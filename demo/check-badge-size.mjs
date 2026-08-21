// PHONE #7 (LOOK-PHONE.md): `.badge` / `.shift-state` rendered at 0.6875rem (11px) — below
// DESIGN.md §4's own stated type-scale floor of 0.75rem (12px). This is the pill that says
// whether a shift is paid, read in a stairwell, in daylight, at the smallest size on the
// screen carrying the largest consequence. Contrast was never the problem
// (demo/audit-contrast.mjs already passed every state token at 4.5:1+) — this is a SIZE
// finding, fixed by raising the one declared font-size to the floor.
//
//   DEMO_BASE=http://127.0.0.1:8083 node demo/check-badge-size.mjs
//
// No new dependency: demo/cdp.mjs, Node, the Chrome already on the machine.
import { attach, launchChrome, sleep } from './cdp.mjs'

const BASE = process.env.DEMO_BASE ?? 'http://127.0.0.1:8083'
const host = new URL(BASE).hostname
if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(host)) {
  console.error(`check-badge-size: refusing "${host}" — loopback only.`)
  process.exit(1)
}

const ADMIN = { email: 'demo@example.test', password: 'demo-nur-lokal-2026' }
const FLOOR_PX = 12 // DESIGN.md §4: 0.75rem is the smallest step on the type scale.

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
    port: 9940 + (process.pid % 200),
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

    await page.goto(`${BASE}/shifts/`, { settle: 900 })
    await page.waitFor(`document.querySelector('.badge, .shift-state')`, { label: 'a state pill' })
    await sleep(200)

    const r = await page.eval(`(() => {
      const pills = [...document.querySelectorAll('.badge, .shift-state')].filter((el) => el.offsetParent !== null)
      return {
        count: pills.length,
        sizes: [...new Set(pills.map((el) => getComputedStyle(el).fontSize))],
      }
    })()`)

    console.log(`  /shifts/: ${r.count} state pills, sizes ${JSON.stringify(r.sizes)}`)
    assert('at least one state pill is present on /shifts/', r.count > 0, `count ${r.count}`)
    for (const size of r.sizes) {
      const px = Number.parseFloat(size)
      assert(`pill font-size ${size} is at or above the ${FLOOR_PX}px floor`, px >= FLOOR_PX)
    }
  } finally {
    child.kill('SIGKILL')
  }

  console.log(failures ? `\ncheck-badge-size: FAIL (${failures})` : '\ncheck-badge-size: OK')
  process.exit(failures ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
