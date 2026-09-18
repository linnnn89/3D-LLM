# 无框窗口 UI 工程规范 — 3D AI 桌宠

> 日期：2026-09-18
> 配套文档：`desktop_pet_feasibility_20260918.md`（架构研究 / 可行性分析）
> 范围：**纯设计，未改动任何代码**
> 标注：`[代码证据]` 本仓库 · `[官方文档]` 官方文档 · `[社区实践]` 开源项目/issue · `[推测]` 未经实测

---

## 0. 三条会直接决定架构的硬限制（先看这个）

我先查证了三件事，它们推翻了"桌面窗口就是一个可以随意拉扯的容器"这个直觉。

### 限制 1：❌ **Windows 上透明窗口不可拉伸**

- Electron 官方旧文档明写："Transparent windows are not resizable. Setting `resizable` to true may make a transparent window stop working on some platforms." `[官方文档]`
- 至今仍是活跃 issue：**electron#49173** "Can not resize frameless, transparent window even if `resizable: true`"。`[社区实践]`
- 根因已在 PR #51175 中说明：当窗口可拉伸时，`HWNDMessageHandler` 会加 `WS_THICKFRAME` 样式，而 **`WS_THICKFRAME` 与分层（半透明）窗口不兼容，会直接摧毁透明效果**。`[社区实践]`

> **推论：不要靠"改窗口尺寸"来缩放角色。** 这是本设计的第一原则（§1）的由来。
>
> ⚠️ **后续修正**：本限制的根因是 `WS_THICKFRAME` 与分层窗口不兼容，而阻断程序化改尺寸的其实是 **min/max 被锁死**——两者独立。因此存在"保透明同时可程序化改尺寸"的修复可能，详见 **§11.1**。§1 第一原则仍然成立（视觉缩放本就不该动窗口），但 §8 的"必须销毁重建"结论已被弱化。

### 限制 2：❌ `app-region: drag` 会吞掉区域内**所有**指针事件

- 官方原文："draggable areas **ignore all pointer events**. For example, a button element that overlaps a draggable region will not emit mouse clicks or mouse enter/exit events within that overlapping area." `[官方文档]`
- 且有已知不生效的 bug：**electron#40985**（Windows 11 23H2 上 `-webkit-app-region: drag` 失效）。`[社区实践]`

> **推论：不能把"拖动角色"直接做成 `app-region: drag`，否则"点击角色"就废了。**

### 限制 3：⚠️ `setIgnoreMouseEvents(true, {forward:true})` **只转发 mouse move，不转发 click**

- 官方原文："Ignoring mouse messages makes the web contents oblivious to mouse movement... an optional parameter can be used to **forward mouse move messages** to the web page, allowing events such as `mouseleave` to be emitted." `[官方文档]`

> **推论（这是最容易踩的坑）：窗口处于穿透状态时，用户点在角色上，渲染器收不到这个 click —— 点击会直接穿到桌面上。** 因此**必须用 hover 提前切换状态**，不能等 click 再判断。详见 §3。

**另外两条次要限制：**
- `setAlwaysOnTop(true, 'screen-saver')` **盖不过 Windows 任务栏**（electron#38020，多版本复现）。`[社区实践]`
- `win.setShape(rects)`（Windows 实验性）虽然能定义交互区域，但官方说明"**区域外不绘制像素**"——与 Godot 的 `SetWindowRgn` 是同一个机制，会裁掉渲染。`[官方文档]` → **不用它做穿透。**

---

## 1. 第一原则：窗口是固定画布，不是可变容器

```
        ❌ 错误模型                        ✅ 正确模型
   ┌──────────────────┐            ┌──────────────────┐
   │  窗口可拉伸        │            │  窗口尺寸固定      │
   │  角色随窗口缩放    │            │  ↓               │
   │  ↓               │            │  canvas 内部缩放   │
   │  → 透明失效 💥    │            │  → 透明始终有效 ✅  │
   └──────────────────┘            └──────────────────┘
```

把用户感知到的三种"缩放"拆开，分别用不同机制实现：

| 用户操作 | 用户以为在做什么 | 实际该做什么 | 成本 |
|---|---|---|---|
| 滚轮滚一下 | 角色变大变小 | **canvas 内相机 dolly / 模型 scale** | 零 |
| 拖窗口边框 | 拉伸窗口 | **不提供**（或改尺寸档位 → 销毁重建窗口） | 高 |
| 换显示器 / 改系统缩放 | — | 监听 `display-metrics-changed` 重算位置 | 低 |

**现有代码正好可以复用**：`app.js` 里已有 OrbitControls，`minDistance 0.5 / maxDistance 3.5`，滚轮缩放已经能用了。`[代码证据] vrm_frontend/app.js:155-161`
桌宠要做的事只有一件：**把 OrbitControls 的"平移"禁掉（角色不能被拖出画布），把"旋转"限制在合理角度，只保留 dolly**。

> 💡 **顺带解决 DPI 问题**：窗口用固定物理尺寸，角色大小由 canvas 内部决定。系统缩放 125%/150% 时，只要窗口以 DIP 为单位固定、canvas 按 `devicePixelRatio` 渲染，视觉大小就是可预期的，不会出现"高 DPI 下角色糊掉"。

---

## 2. 窗口职责矩阵：一窗一职责

| 窗口 | 职责 | `focusable` | 鼠标穿透 | 边框 | 尺寸 | 生命周期 |
|---|---|---|---|---|---|---|
| **Avatar** | 只渲染角色 + 命中检测 | ❌ **false** | 动态切换 | 无 | 固定 | 常驻 |
| **Bubble**（可选） | 对话气泡 / 字幕 | ❌ false | 永久穿透 | 无 | 固定，跟随角色 | 常驻 |
| **Chat** | **所有键盘输入** | ✅ true | 否 | 无框但可拖 | 固定 | 常驻（默认隐藏） |
| **Settings** | 配置 | ✅ true | 否 | **保留系统边框** | 可拉伸 | 按需创建/销毁 |
| **Tray 菜单** | 全局入口 | — | — | 原生 | — | 常驻 |

### 2.1 最重要的决策：Avatar 窗口 `focusable: false`

