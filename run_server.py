# =============================================================================
# [架构导航 / 核心节点] 应用程序主启动入口 (Main Server Process Entrypoint)
# -----------------------------------------------------------------------------
# 角色职责: 整个 Open-LLM-VTuber 后端进程的生命周期总控。
# 核心流向:
#   1. 环境与网络修补 (_heal_unreachable_system_proxy -> 规范 Windows 代理 scheme)
#   2. 本地前端资源与配置校验 (check_frontend_assets -> read_yaml -> validate_config)
#   3. 进程级退出清理挂载 (atexit -> WebSocketServer.clean_cache)
#   4. 服务端原型与引擎异步预热 (WebSocketServer -> server.initialize())
#   5. Uvicorn ASGI Web 容器拉起 (uvicorn.run -> server.app)
# 高危注意:
#   - Windows 注册表残留代理可能导致所有外网 LLM / TTS 无法建立握手，必须优先自愈。
#   - server.initialize() 负责载入 ServiceContext，必须同步/阻塞确保模型就绪再监听端口。
# =============================================================================

import os
import sys
import socket
import atexit
import asyncio
import argparse
from pathlib import Path
import tomli
import uvicorn
from loguru import logger
from upgrade_codes.upgrade_manager import UpgradeManager


# =============================================================================
# [高危避坑 / 网络层] Windows 系统代理自愈与 scheme 规范化
# -----------------------------------------------------------------------------
# 上游触发: 进程启动最优先执行 (顶层代码 _heal_unreachable_system_proxy())
# 下游影响: 写入环境变量 HTTP_PROXY / HTTPS_PROXY 或 NO_PROXY，直接约束 httpx/requests/urllib
# =============================================================================
def _heal_unreachable_system_proxy() -> None:
    """修正 Windows 系统代理的两个常见坑，避免所有外网 API 全部失败。

    **坑 1：scheme 被写错。** 注册表里通常只写 `127.0.0.1:7897`（没有 scheme），
    而 CPython 的 `getproxies_registry()` 会给 https 硬拼上 `https://` 前缀。
    httpx 拿到它就会**用 TLS 去连接代理本身**，必然握手失败，报
    `EOF occurred in violation of protocol (_ssl.c:997)`。
    代理的正确写法是 `http://`（HTTP CONNECT 隧道）。

    **坑 2：残留失效代理。** 代理软件（Clash/Mihomo 等）退出后注册表设置常常
    留着，端口已经没人监听，而 Python 的 urllib / requests / httpx 都会读它。

    两种情况的共同症状：所有外网 API（LLM 端点、TTS 服务）统一连接失败，
    但浏览器、curl、甚至 PowerShell 走直连却一切正常 —— 极难排查。

    这里在启动时规范化 scheme 并探测可达性：可达就写入环境变量正常使用，
    不可达就设 NO_PROXY 绕过。若用户显式设置了 HTTPS_PROXY，则完全尊重用户。
    """
    if os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy"):
        return
    try:
        import urllib.request

        system_proxies = urllib.request.getproxies()
        proxy = system_proxies.get("https") or system_proxies.get("http")
        if not proxy:
            return

        # 坑 1：代理一律走 http:// （CONNECT 隧道），去掉被误加的 https://
        if proxy.startswith("https://"):
            proxy = "http://" + proxy[len("https://") :]

        # 坑 2：探测端口是否真的有人监听
        host_port = proxy.split("://", 1)[-1].rstrip("/")
        host, _, port = host_port.partition(":")
        sock = socket.socket()
        sock.settimeout(1.5)
        try:
            reachable = sock.connect_ex((host, int(port or 80))) == 0
        finally:
            sock.close()

        if reachable:
            os.environ["HTTP_PROXY"] = proxy
            os.environ["HTTPS_PROXY"] = proxy
            os.environ["http_proxy"] = proxy
            os.environ["https_proxy"] = proxy
            print(f"[proxy] 已规范化并使用系统代理: {proxy}")
        else:
            os.environ["NO_PROXY"] = "*"
            os.environ["no_proxy"] = "*"
            print(f"[proxy] 系统代理 {proxy} 不可达，已自动绕过（走直连）")
    except Exception:
        pass


