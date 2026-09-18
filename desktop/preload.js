/*
 * 桌宠视口 preload
 *
 * 职责：在「不修改 vrm_frontend/ 源码」的前提下，把窗口拖动能力叠加到页面上。
 *
 * 设计要点（见 doc/desktop_pet_ui_design_20260918.md §4）：
 *   1. 不使用 `app-region: drag` —— 它会吞掉区域内所有指针事件，点击角色就废了。
 *   2. 用「位移阈值」区分点击与拖动：< 6px 视为点击，交给页面自己的 raycast 处理；
 *      >= 6px 进入拖动模式，通过 IPC 让主进程移动窗口。
 *   3. 一旦进入拖动模式，用 capture 阶段的 stopImmediatePropagation 掐掉
 *      页面里 OrbitControls 的指针事件，避免「窗口移动 + 相机旋转」双重效果。
 *      （isolated world 与主世界共享同一套 DOM 事件派发，所以这一招有效）
 */

const { ipcRenderer } = require('electron')

ipcRenderer.send('avatar:log', `[preload] 已加载 (readyState=${document.readyState})`)

// ---------------------------------------------------------------- 主世界 WebSocket 旁路
//
// 为什么需要它：
//   独立的聊天窗必须复用**这一条** WebSocket 连接。后端每条 /client-ws 连接都会克隆一份
//   ServiceContext（各自的 history_uid），开第二条会导致上下文分叉，而且 TTS 音频只会推给
//   其中一条 —— 角色就不会说话了。
//
// 难点：
//   页面的 `ws` 变量在 app.js 的模块作用域里，外部拿不到；而 preload 跑在隔离世界，
//   `window.WebSocket` 与主世界的不是同一个对象，直接改也没用。
//
// 解法（三跳，全程不改 vrm_frontend 源码）：
//   1. preload 往文档里插一个 <script>，它在**主世界**执行，包装 window.WebSocket；
//   2. 主世界 → 隔离世界：用 DOM CustomEvent（两个世界共享同一套 DOM 事件派发）；
//   3. 隔离世界 → 主进程：ipcRenderer。
//
// 注意注入时机：app.js 是 type="module"（默认 defer），在文档解析后才执行；
// 而 preload 在 readyState=loading 时就开始跑，所以包装一定先于页面的 new WebSocket()。

function installMainWorldWebSocketTee() {
  function patch() {
    if (window.__petWsTeeInstalled) return
    window.__petWsTeeInstalled = true

    const Native = window.WebSocket

    // 只做"包装"，底层仍是原生 socket，页面的收发逻辑完全不变
    function Wrapped(url, protocols) {
      const socket =
        protocols === undefined ? new Native(url) : new Native(url, protocols)
      window.__petSocket = socket

      socket.addEventListener('message', (event) => {
        window.dispatchEvent(
          new CustomEvent('__pet-ws-in', { detail: String(event.data) })
        )
      })
      socket.addEventListener('open', () => {
        window.dispatchEvent(new CustomEvent('__pet-ws-state', { detail: 'open' }))
      })
      socket.addEventListener('close', () => {
        window.dispatchEvent(new CustomEvent('__pet-ws-state', { detail: 'closed' }))
      })

      return socket
    }

    Wrapped.prototype = Native.prototype
    Wrapped.CONNECTING = Native.CONNECTING
    Wrapped.OPEN = Native.OPEN
    Wrapped.CLOSING = Native.CLOSING
    Wrapped.CLOSED = Native.CLOSED

    Object.defineProperty(window, 'WebSocket', {
      configurable: true,
      writable: true,
      value: Wrapped
    })

    // 隔离世界通过这个事件请求"代发一条消息"
    window.addEventListener('__pet-ws-out', (event) => {
      const socket = window.__petSocket
      if (socket && socket.readyState === 1) socket.send(event.detail)
    })

    window.dispatchEvent(
      new CustomEvent('__pet-ws-tee', { detail: document.readyState })
    )
  }

  const source = `(${patch.toString()})()`
  let done = false

  function tryInstall(tag) {
    if (done) return true
    // 关键：preload 跑在文档最早期，此刻 documentElement / head 可能还不存在。
    // 上一版就是在这里 appendChild(null) 抛异常，把整个 preload 后续代码全带崩了。
    const parent = document.head || document.documentElement
    if (!parent) return false
    try {
      const el = document.createElement('script')
      el.textContent = source
      parent.appendChild(el)
      el.remove()
      done = true
      ipcRenderer.send('avatar:log', `[preload] WS 旁路已注入 (${tag})`)
      return true
    } catch (error) {
      done = true // 不再重试，避免刷屏
      ipcRenderer.send('avatar:log', `[preload] WS 旁路注入失败: ${error.message}`)
      return true
    }
  }

  if (tryInstall('immediate')) return

  // documentElement 尚未创建。readyState 变为 'interactive' 发生在 defer 脚本
  // 执行**之前**，是最后一个可靠的时机；同时用定时器做快速重试。
  document.addEventListener('readystatechange', function onState() {
    if (tryInstall('readystatechange:' + document.readyState)) {
      document.removeEventListener('readystatechange', onState)
    }
  })
  let attempts = 0
  const tick = () => {
    if (tryInstall('retry#' + attempts) || attempts++ > 40) return
    setTimeout(tick, 0)
  }
  setTimeout(tick, 0)
}

