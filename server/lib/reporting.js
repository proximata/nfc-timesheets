// P&L and building analytics. All the arithmetic, none of the HTTP.
//
// WHY IT IS SQL AND NOT THE BROWSER: GET /admin/data caps shift rows at SHIFT_PAGE_MAX
// (2000), so a client-side aggregate silently truncates and reports a smaller month than
// actually happened. An aggregate that can quietly be wrong about payroll is worse than
// no aggregate.
//
// TIME. Every period boundary arrives as a UTC INSTANT on the wire and every calendar
// question is answered in Europe/Vienna, by Postgres, using the tz database. There is no
// fixed +01:00/+02:00 offset anywhere below. That matters twice a year and it matters at
// month end, which is payroll time: a period built with one fixed offset loses the last
// evening of October.
//
// MONEY. Integer cents in, integer cents out. Intermediate pro-ration uses `numeric`,
// which is exact decimal arithmetic, never `double precision`. Rounding happens ONCE, at
// the end of a SUM, never per-row inside it.
//
// WHAT THIS FILE REFUSES TO GUESS — every one of these is a NULL plus a reason on the
// wire, not a confident zero:
//   * a month nobody has typed a payment for         -> revenue_cents null, "not_entered"
//   * a period that is not whole Vienna months       -> margin null, "period_not_month_aligned"
//   * a period with no payable hours                 -> materials cannot be split at all
//   * a contract with no target_minutes_per_month    -> target_minutes null
//   * a request the admin has not priced             -> excluded from the pool AND counted
//   * a building with no zones                       -> every per-m2 figure null, "no_zones"
//   * a zone nobody has measured                     -> every per-m2 figure null, "area_incomplete"
//   * a margin against zero revenue                  -> margin_bp null, "zero_revenue"
//   * a baseline nobody has set                      -> below_baseline null, nothing flagged
//
// WHAT IS NO LONGER ON THAT LIST, and it is a deletion rather than a silence:
//   * a worker with no hourly rate. decision-41 made a rate of 0 UNREPRESENTABLE
//     (`workers_rate_positive`, and the column lost its DEFAULT), so the state those
//     `unpriced_*` fields described cannot occur. `labour_seconds` and `labour_cents` now
//     describe THE SAME SET OF SECONDS, and any divergence is a bug rather than a state.
//     `labour.rate_basis: "current"` STAYS — it is a DIFFERENT, still-true limitation, and
//     deleting it along with the unpriced fields would make this report look more certain
//     than it is.
import { all, one } from "./db.js";
import { splitProRata } from "./prorata.js";

// decision-10, COPIED VERBATIM from routes/admin.js `adminData`. A shift counts for money
// only if it has a real end time AND is not a start+8h guess nobody has confirmed. Do NOT
// reformulate it; two spellings of one predicate is how a payslip and a P&L come to
// disagree about the same month.
const PAYABLE = "s.end_time IS NOT NULL AND NOT (s.auto_closed AND s.corrected_at IS NULL)";

// Half-open [from, to) on start_time — the same rule as `adminData` and as
// `startsWithin` in web/lib/payroll.ts: a shift belongs to the period its START falls in.
const IN_PERIOD = "s.start_time >= $1 AND s.start_time < $2";

// The Vienna calendar days a period covers. A DAY belongs to the period its own Vienna
// midnight falls in — the same "belongs to where it starts" rule as a shift, so two
// adjacent periods can never both claim a day and never both miss one.
//
// `d::timestamp AT TIME ZONE 'Europe/Vienna'` is local-wall-time -> instant, resolved
// against the tz database. That is the whole DST story, and it lives here rather than in
// JavaScript because Postgres already ships the rules.
const VIENNA_DAYS = `
  SELECT gs::date AS day
    FROM generate_series(
           ($1::timestamptz AT TIME ZONE 'Europe/Vienna')::date::timestamp,
           ($2::timestamptz AT TIME ZONE 'Europe/Vienna')::date::timestamp,
           interval '1 day') AS gs
   WHERE (gs::date::timestamp AT TIME ZONE 'Europe/Vienna') >= $1
     AND (gs::date::timestamp AT TIME ZONE 'Europe/Vienna') <  $2`;

