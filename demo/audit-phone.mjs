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

      // TOUCH TARGETS: nothing interactive under 44px on a phone — with TWO NAMED
      // EXCEPTIONS, classified here rather than absorbed by a per-screen allowlist.
      //
      // This check exited 1 on 24 of 26 screens for months (REDESIGN-REVIEW.md R3). Every
      // one of those 24 lines was one of the two shapes below, both argued and accepted in
      // REDESIGN-FIX.md §5 — so a genuine new small control would have arrived as a 25th
      // red line under 24 that everybody had learned to scroll past. A gate that is always
      // red is not a gate.
      //
      // The exceptions are CLASSIFIED, not listed by screen, so they cannot go stale: each
      // one restates the WCAG clause that permits it and is re-tested on every element.
      //
      //   BRAND     the header wordmark, 24x24. WCAG 2.5.8 (AA) asks 24x24; 44px is this
      //             house's own AAA-flavoured floor. Below 24 in EITHER dimension it is a
      //             real failure again, so shrinking the header cannot hide behind this.
      //   IN A      2.5.8 excepts a target „in a sentence or [whose] size is otherwise
      //   SENTENCE  constrained by the line-height of non-target text". Enforced literally:
      //             the link's own block must carry MORE text than the link. A lone link in
      //             an empty <li> is not a sentence and still fails.
      const classify = (el) => {
        const r = el.getBoundingClientRect()
        if (el.tagName === 'A' && el.classList.contains('brand')) {
          return r.width >= 24 && r.height >= 24 ? 'brand 24x24 (WCAG 2.5.8 AA)' : null
        }
        if (el.tagName !== 'A') return null
        const block = el.closest('p, li, td, dd, figcaption, blockquote')
        if (block === null) return null
        const own = (el.textContent || '').replace(/\s+/g, ' ').trim()
        const all = (block.textContent || '').replace(/\s+/g, ' ').trim()
        return own !== '' && all.length > own.length + 8 ? 'in a sentence (WCAG 2.5.8)' : null
      }
      const small = [...document.querySelectorAll('button, a[href], input, select, textarea')]
        .filter((el) => {
          const r = el.getBoundingClientRect()
          return r.width > 0 && r.height > 0 && r.height < 44 && !el.classList.contains('visually-hidden')
        })
      const describe = (el) =>
        el.tagName + '.' + (String(el.className).split(' ')[0] || '-') +
        ' h=' + Math.round(el.getBoundingClientRect().height) +
        ' „' + (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 32) + '"'
      out.smallTargets = small.filter((el) => classify(el) === null).slice(0, 6).map(describe)
      out.exceptedTargets = small
        .filter((el) => classify(el) !== null)
        .slice(0, 6)
        .map((el) => describe(el) + ' [' + classify(el) + ']')
      // VACUITY GUARD for the exception itself. The brand link is on every admin screen; if
      // it stops being found, the classifier has silently stopped matching anything and the
      // „excepted" bucket would be empty for the wrong reason.
      out.brandFound = document.querySelector('a.brand') !== null
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
    // /reinigung/ is the public client portal and carries no admin header.
    if (path !== '/reinigung/' && report.brandFound !== true) {
      problems.push('no a.brand — the 24x24 exception matched nothing, so it proves nothing')
    }

    record(
      problems.length === 0,
      `${theme} 360 ${path}`,
      problems.join(' || ') ||
        (report.exceptedTargets.length
          ? `accepted <44px: ${report.exceptedTargets.join(', ')}`
          : ''),
    )
  }
}

console.log(`\nscreenshots: ${OUT}`)
const failed = results.filter((r) => !r.ok)
console.log(`${results.length - failed.length}/${results.length} passed, ${failed.length} FAILED`)
console.log('LOOK AT THE PNGs. Green here has been wrong before.')

page.close()
chrome.child.kill()
process.exit(failed.length === 0 ? 0 : 1)
