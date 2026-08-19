/**
 * Floor area, in INTEGER HUNDREDTHS of a square metre.
 *
 * Same discipline as lib/money.ts and for the same reason: `zones.area_sqm` is
 * `NUMERIC(8,2)` precisely so an exact decimal never passes through binary floating point,
 * and a building's area is a SUM of its zones' areas (decision-43). Adding `12.10 + 0.20`
 * as floats gives 12.299999999999999, and that number then becomes the DENOMINATOR of every
 * EUR/m2 figure the director quotes a new building from.
 *
 * So: parse by string slicing, sum as integers, and divide exactly once, at the point of
 * display. Nothing in this file multiplies a fraction.
 *
 * NULL IS A FIRST-CLASS ANSWER HERE and it is not 0. A zone nobody has measured is real -
 * "Stiege 3, there is no floor plan" - and a required area would be an invented one. An
 * invented m2 poisons the benchmark that is the only reason the column exists, so a
 * building with ANY unmeasured live zone reports a FLOOR ("mindestens 420 m2"), never a
 * total, and the server refuses every per-m2 figure derived from it.
 */

/**
 * Mirrors `AREA_RE` in server/lib/validate.js. The server decides for real.
 *
 * Two decimals, matching the column. Validated as a string of digits rather than by
 * rounding a float: `parseFloat` would silently accept `12.345` and store `12.35`, turning
 * a typo into a measurement.
 */
const AREA_RE = /^(\d{1,6})(?:[.,](\d{1,2}))?$/

/**
 * Area as the director types it -> integer hundredths of m2, or `null` when it is not a
 * well-formed, strictly positive area.
 *
 * `null` is a validation failure the caller must surface, never a silent 0: a zone with no
 * floor is not a zone, which is why the column's CHECK is `> 0` and not `>= 0`.
 */
export function parseAreaToHundredths(input: string): number | null {
  const match = AREA_RE.exec(input.trim())
  if (match === null) return null
  const [, whole = '0', fraction] = match
  const units = Number.parseInt(whole, 10)
  // '5' -> 50 hundredths, '05' -> 5. Pad before parsing, never multiply a fraction.
  const hundredths = fraction === undefined ? 0 : Number.parseInt(fraction.padEnd(2, '0'), 10)
  const total = units * 100 + hundredths
  return total > 0 ? total : null
}

/**
 * Hundredths -> the plain fixed-point decimal that goes back INTO the input field:
 * `42050` -> `420.50`. String slicing, no float ever touches it.
 *
 * For DISPLAY, format `hundredths / 100` through next-intl instead: this is the round-trip
 * partner for `parseAreaToHundredths` and for the string the API is handed, and nothing else.
 */
export function hundredthsToPlainArea(hundredths: number): string {
  return `${Math.trunc(hundredths / 100)}.${String(hundredths % 100).padStart(2, '0')}`
}

/**
 * The wire value -> hundredths.
 *
 * `area_sqm` arrives as a JS number, because server/lib/db.js parses `numeric` to one. That
 * is the ONE place a float touches an area, and it is unavoidable without a second type
 * parser on the server. `String(n)` gives the shortest representation that round-trips, and
 * for a value the column constrains to six digits and two decimals that is exactly the
 * decimal that was stored - so this recovers the exact figure rather than approximating it.
 *
 * `null` in, `null` out: nobody has measured it.
 */
export function wireAreaToHundredths(value: number | null): number | null {
  if (value === null) return null
  return parseAreaToHundredths(String(value))
}

/** What a building's area is, and whether that number is a TOTAL or only a FLOOR. */
export type AreaSum = {
  /** Integer hundredths of m2 over the zones that HAVE an area. 0 when none do. */
  hundredths: number
  /** Live zones counted. */
  zones: number
  /** ...of which nobody has measured. Above 0 means `hundredths` is a floor. */
  unmeasured: number
  /**
   * `'complete'`   every zone measured; the sum is a total
   * `'incomplete'` at least one zone has no area; the sum is a FLOOR and must be said so
   * `'none'`       there are no zones at all; there is no area, and it is not 0
   */
  state: 'complete' | 'incomplete' | 'none'
}

/**
 * Sum a building's zone areas WITHOUT ever pretending an unmeasured zone is 0 m2.
 *
 * The gap between `zones` and the measured ones is the whole guard rail. A screen that
 * printed the bare sum would state "420 m2" for a building with an unmeasured Tiefgarage:
 * a confidently wrong benchmark rather than an approximately right one, and the server
 * refuses every per-m2 figure for exactly that reason (decision-43).
 */
export function sumArea(areas: readonly (number | null)[]): AreaSum {
  let hundredths = 0
  let unmeasured = 0
  for (const value of areas) {
    const parsed = wireAreaToHundredths(value)
    if (parsed === null) unmeasured += 1
    else hundredths += parsed
  }
  return {
    hundredths,
    zones: areas.length,
    unmeasured,
    state: areas.length === 0 ? 'none' : unmeasured > 0 ? 'incomplete' : 'complete',
  }
}
