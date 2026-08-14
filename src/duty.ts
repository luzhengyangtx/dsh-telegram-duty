/**
 * Duty-session driver: keeps one stable DSH session live, delivers Telegram
 * text as follow-up turns (which wakes its agent), waits for the turn to
 * settle, and returns the final assistant text. The resume/create +
 * summarize pattern follows @kriskwok/dsh-feishu-gateway (MIT).
 * @module @luzhengyangtx/dsh-telegram-duty/duty
 */

import type { Context } from '@deepseek-ai/cordis'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import type { ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { TextBlock } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

export interface TurnOutcome {
  text: string
  /** Non-empty when the turn ended abnormally. */
  error?: string
}

export interface DutySessionOptions {
  /** Stable session id (created on first delivery when absent). */
  sessionId: string
  /** Absolute workspace cwd for the duty session. */
  cwd: string
  /** Persona text registered under the deployment persona slot. */
  persona: string
}

/**
 * Aggregate the final assistant text from session events since firstSeq:
 * the last tool-free assistant/message of the turn; a `turn/end` with a
 * non-completed reason becomes an error outcome.
 */
export function summarize(events: readonly SessionEvent[], firstSeq: number): TurnOutcome {
  let started = false
  let text = ''
  let error: string | undefined
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
        .map((block) => block.text)
        .join('')
      if (joined !== '') text = joined
    }
    if (event.type === 'turn/end') {
      const reason = event.data.reason
      if (reason.kind === 'error') error = `${reason.error.code}: ${reason.error.message}`
      else if (reason.kind !== 'completed') error = `turn ended with reason "${reason.kind}"`
    }
  }
  return error === undefined ? { text } : { text, error }
}

/** Serialized delivery into one stable duty session. */
export class DutySession {
  private chain: Promise<unknown> = Promise.resolve()
  private presetPromise: Promise<string | undefined> | undefined

  constructor(
    private readonly ctx: Context,
    private readonly options: DutySessionOptions,
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

  /** Queue one Telegram text; resolves with the duty agent's final reply. */
  async run(text: string): Promise<TurnOutcome> {
    let outcome: TurnOutcome = { text: '' }
    const next = this.chain
      .catch(() => undefined)
      .then(async () => {
        try {
          outcome = await this.turn(text)
        } catch (error) {
          // Surface the failure as an outcome so the gateway can reply it.
          outcome = { text: '', error: error instanceof Error ? error.message : String(error) }
        }
      })
    this.chain = next.catch(() => undefined)
    await next
    return outcome
  }

  private async turn(text: string): Promise<TurnOutcome> {
    const agents = this.ctx.agents
    const defaultModel = this.ctx.agentDefaultModel
    const selection = defaultModel.currentSelection()
    const agentOptions = { provider: selection.provider, model: selection.model }
    const presetId = await this.resolvePreset()
    const setup = async (agentCtx: Context): Promise<void> => {
      const selected: ModelSelectionRef = { current: selection, assembled: undefined }
      installModelSelection(agentCtx, selected)
      // Same name + order as the deployment persona → shadows it for this agent.
      agentCtx.systemPrompt.section({ name: 'deployment:persona', order: 0, text: this.options.persona })
      // Mount the default preset so the duty agent has the standard tools
      // (bash/pwsh/fs/subagents/...), exactly like web-created sessions.
      if (presetId !== undefined) {
        const presets = this.ctx.get('agentPresets')
        if (presets !== undefined) await presets.mount(agentCtx, presetId)
      }
    }

    // Reuse an already-live agent when one exists (e.g. the web UI resumed the
    // duty session): resuming/creating again would collide with it.
    const sessionId = SessionId(this.options.sessionId)
    const live = agents.get(sessionId)
    let agent
    let dispose: () => Promise<void> = async () => undefined
    if (live !== undefined) {
      agent = live
    } else {
      let handle
      try {
        handle = await agents.resume({ resumeSessionId: sessionId, agentOptions, setup })
      } catch (error) {
        const resumeError = error instanceof Error ? error.message : String(error)
        this.ctx.logger.warn('telegram-duty', `resume "${this.options.sessionId}" failed (${resumeError}), creating`)
        try {
          handle = await agents.create({
            sessionId,
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
      agent = handle.agent
      dispose = () => handle.dispose().catch((error: unknown) => {
        this.ctx.logger.warn('telegram-duty', `dispose agent error: ${error instanceof Error ? error.message : String(error)}`)
      })
    }

    try {
      await agent.whenIdle()
      const firstSeq = agent.session.seq
      agent.followup(createUserMessage({
        content: [{ type: 'text', text }],
        source: { kind: 'plugin', plugin: 'telegram-duty' },
      }))
      await agent.whenIdle()
      return summarize(agent.session.events, firstSeq)
    } finally {
      // Release our own handle when we created one; a live foreign agent stays.
      await dispose()
    }
  }
}
