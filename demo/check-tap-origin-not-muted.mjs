// C8 (LOOK.md) — italic + muted colour (.cell-muted) means "there is nothing here"
// everywhere on /shifts/ ("Noch kein Ende", "Läuft noch", "Keine Nummer…") except one cell,
// where it was typeset over a REAL value: "Am Tag gescannt" — the whole audit distinction
// ART DER ERFASSUNG exists for (client_uuid IS NOT NULL). A director reading the ledger saw
// the tap origin styled as an absence.
//
// FIX: a dedicated .shift-origin-tap class — plain --text-secondary, not italic, not muted.
// The manual-entry sibling (.shift-origin-manual, bold) is untouched: a tapped shift is the
// ORDINARY case and gets the row's own weight; the exception keeps the emphasis.
//
//   DEMO_BASE=http://127.0.0.1:8083 node demo/check-tap-origin-not-muted.mjs
//
// No new dependency: demo/cdp.mjs, Node, the Chrome already on the machine.
import { attach, launchChrome, sleep } from './cdp.mjs'

const BASE = process.env.DEMO_BASE ?? 'http://127.0.0.1:8083'
const host = new URL(BASE).hostname
if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(host)) {
  console.error(`check-tap-origin-not-muted: refusing "${host}" — loopback only.`)
  process.exit(1)
}

const ADMIN = { email: 'demo@example.test', password: 'demo-nur-lokal-2026' }

let failures = 0
const assert = (name, cond, detail) => {
  if (cond) {
    console.log(`  ok   ${name}`)
  } else {
    failures++
    console.log(`  FAIL ${name}${detail ? `  ${detail}` : ''}`)
  }
}

async function main() {
  const { child, port } = await launchChrome({
    port: 9960 + (process.pid % 200),
    width: 1680,
    height: 1050,
  })
  const page = await attach(port)
  try {
    await page.goto(`${BASE}/login/`, { settle: 700 })
    await page.waitFor(`document.querySelector('form button[type="submit"]')`, { label: 'sign-in button' })
    await page.type('input[name="email"]', ADMIN.email, { perChar: 0 })
    await page.type('input[name="password"]', ADMIN.password, { perChar: 0 })
    await page.clickText('Anmelden', { selector: 'form button[type="submit"]' })
    await page.waitFor("location.pathname === '/'", { timeout: 15000, label: 'the dashboard' })

    await page.goto(`${BASE}/shifts/`, { settle: 900 })
    await page.waitFor(`[...document.querySelectorAll('td')].some((td) => td.textContent.includes('Am Tag gescannt'))`, {
      label: 'a tapped shift row',
    })
    await sleep(200)

    const r = await page.eval(`(() => {
      const tapEls = [...document.querySelectorAll('.shift-origin-tap')].filter((el) => el.offsetParent !== null)
      const absenceEls = [...document.querySelectorAll('.cell-muted')].filter((el) => el.offsetParent !== null)
      const style = (el) => {
        const cs = getComputedStyle(el)
        return { italic: cs.fontStyle === 'italic', color: cs.color }
      }
      return {
        tapCount: tapEls.length,
        tapStyles: tapEls.map(style),
        absenceCount: absenceEls.length,
        absenceStillItalic: absenceEls.every((el) => style(el).italic),
      }
    })()`)

    console.log(`  /shifts/: ${JSON.stringify(r)}`)
    assert('at least one "Am Tag gescannt" cell is present', r.tapCount > 0, `count ${r.tapCount}`)
    assert(
      'the tap-origin cell is NOT italic (it is a real value, not an absence)',
      r.tapStyles.every((s) => !s.italic),
    )
    assert(
      'genuine absence cells (.cell-muted) are still italic — untouched by this fix',
      r.absenceCount === 0 || r.absenceStillItalic,
    )
  } finally {
    child.kill('SIGKILL')
  }

  console.log(failures ? `\ncheck-tap-origin-not-muted: FAIL (${failures})` : '\ncheck-tap-origin-not-muted: OK')
  process.exit(failures ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
