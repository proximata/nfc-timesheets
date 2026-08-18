// The states demo/shoot-ia.mjs CANNOT reach, photographed in the same four configurations.
//
//   cd web && NEXT_PUBLIC_GOOGLE_MAPS_KEY="$(cd .. && psst get NEXT_PUBLIC_GOOGLE_MAPS_KEY)" \
//     NEXT_PUBLIC_API_BASE_URL="" NEXT_PUBLIC_DEFAULT_LOCALE=de pnpm build && cd ..
//   DATABASE_URL=postgres:///nfc_demo APP_KEY=… PORT=8080 PUBLIC_DIR="$PWD/web/out" \
//     node demo/demo-server.mjs &
//   node demo/shoot-states.mjs
//
// shoot-ia.mjs photographs the fourteen screens, the twelve query-parameter states and the
// map's four degraded ones. It cannot photograph:
//
//   TRANSIENT   loading / error / offline / 401 — they last milliseconds and then stop
//               existing. Produced here by patching `window.fetch` INSIDE THE PAGE, after
//               sign-in, through Page.addScriptToEvaluateOnNewDocument. A loading screen is
//               a fetch that never settles; there is no other way to hold one still.
//   MONEY       a worker with NO hourly rate. The constraint is that such a worker is a
//               NAMED, COUNTED EXCLUSION and never „0,00 €" — and nfc_demo seeds a rate on
//               all eight workers, so the surface that must never lie has never been looked
//               at. Same for a margin baseline: `app_settings` ships empty, so /pl/ has only
//               ever been seen in its „kein Vergleichswert" branch and its flagged blocks —
//               the actual output of the screen — were unphotographed.
//   PORTAL      `portal_grants` is empty in nfc_demo, so the ONE screen a person outside the
//               company ever sees has no ready state to photograph.
//   ROW COUNT   one row, and no rows at all. This project has repeatedly asserted over zero
//               rows and called it a pass; the reverse trap is asserting over 351 shifts and
//               never seeing what six months of nothing looks like.
//
// A state you cannot produce is a state you cannot judge. Everything below is produced.
//
// THE DATABASE IS MUTATED, and that is the point of phase 2. Before a single UPDATE runs a
// `pg_dump -Fc` goes to /tmp, the restore is in a `finally`, and the run ENDS by comparing
// every table's row count against the counts taken before it started. A probe killed
// mid-run skips its finally — so the dump on disk, not the finally, is the actual guarantee.
//
// It asserts nothing about taste. It captures, and it names every file after what it shows.
// No new dependency: demo/cdp.mjs, Node, the Chrome already on the machine.
import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { attach, launchChrome, sleep } from "./cdp.mjs";

const BASE = process.env.DEMO_BASE ?? "http://127.0.0.1:8080";
const DB = process.env.DEMO_DB ?? "nfc_demo";
const OUT = process.env.SHOOT_OUT
  ? process.env.SHOOT_OUT.replace(/\/?$/, "/")
  : new URL("../docs/media/states/", import.meta.url).pathname;
const DUMP = "/tmp/gallery/nfc_demo-before-states.dump";

const host = new URL(BASE).hostname;
if (!["127.0.0.1", "localhost", "[::1]", "::1"].includes(host)) {
  console.error(`shoot-states: refusing to shoot "${host}" — loopback only.`);
  process.exit(1);
}
// This script DELETEs rows. The one database it may ever touch is the throwaway one — the
// same refusal demo/seed.sql and demo/make-admin.mjs make, for the same reason.
if (DB !== "nfc_demo") {
  console.error(`shoot-states: refusing to write to "${DB}" — nfc_demo only.`);
  process.exit(1);
}

const ADMIN = { email: "demo@example.test", password: "demo-nur-lokal-2026" };
const sql = (q) => execFileSync("psql", ["-d", DB, "-tAc", q], { encoding: "utf8" }).trim();
const exec = (q) => execFileSync("psql", ["-d", DB, "-v", "ON_ERROR_STOP=1", "-q", "-c", q], { encoding: "utf8" });