try {
  installMainWorldWebSocketTee()
} catch (error) {
  ipcRenderer.send('avatar:log', `[preload] WS 旁路安装异常: ${error.message}`)
}

// 主世界 → 隔离世界 → 主进程
window.addEventListener('__pet-ws-in', (event) => {
  ipcRenderer.send('avatar:ws-in', event.detail)
})
window.addEventListener('__pet-ws-state', (event) => {
  ipcRenderer.send('avatar:ws-state', event.detail)
})
window.addEventListener('__pet-ws-tee', (event) => {
  ipcRenderer.send('avatar:log', `[preload] 主世界 WebSocket 已包装 (readyState=${event.detail})`)
})

// 主进程 → 隔离世界 → 主世界（代发）
ipcRenderer.on('avatar:ws-send', (_event, payload) => {
  window.dispatchEvent(new CustomEvent('__pet-ws-out', { detail: payload }))
})

const DRAG_THRESHOLD_PX = 6
const DRAG_MOVE_INTERVAL_MS = 16 // 限流 ~60fps，避免 IPC 洪泛

let pressPoint = null
let dragging = false
let lastMoveAt = 0
let pointerAliveReported = false
let moveCount = 0

/**
 * 收到首个真实 pointermove 时通知主进程。
 *
 * 这是「forward 转发确实可用」的唯一证据 —— 主进程只有在拿到它之后才敢开启
 * 点击穿透。否则一旦 forward 失效，穿透后收不到任何鼠标事件，页面里的 raycast
 * 永远不会再跑，角色就再也点不动了（死锁）。
 */
function reportAlive() {
  if (pointerAliveReported) return
  pointerAliveReported = true
  ipcRenderer.send('avatar:pointer-alive')
}

window.addEventListener(
  'pointerdown',
  (event) => {
    if (event.button !== 0) return
    pressPoint = { x: event.clientX, y: event.clientY }
    dragging = false
  },
  true
)

window.addEventListener(
  'pointermove',
  (event) => {
    moveCount += 1
    if (moveCount === 1 || moveCount === 10 || moveCount === 100 || moveCount === 1000) {
      ipcRenderer.send('avatar:log', `[preload] pointermove 累计 ${moveCount}`)
    }
    reportAlive()
    if (!pressPoint) return

    if (!dragging) {
      const dx = event.clientX - pressPoint.x
      const dy = event.clientY - pressPoint.y
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return

      dragging = true
      ipcRenderer.send('avatar:drag-start')
    }

    // 拖动期间不再让页面处理指针事件（掐掉 OrbitControls）
    event.stopImmediatePropagation()

    const now = performance.now()
    if (now - lastMoveAt < DRAG_MOVE_INTERVAL_MS) return
    lastMoveAt = now
    ipcRenderer.send('avatar:drag-move')
  },
  true
)

function endDrag(event) {
  if (dragging) {
    if (event) event.stopImmediatePropagation()
    ipcRenderer.send('avatar:drag-end')
  }
  pressPoint = null
  dragging = false
}

window.addEventListener('pointerup', endDrag, true)
window.addEventListener('pointercancel', endDrag, true)

// 右键菜单交给主进程用原生 Menu.popup() 绘制
window.addEventListener(
  'contextmenu',
  (event) => {
    event.preventDefault()
    ipcRenderer.send('avatar:context-menu')
  },
  true
)

// ---------------------------------------------------------------- 角色命中区域探测
//
// 关键：不修改 vrm_frontend 源码拿到「鼠标是否在角色身上」。
//
// vrm_frontend/app.js:1143-1155 每次 pointermove 都会对 VRM 网格做 raycast，
// 并把结果写进 canvas 的**内联样式**：命中 → 'pointer'，未命中 → 'default'。
// 所以只要读 canvas.style.cursor 就等于拿到了精确的逐像素命中结果。
//
// 主进程据此切换 setIgnoreMouseEvents：
//   在角色上   → 取消穿透（可点击、可拖动）
//   不在角色上 → 恢复穿透（点到桌面/下层窗口）
//
// 注意必须周期性上报「当前状态」而不是只在变化时上报 —— 主进程需要持续收到
// 「仍然在角色上」的信号来做宽限期，否则会在角色上误判为离开。

const HOVER_POLL_MS = 100
let hoverTimer = null
let hoverObserver = null

/**
 * 读取当前命中状态并上报。
 *
 * canvas 是 three.js 在 app.js 模块执行时才插入 DOM 的，比 DOMContentLoaded 晚，
 * 所以这里做惰性挂载：第一次拿到 canvas 时再挂 MutationObserver。
 */
function reportHover() {
  const canvas = document.querySelector('#canvas-container canvas')
  if (!canvas) return // 还没渲染出来，下一轮再试

  if (!hoverObserver) {
    hoverObserver = new MutationObserver(reportHover)
    hoverObserver.observe(canvas, { attributes: true, attributeFilter: ['style'] })
    ipcRenderer.send('avatar:log', '[preload] canvas 已出现，命中探测已挂载')
  }

  // 页面还没跑过 raycast 时 cursor 为空字符串，此时不算命中
  ipcRenderer.send('avatar:hover-state', canvas.style.cursor === 'pointer')
}

function startHoverProbe() {
  if (hoverTimer) return
  ipcRenderer.send('avatar:log', `[preload] 启动命中探测 (readyState=${document.readyState})`)
  hoverTimer = setInterval(reportHover, HOVER_POLL_MS)
  reportHover()
}

startHoverProbe()

