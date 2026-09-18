# 3D VRM 桌宠壳（Electron 初版）

这是**技术验证版**，不是完成品。目的是用最小的代价回答设计文档里几个只能实测的问题。

配套设计文档：
- `doc/desktop_pet_feasibility_20260918.md`（架构研究 / 可行性分析）
- `doc/desktop_pet_ui_design_20260918.md`（无框窗口 UI 工程规范）

---

## 启动

### 日常使用：双击仓库根目录的 `启动桌宠.lnk`

**不要用 `npm start` 当日常入口。** 原因：`npm start` 会先起一个 `cmd.exe`，
那个控制台窗口会一直占着任务栏；**关掉它还会连带把桌宠一起杀掉**。

而 `electron.exe` 本身是 **GUI 子系统**程序，直接启动不会分配控制台。
所以 `启动桌宠.lnk` 直接指向：

```
target   : desktop\node_modules\electron\dist\electron.exe
args     : .
workdir  : desktop
icon     : frontend\favicon.ico
```

实测（启动前后对比）：`cmd` 6 → 6，`conhost` 9 → 10（新增那个 `MainWindowHandle = 0`，
是 Node 为管道 stdio 建的无头宿主，不是窗口），全系统可见窗口里没有任何 cmd/conhost/python。
角色窗口是 `skipTaskbar`，所以**任务栏里什么都不会多出来**，只有托盘图标。

> ⚠️ 快捷方式里存的是**绝对路径**，整个项目文件夹移动后需要重建。
> 重建方法见下方「重建快捷方式」。

### 首次准备 / 开发调试

```bat
cd desktop
npm install
node node_modules\electron\install.js   :: postinstall 有时不下载二进制，补跑一次
npm start                               :: 开发用，会带控制台
```

附加参数：

```bat
npm start -- --no-backend    # 后端已在别处跑，跳过检查
npm start -- --resize-test   # 启动后自动跑一遍尺寸切换实验并打日志
```

### 重建快捷方式

```powershell
$root = "D:\CODEX PROJECT\Open-LLM-VTuber"
$ws = New-Object -ComObject WScript.Shell
$sc = $ws.CreateShortcut("$root\启动桌宠.lnk")
$sc.TargetPath       = "$root\desktop\node_modules\electron\dist\electron.exe"
$sc.Arguments        = "."
$sc.WorkingDirectory = "$root\desktop"
$sc.IconLocation     = "$root\frontend\favicon.ico,0"
$sc.Save()
```

全局快捷键（注册失败会在日志里标 `失败`，避免给你一个按不出效果的提示）：

| 快捷键 | 作用 |
|---|---|
| `Ctrl+Shift+R` | 更改大小（再按一次 = 取消） |
| `Ctrl+Shift+S` | 打开设置 |
| `Ctrl+Shift+Space` | 显示/隐藏聊天窗 |

日志：`logs/desktop_pet.log`（托盘菜单可直接打开）。
窗口尺寸与位置保存在 `%APPDATA%/olv-desktop-pet/pet-state.json`，下次启动自动恢复。

### 关闭与收纳

- 角色窗口是**无框**的，没有关闭按钮 —— 这是刻意的。
- **收纳**：托盘图标**左键单击** = 显示/隐藏角色（或托盘菜单第一项）。
- **退出**：托盘右键 → 退出（或角色右键菜单 → 退出）。
- 桌宠有**单实例锁**：重复双击快捷方式只会把已运行的窗口唤出来，不会起第二个。

---

## 托盘菜单（按 Windows 惯例组织）

```
显示角色 / 隐藏角色          ← 状态开关，标签随状态变化
聊天…  Ctrl+Shift+Space
────────────
更改大小…  Ctrl+Shift+R
角色 ▸                       ← radio：角色清单（从页面的 #config-select 读）
预设尺寸 ▸                   ← radio：小 / 中 / 大
取景 ▸                       ← radio：胸像 / 半身 / 全身
────────────
设置…  Ctrl+Shift+S
点击穿透                     ☑
始终置顶                     ☑
回到右下角
────────────
打开日志
打开网页版（对照）
────────────
退出                         ← 约定：永远单独置底
```

