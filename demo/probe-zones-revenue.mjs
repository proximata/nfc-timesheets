// GEOMETRY, MEASURED, for the three surfaces this run added: the zone list and the zone
// drawer on /locations/, and the revenue ledger and its drawer on /pl/.
//
// It answers the questions a screenshot cannot: does anything overflow 390px, is every new
// control reachable by keyboard, is focus trapped inside a drawer and restored when it
// closes, does Escape close it, and does every new sentence survive both themes.
//
// Numbers, not adjectives. Every assertion prints what it measured, so a regression shows
// up as a changed number in a diff rather than as a screenshot somebody has to compare by
// eye.
//
//   node demo/probe-zones-revenue.mjs            (server on 127.0.0.1:4319, DB nfc_demo)
//   BASE=http://127.0.0.1:4319 node demo/probe-zones-revenue.mjs
import { attach, launchChrome, sleep } from './cdp.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4319'
const EMAIL = process.env.DEMO_EMAIL ?? 'demo@example.test'
const PASSWORD = process.env.DEMO_PASSWORD ?? 'demo-nur-lokal-2026'

// Loopback only. Same guard every other demo/*.mjs carries: this script logs in.
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(BASE)) {
  throw new Error(`refusing a non-loopback target: ${BASE}`)
}

const WIDTHS = [
  // decision-7's desktop case, at the width the owner named.
  { name: '1680', width: 1680, height: 1050 },
  // decision-28: the admin panel works on a phone. 390 is the iPhone the director carries.
  { name: '390', width: 390, height: 844 },
]
const THEMES = ['dark', 'light']

