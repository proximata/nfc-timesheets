'use client'

import { useLocale, useTranslations } from 'next-intl'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ApiError, fetchPortalView, type PortalView } from '@/lib/api'
import { htmlLang, isLocale } from '@/lib/locale'
import { CLIENT_PORTAL_LOCALE, portalTokenFrom } from '@/lib/portal'
import { formatDuration } from '@/lib/shifts'

/**
 * THE CLIENT'S CLEANING RECORD. The only screen a non-employee ever sees.
 *
 * Reached at `/reinigung/#k=<token>` and nowhere else: no nav entry, no link from the admin
 * app, no login. The token IS the credential (server/routes/portal.js), it is read from the
 * URL at runtime, and it is deliberately NOT a route segment — `output: 'export'` cannot emit
 * a page per token, and a dynamic route would need a server this deployment does not have
 * (decision-16). Link shape and why it is a fragment: lib/portal.ts.
 *
 * Everything this page shows comes from `GET /portal/:token`: the building's name, and the
 * completed cleanings as date + FIRST NAME + duration. Three fields are read out of each row
 * and nothing else is rendered, so a future server-side addition cannot leak through this
 * screen by accident.
 *
 * No admin chrome (AppShell), no desktop guard (DesktopOnlyGuard, stated exception to
 * decision-7 — this is opened on a phone), German pinned (IntlProvider).
 */

/** Every failure the reader can see. Three messages, no detail about the token. */
type Failure = 'linkInvalid' | 'tooMany' | 'loadFailed'

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; view: PortalView }
  | { kind: 'failed'; why: Failure }

/** Spelled out rather than built from `why`, so a missing message is a typecheck error. */
const HINT_KEY = {
  linkInvalid: 'linkInvalidHint',
  tooMany: 'tooManyHint',
  loadFailed: 'loadFailedHint',
} as const

/**
 * A 404 is an unknown token, a revoked token, or a token for a building that has been
 * switched off — one message for all of them. Telling the reader "this used to work" is
 * information about our client relationships, and a distinct message per cause is a probe.
 */
function failureFor(cause: unknown): Failure {
  if (!(cause instanceof ApiError)) return 'loadFailed'
  if (cause.status === 429) return 'tooMany'
  if (cause.status >= 400 && cause.status < 500) return 'linkInvalid'
  return 'loadFailed'
}

export default function ClientPortalPage() {
  const t = useTranslations('portal')
  const locale = useLocale()
  const [state, setState] = useState<State>({ kind: 'loading' })

  /**
   * Read the token out of the URL and fetch. Also the "try again" handler, which is why it
   * hands the controller back instead of owning one: the caller decides when to abort.
   */
  const load = useCallback(() => {
    const controller = new AbortController()
    const token = portalTokenFrom(window.location.hash, window.location.search)
    if (token === null) {
      // Nothing is sent: a missing or malformed fragment is answered from here.
      setState({ kind: 'failed', why: 'linkInvalid' })
      return controller
    }

    setState({ kind: 'loading' })
    fetchPortalView(token, controller.signal)
      .then((view) => setState({ kind: 'ready', view }))
      .catch((cause) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return
        setState({ kind: 'failed', why: failureFor(cause) })
      })
    return controller
  }, [])

  useEffect(() => {
    const controller = load()
    return () => controller.abort()
  }, [load])

  /**
   * `date` is already the Vienna calendar day the cleaning ended on, as plain `YYYY-MM-DD`.
   * It is read as a UTC midnight and formatted in UTC, so no timezone can move it onto the
   * day before — the client checks this against their own diary.
   */
  const dateFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(htmlLang(isLocale(locale) ? locale : 'de'), {
        weekday: 'short',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        timeZone: 'UTC',
      }),
    [locale],
  )

  function formatDate(date: string): string {
    const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
    // Unparseable: show it verbatim rather than invent a day or hide the row.
    if (parts === null) return date
    return dateFormat.format(
      new Date(Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]))),
    )
  }

  const heading = state.kind === 'ready' ? state.view.building.name : t('heading')

  // The tab/share title. Set from here because the root layout's static metadata says "NFC
  // TimeSheets Admin", and an outsider should be told what they are looking at, not that they
  // have somebody's admin panel open. Set on the client for the same reason the data is
  // fetched on the client: the building is only known once the token has been resolved.
  useEffect(() => {
    document.title =
      state.kind === 'ready'
        ? t('documentTitle', { building: state.view.building.name })
        : t('heading')
  }, [state, t])

  return (
    // `lang` on the element, not only via the <html lang> the provider rewrites: the
    // prerendered file carries the build-time default (`en`) and this text is German either
    // way, so a screen reader must be told before any JavaScript has run.
    <main className="portal" id="main-content" lang={htmlLang(CLIENT_PORTAL_LOCALE)}>
      <div className="portal-card">
        <h1>{heading}</h1>

        {/* Always mounted, so a status change is announced as text inside an existing live
            region rather than as a node appearing. Empty when there is nothing to say. */}
        <p className="portal-status" role="status">
          {state.kind === 'loading' ? t('loading') : ''}
        </p>

        {state.kind === 'failed' ? (
          <div className="portal-failure">
            <p role="alert">{t(state.why)}</p>
            <p>{t(HINT_KEY[state.why])}</p>
            {state.why === 'linkInvalid' ? null : (
              <button type="button" className="button-primary" onClick={load}>
                {t('retry')}
              </button>
            )}
          </div>
        ) : null}

        {state.kind === 'ready' ? (
          <>
            <h2>{t('cleaningsHeading')}</h2>
            {state.view.cleanings.length === 0 ? (
              // An empty list is not an error: say what it means and what changes it.
              <p className="portal-empty">{t('empty')}</p>
            ) : (
              <table className="portal-table">
                <caption className="visually-hidden">
                  {t('tableCaption', { building: state.view.building.name })}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">{t('colDate')}</th>
                    <th scope="col">{t('colWho')}</th>
                    <th scope="col">{t('colDuration')}</th>
                  </tr>
                </thead>
                <tbody>
                  {state.view.cleanings.map((cleaning, index) => (
                    // No id is returned and none may be (nothing about this building is
                    // enumerable), and the content is not unique either — the same person can
                    // clean the same building twice on one day for the same time. These rows
                    // hold no state, are never reordered and are only ever replaced
                    // wholesale, so the position IS the identity here.
                    <tr
                      // biome-ignore lint/suspicious/noArrayIndexKey: see above.
                      key={index}
                    >
                      <td>{formatDate(cleaning.date)}</td>
                      <td>{cleaning.first_name}</td>
                      <td>{t('durationValue', { value: formatDuration(cleaning.minutes) })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="portal-note">{t('note')}</p>
          </>
        ) : null}
      </div>
    </main>
  )
}
