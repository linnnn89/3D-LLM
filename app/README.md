# 本地桌面套壳启动器（`app/`）

本目录实现了 Open-LLM-VTuber 的**本地独立桌面客户端**：它不是打包应用，而是一个"**自动拉起后端 + 浏览器 App 视口**"的套壳外壳，让 3D 角色以一个没有地址栏、没有标签页的独立窗口出现，关掉窗口即自动停服、释放端口。

---

## 1. 入口链路

```
启动Open-LLM-VTuber.lnk          (项目根目录快捷方式)
        │  Target: app\启动器.exe
        ▼
app\启动器.exe                    (C#，由 Program.cs 编译)
        │  → .venv\Scripts\python.exe app\launcher.py
        │    (若 .venv 不存在则退化为: uv run python app\launcher.py)
        ▼
app\launcher.py                   (真正的启动逻辑)
        │
        ├─ 1. 探测 127.0.0.1:12393 是否已在监听
        ├─ 2. 未监听 → 拉起 run_server.py（工作目录 = 项目根）
        ├─ 3. 轮询 http://localhost:12393/vrm/ 直到就绪（最长 40s，接受 200/307）
        ├─ 4. 定位 Edge / Chrome
        ├─ 5. 以 --app= 模式唤起独立视口窗口
        └─ 6. 等待窗口关闭 → 终止自己拉起的后端进程
```

另有等价入口 `app\launcher.bat`（`cd` 到项目根后 `uv run python app/launcher.py`）。

### `Program.cs`（C# 外壳）做了什么

| 步骤 | 行为 |
| --- | --- |
| 定位项目根 | 若 exe 位于名为 `app` 的目录内 → 根 = 上一级；否则根 = exe 所在目录 |
| 定位 `launcher.py` | 先找 `<root>\app\launcher.py`，找不到再找 exe 同级的 `launcher.py` |
| 选择 Python | `<root>\.venv\Scripts\python.exe` 存在则直接用它；否则用 `uv run python` |
| 启动方式 | `UseShellExecute=false` + `CreateNoWindow=true`，**无控制台窗口**，并阻塞等待子进程结束 |

> 由于 `CreateNoWindow=true`，启动器**不会显示任何控制台输出**。如果启动失败，请改用 `launcher.bat` 运行，才能看到 `launcher.py` 的打印。

### `launcher.py` 的参数

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `--url` | `http://localhost:12393/vrm/` | 要打开的视口地址 |
| `--live2d` | 关 | 改为打开 `http://localhost:12393/`（Live2D 主页面而非 3D VRM 页面） |
| `--no-server` | 关 | 跳过启动后端，直接连接已有服务 |
| `--width` / `--height` | 1280 / 820 | 套壳窗口尺寸 |

### 浏览器视口的启动参数

```text
<msedge.exe|chrome.exe>
  --app=http://localhost:12393/vrm/     # 无地址栏/书签栏的独立 App 视口
  --user-data-dir=%TEMP%\vtuber_app_profile   # 独立且持久的用户数据目录
  --window-size=1280,820
  --no-first-run --no-default-browser-check
  --disable-features=Translate --disable-background-networking
  --enable-gpu-rasterization
```

浏览器探测顺序：Edge（`Program Files (x86)` → `Program Files` → `%LOCALAPPDATA%`）→ Chrome（`Program Files` → `Program Files (x86)` → `%LOCALAPPDATA%`）。全都找不到时才退回系统默认浏览器（此时不再是套壳窗口）。

---

## 2. 它**不**打包前端（最重要的一点）

启动器加载的是 `http://localhost:12393/vrm/`，而该路径在 `src/open_llm_vtuber/server.py` 中被直接挂载到项目根的 **`vrm_frontend/` 目录**：

```python
self.app.mount("/vrm", CORSStaticFiles(directory="vrm_frontend", html=True))
```

因此：

