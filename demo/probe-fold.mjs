// WHAT IS ON THE FOLD OF THE LANDING SCREEN, before and after the map region was cut.
//
//   node demo/probe-fold.mjs                 # against http://127.0.0.1:8080
//
// THE QUESTION IT ANSWERS. `/` renders, in order: the answer band, the map region (OPTIONAL
// — production has one building and no coordinates, so it draws nothing) and the Objektliste
// (ALWAYS rendered, every building, every path). At 52vh/560px of map, the Objektliste's own
// heading landed at y=964 on a 1000px-tall viewport and not one row of it was on the fold:
// the optional region was holding the fold and the always-rendered one was underneath it.
//
// So this walks the screen top to bottom and reports which landmarks are above the fold and
// how many building rows are fully visible — at the desk (1680x1000) and on a phone
// (390x844) — for the shipped layout AND for the old one, which is reproduced by putting the
// old map height back through a stylesheet rather than by rebuilding a second tree. That is
// the only thing this change touched, so it is the only thing the comparison varies.
//
// It is a PROBE and not a check: it prints geometry and never exits non-zero on a number.
// The assertion that the always-rendered region reaches the fold lives in
// demo/check-map-home.mjs, where it can go red.
import { attach, launchChrome, sleep } from './cdp.mjs'

const BASE = process.env.DEMO_BASE ?? 'http://127.0.0.1:8080'
if (!['127.0.0.1', 'localhost'].includes(new URL(BASE).hostname)) {
  console.error('probe-fold: loopback only.')
  process.exit(1)
}
const ADMIN = { email: 'demo@example.test', password: 'demo-nur-lokal-2026' }

/** The old geometry, restored as a stylesheet: `min(52vh, 560px)` plus the second margin. */
const OLD_MAP_CSS = `.map-canvas { height: min(52vh, 560px) !important; margin-bottom: 16px !important; }`

const LANDMARKS = `(() => {
  const fold = window.innerHeight
  const pick = []
  const add = (label, el) => {
    if (!el) return
    const r = el.getBoundingClientRect()
    if (r.height === 0 && r.width === 0) return
    pick.push({ label, top: Math.round(r.top + window.scrollY), h: Math.round(r.height) })
  }
  add('h1', document.querySelector('h1'))
  add('answer band (the first datum)', document.querySelector('.answer'))
  add('map region heading', document.querySelector('#map-region-heading'))
  add('map canvas', document.querySelector('.map-canvas'))
  add('map status sentence', document.querySelector('.map-region .note'))
  for (const panel of document.querySelectorAll('.list')) {
    const h = panel.querySelector('h2')
    if (h) add('PANEL: ' + h.textContent.trim(), panel)
  }
  const rows = [...document.querySelectorAll('table.objects-table tbody tr')].map((r) => {
    const rect = r.getBoundingClientRect()
    return {
      name: (r.querySelector('th')?.childNodes[0]?.textContent ?? '').trim(),
      top: Math.round(rect.top + window.scrollY),
      bottom: Math.round(rect.bottom + window.scrollY),
    }
  })
  return {
    fold,
    docHeight: Math.round(document.documentElement.scrollHeight),
    landmarks: pick,
    rowsFullyAbove: rows.filter((r) => r.bottom <= fold).map((r) => r.name),
    rowsPartly: rows.filter((r) => r.top < fold && r.bottom > fold).map((r) => r.name),
    totalRows: rows.length,
  }
}) ()`

const configs = [
  { w: 1680, h: 1000, mobile: false },
  { w: 390, h: 844, mobile: true },
]

for (const cfg of configs) {
  const { child, port } = await launchChrome({
    port: cfg.w === 390 ? 9781 : 9780,
    width: cfg.w,
    height: cfg.h,
  })
  const page = await attach(port)
  try {
    await page.send('Emulation.setDeviceMetricsOverride', {
      width: cfg.w,
      height: cfg.h,
      deviceScaleFactor: 1,
      mobile: cfg.mobile,
    })
    await page.goto(`${BASE}/login/`, { settle: 700 })
    await page.type('input[name="email"]', ADMIN.email, { perChar: 0 })
    await page.type('input[name="password"]', ADMIN.password, { perChar: 0 })
    await page.clickText('Anmelden', { selector: 'form button[type="submit"]' })
    await page.waitFor("location.pathname === '/'", { timeout: 20000 })
    await sleep(3500)

    for (const era of ['BEFORE (map at 52vh/560px)', 'AFTER (map at 36vh/400px)']) {
      if (era.startsWith('BEFORE')) {
        await page.eval(
          `(() => { const s = document.createElement('style'); s.id = 'old-map'; s.textContent = ${JSON.stringify(OLD_MAP_CSS)}; document.head.append(s); return true })()`,
        )
      } else {
        await page.eval(`(() => { document.getElementById('old-map')?.remove(); return true })()`)
      }
      await sleep(1200)
      const seen = await page.eval(LANDMARKS)
      console.log(`\n=== ${cfg.w}x${cfg.h} · ${era} ===`)
      console.log(`  document ${seen.docHeight}px, fold at ${seen.fold}px`)
      for (const l of seen.landmarks) {
        console.log(
          `  ${l.top + l.h <= seen.fold ? 'ABOVE ' : l.top < seen.fold ? 'CUT   ' : 'below '} y=${String(l.top).padStart(4)} h=${String(l.h).padStart(4)}  ${l.label}`,
        )
      }
      console.log(
        `  Objektliste rows fully on the fold: ${seen.rowsFullyAbove.length}/${seen.totalRows}` +
          `${seen.rowsFullyAbove.length ? ` — ${seen.rowsFullyAbove.join(', ')}` : ''}` +
          `${seen.rowsPartly.length ? ` · partly: ${seen.rowsPartly.join(', ')}` : ''}`,
      )
    }
  } finally {
    page.close()
    child.kill('SIGKILL')
  }
}
