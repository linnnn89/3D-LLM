# Windows 3D AI 桌宠 — 架构研究 / 可行性分析 / 初步实施方案

> 日期：2026-09-18
> 范围：**仅研究，未改动任何代码**
> 证据标注：`[代码证据]` 本仓库实测 · `[官方文档]` 官方文档 · `[社区实践]` 开源项目/论坛 · `[推测]` 未经实测的推断
> 所有性能数字均标注是否实测。

---

## 0. 结论摘要（先看这一段）

1. **你想要的"解耦架构"已经基本存在于这个仓库里了。** 后端 `run_server.py` 是一个无 GUI 依赖的 FastAPI/uvicorn 服务，前端只是 `/vrm` 路径下的**静态目录挂载**。AI Core 与渲染器之间只隔着一条 `ws://localhost:12393/client-ws`。`[代码证据] src/open_llm_vtuber/server.py:85,167-176`
2. **你想要的"Character API"也已经存在了 90%。** `websocket_handler.py` 里的 JSON 协议（`text-input` / `audio` / `actions.expressions` / `control` …）就是 Character API 的雏形，不需要发明新协议，只需要补 2 个消息类型 + 修 1 个已有 bug。`[代码证据] src/open_llm_vtuber/websocket_handler.py:32-98`
3. **真正缺的只有一层"窗口壳"**：把现在的 `Edge --app` 浏览器壳（`app/launcher.py`）换成一个真正的无框透明窗口宿主。`[代码证据] app/launcher.py:71-87`
4. **推荐第一版：Electron 壳 + 复用现有 `vrm_frontend/`。** 3D 代码零改动即可复用（纯 ESM + importmap + 本地 libs，无构建步骤）。`[代码证据] vrm_frontend/index.html:9-21`
5. **Godot / Unity 不建议作为第一版**：会丢掉全部 Three.js 渲染代码，且 `godot-vrm` **不支持 VRMA 动画**（你现有的动作系统正好建在 VRMA 上）。`[官方文档] github.com/V-Sekai/godot-vrm`
6. **Lively 只应作为第二 Runtime（可选壁纸模式）**，不能作为桌宠主 Runtime：它是"背景层"托管，无法做 always-on-top、无法承载浮动聊天窗。`[官方文档] lively wiki / Application-Wallpaper`
7. **最重要的发现**：上游官方**已经有 Electron 桌宠模式**（透明/穿透/置顶/托盘/拖动/鼠标跟随），只是只支持 Live2D；你的 `vrm_frontend/` 是自研的 3D 替代品。也就是说，**"如何做 Electron 桌宠"这件事已经有人踩过一遍坑了**，可以直接照抄窗口层设计。`[官方文档] docs.llmvtuber.com/en/docs/user-guide/frontend/electron/` `[代码证据] .gitmodules（frontend 子模块指向 Open-LLM-VTuber-Web）`

**一句话结论**：这不是一个"要不要重写"的问题，而是一个"把浏览器壳换成 Electron 壳、并补齐 3 个协议缺口"的问题。工作量集中在窗口层，不在 AI 层，也不在 3D 层。

---

## 1. 当前仓库架构审计

### 1.1 这是什么

`D:\CODEX PROJECT\Open-LLM-VTuber` 是 **Open-LLM-VTuber 的 fork**：

- `origin` → `github.com/linnnn89/3D-LLM.git`
- `upstream` → `github.com/Open-LLM-VTuber/Open-LLM-VTuber.git`
- `frontend/` 是指向 `Open-LLM-VTuber/Open-LLM-VTuber-Web`（branch `build`）的 git submodule `[代码证据] .gitmodules`

本 fork 相对上游的核心增量是：**自研了一套 3D VRM 前端（`vrm_frontend/`）替代上游的 Live2D 前端**，并新增了设置中心、密钥保险库、长期记忆子系统 `[代码证据] git log: c38b6e8, 5e9a2ea`。

### 1.2 真实架构图

```
┌─────────────────────────────────────────────────────────────────────┐
│  进程 1：Python AI Core（run_server.py → uvicorn，端口 12393）        │
│                                                                     │
│  FastAPI (server.py:85)                                             │
│   ├─ WS  /client-ws   ← 主对话通道（每连接一个 ServiceContext 克隆） │
│   ├─ WS  /proxy-ws    ← 多客户端共享（默认关闭）                     │
│   ├─ WS  /tts-ws      ← web_tool 用                                 │
│   ├─ HTTP /asr, /api/settings/*                                     │
│   └─ 静态挂载：                                                      │
│       /vrm      → vrm_frontend/   ← ★ 本 fork 的 3D 前端             │
│       /         → frontend/       ← 上游 Live2D 前端（编译产物）      │
│       /vrm-models, /cache, /live2d-models, /bg, /avatars            │
│                                                                     │
│  纯 AI 能力（与 WebSocket 零耦合）：                                  │
│   agent/  mcpp/  memory/  chat_history_manager.py  prompts/          │
│  语音：tts/  asr/  vad/                                              │
└─────────────────────────────────────────────────────────────────────┘
                              ▲
                              │ ws://localhost:12393/client-ws  (JSON)
                              │ 纯 TCP，无 Named Pipe / 无共享内存
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  进程 2：渲染器（现状 = Edge 浏览器 --app 模式）                      │
│                                                                     │
│  app/启动器.exe (C#, Program.cs 编译产物)                             │
│     └─ 拉起 .venv\Scripts\python.exe app/launcher.py                 │
│          ├─ subprocess.Popen(run_server.py)   ← 拉起进程 1            │
│          ├─ 轮询 http://localhost:12393/vrm/ 直到就绪（40s 超时）      │
│          └─ subprocess.Popen(msedge/chrome --app=http://.../vrm/)     │
│                                                                     │
│  vrm_frontend/  (纯静态 ESM，无构建步骤)                              │
│   index.html  app.js(1562行)  style.css                             │
│   settings.html / character.html  ← 另一个 Edge --app 窗口            │
│   libs/  three r169 + @pixiv/three-vrm v3.3.4 + VRMA loader          │
│   motions/  *.vrma (3 个文件)                                        │
└─────────────────────────────────────────────────────────────────────┘
```

### 1.3 关键边界结论

| 问题 | 结论 | 证据 |
|---|---|---|
| AI Core 能脱离前端独立跑吗？ | **能**。`agent/`、`mcpp/`、`memory/` 内 grep 无 `fastapi` / `WebSocket` 依赖 | `[代码证据]` 全包 grep |
| WebSocket 耦合在哪？ | 只在 `conversations/*`、`service_context.py`、`websocket_handler.py`、`proxy_handler.py` | `[代码证据]` |
| 前端能换掉吗？ | **能，且只换静态目录**。后端对前端零渲染逻辑 | `[代码证据] server.py:167-176` |
| 有 IPC（管道/共享内存）吗？ | **没有**。全部走 localhost TCP | `[代码证据]` 全库 grep |
| 有托盘 / 开机自启吗？ | **没有** | `[代码证据]` 全库 grep 无命中 |
| 设置窗口怎么开的？ | 后端用 `subprocess.Popen` 拉起**外部** Edge/Chrome `--app` | `[代码证据] settings_router.py:817-886` |

