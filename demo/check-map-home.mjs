// The runnable check for the map landing surface (decision-39) and the geocode backfill.
//
//   cd web && NEXT_PUBLIC_GOOGLE_MAPS_KEY=<browser key> pnpm build
//   DATABASE_URL=postgres:///nfc_demo APP_KEY=… PORT=8080 PUBLIC_DIR="$PWD/web/out" \
//     node demo/demo-server.mjs &
//   node demo/check-map-home.mjs
//
// PORT 8080 IS NOT ARBITRARY. The Maps browser key is HTTP-referrer restricted to
// `https://schimmer-glanz.exe.xyz/*`, `http://localhost:3000/*` and `http://127.0.0.1:8080/*`.
// On any other port Google answers `gm_authFailure` and this file would prove the degraded
// path five times over and the working one never.
//
// A KEY IS REQUIRED, AND A KEY-LESS RUN IS A SEPARATE, DELIBERATE ONE:
//
//   node demo/check-map-home.mjs                # the build must carry a Maps key
//   MAP_NO_KEY=1 node demo/check-map-home.mjs   # …against a build that carries none
//
// This used to be one lenient run that adapted to whichever build it found. It is not any
// more, because a key-less build silently skipped every assertion about pins, the info box,
// `gm_authFailure`, cost and the blocked-script path — leaving five green lines and a PASS
// that had proved nothing. A check whose coverage depends on an environment variable
// somebody forgot is a check that reports the forgetting as success. So the run states
// which build it wants and refuses the other one.
// (Measured, on this repo, this session: 20 assertions on a key-less build, 84 with a key.)
//
// The key-less rendering is a real deployment state — `ops/deploy.sh` does not pass the key
// to the web build — so `MAP_NO_KEY=1` proves it: the region says so in words, no canvas is
// mounted, and every building is still listed with its numbers.
// The geocode BACKFILL, which is what puts pins in the database at all, is checked
// separately and without a browser in demo/check-backfill.mjs.
//
// WHAT IT PROVES, and why none of it is establishable by reading the code:
//
//   1. THE MAP DRAWS OUR PINS, one per geocoded building, positioned, over real tiles. A
//      component that renders and never gets a projection looks identical in the DOM.
//   2. PIN STATE IS READABLE WITHOUT COLOUR. Every state is asserted as a GLYPH and a WORD
//      in the label's own text, so a greyscale screenshot still answers the question.
//   3. THE INFO BOX IS ON THE PIN, carries the numbers, carries the cross-links, and every
//      one of those links carries its filter (decision-38). And the DRAWER is not also open:
//      two boxes about one building, on one screen, is the disagreement this must not ship.
//   4. THE INFO BOX STAYS INSIDE THE MAP. A box that hangs off the edge is a box whose last
//      cross-links nobody can click; it is measured, not assumed.
//   5. DEGRADATION IS THE DAY-ONE STATE AND IS PROVEN BY BREAKING THINGS FOR REAL — the
//      Maps script blocked at the NETWORK layer, Google's own `gm_authFailure` fired, and
//      every coordinate in the database set to NULL. In each case the screen must still
//      answer the director's question, and the ledger must still be under it.
//   6. A REFRESH AND A THEME SWITCH COST NOTHING. Billing is per `new google.maps.Map`, so
//      the constructor is counted, not reasoned about.
//   7. THE LEDGER SURVIVED. asOf, recentScope, truncatedNote, overdueFlag-as-a-word and the
//      NAMED triage rows were each bought with an incident and are asserted by their words.
//
// IT WRITES TO nfc_demo AND PUTS IT BACK. Two states cannot be faked from the browser — a
// portfolio with no coordinates at all, and a portfolio with no buildings at all — and both
// are what production looks like today. The writes are `UPDATE locations SET lat = NULL` and
// `UPDATE locations SET active = false`, they are reverted in `finally`, and the guard below
// refuses any database that is not literally `nfc_demo`.
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { attach, launchChrome, sleep } from "./cdp.mjs";

const BASE = process.env.DEMO_BASE ?? "http://127.0.0.1:8080";
const DB = process.env.DEMO_DB ?? "nfc_demo";
/** Which build this run wants. Not a fallback — the wrong one is refused (see the header). */
const wantNoKey = process.env.MAP_NO_KEY === "1";
const SHOTS = "/tmp/ts-demo/map-home";
const ADMIN = { email: "demo@example.test", password: "demo-nur-lokal-2026" };

const host = new URL(BASE).hostname;
if (!["127.0.0.1", "localhost", "[::1]", "::1"].includes(host)) {
  console.error(`check-map-home: refusing to run against "${host}" — loopback only.`);
  process.exit(1);
}
// The same refusal demo/seed.sql and demo/make-admin.mjs make, for the same reason: this
// file UPDATEs rows, and the one database it may ever touch is the throwaway one.
if (DB !== "nfc_demo") {
  console.error(`check-map-home: refusing to write to "${DB}" — nfc_demo only.`);
  process.exit(1);
}