/**
 * TARGET TIME earned by each building over the period, day by day.
 *
 * A monthly target is pro-rated by DAY against the length of that day's OWN month: a day in
 * February is worth 1/28th, a day in March 1/31st. Summing whole days and rounding once at
 * the end means twelve monthly reports add up to the annual one, which "monthly / 30" would
 * not.
 *
 * *** IT NO LONGER SLICES MONEY, AND THE MISSING LINE IS THE WHOLE OF decision-42. ***
 * This function used to produce `revenue_cents` the same way, which was careful arithmetic
 * about a number nobody received: a contract is what was AGREED. What was RECEIVED is a
 * typed monthly fact in `location_revenue`, read by `revenueSlice`. The accrual line is
 * DELETED rather than left computed-and-ignored, because a dormant accrual is one
 * `COALESCE` away from coming back.
 *
 * `target_unknown_days` is the honesty channel that survives: a building whose contract
 * carries no target for part of the period says so instead of reporting a smaller target.
 *
 * A TARGET IS NOT MONEY, which is why pro-rating one is still legitimate here: it is a
 * measure of contracted EFFORT spread over days that were actually worked, not a payment
 * with a date attached.
 */
async function contractSlice(from, to) {
  return all(
    `WITH days AS (${VIENNA_DAYS}),
     day_month AS (
       SELECT day,
              EXTRACT(DAY FROM (date_trunc('month', day::timestamp) + interval '1 month - 1 day'))::numeric AS days_in_month
         FROM days
     )
     SELECT c.location_id,
            ROUND(SUM(c.target_minutes_per_month::numeric / dm.days_in_month)
                    FILTER (WHERE c.target_minutes_per_month IS NOT NULL))::bigint     AS target_minutes,
            count(*) FILTER (WHERE c.target_minutes_per_month IS NULL)::int            AS target_unknown_days
       FROM day_month dm
       JOIN location_contracts c
         ON c.valid_from <= dm.day
        AND (c.valid_to IS NULL OR dm.day < c.valid_to)
      GROUP BY c.location_id`,
    [from, to],
  );
}

/** How many Vienna days the period covers at all. The denominator for "partly priced". */
async function periodDays(from, to) {
  const row = await one(`SELECT count(*)::int AS n FROM (${VIENNA_DAYS}) d`, [from, to]);
  return row.n;
}

/**
 * The WHOLE Vienna calendar months FULLY CONTAINED in [from, to), and whether the period is
 * exactly those months and nothing else (decision-42 §4).
 *
 * A TYPED MONTHLY PAYMENT CANNOT BE SLICED. 17/30ths of "the client paid 1.250,00 in
 * September" invents a payment schedule nobody agreed to — it is the same accrual
 * decision-42 removed, applied to the replacement. So a ragged period reports revenue for
 * the months it fully contains, NAMES the partial ones as excluded, and REFUSES the margin.
 *
 * Cost keeps its exact half-open day boundaries, which is why the margin has to be refused
 * rather than approximated: comparing a full month of revenue against a partial month of
 * labour is a margin computed from two different periods.
 *
 * Every boundary is resolved against the tz database by Postgres. That matters twice a
 * year: 2026-03-01 00:00 Vienna is +01:00 and 2026-04-01 00:00 Vienna is +02:00, so a
 * March period built with one fixed offset is an hour wrong at one end.
 */
async function monthWindow(from, to) {
  const row = await one(
    `WITH candidate AS (
       SELECT gs::date AS month_start,
              (gs::date::timestamp AT TIME ZONE 'Europe/Vienna')                        AS lo,
              ((gs::date + interval '1 month')::timestamp AT TIME ZONE 'Europe/Vienna') AS hi
         FROM generate_series(
                date_trunc('month', $1::timestamptz AT TIME ZONE 'Europe/Vienna'),
                date_trunc('month', ($2::timestamptz - interval '1 microsecond') AT TIME ZONE 'Europe/Vienna'),
                interval '1 month') AS gs
     ),
     whole AS (SELECT * FROM candidate WHERE lo >= $1 AND hi <= $2)
     -- ::text, not the bare date. pg's ARRAY parser does NOT use the scalar date parser
     -- lib/db.js pins, so an array of dates comes back as JS Date objects and the day is
     -- silently shifted by the process's own zone on the way out. Text in, text back, and
     -- handed straight to the next query as a date[] parameter.
     SELECT COALESCE(array_agg(w.month_start::text ORDER BY w.month_start), '{}') AS months,
            (SELECT count(*) FROM candidate)::int                           AS touched,
            (SELECT count(*) FROM whole)::int                               AS contained,
            -- "the period IS these months": it starts at the first one and ends at the last
            -- one's end, with nothing hanging off either side.
            (SELECT count(*) FROM candidate) = (SELECT count(*) FROM whole)
              AND (SELECT count(*) FROM whole) > 0                          AS aligned
       FROM whole w`,
    [from, to],
  );
  return {
    months: row.months ?? [],
    monthsTouched: row.touched,
    monthsContained: row.contained,
    aligned: row.aligned === true,
  };
}

