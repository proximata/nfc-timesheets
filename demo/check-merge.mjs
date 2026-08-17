// Runtime proof for the MERGE, in both locales: no next-intl MISSING_MESSAGE, and no raw
// key path rendered onto a screen. `next build` only prerenders the empty first paint, so it
// cannot see a key that is missing on a row that only exists once data has arrived.
//
// Read-only against the local demo stack on 127.0.0.1:8082 («stack» in backlog/docs/DEMO.md).
// Bounded: every wait has a timeout, because a check that can hang forever looks exactly like
// a check that is passing.
//
//   «stack», then: node demo/check-merge.mjs
//
// CDP PORT, and it is not paranoia: `launchChrome` returns as soon as SOMETHING answers
// /json/version on that port. A headless Chrome left behind by an earlier run therefore gets
// silently reused, complete with its localStorage — which is how this script first reported
// an English screen against a German build for twenty minutes. Pick a port nothing holds:
//   curl -s -m1 -o /dev/null -w '%{http_code}' http://127.0.0.1:9353/json/version
import { attach, launchChrome } from './cdp.mjs'

const BASE = 'http://127.0.0.1:8082'
if (!/^http:\/\/127\.0\.0\.1:/.test(BASE)) throw new Error('loopback only')

const PAGES = [
  '/', '/shifts/', '/material-requests/', '/workers/', '/locations/', '/clients/',
  '/contracts/', '/inventory/', '/payroll/', '/pl/', '/analytics/', '/account/',
]

// Every namespace in the message tree. A rendered `home.intro` is what a deleted-but-still
// called key looks like on screen.
const NAMESPACES = [
  'meta', 'app', 'a11y', 'nav', 'locale', 'home', 'payroll', 'login', 'workers', 'locations',
  'clients', 'shifts', 'inventory', 'materials', 'pl', 'contracts', 'analytics', 'portal',
  'notFound', 'footer', 'error', 'account', 'theme', 'overlay', 'field',
]
const KEY_PATH = new RegExp(`\\b(${NAMESPACES.join('|')})\\.[a-z][A-Za-z0-9]{2,}\\b`, 'g')

const { child } = await launchChrome({ port: 9353, width: 1440, height: 1000 })
const page = await attach(9353)
const failures = []
const problems = []

/**
 * MEASURED, so nobody trusts this arm: next-intl 4.12 renders an unparseable message as its
 * own raw text and logs NOTHING — no console call, no exception. Verified by shipping
 * `"question": "Muss ich {gerade etwas tun?"` into a real build: the screen showed the broken
 * string, `logs` was `[]`. So this listener is a bonus, and the two checks that can actually
 * fail are the raw-key-path scan below and `pnpm check`'s ICU parse.
 */
const INTL_ERROR = /MISSING_MESSAGE|INSUFFICIENT_PATH|INVALID_MESSAGE|IntlError|MessageFormat/
page.on('Runtime.consoleAPICalled', ({ type, args }) => {
  const text = args.map((a) => a.value ?? a.description ?? '').join(' ')
  if (INTL_ERROR.test(text)) problems.push(`console ${type}: ${text.slice(0, 220)}`)
})
page.on('Runtime.exceptionThrown', ({ exceptionDetails }) => {
  const text = exceptionDetails?.exception?.description ?? exceptionDetails?.text ?? ''
  if (INTL_ERROR.test(text)) problems.push(`uncaught: ${text.slice(0, 220)}`)
})

try {
  await page.goto(`${BASE}/login/`, { settle: 1800 })
  await page.type('input[name="email"]', 'demo@example.test')
  await page.type('input[name="password"]', 'demo-nur-lokal-2026')
  await page.clickText('Anmelden', { selector: 'form button[type="submit"]' })
  await page.waitFor(`!location.pathname.includes('login')`, { timeout: 12_000, label: 'sign-in' })

  for (const locale of ['de', 'en']) {
    await page.goto(`${BASE}/`)
    await page.eval(`localStorage.setItem('nfcts.locale', ${JSON.stringify(locale)})`)
    for (const path of PAGES) {
      await page.goto(`${BASE}${path}`, { settle: 1400 })
      // Bounded: a screen that never finishes loading is a failure, not a wait.
      await page.waitFor('document.querySelector("h1")', { timeout: 8_000, label: `${path} h1` })
      // The locale loop has to be able to fail: if the switch never took, the "English"
      // half of this run is a second German pass wearing a label.
      const lang = await page.eval('document.documentElement.lang')
      const wanted = locale === 'de' ? 'de-AT' : 'en'
      if (lang !== wanted) failures.push(`${locale} ${path}: <html lang> is ${lang}, wanted ${wanted}`)
      const text = await page.eval('document.body.innerText')
      const hits = [...new Set(text.match(KEY_PATH) ?? [])]
        // Two real, rendered strings that contain a dot-word: decision refs and file names.
        .filter((h) => !/^(app\.|meta\.)/.test(h))
      if (hits.length) failures.push(`${locale} ${path}: raw key path on screen -> ${hits}`)
    }
  }
} finally {
  page.close()
  child.kill()
}

process.stdout.write(`visited ${PAGES.length * 2} screens\n`)
for (const p of problems) process.stdout.write(`  next-intl: ${p}\n`)
if (failures.length || problems.length) {
  process.stderr.write(`\nFAIL\n${[...failures, ...problems].map((f) => `  ${f}`).join('\n')}\n`)
  process.exit(1)
}
process.stdout.write('ok   no MISSING_MESSAGE, no raw key path, both locales\n')