> ⚠️ **这是一条重要线索**：`app/launcher.py` 只是一个"进程管理 + 开浏览器"的外壳，它**可以整体丢弃**，因为真正的服务端（`run_server.py`）是完全自洽的。

---

## 2. 当前能力清单

状态口径：**存在** = 有可用实现 · **部分** = 有壳无实/未接线 · **不存在** = 无代码

| 能力 | 当前状态 | 可复用 | 改造程度 | 证据 |
|---|---|---|---|---|
| **LLM** | 存在 | ✅ 完全 | **零** | 8 类 provider，自研 `StatelessLLMInterface`，无 LangChain。`agent/stateless_llm/*` |
| **Agent** | 存在 | ✅ 完全 | **零** | `AgentInterface.chat()` → async generator。`agent/agents/basic_memory_agent.py:714` |
| **Memory（工作）** | 存在 | ✅ 完全 | 零 | 滚动窗口 **15 条消息**（非 token 裁剪）。`basic_memory_agent.py:246` |
| **Memory（长期）** | 存在 | ✅ 完全 | 零 | SQLite + FTS5 trigram，`data/memory.sqlite`。`memory/repository.py:42-54` |
| **Character 人设** | 存在 | ✅ 完全 | 零 | `characters/*.yaml` 的 `persona_prompt` + `prompts/` |
| **Tool calling / MCP** | 存在 | ✅ 完全 | 零 | `mcp_servers.json` 真实接入（time / ddg-search），按角色开关 |
| **TTS** | 存在（8 引擎） | ✅ 完全 | 零 | 全部云端/兼容 API，**无本地推理**。`tts/tts_factory.py` |
| **TTS 流式（面向客户端）** | **不存在** | — | 需自建 | 所有引擎只返回**文件路径**；按句推送是 `tts_manager` 的近似的方案 |
| **STT / ASR** | 存在（2 引擎） | ✅ 完全 | 零 | 只有 Groq Whisper + Azure，**无本地 whisper**，整段非流式。`asr/asr_factory.py` |
| **VAD** | 存在 | ✅ | 零 | 本地 Silero，**默认关闭**（`null`）。`vad/silero.py` |
| **打断 interrupt** | 存在 | ✅ 完全 | 零 | 手动 + VAD barge-in 双路径 |
| **唤醒词 / hotkey** | **不存在** | — | 需新增 | 后端 grep 零命中 |
| **Vision（后端通路）** | 存在 | ✅ 完全 | 零 | `ImageSource{CAMERA,SCREEN,CLIPBOARD,UPLOAD}` → LLM image_url block |
| **Vision（采集端）** | **不存在** | — | 需新增 | VRM 前端只发 `text-input`，无摄像头/截图；服务端无 screen capture |
| **桌面感知** | **不存在** | — | 需新增 | 全库无 `mss`/`pyautogui`/`PIL` 采集 |
| **VRM 加载/渲染** | 存在 | ✅ **完全** | **零** | three r169 + three-vrm v3.3.4，本地 `libs/`，无 CDN 无构建 |
| **表情 Expression** | 存在 | ✅ 完全 | 零 | 5 预设 + 数字码映射 + 情绪字符串映射。`app.js:490-549` |
| **Lip Sync** | 存在 | ✅ 完全 | 零 | **WebAudio 频谱驱动**（非 viseme），双 viseme 混合 aa/oh。`app.js:551-576` |
| **眨眼 Blink** | 存在 | ✅ 完全 | 零 | 随机 2.4~6.0s，sin 曲线。`app.js:578-601` |
| **眼球 / LookAt** | 存在 | ✅ 部分 | **小改** | 硬编码看向 camera；设置里的 `mouse`/`none` 模式**未接线** |
| **Animation / Motion** | 存在 | ✅ 完全 | 零 | VRMA 官方动捕优先 + 程序化保底双引擎；**仅 3 个 .vrma 文件**，7 个走程序化 |
| **SpringBone 物理** | 存在 | ✅ | 零 | 由 `vrm.update(delta)` 驱动；**不可在 UI 调参** |
| **点击交互（raycast）** | 存在 | ✅ 完全 | 零 | 头/身分区命中 + 随机表情动作 + 500ms 冷却 |
| **拖动 / 缩放** | 存在（OrbitControls） | ⚠️ 需替换 | **中** | 现在是转相机，不是拖窗口 |
| **右键菜单** | **不存在** | — | 需新增 | 无 `contextmenu` 监听 |
| **Chat UI** | 存在 | ⚠️ 需拆分 | **中** | 与 3D 同 DOM 叠加（`#canvas-container` + `.ui-layer`），未分离 |
| **设置 UI** | 存在 | ⚠️ 需迁移 | **中** | 独立 Edge `--app` 窗口 + `localStorage` 跨窗口同步 |
| **WebSocket 客户端** | 存在 | ✅ 完全 | 零 | 20s 心跳、3s 重连、9 种发送类型 |
| **Desktop（透明/无框/置顶/穿透）** | **不存在** | — | **需新建** | 当前靠浏览器 `--app`，窗口样式不可控 |
| **托盘 / 开机自启** | **不存在** | — | 需新增 | — |
| **Wallpaper 模式** | **不存在** | — | 需新增 | — |

### 2.1 必须知道的两个"坑"（会直接影响新渲染器）

1. **`frontend-playback-complete` 握手缺失（既有 bug）**
   后端在 `conversation_utils.py:180-182` 会 `wait_for_response(client_uid, "frontend-playback-complete")`，**且没有超时**；而 `vrm_frontend/app.js` **从未发送过这条消息**。
   全库 grep 确认：该字符串只出现在后端两处（等待处 + `websocket_handler.py:259` 的白名单）。
   → 结论：**任何新渲染器都应显式回这条消息**，否则一轮对话的收尾逻辑可能挂起。`[代码证据]`

2. **半接线的 3D 设置项**
   角色设置页有"视线模式 / 呼吸幅度 / 背景"，但 `app.js` 里**没有读取代码**；`applyBackgroundTheme()` 定义了但从未被调用。`[代码证据] vrm_frontend/app.js:1500-1520` 未被调用

---

## 3. Renderer 技术比较

### 3.1 十个问题的正面回答

| # | 问题 | Three.js+Electron | Godot 4 | Unity | Lively |
|---|---|---|---|---|---|
| 1 | 最容易复用现有 VRM 代码 | **★★★★★ 零改动** | ★☆ 全部重写 | ★ 全部重写 | ★★★★★ 零改动 |
| 2 | 最容易做到真正透明桌宠 | ★★★★ | ★★★★ | ★★ | ✗ 无置顶概念 |
| 3 | 最容易做 Windows 原生窗口控制 | ★★★★（Electron API） | ★★★（`SetWindowRgn` 限制多） | ★★（需第三方脚本） | ✗ |
| 4 | 最容易做聊天 UI | ★★★★★ | ★★★ | ★★ | ✗ |
| 5 | 最容易做鼠标交互 | ★★★★ | ★★★ | ★★★ | ★★★ |
| 6 | 最容易做未来桌面感知 | ★★★★（Node 侧随便调 Win32） | ★★★★ | ★★★ | ★★ |
| 7 | 最容易降低 GPU / RAM | ★★★ | **★★★★★** | ★★ | ★★★ |
| 8 | 最容易长期维护 | **★★★★★** | ★★★ | ★★ | ★★ |
| 9 | **最适合第一版** | **✅** | ✗ | ✗ | ✗ |
| 10 | 适合 Wallpaper 模式 | ★★★ | ★★★★ | ★★★ | **★★★★★（它就是这个）** |

