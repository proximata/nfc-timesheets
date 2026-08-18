// The runnable check for ops/backfill-geocode.mjs — the script that gives the buildings
// with no map pin a second chance at one.
//
//   DATABASE_URL=postgres:///nfc_demo node demo/check-backfill.mjs
//
// WHY IT EXISTS. The map on `/` draws pins, and production holds ONE building whose
// `lat`/`lng` are NULL and whose `geocode_status` is `no_key` — created before the key was
// installed on the machine. Nothing in the product ever asks again on its own. So this
// script is a PREREQUISITE of the map having any pins at all, and it runs from a deploy,
// against the live database, unattended. Four of its claims are therefore load-bearing and
// none of them is establishable by reading it:
//
//   1. IT FAILS SOFT. No key, a geocoder that throws, a quota error — every one of those
//      ends with exit 0 and every building in exactly the state it started in. A deploy
//      whose job is shipping the admin may not fail over a map pin.
//   2. IT IS IDEMPOTENT. Run it twice and the second run selects nothing and writes
//      nothing. „Safe to run twice" is the difference between a deploy step and a hazard.
//   3. IT NEVER OVERWRITES A FRESHER ANSWER. The write is `WHERE id = $1 AND lat IS NULL`,
//      so a pin the admin set from the panel while the loop was running survives.
//   4. IT SAYS WHAT IT CHANGED, and names the buildings it skipped. „3 übersprungen" is
//      not actionable; „Studiohaus Neubaugasse — ZERO_RESULTS" is an address to go and fix.
//
// GOOGLE IS NEVER ASKED. The geocoder is injected through `setGeocoderForTest` — the same
// seam server/check-api.js uses, for the reason server/lib/geocode.js states: a check that
// needs the internet is a check that fails on a train, and one that depends on Google's
// uptime reports their outage as our bug. The LIVE key was exercised once, by hand, against
// the live endpoint (Arsenalstraße 11 → 48.1761151, 16.3953038); that is a fact about a
// credential, not a property of this script, and it does not belong in a check that has to
// pass every time.
//
// IT WRITES TO nfc_demo AND PUTS IT BACK. It has to: the states worth checking are states
// of the `locations` table. Every row is snapshotted first and restored in `finally`, and
// the guard below refuses any database that is not the throwaway one.
import { all, pool, query } from "../server/lib/db.js";
import { setGeocoderForTest } from "../server/lib/geocode.js";
import { assertDemoDatabase } from "./db-guard.mjs";
import { backfill } from "../ops/backfill-geocode.mjs";

assertDemoDatabase(process.env.DATABASE_URL ?? "", (why) => {
  console.error(`check-backfill: ${why}`);
  process.exit(1);
});

