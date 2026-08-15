/**
 * Gateway orchestration: whitelisted Telegram messages are routed to command
 * handling, approval answers, or the duty session (or a targeted session via
 * /sessions buttons and `#N` prefixes); watch-mode transitions and the global
 * approval answerer live here. Task messages get an immediate ack plus a
 * looping "typing…" indicator until the turn settles.
 * @module @luzhengyangtx/dsh-telegram-duty/gateway
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ApprovalRequest, ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { SettingsScope } from '@deepseek-ai/dsh-settings'
import type { TelegramDutyConfig } from './config.ts'
import type { InlineKeyboard, TelegramCallbackQuery, TelegramClient, TelegramUpdate } from './telegram.ts'
import { Poller } from './poller.ts'
import { SessionDriver, TARGET_OFFLINE_ERROR } from './duty.ts'
import type { TurnOutcome } from './duty.ts'
import { ApprovalManager, parseApprovalCallback, parseApprovalReply } from './approval.ts'
import { TelegramAskManager, parseAskCallback } from './ask.ts'
import type { TelegramAskOutcome } from './ask.ts'
import { chunkText, isBareTargetPrefix, parseCommand, parseSessionCallback, parseTargetPrefix } from './router.ts'
import { Targeting, displayTitle } from './targeting.ts'
import type { SessionItem } from './targeting.ts'
import { scanPendingApprovals } from './pending.ts'
import { stringsFor } from './i18n.ts'
import type { Strings } from './i18n.ts'

/** How often to re-send the typing indicator (Telegram shows it ~5 s). */
export const TYPING_INTERVAL_MS = 4000
/**
 * Upper bound of numbered /sessions rows. Telegram caps a message at 100
 * buttons; 50 keeps the listing comfortably below that while covering any
 * realistic workspace.
 */
export const MAX_SESSION_LIST = 50

/**
 * Narrow structural views of the optional persistence services (typed by
 * cast: the plugin keeps its dependency surface small and both services may
 * be absent in headless deployments).
 */
interface ColdPersistence {
  list(signal?: AbortSignal): Promise<Array<{ id: { toString(): string }; createdAt?: number }>>
}
interface ColdProjectionCache {
  cachedSnapshot(meta: unknown): {
    values: { title?: string | null; sessionListMetadata?: { blank?: boolean } }
  } | undefined
}
interface WorkspaceRegistryLike {
  list(): Array<{ sessionIds: ReadonlyArray<{ toString(): string }> }>
  archivedSessionIds: ReadonlyArray<{ toString(): string }>
}

export interface GatewayDeps {
  ctx: Context
  runtime: TelegramDutyConfig
  client: TelegramClient
  settings: SettingsScope<TelegramDutyConfig>
  stateOn: SettingsScope<{ n?: number }>
  stateOff: SettingsScope<{ n?: number }>
}

export interface TypingLoop {
  stop: () => void
}

/**
 * Start the phone's "bot is typing…" animation: one immediate chat action,
 * then a beat every `intervalMs` until `stop()` (each action lasts ~5 s on
 * Telegram, so the interval must be shorter). Never throws.
 */
export function startTypingLoop(
  sendChatAction: (chatId: number, action: string) => Promise<unknown>,
  chatId: number,
  intervalMs: number,
  log?: (message: string) => void,
): TypingLoop {
  const beat = (): void => {
    void sendChatAction(chatId, 'typing').catch((error: unknown) => {
      log?.(`sendChatAction failed: ${error instanceof Error ? error.message : String(error)}`)
    })
  }
  beat()
  const timer = setInterval(beat, intervalMs)
  return { stop: () => { clearInterval(timer) } }
}

/** All gateway state for one plugin run. */
export class Gateway {
  private readonly ctx: Context
  private readonly runtime: TelegramDutyConfig
  private readonly client: TelegramClient
  private readonly settings: SettingsScope<TelegramDutyConfig>
  private readonly stateOn: SettingsScope<{ n?: number }>
  private readonly stateOff: SettingsScope<{ n?: number }>
  private readonly dutyId: string
  private readonly driver: SessionDriver
  private readonly targeting = new Targeting()
  private readonly approvals: ApprovalManager
  private readonly asks: TelegramAskManager
  private readonly poller: Poller
  private readonly strings: Strings
  private readonly inflight = new Set<Promise<void>>()
  private mode: 'local' | 'duty'

