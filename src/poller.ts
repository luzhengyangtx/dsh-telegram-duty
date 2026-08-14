/**
 * Long-poll loop over Telegram getUpdates with offset persistence, per-update
 * sequential acking, and exponential backoff. Idle cost is one in-flight
 * request held server-side — no tokens, no busy work.
 * @module @deepseek-ai/dsh-telegram-duty/poller
 */

import * as path from 'node:path'
import { readJson, writeJson } from './storage.ts'
import type { TelegramClient, TelegramUpdate } from './telegram.ts'

export interface PollerOptions {
  client: TelegramClient
  dataDir: string
  /** Handle one update; returning normally acks it (offset advances). */
  onUpdate: (update: TelegramUpdate) => Promise<void> | void
  /** Channel health transitions (web banner wiring). */
  onChannelState?: (up: boolean) => void
  /** Non-fatal errors (handler failures, transient Telegram errors). */
  onError?: (error: Error) => void
  longPollSeconds?: number
  maxBackoffMs?: number
  /** Smallest pause between two poll cycles (tests shorten this). */
  minIntervalMs?: number
}

interface OffsetRecord {
  nextOffset: number
}

const sleep = (ms: number): Promise<void> => new Promise<void>((resolve) => {
  setTimeout(resolve, ms)
})

/** Durable getUpdates cursor: restarts resume without losing or re-sending. */
export class Poller {
  private stopped = false
  private busy: Promise<void> = Promise.resolve()
  private nextOffset: number
  private firstStart: boolean
  private readonly offsetFile: string

  constructor(private readonly options: PollerOptions) {
    this.offsetFile = path.join(options.dataDir, 'offset.json')
    const record = readJson<OffsetRecord>(this.offsetFile, { nextOffset: -1 })
    this.nextOffset = record.nextOffset
    // -1 marks "no cursor yet": the first poll skips the pre-existing backlog
    // (old bridge-era noise) and starts from the newest update instead.
    this.firstStart = record.nextOffset === -1
  }

  /** Start the loop (idempotent). */
  start(): void {
    if (this.stopped) return
    this.busy = this.loop()
  }

  /** Ask the loop to wind down and await the in-flight cycle. */
  async stop(): Promise<void> {
    this.stopped = true
    await this.busy
  }

  private async loop(): Promise<void> {
    const longPoll = this.options.longPollSeconds ?? 25
    const maxBackoff = this.options.maxBackoffMs ?? 60_000
    const minInterval = this.options.minIntervalMs ?? 0
    let backoffMs = Math.min(1000, maxBackoff)
    while (!this.stopped) {
      try {
        const res = await this.options.client.getUpdates(this.firstStart ? 0 : this.nextOffset, longPoll)
        if (!res.ok) throw new Error(`getUpdates rejected: ${res.description ?? 'unknown error'}`)
        this.options.onChannelState?.(true)
        backoffMs = Math.min(1000, maxBackoff)
        const updates = res.result ?? []
        if (this.firstStart) {
          // First run: fast-forward past whatever was queued before the plugin
          // existed (e.g. old notify-bridge replies) instead of replaying it.
          for (const update of updates) this.nextOffset = Math.max(this.nextOffset, update.update_id + 1)
          this.firstStart = false
          writeJson(this.offsetFile, { nextOffset: this.nextOffset })
          if (this.stopped) return
          if (minInterval > 0) await sleep(minInterval)
          continue
        }
        // Finish the whole fetched batch even when stop() raced the poll:
        // every processed update persists its offset, so nothing is lost.
        for (const update of updates) {
          this.nextOffset = Math.max(this.nextOffset, update.update_id + 1)
          try {
            await this.options.onUpdate(update)
          } catch (error) {
            // Poisoned updates are acked (logged) rather than retried forever.
            this.options.onError?.(error instanceof Error ? error : new Error(String(error)))
          }
          writeJson(this.offsetFile, { nextOffset: this.nextOffset })
        }
        if (this.stopped) return
        if (minInterval > 0) await sleep(minInterval)
      } catch (error) {
        this.options.onChannelState?.(false)
        this.options.onError?.(error instanceof Error ? error : new Error(String(error)))
        await sleep(backoffMs)
        backoffMs = Math.min(backoffMs * 2, maxBackoff)
      }
    }
  }
}
