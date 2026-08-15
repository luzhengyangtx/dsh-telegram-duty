# dsh-telegram-duty

Turn [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) into your always-on pocket duty office: message a Telegram bot from your phone, the duty agent gets to work, and the result comes back to your phone. Idle cost is zero tokens — the plugin long-polls `getUpdates` and only wakes an agent when a message arrives.

[中文说明](README.zh.md)

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

## Requirements

- A built DeepSeek Harness checkout with `dsh` CLI working, and a configured model.
- A Telegram bot token (from [@BotFather](https://t.me/BotFather)) and your chat id.
- Node ^22.19.0 || >=24.0.0 (the built-in `proxyEnv` support of Node ≥ 24.5 is used when a proxy is configured).

## Install

This package is a DSH plugin **bundle**: it ships its own `cordis.patch.yml` and mounts one plugin row (`id: telegram-duty`).

From inside a DeepSeek Harness checkout (workspace member):

```powershell
# 1. place this package under packages/interaction/telegram-duty
pnpm install
node_modules\.bin\tsc.cmd -b packages/interaction/telegram-duty/tsconfig.json

# 2. edit your profile patch, e.g. C:\Users\<you>\.dsh\profiles\web\cordis.patch.yml:
# - insert:
#     - id: telegram-duty
#       name: '@luzhengyangtx/dsh-telegram-duty'
#       config:
#         token: '123456:YOUR-BOT-TOKEN'     # or omit and set credentialsFile
#         chatId: 123456789                  # your chat id (whitelist)
#         language: en                       # or zh

# 3. restart dsh web
pnpm dsh web
```

Outside the checkout (standalone folder), the plugin resolves its `@deepseek-ai/*` imports from its own `node_modules`, so install the two published packages first:

```powershell
pnpm add @deepseek-ai/cordis @deepseek-ai/schemastery
```

## Configuration

All fields live in the `telegram-duty` settings namespace (the web Settings page shows it, or put them under the patch row's `config:`).

| Field | Default | Meaning |
|-------|---------|---------|
| `token` | — | Bot token (marked secret; never shown in settings UIs). Alternatively set `credentialsFile` to a JSON file with `token` / `chat_id` / `proxy`. |
| `chatId` | — | Whitelisted chat id. |
| `proxy` | (empty) | HTTP proxy used for Bot API calls. **Leave empty for a direct connection — only set a local proxy (e.g. `http://127.0.0.1:7890`) when Telegram is blocked in your network.** |
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
