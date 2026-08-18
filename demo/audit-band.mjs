// The TABLET BAND audit: every screen, every width between the phone card layout and a
// roomy desktop, one number each — documentElement.scrollWidth - clientWidth.
//
//   node demo/audit-band.mjs                  # «stack» on 127.0.0.1:8082 first
//   BAND_DIAG=1 node demo/audit-band.mjs      # also print the min-content driver per table
//
// WHY THIS FILE EXISTS, and it is the whole point of it:
//
// The admin has three layout modes by viewport width — cards ≤767px, a real table that has
// to shrink between 768 and 1439, and a roomy table from 1440 up. `3211e32` verified 390px
// and 1680px, the two widths on either side of the middle band, and shipped a document that
// scrolled sideways at 1024 with /locations/'s Aktionen column — Bearbeiten, Deaktivieren —
// off the right edge and no affordance saying so. decision-28: "Any future screen that
// answers this with a horizontal scrollbar has missed the point of this record."
//
// So this probe does not sample. It walks the WHOLE band plus both boundaries plus the two
// widths the fix pass did check, on all thirteen screens, and it fails on ONE pixel of
// document overflow. Endpoint-only testing cannot be repeated here without deleting code.
//
// AND IT MEASURES TWO MORE THINGS, because document overflow alone reports a clean page for a
// screen that is visibly broken.
//
// SECOND: `section.list` carries `overflow: hidden` for its rounded corner, so a table wider
// than its panel is not scrolled and not overflowed — it is CUT. At 1440 /locations/ rendered
// its last button as "Deakti…" against the panel edge with a document scrollWidth of exactly
// 1440: unreachable, and invisible to every probe that only subtracts clientWidth. So every
// control inside a table is also checked against the box of its nearest clipping ancestor. A
// control that is not fully inside it is a FAIL.
//
// THIRD: a table must fit inside its panel's CONTENT box, not merely inside its border box.
// Those differ by the panel's padding, and a table that has eaten its padding is a table
// whose columns are already past their floor — the pixel before it starts cutting things off.
// `/workers/` did exactly that from 1560 to ~1595, where `.cell-actions` goes back to
// `nowrap`: table 1278px inside a 1262px panel, a button 5px into the padding, nothing cut
// and nothing scrolled. Both of the checks above passed it. This one does not.
//
// It also names the cause, because a number alone is unfixable. `BAND_DIAG=1` clones each
// table into a `width: min-content` box and reads back the per-column minimum widths and the
// cell text that sets each one — that is the floor an auto-layout table cannot go under, and
// the sum of those columns IS the width at which the page starts to scroll.
import { attach, launchChrome, sleep } from './cdp.mjs'

const BASE = process.env.AUDIT_BASE ?? 'http://127.0.0.1:8082'
const ADMIN = { email: 'demo@example.test', password: 'demo-nur-lokal-2026' }
const DIAG = process.env.BAND_DIAG === '1'

// 768–1439 is the band that broke. 767 and 1440 are its boundaries and must stay clean too.
const BAND = [768, 800, 900, 1024, 1152, 1280, 1366, 1439]
// 390 and 1680 are the two widths `3211e32` DID check: they are anchors against a fix that
// trades the band for a regression at the ends.
//
// EVERY BREAKPOINT THE FIX ITSELF INTRODUCES IS ALSO ON THIS LIST, and both sides of it. A
// stylesheet that changes shape at 1280 and again at 1560 has two more places to be wrong,
// and sampling around them is the same mistake that shipped this defect: `/workers/` was
// caught at exactly 1560, where `.cell-actions` goes back to `nowrap` and its min-content
// jumped to 1279px against 1262px of panel. Nothing between 1440 and 1680 had been measured.
const WIDTHS = [390, 767, ...BAND, 1440, 1500, 1559, 1560, 1599, 1600, 1680, 1920]

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
  '/reinigung/',
]

