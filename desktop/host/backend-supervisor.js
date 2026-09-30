'use strict'

const fs = require('node:fs')
const net = require('node:net')
const path = require('node:path')
const { spawn } = require('node:child_process')

function createBackendSupervisor({ projectRoot, host, port, log }) {
  let processHandle = null
  let startedByUs = false

  function isPortOpen() {
    return new Promise((resolve) => {
      const socket = net.connect({ host, port })
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

  function startBackend() {
    const venvPython = path.join(projectRoot, '.venv', 'Scripts', 'python.exe')
    const command = fs.existsSync(venvPython) ? venvPython : 'uv'
    const args = command === 'uv' ? ['run', 'python'] : []
    log(`[backend] 拉起 ${command} run_server.py`)
    const child = spawn(command, [...args, 'run_server.py'], {
      cwd: projectRoot,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
    })
    processHandle = child
    startedByUs = true

    // Python owns detailed backend logs. Drain pipes without saving another copy.
    child.stdout.resume()
    child.stderr.resume()
    child.on('error', (error) => {
      log(`[backend] 启动失败: ${error.message}`)
      if (processHandle === child) processHandle = null
    })
    child.on('exit', (code, signal) => {
      log(`[backend] 已退出 code=${code} signal=${signal}`)
      if (processHandle === child) processHandle = null
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
    if (!startedByUs || !processHandle) return
    log('[backend] 关闭由本进程拉起的后端')
    try {
      processHandle.kill()
    } catch (error) {
      log(`[backend] 关闭异常: ${error.message}`)
    }
    processHandle = null
  }

  return { isPortOpen, startBackend, waitForBackend, stopBackend }
}

module.exports = { createBackendSupervisor }
