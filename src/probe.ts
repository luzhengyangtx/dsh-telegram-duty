/**
 * Dev probe: attempt to resume a session and print the exact error.
 * Mount via a temporary patch row in an isolated profile run:
 *   - insert: - id: telegram-duty-probe / name: file:///.../lib/probe.js
 * Set TG_PROBE_SESSION to override the session id (default telegram-duty).
 * @module @luzhengyangtx/dsh-telegram-duty/probe
 */

import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'

export const name = 'telegram-duty-probe'
export const inject = ['agents']

export async function apply(ctx: Context): Promise<void> {
  const id = process.env.TG_PROBE_SESSION ?? 'telegram-duty'
  try {
    const handle = await ctx.agents.resume({ resumeSessionId: SessionId(id) })
    console.log(`PROBE: resume OK, agent live = ${handle.agent.id}`)
    await handle.dispose()
  } catch (error) {
    console.log('PROBE: resume FAILED:', error instanceof Error ? error.message : String(error))
    if (error instanceof Error && error.cause instanceof Error) {
      console.log('PROBE: cause:', error.cause.message)
    }
  }
}
