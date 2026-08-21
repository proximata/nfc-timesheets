// LOOK.md W7 — `/tags/` printed the raw UTC ISO string for `reported_at`. Every other
// boundary in this product pins Europe/Vienna explicitly; this one did not, and a tag
// reported 00:00-02:00 Vienna time (UTC is BEHIND Vienna) rendered as the PREVIOUS calendar
// day — exactly when a night crew mounts cards.
//
//   «stack»  seeded nfc_demo + the API serving a build of these screens (loopback only)
//   DEMO_BASE=http://127.0.0.1:8092 node demo/check-tags-timezone.mjs
//
// THE DATABASE IS MUTATED: one throwaway reported_tags row, deleted in a `finally` by its
// own id — no dump/restore needed, nothing else is touched.
//
// No new dependency: demo/cdp.mjs, Node, the Chrome already on the machine.
import { execFileSync } from "node:child_process";
import { attach, launchChrome, sleep } from "./cdp.mjs";

const BASE = process.env.DEMO_BASE ?? "http://127.0.0.1:8092";
const DB = process.env.DEMO_DB ?? "nfc_demo";

const host = new URL(BASE).hostname;
if (!["127.0.0.1", "localhost", "[::1]", "::1"].includes(host)) {
  console.error(`check-tags-timezone: refusing "${host}" — loopback only.`);
  process.exit(1);
}
if (DB !== "nfc_demo") {
  console.error(`check-tags-timezone: refusing to write to "${DB}" — nfc_demo only.`);
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
  } finally {
    child.kill("SIGKILL");
    exec(`DELETE FROM reported_tags WHERE id = '${TAG_ID}'`);
  }

  console.log(failures ? `\ncheck-tags-timezone: FAIL (${failures})` : "\ncheck-tags-timezone: all checks green");
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  exec(`DELETE FROM reported_tags WHERE id = '${TAG_ID}'`);
  process.exit(1);
});