/**
 * What each building was PAID, for the whole months the period contains (decision-42).
 *
 * Reads `location_revenue`, not `location_contracts`: a contract is what was AGREED, and a
 * report that shows it as received is a report the director takes into a conversation about
 * money that never arrived.
 *
 * `entered_months` vs the number of months asked for is the honesty channel: a total over
 * some known and some unknown months is not a total, and the caller has to be able to say
 * so instead of printing a smaller number that looks like a bad quarter.
 *
 * `superseded_at IS NULL` is the whole append-only read. The superseded rows stay for the
 * provenance line and are never summed.
 */
async function revenueSlice(monthStarts) {
  if (monthStarts.length === 0) return [];
  return all(
    `SELECT r.location_id,
            SUM(r.amount_cents)::bigint AS revenue_cents,
            count(*)::int               AS entered_months,
            max(r.entered_at)           AS last_entered_at
       FROM location_revenue r
      WHERE r.superseded_at IS NULL AND r.month = ANY ($1::date[])
      GROUP BY r.location_id`,
    [monthStarts],
  );
}

/**
 * The provenance of the MOST RECENT figure in the period, per building, in words the screen
 * prints verbatim: "eingetragen 03.09 · schimmer" and "geändert 11.09 · vorher 1.250,00".
 *
 * "This was changed" without "from what" sends the director to the database, so the previous
 * amount is named. "Geändert" is a WORD, not a colour — colour is always the second signal.
 */
async function revenueProvenance(monthStarts) {
  if (monthStarts.length === 0) return [];
  return all(
    `SELECT DISTINCT ON (r.location_id)
            r.location_id, to_char(r.month, 'YYYY-MM') AS month,
            r.entered_at, a.email AS entered_by_email,
            prev.amount_cents AS previous_cents, prev.superseded_at AS changed_at
       FROM location_revenue r
       LEFT JOIN admins a ON a.id = r.entered_by
       LEFT JOIN LATERAL (
         SELECT p.amount_cents, p.superseded_at
           FROM location_revenue p
          WHERE p.location_id = r.location_id AND p.month = r.month AND p.superseded_at IS NOT NULL
          ORDER BY p.superseded_at DESC, p.id DESC
          LIMIT 1
       ) prev ON true
      WHERE r.superseded_at IS NULL AND r.month = ANY ($1::date[])
      ORDER BY r.location_id, r.entered_at DESC, r.id DESC`,
    [monthStarts],
  );
}

/**
 * The AGREED figure for the same months — "vereinbart", beside "erhalten" (decision-42 §3).
 *
 * This is the question the split BUYS, and the argument for keeping `location_contracts`
 * alive rather than deleting it: the difference between what was contracted and what turned
 * up is NAMED on the row instead of being silently absorbed into the margin.
 *
 * The contract in force on the FIRST of each month, summed. Whole months only, so there is
 * no pro-ration here either.
 */
async function contractedForMonths(monthStarts) {
  if (monthStarts.length === 0) return [];
  return all(
    `SELECT c.location_id, SUM(c.monthly_contract_cents)::bigint AS contract_cents
       FROM unnest($1::date[]) AS m(month_start)
       JOIN location_contracts c
         ON c.valid_from <= m.month_start
        AND (c.valid_to IS NULL OR m.month_start < c.valid_to)
      GROUP BY c.location_id`,
    [monthStarts],
  );
}

/**
 * A building's area, DERIVED from its live zones and never stored (decision-43).
 *
 * `measured` counts zones that have an area, `total` counts active zones. The gap is the
 * whole guard rail: one unmeasured zone makes the SUM a floor, not a total, and a floor
 * used as a denominator inflates every per-m2 figure computed from it. So the caller
 * refuses the figure rather than dividing by a number it knows is too small.
 *
 * NUMERIC out of SQL, carried as a STRING to the caller: `area_sqm` is exact decimal in the
 * column precisely so it never goes near binary floating point.
 */
async function areaByLocation() {
  return all(
    `SELECT z.location_id,
            count(*)::int                                     AS zones_total,
            count(*) FILTER (WHERE z.area_sqm IS NULL)::int    AS zones_unmeasured,
            SUM(z.area_sqm) FILTER (WHERE z.area_sqm IS NOT NULL) AS area_sqm
       FROM zones z
      WHERE z.active
      GROUP BY z.location_id`,
  );
}

