# -*- coding: utf-8 -*-
"""
Open-LLM-VTuber 本地独立 Web 套壳桌面启动器
==============================================
位于 app/ 目录下的套壳启动核心：
- 自动检测并启动后端 Python 服务；
- 探测等待服务就绪；
- 调起原生独立 App 视口（去除浏览器多余栏位与标签）；
- 关闭视口窗口时自动退出并释放端口。
"""

import os
import sys
import time
import socket
import argparse
import tempfile
import subprocess
import urllib.request

PORT = 12393
DEFAULT_URL = f"http://localhost:{PORT}/vrm/"

# 项目根目录（当前 app/ 目录的上一级）
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVER_SCRIPT = os.path.join(PROJECT_ROOT, "run_server.py")


def is_port_open(port: int = PORT) -> bool:
    """检测指定端口是否已被占用（服务是否正在监听）"""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        return s.connect_ex(("127.0.0.1", port)) == 0


def wait_for_server(url: str, timeout: int = 40) -> bool:
    """轮询探测后端服务是否已完全就绪（返回 200 或 307）"""
    start = time.time()
    print("[*] 正在等待后端服务就绪...", end="", flush=True)
    while time.time() - start < timeout:
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=1.5) as resp:
                if resp.status in (200, 307):
                    print(" 完成！")
                    return True
        except Exception:
            pass
        print(".", end="", flush=True)
        time.sleep(0.5)
    print(" 超时！")
    return False


def find_browser() -> str:
    """定位本地可用的 Edge 或 Chrome 浏览器程序"""
    candidates = [
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        os.path.expandvars(r"%LOCALAPPDATA%\Microsoft\Edge\Application\msedge.exe"),
        os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"),
    ]
    for p in candidates:
        if os.path.exists(p):
            return p
    return None


def launch_app_window(browser_exe: str, url: str, width: int = 1280, height: int = 820) -> subprocess.Popen:
    """以独立 App 视口模式启动浏览器窗口（无地址栏、无标签页杂项）"""
    profile_dir = os.path.join(tempfile.gettempdir(), "vtuber_app_profile")
    os.makedirs(profile_dir, exist_ok=True)

    args = [
        browser_exe,
        f"--app={url}",
        f"--user-data-dir={profile_dir}",
        f"--window-size={width},{height}",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-features=Translate",
        "--disable-background-networking",
        "--enable-gpu-rasterization",
    ]
    return subprocess.Popen(args)


def main():
    parser = argparse.ArgumentParser(description="Open-LLM-VTuber 本地独立 Web 套壳桌面启动器")
    parser.add_argument("--url", type=str, default=DEFAULT_URL, help="要打开的视口 URL")
    parser.add_argument("--live2d", action="store_true", help="打开 Live2D 视口而非 3D VRM 视口")
    parser.add_argument("--no-server", action="store_true", help="跳过自动启动后端服务")
    parser.add_argument("--width", type=int, default=1280, help="套壳窗口宽度")
    parser.add_argument("--height", type=int, default=820, help="套壳窗口高度")
    args = parser.parse_args()

    target_url = f"http://localhost:{PORT}/" if args.live2d else args.url

    print("=" * 60)
    print("       Open-LLM-VTuber 本地 3D 独立桌面套壳启动器")
    print("=" * 60)

    server_proc = None

    # 1. 检查或启动后端服务
    if not args.no_server:
        if is_port_open(PORT):
            print(f"[*] 检测到端口 {PORT} 已有服务运行，直接连接...")
        else:
            print("[*] 正在拉起 Open-LLM-VTuber 后端服务进程...")
            server_proc = subprocess.Popen(
                [sys.executable, SERVER_SCRIPT],
                cwd=PROJECT_ROOT,
            )

        # 等待服务就绪
        if not wait_for_server(target_url):
            print("[!] 警告：未能检测到服务就绪，仍将尝试打开窗口...")

    # 2. 定位可用浏览器
    browser_exe = find_browser()
    if not browser_exe:
        print("[!] 未找到 Microsoft Edge 或 Google Chrome，正在尝试调用系统默认浏览器...")
        import webbrowser
        webbrowser.open(target_url)
        print("[*] 已在默认浏览器中打开。按 Ctrl+C 可退出启动器。")
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            pass
        return

    # 3. 唤起独立套壳窗口
    print(f"[*] 正在通过 {os.path.basename(browser_exe)} 唤起独立桌面套壳视口...")
    print(f"[*] 目标视口: {target_url}")
    print("[*] 提示：直接关闭该 3D 客户端视口窗口，即可自动停止服务。")
    print("=" * 60)

    app_proc = launch_app_window(browser_exe, target_url, args.width, args.height)

    # 4. 监听窗口关闭与生命周期回收
    try:
        app_proc.wait()
        print("[*] 客户端窗口已关闭。")
    except KeyboardInterrupt:
        print("\n[*] 收到用户终止信号...")
        try:
            app_proc.terminate()
        except Exception:
            pass
    finally:
        if server_proc:
            print("[*] 正在安全关闭后台服务进程...")
            server_proc.terminate()
            try:
                server_proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                server_proc.kill()
            print("[*] 服务进程已停止，端口释放完毕。再见！")


if __name__ == "__main__":
    main()