一个置顶的透明窗口如果会抢焦点，用户每次切回来打字都会被打断——这是桌宠类软件最招人烦的 bug。

```js
new BrowserWindow({
  transparent: true, frame: false, hasShadow: false,
  focusable: false,        // ★ 核心：永不抢焦点
  skipTaskbar: true,
  alwaysOnTop: true,
  resizable: false,        // ★ 反正透明窗口也不能拉伸
  show: false              // 等 ready-to-show，避免闪白
})
```

Windows 上 `focusable:false` 对应 `WS_EX_NOACTIVATE`：点击不会激活窗口，但鼠标消息仍会送达渲染器。`[推测]` ← **需要冒烟原型实测确认**（这是本设计里最关键的一条待验证假设）。

### 2.2 与之前方案的冲突修正 ⚠️

前一份文档的 **Phase 4-A 建议"聊天输入框叠加在 Avatar 窗口内"**，与本节的 `focusable:false` **直接冲突**——不可聚焦的窗口里没法打字。

两种解法，选一个：

| 方案 | 做法 | 评价 |
|---|---|---|
| **A. 临时提权** | 显示输入框时 `win.setFocusable(true)` + `win.focus()`，隐藏时恢复 | 改动小，但"焦点状态"是有状态的，容易出竞态 bug |
| **B. 独立 Chat 窗口**（推荐） | 输入永远在独立窗口里，Avatar 窗口保持不可聚焦 | 职责清晰，无竞态；代价是 Phase 4 要提前做分窗 |

> **修正建议：直接做 B。** 因为"输入框叠加"本来也要处理"点到输入框时不能穿透"的问题，工程量并不比开一个独立窗口小，而 B 的架构干净得多。

---

## 3. 鼠标穿透：唯一可行的实现模式

### 3.1 为什么不能等 click

```
窗口穿透时用户点击角色：
   mousedown → 穿透到桌面 → 桌面图标被选中（用户看到"我点到了后面的东西"）
   渲染器：什么也没收到 ❌
```

### 3.2 正确模式：hover 预切换

```
每次 mousemove（forward:true 保证能收到）
   │
   ├─ raycast 命中 角色 / 气泡 / 可点 UI？
   │     ├─ 是 → IPC → win.setIgnoreMouseEvents(false)   ← 立刻变为可交互
   │     │        （此后 click / drag 正常到达渲染器）
   │     └─ 否 → IPC → win.setIgnoreMouseEvents(true, {forward:true})
   │
   └─ 状态未变化时不发 IPC（去抖，避免每帧 IPC）
```

这正是 Electron **官方示例**的做法（在元素上监听 `mouseenter` / `mouseleave` 再切 `setIgnoreMouseEvents`）。`[官方文档]`
注意官方示例把 `forward: true` 用在了 mouseenter（进入穿透区）一侧——实际用哪种，取决于哪一侧需要 hover 检测，冒烟时两种都试。

### 3.3 已知代价与缓解

| 问题 | 缓解 |
|---|---|
| 状态切换有一帧延迟，**快速点击可能仍穿透** | 把窗口做成"角色包围盒"而非全屏，缩小需要切换的面积；或加一个静态粗粒度兜底区域 |
| 每秒数十次 IPC | 只在状态翻转时发，不在每帧发 |
| 光标在角色半透明边缘（头发、裙摆）来回抖 | raycast 用**宽松的碰撞体**（胶囊/盒），不要用精确网格 |

### 3.4 明确不用的方案

- ❌ `win.setShape(rects)` —— 官方说明区域外**不绘制**，会裁掉角色（同 Godot `SetWindowRgn` 的坑）。`[官方文档]`
- ❌ 全屏透明窗口 + 全窗穿透 —— 合成面积最大、切换最频繁。

---

## 4. 拖动：与"点击"的冲突怎么解

### 4.1 不能用 `app-region: drag`（理由见限制 2）

### 4.2 用"意图判定"：位移阈值

```
pointerdown on avatar
   ├─ 记录 startPos / startTime / 当前窗口位置
   │
pointermove
   ├─ |delta| < 4px  → 什么都不做（还在"点击"的可能性里）
   └─ |delta| ≥ 4px  → 进入 DRAGGING：
                         IPC → main → win.setPosition(
                           cursorScreenPt - grabOffset
                         )
   │
pointerup
   ├─ 曾进入 DRAGGING → 结束拖动，**不触发**点击反应
   └─ 从未进入      → 触发点击反应
```

**现有代码已经实现了这套判定**，只是目标不是窗口：
> `app.js:1091-1098` — `pointerdown/pointerup` 用位移 `<8px` 且 `<500ms` 区分"纯点击"与 OrbitControls 拖拽。`[代码证据]`

改造量很小：把"驱动 OrbitControls"换成"IPC 移动窗口"。建议阈值统一为 4~8px（太灵敏会误判为拖动，太迟钝会觉得拖不动）。

### 4.3 拖动时用哪个坐标

- 光标屏幕坐标：main 进程 `screen.getCursorScreenPoint()`（**不要**用渲染器的 `event.screenX/Y`，多屏/DPI 下不可靠）
- 抓取偏移：按下时记录 `cursorScreenPt - win.getPosition()`，拖动过程中保持这个偏移，角色就不会"跳"到光标下

### 4.4 附加行为（低成本、高体验）

| 行为 | 实现 |
|---|---|
| 拖到屏幕边缘吸附 | `screen.getDisplayNearestPoint()` 取 workArea，松手时若距离边缘 < N px 则贴边 |
| 跨显示器拖动 | 直接可用（`setPosition` 是虚拟桌面坐标）；注意混合 DPI 时重新计算尺寸 |
| 松手后落回 | 记录起始位置，触发"掉落"动画后 `setPosition` 回原位 |

---

## 5. z-order 分层：不是布尔值，是模式

用户问"pin 在最前台还是放下层"——答案是**两者都要，做成可配置模式**，但**优先级不同**。

