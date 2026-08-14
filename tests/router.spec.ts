import { describe, expect, it } from 'vitest'
import { chunkText, parseCommand } from '../src/router.ts'
import { stringsFor } from '../src/i18n.ts'

describe('parseCommand', () => {
  it('recognizes away/back/help with and without aliases', () => {
    expect(parseCommand('/away')).toBe('away')
    expect(parseCommand('/A')).toBe('away')
    expect(parseCommand('/back')).toBe('back')
    expect(parseCommand('/b')).toBe('back')
    expect(parseCommand('/help')).toBe('help')
    expect(parseCommand('/start')).toBe('help')
  })

  it('ignores surrounding whitespace and case', () => {
    expect(parseCommand('  /AWAY  ')).toBe('away')
  })

  it('returns null for ordinary text', () => {
    expect(parseCommand('帮我查一下进度')).toBeNull()
    expect(parseCommand('/status')).toBeNull()
    expect(parseCommand('')).toBeNull()
  })
})

describe('chunkText', () => {
  it('returns [] for empty input', () => {
    expect(chunkText('', 100)).toEqual([])
  })

  it('passes short text through unchanged', () => {
    expect(chunkText('short', 100)).toEqual(['short'])
  })

  it('splits long text at line boundaries', () => {
    const text = 'line one\nline two\nline three'
    const chunks = chunkText(text, 10)
    expect(chunks.join('\n')).toBe(text)
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(10)
  })

  it('does not split inside a fenced code block', () => {
    const text = 'before\n```\ncode here\n```\nafter'
    const chunks = chunkText(text, 10)
    expect(chunks.some((c) => c.includes('```') && !c.includes('code here'))).toBe(false)
  })

  it('hard-splits when a single line exceeds the limit', () => {
    const chunks = chunkText('x'.repeat(25), 10)
    expect(chunks).toHaveLength(3)
  })
})

describe('help text', () => {
  it('mentions the key commands in both languages', () => {
    for (const language of ['zh', 'en'] as const) {
      const help = stringsFor(language).help
      expect(help).toContain('/away')
      expect(help).toContain('/back')
    }
  })
})
