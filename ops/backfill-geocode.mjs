#!/usr/bin/env node
/**
 * Give the buildings that have no map pin a second chance at one.
 *
 *   node ops/backfill-geocode.mjs --dry-run          # say what it WOULD ask, ask nothing
 *   node ops/backfill-geocode.mjs                    # ask Google, write the pins it gets
 *   node ops/backfill-geocode.mjs --all              # include the "the address is wrong" rows
 *   node ops/backfill-geocode.mjs --limit 20
 *
 * WHY IT EXISTS. Production holds exactly one building, HOIV / Arsenalstraße 11, and it was
 * created BEFORE `GOOGLE_GEOCODING_KEY` was installed on the machine. So its row reads
 * `lat NULL, lng NULL, geocode_status 'no_key'` — not because the address is bad, but
 * because nobody was listening when we asked. The key works now (Arsenalstraße 11 resolves
 * to 48.1761151, 16.3953038), and nothing in the product ever asks again on its own: the
 * geocoder runs at CREATE and on the admin's per-row „erneut geokodieren" button, and both
 * of those need a human who already knows the pin is missing.
 *
 * The map on `/` therefore draws zero pins until this has run once. That is what makes this
 * a PREREQUISITE and not a nicety.
 *
 * IT FAILS SOFT, EVERYWHERE, and that is the whole design (same rule as
 * server/lib/geocode.js and as decision-23 gives telemetry):
 *   - no key configured        -> says so, changes nothing, EXITS 0
 *   - Google times out / 500s  -> that building keeps its old row, the next one is tried
 *   - quota exhausted          -> the status is recorded, the run continues, exit 0
 * There is no failure mode here that is allowed to block a deploy, and none that leaves a
 * building in a worse state than it was in. A pin is an improvement, never a dependency.
 *
 * IT IS IDEMPOTENT AND SAFE TO RUN TWICE. It only ever looks at rows that have NO pin, and
 * the write is `... WHERE id = $1 AND lat IS NULL`, so a pin somebody set from the admin
 * panel while this was running is never overwritten. Running it again after a successful
 * run selects nothing and prints „nichts zu tun".
 *
 * THE KEY NEVER APPEARS HERE. It is read inside server/lib/geocode.js from the process
 * environment (/etc/nfc/env on the VM) and no URL, response body or error message from that
 * file escapes it. Nothing below prints anything but Google's fixed status vocabulary.
 *
 * ponytail: a script, run by hand or by the deploy, not a queue and not a cron. Ceiling: it
 * is serial and rate-limits itself with a fixed sleep, so a portfolio of hundreds would take
 * minutes. There is one building. Upgrade path: a `geocode_attempted_at` column and a
 * systemd timer that retries the "try again later" statuses on a backoff.
 *
 * IT IS ALSO A MODULE. `backfill()` is exported and the auto-run at the bottom only fires
 * when this file IS the command, so demo/check-backfill.mjs can drive it in-process through
 * `setGeocoderForTest` and prove the fail-soft and idempotency claims above without asking
 * Google anything. A check that needs the internet is a check that fails on a train, and one
 * that depends on Google's uptime reports their outage as our bug (server/lib/geocode.js
 * makes the same argument about the same seam).
 */
import { pathToFileURL } from "node:url";
import { all, pool, query } from "../server/lib/db.js";
import { geocode } from "../server/lib/geocode.js";

/**
 * Statuses worth asking about again, because the ANSWER can change without anybody editing
 * the address: a key that was missing has been installed, a quota has reset, a network blip
 * has passed, an API has been switched on in the Cloud console.
 *
 * `null` is in here as the "never attempted" case — a row the geocoder has never seen.
 */
const RETRYABLE = new Set([
  null,
  "no_key",
  "timeout",
  "unknown",
  "malformed",
  "OVER_QUERY_LIMIT",
  "REQUEST_DENIED",
  "UNKNOWN_ERROR",
]);

