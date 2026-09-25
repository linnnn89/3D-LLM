'use strict'

const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { createLogger } = require('./logger')

test('closed console pipe does not stop the file log', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-log-'))
  try {
    const file = path.join(dir, 'desktop.log')
    const output = { log() { throw Object.assign(new Error('broken pipe'), { code: 'EPIPE' }) } }
    const stdout = new EventEmitter()
    const log = createLogger(file, output, stdout)
    log('first')
    log('second')
    assert.match(fs.readFileSync(file, 'utf8'), /first\n.*second\n/s)
    stdout.emit('error', Object.assign(new Error('broken pipe'), { code: 'EPIPE' }))
    log('third')
    assert.match(fs.readFileSync(file, 'utf8'), /third\n$/)
  } finally {
    fs.unlinkSync(path.join(dir, 'desktop.log'))
    fs.rmdirSync(dir)
  }
})
