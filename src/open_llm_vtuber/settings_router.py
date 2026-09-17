# -*- coding: utf-8 -*-
"""Settings API Router for Open-LLM-VTuber.
Provides configuration inspection with real-time default inheritance,
sparse user overrides persisted in User Data Directory (My Documents/LLM-3D-CHAT),
Windows DPAPI key vault management, storage path migration, and Memory subsystem settings.
"""

import os
import json
import yaml
from pathlib import Path
from typing import Any, Dict, Optional
from fastapi import APIRouter, HTTPException, Body
from loguru import logger

from .service_context import ServiceContext
from .security.key_vault import vault
from .security.storage_manager import storage_mgr, get_default_user_data_dir
from .config_manager.utils import read_yaml
from .memory.models import MemorySettings, HistoryRetrievalSettings


PRESET_LLM_PROVIDERS = [
    {
        "id": "deepseek",
        "name": "官方 DeepSeek",
        "base_url": "https://api.deepseek.com/v1",
        "default_model": "deepseek-chat",
        "models": ["deepseek-chat", "deepseek-reasoner"],
        "docs": "https://api-docs.deepseek.com",
    },
    {
        "id": "openrouter",
        "name": "OpenRouter",
        "base_url": "https://openrouter.ai/api/v1",
        "default_model": "deepseek/deepseek-chat",
        "models": [
            "deepseek/deepseek-chat",
            "anthropic/claude-3.5-sonnet",
            "openai/gpt-4o",
            "meta-llama/llama-3.3-70b-instruct",
            "google/gemini-2.0-flash-exp:free",
        ],
        "docs": "https://openrouter.ai/docs",
    },
    {
        "id": "commandcode",
        "name": "Command Code",
        "base_url": "https://api.commandcode.ai/provider/v1",
        "default_model": "claude-3-5-sonnet-20241022",
        "models": ["claude-3-5-sonnet-20241022", "gpt-4o", "deepseek-chat"],
        "docs": "https://commandcode.ai",
    },
    {
        "id": "opencode",
        "name": "OpenCode",
        "base_url": "https://api.opencode.ai/v1",
        "default_model": "default",
        "models": ["default"],
        "docs": "https://opencode.ai",
    },
    {
        "id": "custom",
        "name": "自定义 OpenAI 兼容 Provider",
        "base_url": "https://api.your-service.com/v1",
        "default_model": "default",
        "models": ["default"],
        "docs": "",
    },
]

PRESET_TTS_PROVIDERS = [
    {
        "id": "fish_api_tts",
        "name": "Fish Audio (官方云端)",
        "base_url": "https://api.fish.audio",
        "default_model": "s2-pro-free",
        "models": ["s2-pro-free", "s2.1-pro-free", "s2.1-pro"],
        "latency": "balanced",
        "formats": ["wav", "mp3"],
        "default_reference_id": "7f92f8afb8ec43bf81429cc1c9199cb1",
        "docs": "https://docs.fish.audio",
    },
    {
        "id": "edge_tts",
        "name": "Edge TTS (微软免费语音)",
        "voices": [
            "ja-JP-NanamiNeural",
            "zh-CN-XiaoxiaoNeural",
            "zh-CN-YunxiNeural",
            "en-US-JennyNeural",
        ],
    },
]

SYSTEM_DEFAULTS = {
    "llm": {
        "base_url": "https://api.deepseek.com/v1",
        "model": "deepseek-chat",
        "temperature": 0.7,
        "provider": "openai_compatible_llm",
    },
    "tts": {
        "provider": "fish_api_tts",
        "base_url": "https://api.fish.audio",
        "model": "s2-pro-free",
        "latency": "balanced",
        "reference_id": "7f92f8afb8ec43bf81429cc1c9199cb1",
    },
    "memory": {
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
    },
}


def clean_base_url(url: str) -> str:
    """Ensure base_url strictly stops at /v1 without trailing /chat or /chat/completions."""
    clean = (url or "").strip().rstrip("/")
    if clean.endswith("/chat/completions"):
        clean = clean[:-len("/chat/completions")].rstrip("/")
    elif clean.endswith("/chat"):
        clean = clean[:-len("/chat")].rstrip("/")
    return clean


