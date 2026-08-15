/**
 * Telegram duty gateway plugin, browser half — a frame-wide duty banner
 * (shell.overlay slot) plus a sidebar foot action that opens the duty
 * session. The host publishes the mode via the state-marker settings
 * namespaces (their forwarded events carry the mode); both UI pieces seed
 * themselves by running the host `/duty-mode` command in the current
 * session, and switch back via `/duty-mode-local`. The duty session id comes
 * from the standard session.list projection (`telegramDuty`), never from
 * plugin settings (the web settings wire is allowlisted).
 */

import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls ui-layout's SlotMap declaration (shell.overlay) into this program.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls ui-sidebar's SlotMap declaration (sidebar.footer.action).
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import {
  createSnapshotStore, SessionRuntime,
} from '@deepseek-ai/dsh-client-runtime/client'
import { DutyBanner } from './DutyBanner.tsx'
import type { DutyBannerInjected } from './DutyBanner.tsx'
import { DutyButton } from './DutyButton.tsx'
import type { DutyButtonInjected } from './DutyButton.tsx'
import { DutyWatchController } from './settings-store.ts'
import { findDutySessionId, openDutyFlow } from './duty-button.ts'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'remote', 'sessions', 'locale']

/**
 * Client plugin body: register the duty banner over the shell overlay and the
 * duty action at the sidebar foot, both driven by forwarded state-marker
 * events with a command-based seed.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const controller = new DutyWatchController()
  const sessions = ctx.sessions
  /** Transient open-failure flash (cleared after a few seconds). */
  const openFailed = createSnapshotStore<{ failed: boolean }>({ failed: false })

  ctx.effect(() => ctx.locale.register('telegram-duty.banner', {
    zh: {
      title: '审批已转到手机',
      action: '切回本地',
      sidebarDuty: '值班',
      sidebarError: '未找到值班会话，请先给机器人发一条消息',
    },
    en: {
      title: 'Approvals are on your phone',
      action: 'Back to local',
      sidebarDuty: 'Duty',
      sidebarError: 'Duty session not found — send the bot a message first',
    },
  }), 'telegram-duty: banner dictionaries')

  /** Run one host command against the current session (no-op without one). */
  const runCommand = (line: string): void => {
    const current = sessions.list.getSnapshot().current
    if (current === undefined) return
    const face = sessions.binding(current)?.session
    if (face === undefined) return
    void face.command(line).catch(() => undefined)
  }

  const seed = (): void => {
    runCommand('/duty-mode')
  }
  const switchBack = (): void => {
    runCommand('/duty-mode-local')
  }

  /**
   * Open the duty session. Fast path: the session is in the list with its
   * `telegramDuty` projection. Otherwise ask the host to attach it
   * (`/duty-session`), then retry the scan while refreshing the list, and
   * flash an error state when it still cannot be found (e.g. the bot has
   * never received a message yet).
   */
  const openDuty = (): void => {
    void openDutyFlow({
      find: () => findDutySessionId(sessions.list.getSnapshot()),
      open: (id) => {
        sessions.open(id)
      },
      runCommand: () => {
        runCommand('/duty-session')
      },
      refresh: async () => {
        await (sessions as SessionRuntime).refresh()
      },
      fail: () => {
        openFailed.update((next) => { next.failed = true })
        // Transient one-shot: nothing to clean up after it fires.
        setTimeout(() => {
          openFailed.update((next) => { next.failed = false })
        }, 4000)
      },
    })
  }

  ctx.effect(() => {
    const disposers = [
      ctx.remote.$on('settings/document-updated', (ns) => {
        controller.onNamespace(ns)
      }),
      ctx.on('connection/reset', () => {
        seed()
      }),
    ]
    seed()
    // Retry the seed until the first marker event is observed (covers boot
    // ordering and page loads that predate the connection).
    const retry = setInterval(() => {
      if (controller.store.getSnapshot().status === 'ready') return
      seed()
    }, 3000)
    return () => {
      clearInterval(retry)
      for (const dispose of disposers) dispose()
    }
  }, 'telegram-duty: mode feed')

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'telegram-duty-banner',
    order: 100,
    locale: 'telegram-duty.banner',
    inject: (): DutyBannerInjected => ({ hooks: { duty: controller.store }, switchBack }),
  }, DutyBanner))

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'telegram-duty-sidebar-action',
    order: 200,
    locale: 'telegram-duty.banner',
    inject: (): DutyButtonInjected => ({
      hooks: { duty: controller.store, failed: openFailed },
      open: openDuty,
    }),
  }, DutyButton))
}
