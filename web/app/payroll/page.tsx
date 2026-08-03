'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useFormatter, useLocale, useTranslations } from 'next-intl'
import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import { type AdminSnapshot, ApiError, fetchPayrollSnapshot } from '@/lib/api'
import { type ErrorKey, htmlLang, isLocale } from '@/lib/locale'
import { centsToPlainEuros } from '@/lib/money'
import { LOGIN_PATH } from '@/lib/nav'
import {
  coverageOf,
  msToHours,
  payrollFor,
  periodExceedsCoverage,
  reconcile,
  toCsv,
} from '@/lib/payroll'
import { isPeriod, PAYROLL_PERIODS, type Period, periodContaining, periodRange } from '@/lib/period'
import { toBusinessInput } from '@/lib/shifts'

/**
 * Payroll — what to actually pay each person for a calendar period.
 *
 * WHERE THE NUMBERS COME FROM, because this is the screen where being vague costs money:
 *
 * THE PERIOD GOES TO THE SERVER. `GET /admin/data?from=&to=` cuts the shift ROWS and the
 * pre-aggregated `hours` with the same WHERE clause, so the total under the table and the
 * rows in it describe the same days by construction rather than by two pieces of code
 * happening to agree. Until that parameter existed, `hours` was an ALL-TIME sum sitting
 * next to a period-filtered, row-capped list — which on 3 August 2026 could put July money
 * beside an empty August table, and which capped usable history at whatever the most recent
 * 2000 shifts happened to cover (roughly ten weeks at 20 workers).
 *
 * The page still sums the rows itself and compares the two, because they can still differ
 * in exactly one way: `hours` is not capped by `limit` and the row list is. That gap is the
 * truncated tail, and it is reported out loud instead of shown as a total that will not
 * reconcile.
 *
 * Changing the period REFETCHES. It has to: the rows for last March are not in a payload
 * fetched for August.
 *
 * What it excludes and says so: open shifts, and auto-closed shifts nobody has confirmed
 * (decision-10). Those are unpaid work belonging to a real person, so they are counted,
 * named and linked, never quietly dropped.
 *
 * KNOWN GAP, stated on screen: `workers.hourly_rate_cents` is a single mutable column.
 * There is no rate history, so past hours are priced at today's rate. Editing a rate
 * retroactively changes what last month appears to have cost.
 */

const SHIFTS_PATH = '/shifts/'

/**
 * `YYYY-MM-DD` for the export filename, in VIENNA time and not the browser's.
 *
 * The period starts at Vienna midnight, which is 22:00 or 23:00 UTC the day before; naming
 * the file from the raw instant would date `payroll-2026-06-30.csv` for July, and the
 * accountant files by that name.
 */
function businessDate(iso: string): string {
  return toBusinessInput(iso).slice(0, 10)
}

