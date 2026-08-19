import type { PlBuilding } from '@/lib/api'

/**
 * Profit-and-loss arithmetic that is NOT the server's job: turning the operator's percent
 * into the basis points `app_settings` stores, and building the totals row.
 *
 * Everything here is integer arithmetic on cents and basis points. A margin is a ratio of
 * two integers and is reported in BASIS POINTS (1500 = 15.00%), because a percentage held
 * as a float and compared with `<` against a stored threshold is exactly how a building
 * lands on the wrong side of a flag it is sitting precisely on.
 *
 * THE ONE RULE THIS FILE EXISTS TO PROTECT: a `null` from the API is a REFUSAL TO GUESS.
 * `revenue_cents` null means NOBODY HAS TYPED WHAT THE CLIENT PAID for any month of the
 * period (decision-42); it must never be summed as zero, because a zero would report the
 * building as a total loss and flag it. So the totals below carry the KNOWN-revenue
 * subtotals separately from the whole-period cost, and the caller is expected to say which
 * is which on screen.
 *
 * 0 IS NOT THAT NULL. A building with a typed 0 really was paid nothing this month - a
 * credit month, a dispute, a free trial - and it is summed, counted and flagged normally.
 */

/** `12,5` or `12.5` or `-5` — German keyboards produce the comma. Two decimals, i.e. 1 bp. */
const PERCENT_RE = /^(-?)(\d{1,3})(?:[.,](\d{1,2}))?$/

/** The server's own bound on `pl_margin_baseline_bp` (SETTINGS in routes/admin.js). */
export const MARGIN_BP_LIMIT = 10_000

/**
 * Percent as the director types it -> integer basis points, or `null` when it is not a
 * well-formed percentage. `null` is a validation failure the caller must surface, never a
 * silent 0 — a silent 0 would set the floor to break-even and flag half the portfolio.
 *
 * String slicing plus integer arithmetic, same reasoning as lib/money.ts: `12.5 * 100` is
 * fine and `2.03 * 100` is 202.99999999999997, and a baseline one basis point out is a
 * building on the wrong side of a flag the director has to defend to a client.
 */
export function parsePercentToBp(input: string): number | null {
  const match = PERCENT_RE.exec(input.trim())
  if (match === null) return null
  const [, sign, whole = '0', fraction] = match
  const hundredths = fraction === undefined ? 0 : Number.parseInt(fraction.padEnd(2, '0'), 10)
  const magnitude = Number.parseInt(whole, 10) * 100 + hundredths
  if (magnitude > MARGIN_BP_LIMIT) return null
  // `-0` is a legal thing to type and is not a distinct baseline. Normalise it, or the
  // field round-trips to "-0" and the stored value serialises as "0" — two spellings of
  // break-even, and a form that looks unsaved.
  return sign === '-' && magnitude !== 0 ? -magnitude : magnitude
}

/**
 * Basis points -> the plain decimal that goes back INTO the input field: 1250 -> `12.5`,
 * -500 -> `-5`, 1234 -> `12.34`. Trailing zeros are dropped so the field reads the way a
 * human would have typed it. For DISPLAY, format the number through next-intl instead —
 * this is a round-trip partner for `parsePercentToBp` and nothing else.
 */
export function bpToPlainPercent(bp: number): string {
  const sign = bp < 0 ? '-' : ''
  const abs = Math.abs(bp)
  // ALL trailing zeros: 1200 -> "12", not "12.0", which is what a single-zero strip gives.
  const fraction = String(abs % 100)
    .padStart(2, '0')
    .replace(/0+$/, '')
  const whole = Math.trunc(abs / 100)
  return fraction === '' ? `${sign}${whole}` : `${sign}${whole}.${fraction}`
}

/** A percentage as a fraction, for `Intl.NumberFormat({style:'percent'})`. 1250 -> 0.125. */
export function bpToRatio(bp: number): number {
  return bp / 10_000
}

/**
 * `part` as a share of `whole`, in basis points, or `null` when the share is not defined.
 *
 * Null, not zero, and not Infinity: "labour was 62% of revenue" is a sentence the director
 * takes to a client meeting, and "labour was 0% of revenue" for a building nobody has
 * priced would be a sentence they could not defend.
 */