遵循的惯例：
- **左键点图标 = 主操作**（显示/隐藏），**右键 = 菜单**（`setContextMenu` 自动接管，无需手动 `popup`）
- 第一项放最相关的状态开关，且**文案随状态变化**（"显示角色" ↔ "隐藏角色"）
- 互斥选项用 **radio**，开关用 **checkbox**，不要用子菜单做开关
- 设置类入口居中，诊断类入口靠后
- **"退出"单独置底**并用分隔线隔开
- Tooltip 显示应用名 + **当前角色** + 当前尺寸
- 只有 `globalShortcut.register()` 真的返回成功，才在菜单里显示快捷键提示

### 托盘切换角色是怎么做的

**复用角色窗口那条唯一 WS**，与网页版下拉发的是同一条消息：

```
托盘「角色 ▸」点击
   → main: switchCharacter(file)
   → avatarWindow.webContents.send('avatar:ws-send',
        '{"type":"switch-config","file":"zh_喜多郁代.yaml"}')
   → 页面 preload 的主世界旁路 → 真实的 socket.send()
   → 后端 handle_config_switch → 推回 set-model-and-conf
   → 页面 applyCharacterUI() 换模型，并把 #config-select 同步为该项
   → main 的 handleAvatarWsIn() 记下 conf_name → 重建托盘菜单（radio 跟着变）
```

两个刻意的决定：

- **角色清单从页面的 `#config-select` 读**，而不是自己扫 `characters/*.yaml`。
  那个下拉才是「哪些角色可用、显示什么名字」的唯一事实来源（带 `(Kira)` 这类后缀），
  读它两边永远不会不一致，而且**不用改 `vrm_frontend/` 源码**。
- **当前角色以 `set-model-and-conf` 为准，不拿下拉的选中值当当前值。**
  页面加载那一刻，`#config-select` 的选中项是列表**第一项**，而真正加载的角色要等
  后端推 `set-model-and-conf` 才知道 —— 用前者会在启动后短暂标错。
- 切换**不做乐观更新**：等后端确认后再改 radio，宁可多等一次本地往返（毫秒级）。

> 角色切换不会被持久化到 `conf.yaml`：下次启动仍按 `conf.yaml` 的默认角色加载。
> 这与网页版行为一致。

---

## 调整大小模式（拉伸框）

**背景**：我们在前面查证过 —— **Windows 上透明窗口无法用系统边框拉伸**
（`WS_THICKFRAME` 与分层窗口不兼容，electron#51175 / #49173）。
Electron 的 `win.setAspectRatio()` 在 Windows 上也无效（electron#8036）。
所以"边框"必须自己做。

**两种实现方式的取舍**：

| | A. 在角色窗口里叠一层框 | B. 独立的拉伸框窗口 ✅ |
|---|---|---|
| 把手在窗口边缘 | 被裁掉一半，只能内缩 | 想放多大放多大 |
| 拖动时的角色窗口 | **必须跟着改尺寸** → 页面触发 `resize` → `renderer.setSize()` **每帧重分配 framebuffer** | **完全不动** |
| 拖动期间渲染 | 只能靠冻结绕过 | **天然 0 帧** |
| 命中判定 | 读 `canvas.style.cursor` | 自己的 DOM，`elementFromPoint` 即可 |

选 **B**。关键就是第三行：方案 A 的 `setSize` 每帧重分配 framebuffer 反而更耗 GPU，
与"变动期间不要刷新渲染"的目标背道而驰。

**流程**：

```
托盘/快捷键 → enterResizeMode()
   ├─ 冻结渲染：把页面的 rAF 回调「扣住不执行」（见下）→ 真正 0 帧
   └─ 建一层铺满工作区的透明窗口 resize-frame.html
         · 画目标框（4 个角把手）+ 原尺寸虚影 + 尺寸标签
         · 拖角 = 自由伸缩，**比例锁定**；拖框体 = 移动位置
         · 框外一律穿透，只有框/按钮可交互
   ├─ 确认 / Enter → setBounds 一次性生效 → 恢复渲染
   └─ 取消 / Esc  → 角色窗口自始至终没动过，无需回滚 → 恢复渲染
```

