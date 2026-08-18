// The SHAPE half of the band fix: at which widths is a row a row, and at which is it a card?
//
//   node demo/audit-band-shape.mjs
//
// audit-band.mjs proves nothing is cut off or scrolled sideways. A stylesheet can pass that
// by turning every table into a card at every width, which would destroy the 1680px view the
// director actually works in. This asserts the OTHER direction: the card transform is bounded
// on BOTH sides. 390 and 1024 must be cards; 1280, 1440 and 1680 must be real table rows.
//
// It reads `display` off a real <tbody> <tr>, and it refuses to pass a screen where it found
// no rows at all — "no rows" is how a shape check reports success on a blank page.
//
// AND IT READS THE CAPTIONS, which is the half that was missing. A card is only readable
// because each cell prints its column heading (`data-label` -> `::before`, written by
// components/ResponsiveTableLabels.tsx walking `row.children` POSITIONALLY because every row
// leads with a `<th>`). Map those labels off the `td`s alone instead and every caption slides
// one column left: a rate is captioned "Telefon", which is not unreadable, it is READABLE AND
// FALSE. That exact mutation once passed every probe in demo/ — audit-band, this file's shape
// half, audit-table-words, audit-german, audit-keyboard, audit-focus-ring — because each of
// them counted labelled cells and none of them read one. So the assertion below is TEXT
// against TEXT, per cell, per column index, and never a count: the count is what stayed green.
// R1 widened the blast radius from a phone to every window under 1280px, which is an iPad and
// half a monitor, so it is asserted at all six card widths.
import { attach, launchChrome, sleep } from './cdp.mjs'

const BASE = process.env.AUDIT_BASE ?? 'http://127.0.0.1:8082'
const ADMIN = { email: 'demo@example.test', password: 'demo-nur-lokal-2026' }

// path -> the shape each width owes. `block` = one row is one card, `table-row` = a real row.
const CARD = [390, 767, 768, 1024, 1152, 1279]
const TABLE = [1280, 1440, 1680]
const SCREENS = ['/shifts/', '/workers/', '/locations/', '/clients/', '/inventory/', '/payroll/']

let chrome = null
let page = null
const shutdown = () => {
  try {
    page?.close()
  } catch {
    /* socket already gone */
  }
  try {
    chrome?.child.kill()
  } catch {
    /* already dead */
  }
  chrome = null
}
process.on('exit', shutdown)
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => {
    shutdown()
    process.exit(130)
  })
}
for (const ev of ['uncaughtException', 'unhandledRejection']) {
  process.on(ev, (err) => {
    console.error(`\n${ev}:`, err)
    shutdown()
    process.exit(1)
  })
}

chrome = await launchChrome({ port: Number(process.env.AUDIT_PORT ?? 9408), width: 1280, height: 900 })
page = await attach(chrome.port)

const viewport = (width) =>
  page.send('Emulation.setDeviceMetricsOverride', {
    width,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  })

await viewport(1280)
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

const SHAPE = `(() => {
  const row = document.querySelector('table.data-table tbody tr')
  if (!row) return { rows: 0, display: null }
  return {
    rows: document.querySelectorAll('table.data-table tbody tr').length,
    display: getComputedStyle(row).display,
    // On a card the column heading is printed beside the value; on a row it is in <thead>.
    label: getComputedStyle(row.querySelector('td') ?? row, '::before').content.slice(0, 20),
  }
})()`

