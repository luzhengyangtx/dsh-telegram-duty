/**
 * Model-facing telegram_ask tool: the agent asks the user a question over
 * Telegram (their phone) and waits for the answer — one inline button per
 * option, text replies matching an option label as fallback.
 * @module @luzhengyangtx/dsh-telegram-duty/ask-tool
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Gateway } from './gateway.ts'

/** Build the telegram_ask tool bound to one gateway. */
export function telegramAskTool(gateway: Gateway) {
  return defineTool({
    name: 'telegram_ask',
    description: 'Ask the user a question over Telegram (their phone) and wait for the answer. '
      + 'Use it when you need the user to choose between options, confirm something, or supply missing information. '
      + 'Provide 2 to 4 short options; the user taps a button or replies with one option. '
      + 'Resolves with the chosen option, or answered=false when the user does not respond in time.',
    parameters: {
      question: {
        type: 'string',
        required: true,
        description: 'The specific question to ask the user.',
      },
      options: {
        type: 'array',
        required: true,
        description: '2 to 4 short choice labels; the user picks one.',
        items: { type: 'string' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          answered: { type: 'boolean', required: true },
          answer: { type: 'string' },
          optionIndex: { type: 'number' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      if (!Array.isArray(args.options) || args.options.length < 2 || args.options.length > 4) {
        throw new Error('telegram_ask requires 2 to 4 options')
      }
      const outcome = await gateway.askUser(String(args.question), args.options.map(String), exec.signal)
      return {
        answered: outcome.answered,
        ...(outcome.answer !== undefined ? { answer: outcome.answer } : {}),
        ...(outcome.optionIndex !== undefined ? { optionIndex: outcome.optionIndex } : {}),
      }
    },
  })
}
