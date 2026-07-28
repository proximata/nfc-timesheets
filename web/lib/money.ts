/**
 * Euro <-> cent conversion for payroll input.
 *
 * The admin types euros, `workers.hourly_rate_cents` stores an integer. Everything here is
 * string slicing plus integer arithmetic ON PURPOSE: `Math.round(14.5 * 100)` happens to be
 * right, `Math.round(1.005 * 100)` is not, and a rate that is one cent off is wrong on every
 * payslip for as long as nobody notices.
 */

/** `14.50` or `14,50` — German keyboards produce the comma, so both are accepted. */
const EURO_RE = /^(\d{1,6})(?:[.,](\d{1,2}))?$/

/**
 * Returns integer cents, or `null` when the input is not a well-formed euro amount.
 * `null` is a validation failure the caller must surface, never a silent 0.
 */
export function parseEuroToCents(input: string): number | null {
  const match = EURO_RE.exec(input.trim())
  if (match === null) return null
  const [, whole = '0', fraction] = match
  const euros = Number.parseInt(whole, 10)
  // '5' -> 50 cents, '05' -> 5 cents. Pad before parsing, never multiply a fraction.
  const cents = fraction === undefined ? 0 : Number.parseInt(fraction.padEnd(2, '0'), 10)
  return euros * 100 + cents
}

/** Cents back into an editable field value. Plain dot form; `parseEuroToCents` re-reads it. */
export function centsToEuroInput(cents: number): string {
  return `${Math.trunc(cents / 100)}.${String(cents % 100).padStart(2, '0')}`
}