### 3.2 逐项证据

#### A. Three.js + three-vrm + Electron —— 推荐

- **复用度**：`vrm_frontend/` 是纯静态 ESM + importmap + 本地 `libs/`，**没有 package.json、没有 vite/webpack**，浏览器直接加载。Chromium 内核（Electron/WebView2/CEF）原生支持 importmap 与 WebGL2。`[代码证据] vrm_frontend/index.html:9-21`
- **透明窗口**：Electron `new BrowserWindow({ transparent: true, frame: false })`；`setAlwaysOnTop`、`setSkipTaskbar(true)`（不占任务栏）、`setIgnoreMouseEvents(true, { forward: true })` 做穿透。`[官方文档] electronjs.org/docs/latest/api/browser-window`
- **局部穿透**：官方 API `win.setShape(rects)`（Windows/Linux，实验性）——"区域内可交互，区域外鼠标事件穿透到下层"。这是平台级方案，比 JS 侧轮询更可靠。`[官方文档]`
- **已知取舍**：`setIgnoreMouseEvents` 是整窗生效，要"只有角色可点"必须在渲染器里 raycast → IPC → 切换该开关（社区标准做法）。`[社区实践] electron/electron#23042`
- **同类真实项目**：`haowenGuo/HumanClaw` —— 就是这个方案的完整实现：无框透明桌宠窗口 + **独立聊天窗** + Three.js/three-vrm 的 VRM 渲染 + 本地 FastAPI 后端。`[社区实践]`
- **同类真实项目**：`moeru-ai/airi`（49k star）——VRM/Live2D + Electron 桌面版（stage-tamagotchi），把渲染器拆成独立包，并明确"不为浏览器性能妥协，桌面版走 native"。`[社区实践]`
- **同类真实项目**：上游自己的 `Open-LLM-VTuber-Web` Electron 客户端。`[官方文档]`

#### B. Godot 4 + godot-vrm

- **能透明**：`display/window/per_pixel_transparency/allowed` + `transparent_bg` + `borderless`。`[官方文档/社区实践]`
- **穿透有硬限制**：`DisplayServer.window_set_mouse_passthrough(polygon)` 底层是 `SetWindowRgn`，它**同时裁剪输入和渲染**——区域外不是"只穿透"，而是"不绘制"；并且**只接受单个多边形、按 even-odd 填充**（重合矩形要 `Geometry2D.merge_polygons`，不相连的要零宽桥接）。`[社区实践] github.com/Kalgator/Godot-4-Mouse-Passthrough`
- **有已知 bug**：透明窗 + `window_set_mouse_passthrough` 会白屏闪烁（godotengine/godot#80098）。`[社区实践]`
- **VRM 支持是"部分"**：`godot-vrm`（V-Sekai，MIT，469 star）支持 VRM 0.x/1.0 导入、MToon、SpringBone、表达式 blendShape；但 **`VRMC_vrm_animation`（即 VRMA）尚未实现**，README 明写 Future work。`[官方文档] github.com/V-Sekai/godot-vrm`
  > ⚠️ 这条对你的项目是**致命伤**：你的动作系统（`MOTION_URLS` + `createVRMAnimationClip`）正建立在 VRMA 上。改用 Godot 意味着**放弃现有动作资产与加载逻辑**，退回手写动画状态机。
- **另需自己写**：WebSocket 客户端、音频播放与频谱/口型、表情驱动、点击 raycast。`[推测]`

#### C. Unity + UniVRM

- **透明窗口需要社区脚本**：Unity 官方不支持，需 `UnityWindowsTransparentWindow.cs` 之类的 D3D11 透明 hack 或 `UnityDesktopPetFramework` / `EasyTransparentWindow`。`[社区实践]`
- **有成熟的完整产品先例**：`shinyflvre/Mate-Engine` —— Unity + VRM 桌宠，功能覆盖 idle/拖动/窗口坐立/任务栏坐立/头眼追踪/触摸区/AI 聊天/Mod SDK。许可证 **AGPL v3 + MateProv2 混合**。`[社区实践]`
- **性能参考（这是真实数据）**：Mate Engine README 自述"Alice 模型贴图约 190MB，总 RAM 约 200MB"。`[社区实践]` 注：这是作者自述，非第三方实测。
- **不建议作为第一版**：Unity 体积与运行时常驻开销最大，且三条路线里对现有代码的复用是 0。`[推测]`
- **可借鉴点**：Mate Engine 的"窗口坐立/任务栏坐立/触摸区/表情编辑"是很好的产品功能清单。`[社区实践]`

#### D. Lively Wallpaper

- **WebGL 壁纸支持**：支持 HTML5/WebGL 网页壁纸与 Unity/Godot 应用壁纸。`[官方文档] livelywallpaper.io/wallpaper-types/`
- **输入**：网页壁纸**默认鼠标可用**，键盘需在设置里开 `Wallpaper Input → Keyboard`。`[官方文档] lively wiki / Web-Guide-IV`
- **应用壁纸的硬限制**（原文）：
  - "Wallpaper playback pause is currently disabled for application wallpapers **due to bugs**"（无法在游戏全屏时暂停）`[官方文档]`
  - "Do not try to change application position or size during runtime"（不允许运行时改位置/尺寸）`[官方文档]`
  - "Application that open multiple window is not supported"（多窗口不支持）`[官方文档]`
  - 应用壁纸可以自己装输入钩子，所以"关掉输入"不保证真的关掉。`[官方文档]`
- **多显示器暂停问题**：stretch 模式下全屏不暂停、多屏暂停不一致，属已知 issue。`[社区实践] lively#3110, lively#1796`
- **定位结论**：Lively 是**背景层/壁纸宿主**，没有 always-on-top 概念、不能承载浮动聊天窗、不能自由拖动。**不能作为桌宠主 Runtime**，但非常适合作为"壁纸模式"的第二 Runtime（直接指向同一个 `/vrm/` URL 即可）。`[官方文档]+[推测]`

#### E. 其他方案（备查）

| 方案 | 结论 |
|---|---|
| **WebView2**（pywebview / WPF） | 透明只支持"完全不透明或完全透明"，**不支持部分不透明度**，且透明背景下 backdrop-filter 模糊失效。`[官方文档/社区实践] WebView2Feedback#915, #4945`。穿透需在 HWND 上加 `WS_EX_TRANSPARENT\|WS_EX_LAYERED`。`[官方文档] MS DWM best practices` |
| **pywebview** | `create_window(transparent=True, frameless=True)` 可用，Python 一体化，但 Win32 窗口细节控制弱于 Electron。`[官方文档]` |
| **Win32 原生 + CEF 离屏渲染** | 最极致可控，工程量最大。`[社区实践] Dir-A/Win32_Transparent` |
| **Godot 多窗口**（`gui_embed_subwindows`） | 可做"一个应用多个浮窗"，是 Godot 路线里最优雅的桌宠做法。`[社区实践] phanstudio/Desktop-Pet` |

