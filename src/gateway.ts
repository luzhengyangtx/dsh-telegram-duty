/**
 * Gateway orchestration: whitelisted Telegram messages are routed to command
 * handling, approval answers, or the duty session; watch-mode transitions and
 * the global approval answerer live here.
 * @module @luzhengyangtx/dsh-telegram-duty/gateway
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ApprovalRequest, ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { SettingsScope } from '@deepseek-ai/dsh-settings'
import type { TelegramDutyConfig } from './config.ts'
import type { InlineKeyboard, TelegramCallbackQuery, TelegramClient, TelegramUpdate } from './telegram.ts'
import { Poller } from './poller.ts'
import { DutySession } from './duty.ts'
import { ApprovalManager, parseApprovalCallback, parseApprovalReply } from './approval.ts'
import { TelegramAskManager, parseAskCallback } from './ask.ts'
import type { TelegramAskOutcome } from './ask.ts'
import { chunkText, parseCommand } from './router.ts'
import { stringsFor } from './i18n.ts'
import type { Strings } from './i18n.ts'

export interface GatewayDeps {
  ctx: Context
  runtime: TelegramDutyConfig
  client: TelegramClient
  settings: SettingsScope<TelegramDutyConfig>
  stateOn: SettingsScope<{ n?: number }>
  stateOff: SettingsScope<{ n?: number }>
}

/** All gateway state for one plugin run. */
export class Gateway {
  private readonly ctx: Context
  private readonly runtime: TelegramDutyConfig
  private readonly client: TelegramClient
  private readonly settings: SettingsScope<TelegramDutyConfig>
  private readonly stateOn: SettingsScope<{ n?: number }>
  private readonly stateOff: SettingsScope<{ n?: number }>
  private readonly duty: DutySession
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
    this.mode = deps.settings.get().watchMode ?? 'local'
    this.strings = stringsFor(deps.settings.get().language ?? 'en')
    this.duty = new DutySession(deps.ctx, {
      sessionId: deps.runtime.sessionId ?? 'telegram-duty',
      cwd: deps.runtime.dutyCwd ?? process.cwd(),
      persona: this.strings.dutyPersona,
    })
    this.approvals = new ApprovalManager({
      timeoutMs: (deps.runtime.approvalTimeoutMinutes ?? 10) * 60_000,
      strings: this.strings,
      send: (text, keyboard) => this.sendChunked(text, keyboard),
      log: (message) => this.ctx.logger.warn('telegram-duty', message),
    })
    this.asks = new TelegramAskManager({
      timeoutMs: (deps.runtime.approvalTimeoutMinutes ?? 10) * 60_000,
      strings: this.strings,
      send: (text, keyboard) => this.sendChunked(text, keyboard),
      log: (message) => this.ctx.logger.warn('telegram-duty', message),
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

  private async handleUpdate(update: TelegramUpdate): Promise<void> {
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

    // 3) task → duty session
    await this.setMode('duty', true)
    const outcome = await this.duty.run(trimmed)
    if (outcome.error !== undefined) {
      await this.sendChunked(this.strings.dutyError(outcome.error))
    } else if (outcome.text.trim() === '') {
      await this.sendChunked(this.strings.dutyEmpty)
    } else {
      await this.sendChunked(outcome.text.trim())
    }
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
    try {
      await this.client.answerCallbackQuery(query.id, ack)
    } catch (error) {
      this.ctx.logger.warn('telegram-duty', `answerCallbackQuery failed: ${error instanceof Error ? error.message : String(error)}`)
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
