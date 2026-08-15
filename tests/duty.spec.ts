import { describe, expect, it } from 'vitest'
import { summarize } from '../src/duty.ts'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

/** Build a minimal session event (types are a big union; cast for test data). */
function ev(seq: number, type: string, data: unknown): SessionEvent {
  return { seq, type, data } as unknown as SessionEvent
}

function assistant(seq: number, content: ContentBlock[]): SessionEvent {
  return ev(seq, 'assistant/message', { turn: 1, step: 1, message: { content } })
}

describe('summarize', () => {
  it('ignores events before firstSeq', () => {
    const events = [assistant(1, [{ type: 'text', text: 'old' }])]
    expect(summarize(events, 2)).toEqual({ text: '' })
  })

  it('joins text blocks of the final assistant message', () => {
    const events = [
      ev(2, 'turn/start', { turn: 1 }),
      assistant(3, [{ type: 'text', text: '你好' }, { type: 'text', text: '世界' }]),
      ev(4, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    ]
    expect(summarize(events, 2)).toEqual({ text: '你好世界' })
  })

  it('skips intermediate tool-call messages and keeps the last plain text', () => {
    const events = [
      ev(2, 'turn/start', { turn: 1 }),
      assistant(3, [{ type: 'tool-call', id: 'c1' as never, name: 'pwsh', arguments: '{}' }]),
      assistant(4, [{ type: 'text', text: 'first' }]),
      assistant(5, [{ type: 'text', text: 'final' }]),
      ev(6, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    ]
    expect(summarize(events, 2)).toEqual({ text: 'final' })
  })

  it('reports a model-error turn end', () => {
    const events = [
      ev(2, 'turn/start', { turn: 1 }),
      assistant(3, [{ type: 'text', text: 'partial' }]),
      ev(4, 'turn/end', { turn: 1, reason: { kind: 'error', error: { code: 'E_MODEL', message: 'boom' } } }),
    ]
    expect(summarize(events, 2)).toEqual({ text: 'partial', error: 'E_MODEL: boom' })
  })

  it('reports a non-completed turn end', () => {
    const events = [
      ev(2, 'turn/start', { turn: 1 }),
      ev(3, 'turn/end', { turn: 1, reason: { kind: 'max-tokens' } }),
    ]
    expect(summarize(events, 2)).toEqual({ text: '', error: 'turn ended with reason "max-tokens"' })
  })

  it('marks an aborted turn as cancelled, not an error', () => {
    const events = [
      ev(2, 'turn/start', { turn: 1 }),
      assistant(3, [{ type: 'text', text: 'partial' }]),
      ev(4, 'turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } }),
    ]
    expect(summarize(events, 2)).toEqual({ text: 'partial', cancelled: true })
  })
})