### 3.3 比较总结

- **判断：Electron 是唯一能"零改 3D 代码 + 完整窗口控制 + 独立聊天窗"三件事同时成立的方案。**
- Godot 是**唯一能显著降低 GPU/RAM 的方案**，但代价是 VRMA 不支持 + 全部渲染逻辑重写，**不建议在第一版尝试**。可作为 Phase 8 之后的"性能专项"评估。
- Unity 不推荐。
- Lively 只做可选壁纸模式。

---

## 4. 推荐架构

```
                        Windows 10/11
                             │
        ┌────────────────────┴────────────────────┐
        │                                          │
   进程 1：AI Core                          进程 2：Avatar Runtime
   Python (run_server.py)                   Electron (main + renderer)
   ├─ FastAPI + uvicorn                     ├─ 窗口 A：Avatar（透明/无框/
   ├─ :12393                                │   置顶/不占任务栏/局部穿透）
   ├─ /client-ws  ◄────── WS (JSON) ───────►│     加载 http://127.0.0.1:12393/vrm/
   ├─ /vrm → vrm_frontend/ (静态)            │     持有唯一 WS 连接
   ├─ /api/settings/*                       ├─ 窗口 B：Chat（无框/可按需显示）
   └─ agent/ mcpp/ memory/ tts/ asr/ vad/   ├─ 窗口 C：Settings（替代 Edge --app）
                                            └─ Tray + 生命周期 + 子进程监管
                                                 │
                                                 │ IPC（Electron ipcMain/ipcRenderer）
                                                 ▼
                                          窗口 A ↔ 窗口 B 通信（不新增第二条 WS）
```

### 4.1 核心原则（与本项目对齐后的版本）

1. **AI Core 不知道渲染器的存在。** 现状已经做到，保持即可。AI Core 只输出：文本、音频（含 base64 WAV + 音量包络 + 表情）、控制指令。
2. **不新增第二条 WebSocket 连接。** 多条 `/client-ws` 连接会在后端各自克隆一份 `ServiceContext`，导致 history_uid 与记忆分叉。`[代码证据] websocket_handler.py:182-199` 因此聊天窗必须通过 Electron IPC 复用窗口 A 的连接。
3. **不拆微服务、不加 IPC 中间件。** 保持 2~3 个进程。
4. **渲染器可替换。** 只要合同是 `/client-ws` 的 JSON 协议，未来的 Godot 渲染器可以并存。

---

## 5. Character API（第一版最小协议）

### 5.1 关键判断：**不需要发明新协议**

现有 `/client-ws` 协议已经承担了 Character API 的职责，字段如下 `[代码证据] websocket_handler.py:48-58`：

```
WSMessage = { type, action?, text?, audio?[float], images?[str],
              history_uid?, file?, display_text? }
```

**服务端 → 渲染器**（角色表现相关）`[代码证据]`：

| type | 载荷 | 对应"角色能力" |
|---|---|---|
| `full-text` | `text` | 对话文本 / 思考中 |
| `audio` | `audio`(base64 WAV), `volumes`(20ms RMS), `slice_length`, `display_text`, **`actions.expressions`** | 语音 + 口型数据 + **表情** |
| `control` | `text` ∈ {`interrupt`, `conversation-chain-start/end`, `start-mic`, `mic-audio-end`} | 状态机 |
| `set-model-and-conf` | `model_info, conf_name, conf_uid, client_uid` | 换角色 |
| `user-input-transcription` | `text` | 用户语音转写 |
| `backend-synth-complete` / `force-new-message` / `error` / `heartbeat-ack` | — | 收尾/异常 |

**渲染器 → 服务端**（已实现）：`text-input`、`mic-audio-data`、`mic-audio-end`、`raw-audio-data`、`ai-speak-signal`、`interrupt-signal`、`fetch-configs`、`switch-config`、`heartbeat` 等。

### 5.2 三个必须补的缺口

> 设计原则：**只做加法**，不改动现有字段语义，保证旧前端仍可用。

**缺口 1 — 补齐播放回执（这是 bug 修复，不是新功能）**

```jsonc
// 渲染器 → 服务端（在音频队列播完后发送）
{ "type": "frontend-playback-complete" }
```
原因：`conversation_utils.py:180-182` 无超时等待它。`[代码证据]`
验证方法：让后端在 `wait_for_response` 处打印日志，发送后应立刻进入 `force-new-message` + `conversation-chain-end`。

**缺口 2 — 新增"无音频的角色事件"**

现状问题：表情/动作**只在 `audio` 载荷里跟着语音走**。若某轮没有 TTS（纯文本、主动发言、工具调用中间态），角色就没有任何表现。`[代码证据] app.js:437-455`

```jsonc
// 服务端 → 渲染器
{
  "type": "character-event",
  "emotion": "happy",        // 可选：happy|sad|angry|surprised|relaxed|neutral
  "expression": "smile",     // 可选：VRM 预设名或自定义 expression key
  "motion": "wave_hand",     // 可选：对应 vrm_frontend 的 MOTION_URLS 键
  "gaze": "mouse",           // 可选：mouse|camera|none
  "state": "thinking",       // 可选：idle|thinking|speaking|listening
  "text": "你好呀！",         // 可选：仅用于气泡
  "speak": false,            // 可选：是否需要 TTS
  "intensity": 0.8           // 可选：0~1
}
```

**缺口 3 — 渲染器就绪握手**

```jsonc
// 渲染器 → 服务端（渲染器初始化完成后）
{ "type": "avatar-ready", "capabilities": ["vrm", "lipsync", "expression", "motion", "audioplayback"] }
```

### 5.3 为什么不做更大的重构

- 现有 `actions.expressions` 已经端到端打通（后端 `agent/output_types.py` 的 `Actions` → `prepare_audio_payload` → 前端 `setEmotion`），**改它会连带影响 Live2D 前端**。`[代码证据]`
- 新增 `character-event` 是纯增量，旧前端收到未知 type 会被 `websocket_handler` 的默认分支忽略/记录，不破坏兼容。`[代码证据] websocket_handler.py:259`

---

## 6. Desktop Runtime：Windows 透明窗口怎么实现

### 6.1 Electron 窗口参数（推荐基线）

```js
// Avatar 窗口
new BrowserWindow({
  transparent: true,        // 背景全透明
  frame: false,             // 无框
  resizable: false,
  skipTaskbar: true,        // 不占任务栏
  alwaysOnTop: true,        // 置顶（可配 level）
  hasShadow: false,
  show: false,              // 等 ready-to-show 再显示，避免闪白
  webPreferences: { preload, contextIsolation: true }
})
// 关键调用
win.setIgnoreMouseEvents(true, { forward: true })  // 默认穿透，forward 让 mousemove 仍能到达渲染器
win.setSkipTaskbar(true)
win.setAlwaysOnTop(true, 'screen-saver')
win.setShape([...])        // Windows 实验性：区域内可交互，区域外穿透（可选）
```

证据：`[官方文档] electronjs.org/docs/latest/api/browser-window`

### 6.2 局部穿透的工作模式（必须这样做）