**比例锁**由拖拽数学自己实现（`resize-frame.html` 的 `resizeTo()`）：
每次取"相对原始尺寸变化更明显"的那个轴驱动缩放，另一个轴按 `宽/高` 推出来，
所以永远不可能拉变形。

**"冻结"是怎么做到 0 帧的**：`vrm_frontend/app.js:1564` 的循环是
`function animate() { requestAnimationFrame(animate); ... }`。
我们把 `window.requestAnimationFrame` 换成一个**只把回调存下来、不执行**的版本，
循环就停在原地 —— 既不渲染，又能随时把存下的回调交还原生 rAF 干净恢复。
比"降频"彻底，也比改前端源码无侵入。

---

## 本版做了什么

| 能力 | 说明 | 设计文档 |
|---|---|---|
| 无框透明窗口 | `transparent` + `frame:false` + `hasShadow:false` | §2.1 |
| 不抢焦点 | `focusable:false`（Windows → `WS_EX_NOACTIVATE`），用 `showInactive()` 显示 | §11.2 |
| 不占任务栏 | `skipTaskbar:true` | §5.2 |
| 始终置顶 | `setAlwaysOnTop(true, 'screen-saver')` | §5.2 |
| 页面透明化 | Electron 侧注入 `pet-overlay.css`，**不修改 `vrm_frontend/` 任何源码** | — |
| 拖动角色 | 位移阈值 6px + 主进程 `setPosition`；**不用 `app-region: drag`** | §4 |
| **局部点击穿透** | **只有角色身体挡住鼠标，透明区域一律穿透到下层窗口** | §3 / §12.6 |
| **调整大小模式** | 独立拉伸框 + 比例锁定 + 确认/取消，拖动期间 **0 帧渲染** | §12.9 |
| 对话框气泡 | 贴人像底部居中，**60% 半透明**，去掉毛玻璃省 GPU | — |
| 设置窗口 | **有边框**常规窗口（无框只用在角色和气泡上） | §6.1 |
| 尺寸/位置记忆 | 存 `%APPDATA%/olv-desktop-pet/pet-state.json`，启动自动恢复 | — |
| 托盘菜单 | 按 Windows 惯例组织（见下） | — |
| **托盘切换角色** | 「角色 ▸」radio，**复用同一条 WS**（发 `switch-config`）；清单从页面 `#config-select` 读 | — |
| 预设尺寸 | 小 / 中 / 大（radio） | §12.1 |
| 取景档位 | 胸像 / 半身 / 全身（合成滚轮事件，**不改前端源码**） | §12.3 |
| 右键菜单 | 原生 `Menu.popup()`，不是 DOM 菜单 | §6.2 |
| 崩溃恢复 | 渲染进程崩溃后 1.5s 自动重载 | §10.3 |
| **独立聊天悬浮窗** | 320×140，可收起成 320×58；**复用角色窗口那条 WS**（IPC 中继，不新建连接） | §2.2 / §7 |

> ⚠️ **npm 安装坑**：`npm install electron` 的 postinstall 有时不会下载二进制，导致 `node_modules/electron/dist/` 缺失、`npm start` 报找不到 electron。补跑一次即可：
> ```bat
> node node_modules\electron\install.js
> ```

## 本版**没有**做（有意留给后续）

- ❌ 全屏应用检测与降帧
- ❌ Wallpaper 模式
- ❌ 协议补丁（`character-event` / `avatar-ready` / `playback-complete` 超时）
- ❌ 精确的「非矩形」命中区域（当前按角色网格 raycast，已经足够，但头发/裙摆边缘可能略有抖动）
- ❌ 调整大小时的实时预览（拖动期间刻意不动角色窗口以省 GPU，确认后才生效）

---

## 局部点击穿透是怎么做的（重要）

**难点**：窗口是「角色包围盒」，如果整窗都可交互，盒内大片透明区域会把点击全吃掉。

**常规解法**是渲染器 raycast → IPC → 切换 `setIgnoreMouseEvents`，但这里有个障碍：
`vrm_frontend/app.js` 是 ES module，`camera` / `currentVrm` 都在模块作用域里，**外部拿不到，无法自己做 raycast**。

**本版的解法（零改动复用前端）**：`app.js:1143-1155` 每次 `pointermove` 已经在对 VRM 网格做 raycast，
并把结果写进 **canvas 的内联样式**：

