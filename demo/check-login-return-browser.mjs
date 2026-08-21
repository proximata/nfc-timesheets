#!/usr/bin/env node
// C6, DRIVEN — the half `demo/check-login-return.mjs` structurally cannot see. (LOOK.md C6)
//
//   DEMO_BASE=http://127.0.0.1:8080 node demo/check-login-return-browser.mjs
//   DEMO_BASE=… LOGIN_RETURN_MUTANT=1 node demo/check-login-return-browser.mjs   # RED
//
// WHY A SECOND CHECK FOR ONE FINDING. `check-login-return.mjs` calls `loginPathWithReturn()`
// and `returnToFromLocation()` against a stubbed `window` and greps every screen's
// `handleAuthLoss`. Both functions are correct, every screen calls the right one, and the
// check is green — and the feature was still broken on the box for every real user, because
// the defect is in NEITHER function: `/login/` read `window.location.search` from a
// `useState` INITIALISER, which runs during the render the client-side navigation triggers,
// before Next has committed the new URL. A pure-function test cannot have a React commit
// order. Only a browser can answer this, so this file only ever runs in one.
//
// WHAT IT ASSERTS, on the path a director actually takes:
//   1. a live screen with filters, whose session then dies -> lands on /login/?returnTo=…
//   2. …and SAYS the session expired (not a blank sign-in card)
//   3. …and signing in returns him to that screen WITH its filters, not to the dashboard
//   4. a cold visit to /login/ says nothing about an expiry, which would be a lie
//
// The mutant restores the shipped bug (initialiser only, no effect) so the negative case is
// the real one and not an invented one.
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { attach, launchChrome, sleep } from './cdp.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ADMIN = { email: 'demo@example.test', password: 'demo-nur-lokal-2026' }

const BASE = process.env.DEMO_BASE ?? 'http://127.0.0.1:8080'
const host = new URL(BASE).hostname
if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(host)) {
  console.error(`check-login-return-browser: refusing "${host}" — loopback only.`)
  process.exit(1)
}

// The screen and the filter that must survive the round trip. `/payroll/` because that is
// the screen the finding was written about — a month picked by hand, lost on every 401.
const SCREEN = '/payroll/'
const QUERY = '?period=2026-07'

let failures = 0
const assert = (name, cond, detail) => {
  if (cond) console.log(`  ok   ${name}`)
  else {
    failures++
    console.log(`  FAIL ${name}${detail ? `  ${detail}` : ''}`)
  }
}

const LOGIN = path.join(REPO, 'web/app/login/page.tsx')

/**
 * Put the shipped bug back: delete the post-commit re-read, leaving the initialiser alone.
 * The caller must rebuild — this mutates SOURCE, and the browser only ever sees `web/out`.
 */
function mutate() {
  const src = readFileSync(LOGIN, 'utf8')
  const start = src.indexOf('  useEffect(() => {')
  const end = src.indexOf('}, [])', start)
  if (start < 0 || end < 0) throw new Error('mutant: the returnTo effect is not where it was')
  writeFileSync(LOGIN, src.slice(0, start) + src.slice(end + '}, [])\n'.length))
  console.log('  (mutant applied: the post-commit re-read is gone — rebuild, then run again)')
}

if (process.env.LOGIN_RETURN_MUTANT === 'apply') {
  mutate()
  process.exit(0)
}

async function signIn(page) {
  await page.waitFor(`document.querySelector('input[type=password]')`, { label: 'the sign-in form' })
  await page.eval(`(() => {
    const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set
      d.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })) }
    set(document.querySelector('input[name=email]'), ${JSON.stringify(ADMIN.email)})
    set(document.querySelector('input[name=password]'), ${JSON.stringify(ADMIN.password)})
    document.querySelector('form').requestSubmit(); return true
  })()`)
  await page.waitFor(`!document.querySelector('input[type=password]')`, {
    label: 'the sign-in form to go away',
    timeout: 20000,
  })
}

async function main() {
  const { child, port } = await launchChrome({ port: 9830 + (process.pid % 150), width: 1440, height: 900 })
  const page = await attach(port)
  try {
    // 4 first: a COLD visit must not claim an expiry. Asserted before any session exists,
    // so nothing this run does can accidentally make it true.
    await page.goto(`${BASE}/login/`, { settle: 900 })
    const cold = await page.eval('document.body.innerText')
    assert('a cold /login/ does not claim the session expired', !/abgelaufen|expired/i.test(cold))

    await signIn(page)

    // The director is on a filtered screen. Read what he can see, so the assertion below is
    // about a screen that really rendered and not about an error page.
    await page.goto(`${BASE}${SCREEN}${QUERY}`, { settle: 2000 })
    const onScreen = await page.eval('location.pathname + location.search')
    assert(`he is on ${SCREEN}${QUERY}`, onScreen === `${SCREEN}${QUERY}`, `got ${onScreen}`)

    // His session dies. Not simulated at the API — the cookie is removed, which is what an
    // expiry is from the browser's side, and then the screen is loaded again.
    await page.send('Network.clearBrowserCookies')
    await page.goto(`${BASE}${SCREEN}${QUERY}`, { settle: 3000 })

    const dead = await page.eval(`({
      url: location.pathname + location.search,
      text: document.body.innerText,
      hasForm: !!document.querySelector('input[type=password]'),
    })`)
    assert('a dead session lands on the sign-in form', dead.hasForm)
    assert(
      'the URL carries where he was',
      dead.url.startsWith('/login/') && decodeURIComponent(dead.url).includes(`${SCREEN}${QUERY}`),
      `got ${dead.url}`,
    )
    assert(
      'the screen SAYS the session expired',
      /abgelaufen|expired/i.test(dead.text),
      `login page text: ${JSON.stringify(dead.text.replace(/\n+/g, ' | ').slice(0, 160))}`,
    )

    await signIn(page)
    await sleep(2500)
    const back = await page.eval('location.pathname + location.search')
    assert(
      `signing in returns him to ${SCREEN}${QUERY}`,
      back === `${SCREEN}${QUERY}`,
      `landed on ${back}`,
    )
  } finally {
    page.close()
    child.kill()
  }
  console.log(failures === 0 ? '\ncheck-login-return-browser: OK' : `\ncheck-login-return-browser: ${failures} FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

await main()
