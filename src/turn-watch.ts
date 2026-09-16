/**
 * Duty watch over other sessions' turns: while the gateway is in `duty` mode,
 * every finished turn of a non-duty session is reported to the phone (full
 * final text — the gateway sender chunks it, nothing is truncated here), and
 * when a session's whole task stretch settles (agent back to idle with
 * nothing queued), one completion line is sent. Phone-initiated turns are
 * excluded: their replies already flow through the task-reply channel.
 * @module @luzhengyangtx/dsh-telegram-duty/turn-watch
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentStatus } from '@deepseek-ai/dsh-agent'
import type { Session, SessionEvent, TurnEndReason } from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { TextBlock } from '@deepseek-ai/dsh-llm'
import { displayTitle } from './targeting.ts'
import type { Strings } from './i18n.ts'

/**
 * How long to wait after an idle transition before judging "task done".
 * Follow-up schedulers (e.g. goal rounds) queue their next turn
 * asynchronously right after a turn ends; the settle re-checks agent status
 * and inbox after this window so a just-queued continuation is never
 * reported as completion.
 */
export const SETTLE_DELAY_MS = 500

/** Source plugin names that mark phone-injected user messages. */
const PHONE_SOURCE_PLUGINS = new Set(['telegram-duty', 'telegram-duty-targeted'])

/** One running stretch of a session: from its first turn/start until idle. */
interface Stretch {
  startedAt: number
  /** Completed turns in this stretch (the completion line's count). */
  turns: number
  /** The most recent turn ended with reason completed. */
  lastCompleted: boolean
  /** The most recent turn was phone-initiated. */
  lastTurnPhone: boolean
}

export interface TurnWatchDeps {
  ctx: Context
  /** The duty session id — its turns are never reported (replies already reach the phone). */
  dutyId: string
  /** Whether the gateway is currently in duty mode. */
  isDuty: () => boolean
  /** Chunked Telegram sender (the gateway's sendChunked); never throws. */
  send: (text: string) => Promise<void>
  strings: Strings
  log?: (message: string) => void
  /** Settle delay override (tests). */
  settleMs?: number
}

/** True when the event is a phone-injected user message (any target session). */
export function isPhoneSourceEvent(event: SessionEvent): boolean {
  if (event.type !== 'user/message') return false
  const source = event.data.source
  return source.kind === 'plugin' && PHONE_SOURCE_PLUGINS.has(source.plugin)
}

/** The last assistant text of one turn, joined across text blocks; '' when none. */
export function lastAssistantText(events: readonly SessionEvent[], turn: number): string {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type !== 'assistant/message') continue
    if (event.data.turn !== turn) continue
    return event.data.message.content
      .filter((block): block is TextBlock => block.type === 'text')
      .map(block => block.text)
      .join('')
  }
  return ''
}

/** One-line human detail for a non-completed turn end. */
export function reasonDetail(reason: TurnEndReason, strings: Strings): string {
  switch (reason.kind) {
    case 'aborted': return strings.reasonAborted
    case 'blocked': return strings.reasonBlocked
    case 'max-tokens': return strings.reasonMaxTokens
    case 'interrupted': return strings.reasonInterrupted
    case 'error': return strings.reasonError(reason.error.code, reason.error.message)
    default: return (reason as { kind: string }).kind
  }
}

/**
 * Session-wide turn reporter. Handlers are plain functions so the gateway
 * registers them as `session/event`, `agent/status` and `agent/disposed`
 * listeners; `dispose()` clears the pending settle timers.
 */
export class TurnWatch {
  private readonly ctx: Context
  private readonly dutyId: string
  private readonly isDuty: () => boolean
  private readonly send: (text: string) => Promise<void>
  private readonly strings: Strings
  private readonly log: ((message: string) => void) | undefined
  private readonly settleMs: number
  private readonly stretches = new Map<string, Stretch>()
  private readonly phoneFlag = new Map<string, boolean>()
  private readonly settleTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private disposed = false

  constructor(deps: TurnWatchDeps) {
    this.ctx = deps.ctx
    this.dutyId = deps.dutyId
    this.isDuty = deps.isDuty
    this.send = deps.send
    this.strings = deps.strings
    this.log = deps.log
    this.settleMs = deps.settleMs ?? SETTLE_DELAY_MS
  }

