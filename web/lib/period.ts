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