| 模式 | 实现 | 可交互 | 盖得住全屏应用 | 稳定性 | 建议 |
|---|---|---|---|---|---|
| **Overlay（默认）** | `setAlwaysOnTop(true, 'screen-saver')` | ✅ | ❌（盖不过任务栏） | 高 | ✅ **第一版只做这个** |
| **Bottom** | 不置顶，普通窗口 | ✅ | N/A | 高 | ✅ 顺手提供 |
| **Auto** | 检测前台窗口是否全屏 → 动态隐藏/暂停 | ✅ | 部分 | 中 | ✅ Phase 6 |
| **Desktop**（WorkerW 桌面层） | `SetParent` 注入 `WorkerW`/`Progman` | ❌ **基本不能** | N/A | **低** | ❌ **不做，交给 Lively** |

### 5.1 为什么不做 WorkerW 桌面层

WorkerW / Progman 注入是真实存在的技术（Wallpaper Engine、DeskX、Animated-Desktop-Wallpapers-Helper 都这么做）`[社区实践]`，但对本项目的收益极低：

1. **注入后基本无法接收点击**——桌面图标层在上面，而且这类窗口通常无法正常交互。`[社区实践]`
2. **版本脆弱**：Win11 24H2 切换壁纸/主题会导致 WorkerW 窗口关闭。`[社区实践]`
3. **需要原生代码**（P/Invoke `EnumWindows` + `FindWindowEx` + `SetParent`），破坏了"只需 JS + Python"的简洁性。

> ✅ **这恰好解释了 Lively 的正确位置**：Lively 就是一个成熟的 WorkerW 注入方案。**需要"桌面层"时不要自己写，直接让 Lively 加载 `/vrm/`。** 自研 Runtime 只负责 Overlay（置顶桌宠）这一种模式。这也和前一份文档"Lively 是可选第二 Runtime"的结论一致。

### 5.2 置顶的正确参数

```js
win.setAlwaysOnTop(true, 'screen-saver')  // level 最高
win.setSkipTaskbar(true)                  // 不占任务栏
```
> ⚠️ 已知：`screen-saver` **不会**让窗口盖过 Windows 任务栏（electron#38020）。`[社区实践]`
> 对桌宠来说这**其实是对的**——角色不应该挡住任务栏。不要为此去做全屏 + 强行 topmost 的 hack。

### 5.3 全屏应用检测（Phase 6）

```
轮询（1~2s 一次，不要每帧）：
  hwnd = GetForegroundWindow()
  rect = DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS)   // 注意用 DWM 版本，GetWindowRect 含不可见边框
  if rect ≈ 某个 display.bounds  →  判定为全屏
      → 行为：不隐藏窗口，而是 { 暂停 rAF + setOpacity(0) }
      → 退出全屏 → 恢复
```
用 DWM 版本取 bounds 的原因：`GetWindowRect` 会包含 Aero 的不可见阴影边框，导致全屏判定失败。`[官方文档] DwmGetWindowAttribute`

> Lively 对**应用壁纸**做不了这件事（官方承认 bug），对网页壁纸可以做。`[官方文档]` 这是自研 Runtime 相对 Lively 的一个实际优势。

---

## 6. 各类 UI 的实现方式总表

| UI 元素 | 载体 | 触发方式 | 关键注意点 |
|---|---|---|---|
| **角色本体** | Avatar 窗口 canvas | 常驻 | hover 预切换穿透 |
| **对话气泡 / 字幕** | Avatar 窗口内 DOM（第一版） | `full-text` 消息 | 必须约束在窗口包围盒内，否则要改独立窗口 |
| **输入框** | **独立 Chat 窗口** | — | 见 §2.2 修正 |
| **右键菜单** | Electron `Menu.popup()` **原生菜单** | 渲染器 `contextmenu` → IPC | ❌ 不要用 DOM 画菜单：无框窗口边界会裁切，且不处理屏幕边缘翻转 |
| **托盘菜单** | `Tray` + `Menu` | 图标左/右键 | 无主界面应用的唯一入口 |
| **设置窗口** | 普通**有边框**窗口 | 托盘 / 菜单 / 快捷键 | ❌ 不要为了"统一风格"也做成无框——有框才能拉伸/最大化 |
| **系统通知** | `new Notification()` | 主动行为 | 走系统通知中心，不占窗口 |
| **Toast / 提示** | 独立小窗口 | 内部事件 | `setIgnoreMouseEvents(true)` 永久穿透 + `focusable:false` |

### 6.1 一个反直觉但重要的建议

**无框只用在"角色"和"气泡"上，其余一律用有框窗口。**

理由：无框窗口丢掉了所有系统提供的免费能力——拉伸、最大化、边缘吸附、系统菜单、DPI 缩放、无障碍。为了"看起来统一"而把设置页做成无框，是在用大量工程成本换一个用户根本注意不到的视觉细节。

### 6.2 右键菜单为什么必须用原生

`Menu.popup()` 由系统绘制，自动处理：屏幕边缘自动翻转、DPI 缩放、多屏定位、键盘导航、无障碍。自己用 DOM 画菜单要重新实现这五件事，而且在透明无框窗口里还会被窗口边界裁切。

---

## 7. 触发方式矩阵

| 触发 | 机制 | 备注 |
|---|---|---|
| 单击角色 | 渲染器 raycast → IPC | 已有 `CLICK_REACTIONS` `[代码证据] app.js:1037-1079` |
| 双击角色 | 同上 + 时间计数 | 与单击需要 250~300ms 延迟区分 |
| 右键角色 | `contextmenu` → IPC → `Menu.popup()` | 当前**完全没有** contextmenu 监听，需新增 |
| **全局快捷键** | `globalShortcut.register('Ctrl+Shift+Space')` | 需提供改键 UI；注册失败（被占用）必须给反馈 |
| 托盘图标 | 左键→显示/隐藏，右键→菜单 | 现状完全没有托盘 |
| **AI 主动** | 后端推 `character-event` → 渲染器弹气泡 | 依赖前一份文档的协议缺口 2 |
| 鼠标靠近 | `pointermove` → LookAt 跟随 | 注意：设置里的 `#vrm-lookat-mode` **当前未接线** `[代码证据]` |
| 拖拽到边缘 | `setPosition` 吸附 | |

