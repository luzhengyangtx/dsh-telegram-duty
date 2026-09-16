/**
 * Sidebar duty toggle: an action beside Settings (the official
 * `sidebar.footer.action` slot) that switches the duty mode — click turns
 * duty on while local and back to local while on duty — with a status dot
 * mirroring the watch mode (the same state-marker channel the banner uses).
 * Folded to the rail, only the icon + dot remain.
 */

import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { DutyWatchState } from './settings-store.ts'
import { DOT_COLORS, dutyDotState } from './duty-button.ts'

/** Registration-side business face handed to the button component. */
export interface DutyButtonInjected {
  hooks: {
    /** Duty-watch snapshot bound by the renderer as useDuty. */
    duty: SnapshotStore<DutyWatchState>
  }
  /** Toggle the duty mode: on while local, off while on duty. */
  toggle: () => void
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
 * Render the duty toggle: icon + "值班" label when wide, status dot always.
 * @param props - composed slot props.
 */
export function DutyButton({ wide, useDuty, toggle, t }: DutyButtonProps) {
  const state = useDuty(snapshot => snapshot)
  const dot = dutyDotState(state.mode, state.status === 'ready')
  const color = DOT_COLORS[dot]

  return (
    <button
      type="button"
      style={rowStyle}
      title={t('sidebarDuty')}
      onClick={() => {
        toggle()
      }}
    >
      <span style={iconStyle}>📱</span>
      {wide ? <span style={labelStyle}>{t('sidebarDuty')}</span> : null}
      <span style={{ ...dotStyle, background: color }} />
    </button>
  )
}
