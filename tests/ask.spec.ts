import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TelegramAskManager, parseAskCallback } from '../src/ask.ts'
import { stringsFor } from '../src/i18n.ts'

const zh = stringsFor('zh')

describe('parseAskCallback', () => {
  it('parses ask option payloads', () => {
    expect(parseAskCallback('ask:3:1')).toEqual({ id: 3, index: 1 })
    expect(parseAskCallback('ask:10:0')).toEqual({ id: 10, index: 0 })
  })

  it('rejects malformed payloads', () => {
    expect(parseAskCallback('appr:1:allow')).toBeNull()
    expect(parseAskCallback('ask:x:1')).toBeNull()
    expect(parseAskCallback('ask:1:x')).toBeNull()
    expect(parseAskCallback('')).toBeNull()
  })
})

describe('TelegramAskManager', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('ask sends the question with one button per option', async () => {
    const send = vi.fn(async () => undefined)
    const manager = new TelegramAskManager({ timeoutMs: 60_000, strings: zh, send })
    const promise = manager.ask({ question: '选哪个？', options: ['方案A', '方案B'] })
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith(
      expect.stringContaining('选哪个？'),
      [
        [{ text: '方案A', callback_data: 'ask:1:0' }],
        [{ text: '方案B', callback_data: 'ask:1:1' }],
      ],
    )
    manager.answerByIndex(1, 1)
    await expect(promise).resolves.toEqual({ answered: true, optionIndex: 1, answer: '方案B' })
  })

  it('answerByIndex rejects unknown ids and out-of-range indexes', () => {
    const manager = new TelegramAskManager({ timeoutMs: 60_000, strings: zh, send: async () => undefined })
    void manager.ask({ question: 'q', options: ['a', 'b'] })
    expect(manager.answerByIndex(9, 0)).toBe(false)
    expect(manager.answerByIndex(1, 5)).toBe(false)
  })

  it('answerByLabel settles the exact label match, most recent first', async () => {
    const manager = new TelegramAskManager({ timeoutMs: 60_000, strings: zh, send: async () => undefined })
    const first = manager.ask({ question: 'q1', options: ['a', 'b'] })
    const second = manager.ask({ question: 'q2', options: ['c', 'd'] })
    expect(manager.answerByLabel('  C ')).toBe(true)
    await expect(second).resolves.toEqual({ answered: true, optionIndex: 0, answer: 'c' })
    expect(manager.answerByLabel('a')).toBe(true)
    await expect(first).resolves.toEqual({ answered: true, optionIndex: 0, answer: 'a' })
  })

  it('answerByLabel leaves non-matching text alone', () => {
    const manager = new TelegramAskManager({ timeoutMs: 60_000, strings: zh, send: async () => undefined })
    void manager.ask({ question: 'q', options: ['a', 'b'] })
    expect(manager.answerByLabel('随便什么')).toBe(false)
  })

  it('times out to unanswered with a notice', async () => {
    const send = vi.fn(async (_text: string) => undefined)
    const manager = new TelegramAskManager({ timeoutMs: 10_000, strings: zh, send })
    const promise = manager.ask({ question: 'q', options: ['a', 'b'] })
    vi.advanceTimersByTime(10_001)
    await expect(promise).resolves.toEqual({ answered: false })
    expect(send.mock.calls.at(-1)?.[0]).toContain('已超时')
  })

  it('aborts to unanswered via the request signal', async () => {
    const controller = new AbortController()
    const manager = new TelegramAskManager({ timeoutMs: 60_000, strings: zh, send: async () => undefined })
    const promise = manager.ask({ question: 'q', options: ['a', 'b'], signal: controller.signal })
    controller.abort()
    await expect(promise).resolves.toEqual({ answered: false })
  })

  it('cancelAll withdraws every pending ask', async () => {
    const manager = new TelegramAskManager({ timeoutMs: 60_000, strings: zh, send: async () => undefined })
    const first = manager.ask({ question: 'q1', options: ['a', 'b'] })
    const second = manager.ask({ question: 'q2', options: ['c', 'd'] })
    manager.cancelAll()
    await expect(first).resolves.toEqual({ answered: false })
    await expect(second).resolves.toEqual({ answered: false })
  })
})
