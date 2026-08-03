#!/usr/bin/env node
// Geocode every building that has an address and no pin yet.
//
//   sudo bash -c 'set -a; . /etc/nfc/env; set +a; node /srv/nfc/bin/geocode-backfill.js'
//
// WHY A SCRIPT AND NOT PART OF THE MIGRATION: 005 runs inside `psql -1` and a migration
// that reaches out to the internet can hang a deploy behind somebody else's timeout, or
// half-apply. Coordinates are data the product can live entirely without (the map lists
// unpinned buildings beside itself rather than dropping them), so they are not schema.
//
// SAFE TO RE-RUN. It only touches rows with lat IS NULL, so a building that already has a
// pin is never re-queried and never overwritten — including one whose pin an admin
// corrected by hand.
//
// --retry-failed also re-attempts rows we have already asked about and got nothing for
// (geocoded_at set, lat still NULL). Off by default: without a key or with a wrong
// address those rows fail every time, and a nightly re-run of them is just quota burnt on
// the same answer.
//
// Needs DATABASE_URL. GOOGLE_GEOCODING_KEY is OPTIONAL: with no key this reports that
// every row was skipped and exits 0, because "not configured" is a supported state, not a
// failure (lib/geocode.js).
import { all, one, pool, query } from "../lib/db.js";
import { geocode } from "../lib/geocode.js";

const retryFailed = process.argv.includes("--retry-failed");

if (!process.env.DATABASE_URL) {
  console.error("geocode-backfill: DATABASE_URL is not set");
  process.exit(1);
}

// The key is never printed, only whether there is one. A log line is a place a credential
// gets read by someone who should not have it.
if (!process.env.GOOGLE_GEOCODING_KEY) {
  console.log("geocode-backfill: GOOGLE_GEOCODING_KEY is not set — nothing to do");
  await pool.end();
  process.exit(0);
}

const targets = await all(
  `SELECT id, slug, name, address FROM locations
    WHERE address IS NOT NULL AND btrim(address) <> '' AND lat IS NULL
      AND ($1 OR geocoded_at IS NULL)
    ORDER BY name`,
  [retryFailed],
);

console.log(`geocode-backfill: ${targets.length} building(s) to look up`);

let pinned = 0;
for (const location of targets) {
  const geo = await geocode(location.address);
  await query(
    "UPDATE locations SET lat = $2, lng = $3, geocode_status = $4, street_view_status = $5, geocoded_at = now() WHERE id = $1",
    [location.id, geo.lat, geo.lng, geo.status, geo.street_view_status],
  );
  if (geo.lat !== null) pinned += 1;
  // The SLUG, never the id: locations.id is what the NFC tags carry (decision-21) and has
  // no business in a deploy log. Coordinates are printed because they are the thing being
  // checked, and a building's street address is already in the panel. The status is
  // printed on a miss because PARTIAL_MATCH (fix the address) and OVER_QUERY_LIMIT (run
  // it again tomorrow) need different people to do different things.
  console.log(
    geo.lat !== null
      ? `  pinned  ${location.slug}  ${geo.lat},${geo.lng}  street_view=${geo.street_view_status ?? "unknown"}`
      : `  no pin  ${location.slug}  ${geo.status}  (the building is unchanged and still usable)`,
  );
}

const remaining = await one("SELECT count(*)::int AS n FROM locations WHERE active AND lat IS NULL");
console.log(`geocode-backfill: ${pinned}/${targets.length} pinned, ${remaining.n} active building(s) still without one`);

await pool.end();
