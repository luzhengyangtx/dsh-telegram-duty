/**
 * Duty-session driver: keeps one stable DSH session live, delivers Telegram
 * text as follow-up turns (which wakes its agent), waits for the turn to
 * settle, and returns the final assistant text. Targeted delivery runs the
 * same flow against any other session id (`runIn`), and `ensureLive` attaches
 * the duty session without a turn (the web sidebar button entry point). The
 * resume/create + summarize pattern follows @kriskwok/dsh-feishu-gateway (MIT).
 * @module @luzhengyangtx/dsh-telegram-duty/duty
 */

import type { Context } from '@deepseek-ai/cordis'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import type { Agent, ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { TextBlock } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

/**
 * Message source marking phone-injected user messages. The duty session's own
 * injections use `telegram-duty` (the host projection unit folds on it to
 * mark the duty session for the web sidebar button); deliveries into OTHER
 * sessions use the targeted name so they never mark those sessions.
 */
export const DUTY_SOURCE_PLUGIN = 'telegram-duty'
export const TARGETED_SOURCE_PLUGIN = 'telegram-duty-targeted'

export interface TurnOutcome {
  text: string
  /** Non-empty when the turn ended abnormally ('OFFLINE' = target cannot wake). */
  error?: string
  /** True when the turn was aborted (e.g. /unblock or a web-side cancel). */
  cancelled?: boolean
}

/** Error marker for a targeted session that could not be resumed. */
export const TARGET_OFFLINE_ERROR = 'OFFLINE'

export interface SessionDriverOptions {
  /** Stable duty session id (created on first delivery when absent). */
  dutySessionId: string
  /** Absolute workspace cwd for the duty session. */
  cwd: string
  /** Persona text registered under the deployment persona slot (duty only). */
  persona: string
}

/**
 * Aggregate the final assistant text from session events since firstSeq:
 * the last tool-free assistant/message of the turn; a `turn/end` with a
 * non-completed reason becomes an error outcome, while an aborted turn is
 * marked `cancelled` (a deliberate interruption, not a failure).
 */
export function summarize(events: readonly SessionEvent[], firstSeq: number): TurnOutcome {
  let started = false
  let text = ''
  let error: string | undefined
  let cancelled = false
  for (const event of events) {
    if (event.seq < firstSeq) continue
    if (event.type === 'turn/start') {
      started = true
      continue
    }
    if (!started) continue
    if (event.type === 'assistant/message') {
      const joined = event.data.message.content
        .filter((block): block is TextBlock => block.type === 'text')
        .map(block => block.text)
        .join('')
      if (joined !== '') text = joined
    }
    if (event.type === 'turn/end') {
      const reason = event.data.reason
      if (reason.kind === 'error') error = `${reason.error.code}: ${reason.error.message}`
      else if (reason.kind === 'aborted') cancelled = true
      else if (reason.kind !== 'completed') error = `turn ended with reason "${reason.kind}"`
    }
  }
  if (error !== undefined) return { text, error }
  return cancelled ? { text, cancelled: true } : { text }
}

/** Serialized delivery into the duty session and, when targeted, others. */
export class SessionDriver {
  private chain: Promise<unknown> = Promise.resolve()
  private presetPromise: Promise<string | undefined> | undefined

  constructor(
    private readonly ctx: Context,
    private readonly options: SessionDriverOptions,
  ) {}

  /**
   * Resolve the default agent preset id once. Mounting it in setup is what
   * gives the duty agent its tools — without it the model has no tool schemas
   * and "fakes" tool calls as plain text (observed in e2e).
   */
  private resolvePreset(): Promise<string | undefined> {
    this.presetPromise ??= (async () => {
      const presets = this.ctx.get('agentPresets')
      if (presets === undefined) return undefined
      return (await presets.resolve(undefined)).id
    })()
    return this.presetPromise
  }

  /** Queue one Telegram text into the duty session; resolves with the reply. */
  async run(text: string): Promise<TurnOutcome> {
    return await this.runIn(this.options.dutySessionId, text)
  }

  /** Queue one Telegram text into an arbitrary session id. */
  async runIn(sessionId: string, text: string): Promise<TurnOutcome> {
    let outcome: TurnOutcome = { text: '' }
    const next = this.chain
      .catch(() => undefined)
      .then(async () => {
        try {
          outcome = await this.turn(sessionId, text)
        } catch (error) {
          // Surface the failure as an outcome so the gateway can reply it.
          outcome = { text: '', error: error instanceof Error ? error.message : String(error) }
        }
      })
    this.chain = next.catch(() => undefined)
    await next
    return outcome
  }

  /**
   * Attach the duty session without running a turn (resume, or create when it
   * never existed). The attached agent is deliberately NOT disposed: the
   * caller (the web sidebar button) wants the session live.
   */
  async ensureLive(): Promise<{ error?: string }> {
    let result: { error?: string } = {}
    const next = this.chain
      .catch(() => undefined)
      .then(async () => {
        try {
          await this.attach(this.options.dutySessionId, true)
        } catch (error) {
          result = { error: error instanceof Error ? error.message : String(error) }
        }
      })
    this.chain = next.catch(() => undefined)
    await next
    return result
  }

  /**
   * Resolve one session as a live agent, reusing an already-live one. Setup
   * mounts the default preset (tools) and model selection; the persona is
   * duty-only. A targeted session that cannot be resumed reports OFFLINE
   * instead of creating a fresh blank session (only the duty session is
   * auto-created).
   */
  private async attach(
    sessionId: string,
    isDuty: boolean,
  ): Promise<{ agent: Agent; dispose: () => Promise<void> }> {
    const agents = this.ctx.agents
    const defaultModel = this.ctx.agentDefaultModel
    const selection = defaultModel.currentSelection()
    const agentOptions = { provider: selection.provider, model: selection.model }
    const presetId = await this.resolvePreset()
    const setup = async (agentCtx: Context): Promise<void> => {
      const selected: ModelSelectionRef = { current: selection, assembled: undefined }
      installModelSelection(agentCtx, selected)
      // Same name + order as the deployment persona → shadows it for this agent.
      if (isDuty) {
        agentCtx.systemPrompt.section({ name: 'deployment:persona', order: 0, text: this.options.persona })
      }
      // Mount the default preset so the agent has the standard tools
      // (bash/pwsh/fs/subagents/...), exactly like web-created sessions.
      if (presetId !== undefined) {
        const presets = this.ctx.get('agentPresets')
        if (presets !== undefined) await presets.mount(agentCtx, presetId)
      }
    }

    const live = agents.get(SessionId(sessionId))
    if (live !== undefined) return { agent: live, dispose: async () => undefined }

    let handle
    try {
      handle = await agents.resume({ resumeSessionId: SessionId(sessionId), agentOptions, setup })
    } catch (error) {
      const resumeError = error instanceof Error ? error.message : String(error)
      if (!isDuty) throw new Error(TARGET_OFFLINE_ERROR)
      this.ctx.logger.warn('telegram-duty', `resume "${this.options.dutySessionId}" failed (${resumeError}), creating`)
      try {
        handle = await agents.create({
          sessionId: SessionId(sessionId),
          meta: {
            cwd: this.options.cwd,
            ...(presetId !== undefined ? { agentPreset: presetId } : {}),
          },
          agentOptions,
          setup,
        })
      } catch (createError) {
        const createMessage = createError instanceof Error ? createError.message : String(createError)
        throw new Error(`resume failed (${resumeError}); create failed (${createMessage})`)
      }
    }
    return {
      agent: handle.agent,
      dispose: () => handle.dispose().catch((error: unknown) => {
        this.ctx.logger.warn('telegram-duty', `dispose agent error: ${error instanceof Error ? error.message : String(error)}`)
      }),
    }
  }

  private async turn(sessionId: string, text: string): Promise<TurnOutcome> {
    const isDuty = sessionId === this.options.dutySessionId
    const { agent, dispose } = await this.attach(sessionId, isDuty)
    try {
      await agent.whenIdle()
      const firstSeq = agent.session.seq
      agent.followup(createUserMessage({
        content: [{ type: 'text', text }],
        source: { kind: 'plugin', plugin: isDuty ? DUTY_SOURCE_PLUGIN : TARGETED_SOURCE_PLUGIN },
      }))
      await agent.whenIdle()
      return summarize(agent.session.events, firstSeq)
    } finally {
      // Release our own handle when we created one; a live foreign agent stays.
      await dispose()
    }
  }
}
