/**
 * Model-facing telegram_notify tool: push one message to the user's phone
 * (Telegram) without waiting for a reply. Every session's agent can use it to
 * report, remind, or notify — the proactive-push counterpart of telegram_ask.
 * @module @luzhengyangtx/dsh-telegram-duty/notify-tool
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Gateway } from './gateway.ts'

/** Build the telegram_notify tool bound to one gateway. */
export function telegramNotifyTool(gateway: Gateway) {
  return defineTool({
    name: 'telegram_notify',
    description: 'Push one message to the user\'s phone over Telegram; does not wait for a reply. '
      + 'Use it to report completion, remind the user, or send a notification from any conversation.',
    parameters: {
      message: {
        type: 'string',
        required: true,
        description: 'The message text to send to the user\'s phone.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          sent: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args) {
      const text = String(args.message).trim()
      if (text === '') throw new Error('telegram_notify: message must not be empty')
      await gateway.notifyPhone(text)
      return { sent: true }
    },
  })
}