const failures = [];
function assert(name, condition, detail = "") {
  if (condition) console.log(`  ok   ${name}${detail ? `  ${detail}` : ""}`);
  else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL ${name}${detail ? `\n         ${detail}` : ""}`);
  }
}

/** One statement against the demo database. Never interpolated from anything a page said. */
function sql(statement) {
  return execFileSync("psql", ["-tAq", "-d", DB, "-v", "ON_ERROR_STOP=1", "-c", statement], {
    encoding: "utf8",
  }).trim();
}

/**
 * The OBJEKTLISTE's own rows, and not `.data-table` at large. Two more tables live further
 * down the same screen („Gerade im Einsatz" and „Zuletzt erfasste Schichten"), so a loose
 * selector counts the ledger and passes while the building list is empty — which is exactly
 * what a sabotage run caught this check doing.
 */
const OBJECT_ROWS = `document.querySelectorAll('table.objects-table tbody tr').length`;
const STATUS = `document.querySelector('.map-region .note')?.textContent?.trim() ?? ''`;
const PINS = `document.querySelectorAll('.map-pin').length`;
/** A message next-intl could not find renders as its own key path. */
const KEY_LEAK = `(() => (document.body.innerText.match(
  /\\b(home|shifts|workers|payroll|analytics|locations|clients|filters|overlay|nav)\\.[a-zA-Z]{3,}/g
) || []))()`;

async function login(page) {
  await page.goto(`${BASE}/login/`, { settle: 700 });
  await page.type('input[name="email"]', ADMIN.email, { perChar: 0 });
  await page.type('input[name="password"]', ADMIN.password, { perChar: 0 });
  await page.clickText("Anmelden", { selector: 'form button[type="submit"]' });
  await page.waitFor(`location.pathname === '/'`, { timeout: 15000, label: "the dashboard" });
}

/** Wait until the map region has settled into a state that is not „is loading". */
async function settled(page, timeout = 20000) {
  await page.waitFor(
    `(() => { const n = document.querySelector('.map-region .note'); return n && !/wird geladen|Loading the map/i.test(n.textContent) })()`,
    { timeout, label: "the map region to settle" },
  );
}

async function shoot(page, name) {
  await page.screenshot(`${SHOTS}/${name}.png`);
  console.log(`       shot ${name}.png`);
}

/** Every fact the LEDGER carries. It is load-bearing on every path, including the broken ones. */
async function ledgerSurvives(page, where) {
  const text = await page.eval(`document.body.textContent ?? ''`);
  for (const [what, needle] of [
    ["the elapsed times say what clock they are read against", "Zeiten bezogen auf"],
    ["the recent list still refuses to be a total", "hier wird nichts zusammengezählt"],
    ["the triage block is still there", "Zu erledigen"],
    ["the on-site block is still there", "Gerade im Einsatz"],
  ]) {
    assert(`${where}: ${what}`, text.includes(needle), needle);
  }
}

/**
 * PUT THE DEMO DATABASE BACK. Idempotent, and callable from anywhere — including a signal
 * handler, which is the point.
 *
 * A `finally` block only runs if the process gets to run code. This check spends minutes
 * with every coordinate NULLed and every building inactive, and a run that is KILLED (^C, a
 * timeout, an editor stopping the task) skips the teardown and leaves `nfc_demo` looking
 * exactly like production on day one. Every later audit that needs pins then either refuses
 * or reports a green nothing — both have happened, and one of them cost the previous round
 * twenty minutes of chasing a defect that was a leftover fixture.
 */
function restoreSeed() {
  sql("UPDATE locations SET active = true");
  // `geocoded_at IS NULL` is the seed's „never asked" row and its status must go back to
  // NULL, not to a status — „nie abgefragt" and „abgefragt, kein Pin" are two different
  // sentences on screen and the demo fixture is meant to hold the first one.
  sql("UPDATE locations SET geocode_status = CASE WHEN geocoded_at IS NULL THEN NULL ELSE 'OK' END");
  sql(`UPDATE locations l SET lat = s.lat, lng = s.lng
         FROM (VALUES
           ('donaufeld-101', 48.25361, 16.42194),
           ('wagramer-4', 48.23472, 16.42250),
           ('gumpendorfer-63', 48.19472, 16.34694),
           ('landstrasser-46', 48.20250, 16.39472),
           ('handelskai-94', 48.24222, 16.38472)
         ) AS s(slug, lat, lng)
        WHERE l.slug = s.slug`);
}

/**
 * The signals that actually arrive. `SIGKILL` cannot be caught — nothing can be done about
 * that one — but ^C, a `kill`, a closed terminal and an uncaught throw all can, and all of
 * them used to leave the fixture degraded. Chrome is killed too: a headless browser at 0 %
 * CPU with nobody watching it is this repo's other favourite way to lose an hour.
 */
let browser = null;
let restored = false;
function bailOut(why) {
  if (!restored) {
    restored = true;
    try {
      restoreSeed();
      console.error(`\ncheck-map-home: ${why} — demo database restored.`);
    } catch (error) {
      console.error(`\ncheck-map-home: ${why} — RESTORE FAILED: ${error.message}`);
      console.error("  run:  psql -d nfc_demo -f demo/seed.sql");
    }
  }
  try {
    browser?.kill("SIGKILL");
  } catch {
    /* already gone */
  }
  process.exit(1);
}
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP", "SIGQUIT"]) {
  process.on(signal, () => bailOut(signal));
}
process.on("uncaughtException", (error) => bailOut(`uncaught: ${error.message}`));

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const before = sql(
    "SELECT count(*) FILTER (WHERE lat IS NOT NULL) || '/' || count(*) FILTER (WHERE geocode_status IS NULL) || '/' || count(*) FILTER (WHERE active) FROM locations",
  );
  const { child, port } = await launchChrome({ port: 9740 + (process.pid % 60), width: 1680, height: 1050 });
  browser = child;
  const page = await attach(port);

  try {
    await login(page);
    await settled(page);

    // ==== 1 · the map draws, and it draws OUR pins over REAL tiles =======================
    const status = await page.eval(STATUS);
    const keyed = !status.includes("kein Kartenschlüssel");
    console.log(`       map status: ${status}`);

    // The build is not what the run asked for. REFUSE — do not adapt. Adapting is how a
    // forgotten environment variable turns into a green run that checked a fifth of this.
    if (keyed === wantNoKey) {
      child.kill();
      console.error(
        wantNoKey
          ? "\ncheck-map-home: MAP_NO_KEY=1 was asked for, but this build CARRIES a Maps key.\n" +
              "                Rebuild without it:  cd web && pnpm build"
          : "\ncheck-map-home: this build carries NO Maps key, so the map itself cannot be checked.\n" +
              "                Rebuild with it:\n" +
              "                  cd web && NEXT_PUBLIC_GOOGLE_MAPS_KEY=\"$(cd .. && psst get NEXT_PUBLIC_GOOGLE_MAPS_KEY)\" pnpm build\n" +
              "                …or check the key-less rendering on purpose:  MAP_NO_KEY=1 node demo/check-map-home.mjs",
      );
      process.exit(1);
    }

    const pinnedInDb = Number(sql("SELECT count(*) FROM locations WHERE active AND lat IS NOT NULL"));
    const activeInDb = Number(sql("SELECT count(*) FROM locations WHERE active"));

    if (keyed) {
      await page.waitFor(`(${PINS}) > 0`, { timeout: 20000, label: "our own pins" });
      assert(
        "map: one pin per geocoded building, and no more",
        (await page.eval(PINS)) === pinnedInDb,
        `${await page.eval(PINS)} pins, ${pinnedInDb} geocoded buildings`,
      );
      assert(
        "map: the pins are POSITIONED — a projection actually ran",
        (await page.eval(
          `[...document.querySelectorAll('.map-pin')].every((p) => p.style.left !== '' && p.style.top !== '')`,
        )) === true,
        await page.eval(`[...document.querySelectorAll('.map-pin')].map((p) => p.style.left).join(' ')`),
      );
      // Bounded wait, not an instant read: `idle` fires when the viewport is settled, and
      // the tile <img>s land a few frames later. A check that races is a check that fails
      // for a reason that has nothing to do with what it is testing.
      const TILES = `document.querySelectorAll('.map-canvas img').length`;
      try {
        await page.waitFor(`(${TILES}) > 4`, { timeout: 12000, label: "Google's tiles" });
      } catch {
        /* reported as a failure below, with the count */
      }
      assert(
        "map: Google's own tiles are underneath, so this is a map and not a grey box",
        (await page.eval(TILES)) > 4,
        `${await page.eval(TILES)} tiles`,
      );
      // decision-39 §3: never the whole viewport, because the ledger is under it.
      const canvasH = await page.eval(
        `Math.round(document.querySelector('.map-canvas').getBoundingClientRect().height)`,
      );
      assert(
        "map: the region is a band, not the viewport — the ledger stays one scroll away",
        canvasH > 200 && canvasH < 700,
        `${canvasH}px of ${await page.eval("innerHeight")}px`,
      );
      // …AND THE ALWAYS-RENDERED REGION REACHES THE FOLD. 'one scroll away' was measured and
      // it was not true: at 52vh/560px the Objektliste's heading landed at y=964 on a
      // 1000px viewport and NOT ONE ROW was on screen. The map is the optional region — it
      // draws nothing at all on the day this ships — and it was holding the fold over the
      // list that is rendered on every path. Asserted on the DRAWN map, because that is the
      // case that is worst and the case that arrives after onboarding succeeds.
      const fold = JSON.parse(
        await page.eval(`(() => {
          const rows = [...document.querySelectorAll('table.objects-table tbody tr')]
          const heading = [...document.querySelectorAll('.list h2')].find((h) => h.textContent.includes('Objekte'))
          const whole = rows.filter((r) => r.getBoundingClientRect().bottom <= window.innerHeight)
          return JSON.stringify({
            fold: window.innerHeight,
            headingY: heading ? Math.round(heading.getBoundingClientRect().top) : null,
            rows: rows.length, whole: whole.length,
            first: whole[0]?.querySelector('th')?.childNodes[0]?.textContent?.trim() ?? null,
          })
        })()`),
      );
      assert(
        "fold: the Objektliste reaches the first screen — the optional region does not hold it",
        fold.whole >= 1 && fold.headingY !== null && fold.headingY < fold.fold - 100,
        `heading at y=${fold.headingY}, ${fold.whole} of ${fold.rows} rows whole above ${fold.fold}px` +
          `${fold.first ? ` — „${fold.first}"` : ""}`,
      );

      // ==== 2 · state is readable WITHOUT colour ========================================
      const labels = await page.eval(
        `[...document.querySelectorAll('.map-pin-label')].map((p) => p.textContent.trim())`,
      );
      assert(
        "pins: every pin carries a GLYPH — filled for occupied, hollow for empty",
        labels.every((l) => l.startsWith("●") || l.startsWith("○")),
        labels.join(" | "),
      );
      assert(
        "pins: every pin carries the WORD, so the count is never a bare number",
        labels.every((l) => /vor Ort/.test(l)),
        labels.join(" | "),
      );
      const occupied = labels.filter((l) => l.startsWith("●"));
      assert(
        "pins: an occupied pin is the one with somebody in it, not merely a colour",
        occupied.every((l) => !/\b0 vor Ort/.test(l)),
        occupied.join(" | "),
      );
      const flagged = labels.filter((l) => l.includes("prüfen"));
      const unresolvedDb = Number(
        sql(
          "SELECT count(DISTINCT location_id) FROM shifts WHERE auto_closed AND corrected_at IS NULL",
        ),
      );
      assert(
        "pins: the attention chip is a WORD and appears on exactly the buildings that need it",
        flagged.length === unresolvedDb,
        `${flagged.length} chips, ${unresolvedDb} buildings with an unconfirmed shift`,
      );
      // AND THE MUTED PALETTE IS ON THE WIRE, not merely in a source array. Google encodes
      // the applied style into the tile request, so this reads our own dark geometry colour
      // back out of the URL the tiles were fetched with. It is the end-to-end form of the
      // `mapId` trade-off: a cloud `mapId` would make the API drop `styles` silently, and
      // the tiles would come back in Google's default palette with nothing on screen
      // complaining — just a white map inside a dark admin.
      const styled = await page.eval(`(() => {
        const src = [...document.querySelectorAll('.map-canvas img')]
          .map((i) => i.src).find((s) => s.includes('/maps/vt?pb=')) ?? ''
        const packed = src.match(/1sstyles!2z([^!&]+)/)?.[1] ?? ''
        try { return atob(packed.replace(/-/g, '+').replace(/_/g, '/')) } catch { return '' }
      })()`);
      assert(
        "map: OUR palette reached Google — the tiles were fetched with the muted style applied",
        styled.includes("#101216") && styled.includes("l.i|p.v:off"),
        styled.slice(0, 90) || "(no style on the tile request)",
      );
      await shoot(page, "map-1680-dark");
    } else {
      // The key-less build, checked on purpose. It is a DEPLOYMENT FACT, not a fault: the
      // key is inlined at build time and ops/deploy.sh does not pass it, so this is what
      // production renders until that changes. The sentence has to say so, and — the part
      // that matters — nothing may be drawn: an empty grey frame over a complete list is a
      // screen apologising for something that is not missing.
      assert(
        "no key: the region says it is a property of the BUILD, and that the list is unaffected",
        /kein Kartenschlüssel/.test(status) && /kein Fehler/.test(status) && /Liste unten/.test(status),
        status,
      );
      assert(
        "no key: no canvas is mounted at all — no empty grey frame",
        (await page.eval(`!document.querySelector('.map-canvas')`)) === true,
      );
      assert(
        "no key: …and no retry is offered, because a retry cannot fix a build",
        (await page.eval(
          `![...document.querySelectorAll('button')].some((b) => b.textContent.includes('Karte erneut laden'))`,
        )) === true,
      );
      assert(
        "no key: the Maps script was never even requested — a key-less build costs nothing",
        (await page.eval(
          `![...document.querySelectorAll('script')].some((s) => (s.src || '').includes('maps.googleapis.com'))`,
        )) === true,
      );
      await shoot(page, "map-nokey-1680-dark");
    }

    // ==== 3 · the Objektliste is there on EVERY path, with the same buildings ============
    const listRows = await page.eval(OBJECT_ROWS);
    assert(
      "Objektliste: every ACTIVE building has a row, whatever the map did",
      listRows === activeInDb,
      `${listRows} rows, ${activeInDb} active buildings`,
    );
    assert(
      "Objektliste: a building with no coordinates says WHICH of the three things happened",
      (await page.eval(`document.body.textContent.includes('Keine Koordinaten')`)) === true,
    );
    assert(
      "Objektliste: …and offers the fix, on the row, where the missing pin is visible",
      (await page.eval(
        `[...document.querySelectorAll('button')].some((b) => b.textContent.includes('Koordinaten holen'))`,
      )) === true,
    );
    assert(
      "Objektliste: no message key rendered as text",
      (await page.eval(KEY_LEAK)).length === 0,
      (await page.eval(KEY_LEAK)).join(", "),
    );
    await ledgerSurvives(page, "map ready");

    // ==== 4 · the info box: on the pin, with the numbers AND the links ===================
    if (keyed) {
      const target = await page.eval(
        `(() => { const p = [...document.querySelectorAll('.map-pin-label')].find((l) => l.textContent.includes('prüfen'))
            ?? document.querySelector('.map-pin-label'); p.click(); return p.textContent.trim() })()`,
      );
      await page.waitFor(`document.querySelector('.map-info')`, { label: "the info box on the pin" });
      await sleep(900);
      assert("info box: a pin click opens it ON the pin", true, target);
      assert(
        "info box: the URL carries the building, so the view can be sent to somebody",
        /^\?location=[0-9a-f-]{36}$/.test(await page.eval("location.search")),
        await page.eval("location.search"),
      );
      assert(
        "info box: the DRAWER is NOT also open — one selection, one rendering",
        (await page.eval(`!document.querySelector('.drawer')`)) === true,
      );
      assert(
        "info box: its heading names the building it is about",
        (await page.eval(`document.querySelector('.map-info h3')?.textContent?.trim() ?? ''`))
          .length > 2,
        await page.eval(`document.querySelector('.map-info h3')?.textContent`),
      );
      for (const [what, needle] of [
        ["who is on site", "Gerade vor Ort"],
        ["what is open here, with no period filter", "Offene Punkte hier"],
        ["when it was last cleaned", "Zuletzt gereinigt"],
        ["the hours against the target", "Stunden diesen Monat"],
        ["the contract as recorded", "Vertrag"],
        ["the clock the elapsed times were read against", "Zeiten bezogen auf"],
      ]) {
        assert(
          `info box: it carries ${what}`,
          (await page.eval(`document.querySelector('.map-info')?.textContent ?? ''`)).includes(
            needle,
          ),
          needle,
        );
      }
      const links = await page.eval(
        `[...document.querySelectorAll('.map-info .panel-links a')].map((a) => a.getAttribute('href'))`,
      );
      assert("info box: it carries the cross-links out", links.length >= 8, `${links.length} links`);
      const bare = links.filter((href) => !href.includes("?"));
      assert(
        "info box: EVERY link out of it carries a filter (decision-38)",
        bare.length === 0,
        bare.join(" ") || `${links.length} links, all filtered`,
      );
      assert(
        "info box: the unconfirmed-shift link carries period=all — being old is what made it unresolved",
        links.every((h) => !h.includes("state=unresolved") || h.includes("period=all")),
        links.filter((h) => h.includes("state=unresolved")).join(" "),
      );

      // ==== 5 · and it stays INSIDE the map ============================================
      const fits = await page.eval(`(() => {
        const b = document.querySelector('.map-info').getBoundingClientRect()
        const m = document.querySelector('.map-canvas').getBoundingClientRect()
        return JSON.stringify({ ok: b.top >= m.top - 1 && b.bottom <= m.bottom + 1 && b.left >= m.left - 1 && b.right <= m.right + 1,
                                box: [Math.round(b.top), Math.round(b.bottom)], map: [Math.round(m.top), Math.round(m.bottom)] })
      })()`);
      const geom = JSON.parse(fits);
      assert(
        "info box: it hangs inside the map, so its last cross-link is clickable",
        geom.ok,
        `box ${geom.box} in map ${geom.map}`,
      );
      await shoot(page, "map-info-1680-dark");

      // …AND THE CROSS-LINKS ARE ON SCREEN, which is a different question from whether they
      // exist and a different question again from whether they can be reached.
      //
      // THIS ASSERTION USED TO MEASURE THE WRONG PROPERTY, and it passed while the screen
      // was broken. It dispatched a real wheel gesture over the box and confirmed that
      // scrolling brought links into view. That was true, and it stayed true, while ZERO of
      // TEN cross-links were inside the box's own rectangle at rest, with no scrollbar (the
      // overlay kind is invisible until you scroll) and no expander. Reachable is not
      // discoverable. The owner's word in IA-PLAN §9 was EXPANDABLE, and there was nothing
      // to expand.
      //
      // So the box is now a DISCLOSURE and this asserts what a reader can SEE:
      //   1. collapsed — the five numbers fit, and the control naming the links is visible,
      //      is a real target and says HOW MANY there are;
      //   2. expanded — EVERY cross-link is inside the box's rectangle with the box NOT
      //      scrolled. `scrollTop === 0` is part of the assertion on purpose: without it,
      //      a box that had been scrolled to the bottom would report the same thing.
      //
      // `.panel-links-out`, not `.panel-links`: the on-site cell on the numbers face is also
      // a `.panel-links` list, so the loose selector finds a WORKER link and passes while
      // every cross-link is unreachable. That is not hypothetical — the first version of
      // this assertion did exactly that and reported it as green.
      const collapsed = JSON.parse(
        await page.eval(`(() => {
          const box = document.querySelector('.map-info')
          const toggle = document.querySelector('.map-info-expand')
          if (!box || !toggle) return JSON.stringify({ found: false })
          const t = toggle.getBoundingClientRect()
          const b = box.getBoundingClientRect()
          // A .visually-hidden node is a 1px clipping rectangle by construction, so it
          // always reports more content than box. That is a screen-reader sentence, not a
          // fold. (No backticks in here: this whole function is inside a template literal.)
          const scrolled = [box, ...box.querySelectorAll('*')]
            .filter((el) => !el.classList.contains('visually-hidden') && el.scrollHeight > el.clientHeight + 2)
          return JSON.stringify({
            found: true,
            label: toggle.textContent.trim(),
            expanded: toggle.getAttribute('aria-expanded'),
            visible: t.height > 0 && t.top >= b.top - 1 && t.bottom <= b.bottom + 1,
            target: Math.round(t.height),
            hiddenOverflow: scrolled.map((el) => String(el.className)),
          })
        })()`),
      );
      assert(
        "info box: the control that reveals the links is VISIBLE, is a real target and says how many",
        collapsed.found === true &&
          collapsed.visible === true &&
          collapsed.target >= 44 &&
          collapsed.expanded === "false" &&
          /\d/.test(collapsed.label ?? ""),
        `„${collapsed.label ?? "(none)"}" ${collapsed.target ?? 0}px, aria-expanded=${collapsed.expanded ?? "?"}`,
      );
      assert(
        "info box: at rest the NUMBERS fit — nothing in the box is hidden behind a silent fold",
        Array.isArray(collapsed.hiddenOverflow) && collapsed.hiddenOverflow.length === 0,
        collapsed.found === true
          ? collapsed.hiddenOverflow.join(" | ") || "nothing scrolls"
          : "no .map-info-expand in the box — there is nothing to expand",
      );

      // Pressed the way a reader presses it, and then measured. `?.` and not `.`: when the
      // disclosure is MISSING — which is precisely the defect these three assertions exist
      // to catch — a throw here would abandon the run and leave every later assertion
      // unmeasured, including the ones about the phone and the degraded states. A check
      // that stops measuring on the first defect reports one defect per run.
      await page.eval(`document.querySelector('.map-info-expand')?.click()`);
      await sleep(700);
      const shown = JSON.parse(
        await page.eval(`(() => {
          const box = document.querySelector('.map-info')
          const links = [...document.querySelectorAll('.map-info .panel-links-out a')]
          if (!box || links.length === 0) return JSON.stringify({ found: false })
          const b = box.getBoundingClientRect()
          const scrolledBy = [box, ...box.querySelectorAll('*')]
            .reduce((most, el) => Math.max(most, el.scrollTop), 0)
          const inside = links.filter((a) => { const f = a.getBoundingClientRect()
            return f.height > 0 && f.top >= b.top - 1 && f.bottom <= b.bottom + 1 })
          return JSON.stringify({ found: true, total: links.length, inside: inside.length,
            scrolledBy, missing: links.filter((a) => !inside.includes(a)).map((a) => a.textContent.trim().slice(0, 40)) })
        })()`),
      );
      assert(
        "info box: one press shows EVERY cross-link inside the box, with nothing scrolled",
        shown.found === true && shown.inside === shown.total && shown.scrolledBy === 0,
        `${shown.inside ?? 0} of ${shown.total ?? 0} links on screen, scrolled ${shown.scrolledBy ?? "?"}px` +
          `${shown.missing?.length ? ` — missing: ${shown.missing.join(" | ")}` : ""}`,
      );
      // …and it is still INSIDE the map when it is bigger. The expanded box is wider and
      // taller than the collapsed one, and a box that grows off the bottom edge has moved
      // the same links out of reach by another route.
      const grown = JSON.parse(
        await page.eval(`(() => {
          const box = document.querySelector('.map-info')
          const map = document.querySelector('.map-canvas')
          if (!box || !map) return JSON.stringify({ ok: false, box: null, map: null })
          const b = box.getBoundingClientRect()
          const m = map.getBoundingClientRect()
          return JSON.stringify({ ok: b.top >= m.top - 1 && b.bottom <= m.bottom + 1 && b.left >= m.left - 1 && b.right <= m.right + 1,
                                  box: [Math.round(b.top), Math.round(b.bottom)], map: [Math.round(m.top), Math.round(m.bottom)] })
        })()`),
      );
      assert(
        "info box: EXPANDED, it is still inside the map — the growth is clamped, not overflowed",
        grown.ok,
        `box ${grown.box} in map ${grown.map}`,
      );
      await shoot(page, "map-info-links-1680-dark");
      await page.eval(`document.querySelector('.map-info-expand')?.click()`);
      await sleep(400);

      // Collapsing is one action and it puts the URL back.
      await page.clickText("Infobox", { selector: ".map-info button" });
      await sleep(600);
      assert(
        "info box: collapsing it closes the box and clears the filter",
        (await page.eval(`!document.querySelector('.map-info') && location.search === ''`)) === true,
        await page.eval("location.search"),
      );

      // ==== 6 · a refresh and a theme switch cost NOTHING ==============================
      // Billing is per `new google.maps.Map`, so the constructor is counted rather than
      // reasoned about. This is real money: the loop this replaces rebuilt the map on every
      // refetch, i.e. thousands of billed loads per open tab per day.
      await page.eval(`(() => {
        const Original = google.maps.Map
        window.__mapBuilds = 0
        google.maps.Map = function (...args) { window.__mapBuilds++; return new Original(...args) }
        google.maps.Map.prototype = Original.prototype
      })()`);
      await page.clickText("Aktualisieren", { selector: ".topline-action button" });
      await sleep(2500);
      await page.select(".theme-switcher select", "light");
      await sleep(1200);
      await page.select(".theme-switcher select", "dark");
      await sleep(1200);
      assert(
        "cost: a refresh and two theme switches construct ZERO new maps",
        (await page.eval("window.__mapBuilds")) === 0,
        `${await page.eval("window.__mapBuilds")} new google.maps.Map(...)`,
      );
      assert(
        "cost: …and the pins are still on screen afterwards",
        (await page.eval(PINS)) === pinnedInDb,
        `${await page.eval(PINS)} pins`,
      );

      // ==== 7 · light theme, same muted map ===========================================
      await page.select(".theme-switcher select", "light");
      await sleep(1400);
      await shoot(page, "map-1680-light");
      await page.select(".theme-switcher select", "dark");
      await sleep(800);

      // ==== 8 · gm_authFailure TEARS THE REGION DOWN ==================================
      // Google's own signal, fired the way Google fires it. It arrives LATE — the script
      // loaded, `new Map()` succeeded — and what is on screen at that moment is Google's
      // grey box under Google's own alert. Covering that is not enough; it must go.
      await page.eval("window.gm_authFailure()");
      await sleep(1200);
      const blocked = await page.eval(STATUS);
      assert(
        "blocked: the sentence names BOTH possibilities, because a browser cannot tell them apart",
        /abgelehnt/.test(blocked) && /Kontingent/.test(blocked),
        blocked,
      );
      assert(
        "blocked: the map is REMOVED, not covered — no grey Google box is left behind",
        (await page.eval(`!document.querySelector('.map-canvas')`)) === true,
      );
      assert(
        "blocked: every building is still listed",
        (await page.eval(`document.querySelectorAll('table.objects-table tbody tr').length`)) >=
          activeInDb,
      );
      await ledgerSurvives(page, "blocked");
      await shoot(page, "map-blocked-1680-dark");
    }

    // ==== 9 · the script BLOCKED AT THE NETWORK LAYER ===================================
    // Not a stubbed module and not a mocked promise: Chrome refuses the request, which is
    // what an ad blocker, a corporate proxy, a CSP or an aeroplane actually does.
    await page.send("Network.setBlockedURLs", { urls: ["*maps.googleapis.com*"] });
    await page.goto(`${BASE}/`, { settle: 2500 });
    await settled(page, 25000);
    // Only a build that WOULD have loaded the script can fail to load it. On a key-less
    // build the region never asks for it, so there is no network failure to observe — and
    // asserting one here would be asserting a state the product cannot be in.
    if (keyed) {
      const offline = await page.eval(STATUS);
      assert(
        "offline: the region says the map could not be loaded, and that the list is unaffected",
        /nicht geladen|antwortet nicht/.test(offline) && /Liste unten/.test(offline),
        offline,
      );
      assert(
        "offline: there is a retry, and it is the only thing that changed",
        (await page.eval(
          `[...document.querySelectorAll('button')].some((b) => b.textContent.includes('Karte erneut laden'))`,
        )) === true,
      );
    }
    assert(
      "offline: every building is still listed, with its numbers",
      (await page.eval(`document.querySelectorAll('table.objects-table tbody tr').length`)) >=
        activeInDb,
    );
    await ledgerSurvives(page, "offline");

    // With no map there is no pin to hang a box on, so `?location=` must still open the
    // building — as the drawer. A URL somebody was sent may not stop working because Google
    // is down.
    const anyId = sql("SELECT id FROM locations WHERE active ORDER BY created_at LIMIT 1");
    await page.goto(`${BASE}/?location=${anyId}`, { settle: 2500 });
    await settled(page, 25000);
    assert(
      "offline: ?location= still opens the building — as the drawer, since there is no pin",
      (await page.eval(`!!document.querySelector('.drawer') && !document.querySelector('.map-info')`)) ===
        true,
    );
    assert(
      "offline: …and the drawer carries the same links, still filtered",
      (await page.eval(
        `[...document.querySelectorAll('.drawer .panel-links a')].every((a) => a.getAttribute('href').includes('?'))`,
      )) === true,
    );
    await shoot(page, "map-offline-1680-dark");
    await page.send("Network.setBlockedURLs", { urls: [] });

    // ==== 10 · 390px: the map is one tap away and the list is the screen =================
    // Run BEFORE the coordinates are nulled, on purpose: with nothing geocoded there is no
    // map to collapse, and „no canvas" would pass for the wrong reason. A sabotage run
    // caught exactly that — `hidden = false` left this block green.
    await page.send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true,
    });
    await page.goto(`${BASE}/`, { settle: 2500 });
    await settled(page, 25000);
    assert(
      "390px: the map is COLLAPSED and says so, with a control that says what it does",
      (await page.eval(
        `(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('Karte anzeigen'));
           return !!b && b.getAttribute('aria-expanded') === 'false' })()`,
      )) === true,
      await page.eval(STATUS),
    );
    assert(
      "390px: …and the control is a real touch target",
      (await page.eval(
        `(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('Karte anzeigen'));
           const r = b.getBoundingClientRect(); return r.height >= 44 && r.width >= 44 })()`,
      )) === true,
    );
    // COLLAPSED means the map was never constructed, not merely hidden. A `display: none`
    // map has still cost a billed load and a stairwell's worth of mobile data — which is
    // half the reason it is collapsed at all.
    assert(
      "390px: …and collapsed means NO map was built — no billed load, no mobile data",
      (await page.eval(`!document.querySelector('.map-canvas')`)) === true,
    );
    assert(
      "390px: the page does not scroll SIDEWAYS — the five-column cap holds",
      (await page.eval(`document.documentElement.scrollWidth <= window.innerWidth + 1`)) === true,
      `content ${await page.eval("document.documentElement.scrollWidth")}px in ${await page.eval("innerWidth")}px`,
    );
    assert(
      "390px: the buildings are still all there, as cards",
      (await page.eval(`document.querySelectorAll('table.objects-table tbody tr').length`)) >=
        activeInDb,
    );

    // THE UNKNOWN-OBJECT STATE, at the width decision-28 makes mandatory. It gets its own
    // assertion because it is the LONGEST string this product renders inside a pill
    // („Objekt: unbekannt – dieses Objekt ist hier nicht vorhanden") and it used to be set
    // `nowrap`: 370px of text starting 25px in, so the document measured 443px against a
    // 390px viewport and the pill's REMOVE control sat entirely off the right edge — on the
    // one state whose whole purpose is to be escapable. The resting screen above did not
    // catch it, because at rest there is no chip.
    //
    // Two things are asserted and both are needed: the document must not scroll sideways
    // (decision-28 forbids answering this with a scrollbar), AND the ✕ must be INSIDE the
    // viewport — an `overflow: hidden` somewhere up the tree would satisfy the first on its
    // own while leaving the control exactly as unreachable as before.
    await page.goto(`${BASE}/?location=00000000-0000-4000-8000-000000000000`, { settle: 2500 });
    const ghost = JSON.parse(
      await page.eval(`(() => {
        const de = document.documentElement
        const chip = document.querySelector('.filter-chip.is-unknown')
        const remove = chip?.querySelector('.filter-chip-remove')
        const r = remove?.getBoundingClientRect()
        return JSON.stringify({
          scrollWidth: de.scrollWidth, vw: de.clientWidth,
          chip: chip !== null, said: (chip?.textContent ?? '').trim().slice(0, 60),
          removeRight: r ? Math.round(r.right) : null,
          removeWidth: r ? Math.round(r.width) : null,
          removeHeight: r ? Math.round(r.height) : null,
        })
      })()`),
    );
    assert(
      "390px: the unknown-object chip does not push the page sideways",
      ghost.chip === true && ghost.scrollWidth <= ghost.vw + 1,
      `content ${ghost.scrollWidth}px in ${ghost.vw}px — „${ghost.said}“`,
    );
    assert(
      "390px: …and its REMOVE control is on screen and a real target — the filter is escapable",
      ghost.removeRight !== null &&
        ghost.removeRight <= ghost.vw + 1 &&
        ghost.removeWidth >= 24 &&
        ghost.removeHeight >= 24,
      `✕ right edge at ${ghost.removeRight}px of ${ghost.vw}px, ${ghost.removeWidth}×${ghost.removeHeight}px`,
    );
    await shoot(page, "map-390-ghost-dark");
    await page.goto(`${BASE}/`, { settle: 2500 });
    await settled(page, 25000);

    await ledgerSurvives(page, "390px");
    await shoot(page, "map-390-dark");
    await page.select(".theme-switcher select", "light");
    await sleep(900);
    await shoot(page, "map-390-light");
    await page.select(".theme-switcher select", "dark");
    await sleep(500);

    // …and ONE TAP brings it, small, without taking the page's scroll with it.
    if (keyed) {
      await page.clickText("Karte anzeigen");
      await page.waitFor(`document.querySelector('.map-canvas')`, {
        timeout: 20000,
        label: "the phone map",
      });
      await sleep(2500);
      const phoneH = await page.eval(
        `Math.round(document.querySelector('.map-canvas').getBoundingClientRect().height)`,
      );
      assert(
        "390px: one tap brings a SMALL map — never the whole screen",
        phoneH > 200 && phoneH <= 360,
        `${phoneH}px of ${await page.eval("innerHeight")}px`,
      );
      assert(
        "390px: …and the page still does not scroll sideways with a map on it",
        (await page.eval(`document.documentElement.scrollWidth <= window.innerWidth + 1`)) === true,
        `content ${await page.eval("document.documentElement.scrollWidth")}px`,
      );
      // A PIN TAP ON A PHONE OPENS THE BOTTOM SHEET, NOT A BOX ON A 320px MAP. The info box
      // on the pin is the owner's chosen presentation and it is a DESKTOP presentation: at
      // 320px of map it would be a ~160px scrolling window holding five numbers and eleven
      // links. Same selection, same `?location=`, same <BuildingFacts> — a frame with room.
      await page.eval(`document.querySelector('.map-pin-label').click()`);
      // Bounded wait that does NOT throw. A `waitFor` here would abort the run on the very
      // failure this is testing for, taking the four blocks after it with it — a check that
      // deletes its own remaining coverage when it goes red is worth less than it looks.
      try {
        await page.waitFor(`document.querySelector('.drawer')`, { timeout: 8000, label: "the bottom sheet" });
      } catch {
        /* reported as a failure below, with what IS on screen */
      }
      assert(
        "390px: tapping a pin opens the BOTTOM SHEET — not a box inside a 320px map",
        (await page.eval(`!!document.querySelector('.drawer') && !document.querySelector('.map-info')`)) === true,
        await page.eval(
          `document.querySelector('.map-info') ? 'an info box on the pin, inside a ' + Math.round(document.querySelector('.map-canvas').getBoundingClientRect().height) + 'px map' : 'no drawer and no info box'`,
        ),
      );
      assert(
        "390px: …and it is the same selection, so the URL is still shareable",
        /^\?location=[0-9a-f-]{36}$/.test(await page.eval("location.search")),
        await page.eval("location.search"),
      );
      await shoot(page, "map-390-sheet-dark");
      await page.eval(`(() => { const b = [...document.querySelectorAll('.drawer button')].find((x) => /Schließen|Close/.test(x.textContent)); if (b) b.click() })()`);
      await sleep(500);
      // Shot BEFORE the scroll test below: a cooperative map answers a bare wheel with
      // Google's own „Halte ⌘ gedrückt" overlay, which is correct behaviour and a
      // misleading thing to keep as the reference picture of the screen.
      await shoot(page, "map-390-open-dark");
      // ONE FINGER MUST SCROLL THE PAGE, and this is the only way to know: dispatch a real
      // scroll gesture over the middle of the map and read the page's own offset back.
      // `gestureHandling: 'cooperative'` is what makes it work; `greedy` (the proof of
      // concept's setting) eats the gesture and traps the reader inside the map.
      const centre = await page.eval(`(() => {
        const r = document.querySelector('.map-canvas').getBoundingClientRect()
        return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) })
      })()`);
      const at = JSON.parse(centre);
      const before = await page.eval("window.scrollY");
      await page.send("Input.dispatchMouseEvent", {
        type: "mouseWheel",
        x: at.x,
        y: at.y,
        deltaX: 0,
        deltaY: 320,
      });
      await sleep(900);
      const after = await page.eval("window.scrollY");
      assert(
        "390px: one finger over the map scrolls the PAGE, it is not swallowed by the map",
        after > before,
        `scrollY ${before} → ${after}`,
      );
    }
    // Back to the desk. Without this the next two blocks would still be on a phone, where
    // the region reports „eingeklappt" and never gets to say why there are no pins.
    await page.send("Emulation.clearDeviceMetricsOverride");

    // ==== 10b · EXACTLY ONE PINNED BUILDING — a block, not a rooftop ====================
    // `fitBounds` over a single point zooms to the MAXIMUM and lands the director on a roof
    // with no street around it, which is the least useful map available. This is not a
    // hypothetical shape: production has ONE building, so it is the first map anybody at
    // this company will ever see. Forced in the database, because one pin is a state of the
    // portfolio and cannot be provoked from the browser.
    if (keyed) {
      const only = sql("SELECT slug FROM locations WHERE active AND lat IS NOT NULL ORDER BY slug LIMIT 1");
      sql(`UPDATE locations SET active = false WHERE lat IS NOT NULL AND slug <> '${only}'`);
      await page.goto(`${BASE}/`, { settle: 2500 });
      await settled(page, 25000);
      await page.waitFor(`(${PINS}) === 1`, { timeout: 20000, label: "the single pin" });
      await sleep(2000);
      // Google exposes no handle on the map instance, so the zoom is read off the TILES,
      // which is the map's own report of where it ended up rather than ours. A raster tile
      // URL is `…/maps/vt?pb=!1m5!1m4!1i<ZOOM>!2i<x>!3i<y>!4i256…`.
      const zoom = await page.eval(`(() => {
        const src = [...document.querySelectorAll('.map-canvas img')]
          .map((i) => i.src).find((s) => s.includes('/maps/vt?pb=')) ?? ''
        return Number(src.match(/!1m4!1i(\\d+)!/)?.[1] ?? -1)
      })()`);
      assert(
        "one pin: the map settles on a BLOCK (zoom 16), not on the roof fitBounds would give",
        zoom === 16,
        `tiles report zoom ${zoom}`,
      );
      sql("UPDATE locations SET active = true");
    }

    // ==== 11 · NO COORDINATES AT ALL — production, today =================================
    // Nulled in the database, not in a fixture. This is the state the one live building is
    // in right now, and the screen has to be useful in it.
    //
    // `geocode_status` goes with the coordinates on purpose: `geocodeAddress` only ever
    // answers 'OK' WITH a pin, so a row holding `lat NULL, status OK` is a state the
    // product cannot produce, and asking a screen to render one teaches nothing except how
    // it renders nonsense. Production's real pair is `lat NULL, status 'no_key'`.
    sql("UPDATE locations SET lat = NULL, lng = NULL, geocode_status = 'no_key'");
    await page.goto(`${BASE}/`, { settle: 2500 });
    await settled(page, 25000);
    const noPins = await page.eval(STATUS);
    // Same rule as the offline block: a key-less build is already saying something truer
    // („dieser Build hat keinen Schlüssel"), and it must not be asked to say this instead.
    // Everything BELOW the region — which is the part that has to carry the screen — is
    // asserted on both builds.
    if (keyed) {
      assert(
        "no coordinates: the region says how many buildings have none, and that the list is complete",
        /keine Koordinaten/.test(noPins) && /vollständig/.test(noPins),
        noPins,
      );
    }
    assert(
      "no coordinates: NO empty grey frame is drawn — a map region with nothing in it is an apology",
      (await page.eval(`!document.querySelector('.map-canvas')`)) === true,
    );
    assert(
      "no coordinates: the whole portfolio is still on screen",
      (await page.eval(`document.querySelectorAll('table.objects-table tbody tr').length`)) >=
        activeInDb,
      `${await page.eval(`document.querySelectorAll('table.objects-table tbody tr').length`)} rows`,
    );
    assert(
      "no coordinates: every row offers „Koordinaten holen\", which is the actual fix",
      (await page.eval(
        `[...document.querySelectorAll('button')].filter((b) => b.textContent.includes('Koordinaten holen')).length`,
      )) >= activeInDb,
    );
    await ledgerSurvives(page, "no coordinates");
    await shoot(page, "map-nopins-1680-dark");

    // ==== 12 · NO BUILDINGS AT ALL — the first hour of the first day =====================
    sql("UPDATE locations SET active = false");
    await page.goto(`${BASE}/`, { settle: 2500 });
    await settled(page, 25000);
    assert(
      "no buildings: the list says so in a sentence about the company, never a blank table",
      (await page.eval(`document.body.textContent.includes('Es ist kein aktives Objekt angelegt')`)) ===
        true,
      await page.eval(`document.querySelector('.empty-state')?.textContent ?? '(no empty state)'`),
    );
    assert(
      "no buildings: and no empty map frame above it",
      (await page.eval(`!document.querySelector('.map-canvas')`)) === true,
    );
    await ledgerSurvives(page, "no buildings");
    await shoot(page, "map-nobuildings-1680-dark");
  } finally {
    restored = true;
    restoreSeed();
    const after = sql(
      "SELECT count(*) FILTER (WHERE lat IS NOT NULL) || '/' || count(*) FILTER (WHERE geocode_status IS NULL) || '/' || count(*) FILTER (WHERE active) FROM locations",
    );
    assert(
      "teardown: the demo database is back where it started (pinned/never-asked/active)",
      after === before,
      `${after} vs ${before}`,
    );
    try {
      child.kill();
    } catch {
      /* already gone */
    }
  }

  console.log("");
  if (failures.length > 0) {
    console.log(`check-map-home: ${failures.length} FAIL`);
    for (const failure of failures) console.log(`  - ${failure}`);
    process.exit(1);
  }
  console.log("check-map-home: PASS");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