```js
renderer.domElement.style.cursor = hits.length > 0 ? 'pointer' : 'default';
```

所以只要读 `canvas.style.cursor` 就等于拿到了**精确的逐像素命中结果**。

```
页面 pointermove → raycast → canvas.style.cursor
        │
        ├─ preload: MutationObserver + 100ms 轮询 读取该样式
        │      → IPC 'avatar:hover-state'
        ▼
   main: 命中角色 → setIgnoreMouseEvents(false)   ← 可点击、可拖动
         未命中   → setIgnoreMouseEvents(true, { forward: true })  ← 穿透到下层
```

**两个必须注意的点**：

1. **`forward: true` 是强制的。** 窗口穿透后仍要把 mousemove 转发回页面，否则页面里的 raycast
   永远不会再跑，就再也收不到「鼠标进入角色」的信号 —— 死锁。
   本版因此**先整窗可交互，直到收到第一个真实 `pointermove` 才敢开启穿透**（日志里会打印
   `已确认 mouse move 转发可用`）。这样最坏情况也只是退回旧行为，不会把角色点死。
2. **不要给 canvas 写 cursor 样式**（`pet-overlay.css` 里有注释警告）。覆盖它会破坏整个命中判定。

---

## 独立聊天悬浮窗

### 为什么不能让它自己连 WebSocket（硬约束）

后端**每一条** `/client-ws` 连接都会克隆一份 `ServiceContext`（各自的 `history_uid`，
见 `websocket_handler.py` 的 `_init_service_context`）。开第二条连接会导致两件事：

- 对话上下文与长期记忆**分叉**，两边历史对不上；
- AI 的 TTS 音频只会推给**其中一条** —— 角色就不会说话了。

所以聊天窗**不建自己的连接**，全部收发经主进程中继到角色窗口那条唯一连接：

```
ChatWindow（无 WS，只有 ipcRenderer）
    │ petChat.sendText(text)   → ipcMain 'chat:outbound'
    │ petChat.getLog()         ← ipcMain.handle 'chat:get-log'
    ▼
main
    │ avatarWindow.webContents.send('avatar:ws-send', json)
    ▼
AvatarWindow（唯一 WS，靠 preload 的主世界旁路拿到收发）
    │ CustomEvent '__pet-ws-out'  → 主世界被包装的 socket.send()
    ▼
ws://127.0.0.1:12393/client-ws
```

收方向同理：主世界 socket 的 `message` → `__pet-ws-in` → preload → `avatar:ws-in`
→ main 的 `handleAvatarWsIn()` → `chat:append` 推给聊天窗。

聊天记录存在**主进程**的 `chatLog` 数组（上限 300 条），所以窗口隐藏期间的消息不会丢，
重新打开时通过 `chat:get-log` 重放。

### 界面

320×140，顶栏 / 消息区 / 输入区三段：

```
● 聊天        思考中…   [⌄] [图钉] [—]
┌─────────────────────────────────────┐
│                       你好啊          │  ← 右对齐粉色 = 我
│ あたし、由比ヶ浜結衣だよ！             │  ← 左对齐灰色 = 角色
└─────────────────────────────────────┘
[🎙] [ 说点什么…（Enter 发送） ] [■] [↑]
```

| 按钮 | 作用 |
|---|---|
| `⌄` / `⌃` | **收起消息区**：窗口 140 → **58**，只剩顶栏 + 输入行 |
| 图钉 | **不自动隐藏**：关掉「失焦 300ms 后收起」 |
| `—` | 隐藏（等同 Esc） |

**收起**只改窗口高度，**底边锚定不动** —— 窗本来就是贴在角色窗口上方的，
所以收起时向下收、展开时向上长，视觉上不会跳。

两个开关是**两件不同的事**，不要混：一个管窗口高度，一个管失焦行为。

### 几个刻意的设计

- **消息区不画「我 / 角色」标签**：靠左右对齐 + 颜色区分说话人。320px 宽的窗里，
  每条消息省下一行文字高度很关键。
- **图标全部用内联 SVG**，不用 emoji —— emoji 在 Windows 上会渲染成彩色字形，
  与 11~12px 的界面字体完全不搭。
