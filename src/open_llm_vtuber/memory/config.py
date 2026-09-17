"""Runtime configuration for the memory subsystem.

The settings center (``settings_router``) persists the user's sparse memory
overrides into ``global.memory`` inside ``user_settings.json`` of the user data
directory.  This module is the single place that turns those overrides into the
``MemorySettings`` object the memory subsystem actually runs on.
"""

import json
from pathlib import Path
from typing import Any, Dict

from loguru import logger

from .models import HistoryRetrievalSettings, MemoryGenerationSettings, MemorySettings

DEFAULT_MEMORY_SETTINGS: Dict[str, Any] = {
    "auto_generate_enabled": True,
    "update_interval_turns": 10,
    "maximum_source_user_turns": 10,
    "target_tokens": 0,
    "retrieval_enabled": True,
    "retrieval_scope": "current_conversation",
    "retrieval_max_results": 6,
    "retrieval_token_budget": 1200,
    "retrieval_recent_count": 20,
    "memory_model": "",
}

VALID_RETRIEVAL_SCOPES = ("current_conversation", "same_character")


def _as_bool(value: Any, fallback: bool) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in ("1", "true", "yes", "on")
    if isinstance(value, (int, float)):
        return bool(value)
    return fallback


def _as_int(value: Any, fallback: int, minimum: int = 0) -> int:
    if value is None or value == "":
        return fallback
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        logger.warning(f"[Memory] Invalid integer setting {value!r}; using {fallback}.")
        return fallback
    return max(minimum, parsed)


def _user_settings_file() -> Path:
    from ..security.storage_manager import storage_mgr

    return storage_mgr.get_user_data_dir() / "user_settings.json"


def load_memory_overrides() -> Dict[str, Any]:
    """Read the ``global.memory`` overrides written by the settings center."""
    try:
        settings_file = _user_settings_file()
        if not settings_file.exists():
            return {}
        data = json.loads(settings_file.read_text(encoding="utf-8"))
    except Exception as e:
        logger.warning(f"[Memory] Failed to read user settings: {e}")
        return {}

    overrides = (data.get("global") or {}).get("memory") or {}
    if not isinstance(overrides, dict):
        logger.warning("[Memory] global.memory is not an object; ignoring overrides.")
        return {}
    return overrides


def load_memory_settings() -> MemorySettings:
    """Build ``MemorySettings`` from the user's sparse overrides on disk."""
    return build_memory_settings(load_memory_overrides())


def build_memory_settings(overrides: Dict[str, Any]) -> MemorySettings:
    """Build ``MemorySettings`` from defaults merged with sparse overrides."""
    defaults = DEFAULT_MEMORY_SETTINGS

    def value(key: str) -> Any:
        return overrides.get(key, defaults[key])

    scope = str(value("retrieval_scope") or "").strip()
    if scope not in VALID_RETRIEVAL_SCOPES:
        if scope:
            logger.warning(
                f"[Memory] Unknown retrieval scope {scope!r}; "
                f"falling back to {defaults['retrieval_scope']!r}."
            )
        scope = defaults["retrieval_scope"]

    model = str(value("memory_model") or "").strip()

    return MemorySettings(
        target_tokens=_as_int(value("target_tokens"), defaults["target_tokens"]),
        auto_generate_enabled=_as_bool(
            value("auto_generate_enabled"), defaults["auto_generate_enabled"]
        ),
        update_interval_turns=_as_int(
            value("update_interval_turns"), defaults["update_interval_turns"], minimum=1
        ),
        maximum_source_user_turns=_as_int(
            value("maximum_source_user_turns"),
            defaults["maximum_source_user_turns"],
            minimum=1,
        ),
        retrieval=HistoryRetrievalSettings(
            enabled=_as_bool(value("retrieval_enabled"), defaults["retrieval_enabled"]),
            scope=scope,
            recent_message_count=_as_int(
                value("retrieval_recent_count"), defaults["retrieval_recent_count"]
            ),
            maximum_results=_as_int(
                value("retrieval_max_results"),
                defaults["retrieval_max_results"],
                minimum=1,
            ),
            token_budget=_as_int(
                value("retrieval_token_budget"), defaults["retrieval_token_budget"]
            ),
        ),
        update_generation=MemoryGenerationSettings(model=model),
        compression_generation=MemoryGenerationSettings(model=model),
    )