_heal_unreachable_system_proxy()

from src.open_llm_vtuber.server import WebSocketServer
from src.open_llm_vtuber.config_manager import Config, read_yaml, validate_config

os.environ["HF_HOME"] = str(Path(__file__).parent / "models")
os.environ["MODELSCOPE_CACHE"] = str(Path(__file__).parent / "models")



def get_version() -> str:
    with open("pyproject.toml", "rb") as f:
        pyproject = tomli.load(f)
    return pyproject["project"]["version"]


def init_logger(console_log_level: str = "INFO") -> None:
    from src.open_llm_vtuber.logging_config import configure_logging
    configure_logging(console_log_level)


def check_frontend_assets():
    """Fail early when the bundled 2D frontend is missing; never fetch at startup."""
    frontend_path = Path(__file__).parent / "frontend" / "index.html"
    if not frontend_path.is_file():
        raise FileNotFoundError(
            f"Bundled 2D frontend is missing: {frontend_path}. "
            "Restore frontend/ from this repository."
        )


def parse_args():
    parser = argparse.ArgumentParser(description="Open-LLM-VTuber Server")
    parser.add_argument("--verbose", action="store_true", help="Enable verbose logging")
    parser.add_argument(
        "--hf_mirror", action="store_true", help="Use Hugging Face mirror"
    )
    return parser.parse_args()


# =============================================================================
# [架构节点] 主服务启动编排流程 (Server Launch Orchestration)
# -----------------------------------------------------------------------------
# 步骤解析:
#   1. 初始化多级日志 (控制台彩色高亮 + 文件轮转保存)
#   2. 本地 2D 前端完备性探测 (check_frontend_assets)
#   3. 用户配置向后兼容同步 (sync_user_config)
#   4. 注册进程退出清理缓存钩子 (atexit -> WebSocketServer.clean_cache)
#   5. 读取与强类型校验 conf.yaml
#   6. 构造 WebSocketServer 实例并异步完成 ServiceContext 预热 (server.initialize)
#   7. 启动 uvicorn 事件循环托管 FastAPI app
# =============================================================================
@logger.catch
def run(console_log_level: str):
    init_logger(console_log_level)
    logger.info(f"Open-LLM-VTuber, version v{get_version()}")

    # The 2D fallback is committed locally; never pull another repository at startup.
    check_frontend_assets()

    # Sync user config with default config
    try:
        UpgradeManager().sync_user_config()
    except Exception as e:
        logger.error(f"Error syncing user config: {e}")

    # [生命周期钩子] 确保进程意外终止或正常退出时清空缓存中的临时音频
    atexit.register(WebSocketServer.clean_cache)

    # [配置管理枢纽] 加载并严格校验主配置文件
    config: Config = validate_config(read_yaml("conf.yaml"))
    server_config = config.system_config

    # [服务装配节点] 实例化 WebSocketServer，挂载路由与静态资源
    server = WebSocketServer(config=config)

    # [高危同步/异步桥接] 预热全局服务上下文缓存 (加载 ASR/TTS/Agent/Live2D/Memory 等引擎)
    logger.info("Initializing server context...")
    try:
        asyncio.run(server.initialize())
        logger.info("Server context initialized successfully.")
    except Exception as e:
        logger.error(f"Failed to initialize server context: {e}")
        sys.exit(1)  # Exit if initialization fails

    # [主循环入口] 移交控制权至 Uvicorn ASGI 服务器
    logger.info(f"Starting server on {server_config.host}:{server_config.port}")
    uvicorn.run(
        app=server.app,
        host=server_config.host,
        port=server_config.port,
        log_level=console_log_level.lower(),
    )


if __name__ == "__main__":
    args = parse_args()
    console_log_level = "DEBUG" if args.verbose else "INFO"
    if args.hf_mirror:
        os.environ["HF_ENDPOINT"] = "https://hf-mirror.com"
    run(console_log_level=console_log_level)
