/*
 * Open-LLM-VTuber 3D VRM 桌宠壳 —— Electron 初版（技术验证）
 *
 * 与 doc/desktop_pet_ui_design_20260918.md 的对应关系：
 *   §2.1  窗口参数：transparent / frame:false / focusable:false / skipTaskbar / 不可拉伸
 *   §4    拖动：主进程 setPosition，不用 app-region
 *   §5.2  z-order：alwaysOnTop('screen-saver') + skipTaskbar
 *   §8    WS 仍在渲染器内（本版不动），窗口尺寸变化走 §11.1 的实验
 *   §11.1 ★ 实验：resizable:false 保透明 + 重置 min/max 后 setSize 是否生效
 *
 * 明确不做（留给后续版本）：
 *   - 局部点击穿透（hover 预切换 setIgnoreMouseEvents）
 *   - 独立 Chat 窗口 / 全局快捷键
 *   - 全屏应用检测
 */

'use strict'

const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  ipcMain,
  screen,
  session,
  nativeImage,
  shell,
  globalShortcut
} = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const net = require('node:net')
const { spawn } = require('node:child_process')

const PROJECT_ROOT = path.resolve(__dirname, '..')
const HOST = '127.0.0.1'
const PORT = 12393
const AVATAR_URL = `http://${HOST}:${PORT}/vrm/`
const LOG_FILE = path.join(PROJECT_ROOT, 'logs', 'desktop_pet.log')

// 尺寸档位 —— 用于验证设计文档 §11.1
const SIZE_PRESETS = {
  small: { width: 340, height: 500, label: '小 (340x500)' },
  medium: { width: 520, height: 760, label: '中 (520x760)' },
  large: { width: 700, height: 1000, label: '大 (700x1000)' }
}

const NO_BACKEND = process.argv.includes('--no-backend')
const RUN_RESIZE_TEST = process.argv.includes('--resize-test')
const FULL_UI = process.argv.includes('--full-ui')

// 取景档位：通过「合成滚轮事件」让页面自己的 OrbitControls 拉远相机。
// 这样无需访问 app.js 的模块作用域变量，也不必修改 vrm_frontend/ 源码。
//
// 原前端相机：FOV=30、距离 1.25、target y=1.30
//   → 可视世界高度 = 2 * d * tan(15°) = d * 0.5359，d=1.25 时只有 0.67（约胸到头顶）
// OrbitControls：minDistance 0.5 / maxDistance 3.5，滚轮向下 dollyOut，每格约 ×(1/0.95)=1.0526
// 因此「先滚到 minDistance 0.5 建立基线，再滚出 N 格」时 N = ln(D / 0.5) / ln(1.0526)
//   bust D=1.25 → 18 格（≈ 原前端默认取景）
//   half D=2.20 → 28 格（可视高度 ≈1.18，约到膝盖）
//   full D=3.20 → 38 格（可视高度 ≈1.72，约全身）
const FRAMING_PRESETS = {
  bust: { steps: 18, label: '胸像（原前端默认）' },
  half: { steps: 28, label: '半身' },
  full: { steps: 38, label: '全身' }
}
let currentFraming = 'full'

/** @type {BrowserWindow|null} */
let avatarWindow = null
/** @type {Tray|null} */
let tray = null
/** @type {import('node:child_process').ChildProcess|null} */
let backendProcess = null
let backendStartedByUs = false
let currentSize = 'medium'
let dragState = null
let overlayCss = ''
let quitting = false

// —— 局部点击穿透状态 ——
// 目标：只有「角色身体」那块区域接收鼠标，其余透明区域一律穿透到下层窗口。
// 命中判定来自渲染器（预加载脚本读 canvas.style.cursor），见 preload.js。
let clickThroughEnabled = true
let pointerAlive = false // 收到过真实 pointermove —— 证明 forward 转发可用，才敢开启穿透
// 注意初值必须是 true：窗口创建后实际处于「可交互（未开启穿透）」状态，
// 若这里写 false，onHoverState 的未命中分支会在 `if (!isInteractive) return` 处
// 直接返回，导致永远切不到穿透 —— 直到鼠标先进角色再离开为止。
let isInteractive = true
let hoverSynced = false // 是否已按真实命中状态同步过一次
let leaveTicks = 0
const LEAVE_TICKS_TO_DISABLE = 3 // 连续 3 次未命中（约 300ms）才恢复穿透，抑制边缘抖动

// —— 调整大小模式 ——
// 设计要点：拖动期间**完全不碰角色窗口**，只画一层独立的「拉伸框」窗口。
// 这样角色窗口不产生 resize 事件 → 页面不会调 renderer.setSize() 重分配 framebuffer
// → 真正 0 帧渲染，符合「变动期间不要刷新渲染」的要求。
let resizeFrameWindow = null
let resizeBackupBounds = null
let renderingFrozen = false
let settingsWindow = null

// —— 独立聊天悬浮窗 ——
// 它**不**建自己的 WebSocket。后端每条 /client-ws 连接都会克隆一份 ServiceContext
// （各自的 history_uid），开第二条会导致上下文分叉，而且 TTS 音频只会推给其中一条，
// 角色就不会说话了。所以聊天窗的所有收发都经 main 中继到角色窗口那一条连接。
const CHAT_LOG_MAX = 300
// 展开时：顶栏 + 约 3 行消息 + 输入区。收起时只留顶栏 + 输入区
// （58 = 24 顶栏 + 1 描边 + 32 输入区 + 1 描边）。
const CHAT_SIZE = { width: 320, height: 140 }
const CHAT_COLLAPSED_HEIGHT = 58
let chatWindow = null
let chatLog = []
let chatStatus = '就绪'
let chatAutoHide = true
// 消息区是否收起。与「自动隐藏」（失焦是否收窗口）是两件事。
let chatCollapsed = false

// —— 角色切换 ——
// 角色清单从角色窗口的 #config-select 读（见 refreshCharacterList），
// 当前角色则以后端推来的 set-model-and-conf 为准（页面加载那一刻 select 的默认选中项
// 是列表第一项，并不等于真正加载的角色，不能拿它当当前值）。
let characterOptions = [] // [{ value, id, label }]
let currentCharacterName = ''
let currentCharacterId = ''

// ---------------------------------------------------------------- 日志

function log(message) {
  const line = `${new Date().toISOString()} ${message}`
  console.log(line)
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true })
    fs.appendFileSync(LOG_FILE, line + '\n')
  } catch {
    /* 日志失败不影响主流程 */
  }
}

// ---------------------------------------------------------------- 后端

