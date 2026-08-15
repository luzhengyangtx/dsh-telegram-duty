import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveRuntime } from '../src/index.ts'
import { Config } from '../src/config.ts'

describe('config', () => {
  let dir: string
  let credentialsFile: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-duty-config-'))
    credentialsFile = path.join(dir, 'config.json')
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('applies schema defaults', () => {
    const resolved = Config({})
    expect(resolved).toMatchObject({
      token: '',
      chatId: 0,
      proxy: '',
      sessionId: 'telegram-duty',
      dutyCwd: '',
      dataDir: '',
      credentialsFile: '',
      language: 'en',
      approvalTimeoutMinutes: 10,
      replyChunkChars: 3800,
    })
  })

  it('explicit schema values win over the credentials file', () => {
    fs.writeFileSync(credentialsFile, JSON.stringify({ token: 'from-file', chat_id: 111 }), 'utf-8')
    const runtime = resolveRuntime({ token: 'explicit', chatId: 222, credentialsFile })
    expect(runtime.token).toBe('explicit')
    expect(runtime.chatId).toBe(222)
  })

  it('falls back to the credentials file for empty fields', () => {
    fs.writeFileSync(credentialsFile, JSON.stringify({ token: 'from-file', chat_id: 333 }), 'utf-8')
    const runtime = resolveRuntime({ credentialsFile })
    expect(runtime.token).toBe('from-file')
    expect(runtime.chatId).toBe(333)
  })

  it('stays empty when both sources are missing', () => {
    const runtime = resolveRuntime({ credentialsFile: path.join(dir, 'absent.json') })
    expect(runtime.token).toBe('')
    expect(runtime.chatId).toBe(0)
  })

  it('tolerates a malformed credentials file', () => {
    fs.writeFileSync(credentialsFile, '{broken', 'utf-8')
    const runtime = resolveRuntime({ token: 'explicit', chatId: 42, credentialsFile })
    expect(runtime.token).toBe('explicit')
    expect(runtime.chatId).toBe(42)
  })
})
