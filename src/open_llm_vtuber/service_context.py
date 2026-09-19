import os
import json
import copy
from typing import Callable
from loguru import logger
from fastapi import WebSocket

from prompts import prompt_loader
from .live2d_model import Live2dModel
from .asr.asr_interface import ASRInterface
from .tts.tts_interface import TTSInterface
from .vad.vad_interface import VADInterface
from .agent.agents.agent_interface import AgentInterface
from .translate.translate_interface import TranslateInterface

from .mcpp.server_registry import ServerRegistry
from .mcpp.tool_manager import ToolManager
from .mcpp.mcp_client import MCPClient
from .mcpp.tool_executor import ToolExecutor
from .mcpp.tool_adapter import ToolAdapter

from .asr.asr_factory import ASRFactory
from .tts.tts_factory import TTSFactory
from .vad.vad_factory import VADFactory
from .agent.agent_factory import AgentFactory
from .translate.translate_factory import TranslateFactory

from .config_manager import (
    Config,
    AgentConfig,
    CharacterConfig,
    SystemConfig,
    ASRConfig,
    TTSConfig,
    VADConfig,
    TranslatorConfig,
    read_yaml,
    validate_config,
)


# =============================================================================
# [架构导航 / 核心节点] 服务上下文与依赖注入中心 (ServiceContext)
# -----------------------------------------------------------------------------
# 角色职责: 全系统核心引擎容器与依赖注入（DI）枢纽。
# 管理组件:
#   - 基础感知与动作: Live2dModel, ASRInterface, TTSInterface, VADInterface
#   - 智能与翻译: AgentInterface (LLM), TranslateInterface
#   - 工具与外部生态: MCP 客户端体系 (ServerRegistry, ToolAdapter, ToolManager, ToolExecutor)
#   - 持久记忆: Long-term memory subsystem (MemoryInterface, 跨会话共享)
# 生命周期与分身模式 (Prototype & Session Clone):
#   1. 全局原型 (default_context_cache): 由 run_server -> server.initialize 装载常驻内存；
#   2. 会话副本 (session_service_context): 客户端连接时通过 load_cache 引用共享重度模型，
#      同时独立维护当前连接专享的 send_text, client_uid, history_uid 及 MCP Client。
# 高危注意:
#   - 动态热重载必须走 load_from_config 比对配置 diff，避免重复初始化大模型导致显存泄漏。
#   - 会话断开时必须调用 close() 释放 MCPClient 及后台子进程。
# =============================================================================
class ServiceContext:
    """Initializes, stores, and updates the asr, tts, and llm instances and other
    configurations for a connected client."""

    def __init__(self):
        self.config: Config = None
        self.system_config: SystemConfig = None
        self.character_config: CharacterConfig = None

        self.live2d_model: Live2dModel = None
        self.asr_engine: ASRInterface = None
        self.tts_engine: TTSInterface = None
        self.agent_engine: AgentInterface = None
        # translate_engine can be none if translation is disabled
        self.vad_engine: VADInterface | None = None
        self.translate_engine: TranslateInterface | None = None

        self.mcp_server_registery: ServerRegistry | None = None
        self.tool_adapter: ToolAdapter | None = None
        self.tool_manager: ToolManager | None = None
        self.mcp_client: MCPClient | None = None
        self.tool_executor: ToolExecutor | None = None

        # the system prompt is a combination of the persona prompt and live2d expression prompt
        self.system_prompt: str = None

        # Store the generated MCP prompt string (if MCP enabled)
        self.mcp_prompt: str = ""

        self.history_uid: str = ""  # Add history_uid field

        # Long-term memory subsystem, shared process-wide across sessions
        self.memory_interface = None

        self.send_text: Callable = None
        self.client_uid: str = None

    def __str__(self):
        return (
            f"ServiceContext:\n"
            f"  System Config: {'Loaded' if self.system_config else 'Not Loaded'}\n"
            f"    Details: {json.dumps(self.system_config.model_dump(), indent=6) if self.system_config else 'None'}\n"
            f"  Live2D Model: {self.live2d_model.model_info if self.live2d_model else 'Not Loaded'}\n"
            f"  ASR Engine: {type(self.asr_engine).__name__ if self.asr_engine else 'Not Loaded'}\n"
            f"    Config: {json.dumps(self.character_config.asr_config.model_dump(), indent=6) if self.character_config.asr_config else 'None'}\n"
            f"  TTS Engine: {type(self.tts_engine).__name__ if self.tts_engine else 'Not Loaded'}\n"
            f"    Config: {json.dumps(self.character_config.tts_config.model_dump(), indent=6) if self.character_config.tts_config else 'None'}\n"
            f"  LLM Engine: {type(self.agent_engine).__name__ if self.agent_engine else 'Not Loaded'}\n"
            f"    Agent Config: {json.dumps(self.character_config.agent_config.model_dump(), indent=6) if self.character_config.agent_config else 'None'}\n"
            f"  VAD Engine: {type(self.vad_engine).__name__ if self.vad_engine else 'Not Loaded'}\n"
            f"    Agent Config: {json.dumps(self.character_config.vad_config.model_dump(), indent=6) if self.character_config.vad_config else 'None'}\n"
            f"  System Prompt: {self.system_prompt or 'Not Set'}\n"
            f"  MCP Enabled: {'Yes' if self.mcp_client else 'No'}"
        )

    # ==== Initializers

    async def _init_mcp_components(self, use_mcpp, enabled_servers):
        """Initializes MCP components based on configuration, dynamically fetching tool info."""
        logger.debug(
            f"Initializing MCP components: use_mcpp={use_mcpp}, enabled_servers={enabled_servers}"
        )

        # Reset MCP components first
        self.mcp_server_registery = None
        self.tool_manager = None
        self.mcp_client = None
        self.tool_executor = None
        self.json_detector = None
        self.mcp_prompt = ""

        if use_mcpp and enabled_servers:
            # 1. Initialize ServerRegistry
            self.mcp_server_registery = ServerRegistry()
            logger.info("ServerRegistry initialized or referenced.")

            # 2. Use ToolAdapter to get the MCP prompt and tools
            if not self.tool_adapter:
                logger.error(
                    "ToolAdapter not initialized before calling _init_mcp_components."
                )
                self.mcp_prompt = "[Error: ToolAdapter not initialized]"
                return  # Exit if ToolAdapter is mandatory and not initialized

            try:
                (
                    mcp_prompt_string,
                    openai_tools,
                    claude_tools,
                ) = await self.tool_adapter.get_tools(enabled_servers)
                # Store the generated prompt string
                self.mcp_prompt = mcp_prompt_string
                logger.info(
                    f"Dynamically generated MCP prompt string (length: {len(self.mcp_prompt)})."
                )
                logger.info(
                    f"Dynamically formatted tools - OpenAI: {len(openai_tools)}, Claude: {len(claude_tools)}."
                )

                # 3. Initialize ToolManager with the fetched formatted tools

                _, raw_tools_dict = await self.tool_adapter.get_server_and_tool_info(
                    enabled_servers
                )
                self.tool_manager = ToolManager(
                    formatted_tools_openai=openai_tools,
                    formatted_tools_claude=claude_tools,
                    initial_tools_dict=raw_tools_dict,
                )
                logger.info("ToolManager initialized with dynamically fetched tools.")

            except Exception as e:
                logger.error(
                    f"Failed during dynamic MCP tool construction: {e}", exc_info=True
                )
                # Ensure dependent components are not created if construction fails
                self.tool_manager = None
                self.mcp_prompt = "[Error constructing MCP tools/prompt]"

            # 4. Initialize MCPClient
            if self.mcp_server_registery:
                self.mcp_client = MCPClient(
                    self.mcp_server_registery, self.send_text, self.client_uid
                )
                logger.info("MCPClient initialized for this session.")
            else:
                logger.error(
                    "MCP enabled but ServerRegistry not available. MCPClient not created."
                )
                self.mcp_client = None  # Ensure it's None

            # 5. Initialize ToolExecutor
            if self.mcp_client and self.tool_manager:
                self.tool_executor = ToolExecutor(self.mcp_client, self.tool_manager)
                logger.info("ToolExecutor initialized for this session.")
            else:
                logger.warning(
                    "MCPClient or ToolManager not available. ToolExecutor not created."
                )
                self.tool_executor = None  # Ensure it's None

            logger.info("StreamJSONDetector initialized for this session.")

        elif use_mcpp and not enabled_servers:
            logger.warning(
                "use_mcpp is True, but mcp_enabled_servers list is empty. MCP components not initialized."
            )
        else:
            logger.debug(
                "MCP components not initialized (use_mcpp is False or no enabled servers)."
            )

    # =========================================================================
    # [生命周期与清理] 会话销毁资源回收
    # 上游调用: websocket_handler.py -> handle_disconnect(client_uid)
    # 核心职责: 关闭本会话的 MCPClient 连接与 Agent 内部异步资源，防止子进程与网络僵死
    # =========================================================================
    async def close(self):
        """Close resources associated with this service context."""
        logger.info("Closing ServiceContext resources...")
        if self.mcp_client:
            logger.info(f"Closing MCPClient for context instance {id(self)}...")
            await self.mcp_client.aclose()
            self.mcp_client = None
        if self.agent_engine and hasattr(self.agent_engine, "close"):
            await self.agent_engine.close()  # Ensure agent resources are also closed
        logger.info("ServiceContext closed.")

    # =========================================================================
    # [架构节点 / 会话分身] 从全局原型轻量克隆会话上下文
    # 上游调用: websocket_handler.py -> _init_service_context
    # 核心设计:
    #   - 传入全局共享的 ASR/TTS/Agent/Live2D 引擎实例引用（零重复载入开销）
    #   - 独立绑定当前连接的 send_text 与 client_uid
    #   - 为该会话独立初始化专属的 MCP 组件链 (_init_mcp_components)
    # =========================================================================
    async def load_cache(
        self,
        config: Config,
        system_config: SystemConfig,
        character_config: CharacterConfig,
        live2d_model: Live2dModel,
        asr_engine: ASRInterface,
        tts_engine: TTSInterface,
        vad_engine: VADInterface,
        agent_engine: AgentInterface,
        translate_engine: TranslateInterface | None,
        mcp_server_registery: ServerRegistry | None = None,
        tool_adapter: ToolAdapter | None = None,
        send_text: Callable = None,
        client_uid: str = None,
    ) -> None:
        """
        Load the ServiceContext with the reference of the provided instances.
        Pass by reference so no reinitialization will be done.
        """
        if not character_config:
            raise ValueError("character_config cannot be None")
        if not system_config:
            raise ValueError("system_config cannot be None")

        self.config = config
        self.system_config = system_config
        self.character_config = character_config
        self.live2d_model = live2d_model
        self.asr_engine = asr_engine
        self.tts_engine = tts_engine
        self.vad_engine = vad_engine
        self.agent_engine = agent_engine
        self.translate_engine = translate_engine
        # Load potentially shared components by reference
        self.mcp_server_registery = mcp_server_registery
        self.tool_adapter = tool_adapter
        self.send_text = send_text
        self.client_uid = client_uid

        # Initialize session-specific MCP components
        await self._init_mcp_components(
            self.character_config.agent_config.agent_settings.basic_memory_agent.use_mcpp,
            self.character_config.agent_config.agent_settings.basic_memory_agent.mcp_enabled_servers,
        )

        logger.debug(f"Loaded service context with cache: {character_config}")

    # =========================================================================
    # [架构节点 / 配置热重载] 全量/增量差异化重载引擎
    # 上游调用:
    #   - 服务启动: server.initialize -> default_context_cache.load_from_config
    #   - 运行时切配置: settings_router.py / websocket_handler.py -> handle_config_switch
    # 核心设计:
    #   - 检查子配置是否变动，仅当配置变更时才触发对应 Factory 重新实例化
    #   - 未变更的引擎保持原有实例，防止重载时发生显存/内存溢出
    # =========================================================================
    async def load_from_config(self, config: Config) -> None:
        """
        Load the ServiceContext with the config.
        Reinitialize the instances if the config is different.

        Parameters:
        - config (Dict): The configuration dictionary.
        """
        if not self.config:
            self.config = config

        if not self.system_config:
            self.system_config = config.system_config

        if not self.character_config:
            self.character_config = config.character_config

        # update all sub-configs

        # init live2d from character config
        self.init_live2d(config.character_config.live2d_model_name)

        # init asr from character config
        self.init_asr(config.character_config.asr_config)

        # init tts from character config
        self.init_tts(config.character_config.tts_config)

        # init vad from character config
        self.init_vad(config.character_config.vad_config)

        # Initialize shared ToolAdapter if it doesn't exist yet
        if (
            not self.tool_adapter
            and config.character_config.agent_config.agent_settings.basic_memory_agent.use_mcpp
        ):
            if not self.mcp_server_registery:
                logger.info(
                    "Initializing shared ServerRegistry within load_from_config."
                )
                self.mcp_server_registery = ServerRegistry()
            logger.info("Initializing shared ToolAdapter within load_from_config.")
            self.tool_adapter = ToolAdapter(server_registery=self.mcp_server_registery)

        # Initialize MCP Components before initializing Agent
        await self._init_mcp_components(
            config.character_config.agent_config.agent_settings.basic_memory_agent.use_mcpp,
            config.character_config.agent_config.agent_settings.basic_memory_agent.mcp_enabled_servers,
        )

        # init agent from character config
        await self.init_agent(
            config.character_config.agent_config,
            config.character_config.persona_prompt,
        )

        self.init_translate(
            config.character_config.tts_preprocessor_config.translator_config
        )

        # store typed config references
        self.config = config
        self.system_config = config.system_config or self.system_config
        self.character_config = config.character_config

    def init_live2d(self, live2d_model_name: str) -> None:
        logger.info(f"Initializing Live2D: {live2d_model_name}")
        try:
            self.live2d_model = Live2dModel(live2d_model_name)
            self.character_config.live2d_model_name = live2d_model_name
        except Exception as e:
            logger.critical(f"Error initializing Live2D: {e}")
            logger.critical("Try to proceed without Live2D...")

    def init_asr(self, asr_config: ASRConfig) -> None:
        if not self.asr_engine or (self.character_config.asr_config != asr_config):
            logger.info(f"Initializing ASR: {asr_config.asr_model}")
            try:
                self.asr_engine = ASRFactory.get_asr_system(
                    asr_config.asr_model,
                    **getattr(asr_config, asr_config.asr_model).model_dump(),
                )
                # saving config should be done after successful initialization
                self.character_config.asr_config = asr_config
            except Exception as e:
                logger.error(f"Failed to initialize ASR ({asr_config.asr_model}): {e}")
                logger.warning(
                    "Proceeding without ASR. Text interaction will remain fully functional."
                )
                self.asr_engine = None
        else:
            logger.info("ASR already initialized with the same config.")

    def init_tts(self, tts_config: TTSConfig) -> None:
        if not self.tts_engine or (self.character_config.tts_config != tts_config):
            logger.info(f"Initializing TTS: {tts_config.tts_model}")
            self.tts_engine = TTSFactory.get_tts_engine(
                tts_config.tts_model,
                **getattr(tts_config, tts_config.tts_model.lower()).model_dump(),
            )
            # saving config should be done after successful initialization
            self.character_config.tts_config = tts_config
        else:
            logger.info("TTS already initialized with the same config.")

    def init_vad(self, vad_config: VADConfig) -> None:
        if vad_config.vad_model is None:
            logger.info("VAD is disabled.")
            self.vad_engine = None
            return

        if not self.vad_engine or (self.character_config.vad_config != vad_config):
            logger.info(f"Initializing VAD: {vad_config.vad_model}")
            self.vad_engine = VADFactory.get_vad_engine(
                vad_config.vad_model,
                **getattr(vad_config, vad_config.vad_model.lower()).model_dump(),
            )
            # saving config should be done after successful initialization
            self.character_config.vad_config = vad_config
        else:
            logger.info("VAD already initialized with the same config.")

    async def init_agent(self, agent_config: AgentConfig, persona_prompt: str) -> None:
        """Initialize or update the LLM engine based on agent configuration."""
        logger.info(f"Initializing Agent: {agent_config.conversation_agent_choice}")

        if (
            self.agent_engine is not None
            and agent_config == self.character_config.agent_config
            and persona_prompt == self.character_config.persona_prompt
        ):
            logger.debug("Agent already initialized with the same config.")
            return

        system_prompt = await self.construct_system_prompt(persona_prompt)

        # Pass avatar to agent factory
        avatar = self.character_config.avatar or ""  # Get avatar from config

        try:
            self.agent_engine = AgentFactory.create_agent(
                conversation_agent_choice=agent_config.conversation_agent_choice,
                agent_settings=agent_config.agent_settings.model_dump(),
                llm_configs=agent_config.llm_configs.model_dump(),
                system_prompt=system_prompt,
                live2d_model=self.live2d_model,
                tts_preprocessor_config=self.character_config.tts_preprocessor_config,
                character_avatar=avatar,
                system_config=self.system_config.model_dump(),
                tool_manager=self.tool_manager,
                tool_executor=self.tool_executor,
                mcp_prompt_string=self.mcp_prompt,
            )

            logger.debug(f"Agent choice: {agent_config.conversation_agent_choice}")
            logger.debug(f"System prompt: {system_prompt}")

            # Save the current configuration
            self.character_config.agent_config = agent_config
            self.system_prompt = system_prompt
            self._init_memory(agent_config, persona_prompt)

        except Exception as e:
            logger.error(f"Failed to initialize agent: {e}")
            raise

    def _init_memory(self, agent_config: AgentConfig, persona_prompt: str = "") -> None:
        """Attach the process-wide long-term memory subsystem to this session.

        The subsystem owns a SQLite connection, so all sessions share one instance
        while the LLM used for memory synthesis is rebound to the current agent.
        """
        try:
            from .memory import (
                get_shared_interface,
                load_memory_settings,
                register_character_info,
            )

            memory = get_shared_interface()
            memory.refresh_settings(load_memory_settings())

            character_config = self.character_config
            if character_config:
                register_character_info(
                    character_config.conf_uid,
                    {
                        "name": character_config.character_name or "",
                        "persona": persona_prompt or character_config.persona_prompt or "",
                    },
                )

            if hasattr(self.agent_engine, "generate_memory_text"):
                memory.set_llm_generate(self.agent_engine.generate_memory_text)
            else:
                logger.warning(
                    f"Agent {type(self.agent_engine).__name__} cannot synthesize memories; "
                    "automatic memory updates stay unavailable for this session."
                )

            self.memory_interface = memory
            logger.info("Long-term memory subsystem attached.")
        except Exception as e:
            logger.error(f"Failed to initialize the long-term memory subsystem: {e}")
            self.memory_interface = None

    def init_translate(self, translator_config: TranslatorConfig) -> None:
        """Initialize or update the translation engine based on the configuration."""

        if not translator_config.translate_audio:
            logger.debug("Translation is disabled.")
            return

        if (
            not self.translate_engine
            or self.character_config.tts_preprocessor_config.translator_config
            != translator_config
        ):
            logger.info(
                f"Initializing Translator: {translator_config.translate_provider}"
            )
            self.translate_engine = TranslateFactory.get_translator(
                translator_config.translate_provider,
                getattr(
                    translator_config, translator_config.translate_provider
                ).model_dump(),
            )
            self.character_config.tts_preprocessor_config.translator_config = (
                translator_config
            )
        else:
            logger.info("Translation already initialized with the same config.")

    # ==== utils

    async def construct_system_prompt(self, persona_prompt: str) -> str:
        """
        Append tool prompts to persona prompt.

        Parameters:
        - persona_prompt (str): The persona prompt.

        Returns:
        - str: The system prompt with all tool prompts appended.
        """
        logger.debug(f"constructing persona_prompt: '''{persona_prompt}'''")

        for prompt_name, prompt_file in self.system_config.tool_prompts.items():
            if (
                prompt_name == "group_conversation_prompt"
                or prompt_name == "proactive_speak_prompt"
            ):
                continue

            prompt_content = prompt_loader.load_util(prompt_file)

            if prompt_name == "live2d_expression_prompt":
                prompt_content = prompt_content.replace(
                    "[<insert_emomap_keys>]", self.live2d_model.emo_str
                )

            if prompt_name == "mcp_prompt":
                continue

            persona_prompt += prompt_content

        logger.debug("\n === System Prompt ===")
        logger.debug(persona_prompt)

        return persona_prompt

    async def handle_config_switch(
        self,
        websocket: WebSocket,
        config_file_name: str,
    ) -> None:
        """
        Handle the configuration switch request.
        Change the configuration to a new config and notify the client.

        Parameters:
        - websocket (WebSocket): The WebSocket connection.
        - config_file_name (str): The name of the configuration file.
        """
        try:
            new_character_config_data = None

            # 兼容旧版本中日文文件名向身份证 ID 的平滑重定向表
            LEGACY_NAME_ALIASES = {
                "zh_喜多郁代.yaml": "zh_kita_ikuyo_01.yaml",
                "喜多郁代": "zh_kita_ikuyo_01.yaml",
                "zh_由比滨结衣.yaml": "zh_yuigahama_yui_01.yaml",
                "由比滨结衣": "zh_yuigahama_yui_01.yaml",
                "zh_雷电将军.yaml": "zh_raiden_shogun_01.yaml",
                "雷电将军": "zh_raiden_shogun_01.yaml",
                "zh_托尔.yaml": "zh_tohru_01.yaml",
                "托尔": "zh_tohru_01.yaml",
                "zh_时崎狂三.yaml": "zh_tokisaki_kurumi_01.yaml",
                "时崎狂三": "zh_tokisaki_kurumi_01.yaml",
                "zh_坎特蕾拉.yaml": "zh_cantarella_01.yaml",
                "坎特蕾拉": "zh_cantarella_01.yaml",
                "zh_坎特蕾拉（PMX）.yaml": "zh_cantarella_pmx_01.yaml",
                "zh_坎特蕾拉(PMX).yaml": "zh_cantarella_pmx_01.yaml",
                "坎特蕾拉（PMX）": "zh_cantarella_pmx_01.yaml",
                "坎特蕾拉(PMX)": "zh_cantarella_pmx_01.yaml",
                "zh_弗洛洛.yaml": "zh_phrolova_01.yaml",
                "弗洛洛": "zh_phrolova_01.yaml",
            }
            if config_file_name in LEGACY_NAME_ALIASES:
                config_file_name = LEGACY_NAME_ALIASES[config_file_name]

            # 若直接传入身份证ID（如 zh_yuigahama_yui_01），自动补齐扩展名
            if not config_file_name.endswith(".yaml") and not config_file_name.endswith(".yml"):
                config_file_name = f"{config_file_name}.yaml"

            if config_file_name == "conf.yaml":
                # Load base config
                new_character_config_data = read_yaml("conf.yaml").get(
                    "character_config"
                )
            else:
                # Load alternative config and merge with base config
                characters_dir = self.system_config.config_alts_dir
                file_path = os.path.normpath(
                    os.path.join(characters_dir, config_file_name)
                )
                if not file_path.startswith(characters_dir):
                    raise ValueError("Invalid configuration file path")

                alt_config_data = read_yaml(file_path).get("character_config")

                # Start with original config data and perform a deep merge
                new_character_config_data = deep_merge(
                    self.config.character_config.model_dump(), alt_config_data
                )

                # LLM / API 提供商配置为**全局共用**：始终以 conf.yaml 的 agent_config 为准，
                # 角色 yaml 不允许覆盖它（否则每切一个角色就会换一套 LLM 提供商与密钥池）。
                # 每次切换都重新读取 conf.yaml，保证在设置面板里改完 LLM 后立刻生效。
                global_character_config = (
                    read_yaml("conf.yaml").get("character_config") or {}
                )
                if global_character_config.get("agent_config"):
                    new_character_config_data["agent_config"] = (
                        global_character_config["agent_config"]
                    )

                # TTS：引擎与全部合成参数同样**全局共用**，角色 yaml 只允许覆盖"音色"
                # （fish 的 reference_id / edge 的 voice）。
                # 理由：同一套引擎参数对每个角色重复存一份，改一次就要改 N 个文件，
                # 而且很容易各角色不一致；音色才是真正随角色走的东西。
                global_tts = global_character_config.get("tts_config") or {}
                if global_tts:
                    local_tts = new_character_config_data.get("tts_config") or {}
                    merged_tts = copy.deepcopy(global_tts)

                    # 引擎选择以全局为准；全局未指定时才接受角色 yaml 的声明
                    if not merged_tts.get("tts_model") and local_tts.get("tts_model"):
                        merged_tts["tts_model"] = local_tts["tts_model"]
                    engine = merged_tts.get("tts_model", "fish_api_tts")

                    # 只搬运"音色"这一个角色属性
                    if engine == "fish_api_tts":
                        rid = (local_tts.get("fish_api_tts") or {}).get("reference_id")
                        if rid:
                            merged_tts.setdefault("fish_api_tts", {})[
                                "reference_id"
                            ] = rid
                    elif engine == "edge_tts":
                        voice = (local_tts.get("edge_tts") or {}).get("voice")
                        if voice:
                            merged_tts.setdefault("edge_tts", {})["voice"] = voice

                    new_character_config_data["tts_config"] = merged_tts

            if new_character_config_data:
                new_config = {
                    "system_config": self.system_config.model_dump(),
                    "character_config": new_character_config_data,
                }
                new_config = validate_config(new_config)
                await self.load_from_config(new_config)  # Await the async load
                logger.debug(f"New config: {self}")
                logger.debug(
                    f"New character config: {self.character_config.model_dump()}"
                )

                # Send responses to client
                await websocket.send_text(
                    json.dumps(
                        {
                            "type": "set-model-and-conf",
                            "model_info": self.live2d_model.model_info,
                            "conf_name": self.character_config.conf_name,
                            "conf_uid": self.character_config.conf_uid,
                            "character_id": self.character_config.conf_uid,
                        }
                    )
                )

                await websocket.send_text(
                    json.dumps(
                        {
                            "type": "config-switched",
                            "message": f"Switched to config: {config_file_name}",
                        }
                    )
                )

                logger.info(f"Configuration switched to {config_file_name}")
            else:
                raise ValueError(
                    f"Failed to load configuration from {config_file_name}"
                )

        except Exception as e:
            logger.error(f"Error switching configuration: {e}")
            logger.debug(self)
            await websocket.send_text(
                json.dumps(
                    {
                        "type": "error",
                        "message": f"Error switching configuration: {str(e)}",
                    }
                )
            )
            raise e


def deep_merge(dict1, dict2):
    """
    Recursively merges dict2 into dict1, prioritizing values from dict2.
    """
    result = dict1.copy()
    for key, value in dict2.items():
        if key in result and isinstance(result[key], dict) and isinstance(value, dict):
            result[key] = deep_merge(result[key], value)
        else:
            result[key] = value
    return result
