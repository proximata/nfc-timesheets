// Keyboard + overlay accessibility audit, driven through real key events.
//
//   node demo/audit-overlays.mjs
//   AUDIT_BASE=http://127.0.0.1:8082 node demo/audit-overlays.mjs
//
// Needs the local stack from backlog/docs/DEMO.md: a seeded nfc_demo database and the API
// serving web/out. Loopback only, same guard as demo/record-admin.mjs.
//
// WHY REAL KEY EVENTS. `el.dispatchEvent(new KeyboardEvent('keydown'))` does not move focus:
// the browser's own sequential-navigation is what Tab does, and a synthetic event only runs
// the listeners. A focus trap tested with synthetic Tabs passes even when it does not trap,
// which is the exact shape of check this project has already shipped twice. So every keypress
// below goes through Input.dispatchKeyEvent, and the assertion reads document.activeElement.
//
// EVERY WAIT IS BOUNDED. page.waitFor has a 15 s default and each call here names a label, so
// a check that can never pass fails loudly instead of looking like a slow one.
import { attach, launchChrome, sleep } from './cdp.mjs'

const BASE = process.env.AUDIT_BASE ?? 'http://127.0.0.1:8082'
const host = new URL(BASE).hostname
if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(host)) {
  console.error(`audit-overlays: refusing to drive "${host}" — loopback only.`)
  process.exit(1)
}

const ADMIN = { email: 'demo@example.test', password: 'demo-nur-lokal-2026' }

const chrome = await launchChrome({ port: Number(process.env.AUDIT_PORT ?? 9402), width: 1440, height: 900 })
const page = await attach(chrome.port)

