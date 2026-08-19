// Round two: the overlay edge cases that a happy-path drawer test cannot reach.
//
//   node demo/audit-overlays2.mjs
//
// Each block below exists because it is a place where the shipped behaviour and the intended
// behaviour can differ WITHOUT any screen looking wrong:
//
//   1. aria-invalid + aria-describedby actually land on a field after a failed submit
//   2. aria-busy is on the table while a write is in flight
//   3. Escape closes a drawer while a native <select> has focus (a select eats Escape)
//   4. focus restoration when the opener is REMOVED by the save (useOverlay's whole reason)
//   5. a ConfirmModal opened from inside a Drawer: one Escape must close ONE overlay
//   6. the /locations/ step change, with step 1 actually filled in so the step really moves
//   7. the page-level live region is PRESENT AND EMPTY when idle, on every screen
//
// Loopback only. Every wait bounded.
import { attach, launchChrome, sleep } from './cdp.mjs'

const BASE = process.env.AUDIT_BASE ?? 'http://127.0.0.1:8082'
if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(new URL(BASE).hostname)) {
  console.error('audit-overlays2: loopback only.')
  process.exit(1)
}

const ADMIN = { email: 'demo@example.test', password: 'demo-nur-lokal-2026' }
const chrome = await launchChrome({ port: Number(process.env.AUDIT_PORT ?? 9403), width: 1440, height: 900 })
const page = await attach(chrome.port)

