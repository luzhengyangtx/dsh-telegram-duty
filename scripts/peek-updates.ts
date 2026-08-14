/**
 * Peek at currently pending Telegram updates without consuming them.
 * Usage: TG_CREDS=/path/to/config.json node --import tsx/esm scripts/peek-updates.ts
 */

import * as fs from 'node:fs'
import { TelegramClient } from '../src/telegram.ts'

const credsFile = process.env.TG_CREDS
if (credsFile === undefined || credsFile === '') {
  console.error('set TG_CREDS to a config.json path')
  process.exit(1)
}
const creds = JSON.parse(fs.readFileSync(credsFile, 'utf-8')) as { token?: string; proxy?: string }
const client = new TelegramClient(creds.token ?? '', creds.proxy ?? '')
try {
  const res = await client.getUpdates(0, 1)
  if (!res.ok) {
    console.log('getUpdates failed:', res.description)
    process.exitCode = 1
  } else {
    for (const update of res.result ?? []) {
      const msg = update.message
      console.log(JSON.stringify({
        update_id: update.update_id,
        chat: msg?.chat,
        text: msg?.text,
      }, null, 2))
    }
  }
} finally {
  client.close()
}
