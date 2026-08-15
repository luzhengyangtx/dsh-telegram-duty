import { describe, expect, it } from 'vitest'
import { scanPendingApprovals } from '../src/pending.ts'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

function ev(seq: number, type: string, data: unknown): SessionEvent {
  return { seq, type, data } as unknown as SessionEvent
}

describe('scanPendingApprovals', () => {
  it('lists asked approvals that were never decided', () => {
    const events = [
      ev(0, 'user/message', {}),
      ev(1, 'approval/asked', { id: 'a1', toolName: 'pwsh', reason: 'install' }),
      ev(2, 'assistant/message', {}),
    ]
    expect(scanPendingApprovals(events)).toEqual([{ id: 'a1', toolName: 'pwsh', reason: 'install' }])
  })

  it('excludes asked/decided pairs', () => {
    const events = [
      ev(1, 'approval/asked', { id: 'a1', toolName: 'pwsh' }),
      ev(2, 'approval/decided', { id: 'a1', outcome: 'allowed-once' }),
      ev(3, 'approval/asked', { id: 'a2', toolName: 'bash' }),
      ev(4, 'approval/decided', { id: 'a2', outcome: 'rejected' }),
    ]
    expect(scanPendingApprovals(events)).toEqual([])
  })

  it('keeps undecided approvals among decided ones, in chronological order', () => {
    const events = [
      ev(1, 'approval/asked', { id: 'a1', toolName: 'pwsh' }),
      ev(2, 'approval/decided', { id: 'a1', outcome: 'rejected' }),
      ev(3, 'approval/asked', { id: 'a2', toolName: 'bash' }),
      ev(4, 'approval/asked', { id: 'a3', toolName: 'fs' }),
      ev(5, 'approval/decided', { id: 'a3', outcome: 'allowed-once' }),
    ]
    expect(scanPendingApprovals(events)).toEqual([{ id: 'a2', toolName: 'bash' }])
  })

  it('ignores unrelated events and omits the reason when absent', () => {
    const events = [
      ev(1, 'turn/start', {}),
      ev(2, 'approval/asked', { id: 'a1', toolName: 'fs' }),
      ev(3, 'tool/result', {}),
    ]
    expect(scanPendingApprovals(events)).toEqual([{ id: 'a1', toolName: 'fs' }])
  })
})
