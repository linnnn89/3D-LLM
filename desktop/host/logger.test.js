'use strict'

const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { createLogger } = require('./logger')

test('closed console pipe does not stop the file log', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-log-'))
  try {
    const file = path.join(dir, 'desktop.log')
    const output = { log() { throw Object.assign(new Error('broken pipe'), { code: 'EPIPE' }) } }
    const stdout = new EventEmitter()
    const log = createLogger(file, output, stdout)
    log('first')
    log('second')
    await log.flush()
    assert.match(fs.readFileSync(file, 'utf8'), /first\n.*second\n/s)
    stdout.emit('error', Object.assign(new Error('broken pipe'), { code: 'EPIPE' }))
    log('third')
    await log.flush()
    assert.match(fs.readFileSync(file, 'utf8'), /third\n$/)
    fs.writeFileSync(file, Buffer.alloc(2 * 1024 * 1024, 'x'))
    for (let i = 0; i < 4; i++) {
      log('rotated-' + i)
      await log.flush()
      if (i < 3) fs.writeFileSync(file, Buffer.alloc(2 * 1024 * 1024, 'x'))
    }
    assert.equal(fs.existsSync(file + '.4'), false)
    for (const suffix of ['.1', '.2', '.3']) assert.equal(fs.statSync(file + suffix).size, 2 * 1024 * 1024)
    assert.match(fs.readFileSync(file, 'utf8'), /rotated-3/)
  } finally {
    for (const file of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, file))
    fs.rmdirSync(dir)
  }
})
