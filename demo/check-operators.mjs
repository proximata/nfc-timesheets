// THE RUNNABLE CHECK FOR /operators/ — the screen TASK-214 built, driven for real.
//
//   cd web && NEXT_PUBLIC_GOOGLE_MAPS_KEY=$(cd .. && psst get NEXT_PUBLIC_GOOGLE_MAPS_KEY) pnpm build
//   DATABASE_URL=postgres:///nfc_demo APP_KEY=demo-app-key-local-only-0123456789 \
//     PORT=8080 PUBLIC_DIR="$PWD/web/out" node server/server.js &
//   DEMO_BASE=http://127.0.0.1:8080 node demo/check-operators.mjs
//
// IT WRITES to nfc_demo — it creates an operator, issues a code, revokes it and deactivates
// somebody, because a screen that is only ever LOOKED at is not a screen that has been
// checked. Everything it writes it takes back in `finally`, and the teardown ASSERTS the row
// counts it started with. A probe killed mid-run skips its finally, so the teardown is also
// idempotent SQL you can paste by hand (see TEARDOWN below).
//
// WHAT IS ACTUALLY ASSERTED, and why each one is here rather than assumed:
//
//   1. THE LIST RENDERS at 1680 and 390, dark and light. Screenshots, and a row count read
//      back from the DOM — a table that renders zero rows looks identical to one that has
//      not loaded yet in a PNG.
//   2. CREATE works end to end and the new row comes back with its E.164 phone.
//   3. A PHONE COLLISION SURFACES AS A REAL ERROR. Not a silent no-op, not `phone_claimed`,
//      not `409`. The drawer stays open, the phone field is aria-invalid, the message is
//      German prose, and the typed values are still there to be corrected.
//   4. THE SCREEN SAYS PLAINLY THAT AN OPERATOR PHONE CANNOT BE A WORKER PHONE — before
//      the director types it, not only after the server refuses it. This one is EXPECTED
//      RED at the commit that introduced this file; see the report.
//   5. THE CODE IS SHOWN ONCE, focus lands on it, and the panel says so.
//   6. REVOKE and DEACTIVATE both go through a confirmation that names the person and the
//      consequence, and deactivate says it cannot be undone from this screen (it cannot —
//      POST /admin/operators is create-only).
//   7. KEYBOARD, on both overlays: focus in, trapped both directions, Escape closes, focus
//      returns TO THE OPENER — checked by node IDENTITY, with a property stamped on the
//      element before it is clicked. `opener.isConnected` has lied in this codebase before
//      (lib/useOverlay.ts's own comment), so a check that only asks "is focus somewhere
//      sensible" would have passed the defect that comment was written for.
//   8. NO SIDEWAYS SCROLL at eleven widths, in both themes, WITH THE DRAWER OPEN as well as
//      without — 767/768 and 1439/1440 are the endpoints of the two bands that have broken
//      before, and the middle of the band is measured, not interpolated.
//   9. CONTRAST computed on the real DOM in both themes (not on token pairs — a screen can
//      use a colour nobody put in a pair list), and GREYSCALE: with colour removed, the
//      status column and the code column still SAY what they mean.
//
// No new dependency: demo/cdp.mjs, node:child_process for psql, and the Chrome on the box.
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { attach, launchChrome, sleep } from './cdp.mjs'
import { assertFreshBuild } from './build-guard.mjs'

const BASE = process.env.DEMO_BASE ?? 'http://127.0.0.1:8080'
const DB = process.env.DEMO_DB ?? 'nfc_demo'
const SHOTS = '/tmp/ts-demo/operators'
const ADMIN = { email: 'demo@example.test', password: 'demo-nur-lokal-2026' }
const DEADLINE_MS = 12 * 60 * 1000

// The rows this probe creates. Named, so the teardown can be written by hand:
//
//   TEARDOWN (idempotent, safe to paste after a killed run):
//     psql -d nfc_demo -c "DELETE FROM phone_identities WHERE operator_id IN
//        (SELECT id FROM operators WHERE name LIKE 'PROBE %');
//      DELETE FROM operators WHERE name LIKE 'PROBE %';
//      UPDATE operators SET enrolment_code_hash = NULL, enrolment_code_expires_at = NULL,
//        enrolment_code_issued_at = NULL, enrolment_code_issued_by = NULL,
//        enrolment_code_redeemed_at = NULL;"
const PROBE_NAME = 'PROBE Operator'
const PROBE_PHONE = '0664 900 90 01' // → +436649009001, claimed by nobody in demo/seed.sql
/** The 390px journey needs its own person: §5's is already deactivated by §9. */
const PHONE_PROBE_NAME = 'PROBE Handy'
const PHONE_PROBE_PHONE = '0664 900 90 02'
// demo/seed.sql claims this one for WORKER 'Anna Berger' with operator_id NULL. Typing it
// into this screen is the collision the whole phone_identities design exists to make
// impossible, arriving at the one door a director actually uses.
const WORKER_PHONE = '+436600000004'

const host = new URL(BASE).hostname
if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(host)) {
  console.error(`check-operators: refusing to run against "${host}" — loopback only.`)
  process.exit(1)
}
if (DB !== 'nfc_demo') {
  console.error(`check-operators: refusing to write to "${DB}" — nfc_demo only.`)
  process.exit(1)
}

/**
 * NAMED, DATED GAPS — the same device as demo/audit-contrast.mjs's EXPECTED list, and for
 * the same reason: a gate that is red every run is not a gate, it is a line people learn to
 * scroll past. An entry here is a DEFECT THAT IS FILED, not a defect that is forgiven, and
 * it fails in BOTH directions — an entry that starts passing also exits 1, so a fixed screen
 * cannot leave a stale excuse behind for the next regression to hide under.
 */
const KNOWN_GAPS = new Map([
  [
    'the screen says an operator phone cannot also be a worker phone',
    'TASK-215 — the rule is enforced by phone_identities and stated nowhere the director can read',
  ],
])

