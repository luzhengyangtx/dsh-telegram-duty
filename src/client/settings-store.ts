/**
 * Duty-mode store (browser half). The web settings wire is allowlisted, so
 * the host publishes the mode through the state-marker namespaces: a
 * timestamp write into `telegram-duty-on` / `telegram-duty-off` rides the
 * forwarded `settings/document-updated` event, whose namespace name IS the
 * mode signal. No settings reads are needed.
 */

import {
  createSnapshotStore, type SnapshotStore,
} from '@deepseek-ai/dsh-client-runtime/client'

export const DUTY_STATE_ON_NS = 'telegram-duty-on'
export const DUTY_STATE_OFF_NS = 'telegram-duty-off'

export type DutyMode = 'local' | 'duty'

/** Banner-relevant snapshot of the duty mode. */
export interface DutyWatchState {
  /** Latest mode learned from a state-marker event. */
  mode: DutyMode
  /** Whether at least one marker event has been observed. */
  status: 'idle' | 'ready'
}

/** Keep the duty mode from the forwarded marker events. */
export class DutyWatchController {
  /** Snapshot consumed through the slot-injected bound selector hook. */
  readonly store: SnapshotStore<DutyWatchState> = createSnapshotStore({
    mode: 'local',
    status: 'idle',
  })

  /** Handle one forwarded settings namespace; only the markers matter. */
  onNamespace(ns: string): void {
    if (ns === DUTY_STATE_ON_NS) {
      this.setMode('duty')
    } else if (ns === DUTY_STATE_OFF_NS) {
      this.setMode('local')
    }
  }

  private setMode(mode: DutyMode): void {
    const state = this.store.getSnapshot()
    if (state.mode === mode && state.status === 'ready') return
    this.store.update((next) => {
      next.mode = mode
      next.status = 'ready'
    })
  }
}
