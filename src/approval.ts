/**
 * Global approval forwarding: while on duty, every session's approval request
 * becomes a numbered Telegram question; the user's reply settles the pending
 * promise, which the approval service turns into the caller's continuation.
 * Timeout and channel failure resolve 'rejected' (fail-closed).
 * @module @luzhengyangtx/dsh-telegram-duty/approval
 */

import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import type { Strings } from './i18n.ts'
import type { InlineKeyboard } from './telegram.ts'

export interface ApprovalQuestion {
  toolName: string
  reason?: string
  signal?: AbortSignal
}

/** Parse a button payload like `appr:7:allow` into its answer. */
export function parseApprovalCallback(data: string): { id: number; decision: 'allowed-once' | 'rejected' } | null {
  const match = /^appr:(\d+):(allow|reject)$/.exec(data)
  if (match === null) return null
  const id = Number(match[1])
  if (!Number.isSafeInteger(id)) return null
  return { id, decision: match[2] === 'allow' ? 'allowed-once' : 'rejected' }
}

export interface ApprovalAnswer {
  id: number
  decision: 'allowed-once' | 'rejected'
}

export type ApprovalReplyParse =
  | { kind: 'answer'; id: number; decision: 'allowed-once' | 'rejected' }
  | { kind: 'ambiguous' }
  | { kind: 'none' }

const ALLOW_WORDS = /^(同意|允许|批准|好|可以|行|ok|yes|approve|allow)$/i
const REJECT_WORDS = /^(拒绝|不同意|取消|不要|不行|no|reject|deny)$/i
const NUMBERED_REPLY = /^\s*#?\s*(\d+)\s+(.+?)\s*$/

/**
 * Parse one Telegram text as an approval answer.
 * - "3 同意" targets approval #3.
 * - "同意" targets the only pending approval (ambiguous when several).
 */
export function parseApprovalReply(text: string, pendingIds: readonly number[]): ApprovalReplyParse {
  const numbered = NUMBERED_REPLY.exec(text)
  if (numbered !== null) {
    const id = Number(numbered[1])
    const word = numbered[2] ?? ''
    if (ALLOW_WORDS.test(word)) return { kind: 'answer', id, decision: 'allowed-once' }
    if (REJECT_WORDS.test(word)) return { kind: 'answer', id, decision: 'rejected' }
    return { kind: 'none' }
  }
  const word = text.trim()
  if (ALLOW_WORDS.test(word) || REJECT_WORDS.test(word)) {
    if (pendingIds.length === 1) {
      const only = pendingIds[0]
      if (only === undefined) return { kind: 'none' }
      return { kind: 'answer', id: only, decision: ALLOW_WORDS.test(word) ? 'allowed-once' : 'rejected' }
    }
    if (pendingIds.length > 1) return { kind: 'ambiguous' }
  }
  return { kind: 'none' }
}

/** Render one numbered Telegram approval question. */
export function renderApprovalQuestion(id: number, question: ApprovalQuestion, timeoutMinutes: number, strings: Strings): string {
  const reason = question.reason?.trim() ?? ''
  return strings.approvalQuestion(id, question.toolName, reason, timeoutMinutes)
}

export interface ApprovalManagerDeps {
  /** Approval timeout in milliseconds. */
  timeoutMs: number
  /** User-facing message table for the configured language. */
  strings: Strings
  /** Send one Telegram text with optional inline buttons (best effort). */
  send: (text: string, keyboard?: InlineKeyboard) => Promise<void>
  log?: (message: string) => void
}

interface PendingEntry {
  question: ApprovalQuestion
  resolve: (outcome: ApprovalOutcome) => void
  timer: ReturnType<typeof setTimeout>
  onAbort: () => void
}

/**
 * Process-local registry of unanswered Telegram approvals. Answering, timeout,
 * or an aborted request each settle exactly once and remove the entry.
 */
export class ApprovalManager {
  private nextId = 1
  private readonly pending = new Map<number, PendingEntry>()

  constructor(private readonly deps: ApprovalManagerDeps) {}

  /** Ask the user over Telegram; resolves with the closed outcome. */
  ask(question: ApprovalQuestion): Promise<ApprovalOutcome> {
    const id = this.nextId
    this.nextId += 1
    return new Promise<ApprovalOutcome>((resolve) => {
      let settled = false
      const settle = (outcome: ApprovalOutcome): void => {
        if (settled) return
        settled = true
        const entry = this.pending.get(id)
        if (entry !== undefined) {
          clearTimeout(entry.timer)
          entry.question.signal?.removeEventListener('abort', entry.onAbort)
          this.pending.delete(id)
        }
        resolve(outcome)
      }
      const onAbort = (): void => {
        settle('cancelled')
      }
      const entry: PendingEntry = {
        question,
        resolve: settle,
        onAbort,
        timer: setTimeout(() => {
          const minutes = Math.round(this.deps.timeoutMs / 60_000)
          void this.deps.send(this.deps.strings.approvalTimeout(id, minutes)).catch(() => undefined)
          settle('rejected')
        }, this.deps.timeoutMs),
      }
      this.pending.set(id, entry)
      question.signal?.addEventListener('abort', onAbort, { once: true })
      if (question.signal?.aborted === true) {
        settle('cancelled')
        return
      }
      const minutes = Math.round(this.deps.timeoutMs / 60_000)
      const reason = question.reason?.trim() ?? ''
      const keyboard: InlineKeyboard = [[
        { text: this.deps.strings.approveButton, callback_data: `appr:${id}:allow` },
        { text: this.deps.strings.rejectButton, callback_data: `appr:${id}:reject` },
      ]]
      void this.deps
        .send(this.deps.strings.approvalQuestion(id, question.toolName, reason, minutes), keyboard)
        .catch((error: unknown) => {
          this.deps.log?.(`failed to send approval #${id}: ${error instanceof Error ? error.message : String(error)}`)
        })
    })
  }

  /** Ids of all unanswered approvals, in issue order. */
  pendingIds(): number[] {
    return [...this.pending.keys()]
  }

  /** Settle one pending approval from a parsed reply; false when unknown. */
  answer(id: number, decision: 'allowed-once' | 'rejected'): boolean {
    const entry = this.pending.get(id)
    if (entry === undefined) return false
    entry.resolve(decision)
    return true
  }

  /** Withdraw every unanswered approval (plugin teardown). */
  cancelAll(): void {
    for (const entry of this.pending.values()) entry.resolve('cancelled')
    this.pending.clear()
  }
}
