import { fromBusinessInput, toBusinessInput } from '@/lib/shifts'

/**
 * ONE period vocabulary for the whole admin panel.
 *
 * Before this file there were two: `/shifts/` had open-ended browsing periods ("this month
 * so far") defaulting to the current month, and `/payroll/` had closed calendar periods
 * defaulting to last month. On 3 August 2026, with every recorded shift dated 30 July, that
 * produced EUR 51.18 of July pay next to an empty August shift table on the same afternoon.
 * Two screens that must agree before money moves could not even name the same period.
 *
 * Everything here is a HALF-OPEN `[from, to)` range of UTC instants, because that is what
 * goes on the wire (`GET /admin/data?from=&to=`) and what the server's WHERE clause applies.
 * The boundaries are Vienna wall-clock midnights: the director closes a month against a
 * kitchen calendar, not against UTC, and 1 August 00:00 in Vienna is 31 July 22:00 UTC.
 * Getting that hour wrong at a month end moves a shift onto the wrong payslip.
 *
 * A shift belongs to the period its START falls in. Same rule as `adminData` in
 * server/routes/admin.js; stated in both places on purpose.
 */

/**
 * `last30Days` is FIRST and is the browsing default. A calendar month is the wrong default
 * for a screen whose job is "show me what happened": on the 1st of a month it renders an
 * empty table to a company that worked all of yesterday, which is indistinguishable from
 * data loss. A rolling window always contains yesterday.
 *
 * `all` is a browsing escape hatch, not a pay period — see `PAYROLL_PERIODS`.
 */
export const PERIODS = [
  'last30Days',
  'thisMonth',
  'lastMonth',
  'thisQuarter',
  'thisYear',
  'all',
] as const
export type Period = (typeof PERIODS)[number]

export function isPeriod(value: string): value is Period {
  return (PERIODS as readonly string[]).includes(value)
}

/**
 * What payroll may be run for. `all` is deliberately absent: "everything ever recorded" is
 * not a pay period, and an export named after it would be a payslip nobody can date.
 */
export const PAYROLL_PERIODS = PERIODS.filter((value) => value !== 'all')

/** Half-open `[from, to)` as ISO-8601 UTC instants. `null` = unbounded on that side. */
export type PeriodRange = { from: string | null; to: string | null }

const pad = (value: number) => String(value).padStart(2, '0')

/** The Vienna calendar day an instant falls on. Month is 1-based. */
function businessDay(at: Date): { year: number; month: number; day: number } {
  const text = toBusinessInput(at.toISOString())
  return {
    year: Number(text.slice(0, 4)),
    month: Number(text.slice(5, 7)),
    day: Number(text.slice(8, 10)),
  }
}

/**
 * Vienna wall-clock midnight that STARTS the given calendar day, as a UTC instant.
 *
 * `month` is 1-based and both it and `day` may overflow, so callers can write "one month
 * on" or "29 days back" without their own calendar arithmetic: month 13 is next January,
 * day 0 is the last day of the previous month. The overflow is normalised with `Date.UTC`,
 * which has no daylight saving to get wrong — only the resulting Y-M-D is kept, and it is
 * then read as VIENNA wall time by `fromBusinessInput`, which is where the DST correction
 * happens (and which is what makes 27 October 2024 a 25-hour day rather than a 24-hour one).
 */
export function businessMidnight(year: number, month: number, day: number): string {
  const normalised = new Date(Date.UTC(year, month - 1, day))
  const text = `${normalised.getUTCFullYear()}-${pad(normalised.getUTCMonth() + 1)}-${pad(
    normalised.getUTCDate(),
  )}T00:00`
  const iso = fromBusinessInput(text)
  // Unreachable: Vienna's clock changes at 02:00/03:00, so midnight always exists. Loud
  // rather than silent if that ever stops being true — a guessed boundary lands on a payslip.
  if (iso === null) throw new RangeError(`no Vienna midnight for ${text}`)
  return iso
}

export function periodRange(period: Period, now: Date): PeriodRange {
  const { year, month, day } = businessDay(now)
  const midnight = (y: number, m: number, d: number) => businessMidnight(y, m, d)
  switch (period) {
    case 'last30Days':
      // Ends at TOMORROW's midnight, so today's shifts are inside the window. 30 days
      // inclusive of today, hence day - 29.
      return { from: midnight(year, month, day - 29), to: midnight(year, month, day + 1) }
    case 'thisMonth':
      return { from: midnight(year, month, 1), to: midnight(year, month + 1, 1) }
    case 'lastMonth':
      return { from: midnight(year, month - 1, 1), to: midnight(year, month, 1) }
    case 'thisQuarter': {
      const first = Math.floor((month - 1) / 3) * 3 + 1
      return { from: midnight(year, first, 1), to: midnight(year, first + 3, 1) }
    }
    case 'thisYear':
      return { from: midnight(year, 1, 1), to: midnight(year + 1, 1, 1) }
    case 'all':
      return { from: null, to: null }
  }
}

