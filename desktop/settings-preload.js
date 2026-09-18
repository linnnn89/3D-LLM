/*
 * 设置窗口的 preload
 */

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('petSettings', {
  getState: () => ipcRenderer.invoke('settings:get-state'),
  action: (payload) => ipcRenderer.send('settings:action', payload),
  onState: (handler) => ipcRenderer.on('settings:state', (_event, state) => handler(state))
})
