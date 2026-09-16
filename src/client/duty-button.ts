/**
 * Pure client logic for the sidebar duty toggle: the status-dot mapping and
 * the click action mapping — while on duty a click switches back to local,
 * otherwise it turns duty on (both through host commands). The dot colors
 * mirror the watch mode the banner uses.
 * @module @luzhengyangtx/dsh-telegram-duty/client/duty-button
 */

import type { DutyMode } from './settings-store.ts'

export type DutyDotState = 'duty' | 'local' | 'unknown'

/** Map the watch store onto the three visual dot states. */
export function dutyDotState(mode: DutyMode, ready: boolean): DutyDotState {
  if (!ready) return 'unknown'
  return mode === 'duty' ? 'duty' : 'local'
}

/** Dot colors: attention while on duty, gray locally, dim before the first marker. */
export const DOT_COLORS: Record<DutyDotState, string> = {
  duty: '#f59e0b',
  local: '#9ca3af',
  unknown: 'rgba(156, 163, 175, 0.45)',
}

/** The click action for one dot state: on duty → switch back, else turn on. */
export type DutyToggleAction = 'off' | 'on'

export function toggleAction(dot: DutyDotState): DutyToggleAction {
  return dot === 'duty' ? 'off' : 'on'
}
