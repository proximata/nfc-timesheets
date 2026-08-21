#!/usr/bin/env node
// A 401/403 MUST NOT LOSE THE SCREEN AND PERIOD HE WAS ON. (LOOK.md C6)
//
//     node demo/check-login-return.mjs
//
// WHAT WAS WRONG. Every admin screen's `handleAuthLoss` did `router.replace(LOGIN_PATH)` on
// a dead session — a bare `/login/`, no memory of `/payroll/?period=lastMonth`. A director
// reading last month's payroll in a stairwell, on a phone, got dumped on an empty sign-in
// form with no explanation and had to re-navigate and re-pick the period by hand once back
// in. Filed as TASK-230 / LOOK.md C6.
//
// THE FIX. `lib/nav.ts` gained two pure functions: `loginPathWithReturn()` (called from every
// screen's `handleAuthLoss`, reads the CURRENT screen off `window.location`) and
// `returnToFromLocation()` (called from `/login/`, reads it back off `/login/`'s own URL,
// same-origin-only). `/login/` shows `login.sessionExpired` when, and only when, it was
// reached this way, and returns him to that URL — never the dashboard — after a successful
// sign-in.
//
// WHAT THIS ASSERTS: the two functions' behaviour (round trip + the open-redirect guard),
// run for real against a minimal `window` stub, and — mechanically, so a new screen cannot
// silently keep the old bug — that every screen with a `handleAuthLoss` calls
// `loginPathWithReturn()` and none still calls the bare `LOGIN_PATH`.
//
// SHOW IT RED:  node demo/check-login-return.mjs --mutate
//   puts one screen back to `router.replace(LOGIN_PATH)`, runs the check, restores the file.
import { readFileSync, writeFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WEB = path.join(REPO, 'web')

// Every admin screen that has a `handleAuthLoss`. Kept explicit, like check-load-failure.mjs's
// SCREENS list: a new screen should have to be added here on purpose.
const SCREENS = [
  'app/page.tsx',
  'app/locations/page.tsx',
  'app/workers/page.tsx',
  'app/shifts/page.tsx',
  'app/payroll/page.tsx',
  'app/pl/page.tsx',
  'app/operators/page.tsx',
  'app/material-requests/page.tsx',
  'app/analytics/page.tsx',
  'app/inventory/page.tsx',
  'app/contracts/page.tsx',
  'app/clients/page.tsx',
  'app/tags/page.tsx',
]

let failed = 0
function ok(msg) {
  console.log(`  ok   ${msg}`)
}
function bad(msg) {
  console.log(`  FAIL ${msg}`)
  failed += 1
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!specifier.startsWith('@/')) return nextResolve(specifier, context)
    return nextResolve(pathToFileURL(path.join(WEB, `${specifier.slice(2)}.ts`)).href, context)
  },
})

async function checkBehaviour() {
  // Fresh import each time round: the two functions read `globalThis.window`, which this
  // test rewrites between cases, and Node's ESM cache would otherwise hand back a module
  // that closed over the FIRST stub.
  const navUrl = `${pathToFileURL(path.join(WEB, 'lib/nav.ts')).href}?t=${Date.now()}`

  const cases = [
    {
      name: 'loginPathWithReturn() carries the current screen and its query string',
      window: { location: { pathname: '/payroll/', search: '?period=lastMonth' } },
      run: (m) => m.loginPathWithReturn(),
      want: '/login/?returnTo=%2Fpayroll%2F%3Fperiod%3DlastMonth',
    },
    {
      name: 'loginPathWithReturn() on / (no query) omits an empty returnTo',
      window: { location: { pathname: '/', search: '' } },
      run: (m) => m.loginPathWithReturn(),
      want: '/login/?returnTo=%2F',
    },
    {
      name: 'loginPathWithReturn() on /login/ itself does not chain a returnTo onto a returnTo',
      window: { location: { pathname: '/login/', search: '' } },
      run: (m) => m.loginPathWithReturn(),
      want: '/login/',
    },
    {
      name: 'returnToFromLocation() reads back exactly what loginPathWithReturn() wrote',
      window: { location: { search: '?returnTo=%2Fpayroll%2F%3Fperiod%3DlastMonth' } },
      run: (m) => m.returnToFromLocation(),
      want: '/payroll/?period=lastMonth',
    },
    {
      name: 'returnToFromLocation() refuses a protocol-relative return (open-redirect guard)',
      window: { location: { search: '?returnTo=%2F%2Fevil.example%2F' } },
      run: (m) => m.returnToFromLocation(),
      want: null,
    },
    {
      name: 'returnToFromLocation() refuses a bare host (open-redirect guard)',
      window: { location: { search: '?returnTo=evil.example' } },
      run: (m) => m.returnToFromLocation(),
      want: null,
    },
    {
      name: 'returnToFromLocation() with no returnTo param is null, not "/login/"',
      window: { location: { search: '' } },
      run: (m) => m.returnToFromLocation(),
      want: null,
    },
  ]

  for (const { name, window, run, want } of cases) {
    globalThis.window = window
    try {
      const nav = await import(navUrl)
      const got = run(nav)
      got === want ? ok(name) : bad(`${name}\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`)
    } finally {
      delete globalThis.window
    }
  }
}

