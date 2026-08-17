'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useFormatter, useLocale, useTranslations } from 'next-intl'
import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import { AnswerBand } from '@/components/AnswerBand'
import { EmptyState } from '@/components/EmptyState'
import { Field } from '@/components/Field'
import { ListPanel } from '@/components/ListPanel'
import { PageHeader } from '@/components/PageHeader'
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
 * „Was ist diesen Monat auszuzahlen?" — the answer band says it in one number, the table
 * says it per person, and the exceptions between them say what that number is NOT.
 *
 * WHERE THE NUMBERS COME FROM, because this is the screen where being vague costs money:
 *
 * THE PERIOD GOES TO THE SERVER. `GET /admin/data?from=&to=` cuts the shift ROWS and the
 * pre-aggregated `hours` with the same WHERE clause, so the total in the answer band, the
 * total under the table and the rows in it describe the same days by construction rather
 * than by two pieces of code happening to agree — all three read the SAME `totals` object,
 * for the same reason. Until that parameter existed, `hours` was an ALL-TIME sum sitting
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
 * What it excludes and says so: open shifts, auto-closed shifts nobody has confirmed
 * (decision-10), and anybody whose hourly rate has never been set. Those are unpaid work
 * belonging to a real person, so they are counted, named and linked, never quietly dropped.
 * THE REDESIGN MOVED THIS PROSE, IT DID NOT DELETE ANY OF IT: the exceptions that are
 * actionable today stay above the table, and the two standing limitations sit in an open
 * „Wie diese Seite funktioniert" disclosure under it. Nothing here is hover-only.
 *
 * KNOWN GAP, stated on screen: `workers.hourly_rate_cents` is a single mutable column.
 * There is no rate history, so past hours are priced at today's rate. Editing a rate
 * retroactively changes what last month appears to have cost.
 *
 * NO WRITES. The CSV is a client-side Blob, so this screen has no drawer and no confirm.
 */

