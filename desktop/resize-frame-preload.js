/*
 * 拉伸框窗口的 preload
 *
 * 这个窗口是我们自己写的，DOM 完全可控，所以命中判定不需要 raycast ——
 * 直接用 Electron 官方推荐的 mouseenter / mouseleave 切换 setIgnoreMouseEvents 即可。
 */

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('resizeApi', {
  /** 主进程下发初始矩形（屏幕 DIP 坐标）与工作区原点 */
  onInit: (handler) => ipcRenderer.on('resize:init', (_event, payload) => handler(payload)),

  /** 请求取消（等同按 Esc / 点取消） */
  cancel: () => ipcRenderer.send('resize:cancel'),

  /** 确认新矩形（屏幕 DIP 坐标） */
  commit: (rect) => ipcRenderer.send('resize:commit', rect),

  /**
   * 上报「鼠标是否在可交互区域上」。
   * 主进程据此切换 setIgnoreMouseEvents：框外一律穿透，不挡住桌面。
   */
  hover: (interactive) => ipcRenderer.send('resize:hover', interactive)
})