- **修改 `vrm_frontend/` 下的任何前端文件（app.js / index.html / style.css / motions/*.vrma），刷新视口即可生效**，无需重新编译、无需重新打包。
- 反过来，**只改前端不会影响后端**；只改后端（`src/` 下的 Python）则**必须重启服务**才生效。

---

## 3. 注意事项与常见坑

### 3.1 端口复用：改了后端代码却没生效

`launcher.py` 的第一件事是 `is_port_open(12393)`：

> **如果 12393 已经在监听，它会直接连接那个服务，而不会重启它。**

所以当你手动跑过一个服务、或上一次的进程没退干净时，启动器会复用那个**旧进程**——此时修改 `src/` 下的 Python 代码不会体现出来。

排查与处理：

```powershell
# 看是谁占着端口
Get-NetTCPConnection -LocalPort 12393 -State Listen | Select-Object OwningProcess
# 结束它（换成上面查到的 PID）
Stop-Process -Id <PID> -Force
```

### 3.2 关闭窗口会停掉服务

仅当服务是**由本次启动器拉起**时才成立：关掉视口窗口 → `server_proc.terminate()` → 端口释放。
如果服务是外部（手动）启动的，关窗口**不会**停它。

### 3.3 浏览器缓存导致"改了还是旧的"

套壳窗口使用持久化 profile（`%TEMP%\vtuber_app_profile`），会缓存 JS/HTML，也会缓存 3D 模型（`.vrm` 体积大，替换后若命中旧缓存尤其难察觉）。为此 `server.py` 的 `CORSStaticFiles` 已对 `.js/.mjs/.html/.css/.vrm` 下发：

```
Cache-Control: no-cache, must-revalidate
```

含义是"可缓存但每次必须回源校验"：文件没变走 304，文件一变立刻生效。

若在旧版本服务上仍遇到旧资源，任选其一：

- 视口内按 `Ctrl + F5` 强制刷新；
- 删除 `%TEMP%\vtuber_app_profile` 目录后重新启动；
- 重启后端服务使其带上新的响应头。

### 3.4 端口被占用但服务是坏的

启动器只检查"端口是否被监听"，不检查服务是否健康。若 12393 被一个僵死进程占着，启动器会连接它并打开一个空白/报错的页面。按 3.1 清理端口即可。

### 3.5 麦克风与远程访问

浏览器只在**安全上下文**（`https` 或 `localhost`）下允许麦克风。本机通过 `localhost` 访问没问题；若要从别的设备访问，必须自行配置 `https` 反向代理。

---

## 4. 排错速查

| 现象 | 可能原因 | 处理 |
| --- | --- | --- |
| 双击 exe 毫无反应 | `CreateNoWindow=true` 吞掉了输出；或 Python 环境缺失 | 改用 `launcher.bat` 观察输出 |
| 界面能开但内容陈旧 | 浏览器启发式缓存 | 见 3.3 |
| 改了 `src/` 没变化 | 复用了旧服务进程 | 见 3.1 |
| 白屏 / 连不上 | 端口被僵死进程占用 | 见 3.4 |
| 打开的窗口有地址栏 | 没找到 Edge/Chrome，退回了默认浏览器 | 安装 Edge 或 Chrome |
| 关窗口后端口没释放 | 服务非本次启动器拉起 | 手动结束对应进程 |

---

## 5. 相关文件

| 文件 | 作用 |
| --- | --- |
| `app/Program.cs` | C# 外壳源码（`启动器.exe` 由它编译而来） |
| `app/launcher.py` | 启动逻辑：拉起服务、等待就绪、唤起视口、生命周期回收 |
| `app/launcher.bat` | 等价入口，保留控制台输出，便于排错 |
| `run_server.py` | 被拉起的后端服务（项目根） |
| `src/open_llm_vtuber/server.py` | 静态资源挂载点（`/vrm` → `vrm_frontend/`）与缓存头 |
| `vrm_frontend/` | 3D VRM 前端全部资源，改动实时生效 |
