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


# =============================================================================
# [架构导航 / 核心节点] 长程记忆子系统统一门面 (Memory Subsystem Facade)
# -----------------------------------------------------------------------------
# 角色职责:
#   向外提供长程记忆的统一门面接口，解耦上层对话流水线与底层 SQLite FTS5 / LLM 提炼服务。
# 核心机制:
#   1. 双路提示词注入 (get_prompt_injection):
#      - 静态基石: 角色长期记忆银行 MemoryBank (存储长期事实、用户画像、核心关系)；
#      - 动态召回: 基于 SQLite FTS5 Trigram 全文索引，根据当前 user_text 检索高相关度历史对话片段。
#   2. 异步摄入与自动提炼 (record_turn):
#      - 每轮对话结束时，将成对对话轮次摄入 SQLite；
#      - 当积累轮次达到阈值时，自动触发后台异步 LLM 记忆提炼与银行更新任务。
# =============================================================================
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

    # =========================================================================
    # [架构节点 / 记忆召回] 提取静态 MemoryBank 与动态 FTS5 BM25 检索历史
    # 上游调用: single_conversation.py -> process_single_conversation (阶段 3)
    # 下游返回: (memory_bank_text, recalled_history_prompt_text)
    # 注入方式: 组合后填入 BatchInput.metadata["memory_context"]，提示词层面注入
    # =========================================================================
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

    # =========================================================================
    # [架构节点 / 轮次索引] 摄入完整成对对话轮次并通知提炼调度器
    # 上游调用: single_conversation.py -> process_single_conversation (阶段 8)
    # 下游联动: repository.index_turn -> service.notify_new_turn (达到批次阈值时异步提炼)
    # =========================================================================
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
