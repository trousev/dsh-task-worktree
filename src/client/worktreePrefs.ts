/**
 * Durable preferences of dsh-task-worktree, read and written through the
 * client settings scope (`ctx.settingsScope`, provided by
 * `@deepseek-ai/dsh-client-ui-settings`).
 *
 * The host half registers the `task-worktree` settings namespace; this store is
 * the browser mirror of it. It keeps a plain observable snapshot so slot
 * components can read it through `useSyncExternalStore`, and it routes every
 * user choice through the scope's revision-fenced writes.
 *
 * The settings transport is reached structurally rather than by importing its
 * types: this external package must stay free of monorepo-internal type
 * dependencies, and a host without the service simply never binds (the store
 * then reports `available: false` and the controls render disabled).
 */

/** Settings namespace owned by the host half; keep in sync with `lib/index.js`. */
export const SETTINGS_NS = 'task-worktree'

/** Mode a conversation can start in. */
export type DefaultMode = 'local' | 'worktree'

/** The user-editable section of the settings namespace. */
export interface WorktreePreferences {
  /** Mode a blank conversation starts in. */
  defaultMode: DefaultMode
  /** Composer choices write `defaultMode` back, so the next conversation matches. */
  rememberLastChoice: boolean
}

/** Snapshot the components subscribe to. */
export interface WorktreePrefsSnapshot extends WorktreePreferences {
  /** Sync state of the settings transport (`loading` until the first answer). */
  status: 'loading' | 'ready' | 'unavailable'
  /** Whether a writable settings scope is bound (false: edits cannot persist). */
  available: boolean
}

/** The subset of the client settings scope this plugin touches. */
interface SettingsScopeLike<T> {
  getSnapshot(): {
    status: 'loading' | 'ready' | 'unavailable'
    value: T | undefined
    writable: boolean
  }
  subscribe(listener: () => void): () => void
  set(field: string, value: unknown): Promise<void>
}

/** The subset of `ctx.settingsScope` this plugin touches. */
export interface SettingsScopeBinder {
  bind<T>(spec: { namespace: string; decode?: (section: unknown) => T | undefined }): SettingsScopeLike<T>
}

/** Observable preference store consumed by the panel and the settings card. */
export interface WorktreePrefsStore {
  subscribe(listener: () => void): () => void
  getSnapshot(): WorktreePrefsSnapshot
  /** Bind the durable scope; returns the unsubscribe function (an effect body). */
  bind(binder: SettingsScopeBinder): () => void
  setDefaultMode(mode: DefaultMode): Promise<boolean>
  setRememberLastChoice(remember: boolean): Promise<boolean>
}

/** Snapshot used before any settings service answers. */
export const PREFS_FALLBACK: WorktreePrefsSnapshot = Object.freeze({
  defaultMode: 'local' as DefaultMode,
  rememberLastChoice: true,
  status: 'loading' as const,
  available: false,
})

/**
 * Narrow one wire section to the section this plugin owns.
 *
 * The host resolves the schema before the value reaches the browser, so this
 * stays defensive rather than validating: an unexpected section keeps the last
 * accepted value (returning undefined).
 */
function decode(section: unknown): WorktreePreferences | undefined {
  if (typeof section !== 'object' || section === null || Array.isArray(section)) return undefined
  const raw = section as { defaultMode?: unknown; rememberLastChoice?: unknown }
  return {
    defaultMode: raw.defaultMode === 'worktree' ? 'worktree' : 'local',
    rememberLastChoice: raw.rememberLastChoice !== false,
  }
}

export function createPrefsStore(): WorktreePrefsStore {
  let snapshot: WorktreePrefsSnapshot = PREFS_FALLBACK
  let scope: SettingsScopeLike<WorktreePreferences> | undefined
  const listeners = new Set<() => void>()

  const publish = (next: WorktreePrefsSnapshot): void => {
    if (
      snapshot.defaultMode === next.defaultMode
      && snapshot.rememberLastChoice === next.rememberLastChoice
      && snapshot.status === next.status
      && snapshot.available === next.available
    ) return
    snapshot = next
    for (const listener of listeners) listener()
  }

  /** Fold the scope's latest accepted section into the local snapshot. */
  const adopt = (): void => {
    if (scope === undefined) return
    const current = scope.getSnapshot()
    const value = current.value
    publish({
      defaultMode: value?.defaultMode === 'worktree' ? 'worktree' : 'local',
      rememberLastChoice: value?.rememberLastChoice !== false,
      status: current.status,
      available: current.status === 'ready' && current.writable,
    })
  }

  /**
   * One user choice. `set` resolves even when the host REFUSES the write, so
   * acceptance is confirmed by re-reading the scope (the documented contract of
   * the settings transport); a rejected write triggers the scope's recovery
   * read, and either way the store ends up showing what the host accepted.
   */
  const write = async (field: keyof WorktreePreferences, value: unknown): Promise<boolean> => {
    if (scope === undefined) return false
    try {
      await scope.set(field, value)
    } catch (error) {
      console.warn(`[dsh-task-worktree] settings write failed: ${error instanceof Error ? error.message : String(error)}`)
      return false
    }
    const current = scope.getSnapshot()
    return current.status === 'ready' && current.value?.[field] === value
  }

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot() {
      return snapshot
    },
    bind(binder) {
      scope = binder.bind<WorktreePreferences>({ namespace: SETTINGS_NS, decode })
      adopt()
      return scope.subscribe(adopt)
    },
    setDefaultMode(mode) {
      return write('defaultMode', mode)
    },
    setRememberLastChoice(remember) {
      return write('rememberLastChoice', remember)
    },
  }
}
