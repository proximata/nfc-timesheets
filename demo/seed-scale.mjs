// Additive scale seed for nfc_demo (TASK-235/236: measuring the /shifts/ and /pl/ ceiling
// fixes against something closer to a second client than one building and no work).
//
// GROWS the existing demo/seed.sql fixture — 6 buildings, 7 workers, 351 shifts — up to
// the 8 buildings / 20 workers backlog/docs/STATE-OF-THE-PRODUCT.md measures its "20-worker
// operation writes ~440-880 shifts a month" claim against, and adds two months of shifts at
// that density. It does NOT truncate anything demo/seed.sql owns and is safe to run after
// it, once, on top of what is there — re-running skips locations/workers that already exist
// (ON CONFLICT DO NOTHING) but WILL insert another two months of shifts, so it is additive
// and not idempotent on the shift count. Run it once per measurement.
//
// LOCAL ONLY: uses demo/db-guard.mjs, the same guard demo/make-admin.mjs and
// demo/demo-server.mjs use — nfc_demo, on this machine, and refuses every way a hostname can
// sneak past a naive check (?host=, $PGHOST — see db-guard.mjs's own header).
//
//   DATABASE_URL=postgres:///nfc_demo node demo/seed-scale.mjs
import { pool, query } from "../server/lib/db.js";
import { assertDemoDatabase } from "./db-guard.mjs";

assertDemoDatabase(process.env.DATABASE_URL ?? "", (why) => {
  console.error(`seed-scale: ${why}`);
  process.exit(1);
});

// Real Vienna street addresses (so geocoding has something to chew on, same convention as
// demo/seed.sql), fictional buildings — matching its existing six.
const NEW_LOCATIONS = [
  {
    slug: "meidlinger-77",
    name: "Wohnhausanlage Meidlinger Hauptstrasse",
    address: "Meidlinger Hauptstrasse 77, 1120 Wien",
  },
  { slug: "prater-12", name: "Buerohaus Praterstrasse", address: "Praterstrasse 12, 1020 Wien" },
];

// Thirteen more workers, alongside demo/seed.sql's existing seven, for twenty total.
// Fictional, matching its existing roster's mix.
const NEW_WORKERS = [
  ["Katarzyna Wozniak", 1410],
  ["Mehmet Yildiz", 1530],
  ["Ivana Horvat", 1370],
  ["Milan Jovanovic", 1490],
  ["Aylin Sahin", 1440],
  ["Dariusz Kowalski", 1520],
  ["Branka Petrovic", 1360],
  ["Emre Aydin", 1470],
  ["Zofia Kaminska", 1400],
  ["Vlado Kovac", 1560],
  ["Fatima Celik", 1330],
  ["Igor Novak", 1580],
  ["Barbara Krol", 1420],
];

// How many whole PAST Vienna calendar months to fill, and how dense: ~85% of weekdays
// worked, one shift per worker per day, 8 buildings picked at random per shift. At 20
// workers this lands in the 440-880/month range the docs measure against, on purpose.
//
// START/COUNT are overridable so a second run can fill FURTHER-back months instead of
// re-stacking the same ones (re-running with the defaults would double-book the same two
// months with overlapping duplicate shifts) — used once here to push the total ledger past
// the 2000-row ceiling on purpose, to measure truncation honestly at real volume rather
// than only in the isolated boundary test.
const MONTHS_BACK_START = Number(process.env.SEED_MONTHS_BACK_START ?? 1);
const MONTHS_BACK = Number(process.env.SEED_MONTHS_BACK_COUNT ?? 2);
const ATTENDANCE = 0.85;

async function main() {
  for (const loc of NEW_LOCATIONS) {
    await query(
      "INSERT INTO locations (slug, name, address, active) VALUES ($1, $2, $3, true) ON CONFLICT (slug) DO NOTHING",
      [loc.slug, loc.name, loc.address],
    );
  }
  for (const [name, rate] of NEW_WORKERS) {
    const email = `${name.split(" ")[0].toLowerCase()}@example.test`;
    await query(
      "INSERT INTO workers (name, email, hourly_rate_cents, active) VALUES ($1, $2, $3, true) ON CONFLICT (email) DO NOTHING",
      [name, email, rate],
    );
  }

  const locations = (await query("SELECT id FROM locations WHERE active ORDER BY id")).rows.map((r) => r.id);
  const workers = (await query("SELECT id FROM workers WHERE active ORDER BY id")).rows.map((r) => r.id);
  console.log(`buildings (active): ${locations.length}`);
  console.log(`workers (active): ${workers.length}`);

  const now = new Date();
  let inserted = 0;
  for (let m = MONTHS_BACK_START; m < MONTHS_BACK_START + MONTHS_BACK; m++) {
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - m, 1));
    const daysInMonth = new Date(
      Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0),
    ).getUTCDate();
    let monthCount = 0;
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth(), day));
      if (date.getUTCDay() === 0) continue; // no Sunday shifts
      for (const workerId of workers) {
        if (Math.random() > ATTENDANCE) continue;
        const locationId = locations[Math.floor(Math.random() * locations.length)];
        const startHour = 6 + Math.floor(Math.random() * 3); // 06:00-08:59
        const durationMin = 90 + Math.floor(Math.random() * 150); // 1.5h-4h
        const start = new Date(
          Date.UTC(
            date.getUTCFullYear(),
            date.getUTCMonth(),
            date.getUTCDate(),
            startHour,
            Math.floor(Math.random() * 60),
          ),
        );
        const end = new Date(start.getTime() + durationMin * 60_000);
        await query(
          "INSERT INTO shifts (worker_id, location_id, start_time, end_time) VALUES ($1, $2, $3, $4)",
          [workerId, locationId, start.toISOString(), end.toISOString()],
        );
        inserted++;
        monthCount++;
      }
    }
    console.log(`${monthStart.toISOString().slice(0, 7)}: ${monthCount} shifts`);
  }

  console.log(`shifts inserted this run: ${inserted}`);
  const total = (await query("SELECT count(*)::int AS n FROM shifts")).rows[0].n;
  console.log(`shifts total in nfc_demo: ${total}`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