/** `network:ECONNRESET`, `http_502` — same family, but the detail is not enumerable. */
const RETRYABLE_PREFIXES = ["network:", "http_"];

/**
 * The ones a retry cannot fix, because the answer is a fact about the address the director
 * typed and it will be the same fact tomorrow. Skipped unless `--all`, so an ordinary run
 * does not spend quota re-asking a question that has already been answered.
 *
 * They are still LISTED, by name, with their status: a building that will never get a pin
 * until somebody corrects its address is exactly the thing this run should surface.
 */
const ADDRESS_IS_THE_PROBLEM = new Set([
  "ZERO_RESULTS",
  "PARTIAL_MATCH",
  "APPROXIMATE_ONLY",
  "INVALID_REQUEST",
  "no_address",
]);

function isRetryable(status) {
  if (RETRYABLE.has(status)) return true;
  return typeof status === "string" && RETRYABLE_PREFIXES.some((p) => status.startsWith(p));
}

function flag(argv, name) {
  return argv.includes(`--${name}`);
}

function option(argv, name, fallback) {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const value = argv[i + 1];
  return value === undefined || value.startsWith("--") ? fallback : value;
}

/**
 * Between calls. Google's geocoding quota is per second as well as per day, and a serial
 * loop with no gap is the shape that turns a 6-building backfill into six OVER_QUERY_LIMIT
 * rows. ponytail: a constant, not a token bucket. Ceiling: ~5 buildings/second is the
 * fastest this will ever go. Upgrade path: read the retry-after Google sends.
 */
const PAUSE_MS = 200;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param {string[]} argv  the flags, exactly as they would arrive on the command line.
 * @returns {Promise<{pinned: number, stillNoPin: number, skipped: number, asked: number}>}
 *   A COUNT OF WHAT CHANGED, so a caller — the deploy, or the check — can assert on it
 *   instead of parsing the log it printed.
 */
