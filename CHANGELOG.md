# Changelog

All notable changes to this project are documented here. Stable releases are
tagged; intermediate development builds on npm are deprecated and point here.

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
