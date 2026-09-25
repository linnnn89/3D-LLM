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

  return function log(message) {
    const line = `${new Date().toISOString()} ${message}`
    if (consoleAvailable) {
      try {
        output.log(line)
      } catch (error) {
        if (error.code === 'EPIPE') consoleAvailable = false
        else throw error
      }
    }
    try {
      fs.mkdirSync(path.dirname(logFile), { recursive: true })
      fs.appendFileSync(logFile, line + '\n')
    } catch {
      /* 日志失败不影响主流程 */
    }
  }
}

module.exports = { createLogger }