- **顶栏用 `-webkit-app-region: drag` 拖动**。这里可以用，是因为聊天窗**没有**需要点击的
  canvas；角色窗口不能用（理由见上面「拖动角色」一节）。
- **改尺寸复用了角色窗口那套已验证的机制**：`resizable:false`（不加 `WS_THICKFRAME`，保住透明）
  \+ `setMinimumSize(1,1)` / `setMaximumSize(0,0)` 解锁后 `setSize` 才生效；
  **绝不调用 `setResizable()`**（会永久破坏透明，electron#51094）。
- **「Connection established」被显式过滤**：后端每次建立连接都会先发一条
  `{"type":"full-text","text":"Connection established"}`（`websocket_handler.py` 的
  `_send_initial_messages`），它不是角色的发言。重连时会再发一次，所以是**每次都过滤**，
  而不是只在首次连接后过滤。

### 已知行为

- **AI 回复按句拆成多个气泡**：后端是**按句**推 `full-text` 的，一轮回复有几句就是几个气泡。
  这是后端行为，聊天窗只做展示。
- **语音输入（麦克风）尚未实测**：`getUserMedia` 在 `http://127.0.0.1` 属安全上下文，
  主进程已用 `session.setPermissionRequestHandler` 放行 `media` 权限，
  采集格式（16kHz + ScriptProcessor 4096）与 `vrm_frontend/app.js` 保持一致，
  但**还没有真正录过一次音**。

---

## 实测验证结果（2026-09-18）

| # | 项 | 结果 |
|---|---|---|
| 1 | 角色背景透明 | ✅ 截图背景为纯黑（alpha 呈现），页面原本的紫色渐变已被覆盖 |
| 2 | 保透明前提下改窗口尺寸 | ✅ 小/大/中三档 `setSize` 全部生效，`isResizable=false` |
| 3 | `focusable:false` 下鼠标事件可达 | ✅ 已收到真实 pointermove |
| 4 | 空白区穿透 / 角色区可交互 | ✅ 见下方日志 |
| 5 | 取景档位 | ✅ 胸像/半身/全身三档，`ok:true` |
| 6 | 后端自动拉起 | ✅ 约 4 秒就绪，无 CMD 黑窗 |
| 7 | 全局快捷键注册 | ✅ `Ctrl+Shift+R` / `Ctrl+Shift+S` 均 ok |
| 8 | **调整大小 + 比例锁** | ✅ 405×591 → 249×363（比值 0.6853 → 0.6859） |
| 9 | **取消不改变窗口** | ✅ `已取消，窗口保持 273x389` |
| 10 | **拖动期间 0 帧渲染** | ✅ `渲染冻结：(frozen)` → `渲染恢复：(resumed)` |
| 11 | **聊天窗复用同一条 WS** | ✅ 出站经 IPC 中继到角色窗口那条连接，AI 正常回复（没有第二条 `/client-ws`） |
| 12 | **聊天窗收发全链路** | ✅ 键入 `hello` → 右侧气泡 → 14s 后 3 条日语回复，状态 `思考中…` → `说话中…` |
| 13 | **消息区收起 / 展开** | ✅ `已收起 → 320x58` / `已展开 → 320x140`，底边锚定，透明未丢 |
| 14 | **握手消息已过滤** | ✅ 聊天记录里不再出现 `Connection established` |
| 15 | 聊天窗显示时机 | ⚠️ `ready-to-show` **不触发**，实际由 `did-finish-load` 兜底显示（114ms） |
| 16 | 麦克风 STT | ❌ **未实测**（见上文「已知行为」） |
| 17 | **托盘切换角色** | ✅ 清单读回 3 项，切换后 radio 随 `set-model-and-conf` 同步（用户实测可切换） |

局部穿透的实测日志：

```
[preload] canvas 已出现，命中探测已挂载
[preload] pointermove 累计 1
[hit] 已确认 mouse move 转发可用（focusable:false 下鼠标事件可达）→ 启用点击穿透
[hit] 鼠标进入角色 → 取消穿透          ← 光标移到角色躯干
[hit] 鼠标离开角色 → 恢复穿透          ← 光标移到上方空白区
```

调整大小模式的实测日志：

