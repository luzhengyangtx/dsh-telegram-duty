/**
 * Duty-watch settings controller (browser half): reads the plugin's
 * `telegram-duty` settings namespace through the host settings API and can
 * switch the watch mode back to local. Push invalidations arrive from the
 * host as `settings/document-updated` events.
 */

import type {
  IApiClient, SettingsNamespaceView,
} from '@deepseek-ai/dsh-api-remotes/client'
import {
  createSnapshotStore, type SnapshotStore,
} from '@deepseek-ai/dsh-client-runtime/client'

/** Settings namespace owned by the host plugin. */
export const TELEGRAM_DUTY_SETTINGS_NS = 'telegram-duty'

/** Banner-relevant snapshot of the duty settings. */
export interface DutyWatchState {
  status: 'idle' | 'loading' | 'ready' | 'saving' | 'unavailable' | 'error'
  error: string | null
  mode: 'local' | 'duty'
  language: 'zh' | 'en'
  revision: number
}

/** Join settings reads/writes with pushed invalidations. */
export class DutyWatchController {
  /** Snapshot consumed through the slot-injected bound selector hook. */
  readonly store: SnapshotStore<DutyWatchState> = createSnapshotStore({
    status: 'idle',
    error: null,
    mode: 'local',
    language: 'en',
    revision: 0,
  })

  private generation = 0
  private view: SettingsNamespaceView | undefined

  /** @param api - Settings wire face of the client connection. */
  constructor(private readonly api: Pick<IApiClient, 'settings'>) {}

  /** Refresh the duty-watch snapshot; the latest request wins. */
  async load(): Promise<void> {
    const generation = ++this.generation
    this.store.update((state) => {
      state.status = 'loading'
      state.error = null
    })
    try {
      const response = await this.api.settings.describe({})
      if (!response.result.ok) throw new Error(response.result.error.message)
      if (generation !== this.generation) return
      const view = response.result.value.namespaces.find(entry => entry.ns === TELEGRAM_DUTY_SETTINGS_NS)
      if (view === undefined) {
        this.view = undefined
        this.store.update((state) => {
          state.status = 'unavailable'
          state.mode = 'local'
          state.language = 'en'
        })
        return
      }
      this.accept(view)
    } catch (error) {
      if (generation !== this.generation) return
      this.fail(error)
    }
  }

  /** Persist watchMode=local (the banner's one-click switch-back). */
  async switchBack(): Promise<void> {
    const view = this.view
    if (view === undefined) return
    const generation = ++this.generation
    this.store.update((draft) => {
      draft.status = 'saving'
      draft.error = null
    })
    try {
      const response = await this.api.settings.mutate({
        ns: TELEGRAM_DUTY_SETTINGS_NS,
        ops: [{ op: 'set', path: ['watchMode'], value: 'local' }],
        expectedRevision: view.revision,
      })
      if (generation !== this.generation) return
      if (!response.result.ok) throw new Error(response.result.error.message)
      this.accept(response.result.value)
    } catch (error) {
      if (generation !== this.generation) return
      this.fail(error)
    }
  }

  /** Stop in-flight responses from publishing after plugin disposal. */
  dispose(): void {
    this.generation += 1
    this.view = undefined
  }

  private accept(view: SettingsNamespaceView): void {
    const value = view.value as { watchMode?: unknown; language?: unknown } | null
    const mode = value?.watchMode === 'duty' ? 'duty' : 'local'
    const language = value?.language === 'zh' ? 'zh' : 'en'
    this.view = view
    this.store.update((state) => {
      state.status = 'ready'
      state.error = null
      state.mode = mode
      state.language = language
      state.revision = view.revision
    })
  }

  private fail(error: unknown): void {
    this.store.update((state) => {
      state.status = 'error'
      state.error = error instanceof Error ? error.message : String(error)
    })
  }
}