/**
 * Payable labour per building: whole seconds, and the cost of them.
 *
 * Grouped by (building, worker) FIRST because the rate is a property of the worker: one
 * ROUND per worker per building, then an integer sum. Rounding the whole building at once
 * would silently apply one worker's rate to another's hours.
 *
 * THE HONESTY LIMIT, and it is permanent until a new decision record changes it:
 * `workers.hourly_rate_cents` is ONE MUTABLE COLUMN. There is no rate history, so every
 * figure here values ALL history at TODAY's rate — raise someone's wage and last March's
 * cost silently changes. The API states this back as `labour.rate_basis: "current"` so the
 * screen can carry a permanent visible notice rather than a tooltip. Fixing it means a
 * `worker_rates` table read by PAYROLL, which is live money for real people and is a
 * decision record, not a commit.
 *
 * THERE IS NO UNPRICED LABOUR ANY MORE (decision-41). `workers.hourly_rate_cents` lost its
 * `DEFAULT 0` and gained `CHECK (> 0)`, so a rate of 0 is unrepresentable and the state the
 * old `unpriced_seconds` / `unpriced_workers` columns described cannot occur. What that
 * buys, and it is worth stating where the arithmetic happens: `labour_seconds` and
 * `labour_cents` now describe THE SAME SET OF SECONDS. Any divergence between them is a
 * bug, not a state, and the check suite asserts `labour_cents > 0` whenever
 * `labour_seconds > 0` rather than trusting this comment.
 *
 * The old `FILTER (WHERE hourly_rate_cents <> 0)` is gone with it. It was arithmetically a
 * no-op — a zero rate contributes zero anyway — and that coincidence was the entire bug: it
 * let `labour_cents` look correct while it was quietly pricing somebody's wage at nothing.
 */
async function labourByLocation(from, to) {
  return all(
    `WITH per_worker AS (
       SELECT s.location_id, s.worker_id, w.hourly_rate_cents,
              SUM(EXTRACT(EPOCH FROM (s.end_time - s.start_time))) AS secs
         FROM shifts s
         JOIN workers w ON w.id = s.worker_id
        WHERE ${PAYABLE} AND ${IN_PERIOD}
        GROUP BY s.location_id, s.worker_id, w.hourly_rate_cents
     )
     SELECT location_id,
            SUM(secs)::bigint                                     AS labour_seconds,
            SUM(ROUND(secs * hourly_rate_cents / 3600.0))::bigint  AS labour_cents
       FROM per_worker
      GROUP BY location_id`,
    [from, to],
  );
}

/**
 * What the period does NOT contain, per building, and why (decision-10).
 *
 * An unresolved auto-closed shift is a start+8h guess no human has confirmed. It is
 * excluded from labour cost — but it is NOT invisible: a building whose "cost" is low
 * because three shifts are stuck awaiting resolution is not a cheap building, and a report
 * that does not say so is lying by omission. Open shifts are counted separately: they are
 * not unresolved, they are still running.
 */
async function exclusionsByLocation(from, to) {
  return all(
    `SELECT s.location_id,
            count(*) FILTER (WHERE s.end_time IS NOT NULL AND s.auto_closed AND s.corrected_at IS NULL)::int
              AS unresolved_shifts,
            COALESCE(SUM(EXTRACT(EPOCH FROM (s.end_time - s.start_time)))
              FILTER (WHERE s.end_time IS NOT NULL AND s.auto_closed AND s.corrected_at IS NULL), 0)::bigint
              AS unresolved_seconds,
            count(*) FILTER (WHERE s.end_time IS NULL)::int AS open_shifts
       FROM shifts s
      WHERE ${IN_PERIOD}
        AND (s.end_time IS NULL OR (s.auto_closed AND s.corrected_at IS NULL))
      GROUP BY s.location_id`,
    [from, to],
  );
}

/**
 * The material pot for the period.
 *
 * `ordered_at` and not `created_at`: the cost belongs to the month we committed the money
 * in. `status IN ('ordered','arrived')` because a request that was only approved is not a
 * spend yet, and a rejected one never will be.
 *
 * `inventory_items.unit_cost_cents` is deliberately NOT summed here. It is a PRICE LIST,
 * not a purchase ledger — multiplying it by anything would be inventing purchases that
 * may never have happened. The only per-period material cost this system has is what an
 * admin actually typed against a request they actually ordered.
 */
async function materialPool(from, to) {
  return one(
    `SELECT COALESCE(SUM(cost_cents), 0)::bigint                   AS pool_cents,
            count(*) FILTER (WHERE cost_cents IS NULL)::int        AS unpriced_requests,
            count(*) FILTER (WHERE cost_cents IS NOT NULL)::int    AS priced_requests
       FROM material_requests
      WHERE status IN ('ordered', 'arrived')
        AND ordered_at >= $1 AND ordered_at < $2`,
    [from, to],
  );
}

