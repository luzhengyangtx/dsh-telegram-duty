// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { DOT_COLORS, dutyDotState, toggleAction } from '../src/client/duty-button.ts'
import { bannerStyle, buttonStyle } from '../src/client/DutyBanner.tsx'

describe('dutyDotState', () => {
  it('maps duty/local/unknown', () => {
    expect(dutyDotState('duty', true)).toBe('duty')
    expect(dutyDotState('local', true)).toBe('local')
    expect(dutyDotState('duty', false)).toBe('unknown')
    expect(dutyDotState('local', false)).toBe('unknown')
  })

  it('assigns the attention color to duty and gray to local', () => {
    expect(DOT_COLORS.duty).toBe('#f59e0b')
    expect(DOT_COLORS.local).toBe('#9ca3af')
    expect(DOT_COLORS.unknown).toBe('rgba(156, 163, 175, 0.45)')
  })
})

describe('toggleAction', () => {
  it('switches back to local while on duty', () => {
    expect(toggleAction('duty')).toBe('off')
  })

  it('turns duty on while local or before the first marker', () => {
    expect(toggleAction('local')).toBe('on')
    expect(toggleAction('unknown')).toBe('on')
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
