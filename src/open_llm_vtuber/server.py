"""
Open-LLM-VTuber Server
========================
This module contains the WebSocket server for Open-LLM-VTuber, which handles
the WebSocket connections, serves static files, and manages the web tool.
It uses FastAPI for the server and Starlette for static file serving.
"""

import os
import shutil
import mimetypes

from fastapi import FastAPI
from starlette.middleware.cors import CORSMiddleware
from starlette.responses import Response, RedirectResponse
from starlette.staticfiles import StaticFiles as StarletteStaticFiles

from .routes import init_client_ws_route, init_webtool_routes, init_proxy_route
from .settings_router import init_settings_routes
from .service_context import ServiceContext
from .config_manager.utils import Config

mimetypes.add_type("model/gltf-binary", ".vrm")


# Create a custom StaticFiles class that adds CORS headers
class CORSStaticFiles(StarletteStaticFiles):
    """
    Static files handler that adds CORS headers to all responses.
    Needed because Starlette StaticFiles might bypass standard middleware.
    """

    async def get_response(self, path: str, scope):
        response = await super().get_response(path, scope)

        # Add CORS headers to all responses
        response.headers["Access-Control-Allow-Origin"] = "*"
        response.headers["Access-Control-Allow-Methods"] = "GET, OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = "*"

        if path.endswith(".js"):
            response.headers["Content-Type"] = "application/javascript"

        # 未设置 Cache-Control 时浏览器会按 Last-Modified 做启发式缓存，
        # 导致修改 vrm_frontend/ 或替换 vrm-models/ 里的模型后，套壳视口仍然加载旧文件。
        # no-cache 表示"可缓存但每次必须校验"，文件未变时走 304，文件变更时立刻生效。
        if path.endswith((".js", ".mjs", ".html", ".css", ".vrm", ".pmx", ".pmd", ".vmd", ".tga", ".bmp", ".wasm")):
            response.headers["Cache-Control"] = "no-cache, must-revalidate"

        return response


class AvatarStaticFiles(CORSStaticFiles):
    """
    Avatar files handler with security restrictions and CORS headers
    """

    async def get_response(self, path: str, scope):
        allowed_extensions = (".jpg", ".jpeg", ".png", ".gif", ".svg")
        if not any(path.lower().endswith(ext) for ext in allowed_extensions):
            return Response("Forbidden file type", status_code=403)
        response = await super().get_response(path, scope)
        return response


