/**
 * Telegram duty gateway plugin, browser half — a frame-wide duty banner
 * (shell.overlay slot). The host publishes the mode via the state-marker
 * settings namespaces (their forwarded events carry the mode); the banner
 * seeds itself by running the host `/duty-mode` command in the current
 * session, and switches back via `/duty-mode-local`.
 */

import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls ui-layout's SlotMap declaration (shell.overlay) into this program.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { DutyBanner } from './DutyBanner.tsx'
import type { DutyBannerInjected } from './DutyBanner.tsx'
import { DutyWatchController } from './settings-store.ts'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'remote', 'sessions', 'locale']

/**
 * Client plugin body: register the duty banner over the shell overlay,
 * driven by forwarded state-marker events with a command-based seed.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const controller = new DutyWatchController()
  const sessions = ctx.sessions

  ctx.effect(() => ctx.locale.register('telegram-duty.banner', {
    zh: { title: '审批已转到手机', action: '切回本地' },
    en: { title: 'Approvals are on your phone', action: 'Back to local' },
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
}
