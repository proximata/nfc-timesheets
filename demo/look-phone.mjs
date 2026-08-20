// LOOK at the admin and the client portal on a phone. Not an assertion sweep — a camera.
//
//   node demo/look-phone.mjs                    # 390 dark + light, full page, docs/media/look/
//   LOOK_WIDTHS=360,390,414 node demo/look-phone.mjs
//
// WHY THIS EXISTS BESIDE demo/audit-phone.mjs. That file asserts: no horizontal scroll, no
// target under 44px, captions match the thead position for position. All of those assertions
// were GREEN while the cards on this product were captioned with the wrong column, because
// the transform and the assertion read the same DOM the same way and agreed with each other.
// So this script's product is PNGs of WHOLE screens (captureBeyondViewport, not the fold) and
// a dump of every caption→cell pair AS TEXT, which a human then reads. It fails nothing.
//
// It also renders each shot a second time through a CSS greyscale filter, because
// docs/brand/DESIGN.md §3.4 makes "readable when desaturated" the actual test, and eyeballing
// a colour screenshot cannot answer it.
import { mkdirSync, writeFileSync } from 'node:fs'
import { attach, launchChrome, sleep } from './cdp.mjs'

const BASE = process.env.LOOK_BASE ?? 'http://127.0.0.1:8080'
const OUT = process.env.LOOK_OUT ?? 'docs/media/look-phone'
const WIDTHS = (process.env.LOOK_WIDTHS ?? '390').split(',').map(Number)
const THEMES = (process.env.LOOK_THEMES ?? 'dark,light').split(',')
const ADMIN = { email: 'demo@example.test', password: 'demo-nur-lokal-2026' }

const SCREENS = [
  ['/', 'home'],
  ['/shifts/', 'shifts'],
  ['/material-requests/', 'materials'],
  ['/workers/', 'workers'],
  ['/locations/', 'locations'],
  ['/clients/', 'clients'],
  ['/payroll/', 'payroll'],
  ['/pl/', 'pl'],
  ['/contracts/', 'contracts'],
  ['/analytics/', 'analytics'],
  ['/inventory/', 'inventory'],
  ['/operators/', 'operators'],
  ['/tags/', 'tags'],
  ['/account/', 'account'],
]

mkdirSync(OUT, { recursive: true })
const notes = []
const say = (line) => {
  notes.push(line)
  console.log(line)
}

const chrome = await launchChrome({ port: Number(process.env.LOOK_PORT ?? 9421), width: 390, height: 844 })
const page = await attach(chrome.port)

async function viewport(width, height = 844) {
  await page.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 2,
    mobile: true,
    screenWidth: width,
    screenHeight: height,
  })
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
}

/** Full page, not the fold. A phone screen that is fine above 844px and broken below it is
 *  exactly the class of defect a viewport-sized shot hides. */
async function shoot(file, { grey = false } = {}) {
  await page.eval(`window.scrollTo(0,0)`)
  if (grey) {
    await page.eval(`(() => {
      let s = document.getElementById('__look_grey')
      if (!s) { s = document.createElement('style'); s.id = '__look_grey'; document.head.appendChild(s) }
      s.textContent = 'html{filter:grayscale(1) !important}'
      return true
    })()`)
    await sleep(120)
  }
  const { data } = await page.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
  })
  writeFileSync(file, Buffer.from(data, 'base64'))
  if (grey) await page.eval(`document.getElementById('__look_grey')?.remove()`)
}

// ---- sign in ------------------------------------------------------------------------
await viewport(1280, 900)
await page.goto(`${BASE}/login/`, { settle: 700 })
await page.eval(`(() => {
  const [u, p] = document.querySelectorAll('input')
  const set = (el, v) => {
    Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  set(u, ${JSON.stringify(ADMIN.email)}); set(p, ${JSON.stringify(ADMIN.password)})
  document.querySelector('form').requestSubmit(); return true
})()`)
await page.waitFor(`location.pathname === '/'`, { timeout: 15000, label: 'signed in' })
say(`signed in at ${BASE}`)