> ⚠️ **全局快捷键的坑**：`globalShortcut` 是系统级独占的，与其他软件冲突时静默失败。必须：① `register()` 返回 false 时提示；② 设置里可改；③ 提供备用触发（托盘）。

---

## 8. 窗口重建流程（唯一需要改尺寸的场景）

> ⚠️ **前置修正**：本节基于"透明窗口完全无法改尺寸"这一较强假设。§11.1 找到了可能的修复路径（`resizable:false` 保透明 + 重置 min/max 后 `setSize`）。**若 §11.1 实测成立，本节流程可以不用**。在实测结果出来之前，本节作为兜底方案保留。

既然透明窗口不能 resize，任何**真实**的尺寸变化（如角色尺寸档位 S/M/L 切换、多显示器 DPI 变化）都必须走"重建"：

```
1. newWin = new BrowserWindow({...新尺寸...})   // show: false
2. newWin.once('ready-to-show', () => {
       newWin.show();
       oldWin.destroy();                        // 不能让两个都可见 → 会闪
   })
3. 把状态传过去（当前角色 / 表情 / 位置 / WS 由 Chat 或 main 持有，不重连）
```

**关键**：WS 连接**不能**随窗口重建而重连（会导致后端克隆出新的 ServiceContext，history_uid 分叉）。
→ 更强的主张：**把 WS 连接放在 main 进程**（Node 侧用 `ws` 库），Avatar/Chat 只是 UI 消费者。这样窗口重建、崩溃恢复都不影响会话状态。

> 📌 这是本设计里唯一一处建议**偏离现状**的架构改动，值得单独讨论。现状是 WS 在渲染器里（`app.js:1118`）。`[代码证据]`

---

## 9. 待实测清单（冒烟原型要回答的问题）

下面每一条都**不能靠推理确定**，必须跑起来看。按重要性排序：

> ⚠️ **本表已被 §11.6 更新**：#1 已通过社区证据验证（`focusable:false` → `WS_EX_NOACTIVATE`，鼠标事件正常到达），并新增两项关于"透明窗口能否程序化改尺寸"的测试。以 §11.6 为准。

| # | 问题 | 为什么重要 | 怎么测 |
|---|---|---|---|
| 1 | `focusable:false` 的透明窗口，鼠标事件还到得了渲染器吗？ | 决定 §2.1 的核心决策是否成立 | 打印 renderer 的 `pointermove` 计数 |
| 2 | hover 预切换的实际延迟有多大？快速点击会不会漏？ | 决定穿透方案是否可用 | 角色上连点 20 次，统计漏判率 |
| 3 | 透明窗口 `setPosition()` 拖动流畅吗？有无撕裂/抖动？ | 决定拖动体验 | 拖 10 秒，肉眼看 + 记录帧率 |
| 4 | `setIgnoreMouseEvents` 切换频率对 CPU 的影响 | 决定去抖策略 | 任务管理器观察 |
| 5 | 角色包围盒窗口（480×720）的 GPU 占用 vs 全屏 | 决定第一版窗口尺寸策略 | GPU-Z / 任务管理器 |
| 6 | three.js 在 Electron 里 WebGL2 是否正常、有无颜色/透明度差异 | 决定渲染层是否真的零改动 | 与浏览器截图逐像素对比 |
| 7 | 40s 冷启动里，Electron 何时能显示"加载中" | 决定启动体验设计 | 打时间戳 |
| 8 | 系统缩放 125%/150% 下角色清晰度 | 决定 canvas 分辨率策略 | 改系统缩放对比 |

---

## 10. 修正与补充：对前一份文档的变更

| # | 前文档内容 | 本设计修正 | 原因 |
|---|---|---|---|
| 1 | Phase 3「拖动角色移动窗口」未说明实现 | 补：位移阈值 + `setPosition`，**禁用 `app-region: drag`** | 限制 2 |
| 2 | Phase 4-A「聊天 UI 叠加在 Avatar 窗口内」（推荐） | **改为推荐 Phase 4-B（独立 Chat 窗口）** | 与 `focusable:false` 冲突（§2.2） |
| 3 | 「缩放角色」笼统写为"改尺寸档位" | 明确区分：**视觉缩放 = canvas dolly（零成本）；窗口缩放 = 销毁重建（避免）** | 限制 1 |
| 4 | desktop pet 分层未细化 | 补三模式；**明确不做 WorkerW 桌面层，交给 Lively** | §5.1 |
| 5 | `setShape` 作为局部穿透候选方案 | **降级为不用** | 官方：区域外不绘制 |
| 6 | WS 连接位置未讨论 | 提出把 WS 移到 main 进程 | §8，避免窗口重建导致会话分叉 |

---

## 11. 修复方案汇总（对 §0 各限制的处置）

| # | 限制 | 能修吗 | 方案 | 代价 |
|---|---|---|---|---|
| 1 | 透明窗口不可拉伸 | ✅ **已验证可行**（见 §12.1） | `resizable:false` 保透明 + 重置 min/max 后 `setSize` | 无 |
| 2 | `app-region: drag` 吞指针事件 | ✅ | 不用它，改手动 IPC 拖动 | 无 |
| 3 | `forward:true` 不转发 click | ✅ | hover 预切换 + 200~300ms 宽限期 | 一帧延迟 |
| 4 | `screen-saver` 盖不过任务栏 | ❌ 不建议 | — | 本就不该盖 |
| 5 | `focusable:false` 鼠标事件 | ✅ **已验证可用**（见 §12.2） | 不用改 | 无 |
| 6 | WorkerW 桌面层不可交互 | ❌ 无干净解 | 交给 Lively | 放弃自研 |
| 7 | WS 在渲染器导致重建分叉 | ✅ | WS 移到 main 进程（§8） | 中等重构 |
| 8 | `playback-complete` 无超时 | ✅ | 加 timeout 兜底 | 无 |

### 11.1 限制 1 的修复假设（✅ 已于 §12.1 实测验证）

Electron 在 Windows 上实现 `resizable:false` 的机制（issue #31233 / #42258）：
> 先把窗口的 **min/max size 设为当前尺寸**，再调 `SetCanResize` **移除 `WS_THICKFRAME`**。窗口移动或还原时 `WM_GETMINMAXINFO` 按之前设的 min/max 卡住尺寸。

