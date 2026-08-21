#!/usr/bin/env node
// THE CLARITY PASS, RE-MEASURED ON THE LIVE BOX — with a browser, never a grep.
//
//   ADMIN_EMAIL=… ADMIN_PASSWORD=… node demo/verdict-clarity-live.mjs [base]
//
// WHY THIS FILE EXISTS AND demo/check-*.mjs DOES NOT COVER IT. The clarity pass shipped ten
// checks. Every one of them is `loopback only` by its own guard (it needs the demo admin and
// a seeded nfc_demo), so not one of them can be pointed at production — and two of them
// (`check-retry-control`, `check-load-failure`) read the SOURCE TREE rather than the DOM by
// their own admission. A source check cannot answer the only question that matters after
// § 0 of STATE-OF-THE-PRODUCT.md: is the fix on the box the director opens? Twice now in one
// week the answer has been no while every local check was green.
//
// So: real Chrome, real TLS, the production origin, a throwaway admin session, and every
// assertion read out of `getComputedStyle` or `innerText` of the SHIPPED bundle.
//
// HOW EACH ASSERTION IS MADE FALSIFIABLE. Not by a mutant flag — by running this file
// against the box BEFORE the deploy, where the old bundle is still being served. That is the
// negative case, it is free, and it is the real one. Run order:
//
//   node demo/verdict-clarity-live.mjs      # before ./ops/deploy.sh  -> must FAIL
//   ./ops/deploy.sh
//   node demo/verdict-clarity-live.mjs      # after                   -> must PASS
//
// PROBES INJECTED INTO THE PAGE. Production carries no shifts and no clients, so several
// findings have no row to measure. Where that is the case this file appends a DOM fragment
// carrying the exact classes the real markup uses and reads the computed style off it. That
// measures the SHIPPED STYLESHEET, which is precisely what the finding was about — it does
// not measure whether the class is on the right element, and every such assertion says so
// in its own name (`css:`). Assertions that read real markup say `live:`.
import { mkdirSync, writeFileSync } from "node:fs";
import { attach, launchChrome, sleep } from "./cdp.mjs";

const BASE = process.argv[2] ?? "https://schimmer-glanz.exe.xyz";
const OUT = process.env.VERDICT_OUT ?? "docs/media/verdict-clarity";
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;
if (!EMAIL || !PASSWORD) {
  console.error("ADMIN_EMAIL and ADMIN_PASSWORD must be in the environment");
  process.exit(2);
}

let fails = 0;
const ok = (m) => console.log(`  ok:   ${m}`);
const bad = (m) => {
  fails++;
  console.log(`  FAIL: ${m}`);
};
const section = (t) => console.log(`\n== ${t}`);

mkdirSync(OUT, { recursive: true });

const chrome = await launchChrome({ port: 9466, width: 1680, height: 1050 });
const page = await attach(chrome.port);

async function viewport(width, height, mobile) {
  await page.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: mobile ? 2 : 1,
    mobile,
  });
}

async function shoot(name) {
  const { data } = await page.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(data, "base64"));
}

/** Paint a computed colour into a canvas and read the pixel back — never parse `oklch()`. */
const LUMA_FN = `(css) => {
  const c = document.createElement('canvas'); c.width = c.height = 1
  const x = c.getContext('2d'); x.fillStyle = css; x.fillRect(0, 0, 1, 1)
  const [r, g, b] = x.getImageData(0, 0, 1, 1).data
  return Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b)
}`

async function signIn() {
  await page.goto(`${BASE}/login/`);
  await page.waitFor("document.querySelector('input[type=password]')", { label: "the sign-in form" });
  await page.eval(`(() => {
    const set = (el, v) => {
      const d = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set
      d.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true }))
    }
    set(document.querySelector('input[name=email]'), ${JSON.stringify(EMAIL)})
    set(document.querySelector('input[name=password]'), ${JSON.stringify(PASSWORD)})
    document.querySelector('form').requestSubmit()
    return true
  })()`);
  await page.waitFor("!document.querySelector('input[type=password]')", {
    label: "the sign-in form to go away",
    timeout: 20000,
  });
}