// ---- the sweep ----------------------------------------------------------------------
for (const width of WIDTHS) {
  for (const theme of THEMES) {
    await viewport(width)
    for (const [path, name] of SCREENS) {
      await page.goto(`${BASE}${path}`, { settle: 1600 })
      await page.eval(
        `localStorage.setItem('nfcts.theme', ${JSON.stringify(theme)});
         document.documentElement.setAttribute('data-theme', ${JSON.stringify(theme)})`,
      )
      await sleep(400)

      const report = await page.eval(`(() => {
        const out = { path: location.pathname }
        out.overflowBy = document.documentElement.scrollWidth - document.documentElement.clientWidth
        out.docHeight = document.documentElement.scrollHeight
        out.wide = [...document.querySelectorAll('*')]
          .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1)
          .slice(0, 6)
          .map((el) => el.tagName + '.' + String(el.className).split(' ')[0] +
               ' r=' + Math.round(el.getBoundingClientRect().right))

        // EVERY caption paired with the TEXT OF THE CELL IT CAPTIONS, for every row, not
        // just the first. The known failure captioned a timestamp "Objekt"; that is only
        // visible if you read the pair, so the pair is what gets printed.
        out.tables = [...document.querySelectorAll('table.data-table')].map((t) => {
          const heads = [...t.querySelectorAll('thead th')].map((h) => h.textContent.trim())
          const cap = t.querySelector('caption')
          const rows = [...t.querySelectorAll('tbody tr')].slice(0, 3).map((r) =>
            [...r.children].map((c, i) => ({
              tag: c.tagName,
              head: heads[i] ?? '(no heading)',
              label: c.getAttribute('data-label') ?? '',
              text: (c.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 44),
            })),
          )
          return { caption: cap ? cap.textContent.trim() : null, heads, rowCount: t.querySelectorAll('tbody tr').length, rows }
        })

        // Anything interactive under 44 in EITHER dimension, with its own words attached.
        out.small = [...document.querySelectorAll('button, a[href], input, select, textarea, [role=button], [tabindex]')]
          .map((el) => ({ el, r: el.getBoundingClientRect() }))
          .filter(({ el, r }) => r.width > 0 && r.height > 0 && (r.height < 44 || r.width < 44) &&
                                 !el.classList.contains('visually-hidden'))
          .map(({ el, r }) => Math.round(r.width) + 'x' + Math.round(r.height) + ' ' + el.tagName +
               '.' + (String(el.className).split(' ')[0] || '-') +
               ' „' + (el.textContent || el.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim().slice(0, 34) + '"')

        // HOVER-ONLY AFFORDANCES. A :hover rule that is the only way to reveal something is
        // unusable on a touch screen. Read out of the stylesheets, not guessed.
        out.hoverOnly = []
        for (const sheet of document.styleSheets) {
          let rules
          try { rules = sheet.cssRules } catch { continue }
          for (const rule of rules) {
            if (!rule.selectorText || !rule.selectorText.includes(':hover')) continue
            const s = rule.style
            const reveals = ['display', 'visibility', 'opacity', 'transform', 'max-height', 'height', 'width']
              .filter((p) => s.getPropertyValue(p) !== '')
            const dangerous = reveals.filter((p) => {
              const v = s.getPropertyValue(p)
              return (p === 'display' && v !== 'none') || (p === 'visibility' && v === 'visible') ||
                     (p === 'opacity' && Number(v) >= 0.9)
            })
            if (dangerous.length) out.hoverOnly.push(rule.selectorText + ' { ' + dangerous.map((p) => p + ':' + s.getPropertyValue(p)).join('; ') + ' }')
          }
        }
        out.hoverOnly = [...new Set(out.hoverOnly)].slice(0, 8)

        out.h1 = (document.querySelector('h1')?.textContent || '').replace(/\\s+/g, ' ').trim()
        out.navVisible = (() => {
          const n = document.querySelector('nav.sidebar')
          return n ? getComputedStyle(n).display !== 'none' && n.getClientRects().length > 0 : null
        })()
        return out
      })()`)

      const stem = `${OUT}/${width}-${theme}-${name}`
      await shoot(`${stem}.png`)
      if (theme === 'dark' && width === 390) await shoot(`${stem}-grey.png`, { grey: true })

      writeFileSync(`${stem}.json`, JSON.stringify(report, null, 1))
      const flags = []
      if (report.overflowBy > 1) flags.push(`H-SCROLL +${report.overflowBy} (${report.wide.join(', ')})`)
      if (report.small.length) flags.push(`${report.small.length} under 44`)
      if (report.hoverOnly.length) flags.push(`${report.hoverOnly.length} hover-reveal rules`)
      say(`${width} ${theme} ${path.padEnd(20)} h=${report.docHeight}px  ${flags.join(' | ') || 'clean'}`)
    }
  }
}

writeFileSync(`${OUT}/_log.txt`, `${notes.join('\n')}\n`)
console.log(`\nshots + json: ${OUT}`)
page.close()
chrome.child.kill()
