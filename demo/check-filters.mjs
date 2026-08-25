// The runnable check for the URL filter contract (decision-38) and the nav prune
// (decision-39).
//
//   cd web && pnpm build
//   DATABASE_URL=postgres:///nfc_demo APP_KEY=… PORT=8092 PUBLIC_DIR="$PWD/web/out" \
//     node demo/demo-server.mjs &
//   node demo/check-filters.mjs
//
// WHAT IT PROVES, and why each of these is a thing a code reading cannot establish:
//
//   1. A LINK ARRIVES FILTERED. It is not enough that the href contains `?location=…`; the
//      target must render fewer rows than it renders unfiltered, and the rows it renders
//      must be the right ones. So every link assertion is: read the href, follow it, count
//      the rows, compare against the unfiltered count, and read a value out of a cell.
//   2. THE FILTER IS VISIBLE AND REMOVABLE. A filtered screen and an empty database look
//      identical, and this product has already made a director believe his payroll data was
//      gone by showing him a correctly empty table. So the chip must be in the DOM, must
//      name the object, and clicking its ✕ must restore the unfiltered count.
//   3. A MANGLED URL DEGRADES. One per parameter, hand-typed nonsense, and the screen must
//      still render its own content — never a blank page, never a stack trace.
//   4. BACK BEHAVES. Opening a panel pushes, so back closes it; changing a filter replaces,
//      so back does not walk through every dropdown twiddle.
//
// PORT 8092 IS PART OF THE FIXTURE. The Maps browser key is referrer-restricted to
// `http://127.0.0.1:8080/*` (among others), so on 8092 Google answers `gm_authFailure`, the
// map region on `/` tears itself down, and `?location=` renders the Objektpanel as the
// DRAWER — which is what the assertions below read. That is the degraded path and it is the
// right one to pin here: this file is about the parameter contract, not about the map.
// demo/check-map-home.mjs runs on 8080 and covers the other rendering of the same URL.
//
// Everything is bounded: every wait has a timeout and the run has a deadline. A check that
// blocks forever is not a slow test, it is a test that cannot fail.
//
// READ-ONLY against nfc_demo: it follows links, opens panels and presses back. It never
// submits a form and never writes a row.
import { mkdirSync } from "node:fs";
import { attach, launchChrome, sleep } from "./cdp.mjs";

const BASE = process.env.DEMO_BASE ?? "http://127.0.0.1:8092";
const SHOTS = "/tmp/ts-demo/filters";
const DEADLINE_MS = 6 * 60 * 1000;
const ADMIN = { email: "demo@example.test", password: "demo-nur-lokal-2026" };