function isPortOpen() {
  return new Promise((resolve) => {
    const socket = net.connect({ host: HOST, port: PORT })
    let settled = false
    const done = (ok) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(ok)
    }
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
    socket.setTimeout(800, () => done(false))
  })
}

function resolvePythonLauncher() {
  const venvPython = path.join(PROJECT_ROOT, '.venv', 'Scripts', 'python.exe')
  if (fs.existsSync(venvPython)) {
    return { command: venvPython, args: [] }
  }
  return { command: 'uv', args: ['run', 'python'] }
}

function startBackend() {
  const { command, args } = resolvePythonLauncher()
  log(`[backend] 拉起 ${command} run_server.py`)
  backendProcess = spawn(command, [...args, 'run_server.py'], {
    cwd: PROJECT_ROOT,
    windowsHide: true, // 不弹 CMD 黑窗
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
  })
  backendStartedByUs = true

  const forward = (stream, tag) => {
    stream.setEncoding('utf8')
    stream.on('data', (chunk) => {
      const text = String(chunk).trim()
      if (text) log(`[backend:${tag}] ${text}`)
    })
  }
  forward(backendProcess.stdout, 'out')
  forward(backendProcess.stderr, 'err')

  backendProcess.on('error', (error) => {
    log(`[backend] 启动失败: ${error.message}`)
    backendProcess = null
  })
  backendProcess.on('exit', (code, signal) => {
    log(`[backend] 已退出 code=${code} signal=${signal}`)
    backendProcess = null
  })
}

async function waitForBackend(timeoutMs = 90000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (await isPortOpen()) return true
    await new Promise((resolve) => setTimeout(resolve, 700))
  }
  return false
}

function stopBackend() {
  if (backendStartedByUs && backendProcess) {
    log('[backend] 关闭由本进程拉起的后端')
    try {
      backendProcess.kill()
    } catch (error) {
      log(`[backend] 关闭异常: ${error.message}`)
    }
    backendProcess = null
  }
}

// ---------------------------------------------------------------- 状态持久化

function petStateFile() {
  return path.join(app.getPath('userData'), 'pet-state.json')
}

function loadPetState() {
  try {
    return JSON.parse(fs.readFileSync(petStateFile(), 'utf8'))
  } catch {
    return {}
  }
}

function savePetState(patch) {
  try {
    const next = { ...loadPetState(), ...patch }
    fs.mkdirSync(path.dirname(petStateFile()), { recursive: true })
    fs.writeFileSync(petStateFile(), JSON.stringify(next, null, 2))
  } catch (error) {
    log(`[state] 保存失败: ${error.message}`)
  }
}

/** 取上次保存且仍在某个显示器工作区内的尺寸 */
function restoreSavedBounds() {
  const saved = loadPetState().bounds
  if (!saved || !Number.isFinite(saved.width) || !Number.isFinite(saved.height)) return null
  if (saved.width < 160 || saved.height < 160) return null

  const target = {
    x: Number.isFinite(saved.x) ? saved.x : 0,
    y: Number.isFinite(saved.y) ? saved.y : 0,
    width: Math.round(saved.width),
    height: Math.round(saved.height)
  }
  const display = screen.getDisplayMatching(target)
  if (!display) return null

  // 夹回工作区，避免上次在副屏保存、这次副屏没插
  const work = display.workArea
  target.x = Math.min(Math.max(target.x, work.x), work.x + work.width - target.width)
  target.y = Math.min(Math.max(target.y, work.y), work.y + work.height - target.height)
  return target
}

// ---------------------------------------------------------------- 渲染冻结
//
// 页面的动画循环是 app.js:1564 `function animate() { requestAnimationFrame(animate); ... }`。
// 把 requestAnimationFrame 换成一个「只把回调扣下来、不执行」的版本，循环就停在原地：
// 既不渲染（0 帧），又能随时把扣下的回调交还给原生 rAF 干净恢复 —— 这比降频更彻底，
// 也比改前端源码更无侵入。

async function freezeRendering() {
  if (!avatarWindow || avatarWindow.isDestroyed() || renderingFrozen) return
  try {
    const result = await avatarWindow.webContents.executeJavaScript(`(() => {
      if (window.__petRafOriginal) return 'already-frozen'
      window.__petRafOriginal = window.requestAnimationFrame.bind(window)
      window.__petRafPending = null
      window.requestAnimationFrame = (cb) => { window.__petRafPending = cb; return 0 }
      return 'frozen'
    })()`)
    renderingFrozen = result !== 'already-frozen'
    log(`[freeze] 渲染冻结：(${result}) — 拖动期间 0 帧`)
  } catch (error) {
    log(`[freeze] 冻结失败: ${error.message}`)
  }
}

async function resumeRendering() {
  if (!renderingFrozen || !avatarWindow || avatarWindow.isDestroyed()) {
    renderingFrozen = false
    return
  }
  try {
    const result = await avatarWindow.webContents.executeJavaScript(`(() => {
      const original = window.__petRafOriginal
      if (!original) return 'not-frozen'
      const pending = window.__petRafPending
      window.requestAnimationFrame = original
      window.__petRafOriginal = null
      window.__petRafPending = null
      if (pending) original(pending)
      return 'resumed'
    })()`)
    log(`[freeze] 渲染恢复：(${result})`)
  } catch (error) {
    log(`[freeze] 恢复失败: ${error.message}`)
  }
  renderingFrozen = false
}

// ---------------------------------------------------------------- 调整大小模式

function enterResizeMode() {
  if (resizeFrameWindow) return
  if (!avatarWindow || avatarWindow.isDestroyed()) {
    log('[resize] 角色窗口不存在，无法进入调整大小模式')
    return
  }

  const bounds = avatarWindow.getBounds()
  resizeBackupBounds = { ...bounds }
  freezeRendering()
  createResizeFrameWindow(bounds)
  refreshTrayMenu()
  log(`[resize] 进入调整大小模式，当前 ${bounds.width}x${bounds.height} @ (${bounds.x}, ${bounds.y})`)
}

