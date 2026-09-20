/**
 * The plugin's card on the Plugins → Plugin configuration settings page.
 *
 * It owns the `task-worktree` settings namespace through ONE three-way choice:
 * pin local mode, pin worktree mode, or let the composer's picker decide and
 * remember it. Two controls (a mode plus a "remember" switch) would describe
 * the same three states with a fourth combination that means nothing, which is
 * why this is a single radio group.
 *
 * Writes go through the client settings scope (revision-fenced, persisted by
 * the host), so the value is live and survives restarts. The card is dispatched
 * by the Plugins section under the settings namespace this plugin's host half
 * registers, so it appears only where that namespace is actually served. The
 * host's own card chrome is package-internal, so the container is drawn here
 * with the same design tokens.
 */
import { useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import {
  IconBranchOutline16,
  IconChevronDownOutline14,
  IconFolderOpenOutline16,
  IconRefreshOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorktreeKey } from './locales.ts'
import { choiceOf } from './worktreePrefs.ts'
import type { NewConversationChoice, WorktreePrefsStore } from './worktreePrefs.ts'
import css from './WorktreeSettings.module.css'

export interface WorktreeSettingsCardProps {
  /** Durable preferences (settings namespace `task-worktree`). */
  prefs: WorktreePrefsStore
  /** Locale-bound strings for the card copy. */
  t: (key: keyof WorktreeKey) => string
}

export function WorktreeSettingsCard({ prefs, t }: WorktreeSettingsCardProps): ReactNode {
  const snapshot = useSyncExternalStore(prefs.subscribe, prefs.getSnapshot)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const disabled = !snapshot.available || busy
  const choice = choiceOf(snapshot)
  // Under `last` the remembered pick is what actually happens, so the hint
  // says which mode that currently is.
  const remembered = snapshot.defaultMode === 'worktree' ? t('worktreeMode') : t('localMode')
  const hint = choice === 'last'
    ? `${t('settingsRememberHint')} ${t('settingsRememberedNow')}${remembered}`
    : choice === 'worktree'
      ? t('settingsDefaultWorktreeHint')
      : t('settingsDefaultLocalHint')

  const options: { id: NewConversationChoice; label: string; icon: ReactNode }[] = [
    { id: 'local', label: t('localMode'), icon: <IconFolderOpenOutline16 size={13} className={css.segIcon} /> },
    { id: 'worktree', label: t('worktreeMode'), icon: <IconBranchOutline16 size={13} className={css.segIcon} /> },
    { id: 'last', label: t('settingsRemember'), icon: <IconRefreshOutline16 size={13} className={css.segIcon} /> },
  ]

  const choose = (next: NewConversationChoice): void => {
    if (disabled || next === choice) return
    setBusy(true)
    setFailed(false)
    void prefs.setNewConversationChoice(next).then(ok => {
      if (!ok) setFailed(true)
    }).finally(() => {
      setBusy(false)
    })
  }

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
      {open && (
        <div className={css.body}>
          <div className={css.field}>
            <div className={css.label}>{t('settingsDefaultMode')}</div>
            <div className={css.seg} role="radiogroup" aria-label={t('settingsDefaultMode')}>
              {options.map(option => (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={choice === option.id}
                  className={choice === option.id ? `${css.segBtn} ${css.segOn}` : css.segBtn}
                  disabled={disabled}
                  onClick={() => { choose(option.id) }}
                >
                  {option.icon}
                  <span>{option.label}</span>
                </button>
              ))}
            </div>
            <div className={css.hint}>{hint}</div>
          </div>
          {snapshot.status === 'unavailable' && <div className={css.notice}>{t('settingsUnavailable')}</div>}
          {failed && <div className={`${css.notice} ${css.error}`} role="alert">{t('settingsSaveFailed')}</div>}
        </div>
      )}
    </div>
  )
}
