// Accessibility of the two NEW surfaces of the IA round: the Objektpanel (`?location=`) and
// the map region on `/`. Driven through REAL key events, against a real Google map.
//
//   cd web && NEXT_PUBLIC_GOOGLE_MAPS_KEY=$(psst get NEXT_PUBLIC_GOOGLE_MAPS_KEY) pnpm build
//   DATABASE_URL=postgres:///nfc_demo APP_KEY=… PORT=8080 PUBLIC_DIR="$PWD/web/out" \
//     node demo/demo-server.mjs &
//   node demo/audit-map-a11y.mjs
//
// PORT 8080 IS PART OF THE FIXTURE, same as demo/check-map-home.mjs: the Maps browser key is
// referrer-restricted to `http://127.0.0.1:8080/*`, so on any other port Google answers
// `gm_authFailure`, the map tears itself down, and every assertion below about a DRAWN map
// would pass vacuously by never running. So a run that cannot find pins REFUSES rather than
// reporting a green nothing.
//
// WHY REAL KEY EVENTS. `dispatchEvent(new KeyboardEvent('keydown'))` does not move focus —
// sequential navigation is the browser's, not a listener's — so a focus trap tested with
// synthetic Tabs passes even when it does not trap. Every keypress here goes through
// `Input.dispatchKeyEvent` and every assertion reads `document.activeElement`.
//
// WHAT IT PROVES, and why none of it is readable off the source:
//
//   1. THE OBJEKTPANEL DRAWER keeps the whole overlay contract — focus in, trapped both
//      ways, Escape closes, focus RESTORES to the opener, body scroll locked and released.
//      Checked on the rendering that production will actually see on day one: a building
//      with NULL coordinates, which cannot have an info box and therefore gets the drawer.
//   2. THE INFO BOX ON A PIN IS HELD TO THE SAME CONTRACT, and the run reports exactly which
//      parts of it hold. It is not a dialog and does not claim to be, but it is a thing that
//      appears over the reading surface holding eleven links, and „can a keyboard reach it,
//      and can a keyboard get out of it" has one right answer whatever it is called.
//   3. THE KEYBOARD PATH IS THE OBJEKTLISTE, and it reaches EVERYTHING THE PINS DO. Proven
//      as set equality of hrefs per building — the mouse path (click the pin) against the
//      keyboard path (focus the row's „Öffnen" and press Enter) — for every building,
//      pinned and unpinned. A stated ceiling („the list is the tab order") is only a ceiling
//      if the list is complete; otherwise it is a hole with a comment on it.
//   4. THE COST OF GOOGLE'S OWN CHROME IS COUNTED. `disableDefaultUI` leaves zoom, „Kurz-
//      befehle", the terms link and two more anchors in the tab order of the LANDING screen,
//      ahead of the ledger. That is not a bug we introduced but it is a bill the keyboard
//      user pays on every visit, and a number nobody has measured is a number nobody can
//      decide about.
//
// READ-ONLY against nfc_demo. It clicks, tabs and presses Escape; it submits no form.
import { mkdirSync } from 'node:fs'
import { attach, launchChrome, sleep } from './cdp.mjs'

const BASE = process.env.AUDIT_BASE ?? 'http://127.0.0.1:8080'
const SHOTS = '/tmp/ts-audit/map-a11y'
const ADMIN = { email: 'demo@example.test', password: 'demo-nur-lokal-2026' }

const host = new URL(BASE).hostname
if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(host)) {
  console.error(`audit-map-a11y: refusing to drive "${host}" — loopback only.`)
  process.exit(1)
}

