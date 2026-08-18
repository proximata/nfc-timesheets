// WCAG contrast for the MAP SURFACE, computed — never eyeballed — in both themes.
//
//   node demo/audit-map-contrast.mjs
//
// demo/audit-contrast.mjs scores our own surfaces against each other. It cannot score the
// map, because the map has a background this design does not own: Google's tiles. And it
// composites every translucent token over `--bg-base`, which is the wrong backdrop for
// anything drawn ON the map. `--border-strong` is `rgba(255,255,255,.36)`; over the page it
// is one colour and over a #101216 tile it is another, and the pin's anchor stem — a 1px
// line with nothing else to make it visible — is drawn on the tile.
//
// WHERE THE NUMBERS COME FROM, and why both halves are PARSED rather than read off a screen:
//
//   the tokens   web/app/globals.css is parsed for the `:root` and `[data-theme="light"]`
//                declaration blocks. Parsing the FILE and then also asserting that the
//                browser resolves each token to the same value catches the case a
//                computed-style-only audit cannot: a token declared in the file and
//                overridden somewhere else, i.e. a number that is true of the source and
//                false of the screen.
//   the tiles    web/lib/map.ts is parsed for MAP_STYLE_DARK and MAP_STYLE_LIGHT. Those
//                arrays ARE the map's colours — we chose every one of them — so a pin
//                measured against them is measured against what actually renders. A
//                screenshot sample would be measured against whichever tile happened to be
//                under the pin that run.
//
// The resolution step still goes through Chrome (`ctx.fillStyle` + `getImageData`), because
// the accent tokens are `oklch()` and converting oklch to sRGB in this file would be a
// second implementation of the colour engine that paints the pixels.
//
// TIERS. `body` 4.5:1, `large` 3:1, `ui` 3:1 (WCAG 1.4.11: a boundary, a glyph, or any
// graphical object needed to understand the content).
//
// WHAT IS SCORED AND WHAT IS ONLY MEASURED, because this file spent a round exiting 1 with
// 18 failures of which 2 were defects, and a check that is permanently red is a check
// everybody learns to scroll past:
//
//   SCORED    everything our own surfaces are responsible for: the words in the chip and in
//             the box, the boundary that makes a chip visible against a tile, the focus
//             ring, and the street names — rendered TEXT in a colour we chose.
//   MITIGATED a pair that fails on its own but is carried by another property MEASURED ON
//             THE SAME RUN. The chip's fill is `--bg-overlay`, which IS the dark road
//             colour, so fill-vs-tile is 1:1 BY CONSTRUCTION and always will be; what makes
//             the chip a chip is its 1px border, and 1.4.11 asks for the boundary. So the
//             pair passes only if the mitigation passes, and the run prints both numbers.
//             Delete the border and this goes red — that is the point of writing it this
//             way instead of deleting the row.
//   INFO      measured, printed, NEVER scored, with the reason. Two kinds only: a signal
//             that is redundant reinforcement of a WORD that is itself scored (the `kein
//             Tag` hatching), and Google's own geometry under the muted palette the owner
//             chose in IA-PLAN §9 — road against ground, the Danube, a district boundary.
//             Those last are not our content and nothing on the screen depends on telling
//             them apart: the pins are the data and the Objektliste carries every fact the
//             map shows. Making them meet 3:1 would mean un-muting the map against an
//             explicit decision.
//
// An INFO row cannot fail, so it is not a check and is not counted as one. It is printed so
// the number stays in front of whoever changes the palette next.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { attach, launchChrome } from './cdp.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'web')
const BASE = process.env.AUDIT_BASE ?? 'http://127.0.0.1:8080'

