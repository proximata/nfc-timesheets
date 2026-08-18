// The runnable check for batch "materials-account-login" of the admin redesign.
//
//   node demo/check-materials-account-login.mjs
//   DEMO_BASE=http://127.0.0.1:8091 node demo/check-materials-account-login.mjs
//
// It drives a BUILT static export served by the demo API (loopback only, nfc_demo only) and
// writes screenshots into /tmp/ts-demo/materials-account-login for a human to LOOK at.
// Every layout assertion this project ever wrote stayed green through a bug a human spotted
// in two seconds, so the screenshots are not decoration — they are half the check.
//
// WHAT ROTS SILENTLY HERE, in order of how expensive it is:
//
//   1. THE LOGIN FIELD BECOMING type="email". The admin identity is a USERNAME (`schimmer`
//      on the live box). A browser that validates it as an address refuses to submit and
//      the client is locked out of their own panel by a message we did not write. Caught as
//      a near-miss once already this week.
//   2. THE USER-EXISTS ORACLE. One message for every rejected credential. Two friendlier
//      messages is an enumeration probe, and it reads like an improvement.
//   3. A "Details" BUTTON ON A REFUSED REQUEST. The server 409s every edit of a rejected
//      request, cost included, so that button can only ever fail. Nothing on screen says so
//      unless the row is asked.
//   4. CARD CAPTIONS ON A PHONE. ResponsiveTableLabels captions by CELL POSITION, so a
//      column inserted or a leading <th> dropped captions a timestamp "Kosten" — readable,
//      and false. Both probes run: the count probe (weak) and the text probe (the real one).
//
// Bounded throughout: every wait has a timeout and the run has a deadline. A check that
// blocks forever is not a slow test, it is a test that cannot fail and looks like progress.
//
// No new dependency: demo/cdp.mjs, Node, and the Chrome already on the machine.
import { mkdirSync } from 'node:fs'
import { attach, launchChrome, sleep } from './cdp.mjs'

const BASE = process.env.DEMO_BASE ?? 'http://127.0.0.1:8091'
const SHOTS = '/tmp/ts-demo/materials-account-login'
const DEADLINE_MS = 5 * 60 * 1000

const ADMIN = { email: 'demo@example.test', password: 'demo-nur-lokal-2026' }

// Never the live server. A hostname check, not a comment.
const host = new URL(BASE).hostname
if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(host)) {
  console.error(`check-materials: refusing to run against "${host}" — loopback only.`)
  process.exit(1)
}

const failures = []
const notes = []
function assert(name, condition, detail = '') {
  if (condition) console.log(`  ok   ${name}${detail ? `  ${detail}` : ''}`)
  else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
    console.log(`  FAIL ${name}${detail ? `\n         ${detail}` : ''}`)
  }
}

const KEYS = {
  Escape: { windowsVirtualKeyCode: 27, key: 'Escape', code: 'Escape' },
  Tab: { windowsVirtualKeyCode: 9, key: 'Tab', code: 'Tab' },
}

async function press(page, name, { shift = false } = {}) {
  const k = KEYS[name]
  const modifiers = shift ? 8 : 0
  await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...k, modifiers })
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', ...k, modifiers })
  await sleep(60)
}

/** Resize, and PROVE the resize took — `mobile:true` silently hands this page 1304px. */
async function setViewport(page, width, height) {
  await page.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await sleep(250)
  const actual = await page.eval('window.innerWidth')
  if (actual !== width) {
    throw new Error(`viewport override did not take: asked for ${width}px, got ${actual}px`)
  }
}

const WHERE_FOCUS = `(() => {
  const a = document.activeElement
  if (!a) return 'null'
  return [a.tagName, a.id ? '#' + a.id : '', a.className ? '.' + String(a.className).split(' ').join('.') : ''].join('')
})()`

/** count = the probe that stayed green through the bug. text = the probe that catches it. */
const CAPTION_PROBE = `(() => {
  const out = { count: 0, cells: 0, mismatches: [], tables: 0 }
  for (const table of document.querySelectorAll('table.data-table')) {
    const headings = [...table.querySelectorAll('thead th')].map((th) => (th.textContent || '').trim())
    if (headings.length === 0) continue
    out.tables++
    for (const row of table.querySelectorAll('tbody tr')) {
      const cells = [...row.children]
      cells.forEach((cell, i) => {
        if (cell.tagName !== 'TD') return
        out.cells++
        const label = cell.getAttribute('data-label')
        if (label === null) return
        out.count++
        if (label !== headings[i]) {
          out.mismatches.push(
            'row "' + (row.querySelector('th')?.textContent || '?').trim().slice(0, 30) + '" col ' + i +
            ': labelled "' + label + '" but the header there is "' + headings[i] + '"'
          )
        }
      })
    }
  }
  return out
})()`

