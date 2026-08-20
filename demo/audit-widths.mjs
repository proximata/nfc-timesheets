// Horizontal overflow, ELEVEN widths, every screen, plus every screen with its panel open.
//
//   node demo/audit-widths.mjs                    # against http://127.0.0.1:8080
//   AUDIT_BASE=http://127.0.0.1:8092 node demo/audit-widths.mjs
//
// WHY ELEVEN AND NOT TWO. The redesign review's R1 was a horizontal scrollbar between 768px
// and 1439px — a band with no endpoint in it. Testing 390 and 1680 said the layout was fine
// at both ends of a range it was broken across the middle of, twice. So the widths below are
// the BREAKPOINT EDGES AND THE MIDDLE OF EVERY BAND BETWEEN THEM:
//
//   767   the last phone pixel      768   the first tablet pixel (`.data-table` stops being cards)
//   800   inside the tablet band    900   inside the tablet band, wider
//   1024  --desktop-min             1152  inside the desktop band
//   1280  the common laptop         1366  the other common laptop
//   1439  the last pixel before     1440  the width the design was drawn at
//   1680  the director's monitor
//
// A CULPRIT, NOT A NUMBER. `scrollWidth - clientWidth` says a page overflows; it does not say
// what by, and an overflow report without an element is a bug nobody can start on. Every
// failure below names the widest offending elements and their right edges.
//
// THE PANELS ARE MEASURED TOO. `?location=` and `?worker=` put a drawer over the page and a
// chip above it — both introduced this round — and a drawer that overflows is a drawer whose
// close button is off screen. An audit that only ever measures the resting state measures
// the state nobody has a problem with.
//
// AND BOTH THEMES AT ALL ELEVEN WIDTHS. This file used to measure the light theme at 1024px
// only, with the reasoning that „the light theme is the same layout with different paint" —
// which is the same reasoning that produced „390 and 1680 are fine, so the range between
// them is fine", i.e. R1. Paint is not free: a light-theme token can carry a different
// border width or a different shadow spread, `.map-pin-flag.is-notag` paints a
// repeating-linear-gradient, and a single extra pixel of border on a table that is already
// at the edge of its column budget is an overflow at ONE width and nowhere else. Assuming a
// theme away is exactly the shape of assumption this file exists to refuse.
import { mkdirSync, readFileSync } from 'node:fs'
import { attach, launchChrome, sleep } from './cdp.mjs'

/**
 * The localStorage key the app itself persists the theme under, READ OUT OF THE SOURCE.
 *
 * Not a literal, because a literal is what was here first and it was WRONG: `ts-theme`,
 * while `web/lib/theme.ts` writes `nfcts.theme`. `THEME_INIT_SCRIPT` runs on every page load
 * and reads the real key, so a wrong key means the theme reverts to dark on the next
 * navigation — i.e. a „light" pass that measures the dark theme and agrees with itself. The
 * same wrong literal is in demo/probe-zones-revenue.mjs, where it is masked because that
 * probe re-applies `data-theme` after every goto.
 *
 * A FAILURE, never a fallback: a default here would restore exactly the silent-dark bug.
 */
const THEME_STORAGE_KEY = (() => {
  const src = readFileSync(new URL('../web/lib/theme.ts', import.meta.url), 'utf8')
  const hit = src.match(/THEME_STORAGE_KEY\s*=\s*'([^']+)'/)
  if (!hit) throw new Error('audit-widths: cannot read THEME_STORAGE_KEY from web/lib/theme.ts')
  return hit[1]
})()

const BASE = process.env.AUDIT_BASE ?? 'http://127.0.0.1:8080'
const OUT = '/tmp/ts-audit/widths'
const ADMIN = { email: 'demo@example.test', password: 'demo-nur-lokal-2026' }

if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(new URL(BASE).hostname)) {
  console.error('audit-widths: loopback only.')
  process.exit(1)
}

/** Breakpoint edges AND the middles between them. See the header for why. */
const WIDTHS = [767, 768, 800, 900, 1024, 1152, 1280, 1366, 1439, 1440, 1680]

/** Both, at every width. See the header for why this is not one theme plus an assumption. */
const THEMES = ['dark', 'light']

const SCREENS = [
  '/',
  '/shifts/',
  '/material-requests/',
  '/workers/',
  '/locations/',
  '/clients/',
  '/contracts/',
  '/inventory/',
  '/operators/',
  '/payroll/',
  '/pl/',
  '/analytics/',
  '/account/',
  '/reinigung/',
]

/**
 * The states this round ADDED, each one a URL. Measured at every width like any other
 * screen, because a panel is a layout and not a decoration.
 */