const failures = [];
function assert(name, condition, detail = "") {
  if (condition) console.log(`  ok   ${name}${detail ? `  ${detail}` : ""}`);
  else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL ${name}${detail ? `\n         ${detail}` : ""}`);
  }
}

/** Everything the script may write, for one building. */
const COLUMNS = "id, slug, lat, lng, geocoded_at, geocode_status, street_view_status";

const rows = () => all(`SELECT ${COLUMNS} FROM locations ORDER BY slug`);
const row = async (slug) => (await all(`SELECT ${COLUMNS} FROM locations WHERE slug = $1`, [slug]))[0];

/** A comparable fingerprint of the whole table, so „nothing was written" is one assertion. */
const fingerprint = (list) =>
  list
    .map((r) => `${r.slug}|${r.lat}|${r.lng}|${r.geocoded_at?.toISOString() ?? "-"}|${r.geocode_status}|${r.street_view_status}`)
    .join("\n");

/** Swallow the script's own log lines while a block runs, so the check's output is readable. */
async function quiet(fn) {
  const real = console.log;
  const lines = [];
  console.log = (...args) => lines.push(args.join(" "));
  try {
    const result = await fn();
    return { result, log: lines.join("\n") };
  } finally {
    console.log = real;
  }
}

async function main() {
  const before = await rows();
  const restore = fingerprint(before);
  const key = process.env.GOOGLE_GEOCODING_KEY;

  try {
    // Production's exact state, put on every demo building: asked before there was a key,
    // so no pin and a status that says why. `no_key` is retryable BECAUSE the answer can
    // change without anybody editing the address — which is the whole premise of the script.
    await query("UPDATE locations SET lat = NULL, lng = NULL, geocoded_at = NULL, geocode_status = 'no_key'");
    const activeCount = Number((await all("SELECT count(*)::int AS n FROM locations WHERE active"))[0].n);

    // ==== 1 · NO KEY — a supported configuration, not a fault =============================
    // A machine without a geocoding key is a state server/lib/geocode.js explicitly
    // supports. The script must notice, say so, change nothing and exit 0.
    delete process.env.GOOGLE_GEOCODING_KEY;
    setGeocoderForTest(() => {
      throw new Error("the geocoder must not be reached without a key");
    });
    // `.catch` and not a bare await: "it does not throw" is the assertion, so the throw has
    // to become a named FAIL line rather than an uncaught exception that kills the run and
    // takes the teardown with it.
    let noKeyThrew = null;
    const noKey = await quiet(() => backfill([]).catch((err) => { noKeyThrew = err; return null; }));
    assert("no key: it does NOT throw — a deploy may not die over a map pin", noKeyThrew === null, noKeyThrew?.message ?? "");
    assert("no key: it says so in words, and does not pretend to have tried", noKey.log.includes("GOOGLE_GEOCODING_KEY is not set"), noKey.log.split("\n").at(-1));
    assert("no key: it reports zero of everything rather than a null", noKey.result?.pinned === 0 && noKey.result?.asked === 0, JSON.stringify(noKey.result));
    assert(
      "no key: every building keeps the state it had — a missing key costs nothing",
      fingerprint(await rows()) === fingerprint(await rows()) && (await row("donaufeld-101")).lat === null,
    );

    // ==== 2 · DRY RUN — it asks nothing and writes nothing ================================
    process.env.GOOGLE_GEOCODING_KEY = "test-key-never-used";
    let asked = [];
    setGeocoderForTest(async (address) => {
      asked.push(address);
      return { status: "OK", lat: 48.2, lng: 16.37, street_view_status: "OK" };
    });
    const beforeDry = fingerprint(await rows());
    const dry = await quiet(() => backfill(["--dry-run"]));
    assert("dry run: NOTHING is written — the fingerprint of the table is unchanged", fingerprint(await rows()) === beforeDry);
    assert("dry run: …and the geocoder was never called at all", asked.length === 0, `${asked.length} calls`);
    assert(
      "dry run: it names each building it WOULD ask about, with the state it is in now",
      dry.log.includes("would donaufeld-101") && dry.log.includes("[no_key]"),
      dry.log.split("\n").find((l) => l.includes("donaufeld-101")) ?? "(not named)",
    );

    // ==== 3 · THE REAL RUN — it pins what Google answers, and logs it =====================
    asked = [];
    const run = await quiet(() => backfill([]));
    assert("run: every building without a pin was asked about, once", asked.length === activeCount, `${asked.length} asked, ${activeCount} active`);
    assert("run: …and it reports what it changed, as a count", run.result.pinned === activeCount, JSON.stringify(run.result));
    const pinnedRow = await row("donaufeld-101");
    assert("run: the coordinate is on the row", Number(pinnedRow.lat) === 48.2 && Number(pinnedRow.lng) === 16.37, `${pinnedRow.lat},${pinnedRow.lng}`);
    assert("run: …with the status that produced it, so the admin panel can say „auf der Karte\"", pinnedRow.geocode_status === "OK" && pinnedRow.geocoded_at !== null);
    assert(
      "run: the log names the building and the transition, not just a total",
      run.log.includes("PIN   donaufeld-101") && run.log.includes("[no_key → OK]"),
      run.log.split("\n").find((l) => l.includes("donaufeld-101")) ?? "(not named)",
    );

    // ==== 4 · RUN IT AGAIN — the second run is a no-op ====================================
    // This is what „safe to run twice" has to mean: not „does no harm" but „selects
    // nothing". A deploy runs it on every release.
    asked = [];
    const afterFirst = fingerprint(await rows());
    const again = await quiet(() => backfill([]));
    assert("twice: the second run finds nothing to do and says so", again.log.includes("nichts zu tun"), again.log.split("\n").at(-1));
    assert("twice: …asks Google nothing", asked.length === 0, `${asked.length} calls`);
    assert("twice: …and writes nothing", fingerprint(await rows()) === afterFirst);

    // ==== 5 · ONE BUILDING'S GEOCODE BLOWS UP — the loop does not =========================
    // `geocode()` is contracted never to throw and converts an exception into
    // `noPin('unknown')` (its own outermost catch). That contract is what this asserts, and
    // the shape of the assertion is the point: ONE address explodes and the OTHERS still get
    // pins. A run that aborts on the first bad building leaves the rest unpinned and looks,
    // from the log, exactly like a run that had nothing to do.
    await query("UPDATE locations SET lat = NULL, lng = NULL, geocoded_at = NULL, geocode_status = 'no_key'");
    setGeocoderForTest(async (address) => {
      if (address.includes("Donaufelder")) throw new Error("Google is down");
      return { status: "OK", lat: 48.2, lng: 16.37, street_view_status: "OK" };
    });
    const boom = await quiet(() => backfill([]));
    assert(
      "one bad building: the loop CONTINUES — every other building still gets its pin",
      boom.result.pinned === activeCount - 1 && boom.result.stillNoPin === 1,
      JSON.stringify(boom.result),
    );
    const broke = await row("donaufeld-101");
    assert("one bad building: no coordinate is invented for it", broke.lat === null && broke.lng === null, `${broke.lat},${broke.lng}`);
    assert(
      "one bad building: …and the reason is recorded as RETRYABLE, so the next run tries again",
      broke.geocode_status === "unknown",
      broke.geocode_status,
    );
    // …and it really does try again. A transient failure that quietly became a permanent
    // skip would be the worst of both: no pin, and nothing left saying to ask for one.
    asked = [];
    setGeocoderForTest(async (address) => {
      asked.push(address);
      return { status: "OK", lat: 48.25, lng: 16.42, street_view_status: "OK" };
    });
    const retried = await quiet(() => backfill([]));
    assert(
      "one bad building: the NEXT run picks exactly that building back up",
      asked.length === 1 && asked[0].includes("Donaufelder") && retried.result.pinned === 1,
      `${asked.join(" | ")} → ${JSON.stringify(retried.result)}`,
    );

    // ==== 6 · A QUOTA ERROR — no pin, but the REASON is recorded ==========================
    // `OVER_QUERY_LIMIT` is „try again later"; `ZERO_RESULTS` is „go and fix the address".
    // The admin acts on those differently and cannot tell them apart from an empty map, so
    // the status is written even though the coordinates are not.
    await query("UPDATE locations SET lat = NULL, lng = NULL, geocode_status = 'no_key' WHERE slug = 'donaufeld-101'");
    setGeocoderForTest(async () => ({ status: "OVER_QUERY_LIMIT", lat: null, lng: null, street_view_status: null }));
    const quota = await quiet(() => backfill([]));
    const quotaRow = await row("donaufeld-101");
    assert("quota: exit is normal — a quota error is not a deploy failure", quota.result.stillNoPin === 1, JSON.stringify(quota.result));
    assert("quota: no coordinate is invented", quotaRow.lat === null);
    assert("quota: …but the reason replaces „no_key\", because it is a different problem", quotaRow.geocode_status === "OVER_QUERY_LIMIT", quotaRow.geocode_status);

    // ==== 7 · „THE ADDRESS IS THE PROBLEM" is SKIPPED, and NAMED ==========================
    // A retry cannot change a ZERO_RESULTS, so an ordinary run must not spend quota asking
    // again — and must still put the building in front of the operator, by name.
    await query("UPDATE locations SET lat = NULL, lng = NULL, geocode_status = 'ZERO_RESULTS' WHERE slug = 'donaufeld-101'");
    asked = [];
    setGeocoderForTest(async () => ({ status: "OK", lat: 48.3, lng: 16.4, street_view_status: "OK" }));
    const skip = await quiet(() => backfill([]));
    assert("hopeless address: it is not asked about again", asked.length === 0, `${asked.length} calls`);
    assert(
      "hopeless address: …it is NAMED with its status and what to do about it",
      skip.log.includes("skip  donaufeld-101") && skip.log.includes("ZERO_RESULTS") && skip.log.includes("die Adresse ist das Problem"),
      skip.log.split("\n").find((l) => l.includes("donaufeld-101")) ?? "(not named)",
    );
    assert("hopeless address: …and it still has no pin", (await row("donaufeld-101")).lat === null);

    // …unless the operator insists, which is what --all is for.
    const forced = await quiet(() => backfill(["--all"]));
    assert("--all: the operator can force the skipped ones", forced.result.pinned === 1 && Number((await row("donaufeld-101")).lat) === 48.3, JSON.stringify(forced.result));

    // ==== 8 · A FRESHER PIN IS NEVER OVERWRITTEN =========================================
    // The admin geocoding a building from the panel while this loop is running is not a
    // hypothetical: the button is on the row the loop is working through. `AND lat IS NULL`
    // is the guard, and this is what proves it is doing something.
    await query("UPDATE locations SET lat = NULL, lng = NULL, geocode_status = 'no_key' WHERE slug = 'donaufeld-101'");
    setGeocoderForTest(async () => {
      // Somebody else pins it WHILE we are waiting for Google. Same race, made deterministic.
      await query("UPDATE locations SET lat = 48.9, lng = 16.9, geocode_status = 'OK' WHERE slug = 'donaufeld-101'");
      return { status: "OK", lat: 48.2, lng: 16.37, street_view_status: "OK" };
    });
    const raced = await quiet(() => backfill([]));
    const kept = await row("donaufeld-101");
    assert("race: the pin somebody else just set is KEPT, not overwritten", Number(kept.lat) === 48.9, `${kept.lat}`);
    assert("race: …and the run says so rather than claiming a pin it did not write", raced.log.includes("keep  donaufeld-101") && raced.result.pinned === 0, JSON.stringify(raced.result));

    // ==== 9 · NO ADDRESS — nothing to geocode, and not Google's fault =====================
    await query("UPDATE locations SET lat = NULL, lng = NULL, address = '', geocode_status = 'no_key' WHERE slug = 'donaufeld-101'");
    asked = [];
    const noAddress = await quiet(() => backfill([]));
    assert("no address: it is not a round trip", asked.length === 0, `${asked.length} calls`);
    assert("no address: …and the log says which building and why", noAddress.log.includes("keine Adresse hinterlegt"), noAddress.log.split("\n").find((l) => l.includes("donaufeld-101")) ?? "(not named)");
  } finally {
    setGeocoderForTest(null);
    if (key === undefined) delete process.env.GOOGLE_GEOCODING_KEY;
    else process.env.GOOGLE_GEOCODING_KEY = key;
    // Put every row back, column by column, from the snapshot taken before anything ran.
    for (const r of before) {
      await query(
        `UPDATE locations SET lat = $2, lng = $3, geocoded_at = $4, geocode_status = $5, street_view_status = $6 WHERE id = $1`,
        [r.id, r.lat, r.lng, r.geocoded_at, r.geocode_status, r.street_view_status],
      );
    }
    await query("UPDATE locations SET address = $2 WHERE slug = $1", ["donaufeld-101", "Donaufelder Strasse 101, 1210 Wien"]);
    assert("teardown: every building is back where it started", fingerprint(await rows()) === restore);
    await pool.end();
  }

  console.log("");
  if (failures.length > 0) {
    console.log(`check-backfill: ${failures.length} FAIL`);
    for (const failure of failures) console.log(`  - ${failure}`);
    process.exit(1);
  }
  console.log("check-backfill: PASS");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
