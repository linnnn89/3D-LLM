import logging
from typing import Optional, List, Tuple, Dict, Callable, Awaitable, Any

logger = logging.getLogger(__name__)

from .models import (
    MemoryBank,
    MemoryDraft,
    MemorySettings,
    MemoryTaskStatus,
    CompleteTurn,
    HistorySnippet,
)
from .repository import MemoryRepository
from .service import MemoryService
from .prompts import MEMORY_RECALL_TEMPLATE


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
            llm_generate_fn=llm_generate_fn or self._default_mock_llm,
            get_character_info_fn=get_character_info_fn,
            settings=self.settings,
        )

    async def _default_mock_llm(self, messages: list, settings: Any) -> str:
        logger.warning("[MemoryInterface] No llm_generate_fn supplied; using mock response.")
        return "（未配置记忆提炼LLM函数，这是默认生成的记忆占位符）"

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