function createResizeFrameWindow(rect) {
  const display = screen.getDisplayMatching(rect)
  const work = display.workArea

  resizeFrameWindow = new BrowserWindow({
    x: work.x,
    y: work.y,
    width: work.width,
    height: work.height,
    transparent: true,
    frame: false,
    hasShadow: false,
    resizable: false,
    thickFrame: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    fullscreenable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'resize-frame-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  resizeFrameWindow.setAlwaysOnTop(true, 'screen-saver')
  // 刻意**不**在这里开启穿透：先保持可交互，等渲染进程确认 mousemove 能送达后
  // 再由 resize:hover 信号切成穿透。否则万一 forward 转发失效，框就点不动了。

  resizeFrameWindow.on('closed', () => {
    resizeFrameWindow = null
  })

  resizeFrameWindow.webContents.once('did-finish-load', () => {
    if (!resizeFrameWindow || resizeFrameWindow.isDestroyed()) return
    // 需要键盘（Esc / Enter），所以这里用 show() 而不是 showInactive()
    resizeFrameWindow.show()
    resizeFrameWindow.webContents.send('resize:init', {
      origin: { x: work.x, y: work.y },
      work: { width: work.width, height: work.height },
      rect: { ...rect },
      aspect: rect.width / rect.height,
      minWidth: 200
    })
  })

  resizeFrameWindow.loadFile(path.join(__dirname, 'resize-frame.html')).catch((error) => {
    log(`[resize] 拉伸框窗口加载失败: ${error.message}`)
  })
}

/**
 * 退出调整大小模式。
 * @param {boolean} commit 是否应用新矩形
 * @param {{x:number,y:number,width:number,height:number}} [rect] 屏幕 DIP 坐标
 */
function exitResizeMode(commit, rect) {
  const backup = resizeBackupBounds
  resizeBackupBounds = null

  if (resizeFrameWindow && !resizeFrameWindow.isDestroyed()) {
    resizeFrameWindow.destroy()
  }
  resizeFrameWindow = null

  if (commit && rect && avatarWindow && !avatarWindow.isDestroyed()) {
    const next = {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    }
    applySizeUnlock('应用新尺寸前')
    avatarWindow.setBounds(next)
    currentSize = null // 不再对应任何预设档位
    savePetState({ bounds: next })
    log(`[resize] ✅ 已应用 ${next.width}x${next.height} @ (${next.x}, ${next.y})`)
  } else {
    log(`[resize] 已取消，窗口保持 ${backup ? backup.width + 'x' + backup.height : '原状'}`)
  }

  resumeRendering()
  refreshTrayMenu()
  pushSettingsState()
}

// ---------------------------------------------------------------- 窗口

function loadOverlayCss() {
  if (FULL_UI) {
    overlayCss = ''
    return
  }
  try {
    overlayCss = fs.readFileSync(path.join(__dirname, 'pet-overlay.css'), 'utf8')
  } catch (error) {
    log(`[css] 读取 pet-overlay.css 失败: ${error.message}`)
  }
}

function defaultPosition(width, height) {
  const work = screen.getPrimaryDisplay().workArea
  return {
    x: work.x + work.width - width - 48,
    y: work.y + work.height - height
  }
}

function createAvatarWindow() {
  // 优先用上次保存的尺寸/位置；没保存过或已不在任何显示器工作区内则回落默认
  const saved = restoreSavedBounds()
  const preset = SIZE_PRESETS[currentSize] || SIZE_PRESETS.medium
  const width = FULL_UI ? 1280 : (saved ? saved.width : preset.width)
  const height = FULL_UI ? 800 : (saved ? saved.height : preset.height)
  const fallback = defaultPosition(width, height)
  const x = FULL_UI ? undefined : (saved ? saved.x : fallback.x)
  const y = FULL_UI ? undefined : (saved ? saved.y : fallback.y)

  avatarWindow = new BrowserWindow({
    width,
    height,
    center: Boolean(FULL_UI),
    ...(x !== undefined && y !== undefined && !FULL_UI ? { x, y } : {}),
    // —— 窗口参数 ——
    transparent: !FULL_UI,
    frame: Boolean(FULL_UI),
    hasShadow: true,
    resizable: true,
    thickFrame: true,
    focusable: true,
    skipTaskbar: false,
    alwaysOnTop: false,
    fullscreenable: false,
    maximizable: true,
    minimizable: true,
    autoHideMenuBar: true,
    show: Boolean(FULL_UI),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  })

  if (!FULL_UI) {
    avatarWindow.setAlwaysOnTop(true, 'screen-saver')
  }

  // 重置穿透状态：新窗口先整窗可交互，等确认 forward 转发可用后，
  // 才会切到「只有角色挡住鼠标」。这样最坏情况也只是回到旧行为，不会把角色点不动。
  pointerAlive = false
  isInteractive = true // 与窗口真实状态一致（未调用 setIgnoreMouseEvents）
  hoverSynced = false
  leaveTicks = 0

  // §11.1 实验：解锁 min/max，使程序化 setSize 有生效的可能（透明不受影响）
  applySizeUnlock('窗口创建')

  avatarWindow.webContents.on('dom-ready', () => {
    if (overlayCss) {
      avatarWindow.webContents.insertCSS(overlayCss).catch((error) => {
        log(`[css] 注入失败: ${error.message}`)
      })
    }
  })

  avatarWindow.webContents.on('did-finish-load', () => {
    log('[window] 页面加载完成')
    renderingFrozen = false // 页面重载后注入的全局变量已失效，标志位必须同步复位
    if (!avatarWindow.isVisible()) {
      avatarWindow.showInactive() // 不抢焦点
      log('[window] 已用 showInactive() 显示')
    }

    // 托盘的角色菜单要等页面 DOM 就绪后才有 #config-select 可读
    refreshCharacterList()

    // 等 VRM 与 OrbitControls 就绪后再套用取景
    setTimeout(() => applyFraming(currentFraming), 3500)

    if (RUN_RESIZE_TEST) {
      setTimeout(runResizeTest, 7000)
    }
  })

  avatarWindow.webContents.on('render-process-gone', (_event, details) => {
    log(`[window] 渲染进程异常退出: ${details.reason}，1.5s 后重载`)
    setTimeout(() => {
      if (avatarWindow && !avatarWindow.isDestroyed()) avatarWindow.reload()
    }, 1500)
  })

  avatarWindow.webContents.on('did-fail-load', (_event, code, description) => {
    log(`[window] 加载失败 ${code} ${description}（后端是否已就绪？）`)
  })

  avatarWindow.on('closed', () => {
    avatarWindow = null
  })

  avatarWindow.loadURL(AVATAR_URL).catch((error) => {
    log(`[window] loadURL 异常: ${error.message}`)
  })

  log(`[window] 创建完成 ${width}x${height} @ (${x}, ${y})`)
}

/**
 * 重置 min/max 尺寸限制。
 *
 * Windows 上 Electron 用「把 min/max 设为当前尺寸 + 移除 WS_THICKFRAME」
 * 来实现 resizable:false，结果导致程序化 setSize 也被卡住（issue #42258）。
 * 这里只解锁 min/max，绝不调用 setResizable()（那会永久破坏透明，issue #51094）。
 */
function applySizeUnlock(reason) {
  if (!avatarWindow || avatarWindow.isDestroyed()) return
  try {
    avatarWindow.setMinimumSize(1, 1)
    avatarWindow.setMaximumSize(0, 0)
    log(`[size] ${reason}：已重置 min/max（setResizable 未被调用）`)
  } catch (error) {
    log(`[size] ${reason}：重置 min/max 失败: ${error.message}`)
  }
}

/** §11.1 核心实验：在不丢透明的前提下改变窗口尺寸 */
function resizeAvatar(sizeKey) {
  if (!avatarWindow || avatarWindow.isDestroyed()) return
  const preset = SIZE_PRESETS[sizeKey]
  if (!preset) return
  currentSize = sizeKey

  const before = avatarWindow.getSize()
  const oldBounds = avatarWindow.getBounds()

  applySizeUnlock('切换尺寸前')
  avatarWindow.setSize(preset.width, preset.height)

  const after = avatarWindow.getSize()
  const worked = after[0] === preset.width && after[1] === preset.height

  // 保持右下角锚定，并保证仍留在工作区内
  const work = screen.getPrimaryDisplay().workArea
  let x = oldBounds.x + oldBounds.width - after[0]
  let y = oldBounds.y + oldBounds.height - after[1]
  x = Math.min(Math.max(x, work.x), work.x + work.width - after[0])
  y = Math.min(Math.max(y, work.y), work.y + work.height - after[1])
  avatarWindow.setPosition(Math.round(x), Math.round(y))

  log(
    `[resize-test] ${sizeKey} 请求 ${preset.width}x${preset.height} | ` +
      `setSize 前 ${before.join('x')} | 后 ${after.join('x')} | ` +
      `${worked ? '✅ setSize 生效' : '❌ setSize 被拦截'} | ` +
      `isResizable=${avatarWindow.isResizable()} —— 透明是否保住请肉眼确认`
  )

  savePetState({ bounds: avatarWindow.getBounds() })
  refreshTrayMenu()
  pushSettingsState()
}

/**
 * 调整取景（不改 vrm_frontend 源码）。
 *
 * 往 canvas 上派发合成的 WheelEvent，交给页面已有的 OrbitControls 处理 ——
 * 效果等同于用户用滚轮缩放。因为相机对象位于 app.js 的模块作用域内，
 * 外部拿不到，这是唯一不修改前端源码的办法。
 *
 * 清零基线：先反向滚回最大距离，再正向放到目标档位，保证多次切换可复现。
 */
async function applyFraming(level) {
  if (!avatarWindow || avatarWindow.isDestroyed()) return
  const preset = FRAMING_PRESETS[level]
  if (!preset) return
  currentFraming = level

  const script = `(() => {
    try {
      const canvas = document.querySelector('#canvas-container canvas');
      if (!canvas) return { ok: false, reason: 'no-canvas' };
      const fire = (deltaY) => canvas.dispatchEvent(new WheelEvent('wheel', {
        deltaY: deltaY, deltaMode: 0, bubbles: true, cancelable: true
      }));
      for (let i = 0; i < ${FRAMING_MAX_STEPS}; i++) fire(-100);
      for (let i = 0; i < ${preset.steps}; i++) fire(100);
      return { ok: true, w: canvas.width, h: canvas.height, targetSteps: ${preset.steps} };
    } catch (error) {
      return { ok: false, reason: String(error && error.stack ? error.stack : error) };
    }
  })()`

  try {
    const result = await avatarWindow.webContents.executeJavaScript(script)
    log(`[framing] ${level} → ${JSON.stringify(result)}`)
  } catch (error) {
    log(`[framing] ${level} 失败: ${error.message}`)
  }
  refreshTrayMenu()
  pushSettingsState()
}

/** 把相机拉近到最大距离，作为可复现的基线 */
const FRAMING_MAX_STEPS = 40

/**
 * §11.1 自动跑测：按 小 → 大 → 中 循环，逐次打印 setSize 是否生效。
 * setSize 生效 ≠ 透明保住，后者需要肉眼确认（截图无法给出 alpha 判定）。
 */
async function runResizeTest() {
  log('[resize-test] === 开始自动跑测（小 → 大 → 中）===')
  for (const key of ['small', 'large', 'medium']) {
    resizeAvatar(key)
    await new Promise((resolve) => setTimeout(resolve, 800))
  }
  log('[resize-test] === 跑测结束，请肉眼确认角色背景是否仍透明 ===')
}

function resetPosition() {
  if (!avatarWindow || avatarWindow.isDestroyed()) return
  const [width, height] = avatarWindow.getSize()
  const { x, y } = defaultPosition(width, height)
  avatarWindow.setPosition(x, y)
}

function toggleVisible() {
  if (!avatarWindow || avatarWindow.isDestroyed()) return
  if (avatarWindow.isVisible()) {
    avatarWindow.hide()
  } else {
    avatarWindow.showInactive()
  }
  refreshTrayMenu()
}

// ---------------------------------------------------------------- 托盘

function trayIcon() {
  const candidates = [
    path.join(PROJECT_ROOT, 'frontend', 'favicon.ico'),
    path.join(PROJECT_ROOT, 'doc', 'architecture_topology.png')
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      const image = nativeImage.createFromPath(candidate)
      if (!image.isEmpty()) return image
    }
  }
  log('[tray] 未找到可用图标')
  return nativeImage.createEmpty()
}

/**
 * 从角色窗口读回可切换的角色清单。
 *
 * 为什么不自己扫 `characters/*.yaml`：网页版的 `#config-select` 才是「哪些角色可用、
 * 显示什么名字」的唯一事实来源（还带 `(Kira)` 这类后缀）。直接读它，两边永远不会不一致，
 * 也**不需要改动 `vrm_frontend/` 任何源码**。
 */
async function refreshCharacterList() {
  if (!avatarWindow || avatarWindow.isDestroyed()) return
  try {
    const options = await avatarWindow.webContents.executeJavaScript(`(() => {
      const sel = document.getElementById('config-select')
      if (!sel) return null
      return Array.from(sel.options).map((o) => ({
        value: o.value,
        id: o.getAttribute('data-id') || o.value.replace(/\\.ya?ml$/i, ''),
        label: o.textContent.trim()
      }))
    })()`)
    if (!Array.isArray(options) || !options.length) return
    characterOptions = options
    log(`[char] 角色清单已载入，共 ${characterOptions.length} 项`)
  } catch (error) {
    log(`[char] 读取角色清单失败: ${error.message}`)
  }
  refreshTrayMenu()
}

/**
 * 切换角色 —— 复用角色窗口那条唯一 WS，与网页版下拉发的是同一条消息。
 * 代价是必须经后端往返（它再推 `set-model-and-conf` 回来），所以**不在这里乐观改状态**，
 * 当前角色一律以 `set-model-and-conf` 为准。
 */
function switchCharacter(file) {
  if (!avatarWindow || avatarWindow.isDestroyed()) {
    log('[char] 角色窗口不可用，无法切换角色')
    return
  }
  if (!file || isCurrentCharacter(file)) return
  log(`[char] 请求切换角色: ${file}`)
  avatarWindow.webContents.send('avatar:ws-send', JSON.stringify({ type: 'switch-config', file }))
}

/** 角色清单里的一项是否就是当前角色（根据身份证 ID 精准判定） */
function isCurrentCharacter(value, label, id) {
  const targetId = id || (typeof value === 'string' ? value.replace(/\.ya?ml$/i, '') : '')
  if (currentCharacterId && targetId) {
    return targetId === currentCharacterId
  }
  if (!currentCharacterName) return false
  return String(value).includes(currentCharacterName) || String(label || '').includes(currentCharacterName)
}

/**
 * 托盘菜单。
 *
 * 遵循 Windows 托盘应用的通行惯例（Electron 官方 Tray 指南 + 系统通知区习惯）：
 *   - 左键点图标 = 主操作（这里用「显示/隐藏角色」），右键 = 菜单（由 setContextMenu 自动挂载）
 *   - 第一项是与用户最相关的状态开关，且**标签随状态变化**
 *   - 单选（radio）用于互斥选项，勾选（checkbox）用于开/关
 *   - 设置类入口放在中间，诊断类入口次之
 *   - **「退出」永远单独放在最后**，并用分隔线隔开
 *   - Tooltip 显示应用名与当前状态
 */
function refreshTrayMenu() {
  if (!tray) return
  const alive = avatarWindow && !avatarWindow.isDestroyed()
  const visible = alive && avatarWindow.isVisible()
  const onTop = alive && avatarWindow.isAlwaysOnTop()
  const resizing = Boolean(resizeFrameWindow)

  const sizeLabel = (() => {
    if (!alive) return '无窗口'
    const b = avatarWindow.getBounds()
    return `${b.width} × ${b.height}`
  })()

  tray.setToolTip(
    `Open-LLM-VTuber 3D 桌宠 · ${currentCharacterName || '角色加载中'} · ${sizeLabel}`
  )

  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: visible ? '隐藏角色' : '显示角色', click: toggleVisible },
      {
        label: '聊天…',
        ...(shortcuts.chat ? { accelerator: 'Ctrl+Shift+Space' } : {}),
        click: toggleChatWindow
      },
      { type: 'separator' },
      {
        label: resizing ? '调整大小中…（点此取消）' : '更改大小…',
        // 只有真的注册成功才显示快捷键，否则等于给用户一个按不出效果的提示
        ...(shortcuts.resize ? { accelerator: 'Ctrl+Shift+R' } : {}),
        click: () => (resizing ? exitResizeMode(false) : enterResizeMode())
      },
      {
        label: '角色',
        submenu: characterOptions.length
          ? characterOptions.map((option) => ({
              label: option.label,
              type: 'radio',
              checked: isCurrentCharacter(option.value, option.label, option.id),
              click: () => switchCharacter(option.value)
            }))
          : [{ label: '角色清单载入中…', enabled: false }]
      },
      {
        label: '预设尺寸',
        submenu: Object.entries(SIZE_PRESETS).map(([key, preset]) => ({
          label: preset.label,
          type: 'radio',
          checked: currentSize === key,
          click: () => resizeAvatar(key)
        }))
      },
      {
        label: '取景',
        submenu: Object.entries(FRAMING_PRESETS).map(([key, preset]) => ({
          label: preset.label,
          type: 'radio',
          checked: currentFraming === key,
          click: () => applyFraming(key)
        }))
      },
      { type: 'separator' },
      { label: '设置…', ...(shortcuts.settings ? { accelerator: 'Ctrl+Shift+S' } : {}), click: openSettingsWindow },
      {
        label: '点击穿透',
        type: 'checkbox',
        checked: clickThroughEnabled,
        click: (item) => setClickThroughEnabled(item.checked)
      },
      {
        label: '始终置顶',
        type: 'checkbox',
        checked: Boolean(onTop),
        click: (item) => {
          if (!avatarWindow || avatarWindow.isDestroyed()) return
          avatarWindow.setAlwaysOnTop(item.checked, 'screen-saver')
          refreshTrayMenu()
        }
      },
      { label: '回到右下角', click: resetPosition },
      { type: 'separator' },
      { label: '打开日志', click: () => shell.openPath(LOG_FILE) },
      { label: '打开网页版（对照）', click: () => shell.openExternal(AVATAR_URL) },
      { type: 'separator' },
      { label: '退出', click: quit }
    ])
  )
}