/** Every building that either still exists or was worked in the period. */
async function reportableLocations(from, to) {
  return all(
    `SELECT l.id, l.slug, l.name, l.address, l.active, l.lat, l.lng,
            l.geocoded_at, l.geocode_status, l.street_view_status,
            l.client_id, c.name AS client_name,
            l.contact_id, ct.name AS contact_name
       FROM locations l
       LEFT JOIN clients c   ON c.id  = l.client_id
       LEFT JOIN contacts ct ON ct.id = l.contact_id
      WHERE l.active
         OR EXISTS (SELECT 1 FROM shifts s WHERE s.location_id = l.id AND ${IN_PERIOD})
      ORDER BY l.active DESC, l.name`,
    [from, to],
  );
}

/** The operator-set margin floor, in basis points, or null because nobody has set one. */
export async function marginBaselineBp() {
  const row = await one("SELECT value FROM app_settings WHERE key = 'pl_margin_baseline_bp'");
  if (!row) return null;
  const n = Number(row.value);
  // A row that is not an integer is corruption, not a baseline. Treat it as unset rather
  // than flagging every building against NaN.
  return Number.isSafeInteger(n) ? n : null;
}

const byId = (rows, key = "location_id") => new Map(rows.map((r) => [r[key], r]));

/**
 * GET /admin/pl — revenue minus labour minus materials, per building, for one period.
 *
 * decision-6 is the whole material story: the pot is split PRO-RATA BY LABOUR HOURS, not
 * by which building a worker happened to name on the request. Option B ("worker assigns
 * to building") was considered and rejected — nobody will do it, and half-done attribution
 * is worse than none. `splitProRata` uses largest-remainder so the parts sum EXACTLY back
 * to the pot with no cent lost; `material_unallocated_cents` is the residue when there is
 * nothing to split by, and it is reported rather than swallowed.
 */