mkdirSync(OUT, { recursive: true });
mkdirSync("/tmp/gallery", { recursive: true });

const TABLES = sql(
  "SELECT string_agg(table_name, ' ' ORDER BY table_name) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'",
).split(" ");
const fingerprint = () => TABLES.map((t) => `${t} ${sql(`SELECT count(*) FROM ${t}`)}`).join("\n");

const BEFORE = fingerprint();
writeFileSync("/tmp/gallery/db-fingerprint-before.txt", `${BEFORE}\n`);
execFileSync("pg_dump", ["-Fc", "-f", DUMP, DB]);
console.log(`shoot-states: dump -> ${DUMP}`);
console.log(BEFORE.replace(/^/gm, "  "));

async function freePort(from) {
  for (let port = from; port < from + 80; port++) {
    const ok = await new Promise((resolve) => {
      const probe = createServer();
      probe.once("error", () => resolve(false));
      probe.once("listening", () => probe.close(() => resolve(true)));
      probe.listen(port, "127.0.0.1");
    });
    if (ok) return port;
  }
  throw new Error(`no free debugging port in ${from}..${from + 80}`);
}

const CONFIGS = [
  { w: 1680, h: 1000, theme: "dark", mobile: false },
  { w: 1680, h: 1000, theme: "light", mobile: false },
  { w: 390, h: 844, theme: "dark", mobile: true },
  { w: 390, h: 844, theme: "light", mobile: true },
].filter((c) => !process.env.IA_CONFIG || `${c.w}-${c.theme}` === process.env.IA_CONFIG);

const shots = [];

/**
 * Viewport shot, always. `captureBeyondViewport` blanks the Google map AND leaves it blank
 * in every later capture of the same page (measured — see demo/shoot-ia.mjs), and half the
 * states here are on `/`. A full-page clip is also the wrong picture for a state whose whole
 * point is what the director sees before scrolling.
 */
async function shot(page, file, note) {
  const { data } = await page.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`${OUT}${file}`, Buffer.from(data, "base64"));
  const seen = await page.eval(`(() => {
    const de = document.documentElement
    const main = document.querySelector('main') || document.body
    return {
      theme: de.getAttribute('data-theme'),
      h1: (document.querySelector('h1')?.textContent || '').trim(),
      alert: [...document.querySelectorAll('[role=alert]')].map(e => e.textContent.trim()).filter(Boolean).join(' | '),
      status: [...document.querySelectorAll('[role=status]')].map(e => e.textContent.trim()).filter(Boolean).join(' | ').slice(0, 300),
      path: location.pathname + location.hash,
      text: (main.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 400),
      overflow: de.scrollWidth > de.clientWidth + 1 ? de.scrollWidth : 0,
    }
  })()`);
  shots.push({ file, note, ...seen });
  console.log(`  ${file.padEnd(46)} ${seen.overflow ? `OVERFLOW ${seen.overflow}px ` : ""}${(seen.alert || seen.status || seen.text).slice(0, 90)}`);
  return seen;
}

async function signIn(page) {
  await page.goto("about:blank", { settle: 60 });
  await page.goto(`${BASE}/login/`, { settle: 500 });
  await page.waitFor(`document.querySelector('form button[type="submit"]')`, { label: "sign-in button" });
  await page.type('input[name="email"]', ADMIN.email, { perChar: 0 });
  await page.type('input[name="password"]', ADMIN.password, { perChar: 0 });
  await page.clickText("Anmelden", { selector: 'form button[type="submit"]' });
  await page.waitFor("location.pathname === '/'", { label: "dashboard after sign-in", timeout: 20000 });
  await sleep(700);
}

/**
 * Install a fetch patch that survives navigation, and hand back its uninstaller.
 *
 * `Page.addScriptToEvaluateOnNewDocument` runs BEFORE the app's own bundle, which is the
 * only ordering in which a patched `fetch` is the one React ever sees. It is installed
 * AFTER sign-in, so the login round trip is real and the session cookie is a real cookie.
 */
