import { describe, expect, it } from 'vitest'
import { Targeting, displayTitle } from '../src/targeting.ts'
import type { SessionItem } from '../src/targeting.ts'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

function item(sessionId: string, title = sessionId, status: SessionItem['status'] = 'idle'): SessionItem {
  return { sessionId, title, status }
}

function ev(seq: number, type: string, data: unknown): SessionEvent {
  return { seq, type, data } as unknown as SessionEvent
}

describe('Targeting', () => {
  it('resolves snapshot indices 1-based after capture', () => {
    const targeting = new Targeting()
    targeting.capture([item('a', 'Alpha'), item('b', 'Beta')], 1000)
    expect(targeting.lookup(1, 1100)).toEqual({ sessionId: 'a', title: 'Alpha' })
    expect(targeting.lookup(2, 1100)).toEqual({ sessionId: 'b', title: 'Beta' })
  })

  it('returns undefined for unknown or zero indices', () => {
    const targeting = new Targeting()
    targeting.capture([item('a')], 1000)
    expect(targeting.lookup(0, 1100)).toBeUndefined()
    expect(targeting.lookup(3, 1100)).toBeUndefined()
  })

  it('returns undefined and reports expiry after the TTL', () => {
    const targeting = new Targeting(100)
    targeting.capture([item('a')], 1000)
    expect(targeting.lookup(1, 1101)).toBeUndefined()
    expect(targeting.expired(1101)).toBe(true)
    expect(targeting.expired(1099)).toBe(false)
  })

  it('reports not-expired before any snapshot', () => {
    const targeting = new Targeting()
    expect(targeting.expired(5000)).toBe(false)
  })

  it('a fresh capture replaces the previous snapshot', () => {
    const targeting = new Targeting()
    targeting.capture([item('a')], 1000)
    targeting.capture([item('x'), item('y')], 2000)
    expect(targeting.lookup(1, 2100)?.sessionId).toBe('x')
    expect(targeting.lookup(2, 2100)?.sessionId).toBe('y')
  })

  it('tracks the active target and resets to null (default route)', () => {
    const targeting = new Targeting()
    expect(targeting.activeId()).toBeNull()
    targeting.setActive('s1')
    expect(targeting.activeId()).toBe('s1')
    targeting.setActive(null)
    expect(targeting.activeId()).toBeNull()
  })
})

describe('displayTitle', () => {
  it('uses the fixed duty name for the duty session', () => {
    expect(displayTitle('duty-id', [ev(1, 'session/title', { title: 'Something else' })], true, '值班会话')).toBe('值班会话')
  })

  it('reads the latest session/title event for other sessions', () => {
    const events = [
      ev(1, 'session/title', { title: 'Old title' }),
      ev(2, 'assistant/message', {}),
      ev(3, 'session/title', { title: 'New title' }),
    ]
    expect(displayTitle('s1', events, false, '值班会话')).toBe('New title')
  })

  it('ignores empty titles and falls back to the session id', () => {
    expect(displayTitle('s1', [ev(1, 'session/title', { title: '  ' })], false, '值班会话')).toBe('s1')
    expect(displayTitle('s1', [], false, '值班会话')).toBe('s1')
  })
})
