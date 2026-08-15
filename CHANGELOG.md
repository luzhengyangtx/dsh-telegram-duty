# Changelog

All notable changes to this project are documented here. Stable releases are
tagged; intermediate development builds on npm are deprecated and point here.

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