async function patchFetch(page, body) {
  const { identifier } = await page.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `(() => {
      const real = window.fetch
      window.fetch = async (input, init) => {
        const url = String(input && input.url ? input.url : input)
        ${body}
        return real(input, init)
      }
    })()`,
  });
  return () => page.send("Page.removeScriptToEvaluateOnNewDocument", { identifier });
}

// `/admin/data` is NOT enough: /pl/ and /analytics/ have their own endpoints, so hanging
// only the dashboard's fetch produced a „loading" screenshot of /pl/ FULLY LOADED. Caught by
// reading the probe text next to the file name, which is the whole reason it is logged.
const HANG = `if (url.includes('/admin/')) return new Promise(() => {})`;
const FAIL500 = `if (url.includes('/admin/')) return new Response('{"error":"boom"}', { status: 500, headers: { 'content-type': 'application/json' } })`;
const FAIL401 = `if (url.includes('/admin/')) return new Response('{"error":"unauthorised"}', { status: 401, headers: { 'content-type': 'application/json' } })`;
const OFFLINE = `if (url.includes('/admin/')) throw new TypeError('Failed to fetch')`;
const PORTAL_429 = `if (url.includes('/portal/')) return new Response('{"error":"too_many"}', { status: 429, headers: { 'content-type': 'application/json' } })`;
const PORTAL_500 = `if (url.includes('/portal/')) return new Response('{"error":"boom"}', { status: 500, headers: { 'content-type': 'application/json' } })`;

/**
 * Navigate, ALWAYS through about:blank first.
 *
 * `cdp.mjs`'s `goto` waits for `Page.loadEventFired`, and a navigation that changes only the
 * URL FRAGMENT is a same-document navigation: no load event is ever fired and the wait hangs
 * for ever. Two portal states in a row differ only in their `#k=` token, and the run sat on
 * one of them for three minutes before this was found. Going through about:blank makes every
 * hop a real document load, at the cost of one extra navigation.
 */
const visit = async (page, url, settle = 1500) => {
  await page.goto("about:blank", { settle: 60 });
  // And a DEADLINE, because the failure above was silent: `goto` waiting on an event that
  // will never arrive looks exactly like a slow page. A hang must fail, loudly.
  await Promise.race([
    page.goto(`${BASE}${url}`, { settle }),
    sleep(45_000).then(() => {
      throw new Error(`navigation to ${url} never fired a load event`);
    }),
  ]);
};

/** A settled screen: a table, a list, a form, an empty state, a notice or an error. */
async function settled(page, label) {
  try {
    await page.waitFor(
      `document.querySelectorAll('table.data-table tbody tr, .row, .empty-state, form, .notice, .form-error:not(:empty), [role=alert]:not(:empty), .portal-card').length > 0`,
      { timeout: 10000, label },
    );
  } catch {
    console.log(`    warn: ${label} rendered nothing in 10s`);
  }
  await sleep(500);
}

// ---------------------------------------------------------------------------------------
// The building ids the states are built around, read from the database rather than typed.
// ---------------------------------------------------------------------------------------
const PINNED = sql("SELECT id FROM locations WHERE active AND lat IS NOT NULL ORDER BY name LIMIT 1");
const HOT = sql(
  "SELECT location_id FROM shifts GROUP BY 1 ORDER BY count(*) DESC LIMIT 1",
);
/** The busiest worker: taking their rate away is the loudest possible version of the bug. */
const RICH_WORKER = sql("SELECT worker_id FROM shifts GROUP BY 1 ORDER BY count(*) DESC LIMIT 1");
const RICH_NAME = sql(`SELECT name FROM workers WHERE id = ${RICH_WORKER}`);
const GHOST_UUID = "00000000-0000-4000-8000-000000000000";

