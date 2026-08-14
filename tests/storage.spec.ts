import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readJson, writeJson } from '../src/storage.ts'

describe('storage', () => {
  let dir: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-duty-storage-'))
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('readJson returns the fallback for a missing file', () => {
    expect(readJson(path.join(dir, 'nope.json'), { a: 1 })).toEqual({ a: 1 })
  })

  it('readJson returns the fallback for malformed content', () => {
    const file = path.join(dir, 'broken.json')
    fs.writeFileSync(file, '{not json', 'utf-8')
    expect(readJson(file, { a: 1 })).toEqual({ a: 1 })
  })

  it('writeJson + readJson round-trips', () => {
    const file = path.join(dir, 'ok.json')
    writeJson(file, { nextOffset: 7 })
    expect(readJson(file, { nextOffset: 0 })).toEqual({ nextOffset: 7 })
  })

  it('writeJson creates missing parent directories', () => {
    const file = path.join(dir, 'deep', 'nested', 'ok.json')
    writeJson(file, { value: true })
    expect(fs.existsSync(file)).toBe(true)
  })
})
