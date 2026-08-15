/**
 * Duty banner, browser half: while the host plugin is in duty mode, a frame
 * overlay shows "approvals are on your phone" with a one-click switch back
 * to local mode. Rendered through the shell.overlay slot.
 */

import { useEffect } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { DutyWatchState } from './settings-store.ts'

/** Registration-side business face handed to the banner component. */
export interface DutyBannerInjected {
  hooks: {
    /** Duty-watch snapshot bound by the renderer as useDuty. */
    duty: SnapshotStore<DutyWatchState>
  }
  /** Load the snapshot when the banner first renders. */
  load: () => Promise<void>
  /** Persist watchMode=local. */
  switchBack: () => Promise<void>
}

/** Full component props. */
export type DutyBannerProps =
  PropsRuntime<'shell.overlay'>
  & InjectFace<DutyBannerInjected>

const TEXTS = {
  zh: { title: '审批已转到手机', action: '切回本地', saving: '切换中…' },
  en: { title: 'Approvals are on your phone', action: 'Back to local', saving: 'Switching…' },
} as const

const bannerStyle: React.CSSProperties = {
  position: 'fixed',
  top: 12,
  left: '50%',
  transform: 'translateX(-50%)',
  zIndex: 1000,
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '8px 14px',
  background: '#1f2937',
  color: '#fff',
  borderRadius: 999,
  fontSize: 13,
  boxShadow: '0 4px 16px rgba(0, 0, 0, 0.25)',
}

const buttonStyle: React.CSSProperties = {
  border: '1px solid rgba(255, 255, 255, 0.4)',
  background: 'transparent',
  color: '#fff',
  borderRadius: 999,
  padding: '3px 10px',
  cursor: 'pointer',
  fontSize: 12,
}

/**
 * Render the duty-mode banner, or null while local/unavailable.
 * @param props - composed slot props.
 */
export function DutyBanner({ useDuty, load, switchBack }: DutyBannerProps) {
  const state = useDuty(snapshot => snapshot)

  useEffect(() => {
    void load()
  }, [load])

  if (state.status === 'unavailable' || state.status === 'error') return null
  if (state.mode !== 'duty') return null
  const t = TEXTS[state.language] ?? TEXTS.en
  const busy = state.status === 'saving'

  return (
    <div style={bannerStyle}>
      <span>🔔 {t.title}</span>
      <button
        type="button"
        disabled={busy}
        style={buttonStyle}
        onClick={() => {
          void switchBack()
        }}
      >
        {busy ? t.saving : t.action}
      </button>
    </div>
  )
}
