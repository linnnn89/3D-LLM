'use strict'

function createShortcutManager({ globalShortcut, log, onResize, onSettings, onChat, onRegistered }) {
  const shortcuts = { resize: false, settings: false, chat: false }

  function registerShortcuts() {
    // Global shortcuts can fail silently when another app owns the key.
    try {
      shortcuts.resize = globalShortcut.register('CommandOrControl+Shift+R', onResize)
      shortcuts.settings = globalShortcut.register('CommandOrControl+Shift+S', onSettings)
      shortcuts.chat = globalShortcut.register('CommandOrControl+Shift+Space', onChat)
    } catch (error) {
      log(`[shortcut] 注册异常: ${error.message}`)
    }
    log(
      `[shortcut] Ctrl+Shift+R=${shortcuts.resize ? 'ok' : '失败'} ` +
        `Ctrl+Shift+S=${shortcuts.settings ? 'ok' : '失败'} ` +
        `Ctrl+Shift+Space=${shortcuts.chat ? 'ok' : '失败'}`
    )
    onRegistered()
  }

  return { shortcuts, registerShortcuts }
}

module.exports = { createShortcutManager }
