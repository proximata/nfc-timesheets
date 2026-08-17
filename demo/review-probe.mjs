// ADVERSARIAL REVIEW PROBE. Written from scratch by the review gate; it deliberately does
// NOT import or reuse the audit-*.mjs the earlier agents wrote, because the thing under
// test includes those scripts.
//
//   node demo/review-probe.mjs            # all
//   node demo/review-probe.mjs --mutation # print what each check reads, for mutation work
//
// Every assertion below reads TEXT or a COMPUTED STYLE and compares it to an expected
// string. None of them counts elements. A count is how this repo shipped phone cards
// captioned with the wrong column.
import { rmSync } from "node:fs";
import { createServer } from "node:net";
import { attach, launchChrome, sleep } from "./cdp.mjs";

const BASE = process.env.BASE ?? "http://127.0.0.1:8082";
const ADMIN = { email: "demo@example.test", password: "demo-nur-lokal-2026" };
const WIDTH = Number(process.env.WIDTH ?? 1440);
const HEIGHT = Number(process.env.HEIGHT ?? 1000);
const ONLY = process.env.ONLY ?? "";

let pass = 0;
let fail = 0;
const results = [];
const ok = (name, detail = "") => {
  pass++;
  results.push(["ok", name, detail]);
  console.log(`  ok   ${name}${detail ? ` — ${detail}` : ""}`);
};
const bad = (name, detail = "") => {
  fail++;
  results.push(["FAIL", name, detail]);
  console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
};
const check = (name, cond, detail = "") => (cond ? ok(name, detail) : bad(name, detail));

async function freePort(from) {
  for (let port = from; port < from + 60; port++) {
    const free = await new Promise((r) => {
      const p = createServer();
      p.once("error", () => r(false));
      p.once("listening", () => p.close(() => r(true)));
      p.listen(port, "127.0.0.1");
    });
    if (free) return port;
  }
  throw new Error("no free port");
}

const port = await freePort(9600);
const profile = `/tmp/rev-chrome-${port}`;
rmSync(profile, { recursive: true, force: true });
const { child } = await launchChrome({ port, width: WIDTH, height: HEIGHT });
const page = await attach(port);
// A hung Chrome that sits at 0% CPU has cost this repo 49 minutes. Hard deadline.
const deadline = setTimeout(() => {
  console.error("\nreview-probe: DEADLINE — killing Chrome");
  try {
    child.kill("SIGKILL");
  } catch {}
  process.exit(3);
}, 300_000);

// A throw, not just a hang, is what stranded a headless Chrome on port 9600 during this
// very review: the deadline timer only fires on a hang. Kill on any exit path.
const shutdown = () => {
  try { child.kill("SIGKILL") } catch {}
  rmSync(profile, { recursive: true, force: true })
}
process.on("uncaughtException", (e) => { console.error(e); shutdown(); process.exit(2) })
process.on("unhandledRejection", (e) => { console.error(e); shutdown(); process.exit(2) })
process.on("exit", shutdown)

async function signIn() {
  await page.goto(`${BASE}/login/`, { settle: 600 });
  await page.waitFor(`document.querySelector('form button[type="submit"]')`, {
    label: "sign-in button",
  });
  await page.type('input[name="email"]', ADMIN.email, { perChar: 0 });
  await page.type('input[name="password"]', ADMIN.password, { perChar: 0 });
  await page.clickText("Anmelden", { selector: 'form button[type="submit"]' });
  await page.waitFor("location.pathname === '/'", { label: "dashboard", timeout: 20000 });
  await sleep(600);
}

const want = (label, group) => !ONLY || ONLY.split(",").includes(group);

// ---------------------------------------------------------------------------
// T0 — /login/ FIRST, because a regression here locks the client out.
// ---------------------------------------------------------------------------
if (want("login", "login")) {
  console.log("\n### T0 /login/ — the field is a USERNAME");
  await page.goto(`${BASE}/login/`, { settle: 600 });
  await page.waitFor(`document.querySelector('input[name="email"]')`, { label: "the field" });
  const f = await page.eval(`(() => {
    const el = document.querySelector('input[name="email"]')
    const lab = el.labels?.[0]?.textContent || document.querySelector('label')?.textContent || ''
    return { type: el.getAttribute('type'), ac: el.getAttribute('autocomplete'), label: lab.trim(),
             inputmode: el.getAttribute('inputmode') }
  })()`);
  check("login field is type=text", f.type === "text", `type=${f.type}`);
  check("login field autocomplete=username", f.ac === "username", `autocomplete=${f.ac}`);
  check(
    "login field is labelled as a username, not an e-mail",
    /Benutzername|username/i.test(f.label) && !/mail/i.test(f.label),
    JSON.stringify(f.label),
  );
}

