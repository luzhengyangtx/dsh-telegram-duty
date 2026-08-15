import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Gateway, startTypingLoop, TYPING_INTERVAL_MS } from '../src/gateway.ts'
import type { TelegramClient, TelegramUpdate } from '../src/telegram.ts'
import type { InlineKeyboard } from '../src/telegram.ts'
import type { Context } from '@deepseek-ai/cordis'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { stringsFor } from '../src/i18n.ts'

const strings = stringsFor('zh')

function ev(seq: number, type: string, data: unknown): SessionEvent {
  return { seq, type, data } as unknown as SessionEvent
}

interface FakeAgent {
  id: string
  status: 'idle' | 'running'
  session: { seq: number; events: SessionEvent[] }
  whenIdle: ReturnType<typeof vi.fn>
  followup: ReturnType<typeof vi.fn>
  cancel: ReturnType<typeof vi.fn>
}

/** A live agent whose next turn answers with `reply`. */
function agentOf(id: string, reply: string, extra: Partial<FakeAgent> = {}): FakeAgent {
  const events = [
    ev(1, 'turn/start', { turn: 1 }),
    ev(2, 'assistant/message', { turn: 1, step: 1, message: { content: [{ type: 'text', text: reply }] } }),
    ev(3, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
  ]
  return {
    id,
    status: 'idle',
    session: { seq: 1, events },
    whenIdle: vi.fn(async () => undefined),
    followup: vi.fn(),
    cancel: vi.fn(),
    ...extra,
  }
}

interface FakeClient {
  sent: string[]
  keyboards: InlineKeyboard[]
  actions: string[]
  callbacks: Array<{ queryId: string; text?: string }>
}

function fakeClient(): TelegramClient & FakeClient {
  const client: FakeClient = {
    sent: [],
    keyboards: [],
    actions: [],
    callbacks: [],
  }
  return {
    ...client,
    sendMessage: vi.fn(async (_chatId: number, text: string, options?: { keyboard?: InlineKeyboard }) => {
      client.sent.push(text)
      if (options?.keyboard !== undefined) client.keyboards.push(options.keyboard)
      return { ok: true }
    }),
    sendChatAction: vi.fn(async (_chatId: number, action: string) => {
      client.actions.push(action)
      return { ok: true }
    }),
    answerCallbackQuery: vi.fn(async (queryId: string, text?: string) => {
      client.callbacks.push({ queryId, text })
      return { ok: true }
    }),
    getUpdates: vi.fn(),
    getMe: vi.fn(),
    close: vi.fn(),
  } as unknown as TelegramClient & FakeClient
}

interface GatewayHarness {
  gateway: Gateway
  client: TelegramClient & FakeClient
  settings: { get: ReturnType<typeof vi.fn>; watch: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> }
  ctx: Context
}

function makeGateway(opts: {
  roots?: () => FakeAgent[]
  get?: (id: string) => FakeAgent | undefined
  resume?: (options: unknown) => Promise<unknown>
  watchMode?: 'local' | 'duty'
  services?: Record<string, unknown>
} = {}): GatewayHarness {
  const ctx = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    get: vi.fn((name: string) => opts.services?.[name]),
    on: vi.fn(),
    agents: {
      roots: vi.fn(opts.roots ?? (() => [])),
      get: vi.fn(opts.get ?? (() => undefined)),
      resume: vi.fn(opts.resume ?? (async () => { throw new Error('no such session') })),
      create: vi.fn(async () => { throw new Error('create not expected in this test') }),
      list: vi.fn(() => (opts.roots ?? (() => []))()),
    },
    agentDefaultModel: {
      currentSelection: vi.fn(() => ({ provider: 'test', model: 'test' })),
    },
  } as unknown as Context
  const settings = {
    get: vi.fn(() => ({ watchMode: opts.watchMode ?? 'duty', language: 'zh' })),
    watch: vi.fn(),
    update: vi.fn(async () => undefined),
  }
  const stateOn = { update: vi.fn(async () => undefined) }
  const stateOff = { update: vi.fn(async () => undefined) }
  const client = fakeClient()
  const gateway = new Gateway({
    ctx,
    runtime: { chatId: 1, sessionId: 'duty', language: 'zh', approvalTimeoutMinutes: 10, replyChunkChars: 3800, dutyCwd: '.', dataDir: '.' },
    client,
    settings: settings as never,
    stateOn: stateOn as never,
    stateOff: stateOff as never,
  })
  return { gateway, client, settings, ctx }
}

function textUpdate(id: number, text: string): TelegramUpdate {
  return { update_id: id, message: { message_id: id, chat: { id: 1 }, text } }
}

