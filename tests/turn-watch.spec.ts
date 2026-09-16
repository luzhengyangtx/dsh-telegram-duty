import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { stringsFor } from '../src/i18n.ts'
import { TurnWatch } from '../src/turn-watch.ts'

/** Build a minimal session event (types are a big union; cast for test data). */
function ev(seq: number, type: string, data: unknown): SessionEvent {
  return { seq, type, data } as unknown as SessionEvent
}

function userMessage(seq: number, source: unknown): SessionEvent {
  return ev(seq, 'user/message', { source })
}

function assistant(seq: number, turn: number, text: string): SessionEvent {
  return ev(seq, 'assistant/message', { turn, step: 1, message: { content: [{ type: 'text', text }] } })
}

function titleEvent(seq: number, title: string): SessionEvent {
  return ev(seq, 'session/title', { title })
}

interface FakeSession {
  id: string
  events: SessionEvent[]
  /** Mirrors the production reader TurnWatch uses (the live event log). */
  snapshotEvents: () => SessionEvent[]
}

/** Minimal session fake whose snapshot reader follows later pushes to `events`. */
function fakeSession(id: string): FakeSession {
  const events: SessionEvent[] = []
  return { id, events, snapshotEvents: () => events }
}

interface FakeAgent extends Agent {
  id: string
  status: 'idle' | 'running'
  inbox: { nextStep: unknown[]; nextTurn: unknown[] }
  session: FakeSession
}

function fakeAgent(id: string, events: SessionEvent[], status: 'idle' | 'running' = 'idle'): FakeAgent {
  return {
    id,
    status,
    inbox: { nextStep: [], nextTurn: [] },
    session: { id, events, snapshotEvents: () => events },
  } as unknown as FakeAgent
}

interface Harness {
  watch: TurnWatch
  send: ReturnType<typeof vi.fn>
  duty: boolean
  agents: Map<string, FakeAgent>
  /** Append one event to the session log and feed it to the watch (live-log semantics). */
  feed: (session: FakeSession, event: SessionEvent) => void
}

function makeWatch(dutyId = 'telegram-duty'): Harness {
  const send = vi.fn(async (_text: string) => undefined)
  const agents = new Map<string, FakeAgent>()
  const duty = { on: false }
  const watch = new TurnWatch({
    ctx: {
      agents: { get: (sid: unknown) => agents.get(String(sid)) },
    } as unknown as Context,
    dutyId,
    isDuty: () => duty.on,
    send: text => send(text),
    strings: stringsFor('zh'),
    settleMs: 20,
  })
  const harness: Harness = {
    watch,
    send,
    get duty() { return duty.on },
    set duty(value: boolean) { duty.on = value },
    agents,
    feed: (session, event) => {
      session.events.push(event)
      watch.onSessionEvent(session as never, event)
    },
  }
  return harness
}