const host = new URL(BASE).hostname;
if (!["127.0.0.1", "localhost", "[::1]", "::1"].includes(host)) {
  console.error(`check-filters: refusing to run against "${host}" — loopback only.`);
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

/** Rows in the first `.data-table` on screen. The unit every filter assertion counts in. */
const ROWS = `document.querySelectorAll('table.data-table tbody tr').length`;
/** Every chip, as "Label: Value". The sentence the reader sees. */
const CHIPS = `[...document.querySelectorAll('.filter-chip-text')].map((c) => c.textContent.trim())`;
/** A message next-intl could not find renders as its own key path. */
const KEY_LEAK = `(() => (document.body.innerText.match(
  /\\b(home|shifts|workers|payroll|pl|analytics|locations|clients|materials|contracts|filters|overlay|nav)\\.[a-zA-Z]{3,}/g
) || []))()`;

/**
 * TASK-269: `/shifts/` is paged at SHIFT_PAGE_SIZE=50 (TASK-18), so `ROWS` (the visible
 * tbody) tops out at 50 regardless of how many rows actually match — a filtered AND an
 * unfiltered view both read 50 on any building/period with >=50 shifts, and a count built
 * from ROWS alone cannot tell "fewer" from "page cap" and cannot tell "restored" from
 * "still capped". The true count is server-computed (`shift_matching_count`) and printed
 * verbatim in the AnswerBand's "shown X of Y" cell (web/app/shifts/page.tsx, t('shownOfTotal')
 * — "{shown} von {total}" / "{shown} of {total}", locale-agnostic: the total is always the
 * trailing number). Read that instead of counting rows.
 */
async function matchingTotal(page) {
  const total = await page.eval(`(() => {
    const cells = [...document.querySelectorAll('.answer .cell .v')]
    for (const c of cells) {
      const m = c.textContent.trim().match(/^(\\d+)\\D+(\\d+)$/)
      if (m) return Number(m[2])
    }
    return null
  })()`);
  if (total === null) throw new Error("matchingTotal: no 'shown X of Y' cell found in .answer");
  return total;
}

async function login(page) {
  await page.goto(`${BASE}/login/`, { settle: 700 });
  await page.type('input[name="email"]', ADMIN.email, { perChar: 0 });
  await page.type('input[name="password"]', ADMIN.password, { perChar: 0 });
  await page.clickText("Anmelden", { selector: 'form button[type="submit"]' });
  await page.waitFor(`location.pathname === '/'`, { timeout: 15000, label: "the dashboard" });
}

/** Read the href of the first link whose text contains `text`, without following it. */
async function hrefOf(page, text, selector = "a") {
  return page.eval(`(() => {
    const hit = [...document.querySelectorAll(${JSON.stringify(selector)})]
      .find((el) => (el.textContent || '').includes(${JSON.stringify(text)}))
    return hit ? hit.getAttribute('href') : null
  })()`);
}

async function shoot(page, name) {
  await page.screenshot(`${SHOTS}/${name}.png`);
  console.log(`       shot ${name}.png`);
}

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const port0 = 9700 + (process.pid % 200);
  const { child, port } = await launchChrome({ port: port0, width: 1680, height: 1050 });
  const page = await attach(port);

  try {
    await login(page);

    // ==== 0 · the baseline every filter assertion is measured against ====================
    await page.goto(`${BASE}/shifts/?period=all`, { settle: 1200 });
    await page.waitFor(`(${ROWS}) > 0`, { label: "the unfiltered shift log" });
    const allShifts = await matchingTotal(page);
    assert("baseline: the shift log has rows to filter", allShifts > 5, `${allShifts} rows`);

    // ==== 1 · nav 12 → 9, and nothing was orphaned =======================================
    const navHrefs = await page.eval(
      `[...document.querySelectorAll('.nav-list a')].map((a) => new URL(a.href).pathname)`,
    );
    assert("nav: 9 destinations, down from 12 (decision-39)", navHrefs.length === 9, navHrefs.join(" "));
    for (const gone of ["/contracts/", "/analytics/", "/inventory/"]) {
      assert(`nav: ${gone} left the sidebar`, !navHrefs.includes(gone));
    }

    // ==== 2 · the Objektpanel, and the eleven links out of it ============================
    await page.goto(`${BASE}/locations/`, { settle: 1200 });
    await page.waitFor(`document.querySelector('table.data-table tbody tr')`, {
      label: "the buildings table",
    });
    const buildingHref = await page.eval(
      `document.querySelector('table.data-table tbody th a')?.getAttribute('href')`,
    );
    const buildingName = await page.eval(
      `document.querySelector('table.data-table tbody th a')?.textContent?.trim()`,
    );
    assert(
      "locations: the building name links to its object surface, carrying the uuid",
      /^\/\?location=[0-9a-f-]{36}$/.test(buildingHref ?? ""),
      buildingHref ?? "no link",
    );
    const uuid = (buildingHref ?? "").split("=")[1];

    await page.goto(`${BASE}${buildingHref}`, { settle: 1400 });
    // TWO RENDERINGS, ONE CONTRACT. decision-39 made the map the landing surface, and since
    // then a building the map can draw opens as the INFO BOX ON ITS PIN while a building with
    // no coordinates opens as the drawer (MAP-HOME-SPEC §7, STATE-GALLERY §1). This waited for
    // `.drawer` and nothing else, so it timed out on a pinned building — which is the ordinary
    // case — and reported it as „the Objektpanel never opened".
    //
    // Accepting either is NOT loosening the assertion: exactly one of the two may be on the
    // screen (HomeMap tells `/` through `onDrawnChange` precisely so two boxes about one
    // building cannot ship), and that exclusivity is asserted here rather than assumed. The
    // title still has to name the building the row named.
    await page.waitFor(`document.querySelector('.drawer, .map-info')`, {
      label: "the Objektpanel (drawer or info box)",
    });
    const panel = await page.eval(`(() => {
      const drawer = document.querySelector('.drawer')
      const box = document.querySelector('.map-info')
      return {
        kind: drawer !== null ? (box !== null ? 'BOTH' : 'drawer') : 'info box',
        title: (drawer?.querySelector('h2') ?? box?.querySelector('h3'))?.textContent?.trim() ?? null,
      }
    })()`);
    const panelTitle = panel.title;
    assert(
      "/?location=<uuid> opens the Objektpanel ON that building, in exactly one place",
      panel.kind !== "BOTH" &&
        panelTitle !== null &&
        (buildingName ?? "").startsWith(panelTitle),
      `${panel.kind} titled "${panelTitle}", row said "${buildingName}"`,
    );
    const leak = await page.eval(KEY_LEAK);
    assert("Objektpanel: no message key rendered as text", leak.length === 0, leak.join(", "));
    const chipsOnHome = await page.eval(CHIPS);
    assert(
      "Objektpanel: the filter is echoed as a chip naming the building",
      chipsOnHome.length === 1 && chipsOnHome[0].includes(panelTitle ?? "\u0000"),
      chipsOnHome.join(" | "),
    );
    await shoot(page, "objektpanel-1680");

    // The panel is whichever of the two shapes opened above. `.map-info` keeps both faces
    // MOUNTED and hides one with the `hidden` attribute, so the hrefs are readable either
    // way — and asking the DOM for them is the right question here: whether a link is on
    // the screen is V1's question and is measured, in geometry, by demo/recheck.mjs.
    const PANEL = ".drawer, .map-info";
    const panelLinks = await page.eval(
      `[...document.querySelectorAll('${PANEL}')].flatMap((p) => [...p.querySelectorAll('.panel-links a')]).map((a) => a.getAttribute('href'))`,
    );
    // Every link out of the panel must carry state. A bare href here is the whole defect.
    const bare = panelLinks.filter((href) => !href.includes("?"));
    assert(
      "Objektpanel: EVERY link out of it carries a filter",
      bare.length === 0,
      bare.length === 0 ? `${panelLinks.length} links, all filtered` : bare.join(" "),
    );
    // RULE 1: a link is never rendered to an empty target — the zero is stated in words.
    // Whichever way this building falls, one of the two must be on screen and never both.
    const materialLink = panelLinks.some((href) => href.startsWith("/material-requests/"));
    const materialWords = await page.eval(
      `!!document.querySelector('.drawer .panel-link-empty, .map-info .panel-link-empty')`,
    );
    assert(
      "Objektpanel: the material queue is either a link or the words, never both, never neither",
      materialLink !== materialWords,
      `link=${materialLink} words=${materialWords}`,
    );

    for (const [label, want] of [
      ["shifts of this building", `/shifts/?location=${uuid}&period=thisMonth`],
      ["payroll, this building, last month", `/payroll/?location=${uuid}&period=lastMonth`],
      ["P&L, this building, last month", `/pl/?location=${uuid}&period=lastMonth`],
      ["contract history of this building", `/contracts/?location=${uuid}`],
      ["time trend of this building", `/analytics/?location=${uuid}`],
      ["edit this building", `/locations/?open=${uuid}`],
    ]) {
      assert(`Objektpanel link: ${label}`, panelLinks.includes(want), want);
    }

    // ==== 3 · follow them, and prove the target ARRIVES FILTERED ==========================
    // /shifts/?location=…
    await page.goto(`${BASE}/shifts/?location=${uuid}&period=all`, { settle: 1400 });
    await page.waitFor(`document.querySelector('.filter-chip-text')`, { label: "the chip" });
    // Counts the WINDOW (server-side matching total), not the page (TASK-269): on a
    // building with >=50 shifts, visible tbody rows read 50 either way and cannot tell
    // filtered from unfiltered.
    const shiftsHere = await matchingTotal(page);
    const shiftChips = await page.eval(CHIPS);
    assert(
      "/shifts/?location= arrives FILTERED, not merely at /shifts/",
      shiftsHere > 0 && shiftsHere < allShifts,
      `${shiftsHere} of ${allShifts} matching`,
    );
    assert(
      "/shifts/: the filter is visible as a chip naming the building",
      shiftChips.some((c) => c.includes(panelTitle ?? "\u0000")),
      shiftChips.join(" | "),
    );
    const onlyThisBuilding = await page.eval(
      `[...new Set([...document.querySelectorAll('table.data-table tbody tr td:nth-child(2)')]
         .map((td) => td.textContent.trim()))]`,
    );
    assert(
      "/shifts/: every visible row really is that building",
      onlyThisBuilding.length === 1,
      onlyThisBuilding.join(" | "),
    );
    await shoot(page, "shifts-filtered-1680");

    // …and the chip's ✕ puts the table back. Same TASK-269 reasoning: this building has
    // >=50 shifts, so a broken removal (still filtered) would ALSO show 50 visible rows,
    // identical to a correct removal's first page — ROWS cannot tell them apart. The
    // matching total can: it is 348-ish restored, or it is still 71-ish stuck.
    await page.eval(`document.querySelector('.filter-chip-remove')?.click()`);
    await sleep(600);
    const afterRemoval = await matchingTotal(page);
    assert(
      "/shifts/: removing the chip restores every row",
      afterRemoval === allShifts,
      `${afterRemoval} of ${allShifts} matching after removal`,
    );
    assert(
      "/shifts/: removing the chip takes the parameter out of the URL too",
      !(await page.eval("location.search")).includes("location="),
      await page.eval("location.search"),
    );

    // /shifts/?state=unresolved — payroll's caveat link, and the reason period=all matters.
    await page.goto(`${BASE}/shifts/?period=all&state=unresolved`, { settle: 1400 });
    const unresolvedRows = await page.eval(ROWS);
    const states = await page.eval(
      `[...new Set([...document.querySelectorAll('table.data-table tbody tr td:nth-child(6) .badge')]
         .map((b) => b.textContent.trim()))]`,
    );
    assert(
      "/shifts/?state=unresolved shows ONLY unconfirmed shifts",
      unresolvedRows > 0 && states.length === 1 && states[0] === "Nicht bestätigt",
      `${unresolvedRows} rows, states: ${states.join("/")}`,
    );

    // ==== 3b · a FILTERED empty period still offers its way out, and keeps the filter =====
    // The escape hatch on `/shifts/` („nothing in this period — 5 shifts exist outside it")
    // is the machinery that once stood between „fine" and „our payroll data is gone", and a
    // filter contract is exactly the change that could quietly bypass it: `outsideCount` is
    // now counted over the state-filtered rows, not over everything.
    //
    // `state=open&period=lastMonth` is empty by construction rather than by fixture luck —
    // an OPEN shift is one that started and has not ended, so it is never in a month that
    // has already finished, and the seed always has one running.
    await page.goto(`${BASE}/shifts/?state=open&period=lastMonth`, { settle: 1500 });
    const escapeText = await page.eval(
      `document.querySelector('.empty-state')?.textContent?.trim() ?? ''`,
    );
    const escapeButtons = await page.eval(
      `[...document.querySelectorAll('.form-actions button')].map((b) => b.textContent.trim())`,
    );
    assert(
      "/shifts/: a filtered empty period still says how many rows are OUTSIDE it",
      (await page.eval(ROWS)) === 0 && /au\u00dferhalb/.test(escapeText),
      escapeText.slice(0, 80),
    );
    assert(
      "/shifts/: …and still offers both ways out",
      escapeButtons.length === 2,
      escapeButtons.join(" / "),
    );
    // The way out must not throw the filter away: „show me everything" means every PERIOD,
    // not every shift in the company. Landing on an unfiltered log here would be the same
    // lost context the whole contract exists to keep.
    await page.eval(`document.querySelector('.form-actions button')?.click()`);
    await sleep(700);
    assert(
      "/shifts/: the way out changes the period and KEEPS the filter",
      (await page.eval("location.search")).includes("state=open") &&
        (await page.eval("location.search")).includes("period=all") &&
        (await page.eval(ROWS)) > 0,
      `${await page.eval("location.search")} → ${await page.eval(ROWS)} rows`,
    );

    // ==== 4 · the Mitarbeiterpanel =======================================================
    await page.goto(`${BASE}/workers/`, { settle: 1200 });
    await page.waitFor(`document.querySelector('table.data-table tbody tr')`, {
      label: "the worker table",
    });
    const allWorkers = await page.eval(ROWS);
    await page.eval(`document.querySelector('table.data-table tbody th button')?.click()`);
    await page.waitFor(`document.querySelector('.drawer')`, { label: "the Mitarbeiterpanel" });
    const workerName = await page.eval(`document.querySelector('.drawer h2')?.textContent?.trim()`);
    assert(
      "clicking a worker name opens the panel AND writes ?worker= to the URL",
      /\?worker=\d+$/.test(await page.eval("location.search")),
      await page.eval("location.search"),
    );
    const workerLeak = await page.eval(KEY_LEAK);
    assert(
      "Mitarbeiterpanel: no message key rendered as text",
      workerLeak.length === 0,
      workerLeak.join(", "),
    );
    const workerLinks = await page.eval(
      `[...document.querySelectorAll('.drawer .panel-links a')].map((a) => a.getAttribute('href'))`,
    );
    const workerId = (await page.eval("location.search")).split("=")[1];
    assert(
      "Mitarbeiterpanel: all shifts of this person, all periods",
      workerLinks.includes(`/shifts/?worker=${workerId}&period=all`),
      workerLinks.join(" "),
    );
    assert(
      "Mitarbeiterpanel: payroll for this person, in payroll's OWN period",
      workerLinks.includes(`/payroll/?worker=${workerId}&period=lastMonth`),
      workerLinks.join(" "),
    );
    await shoot(page, "mitarbeiterpanel-1680");

    // ==== 5 · BACK BEHAVES ===============================================================
    // Opening the panel PUSHED, so one back press closes it and leaves the list intact.
    await page.eval("history.back()");
    await sleep(800);
    assert(
      "back closes the panel it opened (open = push)",
      (await page.eval(`!document.querySelector('.drawer')`)) === true &&
        (await page.eval("location.search")) === "",
      `search="${await page.eval("location.search")}" drawer=${await page.eval(
        `!!document.querySelector('.drawer')`,
      )}`,
    );
    assert(
      "back leaves the list behind the panel untouched",
      (await page.eval(ROWS)) === allWorkers,
      `${await page.eval(ROWS)} of ${allWorkers} rows`,
    );

    // Changing a filter REPLACED, so four twiddles do not cost four back presses.
    await page.goto(`${BASE}/shifts/?period=all`, { settle: 1200 });
    const beforeTwiddles = await page.eval("history.length");
    for (const value of ["thisMonth", "lastMonth", "thisYear", "all"]) {
      await page.select(".filter-bar .field:nth-child(3) select", value);
      await sleep(250);
    }
    const afterTwiddles = await page.eval("history.length");
    assert(
      "four filter changes add ZERO history entries (change = replace)",
      afterTwiddles === beforeTwiddles,
      `history.length ${beforeTwiddles} → ${afterTwiddles}`,
    );
    assert(
      "…and the last one is still in the URL, so the view is linkable",
      (await page.eval("location.search")).includes("period=all"),
      await page.eval("location.search"),
    );

    // ==== 6 · a hand-mangled URL degrades, one per parameter ==============================
    const mangled = [
      ["location", `/?location=not-a-uuid`, `.topline h1`],
      ["location (well formed, names nothing)", `/?location=${"0".repeat(8)}-0000-0000-0000-${"0".repeat(12)}`, `.topline h1`],
      ["worker", `/workers/?worker=abc`, `table.data-table`],
      ["worker (zero)", `/workers/?worker=0`, `table.data-table`],
      ["client", `/clients/?client=-1`, `table.data-table`],
      ["shift", `/shifts/?shift=1.5&period=all`, `table.data-table`],
      ["period", `/payroll/?period=letzterMonat`, `.answer`],
      ["state", `/shifts/?state=nonsense&period=all`, `table.data-table`],
      ["status", `/material-requests/?status=nonsense`, `.topline h1`],
      ["open", `/locations/?open=%2Fetc%2Fpasswd`, `table.data-table`],
      ["all of them at once", `/?location=x&worker=y&client=z&shift=q&period=p&state=s&status=t&open=o`, `.topline h1`],
    ];
    for (const [name, url, mustRender] of mangled) {
      await page.goto(`${BASE}${url}`, { settle: 1100 });
      const rendered = await page.eval(`!!document.querySelector(${JSON.stringify(mustRender)})`);
      const errors = await page.eval(
        `[...document.querySelectorAll('[role="alert"]')].map((p) => p.textContent.trim()).filter(Boolean)`,
      );
      assert(
        `mangled ?${name} → the screen still renders, no error`,
        rendered && errors.length === 0,
        `rendered=${rendered} alerts=${errors.join(" | ")}`,
      );
    }

    // A well-formed uuid that names nothing must SAY SO — never silently show everything.
    const ghost = `00000000-0000-0000-0000-000000000000`;
    await page.goto(`${BASE}/?location=${ghost}`, { settle: 1200 });
    const ghostChips = await page.eval(CHIPS);
    assert(
      "an unknown building says it is unknown rather than quietly showing the dashboard",
      ghostChips.some((c) => c.includes("unbekannt")),
      ghostChips.join(" | "),
    );
    // Probed as an ELEMENT, not as body text: the chip's own wording contains the same
    // words, so a body-text probe stays green while the notice itself is gone. That is
    // exactly the mutation this line exists to catch.
    const ghostNotice = await page.eval(
      `document.querySelector('.notice.bad')?.textContent?.trim() ?? ''`,
    );
    assert(
      "…and the screen states, in its own sentence, that nothing is missing",
      ghostNotice.includes("Filter") && ghostNotice.length > 40,
      ghostNotice === "" ? "no .notice.bad on the page" : ghostNotice,
    );
    // Both shapes, not just the drawer: since decision-39 a pinned building opens as the
    // info box on its pin, so „no drawer" would have been satisfied by a ghost id that
    // opened a box on the nearest pin — the exact leak this line exists to forbid.
    assert(
      "…and it does NOT open a panel on somebody else's building, in EITHER shape",
      (await page.eval(`!document.querySelector('.drawer, .map-info')`)) === true,
      await page.eval(
        `document.querySelector('.drawer, .map-info')?.className ?? 'nothing opened'`,
      ),
    );
    await shoot(page, "unknown-building-1680");

    // An empty list says WHICH filter emptied it. Three sentences on `/locations/` and they
    // are not interchangeable: „noch keine Objekte angelegt" to a company with forty is the
    // misreading this contract exists to stop, and so is „nur Objekte ohne erfasste Schicht"
    // when what actually emptied the list was a client filter.
    await page.goto(`${BASE}/locations/?client=999999`, { settle: 1300 });
    const emptyByClient = await page.eval(
      `document.querySelector('.empty-state')?.textContent?.trim() ?? ''`,
    );
    assert(
      "/locations/: an empty CLIENT filter names the client, not the tag state",
      emptyByClient.includes("Kunden") && !emptyByClient.includes("erfasste Schicht"),
      emptyByClient,
    );
    await page.goto(`${BASE}/locations/?state=noTag`, { settle: 1300 });
    const noTagBody = await page.eval(
      `document.querySelector('.empty-state')?.textContent?.trim()
         ?? document.querySelector('table.data-table') ? 'rows' : ''`,
    );
    assert(
      "/locations/?state=noTag either lists buildings or says THAT is what it filtered on",
      noTagBody === "rows" || noTagBody.includes("erfasste Schicht"),
      noTagBody,
    );

    // ==== 7 · payroll's three caveat links land in payroll's OWN period ===================
    await page.goto(`${BASE}/payroll/?period=all`, { settle: 1400 });
    // `all` is not a payroll period; the screen must fall back rather than break.
    assert(
      "/payroll/?period=all is refused politely (PAYROLL_PERIODS has no 'all')",
      (await page.eval(`!!document.querySelector('.answer')`)) === true,
    );
    await page.goto(`${BASE}/payroll/?period=thisYear`, { settle: 1600 });
    await page.waitFor(`document.querySelector('.callout')`, { label: "the caveat block" });
    for (const [label, want] of [
      ["unresolved", "state=unresolved"],
      ["open", "state=open"],
      ["manual", "state=manual"],
    ]) {
      const href = await hrefOf(page, "Schichten", ".callout a");
      const all = await page.eval(
        `[...document.querySelectorAll('.callout a')].map((a) => a.getAttribute('href'))`,
      );
      const hit = all.find((h) => h.includes(want));
      assert(
        `/payroll/ caveat link (${label}) carries the period AND the condition`,
        hit !== undefined && hit.includes("period=thisYear"),
        hit ?? `none of: ${all.join(" ")} (first: ${href})`,
      );
    }
    await shoot(page, "payroll-caveats-1680");

    // ==== 8 · a scoped payroll refuses to export, and says why ============================
    await page.goto(`${BASE}/payroll/?location=${uuid}&period=thisYear`, { settle: 1600 });
    assert(
      "/payroll/?location= narrows to the people with hours there",
      (await page.eval(ROWS)) > 0,
      `${await page.eval(ROWS)} rows`,
    );
    assert(
      "scoped payroll withholds the CSV export…",
      (await page.eval(
        `![...document.querySelectorAll('button')].some((b) => b.textContent.includes('CSV'))`,
      )) === true,
    );
    assert(
      "…and states the reason where the filter is",
      (await page.eval(`document.body.innerText.includes('CSV-Export')`)) === true,
    );
    assert(
      "scoped payroll makes NO reconciliation claim it cannot check",
      (await page.eval(`!document.body.innerText.includes('Es fehlt nichts')`)) === true,
    );

    // ==== 9 · the payroll caveats and named exclusions still survive unfiltered ===========
    await page.goto(`${BASE}/payroll/?period=thisYear`, { settle: 1600 });
    // `textContent`, not `innerText`: two of these live inside a <details> that ships
    // CLOSED, and innerText cannot see a closed disclosure. Whether they should be OPEN is a
    // live design question (REDESIGN-INVENTORY truth #14 says unconditional, review finding
    // D8 closed it) and is deliberately NOT decided by this batch. What IS this batch's
    // business: the filter work must not have deleted them, and it did not.
    for (const truth of [
      ["the rate-history caveat survived the filter work", "nur ein Stundensatz"],
      ["the attribution rule survived the filter work", "begonnen hat"],
    ]) {
      assert(
        `/payroll/: ${truth[0]}`,
        (await page.eval(`document.body.textContent.includes(${JSON.stringify(truth[1])})`)) ===
          true,
      );
    }
    // THE „no rate" TRUTH THAT USED TO BE ASSERTED HERE IS GONE, and its removal is the
    // point rather than an omission: decision-41 made a wage of 0 unrepresentable, so
    // „Kein Stundensatz" is copy for a state the column no longer admits. What replaces it
    // is the assertion that the copy did not survive the state.
    assert(
      "/payroll/: no copy survives for a wage that cannot be missing",
      (await page.eval(
        `!document.body.textContent.includes('Kein Stundensatz') && !document.body.textContent.includes('ohne Stundensatz')`,
      )) === true,
    );
    // The reconciliation line itself, which is about the ROW CAP and not about wages: the
    // loaded shifts add up to exactly what the server totalled, or the screen says by how
    // much they do not. „fehlt nichts" is the phrase both branches of that sentence share.
    assert(
      "/payroll/: the reconciliation is still claimed when nothing is filtered",
      (await page.eval(
        `document.body.textContent.includes('fehlt nichts') || document.body.textContent.includes('fehlen')`,
      )) === true,
    );

    // ==== 10 · the three demoted routes are reachable, filtered ===========================
    await page.goto(`${BASE}/contracts/?location=${uuid}`, { settle: 1500 });
    assert(
      "/contracts/?location= arrives with the building already selected",
      (await page.eval(`document.querySelector('.toolbar-field select')?.value`)) === uuid,
      await page.eval(`document.querySelector('.toolbar-field select')?.value`),
    );
    await page.goto(`${BASE}/analytics/?location=${uuid}`, { settle: 1800 });
    assert(
      "/analytics/?location= arrives with that building's panel open",
      (await page.eval(`document.querySelector('.drawer h2')?.textContent?.trim()`)) ===
        panelTitle,
      await page.eval(`document.querySelector('.drawer h2')?.textContent?.trim()`),
    );
    await page.goto(`${BASE}/material-requests/`, { settle: 1400 });
    assert(
      "/inventory/ has a permanent way in from the material queue",
      (await page.eval(
        `[...document.querySelectorAll('a')].some((a) => a.getAttribute('href') === '/inventory/')`,
      )) === true,
    );

    // ==== 11 · 390px — the chip is above the fold and nothing scrolls sideways ============
    await page.send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await sleep(300);
    await page.goto(`${BASE}/shifts/?location=${uuid}&period=all`, { settle: 1500 });
    await page.waitFor(`document.querySelector('.filter-chip')`, { label: "the chip at 390px" });
    const chipTop = await page.eval(
      `document.querySelector('.filter-chip').getBoundingClientRect().top`,
    );
    assert("390px: the chip is above the fold", chipTop < 844, `top ${Math.round(chipTop)}px`);
    const overflow = await page.eval(
      `document.documentElement.scrollWidth - document.documentElement.clientWidth`,
    );
    assert("390px: no horizontal scroll with a chip on screen", overflow <= 0, `${overflow}px`);
    const removeBox = await page.eval(
      `(() => { const r = document.querySelector('.filter-chip-remove').getBoundingClientRect()
         return { w: Math.round(r.width), h: Math.round(r.height) } })()`,
    );
    assert(
      "390px: the ✕ is a 44px target",
      removeBox.w >= 44 && removeBox.h >= 44,
      `${removeBox.w}×${removeBox.h}`,
    );
    await shoot(page, "chip-390");

    // ==== 12 · the remaining link sites, by row ===========================================
    // Each of these is a cell whose TEXT is the link, so the row gains no column and a 390px
    // card keeps its shape. Asserted as hrefs rather than followed one by one: the follow-
    // through is proven above, on the shift log, and what can still go wrong here is a link
    // that forgot its id.
    await page.send("Emulation.clearDeviceMetricsOverride");
    await sleep(200);

    const rowLinks = [
      ["/shifts/ row: the worker name → that person's panel", "/shifts/?period=all", /^\/workers\/\?worker=\d+$/, "table.data-table tbody th a"],
      ["/shifts/ row: the building name → its object surface", "/shifts/?period=all", /^\/\?location=[0-9a-f-]{36}$/, "table.data-table tbody td:nth-child(2) a"],
      ["/payroll/ row: the worker name → that person's panel", "/payroll/?period=thisYear", /^\/workers\/\?worker=\d+$/, "table.data-table tbody th a"],
      ["/locations/ row: the contract cell → that building's contract history", "/locations/", /^\/contracts\/\?location=[0-9a-f-]{36}$/, "table.data-table tbody td a"],
      ["/clients/ row: the buildings cell → that client's buildings", "/clients/", /^\/locations\/\?client=\d+$/, "table.data-table tbody td a"],
      ["/material-requests/ row: the worker name → that person's panel", "/material-requests/?status=all", /^\/workers\/\?worker=\d+$/, "table.data-table tbody th a"],
      ["/material-requests/ row: the named building → its object surface", "/material-requests/?status=all", /^\/\?location=[0-9a-f-]{36}$/, "table.data-table tbody td a"],
    ];
    for (const [label, url, shape, selector] of rowLinks) {
      await page.goto(`${BASE}${url}`, { settle: 1400 });
      const hrefs = await page.eval(
        `[...document.querySelectorAll(${JSON.stringify(selector)})].map((a) => a.getAttribute('href'))`,
      );
      const hit = hrefs.find((href) => shape.test(href));
      assert(label, hit !== undefined, hit ?? `none of ${hrefs.length}: ${hrefs.slice(0, 3).join(" ")}`);
    }

    // /pl/ — the flagged block is the one place in the admin that argues in prose, and every
    // link under that argument must be about the building it just argued over.
    await page.goto(`${BASE}/pl/?period=thisYear`, { settle: 1800 });
    const plRowLink = await page.eval(
      `document.querySelector('table.data-table tbody th a')?.getAttribute('href')`,
    );
    assert(
      "/pl/ row: the building name → its object surface",
      /^\/\?location=[0-9a-f-]{36}$/.test(plRowLink ?? ""),
      plRowLink ?? "no link",
    );
    const plFlagged = await page.eval(
      `[...document.querySelectorAll('.list .callout .panel-links a')].map((a) => a.getAttribute('href'))`,
    );
    if (plFlagged.length === 0) {
      console.log("       (no flagged building in this fixture - the flagged links are not on screen)");
    } else {
      const bareFlagged = plFlagged.filter((href) => !href.includes("location="));
      assert(
        "/pl/ flagged block: every link carries the building it argued about",
        bareFlagged.length === 0,
        bareFlagged.length === 0 ? plFlagged.join(" ") : bareFlagged.join(" "),
      );
      assert(
        "/pl/ flagged block: the shift link carries the P&L's OWN period",
        plFlagged.some((href) => href.includes("/shifts/") && href.includes("period=thisYear")),
        plFlagged.join(" "),
      );
    }

    // ==== 13 · the same screens in English ================================================
    // WHAT PROVES WHAT, so nobody reads more into this than it says: `pnpm check` proves the
    // two locale files carry the identical KEY SET, and `global.d.ts` types every `t()` call
    // against en.json so a key that does not exist fails `tsc` before it can ship. What
    // NEITHER of those sees is a key that exists and renders wrongly, or a screen that reads
    // half-German in English. ~100 keys landed with this contract; this is the pass that
    // looks at them rendered.
    await page.goto(`${BASE}/?location=${uuid}`, { settle: 1500 });
    await page.select(".locale-switcher select", "en");
    await sleep(700);
    const enLeak = await page.eval(KEY_LEAK);
    assert(
      "English: the Objektpanel renders no message key as text",
      enLeak.length === 0,
      enLeak.join(", "),
    );
    const enChips = await page.eval(CHIPS);
    assert(
      "English: the chip is translated, not a German string in an English screen",
      enChips.some((c) => c.startsWith("Building:")),
      enChips.join(" | "),
    );
    await shoot(page, "objektpanel-en-1680");

    await page.goto(`${BASE}/workers/?worker=1`, { settle: 1500 });
    await page.select(".locale-switcher select", "en");
    await sleep(700);
    const enWorkerLeak = await page.eval(KEY_LEAK);
    assert(
      "English: the Mitarbeiterpanel renders no message key as text",
      enWorkerLeak.length === 0,
      enWorkerLeak.join(", "),
    );
    await shoot(page, "mitarbeiterpanel-en-1680");
  } finally {
    await page.close();
    child.kill();
  }

  if (failures.length > 0) {
    console.log(`\n${failures.length} failed:\n- ${failures.join("\n- ")}`);
    process.exit(1);
  }
  console.log("\ncheck-filters: PASS");
}

const bail = setTimeout(() => {
  console.error("check-filters: deadline exceeded");
  process.exit(1);
}, DEADLINE_MS);
bail.unref();

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
