/**
 * Worktree-mode arming policy.
 *
 * Decides which conversations carry the worktree-creation instruction, and
 * keeps that decision independent of the harness event wiring so it can be
 * tested without a boot:
 *
 * - `/worktree mode-on` (or the composer selector) ARMS one session; the next
 *   genuine user message carries the instruction with the armed name.
 * - With the configured default mode set to `worktree`, a conversation that
 *   starts EMPTY arms itself: the instruction rides its first genuine user
 *   message, so a new task is isolated without touching the selector.
 * - An explicit `/worktree mode-off` is the user answering "local" for that
 *   conversation: the default must not override it.
 * - A resumed conversation is never auto-armed — it already has a history and
 *   a mode of its own.
 *
 * @module dsh-task-worktree/mode
 */

/** @typedef {{ id: string, session?: { seq?: number }, inject: (message: unknown) => void }} ModeAgent */

/**
 * @param {object} deps
 * @param {() => ('local' | 'worktree')} deps.defaultMode - live settings reader.
 * @param {(agent: ModeAgent, name: string | undefined) => void} deps.inject -
 *   deliver the creation instruction to one agent.
 */
export function createModeArmer({ defaultMode, inject }) {
  /** Sessions armed by an explicit mode-on, with the optional branch name. */
  const armed = new Map()
  /** Sessions whose mode decision is already made (armed or default). */
  const decided = new Set()
  /** Sessions the user explicitly put in local mode. */
  const suppressed = new Set()
  /** Sessions that started empty in this process (auto-default candidates). */
  const fresh = new Set()

  return {
    /** Arm one session (`/worktree mode-on [name]`). */
    arm(sessionId, name) {
      suppressed.delete(sessionId)
      armed.set(sessionId, { name: name?.trim() || undefined })
    },
    /** Mark one session as an explicit local choice (`/worktree mode-off`). */
    disarm(sessionId) {
      armed.delete(sessionId)
      suppressed.add(sessionId)
    },
    /** Note a session lifecycle start; only an empty conversation can auto-arm. */
    sessionStart(agent, source) {
      if (source !== 'startup' && source !== 'clear') return
      if (!decided.has(agent.id)) fresh.add(agent.id)
    },
    /** One message entered the live inbox: maybe deliver the instruction. */
    inboxInserted(agent, message) {
      // Only a genuine human prompt rides an injection; never re-arm on
      // producer-supplied context or tool results.
      if (message?.source?.kind !== 'user') return
      const pending = armed.get(agent.id)
      if (pending !== undefined) {
        armed.delete(agent.id)
        decided.add(agent.id)
        fresh.delete(agent.id)
        inject(agent, pending.name)
        return
      }
      if (decided.has(agent.id)) return
      // `session.seq === 0` is the fallback for an agent whose session-start
      // beacon has not been observed yet.
      const untouched = fresh.has(agent.id) || agent.session?.seq === 0
      if (!untouched) return
      decided.add(agent.id)
      fresh.delete(agent.id)
      if (suppressed.has(agent.id)) return
      if (defaultMode() !== 'worktree') return
      inject(agent, undefined)
    },
    /** Drop every per-session fact of a disposed agent. */
    disposed(agent) {
      armed.delete(agent.id)
      decided.delete(agent.id)
      suppressed.delete(agent.id)
      fresh.delete(agent.id)
    },
    /** Live counts, for diagnostics and tests. */
    inspect() {
      return { armed: armed.size, decided: decided.size, suppressed: suppressed.size, fresh: fresh.size }
    },
  }
}
