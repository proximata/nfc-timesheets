'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useFormatter, useLocale, useTranslations } from 'next-intl'
import { type FormEvent, useCallback, useEffect, useId, useMemo, useState } from 'react'
import { AnswerBand } from '@/components/AnswerBand'
import { ConfirmModal } from '@/components/ConfirmModal'
import { Drawer } from '@/components/Drawer'
import { EmptyState } from '@/components/EmptyState'
import { Field } from '@/components/Field'
import { FilterChips } from '@/components/FilterChips'
import { ListPanel } from '@/components/ListPanel'
import { PageHeader } from '@/components/PageHeader'
import {
  ApiError,
  clearSetting,
  fetchPl,
  fetchRevenue,
  isClosedRange,
  MARGIN_BASELINE_KEY,
  type PlBuilding,
  type PlReport,
  type RevenueGrid,
  retractRevenue,
  saveRevenue,
  saveSetting,
} from '@/lib/api'
import { filterHref, useFilters } from '@/lib/filters'
import { type ErrorKey, htmlLang, isLocale } from '@/lib/locale'
import { centsToPlainEuros, parseEuroToCents } from '@/lib/money'
import { LOGIN_PATH } from '@/lib/nav'
import {
  futureDays,
  isPartElapsed,
  isPeriod,
  PAYROLL_PERIODS,
  type Period,
  periodRange,
} from '@/lib/period'
import {
  bpToPlainPercent,
  bpToRatio,
  parsePercentToBp,
  plTotals,
  shareBp,
  shortfallBp,
} from '@/lib/pl'
import { formatDuration } from '@/lib/shifts'

/**
 * Profit and loss per building: revenue − labour − materials, for one period.
 *
 * „Verdienen wir an diesem Objekt?" — answered by the band, argued by the flagged blocks,
 * evidenced by the table, and qualified by the methodology under it.
 *
 * EVERY NUMBER HERE COMES FROM THE SERVER'S SQL (`GET /admin/pl`), not from arithmetic in
 * this file. `/admin/data` caps shift rows at 2000, so a browser-side aggregate would
 * silently report a smaller month than actually happened — and a P&L that can quietly be
 * wrong is worse than no P&L. What this file adds is a totals row over the buildings it
 * was given, and the words.
 *
 * THE THREE THINGS THIS SCREEN WILL NOT DO:
 *
 * 1. Show a confident zero for something nobody knows. A building nobody has typed a
 *    payment for has `revenue_cents: null` and renders as "nicht eingetragen", never as
 *    EUR 0.00 — a zero would report it as a total loss and flag it for a conversation with
 *    a client who is paying perfectly well. A TYPED 0 is a different thing entirely and is
 *    shown as 0,00 EUR: that client really did pay nothing this month.
 * 1b. Slice a payment. Revenue is a TYPED MONTHLY FACT (decision-42), so the report covers
 *    the whole Vienna months the period FULLY CONTAINS and names the partial ones as
 *    excluded. A ragged period gets no margin at all, `period_not_month_aligned`. The old
 *    daily accrual off the contract — careful arithmetic about a number nobody received —
 *    is gone, and with it the inflated-margin case that made "Dieses Jahr" picked in August
 *    report 71,33 % beside the 10,70 % the last closed month actually made.
 * 1c. THE COST SIDE'S "no rate" CASE IS GONE, AND ITS COPY WENT WITH IT. decision-41 made a
 *    wage of 0 unrepresentable, so `labour_seconds` and `labour_cents` describe the same
 *    seconds and there is nothing left to disclaim. `rate_basis: 'current'` is a DIFFERENT,
 *    still-true limitation and it stays in the method block: there is still no rate
 *    history, so raising a wage still re-values last March.
 * 2. Treat "not assessable" as a pass. `below_baseline` is TRUE, FALSE **or NULL**, and
 *    null means the margin or the baseline is unknown. It gets its own words.
 * 3. Invent the baseline. `pl_margin_baseline_bp` ships UNSET and nothing defaults it. With
 *    it unset no building is flagged and the screen says so, because this codebase has no
 *    basis for an opinion about what a Viennese cleaning contract ought to earn. Setting it
 *    is a control on this page, and unsetting it is too — an invented threshold would end up
 *    in a real conversation about revising a client's contract.
 *
 * A FLAG IS NOT A RED DOT. The director has to be able to argue the case to a client, so
 * every flagged building gets a paragraph naming the margin, the floor, the shortfall, and
 * where the money went — including the hours that were deliberately NOT counted
 * (decision-10), because a building looks cheap precisely while those are outstanding. Those
 * paragraphs stay paragraphs. Compressing them into a badge was never on the table.
 *
 * ONE WRITE: the baseline, in a drawer. Its result is announced in the PAGE's live region,
 * because Escape closes a drawer at any moment and a message that leaves with the overlay
 * reporting it has not been read.
 */

const MATERIALS_PATH = '/material-requests/'
const CONTRACTS_PATH = '/contracts/'
const SHIFTS_PATH = '/shifts/'
/** Where a building is created. The empty state names that action, so it links to it. */
const BUILDINGS_PATH = '/locations/'
/** The building's object surface. `/?location=<uuid>` — there is no `/locations/<id>`. */
const HOME_PATH = '/'