const results = []
const record = (ok, label, detail = '') => {
  results.push({ ok, label, detail })
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `  — ${detail}` : ''}`)
}

// --- parse the token file ---------------------------------------------------------------

const CSS = readFileSync(join(ROOT, 'app/globals.css'), 'utf8')

/** The declarations of one selector's FIRST block. Comments and nested blocks are not in it. */
function tokensOf(selector) {
  const start = CSS.indexOf(`${selector} {`)
  if (start < 0) throw new Error(`audit-map-contrast: no "${selector} {" in app/globals.css`)
  const end = CSS.indexOf('\n}', start)
  const block = CSS.slice(start, end)
  const out = {}
  for (const match of block.matchAll(/^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/gim)) {
    out[match[1]] = match[2].replace(/\/\*[\s\S]*?\*\//g, '').trim()
  }
  return out
}

const DARK_TOKENS = tokensOf(':root')
const LIGHT_TOKENS = { ...DARK_TOKENS, ...tokensOf('[data-theme="light"]') }
if (Object.keys(DARK_TOKENS).length < 15) {
  throw new Error(`audit-map-contrast: parsed only ${Object.keys(DARK_TOKENS).length} tokens`)
}

// --- parse the map style arrays ----------------------------------------------------------

const MAP_TS = readFileSync(join(ROOT, 'lib/map.ts'), 'utf8')

/**
 * The colours one style array paints, keyed by what they paint. Read out of the array rather
 * than duplicated here: the arrays are the map, and a second copy of them in this file would
 * be a second map that never renders.
 */
function mapColoursOf(name) {
  const start = MAP_TS.indexOf(`export const ${name}: MapStyle = [`)
  if (start < 0) throw new Error(`audit-map-contrast: no ${name} in lib/map.ts`)
  const end = MAP_TS.indexOf('\n]', start)
  const block = MAP_TS.slice(start, end)
  const out = {}
  // One entry per `{ … color: '#xxxxxx' }` object, labelled by its featureType/elementType.
  for (const entry of block.split(/\},\s*\n/)) {
    const colour = entry.match(/color:\s*'(#[0-9a-f]{3,8})'/i)?.[1]
    if (colour === undefined) continue
    const feature = entry.match(/featureType:\s*'([^']+)'/)?.[1] ?? 'all'
    const element = entry.match(/elementType:\s*'([^']+)'/)?.[1] ?? 'geometry'
    out[`${feature}/${element}`] = colour
  }
  return out
}

const DARK_MAP = mapColoursOf('MAP_STYLE_DARK')
const LIGHT_MAP = mapColoursOf('MAP_STYLE_LIGHT')
for (const [name, map] of [['dark', DARK_MAP], ['light', LIGHT_MAP]]) {
  if (Object.keys(map).length < 8) {
    throw new Error(`audit-map-contrast: parsed only ${Object.keys(map).length} ${name} map colours`)
  }
}

/**
 * The four backdrops a pin can actually sit on, worst case first. A pin does not choose its
 * tile, so every pair below is scored against ALL of them and the WORST one is the verdict.
 * Scoring against the base geometry only is how a chip that vanishes over water passes.
 */
const BACKDROPS = (map) => ({
  geometry: map['all/geometry'],
  road: map['road/geometry'],
  highway: map['road.highway/geometry'],
  water: map['water/geometry'],
  building: map['landscape.man_made/geometry'],
})

/**
 * Every pair that actually renders on the map surface, read out of the `.map-*` rules in
 * globals.css. `stack` is bottom-to-top: a translucent token is composited over everything
 * beneath it, which is the whole reason `--border-strong` needs two different numbers.
 *
 *   onTile: true  → the pair is scored against every backdrop and reported at its worst.
 */
const PAIRS = [
  // --- the pin chip, over the tiles ---
  {
    fg: '--bg-overlay',
    stack: [],
    onTile: true,
    tier: 'ui',
    where: '.map-pin-label chip fill vs the tile under it',
    // The fill is the tile colour by construction; the 1px border is what draws the chip.
    mitigatedBy: { fg: '--border-strong', stack: ['--bg-overlay'], why: 'its own 1px border' },
  },
  { fg: '--border-strong', stack: ['--bg-overlay'], onTile: true, tier: 'ui', where: '.map-pin-label 1px border, over its own fill, vs the tile' },
  // The one element with NO second signal: 1px wide, straight onto a tile, and the only
  // mark saying which building the chip belongs to. It is `--text-muted` rather than
  // `--border-strong` for exactly that reason — see the rule in globals.css.
  { fg: '--text-muted', stack: [], onTile: true, tier: 'ui', where: '.map-pin::after — the 1px anchor stem, drawn straight onto the tile' },
  { fg: '--accent', stack: ['--bg-raised'], onTile: true, tier: 'ui', where: '.map-pin.is-selected border vs the tile' },

  // --- what is written INSIDE the chip (opaque fill, so the tile does not reach it) ---
  { fg: '--text-primary', stack: ['--bg-overlay'], tier: 'body', where: '.map-pin-name — the building name in the chip' },
  { fg: '--text-secondary', stack: ['--bg-overlay'], tier: 'body', where: '.map-pin-count — „n vor Ort"' },
  { fg: '--text-muted', stack: ['--bg-overlay'], tier: 'body', where: '.map-pin[data-state=empty] count + glyph — „0 vor Ort"' },
  { fg: '--state-open', stack: ['--bg-overlay'], tier: 'ui', where: '● occupied glyph + the 3px left rule' },
  { fg: '--state-unres', stack: ['--bg-overlay'], tier: 'body', where: '.map-pin-flag „prüfen" — a WORD, so body tier' },
  { fg: '--text-muted', stack: ['--bg-overlay'], tier: 'body', where: '.map-pin-flag.is-notag „kein Tag"' },
  // INFO: the hatching is redundant reinforcement of the WORD measured on the line above,
  // which passes at 4.93 (dark) / 5.15 (light). A hatch nobody can see costs nothing; the
  // word is what says the tag is missing, and greyscale proves it (demo/check-ia-greyscale).
  { fg: '--border', stack: ['--bg-overlay'], tier: 'ui', info: true, where: '.map-pin-flag.is-notag hatching — redundant, the WORD above carries it' },
  { fg: '--border-strong', stack: ['--bg-overlay'], tier: 'ui', where: '.map-pin-flag divider rule inside the chip' },
  { fg: '--text-primary', stack: ['--bg-raised'], tier: 'body', where: '.map-pin.is-selected — the same name on the SELECTED fill' },
  { fg: '--text-secondary', stack: ['--bg-raised'], tier: 'body', where: '.map-pin.is-selected count on the selected fill' },

  // --- the info box on the pin ---
  {
    fg: '--bg-raised',
    stack: [],
    onTile: true,
    tier: 'ui',
    where: '.map-info fill vs the tile behind it',
    mitigatedBy: { fg: '--border-strong', stack: ['--bg-raised'], why: 'its own 1px border' },
  },
  { fg: '--border-strong', stack: ['--bg-raised'], onTile: true, tier: 'ui', where: '.map-info border vs the tile' },
  { fg: '--text-primary', stack: ['--bg-raised'], tier: 'body', where: '.map-info-head h3 — the building name' },
  { fg: '--text-muted', stack: ['--bg-raised'], tier: 'body', where: '.map-info .panel-metrics dt — the metric labels' },
  { fg: '--text-secondary', stack: ['--bg-raised'], tier: 'body', where: '.map-info body copy' },
  { fg: '--accent', stack: ['--bg-raised'], tier: 'body', where: '.map-info cross-links — the point of the box' },
  { fg: '--state-unres', stack: ['--bg-raised'], tier: 'body', where: '.map-info unresolved state word' },
  { fg: '--focus', stack: ['--bg-raised'], tier: 'ui', where: ':focus-visible ring on a link inside the box' },
  { fg: '--focus', stack: [], onTile: true, tier: 'ui', where: ':focus-visible ring where it overhangs onto the tile' },
]

/** Google's own labels, in colours WE chose in lib/map.ts. Street names are readable text. */
const MAP_LABEL_PAIRS = [
  { fg: 'all/labels.text.fill', bg: 'all/geometry', tier: 'body', where: 'district + place labels on the base geometry' },
  { fg: 'road/labels.text.fill', bg: 'road/geometry', tier: 'body', where: 'street names on a street' },
  { fg: 'road/labels.text.fill', bg: 'all/geometry', tier: 'body', where: 'a street name that overhangs onto the base geometry' },
  { fg: 'road/labels.text.fill', bg: 'road.highway/geometry', tier: 'body', where: 'a street name on a motorway' },
  { fg: 'road/labels.text.fill', bg: 'water/geometry', tier: 'body', where: 'a street name crossing water' },
  // INFO from here down: Google's geometry against Google's geometry, in the muted palette
  // the owner chose (IA-PLAN §9). A flat field is what „muted" means, and no fact on this
  // screen requires telling a road from the ground — the pins are the data and every number
  // they carry is repeated in words in the Objektliste. Printed every run so the price of
  // that decision stays visible to whoever changes the palette.
  { fg: 'administrative/geometry.stroke', bg: 'all/geometry', tier: 'ui', info: true, where: 'district boundary line (muted by decision)' },
  { fg: 'road/geometry', bg: 'all/geometry', tier: 'ui', info: true, where: 'a road against the ground (muted by decision)' },
  { fg: 'water/geometry', bg: 'all/geometry', tier: 'ui', info: true, where: 'the Danube against the ground (muted by decision)' },
]

const REQUIRED = { body: 4.5, large: 3, ui: 3 }

const chrome = await launchChrome({
  port: Number(process.env.AUDIT_PORT ?? 9424),
  width: 900,
  height: 700,
})
const page = await attach(chrome.port)
await page.goto(`${BASE}/login/`, { settle: 500 })

/**
 * Composite a bottom-to-top stack of CSS colour strings and return the WCAG ratio between
 * the top one and everything under it. Runs in Chrome so `oklch()` is resolved by the engine
 * that paints it.
 */
async function ratio(stack) {
  return page.eval(`(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 1; canvas.height = 1
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    const rgba = (value) => {
      ctx.clearRect(0, 0, 1, 1)
      ctx.fillStyle = '#ff00ff'          // a sentinel: an unparseable value leaves it here
      ctx.fillStyle = value
      if (ctx.fillStyle === '#ff00ff' && !/ff00ff|magenta/i.test(value)) {
        throw new Error('Chrome could not parse the colour: ' + value)
      }
      ctx.clearRect(0, 0, 1, 1)
      ctx.fillStyle = value
      ctx.fillRect(0, 0, 1, 1)
      // getImageData is NON-premultiplied (HTML spec): the channels are the authored ones
      // and must NOT be divided by alpha. Dividing scored rgba(255,255,255,.08) as 21:1.
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
      return { r, g, b, a: a / 255 }
    }
    const over = (fg, bg) => ({
      r: fg.r * fg.a + bg.r * (1 - fg.a),
      g: fg.g * fg.a + bg.g * (1 - fg.a),
      b: fg.b * fg.a + bg.b * (1 - fg.a),
      a: 1,
    })
    const lum = (c) => {
      const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4) }
      return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b)
    }
    const layers = ${JSON.stringify(stack)}.map(rgba)
    let bg = layers[0]
    for (let i = 1; i < layers.length - 1; i++) bg = over(layers[i], bg)
    const fg = over(layers[layers.length - 1], bg)
    const [hi, lo] = [lum(fg), lum(bg)].sort((x, y) => y - x)
    return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100
  })()`)
}

/** Assert that the FILE and the BROWSER agree about every token this run scores. */
async function tokensAgree(theme, tokens) {
  const computed = await page.eval(`(() => {
    document.documentElement.setAttribute('data-theme', ${JSON.stringify(theme)})
    const cs = getComputedStyle(document.documentElement)
    const names = ${JSON.stringify(Object.keys(tokens))}
    return Object.fromEntries(names.map((n) => [n, cs.getPropertyValue(n).trim()]))
  })()`)
  const drift = []
  for (const [name, declared] of Object.entries(tokens)) {
    // Compared as PIXELS, not as strings. `ctx.fillStyle` echoes the colour-function syntax
    // back rather than normalising it (`oklch(…)` stays `oklch(…)`, `getComputedStyle`
    // answers `lab(…)`), so a string comparison reported all seven oklch tokens as drift
    // when every one of them paints the identical colour. Bytes are the only honest test.
    const same = await page.eval(`(() => {
      const c = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
      const bytes = (v) => {
        c.clearRect(0, 0, 1, 1); c.fillStyle = v; c.fillRect(0, 0, 1, 1)
        return [...c.getImageData(0, 0, 1, 1).data].join(',')
      }
      return bytes(${JSON.stringify(declared.startsWith('var(') ? computed[name] : declared)}) === bytes(${JSON.stringify(computed[name])})
    })()`)
    if (!same) drift.push(`${name}: file="${declared}" browser="${computed[name]}"`)
  }
  record(
    drift.length === 0,
    `${theme}: every token parsed out of globals.css resolves to the same colour in the browser`,
    drift.join(' | ') || `${Object.keys(tokens).length} tokens`,
  )
  return computed
}

let failures = 0
for (const [theme, tokens, map] of [
  ['dark', DARK_TOKENS, DARK_MAP],
  ['light', LIGHT_TOKENS, LIGHT_MAP],
]) {
  console.log(`\n=== ${theme.toUpperCase()} ===`)
  const computed = await tokensAgree(theme, tokens)
  const value = (spec) => {
    if (spec.startsWith('--')) {
      const v = tokens[spec] ?? ''
      // A token whose declared value is itself a var() is scored at its RESOLVED value.
      return v === '' || v.startsWith('var(') ? computed[spec] : v
    }
    return spec
  }
  const backdrops = BACKDROPS(map)
  const missing = Object.entries(backdrops).filter(([, c]) => !c)
  if (missing.length) throw new Error(`no ${theme} colour for ${missing.map(([k]) => k).join(', ')}`)

  console.log(`       tiles: ${Object.entries(backdrops).map(([k, v]) => `${k}=${v}`).join(' ')}`)

  /** The worst ratio this pair reaches across every tile a pin can land on. */
  const worstOnTile = async (fg, stack) => {
    const scored = []
    for (const [tile, colour] of Object.entries(backdrops)) {
      scored.push([tile, await ratio([colour, ...stack.map(value), value(fg)])])
    }
    scored.sort((a, b) => a[1] - b[1])
    return scored[0]
  }

  for (const pair of PAIRS) {
    const need = REQUIRED[pair.tier]
    if (pair.onTile) {
      // Scored on EVERY backdrop, reported at its worst. A pin does not pick its tile.
      const [worstTile, worst] = await worstOnTile(pair.fg, pair.stack)
      let ok = worst >= need
      let note = `${pair.fg} on the map (worst: ${worstTile} ${backdrops[worstTile]})`
      if (!ok && pair.mitigatedBy !== undefined) {
        // The pair fails on its own. It passes only if the property that actually makes it
        // visible passes, measured HERE, on this run, against the same worst tile.
        const [tile, mitigated] = await worstOnTile(pair.mitigatedBy.fg, pair.mitigatedBy.stack)
        ok = mitigated >= need
        note += `  — carried by ${pair.mitigatedBy.why} at ${mitigated}:1 on ${tile}`
      }
      if (pair.info === true) {
        console.log(`  info ${String(worst).padStart(6)}:1  (not scored)   ${note}  — ${pair.where}`)
        continue
      }
      if (!ok) failures++
      console.log(
        `  ${ok ? 'ok  ' : 'FAIL'} ${String(worst).padStart(6)}:1  need ${need}:1  ${note}  — ${pair.where}`,
      )
      results.push({ ok, label: `${theme} ${pair.where}`, detail: `${worst}:1 on ${worstTile}` })
    } else {
      const r = await ratio([...pair.stack.map(value), value(pair.fg)])
      if (pair.info === true) {
        console.log(
          `  info ${String(r).padStart(6)}:1  (not scored)   ${pair.fg} on ${pair.stack.join(' + ')}  — ${pair.where}`,
        )
        continue
      }
      const ok = r >= need
      if (!ok) failures++
      console.log(
        `  ${ok ? 'ok  ' : 'FAIL'} ${String(r).padStart(6)}:1  need ${need}:1  ` +
          `${pair.fg} on ${pair.stack.join(' + ')}  — ${pair.where}`,
      )
      results.push({ ok, label: `${theme} ${pair.where}`, detail: `${r}:1` })
    }
  }

  console.log(`  --- the tiles' own colours, which lib/map.ts chose ---`)
  for (const pair of MAP_LABEL_PAIRS) {
    const fg = map[pair.fg]
    const bg = map[pair.bg]
    if (!fg || !bg) {
      // A MISSING colour is always a failure, even for an info row: it means this file and
      // lib/map.ts have drifted, and every number below it is then about a map that is not
      // the one being served.
      console.log(`  MISSING ${pair.fg} or ${pair.bg} in the ${theme} style array`)
      failures++
      continue
    }
    const r = await ratio([bg, fg])
    const need = REQUIRED[pair.tier]
    if (pair.info === true) {
      console.log(`  info ${String(r).padStart(6)}:1  (not scored)   ${fg} on ${bg}  — ${pair.where}`)
      continue
    }
    const ok = r >= need
    if (!ok) failures++
    console.log(
      `  ${ok ? 'ok  ' : 'FAIL'} ${String(r).padStart(6)}:1  need ${need}:1  ${fg} on ${bg}  — ${pair.where}`,
    )
    results.push({ ok, label: `${theme} ${pair.where}`, detail: `${r}:1` })
  }
}

// The negative case has to be REACHABLE, and saying so is not the same as showing it — but
// it is what makes the mutation cheap enough to actually run. All three have been run:
//   --state-unres light 0.55 -> 0.58   the two WORD rows go FAIL (4.34:1)
//   --border-strong -> transparent      the chip and box fills lose their mitigation, FAIL
//   MAP_STYLE_DARK all/geometry -> #8a9099  the anchor stem drops 3.24 -> 1.62, FAIL
console.log(
  '\nMutation check: lighten --border-strong toward its background in globals.css, or lighten\n' +
    "MAP_STYLE_DARK's `all/geometry` in lib/map.ts, and the pin-on-tile rows must go FAIL.",
)
console.log(`\n${failures} contrast failure(s) across ${results.length} scored measurements.`)
for (const r of results.filter((x) => !x.ok)) console.log(`  FAIL ${r.label} — ${r.detail}`)

page.close()
chrome.child.kill()
process.exit(failures === 0 ? 0 : 1)
