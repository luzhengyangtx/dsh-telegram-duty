/**
 * Duty banner, browser half: while the host plugin is in duty mode, a frame
 * overlay shows "approvals are on your phone" with a one-click switch back
 * to local mode. Rendered through the shell.overlay slot; text follows the
 * web UI locale.
 */

import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { DutyWatchState } from './settings-store.ts'

/** Banner locale dictionary declared into the shared LocaleNamespaceMap. */
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'telegram-duty.banner': 'title' | 'action'
  }
}

/** Registration-side business face handed to the banner component. */
export interface DutyBannerInjected {
  hooks: {
    /** Duty-watch snapshot bound by the renderer as useDuty. */
    duty: SnapshotStore<DutyWatchState>
  }
  /** Persist watchMode=local through the host command. */
  switchBack: () => void
}

/** Full component props. */
export type DutyBannerProps =
  PropsRuntime<'shell.overlay'>
  & PropsLocale<'telegram-duty.banner'>
  & InjectFace<DutyBannerInjected>

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
 * Render the duty-mode banner while the latest state marker says duty;
 * nothing otherwise.
 * @param props - composed slot props.
 */
export function DutyBanner({ useDuty, switchBack, t }: DutyBannerProps) {
  const state = useDuty(snapshot => snapshot)

  if (state.status !== 'ready' || state.mode !== 'duty') return null

  return (
    <div style={bannerStyle}>
      <span>🔔 {t('title')}</span>
      <button
        type="button"
        style={buttonStyle}
        onClick={() => {
          switchBack()
        }}
      >
        {t('action')}
      </button>
    </div>
  )
}
