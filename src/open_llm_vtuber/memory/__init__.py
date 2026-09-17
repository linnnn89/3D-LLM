"""
Open-LLM-VTuber Memory Subsystem.
Ported and adapted from the live2Dchat memory architecture.
Provides long-term MemoryBank, FTS5 Trigram BM25 history retrieval,
turn checkpoints, and asynchronous background LLM summarization.
"""

from .models import (
    MemoryBank,
    MemoryCheckpoint,
    MemoryDraft,
    CompleteTurn,
    HistorySnippet,
    MemorySettings,
    HistoryRetrievalSettings,
    MemoryGenerationSettings,
    MemoryTaskStatus,
)
from .config import DEFAULT_MEMORY_SETTINGS, load_memory_settings
from .repository import MemoryRepository
from .service import MemoryService
from .interface import (
    MemoryInterface,
    get_shared_interface,
    register_character_info,
    reset_shared_interface,
)

__all__ = [
    "MemoryBank",
    "MemoryCheckpoint",
    "MemoryDraft",
    "CompleteTurn",
    "HistorySnippet",
    "MemorySettings",
    "HistoryRetrievalSettings",
    "MemoryGenerationSettings",
    "MemoryTaskStatus",
    "DEFAULT_MEMORY_SETTINGS",
    "load_memory_settings",
    "MemoryRepository",
    "MemoryService",
    "MemoryInterface",
    "get_shared_interface",
    "register_character_info",
    "reset_shared_interface",
]
