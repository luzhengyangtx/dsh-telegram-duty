/**
 * Pure text helpers for the Telegram message router: command recognition and
 * reply chunking under Telegram's 4096-char message limit.
 * @module @luzhengyangtx/dsh-telegram-duty/router
 */

export type DutyCommand = 'away' | 'back' | 'help' | null

/** Recognize the plugin's own slash commands (exact match, trimmed). */
export function parseCommand(text: string): DutyCommand {
  const t = text.trim().toLowerCase()
  if (t === '/away' || t === '/a') return 'away'
  if (t === '/back' || t === '/b') return 'back'
  if (t === '/help' || t === '/h' || t === '/start') return 'help'
  return null
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