// One live browser, killed from every exit path there is. A previous run in this repo left a
// headless Chrome on a debugging port after a throw, and it sat there for 49 minutes.
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

chrome = await launchChrome({ port: Number(process.env.AUDIT_PORT ?? 9407), width: 1280, height: 900 })
page = await attach(chrome.port)

const viewport = (width, height = 900) =>
  page.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
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

// Measured in the page. Returns the overflow AND, when asked, what is setting the floor.
const MEASURE = (diag) => `(() => {
  const doc = document.documentElement
  const out = {
    width: window.innerWidth,
    overflow: doc.scrollWidth - doc.clientWidth,
    culprits: [...document.querySelectorAll('#main-content *')]
      .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1)
      .slice(0, 4)
      .map((el) => el.tagName.toLowerCase() + '.' + String(el.className).split(' ')[0] +
           '@' + Math.round(el.getBoundingClientRect().right)),
    clipped: [],
    spills: [],
    controls: 0,
    tables: [],
  }

  // A table against the CONTENT box of the block that holds it. clientWidth is that box; the
  // 1px tolerance is for a border landing on a half pixel, not for a column that does not fit.
  for (const table of document.querySelectorAll('table.data-table')) {
    const holder = table.parentElement
    const w = table.getBoundingClientRect().width
    if (w > holder.clientWidth + 1) {
      out.spills.push({
        caption: (table.querySelector('caption')?.textContent ?? '(no caption)').trim().slice(0, 34),
        table: Math.round(w),
        holder: holder.clientWidth,
      })
    }
  }

  // Every control a row offers, against the box that clips it. A button whose right edge is
  // past that box is painted nowhere: no scrollbar reveals it, and nothing on screen says it
  // exists. 1px of tolerance, because a border can land on a half pixel.
  for (const el of document.querySelectorAll('table.data-table button, table.data-table a')) {
    const r = el.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) continue // genuinely not rendered, e.g. hidden dialogs
    out.controls++
    let clip = null
    for (let p = el.parentElement; p; p = p.parentElement) {
      const cs = getComputedStyle(p)
      if (cs.overflowX !== 'visible') { clip = p; break }
    }
    const box = clip ? clip.getBoundingClientRect() : { left: 0, right: window.innerWidth }
    const limit = Math.min(box.right, window.innerWidth)
    if (r.right > limit + 1 || r.left < Math.max(box.left, 0) - 1) {
      out.clipped.push({
        label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 34),
        right: Math.round(r.right),
        limit: Math.round(limit),
        by: clip ? clip.tagName.toLowerCase() + '.' + String(clip.className).split(' ')[0] : 'viewport',
      })
    }
  }
  out.clipped = out.clipped.slice(0, 4)
  if (!${diag}) return out

  // The min-content width of a table is not readable from the laid-out table — it has
  // already been stretched to 100%. Clone it into a width:min-content box INSIDE the same
  // stylesheet context and read the columns back at their floor.
  for (const table of document.querySelectorAll('table.data-table')) {
    const box = document.createElement('div')
    box.style.cssText = 'position:absolute;left:-99999px;top:0;width:min-content;'
    const clone = table.cloneNode(true)
    box.appendChild(clone)
    table.parentElement.appendChild(box)
    const heads = [...clone.querySelectorAll('thead th')]
    const bodyRows = [...clone.querySelectorAll('tbody tr')]
    const cols = heads.map((th, i) => {
      // The cell whose own min-content is widest is the one that sets the column.
      let worst = ''
      let worstLen = -1
      for (const row of bodyRows) {
        const cell = row.children[i]
        if (!cell) continue
        const text = (cell.textContent || '').trim().replace(/\\s+/g, ' ')
        const longest = Math.max(0, ...text.split(' ').map((w) => w.length))
        if (longest > worstLen) { worstLen = longest; worst = text.slice(0, 46) }
      }
      return {
        head: (th.textContent || '').trim(),
        min: Math.round(th.getBoundingClientRect().width),
        worst,
      }
    })
    const min = Math.round(clone.getBoundingClientRect().width)
    box.remove()
    const caption = table.querySelector('caption')
    out.tables.push({
      caption: caption ? caption.textContent.trim().slice(0, 40) : '(no caption)',
      min,
      avail: Math.round(table.parentElement.getBoundingClientRect().width),
      cols: cols.sort((a, b) => b.min - a.min),
    })
  }
  return out
})()`