function createTray() {
  const icon = trayIcon()
  tray = new Tray(icon)
  tray.on('click', toggleVisible)
  tray.on('double-click', enterResizeMode)
  refreshTrayMenu()
  log(`[tray] 托盘已创建（图标 ${icon.isEmpty() ? '为空' : icon.getSize().width + 'x' + icon.getSize().height}）`)
}

// ---------------------------------------------------------------- 右键菜单

function popupAvatarMenu() {
  if (!avatarWindow || avatarWindow.isDestroyed()) return
  Menu.buildFromTemplate([
    { label: '聊天…', ...(shortcuts.chat ? { accelerator: 'Ctrl+Shift+Space' } : {}), click: showChatWindow },
    { label: '隐藏角色', click: toggleVisible },
    { label: '回到右下角', click: resetPosition },
    { type: 'separator' },
    { label: '退出', click: quit }
  ]).popup({ window: avatarWindow })
}

// ---------------------------------------------------------------- 局部点击穿透

/**
 * 切换窗口是否忽略鼠标事件。
 *
 * forward:true 是**必须**的 —— 窗口穿透后仍要把 mousemove 转发给页面，
 * 否则页面里的 raycast 永远不会再跑，就再也收不到「鼠标进入角色」的信号，
 * 形成死锁（鼠标永远无法把角色变回可交互）。
 */
