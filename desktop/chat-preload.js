/*
 * 独立聊天悬浮窗的 preload
 *
 * 这个窗口**没有** WebSocket。所有收发都经 ipcRenderer 交给主进程，
 * 再由主进程中继到角色窗口那条唯一的 /client-ws 连接。
 * （原因见 main.js 里 chatWindow 附近的注释）
 */

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('petChat', {
  /** 拉取历史消息与窗口状态（窗口是常驻的，隐藏期间的消息也会累积在主进程） */
  getLog: () => ipcRenderer.invoke('chat:get-log'),

  sendText: (text) => ipcRenderer.send('chat:outbound', { type: 'text-input', text }),

  interrupt: () =>
    ipcRenderer.send('chat:outbound', { type: 'interrupt-signal', text: 'interrupt' }),

  /** 语音输入：与 vrm_frontend/app.js 完全一致的格式（16kHz 单声道 float32 块） */
  sendAudioChunk: (samples) =>
    ipcRenderer.send('chat:outbound', { type: 'mic-audio-data', audio: samples }),

  endAudio: () => ipcRenderer.send('chat:outbound', { type: 'mic-audio-end' }),

  hide: () => ipcRenderer.send('chat:hide'),

  setAutoHide: (value) => ipcRenderer.send('chat:set-auto-hide', value),

  /** 收起 / 展开消息区（窗口高度随之变化） */
  setCollapsed: (value) => ipcRenderer.send('chat:set-collapsed', value),

  onAppend: (handler) => ipcRenderer.on('chat:append', (_event, entry) => handler(entry)),
  onStatus: (handler) => ipcRenderer.on('chat:status', (_event, status) => handler(status))
})