export async function profitAndLoss(from, to) {
  // The month window has to be known before revenue can be read, so this one is sequential
  // on purpose. It is a single aggregate over generate_series and touches no table.
  const window = await monthWindow(from, to);

  const [locations, contracts, labour, exclusions, pool, days, baselineBp, revenue, provenance, contracted, areas] =
    await Promise.all([
      reportableLocations(from, to),
      // STILL READ, and only for `target_minutes` — /analytics/ needs it and decision-28's
      // period-correct target survives. Its `revenue_cents` output is RETIRED here.
      contractSlice(from, to),
      labourByLocation(from, to),
      exclusionsByLocation(from, to),
      materialPool(from, to),
      periodDays(from, to),
      marginBaselineBp(),
      revenueSlice(window.months),
      revenueProvenance(window.months),
      contractedForMonths(window.months),
      areaByLocation(),
    ]);

  const contractOf = byId(contracts);
  const labourOf = byId(labour);
  const exclusionOf = byId(exclusions);
  const revenueOf = byId(revenue);
  const provenanceOf = byId(provenance);
  const contractedOf = byId(contracted);
  const areaOf = byId(areas);

  // Weights are whole SECONDS of payable labour. Buildings with no hours have weight 0 and
  // therefore get 0 cents of materials, which is the correct reading of decision-6: a
  // building nobody cleaned this month consumed none of this month's supplies.
  const weights = locations.map((l) => ({ key: l.id, weight: Number(labourOf.get(l.id)?.labour_seconds ?? 0) }));
  const poolCents = Number(pool.pool_cents);
  const split = splitProRata(poolCents, weights);
  const allocated = split === null ? 0 : poolCents;

  const buildings = locations.map((l) => {
    const c = contractOf.get(l.id) ?? null;
    const lab = labourOf.get(l.id) ?? null;
    const ex = exclusionOf.get(l.id) ?? null;

    const rev = revenueOf.get(l.id) ?? null;
    const prov = provenanceOf.get(l.id) ?? null;
    const area = areaOf.get(l.id) ?? null;

    const labourSeconds = Number(lab?.labour_seconds ?? 0);
    const labourCents = Number(lab?.labour_cents ?? 0);
    const materialCents = split?.get(l.id) ?? 0;

    // NOBODY HAS TYPED A PAYMENT => UNKNOWN, never 0 and never the contract value
    // (decision-42). The absence of a row IS the unknown; a row carrying 0 means "they paid
    // nothing this month", which is a different, real answer and is reported as 0.
    const revenueCents = rev === null ? null : Number(rev.revenue_cents);
    const enteredMonths = rev === null ? 0 : rev.entered_months;
    const monthsMissingRevenue = window.monthsContained - enteredMonths;

    // A ragged period gets revenue for the months it FULLY CONTAINS and no margin at all.
    // Cost keeps exact day boundaries, so a margin here would divide a full month of
    // revenue by a partial month of labour — two different periods, one number.
    const profitCents = revenueCents === null ? null : revenueCents - labourCents - materialCents;
    const marginBp =
      !window.aligned || revenueCents === null || revenueCents === 0
        ? null
        : Math.round((profitCents * 10000) / revenueCents);

    // ---- per square metre (decision-43 §6) -------------------------------------------
    // THE PAYOFF OF ZONES: the denominator the director needs to quote a new building.
    //
    // The guard rails are the point, not a footnote. ONE unmeasured active zone makes the
    // area a FLOOR, and a denominator that is silently too small inflates every figure
    // computed from it — the same class of error this file already refuses for revenue.
    // So: any unmeasured zone, or no zones at all, and EVERY per-m2 figure is null with a
    // named reason. Never 0, never "about".
    //
    // PER-ZONE COST IS REFUSED AND THE REFUSAL IS DELIBERATE. A shift is building-level, so
    // no duration is attributable to a zone. Splitting the building's labour by area share
    // would assert that time is proportional to floor area, which is false in the obvious
    // direction: a Tiefgarage is fast per m2 and an office floor is slow. Same failure
    // decision-6 already refused for materials.
    const zonesTotal = area === null ? 0 : area.zones_total;
    const zonesUnmeasured = area === null ? 0 : area.zones_unmeasured;
    const areaReason = zonesTotal === 0 ? "no_zones" : zonesUnmeasured > 0 ? "area_incomplete" : null;
    // Exact decimal all the way: `area_sqm` is NUMERIC in the column and arrives as a
    // string, and it is only ever divided INTO an integer, never multiplied by a float.
    const areaSqm = areaReason === null ? Number(area.area_sqm) : null;
    const perArea = (value) =>
      areaSqm === null || value === null ? null : Math.round((value * 100) / areaSqm) / 100;

    return {
      location_id: l.id,
      slug: l.slug,
      name: l.name,
      active: l.active,
      client_id: l.client_id,
      client_name: l.client_name,

      labour_seconds: labourSeconds,
      labour_minutes: Math.round(labourSeconds / 60),
      // Every payable second is priced (decision-41), so this and `labour_seconds` describe
      // the same set. There is no `labour_unpriced_*` any more — the state is gone, not the
      // reporting of it.
      labour_cents: labourCents,
      material_cents: materialCents,

      revenue_cents: revenueCents,
      // Named so the screen prints a reason instead of a dash nobody can act on.
      revenue_unknown_reason: revenueCents === null ? "not_entered" : null,
      // How many of the period's whole months still have nobody's figure in them. The
      // period total is only a TOTAL once this is 0; until then it is a partial sum and the
      // screen has to say so.
      months_missing_revenue: monthsMissingRevenue,
      revenue_months_entered: enteredMonths,
      // "vereinbart" beside "erhalten" — the question the contract/revenue split buys, with
      // the difference NAMED on the row instead of absorbed into the margin.
      contract_cents: contractedOf.has(l.id) ? Number(contractedOf.get(l.id).contract_cents) : null,
      // Provenance, in words. "Geändert" without "from what" sends the director to the
      // database, so the previous amount travels with it.
      revenue_entered_at: prov?.entered_at ?? null,
      revenue_entered_by: prov?.entered_by_email ?? null,
      revenue_changed_at: prov?.changed_at ?? null,
      revenue_previous_cents: prov?.previous_cents === undefined || prov?.previous_cents === null
        ? null
        : Number(prov.previous_cents),
      period_days: days,

      target_minutes: c === null || c.target_minutes === null ? null : Number(c.target_minutes),
      target_unknown_days: c === null ? days : c.target_unknown_days,

      // Area is DERIVED from the live zones and is never stored: a stored total drifts the
      // first time a zone is resized. NULL with a reason whenever it would be a floor
      // masquerading as a total.
      building_m2: areaSqm,
      zones_total: zonesTotal,
      zones_unmeasured: zonesUnmeasured,
      area_unknown_reason: areaReason,
      revenue_cents_per_m2: perArea(revenueCents),
      labour_minutes_per_m2: perArea(Math.round(labourSeconds / 60)),
      cost_cents_per_m2: perArea(labourCents + materialCents),
      // The EUR/m2 figure has TWO ways of being unknowable and the screen must say which.
      per_m2_unknown_reason: areaReason ?? (revenueCents === null ? "not_entered" : null),

      profit_cents: profitCents,
      margin_bp: marginBp,
      margin_unknown_reason: !window.aligned
        ? "period_not_month_aligned"
        : revenueCents === null
          ? "revenue_not_entered"
          : revenueCents === 0
            ? "zero_revenue"
            : null,
      // TRUE only when we know the margin AND somebody has said what the floor is.
      // null means "not assessable", and null is not a pass.
      below_baseline: baselineBp === null || marginBp === null ? null : marginBp < baselineBp,

      // decision-10, per building. Not a footnote: a building looks cheap precisely
      // because these hours were withheld from its cost.
      excluded_unresolved_shifts: ex?.unresolved_shifts ?? 0,
      excluded_unresolved_seconds: Number(ex?.unresolved_seconds ?? 0),
      open_shifts: ex?.open_shifts ?? 0,
    };
  });

  return {
    range: { from: from.toISOString(), to: to.toISOString() },
    period_days: days,
    timezone: "Europe/Vienna",
    baseline_margin_bp: baselineBp,
    // Absent baseline => nothing is flagged and the screen says so. This codebase does
    // not get to decide what margin a Viennese cleaning contract ought to make.
    baseline_set: baselineBp !== null,
    // decision-42. The period's shape decides whether a margin is answerable at all, so it
    // is stated once at the top rather than inferred from N identical per-building reasons.
    revenue: {
      basis: "entered",
      basis_decision: "decision-42",
      // WHOLE Vienna months only. A typed payment cannot be sliced: 17/30ths of "the client
      // paid 1.250,00 in September" invents a payment schedule nobody agreed to.
      months: window.months.map((m) => String(m).slice(0, 7)),
      months_contained: window.monthsContained,
      months_touched: window.monthsTouched,
      // FALSE means the period has days hanging off a month boundary. Those days' revenue
      // is NOT sliced and NOT guessed — it is excluded and named, and every margin is null.
      month_aligned: window.aligned,
      partial_months_excluded: window.monthsTouched - window.monthsContained,
    },
    labour: {
      // The permanent, visible limitation. Not a tooltip. It SURVIVES decision-41: a rate
      // is now always SOME number, but it is still ONE MUTABLE COLUMN with no history, so
      // raising a wage still re-values last March. Deleting this line along with the
      // `unpriced_*` fields is the likeliest mistake in this change — it would make the
      // report look more certain than it is. Period-correct labour is `worker_rates` and
      // its own decision record.
      rate_basis: "current",
      rate_basis_note:
        "Arbeitskosten werden mit dem AKTUELLEN Stundensatz bewertet; es gibt keine Satzhistorie.",
    },
    materials: {
      basis: "pro_rata_labour_hours",
      basis_decision: "decision-6",
      pool_cents: poolCents,
      allocated_cents: allocated,
      // Materials were ordered but nobody worked anywhere in the period, so there is no
      // labour to split them by. Reported, never silently dropped and never spread evenly.
      unallocated_cents: poolCents - allocated,
      unallocated_reason: split === null && poolCents > 0 ? "no_payable_labour_in_period" : null,
      unpriced_requests: pool.unpriced_requests,
      priced_requests: pool.priced_requests,
    },
    buildings,
  };
}