def get_user_settings_file() -> Path:
    """Path to user_settings.json stored alongside keys.enc in the User Data Directory."""
    return storage_mgr.get_user_data_dir() / "user_settings.json"


def load_user_settings() -> dict:
    """Load user settings from user data directory."""
    f = get_user_settings_file()
    if f.exists():
        try:
            return json.loads(f.read_text(encoding="utf-8"))
        except Exception as e:
            logger.warning(f"Failed to read {f}: {e}")
    return {}


def save_user_settings(data: dict) -> bool:
    """Save user settings to user data directory."""
    try:
        f = get_user_settings_file()
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        return True
    except Exception as e:
        logger.error(f"Failed to save user settings: {e}")
        return False


def init_settings_routes(default_context_cache: ServiceContext) -> APIRouter:
    router = APIRouter(prefix="/api/settings", tags=["Settings"])

    @router.get("/providers")
    async def get_providers():
        """Get preset providers for LLM and TTS."""
        return {
            "llm_providers": PRESET_LLM_PROVIDERS,
            "tts_providers": PRESET_TTS_PROVIDERS,
        }

    @router.get("/keys")
    async def get_keys_status():
        """Get configured API keys status with Windows DPAPI encryption."""
        return {
            "vault_path": str(vault.vault_path),
            "user_data_dir": str(storage_mgr.get_user_data_dir()),
            "status": vault.get_keys_status(),
        }

    @router.post("/keys")
    async def save_keys(payload: Dict[str, str] = Body(...)):
        """Save API keys into Windows DPAPI encrypted vault in user data folder."""
        for provider, key in payload.items():
            vault.set_key(provider, key)
        return {
            "success": True,
            "message": f"API 密钥已通过 Windows DPAPI 成功加密并保存至 {vault.vault_path}。",
            "status": vault.get_keys_status(),
        }

    @router.get("/storage-path")
    async def get_storage_path():
        """Get current and default user data storage directory."""
        return {
            "current_path": str(storage_mgr.get_user_data_dir()),
            "default_path": str(get_default_user_data_dir()),
            "is_default": storage_mgr.get_user_data_dir() == get_default_user_data_dir(),
        }

    @router.post("/storage-path")
    async def update_storage_path(payload: Dict[str, Any] = Body(...)):
        """Update and optionally migrate user data directory."""
        new_path = payload.get("new_path")
        migrate = payload.get("migrate", True)
        if not new_path:
            raise HTTPException(status_code=400, detail="new_path is required")

        ok, msg = storage_mgr.set_user_data_dir(new_path, migrate=migrate)
        if not ok:
            raise HTTPException(status_code=500, detail=msg)
        return {
            "success": True,
            "message": msg,
            "current_path": str(storage_mgr.get_user_data_dir()),
        }

    @router.post("/storage-path/reset")
    async def reset_storage_path():
        """Reset storage path back to default Documents/LLM-3D-CHAT and migrate files back."""
        ok, msg = storage_mgr.reset_to_default(migrate=True)
        if not ok:
            raise HTTPException(status_code=500, detail=msg)
        return {
            "success": True,
            "message": msg,
            "current_path": str(storage_mgr.get_user_data_dir()),
        }

    @router.get("/config")
    async def get_settings_config(character: Optional[str] = None):
        """Get active configuration alongside system defaults for placeholder reference."""
        try:
            base_conf = read_yaml("conf.yaml")
        except Exception:
            base_conf = {}

        characters_dir = Path("characters")
        character_files = []
        if characters_dir.exists():
            character_files = [f.name for f in characters_dir.glob("*.yaml") if f.is_file()]

        target_char = character or (character_files[0] if character_files else "conf.yaml")
        char_conf = {}
        if target_char != "conf.yaml" and (characters_dir / target_char).exists():
            try:
                char_conf = read_yaml(str(characters_dir / target_char)) or {}
            except Exception as e:
                logger.warning(f"Failed to read character yaml {target_char}: {e}")

        user_data = load_user_settings()
        char_overrides = user_data.get("characters", {}).get(target_char, {})
        memory_overrides = user_data.get("global", {}).get("memory", {})

        return {
            "target_character": target_char,
            "character_files": character_files,
            "base_conf": base_conf,
            "character_conf": char_conf,
            "defaults": SYSTEM_DEFAULTS,
            "user_overrides": char_overrides,
            "memory_overrides": memory_overrides,
            "keys_status": vault.get_keys_status(),
            "user_data_dir": str(storage_mgr.get_user_data_dir()),
            "default_user_data_dir": str(get_default_user_data_dir()),
        }

    @router.post("/config")
    async def save_settings_config(payload: Dict[str, Any] = Body(...)):
        """Sparse/Incremental save of user overrides into user_settings.json in User Data Directory."""
        target_char = payload.get("character_file")
        if not target_char:
            raise HTTPException(status_code=400, detail="character_file is required")

        user_data = load_user_settings()
        char_bucket = user_data.setdefault("characters", {}).setdefault(target_char, {})

        # 1. Persona prompt
        if "persona_prompt" in payload:
            val = payload["persona_prompt"]
            if val and val.strip():
                char_bucket["persona_prompt"] = val
            else:
                char_bucket.pop("persona_prompt", None)

        # 2. LLM overrides (only save if different from defaults!)
        llm_in = payload.get("llm", {})
        if llm_in:
            llm_bucket = char_bucket.setdefault("llm", {})
            def_base = SYSTEM_DEFAULTS["llm"]["base_url"]
            def_model = SYSTEM_DEFAULTS["llm"]["model"]
            def_temp = SYSTEM_DEFAULTS["llm"]["temperature"]

            in_url = clean_base_url(llm_in.get("base_url") or "")
            if in_url and in_url != def_base:
                llm_bucket["base_url"] = in_url
            else:
                llm_bucket.pop("base_url", None)

            in_model = (llm_in.get("model") or "").strip()
            if in_model and in_model != def_model:
                llm_bucket["model"] = in_model
            else:
                llm_bucket.pop("model", None)

            if "temperature" in llm_in and llm_in["temperature"] is not None:
                in_temp = float(llm_in["temperature"])
                if abs(in_temp - def_temp) > 0.001:
                    llm_bucket["temperature"] = in_temp
                else:
                    llm_bucket.pop("temperature", None)

            if not llm_bucket:
                char_bucket.pop("llm", None)

        # 3. TTS overrides (only save if different from defaults!)
        tts_in = payload.get("tts", {})
        if tts_in:
            tts_bucket = char_bucket.setdefault("tts", {})
            in_prov = tts_in.get("provider", "fish_api_tts")
            tts_bucket["provider"] = in_prov

            if in_prov == "fish_api_tts":
                def_fish_base = SYSTEM_DEFAULTS["tts"]["base_url"]
                def_fish_model = SYSTEM_DEFAULTS["tts"]["model"]
                def_fish_lat = SYSTEM_DEFAULTS["tts"]["latency"]
                def_fish_ref = SYSTEM_DEFAULTS["tts"]["reference_id"]

                in_f_url = (tts_in.get("base_url") or "").strip()
                if in_f_url and in_f_url != def_fish_base:
                    tts_bucket["base_url"] = in_f_url
                else:
                    tts_bucket.pop("base_url", None)

                in_f_model = (tts_in.get("model") or "").strip()
                if in_f_model and in_f_model != def_fish_model:
                    tts_bucket["model"] = in_f_model
                else:
                    tts_bucket.pop("model", None)

                in_f_lat = (tts_in.get("latency") or "").strip()
                if in_f_lat and in_f_lat != def_fish_lat:
                    tts_bucket["latency"] = in_f_lat
                else:
                    tts_bucket.pop("latency", None)

                in_f_ref = (tts_in.get("reference_id") or "").strip()
                if in_f_ref and in_f_ref != def_fish_ref:
                    tts_bucket["reference_id"] = in_f_ref
                else:
                    tts_bucket.pop("reference_id", None)
            elif in_prov == "edge_tts":
                if "voice" in tts_in and tts_in["voice"]:
                    tts_bucket["voice"] = tts_in["voice"]

            if len(tts_bucket) <= 1 and tts_bucket.get("provider") == SYSTEM_DEFAULTS["tts"]["provider"]:
                char_bucket.pop("tts", None)

        # 4. Memory Settings overrides (saved into global.memory in user_settings.json)
        mem_in = payload.get("memory")
        if mem_in:
            global_bucket = user_data.setdefault("global", {})
            mem_bucket = global_bucket.setdefault("memory", {})
            def_mem = SYSTEM_DEFAULTS["memory"]

            for k, def_v in def_mem.items():
                if k in mem_in:
                    user_v = mem_in[k]
                    if isinstance(def_v, bool):
                        user_v = bool(user_v)
                    elif isinstance(def_v, int):
                        if user_v == "" or user_v is None:
                            user_v = def_v
                        else:
                            try:
                                user_v = int(user_v)
                            except (ValueError, TypeError):
                                user_v = def_v
                    elif isinstance(def_v, str):
                        user_v = str(user_v).strip() if user_v is not None else ""

                    if user_v != def_v:
                        mem_bucket[k] = user_v
                    else:
                        mem_bucket.pop(k, None)
            if not mem_bucket:
                global_bucket.pop("memory", None)

        # Clean empty char bucket
        if not char_bucket:
            user_data.get("characters", {}).pop(target_char, None)

        # Persist user_settings.json in user data directory
        save_user_settings(user_data)
        logger.info(f"Saved user overrides to {get_user_settings_file()}")

        # Also write active overrides to character YAML for seamless backend consumption
        characters_dir = Path("characters")
        file_path = characters_dir / target_char if target_char != "conf.yaml" else Path("conf.yaml")
        if file_path.exists():
            try:
                existing_yaml = read_yaml(str(file_path)) or {}
                c_cfg = existing_yaml.setdefault("character_config", {})
                if "persona_prompt" in char_bucket:
                    c_cfg["persona_prompt"] = char_bucket["persona_prompt"]
                if "llm" in char_bucket:
                    ag = c_cfg.setdefault("agent_config", {}).setdefault("agent_settings", {}).setdefault("basic_memory_agent", {})
                    ag["llm_provider"] = "openai_compatible_llm"
                    ls = ag.setdefault("llm_settings", {}).setdefault("openai_compatible_llm", {})
                    if "base_url" in char_bucket["llm"]:
                        ls["base_url"] = char_bucket["llm"]["base_url"]
                    if "model" in char_bucket["llm"]:
                        ls["model"] = char_bucket["llm"]["model"]
                    if "temperature" in char_bucket["llm"]:
                        ls["temperature"] = char_bucket["llm"]["temperature"]
                    ls["llm_api_key"] = "KEY_VAULT"
                if "tts" in char_bucket:
                    t_cfg = c_cfg.setdefault("tts_config", {})
                    t_cfg["tts_model"] = char_bucket["tts"].get("provider", "fish_api_tts")
                    if t_cfg["tts_model"] == "fish_api_tts":
                        f_cfg = t_cfg.setdefault("fish_api_tts", {})
                        f_cfg["api_key"] = "KEY_VAULT"
                        if "base_url" in char_bucket["tts"]: f_cfg["base_url"] = char_bucket["tts"]["base_url"]
                        if "model" in char_bucket["tts"]: f_cfg["model"] = char_bucket["tts"]["model"]
                        if "latency" in char_bucket["tts"]: f_cfg["latency"] = char_bucket["tts"]["latency"]
                        if "reference_id" in char_bucket["tts"]: f_cfg["reference_id"] = char_bucket["tts"]["reference_id"]
                    elif t_cfg["tts_model"] == "edge_tts":
                        e_cfg = t_cfg.setdefault("edge_tts", {})
                        if "voice" in char_bucket["tts"]: e_cfg["voice"] = char_bucket["tts"]["voice"]

                with open(file_path, "w", encoding="utf-8") as yf:
                    yaml.dump(existing_yaml, yf, allow_unicode=True, sort_keys=False)
            except Exception as ye:
                logger.warning(f"Could not update yaml: {ye}")

        return {
            "success": True,
            "message": f"设置已成功增量保存至用户资料库: {get_user_settings_file()}",
            "user_data_file": str(get_user_settings_file()),
            "character_file": target_char,
        }

    return router
