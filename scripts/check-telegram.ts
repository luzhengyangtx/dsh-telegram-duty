/**
 * Standalone Telegram channel check: validates token + proxy tunnel +
 * getUpdates against the real Bot API without booting dsh.
 * Usage: TG_CREDS=/path/to/config.json node --import tsx/esm scripts/check-telegram.ts
 * config.json shape: { "token": "...", "proxy": "http://127.0.0.1:7890" }
 */

import * as fs from 'node:fs'
import { TelegramClient } from '../src/telegram.ts'

const credsFile = process.env.TG_CREDS
if (credsFile === undefined || credsFile === '') {
  console.error('set TG_CREDS to a config.json path')
  process.exit(1)
}
const creds = JSON.parse(fs.readFileSync(credsFile, 'utf-8')) as { token?: string; chat_id?: number; proxy?: string }

const client = new TelegramClient(creds.token ?? '', creds.proxy ?? '')

try {
  const me = await client.getMe()
  console.log(`getMe: ok=${me.ok} bot=@${me.result?.username ?? me.result?.first_name ?? '?'} desc=${me.description ?? ''}`)
  if (!me.ok) process.exitCode = 1
  const updates = await client.getUpdates(0, 1)
  console.log(`getUpdates: ok=${updates.ok} count=${updates.result?.length ?? 0} desc=${updates.description ?? ''}`)
  if (!updates.ok) process.exitCode = 1
  // Do NOT send a message during the automated check; the human e2e does that.
  console.log('CHANNEL OK')
} finally {
  client.close()
}