```
渲染器每帧 raycast（已有 handleModelClick 的 raycaster）
   │ 命中角色 / 气泡 / 输入框？
   ├─ 是 → IPC: setIgnoreMouseEvents(false)   ← 可交互
   └─ 否 → IPC: setIgnoreMouseEvents(true, {forward:true})  ← 穿透到桌面
```
理由：`setIgnoreMouseEvents` 是整窗生效。`[社区实践] electron#23042`；`forward: true` 才能让 `mouseleave` 之类的移动事件仍到达渲染器。`[官方文档]`

### 6.3 窗口尺寸的权衡（重要性能点）

| 方案 | 优点 | 缺点 |
|---|---|---|
| **A. 角色包围盒窗口**（如 480×720 固定） | 透明合成开销小、GPU 占用低 | 角色不能"走"到桌面任意位置 |
| **B. 全屏透明窗口（跨多显示器）** | 角色可自由漫游 | 每帧全屏 alpha 合成，GPU 明显上升；多分辨率/DPI 混合时有"死区" |

**建议第一版用 A**，把"自由漫游"留给后续优化。Godot 侧的同类经验：跨屏统一矩形在不匹配分辨率下会出现无显示器死区，需要逐个显示器 clamp。`[社区实践] Kalgator`

### 6.4 与现有实现的差异（需要动的地方）

| 现状 | 改法 |
|---|---|
| `app/launcher.py:71-87` 用 `Edge --app` 开窗口 | 换成 Electron `BrowserWindow` |
| `settings_router.py:817-886` 用 `subprocess.Popen` 开 Edge 设置窗 | 换成 Electron 第二个 `BrowserWindow`（同一 session partition，保住 `localStorage` 同步） |
| `app/Program.cs` + `启动器.exe` 只是瘦壳 | 可保留为"启动 Electron"的入口，或直接换成 Electron 打包产物 |

---

## 7. Chat UI：如何与 Avatar 分离

### 7.1 现状

`vrm_frontend/index.html` 里 3D 画布和聊天 UI 是**同一 DOM 叠加**（`#canvas-container` + `.ui-layer`），`.ui-layer { pointer-events: none }` + `.clickable { pointer-events: auto }` 保证 canvas 能收到 raycast。`[代码证据] style.css:33-49`

### 7.2 两步走（不要一步到位）

**Phase 4-A（最小改动，先用这个）**：聊天 UI 留在 Avatar 窗口内，但**默认隐藏**，由「点击角色 / 全局快捷键 / AI 主动发言」唤起，用后自动隐藏。这正是上游 Electron 桌宠模式的做法（"输入框与字幕可独立拖动、可隐藏"）。`[官方文档] docs.llmvtuber.com/.../electron/`
- 改动量：`index.html` 加 `hidden` 状态 + `app.js` 加开关函数。**不需要拆窗口。**

**Phase 4-B（真正的分离）**：新建 `chat.html` + 独立无框 `BrowserWindow`。
- **关键约束**：聊天窗**不能**自己连 `/client-ws`（会造成多 ServiceContext 分叉）。`[代码证据]`
- 正确做法：
  ```
  ChatWindow（无 WS）
      │ ipcRenderer.invoke('send-text', text)
      ▼
  Electron main（中继）
      │ webContents.send('avatar:relay', msg)
      ▼
  AvatarWindow（唯一 WS 连接）→ ws.send({type:'text-input'})
      │ 收到 full-text / audio 后
      ▼
  main → ChatWindow.webContents.send('chat:update', ...)
  ```
- 两窗口用**同一个 `partition`**，`localStorage` 的 `storage` 事件才能跨窗触发（现有设置同步机制依赖它）。`[代码证据] vrm_frontend/app.js:1458-1468`

### 7.3 全局快捷键（当前完全没有，需新增）

Electron `globalShortcut.register(...)`，建议 `Ctrl+Shift+Space` 唤起聊天框。`[官方文档]`

---

## 8. Wallpaper Runtime：Lively 该放在什么位置

### 8.1 结论：**作为 Phase 8 的可选第二 Runtime，不影响主路线**

### 8.2 逐项回答

| 问题 | 答案 | 证据 |
|---|---|---|
| 1. Lively 能否直接承载现有 WebGL/Three.js/VRM？ | **能**。它支持 HTML5/WebGL 网页壁纸；把 `/vrm/` 的 URL 加进去即可 | `[官方文档]` |
| 2. 能否承载 Godot？ | 能（应用壁纸，选 `Application Godot (*.exe)`） | `[官方文档]` |
| 3. 鼠标输入可用？ | 网页壁纸默认可用 | `[官方文档]` |
| 4. 键盘输入可用？ | 需手动开启 `Wallpaper Input → Keyboard` | `[官方文档]` |
| 5. 聊天 UI 适合放壁纸内？ | **不适合**。壁纸在桌面图标层之下，输入框会被图标遮挡 | `[推测]` |
| 6. 应用独立 Floating Chat Window？ | **应该**。用第 7 节的两个 Electron 窗口方案 | `[推测]` |
| 7. 性能表现 | 网页壁纸走得通；**但应用壁纸无法在游戏全屏时暂停**（官方承认是 bug） | `[官方文档]` |
| 8. 生命周期管理 | Lively 自己管理壁纸进程；**不允许运行时改窗口位置/尺寸** | `[官方文档]` |
| 9. 多显示器 | 支持 span/duplicate/perscreen，但**暂停逻辑在多屏下不一致** | `[社区实践] lively#3110` |
| 10. 全屏程序时是否暂停 | 网页壁纸会暂停；**应用壁纸不会**（bug） | `[官方文档]` |

### 8.3 落地方式

壁纸模式**不新增代码路径**：AI Core 不变，Electron 的 Avatar 窗口可以**不启动**，直接让 Lively 加载 `http://127.0.0.1:12393/vrm/`。需要的是：
- 让 `/vrm/` 在"无 Electron 宿主"下也能工作（现状可工作，因为它本来就是网页）；
- 聊天/设置走 Electron 的独立窗口（可与壁纸模式共存）。

### 8.4 风险

Lively 是第三方软件，版本行为不受控；把它写进"第一版验收标准"会让项目被外部依赖拖住。**明确降级为可选模式。**

---

## 9. 进程结构

### 9.1 推荐（2 个进程，最少依赖）

| # | 进程 | 前台/后台 | 内容 |
|---|---|---|---|
| 1 | **AI Core** (`python run_server.py`) | **后台，无窗口** | FastAPI + uvicorn，`:12393`。由 Electron main 以子进程方式启动 |
| 2 | **Electron 应用** | **前台（仅透明窗口）** | main 进程 + 3 个 renderer：Avatar（透明）/ Chat / Settings |

线程层面：
- Electron main：Node 单线程 + libuv；负责窗口、托盘、子进程监管、IPC 中继。
- 每个 `BrowserWindow` 一个 renderer 进程（Electron 默认多进程模型）。
- Python 侧：uvicorn/asyncio 单进程；`MemoryService` 的后台合成是 `asyncio` 任务；TTS/ASR 通过 `asyncio.to_thread` 落到线程池。`[代码证据]`

### 9.2 明确不做的