function applyIgnoreMouseEvents(ignore) {
  if (FULL_UI) return
  if (!avatarWindow || avatarWindow.isDestroyed()) return
  try {
    if (ignore) {
      avatarWindow.setIgnoreMouseEvents(true, { forward: true })
    } else {
      avatarWindow.setIgnoreMouseEvents(false)
    }
  } catch (error) {
    log(`[hit] setIgnoreMouseEvents 失败: ${error.message}`)
  }
}

/** 恢复到「透明区域穿透」的默认状态 */
function restoreClickThrough(reason) {
  if (FULL_UI) return
  isInteractive = false
  leaveTicks = 0
  applyIgnoreMouseEvents(true)
  if (reason) log(`[hit] ${reason} → 恢复穿透`)
}

function onHoverState(hovering) {
  if (FULL_UI) return
  if (!avatarWindow || avatarWindow.isDestroyed()) return
  if (!clickThroughEnabled) return
  if (dragState) return // 拖动过程中不要切换穿透，否则会把拖动打断
  // 只有确认过 mouse move 转发可用，才允许把窗口切成穿透（防死锁）
  if (!pointerAlive) return

  // 通道打通后的第一次上报：直接按真实命中状态同步，不走宽限期。
  // 否则启动后会有一小段时间仍在阻挡下层窗口（就是这里漏过一次的 bug）。
  if (!hoverSynced) {
    hoverSynced = true
    if (hovering) {
      isInteractive = true
      leaveTicks = 0
      applyIgnoreMouseEvents(false)
      log('[hit] 初始同步：鼠标在角色上 → 保持可交互')
    } else {
      restoreClickThrough('初始同步：鼠标不在角色上')
    }
    return
  }

  if (hovering) {
    leaveTicks = 0
    if (!isInteractive) {
      isInteractive = true
      applyIgnoreMouseEvents(false)
      log('[hit] 鼠标进入角色 → 取消穿透')
    }
  } else {
    if (!isInteractive) return
    leaveTicks += 1
    if (leaveTicks >= LEAVE_TICKS_TO_DISABLE) {
      restoreClickThrough('鼠标离开角色')
    }
  }
}

