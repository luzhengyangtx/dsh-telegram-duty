/**
 * Small atomic-JSON persistence helpers shared by the poller (offset) and the
 * duty toggle (state). Writes go through a tmp file + rename so a crash never
 * leaves a torn document.
 * @module @deepseek-ai/dsh-telegram-duty/storage
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

/** Read and parse a JSON file, falling back when missing or malformed. */
export function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as T
  } catch {
    return fallback
  }
}

/** Atomically write a JSON document (tmp + rename). */
export function writeJson(file: string, value: unknown): void {
  const dir = path.dirname(file)
  fs.mkdirSync(dir, { recursive: true })
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf-8')
  fs.renameSync(tmp, file)
}
