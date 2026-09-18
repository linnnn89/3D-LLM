# -*- coding: utf-8 -*-
"""Settings API Router for Open-LLM-VTuber.
Provides configuration inspection with real-time default inheritance,
sparse user overrides persisted in User Data Directory (My Documents/LLM-3D-CHAT),
Windows DPAPI key vault management, storage path migration, and Memory subsystem settings.
"""

import os
import json
import copy
import yaml
from pathlib import Path
from typing import Any, Dict, Optional
from fastapi import APIRouter, HTTPException, Body
from loguru import logger

from .service_context import ServiceContext
from .security.key_vault import vault
from .security.storage_manager import storage_mgr, get_default_user_data_dir
from .config_manager.utils import read_yaml
from .memory.config import DEFAULT_MEMORY_SETTINGS


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
        "endpoint": "https://api.fish.audio/v1/tts",
        "default_model": "s2.1-pro-free",
        # 官方 model 头支持的完整取值（见 docs.fish.audio 的 TTS 端点文档）。
        # 必须做白名单校验：未识别的值会被服务端**静默**回退到付费的 s2.1-pro，
        # 于是后续每次合成都变成意料之外的 402。
        "models": ["s2.1-pro-free", "s2.1-pro", "s2-pro", "s1", "drama-3-preview"],
        "latency": "balanced",
        "formats": ["wav", "mp3"],
        "modes": ["standard", "optimized"],
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
        "model": "s2.1-pro-free",
        "latency": "balanced",
        "reference_id": "7f92f8afb8ec43bf81429cc1c9199cb1",
        # 输出格式需与落盘扩展名一致，否则会写出"内容 mp3 / 后缀 wav"的坏文件
        "format": "wav",
        # 情感表现力与语速（官方 TTSRequest 参数）
        "temperature": 0.7,
        "top_p": 0.7,
        "speed": 1.0,
        # 合成模式：standard=每句新建连接（原行为）；optimized=复用长连接
        "mode": "standard",
    },
    # Single source of truth: the memory subsystem reads the same defaults
    "memory": dict(DEFAULT_MEMORY_SETTINGS),
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


# 全局设置存档：固定 3 个槽位。每槽是一整份**全局通用配置**的快照
# （LLM + 长期记忆）。不含 API 密钥（独立存于 DPAPI 保险库）与数据存储路径（随机器走）。
PROFILE_SLOTS = 3


def write_global_llm_to_conf(
    provider: str | None,
    base_url: str | None,
    model: str | None,
    temperature: float | None,
) -> dict:
    """把 LLM 配置写进全局 conf.yaml 的 agent_config.llm_configs（运行时真正读取处）。

    API Key 只写占位符——真实密钥在 DPAPI 保险库里，由 `stateless_llm_factory`
    依据 base_url / model 自动匹配取出。
    """
    conf_path = Path("conf.yaml")
    conf_yaml = read_yaml(str(conf_path)) or {}
    agent_cfg = conf_yaml.setdefault("character_config", {}).setdefault(
        "agent_config", {}
    )
    provider = (provider or "openai_compatible_llm").strip()
    agent_cfg.setdefault("agent_settings", {}).setdefault("basic_memory_agent", {})[
        "llm_provider"
    ] = provider
    llm_conf = agent_cfg.setdefault("llm_configs", {}).setdefault(provider, {})

    if base_url:
        llm_conf["base_url"] = clean_base_url(base_url)
    if model:
        llm_conf["model"] = model.strip()
    if temperature is not None:
        try:
            llm_conf["temperature"] = float(temperature)
        except (TypeError, ValueError):
            pass
    if not llm_conf.get("llm_api_key"):
        llm_conf["llm_api_key"] = "KEY_VAULT"

    with open(conf_path, "w", encoding="utf-8") as yf:
        yaml.dump(conf_yaml, yf, allow_unicode=True, sort_keys=False)
    return llm_conf


