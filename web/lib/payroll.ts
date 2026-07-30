import type { HoursRow, Shift, Worker } from '@/lib/api'
import { blocksPayroll, isManualEntry, shiftState } from '@/lib/shifts'

/**
 * Payroll arithmetic. No React, no fetching.
 *
 * Two rules hold everywhere in this file:
 *
 *  1. MONEY IS INTEGER CENTS. Durations are integer milliseconds. Hours only ever exist as
 *     a float for display, never as an intermediate in a money calculation — `14.5 * 0.75`
 *     is fine and `1.005 * 100` is not, and a rate that is a cent out is wrong on every
 *     payslip until somebody notices.
 *  2. THE PERIOD IS DECIDED HERE, NOT BY THE SERVER. `/admin/data` has no `from`/`to`
 *     (see `adminData` in server/routes/admin.js), so its `hours` aggregate is all-time and
 *     cannot be used to pay anybody for a month. It survives here only as a cross-check.
 */

/**
 * Calendar periods, because payroll runs monthly and reporting runs yearly against a wall
 * calendar. Deliberately NOT the `Period` in lib/shifts.ts, which is a browsing filter with
 * an open upper bound ("this month so far, plus anything logged since"); this one is a
 * closed `[start, end)` pay period, and it has a `lastMonth` because that is the one payroll
 * is actually run for.
 */
export const PAYROLL_PERIODS = ['thisMonth', 'lastMonth', 'thisQuarter', 'thisYear'] as const
export type PayrollPeriod = (typeof PAYROLL_PERIODS)[number]

export function isPayrollPeriod(value: string): value is PayrollPeriod {
  return (PAYROLL_PERIODS as readonly string[]).includes(value)
}

/** Half-open `[start, end)` in the BROWSER's local time — Europe/Vienna for this business. */
export type PeriodRange = { start: Date; end: Date }

export function periodRange(period: PayrollPeriod, now: Date): PeriodRange {
  const year = now.getFullYear()
  const month = now.getMonth()
  switch (period) {
    case 'thisMonth':
      return { start: new Date(year, month, 1), end: new Date(year, month + 1, 1) }
    case 'lastMonth':
      return { start: new Date(year, month - 1, 1), end: new Date(year, month, 1) }
    case 'thisQuarter': {
      const first = Math.floor(month / 3) * 3
      return { start: new Date(year, first, 1), end: new Date(year, first + 3, 1) }
    }
    case 'thisYear':
      return { start: new Date(year, 0, 1), end: new Date(year + 1, 0, 1) }
  }
}

/**
 * A shift belongs to the period its START falls in. A shift that runs across midnight on
 * the 31st is therefore paid in the month it began — one rule, applied to every row, and
 * stated on screen so nobody has to reverse-engineer it from a total.
 */
function startsWithin(shift: Shift, range: PeriodRange | null): boolean {
  if (range === null) return true
  const startedAt = new Date(shift.start_time).getTime()
  return startedAt >= range.start.getTime() && startedAt < range.end.getTime()
}

export type PayrollLine = {
  worker: Worker
  /** Payable milliseconds. Integer, summed before any division. */
  payableMs: number
  payableShifts: number
  /** `payableMs` priced at the worker's CURRENT rate. Rounded exactly once, at the end. */
  payCents: number
  /** Excluded from the total above, and why (decision-10). Both link to /shifts/. */
  openShifts: number
  unresolvedShifts: number
  /**
   * How many of `payableShifts` were TYPED IN rather than tapped on a tag (`client_uuid IS
   * NULL` — see `isManualEntry`). These ARE paid; the count is the audit trail.
   *
   * Payroll is where a shift is turned into money and where it is later disputed, so "which
   * of these hours has no tag behind it" has to be answerable from this screen and from the
   * CSV the accountant keeps. Counted, never deducted: a hand-entered shift is a real day
   * worked by someone whose phone died, and refusing to pay it was never the point.
   */
  manualShifts: number
}

export type PayrollTotals = {
  lines: PayrollLine[]
  payableMs: number
  payCents: number
  openShifts: number
  unresolvedShifts: number
  /** Paid shifts in this period that a human typed in. Included in the total above. */
  manualShifts: number
  /**
   * Shift rows whose `worker_id` matches no worker in the payload. Should be structurally
   * impossible — `adminData` inner-joins workers and filters neither list — so it exists
   * only so that a broken assumption shows up as a visible number instead of as money
   * quietly falling out of a total.
   */
  orphanShifts: number
}

/**
 * Per-worker hours and pay for `range` (null = everything supplied).
 *
 * Rounding matches the server's `ROUND(SUM(hours) * hourly_rate_cents)` exactly: sum the
 * whole period first, price it once. Rounding each shift instead would drift by up to half
 * a cent per shift, which is a reconciliation argument nobody wants to have.
 */