describe('TurnWatch turn reports', () => {
  let h: Harness
  beforeEach(() => {
    vi.useFakeTimers()
    h = makeWatch()
  })
  afterEach(() => {
    vi.useRealTimers()
    h.watch.dispose()
  })

  it('reports a completed web turn with the full final text while on duty', () => {
    h.duty = true
    const session: FakeSession = fakeSession('s1')
    h.feed(session, titleEvent(1, '宝贝记录'))
    h.feed(session, ev(2, 'turn/start', { turn: 3 }))
    h.feed(session, assistant(3, 3, '第一段'))
    h.feed(session, assistant(4, 3, '最终回复'))
    h.feed(session, ev(5, 'turn/end', { turn: 3, reason: { kind: 'completed' } }))
    expect(h.send).toHaveBeenCalledTimes(1)
    expect(h.send.mock.calls[0]![0]).toBe('📄 宝贝记录 · 第 3 轮结束\n\n最终回复')
  })

  it('passes a long body through untruncated (chunking belongs to the sender)', () => {
    h.duty = true
    const long = '很长的正文。'.repeat(800)
    const session: FakeSession = fakeSession('s1')
    h.feed(session, ev(1, 'turn/start', { turn: 1 }))
    h.feed(session, assistant(2, 1, long))
    h.feed(session, ev(3, 'turn/end', { turn: 1, reason: { kind: 'completed' } }))
    const sent = h.send.mock.calls[0]![0] as string
    expect(sent).toBe(`📄 s1 · 第 1 轮结束\n\n${long}`)
  })

  it('stays silent in local mode', () => {
    const session: FakeSession = fakeSession('s1')
    h.feed(session, ev(1, 'turn/start', { turn: 1 }))
    h.feed(session, assistant(2, 1, 'text'))
    h.feed(session, ev(3, 'turn/end', { turn: 1, reason: { kind: 'completed' } }))
    expect(h.send).not.toHaveBeenCalled()
  })

  it('never reports the duty session itself', () => {
    h.duty = true
    const session: FakeSession = fakeSession('telegram-duty')
    h.feed(session, userMessage(1, { kind: 'plugin', plugin: 'telegram-duty' }))
    h.feed(session, ev(2, 'turn/start', { turn: 1 }))
    h.feed(session, assistant(3, 1, 'text'))
    h.feed(session, ev(4, 'turn/end', { turn: 1, reason: { kind: 'completed' } }))
    expect(h.send).not.toHaveBeenCalled()
  })

  it('skips phone-initiated turns (their reply already went through the task channel)', () => {
    h.duty = true
    const session: FakeSession = fakeSession('s1')
    h.feed(session, userMessage(1, { kind: 'plugin', plugin: 'telegram-duty-targeted' }))
    h.feed(session, ev(2, 'turn/start', { turn: 1 }))
    h.feed(session, assistant(3, 1, 'text'))
    h.feed(session, ev(4, 'turn/end', { turn: 1, reason: { kind: 'completed' } }))
    expect(h.send).not.toHaveBeenCalled()
  })

  it('reports an error turn with its detail', () => {
    h.duty = true
    const session: FakeSession = fakeSession('s1')
    h.feed(session, titleEvent(1, '会话甲'))
    h.feed(session, ev(2, 'turn/start', { turn: 2 }))
    h.feed(session, ev(3, 'turn/end', { turn: 2, reason: { kind: 'error', error: { code: 'E_MODEL', message: 'boom' } } }))
    expect(h.send.mock.calls[0]![0]).toBe('⚠️ 会话甲 · 第 2 轮结束：出错（E_MODEL：boom）')
  })

  it('reports an aborted turn as cancelled', () => {
    h.duty = true
    const session: FakeSession = fakeSession('s1')
    h.feed(session, ev(1, 'turn/start', { turn: 1 }))
    h.feed(session, ev(2, 'turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } }))
    expect(h.send.mock.calls[0]![0]).toBe('⚠️ s1 · 第 1 轮结束：被取消')
  })

  it('sends only the header when the turn has no text body', () => {
    h.duty = true
    const session: FakeSession = fakeSession('s1')
    h.feed(session, ev(1, 'turn/start', { turn: 1 }))
    h.feed(session, ev(2, 'turn/end', { turn: 1, reason: { kind: 'completed' } }))
    expect(h.send.mock.calls[0]![0]).toBe('📄 s1 · 第 1 轮结束')
  })

  it('ignores a turn/end for a stretch it never saw start', () => {
    h.duty = true
    const session: FakeSession = fakeSession('s1')
    h.feed(session, ev(1, 'turn/end', { turn: 1, reason: { kind: 'completed' } }))
    expect(h.send).not.toHaveBeenCalled()
  })

  it('only reads assistant messages of the reported turn', () => {
    h.duty = true
    const session: FakeSession = fakeSession('s1')
    h.feed(session, ev(1, 'turn/start', { turn: 1 }))
    h.feed(session, assistant(2, 1, '第一轮'))
    h.feed(session, ev(3, 'turn/end', { turn: 1, reason: { kind: 'completed' } }))
    h.feed(session, ev(4, 'turn/start', { turn: 2 }))
    h.feed(session, assistant(5, 2, '第二轮'))
    h.feed(session, ev(6, 'turn/end', { turn: 2, reason: { kind: 'completed' } }))
    expect(h.send.mock.calls[0]![0]).toBe('📄 s1 · 第 1 轮结束\n\n第一轮')
    expect(h.send.mock.calls[1]![0]).toBe('📄 s1 · 第 2 轮结束\n\n第二轮')
  })
})

describe('TurnWatch completion settle', () => {
  let h: Harness
  beforeEach(() => {
    vi.useFakeTimers()
    h = makeWatch()
  })
  afterEach(() => {
    vi.useRealTimers()
    h.watch.dispose()
  })

  it('sends the completion line once the agent settles idle with an empty inbox', async () => {
    vi.setSystemTime(new Date('2026-08-21T12:00:00Z'))
    h.duty = true
    const session: FakeSession = fakeSession('s1')
    h.feed(session, titleEvent(1, '会话乙'))
    h.feed(session, ev(2, 'turn/start', { turn: 1 }))
    h.feed(session, assistant(3, 1, 'body'))
    h.feed(session, ev(4, 'turn/end', { turn: 1, reason: { kind: 'completed' } }))
    const agent = fakeAgent('s1', session.events, 'idle')
    h.agents.set('s1', agent)
    vi.setSystemTime(new Date('2026-08-21T12:03:00Z'))
    h.watch.onAgentStatus({ agent, status: 'idle' })
    await vi.advanceTimersByTimeAsync(25)
    expect(h.send.mock.calls.at(-1)![0]).toBe('✅ 会话乙 · 任务完成（共 1 轮，用时 3 分钟）')
    // A second idle transition does not re-report the closed stretch.
    h.watch.onAgentStatus({ agent, status: 'idle' })
    await vi.advanceTimersByTimeAsync(25)
    expect(h.send).toHaveBeenCalledTimes(2) // turn report + completion, nothing more
  })

  it('does not send the completion line when the last turn was phone-initiated', async () => {
    h.duty = true
    const session: FakeSession = fakeSession('s1')
    h.feed(session, userMessage(1, { kind: 'plugin', plugin: 'telegram-duty-targeted' }))
    h.feed(session, ev(2, 'turn/start', { turn: 1 }))
    h.feed(session, assistant(3, 1, 'body'))
    h.feed(session, ev(4, 'turn/end', { turn: 1, reason: { kind: 'completed' } }))
    const agent = fakeAgent('s1', session.events, 'idle')
    h.agents.set('s1', agent)
    h.watch.onAgentStatus({ agent, status: 'idle' })
    await vi.advanceTimersByTimeAsync(25)
    expect(h.send).not.toHaveBeenCalled()
  })

  it('does not complete after an error turn (出错收尾不算完成)', async () => {
    h.duty = true
    const session: FakeSession = fakeSession('s1')
    h.feed(session, ev(1, 'turn/start', { turn: 1 }))
    h.feed(session, ev(2, 'turn/end', { turn: 1, reason: { kind: 'error', error: { code: 'E_MODEL', message: 'boom' } } }))
    const agent = fakeAgent('s1', session.events, 'idle')
    h.agents.set('s1', agent)
    h.watch.onAgentStatus({ agent, status: 'idle' })
    await vi.advanceTimersByTimeAsync(25)
    // Only the turn-failed line was sent; no completion line follows it.
    expect(h.send).toHaveBeenCalledTimes(1)
    expect(h.send.mock.calls[0]![0]).toContain('第 1 轮结束')
    expect(h.send.mock.calls[0]![0]).not.toContain('任务完成')
  })

  it('keeps the stretch when the agent is still busy at settle, then completes on the next idle', async () => {
    vi.setSystemTime(new Date('2026-08-21T12:00:00Z'))
    h.duty = true
    const session: FakeSession = fakeSession('s1')
    h.feed(session, ev(1, 'turn/start', { turn: 1 }))
    h.feed(session, assistant(2, 1, 'body'))
    h.feed(session, ev(3, 'turn/end', { turn: 1, reason: { kind: 'completed' } }))
    const agent = fakeAgent('s1', session.events, 'running')
    agent.inbox.nextTurn.push({})
    h.agents.set('s1', agent)
    vi.setSystemTime(new Date('2026-08-21T12:02:00Z'))
    h.watch.onAgentStatus({ agent, status: 'idle' })
    await vi.advanceTimersByTimeAsync(25)
    expect(h.send.mock.calls.at(-1)![0]).toContain('第 1 轮结束')
    expect(h.send.mock.calls.at(-1)![0]).not.toContain('任务完成')
    // The next round ends and the agent really goes idle: completion fires.
    agent.status = 'idle'
    agent.inbox.nextTurn = []
    h.watch.onAgentStatus({ agent, status: 'idle' })
    await vi.advanceTimersByTimeAsync(25)
    expect(h.send.mock.calls.at(-1)![0]).toBe('✅ s1 · 任务完成（共 1 轮，用时 2 分钟）')
  })

  it('stays silent when completion happens in local mode (but still resets the stretch)', async () => {
    const session: FakeSession = fakeSession('s1')
    h.feed(session, ev(1, 'turn/start', { turn: 1 }))
    h.feed(session, assistant(2, 1, 'body'))
    h.feed(session, ev(3, 'turn/end', { turn: 1, reason: { kind: 'completed' } }))
    const agent = fakeAgent('s1', session.events, 'idle')
    h.agents.set('s1', agent)
    h.watch.onAgentStatus({ agent, status: 'idle' })
    await vi.advanceTimersByTimeAsync(25)
    expect(h.send).not.toHaveBeenCalled()
  })

  it('drops state (and pending settles) when the agent is disposed', async () => {
    h.duty = true
    const session: FakeSession = fakeSession('s1')
    h.feed(session, ev(1, 'turn/start', { turn: 1 }))
    h.feed(session, assistant(2, 1, 'body'))
    h.feed(session, ev(3, 'turn/end', { turn: 1, reason: { kind: 'completed' } }))
    const agent = fakeAgent('s1', session.events, 'idle')
    h.agents.set('s1', agent)
    h.watch.onAgentStatus({ agent, status: 'idle' })
    h.watch.onAgentDisposed({ agent })
    await vi.advanceTimersByTimeAsync(25)
    expect(h.send.mock.calls.at(-1)![0]).toContain('第 1 轮结束')
    expect(h.send.mock.calls.at(-1)![0]).not.toContain('任务完成')
  })

  it('resets the stretch without a line when the agent is gone at settle', async () => {
    h.duty = true
    const session: FakeSession = fakeSession('s1')
    h.feed(session, ev(1, 'turn/start', { turn: 1 }))
    h.feed(session, assistant(2, 1, 'body'))
    h.feed(session, ev(3, 'turn/end', { turn: 1, reason: { kind: 'completed' } }))
    const agent = fakeAgent('s1', session.events, 'idle')
    h.watch.onAgentStatus({ agent, status: 'idle' })
    await vi.advanceTimersByTimeAsync(25)
    expect(h.send.mock.calls.at(-1)![0]).toContain('第 1 轮结束')
    expect(h.send.mock.calls.at(-1)![0]).not.toContain('任务完成')
  })

  it('rounds the duration up to whole minutes', async () => {
    vi.setSystemTime(new Date('2026-08-21T12:00:00Z'))
    h.duty = true
    const session: FakeSession = fakeSession('s1')
    h.feed(session, ev(1, 'turn/start', { turn: 1 }))
    h.feed(session, assistant(2, 1, 'body'))
    h.feed(session, ev(3, 'turn/end', { turn: 1, reason: { kind: 'completed' } }))
    const agent = fakeAgent('s1', session.events, 'idle')
    h.agents.set('s1', agent)
    vi.setSystemTime(new Date('2026-08-21T12:00:30Z'))
    h.watch.onAgentStatus({ agent, status: 'idle' })
    await vi.advanceTimersByTimeAsync(25)
    expect(h.send.mock.calls.at(-1)![0]).toBe('✅ s1 · 任务完成（共 1 轮，用时 1 分钟）')
  })
})
