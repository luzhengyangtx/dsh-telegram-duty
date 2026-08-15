/**
 * Pure client logic for the sidebar duty button: the status-dot mapping and
 * the duty-session lookup through the standard session.list projection values
 * (the host folds the `telegramDuty` marker from phone-injected messages).
 * @module @luzhengyangtx/dsh-telegram-duty/client/duty-button
 */

import type { SessionId, SessionListState } from '@deepseek-ai/dsh-client-runtime/client'
import type { DutyMode } from './settings-store.ts'

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** True once a session received a phone-injected message (the duty session). */
    telegramDuty?: boolean
  }
}

export type DutyDotState = 'duty' | 'local' | 'unknown'

/** Map the watch store onto the three visual dot states. */
export function dutyDotState(mode: DutyMode, ready: boolean): DutyDotState {
  if (!ready) return 'unknown'
  return mode === 'duty' ? 'duty' : 'local'
}

/** Dot colors: attention while on duty, gray locally, dim before the first marker. */
export const DOT_COLORS: Record<DutyDotState | 'error', string> = {
  duty: '#f59e0b',
  local: '#9ca3af',
  unknown: 'rgba(156, 163, 175, 0.45)',
  error: '#ef4444',
}

/** Find the duty session id in the current list snapshot, or undefined. */
export function findDutySessionId(state: SessionListState): SessionId | undefined {
  for (const id of state.ids) {
    if (state.byId[id]?.projectionValues?.telegramDuty === true) return id
  }
  return undefined
}

export interface OpenDutyDeps {
  /** Scan the current session list for the duty session id. */
  find: () => SessionId | undefined
  /** Open a found session. */
  open: (id: SessionId) => void
  /** Ask the host to attach the duty session (/duty-session). */
  runCommand: () => void
  /** Refresh the session list baseline. */
  refresh: () => Promise<void>
  /** Report that the session could not be found after all attempts. */
  fail: () => void
  /** Retry timing (injected for tests). */
  delayMs?: number
  attempts?: number
}

/**
 * The button click flow: open the duty session when it is in the list with
 * its marker; otherwise have the host attach it and retry the scan while
 * refreshing the list; flash the error state when it stays missing.
 */
export async function openDutyFlow(deps: OpenDutyDeps): Promise<void> {
  const found = deps.find()
  if (found !== undefined) {
    deps.open(found)
    return
  }
  deps.runCommand()
  const attempts = deps.attempts ?? 6
  const delay = deps.delayMs ?? 700
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, delay))
    const retry = deps.find()
    if (retry !== undefined) {
      deps.open(retry)
      return
    }
    try {
      await deps.refresh()
    } catch {
      // Keep retrying until the attempts run out.
    }
  }
  deps.fail()
}
