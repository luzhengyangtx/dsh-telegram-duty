/**
 * Telegram question channel for ordinary agent questions (choices,
 * confirmations, missing information): pushes the question to the user's
 * phone with one inline button per option and waits for the answer. Text
 * replies matching an option label work as a fallback.
 * @module @luzhengyangtx/dsh-telegram-duty/ask
 */

import type { Strings } from './i18n.ts'
import type { InlineKeyboard } from './telegram.ts'

export interface TelegramAsk {
  question: string
  options: string[]
  signal?: AbortSignal
}

export interface TelegramAskOutcome {
  answered: boolean
  /** 0-based index of the chosen option, when answered. */
  optionIndex?: number
  /** The chosen option label, when answered. */
  answer?: string
}

/** Parse a button payload like `ask:3:1` into an ask id + option index. */
export function parseAskCallback(data: string): { id: number; index: number } | null {
  const match = /^ask:(\d+):(\d+)$/.exec(data)
  if (match === null) return null
  const id = Number(match[1])
  const index = Number(match[2])
  if (!Number.isSafeInteger(id) || !Number.isSafeInteger(index)) return null
  return { id, index }
}

export interface TelegramAskManagerDeps {
  /** Ask timeout in milliseconds. */
  timeoutMs: number
  /** User-facing message table for the configured language. */
  strings: Strings
  /** Send one Telegram text with optional inline buttons (best effort). */
  send: (text: string, keyboard?: InlineKeyboard) => Promise<void>
  log?: (message: string) => void
}

interface PendingAsk {
  options: string[]
  resolve: (outcome: TelegramAskOutcome) => void
  timer: ReturnType<typeof setTimeout>
  onAbort: () => void
}

/**
 * Process-local registry of unanswered Telegram questions. An option button,
 * a matching text reply, timeout, or an aborted request each settle exactly
 * once and remove the entry.
 */
export class TelegramAskManager {
  private nextId = 1
  private readonly pending = new Map<number, PendingAsk>()

  constructor(private readonly deps: TelegramAskManagerDeps) {}

  /** Ask the user over Telegram; resolves with the closed outcome. */
  ask(ask: TelegramAsk): Promise<TelegramAskOutcome> {
    const id = this.nextId
    this.nextId += 1
    return new Promise<TelegramAskOutcome>((resolve) => {
      let settled = false
      const settle = (outcome: TelegramAskOutcome): void => {
        if (settled) return
        settled = true
        const entry = this.pending.get(id)
        if (entry !== undefined) {
          clearTimeout(entry.timer)
          ask.signal?.removeEventListener('abort', entry.onAbort)
          this.pending.delete(id)
        }
        resolve(outcome)
      }
      const onAbort = (): void => {
        settle({ answered: false })
      }
      const entry: PendingAsk = {
        options: ask.options,
        resolve: settle,
        onAbort,
        timer: setTimeout(() => {
          const minutes = Math.round(this.deps.timeoutMs / 60_000)
          void this.deps.send(this.deps.strings.askTimeout(minutes)).catch(() => undefined)
          settle({ answered: false })
        }, this.deps.timeoutMs),
      }
      this.pending.set(id, entry)
      ask.signal?.addEventListener('abort', onAbort, { once: true })
      if (ask.signal?.aborted === true) {
        settle({ answered: false })
        return
      }
      const minutes = Math.round(this.deps.timeoutMs / 60_000)
      const keyboard: InlineKeyboard = ask.options.map((option, index) => [{
        text: option,
        callback_data: `ask:${id}:${index}`,
      }])
      void this.deps
        .send(this.deps.strings.askQuestion(ask.question, minutes), keyboard)
        .catch((error: unknown) => {
          this.deps.log?.(`failed to send ask #${id}: ${error instanceof Error ? error.message : String(error)}`)
        })
    })
  }

  /** Settle one pending ask from a parsed button callback; false when unknown. */
  answerByIndex(id: number, index: number): boolean {
    const entry = this.pending.get(id)
    if (entry === undefined) return false
    const option = entry.options[index]
    if (option === undefined) return false
    entry.resolve({ answered: true, optionIndex: index, answer: option })
    return true
  }

  /**
   * Text-reply fallback: settle the ask whose option label exactly matches
   * (case-insensitive). Matches at most one ask, the most recently asked.
   */
  answerByLabel(label: string): boolean {
    const trimmed = label.trim().toLowerCase()
    const entries = [...this.pending.entries()].reverse()
    for (const [, entry] of entries) {
      const index = entry.options.findIndex(option => option.trim().toLowerCase() === trimmed)
      if (index === -1) continue
      const option = entry.options[index]
      if (option === undefined) continue
      entry.resolve({ answered: true, optionIndex: index, answer: option })
      return true
    }
    return false
  }

  /** Withdraw every unanswered ask (plugin teardown). */
  cancelAll(): void {
    for (const entry of this.pending.values()) entry.resolve({ answered: false })
    this.pending.clear()
  }
}
