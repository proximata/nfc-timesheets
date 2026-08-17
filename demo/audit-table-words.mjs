// Are table cells breaking German words in HALF on a desktop screen?
//
//   node demo/audit-table-words.mjs                 # 1440px, the width the owner uses
//   AUDIT_WIDTH=1280 node demo/audit-table-words.mjs
//
// WHAT IS MEASURED, and why a screenshot alone would not settle it: for every cell, the widest
// single WORD is measured with the cell's own computed font, and compared to the width the cell
// actually got. If the word is wider than the cell, the browser had no choice but to break it
// mid-word — "Stundensatz" renders as STUN / DENS / ATZ and "15,50 €" as "15,5" / "0 €".
//
// `overflow-wrap: anywhere` (globals.css:576) is what makes this possible: unlike
// `break-word`, `anywhere` also shrinks the cell's MIN-CONTENT size to one character, so
// `table-layout: auto` is free to squeeze a column down to four characters wide even when the
// viewport is 1440px and there is room to spare.
//
// The probe is a measurement, not a screenshot diff, so it is stable across font versions; the
// mutation to run against it is to force `overflow-wrap: break-word` on .data-table cells,
// which must take every offender to zero.
import { attach, launchChrome, sleep } from './cdp.mjs'

const BASE = process.env.AUDIT_BASE ?? 'http://127.0.0.1:8082'
const WIDTH = Number(process.env.AUDIT_WIDTH ?? 1440)
const ADMIN = { email: 'demo@example.test', password: 'demo-nur-lokal-2026' }

const SCREENS = [
  '/shifts/',
  '/workers/',
  '/locations/',
  '/clients/',
  '/contracts/',
  '/inventory/',
  '/payroll/',
  '/pl/',
  '/analytics/',
  '/material-requests/',
]

const chrome = await launchChrome({ port: Number(process.env.AUDIT_PORT ?? 9409), width: WIDTH, height: 1000 })
const page = await attach(chrome.port)

const results = []
const record = (ok, label, detail = '') => {
  results.push({ ok, label, detail })
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `  — ${detail}` : ''}`)
}

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

let totalCells = 0
for (const path of SCREENS) {
  await page.goto(`${BASE}${path}`, { settle: 1400 })
  const report = await page.eval(`(() => {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    const offenders = []
    let cells = 0
    for (const cell of document.querySelectorAll('table.data-table th, table.data-table td')) {
      // TEXT NODES, not textContent. A cell with two stacked <span>s has no whitespace between
      // them in the DOM, so textContent glues them into "LandstrasseOrdinationszentrum" — a
      // 237px "word" that does not exist on screen. The first version of this probe reported
      // seven of those on /analytics/ alone and they were all the concatenation, not the page.
      const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT)
      const words = []
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        for (const w of (n.textContent || '').split(/\\s+/)) if (w !== '') words.push(w)
      }
      const text = words.join(' ')
      if (text === '') continue
      // Only the cell's OWN text: a cell that contains buttons is laid out by them, and a
      // button label breaking is a different defect with a different fix.
      if (cell.querySelector('button, a, input, select')) continue
      cells++
      const cs = getComputedStyle(cell)
      ctx.font = cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily
      const inner =
        cell.clientWidth -
        Number.parseFloat(cs.paddingLeft) -
        Number.parseFloat(cs.paddingRight)
      // The UUID column is allowed to break anywhere on purpose (globals.css:1125) — a UUID
      // has no words and wrapping it is the documented intent.
      if (cell.classList.contains('cell-uuid') || cell.querySelector('.tag-uuid')) continue
      let widest = ''
      let widestPx = 0
      for (const word of words) {
        const w = ctx.measureText(word).width
        if (w > widestPx) { widestPx = w; widest = word }
      }
      if (widestPx > inner + 0.5) {
        offenders.push({
          col: cell.cellIndex,
          word: widest,
          need: Math.round(widestPx),
          got: Math.round(inner),
          text: text.slice(0, 30),
        })
      }
    }
    // Deduplicate by word: five rows of the same broken column is one defect.
    const byWord = new Map()
    for (const o of offenders) if (!byWord.has(o.word)) byWord.set(o.word, o)
    return { cells, offenders: [...byWord.values()].slice(0, 8), count: offenders.length }
  })()`)
  totalCells += report.cells
  record(
    report.count === 0,
    `${WIDTH}px ${path}`,
    report.count === 0
      ? `${report.cells} text cells, none broken`
      : `${report.count} cell(s) too narrow for their own word: ` +
        report.offenders
          .map((o) => `"${o.word}" needs ${o.need}px, cell gives ${o.got}px (col ${o.col})`)
          .join(' || '),
  )
}

// A run that measured nothing is not a pass.
record(totalCells > 100, 'the audit actually measured cells', `${totalCells} text cells across ${SCREENS.length} screens`)

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed, ${failed.length} FAILED`)
page.close()
chrome.child.kill()
process.exit(failed.length === 0 ? 0 : 1)