/** 托盘开关：关闭时整窗恢复可交互（诊断用 / 用户偏好） */
function setClickThroughEnabled(enabled) {
  if (FULL_UI) return
  clickThroughEnabled = enabled
  log(`[hit] 点击穿透 ${enabled ? '已开启' : '已关闭'}`)
  if (!enabled) {
    isInteractive = true
    leaveTicks = 0
    applyIgnoreMouseEvents(false)
  } else if (pointerAlive) {
    restoreClickThrough('重新开启穿透')
  }
  refreshTrayMenu()
  pushSettingsState()
}

// ---------------------------------------------------------------- IPC

ipcMain.on('avatar:log', (_event, message) => log(String(message)))

ipcMain.on('avatar:hover-state', (_event, hovering) => onHoverState(Boolean(hovering)))

ipcMain.on('avatar:pointer-alive', () => {
  if (FULL_UI) return
  if (pointerAlive) return
  pointerAlive = true
  log('[hit] 已确认 mouse move 转发可用（focusable:false 下鼠标事件可达）→ 启用点击穿透')
})

// —— 调整大小模式 ——

ipcMain.on('resize:hover', (_event, interactive) => {
  if (!resizeFrameWindow || resizeFrameWindow.isDestroyed()) return
  resizeFrameWindow.setIgnoreMouseEvents(!interactive, { forward: true })
})

ipcMain.on('resize:cancel', () => exitResizeMode(false))

ipcMain.on('resize:commit', (_event, rect) => {
  if (!rect || !Number.isFinite(rect.width) || !Number.isFinite(rect.height)) {
    log('[resize] 收到非法矩形，按取消处理')
    exitResizeMode(false)
    return
  }
  exitResizeMode(true, rect)
})

ipcMain.on('avatar:drag-start', () => {
  if (!avatarWindow || avatarWindow.isDestroyed()) return
  const cursor = screen.getCursorScreenPoint()
  const bounds = avatarWindow.getBounds()
  dragState = { offsetX: cursor.x - bounds.x, offsetY: cursor.y - bounds.y }
})

ipcMain.on('avatar:drag-move', () => {
  if (!dragState || !avatarWindow || avatarWindow.isDestroyed()) return
  const cursor = screen.getCursorScreenPoint()
  avatarWindow.setPosition(cursor.x - dragState.offsetX, cursor.y - dragState.offsetY)
})

ipcMain.on('avatar:drag-end', () => {
  dragState = null
  if (avatarWindow && !avatarWindow.isDestroyed()) {
    const bounds = avatarWindow.getBounds()
    savePetState({ bounds })
    log(`[window] 位置已保存 @ (${bounds.x}, ${bounds.y})`)
  }
})

ipcMain.on('avatar:context-menu', popupAvatarMenu)

// 角色窗口那条 WS 的旁路（见 preload.js 的「主世界 WebSocket 旁路」）
ipcMain.on('avatar:ws-in', (_event, raw) => handleAvatarWsIn(String(raw)))

ipcMain.on('avatar:ws-state', (_event, state) => {
  log(`[ws] 连接状态: ${state}`)
  setChatStatus(state === 'open' ? '就绪' : '已断开')
})

// ---------------------------------------------------------------- 独立聊天悬浮窗

function pushChatEntry(entry) {
  const last = chatLog[chatLog.length - 1]
  // 后端会为同一句话同时发 full-text 与 audio.display_text，这里去重
  if (last && last.role === entry.role && last.text === entry.text) {
    if (entry.speak) last.speak = true
    return
  }
  chatLog.push(entry)
  if (chatLog.length > CHAT_LOG_MAX) chatLog.splice(0, chatLog.length - CHAT_LOG_MAX)
  if (chatWindow && !chatWindow.isDestroyed()) {
    chatWindow.webContents.send('chat:append', entry)
  }
}

function setChatStatus(status) {
  if (status === chatStatus) return
  chatStatus = status
  if (chatWindow && !chatWindow.isDestroyed()) {
    chatWindow.webContents.send('chat:status', status)
  }
}