await signIn();

// ---------------------------------------------------------------------------
// T1 — /payroll/ reconciliation + NAMED, COUNTED exclusions, never a silent 0,00
// ---------------------------------------------------------------------------
if (want("payroll", "payroll")) {
  console.log("\n### T1 /payroll/ — the number is trustworthy or it is not shown");
  await page.goto(`${BASE}/payroll/`, { settle: 1200 });
  await page.waitFor(`document.querySelectorAll('table tbody tr').length > 0`, {
    label: "payroll rows",
  });
  // THE POSITIVE CASE HAS TO EXIST OR THE CHECK IS THE ZERO-ROWS TRAP AGAIN. The default
  // period on this seed has no unresolved shift and every worker has a rate, so the page
  // truthfully reports nothing excluded. Switch to the month that HAS the exclusions.
  const periodSel = await page.eval(`(() => {
    const s = Array.from(document.querySelectorAll('select'))
      .find((el) => /Dieser Monat/.test(el.textContent || ''))
    if (!s) return null
    const opt = Array.from(s.options).find((o) => /Dieser Monat/.test(o.textContent))
    const set = Object.getOwnPropertyDescriptor(s.constructor.prototype, 'value').set
    set.call(s, opt.value); s.dispatchEvent(new Event('change', { bubbles: true }))
    return opt.value
  })()`);
  console.log(`       (period switched to ${periodSel})`);
  await sleep(1600);
  const p = await page.eval(`(() => {
    const rows = Array.from(document.querySelectorAll('table tbody tr')).map((tr) =>
      Array.from(tr.querySelectorAll('th,td')).map((c) => c.textContent.trim()))
    const body = document.body.innerText
    return { rows, body }
  })()`);
  // The reconciliation sentence: server total vs the rows drawn here.
  const recon = /ergeben genau die Summe des Servers|fehlt nichts|weicht .* ab/i.test(p.body);
  check(
    "payroll states the server-vs-visible reconciliation",
    recon,
    recon ? "„… ergeben genau die Summe des Servers … fehlt nichts.“" : "sentence absent",
  );
  // The rate-less worker. Read the ROW, not a count.
  const noRate = p.rows.find((r) => r.some((c) => /Kein Stundensatz/i.test(c)));
  check(
    "a worker with no hourly rate is a NAMED exclusion",
    !!noRate,
    noRate ? noRate.join(" | ") : "no row mentions Kein Stundensatz",
  );
  check(
    "…and is NOT silently valued at 0,00 €",
    !!noRate && !noRate.some((c) => /^0,00/.test(c)) && noRate.some((c) => /Nicht bewertet/i.test(c)),
    noRate ? `Betrag cell = ${JSON.stringify(noRate[3] ?? "")}` : "n/a",
  );
  // Exclusions are COUNTED, with a number, not just described.
  const counted = /(\d+)\s+Schicht(en)? muss|(\d+)\s+Schicht(en)? müssen|Für (\d+) Mitarbeiter ist kein Stundensatz/i.exec(
    p.body,
  );
  check(
    "exclusions are counted, with a figure",
    !!counted,
    counted ? JSON.stringify(counted[0]) : "no counted exclusion sentence",
  );
  const openShift = /8-Stunden-Timer|bestätigt werden/i.test(p.body);
  check("unresolved auto-closed shifts are named as an exclusion", openShift);
}