export default function PayrollPage() {
  const t = useTranslations('payroll')
  const tError = useTranslations('error')
  const format = useFormatter()
  const locale = useLocale()

  /**
   * Month names come from HERE and not from `format.dateTime`, for one Austrian reason:
   * next-intl is given the message-file key ('de'), so its own formatter resolves Intl
   * against plain German and prints "Januar" where this director says "Jänner". `htmlLang`
   * maps 'de' to the BCP-47 tag 'de-AT', which has the Austrian month names. Same trick,
   * same reason as app/reinigung/page.tsx. timeZone is pinned to match the provider's, so
   * a shift just after midnight still lands on the day the admin worked it.
   */
  const monthDayFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(htmlLang(isLocale(locale) ? locale : 'de'), {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'Europe/Vienna',
      }),
    [locale],
  )
  const router = useRouter()

  const periodId = useId()
  const periodHintId = useId()

  // null = still loading. Never rendered as "no hours yet".
  const [snapshot, setSnapshot] = useState<AdminSnapshot | null>(null)
  const [loadError, setLoadError] = useState<ErrorKey | null>(null)
  /** Payroll is run for the month that has ENDED. Same vocabulary as /shifts/ (lib/period.ts). */
  const [period, setPeriod] = useState<Period>('lastMonth')
  const [exported, setExported] = useState(false)
  const [exportFailed, setExportFailed] = useState(false)
  // Frozen at mount: "this month" must not change meaning halfway through a re-render.
  const [now] = useState(() => new Date())
  const range = useMemo(() => periodRange(period, now), [period, now])

  const handleAuthLoss = useCallback(
    (cause: unknown): boolean => {
      if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) {
        router.replace(LOGIN_PATH)
        return true
      }
      return false
    },
    [router],
  )

  useEffect(() => {
    const controller = new AbortController()
    // The payload IS the period. Clear it first, or the old period's rows stay on screen
    // under the new period's heading while the request is in flight.
    setSnapshot(null)
    void (async () => {
      try {
        setSnapshot(await fetchPayrollSnapshot(range, controller.signal))
        setLoadError(null)
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === 'AbortError') return
        if (handleAuthLoss(cause)) return
        setLoadError(cause instanceof ApiError ? cause.messageKey : 'server')
      }
    })()
    return () => controller.abort()
  }, [handleAuthLoss, range])

  // No client-side period filter: the server already applied one, and a second opinion here
  // is precisely the disagreement this screen exists to have eliminated.
  const totals = snapshot === null ? null : payrollFor(snapshot.workers, snapshot.shifts)
  const coverage = snapshot === null ? null : coverageOf(snapshot.shifts, snapshot.shift_limit)
  const incomplete = coverage !== null && periodExceedsCoverage(range, coverage)
  const reconciliation =
    snapshot === null ? null : reconcile(snapshot.workers, snapshot.shifts, snapshot.hours)

  // Explicit map, not a template-literal key: messages are typed (global.d.ts), and a
  // computed key would defeat the check that catches a typo at build time.
  const periodLabel: Record<Period, string> = {
    last30Days: t('periodLast30Days'),
    thisMonth: t('periodThisMonth'),
    lastMonth: t('periodLastMonth'),
    thisQuarter: t('periodThisQuarter'),
    thisYear: t('periodThisYear'),
    all: t('periodAll'),
  }

  // PAYROLL_PERIODS has no open-ended member, so both ends are always set; the fallback is
  // there so a future one cannot render "undefined bis undefined" on a payslip screen.
  const rangeLabel =
    range.from === null || range.to === null
      ? periodLabel[period]
      : t('rangeLabel', {
          from: monthDayFormat.format(new Date(range.from)),
          // Half-open, so the last day the admin cares about is one millisecond back.
          to: monthDayFormat.format(new Date(new Date(range.to).getTime() - 1)),
        })

  /**
   * The ledger's real extent, straight from the server and bounded by neither the period
   * nor the row cap. An empty pay period must never be able to read as "the data is gone".
   *
   * `all` is not a pay period, so a shift older than every named period offers no jump —
   * the sentence naming its date still does the work.
   */
  const latestStart = snapshot?.shift_bounds.latest ?? null
  const latest = latestStart === null ? null : periodContaining(latestStart, now)
  const latestPeriod = latest === 'all' ? null : latest

  const money = (cents: number) =>
    format.number(cents / 100, { style: 'currency', currency: 'EUR' })
  const hours = (ms: number) =>
    format.number(msToHours(ms), { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  function downloadCsv() {
    if (totals === null) return
    const rows: string[][] = [
      [
        t('csvWorker'),
        t('csvHours'),
        t('csvRateCents'),
        t('csvAmountCents'),
        t('csvAmountEuro'),
        // The accountant keeps this file; the audit trail has to be in it, not only on screen.
        t('csvManualShifts'),
      ],
      ...totals.lines.map((line) => [
        line.worker.name,
        msToHours(line.payableMs).toFixed(3),
        String(line.worker.hourly_rate_cents),
        String(line.payCents),
        centsToPlainEuros(line.payCents),
        String(line.manualShifts),
      ]),
      [
        t('totalLabel'),
        msToHours(totals.payableMs).toFixed(3),
        '',
        String(totals.payCents),
        centsToPlainEuros(totals.payCents),
        String(totals.manualShifts),
      ],
    ]

    // \uFEFF: without the BOM, Excel reads a UTF-8 export as Latin-1 and mangles every
    // umlaut in a worker's name. ponytail: no download library — an object URL and an
    // anchor click is the whole mechanism, and it is the same in every browser we support.
    const blob = new Blob([`\uFEFF${toCsv(rows)}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    try {
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `payroll-${range.from === null ? 'alle' : businessDate(range.from)}.csv`
      // In the document and revoked on the next tick: a detached anchor is ignored by
      // Firefox, and revoking the object URL in the same turn as the click cancels the
      // download in Safari. Both fail SILENTLY, which is the worst possible outcome for a
      // button whose success message has already been rendered.
      anchor.style.display = 'none'
      document.body.append(anchor)
      anchor.click()
      window.setTimeout(() => {
        anchor.remove()
        URL.revokeObjectURL(url)
      }, 0)
      setExported(true)
      setExportFailed(false)
    } catch {
      URL.revokeObjectURL(url)
      setExported(false)
      setExportFailed(true)
    }
  }

  return (
    <>
      <h1>{t('heading')}</h1>
      <p className="lede">{t('intro')}</p>

      <section aria-labelledby="payroll-period-heading">
        <h2 id="payroll-period-heading">{t('periodHeading')}</h2>
        <div className="field toolbar-field">
          <label htmlFor={periodId}>{t('fieldPeriod')}</label>
          <select
            id={periodId}
            value={period}
            aria-describedby={periodHintId}
            onChange={(event) => {
              const next = event.target.value
              if (isPeriod(next)) setPeriod(next)
              setExported(false)
              setExportFailed(false)
            }}
          >
            {PAYROLL_PERIODS.map((option) => (
              <option key={option} value={option}>
                {periodLabel[option]}
              </option>
            ))}
          </select>
          <p className="field-hint" id={periodHintId}>
            {rangeLabel} {t('attributionHint')}
          </p>
        </div>
      </section>

      <section aria-labelledby="payroll-result-heading">
        <h2 id="payroll-result-heading">{t('resultHeading')}</h2>

        {loadError !== null ? (
          <p className="form-error" role="alert">
            {tError(loadError)}
          </p>
        ) : null}

        {snapshot === null || totals === null || coverage === null || reconciliation === null ? (
          <p role="status">{t('loading')}</p>
        ) : (
          <>
            {/* One permanent live region: the summary is re-announced when the period changes. */}
            <p className="page-summary" role="status">
              {t('summary', {
                period: rangeLabel,
                workers: totals.lines.length,
                hours: hours(totals.payableMs),
                amount: money(totals.payCents),
              })}
            </p>

            <div className="callout">
              <h3>{t('caveatHeading')}</h3>
              <ul>
                {/* decision-10: named, counted, linked. Never a silent exclusion. */}
                {totals.unresolvedShifts > 0 ? (
                  <li>
                    {t('caveatUnresolved', { count: totals.unresolvedShifts })}{' '}
                    <Link href={SHIFTS_PATH}>{t('caveatUnresolvedLink')}</Link>
                  </li>
                ) : null}
                {totals.openShifts > 0 ? (
                  <li>
                    {t('caveatOpen', { count: totals.openShifts })}{' '}
                    <Link href={SHIFTS_PATH}>{t('caveatOpenLink')}</Link>
                  </li>
                ) : null}
                {totals.unresolvedShifts === 0 && totals.openShifts === 0 ? (
                  <li>{t('caveatNoneExcluded')}</li>
                ) : null}

                {/* The shift list is capped; the server aggregate is not. Say which. */}
                {incomplete && coverage.earliestStart !== null ? (
                  <li>
                    {t('caveatTruncated', {
                      limit: snapshot.shift_limit,
                      earliest: monthDayFormat.format(new Date(coverage.earliestStart)),
                    })}
                  </li>
                ) : null}
                {reconciliation.missingCents !== 0 ? (
                  <li>
                    {t('caveatReconcile', {
                      server: money(reconciliation.serverCents),
                      visible: money(reconciliation.visibleCents),
                    })}
                  </li>
                ) : (
                  <li>{t('caveatReconcileOk')}</li>
                )}
                {/* Paid, not excluded — but a payslip dispute has to be able to find the
                    hours that no tag stands behind. Same fact the shift log shows in its
                    "how it was recorded" column; no extra column here, one sentence. */}
                {totals.manualShifts > 0 ? (
                  <li>
                    {t('caveatManual', { count: totals.manualShifts })}{' '}
                    <Link href={SHIFTS_PATH}>{t('caveatManualLink')}</Link>
                  </li>
                ) : null}
                {totals.orphanShifts > 0 ? <li>{t('caveatOrphan')}</li> : null}

                <li>{t('caveatRateHistory')}</li>
              </ul>
            </div>

            {totals.lines.length === 0 ? (
              /* Empty is not an error. But it is ambiguous, and the ambiguous reading is the
                 expensive one, so the screen says which: nothing in THIS period, and here is
                 when something was last recorded, and here is one click to that period. */
              <div className="notice">
                <p>{t('emptyBody')}</p>
                {latestStart === null ? (
                  <p>{t('emptyNeverRecorded')}</p>
                ) : (
                  <>
                    <p>
                      {t('emptyLatestRecorded', {
                        date: monthDayFormat.format(new Date(latestStart)),
                      })}
                    </p>
                    {latestPeriod === null || latestPeriod === period ? null : (
                      <p className="form-actions">
                        <button
                          type="button"
                          className="button-primary"
                          onClick={() => {
                            setPeriod(latestPeriod)
                            setExported(false)
                            setExportFailed(false)
                          }}
                        >
                          {t('emptyJump', { period: periodLabel[latestPeriod] })}
                        </button>
                      </p>
                    )}
                  </>
                )}
              </div>
            ) : (
              <>
                <table className="data-table">
                  <caption className="visually-hidden">
                    {t('tableCaption', { period: rangeLabel })}
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">{t('colWorker')}</th>
                      <th scope="col" className="col-numeric">
                        {t('colHours')}
                      </th>
                      <th scope="col" className="col-numeric">
                        {t('colRate')}
                      </th>
                      <th scope="col" className="col-numeric">
                        {t('colAmount')}
                      </th>
                      <th scope="col">{t('colExcluded')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {totals.lines.map((line) => (
                      <tr key={line.worker.id}>
                        <th scope="row">{line.worker.name}</th>
                        <td className="col-numeric">{hours(line.payableMs)}</td>
                        <td className="col-numeric">{money(line.worker.hourly_rate_cents)}</td>
                        <td className="col-numeric">{money(line.payCents)}</td>
                        <td>
                          {line.unresolvedShifts === 0 && line.openShifts === 0 ? (
                            <span className="cell-muted">{t('excludedNone')}</span>
                          ) : (
                            [
                              line.unresolvedShifts > 0
                                ? t('excludedUnresolved', { count: line.unresolvedShifts })
                                : null,
                              line.openShifts > 0
                                ? t('excludedOpen', { count: line.openShifts })
                                : null,
                            ]
                              .filter((part) => part !== null)
                              .join(' · ')
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th scope="row">{t('totalLabel')}</th>
                      <td className="col-numeric">{hours(totals.payableMs)}</td>
                      <td className="col-numeric" />
                      <td className="col-numeric">{money(totals.payCents)}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>

                <div className="form-actions">
                  <button type="button" className="button-secondary" onClick={downloadCsv}>
                    {t('exportCsv')}
                  </button>
                </div>
                {/* Permanent live regions, same reasoning as the workers form. */}
                <p className="form-status" role="status">
                  {exported ? t('exported') : ''}
                </p>
                <p className="form-error" role="alert">
                  {exportFailed ? t('exportFailed') : ''}
                </p>
              </>
            )}
          </>
        )}
      </section>
    </>
  )
}