/** 角色窗口那条 WS 收到的每一条消息都会经过这里 */
function handleAvatarWsIn(raw) {
  let data
  try {
    data = JSON.parse(raw)
  } catch {
    return
  }
  if (!data || typeof data.type !== 'string') return

  switch (data.type) {
    case 'set-model-and-conf': {
      // 当前角色的唯一权威来源。页面加载那一刻 #config-select 的选中项是列表第一项，
      // 并不等于真正加载的角色，所以托盘不能拿它当"当前角色"。
      const name = typeof data.conf_name === 'string' ? data.conf_name.trim() : ''
      const id = typeof data.conf_uid === 'string' ? data.conf_uid.trim() : (typeof data.character_id === 'string' ? data.character_id.trim() : '')
      let changed = false
      if (name && name !== currentCharacterName) {
        currentCharacterName = name
        changed = true
      }
      if (id && id !== currentCharacterId) {
        currentCharacterId = id
        changed = true
      }
      if (changed) {
        log(`[char] 当前角色: ${name || id} (ID: ${currentCharacterId || '未知'})`)
        refreshTrayMenu()
      }
      break
    }
    case 'full-text': {
      const text = typeof data.text === 'string' ? data.text : ''
      if (!text) break
      // 后端每次建立连接都会先发一条握手消息（见 websocket_handler.py
      // _send_initial_messages：{"type":"full-text","text":"Connection established"}），
      // 它不是角色的发言，别推进聊天记录。重连时会再发一次，所以这里始终要过滤。
      if (text.trim() === 'Connection established') break
      if (/^thinking\.\.\.$/i.test(text.trim())) {
        setChatStatus('思考中…')
        break
      }
      setChatStatus('回复中…')
      pushChatEntry({ role: 'ai', text, at: Date.now() })
      break
    }
    case 'user-input-transcription': {
      if (data.text) pushChatEntry({ role: 'user', text: String(data.text), at: Date.now() })
      break
    }
    case 'audio': {
      // 只用来标记"这句话是有语音的"，文本本身以 full-text 为准
      const spoken = data.display_text && data.display_text.text
      if (spoken) pushChatEntry({ role: 'ai', text: String(spoken), speak: true, at: Date.now() })
      setChatStatus('说话中…')
      break
    }
    case 'control': {
      if (data.text === 'conversation-chain-start') setChatStatus('思考中…')
      else if (data.text === 'conversation-chain-end') setChatStatus('就绪')
      break
    }
    case 'backend-synth-complete':
      break
    case 'error':
      setChatStatus('出错')
      if (data.text) pushChatEntry({ role: 'system', text: String(data.text), at: Date.now() })
      break
    default:
      break
  }
}

/** 把聊天窗贴在角色窗口上方居中；上方放不下就放下面，并夹回工作区 */
function positionChatWindow() {
  if (!chatWindow || chatWindow.isDestroyed()) return
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const work = display.workArea

  let x
  let y
  const height = chatHeight()
  if (avatarWindow && !avatarWindow.isDestroyed()) {
    const b = avatarWindow.getBounds()
    x = Math.round(b.x + b.width / 2 - CHAT_SIZE.width / 2)
    y = b.y - height - 10
    if (y < work.y + 4) y = Math.round(b.y + b.height + 10)
  } else {
    x = Math.round(work.x + work.width - CHAT_SIZE.width - 48)
    y = Math.round(work.y + work.height - height - 48)
  }

  x = Math.min(Math.max(x, work.x + 4), work.x + work.width - CHAT_SIZE.width - 4)
  y = Math.min(Math.max(y, work.y + 4), work.y + work.height - height - 4)
  chatWindow.setBounds({ x, y, width: CHAT_SIZE.width, height })
}

function chatHeight() {
  return chatCollapsed ? CHAT_COLLAPSED_HEIGHT : CHAT_SIZE.height
}

/**
 * 解锁聊天窗的 min/max 限制，让程序化 setSize 生效。
 *
 * 与角色窗口同一套机制：Windows 上 Electron 用「把 min/max 设为当前尺寸 +
 * 移除 WS_THICKFRAME」实现 resizable:false，会把 setSize 一起卡住（issue #42258）。
 * 这里只解锁 min/max，绝不调用 setResizable()（那会永久破坏透明，issue #51094）。
 */
function unlockChatSize() {
  if (!chatWindow || chatWindow.isDestroyed()) return
  try {
    chatWindow.setMinimumSize(1, 1)
    chatWindow.setMaximumSize(0, 0)
  } catch (error) {
    log(`[chat] 解锁尺寸失败: ${error.message}`)
  }
}

/** 收起 / 展开消息区：只改窗口高度，底边保持不动（窗是贴在角色窗口上方的） */
function applyChatCollapse() {
  if (!chatWindow || chatWindow.isDestroyed()) return
  const bounds = chatWindow.getBounds()
  const height = chatHeight()
  if (bounds.height === height) return

  const work = screen.getDisplayMatching(bounds).workArea
  const y = Math.min(
    Math.max(bounds.y + bounds.height - height, work.y + 4),
    work.y + work.height - height - 4
  )

  unlockChatSize()
  chatWindow.setBounds({ x: bounds.x, y: Math.round(y), width: CHAT_SIZE.width, height })
  log(`[chat] ${chatCollapsed ? '已收起' : '已展开'} → ${CHAT_SIZE.width}x${height}`)
}