function checkEveryScreenAdoptedIt() {
  for (const rel of SCREENS) {
    const text = readFileSync(path.join(WEB, rel), 'utf8')
    const hasHandler = /handleAuthLoss/.test(text)
    if (!hasHandler) {
      bad(`${rel}: expected in SCREENS (has no handleAuthLoss) — list is stale`)
      continue
    }
    const usesReturn = /router\.replace\(loginPathWithReturn\(\)\)/.test(text)
    const usesBarePath = /router\.replace\(LOGIN_PATH\)/.test(text)
    if (usesBarePath) {
      bad(`${rel}: still does router.replace(LOGIN_PATH) — loses the screen and its filters`)
    } else if (!usesReturn) {
      bad(`${rel}: handleAuthLoss does not call loginPathWithReturn()`)
    } else {
      ok(`${rel}: handleAuthLoss carries the screen back through login`)
    }
  }
}

function checkLoginPageRendersTheSentence() {
  const text = readFileSync(path.join(WEB, 'app/login/page.tsx'), 'utf8')
  const reads = /returnToFromLocation\(\)/.test(text)
  const rendersSentence = /returnTo !== null.*sessionExpired|sessionExpired.*returnTo/s.test(text)
  const redirectsBack = /router\.push\(returnTo \?\? '\/'\)/.test(text)
  reads
    ? ok('app/login/page.tsx: reads returnTo via lib/nav.ts (not a raw window.location read)')
    : bad('app/login/page.tsx: does not call returnToFromLocation()')
  rendersSentence
    ? ok('app/login/page.tsx: shows login.sessionExpired only when returnTo is set')
    : bad('app/login/page.tsx: does not conditionally render login.sessionExpired')
  redirectsBack
    ? ok('app/login/page.tsx: a successful sign-in returns to returnTo, falling back to /')
    : bad('app/login/page.tsx: does not redirect back to returnTo after signing in')

  for (const locale of ['de', 'en']) {
    const messages = JSON.parse(readFileSync(path.join(WEB, 'messages', `${locale}.json`), 'utf8'))
    typeof messages.login?.sessionExpired === 'string' && messages.login.sessionExpired.trim() !== ''
      ? ok(`messages/${locale}.json: login.sessionExpired exists`)
      : bad(`messages/${locale}.json: login.sessionExpired is missing or empty`)
  }
}

async function check() {
  failed = 0
  await checkBehaviour()
  checkEveryScreenAdoptedIt()
  checkLoginPageRendersTheSentence()
  return failed
}

if (process.argv.includes('--mutate')) {
  const victim = path.join(WEB, SCREENS[4]) // app/payroll/page.tsx
  const original = readFileSync(victim, 'utf8')
  try {
    writeFileSync(
      victim,
      original.replace('router.replace(loginPathWithReturn())', 'router.replace(LOGIN_PATH)'),
    )
    console.log(`-- mutant: ${SCREENS[4]} put back to a bare router.replace(LOGIN_PATH)`)
    const rc = await check()
    console.log(rc > 0 ? '\n  RED, as it must be' : '\n  FAIL: the mutant did NOT go red')
    process.exitCode = rc > 0 ? 0 : 1
  } finally {
    writeFileSync(victim, original)
    console.log('-- restored')
  }
  const after = await check()
  console.log(after === 0 ? '  and green again\n' : '  FAIL: still red after the restore\n')
  if (after !== 0) process.exitCode = 1
} else {
  const rc = await check()
  console.log(rc === 0 ? '\ncheck-login-return: OK' : '\ncheck-login-return: FAILED')
  process.exitCode = rc
}