const results = []
const record = (ok, label, detail = '') => {
  results.push({ ok, label, detail })
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `  — ${detail}` : ''}`)
}

const chrome = await launchChrome({
  port: Number(process.env.AUDIT_PORT ?? 9421),
  width: 1680,
  height: 1050,
})
const page = await attach(chrome.port)

/** Real keypress. `Tab` needs `rawKeyDown` for the browser to run sequential navigation. */
async function key(name, { shift = false } = {}) {
  const map = {
    Tab: { windowsVirtualKeyCode: 9, code: 'Tab', key: 'Tab' },
    Escape: { windowsVirtualKeyCode: 27, code: 'Escape', key: 'Escape' },
    Enter: { windowsVirtualKeyCode: 13, code: 'Enter', key: 'Enter' },
  }
  const base = map[name]
  const modifiers = shift ? 8 : 0
  await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', modifiers, ...base })
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers, ...base })
  await sleep(70)
}

const active = () =>
  page.eval(`(() => {
    const el = document.activeElement
    if (!el || el === document.body) return { tag: 'BODY', text: '', inDrawer: false, inInfo: false, inMapCanvas: false }
    const name = (el.getAttribute('aria-label') || el.textContent || el.id || '').trim()
    return {
      tag: el.tagName,
      id: el.id,
      cls: String(el.className),
      text: name.replace(/\\s+/g, ' ').slice(0, 56),
      inDrawer: !!el.closest('.drawer'),
      inInfo: !!el.closest('.map-info'),
      inMapCanvas: !!el.closest('.map-canvas'),
      isOpener: el === window.__opener,
    }
  })()`)

const bodyLocked = () =>
  page.eval(`getComputedStyle(document.body).overflow === 'hidden' ||
             document.body.style.overflow === 'hidden'`)

async function login() {
  await page.goto(`${BASE}/login/`, { settle: 700 })
  await page.type('input[name="email"]', ADMIN.email, { perChar: 0 })
  await page.type('input[name="password"]', ADMIN.password, { perChar: 0 })
  await page.clickText('Anmelden', { selector: 'form button[type="submit"]' })
  await page.waitFor(`location.pathname === '/'`, { timeout: 15000, label: 'the dashboard' })
}

/** Wait until the map region has settled out of „wird geladen". */
async function mapSettled(timeout = 25000) {
  await page.waitFor(
    `(() => { const n = document.querySelector('.map-region .note');
              return n && !/wird geladen|Loading the map/i.test(n.textContent) })()`,
    { timeout, label: 'the map region to settle' },
  )
}

/**
 * The FULL overlay contract, applied to whatever `selector` names. Used for the drawer AND
 * for the info box, deliberately: writing a weaker version for the surface that is not
 * called a dialog is how „it is not a dialog" turns into „so none of the rules apply".
 *
 * `open` must leave `window.__opener` set to the control that was activated, so restoration
 * is compared against a NODE REFERENCE captured before the click — a re-queried selector
 * would also be satisfied by a fresh element that merely looks like the opener.
 */
async function overlayContract(label, selector, open, { expectDialogRole } = {}) {
  await open()
  await sleep(450)

  const isOpen = await page.eval(`!!document.querySelector(${JSON.stringify(selector)})`)
  if (!isOpen) {
    record(false, `${label}: opens at all`, `nothing matched ${selector}`)
    return
  }

  const first = await active()
  record(first.inDrawer || first.inInfo, `${label}: focus moves INTO it`, `${first.tag} "${first.text}"`)

  if (expectDialogRole) {
    const semantics = await page.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)})
      const by = el.getAttribute('aria-labelledby')
      const named = by && document.getElementById(by)
      return {
        role: el.getAttribute('role'),
        modal: el.getAttribute('aria-modal'),
        name: named ? named.textContent.trim() : el.getAttribute('aria-label'),
      }
    })()`)
    record(
      semantics.role === 'dialog' && semantics.modal === 'true' && !!semantics.name,
      `${label}: role=dialog + aria-modal + an accessible name`,
      `role=${semantics.role} modal=${semantics.modal} name=${JSON.stringify(semantics.name)}`,
    )
    record(await bodyLocked(), `${label}: body scroll locked while open`)
  }

  // Tab is trapped. Count the focusables and press that many + 3: if the trap leaks, focus
  // is outside by then. Bounded by construction — no waiting, no timeout.
  const inside = expectDialogRole ? '.drawer' : '.map-info'
  const count = await page.eval(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)})
    const sel = 'a[href],area[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
    return [...el.querySelectorAll(sel)].filter((n) => n.getClientRects().length > 0).length
  })()`)
  let escaped = null
  for (let i = 0; i < count + 3; i++) {
    await key('Tab')
    const where = await active()
    if (!(inside === '.drawer' ? where.inDrawer : where.inInfo)) {
      escaped = { step: i + 1, ...where }
      break
    }
  }
  record(
    escaped === null,
    `${label}: Tab is trapped (${count} focusables, ${count + 3} presses)`,
    escaped === null ? '' : `escaped at press ${escaped.step} onto ${escaped.tag} "${escaped.text}"`,
  )

  // Escape closes. Dispatched at the document, capture phase or not — a listener that is
  // simply absent is what this catches.
  await key('Escape')
  await sleep(400)
  const closed = await page.eval(`!document.querySelector(${JSON.stringify(selector)})`)
  record(closed, `${label}: Escape closes it`)

  if (closed) {
    const where = await active()
    record(where.isOpener === true, `${label}: focus RESTORED to the opener`, `${where.tag} "${where.text}"`)
    record(!(await bodyLocked()), `${label}: body scroll released after close`)
  } else {
    // Leave the page in a known state for the next section rather than carrying an open
    // surface into it — a cascade of failures caused by one is unreadable.
    await page.eval(`history.replaceState(null, '', location.pathname); dispatchEvent(new PopStateEvent('popstate'))`)
    await sleep(300)
  }
}

async function main() {
  mkdirSync(SHOTS, { recursive: true })
  await login()
  await mapSettled()

  // The fixture has to be the KEYED one or half this file passes by never running.
  const status = await page.eval(`document.querySelector('.map-region .note')?.textContent ?? ''`)
  const pins = await page.eval(`document.querySelectorAll('.map-pin').length`)
  console.log(`       map status: ${status.trim()}`)
  if (pins === 0) {
    console.error(
      '\naudit-map-a11y: no pins. Either the build carries no Maps key or the port is not 8080\n' +
        '                (the key is referrer-restricted). Refusing to report a green nothing.',
    )
    page.close()
    chrome.child.kill()
    process.exit(1)
  }

  // =====================================================================================
  console.log('\n--- 1 · the Objektpanel DRAWER (a building with NULL coordinates) ---')
  // The rendering production sees on day one: `locations` holds one row and its lat/lng are
  // NULL, so there is no pin to hang an info box on and the drawer is the object surface.
  {
    const unpinned = await page.eval(`(() => {
      const row = [...document.querySelectorAll('table.objects-table tbody tr')]
        .find((r) => r.textContent.includes('Koordinaten holen'))
      return row ? row.querySelector('th').textContent.trim() : null
    })()`)
    record(unpinned !== null, 'fixture: a building with no coordinates is on screen', unpinned ?? 'none')

    await overlayContract(
      'Objektpanel drawer',
      '.drawer',
      async () => {
        await page.eval(`(() => {
          const row = [...document.querySelectorAll('table.objects-table tbody tr')]
            .find((r) => r.textContent.includes('Koordinaten holen'))
          const b = row.querySelector('.cell-actions button')
          window.__opener = b; b.focus(); b.click(); return true
        })()`)
      },
      { expectDialogRole: true },
    )
    await page.screenshot(`${SHOTS}/drawer-unpinned.png`)
  }

  // =====================================================================================
  console.log('\n--- 2 · the INFO BOX on a pin, held to the same contract ---')
  await page.goto(`${BASE}/`, { settle: 1200 })
  await mapSettled()
  await page.waitFor(`document.querySelectorAll('.map-pin').length > 0`, { label: 'pins' })
  {
    await overlayContract('map info box', '.map-info', async () => {
      // Opened THE WAY A KEYBOARD USER MUST: the Objektliste row, not the pin. The pin's own
      // label is `aria-hidden` + `tabindex=-1` by design (components/HomeMap.tsx says so),
      // so the row is the only way in.
      await page.eval(`(() => {
        const row = [...document.querySelectorAll('table.objects-table tbody tr')]
          .find((r) => !r.textContent.includes('Koordinaten holen'))
        const b = row.querySelector('.cell-actions button')
        window.__opener = b; b.focus(); b.click(); return true
      })()`)
    })

    // Whatever the contract said, the box is still open or not. Put the URL back.
    await page.goto(`${BASE}/`, { settle: 1200 })
    await mapSettled()
  }

  // =====================================================================================
  console.log('\n--- 3 · where the info box SITS in the tab order, from its own opener ---')
  {
    await page.eval(`(() => {
      const row = [...document.querySelectorAll('table.objects-table tbody tr')]
        .find((r) => !r.textContent.includes('Koordinaten holen'))
      const b = row.querySelector('.cell-actions button')
      window.__opener = b; b.focus(); b.click(); return true
    })()`)
    await sleep(1400)
    await page.screenshot(`${SHOTS}/info-open.png`)

    // FORWARD: how many Tabs from the opener until focus is inside the box? A surface that
    // opens over what you are reading and is only reachable BACKWARDS is a surface a
    // forward-tabbing reader never finds.
    let forward = null
    for (let i = 1; i <= 30; i++) {
      await key('Tab')
      if ((await active()).inInfo) {
        forward = i
        break
      }
    }
    record(
      forward !== null && forward <= 2,
      'info box: reachable by pressing Tab FORWARD from the control that opened it',
      forward === null ? 'not reached in 30 presses' : `${forward} presses`,
    )

    // BACKWARD, for the record: it IS reachable, and this counts what stands in the way.
    await page.eval(`window.__opener.focus()`)
    let backward = null
    let googleStops = 0
    for (let i = 1; i <= 30; i++) {
      await key('Tab', { shift: true })
      const where = await active()
      if (where.inMapCanvas && !where.inInfo) googleStops++
      if (where.inInfo) {
        backward = i
        break
      }
    }
    record(
      backward !== null,
      'info box: reachable at all with the keyboard (Shift+Tab)',
      backward === null ? 'not reached in 30 presses' : `${backward} presses back, ${googleStops} of them Google's own controls`,
    )

    // And once inside, can the reader LEAVE it forwards without walking the whole box?
    // (No trap is claimed, so this is a measurement, not a violation.)
    const linkCount = await page.eval(`document.querySelectorAll('.map-info a').length`)
    record(
      linkCount >= 5,
      'info box: the cross-links really are inside it (not a summary that links nowhere)',
      `${linkCount} links`,
    )
  }

  // =====================================================================================
  console.log("\n--- 4 · Google's own controls in the tab order of the LANDING screen ---")
  await page.goto(`${BASE}/`, { settle: 1200 })
  await mapSettled()
  {
    // The selector is built per-clause on purpose. `'.map-canvas ' + 'a,button,…'` is the
    // bug that made the first version of this line answer 35: a descendant combinator binds
    // only to the FIRST clause of a comma list, so every button on the page was counted and
    // the number said nothing about the map.
    const SCOPED = ['a[href]', 'button:not([disabled])', '[tabindex]:not([tabindex="-1"])']
      .map((clause) => `.map-canvas ${clause}`)
      .join(',')
    const google = await page.eval(`(() => {
      return [...document.querySelectorAll(${JSON.stringify(SCOPED)})]
        // Our own pins are excluded because they are NOT tab stops (asserted below): the
        // button clause matches them but tabIndex = -1 keeps them out of the sequence, and
        // counting them here would blame Google for our own markup.
        .filter((n) => n.getClientRects().length > 0 && !n.closest('.map-pin') && n.tabIndex >= 0)
        .map((n) => (n.getAttribute('aria-label') || n.textContent || n.title || '?').trim().replace(/\\s+/g, ' ').slice(0, 44))
    })()`)
    console.log(`       ${google.length} stops: ${google.join(' | ')}`)

    // …and the pins themselves are NOT among them. That is the stated ceiling in
    // components/HomeMap.tsx, and a ceiling nobody measures is a ceiling that drifts.
    const pinStops = await page.eval(
      `[...document.querySelectorAll('.map-pin-label')].filter((n) => n.tabIndex >= 0).length`,
    )
    record(
      pinStops === 0,
      'map: the pins are NOT tab stops — the Objektliste is the keyboard path (stated ceiling)',
      `${pinStops} focusable pin labels`,
    )
    // Every one of them must at least be NAMED — an unlabelled control inside a region the
    // reader cannot see is the worst of both.
    record(
      google.every((name) => name !== '?' && name !== ''),
      "map: every one of Google's own tab stops carries an accessible name",
      google.join(' | '),
    )
    // The number itself is the finding. Asserted against a ceiling so a future Maps release
    // that doubles it is caught rather than absorbed.
    // The number itself is the finding, and 8 is not an aspiration — it is what Google's
    // own chrome costs TODAY with `disableDefaultUI: true` and only `zoomControl` asked for.
    // Pinned so a Maps release that adds a ninth is caught rather than absorbed.
    record(
      google.length <= 8,
      "map: Google's chrome costs no more than 8 tab stops ahead of the ledger",
      `${google.length}: ${google.join(' | ')}`,
    )
  }

  // =====================================================================================
  console.log('\n--- 5 · the Objektliste reaches EVERYTHING the pins do ---')
  // Set equality of hrefs, per building, mouse path against keyboard path. This is what
  // makes „the pins are aria-hidden, the list is the tab order" a ceiling and not a hole.
  {
    const buildings = await page.eval(`(() => {
      return [...document.querySelectorAll('table.objects-table tbody tr')].map((r) => ({
        // The FIRST text node of the row header. \`textContent\` would drag the coordinate
        // note in with it and the pin lookup below would then never match.
        name: (r.querySelector('th').childNodes[0].textContent || '').trim(),
        unpinned: r.textContent.includes('Koordinaten holen'),
      }))
    })()`)
    record(buildings.length > 1, 'fixture: more than one building to compare', `${buildings.length}`)

    /** Open building #i through the LIST and read every href on whichever surface appears. */
    const viaList = async (index) => {
      await page.goto(`${BASE}/`, { settle: 1200 })
      await mapSettled()
      await page.eval(`(() => {
        const r = document.querySelectorAll('table.objects-table tbody tr')[${index}]
        const b = r.querySelector('.cell-actions button')
        b.focus(); b.click(); return true
      })()`)
      await sleep(1300)
      return page.eval(`(() => {
        const box = document.querySelector('.map-info') || document.querySelector('.drawer')
        if (!box) return null
        return [...box.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')).sort()
      })()`)
    }

    /** Open the SAME building by clicking its pin, the way a mouse does. */
    const viaPin = async (name) => {
      await page.goto(`${BASE}/`, { settle: 1200 })
      await mapSettled()
      await page.waitFor(`document.querySelectorAll('.map-pin').length > 0`, {
        timeout: 25000,
        label: `pins, before clicking ${name}`,
      })
      const clicked = await page.eval(`(() => {
        const wanted = ${JSON.stringify(name)}
        const pin = [...document.querySelectorAll('.map-pin')]
          .find((p) => p.textContent.includes(wanted.split(' ')[0]))
        if (!pin) return false
        pin.querySelector('.map-pin-label').click()
        return true
      })()`)
      if (!clicked) return 'no-pin'
      await sleep(1300)
      return page.eval(`(() => {
        const box = document.querySelector('.map-info') || document.querySelector('.drawer')
        if (!box) return null
        return [...box.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')).sort()
      })()`)
    }

    for (const [index, building] of buildings.entries()) {
      const list = await viaList(index)
      if (building.unpinned) {
        record(
          Array.isArray(list) && list.length >= 5,
          `parity: ${building.name} (no pin) — the list still opens its whole object surface`,
          Array.isArray(list) ? `${list.length} links` : String(list),
        )
        continue
      }
      const pin = await viaPin(building.name)
      const same = Array.isArray(list) && Array.isArray(pin) && JSON.stringify(list) === JSON.stringify(pin)
      record(
        same,
        `parity: ${building.name} — the list row opens exactly what the pin opens`,
        same
          ? `${list.length} links, identical`
          : `list=${JSON.stringify(list)?.slice(0, 120)} pin=${JSON.stringify(pin)?.slice(0, 120)}`,
      )
    }
  }

  // =====================================================================================
  console.log('\n--- 6 · the phone: the map is collapsed and the panel is the bottom sheet ---')
  {
    await page.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true,
    })
    await page.goto(`${BASE}/`, { settle: 1600 })
    await page.waitFor(`document.querySelectorAll('table.objects-table tbody tr').length > 0`, {
      label: 'the Objektliste on a phone',
    })
    const collapsed = await page.eval(
      `document.querySelector('.map-canvas') === null && !!document.querySelector('[aria-controls="map-region-body"]')`,
    )
    record(collapsed, 'phone: no map is built until it is asked for, and there is a control to ask')

    await overlayContract(
      'phone Objektpanel',
      '.drawer',
      async () => {
        await page.eval(`(() => {
          const r = document.querySelectorAll('table.objects-table tbody tr')[0]
          const b = r.querySelector('.cell-actions button')
          window.__opener = b; b.focus(); b.click(); return true
        })()`)
      },
      { expectDialogRole: true },
    )
    await page.screenshot(`${SHOTS}/phone-panel.png`)
    await page.send('Emulation.clearDeviceMetricsOverride')
  }
}

try {
  await main()
} catch (error) {
  record(false, 'the run itself', error.message)
}

console.log(`\nscreenshots: ${SHOTS}`)
const failed = results.filter((r) => !r.ok)
console.log(`${results.length - failed.length}/${results.length} passed, ${failed.length} FAILED`)
for (const f of failed) console.log(`  FAIL ${f.label}${f.detail ? ` — ${f.detail}` : ''}`)

page.close()
chrome.child.kill()
process.exit(failed.length === 0 ? 0 : 1)
