/**
 * In-memory session routing state for targeted messages: the numbering
 * snapshot behind `/sessions` buttons and `#N` prefixes, plus the active
 * target (the session every subsequent message goes to). Nothing here is
 * persisted — a DSH restart returns routing to the default duty session.
 * @module @luzhengyangtx/dsh-telegram-duty/targeting
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'

/** One row of the /sessions listing. */
export interface SessionItem {
  sessionId: string
  title: string
  status: 'idle' | 'running' | 'offline'
}

/** One resolved snapshot entry (index → session identity + display title). */
export interface TargetLookup {
  sessionId: string
  title: string
}

/** How long a /sessions numbering snapshot stays valid for `#N` prefixes. */
export const TARGET_SNAPSHOT_TTL_MS = 30 * 60_000

/**
 * Routing state: captures the numbering snapshot from each `/sessions`, lets
 * `#N` prefixes and numbered buttons resolve through it, and holds the active
 * target session (null = default duty route).
 */
export class Targeting {
  private entries: Array<{ sessionId: string; title: string }> = []
  private snapshotAt = 0
  private active: string | null = null

  constructor(private readonly ttlMs: number = TARGET_SNAPSHOT_TTL_MS) {}

  /** Replace the numbering snapshot with the current listing (1-based). */
  capture(items: readonly SessionItem[], now: number = Date.now()): void {
    this.entries = items.map(item => ({ sessionId: item.sessionId, title: item.title }))
    this.snapshotAt = now
  }

  /** Resolve a 1-based `#N`/button index within the snapshot TTL. */
  lookup(index: number, now: number = Date.now()): TargetLookup | undefined {
    if (this.snapshotAt === 0 || now - this.snapshotAt > this.ttlMs) return undefined
    const entry = this.entries[index - 1]
    return entry === undefined ? undefined : { ...entry }
  }

  /** True when a snapshot once existed but has aged out. */
  expired(now: number = Date.now()): boolean {
    return this.snapshotAt !== 0 && now - this.snapshotAt > this.ttlMs
  }

  /** Set the active target session (null = default duty route). */
  setActive(sessionId: string | null): void {
    this.active = sessionId
  }

  /** The active target session id, or null for the default duty route. */
  activeId(): string | null {
    return this.active
  }
}

/**
 * Display title for the /sessions listing: the duty session gets its fixed
 * name, other sessions use their latest `session/title` event, falling back
 * to the session id. (`session/title` is a plugin-merged event type outside
 * this package's compile-time union, so the scan goes through a cast.)
 */
export function displayTitle(
  sessionId: string,
  events: readonly SessionEvent[],
  isDuty: boolean,
  dutyName: string,
): string {
  if (isDuty) return dutyName
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event === undefined) continue
    if ((event as { type: string }).type !== 'session/title') continue
    const title = (event.data as { title?: unknown }).title
    if (typeof title === 'string' && title.trim() !== '') return title.trim()
  }
  return sessionId
}