/** Per-row shape of the queue: which controls each lifecycle stage offers. */
const ROW_PROBE = `(() => {
  const rows = [...document.querySelectorAll('table.data-table tbody tr')]
  return rows.map((row) => {
    const cell = row.querySelector('td.cell-actions')
    const buttons = [...(cell?.querySelectorAll('button') ?? [])]
    return {
      who: (row.querySelector('th')?.textContent || '').trim().slice(0, 24),
      cls: row.className,
      badge: (row.querySelector('.badge')?.textContent || '').trim(),
      strike: getComputedStyle(row.querySelector('.badge')).textDecorationLine,
      primary: buttons.filter((b) => b.classList.contains('btn-primary')).length,
      quiet: buttons.filter((b) => b.classList.contains('btn-quiet')).length,
      labels: buttons.map((b) => b.textContent.trim()),
      rule: getComputedStyle(row.children[0]).borderLeftColor,
      ruleWidth: getComputedStyle(row.children[0]).borderLeftWidth,
    }
  })
})()`

async function signIn(page) {
  await page.goto(`${BASE}/login/`, { settle: 700 })
  await page.type('input[name="email"]', ADMIN.email, { perChar: 0 })
  await page.type('input[name="password"]', ADMIN.password, { perChar: 0 })
  await page.clickText('Anmelden', { selector: 'form button[type="submit"]' })
  await page.waitFor(`location.pathname === '/'`, { timeout: 15000, label: 'the dashboard' })
}

async function setTheme(page, theme) {
  await page.eval(`localStorage.setItem('nfcts.theme', '${theme}')`)
}

