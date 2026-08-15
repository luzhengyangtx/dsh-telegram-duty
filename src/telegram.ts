/**
 * Minimal Telegram Bot API client over node:https.
 *
 * Telegram requires a proxy on this machine (Clash at 127.0.0.1:7890). Node 24
 * supports HTTP CONNECT proxying natively through the https.Agent `proxy`
 * option, so no extra dependency or hand-rolled tunnel is needed.
 * @module @deepseek-ai/dsh-telegram-duty/telegram
 */

import * as https from 'node:https'

const debug = process.env.TELEGRAM_DUTY_DEBUG === '1'
const debugLog = (...args: unknown[]): void => {
  if (debug) console.log('[telegram-duty]', ...args)
}

export interface TelegramUser {
  id: number
  first_name?: string
}

export interface TelegramChat {
  id: number
  type?: string
}

export interface TelegramMessage {
  message_id: number
  from?: TelegramUser
  chat: TelegramChat
  text?: string
}

export interface TelegramUpdate {
  update_id: number
  message?: TelegramMessage
  callback_query?: TelegramCallbackQuery
}

/** One inline keyboard row: text buttons carrying short callback payloads. */
export type InlineKeyboard = Array<Array<{ text: string; callback_data: string }>>

export interface TelegramCallbackQuery {
  id: string
  from?: TelegramUser
  message?: TelegramMessage
  chat_instance?: string
  /** The callback_data attached to the pressed button. */
  data?: string
}

export interface TelegramResponse<T> {
  ok: boolean
  result?: T
  description?: string
  error_code?: number
}

/** One plain GET returning status + body. */
function request(url: string, agent: https.Agent, timeoutMs: number): Promise<{ status: number; body: string }> {
  debugLog('request:', url)
  return new Promise((resolve, reject) => {
    const req = https.request(url, { agent, method: 'GET' }, (res) => {
      let body = ''
      res.setEncoding('utf-8')
      res.on('data', (chunk: string) => {
        body += chunk
      })
      res.on('end', () => {
        resolve({ status: res.statusCode ?? 0, body })
      })
      res.on('error', reject)
    })
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`telegram request timed out after ${timeoutMs}ms`))
    })
    req.on('error', reject)
    req.end()
  })
}

/** Telegram Bot API client scoped to one bot token. */
export class TelegramClient {
  private readonly agent: https.Agent

  constructor(
    private readonly token: string,
    proxy: string,
  ) {
    // Node 24 built-in proxy support (v24.5+): the agent reads proxy settings
    // from the env-shaped `proxyEnv` option and tunnels CONNECT by itself.
    this.agent = proxy === ''
      ? new https.Agent({ keepAlive: true })
      : new https.Agent({
          keepAlive: true,
          proxyEnv: { HTTPS_PROXY: proxy, HTTP_PROXY: proxy },
        } as https.AgentOptions)
  }

  /** Invoke one Bot API method with query-string parameters. */
  async call<T>(method: string, params: Record<string, unknown>, timeoutMs: number): Promise<TelegramResponse<T>> {
    const qs = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null) continue
      qs.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value))
    }
    const url = `https://api.telegram.org/bot${this.token}/${method}?${qs.toString()}`
    const res = await request(url, this.agent, timeoutMs)
    return JSON.parse(res.body) as TelegramResponse<T>
  }

  /** Long-poll for new messages and button presses. */
  async getUpdates(offset: number, longPollSeconds: number): Promise<TelegramResponse<TelegramUpdate[]>> {
    return this.call<TelegramUpdate[]>(
      'getUpdates',
      { offset, timeout: longPollSeconds, allowed_updates: ['message', 'callback_query'] },
      (longPollSeconds + 15) * 1000,
    )
  }

  /** Send a text message to a chat, optionally with inline buttons. */
  async sendMessage(chatId: number, text: string, options: {
    replyToMessageId?: number
    keyboard?: InlineKeyboard
  } = {}): Promise<TelegramResponse<TelegramMessage>> {
    const params: Record<string, unknown> = { chat_id: chatId, text }
    if (options.replyToMessageId !== undefined) params.reply_to_message_id = options.replyToMessageId
    if (options.keyboard !== undefined && options.keyboard.length > 0) {
      params.reply_markup = { inline_keyboard: options.keyboard }
    }
    return this.call<TelegramMessage>('sendMessage', params, 30_000)
  }

  /** Acknowledge a button press (keeps the button spinner from hanging). */
  async answerCallbackQuery(queryId: string, text?: string): Promise<TelegramResponse<boolean>> {
    const params: Record<string, unknown> = { callback_query_id: queryId }
    if (text !== undefined && text !== '') params.text = text
    return this.call<boolean>('answerCallbackQuery', params, 10_000)
  }

  /** Identity check (used at startup to validate token + proxy). */
  async getMe(): Promise<TelegramResponse<{ id: number; username?: string; first_name?: string }>> {
    return this.call<{ id: number; username?: string; first_name?: string }>('getMe', {}, 30_000)
  }

  /** Close all pooled sockets (plugin teardown). */
  close(): void {
    this.agent.destroy()
  }
}
