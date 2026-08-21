// PHONE #6 (LOOK-PHONE.md): below 768px the nav becomes a horizontally scrolling strip
// (globals.css) that always opened scrolled to its LEFT edge. `aria-current="page"` was
// rendered on the right element — a screen reader was told — but a director looking at the
// screen was not: on 7 of 9 destinations the "you are here" mark sat 300-500px off to the
// right, never visible. Fixed in components/SidebarNav.tsx: a `useEffect` keyed on
// `pathname` calls `scrollIntoView({ inline: 'nearest', block: 'nearest' })` on the current
// link, which is a no-op on desktop (the strip never scrolls there) and moves the phone
// strip's scroll offset — never its own vertical position — into place on every navigation.
//
//   DEMO_BASE=http://127.0.0.1:8083 node demo/check-nav-scroll.mjs
//
// No new dependency: demo/cdp.mjs, Node, the Chrome already on the machine.
import { attach, launchChrome, sleep } from './cdp.mjs'

const BASE = process.env.DEMO_BASE ?? 'http://127.0.0.1:8083'
const host = new URL(BASE).hostname
if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(host)) {
  console.error(`check-nav-scroll: refusing "${host}" — loopback only.`)
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
    port: 9860 + (process.pid % 200),
    width: 390,
    height: 844,
  })
  const page = await attach(port)
  try {
    await page.goto(`${BASE}/login/`, { settle: 700 })
    await page.waitFor(`document.querySelector('form button[type="submit"]')`, { label: 'sign-in button' })
    await page.type('input[name="email"]', ADMIN.email, { perChar: 0 })
    await page.type('input[name="password"]', ADMIN.password, { perChar: 0 })
    await page.clickText('Anmelden', { selector: 'form button[type="submit"]' })
    await page.waitFor("location.pathname === '/'", { timeout: 15000, label: 'the dashboard' })

    // The two ends of the strip: /  is the first entry (always visible, proves nothing) and
    // /account/ is the LAST — nine destinations, "Konto" was the one LOOK-PHONE measured
    // 300-500px off to the right.
    for (const path of ['/', '/account/']) {
      await page.goto(`${BASE}${path}`, { settle: 900 })
      await page.waitFor(`document.querySelector('.sidebar [aria-current="page"]')`, {
        label: 'the current nav entry',
      })
      await sleep(200)

      const geom = await page.eval(`(() => {
        const current = document.querySelector('.sidebar [aria-current="page"]')
        const sidebar = document.querySelector('.sidebar')
        const rect = current.getBoundingClientRect()
        const sidebarRect = sidebar.getBoundingClientRect()
        return {
          text: current.textContent,
          left: Math.round(rect.left - sidebarRect.left),
          right: Math.round(rect.right - sidebarRect.left),
          strip: Math.round(sidebarRect.width),
        }
      })()`)

      console.log(`  ${path}  current="${geom.text}"  [${geom.left}, ${geom.right}] of ${geom.strip}px strip`)
      assert(
        `${path}: the "you are here" entry ("${geom.text}") is inside the visible strip, not scrolled off`,
        geom.left >= 0 && geom.right <= geom.strip,
        `[${geom.left}, ${geom.right}] vs strip width ${geom.strip}`,
      )
    }
  } finally {
    child.kill('SIGKILL')
  }

  console.log(failures ? `\ncheck-nav-scroll: FAIL (${failures})` : '\ncheck-nav-scroll: OK')
  process.exit(failures ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