```
[resize] 进入调整大小模式，当前 405x591 @ (1135, 204)
[freeze] 渲染冻结：(frozen) — 拖动期间 0 帧
[resize] ✅ 已应用 249x363 @ (1291, 432)      ← 比例 0.6859 ≈ 原 0.6853，没变形
[freeze] 渲染恢复：(resumed)
...
[resize] 已取消，窗口保持 273x389             ← Esc：角色窗口自始至终没动过
[freeze] 渲染恢复：(resumed)
```

聊天窗的实测日志：

```
[chat] 请求显示聊天窗                          ← Ctrl+Shift+Space
[chat] 已显示 (did-finish-load)                ← ready-to-show 没触发，是第二重兜底救的
[chat] 已收起 → 320x58
[chat] 已展开 → 320x140
```

托盘角色菜单的实测日志：

```
[char] 角色清单已载入，共 3 项
[char] 当前角色: mao_pro                       ← 后端连上时先发一条（conf.yaml 的默认值，匹配不到任何选项）
[char] 当前角色: 由比滨结衣                     ← 紧接着的 set-model-and-conf 才是真正的当前角色
```

**仍需你人工体感的项**：

- 拖动角色是否跟手、有无抖动
- 角色边缘（头发、裙摆）进出时穿透切换有无闪烁；若闪，调大 `main.js` 的 `LEAVE_TICKS_TO_DISABLE`
- 在别的软件打字时是否被抢焦点
- 任务管理器里的 RAM / GPU 占用（本版未采集）
- 聊天窗「失焦 300ms 自动隐藏」的手感：会不会在点麦克风弹权限框时被误收起

---

## 已知取舍

- **窗口不是全屏**，而是「角色包围盒」（默认 520×760）。透明窗口每帧要做 alpha 合成，面积越小 GPU 开销越低；代价是角色不能自由漫游到桌面任意角落。
- **穿透有一帧级延迟**：页面 raycast 节流 60ms + IPC，极快的「移入即点击」仍可能穿透一次。这是 `setIgnoreMouseEvents` 整窗生效的固有限制（设计文档 §3.3）。
- **调整大小时看不到实时预览**：拖动期间角色窗口刻意不动（这是 0 帧渲染的前提），确认后才一次性生效。
  用框体 + 尺寸标签 + 原尺寸虚影作为反馈。若之后想要实时预览，可在"每次 pointerup 应用一次"（一次手势一次重绘）。
- **`setResizable()` 在任何情况下都不调用** —— 运行时调用会永久破坏透明（electron#51094）。
- 页面顶部的角色卡/设置按钮、底部输入条被 CSS 隐藏了（桌宠不需要），但它们仍在 DOM 里。
- 对话框气泡去掉了 `backdrop-filter` 毛玻璃（透明窗口里它要合成 WebGL 输出，是常驻 GPU 开销）。
  想要毛玻璃，把 `pet-overlay.css` 里那两行改回 `blur(20px)` 即可。
- 拖动角色过程中会暂时禁用穿透切换，避免拖动被中途打断。
- **透明窗口的 `ready-to-show` 不触发**（角色窗与聊天窗都一样）。因此两个窗口都靠
  `did-finish-load` 显示，聊天窗另外加了 2.5s 定时兜底。用 `show:false` + `ready-to-show` 那套
  常规写法在这里会得到一个**永远不出现的窗口**。

---

## 目录

```
desktop/
├── package.json              electron 依赖与启动脚本
├── main.js                   窗口 / 托盘 / 子进程监管 / 尺寸模式 / 持久化 / 快捷键
├── preload.js                拖动意图判定 + 角色命中探测（读 canvas.style.cursor）
├── pet-overlay.css           注入角色窗口的透明化与气泡样式
├── resize-frame.html         独立拉伸框 UI（比例锁 + 确认/取消）
├── resize-frame-preload.js   拉伸框的 IPC 桥
├── chat.html                 聊天悬浮窗 UI（顶栏 / 消息区 / 输入区，可收起）
├── chat-preload.js           聊天窗的 IPC 桥（收发都中继给角色窗口那条 WS）
├── settings.html             设置窗口
├── settings-preload.js       设置窗口的 IPC 桥
└── README.md
```