// ---------------------------------------------------------------------------------------
// PHASE 1 — the transient states, and the ones a bad URL produces. No DB mutation.
// ---------------------------------------------------------------------------------------
async function phase1(page, cfg, tag) {
  // --- loading: a fetch that never settles ---------------------------------------------
  let off = await patchFetch(page, HANG);
  for (const [name, url] of [
    ["home", "/"],
    ["shifts", "/shifts/"],
    ["payroll", "/payroll/"],
    ["pl", "/pl/"],
    ["analytics", "/analytics/"],
  ]) {
    await visit(page, url);
    await shot(page, `state-loading-${name}-${tag}.png`, "the API never answers");
  }
  await off();

  // --- error: the server answered 500 --------------------------------------------------
  off = await patchFetch(page, FAIL500);
  for (const [name, url] of [
    ["home", "/"],
    ["shifts", "/shifts/"],
    ["payroll", "/payroll/"],
    ["workers", "/workers/"],
  ]) {
    await visit(page, url, 1200);
    await settled(page, `${name} error`);
    await shot(page, `state-error500-${name}-${tag}.png`, "GET /admin/data -> 500");
  }
  await off();

  // --- offline: the request never left the machine -------------------------------------
  off = await patchFetch(page, OFFLINE);
  for (const [name, url] of [
    ["home", "/"],
    ["shifts", "/shifts/"],
  ]) {
    await visit(page, url, 1200);
    await settled(page, `${name} offline`);
    await shot(page, `state-offline-${name}-${tag}.png`, "fetch rejects — offline / blocked");
  }
  await off();

  // --- 401: the session expired under the director ------------------------------------
  // What is photographed here is the CONSEQUENCE. There is no 401 screen by design
  // (`router.replace('/login/')`), and whether the redirect says anything is the question.
  off = await patchFetch(page, FAIL401);
  await visit(page, "/payroll/", 2000);
  await sleep(1200);
  await shot(page, `state-401-from-payroll-${tag}.png`, "session expired mid-session -> redirect");
  await off();
  // Re-establish: the 401 above may have dropped us on /login/ with a live cookie anyway.
  await visit(page, "/", 1200);
  if (await page.eval("location.pathname === '/login/'")) await signIn(page);

  // --- object parameters that name nothing ---------------------------------------------
  for (const [name, url, note] of [
    ["ghost-worker", "/workers/?worker=999999", "?worker= names nobody"],
    ["ghost-location", `/?location=${GHOST_UUID}`, "well-formed uuid naming no building"],
    ["malformed-location", "/?location=not-a-uuid", "?location= is not a uuid at all"],
    ["uppercased-location", `/?location=${PINNED.toUpperCase()}`, "the tag URI's uuid, uppercased (decision-21)"],
    ["unknown-period", "/shifts/?period=letzterMonat", "a period id from another vocabulary"],
    ["nonsense-param", "/shifts/?nonsense=1&state=banana", "parameters this app does not have"],
  ]) {
    await visit(page, url, 2200);
    await settled(page, name);
    await shot(page, `state-badurl-${name}-${tag}.png`, note);
  }

  // --- the two forms, in their rejection states ----------------------------------------
  await visit(page, "/account/", 900);
  await page.type('input[name="current"]', "wrong-one", { perChar: 0 });
  await page.type('input[name="next"]', "abc", { perChar: 0 });
  await page.type('input[name="repeat"]', "abcd", { perChar: 0 });
  await page.clickText("Passwort ändern", { selector: 'form button[type="submit"]' }).catch(() => {});
  await sleep(900);
  await shot(page, `state-form-account-rejected-${tag}.png`, "password too short / mismatch / wrong current");

  await visit(page, "/login/", 900);
  await page.type('input[name="email"]', "schimmer", { perChar: 0 });
  await page.type('input[name="password"]', "definitely-not-it", { perChar: 0 });
  await page.clickText("Anmelden", { selector: 'form button[type="submit"]' });
  await sleep(1400);
  await shot(page, `state-form-login-failed-${tag}.png`, "one message for every rejected credential");
  await signIn(page);

  // --- the portal's two server failures -------------------------------------------------
  // Patched rather than provoked: the real 429 comes from FAIL_LIMIT=5 consecutive bad
  // tokens, and spending that budget here would turn the NEXT state's honest 404 into a
  // 429 and mislabel the picture. The token only has to be the right SHAPE — the patch
  // answers before the request means anything.
  for (const [name, token, patch, note] of [
    ["toomany", "t".repeat(43), PORTAL_429, "GET /portal/<token> -> 429, the rate limit a shared office IP hits"],
    ["failed", "f".repeat(43), PORTAL_500, "GET /portal/<token> -> 500"],
  ]) {
    const offPortal = await patchFetch(page, patch);
    await visit(page, `/reinigung/#k=${token}`, 1600);
    await settled(page, `portal ${name}`);
    await shot(page, `state-portal-${name}-${tag}.png`, note);
    await offPortal();
  }
}