**推论**：破坏透明的是 `WS_THICKFRAME`（与"可拉伸"标志绑定），而阻断程序化改尺寸的是 **min/max 被锁死** —— 这是两件独立的事。因此可能存在如下修复：

```js
const win = new BrowserWindow({
  transparent: true, frame: false,
  resizable: false,     // 保住透明：不添加 WS_THICKFRAME
  thickFrame: false,    // 双保险；顺带移除阴影与窗口动画
  hasShadow: false
})
win.setMinimumSize(1, 1)   // 解锁 min/max
win.setMaximumSize(0, 0)   // 0 = 无限制
win.setSize(newW, newH)    // 假设：可直接改尺寸且透明不丢
```

若成立，则 §8 的"销毁重建窗口"流程可以省掉，甚至能做平滑缩放。

> 🚨 **操作纪律**：`setResizable()` **绝对不要在运行时调用**。issue #51094 记录 `setResizable(true→false)` 之后透明**永久丢失**。构建时定死，之后不碰。
> `thickFrame:false` 在部分版本另有一个"无法通过拖边拉伸"的回归（#48576），对桌宠无影响。

### 11.2 限制 5 的验证结论（原"待实测"已可降级）

Chromium 在 Windows 上把 `focusable:false` 映射为 **`WS_EX_NOACTIVATE`**：
- 点击 / 显示 / 移动**都无法激活**该窗口 → 底层应用永不失焦 ✅
- Windows 将其**排除出 Alt+Tab 列表** ✅
- **鼠标事件正常到达**（点击有效，只是不触发激活）✅

→ 这是"不抢焦点 + 不进 Alt+Tab + 可点击"的组合，正是桌宠需要的。

> ⚠️ 后续坑（issue #21459）：`focusable` **由 false 改回 true 后，focus 事件不再触发**。
> → 这是**放弃"输入时临时提权"（§2.2 方案 A）、改用独立 Chat 窗口（方案 B）的又一条理由**。

### 11.3 限制 3 的三个层次

| 层次 | 做法 | 效果 | 代价 |
|---|---|---|---|
| 基础 | hover 预切换 `setIgnoreMouseEvents` | 解决 90% | 一帧延迟 |
| 增强 | 命中后保持可交互 200~300ms **宽限期** | 消除抖动与漏判 | 无 |
| 根治 | `setShape([rects])` 设"永不穿透"包围盒 | 彻底消除漏判 | 见下 |
| 终极 | C++ addon hook `WM_NCHITTEST`，物理像素 per-pixel hit test | 完美 | 需编译原生模块 |

**❌ 一条堵死的路**：不能用 Electron 的 `win.hookWindowMessage()` hook `WM_NCHITTEST`。官方明确拒绝（issue #8762）：*"处理 `hookWindowMessage` 回调的返回值再传给系统是有问题的，因为同一消息可注册多个回调"*。
→ `hookWindowMessage` **只能被动通知，不能修改消息返回值**。要做 per-pixel 只能写 native addon（社区项目 winpane 即如此：维护物理像素矩形表 + `WM_NCHITTEST` 反查），**对第一版属过度设计**。

**`setShape` 的代价**（官方："区域外不绘制像素"）：
- 盒子必须**同时**容纳角色与气泡，否则气泡被裁；
- 盒内透明角落会挡住桌面点击；
- 角色阴影/粒子若超出盒子会被切掉。

→ 折中：盒子比角色大一圈（容纳弹簧骨骼飘动的头发），不要贴紧模型。

### 11.4 限制 6 的替代方案修正

「桌面层 + 可交互」在 **Lively 的网页壁纸**里是**成立的**：Lively 网页壁纸**默认转发鼠标输入**（键盘需在设置中手动开启）。
→ 这把 Lively 的定位从"劣化版 Runtime"提升为：**"桌面层"这个模式的唯一现成实现**。自研 Runtime 只负责 Overlay，桌面层完全交给 Lively。

### 11.5 限制 7 / 8 的代码级修复

- **WS 移到 main 进程**：用 Node 的 `ws` 库建立唯一连接，Avatar/Chat 仅作 UI 消费者。窗口重建与渲染器崩溃不再影响会话状态，也不会让后端克隆出新的 `ServiceContext`。现状 WS 在 `vrm_frontend/app.js:1118`。
- **`playback-complete` 超时**：`src/open_llm_vtuber/conversations/conversation_utils.py:180-182` 加超时兜底。独立于桌宠，可随时先修。

### 11.6 §9 待实测清单的更新

| # | 原问题 | 状态 |
|---|---|---|
| 1 | `focusable:false` 下鼠标事件是否到达 | ✅ **已验证**（见 §11.2），降级 |
| — | **`resizable:false` + 重置 min/max 后能否 `setSize` 且保住透明** | 🆕 **新增，优先级最高**（见 §11.1） |
| — | `thickFrame:false` 下透明是否正常 | 🆕 新增 |
| 2~8 | 同 §9 其余各项 | 待实测 |

---

## 12. 初版实测结果（2026-09-18，Electron 44.4.2 / Windows）

> 实测件：`desktop/`（初版 Electron 壳）。环境：显示器缩放 125%，Electron 44.4.2 / Chromium 152。

### 12.1 ✅ §11.1 假设成立：保透明 + 程序化改尺寸可同时做到

```
[size] 窗口创建：已重置 min/max（setResizable 未被调用）
[resize-test] small  请求 340x500  | setSize 前 520x760  | 后 340x500  | ✅ 生效 | isResizable=false
[resize-test] large  请求 700x1000 | setSize 前 340x500  | 后 700x1000 | ✅ 生效 | isResizable=false
[resize-test] medium 请求 520x760  | setSize 前 700x1000 | 后 520x760  | ✅ 生效 | isResizable=false
```

