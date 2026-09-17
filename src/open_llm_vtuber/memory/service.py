import asyncio
import uuid
from typing import Dict, Optional, Callable, Awaitable, Set, Any
import logging

logger = logging.getLogger(__name__)

from .models import (
    now_iso,
    MemoryBank,
    MemoryDraft,
    MemorySettings,
    MemoryTaskStatus,
    MemoryGenerationSettings,
)
from .repository import MemoryRepository, estimate_tokens
from .prompts import (
    MEMORY_UPDATE_SYSTEM,
    MEMORY_UPDATE_INPUT,
    MEMORY_COMPRESS_SYSTEM,
    MEMORY_COMPRESS_INPUT,
)


class MemoryService:
    """
    Asynchronous memory service orchestrating background memory updates,
    compressions, task cancellation, and status tracking per character.
    """

    def __init__(
        self,
        repository: MemoryRepository,
        llm_generate_fn: Callable[[list, MemoryGenerationSettings], Awaitable[str]],
        get_character_info_fn: Optional[Callable[[str], Dict[str, str]]] = None,
        settings: Optional[MemorySettings] = None,
    ):
        self.repository = repository
        self.llm_generate = llm_generate_fn
        self.get_character_info = get_character_info_fn or (
            lambda char_id: {"name": char_id, "persona": "", "user_profile": ""}
        )
        self.settings = settings or MemorySettings()

        self._running_tasks: Dict[str, asyncio.Task] = {}
        self._pending_queues: Dict[str, Set[str]] = {}
        self._statuses: Dict[str, MemoryTaskStatus] = {}
        self._disposed = False

    def status(self, character_id: str) -> MemoryTaskStatus:
        """Get current task status for a character."""
        if character_id in self._statuses:
            return self._statuses[character_id]
        return MemoryTaskStatus(state="idle", character_id=character_id)

    def _set_status(
        self,
        character_id: str,
        state: str,
        message: Optional[str] = None,
        session_id: Optional[str] = None,
    ):
        st = MemoryTaskStatus(
            state=state,
            character_id=character_id,
            session_id=session_id,
            message=message,
            updated_at=now_iso(),
        )
        self._statuses[character_id] = st
        logger.debug(f"[MemoryService] Character {character_id} status -> {state}: {message}")

    def after_turn(self, character_id: str, session_id: str):
        """
        Check if pending turns have reached the configured threshold.
        If so, schedule an automatic background update task.
        """
        if self._disposed or not self.settings.auto_generate_enabled:
            return

        # If a draft already exists, wait for user resolution
        if self.repository.read_draft(character_id):
            return

        pending = self.repository.pending_turns(character_id, session_id)
        if pending < self.settings.update_interval_turns:
            return

        if character_id not in self._pending_queues:
            self._pending_queues[character_id] = set()
        self._pending_queues[character_id].add(session_id)

        if character_id not in self._running_tasks:
            self._set_status(character_id, "queued", "Memory update queued", session_id)
            asyncio.create_task(self._drain(character_id))

    async def _drain(self, character_id: str):
        """Sequentially process pending sessions for a character."""
        if self._disposed:
            return

        queue = self._pending_queues.get(character_id)
        if not queue:
            self._pending_queues.pop(character_id, None)
            return

        if not self.settings.auto_generate_enabled or self.repository.read_draft(character_id):
            self._pending_queues.pop(character_id, None)
            return

        session_id = next(iter(queue))
        queue.remove(session_id)

        # Verify pending turns still meet requirement
        pending = self.repository.pending_turns(character_id, session_id)
        if pending < self.settings.update_interval_turns:
            await self._drain(character_id)
            return

        try:
            task = asyncio.create_task(
                self._run_task(character_id, "update", session_id, automatic=True)
            )
            self._running_tasks[character_id] = task
            await task
        except Exception as e:
            logger.warning(f"[MemoryService] Background memory update for {character_id} failed: {e}")
        finally:
            self._running_tasks.pop(character_id, None)
            # Continue draining next batch if available
            await self._drain(character_id)

    async def update(self, character_id: str, session_id: str) -> MemoryDraft:
        """Manually trigger memory update and produce an editable draft."""
        return await self._run_task(character_id, "update", session_id, automatic=False)

    async def compress(self, character_id: str) -> MemoryDraft:
        """Manually trigger memory compression on the current memory bank."""
        return await self._run_task(character_id, "compression", None, automatic=False)

    def cancel(self, character_id: str):
        """Cancel any running memory task for a character."""
        self._pending_queues.pop(character_id, None)
        task = self._running_tasks.pop(character_id, None)
        if task and not task.done():
            task.cancel()
            self._set_status(character_id, "cancelled", "Memory task cancelled")

    async def _run_task(
        self,
        character_id: str,
        kind: str,
        session_id: Optional[str],
        automatic: bool,
    ) -> MemoryDraft:
        if self._disposed:
            raise RuntimeError("MemoryService has been disposed.")

        if character_id in self._running_tasks and self._running_tasks[character_id] is not asyncio.current_task():
            raise RuntimeError(f"A memory task is already running for {character_id}.")

        existing_draft = self.repository.read_draft(character_id)
        if existing_draft:
            raise RuntimeError("A draft already exists. Please commit or discard it first.")

        bank = self.repository.read_bank(character_id)
        char_info = self.get_character_info(character_id)
        char_name = char_info.get("name", character_id)
        persona = char_info.get("persona", "")
        user_profile = char_info.get("user_profile", "")

        state_name = "updating" if kind == "update" else "compressing"
        self._set_status(
            character_id,
            state_name,
            "Generating memory update..." if kind == "update" else "Compressing memory...",
            session_id,
        )

        gen_settings = (
            self.settings.update_generation
            if kind == "update"
            else self.settings.compression_generation
        )

        source_batch = None
        source_messages_text = ""
        through_id = None
        turn_count = 0
        digest = ""
        source_msg_ids = []

        if kind == "update":
            if not session_id:
                raise ValueError("session_id is required for memory update.")
            source_batch = self.repository.source_batch(character_id, session_id, self.settings)
            if not source_batch:
                self._set_status(character_id, "idle", "No turns to update", session_id)
                raise ValueError("No unprocessed dialogue turns found.")
            turns, through_id, digest = source_batch
            turn_count = len(turns)
            source_msg_ids = [t.assistant_id for t in turns]
            source_messages_text = "\n\n".join(
                f"User: {t.user_content}\n{char_name}: {t.assistant_content}"
                for t in turns
            )

        length_instr = (
            f"記憶正文の長さ制限：約 {self.settings.target_tokens} tokens 以内"
            if self.settings.target_tokens > 0
            else "記憶の長さに厳密な上限は設けません。必要な事実を簡潔に残してください。"
        )

        if kind == "update":
            system_prompt = MEMORY_UPDATE_SYSTEM.format(
                name=char_name, memory_length_instruction=length_instr
            )
            user_prompt = MEMORY_UPDATE_INPUT.format(
                name=char_name,
                persona=persona,
                user_profile=user_profile,
                memory_body=bank.body or "（まだ記憶はありません）",
                source_messages=source_messages_text,
            )
        else:
            if not bank.body.strip():
                raise ValueError("Cannot compress empty memory bank.")
            system_prompt = MEMORY_COMPRESS_SYSTEM.format(
                name=char_name, memory_length_instruction=length_instr
            )
            user_prompt = MEMORY_COMPRESS_INPUT.format(
                name=char_name, memory_body=bank.body
            )

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]

        try:
            generated_body = await self.llm_generate(messages, gen_settings)
            generated_body = generated_body.strip()
            if not generated_body:
                raise ValueError("LLM returned empty memory body.")

            draft = MemoryDraft(
                id=str(uuid.uuid4()),
                character_id=character_id,
                session_id=session_id,
                kind=kind,
                body=generated_body,
                base_revision=bank.revision,
                source_message_ids=source_msg_ids,
                source_digest=digest,
                through_assistant_id=through_id,
                source_turn_count=turn_count,
            )

            if automatic:
                self.repository.commit_generated(draft)
                self._set_status(
                    character_id,
                    "succeeded",
                    f"Auto-updated memory from {turn_count} turns",
                    session_id,
                )
            else:
                self.repository.save_draft(draft)
                self._set_status(
                    character_id,
                    "succeeded",
                    "Draft generated and saved for review",
                    session_id,
                )
            return draft

        except asyncio.CancelledError:
            self._set_status(character_id, "cancelled", "Task cancelled", session_id)
            raise
        except Exception as e:
            self._set_status(character_id, "failed", str(e), session_id)
            raise e

    def edit_bank(self, character_id: str, body: str, expected_revision: Optional[int] = None) -> MemoryBank:
        """Directly edit memory bank content (cancelling any running task)."""
        self.cancel(character_id)
        bank = self.repository.write_bank(character_id, body, expected_revision)
        self._set_status(character_id, "succeeded", "Memory bank updated manually")
        return bank

    def commit_draft(
        self, character_id: str, draft_id: str, body: str, expected_revision: int
    ) -> MemoryBank:
        """Commit an approved draft with optional user edits."""
        bank = self.repository.commit_draft(character_id, draft_id, body, expected_revision)
        self._set_status(character_id, "succeeded", "Draft committed successfully")
        return bank

    def discard_draft(self, character_id: str, draft_id: Optional[str] = None):
        """Discard an existing draft."""
        self.repository.discard_draft(character_id, draft_id)
        self._set_status(character_id, "idle", "Draft discarded")

    def dispose(self):
        """Dispose and cancel all active operations."""
        self._disposed = True
        for cid in list(self._running_tasks.keys()):
            self.cancel(cid)
        self._pending_queues.clear()
        self._statuses.clear()
