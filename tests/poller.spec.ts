import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Poller } from '../src/poller.ts'
import type { TelegramClient, TelegramResponse, TelegramUpdate } from '../src/telegram.ts'

/** Fake Telegram client: scripted responses per call index. */
function fakeClient(responses: Array<TelegramResponse<TelegramUpdate[]>>): TelegramClient {
  let index = 0
  return {
    getUpdates: vi.fn(async () => {
      const res = responses[Math.min(index, responses.length - 1)] ?? { ok: true, result: [] }
      index += 1
      return res
    }),
    sendMessage: vi.fn(),
    getMe: vi.fn(),
    close: vi.fn(),
  } as unknown as TelegramClient
}

function update(id: number, text = 'hi'): TelegramUpdate {
  return { update_id: id, message: { message_id: id, chat: { id: 1 }, text } }
}

describe('Poller', () => {
  let dir: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-duty-poller-'))
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('starts from the persisted offset', async () => {
    fs.writeFileSync(path.join(dir, 'offset.json'), JSON.stringify({ nextOffset: 9 }), 'utf-8')
    const client = fakeClient([{ ok: true, result: [update(11)] }])
    const poller = new Poller({ client, dataDir: dir, onUpdate: () => undefined, minIntervalMs: 1 })
    poller.start()
    await poller.stop()
    expect(client.getUpdates).toHaveBeenCalledWith(9, expect.any(Number))
  })

  it('fast-forwards past the backlog on the very first run', async () => {
    const client = fakeClient([{ ok: true, result: [update(10), update(12)] }])
    const handled: number[] = []
    const poller = new Poller({
      client,
      dataDir: dir,
      onUpdate: (u) => {
        handled.push(u.update_id)
      },
      minIntervalMs: 1,
    })
    poller.start()
    await poller.stop()
    // Old queued updates are skipped, never handed to the handler.
    expect(handled).toEqual([])
    const record = JSON.parse(fs.readFileSync(path.join(dir, 'offset.json'), 'utf-8')) as { nextOffset: number }
    expect(record.nextOffset).toBe(13)
    expect(client.getUpdates).toHaveBeenCalledWith(0, expect.any(Number))
  })

  it('advances and persists the offset per update', async () => {
    fs.writeFileSync(path.join(dir, 'offset.json'), JSON.stringify({ nextOffset: 0 }), 'utf-8')
    const client = fakeClient([{ ok: true, result: [update(3), update(5)] }])
    const handled: number[] = []
    const poller = new Poller({
      client,
      dataDir: dir,
      onUpdate: (u) => {
        handled.push(u.update_id)
      },
      minIntervalMs: 1,
    })
    poller.start()
    await poller.stop()
    expect(handled).toEqual([3, 5])
    const record = JSON.parse(fs.readFileSync(path.join(dir, 'offset.json'), 'utf-8')) as { nextOffset: number }
    expect(record.nextOffset).toBe(6)
  })

  it('acks a poisoned update and keeps polling', async () => {
    fs.writeFileSync(path.join(dir, 'offset.json'), JSON.stringify({ nextOffset: 0 }), 'utf-8')
    const onError = vi.fn()
    const client = fakeClient([{ ok: true, result: [update(7)] }, { ok: true, result: [] }])
    const poller = new Poller({
      client,
      dataDir: dir,
      onUpdate: () => {
        throw new Error('handler blew up')
      },
      onError,
      minIntervalMs: 1,
    })
    poller.start()
    await poller.stop()
    expect(onError).toHaveBeenCalledTimes(1)
    const record = JSON.parse(fs.readFileSync(path.join(dir, 'offset.json'), 'utf-8')) as { nextOffset: number }
    expect(record.nextOffset).toBe(8)
  })

  it('reports the channel down and back up with backoff', async () => {
    const states: boolean[] = []
    const client = fakeClient([
      { ok: false, description: 'flood' },
      { ok: false, description: 'flood' },
      { ok: true, result: [] },
    ])
    const poller = new Poller({
      client,
      dataDir: dir,
      onUpdate: () => undefined,
      onChannelState: (up) => {
        states.push(up)
      },
      maxBackoffMs: 5,
      minIntervalMs: 1,
    })
    poller.start()
    // Let the loop chew through the scripted responses and recover.
    await vi.waitFor(() => {
      expect(states).toContain(true)
    })
    await poller.stop()
    expect(states[0]).toBe(false)
  })

  it('stop() settles the in-flight cycle', async () => {
    const client = fakeClient([{ ok: true, result: [update(1)] }])
    const poller = new Poller({ client, dataDir: dir, onUpdate: () => undefined, minIntervalMs: 1 })
    poller.start()
    const stopped = poller.stop()
    await expect(stopped).resolves.toBeUndefined()
  })
})