const SHIFTS_PATH = '/shifts/'
const WORKERS_PATH = '/workers/'

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
  /**
   * 0 cents is not a rate anybody agreed (`/workers/` says so on the row too). Their hours
   * are real and are in the hours column; their money is priced at zero and is therefore
   * MISSING from the amount. Counted and named, never shown as a confident EUR 0,00.
   */
  const noRateLines =
    totals === null ? [] : totals.lines.filter((l) => l.worker.hourly_rate_cents === 0)

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

  const excludedShifts = totals === null ? 0 : totals.unresolvedShifts + totals.openShifts
  /** What is excluded, in the words the rows use. Never empty: „nothing" is a branch. */
  const shiftExclusionSummary =
    totals === null || excludedShifts === 0
      ? t('answerExcludedNone')
      : [
          totals.unresolvedShifts > 0
            ? t('excludedUnresolved', { count: totals.unresolvedShifts })
            : null,
          totals.openShifts > 0 ? t('excludedOpen', { count: totals.openShifts }) : null,
        ]
          .filter((part) => part !== null)
          .join(' · ')
  const noRateSummary =
    noRateLines.length === 0 ? null : t('answerExcludedNoRate', { count: noRateLines.length })

  return (
    <>
      <PageHeader
        title={t('heading')}
        question={t('question')}
        action={
          totals !== null && totals.lines.length > 0 ? (
            <button type="button" className="btn btn-primary" onClick={downloadCsv}>
              {t('exportCsv')}
            </button>
          ) : undefined
        }
      />

      {/*
        THE PAGE'S live regions, permanently mounted and empty when there is nothing to say —
        a text change inside an existing region is announced far more reliably than a node
        that blinks into existence, and the export button now lives in the header, so its
        outcome has to be announced at page level rather than beside a table that may have
        been replaced by a period change in the meantime.
      */}
      <p className="form-error" role="alert">
        {loadError === null ? '' : tError(loadError)}
      </p>
      <p className="form-status" role="status">
        {exported ? t('exported') : ''}
      </p>
      <p className="form-error" role="alert">
        {exportFailed ? t('exportFailed') : ''}
      </p>

      {/* THE ANSWER FIRST, above the control that changes it: one amount, and what it does
          not include. Every figure here comes from the SAME `totals` the table below is
          rendered from — a review once caught this screen showing a total and a row list
          that disagreed — and the first cell names its own period, so the number is never
          read without knowing which days it covers. */}
      {totals === null ? null : (
        <AnswerBand
          cells={[
            { k: t('answerAmount'), v: money(totals.payCents), sub: rangeLabel },
            {
              k: t('answerHours'),
              v: hours(totals.payableMs),
              calm: true,
              sub: t('answerHoursSub'),
            },
            { k: t('answerWorkers'), v: totals.lines.length, calm: true },
            {
              k: t('answerExcluded'),
              // The number counts SHIFTS. An unpriced worker is not a shift, so it is named
              // in the line underneath instead of being added to a count of a different
              // thing — but it still turns this cell from calm to something to act on.
              v: excludedShifts,
              calm: excludedShifts === 0 && noRateLines.length === 0,
              // The SAME plural-correct strings the rows use, joined the same way — a second
              // phrasing of the same count is a second thing to keep in step. The shift
              // clause is ALWAYS first, including its „nothing" branch, so the 0 above can
              // never be read as a claim about the unpriced worker named after it.
              sub: [shiftExclusionSummary, noRateSummary].filter((p) => p !== null).join(' · '),
            },
          ]}
        />
      )}

      <div className="filter-bar">
        <Field id={periodId} label={t('fieldPeriod')} help={rangeLabel}>
          <select
            value={period}
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
        </Field>
      </div>

      {snapshot === null || totals === null || coverage === null || reconciliation === null ? (
        <p role="status">{t('loading')}</p>
      ) : (
        <>
          {/* THE TOTAL MAY BE WRONG, not merely incomplete. Two sentences, above everything,
              and neither of them is ever a tooltip or a hover. */}
          {incomplete || reconciliation.missingCents !== 0 ? (
            <div className="note bad">
              {incomplete && coverage.earliestStart !== null ? (
                <p>
                  {t('caveatTruncated', {
                    limit: snapshot.shift_limit,
                    earliest: monthDayFormat.format(new Date(coverage.earliestStart)),
                  })}
                </p>
              ) : null}
              {reconciliation.missingCents !== 0 ? (
                <p>
                  {t('caveatReconcile', {
                    server: money(reconciliation.serverCents),
                    visible: money(reconciliation.visibleCents),
                  })}
                </p>
              ) : null}
            </div>
          ) : null}

          {/* Before paying: what is excluded, counted and linked (decision-10). The clean
              branches are here too — „nichts fehlt" that is never said is indistinguishable
              from a check nobody ran. */}
          <div className="callout">
            <h3>{t('caveatHeading')}</h3>
            <ul>
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
              {/* An unset rate is not a free worker. Their hours are in the hours column and
                  their money is in nobody's column, so the sum is too low by an amount this
                  screen cannot know. */}
              {noRateLines.length > 0 ? (
                <li>
                  {t('caveatNoRate', { count: noRateLines.length })}{' '}
                  <Link href={WORKERS_PATH}>{t('caveatNoRateLink')}</Link>
                </li>
              ) : null}
              {/* The row list is capped; the server aggregate is not. The failing branch is
                  in the warning above, and the reconciled branch is stated here, because
                  silence would read as "not checked". */}
              {reconciliation.missingCents === 0 ? <li>{t('caveatReconcileOk')}</li> : null}
              {/* Paid, not excluded — but a payslip dispute has to be able to find the
                  hours that no tag stands behind. Same fact the shift log shows in its
                  "how it was recorded" column, and a column in the CSV. */}
              {totals.manualShifts > 0 ? (
                <li>
                  {t('caveatManual', { count: totals.manualShifts })}{' '}
                  <Link href={SHIFTS_PATH}>{t('caveatManualLink')}</Link>
                </li>
              ) : null}
              {totals.orphanShifts > 0 ? <li>{t('caveatOrphan')}</li> : null}
            </ul>
          </div>

          <ListPanel title={t('resultHeading')}>
            {totals.lines.length === 0 ? (
              /* Empty is not an error. But it is ambiguous, and the ambiguous reading is the
                 expensive one, so the screen says which: nothing in THIS period, and here is
                 when something was last recorded, and here is one click to that period. */
              <div className="list-body">
                <EmptyState>
                  {t('emptyBody')}{' '}
                  {latestStart === null
                    ? t('emptyNeverRecorded')
                    : t('emptyLatestRecorded', {
                        date: monthDayFormat.format(new Date(latestStart)),
                      })}
                </EmptyState>
                {latestStart !== null && latestPeriod !== null && latestPeriod !== period ? (
                  <p className="form-actions">
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => {
                        setPeriod(latestPeriod)
                        setExported(false)
                        setExportFailed(false)
                      }}
                    >
                      {t('emptyJump', { period: periodLabel[latestPeriod] })}
                    </button>
                  </p>
                ) : null}
              </div>
            ) : (
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
                  {totals.lines.map((line) => {
                    const noRate = line.worker.hourly_rate_cents === 0
                    const attention = noRate || line.unresolvedShifts > 0 || line.openShifts > 0
                    return (
                      // The 3px left rule is the THIRD signal. The words in the last column
                      // are the first, their position is the second; desaturate this table
                      // and it still reads.
                      <tr key={line.worker.id} className={attention ? 'is-unres' : undefined}>
                        <th scope="row">{line.worker.name}</th>
                        <td className="col-numeric">{hours(line.payableMs)}</td>
                        <td className="col-numeric">
                          {noRate ? (
                            <span className="cell-muted">{t('rowNoRate')}</span>
                          ) : (
                            money(line.worker.hourly_rate_cents)
                          )}
                        </td>
                        <td className="col-numeric">
                          {noRate ? (
                            <span className="cell-muted">{t('amountNoRate')}</span>
                          ) : (
                            money(line.payCents)
                          )}
                        </td>
                        <td>
                          {!noRate && line.unresolvedShifts === 0 && line.openShifts === 0 ? (
                            <span className="cell-muted">{t('excludedNone')}</span>
                          ) : (
                            [
                              line.unresolvedShifts > 0
                                ? t('excludedUnresolved', { count: line.unresolvedShifts })
                                : null,
                              line.openShifts > 0
                                ? t('excludedOpen', { count: line.openShifts })
                                : null,
                              noRate ? t('excludedNoRate') : null,
                            ]
                              .filter((part) => part !== null)
                              .join(' · ')
                          )}
                        </td>
                      </tr>
                    )
                  })}
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
            )}
          </ListPanel>

          {/*
            The two standing limitations. OPEN by default and collapsible, never hover-only:
            they are true in every period, so they are typeset small and put under the table
            rather than above it — and they may not be deleted to make the screen lighter.
          */}
          <details className="callout" open>
            <summary>{t('howHeading')}</summary>
            <ul>
              {/* `intro` is no longer a lede over the table — the question replaced it — but the
                  sentence it carried is a fact about where these numbers come from, so it is
                  kept here rather than deleted with the paragraph it used to live in. */}
              <li>{t('intro')}</li>
              <li>{t('caveatRateHistory')}</li>
              <li>{t('attributionHint')}</li>
            </ul>
          </details>
        </>
      )}
    </>
  )
}
