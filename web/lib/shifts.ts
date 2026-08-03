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

/**
 * Was this shift typed into the admin panel instead of tapped on a tag?
 *
 * There is no "added by hand" column and there must not be one: every phone-originated
 * shift carries an idempotency key in `client_uuid`, so a NULL there means, and can only
 * mean, that a human filed it (see server/db/migrations/003, POST /admin/shifts). Payroll
 * gets audited; a hand-entered shift that looks identical to a tapped one is how a dispute
 * becomes unanswerable, so every list that shows shifts must show this.
 */
export function isManualEntry(shift: Pick<Shift, 'client_uuid'>): boolean {
  return shift.client_uuid === null
}

/**
 * The shift of `workerId` that already covers part of [startIso, endIso), or `null`.
 *
 * Mirrors the overlap query in `POST /admin/shifts`: half-open intervals, and an OPEN
 * shift covers everything after its start, because a worker still on the clock somewhere
 * cannot also have been in another building.
 *
 * The server is the authority — it answers 409 and this cannot see shifts beyond the page
 * it was sent. It exists so the 409 can be phrased as "Anna is already recorded at Neuhaus
 * 09:00–13:00" instead of an opaque refusal the director cannot act on.
 */
export function overlappingShift(
  shifts: readonly Shift[],
  workerId: number,
  startIso: string,
  endIso: string,
): Shift | null {
  const start = new Date(startIso).getTime()
  const end = new Date(endIso).getTime()
  return (
    shifts.find((shift) => {
      if (shift.worker_id !== workerId) return false
      const shiftStart = new Date(shift.start_time).getTime()
      const shiftEnd =
        shift.end_time === null ? Number.POSITIVE_INFINITY : new Date(shift.end_time).getTime()
      return shiftStart < end && shiftEnd > start
    }) ?? null
  )
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

// Reporting periods used to live here, computed in the BROWSER's zone. They now live in
// lib/period.ts, pinned to Vienna and shared with /payroll/ — see the header of that file
// for why two period vocabularies was a money defect and not a tidiness one.

/**
 * The one clock this business runs on. The company, its buildings and its director are all
 * in Vienna; the API stores UTC. Every time a human reads or types on the admin screens is
 * therefore Vienna wall-clock time and is converted at this boundary.
 *
 * Pinned to the zone, NOT to the browser's zone, which is what `new Date(...)` getters and
 * `toISOString()` would give. A laptop set to UTC (or a director on a trip) would otherwise
 * silently move a 07:30 shift by an hour or two — and, for a shift near midnight, onto the
 * wrong DAY, which is the wrong month at month end and the wrong payslip. Screens must also
 * SAY which zone is meant, so nobody has to infer it.
 */
export const BUSINESS_TIME_ZONE = 'Europe/Vienna'

// en-CA gives ISO-ordered numeric parts, so no locale-dependent reordering is needed.
const BUSINESS_PARTS = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

/**
 * What `<input type="datetime-local">` produces — shape-checked before parsing, because
 * `Date.parse` is lenient enough to turn junk into a real date: `Date.parse('nope:00Z')`
 * answers 1999-12-31 in V8 rather than NaN, and that would be filed as a shift.
 */
const LOCAL_INPUT_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d$/

/** `YYYY-MM-DDTHH:mm` as `<input type="datetime-local">` requires, in Vienna wall time. */
export function toBusinessInput(iso: string): string {
  const at: Record<string, string> = {}
  for (const part of BUSINESS_PARTS.formatToParts(new Date(iso))) at[part.type] = part.value
  // Vienna is never 24:00, but hour12:false emits it in some engines for midnight.
  const hour = at.hour === '24' ? '00' : at.hour
  return `${at.year}-${at.month}-${at.day}T${hour}:${at.minute}`
}

/** The zone's offset from UTC at a given instant, in ms. Positive = ahead of UTC. */
function businessOffsetMs(instantMs: number): number {
  const wallAsUtc = Date.parse(`${toBusinessInput(new Date(instantMs).toISOString())}:00Z`)
  return wallAsUtc - instantMs
}

/**
 * The inverse: Vienna wall-clock text -> ISO-8601 instant. `null` when the field is empty
 * or unparseable — never a guess, because a guessed timestamp lands on a payslip.
 *
 * Two passes: read the text as if it were UTC, subtract the offset that applies there, then
 * re-read the offset at that corrected instant. The second pass is what gets the hour right
 * on the two DST changeover days a year. The one hour that does not exist in March resolves
 * to the instant CET/CEST actually jumps to, rather than being rejected.
 */
export function fromBusinessInput(value: string): string | null {
  const text = value.trim()
  if (!LOCAL_INPUT_RE.test(text)) return null
  const wallAsUtc = Date.parse(`${text}:00Z`)
  if (!Number.isFinite(wallAsUtc)) return null
  const firstPass = wallAsUtc - businessOffsetMs(wallAsUtc)
  const ms = wallAsUtc - businessOffsetMs(firstPass)
  if (!Number.isFinite(ms)) return null
  const iso = new Date(ms).toISOString()
  // 30 February does not exist, and V8 rolls it forward to 2 March instead of answering
  // NaN. Reject anything whose DAY does not survive the round trip rather than file a
  // shift on a date nobody typed. Only the day is compared: 02:30 on the March clock
  // change is a real instant (03:30 CEST) and is deliberately accepted.
  return toBusinessInput(iso).slice(0, 10) === text.slice(0, 10) ? iso : null
}