**结论**：
- `resizable: false`（不添加 `WS_THICKFRAME`）确实保住了透明；
- `setMinimumSize(1,1)` + `setMaximumSize(0,0)` 确实解开了 `WM_GETMINMAXINFO` 的尺寸锁；
- 因此 **§8「销毁重建窗口」流程可以废弃**，窗口尺寸可以直接改，甚至可做平滑缩放。
- 三者叠加后仍在运行中保持 `isResizable=false`，没有触碰 `setResizable()`。

### 12.2 ✅ §11.2 已验证：`focusable:false` 下鼠标事件可达

日志实测：
```
[renderer] 已收到首个 pointermove —— focusable:false 下鼠标事件可达 ✅
```
窗口确实以 `WS_EX_NOACTIVATE` 创建，但渲染器正常收到指针事件。§2.1 的核心决策成立。

### 12.3 新发现 A：原前端的默认取景是「胸像」，对桌宠偏近

`vrm_frontend/app.js:137-138`：`PerspectiveCamera(30, ...)` + `position(0, 1.36, 1.25)`、`target(0, 1.30, 0)`。

```
可视世界高度 = 2 × d × tan(FOV/2) = 2 × 1.25 × tan(15°) ≈ 0.67 单位
```
VRM 全身约 1.5~1.7 单位 → **默认只显示约胸到头顶**。这对网页聊天是合理的（肖像构图），对桌宠偏近。

要看到全身需要距离 ≈ 3.2（可视高度 ≈ 1.72），而 `OrbitControls.maxDistance = 3.5` 刚好放得下。

**已验证的非侵入式解法**：往 canvas 派发合成的 `WheelEvent`，交给页面已有的 OrbitControls 处理 —— 效果等同于用户滚动滚轮。实测 `{"ok":true}`，全身取景成功。
每档步数由 `N = ln(D / 0.5) / ln(1.0526)` 推出（先滚到 `minDistance` 建立基线再滚出）：
`bust D=1.25→18 格`、`half D=2.20→28 格`、`full D=3.20→38 格`。

### 12.4 新发现 B：相机在模块作用域内，外部拿不到 → 这是一处需要决策的代码改动

`vrm_frontend/app.js` 是 ES module，`camera` / `controls` / `currentVrm` 都是模块级变量，**没有挂到 `window`**。
后果：
- 取景只能靠"合成滚轮事件"间接控制（可用，但不可精确设值）；
- **「局部点击穿透」无法实现** —— 它需要 raycaster 与场景，而场景外部访问不到。

→ **建议（待确认，尚未改动）**：在 `vrm_frontend/app.js` 里加一行控制面导出，例如：

```js
// app.js 末尾
window.__vtuber = {
  get camera() { return camera },
  get controls() { return controls },
  get vrm() { return currentVrm },
  setEmotion, playMotion   // 复用已有函数
}
```

- **位置**：`vrm_frontend/app.js` 模块末尾
- **改动内容**：仅新增一个只读控制面对象，不修改任何既有逻辑
- **原因**：① 精确取景；② 为局部点击穿透提供 raycast 能力；③ 为后续 `character-event` 协议提供表现层入口
- **验证方法**：在 Electron 里 `executeJavaScript('window.__vtuber.vrm ? "ok" : "missing"')` 返回 `ok`；然后据此实现 hover raycast 并观察穿透是否正确

### 12.5 实测环境与工程注意事项

| 项 | 实测值 / 说明 |
|---|---|
| Electron 版本 | 44.4.2（Chromium 152 / Node 24.21.0） |
| 显示器缩放 | 125%。窗口 DIP→物理像素换算正常：520×760 DIP → 650×950 物理 |
| 后端冷启动 | **约 4 秒**（`[backend]` 就绪探测：已就绪），远低于 `app/launcher.py` 预留的 40s |
| 自动拉起后端 | ✅ 成功，无 CMD 黑窗（`windowsHide: true`） |
| 无框透明 | ✅ 窗口截图背景为纯黑（alpha 呈现），而页面 CSS 原本是紫色渐变 → 证明 `background: transparent` 注入生效 |
| 不在任务栏 | ✅ 任务栏无该窗口条目 |
| 始终置顶 | ✅ 浮于前台应用之上 |
| ⚠️ npm 安装坑 | `npm install electron` 的 postinstall **没有下载二进制**（`node_modules/electron/dist/` 缺失）。需手动补跑 `node node_modules/electron/install.js` |

### 12.6 ✅ 局部点击穿透已实现并实测通过（含一处关键发现）

**问题**：窗口是「角色包围盒」，整窗可交互会让盒内大片透明区域吃掉点击 —— 用户实测反馈
「上方全部都没法穿透进去做后面的窗口点击」。

**关键发现**：**不需要修改 `vrm_frontend` 也能拿到精确命中结果。**

`vrm_frontend/app.js:1143-1155` 每次 `pointermove` 已经在对 VRM 网格做 raycast，并把结果写进
**canvas 的内联样式**：

```js
renderer.domElement.style.cursor = hits.length > 0 ? 'pointer' : 'default';
```

→ 读 `canvas.style.cursor` 即等价于拿到了逐像素命中结果。这比 `setShape` 矩形近似精确得多，
且完全不需要 §12.4 提议的控制面导出。

**实现链路**：

```
页面 pointermove → raycast → canvas.style.cursor
        │
        ├─ preload：MutationObserver（即时）+ 100ms 轮询（兜底）
        │      → IPC 'avatar:hover-state'
        ▼
   main：命中角色 → setIgnoreMouseEvents(false)
         未命中   → setIgnoreMouseEvents(true, { forward: true })
```

**实测日志**：
```
[preload] canvas 已出现，命中探测已挂载
[preload] pointermove 累计 1
[hit] 已确认 mouse move 转发可用（focusable:false 下鼠标事件可达）→ 启用点击穿透
[hit] 鼠标进入角色 → 取消穿透
[hit] 鼠标离开角色 → 恢复穿透
```

**由此确认的两条工程约束**：

1. **`forward: true` 是强制的**，且必须**先验证它真的生效**再开启穿透。
   若穿透后 mousemove 不再送达，页面的 raycast 永不再跑 → 收不到「鼠标进入角色」信号 → 死锁。
   本版的做法：先整窗可交互，直到收到**第一个真实 `pointermove`** 才允许进入穿透态。
   最坏情况只是退回旧行为，不会把角色点死。