async function main() {
  mkdirSync(SHOTS, { recursive: true })
  const port0 = 9600 + (process.pid % 300)
  const { child, port } = await launchChrome({ port: port0, width: 1680, height: 1200 })
  const page = await attach(port)

  try {
    // =====================================================================================
    // 1. /login/ — the first screen the new client sees, and the two things that must not
    //    regress. The failures run BEFORE the successful sign-in: the server locks out
    //    after 5 consecutive failures, so this spends exactly 2 of them.
    // =====================================================================================
    await page.goto(`${BASE}/login/`, { settle: 800 })

    const field = await page.eval(`(() => {
      const el = document.querySelector('form input[name="email"]')
      return { type: el.getAttribute('type'), auto: el.getAttribute('autocomplete'),
               label: document.querySelector('label[for="' + el.id + '"]')?.textContent.trim(),
               focused: document.activeElement === el }
    })()`)
    assert(
      'login: the identity field is type="text" + autocomplete="username", NEVER type="email"',
      field.type === 'text' && field.auto === 'username',
      JSON.stringify(field),
    )
    assert('login: autofocus still lands in the identity field', field.focused === true)
    assert(
      'login: the field is labelled as a username, not an address',
      field.label === 'Benutzername',
      `label "${field.label}"`,
    )

    const say = async (email, password) => {
      await page.eval(`(() => {
        for (const el of document.querySelectorAll('form input')) {
          const set = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set
          set.call(el, '')
          el.dispatchEvent(new Event('input', { bubbles: true }))
        }
      })()`)
      await page.type('input[name="email"]', email, { perChar: 0 })
      await page.type('input[name="password"]', password, { perChar: 0 })
      await page.clickText('Anmelden', { selector: 'form button[type="submit"]' })
      await page.waitFor(`document.querySelector('.form-error')?.textContent.trim().length > 0`, {
        timeout: 10000,
        label: `the failure message for ${email}`,
      })
      return page.eval(`document.querySelector('.form-error').textContent.trim()`)
    }

    const wrongPassword = await say(ADMIN.email, 'definitely-not-the-password')
    await page.screenshot(`${SHOTS}/login-dark-error.png`)
    const unknownUser = await say('nobody@example.invalid', 'definitely-not-the-password')
    assert(
      'login: ONE message for every rejected credential — no user-exists oracle',
      wrongPassword === unknownUser && wrongPassword.length > 0,
      `"${wrongPassword}" vs "${unknownUser}"`,
    )
    assert(
      'login: the error region is announced (role=alert) and was already in the DOM',
      (await page.eval(`document.querySelector('.form-error').getAttribute('role')`)) === 'alert',
    )
    notes.push(`login failure message: "${wrongPassword}"`)

    for (const [theme, width, height, name] of [
      ['dark', 1680, 1200, 'login-dark-1680'],
      ['light', 1680, 1200, 'login-light-1680'],
      ['dark', 390, 844, 'login-dark-390'],
      ['light', 390, 844, 'login-light-390'],
    ]) {
      await setTheme(page, theme)
      await setViewport(page, width, height)
      await page.goto(`${BASE}/login/`, { settle: 600 })
      const scroll = await page.eval(
        `({ w: document.documentElement.scrollWidth, v: window.innerWidth })`,
      )
      assert(
        `layout[${name}]: no horizontal page scroll`,
        scroll.w <= scroll.v + 1,
        JSON.stringify(scroll),
      )
      await page.screenshot(`${SHOTS}/${name}.png`)
    }

    // =====================================================================================
    // 2. sign in, then /material-requests/
    // =====================================================================================
    await setTheme(page, 'dark')
    await setViewport(page, 1680, 1200)
    await signIn(page)

    await page.goto(`${BASE}/material-requests/`, { settle: 1200 })
    await page.waitFor(`document.querySelector('table.data-table tbody tr')`, {
      timeout: 15000,
      label: 'the material queue',
    })

    const head = await page.eval(`(() => ({
      h1: document.querySelector('h1')?.textContent.trim(),
      question: document.querySelector('.question')?.textContent.trim(),
      answers: [...document.querySelectorAll('.answer .cell')].map((c) => c.querySelector('.k').textContent.trim() + '=' + c.querySelector('.v').textContent.trim()),
      answerRole: document.querySelector('.answer')?.getAttribute('role'),
      liveRegions: [...document.querySelectorAll('[role=status], [role=alert]')].length,
      standing: [...document.querySelectorAll('.triage-list li')].map((li) => li.textContent.trim().slice(0, 28)),
      openForms: document.querySelectorAll('main form').length,
    }))()`)
    assert(
      'materials: the screen states its question under the h1',
      (head.question ?? '').length > 10,
      head.question,
    )
    assert(
      'materials: the answer band leads with the three waiting counts',
      head.answers.length === 3,
      JSON.stringify(head.answers),
    )
    assert(
      'materials: the band is a live region (it replaced .page-summary role=status)',
      head.answerRole === 'status',
    )
    assert(
      'materials: NO permanently-open form is mounted — every write is in the drawer',
      head.openForms === 0,
      `${head.openForms} form(s) on the page`,
    )
    assert(
      'materials: all three standing facts survive (polling, attribution, unpriced)',
      head.standing.length === 3,
      JSON.stringify(head.standing),
    )
    notes.push(`answer band: ${head.answers.join(' · ')}`)

    const rows = await page.eval(ROW_PROBE)
    notes.push(`queue rows (open filter): ${rows.length}`)
    assert(
      'materials: at most ONE forward action per row — never a dropdown of every status',
      rows.every((r) => r.primary <= 1),
      JSON.stringify(rows.map((r) => [r.who, r.primary])),
    )
    assert(
      'materials: the 3px state rule PAINTS on the first cell of every stateful row',
      rows.every((r) => r.ruleWidth === '3px') &&
        rows.some((r) => r.cls.includes('is-unres') && r.rule !== 'rgba(0, 0, 0, 0)'),
      JSON.stringify(rows.map((r) => [r.cls, r.rule])),
    )
    const unres = rows.find((r) => r.cls.includes('is-unres'))
    const open = rows.find((r) => r.cls.includes('is-open'))
    assert(
      'materials: waiting-on-you and in-flight are different rules AND different words',
      unres && open && unres.rule !== open.rule && unres.badge !== open.badge,
      JSON.stringify({
        unres: unres && [unres.badge, unres.rule],
        open: open && [open.badge, open.rule],
      }),
    )
    await page.screenshot(`${SHOTS}/materials-dark-1680.png`)
    await page.scrollTo('.list:last-of-type', { pause: 600 })
    await page.screenshot(`${SHOTS}/materials-dark-1680-bottom.png`)

    // ---- the refused row: terminal, and no control that could only fail ------------------
    const switched = await page.eval(`(() => {
      const el = document.querySelector('.toolbar-field select')
      if (!el) return false
      const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set
      set.call(el, 'all')
      el.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    })()`)
    assert('materials: the open/all filter is on the page and switches', switched === true)
    await sleep(500)
    const all = await page.eval(ROW_PROBE)
    const refused = all.filter(
      (r) => r.cls.includes('is-muted') && r.strike.includes('line-through'),
    )
    assert(
      'materials: the history contains a refused row (otherwise the two checks below are vacuous)',
      refused.length > 0,
      `${all.length} rows, ${refused.length} refused`,
    )
    assert(
      'materials: a refused request offers NO edit control — the server 409s every edit of one',
      refused.every((r) => r.labels.length === 0),
      JSON.stringify(refused.map((r) => [r.who, r.labels])),
    )
    assert(
      'materials: refused keeps the line-through — the signal that survives greyscale',
      refused.every((r) => r.strike.includes('line-through')),
      JSON.stringify(refused.map((r) => r.strike)),
    )
    const done = all.filter((r) => r.badge === 'Geliefert')
    assert(
      'materials: a DELIVERED request stays editable — the invoice turns up late',
      done.length > 0 && done.every((r) => r.labels.some((l) => l.startsWith('Details'))),
      JSON.stringify(done.map((r) => [r.who, r.labels])),
    )
    await page.screenshot(`${SHOTS}/materials-dark-1680-all.png`)

    // ---- the paperwork drawer: focus in, trapped, restored -------------------------------
    const opened = await page.eval(`(() => {
      const btn = [...document.querySelectorAll('td.cell-actions button')].find((b) => b.textContent.startsWith('Details'))
      if (!btn) return null
      btn.id = 'probe-details'
      btn.focus(); btn.click()
      return true
    })()`)
    assert('materials: a Details control exists to open the drawer', opened === true)
    await page.waitFor(`document.querySelector('.drawer')`, {
      timeout: 5000,
      label: 'the detail drawer',
    })
    assert(
      'materials: focus moves INTO the drawer (the deliberate focus move, kept)',
      await page.eval(`!!document.querySelector('.drawer')?.contains(document.activeElement)`),
      await page.eval(WHERE_FOCUS),
    )
    const drawer = await page.eval(`(() => ({
      title: document.querySelector('.drawer h2')?.textContent.trim(),
      step: document.querySelector('.drawer .step')?.textContent.trim(),
      quote: document.querySelector('.drawer q')?.textContent.trim().slice(0, 40),
      fields: [...document.querySelectorAll('.drawer .field label')].map((l) => l.textContent.trim()),
      hints: [...document.querySelectorAll('.drawer .field-hint')].map((p) => p.textContent.trim().slice(0, 24)),
      described: [...document.querySelectorAll('.drawer .field input, .drawer .field select, .drawer .field textarea')]
        .every((el) => (el.getAttribute('aria-describedby') || '').includes('-error')),
    }))()`)
    assert(
      'materials: the drawer names the worker whose request it is',
      (drawer.title ?? '').length > 5,
      drawer.title,
    )
    assert(
      "materials: the worker's own words travel with the paperwork, still quoted",
      (drawer.quote ?? '').length > 0,
      drawer.quote,
    )
    assert(
      'materials: all five paperwork fields are in the drawer',
      drawer.fields.length === 5,
      JSON.stringify(drawer.fields),
    )
    assert(
      'materials: every drawer control is wired to its own error node',
      drawer.described === true,
    )
    assert(
      'materials: decision-6 is still stated AT the building control',
      drawer.hints.some((h) => h.startsWith('Nur Kontext')),
      JSON.stringify(drawer.hints),
    )
    // Past the 200ms entry animation: a screenshot on the same tick catches a
    // half-faded overlay and reads as a contrast fault that is not there.
    await sleep(400)
    await page.screenshot(`${SHOTS}/materials-dark-drawer.png`)
    for (let i = 0; i < 16; i++) await press(page, 'Tab')
    assert(
      'materials: Tab never leaves the open drawer',
      await page.eval(`!!document.querySelector('.drawer')?.contains(document.activeElement)`),
      await page.eval(WHERE_FOCUS),
    )
    await press(page, 'Escape')
    await sleep(300)
    assert(
      'materials: Escape closes the drawer',
      !(await page.eval(`!!document.querySelector('.drawer')`)),
    )
    assert(
      'materials: focus returns to the control that opened it',
      (await page.eval(`document.activeElement?.id`)) === 'probe-details',
      await page.eval(WHERE_FOCUS),
    )

    // ---- refusing is irreversible, so it asks first --------------------------------------
    const askedToReject = await page.eval(`(() => {
      const btn = [...document.querySelectorAll('td.cell-actions button')].find((b) => b.textContent.startsWith('Ablehnen'))
      if (!btn) return null
      btn.id = 'probe-reject'
      btn.focus(); btn.click()
      return true
    })()`)
    assert('materials: a refuse control exists', askedToReject === true)
    await page.waitFor(`document.querySelector('.modal')`, {
      timeout: 5000,
      label: 'the confirm modal',
    })
    const modal = await page.eval(`(() => {
      const m = document.querySelector('.modal')
      const describedBy = m.getAttribute('aria-describedby')
      return {
        title: m.querySelector('h2').textContent.trim(),
        body: document.getElementById(describedBy)?.textContent.trim().slice(0, 40),
        danger: !!m.querySelector('.btn-danger'),
        wired: !!describedBy && !!document.getElementById(describedBy),
      }
    })()`)
    assert(
      'materials: refusing asks first, and names the worker',
      modal.title.includes('ablehnen'),
      modal.title,
    )
    assert(
      "materials: the consequence is a sentence, wired as the dialog's description",
      modal.wired && (modal.body ?? '').length > 10,
      JSON.stringify(modal),
    )
    assert('materials: the confirm button carries the destructive treatment', modal.danger === true)
    // Past the 200ms entry animation: a screenshot on the same tick catches a
    // half-faded overlay and reads as a contrast fault that is not there.
    await sleep(400)
    await page.screenshot(`${SHOTS}/materials-dark-confirm.png`)
    await press(page, 'Escape')
    await sleep(300)
    assert(
      'materials: Escape cancels the refusal and nothing was written',
      !(await page.eval(`!!document.querySelector('.modal')`)) &&
        (await page.eval(`document.activeElement?.id`)) === 'probe-reject',
      await page.eval(WHERE_FOCUS),
    )

    // =====================================================================================
    // 3. /account/ — one job, and one absence that must stay an absence
    // =====================================================================================
    await page.goto(`${BASE}/account/`, { settle: 900 })
    const account = await page.eval(`(() => ({
      question: document.querySelector('.question')?.textContent.trim(),
      fields: [...document.querySelectorAll('form .field label')].map((l) => l.textContent.trim()),
      autocomplete: [...document.querySelectorAll('form input')].map((i) => i.getAttribute('autocomplete')),
      status: !!document.querySelector('[role=status]'),
      noResetSaid: [...document.querySelectorAll('.note')].some((n) => n.textContent.includes('Passwort vergessen')),
      resetControls: [...document.querySelectorAll('main a, main button')]
        .filter((el) => /vergessen|zur(ü|ue)cksetzen|reset|e-?mail/i.test(el.textContent))
        .map((el) => el.textContent.trim()),
    }))()`)
    assert('account: states its question', (account.question ?? '').length > 10, account.question)
    assert(
      'account: three password fields',
      account.fields.length === 3,
      JSON.stringify(account.fields),
    )
    assert(
      'account: autocomplete stays current-password / new-password / new-password',
      JSON.stringify(account.autocomplete) ===
        JSON.stringify(['current-password', 'new-password', 'new-password']),
      JSON.stringify(account.autocomplete),
    )
    assert('account: the single live region for both outcomes is mounted', account.status === true)
    assert(
      'account: NO reset-by-email control — there is no outbound mail to send one over',
      account.resetControls.length === 0,
      JSON.stringify(account.resetControls),
    )
    assert(
      'account: …and the absence is now SAID on screen rather than only in a comment',
      account.noResetSaid === true,
    )
    await page.screenshot(`${SHOTS}/account-dark-1680.png`)

    // =====================================================================================
    // 4. the phone, and the captions
    // =====================================================================================
    for (const [w, h] of [
      [390, 844],
      [360, 780],
    ]) {
      await setViewport(page, w, h)
      for (const [path, label] of [
        ['/material-requests/', 'materials'],
        ['/account/', 'account'],
      ]) {
        await page.goto(`${BASE}${path}`, { settle: 1200 })
        const probe = await page.eval(CAPTION_PROBE)
        assert(
          `captions[${label}@${w}]: every data-label matches the header in its own column`,
          probe.mismatches.length === 0,
          probe.mismatches.slice(0, 4).join(' | '),
        )
        notes.push(
          `${label}@${w}: ${probe.tables} table(s), ${probe.cells} cells, ${probe.count} labelled ` +
            `(count probe: ${probe.count > 0 ? 'GREEN' : 'no data'}; text probe: ` +
            `${probe.mismatches.length === 0 ? 'GREEN' : `RED ×${probe.mismatches.length}`})`,
        )
        const scroll = await page.eval(
          `({ w: document.documentElement.scrollWidth, v: window.innerWidth })`,
        )
        if (scroll.v !== w) throw new Error(`the ${w}px viewport was lost: ${scroll.v}px`)
        assert(
          `layout[${label}@${w}]: no horizontal page scroll`,
          scroll.w <= scroll.v + 1,
          JSON.stringify(scroll),
        )
        // NINE, not twelve, since decision-39: `/contracts/`, `/analytics/` and
        // `/inventory/` left the sidebar and are reached from the objects that need them.
        // Still an EXACT count — the failure this guards is a phone losing its navigation,
        // and `>= 9` would also pass a sidebar that quietly grew back.
        assert(
          `nav[${label}@${w}]: the sidebar is still a reachable strip, all 9 routes`,
          (await page.eval(`document.querySelectorAll('nav.sidebar a.nav-link').length`)) === 9,
          `${await page.eval(`document.querySelectorAll('nav.sidebar a.nav-link').length`)} links`,
        )
        if (w === 390) {
          await page.screenshot(`${SHOTS}/${label}-dark-390.png`)
          // The cards themselves, not just the top of the page: the captions and the wrapped
          // action row are below the fold and are exactly what an assertion cannot judge.
          await page.eval(`window.scrollTo(0, 620)`)
          await sleep(400)
          await page.screenshot(`${SHOTS}/${label}-dark-390-cards.png`)
        }
      }
    }

    // The drawer IS the screen on a phone.
    await setViewport(page, 390, 844)
    await page.goto(`${BASE}/material-requests/`, { settle: 1200 })
    await page.eval(`(() => {
      const btn = [...document.querySelectorAll('td.cell-actions button')].find((b) => b.textContent.startsWith('Details'))
      btn.click()
    })()`)
    await page.waitFor(`document.querySelector('.drawer')`, {
      timeout: 5000,
      label: 'the phone drawer',
    })
    const dw = await page.eval(`document.querySelector('.drawer').getBoundingClientRect().width`)
    assert('materials: the drawer is the full width of a phone', Math.round(dw) === 390, `${dw}px`)
    // Past the 200ms entry animation: a screenshot on the same tick catches a
    // half-faded overlay and reads as a contrast fault that is not there.
    await sleep(400)
    await page.screenshot(`${SHOTS}/materials-dark-390-drawer.png`)
    await press(page, 'Escape')

    // ---- 44px touch targets --------------------------------------------------------------
    const small = await page.eval(`(() => {
      const out = []
      for (const el of document.querySelectorAll('main button:not(.btn-quiet), main input, main select, main textarea')) {
        const r = el.getBoundingClientRect()
        if (r.height > 0 && r.height < 43.5) out.push((el.tagName + '.' + el.className).slice(0, 40) + ' ' + Math.round(r.height))
      }
      return out
    })()`)
    assert(
      'materials: every non-quiet control clears the 44px floor on a phone',
      small.length === 0,
      JSON.stringify(small),
    )

    // ---- light theme stills --------------------------------------------------------------
    await setTheme(page, 'light')
    for (const [path, name, w, h] of [
      ['/material-requests/', 'materials-light-1680', 1680, 1200],
      ['/account/', 'account-light-1680', 1680, 1200],
      ['/material-requests/', 'materials-light-390', 390, 844],
      ['/account/', 'account-light-390', 390, 844],
    ]) {
      await setViewport(page, w, h)
      await page.goto(`${BASE}${path}`, { settle: 900 })
      await page.screenshot(`${SHOTS}/${name}.png`)
    }
    await setTheme(page, 'dark')
  } finally {
    page.close()
    child.kill()
  }

  console.log('')
  for (const note of notes) console.log(`  note ${note}`)
  console.log(`\n  screenshots: ${SHOTS}`)
  if (failures.length > 0) {
    console.error(`\ncheck-materials-account-login: ${failures.length} FAILURE(S)`)
    for (const f of failures) console.error(`  - ${f}`)
    process.exit(1)
  }
  console.log('\ncheck-materials-account-login: OK')
}

const bail = setTimeout(() => {
  console.error('check-materials-account-login: hit the 5 minute deadline — bailing out.')
  process.exit(1)
}, DEADLINE_MS)
bail.unref?.()

await main()
clearTimeout(bail)