const results = []
const record = (ok, label, detail = '') => {
  results.push({ ok, label, detail })
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `  — ${detail}` : ''}`)
}

/** Real keypress. `Tab` needs rawKeyDown for the browser to run sequential navigation. */
async function key(name, { shift = false } = {}) {
  const map = {
    Tab: { windowsVirtualKeyCode: 9, code: 'Tab', key: 'Tab' },
    Escape: { windowsVirtualKeyCode: 27, code: 'Escape', key: 'Escape' },
    Enter: { windowsVirtualKeyCode: 13, code: 'Enter', key: 'Enter' },
    Space: { windowsVirtualKeyCode: 32, code: 'Space', key: ' ', text: ' ' },
  }
  const base = map[name]
  const modifiers = shift ? 8 : 0
  await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', modifiers, ...base })
  if (base.text) await page.send('Input.dispatchKeyEvent', { type: 'char', modifiers, ...base })
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers, ...base })
  await sleep(70)
}

/** A readable description of whatever currently has focus. */
const active = () =>
  page.eval(`(() => {
    const el = document.activeElement
    if (!el || el === document.body) return { tag: 'BODY', text: '', inOverlay: false }
    const label = (el.getAttribute('aria-label') || el.textContent || el.id || '').trim()
    return {
      tag: el.tagName,
      id: el.id,
      cls: el.className,
      text: label.slice(0, 60),
      inOverlay: !!el.closest('.drawer, .modal'),
      inMain: !!el.closest('#main-content'),
    }
  })()`)

const bodyLocked = () =>
  page.eval(`getComputedStyle(document.body).overflow === 'hidden' ||
             document.body.style.overflow === 'hidden'`)

/** Click a control by its visible text, and remember it so focus restoration is checkable. */
async function clickAndRemember(text, selector = 'button, a') {
  const ok = await page.eval(`(() => {
    const wanted = ${JSON.stringify(text)}
    const hit = Array.from(document.querySelectorAll(${JSON.stringify(selector)}))
      .find((el) => ((el.getAttribute('aria-label') || el.textContent || '')).includes(wanted))
    if (!hit) return false
    window.__opener = hit
    hit.focus()
    hit.click()
    return true
  })()`)
  if (!ok) throw new Error(`no control containing: ${text}`)
  await sleep(320)
}

const focusIsOpener = () =>
  page.eval(`document.activeElement === window.__opener && window.__opener.isConnected`)

async function signIn() {
  await page.goto(`${BASE}/login/`, { settle: 500 })
  await page.eval(`(() => {
    const [u, p] = document.querySelectorAll('input')
    const set = (el, v) => {
      Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, v)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }
    set(u, ${JSON.stringify(ADMIN.email)})
    set(p, ${JSON.stringify(ADMIN.password)})
    document.querySelector('form').requestSubmit()
    return true
  })()`)
  await page.waitFor(`location.pathname === '/'`, { timeout: 12000, label: 'signed in' })
}

async function settle(ms = 700) {
  await sleep(ms)
}

/**
 * The whole overlay contract for one drawer or modal, in one function so no screen gets a
 * weaker version of it than another.
 */
async function auditOverlay(label, openText, { selector = 'button, a', kind = 'drawer' } = {}) {
  const overlaySel = kind === 'drawer' ? '.drawer' : '.modal'

  await clickAndRemember(openText, selector)
  const isOpen = await page.eval(`!!document.querySelector('${overlaySel}')`)
  if (!isOpen) {
    record(false, `${label}: opens`, `no ${overlaySel} after clicking "${openText}"`)
    return
  }

  // 1. focus moved IN
  const first = await active()
  record(first.inOverlay, `${label}: focus moves into the ${kind}`, `${first.tag} "${first.text}"`)

  // 2. dialog semantics + accessible name
  const semantics = await page.eval(`(() => {
    const el = document.querySelector('${overlaySel}')
    const labelledBy = el.getAttribute('aria-labelledby')
    const named = labelledBy && document.getElementById(labelledBy)
    return {
      role: el.getAttribute('role'),
      modal: el.getAttribute('aria-modal'),
      name: named ? named.textContent.trim() : null,
      scrim: !!document.querySelector('.scrim'),
    }
  })()`)
  record(
    semantics.role === 'dialog' && semantics.modal === 'true' && !!semantics.name,
    `${label}: role=dialog aria-modal + accessible name`,
    `role=${semantics.role} modal=${semantics.modal} name=${JSON.stringify(semantics.name)}`,
  )

  // 3. body scroll locked
  record(await bodyLocked(), `${label}: body scroll locked while open`)

  // 4. Tab cycles INSIDE. Count of focusables + 3 extra Tabs: if the trap leaks, focus is
  //    outside the overlay by then. Bounded by construction, no waiting.
  const count = await page.eval(`(() => {
    const el = document.querySelector('${overlaySel}')
    const sel = 'a[href],area[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
    return [...el.querySelectorAll(sel)].filter((n) => n.getClientRects().length > 0).length
  })()`)
  let escaped = null
  for (let i = 0; i < count + 3; i++) {
    await key('Tab')
    const where = await active()
    if (!where.inOverlay) {
      escaped = { step: i + 1, ...where }
      break
    }
  }
  record(
    escaped === null,
    `${label}: Tab is trapped (${count} focusables, ${count + 3} presses)`,
    escaped === null ? '' : `escaped at press ${escaped.step} to ${escaped.tag} "${escaped.text}"`,
  )

  // 5. Shift+Tab is trapped too — a trap that only holds forwards is half a trap.
  let escapedBack = null
  for (let i = 0; i < count + 3; i++) {
    await key('Tab', { shift: true })
    const where = await active()
    if (!where.inOverlay) {
      escapedBack = { step: i + 1, ...where }
      break
    }
  }
  record(
    escapedBack === null,
    `${label}: Shift+Tab is trapped`,
    escapedBack === null ? '' : `escaped at press ${escapedBack.step} to ${escapedBack.tag}`,
  )

  // 6. Escape closes
  await key('Escape')
  await sleep(250)
  const closed = await page.eval(`!document.querySelector('${overlaySel}')`)
  record(closed, `${label}: Escape closes it`)

  // 7. focus restored to the invoking control
  if (closed) {
    record(await focusIsOpener(), `${label}: focus restored to the opener`, (await active()).text)
    record(!(await bodyLocked()), `${label}: body scroll released after close`)
  }
}

// ---------------------------------------------------------------------------------------
console.log('signing in…')
await signIn()
await settle()

console.log('\n--- global chrome ---')
{
  // The skip link has to be the FIRST tab stop and has to actually move focus.
  await page.goto(`${BASE}/`, { settle: 900 })
  await page.eval(`document.body.focus(); document.activeElement.blur()`)
  await key('Tab')
  const one = await active()
  record(
    one.cls?.includes('skip-link'),
    'skip link is the first tab stop',
    `${one.tag} "${one.text}"`,
  )
  await key('Enter')
  await sleep(200)
  const afterSkip = await active()
  record(
    afterSkip.id === 'main-content',
    'skip link moves focus to #main-content',
    `${afterSkip.tag}#${afterSkip.id}`,
  )
}