const OPEN_STATES = [
  ['/ with the Objektpanel', '/?location=%LOCATION%'],
  ['/shifts/ filtered by a building', '/shifts/?location=%LOCATION%&period=all'],
  ['/workers/ with the worker panel', '/workers/?worker=1'],
  ['/locations/ with the edit drawer', '/locations/?open=%LOCATION%'],
  ['/payroll/ filtered by a building', '/payroll/?location=%LOCATION%&period=lastMonth'],
  ['/pl/ filtered by a building', '/pl/?location=%LOCATION%&period=lastMonth'],
]

mkdirSync(OUT, { recursive: true })

const results = []
const record = (ok, label, detail = '') => {
  results.push({ ok, label, detail })
  if (!ok) console.log(`  FAIL ${label}  — ${detail}`)
}

const chrome = await launchChrome({
  port: Number(process.env.AUDIT_PORT ?? 9422),
  width: 1440,
  height: 900,
})
const page = await attach(chrome.port)

async function viewport(width) {
  await page.send('Emulation.setDeviceMetricsOverride', {
    width,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  })
}

/**
 * Overflow, and WHO. `documentElement.scrollWidth` alone is one pixel of rounding away from
 * a false positive on a fractional layout, so the tolerance is 1px and the culprits are read
 * with the same tolerance.
 */
const OVERFLOW = `(() => {
  const by = document.documentElement.scrollWidth - document.documentElement.clientWidth
  const limit = window.innerWidth + 1
  // An element inside a CLIPPING ancestor cannot widen the page: Google's map draws its
  // tiles far outside the viewport and \`.map-canvas\` clips them, so counting those as
  // culprits buries the real one under four tiles every single time.
  const clipped = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const o = getComputedStyle(p)
      if (/hidden|clip|auto|scroll/.test(o.overflowX)) return true
    }
    return false
  }
  const over = [...document.querySelectorAll('body *')]
    .filter((el) => {
      const r = el.getBoundingClientRect()
      return r.width > 0 && r.right > limit && !clipped(el)
    })
  // The DEEPEST offenders, not the outermost. Naming the outermost is the obvious choice and
  // it is wrong: a 4000px child STRETCHES its container, so the outermost element is always a
  // wrapper doing nothing wrong, and the thing that actually overflows is filtered out as one
  // of its children. Measured — the self-test at the bottom of this file caught exactly that.
  const overSet = new Set(over)
  const culprits = over
    .filter((el) => ![...el.children].some((child) => overSet.has(child)))
    .sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right)
    .slice(0, 4)
    .map((el) => {
      const r = el.getBoundingClientRect()
      const cls = String(el.className).split(' ').filter(Boolean).slice(0, 2).join('.')
      return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (cls ? '.' + cls : '') +
        ' right=' + Math.round(r.right) + ' w=' + Math.round(r.width)
    })
  return { by, culprits, inner: window.innerWidth }
})()`

async function login() {
  await viewport(1440)
  await page.goto(`${BASE}/login/`, { settle: 600 })
  await page.type('input[name="email"]', ADMIN.email, { perChar: 0 })
  await page.type('input[name="password"]', ADMIN.password, { perChar: 0 })
  await page.clickText('Anmelden', { selector: 'form button[type="submit"]' })
  await page.waitFor(`location.pathname === '/'`, { timeout: 15000, label: 'the dashboard' })
}

/**
 * Set the theme the way the app itself persists it, so it SURVIVES the next navigation.
 * Setting `data-theme` on the element alone does not: `THEME_INIT_SCRIPT` runs on every
 * page load and reads localStorage, so an attribute set after `goto` is wiped by the goto
 * after it — and every measurement but the first would silently be a dark-theme one.
 */
async function setTheme(theme) {
  await page.eval(`(() => {
    try { localStorage.setItem(${JSON.stringify(THEME_STORAGE_KEY)}, ${JSON.stringify(theme)}) } catch {}
    document.documentElement.setAttribute('data-theme', ${JSON.stringify(theme)})
    return document.documentElement.getAttribute('data-theme')
  })()`)
}