export async function backfill(argv = []) {
  const dryRun = flag(argv, "dry-run");
  const includeAll = flag(argv, "all");
  const limit = Number(option(argv, "limit", "500"));
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new Error("--limit must be a positive whole number");
  }

  // Say WHICH database, before anything. This script writes, and the one thing that must
  // never happen quietly is it writing somewhere the operator did not mean.
  const where = await all("SELECT current_database() AS db, inet_server_addr() AS host");
  const db = where[0]?.db ?? "?";
  console.log(`backfill-geocode: database "${db}"${dryRun ? "  (DRY RUN — nothing is written)" : ""}`);

  if (!dryRun && !process.env.GOOGLE_GEOCODING_KEY) {
    // NOT an error, and NOT a non-zero exit. A machine without a geocoding key is a
    // supported configuration (server/lib/geocode.js says so in as many words), and a
    // deploy that fails because of it would be a deploy that fails over a map pin.
    console.log("backfill-geocode: GOOGLE_GEOCODING_KEY is not set — nothing to do.");
    console.log("                  Every building keeps the state it already had.");
    return { pinned: 0, stillNoPin: 0, skipped: 0, asked: 0 };
  }

  const candidates = await all(
    `SELECT id, slug, name, address, geocode_status, geocoded_at
       FROM locations
      WHERE active AND (lat IS NULL OR lng IS NULL)
      ORDER BY created_at
      LIMIT $1`,
    [limit],
  );

  if (candidates.length === 0) {
    console.log("backfill-geocode: every active building already has coordinates — nichts zu tun.");
    return { pinned: 0, stillNoPin: 0, skipped: 0, asked: 0 };
  }

  const todo = [];
  const skipped = [];
  for (const row of candidates) {
    if (includeAll || isRetryable(row.geocode_status)) todo.push(row);
    else skipped.push(row);
  }

  console.log(
    `backfill-geocode: ${candidates.length} building(s) without a pin — ` +
      `${todo.length} to ask about, ${skipped.length} skipped`,
  );

  // The skipped ones are NAMED. „3 übersprungen" tells the operator nothing they can act on;
  // „Studiohaus Neubaugasse — ZERO_RESULTS" tells them which address to go and fix.
  for (const row of skipped) {
    const why = ADDRESS_IS_THE_PROBLEM.has(row.geocode_status)
      ? "die Adresse ist das Problem, ein erneuter Versuch ändert nichts"
      : "kein erneuter Versuch vorgesehen";
    console.log(`  skip  ${row.slug}  [${row.geocode_status ?? "—"}]  ${why}  (--all erzwingt es)`);
  }

  let pinned = 0;
  let stillNoPin = 0;
  for (const row of todo) {
    const address = (row.address ?? "").trim();
    if (address === "") {
      // No address at all is not worth a round trip, and it is not a Google problem.
      console.log(`  ---   ${row.slug}  keine Adresse hinterlegt — nichts zu geokodieren`);
      stillNoPin += 1;
      continue;
    }
    if (dryRun) {
      console.log(`  would ${row.slug}  [${row.geocode_status ?? "nie versucht"}]  ${address}`);
      continue;
    }

    // `geocode()` NEVER THROWS and always answers. That is why there is no try/catch here:
    // adding one would be dead code that hides a change in that contract.
    const result = await geocode(address);
    if (result.lat === null || result.lng === null) {
      // The status is still worth writing: „no_key" becoming „ZERO_RESULTS" is the
      // difference between „try again later" and „go and fix the address", and the admin
      // panel renders exactly that distinction.
      await query(
        `UPDATE locations
            SET geocoded_at = now(), geocode_status = $2
          WHERE id = $1 AND lat IS NULL`,
        [row.id, result.status],
      );
      console.log(`  no pin ${row.slug}  [${row.geocode_status ?? "—"} → ${result.status}]`);
      stillNoPin += 1;
    } else {
      // `AND lat IS NULL` is the concurrency guard: if the admin geocoded this building
      // from the panel while this loop was running, THEIR pin stays. Nothing here is
      // urgent enough to overwrite a fresher answer.
      const done = await query(
        `UPDATE locations
            SET lat = $2, lng = $3, geocoded_at = now(),
                geocode_status = $4, street_view_status = $5
          WHERE id = $1 AND lat IS NULL`,
        [row.id, result.lat, result.lng, result.status, result.street_view_status],
      );
      if (done.rowCount === 0) {
        console.log(`  keep  ${row.slug}  hat inzwischen bereits eine Koordinate — nicht überschrieben`);
      } else {
        console.log(
          `  PIN   ${row.slug}  [${row.geocode_status ?? "—"} → OK]  ` +
            `${result.lat.toFixed(6)},${result.lng.toFixed(6)}`,
        );
        pinned += 1;
      }
    }
    await sleep(PAUSE_MS);
  }

  console.log(
    dryRun
      ? `backfill-geocode: DRY RUN — ${todo.length} would be asked, 0 written`
      : `backfill-geocode: ${pinned} neu gepinnt, ${stillNoPin} weiterhin ohne Pin, ${skipped.length} übersprungen`,
  );
  return { pinned, stillNoPin, skipped: skipped.length, asked: dryRun ? 0 : todo.length };
}

// Only when this file IS the command. Imported — by demo/check-backfill.mjs — it is a module
// and nothing runs, which is what lets the check drive it against a stubbed geocoder.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // The catch is the outermost soft failure: an unreachable database, a permission problem,
  // a column that moved. It reports and exits 0 on purpose — this script is called from a
  // deploy whose job is shipping the admin, and a missing map pin may not fail that deploy.
  backfill(process.argv.slice(2))
    .catch((err) => {
      console.error(`backfill-geocode: aborted — ${err.message}`);
      console.error("                  No building was left in a worse state than it started in.");
    })
    .finally(() => pool.end());
}