def snapshot_global_settings() -> dict:
    """抓取当前生效的**全局通用设置**快照：LLM + 语音合成 + 长期记忆。

    刻意排除 API 密钥（在 DPAPI 保险库）与数据存储路径（属于环境属性）。
    注意：TTS 快照含全局的默认音色（reference_id），但不含"某角色绑定的音色"——
    后者属于角色设置。
    """
    conf_yaml = read_yaml("conf.yaml") or {}
    char_cfg = conf_yaml.get("character_config") or {}
    agent_cfg = char_cfg.get("agent_config") or {}
    provider = (
        (agent_cfg.get("agent_settings") or {})
        .get("basic_memory_agent", {})
        .get("llm_provider", SYSTEM_DEFAULTS["llm"]["provider"])
    )
    llm_conf = (agent_cfg.get("llm_configs") or {}).get(provider) or {}
    llm = {"provider": provider}
    for k in ("base_url", "model", "temperature"):
        v = llm_conf.get(k)
        if v not in (None, ""):
            llm[k] = v

    # 语音合成：整段全局 tts_config（引擎 + 参数 + 默认音色）
    tts = copy.deepcopy(char_cfg.get("tts_config") or {})
    if tts:
        # api_key 永远走保险库，不写进快照
        for engine_cfg in tts.values():
            if isinstance(engine_cfg, dict):
                engine_cfg.pop("api_key", None)

    data = load_user_settings()
    memory = dict((data.get("global") or {}).get("memory") or {})
    return {"llm": llm, "tts": tts, "memory": memory}


