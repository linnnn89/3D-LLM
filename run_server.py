import os
import sys
import socket
import atexit
import asyncio
import argparse
import subprocess
from pathlib import Path
import tomli
import uvicorn
from loguru import logger
from upgrade_codes.upgrade_manager import UpgradeManager


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

upgrade_manager = UpgradeManager()


def get_version() -> str:
    with open("pyproject.toml", "rb") as f:
        pyproject = tomli.load(f)
    return pyproject["project"]["version"]


def init_logger(console_log_level: str = "INFO") -> None:
    logger.remove()
    # Console output
    logger.add(
        sys.stderr,
        level=console_log_level,
        format="<green>{time:YYYY-MM-DD HH:mm:ss}</green> | <level>{level: <8}</level> | <cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> | {message}",
        colorize=True,
    )

    # File output
    logger.add(
        "logs/debug_{time:YYYY-MM-DD}.log",
        rotation="10 MB",
        retention="30 days",
        level="DEBUG",
        format="{time:YYYY-MM-DD HH:mm:ss.SSS} | {level: <8} | {name}:{function}:{line} | {message} | {extra}",
        backtrace=True,
        diagnose=True,
    )


def check_frontend_submodule(lang=None):
    """
    Check if the frontend submodule is initialized. If not, attempt to initialize it.
    If initialization fails, log an error message.
    """
    if lang is None:
        lang = upgrade_manager.lang

    frontend_path = Path(__file__).parent / "frontend" / "index.html"
    if not frontend_path.exists():
        if lang == "zh":
            logger.warning("未找到前端子模块，正在尝试初始化子模块...")
        else:
            logger.warning(
                "Frontend submodule not found, attempting to initialize submodules..."
            )

        try:
            subprocess.run(
                ["git", "submodule", "update", "--init", "--recursive"], check=True
            )
            if frontend_path.exists():
                if lang == "zh":
                    logger.info("👍 前端子模块（和其他子模块）初始化成功。")
                else:
                    logger.info(
                        "👍 Frontend submodule (and other submodules) initialized successfully."
                    )
            else:
                if lang == "zh":
                    logger.critical(
                        '子模块初始化失败。\n你之后可能会在浏览器中看到 {{"detail":"Not Found"}} 的错误提示。请检查我们的快速入门指南和常见问题页面以获取更多信息。'
                    )
                    logger.error(
                        "初始化子模块后，前端文件仍然缺失。\n"
                        + "你是否手动更改或删除了 `frontend` 文件夹？\n"
                        + "它是一个 Git 子模块 - 你不应该直接修改它。\n"
                        + "如果你这样做了，请使用 `git restore frontend` 丢弃你的更改，然后再试一次。\n"
                    )
                else:
                    logger.critical(
                        'Failed to initialize submodules. \nYou might see {{"detail":"Not Found"}} in your browser. Please check our quick start guide and common issues page from our documentation.'
                    )
                    logger.error(
                        "Frontend files are still missing after submodule initialization.\n"
                        + "Did you manually change or delete the `frontend` folder?  \n"
                        + "It's a Git submodule — you shouldn't modify it directly.  \n"
                        + "If you did, discard your changes with `git restore frontend`, then try again.\n"
                    )
        except Exception as e:
            if lang == "zh":
                logger.critical(
                    f'初始化子模块失败: {e}。\n怀疑你跟 GitHub 之间有网络问题。你之后可能会在浏览器中看到 {{"detail":"Not Found"}} 的错误提示。请检查我们的快速入门指南和常见问题页面以获取更多信息。\n'
                )
            else:
                logger.critical(
                    f'Failed to initialize submodules: {e}. \nYou might see {{"detail":"Not Found"}} in your browser. Please check our quick start guide and common issues page from our documentation.\n'
                )


def parse_args():
    parser = argparse.ArgumentParser(description="Open-LLM-VTuber Server")
    parser.add_argument("--verbose", action="store_true", help="Enable verbose logging")
    parser.add_argument(
        "--hf_mirror", action="store_true", help="Use Hugging Face mirror"
    )
    return parser.parse_args()


@logger.catch
def run(console_log_level: str):
    init_logger(console_log_level)
    logger.info(f"Open-LLM-VTuber, version v{get_version()}")

    # Get selected language
    lang = upgrade_manager.lang

    # Check if the frontend submodule is initialized
    check_frontend_submodule(lang)

    # Sync user config with default config
    try:
        upgrade_manager.sync_user_config()
    except Exception as e:
        logger.error(f"Error syncing user config: {e}")

    atexit.register(WebSocketServer.clean_cache)

    # Load configurations from yaml file
    config: Config = validate_config(read_yaml("conf.yaml"))
    server_config = config.system_config

    if server_config.enable_proxy:
        logger.info("Proxy mode enabled - /proxy-ws endpoint will be available")

    # Initialize the WebSocket server (synchronous part)
    server = WebSocketServer(config=config)

    # Perform asynchronous initialization (loading context, etc.)
    logger.info("Initializing server context...")
    try:
        asyncio.run(server.initialize())
        logger.info("Server context initialized successfully.")
    except Exception as e:
        logger.error(f"Failed to initialize server context: {e}")
        sys.exit(1)  # Exit if initialization fails

    # Run the Uvicorn server
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
    if args.verbose:
        logger.info("Running in verbose mode")
    else:
        logger.info(
            "Running in standard mode. For detailed debug logs, use: uv run run_server.py --verbose"
        )
    if args.hf_mirror:
        os.environ["HF_ENDPOINT"] = "https://hf-mirror.com"
    run(console_log_level=console_log_level)