/**
 * The Vienna calendar day an instant falls on, as a serial number, so that two of them can
 * be SUBTRACTED. Only the Y-M-D survives and it is measured against UTC midnights, which
 * have no daylight saving to get wrong — 27 October is a 25-hour day and still one day.
 */
function dayNumber(at: Date): number {
  const { year, month, day } = businessDay(at)
  return Date.UTC(year, month - 1, day) / 86_400_000
}

/**
 * Has this period NOT FINISHED YET — is its end still ahead of `now`?
 *
 * WHY ANY SCREEN CARES. `thisMonth`, `thisQuarter` and `thisYear` all end at a FUTURE
 * boundary, and the server accrues a monthly contract — both its fee and its target minutes
 * — for every contract-valid day in the range (`contractSlice` in server/lib/reporting.js),
 * with no clipping to today. Work only exists for days that have happened. So for as long as
 * a period is still running, one side of every contract comparison is complete and the other
 * is not: /pl/ books revenue for days nobody has worked and reports a margin that is too
 * high, /analytics/ books target minutes nobody could have worked and reports every building
 * as under its agreed time. In August 2026 that is „Dieses Jahr“ at 71,33 % margin against
 * the 10,70 % that the last CLOSED month actually made.
 *
 * The arithmetic is not corrected here. Clipping the accrual changes numbers that have
 * already been reported and needs its own decision record (TASK-175 says so, and files it
 * separately). What these two functions buy is the SENTENCE — the screens say how much of
 * the period has not happened, and which way that bends the number, in the same vocabulary
 * of stated refusals /pl/ already uses for a missing contract and for unpriced labour.
 *
 * `last30Days` ends at TOMORROW's midnight, so it is „still running“ by less than a day: the
 * whole of today is priced and only the hours worked so far exist. True, and small, and said
 * with the same sentence at a count of zero whole days rather than left unsaid.
 */
export function isPartElapsed(range: PeriodRange, now: Date): boolean {
  return range.to !== null && new Date(range.to).getTime() > now.getTime()
}

/**
 * How many WHOLE Vienna days of this period lie after today — days that have not happened at
 * all, as opposed to today, which has partly happened. Zero for a period that has closed,
 * and zero for one that ends tonight.
 *
 * A period entirely in the future (not reachable from any period in `PERIODS`, but the
 * arithmetic is general) counts its own whole length rather than the days between now and
 * it: `from` clamps the start of the count.
 */
export function futureDays(range: PeriodRange, now: Date): number {
  if (range.to === null) return 0
  const tomorrow = dayNumber(now) + 1
  const first = range.from === null ? tomorrow : Math.max(tomorrow, dayNumber(new Date(range.from)))
  return Math.max(0, dayNumber(new Date(range.to)) - first)
}

/** `?from=&to=`, omitting whichever end is unbounded. Empty string when both are. */
export function rangeQuery(range: PeriodRange): string {
  const parts: string[] = []
  if (range.from !== null) parts.push(`from=${encodeURIComponent(range.from)}`)
  if (range.to !== null) parts.push(`to=${encodeURIComponent(range.to)}`)
  return parts.join('&')
}

/** Does this instant fall inside `[from, to)`? The one membership rule, used everywhere. */
export function withinRange(iso: string, range: PeriodRange): boolean {
  const at = new Date(iso).getTime()
  if (range.from !== null && at < new Date(range.from).getTime()) return false
  if (range.to !== null && at >= new Date(range.to).getTime()) return false
  return true
}

/**
 * The period containing `iso` at month granularity — what the "show me where the data
 * actually is" button jumps to when the chosen period is empty but the ledger is not.
 * A month, not a day: it is a period the screen can already name.
 */
export function periodContaining(iso: string, now: Date): Period {
  for (const period of [
    'last30Days',
    'thisMonth',
    'lastMonth',
    'thisQuarter',
    'thisYear',
  ] as const) {
    if (withinRange(iso, periodRange(period, now))) return period
  }
  return 'all'
}
