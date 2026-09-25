'use strict'

const fs = require('node:fs')
const path = require('node:path')

function createAppState({ app, screen, log }) {
  const stateFile = () => path.join(app.getPath('userData'), 'pet-state.json')

  function loadPetState() {
    try {
      return JSON.parse(fs.readFileSync(stateFile(), 'utf8'))
    } catch {
      return {}
    }
  }

  function savePetState(patch) {
    try {
      const next = { ...loadPetState(), ...patch }
      fs.mkdirSync(path.dirname(stateFile()), { recursive: true })
      fs.writeFileSync(stateFile(), JSON.stringify(next, null, 2))
    } catch (error) {
      log(`[state] 保存失败: ${error.message}`)
    }
  }

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
    const work = display.workArea
    target.x = Math.min(Math.max(target.x, work.x), work.x + work.width - target.width)
    target.y = Math.min(Math.max(target.y, work.y), work.y + work.height - target.height)
    return target
  }

  return { loadPetState, savePetState, restoreSavedBounds }
}

module.exports = { createAppState }
