// Drive the director's real phone journeys and MEASURE what each one costs.
//
//   node demo/look-journeys.mjs
//
// Not an assertion sweep. Each block below is one thing a director actually does standing in
// a building (JOURNEYS §8 rows 3, 5, 6, 7, 11), driven at 390px through the real DOM, and
// what it prints is the COST: scroll distance, taps, whether the target was even on screen.
// A screen that "works" and costs eleven screen-heights of scrolling is a finding, and no
// pass/fail assertion in this repo can express that.
import { mkdirSync, writeFileSync } from 'node:fs'
import { attach, launchChrome, sleep } from './cdp.mjs'

const BASE = process.env.LOOK_BASE ?? 'http://127.0.0.1:8080'
const OUT = process.env.LOOK_OUT ?? 'docs/media/look-phone'
const ADMIN = { email: 'demo@example.test', password: 'demo-nur-lokal-2026' }
mkdirSync(OUT, { recursive: true })

const log = []
const say = (s) => {
  log.push(s)
  console.log(s)
}

const chrome = await launchChrome({ port: Number(process.env.LOOK_PORT ?? 9423), width: 390, height: 844 })
const page = await attach(chrome.port)
const viewport = (width, height = 844) =>
  page.send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: 2, mobile: true, screenWidth: width, screenHeight: height,
  })

const shoot = async (name) => {
  const { data } = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  writeFileSync(`${OUT}/j-${name}.png`, Buffer.from(data, 'base64'))
}

await viewport(1280, 900)
await page.goto(`${BASE}/login/`, { settle: 700 })
await page.eval(`(() => {
  const [u, p] = document.querySelectorAll('input')
  const set = (el, v) => { Object.getOwnPropertyDescriptor(el.constructor.prototype,'value').set.call(el, v); el.dispatchEvent(new Event('input',{bubbles:true})) }
  set(u, ${JSON.stringify(ADMIN.email)}); set(p, ${JSON.stringify(ADMIN.password)})
  document.querySelector('form').requestSubmit(); return true })()`)
await page.waitFor(`location.pathname === '/'`, { timeout: 15000, label: 'signed in' })

// ---------------------------------------------------------------------------------------
// J0 · NAVIGATION. Nine destinations in a strip 390px wide. How many can be reached without
// a sideways gesture, and does the strip show the director WHERE HE IS?
// ---------------------------------------------------------------------------------------
for (const width of [360, 390, 414]) {
  await viewport(width)
  for (const path of ['/', '/payroll/', '/account/']) {
    await page.goto(`${BASE}${path}`, { settle: 1200 })
    const nav = await page.eval(`(() => {
      const strip = document.querySelector('nav.sidebar')
      const links = [...strip.querySelectorAll('a')]
      const sr = strip.getBoundingClientRect()
      const vis = links.filter((a) => { const r = a.getBoundingClientRect(); return r.left >= sr.left - 1 && r.right <= sr.right + 1 })
      const cur = links.find((a) => a.getAttribute('aria-current') === 'page')
      const curR = cur ? cur.getBoundingClientRect() : null
      return {
        total: links.length,
        fullyVisible: vis.map((a) => a.textContent.trim()),
        scrollable: strip.scrollWidth - strip.clientWidth,
        scrollLeft: strip.scrollLeft,
        current: cur ? cur.textContent.trim() : null,
        currentOnScreen: curR ? curR.left >= sr.left - 1 && curR.right <= sr.right + 1 : null,
        stripHeight: Math.round(sr.height),
      }
    })()`)
    say(`J0 nav ${width} ${path.padEnd(11)} ${nav.fullyVisible.length}/${nav.total} visible [${nav.fullyVisible.join(' · ')}] hidden-behind ${nav.scrollable}px · here="${nav.current}" onScreen=${nav.currentOnScreen}`)
  }
}