// ---------------------------------------------------------------------------------------
// PHASE 2 — states that only exist if something writes them. Each scenario applies its own
// SQL, is photographed in all four configurations, and is reverted before the next one.
// ---------------------------------------------------------------------------------------
const PORTAL_TOKEN_OK = randomBytes(32).toString("base64url");
const PORTAL_TOKEN_EMPTY = randomBytes(32).toString("base64url");
const PORTAL_TOKEN_DEAD = randomBytes(32).toString("base64url");
const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");

const SCENARIOS = [
  {
    // ZERO, not NULL: `workers.hourly_rate_cents` is NOT NULL and 0 is how this schema spells
    // „no rate stored". nfc_demo already ships two workers at 0 — but the busiest earner is
    // not one of them, so the biggest version of the bug (the largest sum missing from the
    // payout) had never been on screen.
    name: "norate",
    why: `„${RICH_NAME}" is the busiest worker and has NO hourly rate — the eight-surface money rule`,
    apply: () => exec(`UPDATE workers SET hourly_rate_cents = 0 WHERE id = ${RICH_WORKER}`),
    revert: () => {},
    screens: [
      ["payroll", "/payroll/?period=thisYear"],
      ["payroll-lastmonth", "/payroll/"],
      ["pl", "/pl/?period=thisYear"],
      ["workers", "/workers/"],
      ["home", "/"],
    ],
    bottom: ["payroll", "payroll-lastmonth", "pl"],
  },
  {
    name: "baseline",
    why: "a margin baseline of 25% is set, so /pl/ finally flags buildings",
    apply: () => exec("INSERT INTO app_settings (key, value) VALUES ('pl_margin_baseline_bp', '2500') ON CONFLICT (key) DO UPDATE SET value = excluded.value"),
    revert: () => exec("DELETE FROM app_settings WHERE key = 'pl_margin_baseline_bp'"),
    screens: [
      ["pl", "/pl/?period=thisYear"],
      ["pl-scoped", `/pl/?period=thisYear&location=${HOT}`],
    ],
    bottom: ["pl", "pl-scoped"],
  },
  {
    name: "portal",
    why: "three client links: one with cleanings, one with none, one revoked",
    apply: () => {
      // nfc_demo has no building without shifts, so „der Kunde öffnet den Link und es ist
      // noch nichts passiert" cannot be reached without creating one. It doubles as D1's
      // brand-new-building state on /locations/ and /analytics/.
      exec(
        "INSERT INTO locations (name, slug, address, active) VALUES " +
          "('Neubau Testgasse 1', 'testgasse-1', 'Testgasse 1, 1010 Wien', true)",
      );
      const fresh = sql("SELECT id FROM locations WHERE slug = 'testgasse-1'");
      exec(
        "INSERT INTO portal_grants (token_hash, contact_id, location_id) VALUES " +
          `('${sha256(PORTAL_TOKEN_OK)}', 1, '${HOT}'), ` +
          `('${sha256(PORTAL_TOKEN_EMPTY)}', 1, '${fresh}'), ` +
          `('${sha256(PORTAL_TOKEN_DEAD)}', 2, '${PINNED}')`,
      );
      exec(`UPDATE portal_grants SET revoked_at = now() WHERE token_hash = '${sha256(PORTAL_TOKEN_DEAD)}'`);
    },
    revert: () => {},
    restoreAfter: true,
    screens: [
      ["ready", `/reinigung/#k=${PORTAL_TOKEN_OK}`],
      ["empty", `/reinigung/#k=${PORTAL_TOKEN_EMPTY}`],
      // Both of these spend one of the FIVE consecutive failures the rate limiter allows
      // per IP, so they are shot in the two DARK configurations only: eight of them across
      // four configurations trips the lockout and turns the last picture into a 429 wearing
      // the caption „revoked". `notoken` is answered in the page and sends nothing.
      ["revoked", `/reinigung/#k=${PORTAL_TOKEN_DEAD}`, ["1680-dark", "390-dark"]],
      ["badtoken", `/reinigung/#k=${"y".repeat(43)}`, ["1680-dark", "390-dark"]],
      ["notoken", "/reinigung/"],
      // The new building, seen from the admin side: no tag, no shift, no contract.
      ["admin-newbuilding", "/locations/?state=noTag"],
    ],
    noAuth: false,
  },
  {
    name: "onerow",
    why: "one building, one worker, one shift — week one of a real client",
    apply: () => {
      exec(
        "DELETE FROM shifts WHERE id <> (SELECT id FROM shifts WHERE end_time IS NOT NULL AND auto_closed = false ORDER BY start_time DESC LIMIT 1)",
      );
      // material_requests.worker_id is a FOREIGN KEY, so the queue has to shrink to the
      // surviving worker BEFORE the workers table does, or the delete below is rejected.
      exec("DELETE FROM material_requests WHERE worker_id NOT IN (SELECT worker_id FROM shifts)");
      exec("DELETE FROM material_requests WHERE id <> (SELECT min(id) FROM material_requests)");
      exec("DELETE FROM workers WHERE id NOT IN (SELECT worker_id FROM shifts)");
      exec("UPDATE locations SET active = (id IN (SELECT location_id FROM shifts))");
    },
    revert: () => {},
    screens: [
      ["home", "/"],
      ["shifts", "/shifts/?period=all"],
      ["payroll", "/payroll/?period=thisYear"],
      ["pl", "/pl/?period=thisYear"],
      ["workers", "/workers/"],
      ["locations", "/locations/"],
      ["analytics", "/analytics/"],
    ],
    bottom: ["home", "shifts", "payroll", "pl"],
    restoreAfter: true,
  },
  {
    name: "empty",
    why: "day zero: nothing has been created and nothing has been tapped",
    // FK ORDER, and it is not the obvious one: `locations` points AT `contacts` and
    // `clients` (locations_contact_id_fkey), so the buildings go before the people who own
    // them. Deleting contacts first is rejected, which is how this scenario failed once.
    // `admins` and `sessions` are deliberately kept: dropping the session logs the shoot out
    // and every following picture is the login screen.
    apply: () => {
      for (const table of [
        "shifts",
        "material_requests",
        "portal_grants",
        "location_contracts",
        "locations",
        "contacts",
        "clients",
        "inventory_items",
        "workers",
        "app_settings",
      ]) {
        exec(`DELETE FROM ${table}`);
      }
    },
    revert: () => {},
    screens: [
      ["home", "/"],
      ["shifts", "/shifts/?period=all"],
      ["payroll", "/payroll/"],
      ["pl", "/pl/?period=thisYear"],
      ["workers", "/workers/"],
      ["locations", "/locations/"],
      ["clients", "/clients/"],
      ["contracts", "/contracts/"],
      ["inventory", "/inventory/"],
      ["materials", "/material-requests/"],
      ["analytics", "/analytics/"],
    ],
    bottom: ["home"],
    restoreAfter: true,
  },
];

