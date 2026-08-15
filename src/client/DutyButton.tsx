/**
 * Sidebar duty button: an action beside Settings (the official
 * `sidebar.footer.action` slot) that opens the duty session with one click,
 * with a status dot mirroring the watch mode (the same state-marker channel
 * the banner uses). Folded to the rail, only the icon + dot remain.
 */

import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { DutyWatchState } from './settings-store.ts'
import { DOT_COLORS, dutyDotState } from './duty-button.ts'

/** Registration-side business face handed to the button component. */
export interface DutyButtonInjected {
  hooks: {
    /** Duty-watch snapshot bound by the renderer as useDuty. */
    duty: SnapshotStore<DutyWatchState>
    /** Open-failure flash bound by the renderer as useFailed. */
    failed: SnapshotStore<{ failed: boolean }>
  }
  /** Open the duty session (creating/resuming it on the host when needed). */
  open: () => void
}

/** Full component props. */
export type DutyButtonProps =
  PropsRuntime<'sidebar.footer.action'>
  & PropsLocale<'telegram-duty.banner'>
  & InjectFace<DutyButtonInjected>

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  padding: '6px 8px',
  background: 'transparent',
  border: '1px solid transparent',
  borderRadius: 8,
  cursor: 'pointer',
  color: 'inherit',
  fontSize: 13,
}

const labelStyle: React.CSSProperties = {
  whiteSpace: 'nowrap',
}

const iconStyle: React.CSSProperties = {
  fontSize: 14,
  lineHeight: 1,
}

const dotStyle: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: '50%',
  flexShrink: 0,
}

/**
 * Render the duty action: icon + "值班" label when wide, status dot always.
 * @param props - composed slot props.
 */
export function DutyButton({ wide, useDuty, useFailed, open, t }: DutyButtonProps) {
  const state = useDuty(snapshot => snapshot)
  const failedState = useFailed(snapshot => snapshot)
  const dot = dutyDotState(state.mode, state.status === 'ready')
  const color = failedState.failed ? DOT_COLORS.error : DOT_COLORS[dot]

  return (
    <button
      type="button"
      style={failedState.failed ? { ...rowStyle, borderColor: '#ef4444' } : rowStyle}
      title={failedState.failed ? t('sidebarError') : t('sidebarDuty')}
      onClick={() => {
        open()
      }}
    >
      <span style={iconStyle}>📱</span>
      {wide ? <span style={labelStyle}>{t('sidebarDuty')}</span> : null}
      <span style={{ ...dotStyle, background: color }} />
    </button>
  )
}