  constructor(deps: GatewayDeps) {
    this.ctx = deps.ctx
    this.runtime = deps.runtime
    this.client = deps.client
    this.settings = deps.settings
    this.stateOn = deps.stateOn
    this.stateOff = deps.stateOff
    this.dutyId = deps.runtime.sessionId ?? 'telegram-duty'
    this.mode = deps.settings.get().watchMode ?? 'local'
    this.strings = stringsFor(deps.settings.get().language ?? 'en')
    this.driver = new SessionDriver(deps.ctx, {
      dutySessionId: this.dutyId,
      cwd: deps.runtime.dutyCwd ?? process.cwd(),
      persona: this.strings.dutyPersona,
    })
    this.approvals = new ApprovalManager({
      timeoutMs: (deps.runtime.approvalTimeoutMinutes ?? 10) * 60_000,
      strings: this.strings,
      send: (text, keyboard) => this.sendChunked(text, keyboard),
      log: message => this.ctx.logger.warn('telegram-duty', message),
    })
    this.asks = new TelegramAskManager({
      timeoutMs: (deps.runtime.approvalTimeoutMinutes ?? 10) * 60_000,
      strings: this.strings,
      send: (text, keyboard) => this.sendChunked(text, keyboard),
      log: message => this.ctx.logger.warn('telegram-duty', message),
    })
    // Decouple message handling from the polling loop: a duty turn can block
    // for minutes on a pending Telegram approval, and the poller must keep
    // polling to fetch the user's answer (observed deadlock in e2e).
    this.poller = new Poller({
      client: deps.client,
      dataDir: deps.runtime.dataDir ?? '.',
      onUpdate: (update) => {
        this.spawn(() => this.handleUpdate(update))
      },
      onChannelState: (up) => {
        this.ctx.logger.info('telegram-duty', up ? 'Telegram channel up' : 'Telegram channel down')
      },
      onError: (error) => {
        this.ctx.logger.warn('telegram-duty', `poll error: ${error.message}`)
      },
    })
    this.settings.watch((next) => {
      this.mode = next.watchMode ?? 'local'
    })
  }

  /** Run one message handler fire-and-forget, containing its failures. */
  private spawn(task: () => Promise<void>): void {
    const run = task().catch((error: unknown) => {
      this.ctx.logger.warn('telegram-duty', `message handler failed: ${error instanceof Error ? error.message : String(error)}`)
    })
    this.inflight.add(run)
    void run.finally(() => {
      this.inflight.delete(run)
    })
  }

  start(): void {
    this.poller.start()
    void this.refreshStateMarker()
  }

  /**
   * Publish the current mode through the marker namespace whose name the
   * browser half reads from the forwarded settings event.
   */
  async refreshStateMarker(): Promise<void> {
    await this.pushStateMarker(this.mode)
  }

  /** telegram_ask tool body: push a question to the phone and wait. */
  async askUser(question: string, options: string[], signal?: AbortSignal): Promise<TelegramAskOutcome> {
    return await this.asks.ask({
      question,
      options,
      ...(signal !== undefined ? { signal } : {}),
    })
  }

  /** Command body: switch duty back to local (and notify the phone). */
  async switchToLocal(): Promise<void> {
    await this.setMode('local', true)
  }

  /** Sidebar-button entry point: attach the duty session without a turn. */
  async ensureDutyLive(): Promise<{ error?: string }> {
    return await this.driver.ensureLive()
  }

