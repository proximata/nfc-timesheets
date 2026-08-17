// Is the focus ring VISIBLE, on every tab stop, against the surface it is actually drawn on?
//
//   node demo/audit-focus-ring.mjs             # writes /tmp/ts-audit/focus/*.png
//   AUDIT_SCREEN=/locations/ node demo/audit-focus-ring.mjs
//
// Two things are measured per tab stop, and the second is the one that gets forgotten:
//
//   1. there IS an outline: `outline-style` is not `none` and `outline-width` is >= 2px.
//   2. that outline has >= 3:1 contrast (WCAG 1.4.11) against WHAT IS BEHIND IT. The ring is
//      drawn at `outline-offset` OUTSIDE the element's own box, so the surface behind it is
//      the nearest ancestor with a non-transparent background — NOT the element's own. A ring
//      measured against the button it surrounds scores the wrong pair, and a blue ring on a
//      blue primary button passes a check like that while being invisible.
//
// Colours are resolved through Chrome's own engine (canvas fillStyle + getImageData) because
// the tokens are oklch(); the alternative is a second colour-space implementation in this
// file. Alpha is composited, not divided out.
//
// The screenshots exist to be LOOKED AT. Every automated ring check in the world passes on a
// ring that is 1px of near-black on near-black at the far edge of a 2px offset.
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { attach, launchChrome, sleep } from './cdp.mjs'

const BASE = process.env.AUDIT_BASE ?? 'http://127.0.0.1:8082'
const SCREEN = process.env.AUDIT_SCREEN ?? '/workers/'
const OUT = '/tmp/ts-audit/focus'
const ADMIN = { email: 'demo@example.test', password: 'demo-nur-lokal-2026' }
const MAX_STOPS = Number(process.env.AUDIT_STOPS ?? 40)
mkdirSync(OUT, { recursive: true })

const chrome = await launchChrome({ port: Number(process.env.AUDIT_PORT ?? 9408), width: 1440, height: 900 })
const page = await attach(chrome.port)

/**
 * Photograph the ring around one element and PROVE the photograph contains it.
 *
 * The first version used `Page.captureScreenshot({ clip })`, whose clip is in PAGE coordinates
 * while `getBoundingClientRect()` returns VIEWPORT coordinates. Tab scrolls the page, so from
 * the first stop below the fold every crop was taken hundreds of pixels above the element —
 * and for the drawer, whose surface is `position: fixed`, it produced files of flat #0b0c0e
 * that this audit happily reported at 7.26:1. Hence both halves: crop with ffmpeg out of a
 * full-viewport frame so the coordinate systems match, then scan the crop for the ring's own
 * colour and fail if it is not in the image.
 *
 * Returns the share of pixels within tolerance of the ring colour. 0 means the picture does
 * not show what the number claims — the only interesting failure mode of a probe that reads
 * computed styles.
 */
function shootRing(frameB64, rect, ringRgb, outFile) {
  const pad = 14
  const frame = `${OUT}/.frame.png`
  writeFileSync(frame, Buffer.from(frameB64, 'base64'))
  const x = Math.max(0, Math.round(rect.x - pad))
  const y = Math.max(0, Math.round(rect.y - pad))
  const w = Math.round(rect.w + pad * 2)
  const h = Math.round(rect.h + pad * 2)
  execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error', '-i', frame, '-vf', `crop=${w}:${h}:${x}:${y}`, outFile,
  ])
  const raw = execFileSync(
    'ffmpeg',
    ['-loglevel', 'error', '-i', outFile, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
    { maxBuffer: 1 << 28 },
  )
  let hits = 0
  for (let i = 0; i + 2 < raw.length; i += 3) {
    if (
      Math.abs(raw[i] - ringRgb.r) <= 26 &&
      Math.abs(raw[i + 1] - ringRgb.g) <= 26 &&
      Math.abs(raw[i + 2] - ringRgb.b) <= 26
    ) {
      hits++
    }
  }
  return hits / (raw.length / 3)
}

async function tab() {
  for (const type of ['rawKeyDown', 'keyUp']) {
    await page.send('Input.dispatchKeyEvent', { type, windowsVirtualKeyCode: 9, code: 'Tab', key: 'Tab' })
  }
  await sleep(70)
}