export function shareBp(partCents: number, wholeCents: number | null): number | null {
  if (wholeCents === null || wholeCents === 0) return null
  return Math.round((partCents * 10_000) / wholeCents)
}

/**
 * How far under the floor a building is, in basis points. Positive = that far short.
 *
 * `null` whenever either number is unknown — which is the same condition the API reports
 * as `below_baseline: null`, i.e. NOT ASSESSABLE. A screen that turned this into 0 would
 * be claiming the building sits exactly on target.
 */
export function shortfallBp(marginBp: number | null, baselineBp: number | null): number | null {
  if (marginBp === null || baselineBp === null) return null
  return baselineBp - marginBp
}

export type PlTotals = {
  /** Sum over buildings that have a TYPED figure for at least one month of the period. */
  revenueCents: number
  /** How many buildings have none. Their cost is real; what they were paid is unknown. */
  unpricedBuildings: number
  /**
   * Whole months of the period, summed across buildings, that nobody has typed a figure
   * for. The revenue total is a partial sum until this is 0, and the screen has to say so:
   * a quarter with two of three months entered is not a bad quarter, it is two months.
   */
  monthsMissingRevenue: number
  /** Labour and materials for EVERY building in the period, priced or not. */
  labourCents: number
  materialCents: number
  /** ...and for the priced ones alone, which is the only subset a profit can be taken of. */
  labourCentsPriced: number
  materialCentsPriced: number
  /** Cost carried by buildings with no revenue typed. Not a loss - an unknown. */
  costCentsUnpriced: number
  /** Revenue minus cost, OVER THE PRICED BUILDINGS ONLY. Null when there are none. */
  profitCents: number | null
  marginBp: number | null
  /** below_baseline === true / === null. `null` is "not assessable", never a pass. */
  flagged: number
  notAssessable: number
  /** decision-10: hours deliberately withheld from the cost side, and still running work. */
  excludedUnresolvedShifts: number
  openShifts: number
  /**
   * Buildings whose pin is grey because no zone has been filed yet (decision-43).
   *
   * PRESENTATION ONLY. It is deliberately NOT summed into anything, NOT a flag and NOT a
   * reason to exclude a building from a total: an unzoned building's tag resolves, its
   * workers clock in, and its P&L is exactly as real as everyone else's. It exists so the
   * screen can name a next action, in words, beside a number that is already correct.
   */
  unzonedBuildings: number
}

export function plTotals(buildings: readonly PlBuilding[]): PlTotals {
  const totals: PlTotals = {
    revenueCents: 0,
    unpricedBuildings: 0,
    monthsMissingRevenue: 0,
    labourCents: 0,
    materialCents: 0,
    labourCentsPriced: 0,
    materialCentsPriced: 0,
    costCentsUnpriced: 0,
    profitCents: null,
    marginBp: null,
    flagged: 0,
    notAssessable: 0,
    excludedUnresolvedShifts: 0,
    openShifts: 0,
    unzonedBuildings: 0,
  }

  for (const building of buildings) {
    totals.labourCents += building.labour_cents
    totals.materialCents += building.material_cents
    totals.excludedUnresolvedShifts += building.excluded_unresolved_shifts
    totals.openShifts += building.open_shifts
    totals.monthsMissingRevenue += building.months_missing_revenue
    if (building.zone_state === 'unzoned') totals.unzonedBuildings += 1
    if (building.below_baseline === true) totals.flagged += 1
    if (building.below_baseline === null) totals.notAssessable += 1

    if (building.revenue_cents === null) {
      totals.unpricedBuildings += 1
      totals.costCentsUnpriced += building.labour_cents + building.material_cents
    } else {
      totals.revenueCents += building.revenue_cents
      totals.labourCentsPriced += building.labour_cents
      totals.materialCentsPriced += building.material_cents
    }
  }

  const priced = buildings.length - totals.unpricedBuildings
  if (priced > 0) {
    totals.profitCents = totals.revenueCents - totals.labourCentsPriced - totals.materialCentsPriced
    totals.marginBp = shareBp(totals.profitCents, totals.revenueCents)
  }
  return totals
}
