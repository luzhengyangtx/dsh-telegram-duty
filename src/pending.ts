/**
 * Pending-approval scan: folds a session log for `approval/asked` records
 * without a matching `approval/decided` — i.e. approvals still waiting on an
 * answerer. The gateway uses it to warn on `/away` that the web UI holds
 * unanswered approvals (the phone cannot answer an already-web-claimed
 * approval) and to find sessions `/unblock` must cancel.
 * @module @luzhengyangtx/dsh-telegram-duty/pending
 */

import type { ApprovalRequestId } from '@deepseek-ai/dsh-user-approval'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

export interface PendingApprovalInfo {
  id: ApprovalRequestId
  toolName: string
  reason?: string
}

/**
 * Undecided approvals in a session log, in chronological order. Scans
 * backwards with a decided-id set — the same fold the API proxy uses to pair
 * asked/decided audit events.
 */
export function scanPendingApprovals(events: readonly SessionEvent[]): PendingApprovalInfo[] {
  const decided = new Set<string>()
  const pending: PendingApprovalInfo[] = []
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event === undefined) continue
    if (event.type === 'approval/decided') {
      decided.add(event.data.id)
    } else if (event.type === 'approval/asked') {
      if (decided.has(event.data.id)) continue
      pending.push({
        id: event.data.id,
        toolName: event.data.toolName,
        ...(event.data.reason !== undefined ? { reason: event.data.reason } : {}),
      })
    }
  }
  pending.reverse()
  return pending
}
