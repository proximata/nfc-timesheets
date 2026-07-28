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

/**
 * Cents as a plain fixed-point decimal: `1450` -> `14.50`. String slicing, no float ever
 * touches it.
 *
 * Two callers, one function on purpose — the worker form re-reads this with
 * `parseEuroToCents`, and the payroll CSV hands it to an accountant. A second copy of this
 * rounding rule is exactly how the two would eventually disagree by a cent.
 */
export function centsToPlainEuros(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}
