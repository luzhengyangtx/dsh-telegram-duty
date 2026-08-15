/**
 * Dump ALL zstd frames of a duty-session log (frame-by-frame).
 * Usage: node --import tsx/esm scripts/session-peek.ts <path-to-session.jsonl.zstd>
 */

import * as fs from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'

const file = process.argv[2]
if (file === undefined || file === '') {
  console.error('usage: session-peek.ts <path-to-session.jsonl.zstd>')
  process.exit(1)
}
const raw = fs.readFileSync(file)
const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

// Locate every zstd frame boundary.
const starts: number[] = []
for (let i = 0; i <= raw.length - 4; i++) {
  if (raw[i] === MAGIC[0] && raw[i + 1] === MAGIC[1] && raw[i + 2] === MAGIC[2] && raw[i + 3] === MAGIC[3]) {
    starts.push(i)
  }
}
console.log(`file size: ${raw.length} bytes, zstd frames: ${starts.length}`)

const allLines: string[] = []
for (let f = 0; f < starts.length; f++) {
  const start = starts[f] ?? 0
  const end = starts[f + 1] ?? raw.length
  try {
    const text = zstdDecompressSync(raw.subarray(start, end)).toString('utf-8')
    allLines.push(...text.split('\n').filter(line => line !== ''))
  } catch (error) {
    console.log(`frame ${f} decompress failed:`, error instanceof Error ? error.message : error)
  }
}

console.log(`total events: ${allLines.length}`)
for (const line of allLines.slice(-20)) {
  const event = JSON.parse(line) as { type?: string; data?: unknown }
  const type = event.type ?? '?'
  if (type === 'assistant/message') {
    const data = event.data as { message?: { content?: Array<{ type?: string; text?: string }> } }
    const textBlocks = (data.message?.content ?? []).filter(b => b.type === 'text').map(b => b.text ?? '')
    console.log(`[${type}] ${textBlocks.join('').slice(0, 400)}`)
  } else if (type === 'user/message') {
    const data = event.data as { content?: Array<{ type?: string; text?: string }>; source?: { kind?: string } }
    const textBlocks = (data.content ?? []).filter(b => b.type === 'text').map(b => b.text ?? '')
    console.log(`[${type}] source=${data.source?.kind} ${textBlocks.join('').slice(0, 150)}`)
  } else if (type === 'turn/end') {
    console.log(`[${type}] ${JSON.stringify(event.data)}`)
  } else if (type === 'tool/call' || type === 'tool/result') {
    const data = event.data as { name?: string }
    console.log(`[${type}] ${data.name ?? ''} ${JSON.stringify(event.data).slice(0, 200)}`)
  } else {
    console.log(`[${type}]`)
  }
}
