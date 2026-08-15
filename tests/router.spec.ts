import { describe, expect, it } from 'vitest'
import { chunkText, isBareTargetPrefix, parseCommand, parseSessionCallback, parseTargetPrefix } from '../src/router.ts'
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

  it('recognizes sessions and duty', () => {
    expect(parseCommand('/sessions')).toBe('sessions')
    expect(parseCommand('/S')).toBe('sessions')
    expect(parseCommand('/duty')).toBe('duty')
    expect(parseCommand('/D')).toBe('duty')
  })

  it('recognizes unblock', () => {
    expect(parseCommand('/unblock')).toBe('unblock')
    expect(parseCommand('/u')).toBe('unblock')
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

describe('parseTargetPrefix', () => {
  it('parses a #N message prefix', () => {
    expect(parseTargetPrefix('#3 帮我看看进度')).toEqual({ index: 3, rest: '帮我看看进度' })
    expect(parseTargetPrefix('#3\n第二行内容')).toEqual({ index: 3, rest: '第二行内容' })
  })

  it('allows whitespace between # and the number', () => {
    expect(parseTargetPrefix('# 1 hello')).toEqual({ index: 1, rest: 'hello' })
  })

  it('rejects bare numbers, zero, and negative/plain text', () => {
    expect(parseTargetPrefix('#3')).toBeNull()
    expect(parseTargetPrefix('#0 hello')).toBeNull()
    expect(parseTargetPrefix('#-1 hello')).toBeNull()
    expect(parseTargetPrefix('#abc hello')).toBeNull()
    expect(parseTargetPrefix('3 帮我看看')).toBeNull()
  })
})

describe('isBareTargetPrefix', () => {
  it('matches bare #N shapes', () => {
    expect(isBareTargetPrefix('#3')).toBe(true)
    expect(isBareTargetPrefix('# 3 ')).toBe(true)
    expect(isBareTargetPrefix('#3 帮我看看')).toBe(false)
    expect(isBareTargetPrefix('hello')).toBe(false)
  })
})

describe('parseSessionCallback', () => {
  it('parses sess:N payloads', () => {
    expect(parseSessionCallback('sess:3')).toEqual({ index: 3 })
  })

  it('rejects malformed payloads', () => {
    expect(parseSessionCallback('sess:0')).toBeNull()
    expect(parseSessionCallback('sess:x')).toBeNull()
    expect(parseSessionCallback('appr:1:allow')).toBeNull()
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
    expect(chunks.some(c => c.includes('```') && !c.includes('code here'))).toBe(false)
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
      expect(help).toContain('/sessions')
      expect(help).toContain('/duty')
    }
  })
})