- ❌ 不拆 3 个 Python 服务（LLM/TTS/ASR 各一个）——现在是同一进程内的对象，拆开只会引入延迟和协调复杂度。`[代码证据] service_context.py 引用共享`
- ❌ 不加 Named Pipe / gRPC——WebSocket + JSON 已经够用，且是**语言无关**的（未来 Godot/C# 渲染器照样能接）。
- ❌ 不加数据库/消息队列/Docker。

### 9.3 通信层最终建议

**保持 WebSocket + JSON（现状）。** 理由：
1. 已经存在、已经跑通、已经跨语言（B 站客户端也是用 `websockets.connect` 接的）。`[代码证据] live/bilibili_live.py:303`
2. 本地回环延迟在微秒级，不是瓶颈。
3. 换成 Named Pipe 只对"同机同语言"有意义，对未来 Godot/C# 渲染器反而不利。
4. WebSocket 自带重连、分帧、跨平台，调试工具齐全。

**唯一建议**：把协议从"散落在 3 个文件里"整理成一份 `doc/character_api.md`（只写文档，不改代码）。

---

## 10. 生命周期

### 10.1 启动时序（推荐：Electron 作为 supervisor）

```
Windows 登录
  └─ 注册表 Run 键 / 任务计划程序(at logon) 启动 Electron
       ├─ main: 创建 Tray（先让用户看到图标，给反馈）
       ├─ main: spawn Python AI Core（CreateNoWindow，无 CMD 黑窗）
       ├─ main: 轮询 http://127.0.0.1:12393/ 直到 200（沿用现有 wait_for_server 思路）
       ├─ main: new BrowserWindow(Avatar) → load http://127.0.0.1:12393/vrm/
       ├─ renderer: VRM 加载完成 → 发送 { type: 'avatar-ready' }
       └─ main: win.show()  ← 用 ready-to-show，避免闪白
```

- **不弹 CMD**：`subprocess.Popen(..., creationflags=CREATE_NO_WINDOW)`，或把 Python 换成 `pythonw.exe`。现有 `app/Program.cs` 已经用了 `CreateNoWindow=true` 的思路，可借鉴。`[代码证据]`
- **不弹浏览器**：删掉 `app/launcher.py:122-142` 的浏览器分支。

### 10.2 关闭 / 退出

- 托盘右键 → 退出：先 `win.close()`，再 `child.kill()`（Python 侧靠 `atexit` 清 cache，已有）。`[代码证据] run_server.py:196`
- Avatar 窗口的"关闭按钮"应理解为"隐藏"，不退出进程。

### 10.3 崩溃恢复

| 故障 | 处理 |
|---|---|
| AI Core 崩溃 | main 监听 `child.on('exit')` → 指数退避重启（1s/2s/5s/15s，最多 N 次）→ 重启期间 Avatar 窗口显示"离线"状态（`app.js` 已有 3s 自动重连 WS 的逻辑，可直接复用）`[代码证据] app.js:1156-1161` |
| Electron renderer 崩溃 | main 监听 `webContents.on('render-process-gone')` → `win.reload()` |
| Electron main 崩溃 | Python 成为孤儿进程 → 让 Python 侧检测父进程退出后自杀，或下次启动时靠 "12393 已被占用" 逻辑复用（现有行为）`[代码证据] app/launcher.py:109-110` |
| WS 断线 | 现有 3s 重连覆盖 `[代码证据]` |

### 10.4 全屏程序检测（省电）

需要新增：Windows 下用 `GetForegroundWindow` + 窗口矩形与显示器矩形比对，或 `SHQueryUserNotificationState`。检测到全屏 → `webContents.setBackgroundThrottling(true)` 或渲染器内降帧/暂停 rAF。
> Lively 对网页壁纸做同样的事，但对应用壁纸因为 bug 做不了。`[官方文档]` 这是自研 Runtime 相对 Lively 的一个优势。

### 10.5 开机自启

两条路：
- **注册表** `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`（最简单，用户级，无需管理员）
- **任务计划程序**（可设延迟启动、失败重启）

现状**完全没有**自启代码。`[代码证据]` 选注册表方案即可，别上 Windows Service（Service 会话 0 隔离，无法创建桌面窗口）。

---

## 11. 性能

> ⚠️ **以下全部为理论分析 / 尚未测试。** 本机未做任何实测。请在 Phase 3 结束时用 Windows 任务管理器 + GPU-Z / PresentMon 实测一次，替换本表。

### 11.1 已核实的外部真实数据点

| 来源 | 数据 | 性质 |
|---|---|---|
| Mate Engine（Unity）README | "Alice 模型贴图约 190MB → 总 RAM 约 200MB" | 作者自述，非第三方实测 `[社区实践]` |
| 上游文档 | 建议 Chrome，Edge/Safari 有已知问题 | `[官方文档]` |

### 11.2 理论量级估算（未实测）

| 指标 | AI Core (Python) | Avatar Runtime (Electron) | 说明 |
|---|---|---|---|
| **RAM** | 300~700 MB | 250~400 MB（Chromium 基线 + 模型贴图） | 若 TTS/ASR 全走云 API，Python 侧不含模型权重，主要开销在 torch（Silero VAD 若开启会拉入 torch，**数百 MB**）`[推测]`。VAD 默认关闭可省下这块 `[代码证据]` |
| **VRAM** | ~0（云 API） | 100~400 MB | 取决于 VRM 贴图与是否开 MSAA/阴影；四盏灯无阴影 `[代码证据] app.js:166-179` |
| **GPU** | 0 | **主要变量**：透明窗口每帧全屏 alpha 合成是最大成本。**用 480×720 包围盒窗口而非全屏可显著降低** | `[推测]` |
| **CPU** | LLM 走云时 < 5% | 单 renderer 常驻约 3~10%（60fps 未限帧时更高） | 建议加帧率上限（30fps 对桌宠足够）`[推测]` |
| **启动时间** | 3~10 s | 1~3 s | 现状 `wait_for_server` 超时给了 40s，说明冷启动可能到十几秒（首次含模型下载）`[代码证据] app/launcher.py:36` |

### 11.3 降低占用的手段（有优先级）

1. **AI Core 的 ASR/TTS 全走云**（现状已如此）→ 不加载任何本地模型权重。`[代码证据]`
2. **VAD 保持关闭**（否则会 import torch）。`[代码证据] vad 默认 null`
3. **渲染器限帧**：30fps 足够，空闲时可降到 10fps。
4. **窗口不用全屏**，用角色包围盒。
5. **全屏程序前台时暂停渲染**（第 10.4 节）。
6. **模型减面**：仓库已有 `scripts/optimize_vrm.py`（gltfpack 简化网格 + 按骨骼索引偏移回植 VRM 扩展），实测能把百万面级高模压到可实时渲染的面数；减面过程中两个已踩过的坑（顶点属性被裁 / 量化破坏 UV）见 `doc/pitfalls.md` §2.1 / §2.2。`[代码证据]`

### 11.4 如果要更极致的性能

唯一现实路径是 Godot/原生渲染器，但要付出第 3.2.B 节列出的全部代价（VRMA 不支持是硬伤）。**建议先量化 Electron 的实际占用，再决定是否值得。**

---

## 12. 开发路线

### Phase 0：仓库研究（本文档）
- **目标**：确认现状与边界。
- **产出**：本文档。
- **验收**：能明确回答"哪些能复用、哪些要拆"。
- **状态**：✅ 已完成。