  /** session/event listener: track phone injections, stretches, and turn reports. */
  onSessionEvent = (session: Session, event: SessionEvent): void => {
    const id = String(session.id)
    if (event.type === 'user/message') {
      if (isPhoneSourceEvent(event)) this.phoneFlag.set(id, true)
      return
    }
    if (event.type === 'turn/start') {
      if (id !== this.dutyId && !this.stretches.has(id)) {
        this.stretches.set(id, { startedAt: Date.now(), turns: 0, lastCompleted: false, lastTurnPhone: false })
      }
      return
    }
    if (event.type !== 'turn/end') return
    const stretch = this.stretches.get(id)
    if (stretch === undefined) return
    const phone = this.phoneFlag.get(id) === true
    this.phoneFlag.delete(id)
    const reason = event.data.reason
    if (reason.kind === 'completed') {
      stretch.turns += 1
      stretch.lastCompleted = true
      stretch.lastTurnPhone = phone
    } else {
      stretch.lastCompleted = false
      stretch.lastTurnPhone = phone
    }
    if (!this.isDuty() || id === this.dutyId || phone) return
    if (reason.kind === 'completed') {
      // oxlint-disable-next-line typescript/no-deprecated -- Deferred migration of the pre-policy session.events read (title).
      const title = displayTitle(id, session.snapshotEvents(), false, this.strings.dutySessionName)
      // oxlint-disable-next-line typescript/no-deprecated -- Deferred migration of the pre-policy session.events read (final text).
      const body = lastAssistantText(session.snapshotEvents(), event.data.turn).trim()
      const text = body === ''
        ? this.strings.turnHeader(title, event.data.turn)
        : `${this.strings.turnHeader(title, event.data.turn)}\n\n${body}`
      void this.send(text).catch((error: unknown) => { this.reportSendFailure(error) })
    } else {
      // oxlint-disable-next-line typescript/no-deprecated -- Deferred migration of the pre-policy session.events read (title).
      const title = displayTitle(id, session.snapshotEvents(), false, this.strings.dutySessionName)
      void this.send(this.strings.turnFailed(title, event.data.turn, reasonDetail(reason, this.strings)))
        .catch((error: unknown) => { this.reportSendFailure(error) })
    }
  }

  /** agent/status listener: schedule the completion settle on idle transitions. */
  onAgentStatus = ({ agent, status }: { agent: Agent; status: AgentStatus }): void => {
    if (status !== 'idle') return
    const id = String(agent.id)
    if (!this.stretches.has(id)) return
    const existing = this.settleTimers.get(id)
    if (existing !== undefined) clearTimeout(existing)
    this.settleTimers.set(id, setTimeout(() => {
      this.settle(id)
    }, this.settleMs))
  }

  /** agent/disposed listener: drop all state for a session that went away. */
  onAgentDisposed = ({ agent }: { agent: Agent }): void => {
    this.forget(String(agent.id))
  }

  /** Clear pending settle timers (plugin teardown). */
  dispose(): void {
    this.disposed = true
    for (const timer of this.settleTimers.values()) clearTimeout(timer)
    this.settleTimers.clear()
  }

  /**
   * The settle check: when the agent is still running or has queued work,
   * keep the stretch (the next idle transition re-settles); otherwise close
   * it and, when eligible, send the completion line.
   */
  private settle(id: string): void {
    this.settleTimers.delete(id)
    if (this.disposed) return
    const stretch = this.stretches.get(id)
    if (stretch === undefined) return
    const agent = this.ctx.agents.get(SessionId(id))
    if (agent !== undefined) {
      const busy = agent.status === 'running'
        || agent.inbox.nextStep.length > 0
        || agent.inbox.nextTurn.length > 0
      if (busy) return
    }
    this.stretches.delete(id)
    const eligible = agent !== undefined
      && this.isDuty()
      && id !== this.dutyId
      && stretch.lastCompleted
      && stretch.turns >= 1
      && !stretch.lastTurnPhone
    if (!eligible) return
    // oxlint-disable-next-line typescript/no-deprecated -- Deferred migration of the pre-policy session.events read (title).
    const title = displayTitle(id, agent.session.snapshotEvents(), false, this.strings.dutySessionName)
    const minutes = Math.max(1, Math.round((Date.now() - stretch.startedAt) / 60_000))
    void this.send(this.strings.turnDone(title, stretch.turns, minutes))
      .catch((error: unknown) => { this.reportSendFailure(error) })
  }

  /** Drop everything tracked for one session id. */
  private forget(id: string): void {
    this.stretches.delete(id)
    this.phoneFlag.delete(id)
    const timer = this.settleTimers.get(id)
    if (timer !== undefined) {
      clearTimeout(timer)
      this.settleTimers.delete(id)
    }
  }

  private reportSendFailure(error: unknown): void {
    this.log?.(`turn-watch send failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}
