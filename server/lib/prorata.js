// Splitting a pot of INTEGER CENTS by weight, with nothing lost and nothing invented.
//
// decision-6: material cost is attributed to buildings pro-rata by labour hours. The
// naive form of that — `round(total * share)` per building — does not sum back to
// `total`: three buildings with equal hours and 100 cents of materials each get
// round(33.33) = 33, and 1 cent evaporates. Over a year of monthly reports that is a
// column of numbers that never quite adds up, and the director is right not to trust it.
//
// Largest remainder (Hamilton) instead: everyone gets their floor, then the leftover
// cents go one each to the largest fractional parts. Sum is EXACTLY `total`, always.
//
// Integers throughout — weights are whole SECONDS of labour, the pot is whole cents. No
// float multiply anywhere, so there is no rounding to argue about in the first place.

/**
 * @param {number} totalCents  non-negative integer
 * @param {Array<{key: string, weight: number}>} entries  non-negative integer weights
 * @returns {Map<string, number>|null}  cents per key, summing exactly to totalCents.
 *   NULL when the total weight is zero — that is "this cannot be split", which is a
 *   different answer from "everyone gets 0" and the caller has to report it as such.
 */
export function splitProRata(totalCents, entries) {
  if (!Number.isSafeInteger(totalCents) || totalCents < 0) {
    throw new TypeError("splitProRata: totalCents must be a non-negative integer");
  }
  for (const e of entries) {
    if (!Number.isSafeInteger(e.weight) || e.weight < 0) {
      throw new TypeError(`splitProRata: weight for ${e.key} must be a non-negative integer`);
    }
  }

  const totalWeight = entries.reduce((sum, e) => sum + e.weight, 0);
  if (totalWeight === 0) return null;

  // floor(total * weight / totalWeight) and the exact numerator of the remainder, both
  // in integers. `total * weight` can exceed 2^53 for absurd inputs (a million euro pot
  // against a decade of seconds), so the multiply is done in BigInt and only the results
  // — which are bounded by totalCents — come back as numbers.
  const T = BigInt(totalCents);
  const W = BigInt(totalWeight);
  const shares = entries.map((e) => {
    const product = T * BigInt(e.weight);
    return { key: e.key, cents: Number(product / W), remainder: product % W };
  });

  const assigned = shares.reduce((sum, s) => sum + s.cents, 0);
  let leftover = totalCents - assigned; // strictly less than entries.length

  // Biggest remainder first; ties broken by key so the same input always produces the
  // same output. A split that moves a cent between two buildings on re-run is a report
  // that contradicts yesterday's screenshot.
  const order = [...shares].sort((a, b) => (a.remainder === b.remainder ? (a.key < b.key ? -1 : 1) : a.remainder > b.remainder ? -1 : 1));
  for (let i = 0; leftover > 0; i = (i + 1) % order.length) {
    order[i].cents += 1;
    leftover -= 1;
  }

  const out = new Map();
  for (const s of shares) out.set(s.key, s.cents);
  return out;
}
