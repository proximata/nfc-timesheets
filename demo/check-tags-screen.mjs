// LOOK.md W7, C3, C4 — three findings on the one screen that is reachable, deliberately
// plain, and carries none of the house i18n or component library (see the file's own
// header):
//
//   W7  reported_at printed the raw UTC ISO string. 00:00-02:00 Vienna time (UTC is BEHIND
//       Vienna) rendered as the PREVIOUS calendar day — exactly when a night crew mounts
//       cards.
//   C3  the admin sees a 36-character UUID; the operator's phone shows only the last six
//       (core/WriteGuard.kt token). The two humans in this procedure had no shared handle.
//   C4  a refused resolve showed the server's own machine code verbatim — 'Abgelehnt:
//       duplicate_zone_name' — snake_case English in a German admin panel.
//
// decision-47 changed WHICH refusal C4 drives: the „Neues Gebäude" radio and its Name/Slug
// fields are gone with POST /admin/tags/:id/resolve-building, so the collision this screen is
// pushed into is now a zone name that already exists in the chosen building (409
// duplicate_zone_name) rather than a slug that already names a building (409 slug_taken).
// Same finding, same assertion shape, a refusal that still exists.
//
//   «stack»  seeded nfc_demo + the API serving a build of these screens (loopback only)
//   DEMO_BASE=http://127.0.0.1:8092 node demo/check-tags-screen.mjs
//
// THE DATABASE IS MUTATED: one throwaway reported_tags row, deleted in a `finally` by its
// own id — no dump/restore needed, nothing else is touched. The C4 case resolves the row
// against a zone name that ALREADY exists in nfc_demo, so nothing new is created there
// either — the refusal is the point.
//
// No new dependency: demo/cdp.mjs, Node, the Chrome already on the machine.
import { execFileSync } from "node:child_process";
import { attach, launchChrome, sleep } from "./cdp.mjs";

const BASE = process.env.DEMO_BASE ?? "http://127.0.0.1:8092";
const DB = process.env.DEMO_DB ?? "nfc_demo";

const host = new URL(BASE).hostname;
if (!["127.0.0.1", "localhost", "[::1]", "::1"].includes(host)) {
  console.error(`check-tags-screen: refusing "${host}" — loopback only.`);
  process.exit(1);
}
if (DB !== "nfc_demo") {
  console.error(`check-tags-screen: refusing to write to "${DB}" — nfc_demo only.`);
  process.exit(1);
}

const ADMIN = { email: "demo@example.test", password: "demo-nur-lokal-2026" };
const sql = (q) => execFileSync("psql", ["-d", DB, "-tAc", q], { encoding: "utf8" }).trim();
const exec = (q) => execFileSync("psql", ["-d", DB, "-v", "ON_ERROR_STOP=1", "-q", "-c", q], { encoding: "utf8" });

