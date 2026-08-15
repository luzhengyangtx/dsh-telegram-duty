/**
 * Telegram duty gateway for DeepSeek Harness.
 *
 * Mounts a Telegram long-poll listener; whitelisted messages are delivered
 * into a dedicated "duty" DSH session and wake its agent, and the final
 * assistant text is replied to Telegram. While the gateway is in `duty` mode,
 * approval requests from ALL sessions are forwarded to Telegram instead of the
 * web UI; in `local` mode the web approval popup behaves normally.
 * @module @luzhengyangtx/dsh-telegram-duty
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-user-approval'
import {
  Config, DUTY_STATE_OFF_NAMESPACE, DUTY_STATE_ON_NAMESPACE, StateMarkerConfig,
  TELEGRAM_DUTY_NAMESPACE, resolveConfig, type CredentialsFile, type TelegramDutyConfig,
} from './config.ts'
import { TelegramClient } from './telegram.ts'
import { Gateway } from './gateway.ts'
import { telegramAskTool } from './ask-tool.ts'
import { telegramNotifyTool } from './notify-tool.ts'
import { telegramDutyProjection } from './projection.ts'
import { stringsFor } from './i18n.ts'

export const name = 'telegram-duty'
export const inject = ['settings', 'agents', 'agentDefaultModel', 'tools', 'commands']

/** Schema values win; empty token/chatId fall back to the credentials file. */
export function resolveRuntime(config: TelegramDutyConfig): TelegramDutyConfig {
  const resolved = resolveConfig(config)
  let credentials: CredentialsFile = {}
  if (resolved.credentialsFile) {
    try {
      credentials = JSON.parse(fs.readFileSync(resolved.credentialsFile, 'utf-8')) as CredentialsFile
    } catch {
      // Missing/unreadable credentials file: fall through to explicit values.
    }
  }
  return {
    ...resolved,
    token: resolved.token || credentials.token || '',
    chatId: resolved.chatId || credentials.chat_id || 0,
  }
}

/** Fill generic defaults for the two paths that must exist at runtime. */
export function effectiveRuntime(config: TelegramDutyConfig): TelegramDutyConfig {
  return {
    ...config,
    dataDir: config.dataDir && config.dataDir !== ''
      ? config.dataDir
      : path.join(process.env.DSH_HOME ?? '.', 'storages', 'telegram-duty'),
    dutyCwd: config.dutyCwd && config.dutyCwd !== '' ? config.dutyCwd : process.cwd(),
  }
}

/** Plugin entry: register settings, then mount the gateway. */
export async function apply(ctx: Context, config: TelegramDutyConfig = {}): Promise<void> {
  try {
    await mount(ctx, config)
  } catch (error) {
    // Leave an on-disk breadcrumb before the loader rolls the row back.
    try {
      const resolved = effectiveRuntime(resolveConfig(config))
      fs.mkdirSync(resolved.dataDir ?? '.', { recursive: true })
      fs.writeFileSync(
        `${resolved.dataDir ?? '.'}/startup-error.json`,
        JSON.stringify({ time: Date.now(), error: error instanceof Error ? error.stack ?? error.message : String(error) }, null, 2),
        'utf-8',
      )
    } catch {
      // Best effort only.
    }
    throw error
  }
}

