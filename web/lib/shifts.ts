import type { Shift } from '@/lib/api'

/**
 * Pure shift arithmetic. No React, no fetching — the shift log is the only screen that
 * decides whether a row is payable, and that rule has to be readable in one place.
 */

/**
 * The four states a shift can be in, in the order they matter to an admin.
 *
 * - `open`      — no end_time. The worker is (supposedly) still on site.
 * - `unresolved`— the 8h timer closed it and no human has confirmed the real end time.
 *                 decision-10: it does NOT count towards pay until the worker (or the
 *                 admin, via a correction here) supplies that time.
 * - `resolved`  — a human stamped the real end time on a shift the timer had guessed at.
 * - `complete`  — tapped in, tapped out, nothing to see.
 *
 * `open` and `unresolved` are exactly the two the server's `hours` aggregate leaves out
 * (see the WHERE clause in server/routes/admin.js), which is why `blocksPayroll` below is
 * derived from this and not maintained separately.
 */
export type ShiftState = 'open' | 'unresolved' | 'resolved' | 'complete'

export function shiftState(shift: Shift): ShiftState {
  if (shift.end_time === null) return 'open'
  if (shift.auto_closed && shift.corrected_at === null) return 'unresolved'
  if (shift.corrected_at !== null) return 'resolved'
  return 'complete'
}

/** Mirrors `WHERE end_time IS NOT NULL AND NOT (auto_closed AND corrected_at IS NULL)`. */
export function blocksPayroll(state: ShiftState): boolean {
  return state === 'open' || state === 'unresolved'
}

/** Whole minutes between two ISO timestamps. Rounded once, for display only. */
export function durationMinutes(startIso: string, endIso: string): number {
  return Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60_000)
}

/** `h:mm`, the form a human checks against a paper timesheet. 90 -> "1:30". */
export function formatDuration(minutes: number): string {
  const sign = minutes < 0 ? '-' : ''
  const total = Math.abs(minutes)
  return `${sign}${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

export const PERIODS = ['week', 'month', 'quarter', 'year', 'all'] as const
export type Period = (typeof PERIODS)[number]

export function isPeriod(value: string): value is Period {
  return (PERIODS as readonly string[]).includes(value)
}

/**
 * Start of the chosen period in the BROWSER's local time, which for this business is
 * Europe/Vienna — the admin closes a month against a wall calendar, not against UTC.
 * `null` = no lower bound.
 *
 * The week starts on Monday (ISO-8601 / Austrian practice), not Sunday.
 */
export function periodStart(period: Period, now: Date): Date | null {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  switch (period) {
    case 'week': {
      const isoWeekday = (now.getDay() + 6) % 7 // Mon = 0
      start.setDate(start.getDate() - isoWeekday)
      return start
    }
    case 'month':
      return new Date(now.getFullYear(), now.getMonth(), 1)
    case 'quarter':
      return new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1)
    case 'year':
      return new Date(now.getFullYear(), 0, 1)
    case 'all':
      return null
  }
}

/**
 * ISO instant -> the `YYYY-MM-DDTHH:mm` local-time string `<input type="datetime-local">`
 * requires. Built from the local getters on purpose: `toISOString().slice(0, 16)` would
 * quietly show a Vienna admin a UTC clock and shift every corrected time by an hour or two.
 */
export function toLocalInput(iso: string): string {
  const date = new Date(iso)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * The inverse. Returns an ISO-8601 instant, or `null` when the field is empty or
 * unparseable — never a guess. `new Date('2026-03-01T07:30')` is local time per spec,
 * which is what the admin typed.
 */
export function fromLocalInput(value: string): string | null {
  if (value.trim() === '') return null
  const ms = new Date(value).getTime()
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}
