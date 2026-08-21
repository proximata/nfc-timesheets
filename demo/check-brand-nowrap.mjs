// U5 (LOOK.md) — at 1280px (a 13" MacBook Air's default) the brand wrapped to two lines,
// "NFC" / "TimeSheets", with "Admin" floating beside the first line.
//
// CAUSE: `.app-header` occupies the SAME grid column as the sidebar (`var(--sidebar-w)`,
// `clamp(13rem, 16vw, 19rem)`), which computes to 208px at 1280 — its 13rem floor. `.brand`
// is `display: inline-flex`, so its two children (`.brand-name`, `.brand-suffix`) are
// BLOCKIFIED flex items (CSS Flexbox §2) and each wraps its own text independently of the
// header's available width; "NFC TimeSheets" does not fit in 208px minus padding.
//
// FIX: `white-space: nowrap` on `.brand`, inherited by both spans.
//
//   DEMO_BASE=http://127.0.0.1:8083 node demo/check-brand-nowrap.mjs
//   DEMO_BASE=... BRAND_MUTANT=1 node demo/check-brand-nowrap.mjs   # shows RED on purpose
//
// Reached on `/`, signed in: `/login/` ALSO renders `.brand`, but it renders OUTSIDE
// `.app-shell` (no nav, no sidebar, by design), so its brand sits in the centred auth card
// with the whole viewport to itself and never reproduced this - the bug is specific to the
// admin shell's header, which is confined to the sidebar's grid column.
// No new dependency: demo/cdp.mjs, Node, the Chrome already on the machine.
import { attach, launchChrome, sleep } from './cdp.mjs'

const ADMIN = { email: 'demo@example.test', password: 'demo-nur-lokal-2026' }

const BASE = process.env.DEMO_BASE ?? 'http://127.0.0.1:8083'
const host = new URL(BASE).hostname
if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(host)) {
  console.error(`check-brand-nowrap: refusing "${host}" — loopback only.`)
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
    port: 9820 + (process.pid % 200),
    width: 1280,
    height: 800,
  })
  const page = await attach(port)
  try {
    await page.goto(`${BASE}/login/`, { settle: 700 })
    await page.waitFor(`document.querySelector('form button[type="submit"]')`, { label: 'sign-in button' })
    await page.type('input[name="email"]', ADMIN.email, { perChar: 0 })
    await page.type('input[name="password"]', ADMIN.password, { perChar: 0 })
    await page.clickText('Anmelden', { selector: 'form button[type="submit"]' })
    await page.waitFor("location.pathname === '/'", { timeout: 15000, label: 'the dashboard' })
    await page.waitFor(`document.querySelector('.brand-name')`, { label: 'the brand' })

    // The mutant: the ONE line this bug is one missing declaration of. Injected into the
    // live page rather than the repo, so a normal run never touches a file.
    if (process.env.BRAND_MUTANT) {
      await page.eval(`(() => {
        const s = document.createElement('style')
        s.textContent = '.brand { white-space: normal !important }'
        document.head.appendChild(s)
      })()`)
      await sleep(150)
    }

    const geom = await page.eval(`(() => {
      const name = document.querySelector('.brand-name')
      const suffix = document.querySelector('.brand-suffix')
      return {
        nameHeight: name.offsetHeight,
        nameWidth: name.offsetWidth,
        suffixTop: Math.round(suffix.getBoundingClientRect().top),
        nameTop: Math.round(name.getBoundingClientRect().top),
      }
    })()`)

    console.log(`  brand-name: ${JSON.stringify(geom)}`)

    // A single line of this text, at this font, is comfortably under 30px tall; two lines
    // is ~45px (measured: 45px wrapped, 23px single-line). 30 sits cleanly between them.
    assert(
      '/ at 1280px, signed in: "NFC TimeSheets" stays on one line',
      geom.nameHeight < 30,
      `offsetHeight ${geom.nameHeight}px`,
    )
    // The other half of the symptom: "Admin" floating beside a WRAPPED first line, not
    // beside the whole (single-line) brand name.
    assert(
      '/ at 1280px, signed in: "Admin" sits on the same line as the brand name',
      Math.abs(geom.suffixTop - geom.nameTop) < 8,
      `suffix top ${geom.suffixTop} vs name top ${geom.nameTop}`,
    )
  } finally {
    child.kill('SIGKILL')
  }

  console.log(failures ? `\ncheck-brand-nowrap: FAIL (${failures})` : '\ncheck-brand-nowrap: OK')
  process.exit(failures ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
