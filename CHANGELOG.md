# Changelog

All notable changes to this project are documented here. Stable releases are
tagged; intermediate development builds on npm are deprecated and point here.

## [0.5.0] - 2026-09-15 — duty broadcast + sidebar toggle + 0.1.5-rc.2 adaptation

> **Requires DeepSeek Harness ≥ 0.1.2-rc.1** (`session.snapshotEvents()` does not
> exist in 0.1.1-rc.2 and older). Users pinned to older DSH should stay on
> `0.4.0`.

- 📣 **Duty-mode turn broadcast** — while on duty, every finished turn of a
  non-duty session is reported to the phone: `📄 <title> · turn N ended` plus
  the turn's final reply (full text, split into multiple messages — never
  truncated), or a `⚠️` line for error/abort/blocked/max-token ends. Phone-initiated
  turns and the duty session itself are not re-reported (their replies already
  reach the phone).
- ✅ **Duty-mode completion notice** — when a session finishes its whole task
  and its agent goes idle, a `✅ <title> · task complete (N turns, M min)` line
  is sent (error endings are not "complete").
- 🎛 **Sidebar duty button is now a toggle** — clicking it while local turns
  duty on (the phone gets the "duty on" notice), clicking again returns to
  local; the status dot keeps showing the mode. The duty session itself is
  opened from the normal sidebar list.
- 🔧 **Adaptation to DSH 0.1.5-rc.2** — session projection definition uses the
  current `stateSchema`/`wire` shape; `ApprovalRequest` carries an `agent`
  field; client session rows use `id`/`displayTitle`/`running`; namespaces use
  literal strings (`settingsNamespace()` was removed); client bundle injects
  `@deepseek-ai/dsh-client-ui-renderer`.
- 🧹 **Lint cleanup** — authoritative type-aware lint is 0 errors for `src`
  (was 17); 2 `poller.ts` early-returns are kept and waived (concurrent
  `stop()` flips the flag after an await point).
- 🧪 133 unit tests passing (14 files).

### Deferred-migration register (policy note 2026-09-09, `snapshotEvents`)

The following 10 production `snapshotEvents()` calls are the pre-existing
read pattern, moved onto the policy-allowed API because the old synchronous
`get events()` was removed in DSH. They carry line-scoped
`typescript/no-deprecated` waivers. Each group has a planned migration — the
waiver is removed when its group migrates:

| Use | Sites | Migration target |
| --- | --- | --- |
| Session title | `gateway.ts:406,452,504`; `turn-watch.ts:146,155,211` (6) | read the title from the `sessionListMetadata` projection instead of scanning events |
| Pending-approval scan | `gateway.ts:500,519` (2) | subscribe to `approval/asked` / `approval/decided` and keep an incremental pending set (`pending.ts` folding can be reused) |
| Turn summary / final text | `turn-watch.ts:148`; `duty.ts:230` (2) | accumulate incrementally from the subscribed `session/event` stream at `turn/end` |

## [0.4.0] - 2026-08-16 — mobile experience release

- 🎯 Targeted sessions: `/sessions` lists the user's workspace sessions (live
  + offline, matching the web sidebar; blank drafts hidden, duty session
  excluded) with numbered buttons; tapping a number routes following messages
  there and confirms in a regular chat message. `#N message` sends a single
  message to session N (30-minute snapshot), offline targets are resumed
  automatically, and `/duty` returns to the default route.
- ⏳ Instant feedback: every task message is acknowledged immediately
  ("📨 收到，正在生成…") and a `sendChatAction('typing')` loop keeps the
  phone's typing animation alive until the result; processing errors reply
  "⚠️ 处理出错" and aborted turns stay silent.
- 📣 `telegram_notify` tool: any session's agent can proactively push a
  message to the phone; a global prompt note teaches agents about it and
  `telegram_ask`.
- ✅ Approval recovery: `/away` warns when the web UI still holds unanswered
  approvals, and `/unblock` cancels turns stuck on them (resend afterwards).
- 📱 Sidebar duty button (`sidebar.footer.action`): one-click open of the duty
  session with a live status dot; the session is located through a new
  `telegramDuty` session projection (no settings-wire changes).
- 🚩 Duty banner enlarged one notch (position/colors unchanged).
- 🔧 Internal: `SessionDriver` delivers into arbitrary sessions; cold-session
  listing via the persistence + projection-cache seam; workspace-registry
  ordering; 40+ new unit tests (119 total).

## [0.3.1] - 2026-08-16 — documentation & community release

- 📖 Quick Start (≈10 minutes, 5 steps) at the top of both READMEs.
- ❔ FAQ (8 entries), incl. proxy guidance for blocked networks and a
  no-reply troubleshooting order.
- 🗺 Roadmap table with an explicit free-forever tier and a pro-tier preview
  (no pro code exists).
- 🤝 Custom services section (email, starting price, delivery scope).
- 💝 Community links: Telegram user group, 爱发电 sponsor page; npm badge.
- 🐛 GitHub issue templates (bug report / feature request).

## [0.3.0] - 2026-08-16 — first clean public milestone

Complete, verified feature set:

- 📱 Telegram task loop: phone message → dedicated duty session (standard tool
  set) → reply back, long replies split under Telegram's limit.
- 🔐 Chat-id whitelist.
- ✅ Global approval forwarding with inline **[Approve] [Reject]** buttons
  (typed replies still work); 10-minute timeout fails closed.
- ❓ `telegram_ask` tool: agents push questions to the phone with one button
  per option; the duty persona prefers it.
- 🚩 Web duty banner: frame-wide notice with one-click switch back, text
  follows the web UI locale (zh/en), live-updated via host state markers.
- 🔀 Duty/local toggle: phone message or `/away` enters duty; web message or
  `/back` returns to local; state persists across restarts.
- 🌐 All Telegram messages support `language: zh | en` (default `en`).
- 🌍 Direct connection by default; `proxy` only when Telegram is blocked.
- 🗂 Durable message cursor (first run fast-forwards the backlog); channel
  down/backoff with recovery.
- Windows/Node 24 friendly: built-in `proxyEnv` proxying, no extra deps.

## [0.2.x] - development line (deprecated)

Rapid iteration builds published while wiring the banner; several were
intermediate and are deprecated on npm. Use 0.3.0.

## [0.1.0] - 2026-08-15 — initial release

Core loop, global approval forwarding, duty/local toggle, zh/en messages.
