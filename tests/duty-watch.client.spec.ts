// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { DutyWatchController } from '../src/client/settings-store.ts'
import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'

function fakeApi(responses: {
  describe?: (input: unknown) => Promise<{ result: { ok: boolean; error?: { message: string }; value: { namespaces: unknown[]; writable: boolean } } }>
  mutate?: (input: unknown) => Promise<{ result: { ok: boolean; error?: { message: string }; value: unknown } }>
}): Pick<IApiClient, 'settings'> {
  return {
    settings: {
      describe: responses.describe ?? (async () => ({
        result: { ok: true, value: { namespaces: [], writable: true } },
      })),
      mutate: responses.mutate ?? (async () => ({ result: { ok: true, value: {} } })),
    },
  } as unknown as Pick<IApiClient, 'settings'>
}

function dutyNamespace(watchMode: string, language = 'zh', revision = 3): unknown {
  return {
    ns: 'telegram-duty',
    revision,
    value: { watchMode, language },
    schema: {},
  }
}

describe('DutyWatchController', () => {
  it('loads duty mode and language from the namespace', async () => {
    const api = fakeApi({
      describe: async () => ({
        result: {
          ok: true,
          value: { namespaces: [dutyNamespace('duty', 'zh')], writable: true },
        },
      }),
    })
    const controller = new DutyWatchController(api)
    await controller.load()
    expect(controller.store.getSnapshot()).toMatchObject({ status: 'ready', mode: 'duty', language: 'zh' })
  })

  it('reports unavailable when the namespace is absent', async () => {
    const controller = new DutyWatchController(fakeApi({}))
    await controller.load()
    expect(controller.store.getSnapshot()).toMatchObject({ status: 'unavailable', mode: 'local' })
  })

  it('reports an error when describe fails', async () => {
    const api = fakeApi({
      describe: async () => ({ result: { ok: false, error: { message: 'boom' }, value: { namespaces: [], writable: false } } }),
    })
    const controller = new DutyWatchController(api)
    await controller.load()
    expect(controller.store.getSnapshot()).toMatchObject({ status: 'error', error: 'boom' })
  })

  it('switchBack mutates watchMode to local with the revision', async () => {
    const mutate = vi.fn(async () => ({
      result: {
        ok: true,
        value: dutyNamespace('local', 'zh', 4),
      },
    }))
    const api = fakeApi({
      describe: async () => ({
        result: {
          ok: true,
          value: { namespaces: [dutyNamespace('duty', 'zh', 3)], writable: true },
        },
      }),
      mutate,
    })
    const controller = new DutyWatchController(api)
    await controller.load()
    await controller.switchBack()
    expect(mutate).toHaveBeenCalledWith({
      ns: 'telegram-duty',
      ops: [{ op: 'set', path: ['watchMode'], value: 'local' }],
      expectedRevision: 3,
    })
    expect(controller.store.getSnapshot()).toMatchObject({ status: 'ready', mode: 'local' })
  })

  it('switchBack without a loaded view is a no-op', async () => {
    const controller = new DutyWatchController(fakeApi({}))
    await controller.switchBack()
    expect(controller.store.getSnapshot().status).toBe('idle')
  })
})
