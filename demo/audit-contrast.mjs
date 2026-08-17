// Contrast audit. COMPUTES WCAG ratios from the shipped token values in BOTH themes.
//
//   node demo/audit-contrast.mjs            # against http://127.0.0.1:8082
//   AUDIT_BASE=... node demo/audit-contrast.mjs
//
// Why it drives a browser rather than doing the maths in Node: the tokens are `oklch()`, and
// converting oklch -> sRGB by hand in this file would be a second implementation of the
// colour engine that actually paints the pixels. Chrome already has one. So the resolution
// step is `ctx.fillStyle = <token value>` + `getImageData`, which returns the exact bytes the
// operator's screen receives, including the alpha compositing for the translucent tokens.
//
// Every pair below is a pair that EXISTS on screen — read out of globals.css, not invented.
// A ratio for a combination nothing renders is a number that cannot fail.
import { attach, launchChrome } from './cdp.mjs'

const BASE = process.env.AUDIT_BASE ?? 'http://127.0.0.1:8082'

/**
 * text-on-surface pairs, `[foreground token, background token, what renders it, tier]`.
 * tier: 'body' → 4.5:1 required. 'large' → 3:1 (>=18.66px bold or >=24px).
 * 'ui' → 3:1, a boundary or a graphical object (WCAG 1.4.11).
 */
const PAIRS = [
  ['--text-primary', '--bg-base', 'body copy on the page', 'body'],
  ['--text-primary', '--bg-raised', 'body copy inside .list / .drawer', 'body'],
  ['--text-primary', '--bg-overlay', 'text on a drawer footer / .btn-quiet hover', 'body'],
  ['--text-primary', '--bg-sunken', 'text on a sunken surface', 'body'],
  ['--text-secondary', '--bg-base', '.question, .lh h2, nav links', 'body'],
  ['--text-secondary', '--bg-raised', '.field-hint, .sub inside a panel', 'body'],
  ['--text-secondary', '--bg-overlay', '.btn-quiet label on its hover surface', 'body'],
  ['--text-muted', '--bg-base', '.cell-muted, .tag-uuid, .empty-state', 'body'],
  ['--text-muted', '--bg-raised', '.cell-muted inside a table in a .list', 'body'],
  ['--text-muted', '--bg-overlay', '.step above a drawer title', 'body'],
  ['--accent', '--bg-base', 'a link / .btn-quiet accent text', 'body'],
  ['--accent', '--bg-raised', 'accent text inside a panel', 'body'],
  ['--accent-text', '--accent', 'label inside .btn-primary', 'body'],
  ['--danger', '--bg-base', '.form-error text', 'body'],
  ['--danger', '--bg-raised', '.form-error inside a drawer', 'body'],
  ['--ok', '--bg-base', '.form-status text', 'body'],
  ['--ok', '--bg-raised', '.form-status inside a panel', 'body'],
  ['--state-open', '--bg-base', '.badge.open word + the 3px rule', 'ui'],
  ['--state-open', '--bg-raised', '.badge.open inside a panel', 'ui'],
  ['--state-unres', '--bg-base', '.badge.unres word + the 3px rule', 'ui'],
  ['--state-unres', '--bg-raised', '.badge.unres inside a panel', 'ui'],
  ['--state-corrected', '--bg-base', '.badge.corr word + the 3px rule', 'ui'],
  ['--state-corrected', '--bg-raised', '.badge.corr inside a panel', 'ui'],
  ['--border', '--bg-base', 'table hairline / panel edge', 'ui'],
  ['--border', '--bg-raised', 'hairline inside a panel', 'ui'],
  ['--border-strong', '--bg-base', '.btn-ghost outline, input outline', 'ui'],
  ['--border-strong', '--bg-raised', '.btn-ghost inside a drawer', 'ui'],
  ['--focus', '--bg-base', ':focus-visible ring on the page', 'ui'],
  ['--focus', '--bg-raised', ':focus-visible ring inside a panel', 'ui'],
]

const REQUIRED = { body: 4.5, large: 3, ui: 3 }