def apply_global_settings(snap: dict) -> None:
    """把一份快照写回生效：LLM + 语音合成 → conf.yaml；长期记忆 → user_settings.json。"""
    llm = (snap or {}).get("llm") or {}
    if llm.get("base_url") or llm.get("model"):
        write_global_llm_to_conf(
            llm.get("provider"),
            llm.get("base_url"),
            llm.get("model"),
            llm.get("temperature"),
        )

    tts = (snap or {}).get("tts") or {}
    if tts:
        conf_path = Path("conf.yaml")
        conf_yaml = read_yaml(str(conf_path)) or {}
        char_cfg = conf_yaml.setdefault("character_config", {})
        current = char_cfg.setdefault("tts_config", {})
        for engine, cfg in tts.items():
            if not isinstance(cfg, dict):
                continue
            if engine == "tts_model":
                current["tts_model"] = cfg
                continue
            target = current.setdefault(engine, {})
            # 保留 yaml 里原有的 api_key 占位（密钥由保险库解析）
            kept_key = target.get("api_key")
            target.update(copy.deepcopy(cfg))
            if kept_key is not None and "api_key" not in cfg:
                target["api_key"] = kept_key
        with open(conf_path, "w", encoding="utf-8") as yf:
            yaml.dump(conf_yaml, yf, allow_unicode=True, sort_keys=False)

    data = load_user_settings()
    global_bucket = data.setdefault("global", {})
    memory = (snap or {}).get("memory")
    if memory:
        global_bucket["memory"] = dict(memory)
    else:
        global_bucket.pop("memory", None)
    save_user_settings(data)


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
        global_llm_overrides = user_data.get("global", {}).get("llm", {})

        # LLM / API 提供商是**全局共用**的：固定从 conf.yaml 的
        # character_config.agent_config.llm_configs 读取（角色 yaml 不参与）。
        # 这也是后端运行时真正读取的位置。
        global_agent_config = (
            (base_conf.get("character_config") or {}).get("agent_config") or {}
        )
        active_provider = (
            (global_agent_config.get("agent_settings") or {})
            .get("basic_memory_agent", {})
            .get("llm_provider", SYSTEM_DEFAULTS["llm"]["provider"])
        )
        global_llm = {
            "provider": active_provider,
            **(
                (global_agent_config.get("llm_configs") or {}).get(
                    active_provider, {}
                )
                or {}
            ),
        }

        # 语音合成同样**全局共用**：固定从 conf.yaml 的 character_config.tts_config 读取。
        # 角色 yaml 只可能覆盖其中的"音色"字段（fish reference_id / edge voice）。
        global_tts = copy.deepcopy(
            (base_conf.get("character_config") or {}).get("tts_config") or {}
        )
        for _engine_cfg in global_tts.values():
            if isinstance(_engine_cfg, dict):
                _engine_cfg.pop("api_key", None)

        return {
            "target_character": target_char,
            "character_files": character_files,
            "base_conf": base_conf,
            "character_conf": char_conf,
            "defaults": SYSTEM_DEFAULTS,
            "user_overrides": char_overrides,
            "memory_overrides": memory_overrides,
            "global_llm": global_llm,
            "global_llm_overrides": global_llm_overrides,
            "global_tts": global_tts,
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

        # 2. LLM overrides —— 全局共用，写入 user_settings.json 的 global.llm
        llm_in = payload.get("llm", {})
        if llm_in:
            global_bucket = user_data.setdefault("global", {})
            llm_bucket = global_bucket.setdefault("llm", {})
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
                global_bucket.pop("llm", None)

        # 3. TTS —— 引擎与合成参数**全局共用**（写入 conf.yaml），
        #    只有"音色"随角色走（fish 的 reference_id / edge 的 voice）。
        #    scope=global 时提交的是「默认音色」，同样写进 conf.yaml。
        tts_in = payload.get("tts", {})
        tts_scope = payload.get("scope", "character")
        if tts_in:
            in_prov = tts_in.get("provider", "fish_api_tts")
            tts_bucket = char_bucket.setdefault("tts", {})
            tts_bucket["provider"] = in_prov

            # (a) 全局参数 → conf.yaml 的 character_config.tts_config
            try:
                conf_path = Path("conf.yaml")
                conf_yaml = read_yaml(str(conf_path)) or {}
                g_tts = conf_yaml.setdefault("character_config", {}).setdefault(
                    "tts_config", {}
                )
                g_tts["tts_model"] = in_prov

                if in_prov == "fish_api_tts":
                    g_fish = g_tts.setdefault("fish_api_tts", {})
                    for key in (
                        "base_url",
                        "model",
                        "latency",
                        "format",
                        "temperature",
                        "top_p",
                        "speed",
                        "mode",
                    ):
                        v = tts_in.get(key)
                        if v is None or v == "":
                            continue
                        g_fish[key] = v
                    # 「全局设置」里填的音色是**默认音色**（未单独绑定的角色使用）
                    if tts_scope == "global":
                        g_rid = (tts_in.get("reference_id") or "").strip()
                        if g_rid:
                            g_fish["reference_id"] = g_rid
                    # API Key 只写占位符，真实密钥在 DPAPI 保险库
                    if not g_fish.get("api_key"):
                        g_fish["api_key"] = "KEY_VAULT"

                with open(conf_path, "w", encoding="utf-8") as yf:
                    yaml.dump(conf_yaml, yf, allow_unicode=True, sort_keys=False)
                logger.info("TTS 全局参数已写入 conf.yaml 的 character_config.tts_config")
            except Exception as te:
                logger.warning(f"Could not update conf.yaml tts_config: {te}")

            # (b) 音色 —— 唯一随角色走的 TTS 设置。
            #     全局页保存时提交的是「默认音色」，已经写进 conf.yaml（见上），此处跳过。
            if tts_scope == "global":
                pass
            elif in_prov == "fish_api_tts":
                in_f_ref = (tts_in.get("reference_id") or "").strip()
                if in_f_ref and in_f_ref != SYSTEM_DEFAULTS["tts"]["reference_id"]:
                    tts_bucket["reference_id"] = in_f_ref
                else:
                    tts_bucket.pop("reference_id", None)
            elif in_prov == "edge_tts":
                in_voice = (tts_in.get("voice") or "").strip()
                if in_voice:
                    tts_bucket["voice"] = in_voice

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

        # LLM 覆盖写入**全局** conf.yaml 的 agent_config.llm_configs
        # （这是后端运行时真正读取的位置）。角色 yaml 不再承载 LLM 配置。
        if llm_in:
            try:
                conf_path = Path("conf.yaml")
                conf_yaml = read_yaml(str(conf_path)) or {}
                ac = conf_yaml.setdefault("character_config", {}).setdefault(
                    "agent_config", {}
                )
                ac.setdefault("agent_settings", {}).setdefault(
                    "basic_memory_agent", {}
                )["llm_provider"] = "openai_compatible_llm"
                llm_conf = ac.setdefault("llm_configs", {}).setdefault(
                    "openai_compatible_llm", {}
                )

                in_url = clean_base_url(llm_in.get("base_url") or "")
                if in_url:
                    llm_conf["base_url"] = in_url
                in_model = (llm_in.get("model") or "").strip()
                if in_model:
                    llm_conf["model"] = in_model
                if llm_in.get("temperature") is not None:
                    try:
                        llm_conf["temperature"] = float(llm_in["temperature"])
                    except (TypeError, ValueError):
                        pass
                # API Key 走 DPAPI 密钥库，yaml 中只保留占位符
                if not llm_conf.get("llm_api_key"):
                    llm_conf["llm_api_key"] = "KEY_VAULT"

                with open(conf_path, "w", encoding="utf-8") as yf:
                    yaml.dump(conf_yaml, yf, allow_unicode=True, sort_keys=False)
                logger.info("LLM 配置已写入全局 conf.yaml 的 agent_config.llm_configs")
            except Exception as le:
                logger.warning(f"Could not update conf.yaml llm_configs: {le}")

        # 角色 YAML：只承载人设与声音（LLM 已移至全局 conf.yaml 统一管理）
        characters_dir = Path("characters")
        file_path = characters_dir / target_char if target_char != "conf.yaml" else Path("conf.yaml")
        if file_path.exists():
            try:
                existing_yaml = read_yaml(str(file_path)) or {}
                c_cfg = existing_yaml.setdefault("character_config", {})
                if "persona_prompt" in char_bucket:
                    c_cfg["persona_prompt"] = char_bucket["persona_prompt"]
                if "tts" in char_bucket and payload.get("scope", "character") != "global":
                    t_in = char_bucket["tts"]
                    in_prov = t_in.get("provider", "fish_api_tts")
                    t_cfg = c_cfg.setdefault("tts_config", {})
                    # 角色 yaml 只承载"音色"——引擎与合成参数都在全局 conf.yaml。
                    # 同时清掉历史遗留的全局字段，避免两处配置互相打架。
                    if in_prov == "fish_api_tts":
                        f_cfg = t_cfg.setdefault("fish_api_tts", {})
                        for legacy in (
                            "base_url",
                            "model",
                            "latency",
                            "format",
                            "temperature",
                            "top_p",
                            "speed",
                            "mode",
                            "api_key",
                        ):
                            f_cfg.pop(legacy, None)
                        rid = t_in.get("reference_id")
                        if rid:
                            f_cfg["reference_id"] = rid
                        else:
                            f_cfg.pop("reference_id", None)
                        if not f_cfg:
                            t_cfg.pop("fish_api_tts", None)
                    elif in_prov == "edge_tts":
                        e_cfg = t_cfg.setdefault("edge_tts", {})
                        voice = t_in.get("voice")
                        if voice:
                            e_cfg["voice"] = voice
                    # 引擎选择不再写进角色 yaml（由全局 conf.yaml 决定）
                    t_cfg.pop("tts_model", None)
                    if not t_cfg:
                        c_cfg.pop("tts_config", None)

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

    # ---------- 全局设置存档（3 个槽位）----------
    # 每个槽保存一整份全局通用配置快照（LLM + 长期记忆），可自定义名称、一键切换。
    # 不含 API 密钥（独立存于 DPAPI 保险库）与数据存储路径（随机器走）。
    # 数据落在个人文件夹的 user_settings.json -> global.profiles。

    def _profiles_bucket(data: dict) -> dict:
        """取出并按需补齐槽位，始终保证恰好 PROFILE_SLOTS 个。"""
        global_bucket = data.setdefault("global", {})
        prof = global_bucket.setdefault("profiles", {})
        slots = prof.get("slots")
        if not isinstance(slots, list):
            slots = []
        while len(slots) < PROFILE_SLOTS:
            slots.append({})
        prof["slots"] = slots[:PROFILE_SLOTS]
        prof.setdefault("active", -1)
        return prof

    def _profile_view(slot: dict, index: int) -> dict:
        """给前端的槽位视图：名称 + 摘要（不暴露完整快照）。"""
        slot = slot or {}
        llm = slot.get("llm") or {}
        tts = slot.get("tts") or {}
        memory = slot.get("memory") or {}
        saved = bool(llm.get("base_url") or llm.get("model") or tts)
        fish = tts.get("fish_api_tts") or {}
        return {
            "index": index,
            "name": slot.get("name") or "",
            "saved": saved,
            "summary": {
                "provider": llm.get("provider", ""),
                "baseUrl": llm.get("base_url", ""),
                "model": llm.get("model", ""),
                "temperature": llm.get("temperature"),
                "ttsEngine": tts.get("tts_model", ""),
                "ttsModel": fish.get("model", ""),
                "memoryKeys": len(memory),
            },
        }

    def _check_index(index: int) -> None:
        if not 0 <= index < PROFILE_SLOTS:
            raise HTTPException(
                status_code=400, detail=f"存档索引必须在 0~{PROFILE_SLOTS - 1} 之间"
            )

    @router.get("/profiles")
    async def get_profiles():
        """列出 3 个存档槽位，以及当前生效的全局设置快照（供前端对比/回显）。"""
        data = load_user_settings()
        prof = _profiles_bucket(data)
        return {
            "success": True,
            "slotCount": PROFILE_SLOTS,
            "active": prof.get("active", -1),
            "slots": [_profile_view(s, i) for i, s in enumerate(prof["slots"])],
            "current": snapshot_global_settings(),
        }

    @router.post("/profiles/{index}/capture")
    async def capture_profile(index: int, payload: Optional[dict] = None):
        """把**当前生效的全局设置**整体存为存档 N（覆盖原内容，可同时改名）。

        这是"存档"语义：抓的是当下真实生效的配置，而不是表单里未保存的草稿。
        """
        _check_index(index)
        data = load_user_settings()
        prof = _profiles_bucket(data)

        name = ((payload or {}).get("name") or "").strip()
        if not name:
            name = (prof["slots"][index] or {}).get("name") or f"存档 {index + 1}"

        prof["slots"][index] = {"name": name, **snapshot_global_settings()}
        save_user_settings(data)
        logger.info(f"全局设置已存为存档 [{index}] {name}")
        return {
            "success": True,
            "slot": _profile_view(prof["slots"][index], index),
            "slots": [_profile_view(s, i) for i, s in enumerate(prof["slots"])],
        }

    @router.post("/profiles/{index}/apply")
    async def apply_profile(index: int):
        """启用存档 N：把它记录的全局设置整套写回生效。"""
        _check_index(index)
        data = load_user_settings()
        prof = _profiles_bucket(data)
        slot = prof["slots"][index] or {}
        if not (slot.get("llm") or slot.get("memory")):
            raise HTTPException(status_code=400, detail="该存档尚未保存任何内容")

        apply_global_settings(slot)
        prof["active"] = index
        save_user_settings(data)
        logger.info(f"已启用全局设置存档 [{index}] {slot.get('name')}")
        return {
            "success": True,
            "active": index,
            "current": snapshot_global_settings(),
        }

    @router.post("/profiles/{index}/rename")
    async def rename_profile(index: int, payload: dict):
        """仅重命名存档，不动其内容。"""
        _check_index(index)
        name = (payload.get("name") or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="存档名不能为空")
        data = load_user_settings()
        prof = _profiles_bucket(data)
        slot = prof["slots"][index] or {}
        slot["name"] = name
        prof["slots"][index] = slot
        save_user_settings(data)
        return {
            "success": True,
            "slots": [_profile_view(s, i) for i, s in enumerate(prof["slots"])],
        }

    @router.delete("/profiles/{index}")
    async def clear_profile(index: int):
        """清空某个存档（不影响当前生效的设置）。"""
        _check_index(index)
        data = load_user_settings()
        prof = _profiles_bucket(data)
        prof["slots"][index] = {}
        if prof.get("active") == index:
            prof["active"] = -1
        save_user_settings(data)
        logger.info(f"已清空全局设置存档 [{index}]")
        return {
            "success": True,
            "active": prof.get("active", -1),
            "slots": [_profile_view(s, i) for i, s in enumerate(prof["slots"])],
        }

    @router.post("/open-window")
    async def open_settings_window(
        character: Optional[str] = None,
        page: Optional[str] = None,
        tab: Optional[str] = None,
    ):
        """在独立的 Edge/Chrome 应用窗口中打开设置页。

        使用 --app 模式（无地址栏/标签页），外观与独立桌面弹窗一致，
        并与主视口共用同一份浏览器 profile，避免缓存分叉。

        - `page`: 'settings'（全局：LLM/密钥/记忆/存储）或 'character'（角色：人设/声音/形象）
        - `character`: 让窗口一开始就定位到该角色档案
        - `tab`: 直接定位到某个 tab
        """
        import subprocess
        import tempfile
        from urllib.parse import quote

        candidates = [
            os.path.expandvars(
                r"%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
            ),
            os.path.expandvars(r"%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"),
            os.path.expandvars(
                r"%LOCALAPPDATA%\Microsoft\Edge\Application\msedge.exe"
            ),
            os.path.expandvars(r"%ProgramFiles%\Google\Chrome\Application\chrome.exe"),
            os.path.expandvars(
                r"%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
            ),
            os.path.expandvars(
                r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
            ),
        ]
        exe = next((c for c in candidates if c and os.path.exists(c)), None)
        if not exe:
            raise HTTPException(
                status_code=404,
                detail="未找到 Edge/Chrome，请手动在浏览器打开 /vrm/settings.html",
            )

        port = getattr(default_context_cache.system_config, "port", None) or 12393
        filename = "character.html" if page == "character" else "settings.html"
        url = f"http://127.0.0.1:{port}/vrm/{filename}"
        params = []
        if character:
            params.append(f"character={quote(character)}")
        if tab:
            params.append(f"tab={quote(tab)}")
        if params:
            url += "?" + "&".join(params)
        profile = os.path.join(tempfile.gettempdir(), "vtuber_app_profile")

        try:
            subprocess.Popen(
                [
                    exe,
                    f"--app={url}",
                    f"--user-data-dir={profile}",
                    "--window-size=1020,780",
                    "--no-first-run",
                    "--no-default-browser-check",
                ],
                close_fds=True,
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"启动设置窗口失败: {e}")

        return {"success": True, "url": url}

    return router