---

### Phase 1：AI Core 服务化 + 协议补齐
- **目标**：让 AI Core 可被任意渲染器驱动，并补上 3 个协议缺口。
- **修改模块**：
  - `src/open_llm_vtuber/conversations/conversation_utils.py:180-182` — 给 `wait_for_response` 加**超时兜底**（例如 15s），避免渲染器不回执时永久挂起。
  - `src/open_llm_vtuber/websocket_handler.py` — 注册 `avatar-ready` 与 `frontend-playback-complete` 处理器。
  - `src/open_llm_vtuber/conversations/single_conversation.py` — 在无音频 / 主动发言路径上推送 `character-event`。
- **新增模块**：`doc/character_api.md`（仅文档）。
- **为什么**：这是所有后续工作的地基；不改这块，桌面壳会带着 bug 一起搬过去。
- **验收**：用 `websocat`/Python 脚本连 `/client-ws`，发 `text-input`，能收到 `full-text` + `audio`(带 expressions) + `control: conversation-chain-end`（不再挂起）。
- **风险**：低。超时兜底会改变收尾时机 → 需要确认不影响 Live2D 前端（它本来就会回执）。
- **验证方法**：同时用现有 Live2D 前端和脚本各跑一轮，对比行为。

---

### Phase 2：Electron Avatar Runtime（透明桌宠窗口）
- **目标**：角色出现在桌面上，无浏览器、无 CMD、无普通窗口。
- **修改模块**：`app/launcher.py`（删除浏览器分支，或整体废弃）。
- **新增模块**：
  - `desktop/main.js`（窗口/托盘/生命周期/子进程监管）
  - `desktop/preload.js`（IPC 桥）
  - `desktop/package.json`
- **为什么**：这是整个需求的核心缺口——当前 `Edge --app` 方案无法控制透明/置顶/穿透/任务栏。
- **验收**（对应用户 15 条成功标准中的 1~6、12）：
  1. 登录后 AI Core 后台启动，无 CMD 黑窗
  2. VRM 角色自动出现
  3. 无 Chrome/Edge 标签页
  4. 无普通 EXE 窗口
  5. 角色背景完全透明
  6. 非角色区域点击穿透到桌面（能点到底下的图标）
- **风险**：**中高**。透明窗口 + 局部穿透 + 焦点/键盘是 Electron 在 Windows 上最容易被坑的地方（`setIgnoreMouseEvents` 整窗生效、透明窗口不能 resize 等）。缓解：先做"固定包围盒窗口 + 角色区域不穿透"的最小版，跑通再上局部穿透。

---

### Phase 3：桌面集成（交互 + 性能摸底）
- **目标**：角色可拖动、可点击、可右键；测出真实性能。
- **修改模块**：`vrm_frontend/app.js` — 拖动改为 `-webkit-app-region: drag` 或 IPC 移动窗口（现在是 OrbitControls 转相机 `app.js:155-161`）；新增右键菜单。
- **新增模块**：`desktop/fullscreen-watcher.js`（全屏检测 → 降帧）。
- **为什么**：桌宠的基本操作反馈，且性能数据决定 Phase 8 之后要不要上 Godot。
- **验收**：拖动角色移动窗口；点击角色触发（复用现有 `CLICK_REACTIONS`）；右键出菜单；实测 RAM/GPU/VRAM/启动时间并回填第 11 节。
- **风险**：中。托盘/自启/崩溃恢复的边界条件多。

---

### Phase 4：文本聊天（先叠加，再分窗）
- **目标**：点击角色 → 出输入框 → 打字 → AI 回文本 → 角色表情动作。
- **修改模块**：`vrm_frontend/index.html` + `app.js`（聊天 UI 默认隐藏 + 开关 + 快捷键）。
- **新增模块**：Phase 4-B 才需要 `vrm_frontend/chat.html` + `desktop/chat-window.js` + IPC 中继。
- **为什么**：用户明确要求聊天 UI 不与渲染器强耦合；但**先做叠加版能最快拿到可用产品**，分窗是提炼而非必需。
- **验收**：点击角色出现输入框；输入后收到回复；角色表情/动作同步；Esc 或失焦自动隐藏；聊天窗与 Avatar 状态同步（不重复建 WS）。
- **风险**：低（4-A）/ 中（4-B，IPC 中继与状态同步）。

---

### Phase 5：TTS / STT 打通
- **目标**：语音输入 + 角色说话。
- **修改模块**：`vrm_frontend/app.js` 的音频链路（已在，基本复用）；Electron 侧需放行麦克风权限 `session.setPermissionRequestHandler`。
- **为什么**：现状麦克风走 `getUserMedia` + ScriptProcessor，在 Electron 里需要宿主授权。`[代码证据] app.js:1333-1354`
- **验收**：按麦克风按钮能录音并上传；TTS 音频播放时口型随动；可打断。
- **风险**：中。Electron 中 `getUserMedia` 在 `http://127.0.0.1` 属安全上下文，通常可用，但权限回调必须实现。

---

### Phase 6：主动行为
- **目标**：AI 能主动搭话、按时间/情绪触发动作。
- **修改模块**：后端新增定时器/事件源 → 发 `character-event`。
- **为什么**：桌宠的核心体验差异点（"它在看着我"）。
- **验收**：空闲 N 分钟后角色主动说话；鼠标靠近时有视线反应（需先接线 `#vrm-lookat-mode`）。
- **风险**：低。

---

### Phase 7：Vision / 桌面感知
- **目标**：角色能"看见"屏幕。
- **修改模块**：**后端通路已就绪**（`ImageSource.SCREEN` + `BatchInput.images` + `basic_memory_agent` 的 image_url block）`[代码证据]`；缺的是**采集端**。
- **新增模块**：Electron main 用 `desktopCapturer` 截屏 → 通过 IPC 交给 Avatar 窗口 → 随 `text-input` 发 `images` 字段。
- **为什么**：这是本项目相对其它桌宠的最大差异化能力，且后端已经准备好了，边际成本低。
- **验收**：角色能回答"我屏幕上是什么"。
- **风险**：中。隐私（需显式开关）、截图时机与 token 成本。

---

### Phase 8：Wallpaper Runtime（可选）
- **目标**：壁纸模式。
- **新增模块**：`LivelyInfo.json` 描述文件。
- **为什么**：扩展使用场景，但**不能影响主路线**。
- **验收**：Lively 能加载 `/vrm/`，鼠标交互可用，角色正常说话。
- **风险**：中。Lively 是第三方，行为受版本影响；应用壁纸的暂停 bug 与多屏不一致是已知问题。`[官方文档]`

---

## 13. 需要改动现有代码的清单（实施前需你确认）

按你的规矩，以下是我认为**必须动**的既有代码点。**目前一条都没改。**

