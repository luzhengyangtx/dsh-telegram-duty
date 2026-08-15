/**
 * Pure text helpers for the Telegram message router: command recognition,
 * targeted-message prefix parsing, session-button callback parsing, and reply
 * chunking under Telegram's 4096-char message limit.
 * @module @luzhengyangtx/dsh-telegram-duty/router
 */

export type DutyCommand = 'away' | 'back' | 'help' | 'sessions' | 'duty' | 'unblock' | null

/** Recognize the plugin's own slash commands (exact match, trimmed). */
export function parseCommand(text: string): DutyCommand {
  const t = text.trim().toLowerCase()
  if (t === '/away' || t === '/a') return 'away'
  if (t === '/back' || t === '/b') return 'back'
  if (t === '/help' || t === '/h' || t === '/start') return 'help'
  if (t === '/sessions' || t === '/s') return 'sessions'
  if (t === '/duty' || t === '/d') return 'duty'
  if (t === '/unblock' || t === '/u') return 'unblock'
  return null
}

export interface TargetPrefix {
  /** 1-based snapshot index from the most recent /sessions list. */
  index: number
  /** Message text after the prefix (never empty). */
  rest: string
}

/**
 * Parse a `#N message` prefix used to send one message to a specific session
 * without changing the default route. `#N` alone (no message text) is not a
 * valid prefix; the gateway reports a dedicated hint for that shape.
 */
export function parseTargetPrefix(text: string): TargetPrefix | null {
  const match = /^#\s*(\d+)\s+(.+)$/s.exec(text.trim())
  if (match === null) return null
  const index = Number(match[1])
  if (!Number.isSafeInteger(index) || index < 1) return null
  return { index, rest: (match[2] ?? '').trim() }
}

/** True for a bare `#N` with no message content (needs a dedicated hint). */
export function isBareTargetPrefix(text: string): boolean {
  return /^#\s*\d+\s*$/.test(text.trim())
}

/** Parse a /sessions button payload like `sess:3` into its snapshot index. */
export function parseSessionCallback(data: string): { index: number } | null {
  const match = /^sess:(\d+)$/.exec(data)
  if (match === null) return null
  const index = Number(match[1])
  if (!Number.isSafeInteger(index) || index < 1) return null
  return { index }
}

/**
 * Split a long reply into chunks that fit one Telegram message, preferring
 * line boundaries and never splitting inside a ``` fenced code block.
 */
export function chunkText(text: string, maxChars: number): string[] {
  if (text === '') return []
  if (text.length <= maxChars) return [text]

  const chunks: string[] = []
  let rest = text
  while (rest.length > maxChars) {
    const window = rest.slice(0, maxChars)
    let cut = window.lastIndexOf('\n')
    if (cut <= 0) cut = maxChars
    const fences = (rest.slice(0, Math.min(rest.length, maxChars + 3)).match(/```/g) ?? []).length
    if (fences % 2 === 1) {
      // The window ends inside a fence: extend the cut past the closing fence.
      const open = rest.indexOf('```')
      const close = open === -1 ? -1 : rest.indexOf('```', open + 3)
      if (close > 0 && close < rest.length) cut = close + 3
    }
    chunks.push(rest.slice(0, cut).trimEnd())
    rest = rest.slice(cut).trimStart()
  }
  if (rest !== '') chunks.push(rest)
  return chunks
}