try {
  section(`0 · sign in to ${BASE}`);
  await viewport(1680, 1050, false);
  await signIn();
  ok(`signed in at ${BASE}`);

  // -----------------------------------------------------------------------------------
  section("1 · U1 — money right-aligns in a .data-table (globals.css specificity fix)");
  await page.goto(`${BASE}/payroll/`, { settle: 1600 });
  const align = await page.eval(`(() => {
    const host = document.createElement('div')
    host.innerHTML = '<table class="data-table"><thead><tr><th class="col-numeric">h</th></tr></thead>' +
                     '<tbody><tr><td class="col-numeric">236,25 €</td></tr></tbody></table>'
    document.body.appendChild(host)
    const td = host.querySelector('td.col-numeric'), th = host.querySelector('th.col-numeric')
    const r = { td: getComputedStyle(td).textAlign, th: getComputedStyle(th).textAlign }
    host.remove(); return r
  })()`);
  align.td === "right"
    ? ok(`css: td.col-numeric computes text-align:right (was left)`)
    : bad(`css: td.col-numeric computes text-align:${align.td} — U1 not on the box`);
  align.th === "right"
    ? ok(`css: th.col-numeric computes text-align:right`)
    : bad(`css: th.col-numeric computes text-align:${align.th}`);

  // -----------------------------------------------------------------------------------
  section("2 · U5 — the brand does not wrap at 1280 (a 13\" MacBook Air)");
  await viewport(1280, 800, false);
  await page.goto(`${BASE}/`, { settle: 1600 });
  await shoot("1280-dashboard");
  // `.brand` — the flex container the two spans are items of — NOT `.app-header`. The first
  // run of this file measured the header and reported U5 red on a box that had the fix: the
  // header's own `white-space` is untouched and always was `normal`. A wrong selector on the
  // ancestor of the right one is the quietest way to invent a defect.
  const brand = await page.eval(`(() => {
    const el = document.querySelector('.brand')
    const name = document.querySelector('.brand-name')
    const suffix = document.querySelector('.brand-suffix')
    if (!el || !name) return null
    const line = (n) => Math.round(Number.parseFloat(getComputedStyle(n).lineHeight) || 0)
    return {
      whiteSpace: getComputedStyle(el).whiteSpace,
      nameRects: name.getClientRects().length,
      // The real symptom U5 named: the brand occupying TWO text lines in the header.
      brandH: Math.round(el.getBoundingClientRect().height),
      lineH: line(name),
      sameRow: suffix ? Math.abs(suffix.getBoundingClientRect().top - name.getBoundingClientRect().top) < 6 : null,
    }
  })()`);
  if (!brand) bad("live: no .brand on the page");
  else if (brand.whiteSpace === "nowrap" && brand.nameRects === 1 && brand.sameRow !== false)
    ok(`live: .brand white-space:nowrap, .brand-name on 1 line, suffix on the same row, brand box ${brand.brandH}px (line-height ${brand.lineH})`);
  else bad(`live: brand wraps at 1280: ${JSON.stringify(brand)} — U5 not on the box`);

  // -----------------------------------------------------------------------------------
  section("3 · PHONE #7 — a state pill is at least the design system's 12px floor");
  const badge = await page.eval(`(() => {
    const host = document.createElement('div')
    host.innerHTML = '<span class="badge">x</span><span class="shift-state">y</span>'
    document.body.appendChild(host)
    const r = Array.from(host.children).map((el) => getComputedStyle(el).fontSize)
    host.remove(); return r
  })()`);
  const px = badge.map((s) => Number.parseFloat(s));
  px.every((v) => v >= 12)
    ? ok(`css: .badge / .shift-state font-size ${badge.join(" / ")} (floor 12px)`)
    : bad(`css: .badge / .shift-state font-size ${badge.join(" / ")} — below the 12px floor`);

  // -----------------------------------------------------------------------------------
  section("4 · C10 — .btn-quiet carries an underline (the affordance that survives greyscale)");
  const quiet = await page.eval(`(() => {
    const host = document.createElement('div')
    host.innerHTML = '<button class="btn btn-quiet">Bearbeiten</button>'
    document.body.appendChild(host)
    const cs = getComputedStyle(host.firstElementChild)
    const r = { line: cs.textDecorationLine, offset: cs.textUnderlineOffset }
    host.remove(); return r
  })()`);
  quiet.line.includes("underline")
    ? ok(`css: .btn-quiet text-decoration-line:${quiet.line} offset ${quiet.offset}`)
    : bad(`css: .btn-quiet text-decoration-line:${quiet.line} — C10 not on the box`);

  // -----------------------------------------------------------------------------------
  section("5 · TASK-229 (1) — .form-error is no longer dimmer than the prose it corrects");
  const luma = await page.eval(`(() => {
    const luma = ${LUMA_FN}
    const host = document.createElement('div')
    host.innerHTML = '<p class="form-error">e</p><p>b</p>'
    document.body.appendChild(host)
    const err = getComputedStyle(host.children[0])
    const body = getComputedStyle(host.children[1])
    const root = getComputedStyle(document.documentElement)
    const r = { err: luma(err.color), errPx: err.fontSize, body: luma(body.color), bodyPx: body.fontSize,
                errRaw: err.color, bodyRaw: body.color,
                secondary: luma(root.getPropertyValue('--text-secondary').trim()) }
    host.remove(); return r
  })()`);
  // THE BASELINE IS --text-secondary, NOT --text-primary, and getting that wrong is how the
  // first run of this file reported a red that was not there. LOOK.md's finding, and
  // STATE-OF-THE-PRODUCT § 1's re-measurement of it, are both about the PROSE BESIDE the
  // error — a form's hint and label text, which is --text-secondary (luma ~173). Body copy
  // at --text-primary (luma ~234) is brighter than almost everything on every screen; an
  // error that had to beat it would have to be white. The gap to primary is REPORTED, not
  // asserted, so the number stays visible and nobody has to re-derive it.
  luma.err >= luma.secondary
    ? ok(`css: .form-error luma ${luma.err} >= the prose beside it (--text-secondary, luma ${luma.secondary}); ${luma.errRaw}. Still ${luma.body - luma.err} below --text-primary (${luma.body}), which is reported, not asserted`)
    : bad(`css: .form-error luma ${luma.err} < --text-secondary luma ${luma.secondary} — still quieter than the prose it corrects`);

  // -----------------------------------------------------------------------------------
  section("6 · C8 — a tapped shift is not typeset as if the value were absent");
  // NOT `is it italic` — an ABSENT rule is also not italic, so that form of the assertion is
  // green on a box that has never heard of this class, which is exactly what the first run of
  // this file did. The rule must be PRESENT and it must paint --text-secondary: a colour that
  // is neither the body's --text-primary (no rule at all) nor .cell-muted's (the old bug).
  const origin = await page.eval(`(() => {
    const host = document.createElement('div')
    host.innerHTML = '<span class="shift-origin-tap">Am Tag gescannt</span><span class="cell-muted">Leer</span>' +
                     '<span>plain</span>'
    document.body.appendChild(host)
    const a = getComputedStyle(host.children[0]), b = getComputedStyle(host.children[1])
    const c = getComputedStyle(host.children[2])
    const r = { tapStyle: a.fontStyle, tapColor: a.color, mutedStyle: b.fontStyle,
                mutedColor: b.color, plainColor: c.color,
                secondary: getComputedStyle(document.documentElement).getPropertyValue('--text-secondary').trim() }
    host.remove(); return r
  })()`);
  const originRuled = origin.tapColor !== origin.plainColor && origin.tapColor !== origin.mutedColor;
  originRuled && origin.tapStyle === "normal"
    ? ok(`css: .shift-origin-tap is ${origin.tapStyle}, ${origin.tapColor} — distinct from plain ${origin.plainColor} and from .cell-muted ${origin.mutedColor}`)
    : bad(`css: .shift-origin-tap ${origin.tapStyle}/${origin.tapColor}; plain ${origin.plainColor}, .cell-muted ${origin.mutedColor} — the rule is absent (C8 not on the box)`);

  // -----------------------------------------------------------------------------------
  section("7 · C2 — the admin says Betreiber, like the phone, and never Operator");
  await viewport(1680, 1050, false);
  await page.goto(`${BASE}/operators/`, { settle: 1800 });
  await shoot("operators-de");
  const opText = await page.eval("document.body.innerText");
  writeFileSync(`${OUT}/operators-de.txt`, opText);
  opText.includes("Betreiber")
    ? ok(`live: /operators/ says „Betreiber" (${(opText.match(/Betreiber/g) ?? []).length}×)`)
    : bad(`live: /operators/ never says „Betreiber"`);
  /Operator(en|s)?\b/.test(opText)
    ? bad(`live: /operators/ still says „${opText.match(/Operator(en|s)?\b/)[0]}" — C2 not on the box`)
    : ok(`live: the word „Operator" does not appear on /operators/`);
  // /operators/ is OFF-NAV (§ 11 asserts that separately) — the first run of this file looked
  // for it in the sidebar, found null, and printed a red line about a link that is not
  // supposed to exist. The inbound link the director actually follows is on /workers/.
  await page.goto(`${BASE}/workers/`, { settle: 1800 });
  const inbound = await page.eval(`(() => {
    const a = document.querySelector('a[href="/operators/"]')
    return a ? a.textContent.trim() : null
  })()`);
  inbound && !/Operator/.test(inbound)
    ? ok(`live: /workers/ links in with „${inbound}"`)
    : bad(`live: /workers/'s inbound link reads „${inbound}" — C2 not on the box`);

  // -----------------------------------------------------------------------------------
  section("8 · C13 — one client, singular");
  await page.goto(`${BASE}/clients/`, { settle: 1800 });
  const clientDrawer = await page.eval(`(() => {
    const btn = Array.from(document.querySelectorAll('button, a')).find((e) => /Kunde/.test(e.textContent))
    if (!btn) return null
    btn.click()
    return true
  })()`);
  await sleep(900);
  const clientText = await page.eval("document.body.innerText");
  writeFileSync(`${OUT}/clients-drawer.txt`, clientText);
  await shoot("clients-drawer");
  if (!clientDrawer) bad("live: no Kunde… control on /clients/");
  else if (clientText.includes("Kunde anlegen")) ok(`live: the drawer heading reads „Kunde anlegen"`);
  else bad(`live: no „Kunde anlegen" heading — C13 not on the box`);
  // The SAME drawer's submit button. Reported here rather than asserted: „Kunden anlegen" is
  // the correct accusative of a weak masculine noun, so it is not wrong German — but it is
  // not the heading's wording either, and the two sit 200px apart.
  console.log(`  note: drawer wording — heading vs button: ${JSON.stringify(
    (clientText.match(/Kunden? (anlegen|bearbeiten)/g) ?? []),
  )}`);

  // -----------------------------------------------------------------------------------
  section("9 · C5 / PHONE #5 — a failed load offers a control, not just an instruction");
  // Seeded, not asserted at: every /admin/* response is blocked in the browser, which is
  // what a dead API looks like from the director's chair. Nothing on the box is touched.
  await page.send("Network.setBlockedURLs", { urls: ["*/admin/*"] });
  for (const path of ["/payroll/", "/shifts/", "/pl/", "/locations/"]) {
    await page.goto(`${BASE}${path}`, { settle: 2500 });
    // EVERY `[role=status]`, not `querySelector`. /locations/ carries FOUR: three empty
    // drawer/live regions that are always in the DOM (deliberately — an assistive technology
    // announces a text change in an existing region far more reliably than a node that
    // appears), and then the load status. The first run of this file took element [0], found
    // it empty, and reported the retry control missing on all four screens. It is there.
    const r = await page.eval(`(() => {
      const all = Array.from(document.querySelectorAll('[role="status"]'))
      const st = all.find((el) => el.innerText.trim() !== '')
      if (!st) return { status: null, regions: all.length }
      const btn = st.querySelector('button')
      return {
        regions: all.length,
        status: st.innerText.trim().slice(0, 120),
        button: btn ? btn.innerText.trim() : null,
        buttonH: btn ? Math.round(btn.getBoundingClientRect().height) : 0,
        stillLoading: /wird geladen|wird berechnet|lädt/i.test(st.innerText),
      }
    })()`);
    if (r.button && !r.stillLoading) ok(`live: ${path} failed load -> „${r.button}" (${r.buttonH}px) and no loading claim`);
    else bad(`live: ${path} failed load -> button=${JSON.stringify(r.button)} stillLoading=${r.stillLoading} status="${r.status}"`);
  }
  await shoot("locations-failed-load");
  // And the control must WORK, not merely exist: unblock, click it, and the screen must
  // recover without a page reload.
  await page.send("Network.setBlockedURLs", { urls: [] });
  const recovered = await page.eval(`(() => {
    const st = Array.from(document.querySelectorAll('[role="status"]')).find((el) => el.querySelector('button'))
    const btn = st && st.querySelector('button')
    if (!btn) return 'no button'
    btn.click()
    return 'clicked'
  })()`);
  await sleep(2500);
  const after = await page.eval(`(() => {
    const st = document.querySelector('[role="status"]')
    return { gone: !st, text: st ? st.innerText.trim().slice(0, 80) : null,
             rows: document.querySelectorAll('.data-table tbody tr').length }
  })()`);
  recovered === "clicked" && (after.gone || after.rows > 0)
    ? ok(`live: /locations/ retry actually reloaded — status gone=${after.gone}, ${after.rows} row(s)`)
    : bad(`live: retry did not recover (${recovered}); status="${after.text}" rows=${after.rows}`);

  // -----------------------------------------------------------------------------------
  section("10 · C6 — a dead session returns him to the screen he was on");
  // Seed the condition: destroy the session cookie the way an expiry does, then navigate.
  await page.goto(`${BASE}/payroll/?period=2026-07`, { settle: 1200 });
  await page.send("Network.clearBrowserCookies");
  await page.goto(`${BASE}/payroll/?period=2026-07`, { settle: 2600 });
  const expired = await page.eval(`(() => ({
    url: location.pathname + location.search,
    text: document.body.innerText.slice(0, 400),
    hasForm: !!document.querySelector('input[type=password]'),
  }))()`);
  writeFileSync(`${OUT}/session-expired.txt`, `${expired.url}\n\n${expired.text}`);
  await shoot("session-expired");
  expired.hasForm
    ? ok(`live: a dead session lands on the sign-in form (${expired.url})`)
    : bad(`live: a dead session did not reach the sign-in form (${expired.url})`);
  /abgelaufen|expired/i.test(expired.text)
    ? ok(`live: it says the session expired, rather than showing a blank card`)
    : bad(`live: no „Ihre Sitzung ist abgelaufen" — C6 not on the box`);
  // …and it must actually go BACK, with the period intact.
  await page.eval(`(() => {
    const set = (el, v) => {
      const d = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set
      d.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true }))
    }
    set(document.querySelector('input[name=email]'), ${JSON.stringify(EMAIL)})
    set(document.querySelector('input[name=password]'), ${JSON.stringify(PASSWORD)})
    document.querySelector('form').requestSubmit()
    return true
  })()`);
  await sleep(3000);
  const back = await page.eval("location.pathname + location.search");
  back.startsWith("/payroll") && back.includes("period=2026-07")
    ? ok(`live: signing in returned him to ${back}`)
    : bad(`live: signing in landed on ${back}, not /payroll/?period=2026-07`);

  // -----------------------------------------------------------------------------------
  section("11 · PHONE #6 — at 390px the nav strip scrolls to „you are here\"");
  await viewport(390, 844, true);
  // Routes that ARE in the nav. `/operators/` deliberately is not: it is reached from
  // /workers/, has no `aria-current` anywhere, and putting it in this list produced a red
  // line that said nothing about PHONE #6 — it said the screen is off-nav, which is by design
  // (web/lib/nav.ts FUTURE_NAV / the off-nav inbound-link check).
  for (const path of ["/", "/pl/", "/payroll/", "/account/"]) {
    await page.goto(`${BASE}${path}`, { settle: 2200 });
    const nav = await page.eval(`(() => {
      const nav = document.querySelector('.sidebar')
      const cur = nav && nav.querySelector('[aria-current="page"]')
      if (!nav || !cur) return { ok: false, why: nav ? 'no aria-current' : 'no .sidebar' }
      const n = nav.getBoundingClientRect(), c = cur.getBoundingClientRect()
      return { ok: c.left >= n.left - 2 && c.right <= n.right + 2,
               label: cur.textContent.trim(), left: Math.round(c.left - n.left),
               scroll: Math.round(nav.scrollLeft), width: Math.round(n.width) }
    })()`);
    nav.ok
      ? ok(`live: ${path} — „${nav.label}" is inside the strip (offset ${nav.left}px, scrollLeft ${nav.scroll})`)
      : bad(`live: ${path} — current nav item out of view: ${JSON.stringify(nav)}`);
  }
  await shoot("390-account-nav");
  const offNav = await page.eval(`(() => {
    const nav = document.querySelector('.sidebar')
    return { hasLink: !!nav?.querySelector('a[href="/operators/"]') }
  })()`);
  offNav.hasLink
    ? bad("live: /operators/ is in the nav strip — this run's assumption about it is wrong")
    : ok("live: /operators/ is off-nav by design, reached from /workers/ (so it has no you-are-here mark)");

  // -----------------------------------------------------------------------------------
  section("12 · the shell at 390px is still whole (LOOK-PHONE #1 must not regress)");
  const shell = await page.eval(`(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    h1y: Math.round((document.querySelector('h1')?.getBoundingClientRect().top ?? -1)),
    navH: Math.round(document.querySelector('.sidebar')?.getBoundingClientRect().height ?? -1),
  }))()`);
  shell.scrollWidth <= 390 && shell.h1y >= 0 && shell.h1y < 220
    ? ok(`live: 390px — scrollWidth ${shell.scrollWidth}, nav ${shell.navH}px, h1 at y=${shell.h1y}`)
    : bad(`live: 390px shell wrong: ${JSON.stringify(shell)}`);
} catch (e) {
  bad(`threw: ${e.message}`);
} finally {
  // A probe killed mid-run skips its finally, so this is best-effort and never the only
  // cleanup: nothing here writes to the box, so the worst residue is a Chrome process.
  page.close();
  chrome.child.kill();
  console.log(`\n${fails === 0 ? "verdict-clarity-live: OK" : `verdict-clarity-live: ${fails} FAILED`}  (${OUT}/)`);
  process.exit(fails === 0 ? 0 : 1);
}