async function measure(label, url, width, theme) {
  await page.goto(`${BASE}${url}`, { settle: 1100 })
  await sleep(200)
  // Read back rather than trust: a theme that did not stick turns the whole light pass into
  // a second dark pass that agrees with the first, which is worse than not running it.
  const applied = await page.eval(`document.documentElement.getAttribute('data-theme')`)
  if (applied !== theme) {
    record(false, `${width}px ${theme} ${label}`, `theme did not stick: data-theme=${applied}`)
    return { by: 0, culprits: [] }
  }
  const report = await page.eval(OVERFLOW)
  const ok = report.by <= 1
  if (!ok) {
    const slug = label.replace(/[^a-z0-9]+/gi, '_')
    await page.screenshot(`${OUT}/overflow-${width}-${theme}-${slug}.png`)
  }
  record(
    ok,
    `${width}px ${theme} ${label}`,
    `+${report.by}px — ${report.culprits.join(' | ') || 'no element found wider than the viewport'}`,
  )
  return report
}

await login()

// The uuid is read out of the running admin rather than typed in, so this file does not
// carry a fixture id that goes stale the next time the seed is regenerated.
await page.goto(`${BASE}/locations/`, { settle: 1200 })
await page.waitFor(`document.querySelector('table.data-table tbody th a')`, { label: 'a building' })
const LOCATION = await page.eval(
  `(document.querySelector('table.data-table tbody th a').getAttribute('href').split('=')[1])`,
)
if (!/^[0-9a-f-]{36}$/.test(LOCATION)) throw new Error(`no building uuid: ${LOCATION}`)

for (const theme of THEMES) {
  await setTheme(theme)
  for (const width of WIDTHS) {
    console.log(`\n=== ${width}px ${theme} ===`)
    await viewport(width)
    for (const path of SCREENS) await measure(path, path, width, theme)
    for (const [label, url] of OPEN_STATES) {
      await measure(label, url.replace('%LOCATION%', LOCATION), width, theme)
    }
  }
}

// The theme really is being switched, and the page really does repaint. Without this, every
// „light" line above could be a dark measurement wearing a label — the exact failure the
// read-back in `measure` guards against, stated once as an assertion of its own so that a
// silent regression in `setTheme` is a FAILURE and not merely 209 duplicated numbers.
console.log('\n=== the two themes are actually two different paints ===')
const PAINT = `(() => {
  const cs = getComputedStyle(document.body)
  return { theme: document.documentElement.getAttribute('data-theme'), bg: cs.backgroundColor, fg: cs.color }
})()`
await viewport(1280)
await setTheme('dark')
await page.goto(`${BASE}/`, { settle: 900 })
const darkPaint = await page.eval(PAINT)
await setTheme('light')
await page.goto(`${BASE}/`, { settle: 900 })
const lightPaint = await page.eval(PAINT)
record(
  darkPaint.theme === 'dark' &&
    lightPaint.theme === 'light' &&
    darkPaint.bg !== lightPaint.bg &&
    darkPaint.fg !== lightPaint.fg,
  'the light pass is not a second dark pass',
  `dark ${darkPaint.bg}/${darkPaint.fg} vs light ${lightPaint.bg}/${lightPaint.fg}`,
)
await setTheme('dark')

// ---------------------------------------------------------------------------------------
// THE PROBE MUST BE ABLE TO GO RED, and 222 green lines are exactly the shape of a check
// that cannot. So the last thing this run does is BREAK the page on purpose — a 4000px box
// inside #main-content — and require the probe to report it, with the culprit named. If this
// line does not fail, nothing above it means anything.
console.log('\n=== self-test: the probe is sabotaged and must report it ===')
await viewport(1280)
await page.goto(`${BASE}/`, { settle: 1000 })
await page.eval(`(() => {
  const wide = document.createElement('div')
  wide.className = 'audit-sabotage'
  wide.style.cssText = 'width:4000px;height:8px'
  document.getElementById('main-content').append(wide)
  return true
})()`)
await sleep(200)
const sabotaged = await page.eval(OVERFLOW)
console.log(`       probe says: +${sabotaged.by}px — ${sabotaged.culprits.join(' | ')}`)
record(
  sabotaged.by > 1 && sabotaged.culprits.some((c) => c.includes('audit-sabotage')),
  'self-test: a deliberately 4000px-wide element is DETECTED and NAMED',
  `+${sabotaged.by}px — ${sabotaged.culprits.join(' | ') || 'the probe saw nothing'}`,
)

const failed = results.filter((r) => !r.ok)
console.log(
  `\n${results.length - 2} measurements across ${WIDTHS.length} widths ` +
    `× ${SCREENS.length + OPEN_STATES.length} states × ${THEMES.length} themes.`,
)
console.log(`${results.length - failed.length}/${results.length} passed, ${failed.length} FAILED`)
if (failed.length) console.log(`screenshots of every failure: ${OUT}`)

page.close()
chrome.child.kill()
process.exit(failed.length === 0 ? 0 : 1)
