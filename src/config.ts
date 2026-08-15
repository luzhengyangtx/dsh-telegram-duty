/**
 * Telegram duty gateway configuration. Explicit values in this schema
 * (settings / patch row config) always win; an optional `credentialsFile`
 * can supply token / chat_id / proxy defaults.
 * @module @luzhengyangtx/dsh-telegram-duty/config
 */

import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'

/** Settings document namespace owned by this plugin. */
export const TELEGRAM_DUTY_NAMESPACE = settingsNamespace('telegram-duty')

/**
 * State-marker namespaces: the web settings wire is allowlisted, so the
 * browser half cannot READ this plugin's configuration namespace. Instead the
 * host writes a timestamp into the marker namespace matching the current watch
 * mode; the forwarded `settings/document-updated` event carries the namespace
 * name verbatim, and the banner derives the mode from WHICH marker moved.
 */
export const DUTY_STATE_ON_NAMESPACE = settingsNamespace('telegram-duty-on')
export const DUTY_STATE_OFF_NAMESPACE = settingsNamespace('telegram-duty-off')

/** Trivial schema for the state-marker sections. */
export const StateMarkerConfig: Schema<{ n?: number }> = z.object({
  n: z.number().default(0),
})

/** User-facing configuration; every field defaults at the schema boundary. */
export interface TelegramDutyConfig {
  /** Bot token. Empty means "read from credentialsFile" when one is set. */
  token?: string
  /** Allowed Telegram chat id (whitelist). */
  chatId?: number
  /** HTTP(S) proxy used for Telegram API calls; empty = direct connection. */
  proxy?: string
  /** Stable DSH session id for the duty session (auto-created on first message). */
  sessionId?: string
  /** Absolute workspace cwd for the duty session (defaults to process cwd). */
  dutyCwd?: string
  /** Approval timeout in minutes; unanswered approvals are rejected. */
  approvalTimeoutMinutes?: number
  /** Watch toggle: local (web approvals) or duty (Telegram approvals). */
  watchMode?: 'local' | 'duty'
  /** Language of all Telegram messages: zh or en. */
  language?: 'zh' | 'en'
  /** Plugin data directory (offset persistence); defaults under DSH_HOME. */
  dataDir?: string
  /** Optional JSON file holding token / chat_id / proxy defaults. */
  credentialsFile?: string
  /** Telegram sendMessage text limit minus headroom; longer replies are split. */
  replyChunkChars?: number
}

export const Config: Schema<TelegramDutyConfig> = z.object({
  token: z.string().role('secret').default(''),
  chatId: z.number().default(0),
  proxy: z.string().default(''),
  sessionId: z.string().default('telegram-duty'),
  dutyCwd: z.string().default(''),
  approvalTimeoutMinutes: z.number().default(10),
  watchMode: z.union([z.const('local'), z.const('duty')]).default('local'),
  language: z.union([z.const('zh'), z.const('en')]).default('en'),
  dataDir: z.string().default(''),
  credentialsFile: z.string().default(''),
  replyChunkChars: z.number().default(3800),
})

/** Apply schema defaults (and surface schema errors early). */
export function resolveConfig(config: TelegramDutyConfig = {}): TelegramDutyConfig {
  return Config(config)
}

/** Shape of the notify bridge credentials file (subset we use). */
export interface CredentialsFile {
  token?: string
  chat_id?: number
  proxy?: string
}