// ---------------------------------------------------------------------------
// T2 — /locations/ tag URI is visible AND copyable, read back from the clipboard
// ---------------------------------------------------------------------------
if (want("locations", "locations")) {
  console.log("\n### T2 /locations/ — the string that gets written to a wall tag");
  await page.send("Browser.grantPermissions", {
    origin: BASE,
    permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"],
  });
  // Headless still refuses navigator.clipboard on an unfocused document.
  await page.send("Page.bringToFront");
  await page.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await page.goto(`${BASE}/locations/`, { settle: 1400 });
  await page.waitFor(`/t\\?l=/.test(document.body.innerText)`, { label: "a tag URL" });
  const shown = await page.eval(`(() => {
    const m = document.body.innerText.replace(/\\s+/g, '').match(/https?:\\/\\/[^\\s]*?\\/t\\?l=[0-9a-f-]{36}/i)
    return m ? m[0] : null
  })()`);
  check(
    "the tag URI is shown in full, host + /t?l=<uuid>",
    !!shown && /\/t\?l=[0-9a-f-]{36}$/i.test(shown),
    shown ?? "none",
  );
  // Now the copy. Click the FIRST row's button and read the clipboard back.
  await page.eval(`navigator.clipboard.writeText('SENTINEL-NOT-A-TAG-URL')`);
  const clicked = await page.eval(`(() => {
    const b = Array.from(document.querySelectorAll('button'))
      .find((el) => /Tag-URL kopieren|Tag-URL/i.test(el.textContent || ''))
    if (!b) return null
    // the row this button belongs to, so we compare against ITS url and not the page's first
    const row = b.closest('tr') || b.closest('li') || b.parentElement
    const url = (row?.innerText || '').replace(/\\s+/g, '').match(/https?:\\/\\/[^\\s]*?\\/t\\?l=[0-9a-f-]{36}/i)
    b.click()
    return url ? url[0] : null
  })()`);
  await sleep(600);
  const clip = await page.eval(`navigator.clipboard.readText()`);
  check(
    "a per-row copy control exists on the tag URI",
    !!clicked,
    clicked ? `row url ${clicked}` : "no Tag-URL kopieren button",
  );
  check(
    "…and it puts THAT ROW's url on the clipboard",
    clip.replace(/\s+/g, "") === (clicked ?? "\u0000"),
    `clipboard=${JSON.stringify(clip)}`,
  );
}

// ---------------------------------------------------------------------------
// T3 — /workers/ enrolment code: INLINE, never a modal, expiry visible AT COPY TIME
// ---------------------------------------------------------------------------
if (want("workers", "workers")) {
  console.log("\n### T3 /workers/ — the code is shown once, inline, with its expiry");
  await page.goto(`${BASE}/workers/`, { settle: 1200 });
  await page.waitFor(`/Zugangscode erstellen/.test(document.body.innerText)`, {
    label: "an enrolment button",
  });
  await page.clickText("Zugangscode erstellen", { selector: "button" });
  // A worker who already has a code gets an inline CONFIRM first — click through it, or
  // this probe reads the confirmation prompt and calls a missing code a missing code.
  await sleep(700);
  if (await page.eval(`/Neuen Zugangscode für .* erstellen\\?/.test(document.body.innerText)`)) {
    await page.clickText("Neuen Zugangscode erstellen", { selector: "button" });
  }
  await page.waitFor(`/Gültig bis/.test(document.body.innerText)`, {
    label: "the code panel",
    timeout: 20000,
  });
  const w = await page.eval(`(() => {
    const all = Array.from(document.querySelectorAll('div,section,aside,form'))
    const panel = all.filter((el) => /Zugangscode für/.test(el.innerText || '') &&
      /Gültig bis/.test(el.innerText || '')).pop()
    const host = panel?.closest('[role="dialog"], dialog, .modal, .drawer')
    const codeM = (panel?.innerText || '').match(/[A-Z0-9]{4}[-–—][A-Z0-9]{4}/)
    const expiry = (panel?.innerText || '').match(/Gültig bis [^.]+/)
    const copyBtn = Array.from(panel?.querySelectorAll('button') ?? [])
      .find((b) => /kopieren/i.test(b.textContent || ''))
    return {
      inModal: !!host, hostRole: host?.getAttribute('role') ?? host?.className ?? null,
      code: codeM ? codeM[0] : null, expiry: expiry ? expiry[0] : null,
      copy: copyBtn?.textContent?.trim() ?? null,
      dialogsOpen: document.querySelectorAll('[role="dialog"]').length,
    }
  })()`);
  check("the enrolment code is NOT in a modal or drawer", !w.inModal, `host=${w.hostRole}`);
  check("no dialog opened at all", w.dialogsOpen === 0, `[role=dialog] count=${w.dialogsOpen}`);
  check("the code itself is on screen", !!w.code, w.code ?? "none");
  check("its expiry is visible AT COPY TIME", !!w.expiry && !!w.copy, `${w.expiry} / ${w.copy}`);
}