| # | 文件 | 位置 | 改什么 | 为什么 | 验证方法 |
|---|---|---|---|---|---|
| 1 | `src/open_llm_vtuber/conversations/conversation_utils.py` | :180-182 | 给 `wait_for_response(..., "frontend-playback-complete")` 加超时 | 当前无超时；VRM 前端从不回执 → 有挂起风险 | 脚本连 WS 发 `text-input`，观察是否在超时后进入 `conversation-chain-end` |
| 2 | `src/open_llm_vtuber/websocket_handler.py` | `_init_message_handlers` :76-98 | 注册 `avatar-ready` / `frontend-playback-complete` 处理器 | 新渲染器需要两个握手 | 发消息不报"unhandled"日志 |
| 3 | `src/open_llm_vtuber/conversations/single_conversation.py` | 无音频分支 | 推送 `character-event` | 纯文本轮次角色无表现 | 关闭 TTS 后角色仍有表情 |
| 4 | `vrm_frontend/app.js` | :155-161 附近 | OrbitControls 与窗口拖动解耦 | 桌宠应拖窗口而非转相机 | 拖动角色窗口跟随移动 |
| 5 | `vrm_frontend/app.js` | 新增读取逻辑 | 接线 `#vrm-lookat-mode` / `#vrm-breath-scale` | 设置项当前"存得下、不生效" | 改设置后视线模式真的变 |
| 6 | `app/launcher.py` | :55-87, 122-142 | 删除浏览器唤起分支 | 不再需要外部浏览器 | 启动后无浏览器进程 |
| 7 | `src/open_llm_vtuber/settings_router.py` | :817-886 | 设置窗口改用 Electron 窗口 | 当前会拉起外部 Edge | 点设置按钮不弹浏览器 |

> ⚠️ 第 1 条是**既有 bug 修复**，我建议优先做，且与桌宠无关也应修。

---

## 14. 技术风险清单

| 风险 | 等级 | 说明 | 缓解 |
|---|---|---|---|
| Electron 透明窗口 + 局部穿透在 Windows 上的坑 | **高** | `setIgnoreMouseEvents` 整窗生效；`setShape` 标着实验性；透明窗口对 resize 不友好 | 先做包围盒窗口 + 全窗可交互，跑通再加穿透 |
| 透明全屏窗口的 GPU 成本 | **中** | 每帧全屏 alpha 合成 | 用包围盒窗口 + 限帧 + 全屏程序时暂停 |
| 多窗口共享 WS 导致上下文分叉 | **中** | 每条 `/client-ws` 连接一个 ServiceContext 克隆 | 只允许 Avatar 窗口持有 WS，其余走 IPC |
| `frontend-playback-complete` 挂起 | **中** | 既有无超时等待 | Phase 1 修 |
| VRM 前端与 Live2D 前端并存导致协议漂移 | 中 | 两套前端消费同一协议 | 把协议写成文档；只做加法 |
| `godot-vrm` 不支持 VRMA（若选 Godot） | **高（若选 Godot）** | 现有动作资产作废 | 第一版不选 Godot |
| Lively 行为不受控 | 中 | 第三方软件，应用壁纸暂停有官方承认的 bug | 明确为可选模式，不进第一版验收 |
| 首次启动慢 / 需下载模型 | 中 | `wait_for_server` 给了 40s | 启动画面 + 后台预热 |
| 麦克风权限在 Electron 中被拒 | 低 | 需显式放行 | `setPermissionRequestHandler` |
| 角色版权 / 模型分发 | 中 | 仓库内多个 VRM 为第三方作品 | 打包时不含模型，由用户自备 |

---

## 15. 下一步具体应该先做什么

**我建议的顺序（都是小步、可验证的）：**

1. **先修 bug（半天级）**：`conversation_utils.py:180-182` 加超时。这条与桌宠无关，但会阻塞后面所有验证。→ 需要你确认第 13 节第 1 条。
2. **做一个 30 行的 Electron 冒烟原型**：一个 `BrowserWindow({transparent:true, frame:false, skipTaskbar:true, alwaysOnTop:true})` 加载 `http://127.0.0.1:12393/vrm/`，手动启动 Python 后端。
   - 目的：**在投入任何架构工作前，先看透明窗口 + three-vrm 在 Windows 上的真实效果与占用**。
   - 这一步能一次性证伪/证实第 11 节的所有性能推测和第 14 节最大的风险。
3. **根据冒烟结果决定**：如果 GPU/RAM 可接受 → 按 Phase 2→3→4 推进；如果不可接受 → 再评估 Godot（届时 VRMA 问题必须一并解决）。

**我不建议现在就动 Phase 1 的协议改动**——先看冒烟原型，因为如果 Electron 路线被证伪，协议改动方向可能也要跟着变。

---

## 附录：参考来源

**本仓库代码证据**：`src/open_llm_vtuber/{server.py, routes.py, websocket_handler.py, service_context.py, settings_router.py, conversations/*, agent/*, memory/*, mcpp/*, tts/*, asr/*, vad/*}`、`vrm_frontend/{app.js, index.html, README.md}`、`app/{launcher.py, Program.cs}`、`.gitmodules`

**外部来源**
- [Open-LLM-VTuber-Web（官方 Electron 前端）](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber-Web)
- [官方文档 · Window & Desktop Pet Mode](https://docs.llmvtuber.com/en/docs/user-guide/frontend/electron/)
- [V-Sekai/godot-vrm](https://github.com/V-Sekai/godot-vrm)
- [AzPepoze/godot-vrm（Godot 4.3+ 活跃分支）](https://github.com/AzPepoze/godot-vrm)
- [Kalgator/Godot-4-Mouse-Passthrough](https://github.com/Kalgator/Godot-4-Mouse-Passthrough)
- [godotengine/godot#80098（透明+穿透闪烁）](https://github.com/godotengine/godot/issues/80098)
- [phanstudio/Desktop-Pet（Godot 桌宠）](https://github.com/phanstudio/Desktop-Pet)
- [shinyflvre/Mate-Engine（Unity VRM 桌宠）](https://github.com/shinyflvre/Mate-Engine)
- [OnyxAmber/UnityDesktopPetFramework](https://github.com/OnyxAmber/UnityDesktopPetFramework)
- [Lively Wiki · Application Wallpaper](https://github.com/rocksdanister/lively/wiki/Application-Wallpaper)
- [Lively Wiki · Web Guide IV: Interaction](https://github.com/rocksdanister/lively/wiki/Web-Guide-IV-:-Interaction)
- [lively#3110 多屏暂停问题](https://github.com/rocksdanister/lively/issues/3110)
- [Electron BrowserWindow API](https://www.electronjs.org/docs/latest/api/browser-window)
- [electron#23042（整窗穿透限制）](https://github.com/electron/electron/issues/23042)
- [WebView2Feedback#915（不支持部分不透明度）](https://github.com/MicrosoftEdge/WebView2Feedback/issues/915)
- [WebView2Feedback#4945（透明下模糊失效）](https://github.com/MicrosoftEdge/WebView2Feedback/issues/4945)
- [pywebview Transparent 示例](https://pywebview.flowrl.com/examples/transparent.html)
- [haowenGuo/HumanClaw（Three.js+three-vrm Electron 桌宠 + 独立聊天窗）](https://github.com/haowenGuo/HumanClaw)
- [moeru-ai/airi](https://github.com/moeru-ai/airi)
- [Microsoft Learn · DWM Best Practices（WS_EX_TRANSPARENT + WS_EX_LAYERED）](https://learn.microsoft.com/en-us/windows/win32/dwm/bestpractices-ovw)
