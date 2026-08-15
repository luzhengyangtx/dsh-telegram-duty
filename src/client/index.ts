/**
 * Telegram duty gateway plugin, browser half — a frame-wide duty banner
 * (shell.overlay slot) driven by the host's telegram-duty settings namespace:
 * shows while watchMode is duty, with a one-click switch back to local.
 */

import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the ctx.remote merge and the forwarded-event key face
// (settings invalidation rides the allowlist) into this program.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls ui-layout's SlotMap declaration (shell.overlay) into this program.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { DutyBanner } from './DutyBanner.tsx'
import type { DutyBannerInjected } from './DutyBanner.tsx'
import { DutyWatchController, TELEGRAM_DUTY_SETTINGS_NS } from './settings-store.ts'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'connection', 'remote']

/**
 * Client plugin body: register the duty banner over the shell overlay,
 * refreshed by pushed settings invalidation events.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const connection = ctx.get('connection') as ConnectionHandle
  const controller = new DutyWatchController(connection.api)
  const load = (): Promise<void> => controller.load()
  const switchBack = (): Promise<void> => controller.switchBack()

  ctx.effect(() => {
    const disposers = [
      ctx.remote.$on('settings/document-updated', (ns) => {
        if (ns !== TELEGRAM_DUTY_SETTINGS_NS) return
        void load()
      }),
      ctx.on('connection/reset', () => {
        void load()
      }),
    ]
    void load()
    return () => {
      controller.dispose()
      for (const dispose of disposers) dispose()
    }
  }, 'telegram-duty: settings invalidations')

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'telegram-duty-banner',
    order: 100,
    inject: (): DutyBannerInjected => ({ hooks: { duty: controller.store }, load, switchBack }),
  }, DutyBanner))
}