console.log('\n--- /shifts/ correction drawer ---')
await page.goto(`${BASE}/shifts/`, { settle: 1200 })
await page.waitFor(`document.querySelectorAll('table.data-table tbody tr').length > 0`, {
  timeout: 12000,
  label: 'shift rows',
})
await auditOverlay('shifts:correct', 'Korrigieren')

console.log('\n--- /shifts/ hand-entry drawer (the SECOND drawer, per the owner) ---')
await auditOverlay('shifts:create', 'Schicht nachtragen')

console.log('\n--- /workers/ drawer + confirm modal ---')
await page.goto(`${BASE}/workers/`, { settle: 1200 })
await page.waitFor(`document.querySelectorAll('table.data-table tbody tr').length > 0`, {
  timeout: 12000,
  label: 'worker rows',
})
await auditOverlay('workers:edit', 'Mitarbeiter anlegen')
await auditOverlay('workers:deactivate-confirm', 'Deaktivieren', { kind: 'modal' })

console.log('\n--- /locations/ two-step drawer ---')
await page.goto(`${BASE}/locations/`, { settle: 1400 })
await page.waitFor(`document.querySelectorAll('table.data-table tbody tr').length > 0`, {
  timeout: 12000,
  label: 'building rows',
})
await auditOverlay('locations:create', 'Objekt anlegen')

console.log('\n--- /locations/ step change: is it announced, and where does focus land? ---')
{
  await clickAndRemember('Objekt anlegen')
  const before = await active()
  await page.eval(`(() => {
    const b = [...document.querySelectorAll('.drawer footer button')]
      .find((n) => n.textContent.includes('Weiter'))
    b.focus(); b.click(); return true
  })()`)
  await sleep(320)
  const after = await active()
  const stepText = await page.eval(`(() => {
    const s = document.querySelector('.drawer .step')
    if (!s) return { text: null, live: false }
    return {
      text: s.textContent.trim(),
      live: !!s.closest('[aria-live], [role=status], [role=alert]'),
    }
  })()`)
  record(
    after.text !== before.text || after.tag !== before.tag,
    'locations: focus moves when the step changes',
    `before ${before.tag} "${before.text}" → after ${after.tag} "${after.text}"`,
  )
  record(
    stepText.live,
    'locations: the step indicator is inside a live region',
    `step="${stepText.text}" live=${stepText.live}`,
  )
  await key('Escape')
  await sleep(200)
}

