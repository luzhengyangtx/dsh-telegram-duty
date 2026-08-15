import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApprovalManager, parseApprovalCallback, parseApprovalReply, renderApprovalQuestion } from '../src/approval.ts'
import { stringsFor } from '../src/i18n.ts'

const zh = stringsFor('zh')

describe('parseApprovalCallback', () => {
  it('parses allow and reject payloads', () => {
    expect(parseApprovalCallback('appr:7:allow')).toEqual({ id: 7, decision: 'allowed-once' })
    expect(parseApprovalCallback('appr:2:reject')).toEqual({ id: 2, decision: 'rejected' })
  })

  it('rejects malformed payloads', () => {
    expect(parseApprovalCallback('ask:1:0')).toBeNull()
    expect(parseApprovalCallback('appr:x:allow')).toBeNull()
    expect(parseApprovalCallback('appr:1:maybe')).toBeNull()
    expect(parseApprovalCallback('')).toBeNull()
  })
})

describe('parseApprovalReply', () => {
  it('parses a numbered allow', () => {
    expect(parseApprovalReply('3 同意', [3, 4])).toEqual({ kind: 'answer', id: 3, decision: 'allowed-once' })
  })

  it('parses a numbered reject with # prefix', () => {
    expect(parseApprovalReply('#5 拒绝', [5])).toEqual({ kind: 'answer', id: 5, decision: 'rejected' })
  })

  it('parses english answers', () => {
    expect(parseApprovalReply('2 ok', [2])).toEqual({ kind: 'answer', id: 2, decision: 'allowed-once' })
    expect(parseApprovalReply('2 no', [2])).toEqual({ kind: 'answer', id: 2, decision: 'rejected' })
  })

  it('targets the only pending approval for unnumbered words', () => {
    expect(parseApprovalReply('同意', [7])).toEqual({ kind: 'answer', id: 7, decision: 'allowed-once' })
    expect(parseApprovalReply('拒绝', [7])).toEqual({ kind: 'answer', id: 7, decision: 'rejected' })
  })

  it('flags ambiguous unnumbered answers with several pending', () => {
    expect(parseApprovalReply('同意', [1, 2])).toEqual({ kind: 'ambiguous' })
  })

  it('returns none for unrelated text', () => {
    expect(parseApprovalReply('帮我看看进度', [1])).toEqual({ kind: 'none' })
    expect(parseApprovalReply('9 也许', [9])).toEqual({ kind: 'none' })
    expect(parseApprovalReply('同意', [])).toEqual({ kind: 'none' })
  })
})

describe('renderApprovalQuestion', () => {
  it('renders with a reason', () => {
    expect(renderApprovalQuestion(3, { toolName: 'pwsh', reason: '删除文件' }, 10, zh)).toBe(
      '【审批 #3】工具「pwsh」请求批准：删除文件\n回复 3 同意 / 3 拒绝（10 分钟内有效）',
    )
  })

  it('renders without a reason', () => {
    expect(renderApprovalQuestion(1, { toolName: 'pwsh' }, 10, zh)).toContain('工具「pwsh」请求批准\n')
  })

  it('renders in english', () => {
    expect(renderApprovalQuestion(2, { toolName: 'pwsh', reason: 'why' }, 10, stringsFor('en'))).toBe(
      '[Approval #2] Tool "pwsh" requests approval: why\nReply 2 approve / 2 reject (valid 10 min)',
    )
  })
})

describe('ApprovalManager', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('ask sends the question with inline buttons and registers the pending id', async () => {
    const send = vi.fn(async () => undefined)
    const manager = new ApprovalManager({ timeoutMs: 60_000, strings: zh, send })
    const promise = manager.ask({ toolName: 'pwsh', reason: 'why' })
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith(
      expect.stringContaining('审批 #1'),
      [[
        { text: '✅ 同意', callback_data: 'appr:1:allow' },
        { text: '⛔ 拒绝', callback_data: 'appr:1:reject' },
      ]],
    )
    expect(manager.pendingIds()).toEqual([1])
    manager.answer(1, 'allowed-once')
    await expect(promise).resolves.toBe('allowed-once')
    expect(manager.pendingIds()).toEqual([])
  })

  it('rejects an unknown answer', () => {
    const manager = new ApprovalManager({ timeoutMs: 60_000, strings: zh, send: async () => undefined })
    expect(manager.answer(9, 'allowed-once')).toBe(false)
  })

  it('times out to rejected and notifies the user', async () => {
    const send = vi.fn(async (_text: string) => undefined)
    const manager = new ApprovalManager({ timeoutMs: 10_000, strings: zh, send })
    const promise = manager.ask({ toolName: 'pwsh' })
    vi.advanceTimersByTime(10_001)
    await expect(promise).resolves.toBe('rejected')
    expect(manager.pendingIds()).toEqual([])
    expect(send.mock.calls.at(-1)?.[0]).toContain('已超时')
  })

  it('aborts to cancelled via the request signal', async () => {
    const controller = new AbortController()
    const manager = new ApprovalManager({ timeoutMs: 60_000, strings: zh, send: async () => undefined })
    const promise = manager.ask({ toolName: 'pwsh', signal: controller.signal })
    controller.abort()
    await expect(promise).resolves.toBe('cancelled')
    expect(manager.pendingIds()).toEqual([])
  })

  it('settles already-aborted signals immediately', async () => {
    const controller = new AbortController()
    controller.abort()
    const manager = new ApprovalManager({ timeoutMs: 60_000, strings: zh, send: async () => undefined })
    await expect(manager.ask({ toolName: 'pwsh', signal: controller.signal })).resolves.toBe('cancelled')
  })

  it('cancelAll withdraws every pending approval', async () => {
    const manager = new ApprovalManager({ timeoutMs: 60_000, strings: zh, send: async () => undefined })
    const first = manager.ask({ toolName: 'a' })
    const second = manager.ask({ toolName: 'b' })
    manager.cancelAll()
    await expect(first).resolves.toBe('cancelled')
    await expect(second).resolves.toBe('cancelled')
  })

  it('send failures never reject the ask promise', async () => {
    const send = vi.fn(async () => {
      throw new Error('network down')
    })
    const manager = new ApprovalManager({ timeoutMs: 60_000, strings: zh, send })
    const promise = manager.ask({ toolName: 'pwsh' })
    // The promise stays pending (fails closed at timeout), send failure is contained.
    manager.answer(1, 'allowed-once')
    await expect(promise).resolves.toBe('allowed-once')
  })
})