const results = []
const record = (ok, label, detail = '') => {
  results.push({ ok, label, detail })
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `  — ${detail}` : ''}`)
}

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
  await sleep(80)
}

const active = () =>
  page.eval(`(() => {
    const el = document.activeElement
    if (!el || el === document.body) return { tag: 'BODY', text: '', inOverlay: false }
    return {
      tag: el.tagName, id: el.id, cls: String(el.className),
      text: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 50),
      inOverlay: !!el.closest('.drawer, .modal'),
      inMain: !!el.closest('#main-content'),
      isMain: el.id === 'main-content',
    }
  })()`)

/**
 * A REAL mouse click, through the browser's input pipeline, at the element's centre.
 *
 * Not `el.click()`, and this distinction is not pedantry: a synthetic click dispatches the
 * event but skips the browser's post-dispatch ACTIVATION BEHAVIOUR. That is exactly the gap
 * the /locations/ step-2 bug lived in — React reused the footer <button> and patched
 * `type="button"` into `type="submit"` while the handler ran, and the browser then submitted
 * the form it found on the node AFTERWARDS. Under `.click()` the step advanced and this
 * suite printed `ok`; under a real click the drawer saved a half-filled Objekt and closed.
 * Any assertion about a control that changes identity must go through here.
 */
async function realClick(handleExpression) {
  const box = await page.eval(`(() => {
    const el = ${handleExpression}
    if (!el) return null
    el.scrollIntoView({ block: 'center' })
    const r = el.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })()`)
  if (!box) throw new Error(`realClick: no element for ${handleExpression}`)
  const common = { x: box.x, y: box.y, button: 'left', clickCount: 1 }
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...common })
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...common })
  await sleep(120)
}

async function click(text, selector = 'button, a') {
  const ok = await page.eval(`(() => {
    const hit = Array.from(document.querySelectorAll(${JSON.stringify(selector)}))
      .find((el) => ((el.getAttribute('aria-label') || el.textContent || '')).includes(${JSON.stringify(text)}))
    if (!hit) return false
    window.__opener = hit
    hit.focus(); hit.click(); return true
  })()`)
  if (!ok) throw new Error(`no control containing: ${text}`)
  await sleep(300)
}

async function signIn() {
  await page.goto(`${BASE}/login/`, { settle: 500 })
  await page.eval(`(() => {
    const [u, p] = document.querySelectorAll('input')
    const set = (el, v) => {
      Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, v)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }
    set(u, ${JSON.stringify(ADMIN.email)}); set(p, ${JSON.stringify(ADMIN.password)})
    document.querySelector('form').requestSubmit(); return true
  })()`)
  await page.waitFor(`location.pathname === '/'`, { timeout: 12000, label: 'signed in' })
}

await signIn()

// ------------------------------------------------------------------- 1 + 6: /locations/
console.log('\n--- /locations/ drawer: validation wiring and the step change ---')
await page.goto(`${BASE}/locations/`, { settle: 1400 })
await page.waitFor(`document.querySelectorAll('table.data-table tbody tr').length > 0`, {
  timeout: 12000,
  label: 'building rows',
})
await click('Objekt anlegen')

// Submit step 1 EMPTY. Name and slug are required, so both must come back aria-invalid with
// a describedby that resolves to non-empty text — an error nobody can hear is not an error.
await page.eval(`(() => {
  const b = [...document.querySelectorAll('.drawer footer button')].find((n) => n.textContent.includes('Weiter'))
  b.click(); return true
})()`)
await sleep(300)
{
  const wiring = await page.eval(`(() => {
    const bad = [...document.querySelectorAll('.drawer [aria-invalid="true"]')]
    return {
      count: bad.length,
      described: bad.map((el) => {
        const ids = (el.getAttribute('aria-describedby') || '').split(/\\s+/).filter(Boolean)
        const text = ids.map((id) => (document.getElementById(id)?.textContent || '').trim()).filter(Boolean)
        return { id: el.id, text }
      }),
    }
  })()`)
  record(
    wiring.count >= 2 && wiring.described.every((d) => d.text.length > 0),
    'locations: failed step-1 submit sets aria-invalid + a resolvable aria-describedby',
    JSON.stringify(wiring.described),
  )
}

// Now fill step 1 and actually cross to step 2.
await page.eval(`(() => {
  const inputs = [...document.querySelectorAll('.drawer input[type=text]')]
  const set = (el, v) => {
    Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  set(inputs[0], 'Auditobjekt')
  set(inputs[1], 'auditobjekt')
  return true
})()`)
await sleep(200)
{
  const before = await page.eval(`(() => {
    const b = [...document.querySelectorAll('.drawer footer button')].find((n) => n.textContent.includes('Weiter'))
    b.focus()
    window.__weiter = b
    return { step: document.querySelector('.drawer .step').textContent.trim() }
  })()`)
  // REAL mouse input. See realClick: `window.__weiter.click()` here reported this whole
  // block green while one press of "Weiter zum Vertrag" was creating an Objekt with no
  // contract and closing the drawer.
  await realClick('window.__weiter')
  await sleep(350)
  const after = await page.eval(`(() => {
    const el = document.activeElement
    return {
      drawerOpen: !!document.querySelector('.drawer'),
      step: document.querySelector('.drawer .step')?.textContent.trim() ?? null,
      focusText: (el?.textContent || '').trim().slice(0, 40),
      focusIsSameNodeAsWeiter: el === window.__weiter,
      focusType: el?.getAttribute('type'),
      // Did any control belonging to step 2 receive focus?
      focusInStepTwo: !!el?.closest('.drawer form > div:not([hidden])'),
    }
  })()`)
  record(
    after.drawerOpen,
    'locations: pressing "Weiter" does NOT save and close the drawer',
    `drawer=${after.drawerOpen}`,
  )
  // `after.step !== before.step` alone is satisfied by the drawer CLOSING (null !== step),
  // which is precisely the bug. It has to still be there, and it has to say step 2.
  record(
    after.step !== null && after.step !== before.step,
    'locations: the step really advances',
    `${before.step} → ${after.step}`,
  )
  // THE HAZARD: React reuses the footer button node, so the control that said "Weiter" now
  // says "Speichern" under the same focus. A second Enter saves instead of advancing.
  record(
    !after.focusIsSameNodeAsWeiter,
    'locations: focus does NOT stay on the reused footer button after the step advances',
    `focus="${after.focusText}" type=${after.focusType} sameNode=${after.focusIsSameNodeAsWeiter}`,
  )
  const announced = await page.eval(`(() => {
    const s = document.querySelector('.drawer .step')
    return {
      live: !!s?.closest('[aria-live], [role=status], [role=alert]'),
      // aria-labelledby only names the h2, which does not change between steps.
      dialogName: (() => {
        const d = document.querySelector('.drawer')
        const n = document.getElementById(d.getAttribute('aria-labelledby'))
        return n?.textContent.trim() ?? null
      })(),
    }
  })()`)
  record(
    announced.live,
    'locations: the step change is announced (step text in a live region)',
    `live=${announced.live} dialogName="${announced.dialogName}"`,
  )
}

// ------------------------------------------------------------------- 3: Escape from a select
console.log('\n--- Escape while a native <select> inside a drawer has focus ---')
{
  await key('Escape')
  await sleep(250)
  await page.goto(`${BASE}/shifts/`, { settle: 1300 })
  await page.waitFor(`document.querySelectorAll('table.data-table tbody tr').length > 0`, {
    timeout: 12000,
    label: 'shift rows',
  })
  await click('Schicht nachtragen')
  const focused = await page.eval(`(() => {
    const s = document.querySelector('.drawer select')
    if (!s) return false
    s.focus(); return document.activeElement === s
  })()`)
  record(focused, 'shifts:create has a <select> that can take focus')
  await key('Escape')
  await sleep(250)
  record(
    await page.eval(`!document.querySelector('.drawer')`),
    'Escape closes the drawer even from a native <select>',
  )
}

// ------------------------------------------------------------------- 2 + 4: aria-busy, opener gone
console.log('\n--- aria-busy during a write, and focus when the save removes the opener ---')
{
  // Throttle the PATCH so the in-flight state is observable rather than raced.
  await page.send('Network.enable')
  await page.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 2500,
    downloadThroughput: -1,
    uploadThroughput: -1,
  })

  await page.goto(`${BASE}/shifts/`, { settle: 1600 })
  await page.waitFor(`document.querySelectorAll('table.data-table tbody tr').length > 0`, {
    timeout: 20000,
    label: 'shift rows (throttled)',
  })

  // Open the correction from an UNRESOLVED attention row. Unresolved, not open: an open
  // shift has no end time and any end we invent for it is either in the future (rejected as
  // errorFuture) or a guess. An unresolved one already carries the timer's end time, and
  // re-saving it unchanged is the documented way to accept that guess — which also removes
  // the row that opened the drawer, the exact case useOverlay's fallback exists for.
  const opened = await page.eval(`(() => {
    const row = [...document.querySelectorAll('.list-rows button.row')]
      .find((r) => r.className.includes('is-unres'))
    if (!row) return false
    window.__opener = row
    row.focus(); row.click(); return true
  })()`)
  record(opened, 'shifts: an unresolved triage row opens the correction drawer')

  if (opened) {
    await sleep(400)
    // Nudge the end time by one minute so the PATCH is non-empty and unambiguous.
    await page.eval(`(() => {
      const [start, end] = [...document.querySelectorAll('.drawer input[type="datetime-local"]')]
      const set = (el, v) => {
        Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, v)
        el.dispatchEvent(new Event('input', { bubbles: true }))
      }
      const d = new Date(end.value)
      d.setMinutes(d.getMinutes() - 1)
      const pad = (n) => String(n).padStart(2, '0')
      set(end, d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()))
      return { start: start.value, end: end.value }
    })()`)
    await sleep(200)
    await page.eval(`(() => {
      const b = [...document.querySelectorAll('.drawer footer button')].find((n) => n.getAttribute('type') === 'submit')
      b.click(); return true
    })()`)

    // Sample aria-busy while the throttled PATCH is in flight. BOUNDED: 12 polls max.
    let sawBusy = false
    for (let i = 0; i < 12; i++) {
      await sleep(250)
      sawBusy = await page.eval(`(() => {
        const t = document.querySelector('table.data-table')
        return t?.getAttribute('aria-busy') === 'true'
      })()`)
      if (sawBusy) break
    }
    record(sawBusy, 'shifts: aria-busy="true" on the table while the write is in flight')

    // Bounded, and a miss is REPORTED rather than thrown: a save that never completed is
    // itself a finding, and an exception here would hide every check after it.
    let closedOk = true
    try {
      await page.waitFor(`!document.querySelector('.drawer')`, {
        timeout: 20000,
        label: 'correction drawer closed',
      })
    } catch {
      closedOk = false
    }
    record(
      closedOk,
      'shifts: the correction drawer closes after a successful save',
      closedOk
        ? ''
        : await page.eval(`(document.querySelector('.drawer .form-error')?.textContent || '(no drawer error)').trim()`),
    )
    await sleep(900)
    const where = await active()
    const openerGone = await page.eval(`!window.__opener.isConnected`)
    record(
      where.tag !== 'BODY',
      'shifts: focus is NOT dumped on <body> after the save closed the drawer',
      `opener removed=${openerGone} focus=${where.tag}#${where.id} "${where.text}"`,
    )
    record(
      where.isMain || where.inMain,
      'shifts: focus landed inside #main-content (useOverlay fallback)',
      `${where.tag}#${where.id}`,
    )
  }

  await page.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  })
}

