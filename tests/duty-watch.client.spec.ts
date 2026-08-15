// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { DutyWatchController } from '../src/client/settings-store.ts'

describe('DutyWatchController', () => {
  it('starts idle in local mode', () => {
    const controller = new DutyWatchController()
    expect(controller.store.getSnapshot()).toEqual({ mode: 'local', status: 'idle' })
  })

  it('learns duty from the on-marker namespace', () => {
    const controller = new DutyWatchController()
    controller.onNamespace('telegram-duty-on')
    expect(controller.store.getSnapshot()).toEqual({ mode: 'duty', status: 'ready' })
  })

  it('learns local from the off-marker namespace', () => {
    const controller = new DutyWatchController()
    controller.onNamespace('telegram-duty-on')
    controller.onNamespace('telegram-duty-off')
    expect(controller.store.getSnapshot()).toEqual({ mode: 'local', status: 'ready' })
  })

  it('ignores unrelated namespaces', () => {
    const controller = new DutyWatchController()
    controller.onNamespace('telegram-duty')
    controller.onNamespace('ui-theme')
    expect(controller.store.getSnapshot()).toEqual({ mode: 'local', status: 'idle' })
  })

  it('is idempotent for repeated markers', () => {
    const controller = new DutyWatchController()
    controller.onNamespace('telegram-duty-on')
    const first = controller.store.getSnapshot()
    controller.onNamespace('telegram-duty-on')
    expect(controller.store.getSnapshot()).toBe(first)
  })
})