/** Installed once per document: the colour maths, so it is not re-sent on every tab stop. */
const HELPERS = `
  window.__rgba = (value) => {
    const c = window.__cv ?? (window.__cv = document.createElement('canvas'))
    c.width = 1; c.height = 1
    const ctx = c.getContext('2d', { willReadFrequently: true })
    ctx.clearRect(0, 0, 1, 1)
    ctx.fillStyle = '#000'
    ctx.fillStyle = value
    ctx.clearRect(0, 0, 1, 1)
    ctx.fillStyle = value
    ctx.fillRect(0, 0, 1, 1)
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
    return { r, g, b, a: a / 255 }
  }
  window.__over = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  })
  window.__lum = (c) => {
    const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4) }
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b)
  }
  window.__ratio = (a, b) => {
    const [hi, lo] = [window.__lum(a), window.__lum(b)].sort((x, y) => y - x)
    return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100
  }
  /** The first ancestor that actually paints something, composited down to the page base. */
  window.__behind = (el) => {
    const base = window.__rgba(getComputedStyle(document.documentElement).getPropertyValue('--bg-base').trim() || '#fff')
    let node = el.parentElement
    const layers = []
    while (node) {
      const c = window.__rgba(getComputedStyle(node).backgroundColor)
      if (c.a > 0) layers.push(c)
      if (c.a >= 1) break
      node = node.parentElement
    }
    let acc = base
    for (const layer of layers.reverse()) acc = window.__over(layer, acc)
    return acc
  }
  true
`

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

