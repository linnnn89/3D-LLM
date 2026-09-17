import logging
import threading
from typing import Optional, List, Tuple, Dict, Callable, Awaitable, Any

from .models import (
    MemoryBank,
    MemoryDraft,
    MemorySettings,
    MemoryTaskStatus,
    CompleteTurn,
)
from .repository import MemoryRepository
from .service import MemoryService
from .prompts import MEMORY_RECALL_TEMPLATE

logger = logging.getLogger(__name__)

_character_registry: Dict[str, Dict[str, str]] = {}


def register_character_info(character_id: str, info: Dict[str, str]) -> None:
    """Remember name/persona for a character so memory synthesis prompts can use them."""
    if character_id:
        _character_registry[character_id] = dict(info)


def _default_character_info(character_id: str) -> Dict[str, str]:
    info = _character_registry.get(character_id, {})
    return {
        "name": info.get("name") or character_id,
        "persona": info.get("persona", ""),
        "user_profile": info.get("user_profile", ""),
    }


class MemoryInterface:
    """
    Public Facade Interface for the Open-LLM-VTuber Memory System.
    Integrates SQLite FTS5 Trigram historical retrieval, persistent MemoryBank,
    turn checkpoints, and asynchronous background LLM summarization.
    """

    def __init__(
        self,
        db_path: str = "data/memory.sqlite",
        llm_generate_fn: Optional[Callable[[list, Any], Awaitable[str]]] = None,
        get_character_info_fn: Optional[Callable[[str], Dict[str, str]]] = None,
        settings: Optional[MemorySettings] = None,
    ):
        self.settings = settings or MemorySettings()
        self.repository = MemoryRepository(db_path=db_path)
        self.service = MemoryService(
            repository=self.repository,
            llm_generate_fn=llm_generate_fn or self._missing_llm,
            get_character_info_fn=get_character_info_fn or _default_character_info,
            settings=self.settings,
        )

    async def _missing_llm(self, messages: list, settings: Any) -> str:
        """Fail loudly instead of persisting a placeholder as the character's memory."""
        raise RuntimeError(
            "Memory subsystem has no LLM bound; refusing to synthesize a memory entry."
        )

    def set_llm_generate(
        self, llm_generate_fn: Optional[Callable[[list, Any], Awaitable[str]]]
    ) -> None:
        """Bind the LLM used to synthesize memory updates and compressions."""
        if llm_generate_fn is not None:
            self.service.llm_generate = llm_generate_fn

    def refresh_settings(self, settings: MemorySettings) -> None:
        """Apply freshly loaded settings to the running subsystem."""
        self.settings = settings
        self.service.settings = settings

    def get_prompt_injection(
        self,
        character_id: str,
        session_id: str,
        user_text: str,
        excluded_msg_ids: Optional[List[str]] = None,
    ) -> Tuple[str, str]:
        """
        Produce prompt injection components for the current turn.

        Returns:
            Tuple[str, str]: (memory_bank_text, recalled_history_prompt_text)
            - memory_bank_text: Long-term persistent memory body of the character.
            - recalled_history_prompt_text: Formatted historical snippets matching the current query.
        """
        # 1. Read persistent memory bank
        bank = self.repository.read_bank(character_id)
        memory_bank_text = bank.body.strip() if bank and bank.body else ""

        # 2. Retrieve relevant historical dialogue turns via FTS5 BM25
        recalled_snippets_text = ""
        if self.settings.retrieval.enabled and user_text.strip():
            snippets = self.repository.retrieve(
                character_id=character_id,
                session_id=session_id,
                query=user_text,
                settings=self.settings.retrieval,
                excluded_ids=excluded_msg_ids,
            )
            if snippets:
                formatted_turns = []
                for s in snippets:
                    formatted_turns.append(
                        f"・過去の会話:\n  ユーザー: {s.turn.user_content}\n  {character_id}: {s.turn.assistant_content}"
                    )
                recalled_snippets_text = MEMORY_RECALL_TEMPLATE.format(
                    recalled_messages="\n".join(formatted_turns)
                )

        return memory_bank_text, recalled_snippets_text

    def record_turn(
        self,
        character_id: str,
        session_id: str,
        user_id: str,
        user_content: str,
        assistant_id: str,
        assistant_content: str,
        user_created_at: Optional[str] = None,
        assistant_created_at: Optional[str] = None,
    ) -> CompleteTurn:
        """
        Record a complete paired turn and notify background scheduler.
        """
        turn = self.repository.index_turn(
            character_id=character_id,
            session_id=session_id,
            user_id=user_id,
            user_content=user_content,
            assistant_id=assistant_id,
            assistant_content=assistant_content,
            user_created_at=user_created_at,
            assistant_created_at=assistant_created_at,
        )
        # Check and queue auto-update
        self.service.after_turn(character_id, session_id)
        return turn

    def get_bank(self, character_id: str) -> MemoryBank:
        """Get the character's long-term memory bank."""
        return self.repository.read_bank(character_id)

    def save_bank(
        self, character_id: str, body: str, expected_revision: Optional[int] = None
    ) -> MemoryBank:
        """Manually save the memory bank."""
        return self.service.edit_bank(character_id, body, expected_revision)

    def get_draft(self, character_id: str) -> Optional[MemoryDraft]:
        """Get the pending memory draft for review."""
        return self.repository.read_draft(character_id)

    def commit_draft(
        self, character_id: str, draft_id: str, body: str, expected_revision: int
    ) -> MemoryBank:
        """Commit an approved memory draft."""
        return self.service.commit_draft(character_id, draft_id, body, expected_revision)

    def discard_draft(self, character_id: str, draft_id: Optional[str] = None):
        """Discard an active memory draft."""
        self.service.discard_draft(character_id, draft_id)

    async def manual_update(self, character_id: str, session_id: str) -> MemoryDraft:
        """Trigger a manual memory update, returning an editable draft."""
        return await self.service.update(character_id, session_id)

    async def manual_compress(self, character_id: str) -> MemoryDraft:
        """Trigger a manual memory compression, returning an editable draft."""
        return await self.service.compress(character_id)

    def get_status(self, character_id: str) -> MemoryTaskStatus:
        """Get task status for character."""
        return self.service.status(character_id)

    def cancel(self, character_id: str):
        """Cancel running memory task for character."""
        self.service.cancel(character_id)

    def close(self):
        """Cleanly close database and cancel running tasks."""
        self.service.dispose()
        self.repository.close()


_shared_interface: Optional[MemoryInterface] = None
_shared_lock = threading.Lock()


def get_shared_interface() -> MemoryInterface:
    """Return the process-wide MemoryInterface, creating it on first use.

    The subsystem owns a SQLite connection, so every session shares one instance
    rather than opening a connection per WebSocket client.
    """
    global _shared_interface
    if _shared_interface is None:
        with _shared_lock:
            if _shared_interface is None:
                from .config import load_memory_settings

                _shared_interface = MemoryInterface(settings=load_memory_settings())
    return _shared_interface


def reset_shared_interface() -> None:
    """Close and drop the shared instance (used by tests and shutdown)."""
    global _shared_interface
    with _shared_lock:
        if _shared_interface is not None:
            _shared_interface.close()
            _shared_interface = None