2. **绝不能在 Electron 侧给 canvas 写 cursor 样式** —— 那会破坏唯一的命中信号来源。

> 📌 **§12.4 的控制面导出因此不再是「必须」**：取景可用合成滚轮事件，命中可用 cursor 反读。
> 它仍然有 value（精确设置相机距离、后续 `character-event` 的表现层入口），但优先级下降为「可选优化」。

### 12.7 仍未实测的项

- 穿透切换的实际观感：角色边缘（头发、裙摆）进出时是否闪烁；极快「移入即点击」的漏判率
- GPU / RAM / VRAM 占用（本版未采集，需任务管理器或 PresentMon）
- 系统缩放 125% 之外（150% / 混合 DPI 多屏）下的清晰度与坐标换算
- 拖动流畅度（需人工体感）
- 聊天窗的**麦克风语音输入**：`getUserMedia` 通路已按 §5 的 Phase 5 放行权限，但还没真正录过一次音

### 12.8 工程坑位备忘（自动化测试与坐标换算）

用脚本模拟鼠标验证穿透时踩到的坑，值得记下：

- **`SetCursorPos` 不保证产生鼠标消息**，自动化测试应使用 `mouse_event` / `SendInput` 注入真实输入。
- **PowerShell 默认不是 DPI 感知的**：`SystemInformation.VirtualScreen` 返回的是缩放后尺寸
  （本机 125% 缩放 → 报告 1536×864，实际 1920×1080），导致按物理坐标算出的落点全部偏出目标窗口。
  必须先 `SetProcessDPIAware()` 再做坐标换算。
- Electron 的窗口尺寸是 **DIP**，而 Win32 / UI Automation 报告的是**物理像素**
  （本机 520×760 DIP → 650×950 物理）。

### 12.8.1 ❌ 不要用 `.vbs` 做启动器（编码陷阱）

想给"无控制台启动"加一个带错误提示的启动器时，第一反应是写 `.vbs`
（`WScript.Shell.Run(..., 0, False)` 可以隐藏启动）。**这条路踩了坑**：

> **WSH 默认按 ANSI 解析 `.vbs` 文件。** 若文件是 UTF-8 且含中文，
> 会被解码成乱码并直接抛**编译错误**：
> `xxx.vbs(20, 47) Microsoft VBScript 编译错误: 未结束的字符串常量`
>
> 更麻烦的是：用 `wscript.exe` 跑时报错会弹一个 **MsgBox**，它会**静默挂起**——
> 桌宠没启动，却在后台留下一个看不见的模态窗口，排查起来很费劲。

**结论：`.vbs` 要么写成纯 ASCII，要么存成 UTF-16LE。** 但更简单的做法是**根本不用脚本**：

```
快捷方式 → electron.exe . （工作目录 = desktop）
```

`electron.exe` 本身就是 **GUI 子系统**程序，直接启动**不会分配控制台**
（`npm start` 会，因为它先起了 `cmd.exe`）。所以一个纯 `.lnk` 就同时满足了
"无控制台" 和 "双击即用"，还没有编码问题。

**顺带纠正一个直觉**：`conhost.exe` 存在 ≠ 有控制台窗口。
Node 以 `windowsHide: true` + 管道 stdio 启动子进程时仍会创建一个 `conhost`，
但它的 `MainWindowHandle = 0`（无窗口）。判断有没有可见控制台要**看窗口句柄**，
不能数进程。

---

### 12.9 ✅ 调整大小模式：用独立的「拉伸框窗口」实现（已实测）

**约束回顾（本文 §0 限制 1）**：Windows 上透明窗口无法用系统边框拉伸（`WS_THICKFRAME` 与分层窗口不兼容）。
且 Electron 的 `win.setAspectRatio()` **在 Windows 上无效**（electron#8036）。所以"边框"必须自造。

**两种自造方式的取舍**：

| | A. 在角色窗口内叠一层框 | B. 独立的拉伸框窗口 ✅ |
|---|---|---|
| 把手位置 | 在窗口边缘会被裁掉一半，只能内缩 | 自己的窗口，任意摆放 |
| 拖动时角色窗口 | **必须同步改尺寸** → 页面触发 `resize` → `renderer.setSize()` **每帧重分配 framebuffer** | **完全不动** |
| 拖动期间渲染 | 只能靠冻结绕过 | **天然 0 帧** |
| 命中判定 | 需读 `canvas.style.cursor` | 自己的 DOM，`elementFromPoint` 即可 |

选 **B**。决定性理由是第三行：方案 A 为了预览而每帧 `setSize`，反而比不省。

**已实现的流程**（`desktop/main.js` + `desktop/resize-frame.html`）：

```
enterResizeMode()
 ├─ freezeRendering()      冻结页面动画循环 → 0 帧
 └─ 建一层铺满工作区的透明窗口（拉伸框）
      · 目标框 + 4 角把手 + 原尺寸虚影 + 尺寸标签
      · 拖角 = 自由伸缩（**比例锁**）；拖框体 = 平移
      · 框/按钮可交互，其余一律穿透
 ├─ 确认 / Enter → applySizeUnlock() + setBounds() 一次性生效 → resumeRendering()
 └─ 取消 / Esc  → 角色窗口自始至终未改动，**无需回滚** → resumeRendering()
```

**「比例锁」实现**：`resizeTo()` 中取"相对原始尺寸变化更明显"的那个轴驱动缩放，
另一轴由 `宽/高` 推出。锚点为对角，并同时受工作区边界约束。

**「0 帧」实现**：`app.js:1564` 的循环是 `animate() { requestAnimationFrame(animate); ... }`。
把 `window.requestAnimationFrame` 换成一个**只把回调存下、不执行**的版本，循环即停在原地；
恢复时把存下的回调交还原生 rAF。比"降频"彻底（真正 0 帧），且不改前端源码。

**实测结果**：