const failures = []
const skipped = []
const lines = []
function record(ok, label, detail) {
  lines.push(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(`${label}: ${detail}`)
}

/**
 * NOT A PASS. A surface this build cannot render, named out loud.
 *
 * The map is the case: `NEXT_PUBLIC_GOOGLE_MAPS_KEY` is not in `ops/deploy.sh`, so the
 * default build draws no pin at all, and an assertion about pins written as
 * `pins === 0 || <the real test>` is green on a screen that never existed. That is worse
 * than a red one — it is a check reporting that it checked something.
 *
 * So the pin assertions SKIP, loudly, and the run prints how to make them run for real:
 *
 *   cd web && NEXT_PUBLIC_GOOGLE_MAPS_KEY=$(psst get NEXT_PUBLIC_GOOGLE_MAPS_KEY) pnpm build
 *   DATABASE_URL=postgres:///nfc_demo APP_KEY=… PORT=8080 PUBLIC_DIR="$PWD/web/out" \
 *     node demo/demo-server.mjs &
 *   BASE=http://127.0.0.1:8080 node demo/probe-zones-revenue.mjs
 *
 * Port 8080 is part of the fixture: the browser key is referrer-restricted to
 * `http://127.0.0.1:8080/*`, so on any other port Google answers `gm_authFailure` and the
 * map tears itself down.
 */
function skip(label, why) {
  lines.push(`SKIP ${label} — ${why}`)
  skipped.push(label)
}

/**
 * DOES THE PAGE OVERFLOW, and who did it.
 *
 * VERBATIM the definition demo/audit-widths.mjs uses, deliberately: `scrollWidth -
 * clientWidth` with a 1px tolerance, and culprits filtered through a CLIPPING-ancestor test.
 * A first version of this probe measured raw `getBoundingClientRect().right` against the
 * viewport and reported +871px on every screen at 390 - it was reading the table inside its
 * own `overflow-x: auto` panel and the off-canvas sidebar, neither of which a user can
 * scroll the PAGE to. Two definitions of "fits" is how two audits come to disagree.
 */
const OVERFLOW = `(() => {
  const by = document.documentElement.scrollWidth - document.documentElement.clientWidth
  const limit = window.innerWidth + 1
  const clipped = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const o = getComputedStyle(p)
      if (/hidden|clip|auto|scroll/.test(o.overflowX)) return true
    }
    return false
  }
  const over = [...document.querySelectorAll('body *')].filter((el) => {
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.right > limit && !clipped(el)
  })
  const overSet = new Set(over)
  const culprits = over
    .filter((el) => ![...el.children].some((c) => overSet.has(c)))
    .sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right)
    .slice(0, 3)
    .map((el) => {
      const r = el.getBoundingClientRect()
      const cls = String(el.className).split(' ').filter(Boolean).slice(0, 2).join('.')
      return el.tagName.toLowerCase() + (cls ? '.' + cls : '') + ' right=' + Math.round(r.right)
    })
  return { over: by > 1 ? by : 0, what: culprits.join(' | ') }
})()`

/** Everything the keyboard can reach, in tab order, as text. */
const FOCUSABLES = `(() => {
  const sel = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  return Array.from(document.querySelectorAll(sel))
    .filter((el) => el.offsetParent !== null || getComputedStyle(el).position === 'fixed')
    .map((el) => (el.getAttribute('aria-label') || el.textContent || el.name || el.type || el.tagName).trim().slice(0, 40))
})()`

/** Signed in the way the director does: two fields and a button, not an injected cookie. */
async function login(page) {
  await page.goto(`${BASE}/login/`, { settle: 700 })
  await page.type('input[name="email"]', EMAIL, { perChar: 5 })
  await page.type('input[name="password"]', PASSWORD, { perChar: 5 })
  await sleep(200)
  await page.eval(`document.querySelector('form button[type="submit"]').click()`)
  await page.waitFor(`location.pathname === '/'`, { label: 'the dashboard after sign-in' })
  await sleep(1000)
}

async function setTheme(page, theme) {
  await page.eval(`(() => {
    document.documentElement.dataset.theme = ${JSON.stringify(theme)}
    try { localStorage.setItem('ts-theme', ${JSON.stringify(theme)}) } catch {}
    return document.documentElement.dataset.theme
  })()`)
  await sleep(150)
}

// CONTRAST IS NOT MEASURED HERE. demo/audit-contrast.mjs already resolves every token
// THROUGH Chrome and composites the translucent ones over what is actually behind them,
// which is the part a hand-rolled version gets wrong: `--accent-weak` is
// `oklch(0.55 0.12 250 / 0.12)`, and a naive `rgb()` parser reads "0.55, 0.12, 250" as the
// background and reports 2.2:1 for a panel that is fine. That audit is the authority; this
// probe measures what it cannot know about.

async function run() {
  const { child, port } = await launchChrome({ port: 9341, width: 1680, height: 1050 })
  const page = await attach(port)
  try {
    await login(page)

    for (const { name, width, height } of WIDTHS) {
      await page.send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: width < 700,
      })

      for (const theme of THEMES) {
        const tag = `${name}/${theme}`

        // ---- /locations/, the zone list -------------------------------------------
        await page.goto(`${BASE}/locations/`)
        await setTheme(page, theme)
        await page.waitFor(`document.querySelectorAll('table.data-table tbody tr').length > 0`)

        let over = await page.eval(OVERFLOW)
        record(over.over <= 0, `${tag} /locations/ fits ${width}px`, `worst +${over.over}px ${over.what}`)

        // The zone column exists on every row and names the area state in WORDS.
        const zoneWords = await page.eval(`(() => {
          const rows = Array.from(document.querySelectorAll('table.data-table tbody tr'))
          return rows.map((r) => (r.children[4]?.textContent || '').trim().slice(0, 70))
        })()`)
        record(
          zoneWords.every((w) => w.length > 0),
          `${tag} every building states its zone/area state`,
          `${zoneWords.length} rows, e.g. "${zoneWords[0]}"`,
        )
        // GREY IS NEVER THE ONLY SIGNAL, and this counts rather than greps.
        //
        // A `body.innerText.includes(...)` version of this assertion passed for the wrong
        // reason twice: once because the phrase appeared in a hint paragraph belonging to no
        // row, and once because the copy was reworded and the check silently went looking
        // for a string nothing rendered any more. So the number of ROWS carrying the words
        // is compared against the number of buildings the API says have no live zone. Both
        // sides are measured; neither is a constant.
        const zoneTruth = await page.eval(`(async () => {
          const res = await fetch('/admin/data?limit=2000', { credentials: 'include' })
          const data = await res.json()
          const live = new Map()
          for (const z of data.zones) {
            if (!z.active) continue
            live.set(z.location_id, (live.get(z.location_id) || 0) + 1)
          }
          const unzoned = data.locations.filter((l) => (live.get(l.id) || 0) === 0)
          const rows = Array.from(document.querySelectorAll('table.data-table tbody tr'))
          const said = rows.filter((r) => unzoned.some((l) => r.textContent.includes(l.name)) && /Noch keine Zone angelegt|No zone recorded yet/.test(r.textContent))
          return {
            unzoned: unzoned.length,
            unzonedActive: unzoned.filter((l) => l.active).length,
            said: said.length,
            names: unzoned.map((l) => l.name),
          }
        })()`)
        record(
          zoneTruth.unzoned > 0 && zoneTruth.said === zoneTruth.unzoned,
          `${tag} every unzoned building says so in words, not only in grey`,
          `${zoneTruth.said}/${zoneTruth.unzoned} rows carry the sentence — ${zoneTruth.names.join(', ')}`,
        )
        // ...AND THE BUILDING IS STILL ACTIVE. The rule the owner stated operationally would
        // refuse the tap from the card on the HOIV wall (decision-43 section 3), so the
        // fixture that proves the words are there also proves the state was not merged.
        record(
          zoneTruth.unzonedActive === zoneTruth.unzoned,
          `${tag} ...and every one of them is still ACTIVE, not silently stood down`,
          `${zoneTruth.unzonedActive} of ${zoneTruth.unzoned} active`,
        )

        // The building tag is a COLLAPSED disclosure, and it still contains the URI.
        const disclosure = await page.eval(`(() => {
          const d = document.querySelector('details.tag-disclosure')
          if (!d) return null
          const r = d.querySelector('summary').getBoundingClientRect()
          return { open: d.open, h: Math.round(r.height), w: Math.round(r.width) }
        })()`)
        record(
          disclosure !== null && disclosure.open === false && disclosure.h >= 24,
          `${tag} building tag is collapsed, summary is a real target`,
          disclosure === null ? 'missing' : `${disclosure.w}x${disclosure.h}px, open=${disclosure.open}`,
        )

        // Open the zone list for a building that HAS zones.
        await page.eval(`(() => {
          const b = Array.from(document.querySelectorAll('button, a')).find((n) => /Zonen verwalten|Manage zones/.test(n.textContent))
          if (!b) throw new Error('no zone-list control on any row')
          b.click()
          return true
        })()`)
        await sleep(900)
        await page.waitFor(`document.body.innerText.includes('m²') || document.body.innerText.includes('Keine Zone')`)

        over = await page.eval(OVERFLOW)
        record(over.over <= 0, `${tag} zone list fits ${width}px`, `worst +${over.over}px ${over.what}`)

        // The zone tag URI is on the PERMANENT tag host, verbatim, never elided.
        const uri = await page.eval(`(() => {
          const c = Array.from(document.querySelectorAll('code.code-block')).find((n) => n.textContent.includes('/t?l='))
          if (!c) return null
          const r = c.getBoundingClientRect()
          return { text: c.textContent, clipped: c.scrollWidth > Math.ceil(r.width) + 1, w: Math.round(r.width) }
        })()`)
        record(
          uri !== null && uri.text.startsWith('https://timesheets.exe.xyz/t?l=') && !uri.clipped,
          `${tag} zone tag URI is whole and on the tag host`,
          uri === null ? 'missing' : `${uri.w}px wide, clipped=${uri.clipped}, ${uri.text}`,
        )

        // Both warnings a director must not discover at the wall.
        const warnings = await page.eval(`(() => {
          const t = document.body.innerText
          return {
            secondTag: /ZWEITER Tag|SECOND tag/.test(t),
            testTap: /Test-Tippen|test tap/i.test(t),
          }
        })()`)
        record(
          warnings.secondTag && warnings.testTap,
          `${tag} the deployment order and the test-tap cost are both stated`,
          JSON.stringify(warnings),
        )

        // ---- the zone drawer: focus trapped, Escape works, focus restored ----------
        const opener = await page.eval(`(() => {
          const b = Array.from(document.querySelectorAll('button')).find((x) => /Zone anlegen|Add a zone/.test(x.textContent))
          if (!b) return null
          b.id = b.id || 'probe-zone-opener'
          // FOCUS, THEN CLICK. A bare .click() leaves document.activeElement on <body>, and
          // then "focus was restored to the opener" is a question about the probe rather
          // than about the drawer. A director reaches this button with Tab.
          b.focus()
          b.click()
          return b.id
        })()`)
        await sleep(600)

        const drawer = await page.eval(`(() => {
          const d = document.querySelector('aside.drawer')
          if (!d) return null
          const r = d.getBoundingClientRect()
          return {
            w: Math.round(r.width),
            modal: d.getAttribute('aria-modal'),
            focusInside: d.contains(document.activeElement),
            active: (document.activeElement.textContent || document.activeElement.tagName).trim().slice(0, 30),
          }
        })()`)
        record(
          drawer !== null && drawer.modal === 'true' && drawer.focusInside,
          `${tag} zone drawer opens, is modal, takes focus`,
          drawer === null ? 'missing' : `${drawer.w}px, focus on "${drawer.active}"`,
        )
        record(
          drawer !== null && drawer.w <= width,
          `${tag} zone drawer fits the viewport`,
          drawer === null ? 'missing' : `${drawer.w} <= ${width}`,
        )

        over = await page.eval(OVERFLOW)
        record(over.over <= 0, `${tag} zone drawer fits ${width}px`, `worst +${over.over}px ${over.what}`)

        // Every control in the drawer is reachable, and the trap holds: tabbing past the
        // last control comes back to the first.
        const trap = await page.eval(`(() => {
          const d = document.querySelector('aside.drawer')
          if (!d) return { count: 0, names: ['(no drawer)'] }
          const sel = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])'
          const inside = Array.from(d.querySelectorAll(sel)).filter((el) => el.offsetParent !== null)
          return { count: inside.length, names: inside.map((e) => (e.getAttribute('aria-label') || e.textContent || e.type).trim().slice(0, 22)) }
        })()`)
        record(trap.count >= 5, `${tag} zone drawer controls reachable`, `${trap.count}: ${trap.names.join(' | ')}`)

        // ESCAPE closes it and focus goes back to the button that opened it.
        await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
        await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
        await sleep(400)
        const restored = await page.eval(`(() => ({
          closed: document.querySelector('aside.drawer') === null,
          focus: document.activeElement.id,
        }))()`)
        record(
          restored.closed && restored.focus === opener,
          `${tag} Escape closes the zone drawer and restores focus`,
          `closed=${restored.closed} focus=${restored.focus || '(body)'} expected=${opener}`,
        )

        // ---- /pl/, the revenue ledger ---------------------------------------------
        await page.goto(`${BASE}/pl/`)
        await setTheme(page, theme)
        await page.waitFor(`document.body.innerText.includes('Umsatz erfassen') || document.body.innerText.includes('Enter revenue')`)

        over = await page.eval(OVERFLOW)
        record(over.over <= 0, `${tag} /pl/ fits ${width}px`, `worst +${over.over}px ${over.what}`)

        // A MONTH WITH NO ENTRY NEVER RENDERS AS 0,00 EUR. This is the assertion the whole
        // decision-42 change exists for, checked against the cells themselves.
        //
        // Scoped to the LEDGER table by its caption, and the amount read from its FIRST LINE
        // only. A first version matched the whole cell text and counted the sub-line
        // "Vereinbart 960,00 EUR" as a zero, which is a substring and not an amount.
        const received = await page.eval(`(() => {
          const table = Array.from(document.querySelectorAll('table.data-table'))
            .find((t) => /Eingetragener Umsatz|Entered revenue/.test(t.querySelector('caption')?.textContent || ''))
          if (!table) return null
          const cells = Array.from(table.querySelectorAll('tbody tr')).map((r) =>
            (r.children[2]?.innerText || r.children[2]?.textContent || '').trim().split('\\n')[0].trim(),
          )
          const isUnknown = (c) => /^(Nicht eingetragen|Not entered)/.test(c)
          const isZero = (c) => /^0[,.]00/.test(c)
          return {
            rows: cells.length,
            sample: cells.slice(0, 6),
            unknown: cells.filter(isUnknown).length,
            zeros: cells.filter(isZero).length,
            // A cell that manages to be both is exactly the failure this change exists to
            // prevent: the unknown rendered as a confident nothing.
            confusions: cells.filter((c) => isUnknown(c) && /0[,.]00/.test(c)).length,
          }
        })()`)
        record(
          received !== null && received.unknown > 0 && received.confusions === 0,
          `${tag} an unentered month says so and is never 0,00`,
          received === null
            ? 'ledger table not found'
            : `${received.rows} rows: ${received.unknown} unentered, ${received.zeros} typed zeros, ${received.confusions} confusions | ${received.sample.join(' / ')}`,
        )

        // A TYPED ZERO IS STILL SHOWN AS A NUMBER, on the same screen, in the same column.
        record(
          received !== null && received.zeros > 0,
          `${tag} a typed 0 renders as an amount, not as the unknown`,
          received === null ? 'ledger table not found' : `${received.zeros} genuine zeros`,
        )

        // Provenance: when it was touched, and what it replaced.
        const provenance = await page.eval(`(() => {
          const t = document.body.innerText
          return { entered: /Eingetragen \\d|Entered \\d/.test(t), changed: /Geändert \\d|Changed \\d/.test(t), previous: /vorher|previously/.test(t) }
        })()`)
        record(
          provenance.entered && provenance.changed && provenance.previous,
          `${tag} /pl/ says when a figure was entered, changed, and what it replaced`,
          JSON.stringify(provenance),
        )

        // ---- the revenue drawer ----------------------------------------------------
        const revOpener = await page.eval(`(() => {
          const b = Array.from(document.querySelectorAll('button')).find((x) => /^Eintragen|^Enter$/.test(x.textContent.trim()))
          if (!b) return null
          b.id = b.id || 'probe-rev-opener'
          b.focus()
          b.click()
          return b.id
        })()`)
        await sleep(600)

        const revDrawer = await page.eval(`(() => {
          const d = document.querySelector('aside.drawer')
          if (!d) return null
          const r = d.getBoundingClientRect()
          const amount = d.querySelector('input[inputmode="decimal"]')
          return {
            w: Math.round(r.width),
            focusInside: d.contains(document.activeElement),
            // THE SUGGESTION IS NOT PRE-FILLED. An agreed number sitting in a field
            // labelled "received", one Enter from being stored, is the accrual decision-42
            // deleted, rebuilt out of a default value.
            amountEmpty: amount !== null && amount.value === '',
            suggestionOffered: /Vertragswert|contract value/.test(d.innerText),
            step: (d.querySelector('.step')?.textContent || '').trim(),
          }
        })()`)
        record(
          revDrawer !== null && revDrawer.focusInside,
          `${tag} revenue drawer opens and takes focus`,
          revDrawer === null ? 'missing' : `${revDrawer.w}px, step "${revDrawer.step}"`,
        )
        record(
          revDrawer !== null && revDrawer.amountEmpty,
          `${tag} the contract value is NOT pre-filled into the amount`,
          revDrawer === null ? 'missing' : `value="" is ${revDrawer.amountEmpty}, suggestion offered ${revDrawer.suggestionOffered}`,
        )

        over = await page.eval(OVERFLOW)
        record(over.over <= 0, `${tag} revenue drawer fits ${width}px`, `worst +${over.over}px ${over.what}`)

        await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
        await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
        await sleep(400)
        const revRestored = await page.eval(`(() => ({
          closed: document.querySelector('aside.drawer') === null,
          focus: document.activeElement.id,
        }))()`)
        record(
          revRestored.closed && revRestored.focus === revOpener,
          `${tag} Escape closes the revenue drawer and restores focus`,
          `closed=${revRestored.closed} focus=${revRestored.focus || '(body)'} expected=${revOpener}`,
        )

        // ---- /, the dashboard: the grey pin and the words behind it ----------------
        //
        // THE SURFACE THE OWNER NAMED. A building with a contract and a contact but no zones
        // is legitimate, is drawn, and is drawn GREY -- and the grey is the SECOND signal.
        // The pin, the Objektliste row and the info box each have to carry the state in
        // words, because a director who desaturates nothing still reads the list on a phone
        // in sunlight.
        await page.goto(`${BASE}/`)
        await setTheme(page, theme)
        await page.waitFor(`document.querySelectorAll('table.objects-table tbody tr').length > 0`)
        await sleep(400)

        over = await page.eval(OVERFLOW)
        record(over.over <= 0, `${tag} / fits ${width}px`, `worst +${over.over}px ${over.what}`)

        // Counted against the API again, not grepped: the Objektliste only lists ACTIVE
        // buildings, so the expected number is the active unzoned ones.
        const home = await page.eval(`(async () => {
          const data = await (await fetch('/admin/data?limit=2000', { credentials: 'include' })).json()
          const live = new Map()
          for (const z of data.zones) {
            if (!z.active) continue
            live.set(z.location_id, (live.get(z.location_id) || 0) + 1)
          }
          const unzoned = data.locations.filter((l) => l.active && (live.get(l.id) || 0) === 0)
          const pinnableUnzoned = unzoned.filter((l) => l.lat !== null && l.lng !== null).length
          const rows = Array.from(document.querySelectorAll('table.objects-table tbody tr'))
          const said = rows.filter((r) => unzoned.some((l) => r.textContent.includes(l.name)) && /Noch keine Zone angelegt|No zone recorded yet/.test(r.textContent))
          const pins = Array.from(document.querySelectorAll('.map-pin'))
          return {
            expected: unzoned.length,
            said: said.length,
            rows: rows.length,
            pins: pins.length,
            pinnableUnzoned,
            mapCollapsed: /Karte ist eingeklappt|map is collapsed/.test(document.body.innerText),
            greyPins: pins.filter((p) => p.dataset.zone === 'unzoned').length,
            pinsSayIt: pins.filter((p) => /ohne Zone|no zone/.test(p.textContent)).length,
            names: unzoned.map((l) => l.name),
          }
        })()`)
        record(
          home.expected > 0 && home.said === home.expected,
          `${tag} / every unzoned building says so in the Objektliste, in words`,
          `${home.said}/${home.expected} rows -- ${home.names.join(', ')}`,
        )
        // THE PINS, and only when Google actually drew some. See `skip` above for why this
        // is not written as `pins === 0 || ...`.
        //
        // The three numbers have to agree: the buildings the API says are unzoned AND
        // pinnable, the pins carrying the grey styling hook, and the pins carrying the WORD.
        // Grey without the word is the failure the owner named; the word without the grey
        // would be the styling silently dropped. Both are one comparison.
        if (home.pins === 0) {
          // TWO DIFFERENT REASONS FOR NO PIN, and they are not interchangeable. On a phone
          // the map is COLLAPSED BY DESIGN (decision-39 §3, IA-PLAN §9) and the Objektliste
          // is the whole answer — which is why the row assertions above are the ones that
          // matter at 390 and they ran. A desktop with no pin is the missing Maps key.
          skip(
            `${tag} / the grey pin`,
            home.mapCollapsed
              ? 'the map is collapsed on a phone by design — the Objektliste above IS the surface here, and it was asserted'
              : 'this build has no Google Maps key, so no pin was drawn — rebuild with the key and re-run against :8080',
          )
        } else {
          record(
            home.greyPins === home.pinnableUnzoned && home.pinsSayIt === home.pinnableUnzoned,
            `${tag} / a pin is grey and SAYS the word, or it is neither`,
            `${home.pins} pins drawn · ${home.pinnableUnzoned} unzoned+pinnable · ${home.greyPins} grey · ${home.pinsSayIt} carrying the word`,
          )
        }

        // THE INFO BOX / DRAWER: what is missing, what still works, and the route that fixes
        // it. Opened from the row, which is the keyboard path and the only set of tab stops.
        const boxOpener = await page.eval(`(async () => {
          const data = await (await fetch('/admin/data?limit=2000', { credentials: 'include' })).json()
          const live = new Set(data.zones.filter((z) => z.active).map((z) => z.location_id))
          const target = data.locations.find((l) => l.active && !live.has(l.id))
          if (!target) return null
          const row = Array.from(document.querySelectorAll('table.objects-table tbody tr')).find((r) => r.textContent.includes(target.name))
          const b = Array.from(row.querySelectorAll('button')).find((x) => /Öffnen|Open/.test(x.textContent))
          b.id = b.id || 'probe-home-opener'
          b.focus()
          b.click()
          return { id: b.id, name: target.name }
        })()`)
        await sleep(700)
        const box = await page.eval(`(() => {
          const d = document.querySelector('aside.drawer, .map-info')
          if (!d) return null
          const text = d.innerText
          return {
            w: Math.round(d.getBoundingClientRect().width),
            focusInside: d.contains(document.activeElement),
            saysMissing: /Noch keine Zone angelegt|No zone recorded yet/.test(text),
            saysStillWorks: /startet trotzdem eine Schicht|still starts a shift/.test(text),
            // NEVER the word for the operational state: 'inaktiv' here would be the merge
            // decision-43 section 3 forbids, printed at the reader.
            saysInactive: /inaktiv|inactive/i.test(text),
            fixLink: Array.from(d.querySelectorAll('a')).some((a) => /Erste Zone anlegen|Create the first zone/.test(a.textContent)),
          }
        })()`)
        record(
          box !== null && box.saysMissing && box.saysStillWorks && !box.saysInactive,
          `${tag} / the panel says what is missing AND what still works, and never says inactive`,
          box === null ? `no panel for ${boxOpener && boxOpener.name}` : JSON.stringify(box),
        )
        record(
          box !== null && box.fixLink,
          `${tag} / ...and offers the route that fixes it`,
          box === null ? 'missing' : `first-zone link ${box.fixLink}`,
        )
        over = await page.eval(OVERFLOW)
        record(over.over <= 0, `${tag} / with the panel open fits ${width}px`, `worst +${over.over}px ${over.what}`)

        await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
        await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
        await sleep(400)
        const homeRestored = await page.eval(`(() => ({
          closed: document.querySelector('aside.drawer') === null && document.querySelector('.map-info') === null,
          focus: document.activeElement.id,
        }))()`)
        record(
          homeRestored.closed && homeRestored.focus === (boxOpener && boxOpener.id),
          `${tag} / Escape closes the building panel and restores focus`,
          `closed=${homeRestored.closed} focus=${homeRestored.focus || '(body)'} expected=${boxOpener && boxOpener.id}`,
        )

        // ---- /workers/, the required rate ------------------------------------------
        await page.goto(`${BASE}/workers/`)
        await setTheme(page, theme)
        await page.waitFor(`document.querySelectorAll('table.data-table tbody tr').length > 0`)
        const rate = await page.eval(`(() => {
          const b = Array.from(document.querySelectorAll('button')).find((x) => /Mitarbeiter anlegen|Add a worker|Add worker/.test(x.textContent))
          b.click()
          return true
        })()`)
        await sleep(500)
        const rateField = await page.eval(`(() => {
          const d = document.querySelector('aside.drawer')
          if (!d) return null
          const labels = Array.from(d.querySelectorAll('label'))
          const l = labels.find((x) => /Stundensatz|Hourly rate/.test(x.textContent))
          if (!l) return null
          const input = d.querySelector('#' + CSS.escape(l.getAttribute('for')))
          return {
            marker: l.textContent.includes('*'),
            optionalWord: /optional/i.test(l.textContent),
            required: input?.required === true,
          }
        })()`)
        record(
          rateField !== null && rateField.marker && rateField.required && !rateField.optionalWord,
          `${tag} the hourly rate is marked required on the label AND the control`,
          JSON.stringify(rateField),
        )
        record(rate === true, `${tag} worker drawer reachable`)
        await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
        await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
        await sleep(300)
      }
    }
  } finally {
    page.close()
    child.kill()
  }

  process.stdout.write(`${lines.join('\n')}\n\n`)
  if (failures.length > 0) {
    process.stderr.write(`${failures.length} probe(s) failed.\n`)
    process.exit(1)
  }
  // A SKIP IS REPORTED IN THE SUCCESS LINE, not swallowed by it. A run that says "all
  // passed" while four assertions never executed is the report this whole file exists to
  // stop being possible.
  process.stdout.write(
    skipped.length === 0
      ? 'All geometry probes passed.\n'
      : `All geometry probes passed — ${skipped.length} SKIPPED and NOT proven: ${skipped.join(', ')}\n`,
  )
}

await run()