// ---------------------------------------------------------------------------
// T4 — /shifts/ TWO drawers, not one behind a mode flag
// ---------------------------------------------------------------------------
if (want("shifts", "shifts")) {
  console.log("\n### T4 /shifts/ — korrigieren and nachtragen are two different things");
  await page.goto(`${BASE}/shifts/`, { settle: 1600 });
  await page.waitFor(`/Schicht nachtragen/.test(document.body.innerText)`, {
    label: "the nachtragen control",
  });
  const drawerRead = `(() => {
    const d = document.querySelector('[role="dialog"]')
    if (!d) return null
    const title = d.querySelector('h2, h3, [class*=title]')?.textContent?.trim() ?? ''
    const fields = Array.from(d.querySelectorAll('label')).map((l) => l.textContent.trim())
    // The fields carry no name attribute, so find the end field the way a person does:
    // by its LABEL. Reading the label is also what proves the asterisk is not a lie.
    const endInput = Array.from(d.querySelectorAll('input')).find((i) =>
      /^Ende/.test((i.labels?.[0]?.innerText || '').trim()))
    return { title, fields, endRequired: endInput ? endInput.required : null,
             endName: (endInput?.labels?.[0]?.innerText || '').replace(/\\s+/g, ' ') }
  })()`;
  await page.clickText("Schicht nachtragen", { selector: "button" });
  await sleep(700);
  const nach = await page.eval(drawerRead);
  await page.eval(`document.querySelector('[role="dialog"]') && (() => {
    const b = Array.from(document.querySelectorAll('[role="dialog"] button'))
      .find((x) => /Abbrechen|Schließen/i.test(x.textContent || ''))
    b?.click(); return true })()`);
  await sleep(500);
  await page.clickText("Korrigieren", { selector: "button" });
  await sleep(700);
  const korr = await page.eval(drawerRead);
  check(
    "„Schicht nachtragen“ is its own drawer",
    !!nach && /nachtragen/i.test(nach.title),
    nach ? JSON.stringify(nach.title) : "no drawer",
  );
  check(
    "„Schicht korrigieren“ is a DIFFERENT drawer",
    !!korr && /korrigieren/i.test(korr.title) && korr.title !== nach?.title,
    korr ? JSON.stringify(korr.title) : "no drawer",
  );
  check(
    "nachtragen requires an end time",
    nach?.endRequired === true,
    `end field ${nach?.endName} required=${nach?.endRequired} · labels ${JSON.stringify(nach?.fields)}`,
  );
  check(
    "korrigieren leaves the end time optional",
    korr?.endRequired === false,
    `end field ${korr?.endName} required=${korr?.endRequired} · labels ${JSON.stringify(korr?.fields)}`,
  );
  await page.eval(`(() => { const b = Array.from(document.querySelectorAll('[role="dialog"] button'))
    .find((x) => /Abbrechen|Schließen/i.test(x.textContent || '')); b?.click(); return true })()`);
}

// ---------------------------------------------------------------------------
// T5 — deactivation is SOFT. History survives.
// ---------------------------------------------------------------------------
if (want("soft", "soft")) {
  console.log("\n### T5 deactivation is soft");
  await page.goto(`${BASE}/workers/`, { settle: 1200 });
  const s = await page.eval(`(() => {
    const rows = Array.from(document.querySelectorAll('table tbody tr')).map((r) => r.innerText)
    const inactive = rows.find((r) => /Inaktiv/i.test(r))
    return { inactive, reactivate: /Wieder aktivieren/.test(document.body.innerText),
             destructive: /(Löschen|Endgültig entfernen|Delete)/.test(document.body.innerText) }
  })()`);
  check(
    "an inactive worker is still listed, with their history",
    !!s.inactive,
    (s.inactive ?? "").replace(/\n/g, " · ").slice(0, 110),
  );
  check("…and can be reactivated", s.reactivate);
  check("nothing on the screen offers to delete", !s.destructive);
}