let failures = 0;
const assert = (name, cond, detail) => {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${detail ? `  ${detail}` : ""}`);
  }
};

// Vienna is CEST (+02:00) in August. 2026-08-17T22:30:00Z is 2026-08-18 00:30 in Vienna —
// the raw UTC date is the 17th, the true Vienna date is the 18th. If the screen ever prints
// the 17th for this row, it is reading the wrong clock.
const TAG_ID = "b6f2a8e1-4c73-4a1e-9d2a-7e6c8f1a2b3d";
const REPORTED_AT_UTC = "2026-08-17T22:30:00.000Z";
const OP1 = sql("SELECT id FROM operators WHERE active ORDER BY id LIMIT 1");
// C4: a LIVE zone name that already exists in a LIVE building, so resolve-zone answers
// 409 duplicate_zone_name. Both halves come out of the seed rather than being typed here,
// so a reseed cannot leave this check asserting against a row that is gone.
const COLLIDING = sql(
  "SELECT z.location_id || '|' || z.name FROM zones z JOIN locations l ON l.id = z.location_id WHERE z.active AND l.active ORDER BY l.name, z.name LIMIT 1",
);
const [COLLIDING_LOCATION_ID, COLLIDING_ZONE_NAME] = COLLIDING.split("|");
if (!COLLIDING_LOCATION_ID || !COLLIDING_ZONE_NAME) {
  console.error("check-tags-screen: nfc_demo has no live zone to collide with — reseed it first.");
  process.exit(1);
}

exec(`DELETE FROM reported_tags WHERE id = '${TAG_ID}'`);
exec(
  `INSERT INTO reported_tags (id, reported_at, reported_by_operator_id) VALUES ('${TAG_ID}', '${REPORTED_AT_UTC}', ${OP1 || "NULL"})`,
);



async function main() {
  const { child, port } = await launchChrome({ port: 9650 + (process.pid % 200), width: 1280, height: 900 });
  const page = await attach(port);
  try {
    await page.goto(`${BASE}/login/`, { settle: 700 });
    await page.waitFor(`document.querySelector('form button[type="submit"]')`, { label: "sign-in button" });
    await page.type('input[name="email"]', ADMIN.email, { perChar: 0 });
    await page.type('input[name="password"]', ADMIN.password, { perChar: 0 });
    await page.clickText("Anmelden", { selector: 'form button[type="submit"]' });
    await page.waitFor("location.pathname === '/'", { timeout: 15000, label: "the dashboard" });

    await page.goto(`${BASE}/tags/`, { settle: 900 });
    await page.waitFor(`document.body.textContent.includes('${TAG_ID}')`, {
      timeout: 15000,
      label: "the seeded tag row",
    });
    await sleep(200);

    const cellText = await page.eval(`(() => {
      const row = [...document.querySelectorAll('tr')].find((r) => r.textContent.includes('${TAG_ID}'))
      if (!row) return null
      return (row.cells[1]?.textContent || '').trim()
    })()`);

    console.log(`  Gemeldet am -> "${cellText}"`);
    assert("tags: reported_at is no longer the raw UTC ISO string", cellText !== REPORTED_AT_UTC, cellText ?? "row not found");
    assert(
      "tags: reported_at does NOT read as the UTC calendar day (17.08.)",
      cellText !== null && !cellText.includes("17.08"),
      cellText ?? "row not found",
    );
    assert(
      "tags: reported_at reads as the VIENNA calendar day (18.08.) — the true day a night crew lived",
      cellText !== null && cellText.includes("18.08"),
      cellText ?? "row not found",
    );

    // ---- C3: the admin's id and the phone's token, on the same row ---------------------
    const wantedToken = TAG_ID.slice(-6);
    const idCellText = await page.eval(`(() => {
      const row = [...document.querySelectorAll('tr')].find((r) => r.textContent.includes('${TAG_ID}'))
      return row ? (row.cells[0]?.textContent || '').trim() : null
    })()`);
    console.log(`  id cell -> "${idCellText}"`);
    assert("tags: the full id is still on screen (nothing here replaces it)", idCellText !== null && idCellText.includes(TAG_ID));
    // NOT `idCellText.includes(wantedToken)` — the full 36-character id ALREADY contains
    // its own last six characters as a substring, so that assertion could never fail (the
    // exact anti-pattern this whole pass exists to catch). It has to be a SEPARATE,
    // labelled occurrence: the token stated as "Token: xxxxxx", not merely present because
    // the id it is carved from is.
    const tokenLabelled = idCellText !== null && new RegExp(`Token:\\s*${wantedToken}\\b`).test(idCellText);
    assert(
      "tags: the same row ALSO states the operator's own six-character token, LABELLED (core/WriteGuard.kt)",
      tokenLabelled,
      `wanted "Token: ${wantedToken}" in "${idCellText}"`,
    );

    // ---- C4: a raw server code must never reach the screen -----------------------------
    // The „Neue Zone in bestehendem Gebäude" branch is the DEFAULT one now (decision-47
    // deleted the building branch): a <select> of buildings, then one text input for the
    // name. Both are addressed positionally through the row, since neither carries an id.
    const filledBoth = await page.eval(`(() => {
      const row = [...document.querySelectorAll('tr')].find((r) => r.textContent.includes('${TAG_ID}'))
      if (!row) return false
      const select = row.querySelector('select')
      // The Name input carries no explicit type= attribute in the JSX (it defaults to text
      // via the DOM property, not the markup) — an attribute selector for input[type="text"]
      // matches zero. Select everything that is not one of the two radios instead.
      const input = row.querySelector('input:not([type="radio"])')
      if (!select || !input) return false
      const selectSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set
      selectSetter.call(select, ${JSON.stringify(COLLIDING_LOCATION_ID)})
      select.dispatchEvent(new Event('change', { bubbles: true }))
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(input, ${JSON.stringify(COLLIDING_ZONE_NAME)})
      input.dispatchEvent(new Event('input', { bubbles: true }))
      return select.value === ${JSON.stringify(COLLIDING_LOCATION_ID)}
    })()`);
    assert("tags: the resolve form's building picker and Name field were reachable", filledBoth === true);

    // The retired capability is NAMED on the screen, not silently missing (decision-47:
    // nothing true is deleted to lighten a screen).
    const noBuildingRadio = await page.eval(
      `!document.body.textContent.includes('Neues Geb\u00e4ude')`,
    );
    assert("tags: the ‚Neues Gebäude' radio is GONE", noBuildingRadio === true);
    const saysWhereItWent = await page.eval(
      `document.body.textContent.includes('zuerst unter \u201eObjekte\u201c angelegt')`,
    );
    assert(
      "tags: …and the screen says where a new building is created instead",
      saysWhereItWent === true,
    );

    await page.eval(`(() => {
      const row = [...document.querySelectorAll('tr')].find((r) => r.textContent.includes('${TAG_ID}'))
      const btn = [...row.querySelectorAll('button')].find((b) => b.textContent.includes('Zuordnen'))
      btn?.click()
      return !!btn
    })()`);
    await page.waitFor(
      `(() => {
        const row = [...document.querySelectorAll('tr')].find((r) => r.textContent.includes('${TAG_ID}'))
        const p = row ? [...row.querySelectorAll('p[role="alert"]')].find((x) => x.textContent.trim() !== '') : null
        return !!p
      })()`,
      { timeout: 10000, label: "the row's error text" },
    );
    const rowErrorText = await page.eval(`(() => {
      const row = [...document.querySelectorAll('tr')].find((r) => r.textContent.includes('${TAG_ID}'))
      const p = row ? [...row.querySelectorAll('p[role="alert"]')].find((x) => x.textContent.trim() !== '') : null
      return p ? p.textContent.trim() : null
    })()`);
    console.log(`  row error -> "${rowErrorText}"`);
    assert(
      "tags: a refused resolve does NOT show the server's raw machine code",
      rowErrorText !== null &&
        !rowErrorText.includes("duplicate_zone_name") &&
        !rowErrorText.includes("Abgelehnt: "),
      rowErrorText ?? "no error text found",
    );
    assert(
      "tags: …it shows a real German sentence instead",
      rowErrorText !== null && rowErrorText.includes("Zone") && rowErrorText.includes("Namen"),
      rowErrorText ?? "no error text found",
    );
  } finally {
    child.kill("SIGKILL");
    exec(`DELETE FROM reported_tags WHERE id = '${TAG_ID}'`);
  }

  console.log(failures ? `\ncheck-tags-screen: FAIL (${failures})` : "\ncheck-tags-screen: all checks green");
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  exec(`DELETE FROM reported_tags WHERE id = '${TAG_ID}'`);
  process.exit(1);
});
