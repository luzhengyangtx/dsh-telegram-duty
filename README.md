# dsh-telegram-duty

[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com) [![npm](https://img.shields.io/npm/v/@luzhengyangtx/dsh-telegram-duty)](https://www.npmjs.com/package/@luzhengyangtx/dsh-telegram-duty)

Turn [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) into your always-on pocket duty office: message a Telegram bot from your phone, the duty agent gets to work, and the result comes back to your phone. Idle cost is zero tokens — the plugin long-polls `getUpdates` and only wakes an agent when a message arrives.

[中文说明](README.zh.md)

## Quick Start (≈10 minutes)

1. **Create a bot** — chat with [@BotFather](https://t.me/BotFather), send `/newbot`, and copy the token (looks like `123456:ABC...`).
2. **Find your chat id** — send any message to [@userinfobot](https://t.me/userinfobot) (or to your new bot) and read the numeric `id`.
3. **Install the plugin** — from inside a DeepSeek Harness checkout:

   ```powershell
   dsh plugin --profile web add @luzhengyangtx/dsh-telegram-duty
   ```

4. **Configure** — add to `C:\Users\<you>\.dsh\profiles\web\cordis.patch.yml`:

   ```yaml
   - id: telegram-duty
     config:
       token: '123456:YOUR-BOT-TOKEN'   # step 1
       chatId: 123456789                # step 2 (whitelist)
       language: zh                     # or en
   ```

5. **Restart** `dsh web` and send any message to your bot from the phone. Done — the duty agent answers.

> While on duty, the web UI shows a banner telling you approvals are forwarded to your phone, with a one-click switch back.

## Features

- 📱 **Task loop** — Telegram message → dedicated "duty" DSH session (its agent has the standard tool set) → final reply back to Telegram; long replies are split under Telegram's message limit.
- 🔐 **Whitelist** — only your own chat id is served; other senders are logged and ignored.
- ✅ **Global approval forwarding** — in *duty* mode, approval requests from **all** sessions go to your phone with **[✅ Approve] [⛔ Reject] buttons** (tap to answer; typing `3 approve / 3 reject` still works). Unanswered approvals time out to *rejected* (fail-closed, 10 minutes by default).
- ❓ **telegram_ask tool** — when an agent needs you to choose between options, confirm something, or supply missing information, it pushes the question to your phone with **one button per option**; the duty agent is prompted to prefer it.
- 🔀 **Duty / local toggle**
  - Enter duty: send any phone message, send `/away`, or flip `watchMode` in the web settings.
  - Back to local: send any message in the web UI, or send `/back`.
  - In local mode approvals stay in the web popup; in duty mode the popup is paused.
- 🚩 **Duty banner** — while on duty, a frame-wide web banner shows "approvals are on your phone" with a one-click switch back.
- 🗂 **Durable** — the `getUpdates` cursor and the watch mode persist across restarts; backlog is fast-forwarded on the very first run only.
- 🌐 **English & Chinese** — every Telegram message respects the `language` setting (`zh` | `en`, default `en`).
- 🌍 **Direct-connection friendly** — connects **directly** by default; configure `proxy` only when Telegram is blocked in your network (see the table below).

## Configuration

All fields live in the `telegram-duty` settings namespace (the web Settings page shows it, or put them under the patch row's `config:`).

| Field | Default | Meaning |
|-------|---------|---------|
| `token` | — | Bot token (marked secret; never shown in settings UIs). Alternatively set `credentialsFile` to a JSON file with `token` / `chat_id` / `proxy`. |
| `chatId` | — | Whitelisted chat id. |
| `proxy` | (empty) | HTTP proxy used for Bot API calls. **Leave empty for a direct connection — only set a local proxy (e.g. `http://127.0.0.1:7890`) when Telegram is blocked in your network, and keep that proxy running.** |
| `sessionId` | `telegram-duty` | Stable DSH session id; created on first message. |
| `dutyCwd` | process cwd | Workspace directory of the duty session. |
| `approvalTimeoutMinutes` | `10` | Unanswered approvals are rejected after this. |
| `watchMode` | `local` | `local` (web popups) or `duty` (approvals to Telegram). |
| `language` | `en` | Language of all Telegram messages: `en` or `zh`. |
| `dataDir` | `<DSH_HOME>/storages/telegram-duty` | Offset persistence directory. |
| `credentialsFile` | — | Optional JSON file `{ token, chat_id, proxy }` for credentials defaults. |
| `replyChunkChars` | `3800` | Split threshold for long replies (Telegram limit 4096). |

## Phone commands

- `/help` — usage
- `/away` — enter duty mode (approvals go to the phone)
- `/back` — return to local mode
- `3 approve` / `3 reject` — answer approval #3; with a single pending approval, bare `approve`/`reject` works too.

## FAQ

- **My bot doesn't reply.** Check in order: ① token and chatId are correct; ② you have sent `/start` to the bot at least once (bots cannot message first); ③ the DSH log shows no `telegram-duty` errors; ④ `watchMode`/language behave as expected.
- **How do I find my chat id?** Send any message to [@userinfobot](https://t.me/userinfobot); it replies with your numeric id.
- **Do I need a proxy?** No — the plugin connects directly by default. Set `proxy` (e.g. `http://127.0.0.1:7890` for Clash) only when your network blocks Telegram, and keep that proxy running while DSH is up.
- **Does it cost tokens while idle?** No. The plugin long-polls `getUpdates`; an agent is woken only when a message arrives.
- **Does it work when my computer is off?** No — the plugin runs together with DSH. Nothing is lost across restarts (the update cursor is persisted to disk).
- **What arrives on my phone?** Task results, approval requests from any session (in duty mode), and agent questions (`telegram_ask`).
- **Will the bot answer messages in groups?** No — the whitelist only serves your own chat id; everything else is logged and ignored.
- **How do I update the plugin?** Run `dsh plugin --profile web add @luzhengyangtx/dsh-telegram-duty@<version>` (or bump the dependency in your profile's `package.json`).

## Roadmap

| Status | Item | Tier |
|--------|------|------|
| ✅ shipped (v0.3.0) | core loop · approval buttons · `telegram_ask` · duty banner · zh/en | free |
| 🚧 planned (v1.x) | voice-message notes, more handy utilities | free |
| 🔭 preview only | multi-platform (Feishu / WhatsApp / …), team & multi-user mode, cloud hosting, priority support | **pro (future)** |

Free forever: Telegram duty, global approval forwarding, duty/local toggle, web duty banner, zh/en. The **pro** row is only a preview — no pro code exists yet; it marks the direction of a future commercial edition.

## Custom Services

Need help onboarding, configuration, connecting other platforms, or bespoke features? Email **dsh-telegram-duty@outlook.com**. Typical engagements start at ¥500 (integration + configuration + Q&A); complex work is quoted case by case. Scope of delivery (working setup + docs + basic Q&A) is agreed before the work starts.

## Community & Support

- 💬 Telegram group: https://t.me/+w8w7kAnGniRhZTJk
- 💝 Sponsor on 爱发电 (afdian): https://afdian.com/a/luzhengyangtx
- ⭐ GitHub: https://github.com/luzhengyangtx/dsh-telegram-duty

## Dev

```powershell
pnpm --filter "@luzhengyangtx/dsh-telegram-duty" run typecheck
node_modules\.bin\vitest.cmd run packages/interaction/telegram-duty/tests

# channel self-check against a real bot:
$env:TG_CREDS='C:\path\to\config.json'
node --import tsx/esm packages/interaction/telegram-duty/scripts/check-telegram.ts
```

## License

MIT. The session-driving pattern (resume/create + summarize) follows [@kriskwok/dsh-feishu-gateway](https://github.com/kriskwok/dsh-feishu-gateway) (MIT) — see LICENSE.
