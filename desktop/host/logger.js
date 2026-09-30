'use strict'

const fs = require('node:fs')
const path = require('node:path')

function createLogger(logFile, output = console, stdout = process.stdout) {
  let consoleAvailable = true
  stdout.on('error', (error) => {
    // A GUI process can outlive the shell or test runner that launched it.
    // Keep the file log working after its inherited console pipe closes.
    if (error.code === 'EPIPE') consoleAvailable = false
  })

  // Serialize async writes and cap pending memory if storage becomes slow.
  let pending = 0
  let writes = Promise.resolve()
  function log(message) {
    const line = `${new Date().toISOString()} ${String(message).slice(0, 32768)}`
    if (consoleAvailable) {
      try {
        output.log(line)
      } catch (error) {
        if (error.code === 'EPIPE') consoleAvailable = false
        else throw error
      }
    }
    if (pending >= 256) return
    pending++
    writes = writes.then(async () => {
      await fs.promises.mkdir(path.dirname(logFile), { recursive: true })
      const bytes = Buffer.byteLength(line + '\n')
      const size = await fs.promises.stat(logFile).then(stat => stat.size, () => 0)
      if (size + bytes > 2 * 1024 * 1024) {
        await fs.promises.rm(logFile + '.3', { force: true })
        for (let i = 2; i >= 0; i--) {
          const from = i ? logFile + '.' + i : logFile
          try { await fs.promises.rename(from, logFile + '.' + (i + 1)) }
          catch (error) { if (error.code !== 'ENOENT') throw error }
        }
      }
      await fs.promises.appendFile(logFile, line.slice(0, 32768) + '\n')
    }).catch(() => {}).finally(() => { pending-- })
  }
  log.flush = () => writes
  return log
}

module.exports = { createLogger }