const failures = []
const staleGaps = []
const gapsSeen = new Set()
const assert = (what, ok, detail = '') => {
  const gap = KNOWN_GAPS.get(what)
  if (gap !== undefined) {
    gapsSeen.add(what)
    if (ok) {
      staleGaps.push(what)
      console.log(`  STALE-GAP ${what}\n         it PASSES now — delete the KNOWN_GAPS entry (${gap})`)
    } else {
      console.log(`  gap  ${what}\n         ${gap}${detail ? `\n         ${detail}` : ''}`)
    }
    return
  }
  if (ok) console.log(`  ok   ${what}${detail ? `  ${detail}` : ''}`)
  else {
    failures.push(what)
    console.log(`  FAIL ${what}${detail ? `\n         ${detail}` : ''}`)
  }
}

const sql = (text) =>
  execFileSync('psql', ['-d', DB, '-tAX', '-v', 'ON_ERROR_STOP=1', '-c', text], {
    encoding: 'utf8',
  }).trim()

const WIDTHS = [767, 768, 800, 900, 1024, 1152, 1280, 1366, 1439, 1440, 1680]

/** Where focus is, in words, for a failure line that has to be actionable. */
const WHERE_FOCUS = `(() => {
  const a = document.activeElement
  if (!a) return 'null'
  if (a === document.body) return 'BODY'
  return a.tagName + (a.className ? '.' + String(a.className).trim().split(/\\s+/).join('.') : '')
    + ' :: ' + (a.textContent || '').trim().slice(0, 40)
})()`

/**
 * Every visible text node, its computed colour and the colour actually painted behind it,
 * with the contrast ratio — in colour AND as CSS `filter: grayscale(1)` would paint it.
 *
 * COLOURS ARE RESOLVED THROUGH A CANVAS, never with a regex. This design's tokens are
 * `oklch(...)`, which Chrome hands back from getComputedStyle as `lab(66.7 -5.9 -57.2)`;
 * a `[\d.]+` scrape reads that as rgb(66.7, 5.9, 57.2) — it silently drops the minus signs
 * and the colour space — and scores the accent link at 1.15:1 against a background it is
 * plainly readable on. The first version of this file did exactly that and reported two
 * fabricated defects. demo/audit-contrast.mjs already resolves through a canvas for the
 * same reason; this now matches it.
 *
 * Walks up for the background because a transparent element paints nothing — reading
 * `backgroundColor` off the text's own node reports rgba(0,0,0,0) and a naive check then
 * scores white-on-black for a screen that is grey-on-grey.
 */
const CONTRAST_PROBE = `(() => {
  const canvas = document.createElement('canvas')
  canvas.width = 1; canvas.height = 1
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  /** Any CSS colour Chrome can compute -> [r,g,b,a], NON-premultiplied (HTML spec). */
  const parse = (value) => {
    ctx.clearRect(0, 0, 1, 1)
    ctx.fillStyle = value
    ctx.fillRect(0, 0, 1, 1)
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
    return [r, g, b, a / 255]
  }
  const chan = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
  const lum = ([r, g, b]) => 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b)
  // CSS filter: grayscale(1) is a luma matrix on the GAMMA-ENCODED channels, which is NOT
  // the same number as relative luminance — that is why a greyscale run can fail where the
  // colour run passes, and why this is a second measurement and not a copy of the first.
  const grey = ([r, g, b]) => { const y = 0.2126 * r + 0.7152 * g + 0.0722 * b; return [y, y, y] }
  const over = (fg, bg) => {
    const a = fg.length > 3 ? fg[3] : 1
    return [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a))
  }
  // COMPOSITE FROM THE BOTTOM UP. Collecting layers on the way OUT and folding them in that
  // order is wrong in exactly the case that matters: .note paints --accent-weak, which is
  // oklch(... / 0.14) over the page. Folding outward-first threw the 0.14 away and scored
  // grey text on FULL-STRENGTH blue -- 1.11:1, a fabricated defect on a paragraph that
  // renders at 7:1. So: walk out, keep every painted layer, stop at the first opaque one,
  // then apply them nearest-LAST.
  const bgOf = (el) => {
    const layers = []
    let node = el
    let base = null
    while (node) {
      const c = parse(getComputedStyle(node).backgroundColor)
      if (c[3] === 1) { base = c.slice(0, 3); break }
      if (c[3] > 0) layers.push(c)
      node = node.parentElement
    }
    let acc = base ?? [255, 255, 255]
    for (let i = layers.length - 1; i >= 0; i--) acc = over(layers[i], acc)
    return acc
  }
  const ratioOf = (fg, bg) => {
    const L1 = lum(fg), L2 = lum(bg)
    return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05)
  }
  const out = []
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = (n.nodeValue || '').trim()
    if (text === '') continue
    const el = n.parentElement
    if (!el || el.closest('.visually-hidden') || el.classList.contains('visually-hidden')) continue
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none') continue
    if (el.getClientRects().length === 0) continue
    const bg = bgOf(el)
    const fg = over(parse(cs.color), bg)
    const px = Number.parseFloat(cs.fontSize)
    const bold = Number(cs.fontWeight) >= 700
    const large = px >= 24 || (bold && px >= 18.66)
    out.push({
      text: text.slice(0, 42),
      where: el.tagName + (el.className ? '.' + String(el.className).trim().split(/\\s+/)[0] : ''),
      ratio: Math.round(ratioOf(fg, bg) * 100) / 100,
      greyRatio: Math.round(ratioOf(grey(fg), grey(bg)) * 100) / 100,
      need: large ? 3 : 4.5,
    })
  }
  return out
})()`

async function setViewport(page, width, height) {
  await page.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await sleep(200)
  const actual = await page.eval('window.innerWidth')
  if (actual !== width) throw new Error(`viewport override did not take: ${width} → ${actual}`)
}

