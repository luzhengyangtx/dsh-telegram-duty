/**
 * Duty-session marker projection: the host folds every session log for
 * `user/message` events injected from the phone (source plugin
 * `telegram-duty`), and the resulting `telegramDuty` value rides the standard
 * session.list projections block down to the web client, where the sidebar
 * "值班" button uses it to find the duty session id without reading plugin
 * settings (the web settings wire is allowlisted).
 * @module @luzhengyangtx/dsh-telegram-duty/projection
 */

import z from 'zod'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** True once a session received a phone-injected message (the duty session). */
    telegramDuty?: boolean
  }
}

/** True when the event is a phone-injected user message into the duty session. */
export function isDutySourceEvent(event: SessionEvent): boolean {
  if (event.type !== 'user/message') return false
  const source = event.data.source
  return source.kind === 'plugin' && source.plugin === 'telegram-duty'
}

/**
 * The projection unit: an idempotent latch — once a session has any
 * duty-sourced message, it stays marked. Targeted deliveries use a different
 * source plugin name, so they never mark other sessions.
 */
export function telegramDutyProjection(): ProjectionDefinition<'telegramDuty', boolean> {
  return {
    key: 'telegramDuty',
    schema: z.boolean(),
    init: () => false,
    apply: (state, event) => {
      if (state) return state
      return isDutySourceEvent(event) ? true : state
    },
    view: state => state,
    stateVersion: 1,
  }
}