/**
 * GET /admin/analytics — actual vs target time per building, plus a trend.
 *
 * THE TREND IS ARITHMETIC, NOT A PREDICTION. N Vienna calendar months of actual payable
 * minutes, the delta between the last two, and a direction. No regression, no forecast,
 * no "expected next month". With fewer than two months that carry any shift at all the
 * answer is `trend_reason: "insufficient_data"` and a null direction — NOT a flat line,
 * which would be a claim we have no basis for.
 *
 * ponytail: the trend is actual minutes only, with no per-month target beside it.
 * CEILING: a building whose contracted target changed mid-trend shows the time moving
 * without showing why. UPGRADE PATH: run `contractSlice` per month bucket — the same
 * day-series machinery, N times.
 */
export async function buildingAnalytics(from, to, months) {
  const [locations, contracts, labour, exclusions, days, trendRows] = await Promise.all([
    reportableLocations(from, to),
    contractSlice(from, to),
    labourByLocation(from, to),
    exclusionsByLocation(from, to),
    periodDays(from, to),
    all(
      // $1 is `to` and $2 the bucket count: the trend window is derived from the END of
      // the reported period and its own length, never from `from`. Numbered from 1 rather
      // than reusing the (from, to) pair the other queries take, because an unreferenced
      // parameter has no type Postgres can infer and raises 42P08 at runtime.
      `WITH anchor AS (
         SELECT date_trunc('month', ($1::timestamptz - interval '1 microsecond') AT TIME ZONE 'Europe/Vienna') AS m
       ),
       buckets AS (
         SELECT gs::date AS month_start,
                (gs::date::timestamp AT TIME ZONE 'Europe/Vienna')                        AS lo,
                ((gs::date + interval '1 month')::timestamp AT TIME ZONE 'Europe/Vienna') AS hi
           FROM anchor a,
                generate_series(a.m - make_interval(months => $2::int - 1), a.m, interval '1 month') AS gs
       )
       SELECT l.id AS location_id,
              to_char(b.month_start, 'YYYY-MM')                                              AS month,
              COALESCE(SUM(EXTRACT(EPOCH FROM (s.end_time - s.start_time))), 0)::bigint      AS seconds,
              count(s.id)::int                                                               AS shifts
         FROM locations l
        CROSS JOIN buckets b
         LEFT JOIN shifts s
                ON s.location_id = l.id
               AND s.end_time IS NOT NULL AND NOT (s.auto_closed AND s.corrected_at IS NULL)
               AND s.start_time >= b.lo AND s.start_time < b.hi
        GROUP BY l.id, b.month_start
        ORDER BY l.id, b.month_start`,
      [to, months],
    ),
  ]);

  const contractOf = byId(contracts);
  const labourOf = byId(labour);
  const exclusionOf = byId(exclusions);

  const trendOf = new Map();
  for (const r of trendRows) {
    if (!trendOf.has(r.location_id)) trendOf.set(r.location_id, []);
    trendOf.get(r.location_id).push({
      month: r.month,
      actual_minutes: Math.round(Number(r.seconds) / 60),
      shifts: r.shifts,
    });
  }

  const buildings = locations.map((l) => {
    const c = contractOf.get(l.id) ?? null;
    const lab = labourOf.get(l.id) ?? null;
    const ex = exclusionOf.get(l.id) ?? null;

    const actualMinutes = Math.round(Number(lab?.labour_seconds ?? 0) / 60);
    const targetMinutes = c === null || c.target_minutes === null ? null : Number(c.target_minutes);
    const trend = trendOf.get(l.id) ?? [];

    // "Enough data" means two months that actually contain shifts. Two empty months are
    // not a trend of zero, they are two months we know nothing about.
    const withData = trend.filter((t) => t.shifts > 0);
    const enough = withData.length >= 2;
    const last = trend[trend.length - 1];
    const previous = trend[trend.length - 2];
    const delta = enough && last && previous ? last.actual_minutes - previous.actual_minutes : null;

    return {
      location_id: l.id,
      slug: l.slug,
      name: l.name,
      active: l.active,
      address: l.address,
      client_id: l.client_id,
      client_name: l.client_name,
      contact_id: l.contact_id,
      contact_name: l.contact_name,

      // Map state. Never derived on the client from `lat IS NULL` alone: that cannot tell
      // "nobody has asked yet" from "we asked and Google had nothing", and
      // `geocode_status` is the further difference between a typo in the address and an
      // exhausted quota — problems with different owners (005_v2_features.sql).
      lat: l.lat,
      lng: l.lng,
      geocoded_at: l.geocoded_at,
      geocode_state: l.lat !== null ? "pinned" : l.geocoded_at === null ? "never_attempted" : "failed",
      geocode_status: l.geocode_status,
      // The building photo is rendered ONLY on 'OK'. The static Street View endpoint
      // answers 200 with a grey "no imagery" tile, so anything looser ships a grey box.
      street_view_status: l.street_view_status,

      actual_minutes: actualMinutes,
      target_minutes: targetMinutes,
      target_unknown_days: c === null ? days : c.target_unknown_days,
      variance_minutes: targetMinutes === null ? null : actualMinutes - targetMinutes,

      trend,
      trend_delta_minutes: delta,
      trend_direction: delta === null ? null : delta > 0 ? "up" : delta < 0 ? "down" : "flat",
      trend_reason: enough ? null : "insufficient_data",

      excluded_unresolved_shifts: ex?.unresolved_shifts ?? 0,
      excluded_unresolved_seconds: Number(ex?.unresolved_seconds ?? 0),
      open_shifts: ex?.open_shifts ?? 0,
    };
  });

  return {
    range: { from: from.toISOString(), to: to.toISOString() },
    period_days: days,
    timezone: "Europe/Vienna",
    trend_months: months,
    buildings,
  };
}