// ---------------------------------------------------------------------------------------
// J1 · „who is on site right now" — the daily check (JOURNEYS D4).
// ---------------------------------------------------------------------------------------
await viewport(390)
await page.goto(`${BASE}/`, { settle: 1800 })
const j1 = await page.eval(`(() => {
  const heads = [...document.querySelectorAll('h2, h3')].map((h) => ({ t: h.textContent.trim(), y: Math.round(h.getBoundingClientRect().top + window.scrollY) }))
  const onsite = heads.find((h) => /vor Ort|Eingestempelt|im Einsatz/i.test(h.t))
  return { docHeight: document.documentElement.scrollHeight, heads, onsite }
})()`)
say(`J1 daily check: page ${j1.docHeight}px = ${(j1.docHeight / 844).toFixed(1)} phone screens`)
say(`   sections: ${j1.heads.map((h) => h.t + '@' + h.y).join(' | ')}`)
await shoot('01-home-fold')

// ---------------------------------------------------------------------------------------
// J2 · CORRECT A SHIFT. From the home screen, reach the correction drawer for a named
// worker. Count the taps and the scroll.
// ---------------------------------------------------------------------------------------
await page.goto(`${BASE}/shifts/`, { settle: 2200 })
const j2 = await page.eval(`(() => {
  const out = { docHeight: document.documentElement.scrollHeight }
  const btns = [...document.querySelectorAll('button')].filter((b) => /Korrigieren/i.test(b.textContent))
  out.correctButtons = btns.length
  out.firstAt = btns[0] ? Math.round(btns[0].getBoundingClientRect().top + window.scrollY) : null
  // the filter controls, and whether they are above the first row
  out.selects = [...document.querySelectorAll('select')].map((s) => ({
    label: (s.labels?.[0]?.textContent || s.getAttribute('aria-label') || '').trim(),
    y: Math.round(s.getBoundingClientRect().top + window.scrollY),
  }))
  return out
})()`)
say(`J2 correct: /shifts/ is ${j2.docHeight}px = ${(j2.docHeight / 844).toFixed(1)} phone screens, ${j2.correctButtons} „Korrigieren" buttons, first at y=${j2.firstAt}`)
say(`   filters: ${j2.selects.map((s) => s.label + '@' + s.y).join(' | ')}`)

await page.eval(`[...document.querySelectorAll('button')].find((b) => /Korrigieren/i.test(b.textContent)).click()`)
await sleep(900)
const j2b = await page.eval(`(() => {
  const dlg = document.querySelector('[role=dialog], .drawer, dialog')
  const r = dlg ? dlg.getBoundingClientRect() : null
  return {
    found: !!dlg,
    role: dlg ? dlg.getAttribute('role') : null,
    box: r ? { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top) } : null,
    scrollHeight: dlg ? dlg.scrollHeight : null,
    focused: document.activeElement ? document.activeElement.tagName + ' „' + (document.activeElement.textContent || '').trim().slice(0, 30) + '"' : null,
    bodyScrollLocked: getComputedStyle(document.body).overflow,
    fields: dlg ? [...dlg.querySelectorAll('input, select, textarea')].map((f) => (f.labels?.[0]?.textContent || f.name || f.type).trim()) : [],
    notice: dlg ? (dlg.textContent.match(/[^.]*Zeitmessung[^.]*\\./) || dlg.textContent.match(/[^.]*bestätigt[^.]*\\./) || [null])[0] : null,
  }
})()`)
say(`J2 drawer: ${JSON.stringify(j2b)}`)
await shoot('02-correct-drawer')
// Escape must close it.
await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
await sleep(500)
const escaped = await page.eval(`!document.querySelector('[role=dialog]')`)
say(`J2 Escape closes the drawer: ${escaped}`)

// ---------------------------------------------------------------------------------------
// J3 · ADD A BUILDING (D1 step 3): the 14-field, two-step drawer, on a phone.
// ---------------------------------------------------------------------------------------
await page.goto(`${BASE}/locations/`, { settle: 2000 })
await page.eval(`[...document.querySelectorAll('button')].find((b) => /Neues Objekt|Objekt anlegen|Anlegen/i.test(b.textContent))?.click()`)
await sleep(1000)
const j3 = await page.eval(`(() => {
  const dlg = document.querySelector('[role=dialog], dialog')
  if (!dlg) return { found: false }
  const fields = [...dlg.querySelectorAll('input, select, textarea')]
  return {
    found: true,
    drawerScroll: dlg.scrollHeight,
    viewport: window.innerHeight,
    screens: +(dlg.scrollHeight / window.innerHeight).toFixed(1),
    fieldCount: fields.length,
    fields: fields.map((f) => ({
      label: (f.labels?.[0]?.textContent || f.getAttribute('aria-label') || f.name || f.type).replace(/\\s+/g,' ').trim().slice(0, 40),
      h: Math.round(f.getBoundingClientRect().height),
    })),
    submitText: [...dlg.querySelectorAll('button')].map((b) => b.textContent.replace(/\\s+/g,' ').trim()).join(' / '),
  }
})()`)
say(`J3 add building: ${JSON.stringify(j3).slice(0, 1400)}`)
await shoot('03-building-drawer')