for (const theme of ['dark', 'light']) {
  console.log(`\n=== ${theme} — ${SCREEN} ===`)
  await page.goto(`${BASE}${SCREEN}`, { settle: 1400 })
  await page.eval(
    `localStorage.setItem('nfcts.theme', ${JSON.stringify(theme)});
     document.documentElement.setAttribute('data-theme', ${JSON.stringify(theme)})`,
  )
  await sleep(250)
  await page.eval(HELPERS)
  await page.eval(`(document.activeElement || document.body).blur()`)

  const seen = new Set()
  const bad = []
  const blank = []
  let stops = 0
  let shots = 0
  for (let i = 0; i < MAX_STOPS; i++) {
    await tab()
    const info = await page.eval(`(() => {
      const el = document.activeElement
      if (!el || el === document.body) return null
      const cs = getComputedStyle(el)
      const r = el.getBoundingClientRect()
      const ring = window.__rgba(cs.outlineColor)
      const behind = window.__behind(el)
      return {
        tag: el.tagName,
        ring: window.__over(ring, behind),
        cls: String(el.className).split(' ').slice(0, 2).join('.'),
        text: (el.getAttribute('aria-label') || el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 34),
        style: cs.outlineStyle,
        width: Number.parseFloat(cs.outlineWidth),
        offset: cs.outlineOffset,
        color: cs.outlineColor,
        ratio: window.__ratio(window.__over(ring, behind), behind),
        rect: { x: r.x, y: r.y, w: r.width, h: r.height },
      }
    })()`)
    if (info === null) break
    stops++
    const id = `${info.tag}.${info.cls}|${info.text}`
    if (seen.has(id)) continue
    seen.add(id)

    const visible = info.style !== 'none' && info.width >= 2
    const contrast = info.ratio >= 3
    if (!visible || !contrast) {
      bad.push(
        `${info.tag}.${info.cls} "${info.text}" outline=${info.style} ${info.width}px ` +
          `offset=${info.offset} ${info.color} → ${info.ratio}:1`,
      )
    }
    // A handful of real crops, so the ring can be inspected rather than trusted. Filtered to
    // controls that carry the design system's own classes: the first five tab stops are the
    // header's skip link, brand and two <select>s, which is the least interesting ring on the
    // page and was all the unfiltered version ever photographed.
    const worthShooting = /btn|nav-link|row|field/.test(info.cls) || info.tag === 'INPUT'
    if (worthShooting && shots < 6 && info.rect.w > 0 && info.rect.h > 0) {
      const { data } = await page.send('Page.captureScreenshot', { format: 'png' })
      const name = `${OUT}/${theme}-${String(shots).padStart(2, '0')}-${info.tag.toLowerCase()}.png`
      const share = shootRing(data, info.rect, info.ring, name)
      console.log(
        `       shot ${name}  (${info.text || info.cls}) ring ${info.ratio}:1  ` +
          `ring pixels in the crop: ${(share * 100).toFixed(2)}%`,
      )
      if (share <= 0) blank.push(`${name} (${info.tag}.${info.cls} "${info.text}")`)
      shots++
    }
  }

  record(stops > 5, `${theme}: ${SCREEN} has a reachable tab order`, `${stops} stops, ${seen.size} distinct`)
  record(bad.length === 0, `${theme}: every tab stop has a >=2px ring at >=3:1`, bad.join(' || '))
  record(
    shots > 0 && blank.length === 0,
    `${theme}: the ring is actually IN every crop that was photographed`,
    blank.length ? `NO ring pixels in: ${blank.join(', ')}` : `${shots} crop(s)`,
  )

  // PHASE 2: the same measurement INSIDE a drawer. The drawer paints --bg-overlay, which is
  // lighter than the page, so a ring that clears 3:1 on the page is not thereby cleared here.
  // Rings inside overlays are also the ones nobody ever photographs.
  const openedDrawer = await page.eval(`(() => {
    const hit = [...document.querySelectorAll('button')]
      .find((b) => (b.textContent || '').includes('anlegen'))
    if (!hit) return false
    hit.click(); return true
  })()`)
  if (!openedDrawer) {
    record(false, `${theme}: a drawer could be opened to measure rings inside it`)
  } else {
    await sleep(450)
    const badInside = []
    const blankInside = []
    let insideStops = 0
    let insideShots = 0
    for (let i = 0; i < 14; i++) {
      await tab()
      const info = await page.eval(`(() => {
        const el = document.activeElement
        if (!el || !el.closest('.drawer, .modal')) return null
        const cs = getComputedStyle(el)
        const r = el.getBoundingClientRect()
        const ring = window.__rgba(cs.outlineColor)
        const behind = window.__behind(el)
        return {
          tag: el.tagName, ring: window.__over(ring, behind),
          cls: String(el.className).split(' ').slice(0, 2).join('.'),
          text: (el.getAttribute('aria-label') || el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 30),
          style: cs.outlineStyle, width: Number.parseFloat(cs.outlineWidth),
          color: cs.outlineColor, ratio: window.__ratio(window.__over(ring, behind), behind),
          rect: { x: r.x, y: r.y, w: r.width, h: r.height },
        }
      })()`)
      if (info === null) continue
      insideStops++
      if (info.style === 'none' || info.width < 2 || info.ratio < 3) {
        badInside.push(`${info.tag}.${info.cls} "${info.text}" ${info.style} ${info.width}px ${info.color} → ${info.ratio}:1`)
      }
      if (insideShots < 3 && info.rect.w > 0) {
        const { data } = await page.send('Page.captureScreenshot', { format: 'png' })
        const name = `${OUT}/${theme}-drawer-${insideShots}-${info.tag.toLowerCase()}.png`
        const share = shootRing(data, info.rect, info.ring, name)
        console.log(
          `       shot ${name}  (${info.text || info.cls}) ring ${info.ratio}:1  ` +
            `ring pixels in the crop: ${(share * 100).toFixed(2)}%`,
        )
        if (share <= 0) blankInside.push(name)
        insideShots++
      }
    }
    record(insideStops >= 3, `${theme}: the drawer has tab stops to measure`, `${insideStops} inside the overlay`)
    record(badInside.length === 0, `${theme}: every ring INSIDE the drawer is >=2px at >=3:1`, badInside.join(' || '))
    record(
      insideShots > 0 && blankInside.length === 0,
      `${theme}: the drawer ring is actually IN every crop`,
      blankInside.length ? `NO ring pixels in: ${blankInside.join(', ')}` : `${insideShots} crop(s)`,
    )
  }
}

console.log(`\nscreenshots: ${OUT}`)
const failed = results.filter((r) => !r.ok)
console.log(`${results.length - failed.length}/${results.length} passed, ${failed.length} FAILED`)
page.close()
chrome.child.kill()
process.exit(failed.length === 0 ? 0 : 1)
