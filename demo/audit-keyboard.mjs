// Keyboard-ONLY write journeys. No mouse, no .click(), no .focus() — every step is a real
// key event through Input.dispatchKeyEvent, so what passes here is what a person with no
// pointer can actually do.
//
//   node demo/audit-keyboard.mjs
//
// The one rule that makes this different from demo/audit-overlays.mjs: that file uses
// `hit.click()` to open drawers, which proves the overlay contract but says NOTHING about
// whether the opener is reachable by Tab in the first place. Here, if a control cannot be
// reached by tabbing, the journey fails.
//
// Journey A — /workers/: Tab to "Mitarbeiter anlegen", Enter, type a name and a rate, submit
//   with Enter, confirm the row exists. This is the write the owner does most often.
// Journey B — /locations/: the TWO-STEP drawer, where the footer button is reused across
//   steps. Pressing Enter on "Weiter" advances the step; the hazard is whether a SECOND
//   Enter — the natural next keystroke — submits the whole object early.
//
// Loopback only. Every loop bounded by a press count, never by a condition that might never
// become true.
import { attach, launchChrome, sleep } from './cdp.mjs'

const BASE = process.env.AUDIT_BASE ?? 'http://127.0.0.1:8082'
if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(new URL(BASE).hostname)) {
  console.error('audit-keyboard: loopback only.')
  process.exit(1)
}
const ADMIN = { email: 'demo@example.test', password: 'demo-nur-lokal-2026' }

const chrome = await launchChrome({ port: Number(process.env.AUDIT_PORT ?? 9406), width: 1440, height: 900 })
const page = await attach(chrome.port)