// ---------------------------------------------------------------------------------------
// J4 · ISSUE AN ENROLMENT CODE (D3) — the code is shown ONCE and read down a phone line.
// ---------------------------------------------------------------------------------------
await page.goto(`${BASE}/workers/`, { settle: 2000 })
const before = await page.eval(`document.body.textContent.length`)
await page.eval(`[...document.querySelectorAll('button')].find((b) => /Zugangscode erstellen/i.test(b.textContent))?.click()`)
await sleep(1400)
const j4 = await page.eval(`(() => {
  const code = document.body.textContent.match(/[A-Z0-9]{4}-[A-Z0-9]{4}(-[A-Z0-9]{4})?/)
  const panel = document.querySelector('[role=dialog]') ||
    [...document.querySelectorAll('div, section')].find((d) => /Zugangscode/i.test(d.textContent) && d.querySelector('code, strong, .code'))
  const r = panel ? panel.getBoundingClientRect() : null
  return {
    codeShown: code ? code[0] : null,
    inViewport: r ? r.top >= 0 && r.top < window.innerHeight : null,
    panelTop: r ? Math.round(r.top) : null,
    scrollY: Math.round(window.scrollY),
    focused: document.activeElement ? document.activeElement.tagName + '.' + document.activeElement.className : null,
    workerNameNearCode: (() => {
      if (!code) return null
      // the row this code belongs to must still be identifiable while it is read aloud
      const card = [...document.querySelectorAll('tr, .card')].find((el) => el.textContent.includes(code[0]))
      return card ? card.textContent.replace(/\\s+/g, ' ').trim().slice(0, 90) : null
    })(),
  }
})()`)
say(`J4 enrolment code: ${JSON.stringify(j4)}`)
await shoot('04-enrolment-code')

// ---------------------------------------------------------------------------------------
// J5 · READ THE MONTH'S PAYROLL, in the period that actually has exclusions.
// ---------------------------------------------------------------------------------------
await page.goto(`${BASE}/payroll/`, { settle: 2200 })
for (const value of ['thisMonth', 'lastMonth', 'last30Days']) {
  const ok = await page.eval(`(() => {
    const s = document.querySelector('select')
    if (!s || ![...s.options].some((o) => o.value === ${JSON.stringify(value)})) return false
    const set = Object.getOwnPropertyDescriptor(s.constructor.prototype, 'value').set
    set.call(s, ${JSON.stringify(value)}); s.dispatchEvent(new Event('change', { bubbles: true })); return true
  })()`)
  if (!ok) { say(`J5 payroll ${value}: option absent`); continue }
  await sleep(2200)
  const j5 = await page.eval(`(() => {
    const caveats = [...document.querySelectorAll('li, p')].map((el) => el.textContent.replace(/\\s+/g, ' ').trim())
      .filter((t) => t.length > 25 && /Schicht|Summe|Stundensatz|gezählt|nachgetragen|fehlt|bestätig/i.test(t))
    return {
      period: document.querySelector('select')?.value,
      docHeight: document.documentElement.scrollHeight,
      caveats: [...new Set(caveats)].slice(0, 10),
      excludedCells: [...document.querySelectorAll('td[data-label]')].filter((td) => /Nicht gezählt/.test(td.getAttribute('data-label'))).map((td) => td.textContent.replace(/\\s+/g,' ').trim()).slice(0, 8),
    }
  })()`)
  say(`J5 payroll ${value}: ${j5.docHeight}px; „Nicht gezählt" cells = ${JSON.stringify(j5.excludedCells)}`)
  for (const c of j5.caveats) say(`     • ${c}`)
  await shoot(`05-payroll-${value}`)
}

writeFileSync(`${OUT}/_journeys.txt`, `${log.join('\n')}\n`)
page.close()
chrome.child.kill()
