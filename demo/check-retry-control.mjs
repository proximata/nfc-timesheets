#!/usr/bin/env node
// A DEAD END WITH NO BUTTON IS INDISTINGUISHABLE FROM DATA LOSS. (LOOK.md C5 / LOOK-PHONE #5)
//
//     node demo/check-retry-control.mjs
//
// WHAT WAS WRONG. `/payroll/`, `/shifts/`, `/pl/` and `/locations/` each render, while they
// have no data, `<p role="status">{loadError === null ? t('loading') : tError(loadError)}</p>`.
// The error sentence itself always ends "…versuchen Sie es noch einmal" — but nothing on
// the screen IS "noch einmal": the only ways to retry were changing a filter (which most
// people would not think to try on a screen that failed for a reason unrelated to any
// filter) or reloading the whole page. `/` is the one screen this does not apply to: it has
// always carried an "Aktualisieren" button in its header, independent of `loadError`.
//
// THE FIX: `components/LoadStatus.tsx`, one component instead of four hand-written copies,
// renders the SAME error sentence plus a `btn-ghost` retry button that calls the screen's
// own `load()` — the exact function its `useEffect` already calls on mount, so a retry is
// not a second code path with its own chance to disagree with the first.
//
// WHAT THIS ASSERTS, and why it is a source check rather than a browser one: this is a
// structural fact about which prop got wired to which callback, and `check-load-failure.mjs`
// already established the precedent for reading it out of the source rather than the DOM.
//
// SHOW IT RED:  node demo/check-retry-control.mjs --mutate
//   deletes the onRetry prop from one screen's <LoadStatus>, runs the check, restores it.
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WEB = path.join(REPO, 'web')

// Every screen that fetches its OWN page and previously dead-ended on a failed load.
// `/` is deliberately excluded: it already has an always-visible header retry button.
const SCREENS = ['app/payroll/page.tsx', 'app/shifts/page.tsx', 'app/pl/page.tsx', 'app/locations/page.tsx']

let failed = 0
function ok(msg) {
  console.log(`  ok   ${msg}`)
}
function bad(msg) {
  console.log(`  FAIL ${msg}`)
  failed += 1
}

function check() {
  failed = 0

  const loadStatusSrc = readFileSync(path.join(WEB, 'components/LoadStatus.tsx'), 'utf8')
  const loadStatusShape =
    /error === null[\s\S]*loading[\s\S]*<button[\s\S]*onClick=\{onRetry\}[\s\S]*retryLabel/
  loadStatusShape.test(loadStatusSrc)
    ? ok('components/LoadStatus.tsx: renders "loading" OR (the error sentence + a retry button), never neither')
    : bad('components/LoadStatus.tsx: does not have the loading/error+button shape expected')

  for (const rel of SCREENS) {
    const text = readFileSync(path.join(WEB, rel), 'utf8')
    const importsIt = /import \{ LoadStatus \} from '@\/components\/LoadStatus'/.test(text)
    const usesIt = /<LoadStatus\b/.test(text)
    const wiresRetry = /<LoadStatus\b[\s\S]{0,400}?onRetry=\{\(\) => void load\(\)\}/.test(text)
    const wiresLabel = /<LoadStatus\b[\s\S]{0,400}?retryLabel=\{tError\('retry'\)\}/.test(text)
    const stillBare = /<p role="status">\{loadError === null \? t\('loading'\) : tError\(loadError\)\}<\/p>/.test(
      text,
    )

    if (stillBare) {
      bad(`${rel}: still renders the bare <p role="status"> with no retry control`)
      continue
    }
    if (!importsIt || !usesIt) {
      bad(`${rel}: does not use <LoadStatus> at all`)
      continue
    }
    if (!wiresRetry) {
      bad(`${rel}: <LoadStatus> is not wired to onRetry={() => void load()}`)
      continue
    }
    if (!wiresLabel) {
      bad(`${rel}: <LoadStatus> has no retryLabel={tError('retry')}`)
      continue
    }
    ok(`${rel}: a failed load offers a retry control that calls the same load()`)
  }

  for (const locale of ['de', 'en']) {
    const messages = JSON.parse(readFileSync(path.join(WEB, 'messages', `${locale}.json`), 'utf8'))
    typeof messages.error?.retry === 'string' && messages.error.retry.trim() !== ''
      ? ok(`messages/${locale}.json: error.retry exists`)
      : bad(`messages/${locale}.json: error.retry is missing or empty`)
  }

  return failed
}

if (process.argv.includes('--mutate')) {
  const victim = path.join(WEB, SCREENS[1]) // app/shifts/page.tsx
  const original = readFileSync(victim, 'utf8')
  try {
    writeFileSync(victim, original.replace("onRetry={() => void load()}\n        />", '/>'))
    console.log(`-- mutant: ${SCREENS[1]}'s <LoadStatus> lost its onRetry prop`)
    const rc = check()
    console.log(rc > 0 ? '\n  RED, as it must be' : '\n  FAIL: the mutant did NOT go red')
    process.exitCode = rc > 0 ? 0 : 1
  } finally {
    writeFileSync(victim, original)
    console.log('-- restored')
  }
  const after = check()
  console.log(after === 0 ? '  and green again\n' : '  FAIL: still red after the restore\n')
  if (after !== 0) process.exitCode = 1
} else {
  const rc = check()
  console.log(rc === 0 ? '\ncheck-retry-control: OK' : '\ncheck-retry-control: FAILED')
  process.exitCode = rc
}