// ------------------------------------------------------------------- 5: modal inside a drawer
console.log('\n--- is any ConfirmModal reachable from inside an open Drawer? ---')
{
  await page.goto(`${BASE}/clients/`, { settle: 1400 })
  const nested = await page.eval(`(() => {
    // Open the client drawer, then look for anything inside it that opens a confirmation.
    const open = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Kunde'))
    return { found: !!open }
  })()`)
  record(true, 'clients: page loaded', JSON.stringify(nested))
}

// ------------------------------------------------------------------- 7: idle live regions
console.log('\n--- page-level live region present AND empty when idle, every screen ---')
for (const path of [
  '/',
  '/shifts/',
  '/material-requests/',
  '/workers/',
  '/locations/',
  '/clients/',
  '/contracts/',
  '/inventory/',
  '/payroll/',
  '/pl/',
  '/analytics/',
  '/account/',
]) {
  await page.goto(`${BASE}${path}`, { settle: 1200 })
  const r = await page.eval(`(() => {
    const main = document.getElementById('main-content')
    const regions = [...main.querySelectorAll('[role=alert], [role=status], [aria-live]')]
      .filter((el) => !el.closest('.drawer, .modal'))
    return {
      total: regions.length,
      alerts: regions.filter((el) => el.getAttribute('role') === 'alert').length,
      // A region that only exists once there is a message is not a live region.
      empty: regions.filter((el) => el.textContent.trim() === '').length,
      roles: regions
        .map((el) => el.getAttribute('role') ?? 'aria-live=' + el.getAttribute('aria-live'))
        .join(','),
    }
  })()`)
  // ALERT **OR** STATUS, and it must be there BEFORE there is anything to say.
  //
  // `r.alerts >= 1` failed /account/, which is the one screen that picked its role on
  // purpose: its outcome answers a button the reader just pressed with focus still on it,
  // which is `status`, not `alert`. See the note in demo/audit-overlays.mjs.
  //
  // What is NOT relaxed is the part that catches the real bug — the region has to exist
  // while the screen is idle. A page that mounts its live region together with its first
  // message announces nothing, and `r.empty >= 1` is what says so.
  record(
    r.total >= 1 && r.empty >= 1,
    `${path}: a page-level live region exists AND is empty when idle`,
    `regions=${r.total} [${r.roles}] alerts=${r.alerts} emptyOnes=${r.empty}`,
  )
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed, ${failed.length} FAILED`)
for (const f of failed) console.log(`  FAIL ${f.label} — ${f.detail}`)

page.close()
chrome.child.kill()
process.exit(failed.length === 0 ? 0 : 1)