console.log('\n--- every screen: labels, live regions, captions, named controls ---')
const SCREENS = [
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
]
for (const path of SCREENS) {
  await page.goto(`${BASE}${path}`, { settle: 1300 })
  const report = await page.eval(`(() => {
    const out = { path: location.pathname }
    // Every form control programmatically associated with a name.
    const controls = [...document.querySelectorAll('input, select, textarea')]
      .filter((el) => el.type !== 'hidden')
    out.unlabelled = controls.filter((el) => {
      if (el.getAttribute('aria-label')) return false
      if (el.getAttribute('aria-labelledby')) return false
      if (el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]')) return false
      return !el.closest('label')
    }).map((el) => el.tagName + (el.id ? '#' + el.id : '') + '[' + (el.type || '') + ']')

    // Icon-only / empty-name controls.
    out.namelessButtons = [...document.querySelectorAll('button, a[href]')].filter((el) => {
      const aria = (el.getAttribute('aria-label') || '').trim()
      const text = (el.textContent || '').replace(/\\s+/g, ' ').trim()
      // Strip decorative children the way a screen reader would.
      const visible = [...el.childNodes].map((n) => {
        if (n.nodeType === 3) return n.textContent
        if (n.nodeType === 1 && n.getAttribute('aria-hidden') === 'true') return ''
        return n.textContent
      }).join('').replace(/\\s+/g, ' ').trim()
      return aria === '' && visible === '' && text !== '' ? false : aria === '' && visible === ''
    }).map((el) => el.tagName + '.' + el.className)

    // Tables keep their visually-hidden caption.
    out.tablesWithoutCaption = [...document.querySelectorAll('table.data-table')]
      .filter((t) => {
        const c = t.querySelector('caption')
        return !c || c.textContent.trim() === ''
      }).length
    out.tables = document.querySelectorAll('table.data-table').length

    // A PAGE-LEVEL LIVE REGION, not literally role=alert.
    //
    // Eleven screens announce their one outcome with role=alert; /account/ announces its
    // one outcome with role=status aria-live=polite, deliberately and with the reason in
    // the source: the password form's result is the answer to a button the reader just
    // pressed with focus still on it, which is the case WAI-ARIA reserves status for.
    // alert is for something that arrives unbidden. Requiring the literal role therefore
    // failed the one screen that had thought about it hardest, and it had been failing
    // since /account/ shipped.
    //
    // The negative case is intact and is the one that matters: a screen with NO live region
    // at all, or one that only exists once there is a message to put in it, still fails.
    // The role each screen chose is printed so a change of mind is visible in the log
    // rather than silent.
    //
    // NOTE FOR THE NEXT EDITOR: this comment lives INSIDE a page.eval template literal. A
    // backtick here ends the string and the file stops parsing at import time — which is
    // exactly how this check arrived: written, never run, left unparseable.
    out.liveRegions = [...document.querySelectorAll('[role=alert], [role=status], [aria-live]')]
      .filter((el) => !el.closest('.drawer, .modal'))
    out.alertRegions = out.liveRegions.length
    out.liveRoles = out.liveRegions
      .map((el) => el.getAttribute('role') ?? 'aria-live=' + el.getAttribute('aria-live'))
      .join(',')
    out.liveRegions = out.liveRegions.length
    out.statusRegions = document.querySelectorAll('[role=status], [aria-live]').length

    // The question line under the h1.
    const h1 = document.querySelector('#main-content h1')
    out.h1 = h1 ? h1.textContent.trim() : null
    out.question = document.querySelector('.topline .question')?.textContent.trim() ?? null

    // Exactly one h1, and no heading above it inside main.
    out.h1Count = document.querySelectorAll('#main-content h1').length

    // ResponsiveTableLabels: thead cell count must equal tbody row child count, or every
    // phone card is captioned with the wrong column.
    out.labelMismatch = [...document.querySelectorAll('table.data-table')].flatMap((t) => {
      const heads = t.querySelectorAll('thead th').length
      return [...t.querySelectorAll('tbody tr')]
        .filter((r) => r.children.length !== heads)
        .slice(0, 1)
        .map((r) => heads + ' headings vs ' + r.children.length + ' cells')
    })
    return out
  })()`)

  const problems = []
  if (report.unlabelled.length) problems.push(`unlabelled: ${report.unlabelled.join(', ')}`)
  if (report.namelessButtons.length) problems.push(`nameless: ${report.namelessButtons.join(', ')}`)
  if (report.tablesWithoutCaption) problems.push(`${report.tablesWithoutCaption} table(s) w/o caption`)
  if (report.alertRegions === 0) problems.push('no page-level live region (alert or status)')
  if (report.h1Count !== 1) problems.push(`${report.h1Count} h1 in main`)
  if (report.question === null) problems.push('no question line under the h1')
  if (report.labelMismatch.length) problems.push(`card-label mismatch: ${report.labelMismatch.join('; ')}`)
  record(
    problems.length === 0,
    `${path}`,
    problems.join(' | ') ||
      `h1="${report.h1}" tables=${report.tables} live=[${report.liveRoles}]`,
  )
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed, ${failed.length} FAILED`)
for (const f of failed) console.log(`  FAIL ${f.label} — ${f.detail}`)

page.close()
chrome.child.kill()
process.exit(failed.length === 0 ? 0 : 1)