const rows = []
let seenControls = 0
for (const path of SCREENS) {
  await viewport(WIDTHS[0])
  await page.goto(`${BASE}${path}`, { settle: 1200 })
  const cells = []
  for (const width of WIDTHS) {
    await viewport(width)
    await sleep(220)
    const r = await page.eval(MEASURE(DIAG ? 'true' : 'false'))
    // The emulation override is the only thing that can silently make this probe measure a
    // width it was not asked for, which would turn every "clean" into a lie.
    if (r.width !== width) throw new Error(`viewport ${width} reported ${r.width} on ${path}`)
    cells.push({ width, ...r })
    seenControls += r.controls
    if (DIAG && (r.overflow > 0 || r.clipped.length > 0 || r.spills.length > 0)) {
      console.log(`\n--- ${path} @${width}: +${r.overflow}px — ${r.culprits.join(', ')}`)
      for (const t of r.tables) {
        console.log(`    table "${t.caption}"  min-content ${t.min}px in ${t.avail}px available`)
        for (const c of t.cols.slice(0, 5)) {
          console.log(`      ${String(c.min).padStart(4)}px  ${c.head.padEnd(18)} ${c.worst}`)
        }
      }
    }
  }
  rows.push({ path, cells })
}

const bad = (c) => c.overflow > 0 || c.clipped.length > 0 || c.spills.length > 0

console.log(`\n${'screen'.padEnd(20)}${WIDTHS.map((w) => String(w).padStart(7)).join('')}`)
let failed = 0
for (const row of rows) {
  const line = row.cells
    .map((c) =>
      (c.overflow > 0
        ? `+${c.overflow}`
        : c.clipped.length > 0
          ? `cut${c.clipped.length}`
          : c.spills.length > 0
            ? `sp${c.spills.length}`
            : '·'
      ).padStart(7),
    )
    .join('')
  console.log(`${row.path.padEnd(20)}${line}`)
  failed += row.cells.filter(bad).length
}
console.log(`\n· = 0px of document overflow, no row control cut off, no table past its panel's content box. ${rows.length} screens x ${WIDTHS.length} widths = ${rows.length * WIDTHS.length} measurements, ${seenControls} control positions.`)
// A run that found no controls to check is a run whose second half proved nothing.
if (seenControls < 100) {
  console.log(`\nFAILED — only ${seenControls} controls measured; the clipping half of this probe cannot have run.`)
  shutdown()
  process.exit(1)
}

if (failed > 0) {
  console.log(`\n${failed} FAILED — the document scrolls sideways, or a control is cut off (decision-28).`)
  for (const row of rows) {
    for (const c of row.cells) {
      if (c.overflow > 0) console.log(`  FAIL ${row.path} @${c.width}: +${c.overflow}px — ${c.culprits.join(', ')}`)
      for (const x of c.clipped) {
        console.log(`  FAIL ${row.path} @${c.width}: "${x.label}" ends at ${x.right}px, cut at ${x.limit}px by ${x.by}`)
      }
      for (const x of c.spills) {
        console.log(`  FAIL ${row.path} @${c.width}: table "${x.caption}" is ${x.table}px inside a ${x.holder}px panel`)
      }
    }
  }
} else {
  console.log('\nAll clean. Re-run with BAND_DIAG=1 to see each table\'s min-content floor.')
}

shutdown()
process.exit(failed === 0 ? 0 : 1)