// A port of our own. launchChrome's poll of /json/version succeeds against ANY Chrome on
// that port, so a leftover browser on the 9333 default is silently adopted — and then wiped
// out from under itself by the profile rmSync. That is the "hung headless Chrome at 0% CPU"
// this repo already lost 49 minutes to.
const chrome = await launchChrome({ port: Number(process.env.AUDIT_PORT ?? 9401), width: 1280, height: 900 })
const page = await attach(chrome.port)

/**
 * Resolves a list of CSS colour strings to sRGB bytes THROUGH CHROME, then composites any
 * translucent one over its own background and returns the WCAG ratio.
 *
 * The compositing matters: `--border` is `rgba(255,255,255,.08)`, and scoring it as if it
 * were opaque white would report 15:1 for a hairline that is actually barely there.
 */
async function measure(theme) {
  return page.eval(`(() => {
    document.documentElement.setAttribute('data-theme', ${JSON.stringify(theme)})
    const cs = getComputedStyle(document.documentElement)
    const canvas = document.createElement('canvas')
    canvas.width = 1; canvas.height = 1
    const ctx = canvas.getContext('2d', { willReadFrequently: true })

    /**
     * token value -> {r,g,b} 0..255 and {a} 0..1, as Chrome resolves it.
     *
     * getImageData returns NON-premultiplied RGBA (HTML spec), so the channels are the
     * authored ones and must NOT be divided by alpha. Dividing was the first version of
     * this function and it scored rgba(255,255,255,.08) as 21:1 against a near-black
     * page -- a hairline you can barely see, reported as the highest contrast on screen.
     */
    const rgba = (value) => {
      ctx.clearRect(0, 0, 1, 1)
      ctx.fillStyle = '#000'
      ctx.fillStyle = value            // an unparseable value leaves #000 and is caught below
      const parsed = ctx.fillStyle
      ctx.clearRect(0, 0, 1, 1)
      ctx.fillStyle = value
      ctx.fillRect(0, 0, 1, 1)
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
      return { r, g, b, a: a / 255, raw: parsed }
    }

    const over = (fg, bg) => ({
      r: fg.r * fg.a + bg.r * (1 - fg.a),
      g: fg.g * fg.a + bg.g * (1 - fg.a),
      b: fg.b * fg.a + bg.b * (1 - fg.a),
      a: 1,
    })

    const lum = (c) => {
      const f = (v) => {
        const s = v / 255
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
      }
      return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b)
    }

    const pairs = ${JSON.stringify(PAIRS)}
    return pairs.map(([fgToken, bgToken, where, tier]) => {
      const fgRaw = cs.getPropertyValue(fgToken).trim()
      const bgRaw = cs.getPropertyValue(bgToken).trim()
      if (fgRaw === '' || bgRaw === '') {
        return { fgToken, bgToken, where, tier, missing: true }
      }
      // A background token is opaque in this design; composite it over the page base anyway
      // so a future translucent one cannot silently score against nothing.
      const base = rgba(cs.getPropertyValue('--bg-base').trim())
      const bg = over(rgba(bgRaw), base)
      const fg = over(rgba(fgRaw), bg)
      const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x)
      return {
        fgToken, bgToken, where, tier,
        fg: fgRaw, bg: bgRaw,
        ratio: Math.round(((a + 0.05) / (b + 0.05)) * 100) / 100,
      }
    })
  })()`)
}

await page.goto(`${BASE}/login/`, { settle: 400 })

let failures = 0
for (const theme of ['dark', 'light']) {
  const rows = await measure(theme)
  console.log(`\n=== ${theme.toUpperCase()} ===`)
  for (const row of rows) {
    if (row.missing) {
      console.log(`  MISSING TOKEN  ${row.fgToken} on ${row.bgToken}`)
      failures++
      continue
    }
    const need = REQUIRED[row.tier]
    const pass = row.ratio >= need
    if (!pass) failures++
    console.log(
      `  ${pass ? 'ok  ' : 'FAIL'} ${String(row.ratio).padStart(6)}:1  need ${need}:1  ` +
        `${row.fgToken} on ${row.bgToken}  — ${row.where}`,
    )
  }
}

// The negative case has to be reachable, so say what would make it fire.
console.log(
  `\n${failures} contrast failure(s). Mutation check: lighten --text-muted toward its ` +
    `background in globals.css and the two --text-muted rows must go FAIL.`,
)

page.close()
chrome.child.kill()
process.exit(failures === 0 ? 0 : 1)
