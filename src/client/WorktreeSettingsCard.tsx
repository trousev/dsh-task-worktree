/**
 * The plugin's card on the Plugins → Plugin configuration settings page.
 *
 * It owns the `task-worktree` settings namespace: the mode a NEW conversation
 * starts in, and whether the composer's mode selector remembers the last
 * choice. Both writes go through the client settings scope (revision-fenced,
 * persisted by the host), so the value is live and survives restarts.
 *
 * The card is dispatched by the Plugins section under the settings namespace
 * this plugin's host half registers, so it appears only where that namespace
 * is actually served. The host's own card chrome is package-internal, so the
 * container is drawn here with the same design tokens.
 */
import { useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import {
  IconBranchOutline16,
  IconChevronDownOutline14,
  IconFolderOpenOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorktreeKey } from './locales.ts'
import type { DefaultMode, WorktreePrefsStore } from './worktreePrefs.ts'
import css from './WorktreeSettings.module.css'

export interface WorktreeSettingsCardProps {
  /** Durable preferences (settings namespace `task-worktree`). */
  prefs: WorktreePrefsStore
  /** Locale-bound strings for the card copy. */
  t: (key: keyof WorktreeKey) => string
}

/** One label + hint block with an optional control, the host's row shape. */
function Row(label: string, hint: string, control: ReactNode): ReactNode {
  return (
    <div className={css.row}>
      <div className={css.labelBox}>
        <div className={css.label}>{label}</div>
        <div className={css.hint}>{hint}</div>
      </div>
      {control}
    </div>
  )
}

export function WorktreeSettingsCard({ prefs, t }: WorktreeSettingsCardProps): ReactNode {
  const snapshot = useSyncExternalStore(prefs.subscribe, prefs.getSnapshot)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const disabled = !snapshot.available || busy !== null

  const chooseMode = (mode: DefaultMode): void => {
    if (disabled || snapshot.defaultMode === mode) return
    setBusy(mode)
    setFailed(false)
    void prefs.setDefaultMode(mode).then(ok => {
      if (!ok) setFailed(true)
    }).finally(() => {
      setBusy(null)
    })
  }

  const toggleRemember = (): void => {
    if (disabled) return
    setBusy('remember')
    setFailed(false)
    void prefs.setRememberLastChoice(!snapshot.rememberLastChoice).then(ok => {
      if (!ok) setFailed(true)
    }).finally(() => {
      setBusy(null)
    })
  }

  const body = (
    <div className={css.body}>
      {Row(
        t('settingsDefaultMode'),
        snapshot.defaultMode === 'worktree'
          ? t('settingsDefaultWorktreeHint')
          : t('settingsDefaultLocalHint'),
        <div className={css.seg} role="radiogroup" aria-label={t('settingsDefaultMode')}>
          <button
            type="button"
            role="radio"
            aria-checked={snapshot.defaultMode === 'local'}
            className={snapshot.defaultMode === 'local' ? `${css.segBtn} ${css.segOn}` : css.segBtn}
            disabled={disabled}
            onClick={() => { chooseMode('local') }}
          >
            <IconFolderOpenOutline16 size={13} className={css.segIcon} />
            <span>{t('localMode')}</span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={snapshot.defaultMode === 'worktree'}
            className={snapshot.defaultMode === 'worktree' ? `${css.segBtn} ${css.segOn}` : css.segBtn}
            disabled={disabled}
            onClick={() => { chooseMode('worktree') }}
          >
            <IconBranchOutline16 size={13} className={css.segIcon} />
            <span>{t('worktreeMode')}</span>
          </button>
        </div>,
      )}

      {Row(
        t('settingsRemember'),
        t('settingsRememberHint'),
        <button
          type="button"
          role="switch"
          aria-checked={snapshot.rememberLastChoice}
          aria-label={t('settingsRemember')}
          className={snapshot.rememberLastChoice ? `${css.switch} ${css.switchOn}` : css.switch}
          disabled={disabled}
          onClick={toggleRemember}
        >
          <span className={css.switchKnob} />
        </button>,
      )}

      {snapshot.status === 'unavailable' && <div className={css.notice}>{t('settingsUnavailable')}</div>}
      {failed && <div className={`${css.notice} ${css.error}`} role="alert">{t('settingsSaveFailed')}</div>}
    </div>
  )

  return (
    <div className={open ? `${css.card} ${css.cardOpen}` : css.card} data-testid="worktree-settings-card">
      <button
        type="button"
        className={css.header}
        aria-expanded={open}
        onClick={() => { setOpen(!open) }}
      >
        <div className={css.headText}>
          <div className={css.name}>{t('settingsCardTitle')}</div>
          <div className={css.desc}>{t('settingsCardDesc')}</div>
        </div>
        <span className={open ? `${css.chevron} ${css.chevronOpen}` : css.chevron}>
          <IconChevronDownOutline14 size={14} />
        </span>
      </button>
      {open && body}
    </div>
  )
}