/**
 * Did `selector` show up? TRUE/FALSE, never a throw.
 *
 * `page.waitFor` throws, which aborts the run — and a mutant that removes a confirmation
 * dialog then surfaces as "the probe crashed" instead of "nothing asked before revoking a
 * code". Measured: demo/operator-mutants.sh's `revoke-direct` was reported as caught for the
 * wrong reason until this existed. A missing overlay is a VERDICT about the screen, so it is
 * returned as one.
 */
async function appears(page, selector, { timeout = 5000 } = {}) {
  try {
    await page.waitFor(`document.querySelector('${selector}')`, { timeout })
    return true
  } catch {
    return false
  }
}

async function press(page, key) {
  const code = key === 'Tab' ? 9 : key === 'Escape' ? 27 : 0
  for (const type of ['keyDown', 'keyUp']) {
    await page.send('Input.dispatchKeyEvent', {
      type,
      key,
      code: key,
      windowsVirtualKeyCode: code,
      nativeVirtualKeyCode: code,
    })
  }
  await sleep(160)
}

async function pressShiftTab(page) {
  for (const type of ['keyDown', 'keyUp']) {
    await page.send('Input.dispatchKeyEvent', {
      type,
      key: 'Tab',
      code: 'Tab',
      modifiers: 8,
      windowsVirtualKeyCode: 9,
      nativeVirtualKeyCode: 9,
    })
  }
  await sleep(160)
}

const setTheme = (page, theme) =>
  page.eval(`localStorage.setItem('nfcts.theme', ${JSON.stringify(theme)})`)

/** Click the button in the row whose <th> is `name`, matching the button's own label. */
const rowButton = (name, label) => `(() => {
  const row = [...document.querySelectorAll('table.data-table tbody tr')]
    .find((tr) => (tr.querySelector('th')?.textContent || '').includes(${JSON.stringify(name)}))
  if (!row) return null
  return [...row.querySelectorAll('button')]
    .find((b) => (b.textContent || '').includes(${JSON.stringify(label)})) ?? null
})()`

const rowText = (name) => `(() => {
  const row = [...document.querySelectorAll('table.data-table tbody tr')]
    .find((tr) => (tr.querySelector('th')?.textContent || '').includes(${JSON.stringify(name)}))
  return row ? row.innerText.replace(/\\s+/g, ' ').trim() : null
})()`

async function login(page) {
  await page.goto(`${BASE}/login/`, { settle: 700 })
  await page.type('input[name="email"]', ADMIN.email, { perChar: 0 })
  await page.type('input[name="password"]', ADMIN.password, { perChar: 0 })
  await page.clickText('Anmelden', { selector: 'form button[type="submit"]' })
  await page.waitFor(`location.pathname === '/'`, { timeout: 20000, label: 'the dashboard' })
}

async function openOperators(page, { settle = 1100 } = {}) {
  await page.goto(`${BASE}/operators/`, { settle })
  await page.waitFor(`document.querySelector('table.data-table, .empty-state')`, {
    timeout: 15000,
    label: 'the operator list',
  })
}

/**
 * Open the create drawer and WAIT FOR ITS ENTRY ANIMATION TO BE OVER before anything is
 * measured off it.
 *
 * `.drawer` animates `drawer-in` from `translateX(100%)`. Headless Chrome does not tick a
 * CSS animation while nothing forces a frame, so a plain `click(); sleep(250); rect()` reads
 * the FIRST keyframe: the drawer sits one whole viewport to the right, and an overflow probe
 * then reports the same fabricated defect at every width — which is exactly what the first
 * run of this file did, eleven widths × two themes of it. `.finish()` is deterministic and
 * needs no frame at all.
 */
async function openDrawer(page) {
  await page.eval(`document.querySelector('.topline-action button').click()`)
  await page.waitFor(`document.querySelector('.drawer')`, { timeout: 8000, label: 'the drawer' })
  await page.eval(
    `document.querySelector('.drawer').getAnimations().forEach((a) => a.finish())`,
  )
  await sleep(120)
}

/**
 * Open an overlay from a named opener and run the four keyboard rules against it.
 *
 * `openerJs` must evaluate to the ELEMENT, never to a click — the element is stamped with a
 * marker property first so focus restoration can be checked by IDENTITY. A React re-render
 * that replaces the node loses the marker while keeping tag, class and label, which is
 * exactly the failure lib/useOverlay.ts's `again()` fallback exists to paper over and
 * exactly the one a text comparison cannot see.
 */
