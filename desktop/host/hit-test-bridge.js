'use strict'

function createHitTestBridge({ getWindow, isFullUi, isDragging, log, onPreferenceChanged }) {
  let enabled = true
  let pointerAlive = false
  let interactive = true
  let hoverSynced = false
  let leaveTicks = 0
  const leaveTicksToDisable = 3

  function applyIgnoreMouseEvents(ignore) {
    if (isFullUi()) return
    const window = getWindow()
    if (!window || window.isDestroyed()) return
    try {
      if (ignore) window.setIgnoreMouseEvents(true, { forward: true })
      else window.setIgnoreMouseEvents(false)
    } catch (error) {
      log(`[hit] setIgnoreMouseEvents 失败: ${error.message}`)
    }
  }

  function restoreClickThrough(reason) {
    if (isFullUi()) return
    interactive = false
    leaveTicks = 0
    applyIgnoreMouseEvents(true)
    if (reason) log(`[hit] ${reason} → 恢复穿透`)
  }

  function onHoverState(hovering) {
    if (isFullUi()) return
    const window = getWindow()
    if (!window || window.isDestroyed()) return
    if (!enabled || isDragging() || !pointerAlive) return

    // The first report establishes the real pointer hit state before enabling passthrough.
    if (!hoverSynced) {
      hoverSynced = true
      if (hovering) {
        interactive = true
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
      if (!interactive) {
        interactive = true
        applyIgnoreMouseEvents(false)
        log('[hit] 鼠标进入角色 → 取消穿透')
      }
      return
    }

    if (!interactive) return
    leaveTicks += 1
    if (leaveTicks >= leaveTicksToDisable) restoreClickThrough('鼠标离开角色')
  }

  function setEnabled(value) {
    if (isFullUi()) return
    enabled = Boolean(value)
    log(`[hit] 点击穿透 ${enabled ? '已开启' : '已关闭'}`)
    if (!enabled) {
      interactive = true
      leaveTicks = 0
      applyIgnoreMouseEvents(false)
    } else if (pointerAlive) {
      restoreClickThrough('重新开启穿透')
    }
    onPreferenceChanged()
  }

  return {
    isEnabled: () => enabled,
    markPointerAlive() {
      if (isFullUi() || pointerAlive) return
      pointerAlive = true
      log('[hit] 已确认 mouse move 转发可用（focusable:false 下鼠标事件可达）→ 启用点击穿透')
    },
    onHoverState,
    resetWindowState() {
      pointerAlive = false
      interactive = true
      hoverSynced = false
      leaveTicks = 0
    },
    setEnabled,
  }
}

module.exports = { createHitTestBridge }
