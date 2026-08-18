'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useFormatter, useLocale, useTranslations } from 'next-intl'
import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import { AnswerBand } from '@/components/AnswerBand'
import { EmptyState } from '@/components/EmptyState'
import { Field } from '@/components/Field'
import { FilterChips } from '@/components/FilterChips'
import { ListPanel } from '@/components/ListPanel'
import { PageHeader } from '@/components/PageHeader'
import { type AdminSnapshot, ApiError, fetchPayrollSnapshot } from '@/lib/api'
import { filterHref, useFilters } from '@/lib/filters'
import { type ErrorKey, htmlLang, isLocale } from '@/lib/locale'
import { centsToPlainEuros } from '@/lib/money'
import { LOGIN_PATH } from '@/lib/nav'
import {
  coverageOf,
  decimalComma,
  msToHours,
  type PayrollLine,
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
 * THE FOUR HEADLINE CELLS ARE READ ALONE, so they carry every exclusion between them. The
 * fourth one counted SHIFTS while calling itself „Nicht gezählt", which made it structurally
 * incapable of counting a rate-less PERSON: it printed 0 on a payroll that was 810,30 €
 * short, with the truth in the caveat prose underneath and the reassuring number in the
 * large type. It counts exclusions of every kind now, and „Stunden" names the part of itself
 * that carries no amount, so the two headline numbers reconcile without opening the CSV.
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
 *
 * THE CSV SAYS WHAT THE SCREEN SAYS. It used to ship `Ana Ilic;10.500;0;0;0.00;0` under a
 * screen reading „ein Betrag wird nicht berechnet – auch nicht 0,00 €“, so the accountant's
 * copy and the director's copy disagreed about one real person. A worker with no rate now
 * has EMPTY money cells and a stated reason, and the row still carries her name, her real
 * hours and her manual-shift count. `exclusionNote` is the one function both the table cell
 * and the file read.
 *
 * ...AND IT SAYS IT IN THE READER'S NUMBER FORMAT. The same file then shipped its decimals
 * with a DOT under a semicolon separator, so an Austrian Excel read `10.500` hours as ten
 * thousand five hundred and `3638.26` euros as text. Every decimal now carries a comma
 * (`decimalComma`); the integer cent columns carry no separator at all and read the same
 * everywhere. The rounding rules are untouched — this is a separator, not a second opinion.
 */

const SHIFTS_PATH = '/shifts/'
const WORKERS_PATH = '/workers/'
const HOME_PATH = '/'

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
  const tFilter = useTranslations('filters')
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
  /**
   * `?location=` / `?worker=` / `?period=` (decision-38). The period is read from the URL so
   * the building panel's „Lohn · nur Stunden hier · Vormonat" lands in the period its label
   * promised — the defect this contract exists to remove is a link that says one month and
   * opens another.
   *
   * THE URL IS THE PERIOD. No second copy in `useState`: two sources for the period on the
   * screen where money is decided is exactly the disagreement lib/period.ts was written to
   * end.
   */
  const [filters, setFilters] = useFilters()
  /** Payroll is run for the month that has ENDED. Same vocabulary as /shifts/ (lib/period.ts). */
  const period: Period = filters.period ?? 'lastMonth'
  const setPeriod = (next: Period) => setFilters({ period: next }, 'replace')
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

  /**
   * A SCOPED VIEW, and it says so. `?location=` / `?worker=` narrow the rows to one
   * building or one person, which is what the two object panels link here for: „who did I
   * pay for hours in THIS building last month".
   *
   * WHAT SCOPING COSTS, stated because getting it wrong costs somebody their wages:
   * `hours` — the server's own aggregate, the thing the reconciliation compares against —
   * carries a `worker_id` and NO `location_id`, so a building-scoped reconciliation is not
   * computable at all. Rather than compute it for one filter and not the other, no object
   * filter reconciles and no object filter exports. Both facts are stated on screen in
   * `scopedNote`, and the filter is one click from removal.
   *
   * ponytail: CEILING — a scoped payroll cannot be exported, so „send the accountant just
   * this building's hours" is still a manual job. UPGRADE PATH: a `location_id` on the
   * server's `hours` aggregate, which makes both the reconciliation and the export scopable
   * without a browser sum over a capped list. Not built now: `/admin/data` is the route
   * every screen shares.
   */
  const scoped = filters.location !== null || filters.worker !== null
  const scopedShifts =
    snapshot === null
      ? []
      : snapshot.shifts.filter(
          (shift) =>
            (filters.location === null || shift.location_id === filters.location) &&
            (filters.worker === null || shift.worker_id === filters.worker),
        )
  /**
   * The people this scope is about. A worker filter narrows to that person; a building
   * filter keeps only people who actually have hours there, which is what makes the link
   * „nur Mitarbeiter mit Stunden hier" true rather than a table of everybody with zeros.
   */
  const scopedWorkers =
    snapshot === null
      ? []
      : snapshot.workers.filter((worker) => {
          if (filters.worker !== null && worker.id !== filters.worker) return false
          if (filters.location === null) return true
          return scopedShifts.some((shift) => shift.worker_id === worker.id)
        })

  // No client-side period filter: the server already applied one, and a second opinion here
  // is precisely the disagreement this screen exists to have eliminated.
  const totals =
    snapshot === null
      ? null
      : scoped
        ? payrollFor(scopedWorkers, scopedShifts)
        : payrollFor(snapshot.workers, snapshot.shifts)
  const coverage = snapshot === null ? null : coverageOf(snapshot.shifts, snapshot.shift_limit)
  const incomplete = coverage !== null && periodExceedsCoverage(range, coverage)
  /** null while scoped: not „reconciled", not „failed" — NOT COMPUTED, and stated as such. */
  const reconciliation =
    snapshot === null || scoped
      ? null
      : reconcile(snapshot.workers, snapshot.shifts, snapshot.hours)

  const scopedLocationName =
    filters.location === null
      ? null
      : (snapshot?.locations.find((location) => location.id === filters.location)?.name ?? null)
  const scopedWorkerName =
    filters.worker === null
      ? null
      : (snapshot?.workers.find((worker) => worker.id === filters.worker)?.name ?? null)

  /**
   * 0 cents is not a rate anybody agreed (`/workers/` says so on the row too). Their hours
   * are real and are in the hours column; NO amount is computed for them at all — not zero,
   * no amount — so the payout total is short by a sum this screen cannot know. Counted and
   * named, never shown as a confident EUR 0,00, and `payroll.caveatNoRate` says exactly that
   * in the same words /workers/ uses.
   */
  const noRateLines =
    totals === null ? [] : totals.lines.filter((l) => l.worker.hourly_rate_cents === 0)
  /**
   * The hours inside „Stunden" that carry NO amount, because nobody set those people's
   * rate. They are payable, they are in the hours total, and they are in nobody's money
   * column — so „Stunden 267,25" and „Auszuzahlen 2.827,96 €" cannot be reconciled with each
   * other until this number is on the screen. It was not, and the gap was 810,30 € with
   * nothing above the table to explain it (journey D14, „my hours are wrong").
   */
  const noRateMs = noRateLines.reduce((sum, line) => sum + line.payableMs, 0)

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

  /**
   * What is NOT in this line's amount, in the order and the words the table's last column
   * uses. ONE function, read by the table cell AND by the CSV, because the screen and the
   * file the accountant keeps disagreeing about the same worker is precisely the bug this
   * replaced: the screen said „ein Betrag wird nicht berechnet – auch nicht 0,00 €“ while
   * the export shipped `Ana Ilic;10.500;0;0;0.00;0`.
   */
  function exclusionNote(line: PayrollLine): string {
    const noRate = line.worker.hourly_rate_cents === 0
    if (!noRate && line.unresolvedShifts === 0 && line.openShifts === 0) return t('excludedNone')
    return [
      line.unresolvedShifts > 0 ? t('excludedUnresolved', { count: line.unresolvedShifts }) : null,
      line.openShifts > 0 ? t('excludedOpen', { count: line.openShifts }) : null,
      noRate ? t('excludedNoRate') : null,
    ]
      .filter((part) => part !== null)
      .join(' · ')
  }

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
        // ...and so does the reason a money cell is blank. A blank nobody explains reads as
        // a broken exporter; this column is the file's copy of the table's last column.
        t('csvNote'),
      ],
      ...totals.lines.map((line) => {
        // NO RATE => THE THREE MONEY CELLS ARE EMPTY, and the name, the real hours, the
        // manual-shift count and the reason stay. Empty and not `0`: Excel's SUM skips a
        // blank and adds a zero, so a zero silently asserts „this person's work cost
        // nothing“ in the one artefact that outlives the screen — the same claim /payroll/
        // and /workers/ refuse to make. Not a sentinel like -1 either: it would sum, and it
        // would sum WRONG. Not the word „Nicht bewertet“ in a numeric column either: one
        // text cell turns the whole column to text in Excel and breaks SUM for everyone.
        const noRate = line.worker.hourly_rate_cents === 0
        return [
          line.worker.name,
          // DECIMAL COMMA, because the field separator is a semicolon and the two go
          // together: `10.500` under `;` is TEN THOUSAND FIVE HUNDRED to an Austrian Excel.
          // See `decimalComma` in lib/payroll.ts for what each column used to be read as.
          decimalComma(msToHours(line.payableMs).toFixed(3)),
          noRate ? '' : String(line.worker.hourly_rate_cents),
          noRate ? '' : String(line.payCents),
          noRate ? '' : decimalComma(centsToPlainEuros(line.payCents)),
          String(line.manualShifts),
          exclusionNote(line),
        ]
      }),
      [
        t('totalLabel'),
        // The hours total includes the unpriced hours; the amount total cannot. That gap is
        // the note's whole job — without it the two columns look like an arithmetic error.
        decimalComma(msToHours(totals.payableMs).toFixed(3)),
        '',
        String(totals.payCents),
        decimalComma(centsToPlainEuros(totals.payCents)),
        String(totals.manualShifts),
        noRateLines.length === 0 ? '' : t('csvTotalNoRate', { count: noRateLines.length }),
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
  /**
   * EXCLUSIONS OF EVERY KIND, which is what the cell above them is labelled.
   *
   * It used to be `excludedShifts` alone. A worker with hours and no rate is not a shift, so
   * the one cell whose entire purpose is to name what is missing read „Nicht gezählt 0" on a
   * screen that was 810,30 € short — the reassuring number in the large type, the truth in
   * the small print under it. The count is now the count of things left out; the sub-line
   * says which are shifts and which are people, in the same words the rows use.
   *
   * `noRateLines.length` and not „people with hours and no rate": it is the SAME number the
   * caveat bullet and the CSV's total note already carry, and three counts of one condition
   * is how a screen and the file the accountant keeps come to disagree again.
   */
  const excludedCount = excludedShifts + noRateLines.length
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
          /* NOT OFFERED WHILE SCOPED. A CSV named `payroll-2026-07.csv` that silently holds
             one building's hours is indistinguishable from a complete payroll run in the
             folder the accountant keeps, and the file outlives the screen that explained
             it. The reason is stated below, next to the filter that caused it. */
          totals !== null && totals.lines.length > 0 && !scoped ? (
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

      {/* The filter, echoed and removable (decision-38 rule 3). On the payroll screen this
          is not a nicety: a scoped total under the heading „Auszuzahlen" that does not say
          it is scoped is a wrong number about somebody's wages. */}
      <FilterChips
        chips={[
          filters.location === null
            ? null
            : {
                key: 'location',
                label: tFilter('location'),
                value: scopedLocationName ?? tFilter('unknownLocation'),
                unknown: snapshot !== null && scopedLocationName === null,
                onRemove: () => setFilters({ location: null }, 'replace'),
              },
          filters.worker === null
            ? null
            : {
                key: 'worker',
                label: tFilter('worker'),
                value: scopedWorkerName ?? tFilter('unknownWorker'),
                unknown: snapshot !== null && scopedWorkerName === null,
                onRemove: () => setFilters({ worker: null }, 'replace'),
              },
        ].filter((chip) => chip !== null)}
      />

      {/* What a scope DOES to this screen, in words, next to the number it changed. */}
      {scoped && snapshot !== null ? (
        <div className="note bad">
          {scopedLocationName === null ? null : (
            <p>
              {t('scopedLocation', { name: scopedLocationName })}{' '}
              <Link href={filterHref(HOME_PATH, { location: filters.location })}>
                {t('scopedBuildingLink')}
              </Link>
            </p>
          )}
          {scopedWorkerName === null ? null : (
            <p>
              {t('scopedWorker', { name: scopedWorkerName })}{' '}
              <Link href={filterHref(WORKERS_PATH, { worker: filters.worker })}>
                {t('openWorker')}
              </Link>
            </p>
          )}
          <p>{t('scopedNote')}</p>
        </div>
      ) : null}

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
              // The hours are complete and the amount beside them is not. That difference
              // is stated HERE, on the cell that is too big for the money next to it.
              sub: [
                t('answerHoursSub'),
                noRateMs > 0 ? t('answerHoursUnvalued', { hours: hours(noRateMs) }) : null,
              ]
                .filter((part) => part !== null)
                .join(' · '),
            },
            { k: t('answerWorkers'), v: totals.lines.length, calm: true },
            {
              k: t('answerExcluded'),
              // EVERYTHING left out of the amount above, counted: shifts that block payroll
              // (decision-10) AND people whose hours carry no rate. It counted only the
              // shifts, and therefore said „0" while a real wage was missing from the total.
              v: excludedCount,
              calm: excludedCount === 0,
              // The SAME plural-correct strings the rows use, joined the same way — a second
              // phrasing of the same count is a second thing to keep in step. The shift
              // clause is ALWAYS first, including its „nothing" branch: the count above is a
              // count of two different nouns, so the breakdown may never be silent about
              // either of them.
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

      {snapshot === null || totals === null || coverage === null ? (
        <p role="status">{t('loading')}</p>
      ) : (
        <>
          {/* THE TOTAL MAY BE WRONG, not merely incomplete. Two sentences, above everything,
              and neither of them is ever a tooltip or a hover. */}
          {incomplete || (reconciliation !== null && reconciliation.missingCents !== 0) ? (
            <div className="note bad">
              {incomplete && coverage.earliestStart !== null ? (
                <p>
                  {t('caveatTruncated', {
                    limit: snapshot.shift_limit,
                    earliest: monthDayFormat.format(new Date(coverage.earliestStart)),
                  })}
                </p>
              ) : null}
              {reconciliation !== null && reconciliation.missingCents !== 0 ? (
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
              {/* EVERY caveat link now carries THIS screen's period and the condition it is
                  about. It used to point at a bare `/shifts/`, which opens on the last 30
                  days while payroll runs last month: the three shifts named here were
                  routinely not on the screen the sentence sent the director to. */}
              {totals.unresolvedShifts > 0 ? (
                <li>
                  {t('caveatUnresolved', { count: totals.unresolvedShifts })}{' '}
                  <Link
                    href={filterHref(SHIFTS_PATH, {
                      period,
                      state: 'unresolved',
                      location: filters.location,
                      worker: filters.worker,
                    })}
                  >
                    {t('caveatUnresolvedLink')}
                  </Link>
                </li>
              ) : null}
              {totals.openShifts > 0 ? (
                <li>
                  {t('caveatOpen', { count: totals.openShifts })}{' '}
                  <Link
                    href={filterHref(SHIFTS_PATH, {
                      period,
                      state: 'open',
                      location: filters.location,
                      worker: filters.worker,
                    })}
                  >
                    {t('caveatOpenLink')}
                  </Link>
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
                  <Link
                    href={
                      // One unpriced person → straight to their panel, where the rate is.
                      // Several → the roster, unfiltered: there is no „no rate" state in the
                      // vocabulary and inventing one for a single link would be a parameter
                      // only this screen writes and only that screen reads.
                      noRateLines.length === 1 && noRateLines[0] !== undefined
                        ? filterHref(WORKERS_PATH, { worker: noRateLines[0].worker.id })
                        : WORKERS_PATH
                    }
                  >
                    {t('caveatNoRateLink')}
                  </Link>
                </li>
              ) : null}
              {/* The row list is capped; the server aggregate is not. The failing branch is
                  in the warning above, and the reconciled branch is stated here, because
                  silence would read as "not checked". */}
              {reconciliation !== null && reconciliation.missingCents === 0 ? (
                <li>{t('caveatReconcileOk')}</li>
              ) : null}
              {/* NOT COMPUTED is a third answer and it is not silence. While a scope is on,
                  saying „nichts fehlt" would be a claim nobody checked. */}
              {reconciliation === null ? <li>{t('scopedNote')}</li> : null}
              {/* Paid, not excluded — but a payslip dispute has to be able to find the
                  hours that no tag stands behind. Same fact the shift log shows in its
                  "how it was recorded" column, and a column in the CSV. */}
              {totals.manualShifts > 0 ? (
                <li>
                  {t('caveatManual', { count: totals.manualShifts })}{' '}
                  <Link
                    href={filterHref(SHIFTS_PATH, {
                      period,
                      state: 'manual',
                      location: filters.location,
                      worker: filters.worker,
                    })}
                  >
                    {t('caveatManualLink')}
                  </Link>
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
                        {/* The name opens that person's panel, where their rate, their open
                            shift and their unconfirmed ones are. Reading a name off this
                            table and hunting for it on `/workers/` was the loop. */}
                        <th scope="row">
                          <Link href={filterHref(WORKERS_PATH, { worker: line.worker.id })}>
                            {line.worker.name}
                            <span className="visually-hidden"> {t('openWorker')}</span>
                          </Link>
                        </th>
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
                        {/* Same string the CSV's last column carries, from the same
                            function: two spellings of one exclusion is how a screen and an
                            export drift apart again. */}
                        <td>
                          {!noRate && line.unresolvedShifts === 0 && line.openShifts === 0 ? (
                            <span className="cell-muted">{exclusionNote(line)}</span>
                          ) : (
                            exclusionNote(line)
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
            The two standing limitations. Collapsible and under the table, never hover-only:
            they are true in every period, and they may not be deleted to make the screen
            lighter. They now ship CLOSED — the only change is disclosure, not content. Open
            they put the prose this redesign removed from the top of the screen back at the
            bottom of it, which is why /payroll/ came out at +1% instead of lighter
            (REDESIGN-VISUAL.md D8). Nothing above this line folds: the reconciliation
            sentence and the counted, named exclusions stay in view, always.
          */}
          <details className="callout">
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
