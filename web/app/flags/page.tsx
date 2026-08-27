'use client'

import { useRouter } from 'next/navigation'
import { useFormatter, useTranslations } from 'next-intl'
import { useCallback, useEffect, useState } from 'react'
import { EmptyState } from '@/components/EmptyState'
import { ListPanel } from '@/components/ListPanel'
import { PageHeader } from '@/components/PageHeader'
import { ApiError, type FeatureFlag, fetchFlags, setFlag } from '@/lib/api'
import type { ErrorKey } from '@/lib/locale'
import { loginPathWithReturn } from '@/lib/nav'
import { BUSINESS_TIME_ZONE } from '@/lib/shifts'

/**
 * Feature flags (decision-57 §4): name + enabled toggle, and deliberately nothing else —
 * no per-flag configuration screen, no create form. A row is born in a migration next to
 * the client code that reads it, so PATCH is the only write this screen can make.
 *
 * Reachable by BOTH admin roles: `GET/PATCH /admin/flags` are the only routes the scoped
 * 'flags' account passes (server auth kind "flags"). It gets a 401 on every other admin
 * route — the same treatment as a logged-out browser, which is why those screens need no
 * change here and why this one must not call /admin/data or /admin/session.
 *
 * ponytail: the flag's human description is a lookup keyed by flag name (FLAG_NOTE_KEYS).
 * With one flag that is a two-line map; the ceiling is "every new flag needs a message key
 * or shows none". Upgrade path when there are many: a `description` column on the table.
 */

/** Known flags → a sentence in the `flags` namespace. An unknown name simply shows none. */
const FLAG_NOTE_KEYS: Record<string, 'noteFunShiftScreen' | 'noteSmsLogin'> = {
  fun_shift_screen: 'noteFunShiftScreen',
  sms_login: 'noteSmsLogin',
}

export default function FlagsPage() {
  const t = useTranslations('flags')
  const tError = useTranslations('error')
  const format = useFormatter()
  const router = useRouter()

  const [flags, setFlags] = useState<FeatureFlag[] | null>(null)
  const [loadError, setLoadError] = useState<ErrorKey | null>(null)
  /** The flag currently being written, so only ITS row disables. */
  const [busyName, setBusyName] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)

  const handleAuthLoss = useCallback(
    (cause: unknown): boolean => {
      if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) {
        router.replace(loginPathWithReturn())
        return true
      }
      return false
    },
    [router],
  )

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        setFlags(await fetchFlags(signal))
        setLoadError(null)
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === 'AbortError') return
        if (handleAuthLoss(cause)) return
        setLoadError(cause instanceof ApiError ? cause.messageKey : 'server')
      }
    },
    [handleAuthLoss],
  )

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  async function toggle(flag: FeatureFlag) {
    if (busyName !== null) return
    setBusyName(flag.name)
    setNotice(null)
    try {
      const updated = await setFlag(flag.name, !flag.enabled)
      // Replace the one row from the server's answer: `updated_by`/`updated_at` are the
      // server's to decide and must not be guessed here.
      setFlags((current) =>
        current === null
          ? current
          : current.map((row) => (row.name === updated.name ? updated : row)),
      )
      setNotice({
        ok: true,
        text: t(updated.enabled ? 'noticeEnabled' : 'noticeDisabled', { name: updated.name }),
      })
    } catch (cause) {
      if (handleAuthLoss(cause)) return
      setNotice({ ok: false, text: t('noticeFailed', { name: flag.name }) })
    } finally {
      setBusyName(null)
    }
  }

  return (
    <>
      <PageHeader title={t('heading')} question={t('question')} />

      <p className="form-error" role="alert">
        {loadError === null ? '' : tError(loadError)}
      </p>
      <p className={notice?.ok === false ? 'form-error' : 'form-status'} role="status">
        {notice === null ? '' : notice.text}
      </p>

      <ListPanel title={t('listHeading')}>
        {flags === null ? (
          <p role="status">{loadError === null ? t('loading') : tError(loadError)}</p>
        ) : flags.length === 0 ? (
          <EmptyState>{t('empty')}</EmptyState>
        ) : (
          <table className="data-table">
            <caption className="visually-hidden">{t('tableCaption')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('colFlag')}</th>
                <th scope="col">{t('colUpdated')}</th>
                <th scope="col">{t('colState')}</th>
              </tr>
            </thead>
            <tbody>
              {flags.map((flag) => {
                const noteKey = FLAG_NOTE_KEYS[flag.name]
                return (
                  <tr key={flag.name}>
                    <td>
                      <code className="cell-code">{flag.name}</code>
                      {noteKey === undefined ? null : <p className="cell-muted">{t(noteKey)}</p>}
                    </td>
                    <td>
                      {flag.updated_at === null
                        ? t('neverUpdated')
                        : t('updatedBy', {
                            when: format.dateTime(new Date(flag.updated_at), {
                              dateStyle: 'medium',
                              timeStyle: 'short',
                              timeZone: BUSINESS_TIME_ZONE,
                            }),
                            who: flag.updated_by ?? t('updatedByUnknown'),
                          })}
                    </td>
                    <td className="cell-actions">
                      {/* A button, not a checkbox: the write is a request that can fail, and
                          a checkbox that snaps back is a lie about what happened. The state
                          is in the label AND in aria-pressed, never in colour alone. */}
                      <button
                        type="button"
                        className={flag.enabled ? 'btn btn-quiet' : 'btn btn-primary'}
                        aria-pressed={flag.enabled}
                        disabled={busyName !== null}
                        onClick={() => void toggle(flag)}
                      >
                        {busyName === flag.name
                          ? t('submitting')
                          : flag.enabled
                            ? t('disableAction')
                            : t('enableAction')}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </ListPanel>
    </>
  )
}
