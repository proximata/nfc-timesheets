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

let failed = 0
let seenRows = 0
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
  }
}

// A run that saw no rows checked nothing, and would print all-ok.
if (seenRows < 100) {
  console.log(`\nFAILED — only ${seenRows} rows seen; this check cannot have run.`)
  failed++
}

console.log(`\n${failed === 0 ? 'shape: OK' : `${failed} FAILED`} — ${seenRows} rows inspected.`)
shutdown()
process.exit(failed === 0 ? 0 : 1)
