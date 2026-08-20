// Does Austrian business German fit at 390px? Measured, not eyeballed.
//
//   node demo/audit-german.mjs            # writes /tmp/ts-audit/german/*.png
//
// CLIPPING, NOT OVERFLOW. demo/audit-phone.mjs already proves the document does not scroll
// sideways; a compound can still be swallowed inside a box that scrolls or ellipsises its own
// content, and that produces "Zugangsc…" with no horizontal scrollbar anywhere. So the
// assertion here is per-element: scrollWidth > clientWidth on an element whose computed
// overflow is not `visible`, which is the exact condition under which text is unreachable.
//
// A visible overflow is NOT reported: text that spills out of its box is ugly but readable,
// and audit-phone.mjs catches it if it reaches past the viewport.
//
// WHY IT CANNOT PASS VACUOUSLY: it fails if a screen renders none of the words it is looking
// for. A run that found no "Objekt" anywhere would otherwise be a green run.
import { mkdirSync } from 'node:fs'
import { attach, launchChrome, sleep } from './cdp.mjs'

const BASE = process.env.AUDIT_BASE ?? 'http://127.0.0.1:8082'
const OUT = '/tmp/ts-audit/german'
const ADMIN = { email: 'demo@example.test', password: 'demo-nur-lokal-2026' }
mkdirSync(OUT, { recursive: true })

/** The words the owner named, plus the ones that are longest in the message catalogue. */
const WORDS = [
  'Objekt',
  'Kunde',
  'Zugangscode',
  'Schicht nachtragen',
  'Auswertung',
  'Lohnabrechnung',
  'Materialanforderung',
  'Deaktivieren',
  'Stundensatz',
  'Gewinn',
]

const SCREENS = [
  { path: '/', words: ['Objekt', 'Auswertung'] },
  { path: '/shifts/', words: ['Schicht nachtragen', 'Objekt'] },
  { path: '/workers/', words: ['Zugangscode', 'Stundensatz'] },
  { path: '/locations/', words: ['Objekt', 'Kunde'] },
  { path: '/payroll/', words: ['Lohnabrechnung'] },
  { path: '/material-requests/', words: ['Objekt'] },
  { path: '/analytics/', words: ['Auswertung'] },
  { path: '/pl/', words: ['Gewinn'] },
  { path: '/clients/', words: ['Kunde'] },
  // Off-nav (decision-39 §6) and therefore easy to leave out of a screen list. It was:
  // /operators/ shipped in TASK-214 and no German audit had ever loaded it.
  { path: '/operators/', words: ['Zugangscode', 'Deaktivieren'] },
]

const results = []
const record = (ok, label, detail = '') => {
  results.push({ ok, label, detail })
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `  — ${detail}` : ''}`)
}

const chrome = await launchChrome({ port: Number(process.env.AUDIT_PORT ?? 9407), width: 390, height: 900 })
const page = await attach(chrome.port)

await page.send('Emulation.setDeviceMetricsOverride', {
  width: 1280,
  height: 900,
  deviceScaleFactor: 2,
  mobile: false,
})
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

await page.send('Emulation.setDeviceMetricsOverride', {
  width: 390,
  height: 900,
  deviceScaleFactor: 2,
  mobile: true,
})

for (const { path, words } of SCREENS) {
  await page.goto(`${BASE}${path}`, { settle: 1400 })
  const report = await page.eval(`(() => {
    const words = ${JSON.stringify(WORDS)}
    const wanted = ${JSON.stringify(words)}
    const clipped = []
    const seen = new Set()
    // Text hidden ON PURPOSE is not clipped text. Two patterns in this codebase collapse a box
    // to 1px and hide its overflow, and both are correct: .visually-hidden (globals.css:180)
    // and .nav-group-heading below 768px (globals.css:1558). Without this the audit reports
    // every table caption and every screen-reader-only label as a German overflow, which is
    // 8 lines of noise per screen and hides a real one.
    const hiddenOnPurpose = (el, cs) =>
      el.clientWidth <= 1 ||
      el.clientHeight <= 1 ||
      cs.clipPath === 'inset(50%)' ||
      el.classList.contains('visually-hidden')
    // THE WORD SCAN READS AN ELEMENT'S OWN TEXT NODES, not only leaves.
    //
    // Leaf-only was wrong and it produced a false alarm the day /operators/ was added: every
    // row action in this admin is <button>Deaktivieren<span class="visually-hidden"> von
    // Karin Bauer</span></button>, so the button HAS a child, is skipped, and its own word
    // is never seen. The screen said „Deaktivieren" in 105px of button at 390px while this
    // audit reported the word absent. The clipping scan below stays leaf-only, which is
    // correct for it — a box that clips is the box, not its parent.
    for (const el of document.querySelectorAll('body *')) {
      if (!el.classList.contains('visually-hidden')) {
        const own = [...el.childNodes]
          .filter((n) => n.nodeType === 3)
          .map((n) => n.nodeValue)
          .join(' ')
          .replace(/\\s+/g, ' ')
        if (own.trim() !== '') for (const w of words) if (own.includes(w)) seen.add(w)
      }
      if (el.children.length > 0) continue          // leaf text only, for the clipping scan
      const text = (el.textContent || '').replace(/\\s+/g, ' ').trim()
      if (text === '') continue
      const cs = getComputedStyle(el)
      if (hiddenOnPurpose(el, cs)) continue
      if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue
      if (el.scrollWidth > el.clientWidth + 1) {
        clipped.push(el.tagName + '.' + String(el.className).split(' ')[0] +
          ' overflow=' + cs.overflowX + ' ' + el.scrollWidth + '>' + el.clientWidth +
          ' "' + text.slice(0, 40) + '"')
      }
    }
    // Same test for the boxes themselves — a .btn or a nav link with hidden overflow.
    for (const el of document.querySelectorAll('.btn, .nav-link, .badge, .answer .v, th, td')) {
      const cs = getComputedStyle(el)
      if (hiddenOnPurpose(el, cs)) continue
      if (cs.overflowX === 'visible') continue
      if (el.scrollWidth > el.clientWidth + 1) {
        clipped.push('BOX ' + el.tagName + '.' + String(el.className).split(' ')[0] +
          ' ' + el.scrollWidth + '>' + el.clientWidth +
          ' "' + (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 40) + '"')
      }
    }
    return {
      clipped: [...new Set(clipped)].slice(0, 8),
      missing: wanted.filter((w) => !seen.has(w)),
      lang: document.documentElement.getAttribute('lang'),
    }
  })()`)

  await page.eval('window.scrollTo(0, 0)')
  await page.screenshot(`${OUT}/390${path.replace(/\//g, '_') || '_root'}.png`)

  const problems = []
  if (report.missing.length) {
    problems.push(`the words this screen was supposed to render are absent: ${report.missing.join(', ')} — the check found nothing to measure`)
  }
  if (report.clipped.length) problems.push(`clipped: ${report.clipped.join(' || ')}`)
  // de-AT, not de: the UI is Austrian business German and the locale says so. Asserting a
  // bare 'de' here was the first version of this line and it failed all nine screens.
  if (!String(report.lang).startsWith('de')) {
    problems.push(`<html lang="${report.lang}">, expected a German locale`)
  }
  record(problems.length === 0, `390 ${path}`, problems.join(' || '))
}

console.log(`\nscreenshots: ${OUT}`)
const failed = results.filter((r) => !r.ok)
console.log(`${results.length - failed.length}/${results.length} passed, ${failed.length} FAILED`)
page.close()
chrome.child.kill()
process.exit(failed.length === 0 ? 0 : 1)