# =============================================================================
# [架构导航 / 核心节点] 基础服务装配器与路由聚合中心 (WebSocketServer)
# -----------------------------------------------------------------------------
# 角色职责: 构建 FastAPI 实例，注册所有 API 路由、WebSocket 端点及静态资产挂载。
# 核心架构关系:
#   1. 维持 default_context_cache 单例作为会话的原型模板（Prototype Cache）；
#   2. 路由分发：
#      - /client-ws -> init_client_ws_route (主客户端长连接)
#      - /web-tool  -> init_webtool_routes (前端配置与模型选择工具)
#      - /settings  -> init_settings_routes (配置持久化与热更新)
#      - /proxy-ws  -> init_proxy_route (多客户端/桌宠单信道多路复用)
#   3. 静态资产托管：按特定优先级挂载缓存与模型资源（最后挂载 / 兜底前端）。
# 高危注意:
#   - 静态目录挂载顺序敏感：/ 必须最后 mount，否则会遮蔽其他特定前缀路径。
#   - default_context_cache 必须在应用监听端口前通过 initialize() 加载完成。
# =============================================================================
class WebSocketServer:
    """
    API server for Open-LLM-VTuber. This contains the websocket endpoint for the client, hosts the web tool, and serves static files.

    Creates and configures a FastAPI app, registers all routes
    (WebSocket, web tools, proxy) and mounts static assets with CORS.

    Args:
        config (Config): Application configuration containing system settings.
        default_context_cache (ServiceContext, optional):
            Pre‑initialized service context for sessions' service context to reference to.
            **If omitted, `initialize()` method needs to be called to load service context.**

    Notes:
        - If default_context_cache is omitted, call `await initialize()` to load service context cache.
        - Use `clean_cache()` to clear and recreate the local cache directory.
    """

    def __init__(self, config: Config, default_context_cache: ServiceContext = None):
        self.app = FastAPI(title="Open-LLM-VTuber Server")  # Added title for clarity
        self.config = config
        self.default_context_cache = (
            default_context_cache or ServiceContext()
        )  # Use provided context or initialize a new empty one waiting to be loaded
        # It will be populated during the initialize method call

        # Add global CORS middleware
        self.app.add_middleware(
            CORSMiddleware,
            allow_origins=["*"],
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

        # [路由注册交叉点] 注入 default_context_cache 作为会话原型的共享引用源
        self.app.include_router(
            init_client_ws_route(default_context_cache=self.default_context_cache),
        )
        self.app.include_router(
            init_webtool_routes(default_context_cache=self.default_context_cache),
        )
        self.app.include_router(
            init_settings_routes(default_context_cache=self.default_context_cache),
        )

        # [代理多路复用路由] 当开启 enable_proxy 时向同一端口内的 /client-ws 建立内部转发桥
        system_config = config.system_config
        if hasattr(system_config, "enable_proxy") and system_config.enable_proxy:
            # Construct the server URL for the proxy
            host = system_config.host
            port = system_config.port
            server_url = f"ws://{host}:{port}/client-ws"
            self.app.include_router(
                init_proxy_route(server_url=server_url),
            )

        # Mount cache directory first (to ensure audio file access)
        if not os.path.exists("cache"):
            os.makedirs("cache")
        self.app.mount(
            "/cache",
            CORSStaticFiles(directory="cache"),
            name="cache",
        )

        # Mount static files with CORS-enabled handlers
        self.app.mount(
            "/live2d-models",
            CORSStaticFiles(directory="live2d-models"),
            name="live2d-models",
        )
        self.app.mount(
            "/bg",
            CORSStaticFiles(directory="backgrounds"),
            name="backgrounds",
        )
        self.app.mount(
            "/avatars",
            AvatarStaticFiles(directory="avatars"),
            name="avatars",
        )

        # Mount VRM models directory
        if not os.path.exists("vrm-models"):
            os.makedirs("vrm-models")
        self.app.mount(
            "/vrm-models",
            CORSStaticFiles(directory="vrm-models"),
            name="vrm-models",
        )

        # Mount PMX models directory
        if not os.path.exists("pmx-models"):
            os.makedirs("pmx-models")
        self.app.mount(
            "/pmx-models",
            CORSStaticFiles(directory="pmx-models"),
            name="pmx-models",
        )

        # Mount PMX / Blend motion system directory
        if not os.path.exists("pmx_motion"):
            os.makedirs("pmx_motion")
        self.app.mount(
            "/pmx_motion",
            CORSStaticFiles(directory="pmx_motion"),
            name="pmx_motion",
        )

        # Mount 3D VRM frontend
        if not os.path.exists("vrm_frontend"):
            os.makedirs("vrm_frontend")

        @self.app.get("/vrm", include_in_schema=False)
        async def redirect_to_vrm():
            return RedirectResponse(url="/vrm/")

        self.app.mount(
            "/vrm",
            CORSStaticFiles(directory="vrm_frontend", html=True),
            name="vrm_frontend",
        )

        # Mount main frontend last (as catch-all)
        self.app.mount(
            "/",
            CORSStaticFiles(directory="frontend", html=True),
            name="frontend",
        )

    # =========================================================================
    # [架构节点 / 依赖预热] 异步装载全局服务上下文原型
    # 上游调用: run_server.py -> asyncio.run(server.initialize())
    # 下游流向: default_context_cache.load_from_config(self.config)
    # =========================================================================
    async def initialize(self):
        """Asynchronously load the service context from config.
        Calling this function is needed if default_context_cache was not provided to the constructor."""
        await self.default_context_cache.load_from_config(self.config)

    # =========================================================================
    # [生命周期清理] 缓存目录清空与重建
    # 上游调用: run_server.py -> atexit.register(WebSocketServer.clean_cache)
    # 影响范围: cache 目录下所有由 TTS 阶段落盘的临时音频分块
    # =========================================================================
    @staticmethod
    def clean_cache():
        """Clean the cache directory by removing and recreating it."""
        cache_dir = "cache"
        if os.path.exists(cache_dir):
            shutil.rmtree(cache_dir)
            os.makedirs(cache_dir)