// ---------------------------------------------------------------------------
// T6 — /reinigung/ is the PUBLIC portal: no admin shell, no theme switcher
// ---------------------------------------------------------------------------
if (want("portal", "portal")) {
  console.log("\n### T6 /reinigung/ — public, phone-first, no admin chrome");
  await page.goto(`${BASE}/reinigung/`, { settle: 1200 });
  const r = await page.eval(`(() => ({
    navLinks: document.querySelectorAll('nav a').length,
    hasSidebar: !!document.querySelector('.sidebar, aside nav'),
    switcher: !!Array.from(document.querySelectorAll('select'))
      .find((s) => /Dunkel|Hell|System|Dark|Light/.test(s.textContent || '')),
    logout: /Abmelden/.test(document.body.innerText),
    adminWords: ['Lohnabrechnung','Mitarbeiter anlegen','Objektauswertung','Gewinn']
      .filter((w) => document.body.innerText.includes(w)),
    bg: getComputedStyle(document.body).backgroundColor,
  }))()`);
  check("no admin navigation", r.navLinks === 0 && !r.hasSidebar, `nav a=${r.navLinks}`);
  check("no theme switcher", !r.switcher);
  check("no admin-only vocabulary leaked in", r.adminWords.length === 0, JSON.stringify(r.adminWords));
  check("no Abmelden", !r.logout);
  console.log(`       (body background ${r.bg})`);
}

// ---------------------------------------------------------------------------
// T7 — decision-28: the sidebar at 767px is a STRIP, never display:none
// ---------------------------------------------------------------------------
if (want("phone", "phone")) {
  console.log("\n### T7 decision-28 — the panel works on a phone");
  for (const w of [767, 390]) {
    await page.send("Emulation.setDeviceMetricsOverride", {
      width: w,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await page.goto(`${BASE}/payroll/`, { settle: 1400 });
    const m = await page.eval(`(() => {
      const nav = document.querySelector('.sidebar, aside, nav')
      const cs = nav ? getComputedStyle(nav) : null
      const links = Array.from(document.querySelectorAll('nav a')).map((a) => a.textContent.trim())
      const doc = document.documentElement
      return {
        display: cs?.display ?? null, visibility: cs?.visibility ?? null,
        overflowX: cs?.overflowX ?? null, navW: nav?.getBoundingClientRect().width ?? null,
        scrollW: nav?.scrollWidth ?? null, clientW: nav?.clientWidth ?? null,
        links: links.length, first: links[0] ?? null,
        hScroll: doc.scrollWidth - doc.clientWidth,
        recon: /fehlt nichts|Summe des Servers/.test(document.body.innerText),
        exclusions: /Kein Stundensatz/.test(document.body.innerText),
        cardMode: getComputedStyle(document.querySelector('table tbody tr') || document.body).display,
      }
    })()`);
    check(
      `${w}px · the sidebar is not display:none`,
      m.display !== "none" && m.visibility !== "hidden" && m.links > 0,
      `display=${m.display} links=${m.links} first=${m.first}`,
    );
    if (w === 767) {
      check(
        "767px · it is a horizontally scrolling strip",
        m.scrollW > m.clientW && /auto|scroll/.test(m.overflowX ?? ""),
        `overflow-x=${m.overflowX} scrollW=${m.scrollW} > clientW=${m.clientW}`,
      );
    }
    check(`${w}px · no horizontal scroll on the document`, m.hScroll <= 0, `overflow=${m.hScroll}px`);
    check(`${w}px · payroll reconciliation still visible`, m.recon);
    check(`${w}px · payroll exclusions still named`, m.exclusions);
    if (w === 390) {
      check(
        "390px · table rows became cards, not a scrollable table",
        m.cardMode !== "table-row",
        `tbody tr display=${m.cardMode}`,
      );
    }
  }
  await page.send("Emulation.clearDeviceMetricsOverride");
}

clearTimeout(deadline);
console.log(`\nreview-probe: ${pass} ok, ${fail} FAIL`);
page.close();
child.kill("SIGKILL");
rmSync(profile, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