function callbackUpdate(data: string): TelegramUpdate {
  return { update_id: 100, callback_query: { id: 'cq-1', message: { message_id: 50, chat: { id: 1 } }, data } }
}

function followupText(agent: FakeAgent): string | undefined {
  const call = agent.followup.mock.calls.at(-1)?.[0] as { content: Array<{ type: string; text?: string }> } | undefined
  return call?.content.find(block => block.type === 'text')?.text
}

describe('Gateway task routing', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('acks a task message first, then replies with the turn result', async () => {
    const duty = agentOf('duty', '回复内容')
    const { gateway, client } = makeGateway({
      roots: () => [duty],
      get: id => (id === 'duty' ? duty : undefined),
    })
    await gateway.handleUpdate(textUpdate(1, '你好'))
    expect(client.sent[0]).toBe(strings.ack)
    expect(client.sent).toContain('回复内容')
    expect(followupText(duty)).toBe('你好')
  })

  it('does not ack commands', async () => {
    const duty = agentOf('duty', '回复')
    const { gateway, client } = makeGateway({ roots: () => [duty], get: id => (id === 'duty' ? duty : undefined) })
    await gateway.handleUpdate(textUpdate(1, '/help'))
    expect(client.sent[0]).toContain('/sessions')
    expect(client.sent.some(text => text.includes(strings.ack))).toBe(false)
    expect(client.actions).toEqual([])
  })

  it('does not ack approval replies and settles the pending approval', async () => {
    const { gateway, client } = makeGateway({ watchMode: 'duty' })
    const answer = gateway.onApprovalRequest(
      { toolName: 'pwsh', reason: 'install something' },
      async () => 'rejected' as ApprovalOutcome,
    )
    await vi.advanceTimersByTimeAsync(0)
    await gateway.handleUpdate(textUpdate(1, '1 同意'))
    expect(client.sent).toContain(strings.approvalAccepted(1))
    expect(client.sent.some(text => text.includes(strings.ack))).toBe(false)
    await expect(answer).resolves.toBe('allowed-once')
  })

  it('keeps the typing indicator alive while the turn runs and stops it afterwards', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    let calls = 0
    const duty = agentOf('duty', '慢慢来', {
      whenIdle: vi.fn(() => {
        calls += 1
        return calls === 1 ? Promise.resolve() : gate
      }),
    })
    const { gateway, client } = makeGateway({ roots: () => [duty], get: id => (id === 'duty' ? duty : undefined) })
    const running = gateway.handleUpdate(textUpdate(1, '你好'))
    await vi.advanceTimersByTimeAsync(0)
    expect(client.actions).toEqual(['typing'])
    await vi.advanceTimersByTimeAsync(TYPING_INTERVAL_MS)
    await vi.advanceTimersByTimeAsync(TYPING_INTERVAL_MS)
    expect(client.actions.length).toBe(3)
    release()
    await running
    const settled = client.actions.length
    await vi.advanceTimersByTimeAsync(TYPING_INTERVAL_MS * 3)
    expect(client.actions.length).toBe(settled)
  })

  it('replies with the processing-error message on a failed turn', async () => {
    const duty = agentOf('duty', '', {
      session: {
        seq: 1,
        events: [
          ev(1, 'turn/start', { turn: 1 }),
          ev(2, 'turn/end', { turn: 1, reason: { kind: 'error', error: { code: 'E_MODEL', message: 'boom' } } }),
        ],
      },
    })
    const { gateway, client } = makeGateway({ roots: () => [duty], get: id => (id === 'duty' ? duty : undefined) })
    await gateway.handleUpdate(textUpdate(1, '会失败的'))
    expect(client.sent).toContain(strings.taskError('E_MODEL: boom'))
  })
})