export default function PlPage() {
  const t = useTranslations('pl')
  const tFilter = useTranslations('filters')
  const tError = useTranslations('error')
  const format = useFormatter()
  const locale = useLocale()
  const router = useRouter()

  const periodId = useId()
  const baselineId = useId()
  const revenueAmountId = useId()
  const revenueNoteId = useId()

  /**
   * Austrian month names. next-intl is handed the message-file key ('de'), whose Intl
   * resolution says "Januar"; this director says "Jänner". Same trick and same reason as
   * /payroll/ and /reinigung/. The zone is pinned so a period boundary reads as the day the
   * director would name, not the day the browser's zone would.
   */
  const dayFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(htmlLang(isLocale(locale) ? locale : 'de'), {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'Europe/Vienna',
      }),
    [locale],
  )
  /** „September 2026“ — the heading a typed monthly payment belongs under. */
  const monthFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(htmlLang(isLocale(locale) ? locale : 'de'), {
        month: 'long',
        year: 'numeric',
        timeZone: 'Europe/Vienna',
      }),
    [locale],
  )
  /** „03.09.“ — provenance, where the year is already in the row's month heading. */
  const shortDayFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(htmlLang(isLocale(locale) ? locale : 'de'), {
        day: '2-digit',
        month: '2-digit',
        timeZone: 'Europe/Vienna',
      }),
    [locale],
  )

  const [report, setReport] = useState<PlReport | null>(null)
  const [loadError, setLoadError] = useState<ErrorKey | null>(null)
  /**
   * `?location=` narrows the report to one building; `?period=` is read so the object
   * panel's „Ergebnis dieses Objekts · Vormonat" opens in the month its own label named
   * (decision-38). The URL is the period — no second copy in state.
   */
  const [filters, setFilters] = useFilters()
  /** The month that has ENDED is the one a P&L is run for. Same vocabulary as /payroll/. */
  const period: Period =
    filters.period !== null && filters.period !== 'all' ? filters.period : 'lastMonth'
  const setPeriod = (next: Period) => setFilters({ period: next }, 'replace')
  // Frozen at mount: "this month" must not change meaning halfway through a re-render.
  const [now] = useState(() => new Date())
  const range = useMemo(() => periodRange(period, now), [period, now])
  /**
   * The period has not finished. It no longer inflates REVENUE — decision-42 deleted the
   * daily accrual, and an unentered month is null rather than a growing fraction — but the
   * COST side still only contains days that have happened. So a figure typed for a month
   * that is still running is compared against part of its own labour, and the margin that
   * comes out is too high by an amount nothing here can know. Said twice: in the method
   * block, which argues it, and beside the margin, which is read alone.
   */
  const stillRunning = isPartElapsed(range, now)
  const unhappenedDays = futureDays(range, now)

  const [baselineOpen, setBaselineOpen] = useState(false)
  const [baselineDraft, setBaselineDraft] = useState('')
  const [baselineError, setBaselineError] = useState(false)
  const [baselineNotice, setBaselineNotice] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  /* --- the revenue ledger (decision-42) ------------------------------------------------
   *
   * A SECOND REQUEST, deliberately. `GET /admin/pl` reports the SUM per building over the
   * period; `GET /admin/revenue` returns the individual months, their provenance and the
   * contract suggestion. Deriving the grid from the P&L would mean a period of three months
   * showing one editable number per building, and the director types one month at a time.
   */
  const [grid, setGrid] = useState<RevenueGrid | null>(null)
  /** null = the entry drawer is closed. */
  const [entry, setEntry] = useState<{
    locationId: string
    building: string
    month: string
    amount: string
    note: string
  } | null>(null)
  const [entryError, setEntryError] = useState<'amountInvalid' | 'rejected' | null>(null)
  /** The building-month waiting for a yes/no before its figure goes back to UNKNOWN. */
  const [pendingRetract, setPendingRetract] = useState<{
    locationId: string
    building: string
    month: string
  } | null>(null)

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

  const load = useCallback(
    async (signal?: AbortSignal) => {
      // PAYROLL_PERIODS excludes 'all', so both ends are always set. The guard exists so a
      // future open-ended period cannot silently send `?from=&to=` and get a 400 the
      // screen would report as a server fault.
      if (!isClosedRange(range)) {
        setLoadError('request')
        return
      }
      try {
        // Both, in parallel, and both replaced together: a report from the new period
        // beside a ledger from the old one is two periods on one screen.
        const [next, nextGrid] = await Promise.all([
          fetchPl(range, signal),
          fetchRevenue(range, signal),
        ])
        setReport(next)
        setGrid(nextGrid)
        setBaselineDraft(
          next.baseline_margin_bp === null ? '' : bpToPlainPercent(next.baseline_margin_bp),
        )
        setLoadError(null)
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === 'AbortError') return
        if (handleAuthLoss(cause)) return
        setLoadError(cause instanceof ApiError ? cause.messageKey : 'server')
      }
    },
    [handleAuthLoss, range],
  )

  useEffect(() => {
    const controller = new AbortController()
    // The payload IS the period. Clearing first stops the previous period's rows sitting
    // under the new period's heading while the request is in flight.
    setReport(null)
    setGrid(null)
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  async function submitBaseline(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const bp = parsePercentToBp(baselineDraft)
    if (bp === null) {
      setBaselineError(true)
      setBaselineNotice(null)
      return
    }
    setBaselineError(false)
    setBusy(true)
    try {
      await saveSetting(MARGIN_BASELINE_KEY, bp)
      setBaselineNotice({
        ok: true,
        text: t('baselineSaved', {
          percent: format.number(bpToRatio(bp), { style: 'percent', minimumFractionDigits: 2 }),
        }),
      })
      // Closed on success: the drawer had one job and it is done. The outcome is announced
      // in the page's live region, which is still on screen after the close.
      setBaselineOpen(false)
      await load()
    } catch (cause) {
      if (!handleAuthLoss(cause)) setBaselineNotice({ ok: false, text: t('baselineFailed') })
    } finally {
      setBusy(false)
    }
  }

  async function removeBaseline() {
    if (busy) return
    setBusy(true)
    setBaselineError(false)
    try {
      await clearSetting(MARGIN_BASELINE_KEY)
      setBaselineNotice({ ok: true, text: t('baselineCleared') })
      setBaselineOpen(false)
      await load()
    } catch (cause) {
      if (!handleAuthLoss(cause)) setBaselineNotice({ ok: false, text: t('baselineFailed') })
    } finally {
      setBusy(false)
    }
  }

  /**
   * File, or CORRECT, one building-month. A correction is an INSERT server-side, so the
   * previous figure survives and this screen keeps printing what it used to be.
   *
   * Euros as typed -> integer cents by string slicing (lib/money.ts). No float multiply
   * anywhere near a number that ends up in a report about a client's payments.
   */
  async function submitRevenue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || entry === null) return
    const cents = parseEuroToCents(entry.amount)
    // 0 IS ACCEPTED and is not the empty field: "they paid nothing this month" is a real
    // answer. An EMPTY field is not an entry at all, which is why it fails here rather
    // than being sent as 0.
    if (cents === null) {
      setEntryError('amountInvalid')
      return
    }
    setEntryError(null)
    setBusy(true)
    try {
      await saveRevenue(entry.locationId, entry.month, cents, entry.note.trim())
      setBaselineNotice({
        ok: true,
        text: t('revenueSaved', { building: entry.building, month: monthLabel(entry.month) }),
      })
      // Announced by the PAGE: the drawer closes on success and would take its own message
      // with it, unread.
      setEntry(null)
      await load()
    } catch (cause) {
      if (!handleAuthLoss(cause)) setEntryError('rejected')
    } finally {
      setBusy(false)
    }
  }

  /** Back to UNKNOWN. NOT the same as typing 0 — see `retractRevenue` in lib/api.ts. */
  async function retract(target: { locationId: string; building: string; month: string }) {
    if (busy) return
    setBusy(true)
    try {
      await retractRevenue(target.locationId, target.month)
      setBaselineNotice({
        ok: true,
        text: t('revenueRetracted', {
          building: target.building,
          month: monthLabel(target.month),
        }),
      })
      await load()
    } catch (cause) {
      if (!handleAuthLoss(cause)) setBaselineNotice({ ok: false, text: t('revenueFailed') })
    } finally {
      setBusy(false)
    }
  }

  const money = (cents: number) =>
    format.number(cents / 100, { style: 'currency', currency: 'EUR' })
  const percent = (bp: number) =>
    format.number(bpToRatio(bp), { style: 'percent', minimumFractionDigits: 2 })
  /** Basis points as PERCENTAGE POINTS of difference — "8.5 points short", not "8.5%". */
  const points = (bp: number) => format.number(bp / 100, { maximumFractionDigits: 2 })
  /** Square metres. `NUMERIC(8,2)` on the column; divided once, here, for display only. */
  const area = (hundredthsOfSqm: number) =>
    format.number(hundredthsOfSqm, { maximumFractionDigits: 2 })

  /**
   * `2026-09` -> „September 2026“, in Vienna and in Austrian month names.
   *
   * Built from the 15th, not the 1st: the 1st at 00:00 UTC is still the previous month in
   * a zone behind UTC, and a label that names the wrong month above an editable payment is
   * how a figure lands in August that was meant for September.
   */
  const monthLabel = (month: string) => monthFormat.format(new Date(`${month}-15T12:00:00Z`))

  const periodLabel: Record<Period, string> = {
    last30Days: t('periodLast30Days'),
    thisMonth: t('periodThisMonth'),
    lastMonth: t('periodLastMonth'),
    thisQuarter: t('periodThisQuarter'),
    thisYear: t('periodThisYear'),
    all: t('periodAll'),
  }
  const rangeLabel =
    range.from === null || range.to === null
      ? periodLabel[period]
      : t('rangeLabel', {
          from: dayFormat.format(new Date(range.from)),
          // Half-open, so the last day the director cares about is one millisecond back.
          to: dayFormat.format(new Date(new Date(range.to).getTime() - 1)),
        })

  /**
   * `?location=` — one building's row, its flagged argument and a total scoped to it.
   *
   * The totals row is recomputed over the VISIBLE set rather than left whole: a table of one
   * row under a total of six buildings is a screen contradicting itself. `totalScope` already
   * names how many buildings it counted, so the recomputed total says what it is.
   *
   * The methodology callout below is NOT scoped — the material pool, the unpriced counts and
   * the rate basis are period-wide facts, and a scoped copy of them would be a different
   * number wearing the same label. `scopedNote` says so where they are.
   */
  const allBuildings = report?.buildings ?? []
  const scopedBuilding =
    filters.location === null
      ? null
      : (allBuildings.find((b) => b.location_id === filters.location) ?? null)
  const scopeUnknown = filters.location !== null && report !== null && scopedBuilding === null
  const buildings =
    filters.location === null
      ? allBuildings
      : allBuildings.filter((b) => b.location_id === filters.location)

  const totals = report === null ? null : plTotals(buildings)
  const flagged = buildings.filter((b) => b.below_baseline === true)
  // Hoisted out of the JSX: narrowing `report.baseline_margin_bp` inside a `.map()` callback
  // is lost, and the alternative would be a non-null assertion on the one number the whole
  // flagging argument rests on.
  const baselineBp = report?.baseline_margin_bp ?? null

  /** The assessment, in WORDS. Colour is not a signal this screen is allowed to rely on. */
  function assessment(building: PlBuilding): string {
    if (building.below_baseline === true) return t('assessBelow')
    if (building.below_baseline === false) return t('assessOk')
    if (building.margin_unknown_reason === 'period_not_month_aligned') {
      return t('assessNotMonthAligned')
    }
    if (building.margin_unknown_reason === 'revenue_not_entered') return t('assessNotEntered')
    if (building.margin_unknown_reason === 'zero_revenue') return t('assessZeroRevenue')
    return t('assessNoBaseline')
  }

  /**
   * The area line, or the refusal to state one, in the SAME shape as every other refusal
   * here: a reason in words, never a dash and never a number that is really a floor.
   *
   * PER-ZONE COST IS NOT AND WILL NOT BE ON THIS SCREEN (decision-43). A shift is
   * building-level, so no duration is attributable to a zone; splitting a building's labour
   * by area share would assert that time is proportional to floor area, which is false in
   * the obvious direction — a Tiefgarage is fast per m2, an office floor slow.
   */
  function areaNote(building: PlBuilding): string {
    if (building.area_unknown_reason === 'no_zones') return t('areaNoZones')
    if (building.area_unknown_reason === 'area_incomplete') {
      return t('areaIncomplete', { zones: building.zones_unmeasured })
    }
    if (building.building_m2 === null) return t('areaNoZones')
    const parts = [t('areaTotal', { area: area(building.building_m2) })]
    if (building.cost_cents_per_m2 !== null) {
      parts.push(t('areaCostPerM2', { amount: money(building.cost_cents_per_m2) }))
    }
    if (building.revenue_cents_per_m2 !== null) {
      parts.push(t('areaRevenuePerM2', { amount: money(building.revenue_cents_per_m2) }))
    } else if (building.per_m2_unknown_reason === 'not_entered') {
      parts.push(t('areaRevenuePerM2Unknown'))
    }
    return parts.join(' · ')
  }

  /**
   * WHEN a figure was typed, and what it replaced. Empty string when nothing was entered —
   * the cell above it already says „nicht eingetragen“ and a second sentence saying the
   * same thing is noise.
   */
  function provenanceNote(building: PlBuilding): string[] {
    const lines: string[] = []
    if (building.revenue_entered_at !== null) {
      lines.push(
        t('revenueEnteredAt', {
          date: shortDayFormat.format(new Date(building.revenue_entered_at)),
          // The server sends the admin's email. Never a name it does not have.
          who: building.revenue_entered_by ?? t('revenueEnteredByUnknown'),
        }),
      )
    }
    if (building.revenue_changed_at !== null && building.revenue_previous_cents !== null) {
      lines.push(
        t('revenueChangedAt', {
          date: shortDayFormat.format(new Date(building.revenue_changed_at)),
          previous: money(building.revenue_previous_cents),
        }),
      )
    }
    return lines
  }

  /**
   * The argument, not the verdict. Everything a director needs in front of them on the
   * phone to a client: what the building earned, what it cost to clean, in what proportion,
   * and how far short of the floor that lands.
   */
  function reasoning(building: PlBuilding, floorBp: number): string[] {
    const lines: string[] = []
    const labourShare = shareBp(building.labour_cents, building.revenue_cents)
    const materialShare = shareBp(building.material_cents, building.revenue_cents)
    const short = shortfallBp(building.margin_bp, floorBp)

    if (building.margin_bp !== null && short !== null) {
      lines.push(
        t('whyMargin', {
          margin: percent(building.margin_bp),
          baseline: percent(floorBp),
          points: points(short),
        }),
      )
    }
    if (building.revenue_cents !== null) {
      lines.push(
        t('whyRevenue', {
          revenue: money(building.revenue_cents),
          months: building.revenue_months_entered,
        }),
      )
    }
    // A partial sum argued as if it were a total is the fastest way to lose a client
    // conversation. Named here, on the paragraph the director reads out.
    if (building.months_missing_revenue > 0) {
      lines.push(t('whyRevenueMissing', { months: building.months_missing_revenue }))
    }
    lines.push(
      t('whyLabour', {
        labour: money(building.labour_cents),
        hours: formatDuration(building.labour_minutes),
        share: labourShare === null ? t('shareUnknown') : percent(labourShare),
      }),
    )
    lines.push(
      t('whyMaterial', {
        material: money(building.material_cents),
        share: materialShare === null ? t('shareUnknown') : percent(materialShare),
      }),
    )
    // decision-10, stated where it changes the conclusion: those hours are real work that
    // has NOT been charged into this cost, so the true cost is higher than the row shows.
    if (building.excluded_unresolved_shifts > 0) {
      lines.push(
        t('whyExcluded', {
          shifts: building.excluded_unresolved_shifts,
          hours: formatDuration(Math.round(building.excluded_unresolved_seconds / 60)),
        }),
      )
    }
    if (building.open_shifts > 0) lines.push(t('whyOpen', { shifts: building.open_shifts }))
    return lines
  }

  /**
   * ONE ROW PER BUILDING-MONTH, newest month first.
   *
   * Not a month x building matrix: at 390px a matrix is a horizontal scroll with the
   * building names off-screen, and the row-to-card transform (globals.css) turns a flat
   * table into readable cards for free. It is also the shape the ritual has — the director
   * works down September, then down August.
   *
   * Months the period only TOUCHES are listed and are editable, and they say they are not
   * in this report. A payment is a fact about a month, not about the period somebody
   * happened to have selected, and hiding the row would make the figure unreachable from
   * the one screen that asks for it.
   */
  const containedMonths = new Set(report?.revenue.months ?? [])
  const entryOf = new Map(
    (grid?.entries ?? []).map((row) => [`${row.location_id}|${row.month}`, row]),
  )
  const suggestionOf = new Map(
    (grid?.suggestions ?? []).map((row) => [`${row.location_id}|${row.month}`, row.contract_cents]),
  )
  const ledgerRows =
    grid === null
      ? []
      : [...grid.months].reverse().flatMap((month) =>
          buildings.map((building) => ({
            key: `${building.location_id}|${month}`,
            month,
            building,
            entry: entryOf.get(`${building.location_id}|${month}`) ?? null,
            contractCents: suggestionOf.get(`${building.location_id}|${month}`) ?? null,
            inReport: containedMonths.has(month),
          })),
        )

  return (
    <>
      <PageHeader
        title={t('heading')}
        question={t('question')}
        action={
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setBaselineError(false)
              setBaselineOpen(true)
            }}
          >
            {t('baselineOpen')}
          </button>
        }
      />

      {/* The page's live regions: permanently mounted, empty when there is nothing to say,
          and OUTSIDE the drawer that produces the baseline outcome. */}
      <p className="form-error" role="alert">
        {loadError === null ? '' : tError(loadError)}
      </p>
      <p className={baselineNotice?.ok === false ? 'form-error' : 'form-status'} role="status">
        {baselineNotice === null ? '' : baselineNotice.text}
      </p>

      {/* The filter, echoed and removable (decision-38 rule 3). */}
      <FilterChips
        chips={
          filters.location === null
            ? []
            : [
                {
                  key: 'location',
                  label: tFilter('location'),
                  value: scopedBuilding?.name ?? tFilter('unknownLocation'),
                  unknown: scopeUnknown,
                  onRemove: () => setFilters({ location: null }, 'replace'),
                },
              ]
        }
      />
      {scopeUnknown ? <p className="notice bad">{tFilter('unknownNotice')}</p> : null}

      {/* THE RESULT MAY BE MEANINGLESS, not merely absent. Zero recorded hours against real
          typed revenue prices the period as pure profit at a 100% margin — a tap-pipeline
          outage, a truncated payload and a pre-go-live month all draw exactly this picture
          (LOOK.md W1). `labourCents` sums every building unconditionally, priced or not, so
          this fires independently of which buildings happen to have revenue typed. */}
      {report !== null &&
      totals !== null &&
      totals.labourCents === 0 &&
      totals.marginBp !== null ? (
        <p className="note bad">{t('caveatNoHours')}</p>
      ) : null}

      {/* /inventory/ says „Kein Preis hinterlegt" for an item nobody priced, in words, never
          0,00 €. Here the same unpriced requests are pro-rated into every building's
          Material column AS 0,00 € — a real number, not a display choice, that reads as "no
          material was used" rather than "the cost is unknown" (LOOK.md W5). The fact was
          already stated, truthfully, in bullet 6 of 11 of the method list ~1400px down;
          repeated here where the number it changes actually is. */}
      {report !== null && report.materials.unpriced_requests > 0 ? (
        <p className="note bad">
          {t('caveatMaterialUnpriced', { unpriced: report.materials.unpriced_requests })}
        </p>
      ) : null}

      {/* The answer first, above the control that changes it. `flagged` leads because it is
          the only cell that asks for something; everything else here is context. */}
      {report === null || totals === null ? null : (
        <AnswerBand
          cells={[
            {
              k: t('answerFlagged'),
              // A BARE „0" READS AS A CLEAN PASS. When every building is `notAssessable`
              // there is nothing to be a clean pass OF — „6 von 6 nicht beurteilbar" is the
              // whole content of the answer and the numeral 0 above it said the opposite
              // (LOOK.md W4). Still 0 whenever SOME buildings were actually assessed and
              // simply cleared the bar.
              v:
                totals.notAssessable > 0 && totals.notAssessable === buildings.length
                  ? t('answerFlaggedNoneAssessable')
                  : totals.flagged,
              calm:
                totals.flagged === 0 &&
                !(totals.notAssessable > 0 && totals.notAssessable === buildings.length),
              sub:
                totals.notAssessable > 0
                  ? t('totalNotAssessable', { buildings: totals.notAssessable })
                  : t('totalAllAssessed'),
            },
            {
              k: t('answerProfit'),
              v: totals.profitCents === null ? t('profitUnknown') : money(totals.profitCents),
              // The scope caption used to live only on the NEXT tile (Umsatz). A building
              // can carry real labour cost and still be invisible here, whole, because it
              // has no revenue typed — the headline then silently overstates profit
              // (LOOK.md W3). Stated on the tile it changes, not the one next door.
              sub: [
                rangeLabel,
                totals.unpricedBuildings > 0 && totals.costCentsUnpriced > 0
                  ? t('answerProfitScope', {
                      buildings: totals.unpricedBuildings,
                      cost: money(totals.costCentsUnpriced),
                    })
                  : null,
              ]
                .filter((part) => part !== null)
                .join(' · '),
            },
            {
              k: t('answerMargin'),
              v: totals.marginBp === null ? t('marginUnknown') : percent(totals.marginBp),
              // NOT calm while the period is still running: this is the cell the critique
              // caught reporting 99,25 % for a building in its first week.
              calm: !stillRunning,
              sub: [
                baselineBp === null
                  ? t('answerNoBaseline')
                  : t('answerBaseline', { percent: percent(baselineBp) }),
                stillRunning ? t('answerFuture', { days: unhappenedDays }) : null,
              ]
                .filter((part) => part !== null)
                .join(' · '),
            },
            {
              k: t('answerRevenue'),
              // „Nicht eingetragen", NEVER 0,00 € — the same branch the per-building cell
              // below already had, on the cell a director reads FIRST. With no figure typed
              // anywhere (production, day one) this printed a confident 0,00 €, and the
              // sub-line naming the empty scope is a caption, not the number.
              v: totals.revenueCents === null ? t('revenueUnknown') : money(totals.revenueCents),
              // NOT calm while months are missing: this is a PARTIAL SUM wearing the
              // label of a total, and the number that is too small is the one a director
              // would take to mean a bad quarter.
              calm: totals.monthsMissingRevenue === 0,
              sub: [
                t('totalScope', { buildings: buildings.length - totals.unpricedBuildings }),
                totals.monthsMissingRevenue > 0
                  ? t('answerMonthsMissing', { months: totals.monthsMissingRevenue })
                  : null,
              ]
                .filter((part) => part !== null)
                .join(' · '),
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
              // `all` is excluded by PAYROLL_PERIODS and by the API: /admin/pl requires both
              // bounds, because a monthly fee pro-rated over an unbounded period is either
              // infinitely many days or a month nobody asked for.
              if (isPeriod(next) && next !== 'all') setPeriod(next)
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

      {/* A FAILED LOAD MUST NOT GO ON SAYING "loading". This branch is reached whenever the
          page has no data, and a failed fetch leaves it with no data FOR EVER — so with the
          database stopped, the director got a red error line and, beneath it, a permanent
          "Wird geladen …" in brighter and larger type than the error. Two contradicting
          statements at once, the louder of them false. Desaturated it was worse: the failure
          read as the LESS important of the two, which is colour carrying the whole signal
          instead of being the second one. Measured by stopping postgresql on production and
          photographing this screen (ops/break-infra.sh § 2 puts the box in that state).
          Saying it HERE, and not only in the alert banner, is what makes it reachable: on
          /objekte that banner sits ~370px above this table, so a director reading the table
          never saw it at all. */}
      {report === null || totals === null ? (
        <p role="status">{loadError === null ? t('loading') : tError(loadError)}</p>
      ) : (
        <>
          {/* „Nicht gesetzt" is a supported, deliberate state and not a fault. The sentence
              says what FOLLOWS from it rather than leaving the reader to guess, and it stays
              on the page — not in the drawer that sets it. */}
          <p className="note">
            {report.baseline_margin_bp === null
              ? t('baselineUnset')
              : t('baselineCurrent', { percent: percent(report.baseline_margin_bp) })}
          </p>

          {/*
            WHAT THE CLIENT ACTUALLY PAID, typed by a human, one Vienna month at a time
            (decision-42). It sits ABOVE the report because it is the INPUT the report is
            made of: a director who opens this screen at the start of the month types
            September here and then reads the numbers underneath.

            NOTHING HERE WRITES A ROW ON ITS OWN. The contract value travels as a labelled
            SUGGESTION with a button that fills the field, never as a pre-filled value a
            stray Enter could store: auto-filling it is the rejected accrual wearing a
            different hat, and it fabricates a payment a human then reads as confirmed.
          */}
          <ListPanel title={t('revenueHeading')}>
            <div className="list-body">
              <p className="note">{t('revenueIntro')}</p>
              {/* A ragged period cannot have a margin at all, and the reason is a property
                  of the PERIOD, so it is said once here rather than N times in a column. */}
              {report.revenue.month_aligned ? null : (
                <p className="notice bad">
                  {t('revenueNotAligned', {
                    months: report.revenue.partial_months_excluded,
                  })}
                </p>
              )}
            </div>
            {ledgerRows.length === 0 ? (
              <div className="list-body">
                <EmptyState>{t('revenueEmpty')}</EmptyState>
              </div>
            ) : (
              <table className="data-table" aria-busy={busy}>
                <caption className="visually-hidden">{t('revenueTableCaption')}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t('colMonth')}</th>
                    <th scope="col">{t('colBuilding')}</th>
                    <th scope="col" className="col-numeric">
                      {t('colReceived')}
                    </th>
                    <th scope="col" className="col-numeric">
                      {t('colAgreed')}
                    </th>
                    <th scope="col">{t('colEntered')}</th>
                    <th scope="col">{t('colActions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {ledgerRows.map((row) => (
                    <tr key={row.key} className={row.inReport ? undefined : 'is-muted'}>
                      <th scope="row">
                        {monthLabel(row.month)}
                        {row.inReport ? null : (
                          <span className="shift-state-note">{t('revenueMonthOutside')}</span>
                        )}
                      </th>
                      <td>{row.building.name}</td>
                      <td className="col-numeric">
                        {/* NEVER 0,00 EUR for "nobody has typed one". A typed 0 is a
                            different, real answer and renders as 0,00 EUR right here. */}
                        {row.entry === null ? (
                          <span className="cell-muted">{t('revenueNotEntered')}</span>
                        ) : (
                          money(row.entry.amount_cents)
                        )}
                        {row.entry?.note ? (
                          <span className="shift-state-note">{row.entry.note}</span>
                        ) : null}
                      </td>
                      <td className="col-numeric">
                        {row.contractCents === null ? (
                          <span className="cell-muted">{t('revenueNoContract')}</span>
                        ) : (
                          money(row.contractCents)
                        )}
                      </td>
                      <td>
                        {row.entry === null ? (
                          <span className="cell-muted">{t('revenueNeverEntered')}</span>
                        ) : (
                          <>
                            <span>
                              {t('revenueEnteredAt', {
                                date: shortDayFormat.format(new Date(row.entry.entered_at)),
                                who: row.entry.entered_by_email ?? t('revenueEnteredByUnknown'),
                              })}
                            </span>
                            {row.entry.changed_at !== null && row.entry.previous_cents !== null ? (
                              <span className="shift-state-note">
                                {t('revenueChangedAt', {
                                  date: shortDayFormat.format(new Date(row.entry.changed_at)),
                                  previous: money(row.entry.previous_cents),
                                })}
                              </span>
                            ) : null}
                          </>
                        )}
                      </td>
                      <td className="cell-actions">
                        <button
                          type="button"
                          className="btn btn-quiet"
                          disabled={busy}
                          onClick={() => {
                            setEntryError(null)
                            setEntry({
                              locationId: row.building.location_id,
                              building: row.building.name,
                              month: row.month,
                              // An EDIT starts from the stored figure; a NEW entry starts
                              // EMPTY. The contract is offered inside the drawer as a
                              // one-press fill, never as the value already in the field.
                              amount:
                                row.entry === null ? '' : centsToPlainEuros(row.entry.amount_cents),
                              note: row.entry?.note ?? '',
                            })
                          }}
                        >
                          {row.entry === null ? t('revenueEnter') : t('revenueEdit')}
                          <span className="visually-hidden">
                            {t('forBuildingMonth', {
                              name: row.building.name,
                              month: monthLabel(row.month),
                            })}
                          </span>
                        </button>
                        {row.entry === null ? null : (
                          <button
                            type="button"
                            className="btn btn-quiet"
                            disabled={busy}
                            onClick={() =>
                              setPendingRetract({
                                locationId: row.building.location_id,
                                building: row.building.name,
                                month: row.month,
                              })
                            }
                          >
                            {t('revenueRetract')}
                            <span className="visually-hidden">
                              {t('forBuildingMonth', {
                                name: row.building.name,
                                month: monthLabel(row.month),
                              })}
                            </span>
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </ListPanel>

          {/* THE ARGUMENT, before the evidence. A red row is not something a director can
              take to a client; these paragraphs are. */}
          <ListPanel title={t('flaggedHeading')} padded>
            {baselineBp === null ? (
              <EmptyState>{t('flaggedNoBaseline')}</EmptyState>
            ) : flagged.length === 0 ? (
              <EmptyState>
                {t('flaggedNone', { baseline: percent(baselineBp) })}
                {totals.notAssessable > 0
                  ? ` ${t('flaggedNoneCaveat', { buildings: totals.notAssessable })}`
                  : ''}
              </EmptyState>
            ) : (
              flagged.map((building) => (
                <div className="callout" key={building.location_id}>
                  <h3>{t('flaggedFor', { name: building.name })}</h3>
                  <ul>
                    {reasoning(building, baselineBp).map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                  {/* Every link out of a flagged building carries THAT building and THIS
                      period. They used to be bare navigations: the director read a
                      paragraph about Handelskai and landed on an unfiltered contract list. */}
                  <ul className="panel-links">
                    <li>
                      <Link href={filterHref(HOME_PATH, { location: building.location_id })}>
                        {t('flaggedBuildingLink')}
                      </Link>
                    </li>
                    <li>
                      <Link href={filterHref(CONTRACTS_PATH, { location: building.location_id })}>
                        {t('flaggedContractLink')}
                      </Link>
                    </li>
                    <li>
                      {/* L24: that building's shifts, in the month this argument was made
                          about — not „the shifts screen" on its own default period. */}
                      <Link
                        href={filterHref(SHIFTS_PATH, {
                          location: building.location_id,
                          period,
                        })}
                      >
                        {t('flaggedShiftsLink')}
                      </Link>
                    </li>
                    {/* Rule 1: only when this building actually carries material cost. A
                        link to an empty material queue is the „nichts gefunden" landing
                        this contract exists to stop. */}
                    {building.material_cents > 0 ? (
                      <li>
                        <Link
                          href={filterHref(MATERIALS_PATH, {
                            location: building.location_id,
                            status: 'all',
                          })}
                        >
                          {t('flaggedMaterialsLink')}
                        </Link>
                      </li>
                    ) : null}
                  </ul>
                </div>
              ))
            )}
          </ListPanel>

          <ListPanel title={t('resultHeading')}>
            {buildings.length === 0 ? (
              /* Empty is not an error and must not read like one. There is genuinely
                 nothing to report when no building is active and none was worked in — and
                 the hint says
                 „Legen Sie ein Objekt an“, so it carries the link that does it. /analytics/
                 has offered exactly this link from exactly this sentence since it was
                 written; /pl/ is its twin and did not, which is the same day-zero dead end
                 TASK-178 found on the dashboard. */
              <div className="list-body">
                <EmptyState>
                  {t('emptyBody')} {t('emptyHint')}{' '}
                  <Link href={BUILDINGS_PATH}>{t('emptyLink')}</Link>
                </EmptyState>
              </div>
            ) : (
              <table className="data-table">
                <caption className="visually-hidden">
                  {t('tableCaption', { period: rangeLabel })}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">{t('colBuilding')}</th>
                    <th scope="col">{t('colClient')}</th>
                    <th scope="col" className="col-numeric">
                      {t('colRevenue')}
                    </th>
                    <th scope="col" className="col-numeric">
                      {t('colLabour')}
                    </th>
                    <th scope="col" className="col-numeric">
                      {t('colMaterial')}
                    </th>
                    <th scope="col" className="col-numeric">
                      {t('colProfit')}
                    </th>
                    <th scope="col" className="col-numeric">
                      {t('colMargin')}
                    </th>
                    <th scope="col">{t('colAssessment')}</th>
                  </tr>
                </thead>
                <tbody>
                  {buildings.map((building) => (
                    <tr
                      key={building.location_id}
                      className={
                        building.below_baseline === true
                          ? 'is-unres'
                          : building.active
                            ? undefined
                            : 'is-muted'
                      }
                    >
                      <th scope="row">
                        {/* The name opens the building's panel, carrying its id. */}
                        <Link href={filterHref(HOME_PATH, { location: building.location_id })}>
                          {building.name}
                          <span className="visually-hidden"> {t('flaggedBuildingLink')}</span>
                        </Link>
                        {building.active ? null : (
                          <span className="shift-state-note">{t('buildingInactive')}</span>
                        )}
                        {building.excluded_unresolved_shifts > 0 ? (
                          <span className="shift-state-note">
                            {t('rowExcluded', {
                              shifts: building.excluded_unresolved_shifts,
                            })}
                          </span>
                        ) : null}
                        {/* AREA AND EUR/m2 — the denominator a director quotes a NEW
                            building from, which is the whole payoff of zones. Never a
                            per-ZONE cost: a shift is building-level, so no duration is
                            attributable to a zone (decision-43). The refusal cases carry
                            words, not a dash. */}
                        <span className="shift-state-note num">{areaNote(building)}</span>
                      </th>
                      <td>
                        {building.client_name ?? (
                          <span className="cell-muted">{t('noClient')}</span>
                        )}
                      </td>
                      <td className="col-numeric">
                        {/* „Nicht eingetragen“, NEVER 0,00 EUR. A typed 0 is a different,
                            real answer — "they paid nothing this month" — and it renders
                            as 0,00 EUR through the same branch as any other figure. */}
                        {building.revenue_cents === null ? (
                          <span className="cell-muted">{t('revenueUnknown')}</span>
                        ) : (
                          <>
                            {money(building.revenue_cents)}
                            {/* A partial sum must not be read as a total. */}
                            {building.months_missing_revenue > 0 ? (
                              <span className="shift-state-note">
                                {t('revenuePartialMonths', {
                                  months: building.months_missing_revenue,
                                })}
                              </span>
                            ) : null}
                          </>
                        )}
                        {/* „vereinbart“ beside „erhalten“: the question the contract /
                            revenue split buys, named on the row rather than absorbed into
                            the margin. */}
                        {building.contract_cents === null ? null : (
                          <span className="shift-state-note">
                            {t('revenueAgreed', { amount: money(building.contract_cents) })}
                          </span>
                        )}
                        {provenanceNote(building).map((line) => (
                          <span className="shift-state-note" key={line}>
                            {line}
                          </span>
                        ))}
                      </td>
                      <td className="col-numeric">
                        {/* Every payable second carries a rate (decision-41), so this is
                            always an amount and never a refusal. The old „Betrag wird
                            nicht berechnet“ branch described a state the schema no longer
                            admits. */}
                        {money(building.labour_cents)}
                        <span className="shift-state-note">
                          {t('labourHours', {
                            hours: formatDuration(building.labour_minutes),
                          })}
                        </span>
                      </td>
                      <td className="col-numeric">{money(building.material_cents)}</td>
                      <td className="col-numeric">
                        {building.profit_cents === null ? (
                          <span className="cell-muted">{t('profitUnknown')}</span>
                        ) : (
                          money(building.profit_cents)
                        )}
                      </td>
                      <td className="col-numeric">
                        {building.margin_bp === null ? (
                          <span className="cell-muted">{t('marginUnknown')}</span>
                        ) : (
                          percent(building.margin_bp)
                        )}
                      </td>
                      <td>{assessment(building)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row">
                      {t('totalLabel')}
                      <span className="shift-state-note">
                        {t('totalScope', {
                          buildings: buildings.length - totals.unpricedBuildings,
                        })}
                      </span>
                    </th>
                    <td />
                    {/* All three are sums over the PRICED buildings only, so all three are
                        refusals when that subset is empty. A „Gesamt" row reading 0,00 € of
                        labour above six rows that each show real labour is not a small
                        number, it is a wrong one. */}
                    <td className="col-numeric">
                      {totals.revenueCents === null ? (
                        <span className="cell-muted">{t('revenueUnknown')}</span>
                      ) : (
                        money(totals.revenueCents)
                      )}
                    </td>
                    <td className="col-numeric">
                      {totals.labourCentsPriced === null ? (
                        <span className="cell-muted">{t('totalNoPricedBuildings')}</span>
                      ) : (
                        money(totals.labourCentsPriced)
                      )}
                    </td>
                    <td className="col-numeric">
                      {totals.materialCentsPriced === null ? (
                        <span className="cell-muted">{t('totalNoPricedBuildings')}</span>
                      ) : (
                        money(totals.materialCentsPriced)
                      )}
                    </td>
                    <td className="col-numeric">
                      {totals.profitCents === null ? (
                        <span className="cell-muted">{t('profitUnknown')}</span>
                      ) : (
                        money(totals.profitCents)
                      )}
                    </td>
                    <td className="col-numeric">
                      {totals.marginBp === null ? (
                        <span className="cell-muted">{t('marginUnknown')}</span>
                      ) : (
                        percent(totals.marginBp)
                      )}
                    </td>
                    <td>
                      {totals.notAssessable > 0
                        ? t('totalNotAssessable', { buildings: totals.notAssessable })
                        : t('totalAllAssessed')}
                    </td>
                  </tr>
                </tfoot>
              </table>
            )}
          </ListPanel>

          {/* Standing methodology. Every line is something a reader would otherwise
              reasonably assume the opposite of, and all of them change what the numbers
              mean. Permanently visible — never a tooltip, never behind a hover. It moved
              BELOW the table in the redesign and got smaller. It did not lose a line. */}
          <div className="callout">
            <h3>{t('methodHeading')}</h3>
            <ul>
              {/* The pool, the unpriced counts and the rate basis are PERIOD-wide facts.
                  They are not re-scoped when one building is selected, and pretending they
                  were would be a different number under the same label. */}
              {filters.location === null ? null : <li>{t('scopedNote')}</li>}
              {/* The old lede's second sentence: every number on this page is the server's
                  SQL over exactly the chosen days. The lede is gone, the fact is not. */}
              <li>{t('intro')}</li>
              {/* THE PERIOD'S SHAPE decides whether a margin is answerable at all
                  (decision-42). Whole Vienna months only: a typed payment cannot be sliced,
                  so a ragged period reports the months it fully contains, names the partial
                  ones, and refuses every margin rather than approximating one. */}
              <li>
                {report.revenue.month_aligned
                  ? t('methodMonths', { months: report.revenue.months_contained })
                  : t('methodMonthsRagged', {
                      months: report.revenue.months_contained,
                      excluded: report.revenue.partial_months_excluded,
                    })}
              </li>
              {totals.monthsMissingRevenue > 0 ? (
                <li>{t('methodMonthsMissing', { months: totals.monthsMissingRevenue })}</li>
              ) : null}
              {/* The period covers more than has happened. Revenue no longer accrues into
                  it — that was the accrual decision-42 deleted — but the COST side still
                  only contains days that exist, so a figure typed early flatters. */}
              {stillRunning ? (
                <li>
                  {t('methodFuture', {
                    days: unhappenedDays,
                    periodDays: report.period_days,
                  })}
                </li>
              ) : null}
              {/* decision-28 / the API's `labour.rate_basis`. Rendered from OUR messages
                  rather than the server's `rate_basis_note`, which is German-only and
                  would sit untranslated on the English locale. */}
              <li>
                {report.labour.rate_basis === 'current'
                  ? t('methodRates')
                  : t('methodRatesUnknown')}
              </li>
              <li>{t('methodMaterials')}</li>
              <li>
                {t('methodMaterialPool', {
                  pool: money(report.materials.pool_cents),
                  priced: report.materials.priced_requests,
                })}
              </li>
              {report.materials.unpriced_requests > 0 ? (
                <li>
                  {t('methodUnpriced', { unpriced: report.materials.unpriced_requests })}{' '}
                  <Link href={MATERIALS_PATH}>{t('methodUnpricedLink')}</Link>
                </li>
              ) : null}
              {report.materials.unallocated_cents > 0 ? (
                <li>
                  {t('methodUnallocated', {
                    amount: money(report.materials.unallocated_cents),
                  })}
                </li>
              ) : null}
              <li>{t('methodExclusions')}</li>
              {/* The cost side's "nobody priced this" case is GONE, not hidden: a wage of 0
                  is unrepresentable (decision-41), so every payable second carries an
                  amount. `methodRates` above is the limitation that SURVIVED it, and it is
                  a different one — there is still no rate history. */}
              {totals.unpricedBuildings > 0 ? (
                <li>
                  {t('methodNotEntered', {
                    buildings: totals.unpricedBuildings,
                    cost: money(totals.costCentsUnpriced),
                  })}
                </li>
              ) : null}
              {/* PRESENTATION, said as such. An unzoned building's tag resolves and its
                  numbers are exactly as real as anyone else's; what it cannot answer is
                  EUR/m2, and that is the only claim made here. */}
              {totals.unzonedBuildings > 0 ? (
                <li>
                  {t('methodUnzoned', { buildings: totals.unzonedBuildings })}{' '}
                  <Link href={BUILDINGS_PATH}>{t('methodUnzonedLink')}</Link>
                </li>
              ) : null}
              <li>{t('methodPerZoneRefused')}</li>
              <li>{t('attributionHint')}</li>
            </ul>
          </div>
        </>
      )}

      {/*
        THE ONE WRITE. Configurable, clearable, and never defaulted: an invented threshold
        would end up in a real conversation about revising a client's contract.
      */}
      <Drawer
        open={baselineOpen}
        onClose={() => setBaselineOpen(false)}
        title={t('baselineHeading')}
        busy={busy}
        footer={
          <>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setBaselineOpen(false)}
              disabled={busy}
            >
              {t('cancel')}
            </button>
            <button
              type="submit"
              form="pl-baseline-form"
              className="btn btn-primary"
              disabled={busy}
            >
              {busy ? t('submitting') : t('baselineSubmit')}
            </button>
          </>
        }
      >
        <p>{t('baselineIntro')}</p>
        {/* The form is in the body and the submit button is in the footer, joined by `form=`
            rather than by a click handler: Enter in the field must save, exactly as it did
            when the form was inline on the page. */}
        <form id="pl-baseline-form" onSubmit={submitBaseline} noValidate>
          <Field
            id={baselineId}
            label={t('fieldBaseline')}
            help={t('baselineHint')}
            error={baselineError ? t('errorBaselineInvalid') : undefined}
          >
            <input
              type="text"
              inputMode="decimal"
              value={baselineDraft}
              disabled={busy}
              onChange={(event) => setBaselineDraft(event.target.value)}
            />
          </Field>
        </form>
        {/* Clearing is in the BODY, not the footer: three buttons in a drawer footer wrap on
            a 480px drawer and the primary action ends up on its own line. Clearing is also
            reversible — it is re-settable from this same field — so it needs no confirm. */}
        {report?.baseline_set === true ? (
          <p className="form-actions">
            <button
              type="button"
              className="btn btn-quiet"
              disabled={busy}
              onClick={removeBaseline}
            >
              {t('baselineClear')}
            </button>
          </p>
        ) : null}
      </Drawer>

      {/*
        THE SECOND WRITE: what a client actually paid, for ONE named Vienna month.

        One drawer, one building-month. Not a grid of inputs: a screen full of money fields
        saved by one button is a screen where a stray keystroke in row nine is discovered a
        quarter later, and there is no undo for a figure that has already been reported.
      */}
      <Drawer
        open={entry !== null}
        onClose={() => setEntry(null)}
        title={t('revenueDrawerHeading')}
        step={
          entry === null
            ? undefined
            : t('revenueDrawerStep', {
                name: entry.building,
                month: monthLabel(entry.month),
              })
        }
        busy={busy}
        footer={
          <>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setEntry(null)}
              disabled={busy}
            >
              {t('cancel')}
            </button>
            <button
              type="submit"
              form="pl-revenue-form"
              className="btn btn-primary"
              disabled={busy}
            >
              {busy ? t('submitting') : t('revenueSubmit')}
            </button>
          </>
        }
      >
        {entry === null ? null : (
          <>
            <p>{t('revenueDrawerIntro')}</p>
            <form id="pl-revenue-form" onSubmit={submitRevenue} noValidate>
              <p className="form-error" role="alert">
                {entryError === 'amountInvalid'
                  ? t('errorAmountInvalid')
                  : entryError === 'rejected'
                    ? t('errorRevenueRejected')
                    : ''}
              </p>
              <Field
                id={revenueAmountId}
                label={t('fieldAmount')}
                required
                help={t('amountHint')}
                error={entryError === 'amountInvalid' ? t('errorAmountInvalid') : undefined}
              >
                <input
                  type="text"
                  inputMode="decimal"
                  required
                  value={entry.amount}
                  disabled={busy}
                  onChange={(event) => setEntry({ ...entry, amount: event.target.value })}
                />
              </Field>

              {/*
                THE CONTRACT AS A SUGGESTION, AND ONLY AS ONE (decision-42).

                It fills the field on a press and never before. Pre-filling it would put an
                agreed number into a field labelled "received", one Enter away from being
                stored as a payment nobody has seen — which is the accrual this decision
                deleted, rebuilt out of a default value. The button says both figures out
                loud so the act of accepting it is a decision and not a reflex.
              */}
              {(() => {
                const suggestion = suggestionOf.get(`${entry.locationId}|${entry.month}`)
                if (suggestion === undefined) return <p className="note">{t('suggestionNone')}</p>
                return (
                  <div className="note">
                    <p>{t('suggestionExplain', { amount: money(suggestion) })}</p>
                    <p className="form-actions">
                      <button
                        type="button"
                        className="btn btn-quiet"
                        disabled={busy}
                        onClick={() =>
                          setEntry({ ...entry, amount: centsToPlainEuros(suggestion) })
                        }
                      >
                        {t('suggestionApply', { amount: money(suggestion) })}
                      </button>
                    </p>
                  </div>
                )
              })()}

              <Field
                id={revenueNoteId}
                label={t('fieldRevenueNote')}
                optional
                help={t('revenueNoteHint')}
              >
                <input
                  type="text"
                  value={entry.note}
                  maxLength={500}
                  autoComplete="off"
                  disabled={busy}
                  onChange={(event) => setEntry({ ...entry, note: event.target.value })}
                />
              </Field>
            </form>
            <p className="note">{t('revenueAppendOnly')}</p>
          </>
        )}
      </Drawer>

      {/* Retracting is not deleting and it is NOT typing 0: the month goes back to UNKNOWN.
          It is confirmed because the figure it removes has already been read in a report. */}
      <ConfirmModal
        open={pendingRetract !== null}
        onClose={() => setPendingRetract(null)}
        onConfirm={() => {
          const target = pendingRetract
          setPendingRetract(null)
          if (target !== null) void retract(target)
        }}
        title={
          pendingRetract === null
            ? ''
            : t('retractConfirmTitle', {
                name: pendingRetract.building,
                month: monthLabel(pendingRetract.month),
              })
        }
        body={t('retractConfirmBody')}
        confirmLabel={t('revenueRetract')}
        destructive
        busy={busy}
      />
    </>
  )
}