export function payrollFor(
  workers: Worker[],
  shifts: Shift[],
  range: PeriodRange | null,
): PayrollTotals {
  const lines = new Map<number, PayrollLine>(
    workers.map((worker) => [
      worker.id,
      {
        worker,
        payableMs: 0,
        payableShifts: 0,
        payCents: 0,
        openShifts: 0,
        unresolvedShifts: 0,
        manualShifts: 0,
      },
    ]),
  )
  let orphanShifts = 0

  for (const shift of shifts) {
    if (!startsWithin(shift, range)) continue
    const line = lines.get(shift.worker_id)
    if (line === undefined) {
      orphanShifts += 1
      continue
    }
    const state = shiftState(shift)
    if (state === 'open') line.openShifts += 1
    else if (state === 'unresolved') line.unresolvedShifts += 1
    // `blocksPayroll` already covers every open shift; the second test is what proves it
    // to the type checker, and it is the same predicate the server's WHERE clause uses.
    if (blocksPayroll(state) || shift.end_time === null) continue
    line.payableMs += new Date(shift.end_time).getTime() - new Date(shift.start_time).getTime()
    line.payableShifts += 1
    // Counted only for shifts that actually reach the total, so the number always answers
    // "how much of what I am about to pay was typed in".
    if (isManualEntry(shift)) line.manualShifts += 1
  }

  const totals: PayrollTotals = {
    lines: [],
    payableMs: 0,
    payCents: 0,
    openShifts: 0,
    unresolvedShifts: 0,
    manualShifts: 0,
    orphanShifts,
  }

  for (const line of lines.values()) {
    // Integer milliseconds x integer cents, divided once. Never `hours * rate`.
    line.payCents = Math.round((line.payableMs * line.worker.hourly_rate_cents) / 3_600_000)
    if (line.payableShifts === 0 && line.openShifts === 0 && line.unresolvedShifts === 0) continue
    totals.lines.push(line)
    totals.payableMs += line.payableMs
    // Summed AFTER per-worker rounding: this is the sum of the amounts actually paid out.
    totals.payCents += line.payCents
    totals.openShifts += line.openShifts
    totals.unresolvedShifts += line.unresolvedShifts
    totals.manualShifts += line.manualShifts
  }

  totals.lines.sort((a, b) => a.worker.name.localeCompare(b.worker.name))
  return totals
}

/** Milliseconds -> hours, for DISPLAY only. Never feed this back into a money calculation. */
export function msToHours(ms: number): number {
  return ms / 3_600_000
}

/**
 * How much of the ledger this browser actually holds.
 *
 * `adminData` returns `ORDER BY start_time DESC LIMIT $1`, so when the row count reaches
 * the limit the payload is the most recent N shifts and everything older is simply absent.
 * A period that begins before `earliestStart` is therefore INCOMPLETE, and a total computed
 * over it is too low. That has to be said out loud, not inferred.
 */
export type Coverage = {
  truncated: boolean
  /** ISO start of the oldest shift in the payload, or null when there are no shifts. */
  earliestStart: string | null
}

export function coverageOf(shifts: Shift[], shiftLimit: number): Coverage {
  return {
    truncated: shifts.length >= shiftLimit,
    earliestStart: shifts.length === 0 ? null : (shifts.at(-1)?.start_time ?? null),
  }
}

/** True when the period reaches back past the oldest row we were given. */
export function periodExceedsCoverage(range: PeriodRange, coverage: Coverage): boolean {
  if (!coverage.truncated || coverage.earliestStart === null) return false
  return range.start.getTime() < new Date(coverage.earliestStart).getTime()
}

/**
 * Cross-check against the server's own aggregate.
 *
 * Both sides price all-time payable hours at the worker's current rate, so on a complete
 * payload they must be identical to the cent. Any gap is the tail the `limit` cut off, and
 * the screen reports it as such rather than showing a total that will not reconcile.
 */
export type Reconciliation = { serverCents: number; visibleCents: number; missingCents: number }

export function reconcile(workers: Worker[], shifts: Shift[], hours: HoursRow[]): Reconciliation {
  const serverCents = hours.reduce((sum, row) => sum + row.pay_cents, 0)
  const visibleCents = payrollFor(workers, shifts, null).payCents
  return { serverCents, visibleCents, missingCents: serverCents - visibleCents }
}

/**
 * RFC 4180-ish CSV.
 *
 * ponytail: semicolon-separated, because this file is opened in Excel on an Austrian
 * machine where the list separator is `;` and a comma-separated file lands in one column.
 * Ceiling: no dialect switch. Upgrade path is a second button, not a library.
 * Amounts are exported as integer cents as well as euros so the accountant can total them
 * without inheriting a spreadsheet's float. `centsToPlainEuros` lives in lib/money.ts — the
 * same function the worker form uses to render a rate, deliberately not a second copy.
 */
export function toCsv(rows: readonly (readonly string[])[]): string {
  const cell = (value: string) =>
    /[";\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
  return rows.map((row) => row.map(cell).join(';')).join('\r\n')
}