/** pg_restore over the dump taken before anything was touched. */
function restoreDb(why) {
  console.log(`\nshoot-states: restoring nfc_demo from the dump (${why})`);
  execFileSync("pg_restore", ["--clean", "--if-exists", "--no-owner", "-d", DB, DUMP], {
    stdio: ["ignore", "ignore", "pipe"],
  });
}

async function withBrowser(cfg, drive) {
  const { child, port } = await launchChrome({ port: await freePort(9700), width: cfg.w, height: cfg.h });
  const page = await attach(port);
  try {
    await page.send("Emulation.setDeviceMetricsOverride", {
      width: cfg.w,
      height: cfg.h,
      deviceScaleFactor: 1,
      mobile: cfg.mobile,
    });
    await page.goto(`${BASE}/login/`, { settle: 300 });
    await page.eval(`localStorage.setItem('nfcts.theme', ${JSON.stringify(cfg.theme)})`);
    await drive(page);
  } finally {
    page.close();
    child.kill();
  }
}

try {
  // ---- phase 1 -------------------------------------------------------------------------
  // STATES_PHASE=2 re-runs only the seeded half, so one broken scenario does not cost the
  // ninety transient pictures that already came out right.
  for (const cfg of process.env.STATES_PHASE === "2" ? [] : CONFIGS) {
    const tag = `${cfg.w}-${cfg.theme}`;
    console.log(`\n=== transient + bad-URL states · ${tag} ===`);
    await withBrowser(cfg, async (page) => {
      await signIn(page);
      await phase1(page, cfg, tag);
    });
  }

  // ---- phase 2 -------------------------------------------------------------------------
  const only = process.env.STATES_ONLY ? new Set(process.env.STATES_ONLY.split(",")) : null;
  for (const scenario of SCENARIOS) {
    if (only && !only.has(scenario.name)) continue;
    console.log(`\n### ${scenario.name} — ${scenario.why}`);
    scenario.apply();
    try {
      for (const cfg of CONFIGS) {
        const tag = `${cfg.w}-${cfg.theme}`;
        console.log(`  --- ${scenario.name} · ${tag}`);
        await withBrowser(cfg, async (page) => {
          if (!scenario.noAuth) await signIn(page);
          for (const [name, url, onlyTags] of scenario.screens) {
            if (onlyTags && !onlyTags.includes(tag)) continue;
            await visit(page, url, 1800);
            await settled(page, `${scenario.name}/${name}`);
            await shot(page, `state-${scenario.name}-${name}-${tag}.png`, scenario.why);
            if (scenario.bottom?.includes(name)) {
              await page.eval("window.scrollTo(0, document.documentElement.scrollHeight)");
              await sleep(700);
              await shot(page, `state-${scenario.name}-${name}-${tag}-bottom.png`, `${scenario.why} (bottom)`);
            }
          }
        });
      }
    } finally {
      if (scenario.restoreAfter) restoreDb(`after ${scenario.name}`);
      else scenario.revert();
    }
  }
} finally {
  // ---- the proof ------------------------------------------------------------------------
  restoreDb("end of run");
  const after = fingerprint();
  writeFileSync("/tmp/gallery/db-fingerprint-after.txt", `${after}\n`);
  writeFileSync(`${OUT}states-report.json`, `${JSON.stringify({ base: BASE, at: new Date().toISOString(), shots }, null, 2)}\n`);
  console.log("\n--- nfc_demo row counts, before | after ---");
  const b = BEFORE.split("\n");
  const a = after.split("\n");
  let drift = 0;
  for (let i = 0; i < Math.max(b.length, a.length); i++) {
    const same = b[i] === a[i];
    if (!same) drift++;
    console.log(`  ${same ? "ok  " : "DRIFT"} ${b[i] ?? "(missing)"}  ->  ${a[i] ?? "(missing)"}`);
  }
  console.log(
    drift === 0
      ? "shoot-states: nfc_demo restored — every table matches the pre-run count."
      : `shoot-states: ${drift} TABLE(S) DID NOT COME BACK. Reseed before trusting anything.`,
  );
  console.log(`shoot-states: ${shots.length} images -> ${OUT}`);
}