async function keyboardContract(page, label, openerJs, overlaySelector) {
  const stamped = await page.eval(`(() => {
    const el = ${openerJs}
    if (!el) return false
    window.__probeOpener = el
    el.__probeMark = ${JSON.stringify(`mark-${label}`)}
    el.focus()
    el.click()
    return true
  })()`)
  if (!stamped) throw new Error(`keyboard[${label}]: no opener found`)
  await page.waitFor(`document.querySelector('${overlaySelector}')`, {
    timeout: 8000,
    label: `${label}: the overlay`,
  })

  assert(
    `keyboard[${label}]: focus moves INTO the overlay`,
    await page.eval(
      `!!document.querySelector('${overlaySelector}')?.contains(document.activeElement)`,
    ),
    await page.eval(WHERE_FOCUS),
  )

  // Forward, one stop past the last: a trap that leaks lands on the page behind.
  const stops = await page.eval(
    `document.querySelectorAll('${overlaySelector} a[href],${overlaySelector} button:not([disabled]),${overlaySelector} input:not([disabled]),${overlaySelector} select,${overlaySelector} textarea').length`,
  )
  let escaped = null
  for (let i = 0; i <= stops + 1 && escaped === null; i++) {
    await press(page, 'Tab')
    const inside = await page.eval(
      `!!document.querySelector('${overlaySelector}')?.contains(document.activeElement)`,
    )
    if (!inside) escaped = await page.eval(WHERE_FOCUS)
  }
  assert(
    `keyboard[${label}]: Tab cycles inside, ${stops + 2} presses over ${stops} stop(s)`,
    escaped === null,
    escaped === null ? '' : `focus left the overlay and landed on ${escaped}`,
  )

  let escapedBack = null
  for (let i = 0; i <= stops + 1 && escapedBack === null; i++) {
    await pressShiftTab(page)
    const inside = await page.eval(
      `!!document.querySelector('${overlaySelector}')?.contains(document.activeElement)`,
    )
    if (!inside) escapedBack = await page.eval(WHERE_FOCUS)
  }
  assert(
    `keyboard[${label}]: Shift+Tab cycles inside too`,
    escapedBack === null,
    escapedBack === null ? '' : `focus left the overlay and landed on ${escapedBack}`,
  )

  await press(page, 'Escape')
  await sleep(400)
  assert(
    `keyboard[${label}]: Escape closes the overlay`,
    await page.eval(`document.querySelector('${overlaySelector}') === null`),
  )

  const landed = await page.eval(`(() => {
    const a = document.activeElement
    return {
      sameNode: a === window.__probeOpener,
      marked: a?.__probeMark === ${JSON.stringify(`mark-${label}`)},
      where: a === document.body ? 'BODY' : (a?.tagName ?? 'null') + ' :: ' + (a?.textContent || '').trim().slice(0, 40),
      openerStillConnected: window.__probeOpener?.isConnected === true,
    }
  })()`)
  assert(
    `keyboard[${label}]: focus returns to the EXACT node that opened it`,
    landed.sameNode && landed.marked,
    `focus on ${landed.where} · sameNode=${landed.sameNode} marked=${landed.marked} openerConnected=${landed.openerStillConnected}`,
  )
}