async function mount(ctx: Context, config: TelegramDutyConfig): Promise<void> {
  const settings = ctx.settings.register(TELEGRAM_DUTY_NAMESPACE, Config, {
    base: config,
    applies: 'live',
    validate: (value) => {
      resolveConfig(value)
    },
  })
  // State-marker namespaces (browser-visible mode channel; see config.ts).
  const stateOn = ctx.settings.register(DUTY_STATE_ON_NAMESPACE, StateMarkerConfig, { applies: 'live' })
  const stateOff = ctx.settings.register(DUTY_STATE_OFF_NAMESPACE, StateMarkerConfig, { applies: 'live' })
  const runtime = effectiveRuntime(resolveRuntime(settings.get()))

  if (!runtime.token) {
    throw new Error('telegram-duty: token is required (set it in the patch config or in credentialsFile)')
  }
  if (!runtime.chatId) {
    throw new Error('telegram-duty: chatId is required (set it in the patch config or in credentialsFile)')
  }

  ctx.logger.info(
    'telegram-duty',
    `config ready: sessionId=${runtime.sessionId} chatId=${runtime.chatId} dutyCwd=${runtime.dutyCwd} watchMode=${runtime.watchMode} dataDir=${runtime.dataDir} approvalTimeoutMinutes=${runtime.approvalTimeoutMinutes}`,
  )

  // Smoke-test marker: proves apply() completed inside the live dsh process.
  try {
    fs.mkdirSync(runtime.dataDir ?? '', { recursive: true })
    fs.writeFileSync(
      `${runtime.dataDir ?? '.'}/startup.json`,
      JSON.stringify({ time: Date.now(), sessionId: runtime.sessionId, chatId: runtime.chatId }, null, 2),
      'utf-8',
    )
  } catch (error) {
    ctx.logger.warn('telegram-duty', `could not write startup marker: ${error instanceof Error ? error.message : String(error)}`)
  }

  const client = new TelegramClient(runtime.token, runtime.proxy ?? '')
  const gateway = new Gateway({ ctx, runtime, client, settings, stateOn, stateOff })

  ctx.effect(function* () {
    ctx.on('approval/request', gateway.onApprovalRequest, { prepend: true })
    ctx.on('session/event', gateway.onSessionEvent)
    ctx.tools.register(telegramAskTool(gateway))
    ctx.tools.register(telegramNotifyTool(gateway))
    ctx.commands.register({
      name: 'duty-mode',
      description: 'Show the Telegram duty state (local / duty)',
      recordInput: false,
      handler: async () => {
        await gateway.refreshStateMarker()
        return { kind: 'success' }
      },
    })
    ctx.commands.register({
      name: 'duty-mode-local',
      description: 'Switch the Telegram duty back to local mode',
      recordInput: false,
      handler: async () => {
        await gateway.switchToLocal()
        return { kind: 'success' }
      },
    })
    ctx.commands.register({
      name: 'duty-session',
      description: 'Attach the Telegram duty session (sidebar button fallback)',
      recordInput: false,
      handler: async () => {
        const result = await gateway.ensureDutyLive()
        if (result.error !== undefined) {
          ctx.logger.warn('telegram-duty', `duty-session command failed: ${result.error}`)
        }
        return { kind: 'success' }
      },
    })
    gateway.start()
    yield async () => {
      await gateway.stop()
    }
  }, 'telegram-duty lifecycle')

  // Duty-session marker projection: surfaces `telegramDuty` in session.list
  // so the web sidebar button can locate the duty session. The unit child
  // activates only when a projection registry is composed.
  ctx.inject(['sessionProjections'], (projectionCtx) => {
    projectionCtx.sessionProjections.register(telegramDutyProjection())
  })

  // Teach every session's agent about the phone channels (proactive push +
  // interactive questions); the section activates only when a system-prompt
  // service is composed.
  ctx.inject(['systemPrompt'], (promptCtx) => {
    promptCtx.systemPrompt.context({
      name: 'telegram-duty:phone-tools',
      order: 115,
      text: () => stringsFor(settings.get().language ?? 'en').promptNote,
    })
  })

  // Validate token + proxy in the background; the poller keeps retrying anyway.
  void client.getMe().then(
    (res) => {
      if (res.ok) {
        ctx.logger.info('telegram-duty', `Telegram bot connected: @${res.result?.username ?? res.result?.first_name ?? 'unknown'}`)
      } else {
        ctx.logger.warn('telegram-duty', `getMe rejected: ${res.description ?? 'unknown error'}`)
      }
    },
    (error: unknown) => {
      ctx.logger.warn('telegram-duty', `getMe failed: ${error instanceof Error ? error.message : String(error)}`)
    },
  )
}