function createChatWindow() {
  chatWindow = new BrowserWindow({
    width: CHAT_SIZE.width,
    height: chatHeight(),
    transparent: true,
    frame: false,
    hasShadow: false,
    resizable: false,
    thickFrame: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    fullscreenable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'chat-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  // 用默认层级（floating）：角色窗口是 screen-saver，稳在聊天窗之上
  chatWindow.setAlwaysOnTop(true, 'floating')
  unlockChatSize()

  chatWindow.on('blur', () => {
    if (!chatAutoHide) return
    // 给个短延迟，避免点麦克风/权限弹窗时误隐藏
    setTimeout(() => {
      if (!chatAutoHide) return
      if (chatWindow && !chatWindow.isDestroyed() && !chatWindow.isFocused()) {
        chatWindow.hide()
        refreshTrayMenu()
      }
    }, 300)
  })

  chatWindow.on('closed', () => {
    chatWindow = null
  })

  chatWindow.loadFile(path.join(__dirname, 'chat.html'))

  chatWindow.webContents.on('did-fail-load', (_event, code, description) => {
    log(`[chat] 页面加载失败 ${code} ${description}`)
  })
  chatWindow.webContents.on('render-process-gone', (_event, details) => {
    log(`[chat] 渲染进程异常: ${details.reason}`)
  })

  const reveal = (tag) => {
    if (!chatWindow || chatWindow.isDestroyed()) return
    if (chatWindow.isVisible()) return
    positionChatWindow()
    chatWindow.show()
    chatWindow.focus()
    log(`[chat] 已显示 (${tag})`)
  }

  chatWindow.webContents.once('ready-to-show', () => reveal('ready-to-show'))
  chatWindow.webContents.once('did-finish-load', () => reveal('did-finish-load'))
  // 兜底：透明窗口在个别情况下 ready-to-show 可能不触发，别让窗口一直藏着
  setTimeout(() => reveal('timeout-fallback'), 2500)
}

function showChatWindow() {
  log('[chat] 请求显示聊天窗')
  if (!chatWindow || chatWindow.isDestroyed()) {
    createChatWindow()
  } else {
    positionChatWindow()
    chatWindow.show()
    chatWindow.focus()
  }
  refreshTrayMenu()
}

function hideChatWindow() {
  if (chatWindow && !chatWindow.isDestroyed()) chatWindow.hide()
  refreshTrayMenu()
}

function toggleChatWindow() {
  if (chatWindow && !chatWindow.isDestroyed() && chatWindow.isVisible()) {
    hideChatWindow()
  } else {
    showChatWindow()
  }
}

ipcMain.handle('chat:get-log', () => ({
  entries: chatLog,
  status: chatStatus,
  collapsed: chatCollapsed,
  autoHide: chatAutoHide
}))

ipcMain.on('chat:hide', hideChatWindow)

ipcMain.on('chat:set-auto-hide', (_event, value) => {
  chatAutoHide = Boolean(value)
})

ipcMain.on('chat:set-collapsed', (_event, value) => {
  chatCollapsed = Boolean(value)
  applyChatCollapse()
})

ipcMain.on('chat:outbound', (_event, payload) => {
  if (!payload || typeof payload.type !== 'string') return
  if (!avatarWindow || avatarWindow.isDestroyed()) {
    setChatStatus('角色窗口不可用')
    return
  }
  // 中继到角色窗口，由它那条唯一的 WebSocket 发出去
  avatarWindow.webContents.send('avatar:ws-send', JSON.stringify(payload))
})

// ---------------------------------------------------------------- 设置窗口

function currentSettingsState() {
  const alive = avatarWindow && !avatarWindow.isDestroyed()
  const bounds = alive ? avatarWindow.getBounds() : { width: 0, height: 0 }
  return {
    width: bounds.width,
    height: bounds.height,
    preset: currentSize,
    framing: currentFraming,
    clickThrough: clickThroughEnabled,
    alwaysOnTop: alive ? avatarWindow.isAlwaysOnTop() : false,
    shortcutsOk: shortcuts.resize && shortcuts.settings && shortcuts.chat
  }
}

function pushSettingsState() {
  if (!settingsWindow || settingsWindow.isDestroyed()) return
  settingsWindow.webContents.send('settings:state', currentSettingsState())
}

function openSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show()
    settingsWindow.focus()
    return
  }

  // 设置用**有边框**的常规窗口：能拉伸、有标题栏、进任务栏，才找得回来。
  // （设计文档 §6.1：无框只用在角色和气泡上）
  const work = screen.getPrimaryDisplay().workArea
  settingsWindow = new BrowserWindow({
    width: 460,
    height: 600,
    x: Math.round(work.x + (work.width - 460) / 2),
    y: Math.round(work.y + (work.height - 600) / 2),
    title: '桌宠设置',
    resizable: true,
    maximizable: false,
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'settings-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  settingsWindow.loadFile(path.join(__dirname, 'settings.html'))
  settingsWindow.once('ready-to-show', () => settingsWindow.show())
  settingsWindow.on('closed', () => {
    settingsWindow = null
  })
}

ipcMain.handle('settings:get-state', () => currentSettingsState())

ipcMain.on('settings:action', (_event, payload) => {
  const type = payload && payload.type
  switch (type) {
    case 'resize':
      enterResizeMode()
      break
    case 'preset':
      resizeAvatar(payload.key)
      break
    case 'framing':
      applyFraming(payload.key)
      break
    case 'clickThrough':
      setClickThroughEnabled(Boolean(payload.value))
      break
    case 'alwaysOnTop':
      if (avatarWindow && !avatarWindow.isDestroyed()) {
        avatarWindow.setAlwaysOnTop(Boolean(payload.value), 'screen-saver')
        refreshTrayMenu()
        pushSettingsState()
      }
      break
    case 'resetPosition':
      resetPosition()
      savePetState({ bounds: avatarWindow.getBounds() })
      break
    case 'openLog':
      shell.openPath(LOG_FILE)
      break
    case 'openWebSettings':
      shell.openExternal(`${AVATAR_URL}settings.html`)
      break
    default:
      log(`[settings] 未知操作: ${type}`)
  }
})

// ---------------------------------------------------------------- 全局快捷键

const shortcuts = { resize: false, settings: false, chat: false }

function registerShortcuts() {
  // globalShortcut 是系统级独占的，被别的软件占用时会静默失败 —— 必须记下来，
  // 否则托盘菜单里显示了一个按不出效果的快捷键。
  try {
    shortcuts.resize = globalShortcut.register('CommandOrControl+Shift+R', () => {
      if (resizeFrameWindow) exitResizeMode(false)
      else enterResizeMode()
    })
    shortcuts.settings = globalShortcut.register('CommandOrControl+Shift+S', openSettingsWindow)
    shortcuts.chat = globalShortcut.register('CommandOrControl+Shift+Space', toggleChatWindow)
  } catch (error) {
    log(`[shortcut] 注册异常: ${error.message}`)
  }
  log(
    `[shortcut] Ctrl+Shift+R=${shortcuts.resize ? 'ok' : '失败'} ` +
      `Ctrl+Shift+S=${shortcuts.settings ? 'ok' : '失败'} ` +
      `Ctrl+Shift+Space=${shortcuts.chat ? 'ok' : '失败'}`
  )
  refreshTrayMenu() // 注册结果决定是否显示快捷键提示，需重绘一次
}

// ---------------------------------------------------------------- 生命周期

function quit() {
  quitting = true
  if (resizeFrameWindow && !resizeFrameWindow.isDestroyed()) resizeFrameWindow.destroy()
  if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.destroy()
  if (chatWindow && !chatWindow.isDestroyed()) chatWindow.destroy()
  stopBackend()
  app.exit(0)
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (avatarWindow && !avatarWindow.isDestroyed()) avatarWindow.showInactive()
  })

  app.whenReady().then(async () => {
    loadOverlayCss()

    // 聊天窗要用麦克风做语音输入；Electron 默认不放行 media 权限，必须显式允许。
    // 只放行 media，其余一律拒绝。
    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
      callback(permission === 'media')
    })

    log('=== 桌宠初版启动 ===')
    log(`[env] electron=${process.versions.electron} chrome=${process.versions.chrome} node=${process.versions.node}`)

    if (NO_BACKEND) {
      log('[backend] --no-backend：跳过后端检查')
    } else if (await isPortOpen()) {
      log(`[backend] ${HOST}:${PORT} 已在运行，直接复用`)
    } else {
      startBackend()
      const ready = await waitForBackend()
      log(`[backend] 就绪探测结果: ${ready ? '已就绪' : '超时（仍将尝试加载页面）'}`)
    }

    createAvatarWindow()
    createTray()
    registerShortcuts()

    app.on('activate', () => {
      if (!avatarWindow || avatarWindow.isDestroyed()) createAvatarWindow()
    })
  })

  // 托盘常驻：窗口被关掉也不退出
  app.on('window-all-closed', () => {})

  app.on('before-quit', () => {
    if (!quitting) stopBackend()
  })

  app.on('will-quit', () => {
    globalShortcut.unregisterAll()
  })
}