  private async pushStateMarker(mode: 'local' | 'duty'): Promise<void> {
    const scope = mode === 'duty' ? this.stateOn : this.stateOff
    try {
      await scope.update({ n: Date.now() })
    } catch (error) {
      this.ctx.logger.warn('telegram-duty', `state marker write failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async stop(): Promise<void> {
    this.approvals.cancelAll()
    this.asks.cancelAll()
    await this.poller.stop()
    // Let in-flight message handlers settle (a cancelled approval unwinds
    // the blocked duty turn) before tearing the client down.
    await Promise.allSettled([...this.inflight])
    this.client.close()
  }

  /** approval/request answerer: take over while on duty, else defer to web. */
  onApprovalRequest = async (req: ApprovalRequest, next: () => Promise<ApprovalOutcome>): Promise<ApprovalOutcome> => {
    if (this.mode !== 'duty') return await next()
    return await this.approvals.ask({
      toolName: req.toolName,
      ...(req.reason !== undefined ? { reason: req.reason } : {}),
      ...(req.signal !== undefined ? { signal: req.signal } : {}),
    })
  }

  /** session/event hook: a real user message from the web UI ends duty mode. */
  onSessionEvent = (session: Session, event: SessionEvent): void => {
    if (this.mode !== 'duty') return
    if (event.type !== 'user/message') return
    if (event.data.source?.kind !== 'user') return
    void this.setMode('local', true)
    this.ctx.logger.info('telegram-duty', `user message in session ${session.id} → local mode`)
  }

  /** Poller entry point (public for tests). */
  async handleUpdate(update: TelegramUpdate): Promise<void> {
    // 0) button presses (callback queries)
    const callback = update.callback_query
    if (callback !== undefined) {
      await this.handleCallback(callback)
      return
    }
    const message = update.message
    if (message === undefined) return
    const text = message.text
    if (text === undefined || text.trim() === '') return
    if (message.chat.id !== this.chatId()) {
      this.ctx.logger.info('telegram-duty', `ignoring message from chat ${message.chat.id} (whitelist is ${this.chatId()})`)
      return
    }
    const trimmed = text.trim()

    // 1) approval answer
    const parse = parseApprovalReply(trimmed, this.approvals.pendingIds())
    if (parse.kind === 'answer') {
      if (this.approvals.answer(parse.id, parse.decision)) {
        await this.sendChunked(parse.decision === 'allowed-once'
          ? this.strings.approvalAccepted(parse.id)
          : this.strings.approvalRejected(parse.id))
      } else {
        await this.sendChunked(this.strings.approvalUnknown(parse.id))
      }
      return
    }
    if (parse.kind === 'ambiguous') {
      const first = this.approvals.pendingIds()[0]
      await this.sendChunked(this.strings.approvalAmbiguous(this.approvals.pendingIds().length, first ?? 1))
      return
    }

    // 1b) ask answer (exact option-label match)
    if (this.asks.answerByLabel(trimmed)) {
      await this.sendChunked(this.strings.askAnswered)
      return
    }

    // 2) commands
    const command = parseCommand(trimmed)
    if (command === 'away') {
      if (this.mode === 'duty') {
        // Already on duty: confirm instead of silently ignoring the command.
        await this.sendChunked(this.strings.alreadyDuty + '\n' + this.strings.dutyOn)
      } else {
        await this.setMode('duty', true)
        // Warn about approvals the web UI already holds: the phone cannot
        // answer them, but the user should know what is stuck.
        await this.warnPendingWebApprovals()
      }
      return
    }
    if (command === 'back') {
      if (this.mode === 'local') {
        await this.sendChunked(this.strings.alreadyLocal)
      } else {
        await this.setMode('local', true)
      }
      return
    }
    if (command === 'help') {
      await this.sendChunked(this.strings.help)
      return
    }
    if (command === 'sessions') {
      await this.handleSessionsCommand()
      return
    }
    if (command === 'duty') {
      this.targeting.setActive(null)
      await this.sendChunked(this.strings.dutyReset)
      return
    }
    if (command === 'unblock') {
      await this.handleUnblockCommand()
      return
    }

    // 2.5) bare "#N" with no message content
    if (isBareTargetPrefix(trimmed)) {
      await this.sendChunked(this.strings.prefixNeedsText)
      return
    }

    // 3) task: resolve the route (default duty → active target → #N one-shot)
    let targetId = this.targeting.activeId() ?? this.dutyId
    let targetTitle: string | undefined
    let taskText = trimmed
    const prefix = parseTargetPrefix(trimmed)
    if (prefix !== null) {
      const lookup = this.targeting.lookup(prefix.index)
      if (lookup === undefined) {
        await this.sendChunked(this.targeting.expired() ? this.strings.snapshotExpired : this.strings.prefixUnknown(prefix.index))
        return
      }
      targetId = lookup.sessionId
      targetTitle = lookup.title
      taskText = prefix.rest
    }

    // Immediate receipt feedback, then keep the typing animation alive while
    // the turn runs (approval waits included).
    await this.sendChunked(this.strings.ack)
    await this.setMode('duty', true)
    const typing = startTypingLoop(
      (chatId, action) => this.client.sendChatAction(chatId, action),
      this.chatId(),
      TYPING_INTERVAL_MS,
      message => this.ctx.logger.warn('telegram-duty', message),
    )
    let outcome: TurnOutcome
    try {
      outcome = await this.driver.runIn(targetId, taskText)
    } finally {
      typing.stop()
    }
    if (outcome.cancelled === true) {
      // A deliberate interruption (/unblock or a web-side cancel) already has
      // its own report; stay quiet instead of crying "处理出错".
      return
    }
    if (outcome.error === TARGET_OFFLINE_ERROR) {
      await this.sendChunked(this.strings.sessionOffline(targetTitle ?? targetId))
    } else if (outcome.error !== undefined) {
      await this.sendChunked(this.strings.taskError(outcome.error))
    } else if (outcome.text.trim() === '') {
      await this.sendChunked(this.strings.dutyEmpty)
    } else {
      await this.sendChunked(outcome.text.trim())
    }
  }

  /**
   * /sessions: list the user's MAIN workspace sessions (in the web sidebar's
   * workspace order), with numbered buttons — live ones first by that order
   * (空闲/忙碌), then persisted-but-cold ones (离线, woken on the first
   * targeted message). The internal duty session and non-workspace sessions
   * are not listed. Without a workspace registry (headless), live top-level
   * sessions minus the duty session are listed instead.
   */
  private async handleSessionsCommand(): Promise<void> {
    const items: SessionItem[] = []
    const registry = this.ctx.get('workspaceRegistry') as WorkspaceRegistryLike | undefined
    if (registry === undefined) {
      for (const agent of this.ctx.agents.roots()) {
        if (items.length >= MAX_SESSION_LIST) break
        const id = String(agent.id)
        if (id === this.dutyId) continue
        items.push({
          sessionId: id,
          title: displayTitle(id, agent.session.events, false, this.strings.dutySessionName),
          status: agent.status,
        })
      }
    } else {
      const archived = new Set(registry.archivedSessionIds.map(id => String(id)))
      const order: string[] = []
      for (const workspace of registry.list()) {
        for (const id of workspace.sessionIds) {
          const key = String(id)
          if (key === this.dutyId || archived.has(key) || order.includes(key)) continue
          order.push(key)
        }
      }
      const liveById = new Map(this.ctx.agents.roots().map(agent => [String(agent.id), agent]))
      let coldById: Map<string, { id: string; createdAt: number | undefined; meta: unknown }> | undefined
      if (order.length > 0) {
        const persistence = this.ctx.get('sessionPersistence') as ColdPersistence | undefined
        if (persistence !== undefined) {
          try {
            const headers = await persistence.list()
            coldById = new Map(headers.map(meta => [
              String(meta.id),
              { id: String(meta.id), createdAt: meta.createdAt, meta },
            ]))
          } catch (error) {
            this.ctx.logger.warn('telegram-duty', `cold session listing failed: ${error instanceof Error ? error.message : String(error)}`)
          }
        }
      }
      const cache = this.ctx.get('sessionProjectionCache') as ColdProjectionCache | undefined
      for (const id of order) {
        if (items.length >= MAX_SESSION_LIST) break
        const live = liveById.get(id)
        if (live !== undefined) {
          // Blank (never-used) live sessions are drafts; the web sidebar
          // hides them too, so keep the phone list clean.
          if (live.session.events.length === 0) continue
          items.push({
            sessionId: id,
            title: displayTitle(id, live.session.events, false, this.strings.dutySessionName),
            status: live.status,
          })
          continue
        }
        const cold = coldById?.get(id)
        if (cold === undefined) continue
        const snapshot = cache?.cachedSnapshot(cold.meta)
        // Blank cold sessions (created but never used) have no title and
        // only clutter the list with a raw id; skip them like the web does.
        if (snapshot?.values.sessionListMetadata?.blank === true) continue
        const title = snapshot?.values.title
        items.push({
          sessionId: id,
          title: typeof title === 'string' && title.trim() !== '' ? title.trim() : id,
          status: 'offline',
        })
      }
    }
    if (items.length === 0) {
      await this.sendChunked(this.strings.sessionsNone)
      return
    }
    this.targeting.capture(items)
    const lines = items.map((item, index) => this.strings.sessionsEntry(
      index + 1,
      item.title,
      item.status === 'idle'
        ? this.strings.statusIdle
        : item.status === 'running'
          ? this.strings.statusRunning
          : this.strings.statusOffline,
    ))
    const keyboard: InlineKeyboard = items.map((_item, index) => [{
      text: String(index + 1),
      callback_data: `sess:${index + 1}`,
    }])
    await this.sendChunked([this.strings.sessionsTitle, ...lines].join('\n'), keyboard)
  }

  /**
   * /away helper: after entering duty mode, list approvals the web UI still
   * holds (the phone cannot answer an already-web-claimed approval).
   */
  private async warnPendingWebApprovals(): Promise<void> {
    const lines: string[] = []
    for (const agent of this.ctx.agents.list()) {
      const pending = scanPendingApprovals(agent.session.events)
      if (pending.length === 0) continue
      const id = String(agent.id)
      const title = displayTitle(id, agent.session.events, id === this.dutyId, this.strings.dutySessionName)
      for (const item of pending) lines.push(`· 工具「${item.toolName}」（${title}）`)
    }
    if (lines.length > 0) await this.sendChunked(this.strings.pendingWebApprovals(lines.join('\n')))
  }

  /**
   * /unblock: cancel the active turn of every live session that is stuck on
   * an unanswered approval (the turn abort settles the approval as
   * 'cancelled' and the task can be resent with phone-side approvals).
   */
  private async handleUnblockCommand(): Promise<void> {
    let cancelled = 0
    for (const agent of this.ctx.agents.list()) {
      if (scanPendingApprovals(agent.session.events).length === 0) continue
      agent.cancel({ kind: 'user' })
      cancelled += 1
      this.ctx.logger.info('telegram-duty', `unblock: cancelled turn of session ${String(agent.id)}`)
    }
    await this.sendChunked(cancelled > 0 ? this.strings.unblocked(cancelled) : this.strings.unblockNothing)
  }

  /** telegram_notify tool body: push one message to the phone, no waiting. */
  async notifyPhone(text: string): Promise<void> {
    await this.sendChunked(text)
  }

  private chatId(): number {
    return this.runtime.chatId ?? 0
  }

  private async setMode(mode: 'local' | 'duty', notify: boolean): Promise<void> {
    if (this.mode === mode) return
    this.mode = mode
    try {
      await this.settings.update({ watchMode: mode })
    } catch (error) {
      this.ctx.logger.warn('telegram-duty', `persisting watchMode failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    await this.pushStateMarker(mode)
    if (notify) await this.sendChunked(mode === 'duty' ? this.strings.dutyOn : this.strings.dutyOff)
  }

  /** Handle one inline-button press. */
  private async handleCallback(query: TelegramCallbackQuery): Promise<void> {
    const chatId = query.message?.chat.id
    if (chatId === undefined || chatId !== this.chatId()) {
      this.ctx.logger.info('telegram-duty', `ignoring callback from chat ${chatId ?? 'unknown'}`)
      return
    }
    const data = query.data ?? ''
    let ack: string | undefined
    let targetedTitle: string | undefined
    const session = parseSessionCallback(data)
    if (session !== null) {
      const entry = this.targeting.lookup(session.index)
      if (entry === undefined) {
        ack = this.targeting.expired() ? this.strings.snapshotExpired : this.strings.callbackUnknown
      } else {
        this.targeting.setActive(entry.sessionId)
        ack = this.strings.targetAck
        // The toast alone is too easy to miss: post the confirmation as a
        // regular chat message that stays visible in the conversation.
        targetedTitle = entry.title
      }
    } else {
      const approval = parseApprovalCallback(data)
      if (approval !== null) {
        if (this.approvals.answer(approval.id, approval.decision)) {
          ack = approval.decision === 'allowed-once'
            ? this.strings.approvalAccepted(approval.id)
            : this.strings.approvalRejected(approval.id)
        } else {
          ack = this.strings.approvalUnknown(approval.id)
        }
      } else {
        const ask = parseAskCallback(data)
        if (ask !== null) {
          ack = this.asks.answerByIndex(ask.id, ask.index) ? this.strings.askAnswered : this.strings.callbackUnknown
        } else {
          ack = this.strings.callbackUnknown
        }
      }
    }
    try {
      // answerCallbackQuery toasts cap at 200 characters.
      await this.client.answerCallbackQuery(query.id, ack === undefined ? undefined : ack.slice(0, 190))
    } catch (error) {
      this.ctx.logger.warn('telegram-duty', `answerCallbackQuery failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (targetedTitle !== undefined) {
      await this.sendChunked(this.strings.targeted(targetedTitle))
    }
  }

  /** Send one text, split under Telegram's message limit; never throws. */
  private async sendChunked(text: string, keyboard?: InlineKeyboard): Promise<void> {
    const chunks = chunkText(text, this.runtime.replyChunkChars ?? 3800)
    for (const [index, chunk] of chunks.entries()) {
      try {
        // Buttons belong on the first chunk only.
        await this.client.sendMessage(this.chatId(), chunk, index === 0 && keyboard !== undefined ? { keyboard } : {})
      } catch (error) {
        this.ctx.logger.warn('telegram-duty', `sendMessage failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }
}
