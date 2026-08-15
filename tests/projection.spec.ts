import { describe, expect, it } from 'vitest'
import { isDutySourceEvent, telegramDutyProjection } from '../src/projection.ts'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

function ev(type: string, data: unknown): SessionEvent {
  return { seq: 1, type, data } as unknown as SessionEvent
}

describe('isDutySourceEvent', () => {
  it('matches phone-injected duty messages only', () => {
    expect(isDutySourceEvent(ev('user/message', { source: { kind: 'plugin', plugin: 'telegram-duty' } }))).toBe(true)
    expect(isDutySourceEvent(ev('user/message', { source: { kind: 'plugin', plugin: 'telegram-duty-targeted' } }))).toBe(false)
    expect(isDutySourceEvent(ev('user/message', { source: { kind: 'user' } }))).toBe(false)
    expect(isDutySourceEvent(ev('assistant/message', { message: { content: [] } }))).toBe(false)
  })
})

describe('telegramDutyProjection', () => {
  const unit = telegramDutyProjection()

  it('starts unmarked and latches once a duty message arrives', () => {
    const dutyMessage = ev('user/message', { source: { kind: 'plugin', plugin: 'telegram-duty' } })
    const noise = ev('user/message', { source: { kind: 'plugin', plugin: 'telegram-duty-targeted' } })
    let state = unit.init()
    expect(unit.view(state)).toBe(false)
    state = unit.apply(state, noise)
    expect(unit.view(state)).toBe(false)
    state = unit.apply(state, dutyMessage)
    expect(unit.view(state)).toBe(true)
    // Latch: further events keep it marked (and return the same reference).
    const next = unit.apply(state, noise)
    expect(next).toBe(state)
    expect(unit.view(next)).toBe(true)
  })
})