| 项 | 结果 |
|---|---|
| 比例锁 | 405×591 → 249×363（比值 0.6853 → 0.6859，**未变形**） |
| 拖动期间渲染 | `[freeze] 渲染冻结：(frozen) — 拖动期间 0 帧` → `渲染恢复：(resumed)` |
| 取消 | `[resize] 已取消，窗口保持 273x389`，角色窗口未被触碰 |
| 把手命中 | 用 `elementFromPoint` 判定；**不使用 `mouseenter`** —— 把手带负偏移（伸出框外 8px），从框外进入时父元素的 `mouseenter` 不可靠 |

**与 §3 相同的防死锁纪律**：拉伸框窗口初始**不**开启穿透，等渲染进程确认 mousemove 能送达后
才切成穿透。若 `forward` 转发在本机失效，最坏结果是"框不能穿透桌面"，而不会"框整个点不动"。

---

### 12.10 ✅ 独立聊天悬浮窗（§2.2 方案 B 的落地）

§2.2 的修正结论是「**方案 B：独立 Chat 窗口**，不做"输入框叠加 + 临时提权"」，理由是
`focusable:false` 与"要能打字"直接冲突。聊天窗已按该方案实现并实测通过：

| 项 | 结论 |
|---|---|
| WS 归属 | **聊天窗不建连接**，全部收发出 IPC 中继到角色窗口那条唯一连接（理由见 §2.2：后端每条 `/client-ws` 都克隆一份 `ServiceContext`，且 TTS 只推给其中一条） |
| 实现方式 | preload 注入主世界脚本包装 `window.WebSocket`，收发经 DOM `CustomEvent` 桥回隔离世界 → IPC。**未修改 `vrm_frontend/` 任何源码** |
| 尺寸 | 320×140；消息区可**收起**成 320×58（只留顶栏 + 输入行），底边锚定不动 |
| 改尺寸 | 复用 §11.1 的结论：`resizable:false` 保透明 + 重置 min/max 后 `setBounds` 生效，透明未丢 |
| 顶栏拖动 | 聊天窗**可以**用 `-webkit-app-region: drag` —— 限制 2 说的是它会吞掉区域内**所有**指针事件，而聊天窗顶栏没有需要点击的 canvas（角色窗口才有） |
| 图标 | 全部内联 SVG。emoji 在 Windows 上会被替换成彩色字形，与 11~12px 的界面字体不搭 |

**实测**：`已收起 → 320x58` / `已展开 → 320x140`；键入文本 → 经角色窗口那条连接发出 → 收到回复。
实现细节与日志见 [`../desktop/README.md`](../desktop/README.md)。

### 12.11 ⚠️ 透明窗口的 `ready-to-show` 不触发

角色窗与聊天窗都是 `show:false` + `transparent:true`，实测 **`ready-to-show` 从未触发**。
按常规写法（`win.once('ready-to-show', () => win.show())`）会得到一个**永远不出现的窗口**。

→ 两个窗口都改为在 `did-finish-load` 时显示；聊天窗另外加了 2.5s 定时兜底。
日志实测：`请求显示聊天窗` → **114ms** 后 `已显示 (did-finish-load)`。

---

## 13. 参考来源

**本仓库代码证据**：`vrm_frontend/app.js`（:155-161 OrbitControls、:1037-1079 raycast 点击、:1091-1098 点击/拖拽判定、:1118 WS 连接、:1422-1434 动作下拉）

**外部来源**
- [Electron · Custom Window Interactions（app-region / setIgnoreMouseEvents / forward）](https://www.electronjs.org/docs/latest/tutorial/custom-window-interactions)
- [Electron · BrowserWindow API（setAlwaysOnTop / setShape / setSkipTaskbar / setFocusable）](https://www.electronjs.org/docs/latest/api/browser-window)
- [Electron · Custom Window Styles（transparent 限制）](https://www.electronjs.org/docs/latest/tutorial/custom-window-styles)
- [electron#49173 · 透明无框窗口无法拉伸](https://github.com/electron/electron/issues/49173)
- [electron PR #51175 · WS_THICKFRAME 与分层窗口不兼容（根因）](https://releases.electronjs.org/pr/51175)
- [electron#31233 · `resizable:false` 的实现方式（min/max 锁定 + 移除 WS_THICKFRAME）](https://github.com/electron/electron/issues/31233)
- [electron#42258 · `setSize` 在 `resizable:false` 下无法缩小](https://github.com/electron/electron/issues/42258)
- [electron#51094 · `setResizable` 切换后透明永久丢失](https://github.com/electron/electron/issues/51094)
- [electron#48576 · `thickFrame:false` 的拖边拉伸回归](https://github.com/electron/electron/issues/48576)
- [electron#8762 · 官方拒绝让 hookWindowMessage 修改返回值（阻断 per-pixel hit test 的捷径）](https://github.com/electron/electron/issues/8762)
- [electron#21459 · `focusable` 由 false 改回 true 后 focus 事件失效](https://github.com/electron/electron/issues/21459)
- [winpane · Input and Hit Testing（物理像素 HitTestMap + WM_NCHITTEST 的参考实现）](https://peteretelej.github.io/winpane/design/input/)
- [focusable:false → WS_EX_NOACTIVATE 的实测记录](https://github.com/SuperstitiousSeiya/windows-ai-agent-hide)
- [electron#40985 · -webkit-app-region: drag 失效](https://github.com/electron/electron/issues/40985)
- [electron#38020 · screen-saver 层级盖不过任务栏](https://github.com/electron/electron/issues/38020)
- [electron#23042 · setIgnoreMouseEvents 整窗生效](https://github.com/electron/electron/issues/23042)
- [Microsoft Learn · DwmGetWindowAttribute](https://learn.microsoft.com/en-us/windows/win32/api/dwmapi/nf-dwmapi-dwmgetwindowattribute)
- [Microsoft Learn · GetForegroundWindow](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getforegroundwindow)
- [WorkerW/Progman 壁纸层技术实践（DeskX）](https://github.com/Felix-au/DeskX-Wallpaper-Engine)
- [WebView2 托管 WorkerW 的同类实现](https://github.com/bbabcock1990/Animated-Desktop-Wall-Papers-Helper)
- [Lively Wiki · Application Wallpaper（暂停 bug 等限制）](https://github.com/rocksdanister/lively/wiki/Application-Wallpaper)
