// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DOT_COLORS, dutyDotState, findDutySessionId, openDutyFlow } from '../src/client/duty-button.ts'
import { bannerStyle, buttonStyle } from '../src/client/DutyBanner.tsx'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-client-runtime/client'

function listState(rows: Array<[string, SessionSummary]>): SessionListState {
  return {
    ids: rows.map(([id]) => id as never),
    byId: Object.fromEntries(rows) as never,
    current: undefined,
    phase: 'ready',
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
  } as unknown as SessionListState
}

function row(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    sessionId: 's1' as never,
    blank: false,
    updatedAt: 1,
    ...overrides,
  }
}

describe('dutyDotState', () => {
  it('maps duty/local/unknown', () => {
    expect(dutyDotState('duty', true)).toBe('duty')
    expect(dutyDotState('local', true)).toBe('local')
    expect(dutyDotState('duty', false)).toBe('unknown')
    expect(dutyDotState('local', false)).toBe('unknown')
  })

  it('assigns the attention color to duty and gray to local', () => {
    expect(DOT_COLORS.duty).not.toBe(DOT_COLORS.local)
    expect(DOT_COLORS.error).toBe('#ef4444')
  })
})

describe('findDutySessionId', () => {
  it('finds the row whose telegramDuty projection is true', () => {
    const state = listState([
      ['a' as never, row({ sessionId: 'a' as never })],
      ['b' as never, row({ sessionId: 'b' as never, projectionValues: { telegramDuty: true } })],
    ])
    expect(findDutySessionId(state)).toBe('b')
  })

  it('returns undefined when no row is marked', () => {
    const state = listState([
      ['a' as never, row({ sessionId: 'a' as never, projectionValues: { telegramDuty: false } })],
      ['b' as never, row({ sessionId: 'b' as never })],
    ])
    expect(findDutySessionId(state)).toBeUndefined()
  })

  it('handles an empty list', () => {
    expect(findDutySessionId(listState([]))).toBeUndefined()
  })
})

describe('openDutyFlow', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('opens immediately when the session is already marked', async () => {
    const deps = {
      find: vi.fn(() => 'duty' as never),
      open: vi.fn(),
      runCommand: vi.fn(),
      refresh: vi.fn(async () => undefined),
      fail: vi.fn(),
      delayMs: 1,
      attempts: 3,
    }
    await openDutyFlow(deps)
    expect(deps.open).toHaveBeenCalledWith('duty')
    expect(deps.runCommand).not.toHaveBeenCalled()
    expect(deps.fail).not.toHaveBeenCalled()
  })

  it('attaches via the host command and retries until the scan finds it', async () => {
    let found = false
    const deps = {
      find: vi.fn(() => (found ? 'duty' as never : undefined)),
      open: vi.fn(),
      runCommand: vi.fn(),
      refresh: vi.fn(async () => undefined),
      fail: vi.fn(),
      delayMs: 50,
      attempts: 4,
    }
    const running = openDutyFlow(deps)
    await vi.advanceTimersByTimeAsync(50)
    expect(deps.runCommand).toHaveBeenCalledTimes(1)
    found = true
    await vi.advanceTimersByTimeAsync(50)
    await running
    expect(deps.open).toHaveBeenCalledWith('duty')
    expect(deps.fail).not.toHaveBeenCalled()
  })

  it('flashes the error state when the session never appears', async () => {
    const deps = {
      find: vi.fn(() => undefined),
      open: vi.fn(),
      runCommand: vi.fn(),
      refresh: vi.fn(async () => undefined),
      fail: vi.fn(),
      delayMs: 10,
      attempts: 2,
    }
    const running = openDutyFlow(deps)
    await vi.advanceTimersByTimeAsync(50)
    await running
    expect(deps.open).not.toHaveBeenCalled()
    expect(deps.fail).toHaveBeenCalledTimes(1)
  })
})

describe('banner styles (v0.4.0 size bump)', () => {
  it('keeps position and colors, one notch larger than the original', () => {
    expect(bannerStyle.position).toBe('fixed')
    expect(bannerStyle.background).toBe('#1f2937')
    expect(bannerStyle.fontSize).toBe(14)
    expect(bannerStyle.padding).toBe('10px 16px')
    expect(buttonStyle.fontSize).toBe(13)
    expect(buttonStyle.padding).toBe('4px 12px')
  })
})
