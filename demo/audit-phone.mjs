// Phone-layout audit: 390px and 360px, both themes, every screen.
//
//   node demo/audit-phone.mjs                 # writes /tmp/ts-audit/phone/*.png
//
// TWO CHECKS, AND THE SECOND ONE IS NOT AUTOMATABLE.
//
//  1. Machine: no horizontal scroll at 360px, and the data-label captions on the cards match
//     the column headings POSITION FOR POSITION. components/ResponsiveTableLabels.tsx walks
//     `[...row.children]`, so the leading `<th scope=row>` counts; drop it or insert a column
//     and every card is captioned with the wrong heading. This reads the labels back off the
//     DOM and compares them to the thead, which is the assertion that was missing when this
//     shipped wrong once already.
//  2. Human: the screenshots. The file's own history says every automated assertion stayed
//     green while cards were captioned with the wrong column, so the PNGs below exist to be
//     opened. A green run here is necessary and not sufficient.
import { mkdirSync, readFileSync } from 'node:fs'
import { attach, launchChrome, sleep } from './cdp.mjs'

/**
 * How many destinations the sidebar is SUPPOSED to have, counted out of the source of truth
 * rather than typed in here. Nine since decision-39; it was three too many for a while, and
 * a stale literal made every screen fail for a reason that had already been decided.
 * Regex over the file, deliberately: this is a plain node script with no TypeScript loader,
 * and importing lib/nav.ts would need one. It is scoped to the NAV_GROUPS block and counts
 * `href:` inside it — NOT `^\s*\{ href:`, which was the first version and answered 8, because
 * the account group is written on one line and its entry never starts one. A count that is
 * quietly one short is worse than no count: it fails every screen and blames the sidebar.
 */
const NAV_SOURCE = readFileSync('web/lib/nav.ts', 'utf8')
const NAV_BLOCK = NAV_SOURCE.slice(
  NAV_SOURCE.indexOf('export const NAV_GROUPS'),
  NAV_SOURCE.indexOf('export const OFF_NAV_ROUTES'),
)
const NAV_COUNT = (NAV_BLOCK.match(/href:/g) ?? []).length
if (NAV_COUNT < 2) throw new Error(`audit-phone: read ${NAV_COUNT} nav entries out of web/lib/nav.ts`)

const BASE = process.env.AUDIT_BASE ?? 'http://127.0.0.1:8082'
const OUT = '/tmp/ts-audit/phone'
const ADMIN = { email: 'demo@example.test', password: 'demo-nur-lokal-2026' }

mkdirSync(OUT, { recursive: true })

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

const results = []
const record = (ok, label, detail = '') => {
  results.push({ ok, label, detail })
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `  — ${detail}` : ''}`)
}

const chrome = await launchChrome({ port: Number(process.env.AUDIT_PORT ?? 9404), width: 390, height: 900 })
const page = await attach(chrome.port)

async function viewport(width, height = 900) {
  await page.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 2,
    mobile: true,
  })
}

await viewport(1280, 900)
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

for (const theme of ['dark', 'light']) {
  console.log(`\n=== ${theme} @360px ===`)
  await viewport(360)
  for (const path of SCREENS) {
    await page.goto(`${BASE}${path}`, { settle: 1400 })
    await page.eval(
      `localStorage.setItem('nfcts.theme', ${JSON.stringify(theme)});
       document.documentElement.setAttribute('data-theme', ${JSON.stringify(theme)})`,
    )
    await sleep(250)

    const report = await page.eval(`(() => {
      const out = {}
      out.overflowBy = document.documentElement.scrollWidth - document.documentElement.clientWidth
      // Which elements are actually wider than the viewport — a number alone is unfixable.
      out.culprits = [...document.querySelectorAll('*')]
        .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1)
        .slice(0, 4)
        .map((el) => el.tagName + '.' + String(el.className).split(' ')[0] +
             ' right=' + Math.round(el.getBoundingClientRect().right))

      // Is the sidebar still reachable? Q5: the strip must NOT be display:none.
      const nav = document.querySelector('nav.sidebar')
      out.navVisible = nav ? getComputedStyle(nav).display !== 'none' && nav.getClientRects().length > 0 : null
      out.navLinks = nav ? nav.querySelectorAll('a').length : 0

      // The card captions, read back off the DOM and compared to the thead, position for
      // position. A mismatch here is the failure that shipped green once before.
      out.captions = [...document.querySelectorAll('table.data-table')].map((t) => {
        const heads = [...t.querySelectorAll('thead th')].map((h) => h.textContent.trim())
        const row = t.querySelector('tbody tr')
        if (!row) return { heads: heads.length, rows: 0, mismatch: null }
        const cells = [...row.children]
        const bad = cells.map((c, i) => {
          const want = heads[i] ?? ''
          const got = c.getAttribute('data-label') ?? ''
          if (c.tagName !== 'TD') return got === '' ? null : 'TH#' + i + ' has data-label "' + got + '"'
          if (want === '') return got === '' ? null : 'TD#' + i + ' labelled "' + got + '" but heading is empty'
          return got === want ? null : 'TD#' + i + ' labelled "' + got + '" want "' + want + '"'
        }).filter(Boolean)
        return { heads: heads.length, cells: cells.length, mismatch: bad }
      })

      // Touch targets: nothing interactive under 44px on a phone.
      out.smallTargets = [...document.querySelectorAll('button, a[href], input, select, textarea')]
        .filter((el) => {
          const r = el.getBoundingClientRect()
          return r.width > 0 && r.height > 0 && r.height < 44 && !el.classList.contains('visually-hidden')
        })
        .slice(0, 6)
        .map((el) => el.tagName + '.' + String(el.className).split(' ')[0] + ' h=' + Math.round(el.getBoundingClientRect().height))
      return out
    })()`)

    const file = `${OUT}/${theme}-360${path.replace(/\//g, '_') || '_root'}.png`
    await page.eval(`window.scrollTo(0, 0)`)
    await page.screenshot(file)

    const problems = []
    if (report.overflowBy > 1) {
      problems.push(`h-scroll +${report.overflowBy}px: ${report.culprits.join(', ')}`)
    }
    if (path !== '/reinigung/' && report.navVisible === false) {
      problems.push('sidebar hidden — Q5 says it must stay as a strip')
    }
    // READ FROM web/lib/nav.ts, never a literal. This said `12` for as long as decision-39
    // has said NINE, so every screen carried a failure asserting a superseded decision —
    // and a check that is red for a reason nobody can act on stops being read at all.
    // Counting the source means moving a route in or out of the sidebar updates this by
    // construction, which is what the number was always meant to track.
    if (path !== '/reinigung/' && report.navLinks !== NAV_COUNT) {
      problems.push(`${report.navLinks} nav links, expected ${NAV_COUNT} (web/lib/nav.ts)`)
    }
    const capProblems = report.captions.flatMap((c) => c.mismatch ?? [])
    if (capProblems.length) problems.push(`card captions: ${capProblems.join(' | ')}`)
    if (report.smallTargets.length) problems.push(`<44px: ${report.smallTargets.join(', ')}`)

    record(problems.length === 0, `${theme} 360 ${path}`, problems.join(' || '))
  }
}

console.log(`\nscreenshots: ${OUT}`)
const failed = results.filter((r) => !r.ok)
console.log(`${results.length - failed.length}/${results.length} passed, ${failed.length} FAILED`)
console.log('LOOK AT THE PNGs. Green here has been wrong before.')

page.close()
chrome.child.kill()
process.exit(failed.length === 0 ? 0 : 1)
