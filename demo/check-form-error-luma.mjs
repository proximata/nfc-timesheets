// TASK-229 (1) / LOOK.md §5 — greyscale pass: an error message must not read QUIETER than
// the ordinary text beside it. Desaturate every screenshot and .form-error's red (--danger,
// luma ~146 in dark mode) sat DARKER than an ordinary paragraph's --text-primary (~234) and
// even darker than the dimmer --text-secondary prose next to it (~173) — remove the hue and
// the failure message read as LESS important than the text it was correcting. Colour was the
// ONLY signal, pointing the wrong way, which DESIGN.md §3.4 forbids outright.
//
// FIX: a dedicated --danger-text token (dark theme only; light theme's dark-on-white error
// text was never dimmer than its surroundings) used by .form-error and .field-error, left
// distinct from --danger so .btn-danger's solid fill and the invalid-field border — neither
// of which had this complaint — are untouched.
//
//   DEMO_BASE=http://127.0.0.1:8083 node demo/check-form-error-luma.mjs
//
// Measured by painting the browser's OWN resolved colour into a canvas and reading the
// bytes back (oklch() cannot be parsed by hand without a second colour engine — the exact
// mistake that first over-stated this as a 4x gap before it was measured this way).
// No new dependency: demo/cdp.mjs, Node, the Chrome already on the machine.
import { attach, launchChrome, sleep } from './cdp.mjs'

const BASE = process.env.DEMO_BASE ?? 'http://127.0.0.1:8083'
const host = new URL(BASE).hostname
if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(host)) {
  console.error(`check-form-error-luma: refusing "${host}" — loopback only.`)
  process.exit(1)
}

let failures = 0
const assert = (name, cond, detail) => {
  if (cond) {
    console.log(`  ok   ${name}`)
  } else {
    failures++
    console.log(`  FAIL ${name}${detail ? `  ${detail}` : ''}`)
  }
}

async function main() {
  const { child, port } = await launchChrome({
    port: 9880 + (process.pid % 200),
    width: 1280,
    height: 800,
  })
  const page = await attach(port)
  try {
    await page.goto(`${BASE}/login/`, { settle: 700 })

    const r = await page.eval(`(() => {
      function rgbOf(colorStr) {
        const canvas = document.createElement('canvas')
        canvas.width = 1
        canvas.height = 1
        const ctx = canvas.getContext('2d')
        ctx.fillStyle = colorStr
        ctx.fillRect(0, 0, 1, 1)
        const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
        return { r, g, b }
      }
      function luma({ r, g, b }) {
        return 0.2126 * r + 0.7152 * g + 0.0722 * b
      }
      function lumaOf(className) {
        const el = document.createElement('p')
        if (className) el.className = className
        el.textContent = 'x'
        document.body.appendChild(el)
        const rgb = rgbOf(getComputedStyle(el).color)
        document.body.removeChild(el)
        return luma(rgb)
      }
      return {
        formError: lumaOf('form-error'),
        fieldError: lumaOf('field-error'),
        bodyPrimary: lumaOf(null),
        bodySecondary: lumaOf('question'), // .question: color: var(--text-secondary)
      }
    })()`)

    console.log(`  dark theme luma: ${JSON.stringify(r)}`)
    assert(
      '.form-error is NOT dimmer than plain body text (--text-primary)',
      r.formError >= r.bodyPrimary * 0.6,
      `form-error ${r.formError.toFixed(1)} vs body ${r.bodyPrimary.toFixed(1)}`,
    )
    assert(
      '.form-error is NOT dimmer than the dimmer secondary prose beside it',
      r.formError >= r.bodySecondary,
      `form-error ${r.formError.toFixed(1)} vs secondary ${r.bodySecondary.toFixed(1)}`,
    )
    assert(
      '.field-error is NOT dimmer than the dimmer secondary prose beside it',
      r.fieldError >= r.bodySecondary,
      `field-error ${r.fieldError.toFixed(1)} vs secondary ${r.bodySecondary.toFixed(1)}`,
    )
  } finally {
    child.kill('SIGKILL')
  }

  console.log(failures ? `\ncheck-form-error-luma: FAIL (${failures})` : '\ncheck-form-error-luma: OK')
  process.exit(failures ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
