// ONE assertion, so it can be mutation-tested cheaply: after an overlay closes, does focus
// return to the exact element that opened it?
//
//   node demo/probe-focus-restore.mjs          # exit 0 = restored, 1 = not restored
//
// This exists separately from demo/audit-overlays.mjs because the audit takes ~90 s and the
// only way to trust its "focus restored to the opener" line is to break restoration on
// purpose and watch a probe go red. A 12-second probe makes that affordable, so it happens.
//
// WHY IT CANNOT PASS VACUOUSLY, in the order the failures actually happen:
//   - it FAILS if the opener control is not found (no silent skip)
//   - it FAILS if the drawer never appeared
//   - it FAILS if Escape did not close the drawer
//   - it FAILS if document.activeElement is anything other than the remembered opener,
//     including <body>, which is exactly where a browser dumps focus when a dialog with
//     focus inside it unmounts and nobody restores.
// The identity comparison is against a node reference captured BEFORE the click, not against
// a selector re-queried afterwards — a selector match would also be satisfied by a fresh
// element that merely looks like the opener.
import { attach, launchChrome, sleep } from './cdp.mjs'

const BASE = process.env.AUDIT_BASE ?? 'http://127.0.0.1:8082'
if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(new URL(BASE).hostname)) {
  console.error('probe-focus-restore: loopback only.')
  process.exit(1)
}

const ADMIN = { email: 'demo@example.test', password: 'demo-nur-lokal-2026' }
const OPENER = process.env.PROBE_OPENER ?? 'Mitarbeiter anlegen'
const SCREEN = process.env.PROBE_SCREEN ?? '/workers/'

const chrome = await launchChrome({ port: Number(process.env.AUDIT_PORT ?? 9405), width: 1440, height: 900 })
const page = await attach(chrome.port)

let failure = null
const fail = (why) => {
  if (failure === null) failure = why
}

try {
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

  await page.goto(`${BASE}${SCREEN}`, { settle: 1200 })
  await page.waitFor(`document.querySelectorAll('table.data-table tbody tr').length > 0`, {
    timeout: 12000,
    label: 'rows rendered',
  })

  const found = await page.eval(`(() => {
    const hit = [...document.querySelectorAll('button, a')]
      .find((el) => ((el.getAttribute('aria-label') || el.textContent || ''))
        .includes(${JSON.stringify(OPENER)}))
    if (!hit) return false
    window.__opener = hit
    hit.focus()
    hit.click()
    return true
  })()`)
  if (!found) fail(`no control containing "${OPENER}" on ${SCREEN}`)
  await sleep(400)

  if (!failure && !(await page.eval(`!!document.querySelector('.drawer, .modal')`))) {
    fail('the overlay never opened')
  }

  // Move focus off the first control so a "restoration" that is really just "focus never
  // left" cannot pass. Tab twice: still inside the trap, but no longer on the ✕.
  if (!failure) {
    for (const _ of [0, 1]) {
      await page.send('Input.dispatchKeyEvent', {
        type: 'rawKeyDown',
        windowsVirtualKeyCode: 9,
        code: 'Tab',
        key: 'Tab',
      })
      await page.send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        windowsVirtualKeyCode: 9,
        code: 'Tab',
        key: 'Tab',
      })
      await sleep(90)
    }
    const inside = await page.eval(`!!(document.activeElement &&
      document.activeElement.closest('.drawer, .modal'))`)
    if (!inside) fail('focus was already outside the overlay before Escape — trap leaked')
  }

  if (!failure) {
    for (const type of ['rawKeyDown', 'keyUp']) {
      await page.send('Input.dispatchKeyEvent', {
        type,
        windowsVirtualKeyCode: 27,
        code: 'Escape',
        key: 'Escape',
      })
    }
    await sleep(400)
    if (await page.eval(`!!document.querySelector('.drawer, .modal')`)) {
      fail('Escape did not close the overlay')
    }
  }

  if (!failure) {
    const where = await page.eval(`(() => {
      const a = document.activeElement
      return {
        restored: a === window.__opener,
        tag: a ? a.tagName : 'null',
        id: a ? a.id : '',
        text: a ? (a.getAttribute('aria-label') || a.textContent || '').trim().slice(0, 48) : '',
      }
    })()`)
    if (!where.restored) {
      fail(`focus landed on ${where.tag}${where.id ? `#${where.id}` : ''} ` +
        `"${where.text}" instead of the opener`)
    } else {
      console.log(`  ok   focus returned to the opener — ${where.tag} "${where.text}"`)
    }
  }
} catch (error) {
  fail(`threw: ${error.message}`)
}

page.close()
chrome.child.kill()

if (failure) {
  console.log(`  FAIL focus restoration — ${failure}`)
  console.log('RED')
  process.exit(1)
}
console.log('GREEN')
process.exit(0)
