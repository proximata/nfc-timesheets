// C10 (LOOK.md) — `.btn-quiet` rendered with no border, no fill and body colour, so on
// /locations/ a row carrying FOUR of them ("Zonen verwalten", "Mit X teilen", "Bearbeiten",
// "Deaktivieren") was indistinguishable from the plain data cells beside it.
// "Mit Lena Hofbauer teilen" in particular read as a STATUS ("shared with Lena Hofbauer"),
// not a control that mints a link.
//
// FIX: an underline, the one affordance that survives greyscale and costs no layout space -
// muted (--border-strong) at rest so it still reads as "quiet", full colour on hover/focus.
//
//   DEMO_BASE=http://127.0.0.1:8083 node demo/check-btn-quiet-underline.mjs
//
// No new dependency: demo/cdp.mjs, Node, the Chrome already on the machine.
import { attach, launchChrome, sleep } from './cdp.mjs'

const BASE = process.env.DEMO_BASE ?? 'http://127.0.0.1:8083'
const host = new URL(BASE).hostname
if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(host)) {
  console.error(`check-btn-quiet-underline: refusing "${host}" — loopback only.`)
  process.exit(1)
}

const ADMIN = { email: 'demo@example.test', password: 'demo-nur-lokal-2026' }

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
    port: 9900 + (process.pid % 200),
    width: 1680,
    height: 1050,
  })
  const page = await attach(port)
  try {
    await page.goto(`${BASE}/login/`, { settle: 700 })
    await page.waitFor(`document.querySelector('form button[type="submit"]')`, { label: 'sign-in button' })
    await page.type('input[name="email"]', ADMIN.email, { perChar: 0 })
    await page.type('input[name="password"]', ADMIN.password, { perChar: 0 })
    await page.clickText('Anmelden', { selector: 'form button[type="submit"]' })
    await page.waitFor("location.pathname === '/'", { timeout: 15000, label: 'the dashboard' })

    await page.goto(`${BASE}/locations/`, { settle: 900 })
    await page.waitFor(`document.querySelector('.btn-quiet')`, { label: 'a row action' })
    await sleep(200)

    const r = await page.eval(`(() => {
      const buttons = [...document.querySelectorAll('.btn-quiet')].filter((el) => el.offsetParent !== null)
      const plainCells = [...document.querySelectorAll('td')].filter(
        (el) => el.children.length === 0 && el.textContent.trim() && el.offsetParent !== null,
      )
      return {
        quietCount: buttons.length,
        quietUnderlined: buttons.every((el) => getComputedStyle(el).textDecorationLine.includes('underline')),
        plainCellCount: plainCells.length,
        plainCellUnderlined: plainCells.some((el) => getComputedStyle(el).textDecorationLine.includes('underline')),
      }
    })()`)

    console.log(`  /locations/: ${JSON.stringify(r)}`)
    assert('at least one .btn-quiet row action is present on /locations/', r.quietCount > 0, `count ${r.quietCount}`)
    assert('every visible .btn-quiet is underlined', r.quietUnderlined)
    assert(
      'plain data cells stay UN-underlined (the affordance is exclusive to actions)',
      r.plainCellCount === 0 || !r.plainCellUnderlined,
    )
  } finally {
    child.kill('SIGKILL')
  }

  console.log(failures ? `\ncheck-btn-quiet-underline: FAIL (${failures})` : '\ncheck-btn-quiet-underline: OK')
  process.exit(failures ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