// Every card cell on the screen, compared against the heading of the column it is IN.
//
// Two readings per cell, because the caption exists twice and both can be wrong on their own:
// the `data-label` ATTRIBUTE (what the header association and any future probe reads) and the
// PAINTED `::before` (what the director's eye reads). Chrome resolves `content: attr(...)` to
// a quoted string, and gives `none` where nothing is drawn — `.cell-actions::before` is
// deliberately `none`, so an actions cell is checked on its attribute only.
//
// Comparison is exact after `trim()`, deliberately: the labels are COPIED from the same
// `thead th` textContent, so anything that needs fuzzing to match is already a mismatch. No
// backslash regex lives in this template string — `\s` inside a template literal collapses to
// a plain `s` and silently matches nothing, which is how the last verifier's own probe lied.
const LABELS = `(() => {
  const out = { cells: 0, painted: 0, bad: [] }
  for (const table of document.querySelectorAll('table.data-table')) {
    const headings = [...table.querySelectorAll('thead th')].map((th) => (th.textContent || '').trim())
    if (headings.length === 0) continue
    for (const row of table.querySelectorAll('tbody tr')) {
      const title = (row.children[0] ? row.children[0].textContent : '').trim().slice(0, 22)
      ;[...row.children].forEach((cell, i) => {
        out.cells++
        const want = (headings[i] || '').trim()
        const attr = cell.getAttribute('data-label')
        const raw = getComputedStyle(cell, '::before').content
        const painted = raw === 'none' || raw === 'normal' ? null : raw.replace(/^"|"$/g, '').trim()
        if (painted !== null) out.painted++
        const bad = (why, got) => out.bad.push({ row: title, col: i, why, want, got })
        if (cell.tagName !== 'TD') {
          // The row header IS the card's title. A caption on it is the historical off-by-one.
          if (attr !== null || painted !== null) bad('row header carries a caption', attr || painted)
          return
        }
        if (want === '') {
          if (attr !== null) bad('cell in a headingless column carries a caption', attr)
          return
        }
        if (attr !== want) bad('data-label is not this column heading', attr)
        else if (painted !== null && painted !== want) bad('painted caption is not this column heading', painted)
      })
    }
  }
  return out
})()`

let failed = 0
let seenRows = 0
let seenCells = 0
let seenPainted = 0
const say = (ok, msg) => {
  if (!ok) failed++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${msg}`)
}

for (const path of SCREENS) {
  console.log(`\n### ${path}`)
  for (const [width, want] of [
    ...CARD.map((w) => [w, 'block']),
    ...TABLE.map((w) => [w, 'table-row']),
  ]) {
    await viewport(width)
    await page.goto(`${BASE}${path}`, { settle: 900 })
    const r = await page.eval(SHAPE)
    seenRows += r.rows
    say(
      r.rows > 0 && r.display === want,
      `${String(width).padStart(4)}px — ${want === 'block' ? 'one row is one CARD' : 'a real TABLE row'} — display=${r.display} rows=${r.rows}`,
    )
    if (want !== 'block') continue
    const l = await page.eval(LABELS)
    seenCells += l.cells
    seenPainted += l.painted
    say(
      l.bad.length === 0,
      `${String(width).padStart(4)}px — every caption is its own column's heading — ${l.cells} cells, ${l.painted} captioned`,
    )
    // The PAIRS, not the tally: "605 mismatches" says a probe fired, `Stundensatz` captioned
    // `Telefon` says what shipped. Capped so one broken screen cannot bury the next.
    for (const b of l.bad.slice(0, 8)) {
      console.log(`       col ${b.col} of "${b.row}" — ${b.why}: want "${b.want}", got "${b.got}"`)
    }
    if (l.bad.length > 8) console.log(`       …and ${l.bad.length - 8} more`)
  }
}

// A run that saw no rows checked nothing, and would print all-ok. Same for a run in which no
// caption was ever PAINTED: `content: none` everywhere compares equal to nothing and passes.
// These are vacuity guards on the run, not the assertion — the assertion above is text.
if (seenRows < 100) {
  console.log(`\nFAILED — only ${seenRows} rows seen; this check cannot have run.`)
  failed++
}
if (seenPainted < 200) {
  console.log(`\nFAILED — only ${seenPainted} painted captions seen; the caption check cannot have run.`)
  failed++
}

console.log(
  `\n${failed === 0 ? 'shape: OK' : `${failed} FAILED`} — ${seenRows} rows inspected, ${seenCells} card cells, ${seenPainted} captions read.`,
)
shutdown()
process.exit(failed === 0 ? 0 : 1)