describe('Gateway targeted routing', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  function setupWithSessions(): {
    gateway: Gateway
    client: TelegramClient & FakeClient
    duty: FakeAgent
    second: FakeAgent
    third: FakeAgent
  } {
    const duty = agentOf('duty', '值班回复')
    const second = agentOf('s2', '进度回复', {
      status: 'running',
      session: {
        seq: 1,
        events: [
          ev(0, 'session/title', { title: '进度项目' }),
          ev(1, 'turn/start', { turn: 1 }),
          ev(2, 'assistant/message', { turn: 1, step: 1, message: { content: [{ type: 'text', text: '进度回复' }] } }),
          ev(3, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
        ],
      },
    })
    const third = agentOf('s3', '其他回复', {
      session: {
        seq: 1,
        events: [
          ev(0, 'session/title', { title: '其他项目' }),
          ev(1, 'turn/start', { turn: 1 }),
          ev(2, 'assistant/message', { turn: 1, step: 1, message: { content: [{ type: 'text', text: '其他回复' }] } }),
          ev(3, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
        ],
      },
    })
    const { gateway, client } = makeGateway({
      roots: () => [duty, second, third],
      get: id => (id === 'duty' ? duty : id === 's2' ? second : id === 's3' ? third : undefined),
      services: {
        workspaceRegistry: {
          list: () => [{ sessionIds: ['s2', 's3'] }],
          archivedSessionIds: [],
        },
      },
    })
    return { gateway, client, duty, second, third }
  }

  it('/sessions lists the workspace sessions (duty session excluded)', async () => {
    const { gateway, client } = setupWithSessions()
    await gateway.handleUpdate(textUpdate(1, '/sessions'))
    const listing = client.sent.at(-1) ?? ''
    expect(listing).toContain('[1] 进度项目 · 忙碌')
    expect(listing).toContain('[2] 其他项目 · 空闲')
    expect(listing).not.toContain('值班会话')
    const keyboard = client.keyboards.at(-1) ?? []
    expect(keyboard.map(row => row[0]?.callback_data)).toEqual(['sess:1', 'sess:2'])
  })

  it('/sessions with no sessions replies with the empty hint', async () => {
    const { gateway, client } = makeGateway({
      roots: () => [],
      services: {
        workspaceRegistry: {
          list: () => [{ sessionIds: ['nobody'] }],
          archivedSessionIds: [],
        },
      },
    })
    await gateway.handleUpdate(textUpdate(1, '/sessions'))
    expect(client.sent.at(-1)).toBe(strings.sessionsNone)
  })

  it('a session button sets the active target for following messages', async () => {
    const { gateway, client, second } = setupWithSessions()
    await gateway.handleUpdate(textUpdate(1, '/sessions'))
    await gateway.handleUpdate(callbackUpdate('sess:1'))
    expect(client.callbacks.at(-1)?.text).toBe(strings.targetAck)
    expect(client.sent.at(-1)).toBe(strings.targeted('进度项目'))
    await gateway.handleUpdate(textUpdate(2, '帮我干活'))
    expect(followupText(second)).toBe('帮我干活')
  })

  it('#N sends one message without changing the active route', async () => {
    const { gateway, duty, second, third } = setupWithSessions()
    await gateway.handleUpdate(textUpdate(1, '/sessions'))
    await gateway.handleUpdate(callbackUpdate('sess:1'))
    await gateway.handleUpdate(textUpdate(2, '#2 只发这条给其他'))
    expect(followupText(third)).toBe('只发这条给其他')
    expect(duty.followup).not.toHaveBeenCalled()
    await gateway.handleUpdate(textUpdate(3, '接着发给定向会话'))
    expect(followupText(second)).toBe('接着发给定向会话')
  })

  it('/duty resets the route back to the duty session', async () => {
    const { gateway, client, duty, second } = setupWithSessions()
    await gateway.handleUpdate(textUpdate(1, '/sessions'))
    await gateway.handleUpdate(callbackUpdate('sess:1'))
    await gateway.handleUpdate(textUpdate(2, '/duty'))
    expect(client.sent.at(-1)).toBe(strings.dutyReset)
    await gateway.handleUpdate(textUpdate(3, '回到值班'))
    expect(followupText(duty)).toBe('回到值班')
    expect(second.followup).not.toHaveBeenCalled()
  })

  it('reports unknown prefix indices', async () => {
    const { gateway, client } = setupWithSessions()
    await gateway.handleUpdate(textUpdate(1, '#99 帮帮忙'))
    expect(client.sent.at(-1)).toBe(strings.prefixUnknown(99))
  })

  it('reports bare #N shapes with a hint', async () => {
    const { gateway, client } = setupWithSessions()
    await gateway.handleUpdate(textUpdate(1, '#3'))
    expect(client.sent.at(-1)).toBe(strings.prefixNeedsText)
  })

  it('reports an expired snapshot', async () => {
    const base = 1_700_000_000_000
    vi.setSystemTime(base)
    const { gateway, client } = setupWithSessions()
    await gateway.handleUpdate(textUpdate(1, '/sessions'))
    vi.setSystemTime(base + 31 * 60_000)
    await gateway.handleUpdate(textUpdate(2, '#1 还在吗'))
    expect(client.sent.at(-1)).toBe(strings.snapshotExpired)
  })

  it('reports an offline target that cannot be resumed', async () => {
    const duty = agentOf('duty', '值班回复')
    const ghost = agentOf('s2', '进度回复', {
      session: {
        seq: 1,
        events: [
          ev(0, 'session/title', { title: '进度项目' }),
          ev(1, 'turn/start', { turn: 1 }),
          ev(2, 'assistant/message', { turn: 1, step: 1, message: { content: [{ type: 'text', text: '进度回复' }] } }),
          ev(3, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
        ],
      },
    })
    const { gateway, client } = makeGateway({
      roots: () => [duty, ghost],
      get: id => (id === 'duty' ? duty : undefined),
      resume: async () => { throw new Error('no such persisted session') },
      services: {
        workspaceRegistry: {
          list: () => [{ sessionIds: ['s2'] }],
          archivedSessionIds: [],
        },
      },
    })
    await gateway.handleUpdate(textUpdate(1, '/sessions'))
    await gateway.handleUpdate(textUpdate(2, '#1 帮我看看'))
    expect(client.sent.at(-1)).toBe(strings.sessionOffline('进度项目'))
  })

  it('a fresh gateway routes to the duty session by default (restart behavior)', async () => {
    const duty = agentOf('duty', '默认路由')
    const { gateway } = makeGateway({ roots: () => [duty], get: id => (id === 'duty' ? duty : undefined) })
    await gateway.handleUpdate(textUpdate(1, '直接干活'))
    expect(followupText(duty)).toBe('直接干活')
  })

  it('an aborted turn stays silent (no bogus processing error)', async () => {
    const duty = agentOf('duty', '', {
      session: {
        seq: 1,
        events: [
          ev(1, 'turn/start', { turn: 1 }),
          ev(2, 'turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } }),
        ],
      },
    })
    const { gateway, client } = makeGateway({ roots: () => [duty], get: id => (id === 'duty' ? duty : undefined) })
    await gateway.handleUpdate(textUpdate(1, '会取消的任务'))
    expect(client.sent).toEqual([strings.ack])
  })
})

describe('Gateway cold-session listing', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('/sessions lists persisted-but-cold workspace sessions as offline', async () => {
    const duty = agentOf('duty', '值班回复')
    const { gateway, client } = makeGateway({
      roots: () => [duty],
      get: id => (id === 'duty' ? duty : undefined),
      services: {
        workspaceRegistry: {
          list: () => [{ sessionIds: ['duty', 'cold1'] }],
          archivedSessionIds: [],
        },
        sessionPersistence: {
          list: async () => [{ id: 'cold1', createdAt: 2000 }],
        },
      },
    })
    await gateway.handleUpdate(textUpdate(1, '/sessions'))
    const listing = client.sent.at(-1) ?? ''
    expect(listing).toContain('[1] cold1 · 离线')
    expect(listing).not.toContain('值班会话')
    const keyboard = client.keyboards.at(-1) ?? []
    expect(keyboard.map(row => row[0]?.callback_data)).toEqual(['sess:1'])
  })

  it('/sessions skips blank cold sessions (no raw-id clutter)', async () => {
    const duty = agentOf('duty', '值班回复')
    const { gateway, client } = makeGateway({
      roots: () => [duty],
      get: id => (id === 'duty' ? duty : undefined),
      services: {
        workspaceRegistry: {
          list: () => [{ sessionIds: ['duty', 'blank1', 'titled1'] }],
          archivedSessionIds: [],
        },
        sessionPersistence: {
          list: async () => [
            { id: 'blank1', createdAt: 3000 },
            { id: 'titled1', createdAt: 2000 },
          ],
        },
        sessionProjectionCache: {
          cachedSnapshot: (meta: unknown) => {
            const id = String((meta as { id: { toString(): string } }).id)
            if (id === 'blank1') return { values: { sessionListMetadata: { blank: true } } }
            return { values: { title: '有名字的会话', sessionListMetadata: { blank: false } } }
          },
        },
      },
    })
    await gateway.handleUpdate(textUpdate(1, '/sessions'))
    const listing = client.sent.at(-1) ?? ''
    expect(listing).toContain('[1] 有名字的会话 · 离线')
    expect(listing).not.toContain('blank1')
  })

  it('/sessions skips blank live sessions (drafts)', async () => {
    const duty = agentOf('duty', '值班回复')
    const draft = agentOf('draft1', '', { session: { seq: 0, events: [] } })
    const real = agentOf('real1', '回复', {
      session: {
        seq: 1,
        events: [
          ev(0, 'session/title', { title: '真正会话' }),
          ev(1, 'turn/start', { turn: 1 }),
          ev(2, 'assistant/message', { turn: 1, step: 1, message: { content: [{ type: 'text', text: '回复' }] } }),
          ev(3, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
        ],
      },
    })
    const { gateway, client } = makeGateway({
      roots: () => [duty, draft, real],
      get: id => (id === 'duty' ? duty : id === 'draft1' ? draft : id === 'real1' ? real : undefined),
      services: {
        workspaceRegistry: {
          list: () => [{ sessionIds: ['duty', 'draft1', 'real1'] }],
          archivedSessionIds: [],
        },
      },
    })
    await gateway.handleUpdate(textUpdate(1, '/sessions'))
    const listing = client.sent.at(-1) ?? ''
    expect(listing).toContain('[1] 真正会话 · 空闲')
    expect(listing).not.toContain('draft1')
  })

  it('a targeted message wakes an offline session via resume', async () => {
    const duty = agentOf('duty', '值班回复')
    const cold = agentOf('cold1', '已唤醒回复')
    const { gateway } = makeGateway({
      roots: () => [duty],
      get: id => (id === 'duty' ? duty : undefined),
      resume: async () => ({ agent: cold, dispose: async () => undefined }),
      services: {
        workspaceRegistry: {
          list: () => [{ sessionIds: ['duty', 'cold1'] }],
          archivedSessionIds: [],
        },
        sessionPersistence: {
          list: async () => [{ id: 'cold1', createdAt: 2000 }],
        },
      },
    })
    await gateway.handleUpdate(textUpdate(1, '/sessions'))
    await gateway.handleUpdate(textUpdate(2, '#1 唤醒我'))
    expect(followupText(cold)).toBe('唤醒我')
  })
})

describe('Gateway web-approval recovery', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  function stuckAgent(): FakeAgent {
    return agentOf('duty', '回复', {
      session: {
        seq: 1,
        events: [
          ev(0, 'approval/asked', { id: 'a1', toolName: 'pwsh', reason: 'install' }),
          ev(1, 'turn/start', { turn: 1 }),
          ev(2, 'assistant/message', { turn: 1, step: 1, message: { content: [{ type: 'text', text: '回复' }] } }),
          ev(3, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
        ],
      },
    })
  }

  it('/away warns about approvals the web UI still holds', async () => {
    const duty = stuckAgent()
    const { gateway, client } = makeGateway({
      roots: () => [duty],
      get: id => (id === 'duty' ? duty : undefined),
      watchMode: 'local',
    })
    await gateway.handleUpdate(textUpdate(1, '/away'))
    expect(client.sent.some(text => text.includes('工具「pwsh」') && text.includes('值班会话'))).toBe(true)
  })

  it('/unblock cancels the turn of a session stuck on an approval', async () => {
    const duty = stuckAgent()
    const { gateway, client } = makeGateway({
      roots: () => [duty],
      get: id => (id === 'duty' ? duty : undefined),
    })
    await gateway.handleUpdate(textUpdate(1, '/unblock'))
    expect(duty.cancel).toHaveBeenCalledWith({ kind: 'user' })
    expect(client.sent.at(-1)).toBe(strings.unblocked(1))
  })

  it('/unblock reports when nothing is stuck', async () => {
    const duty = agentOf('duty', '回复')
    const { gateway, client } = makeGateway({ roots: () => [duty], get: id => (id === 'duty' ? duty : undefined) })
    await gateway.handleUpdate(textUpdate(1, '/unblock'))
    expect(duty.cancel).not.toHaveBeenCalled()
    expect(client.sent.at(-1)).toBe(strings.unblockNothing)
  })
})

describe('Gateway notify + target confirmation', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('notifyPhone pushes one message to the phone', async () => {
    const duty = agentOf('duty', '回复')
    const { gateway, client } = makeGateway({ roots: () => [duty], get: id => (id === 'duty' ? duty : undefined) })
    await gateway.notifyPhone('📣 任务完成')
    expect(client.sent.at(-1)).toBe('📣 任务完成')
  })
})

describe('startTypingLoop', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('beats immediately, then per interval, and stops cleanly', async () => {
    const actions: string[] = []
    const send = vi.fn(async (_chatId: number, action: string) => {
      actions.push(action)
      return { ok: true }
    })
    const loop = startTypingLoop(send, 1, 1000)
    expect(actions).toEqual(['typing'])
    await vi.advanceTimersByTimeAsync(2500)
    expect(actions.length).toBe(3)
    loop.stop()
    await vi.advanceTimersByTimeAsync(5000)
    expect(actions.length).toBe(3)
  })
})
