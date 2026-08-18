import type { HoursRow, Shift, Worker } from '@/lib/api'
import type { PeriodRange } from '@/lib/period'
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
 *  2. THE PERIOD IS DECIDED BY THE SERVER AND BY NOBODY ELSE. `GET /admin/data?from=&to=`
 *     bounds the shift ROWS and the `hours` AGGREGATE with the same predicate, so the total
 *     at the bottom of the screen and the rows above it describe the same days by
 *     construction. This file therefore sums whatever it is handed: re-filtering here would
 *     reintroduce exactly the second opinion that was the bug (a July pay total beside an
 *     empty August table). `hours` is now a like-for-like cross-check, see `reconcile`.
 *     The period vocabulary itself lives in lib/period.ts.
 */

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
 * Per-worker hours and pay over exactly the shifts supplied — which is exactly the period
 * the server was asked for.
 *
 * Rounding matches the server's `ROUND(SUM(hours) * hourly_rate_cents)` exactly: sum the
 * whole period first, price it once. Rounding each shift instead would drift by up to half
 * a cent per shift, which is a reconciliation argument nobody wants to have.
 */
export function payrollFor(workers: Worker[], shifts: Shift[]): PayrollTotals {
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
 * `adminData` orders by `start_time DESC` and applies a `LIMIT`, so when the row count
 * reaches the limit the payload is the most recent N shifts OF THE REQUESTED PERIOD and
 * everything older within it is simply absent. A period that begins before `earliestStart`
 * is therefore INCOMPLETE, and a total computed over it is too low. That has to be said out
 * loud, not inferred.
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
  if (range.from === null) return true // unbounded start, and we were given a partial list
  return new Date(range.from).getTime() < new Date(coverage.earliestStart).getTime()
}

/**
 * Cross-check against the server's own aggregate FOR THE SAME PERIOD.
 *
 * Both sides now apply the same `[from, to)` and the same decision-10 exclusions and price
 * at the worker's current rate, so they must be identical to the cent. The only thing that
 * can make them differ is the `LIMIT` on the row list, and the difference is then exactly
 * the truncated tail — which the screen reports rather than quietly under-paying.
 */
export type Reconciliation = { serverCents: number; visibleCents: number; missingCents: number }

export function reconcile(workers: Worker[], shifts: Shift[], hours: HoursRow[]): Reconciliation {
  const serverCents = hours.reduce((sum, row) => sum + row.pay_cents, 0)
  const visibleCents = payrollFor(workers, shifts).payCents
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

/**
 * `3638.26` -> `3638,26`. The Austrian decimal comma, applied ONCE, at the file boundary.
 *
 * THE SEPARATOR IS PART OF THE DIALECT, and half of it was missing. Choosing `;` above
 * commits this file to being read with the REST of the German locale conventions too:
 * decimal `,`, thousands `.`. Under those rules the old export did not say what it meant:
 *
 *   Stunden      `10.500`   -> 10 500, a well-formed thousands group. A THOUSANDFOLD
 *                             overstatement of hours, right-aligned, summing perfectly,
 *                             with no visible symptom at all.
 *   Betrag (EUR) `3638.26`  -> not a number: two decimals is never a valid German group,
 *                             so Excel files it as text and the column totals 0,00 —
 *                             or, for a value like `12.05`, as 12 May.
 *
 * So the file was already internally inconsistent: one column silently multiplied and the
 * next silently not a number. Comma decimals fix both AT ONCE and match what a German
 * Excel writes when it saves a CSV itself, so the file now round-trips through the tool it
 * is opened in. The integer cent columns keep no separator whatsoever — they are the one
 * part of the file that reads identically in every locale, and they are why the accountant
 * can total the money without inheriting a spreadsheet's float either way.
 *
 * A separator swap, NOT a second rounding rule: `centsToPlainEuros` (and `toFixed` for
 * hours) still decides every digit, exactly as the screen does. That is deliberate —
 * a second copy of the rounding is how the screen and the file drift apart by a cent.
 * `,` is not the field delimiter here, so nothing needs quoting (see `toCsv`).
 *
 * The German-Excel reading of every column, before and after, is asserted in
 * web/scripts/check.mjs and against the real downloaded file in demo/check-reports.mjs.
 */
export function decimalComma(plain: string): string {
  return plain.replace('.', ',')
}
