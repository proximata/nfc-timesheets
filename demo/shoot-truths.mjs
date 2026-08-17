// The load-bearing truths, photographed in the state a person actually sees them in.
//
//   «stack» (backlog/docs/DEMO.md §1, PUBLIC_DIR=../web/out on :8082)
//   node demo/shoot-truths.mjs             # -> docs/media/redesign/truth-*.png
//   node demo/shoot-truths.mjs --payroll   # only the two payroll shots
//
// WHY A SECOND SCRIPT. shoot-redesign.mjs photographs screens at rest, and the six things
// this project cannot afford to lose are not visible at rest: a drawer is closed, an
// enrolment code has not been issued, a copy button has not been pressed, and a payroll
// exclusion needs a period that HAS one. A verification pass that only shoots the resting
// state cannot see any of them, so it would have reported all six as "present in the
// source" -- which is exactly the kind of check this repo has been burned by.
//
// Each step ends in a screenshot AND returns the strings it read out of the DOM, so the
// report can quote what the picture shows instead of describing it. Bounded: every wait has
// a timeout and the whole run has a deadline.
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { attach, launchChrome, sleep } from "./cdp.mjs";

const BASE = process.env.DEMO_BASE ?? "http://127.0.0.1:8082";
const host = new URL(BASE).hostname;
if (!["127.0.0.1", "localhost", "[::1]", "::1"].includes(host)) {
  console.error(`shoot-truths: refusing to drive "${host}" — loopback only.`);
  process.exit(1);
}
const OUT = new URL("../docs/media/redesign/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const ADMIN = { email: "demo@example.test", password: "demo-nur-lokal-2026" };
const DEADLINE = Date.now() + 8 * 60 * 1000;
const payrollOnly = process.argv.includes("--payroll");

async function freePort(from) {
  for (let port = from; port < from + 40; port++) {
    const ok = await new Promise((resolve) => {
      const probe = createServer();
      probe.once("error", () => resolve(false));
      probe.once("listening", () => probe.close(() => resolve(true)));
      probe.listen(port, "127.0.0.1");
    });
    if (ok) return port;
  }
  throw new Error("no free debugging port");
}

const findings = {};
const say = (key, value) => {
  findings[key] = value;
  console.log(`  ${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
};

const { child, port } = await launchChrome({ port: await freePort(9560), width: 1680, height: 1100 });
const page = await attach(port);
const shot = async (name, height = 1100) => {
  const { data } = await page.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: 1680, height, scale: 1 },
  });
  // SHOT_SUFFIX keeps a second run from overwriting the first: the no-hourly-rate case needs
  // the SAME payroll screen photographed against a deliberately altered demo row.
  const file = `truth-${name}${process.env.SHOT_SUFFIX ?? ""}.png`;
  writeFileSync(`${OUT}${file}`, Buffer.from(data, "base64"));
  console.log(`  shot ${file}`);
};

try {
  await page.send("Emulation.setDeviceMetricsOverride", { width: 1680, height: 1100, deviceScaleFactor: 1, mobile: false });
  // Headless Chrome denies clipboard-write by default, so without this the copy control can
  // only ever be photographed in its FAILURE state -- which reads like an app bug and is not
  // one. Granted explicitly so both paths can be shot and told apart.
  await page.send("Browser.grantPermissions", { origin: BASE, permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"] });
  await page.goto(`${BASE}/login/`, { settle: 400 });
  await page.eval(`localStorage.setItem('nfcts.theme', 'dark')`);
  await page.goto(`${BASE}/login/`, { settle: 500 });
  await page.waitFor(`document.querySelector('form button[type="submit"]')`, { timeout: 15000, label: "sign-in button" });

  // /login/ read off the live DOM, not off the source: the regression that locks the client
  // out of their own panel is type="email", and it is invisible in a screenshot.
  say(
    "login-username-input",
    await page.eval(`(() => {
      const i = document.querySelector('form input')
      return i.type + ' / autocomplete=' + i.autocomplete + ' / label="' +
        (document.querySelector('label[for="' + i.id + '"]')?.textContent || '?') + '"'
    })()`),
  );

  await page.type('input[name="email"]', ADMIN.email, { perChar: 0 });
  await page.type('input[name="password"]', ADMIN.password, { perChar: 0 });
  await page.clickText("Anmelden", { selector: 'form button[type="submit"]' });
  await page.waitFor("location.pathname === '/'", { timeout: 20000, label: "dashboard" });

  if (!payrollOnly) {
    // ---- 1. the TWO shift drawers, and the Ende field's required-ness in each ----
    await page.goto(`${BASE}/shifts/`, { settle: 1600 });
    await page.waitFor(`document.querySelectorAll('table.data-table tbody tr').length > 0`, { timeout: 8000, label: "shift rows" });

    // The fields carry generated ids and no name attribute, so they are found the way a
    // person finds them: the two datetime-local inputs, in document order, start then end.
    const drawerState = `(() => {
      const d = document.querySelector('.drawer, dialog[open], [role=dialog]')
      if (!d) return { open: false }
      const times = [...d.querySelectorAll('input[type=datetime-local]')]
      const [start, end] = times
      return {
        open: true,
        heading: (d.querySelector('h2, h1')?.textContent || '').trim(),
        timeInputs: times.length,
        endRequired: end ? end.required : null,
        startRequired: start ? start.required : null,
        fields: [...d.querySelectorAll('label')].map((l) => l.textContent.trim()).slice(0, 8),
        submit: (d.querySelector('button[type=submit]')?.textContent || '').trim(),
      }
    })()`;

    await page.clickText("Schicht nachtragen", { selector: "button, a" });
    await page.waitFor(`document.querySelector('.drawer, dialog[open], [role=dialog]')`, { timeout: 6000, label: "hand-entry drawer" });
    await sleep(600);
    say("drawer-nachtragen", await page.eval(drawerState));
    await shot("shifts-drawer-nachtragen");

    await page.eval(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    await sleep(500);
    await page.eval(`(() => { const d = document.querySelector('.drawer, dialog[open], [role=dialog]'); if (d) (d.querySelector('button[aria-label], .drawer-close, button')||{}).click?.() })()`);
    await sleep(500);

    // The FIRST row is the running shift, whose correction has no Ende yet -- the exact case
    // that must not share a drawer with hand-entry.
    await page.clickText("Korrigieren", { selector: "table.data-table tbody tr button" });
    await page.waitFor(`document.querySelector('.drawer, dialog[open], [role=dialog]')`, { timeout: 6000, label: "correction drawer" });
    await sleep(600);
    say("drawer-korrigieren", await page.eval(drawerState));
    await shot("shifts-drawer-korrigieren");

    // ---- 2. a shift CORRECTED BY A HUMAN, so the greyscale test has one to look at ----
    // Filled in through the real form, on the demo database, because the violet "corrected"
    // state cannot be judged from a seed that contains none.
    const corrected = await page.eval(`(() => {
      const d = document.querySelector('.drawer, dialog[open], [role=dialog]')
      const end = [...d.querySelectorAll('input[type=datetime-local]')][1]
      if (!end) return 'no end field'
      // Ten minutes ago, in the browser's own local time. A hard-coded time was in the
      // FUTURE by the time the script ran, and the form correctly refused it with "Dieser
      // Zeitpunkt liegt in der Zukunft." -- a fixture bug that looked like an app bug.
      const when = new Date(Date.now() - 10 * 60 * 1000)
      const pad = (n) => String(n).padStart(2, '0')
      const local = when.getFullYear() + '-' + pad(when.getMonth() + 1) + '-' + pad(when.getDate()) +
        'T' + pad(when.getHours()) + ':' + pad(when.getMinutes())
      const set = Object.getOwnPropertyDescriptor(end.constructor.prototype, 'value').set
      set.call(end, local)
      end.dispatchEvent(new Event('input', { bubbles: true }))
      end.dispatchEvent(new Event('change', { bubbles: true }))
      return end.value
    })()`);
    say("correction-end-typed", corrected);
    await page.clickText("Korrektur speichern", { selector: "button" });
    await sleep(2500);
    say(
      "after-correction",
      await page.eval(`(() => {
        const live = [...document.querySelectorAll('[aria-live]')].map((e) => e.textContent.trim()).filter(Boolean)
        const row = document.querySelector('table.data-table tbody tr')
        return { live, firstRow: (row?.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 160) }
      })()`),
    );
    await shot("shifts-after-correction", 1400);

    // ---- 2b. the "Korrigiert" state, which only an AUTO-CLOSED shift can reach ----
    // `corrected_at` means "a flagged shift was resolved" and nothing else (server/check-api.js
    // asserts an ordinary edit does NOT stamp it), so correcting the running shift above
    // produced "Abgeschlossen". The violet state in DESIGN.md needs one of the two 8-hour
    // shifts, resolved through the same drawer.
    const clickedUnresolved = await page.eval(`(() => {
      const row = [...document.querySelectorAll('table.data-table tbody tr')]
        .find((r) => /Nicht best\u00e4tigt/.test(r.textContent))
      if (!row) return false
      const btn = [...row.querySelectorAll('button')].find((b) => /Korrigieren/.test(b.textContent))
      if (!btn) return false
      btn.click()
      return true
    })()`);
    say("unresolved-row-found", clickedUnresolved);
    if (clickedUnresolved) {
      await page.waitFor(`document.querySelector('.drawer, dialog[open], [role=dialog]')`, { timeout: 6000, label: "correction drawer (unresolved)" });
      await sleep(700);
      await shot("shifts-drawer-unresolved", 1100);
      await page.clickText("Korrektur speichern", { selector: "button" });
      await sleep(2500);
      say(
        "after-resolution",
        await page.eval(`(() => {
          const rows = [...document.querySelectorAll('table.data-table tbody tr')]
            .map((r) => r.textContent.replace(/\\s+/g, ' ').trim())
          return {
            korrigiert: rows.filter((t) => /Korrigiert/.test(t)).slice(0, 2),
            stillUnresolved: rows.filter((t) => /Nicht best\u00e4tigt/.test(t)).length,
          }
        })()`),
      );
      await shot("shifts-state-korrigiert", 1500);
    }

    // ---- 3. the enrolment code: inline panel, not a modal, expiry visible AT COPY TIME ----
    await page.goto(`${BASE}/workers/`, { settle: 1500 });
    await page.waitFor(`document.querySelectorAll('table.data-table tbody tr').length > 0`, { timeout: 8000, label: "worker rows" });
    await page.clickText("Zugangscode erstellen", { selector: "table.data-table tbody tr button" });
    await sleep(2200);
    say(
      "enrolment-panel",
      await page.eval(`(() => {
        const codeish = [...document.querySelectorAll('td, div, p, code, strong')]
          .filter((e) => /Zugangscode f\\u00fcr|G\\u00fcltig bis/.test(e.textContent) && e.children.length < 4)
        const panel = codeish[0]?.closest('tr, .row, .panel, td') ?? null
        return {
          inModal: !!document.querySelector('dialog[open], [role=dialog], .modal'),
          inDrawer: !!document.querySelector('.drawer'),
          panelTag: panel ? panel.tagName.toLowerCase() + '.' + (panel.className || '') : null,
          text: [...new Set(codeish.map((e) => e.textContent.replace(/\\s+/g, ' ').trim()))].slice(0, 4),
          copyButton: [...document.querySelectorAll('button')].map((b) => b.textContent.trim()).filter((t) => /kopieren|sperren/i.test(t)),
        }
      })()`),
    );
    await shot("workers-enrolment-code", 1200);

    // ---- 4. the tag URI, and the copy control that puts it on a wall tag ----
    await page.goto(`${BASE}/locations/`, { settle: 1600 });
    await page.waitFor(`document.querySelectorAll('table.data-table tbody tr').length > 0`, { timeout: 8000, label: "location rows" });
    say(
      "tag-uri",
      await page.eval(`(() => {
        const t = [...document.querySelectorAll('code, td')].map((e) => e.textContent.trim()).find((s) => s.startsWith('https://'))
        return t ?? 'NO https:// STRING ON THE PAGE'
      })()`),
    );
    await page.clickText("Tag-URL kopieren", { selector: "button" });
    await sleep(1200);
    say(
      "tag-copy-feedback",
      await page.eval(`[...document.querySelectorAll('[aria-live]')].map((e) => e.textContent.trim()).filter(Boolean)`),
    );
    await shot("locations-tag-copied", 1200);

    // ---- 4b. the CLIENT PORTAL as a client sees it, which needs a real share link ----
    // /reinigung/ without a token renders "Dieser Link funktioniert nicht.", so the resting
    // screenshot cannot show whether the portal wears the admin shell. One share link is
    // minted through the UI and followed at phone width.
    await page.clickText("teilen", { selector: "table.data-table tbody tr button" });
    await sleep(2000);
    const shareLink = await page.eval(`(() => {
      const t = [...document.querySelectorAll('code, a, input, td')]
        .map((e) => (e.value || e.textContent || '').trim())
        .find((s) => s.includes('/reinigung/'))
      return t ?? null
    })()`);
    say("share-link", shareLink);
    if (shareLink) {
      const url = shareLink.match(/https?:\/\/\S+/)?.[0] ?? shareLink;
      const local = url.replace(/^https?:\/\/[^/]+/, BASE);
      await page.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
      await page.goto(local, { settle: 2000 });
      say(
        "portal-chrome",
        await page.eval(`({
          theme: document.documentElement.getAttribute('data-theme'),
          navLinks: document.querySelectorAll('nav a[href]').length,
          themeSwitcher: document.querySelectorAll('select').length,
          h1: (document.querySelector('h1')?.textContent || '').trim(),
          body: (document.body.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 120),
        })`),
      );
      const { data } = await page.send("Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: true,
        clip: { x: 0, y: 0, width: 390, height: 1400, scale: 1 },
      });
      writeFileSync(`${OUT}truth-portal-shared-390.png`, Buffer.from(data, "base64"));
      console.log("  shot truth-portal-shared-390.png");
      await page.send("Emulation.setDeviceMetricsOverride", { width: 1680, height: 1100, deviceScaleFactor: 1, mobile: false });
    }
  }

  // ---- 5. payroll with exclusions that EXIST: the current month has an open shift ----
  await page.goto(`${BASE}/payroll/`, { settle: 1800 });
  await page.waitFor(`document.querySelector('table.data-table tbody tr, .empty-state')`, { timeout: 10000, label: "payroll body" });
  // `main select`, not `select`: the app shell's theme and language pickers come first in
  // the DOM, and setting the THEME select to "thisMonth" silently does nothing at all --
  // which is exactly how the first run of this script reported the wrong month as evidence.
  await page.select("main select", "thisMonth");
  await sleep(2200);
  say(
    "payroll-this-month",
    await page.eval(`(() => {
      const main = document.querySelector('main')
      const kpi = [...main.querySelectorAll('.kpi, .answer, [class*=kpi]')].map((e) => e.textContent.replace(/\\s+/g, ' ').trim()).slice(0, 6)
      const caveats = [...main.querySelectorAll('li, p')].map((e) => e.textContent.replace(/\\s+/g, ' ').trim())
        .filter((t) => /fehlt|offen|best\\u00e4tig|Stundensatz|Server/.test(t)).slice(0, 6)
      const rows = [...main.querySelectorAll('table.data-table tbody tr')].map((r) => r.textContent.replace(/\\s+/g, ' ').trim())
      return { kpi, caveats, rows }
    })()`),
  );
  await shot("payroll-this-month", 1500);
  if (Date.now() > DEADLINE) throw new Error("deadline exceeded");
} finally {
  page.close();
  child.kill();
}
writeFileSync(`${OUT}truths.json`, `${JSON.stringify(findings, null, 2)}\n`);
console.log("\nshoot-truths: done. NOW LOOK AT THE IMAGES.");