const results = []
const record = (ok, label, detail = '') => {
  results.push({ ok, label, detail })
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `  — ${detail}` : ''}`)
}

const KEYS = {
  Tab: { windowsVirtualKeyCode: 9, code: 'Tab', key: 'Tab' },
  Enter: { windowsVirtualKeyCode: 13, code: 'Enter', key: 'Enter', text: '\r' },
  Escape: { windowsVirtualKeyCode: 27, code: 'Escape', key: 'Escape' },
  Space: { windowsVirtualKeyCode: 32, code: 'Space', key: ' ', text: ' ' },
}

async function key(name, { shift = false } = {}) {
  const base = KEYS[name]
  const modifiers = shift ? 8 : 0
  // Enter must carry `text`, and must be a keyDown rather than a rawKeyDown: a form's
  // implicit submission hangs off the character event, and `rawKeyDown` has none. Sending it
  // raw makes "Enter in the password field does not submit" look like a product bug when it
  // is a harness bug — which is exactly what the first run of this file reported.
  const type = base.text ? 'keyDown' : 'rawKeyDown'
  await page.send('Input.dispatchKeyEvent', {
    type,
    modifiers,
    ...base,
    ...(base.text ? { unmodifiedText: base.text } : {}),
  })
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers, ...base })
  await sleep(80)
}

/** Types through real key events into whatever currently has focus. */
async function typeHere(text) {
  for (const ch of text) {
    await page.send('Input.insertText', { text: ch })
    await sleep(20)
  }
  await sleep(120)
}

const active = () =>
  page.eval(`(() => {
    const el = document.activeElement
    if (!el || el === document.body) return { tag: 'BODY', text: '', name: '' }
    return {
      tag: el.tagName,
      type: el.getAttribute('type') || '',
      id: el.id,
      cls: String(el.className),
      text: (el.getAttribute('aria-label') || el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 48),
      // Needed to fill a form by tabbing: which fields MUST be filled, whether they still
      // are empty, and what shape of value the field wants. inputMode is how a money field
      // is told apart from a name field without hard-coding either form's field order.
      required: el.required === true,
      value: typeof el.value === 'string' ? el.value : '',
      inputMode: el.getAttribute('inputmode') || '',
      inOverlay: !!el.closest('.drawer, .modal'),
    }
  })()`)

/**
 * Tab forward until `predicate(active)` holds. Bounded by `max` presses and REPORTS the trail
 * it walked, so "not reachable" is distinguishable from "reachable at press 61".
 */
async function tabUntil(predicate, { max = 80 } = {}) {
  const trail = []
  for (let i = 0; i < max; i++) {
    await key('Tab')
    const where = await active()
    trail.push(`${where.tag}:${where.text.slice(0, 22)}`)
    if (predicate(where)) return { found: true, presses: i + 1, where, trail }
  }
  return { found: false, presses: max, where: await active(), trail }
}

async function signIn() {
  await page.goto(`${BASE}/login/`, { settle: 500 })
  // Journey 0: sign in with the keyboard only. app/login/page.tsx:97 autoFocuses the username
  // field, so the first keystroke is already in the right place and a Tab here would land on
  // the password field instead — assert the autofocus rather than tabbing blind.
  const start = await active()
  record(
    start.tag === 'INPUT' && start.type === 'text',
    'login: the username field has focus on load (autoFocus)',
    `${start.tag}[type=${start.type}]`,
  )
  await typeHere(ADMIN.email)
  await key('Tab')
  await typeHere(ADMIN.password)
  await key('Enter')
  let ok = true
  try {
    await page.waitFor(`location.pathname === '/'`, { timeout: 12000, label: 'signed in' })
  } catch {
    ok = false
  }
  record(ok, 'login: Enter in the password field submits the form')
  if (!ok) throw new Error('cannot continue without a session')
}

// ------------------------------------------------------------------ Journey A: /workers/
async function journeyWorkers() {
  console.log('\n--- Journey A: create a worker, keyboard only ---')
  const name = `KB Prüfer ${Date.now().toString().slice(-6)}`
  await page.goto(`${BASE}/workers/`, { settle: 1400 })
  await page.waitFor(`document.querySelectorAll('table.data-table tbody tr').length > 0`, {
    timeout: 12000,
    label: 'worker rows',
  })
  await page.eval(`(document.activeElement || document.body).blur()`)

  const opener = await tabUntil((w) => w.text.includes('Mitarbeiter anlegen'))
  record(
    opener.found,
    'workers: "Mitarbeiter anlegen" is reachable by Tab',
    opener.found ? `${opener.presses} press(es)` : `not found in 80 presses; last=${opener.where.text}`,
  )
  if (!opener.found) return

  await key('Enter')
  await sleep(400)
  const isOpen = await page.eval(`!!document.querySelector('.drawer')`)
  record(isOpen, 'workers: Enter on the opener opens the drawer')
  if (!isOpen) return

  // Fill by tabbing from wherever focus landed to the first text input.
  const firstField = await tabUntil((w) => w.tag === 'INPUT' && w.inOverlay, { max: 12 })
  record(firstField.found, 'workers: the first field is reachable by Tab inside the drawer')
  if (!firstField.found) return
  await typeHere(name)

  // EVERY REQUIRED FIELD, filled by tabbing to it. Not just the name: since decision-41 the
  // hourly rate is required too, and a journey that only fills the name stops testing
  // "Enter on submit saves" and starts testing "the form refuses an empty rate" — which is
  // a real behaviour, but it is the OTHER one, and it is asserted below.
  for (let i = 0; i < 6; i++) {
    const empty = await tabUntil(
      (w) => w.inOverlay && w.tag === 'INPUT' && w.required && w.value === '',
      { max: 12 },
    )
    if (!empty.found) break
    // A rate is a rate, a name is a name: type something the field's own validator accepts.
    await typeHere(empty.where.type === 'text' && empty.where.inputMode === 'decimal' ? '14,50' : `KB ${i}`)
  }

  const filled = await page.eval(`(() => {
    const out = []
    for (const el of document.querySelectorAll('.drawer input')) {
      if (el.type === 'checkbox' || el.type === 'hidden') continue
      out.push({ type: el.type, id: el.id, value: el.value, required: el.required })
    }
    return out
  })()`)
  console.log(`       drawer fields: ${JSON.stringify(filled)}`)
  const stillEmpty = filled.filter((f) => f.required && f.value === '')
  record(
    stillEmpty.length === 0,
    'workers: every required field was reachable and filled by Tab alone',
    `${filled.filter((f) => f.required).length} required, ${stillEmpty.length} still empty`,
  )

  const submit = await tabUntil((w) => w.inOverlay && w.type === 'submit', { max: 20 })
  record(submit.found, 'workers: the submit button is reachable by Tab', submit.where.text)
  if (!submit.found) return
  await key('Enter')

  let saved = true
  try {
    await page.waitFor(`!document.querySelector('.drawer')`, {
      timeout: 15000,
      label: 'worker drawer closed after save',
    })
  } catch {
    saved = false
  }
  record(
    saved,
    'workers: Enter on submit saves and closes the drawer',
    saved ? '' : await page.eval(`(document.querySelector('.drawer .form-error')?.textContent ?? '(no error shown)').trim()`),
  )

  if (saved) {
    const present = await page.eval(
      `document.body.textContent.includes(${JSON.stringify(name)})`,
    )
    record(present, 'workers: the new worker appears in the list', name)
    const announced = await page.eval(`(() => {
      const r = [...document.querySelectorAll('[role=status], [role=alert]')]
        .map((n) => n.textContent.trim()).filter(Boolean)
      return r
    })()`)
    record(
      announced.length > 0,
      'workers: the outcome is announced in a page-level live region',
      JSON.stringify(announced),
    )
  }
}

// ------------------------------------------------- Journey B: /locations/ two-step + Enter
async function journeyLocationsDoubleEnter() {
  console.log('\n--- Journey B: /locations/ two-step drawer, the double-Enter hazard ---')
  await page.goto(`${BASE}/locations/`, { settle: 1500 })
  await page.waitFor(`document.querySelectorAll('table.data-table tbody tr').length > 0`, {
    timeout: 12000,
    label: 'building rows',
  })
  await page.eval(`(document.activeElement || document.body).blur()`)

  const opener = await tabUntil((w) => w.text.includes('Objekt anlegen'))
  record(opener.found, 'locations: "Objekt anlegen" is reachable by Tab', `${opener.presses} press(es)`)
  if (!opener.found) return
  await key('Enter')
  await sleep(450)
  if (!(await page.eval(`!!document.querySelector('.drawer')`))) {
    record(false, 'locations: Enter opens the drawer')
    return
  }

  // Fill step 1 the way a person does: tab to the first field, type, tab, type.
  const f1 = await tabUntil((w) => w.tag === 'INPUT' && w.inOverlay, { max: 12 })
  if (!f1.found) {
    record(false, 'locations: step-1 first field reachable by Tab')
    return
  }
  const slug = `kbaudit${Date.now().toString().slice(-6)}`
  await typeHere('KB Audit Objekt')
  await key('Tab')
  await typeHere(slug)

  const weiter = await tabUntil((w) => w.inOverlay && w.text.includes('Weiter'), { max: 20 })
  record(weiter.found, 'locations: the "Weiter" button is reachable by Tab', weiter.where.text)
  if (!weiter.found) return

  const before = await page.eval(`(() => {
    window.__weiter = document.activeElement
    return {
      step: document.querySelector('.drawer .step')?.textContent.trim() ?? null,
      label: document.activeElement.textContent.replace(/\\s+/g, ' ').trim(),
      type: document.activeElement.getAttribute('type'),
    }
  })()`)

  await key('Enter')
  await sleep(450)
  const mid = await page.eval(`(() => {
    const a = document.activeElement
    return {
      step: document.querySelector('.drawer .step')?.textContent.trim() ?? null,
      sameNode: a === window.__weiter,
      label: (a.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 40),
      type: a.getAttribute('type'),
      stillOpen: !!document.querySelector('.drawer'),
    }
  })()`)
  record(mid.step !== before.step, 'locations: Enter on "Weiter" advances the step', `${before.step} → ${mid.step}`)
  console.log(
    `       the focused button was "${before.label}" (type=${before.type}) and is now ` +
      `"${mid.label}" (type=${mid.type}), sameNode=${mid.sameNode}`,
  )

  // THE HAZARD. The second Enter is the most natural keystroke in the world here, and if the
  // same button node is still focused it now means "save", not "next".
  await key('Enter')
  await sleep(900)
  const after = await page.eval(`(() => ({
    stillOpen: !!document.querySelector('.drawer'),
    step: document.querySelector('.drawer .step')?.textContent.trim() ?? null,
  }))()`)
  const created = await page.eval(`document.body.textContent.includes(${JSON.stringify(slug)}) ||
    document.body.textContent.includes('KB Audit Objekt')`)
  record(
    !(after.stillOpen === false && created),
    'locations: a SECOND Enter after "Weiter" does not silently save the object',
    `drawer open=${after.stillOpen} step=${after.step} object in list=${created}`,
  )

  // Clean up whatever this created, and leave the drawer shut either way.
  await key('Escape')
  await sleep(250)
  return { slug }
}

try {
  await signIn()
  await journeyWorkers()
  await journeyLocationsDoubleEnter()
} catch (error) {
  record(false, 'journey aborted', error.message)
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed, ${failed.length} FAILED`)
for (const f of failed) console.log(`  FAIL ${f.label} — ${f.detail}`)

page.close()
chrome.child.kill()
process.exit(failed.length === 0 ? 0 : 1)
