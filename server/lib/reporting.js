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
//   * a building with no contract in the period      -> revenue_cents null, "no_contract"
//   * a period with no payable hours                 -> materials cannot be split at all
//   * a contract with no target_minutes_per_month    -> target_minutes null
//   * a request the admin has not priced             -> excluded from the pool AND counted
//   * a margin against zero revenue                  -> margin_bp null, "zero_revenue"
//   * a baseline nobody has set                      -> below_baseline null, nothing flagged
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
 * Revenue and target time earned by each building over the period, day by day.
 *
 * A contract is a MONTHLY figure, so a period that is not exactly one calendar month has
 * to be pro-rated. It is pro-rated by DAY against the length of that day's OWN month:
 * a day in February is worth 1/28th of the monthly fee, a day in March 1/31st. Summing
 * whole days and rounding once at the end means twelve monthly reports add up to the
 * annual one, which "monthly / 30" would not.
 *
 * `revenue_days` vs `period_days` is the honesty channel: a building priced from the 15th
 * has revenue for half the month and the caller can say so instead of showing a number
 * that looks like a full month's underperformance.
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
            ROUND(SUM(c.monthly_contract_cents::numeric / dm.days_in_month))::bigint AS revenue_cents,
            ROUND(SUM(c.target_minutes_per_month::numeric / dm.days_in_month)
                    FILTER (WHERE c.target_minutes_per_month IS NOT NULL))::bigint     AS target_minutes,
            count(*)::int                                                              AS revenue_days,
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
            SUM(secs)::bigint                                          AS labour_seconds,
            SUM(ROUND(secs * hourly_rate_cents / 3600.0))::bigint      AS labour_cents
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
  const [locations, contracts, labour, exclusions, pool, days, baselineBp] = await Promise.all([
    reportableLocations(from, to),
    contractSlice(from, to),
    labourByLocation(from, to),
    exclusionsByLocation(from, to),
    materialPool(from, to),
    periodDays(from, to),
    marginBaselineBp(),
  ]);

  const contractOf = byId(contracts);
  const labourOf = byId(labour);
  const exclusionOf = byId(exclusions);

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

    const labourSeconds = Number(lab?.labour_seconds ?? 0);
    const labourCents = Number(lab?.labour_cents ?? 0);
    const materialCents = split?.get(l.id) ?? 0;
    const revenueCents = c === null ? null : Number(c.revenue_cents);

    // No contract in the period => revenue is UNKNOWN, not zero. NULL here is what stops
    // a building nobody has priced yet from being reported as a 100% loss and "flagged".
    const profitCents = revenueCents === null ? null : revenueCents - labourCents - materialCents;
    const marginBp =
      revenueCents === null || revenueCents === 0
        ? null
        : Math.round((profitCents * 10000) / revenueCents);

    return {
      location_id: l.id,
      slug: l.slug,
      name: l.name,
      active: l.active,
      client_id: l.client_id,
      client_name: l.client_name,

      labour_seconds: labourSeconds,
      labour_minutes: Math.round(labourSeconds / 60),
      labour_cents: labourCents,
      material_cents: materialCents,

      revenue_cents: revenueCents,
      // Named so the screen prints a reason instead of a dash nobody can act on.
      revenue_unknown_reason: revenueCents === null ? "no_contract" : null,
      revenue_days: c === null ? 0 : c.revenue_days,
      period_days: days,

      target_minutes: c === null || c.target_minutes === null ? null : Number(c.target_minutes),
      target_unknown_days: c === null ? days : c.target_unknown_days,

      profit_cents: profitCents,
      margin_bp: marginBp,
      margin_unknown_reason:
        revenueCents === null ? "no_contract" : revenueCents === 0 ? "zero_revenue" : null,
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
    labour: {
      // The permanent, visible limitation. Not a tooltip.
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