async function main() {
  mkdirSync(SHOTS, { recursive: true })
  assertFreshBuild()

  const before = {
    operators: sql('SELECT count(*) FROM operators'),
    identities: sql('SELECT count(*) FROM phone_identities'),
    codes: sql('SELECT count(*) FROM operators WHERE enrolment_code_hash IS NOT NULL'),
  }

  const chrome = await launchChrome({ port: 9421, width: 1680, height: 1050 })
  const page = await attach(chrome.port)
  const timer = setTimeout(() => {
    console.error('check-operators: deadline hit')
    process.exit(1)
  }, DEADLINE_MS)

  try {
    await login(page)

    // ---- 1 · the list, both sizes, both themes ---------------------------------------
    for (const [w, h, tag] of [
      [1680, 1050, 'desktop'],
      [390, 844, 'phone'],
    ]) {
      await setViewport(page, w, h)
      for (const theme of ['dark', 'light']) {
        await setTheme(page, theme)
        await openOperators(page)
        const seen = await page.eval(`(() => {
          const rows = [...document.querySelectorAll('table.data-table tbody tr')]
          return {
            rows: rows.length,
            names: rows.map((r) => (r.querySelector('th')?.textContent || '').trim()),
            inactive: rows.filter((r) => r.className.includes('is-muted')).length,
          }
        })()`)
        await page.screenshot(`${SHOTS}/operators-${tag}-${theme}.png`)
        assert(
          `list[${tag}/${theme}]: every seeded operator is on screen`,
          seen.rows === 3 && seen.names.join('|').includes('Karin Bauer'),
          `${seen.rows} row(s): ${seen.names.join(', ')} · ${seen.inactive} muted`,
        )
      }
    }

    await setViewport(page, 1680, 1050)
    await setTheme(page, 'dark')
    await openOperators(page)

    // ---- 2 · the form marks required, and required vs optional is VISIBLE -------------
    await openDrawer(page)
    // The hint on an EMPTY field, captured before anything is typed. It is not the same
    // string as the one visible during the collision: `help=` swaps the standing hint for
    // the „Wird gespeichert als: …" preview the moment the number parses, so any rule
    // written into `phoneHint` is GONE from the screen exactly when it is being broken.
    // §4 needs both, and TASK-215 needs to know it.
    const emptyHint = await page.eval(
      `(document.querySelector('.drawer .field-hint')?.textContent || '').trim()`,
    )
    const fields = await page.eval(`(() => {
      return [...document.querySelectorAll('.drawer .field')].map((f) => ({
        label: (f.querySelector('label')?.childNodes[0]?.nodeValue || '').trim(),
        star: !!f.querySelector('.req'),
        optional: !!f.querySelector('.opt'),
        controlRequired: f.querySelector('input,select,textarea')?.required === true,
      }))
    })()`)
    assert(
      'form[operators]: every field is marked required or optional, none unmarked',
      fields.length === 2 && fields.every((f) => f.star !== f.optional),
      fields.map((f) => `${f.label}: ${f.star ? '*' : f.optional ? 'optional' : 'UNMARKED'}`).join(' · '),
    )
    assert(
      'form[operators]: the visible * is backed by a native required on the control',
      fields.every((f) => f.star === f.controlRequired),
      fields.map((f) => `${f.label}: star=${f.star} required=${f.controlRequired}`).join(' · '),
    )

    // ---- 3 · the collision, at the door a director uses -------------------------------
    await page.type('.drawer input[type="text"]', 'PROBE Kollision', { perChar: 0 })
    await page.type('.drawer input[type="tel"]', WORKER_PHONE, { perChar: 0 })
    await page.screenshot(`${SHOTS}/drawer-before-collision.png`)
    await page.clickText('Operator anlegen', { selector: '.drawer footer button[type="submit"]' })
    await sleep(1500)
    const collision = await page.eval(`(() => {
      const drawer = document.querySelector('.drawer')
      const phone = drawer?.querySelector('input[type="tel"]')
      return {
        stillOpen: !!drawer,
        phoneValue: phone?.value ?? null,
        nameValue: drawer?.querySelector('input[type="text"]')?.value ?? null,
        invalid: phone?.getAttribute('aria-invalid'),
        fieldError: (drawer?.querySelector('.field-error')?.textContent || '').trim() ||
          [...(drawer?.querySelectorAll('.field-error') ?? [])].map((p) => p.textContent.trim()).filter(Boolean).join(' | '),
        formError: (drawer?.querySelector('.form-error')?.textContent || '').trim(),
        pageText: document.body.innerText,
      }
    })()`)
    await page.screenshot(`${SHOTS}/drawer-collision.png`)
    const shown = `${collision.formError} ${collision.fieldError}`.trim()
    assert(
      'collision: the create is REFUSED and the drawer stays open with what was typed',
      collision.stillOpen && collision.phoneValue === WORKER_PHONE,
      `open=${collision.stillOpen} phone="${collision.phoneValue}" name="${collision.nameValue}"`,
    )
    assert(
      'collision: the phone field is marked invalid and carries the message',
      collision.invalid === 'true' && collision.fieldError !== '',
      `aria-invalid=${collision.invalid} field-error="${collision.fieldError}"`,
    )
    assert(
      'collision: the message is German prose, not a server token',
      shown.includes('Telefonnummer') &&
        !/phone_claimed|conflict|409|23505|Error/i.test(shown),
      `"${shown}"`,
    )
    assert(
      'collision: no raw server token anywhere on the screen',
      !/phone_claimed|23505|Internal|undefined/.test(collision.pageText),
      collision.pageText
        .split('\n')
        .filter((l) => /phone_claimed|23505|Internal|undefined/.test(l))
        .join(' | '),
    )
    assert(
      'collision: nothing was written — the operator count is unchanged',
      sql('SELECT count(*) FROM operators') === before.operators,
      `${sql('SELECT count(*) FROM operators')} vs ${before.operators} before`,
    )

    // ---- 4 · does the screen SAY a worker's phone cannot be used? ----------------------
    //
    // The rule is structural (phone_identities' primary key) and the director cannot see the
    // schema. Standing copy on the screen, or the hint under the field, or the refusal
    // itself — any of the three would do; what must not happen is that the only way to learn
    // it is to be refused and not be told why.
    const saysWorker = await page.eval(`(() => {
      const text = document.body.innerText
      const hint = (document.querySelector('.drawer .field-hint')?.textContent || '')
      const errs = [...document.querySelectorAll('.drawer .field-error, .drawer .form-error')]
        .map((p) => p.textContent.trim()).join(' ')
      const names = /Mitarbeiter|Reinigungskraft|worker/i
      return {
        onScreen: names.test(text),
        inHint: names.test(hint),
        inRefusal: names.test(errs),
        hint: hint.trim(),
        errs,
      }
    })()`)
    const namesWorker = /Mitarbeiter|Reinigungskraft|worker/i
    assert(
      'the screen says an operator phone cannot also be a worker phone',
      namesWorker.test(emptyHint) || saysWorker.inHint || saysWorker.inRefusal,
      `hint on an empty field="${emptyHint}" · hint during the collision="${saysWorker.hint}" · ` +
        `refusal="${saysWorker.errs}" (the word IS on the screen elsewhere: ${saysWorker.onScreen} — ` +
        `the "Auch Mitarbeiter" column, which says the opposite)`,
    )

    await press(page, 'Escape')
    await sleep(400)

    // ---- 5 · create, for real ---------------------------------------------------------
    await openDrawer(page)
    await page.type('.drawer input[type="text"]', PROBE_NAME, { perChar: 0 })
    await page.type('.drawer input[type="tel"]', PROBE_PHONE, { perChar: 0 })
    const preview = await page.eval(
      `(document.querySelector('.drawer .field-hint')?.textContent || '')`,
    )
    await page.clickText('Operator anlegen', { selector: '.drawer footer button[type="submit"]' })
    await page.waitFor(`document.querySelector('.drawer') === null`, {
      timeout: 10000,
      label: 'the drawer to close on a successful create',
    })
    await sleep(800)
    const created = await page.eval(rowText(PROBE_NAME))
    assert(
      'create: the new operator is in the list, with the phone in E.164',
      created !== null && created.includes('+436649009001'),
      `row: ${created}`,
    )
    assert(
      'create: the drawer previewed the normalised number before saving',
      preview.includes('+436649009001'),
      `hint: "${preview.trim()}"`,
    )
    // NON-VACUITY for "nothing was written" above: the SAME query, on a screen that DID
    // write, has to move. Without this, a count that is broken in a way that always returns
    // the starting number would report the collision as harmless forever.
    assert(
      'create: the row-count oracle moves when something IS written',
      Number(sql('SELECT count(*) FROM operators')) === Number(before.operators) + 1,
      `${before.operators} before → ${sql('SELECT count(*) FROM operators')} after one create`,
    )
    assert(
      'create: the page announces it in a live region that outlives the drawer',
      (await page.eval(`(document.querySelector('[role="status"]')?.textContent || '').trim()`)) !==
        '',
      await page.eval(
        `[...document.querySelectorAll('[role="status"]')].map((p) => p.textContent.trim()).join(' | ')`,
      ),
    )

    // ---- 6 · issue a code, once -------------------------------------------------------
    await page.eval(`(${rowButton(PROBE_NAME, 'Zugangscode erstellen')}).click()`)
    await page.waitFor(`document.querySelector('.share-panel')`, {
      timeout: 10000,
      label: 'the fresh code panel',
    })
    await sleep(400)
    const codePanel = await page.eval(`(() => {
      const panel = document.querySelector('.share-panel')
      return {
        code: (panel.querySelector('code.code')?.textContent || '').trim(),
        text: panel.innerText.replace(/\\s+/g, ' '),
        focused: panel === document.activeElement || panel.contains(document.activeElement),
        labelled: !!panel.getAttribute('aria-labelledby'),
      }
    })()`)
    await page.screenshot(`${SHOTS}/code-panel.png`)
    assert(
      'code: a real code is shown, focus lands on the panel that holds it',
      /^[A-Z0-9-]{6,}$/.test(codePanel.code) && codePanel.focused,
      `code="${codePanel.code}" focused=${codePanel.focused} labelled=${codePanel.labelled}`,
    )
    assert(
      'code: the panel says this is the only time it is shown, and what to do if it leaks',
      /nur dieses eine Mal|nur ein einziges Mal/.test(codePanel.text) &&
        codePanel.text.includes('sperren'),
      codePanel.text.slice(0, 160),
    )
    assert(
      'code: the hash is in the database and the plaintext is NOT',
      sql(
        `SELECT count(*) FROM operators WHERE name = '${PROBE_NAME}' AND enrolment_code_hash IS NOT NULL`,
      ) === '1' &&
        sql(
          `SELECT count(*) FROM operators WHERE enrolment_code_hash = '${codePanel.code}'`,
        ) === '0',
      `hash stored, plaintext "${codePanel.code}" not found in the column`,
    )

    // ---- 7 · revoke, through the confirmation ------------------------------------------
    await page.eval(`(${rowButton(PROBE_NAME, 'Zugangscode sperren')}).click()`)
    const revokeAsked = await appears(page, '.modal')
    const revokeModal = revokeAsked
      ? await page.eval(`document.querySelector('.modal').innerText.replace(/\\s+/g, ' ')`)
      : ''
    await page.screenshot(`${SHOTS}/revoke-confirm.png`)
    assert(
      'revoke: the confirmation names the person and says the code stops working at once',
      revokeAsked && revokeModal.includes(PROBE_NAME) && /sofort nicht mehr/.test(revokeModal),
      revokeAsked
        ? revokeModal.slice(0, 160)
        : 'NOTHING ASKED — one click blocked the code, with no way back and no confirmation',
    )
    if (revokeAsked)
      await page.clickText('Zugangscode sperren', { selector: '.modal footer button.btn-danger' })
    await sleep(1500)
    const afterRevoke = await page.eval(rowText(PROBE_NAME))
    assert(
      'revoke: the row falls back to "no code" and the page says whose code was blocked',
      afterRevoke.includes('Kein Zugangscode') &&
        (await page.eval(
          `[...document.querySelectorAll('[role="status"]')].map((p) => p.textContent).join(' ')`,
        )).includes(PROBE_NAME),
      afterRevoke,
    )
    assert(
      'revoke: the hash is gone from the database',
      sql(
        `SELECT count(*) FROM operators WHERE name = '${PROBE_NAME}' AND enrolment_code_hash IS NOT NULL`,
      ) === '0',
    )

    // ---- 8 · keyboard, both overlays --------------------------------------------------
    await openOperators(page)
    await keyboardContract(
      page,
      'create-drawer',
      `document.querySelector('.topline-action button')`,
      '.drawer',
    )
    await openOperators(page)
    await keyboardContract(
      page,
      'deactivate-confirm',
      rowButton(PROBE_NAME, 'Deaktivieren'),
      '.modal',
    )

    // ---- 9 · deactivate, and what the confirmation admits -----------------------------
    await openOperators(page)
    await page.eval(`(${rowButton(PROBE_NAME, 'Deaktivieren')}).click()`)
    const deactivateAsked = await appears(page, '.modal')
    const confirmText = deactivateAsked
      ? await page.eval(`document.querySelector('.modal').innerText.replace(/\\s+/g, ' ')`)
      : ''
    await page.screenshot(`${SHOTS}/deactivate-confirm.png`)
    assert(
      'deactivate: the confirmation names the person AND admits it cannot be undone here',
      deactivateAsked &&
        confirmText.includes(PROBE_NAME) &&
        /nicht rückgängig/.test(confirmText),
      deactivateAsked
        ? confirmText.slice(0, 200)
        : 'NOTHING ASKED — one click deactivated a person whom this screen cannot reactivate',
    )
    if (deactivateAsked)
      await page.clickText('Deaktivieren', { selector: '.modal footer button.btn-danger' })
    await sleep(1500)
    const afterDeactivate = await page.eval(rowText(PROBE_NAME))
    await page.screenshot(`${SHOTS}/after-deactivate.png`)
    assert(
      'deactivate: the row now says Inaktiv IN WORDS and offers no code',
      afterDeactivate.includes('Inaktiv') && afterDeactivate.includes('kein Zugangscode'),
      afterDeactivate,
    )
    const softly = {
      active: sql(`SELECT active::text FROM operators WHERE name = '${PROBE_NAME}'`),
      claim: sql(`SELECT count(*) FROM phone_identities WHERE phone_e164 = '+436649009001'`),
    }
    assert(
      'deactivate: it is a soft delete — the row and its phone claim both survive',
      softly.active === 'false' && softly.claim === '1',
      `operators.active=${softly.active} · phone_identities rows for +436649009001: ${softly.claim}`,
    )

    // ---- 10 · eleven widths, both themes, list AND drawer ------------------------------
    const overflows = []
    for (const theme of ['dark', 'light']) {
      for (const width of WIDTHS) {
        await setViewport(page, width, 900)
        await setTheme(page, theme)
        await openOperators(page, { settle: 700 })
        const list = await page.eval('document.documentElement.scrollWidth')
        if (list > width) overflows.push(`${theme}/${width}px list: scrollWidth ${list}`)
        await openDrawer(page)
        const drawer = await page.eval('document.documentElement.scrollWidth')
        const drawerBox = await page.eval(
          `(() => { const r = document.querySelector('.drawer').getBoundingClientRect();
             return { left: Math.round(r.left), right: Math.round(r.right) } })()`,
        )
        if (drawer > width) overflows.push(`${theme}/${width}px drawer: scrollWidth ${drawer}`)
        if (drawerBox.right > width + 1 || drawerBox.left < -1)
          overflows.push(
            `${theme}/${width}px drawer box: ${drawerBox.left}…${drawerBox.right} outside 0…${width}`,
          )
        if (width === 767 || width === 768 || width === 1439 || width === 1440)
          await page.screenshot(`${SHOTS}/w${width}-${theme}.png`)
        await press(page, 'Escape')
      }
    }
    assert(
      `widths: no sideways scroll on ${WIDTHS.length} widths × 2 themes × (list + drawer)`,
      overflows.length === 0,
      overflows.join(' | '),
    )

    // ---- 11 · contrast, on the real DOM, both themes -----------------------------------
    await setViewport(page, 1680, 1050)
    for (const theme of ['dark', 'light']) {
      await setTheme(page, theme)
      await openOperators(page)
      const measured = await page.eval(CONTRAST_PROBE)
      const bad = measured.filter((m) => m.ratio < m.need)
      const worst = [...measured].sort((a, b) => a.ratio - b.ratio)[0]
      assert(
        `contrast[${theme}]: ${measured.length} visible strings all meet WCAG AA`,
        bad.length === 0,
        bad.length === 0
          ? `worst ${worst.ratio}:1 ${worst.where} "${worst.text}"`
          : bad
              .slice(0, 6)
              .map((b) => `${b.ratio}:1 (needs ${b.need}) ${b.where} "${b.text}"`)
              .join(' | '),
      )
    }

    // ---- 12 · greyscale: the screen still says everything with colour removed ----------
    for (const theme of ['dark', 'light']) {
      await setTheme(page, theme)
      await openOperators(page)
      await page.eval(
        `document.documentElement.style.filter = 'grayscale(1)'` /* not a screenshot trick:
           this is the page the director sees on a mono screen or with a colour-blind eye */,
      )
      await sleep(300)
      await page.screenshot(`${SHOTS}/greyscale-${theme}.png`)
      const grey = await page.eval(`(() => {
        const rows = [...document.querySelectorAll('table.data-table tbody tr')]
        return rows.map((r) => {
          const cells = [...r.children].map((c) => c.innerText.replace(/\\s+/g, ' ').trim())
          return { name: cells[0], status: cells[3] || '', code: cells[4] || '' }
        })
      })()`)
      const wordy = grey.every((r) => /Aktiv|Inaktiv/.test(r.status))
      const codeWordy = grey.every((r) => r.code.trim() !== '')
      assert(
        `greyscale[${theme}]: active/inactive and the code state are WORDS, not a colour`,
        wordy && codeWordy && grey.length > 0,
        grey.map((r) => `${r.name}: ${r.status} / ${r.code.slice(0, 28)}`).join(' | '),
      )
      // The luma matrix, not the luminance one — see CONTRAST_PROBE's `grey`. A blue accent
      // that clears 4.5:1 in colour can drop below it once the hue is gone.
      const measured = await page.eval(CONTRAST_PROBE)
      const bad = measured.filter((m) => m.greyRatio < m.need)
      const worst = [...measured].sort((a, b) => a.greyRatio - b.greyRatio)[0]
      // NON-VACUITY. Most of this screen is already achromatic, so grey ratio == colour
      // ratio for most strings; if it were true for ALL of them this assertion would be a
      // copy of the one above wearing a different name. The accent link and the primary
      // button are the strings that must move.
      const moved = measured.filter((m) => Math.abs(m.greyRatio - m.ratio) > 0.05)
      assert(
        `greyscale[${theme}]: removing colour actually changes something (non-vacuity)`,
        moved.length > 0,
        moved
          .slice(0, 3)
          .map((m) => `${m.where} "${m.text}" ${m.ratio}→${m.greyRatio}`)
          .join(' | ') || 'NOT ONE string changed ratio — this check is measuring nothing',
      )
      assert(
        `greyscale[${theme}]: contrast survives colour removal (${measured.length} strings)`,
        bad.length === 0,
        bad.length === 0
          ? `worst ${worst.greyRatio}:1 ${worst.where} "${worst.text}" (${worst.ratio}:1 in colour)`
          : bad
              .slice(0, 6)
              .map(
                (b) =>
                  `${b.greyRatio}:1 grey (needs ${b.need}, ${b.ratio}:1 in colour) ${b.where} "${b.text}"`,
              )
              .join(' | '),
      )
      await page.eval(`document.documentElement.style.filter = ''`)
    }

    // ---- 13 · THE SAME WRITE JOURNEY ON A PHONE --------------------------------------
    //
    // Not a duplicate of §1's screenshots. Everything above that WRITES was driven at 1680,
    // and „it renders at 390" is a different claim from „it can be operated at 390": below
    // 768 the table is a stack of cards, the drawer is full-width, and the row actions sit
    // under their own captions. decision-28 says this admin is opened from a phone, and an
    // operator screen is the likeliest of the lot to be.
    await setViewport(page, 390, 844)
    await setTheme(page, 'dark')
    await openOperators(page)
    await openDrawer(page)
    assert(
      'phone[390]: the drawer fits the screen and its first control is focused',
      (await page.eval(`(() => {
        const r = document.querySelector('.drawer').getBoundingClientRect()
        return Math.round(r.left) >= -1 && Math.round(r.right) <= window.innerWidth + 1
      })()`)) &&
        (await page.eval(`document.querySelector('.drawer').contains(document.activeElement)`)),
      await page.eval(
        `(() => { const r = document.querySelector('.drawer').getBoundingClientRect()
           return Math.round(r.left) + '…' + Math.round(r.right) + ' of ' + window.innerWidth })()`,
      ),
    )
    await page.type('.drawer input[type="text"]', PHONE_PROBE_NAME, { perChar: 0 })
    await page.type('.drawer input[type="tel"]', PHONE_PROBE_PHONE, { perChar: 0 })
    await page.screenshot(`${SHOTS}/390-drawer.png`)
    await page.clickText('Operator anlegen', { selector: '.drawer footer button[type="submit"]' })
    await sleep(2000)
    const phoneRow = await page.eval(rowText(PHONE_PROBE_NAME))
    assert(
      'phone[390]: an operator can be created from a phone, and lands in the list',
      phoneRow !== null && phoneRow.includes('+436649009002'),
      `row: ${phoneRow}`,
    )

    await page.eval(`(${rowButton(PHONE_PROBE_NAME, 'Zugangscode erstellen')}).click()`)
    const phoneCode = (await appears(page, '.share-panel'))
      ? await page.eval(`(() => {
          const panel = document.querySelector('.share-panel')
          const r = panel.getBoundingClientRect()
          return {
            code: (panel.querySelector('code.code')?.textContent || '').trim(),
            fits: Math.round(r.right) <= window.innerWidth + 1 && Math.round(r.left) >= -1,
            scroll: document.documentElement.scrollWidth,
          }
        })()`)
      : null
    await page.screenshot(`${SHOTS}/390-code.png`)
    assert(
      'phone[390]: the code is readable on a 390px screen without scrolling sideways',
      phoneCode !== null &&
        /^[A-Z0-9-]{6,}$/.test(phoneCode.code) &&
        phoneCode.fits &&
        phoneCode.scroll <= 390,
      phoneCode === null ? 'no code panel appeared' : JSON.stringify(phoneCode),
    )

    await page.eval(`(${rowButton(PHONE_PROBE_NAME, 'Zugangscode sperren')}).click()`)
    const phoneRevokeAsked = await appears(page, '.modal')
    if (phoneRevokeAsked)
      await page.clickText('Zugangscode sperren', { selector: '.modal footer button.btn-danger' })
    await sleep(1500)
    assert(
      'phone[390]: revoking still asks first, and the modal fits the screen',
      phoneRevokeAsked &&
        (await page.eval(rowText(PHONE_PROBE_NAME))).includes('Kein Zugangscode'),
      phoneRevokeAsked ? '' : 'NOTHING ASKED at 390px',
    )

    await page.eval(`(${rowButton(PHONE_PROBE_NAME, 'Deaktivieren')}).click()`)
    const phoneConfirm = (await appears(page, '.modal'))
      ? await page.eval(`(() => {
          const m = document.querySelector('.modal')
          const r = m.getBoundingClientRect()
          return {
            text: m.innerText.replace(/\\s+/g, ' '),
            fits: Math.round(r.right) <= window.innerWidth + 1 && Math.round(r.left) >= -1,
          }
        })()`)
      : null
    await page.screenshot(`${SHOTS}/390-confirm.png`)
    assert(
      'phone[390]: the deactivate confirmation is on screen, whole, and names the person',
      phoneConfirm !== null &&
        phoneConfirm.fits &&
        phoneConfirm.text.includes(PHONE_PROBE_NAME) &&
        /nicht rückgängig/.test(phoneConfirm.text),
      phoneConfirm === null ? 'no confirmation appeared at 390px' : JSON.stringify(phoneConfirm),
    )
    if (phoneConfirm !== null)
      await page.clickText('Deaktivieren', { selector: '.modal footer button.btn-danger' })
    await sleep(1500)
    assert(
      'phone[390]: the row ends up Inaktiv, in words, on a phone too',
      (await page.eval(rowText(PHONE_PROBE_NAME))).includes('Inaktiv'),
      await page.eval(rowText(PHONE_PROBE_NAME)),
    )
  } catch (cause) {
    // A CRASH IS NOT A VERDICT — but it must not be silence either. demo/fix-mutants.sh only
    // counts a mutant as caught when the log carries a FAIL line, and half these assertions
    // live behind a `waitFor` that THROWS when the overlay it is waiting for never opens. So
    // the throw is recorded as a named failure, with the sections after it visibly missing.
    assert(
      'the probe reached the end of the run',
      false,
      `${String(cause?.message ?? cause).slice(0, 300)}\n         everything after this point was NOT measured`,
    )
  } finally {
    clearTimeout(timer)
    try {
      await page.close()
    } catch {
      /* already gone */
    }
    chrome.child.kill()
    // TEARDOWN. Every row this probe wrote, taken back, and the counts asserted — a probe
    // that leaves a PROBE operator behind makes the NEXT run's list assertion fail for a
    // reason that has nothing to do with the code.
    sql(
      `DELETE FROM phone_identities WHERE operator_id IN (SELECT id FROM operators WHERE name LIKE 'PROBE %');
       DELETE FROM operators WHERE name LIKE 'PROBE %';`,
    )
    const after = {
      operators: sql('SELECT count(*) FROM operators'),
      identities: sql('SELECT count(*) FROM phone_identities'),
      codes: sql('SELECT count(*) FROM operators WHERE enrolment_code_hash IS NOT NULL'),
    }
    assert(
      'teardown: nfc_demo is back to the row counts this probe started with',
      after.operators === before.operators &&
        after.identities === before.identities &&
        after.codes === before.codes,
      `operators ${before.operators}→${after.operators} · identities ${before.identities}→${after.identities} · codes ${before.codes}→${after.codes}`,
    )
  }

  console.log('')
  // A gap that never ran is not a gap, it is a typo in KNOWN_GAPS pointing at an assertion
  // that has been renamed or deleted — and it would silently absorb its replacement.
  const unreached = [...KNOWN_GAPS.keys()].filter((k) => !gapsSeen.has(k))
  for (const k of unreached) console.log(`  FAIL KNOWN_GAPS names an assertion that never ran: ${k}`)
  if (failures.length + staleGaps.length + unreached.length > 0) {
    console.log(`check-operators: ${failures.length} FAIL, ${staleGaps.length} stale gap(s)`)
    for (const f of [...failures, ...staleGaps]) console.log(`  - ${f}`)
    process.exitCode = 1
  } else {
    console.log(
      `check-operators: all checks green, ${KNOWN_GAPS.size} named gap(s) still open — see the lines marked "gap"`,
    )
  }
}

await main()
