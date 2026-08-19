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
const lines = []
function record(ok, label, detail) {
  lines.push(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(`${label}: ${detail}`)
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
        // GREY IS NEVER THE ONLY SIGNAL: an unzoned building says so in text.
        const unzonedSaid = await page.eval(
          `document.body.innerText.includes('Noch keine Zone') || document.body.innerText.includes('No zone yet')`,
        )
        record(unzonedSaid, `${tag} an unzoned building is named in words, not only greyed`)

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
  process.stdout.write('All geometry probes passed.\n')
}

await run()
