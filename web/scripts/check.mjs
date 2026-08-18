#!/usr/bin/env node
/**
 * Two mechanical rules that WILL drift if nobody enforces them:
 *
 *   1. decision-9 - every dependency version in package.json is exact. No ^, no ~, no ranges.
 *   2. decision-8 - every locale file has the identical key set to en.json, every argument
 *      in an English string survives translation, and every message actually PARSES as ICU.
 *      The argument set is taken from the parsed ICU AST, not from a regex over the raw
 *      text: `{count, plural, one {# Schicht} other {# Schichten}}` has one argument and
 *      four pairs of braces, and a regex counts the braces. That is how "1 Schichten
 *      angezeigt." survived in a screen the director reads before payroll.
 *   3. decision-20 - the admin PIN is gone and stays gone: no PIN header, no credential in
 *      web storage, and the API client keeps sending the session cookie.
 *   4. lib/period.ts computes Vienna wall-clock boundaries, including across a daylight
 *      saving change. Those instants go on the wire as a payroll period; an hour of drift
 *      at a month end moves a shift onto the wrong payslip.
 *   5. lib/pl.ts refuses to sum a building whose revenue nobody knows as if it earned zero,
 *      and converts the director's percent to basis points without a float ever touching it.
 *   6. lib/materials.ts holds a COPY of the server's lifecycle table, so the copy is
 *      compared against server/lib/materials.js rather than trusted.
 *   7. lib/map.ts only ever asks Google for a building photograph when the Street View
 *      METADATA endpoint has already said there is one — the image endpoint answers 200
 *      with a grey "no imagery" tile, which would otherwise ship as a photo of a client's
 *      building.
 *
 * Message files are nested objects (next-intl's namespace format, decision-17); they are
 * flattened to dotted paths here so the comparison stays a plain set difference.
 *
 * Plain node, no framework, no dependencies. Run: `pnpm check`. Exits non-zero on failure.
 */

import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const REFERENCE_LOCALE = 'en'
const LOCALES = ['en', 'de']

const failures = []

function check(name, fn) {
  try {
    fn()
    process.stdout.write(`  ok   ${name}\n`)
  } catch (error) {
    failures.push(name)
    process.stdout.write(
      `  FAIL ${name}\n         ${error.message.replace(/\n/g, '\n         ')}\n`,
    )
  }
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(join(ROOT, relativePath), 'utf8'))
}

/**
 * The ICU parser next-intl already formats messages with, so this check and the runtime
 * agree by construction rather than by a second implementation of the grammar.
 *
 * Reached through pnpm's store because it is a transitive dependency and nothing hoists it.
 * ponytail: that path is pnpm's internal layout. Ceiling: a pnpm change breaks resolution.
 * It FAILS LOUDLY rather than skipping - a silently disabled check on payroll wording is
 * worse than a broken build. Upgrade path: add the parser as a direct devDependency.
 */
async function loadIcuParser() {
  const store = join(ROOT, 'node_modules/.pnpm')
  const prefix = '@formatjs+icu-messageformat-parser@'
  const dir = readdirSync(store).find((name) => name.startsWith(prefix))
  assert.ok(dir, `${prefix}* not found under node_modules/.pnpm - run pnpm install`)
  return import(
    pathToFileURL(join(store, dir, 'node_modules/@formatjs/icu-messageformat-parser/index.js')).href
  )
}

const { parse, TYPE } = await loadIcuParser()

/**
 * Every ARGUMENT a message reads, at any nesting depth. `{names}` inside a plural branch
 * counts; the branch keywords `one` / `other` and the `#` do not.
 */
function argumentsOf(value) {
  const found = new Set()
  const walk = (nodes) => {
    for (const node of nodes) {
      if (node.type === TYPE.literal || node.type === TYPE.pound) continue
      if (typeof node.value === 'string') found.add(node.value)
      if (node.options) for (const option of Object.values(node.options)) walk(option.value)
      if (node.type === TYPE.tag && node.children) walk(node.children)
    }
  }
  walk(parse(value))
  return found
}

/**
 * Keys whose `{count}` is a FIXED cap written into the source, not a tally, so it can never
 * be 1 and needs no plural form. Every other `{count}` must select on it — see below.
 */
const FIXED_COUNT_KEYS = new Set(['home.recentHeading', 'home.recentScope'])

/**
 * Is `{count}` interpolated as a bare argument anywhere in this message, rather than being
 * the selector of a plural?
 *
 * The rule this enforces: a number the code TALLIES lands in a sentence, and German and
 * English both inflect around it. Without a plural form the screen says "Davon zählen 1
 * noch nicht zur Bezahlung." and "1 of them do not count towards pay yet." — on the shift
 * log, which is the screen the director reads immediately before paying people. The
 * argument-parity check above cannot see this: both locales have exactly the same argument
 * set, and both are equally wrong.
 */
function hasBareCount(value) {
  let bare = false
  const walk = (nodes) => {
    for (const node of nodes) {
      if (node.type === TYPE.argument && node.value === 'count') bare = true
      if (node.options) for (const option of Object.values(node.options)) walk(option.value)
      if (node.type === TYPE.tag && node.children) walk(node.children)
    }
  }
  walk(parse(value))
  return bare
}

/** {a: {b: 'x'}} -> {'a.b': 'x'}. Non-string leaves are kept so they can be reported. */
function flatten(value, prefix = '', out = {}) {
  for (const [key, child] of Object.entries(value)) {
    const path = prefix === '' ? key : `${prefix}.${key}`
    if (child !== null && typeof child === 'object' && !Array.isArray(child)) {
      flatten(child, path, out)
    } else {
      out[path] = child
    }
  }
  return out
}

// One runnable check of each non-trivial function in this file.
assert.deepEqual(flatten({ a: { b: 'x', c: { d: 'y' } }, e: 'z' }), {
  'a.b': 'x',
  'a.c.d': 'y',
  e: 'z',
})

assert.deepEqual(
  [...argumentsOf('{count, plural, one {# Punkt für {names}} other {# Punkte}}')].sort(),
  ['count', 'names'],
  'arguments nested inside a plural branch must be seen',
)
assert.deepEqual(
  [...argumentsOf('{count, plural, one {Person} other {Personen}}')],
  ['count'],
  'a one-word plural branch is not an argument',
)
assert.equal(hasBareCount('{count} von ihnen zählen nicht.'), true)
assert.equal(hasBareCount('{count, plural, one {# zählt} other {# zählen}}'), false)
assert.equal(hasBareCount('{count, plural, one {# von {count} Tagen} other {#}}'), true)

// --- 1. exact version pins (decision-9) ------------------------------------------------

const pkg = readJson('package.json')
const DEP_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

check('package.json: all dependency versions are exact (no ^ or ~ or ranges)', () => {
  const offenders = []
  for (const field of DEP_FIELDS) {
    for (const [name, range] of Object.entries(pkg[field] ?? {})) {
      if (!EXACT_VERSION.test(range)) offenders.push(`${field}.${name} = "${range}"`)
    }
  }
  assert.deepEqual(offenders, [], `not pinned to an exact version:\n- ${offenders.join('\n- ')}`)
})

check('.npmrc: save-exact=true', () => {
  const npmrc = readFileSync(join(ROOT, '.npmrc'), 'utf8')
  assert.match(npmrc, /^save-exact\s*=\s*true$/m, '.npmrc must contain save-exact=true')
})

// --- 2. locale key parity (decision-8) -------------------------------------------------

const dictionaries = Object.fromEntries(
  LOCALES.map((locale) => [locale, flatten(readJson(`messages/${locale}.json`))]),
)
const reference = dictionaries[REFERENCE_LOCALE]
const referenceKeys = Object.keys(reference)

check(`messages/${REFERENCE_LOCALE}.json: non-empty, every leaf is a string`, () => {
  assert.ok(referenceKeys.length > 0, 'reference dictionary is empty')
  const bad = referenceKeys.filter(
    (key) => typeof reference[key] !== 'string' || reference[key].trim() === '',
  )
  assert.deepEqual(bad, [], `keys must map to a non-empty string: ${bad.join(', ')}`)
})

for (const locale of LOCALES.filter((l) => l !== REFERENCE_LOCALE)) {
  const dictionary = dictionaries[locale]

  check(`messages/${locale}.json: key set identical to ${REFERENCE_LOCALE}.json`, () => {
    const keys = Object.keys(dictionary)
    const missing = referenceKeys.filter((key) => !(key in dictionary))
    const extra = keys.filter((key) => !(key in reference))
    assert.deepEqual(
      { missing, extra },
      { missing: [], extra: [] },
      `missing: [${missing.join(', ')}]\nextra:   [${extra.join(', ')}]`,
    )
  })

  check(`messages/${locale}.json: all values are non-empty strings`, () => {
    const bad = Object.keys(dictionary).filter(
      (key) => typeof dictionary[key] !== 'string' || dictionary[key].trim() === '',
    )
    assert.deepEqual(bad, [], `keys must map to a non-empty string: ${bad.join(', ')}`)
  })

  check(`messages/${locale}.json: ICU arguments preserved (plurals included)`, () => {
    const broken = []
    for (const key of referenceKeys) {
      let expected
      let actual
      try {
        expected = argumentsOf(reference[key])
        actual = argumentsOf(dictionary[key] ?? '')
      } catch (error) {
        // An unparseable message throws at RENDER time in next-intl, i.e. a blank screen.
        broken.push(`${key} (does not parse as ICU: ${error.message.split('\n')[0]})`)
        continue
      }
      const lost = [...expected].filter((name) => !actual.has(name))
      const invented = [...actual].filter((name) => !expected.has(name))
      if (lost.length > 0 || invented.length > 0) {
        broken.push(
          `${key} (lost: ${lost.join(',') || '-'}, unknown: ${invented.join(',') || '-'})`,
        )
      }
    }
    assert.deepEqual(broken, [], `argument mismatch:\n- ${broken.join('\n- ')}`)
  })
}

for (const locale of LOCALES) {
  check(`messages/${locale}.json: every tallied {count} selects a plural form`, () => {
    const bare = Object.entries(dictionaries[locale])
      .filter(
        ([key, value]) =>
          typeof value === 'string' && !FIXED_COUNT_KEYS.has(key) && hasBareCount(value),
      )
      .map(([key]) => key)
    assert.deepEqual(
      bare,
      [],
      `these say "1 shifts" (or "zählen 1"):\n- ${bare.join('\n- ')}\n` +
        'Wrap the sentence in {count, plural, one {...} other {...}} and use # for the number,\n' +
        `or add the key to FIXED_COUNT_KEYS if the number is a hard-coded cap.`,
    )
  })
}

// --- 3. auth hygiene (decision-20) -----------------------------------------------------

const SOURCE_DIRS = ['app', 'components', 'lib']
const SOURCE_EXT = /\.(ts|tsx)$/

function sourceFiles(dir, out = []) {
  for (const entry of readdirSync(join(ROOT, dir))) {
    const path = join(dir, entry)
    if (statSync(join(ROOT, path)).isDirectory()) sourceFiles(path, out)
    else if (SOURCE_EXT.test(entry)) out.push(path)
  }
  return out
}

const sources = SOURCE_DIRS.flatMap((dir) => sourceFiles(dir)).map((path) => ({
  path,
  text: readFileSync(join(ROOT, path), 'utf8'),
}))

check('no admin PIN and no client-stored credential survives anywhere in the app', () => {
  // The session is an httpOnly cookie the browser owns. Anything below means someone
  // reintroduced a secret this bundle can read - i.e. one that XSS can read too.
  const banned = [/x-admin-pin/i, /adminPin/, /sessionStorage/, /document\.cookie/]
  const offenders = sources.flatMap(({ path, text }) =>
    banned.filter((pattern) => pattern.test(text)).map((pattern) => `${path}: ${pattern}`),
  )
  assert.deepEqual(offenders, [], `forbidden auth plumbing:\n- ${offenders.join('\n- ')}`)
})

check('lib/api.ts sends the session cookie', () => {
  const api = sources.find(({ path }) => relative('lib', path) === 'api.ts')
  assert.ok(api, 'lib/api.ts is missing')
  assert.match(api.text, /credentials: 'include'/, "fetch must use credentials: 'include'")
})

// --- 4. Vienna period boundaries (lib/period.ts) ----------------------------------------
//
// `web/lib/*.ts` is imported and RUN here rather than pattern-matched, because the thing
// that has to be right is arithmetic and not wording. Node strips the types itself
// (unflagged from 22.18) and the `@/` alias is resolved below.
//
// ponytail: a resolve hook instead of a build step. Ceiling: it only understands `@/`.
// Upgrade path: a real bundle, if this file ever needs to import a component.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!specifier.startsWith('@/')) return nextResolve(specifier, context)
    return nextResolve(pathToFileURL(join(ROOT, `${specifier.slice(2)}.ts`)).href, context)
  },
})

const { businessMidnight, periodRange, withinRange } = await import(
  pathToFileURL(join(ROOT, 'lib/period.ts')).href
)

check('lib/period.ts: a period boundary is Vienna midnight, not UTC midnight', () => {
  // Summer, +02:00. Get this wrong and 31 July 23:59 is paid in August.
  assert.equal(businessMidnight(2026, 8, 1), '2026-07-31T22:00:00.000Z')
  // Winter, +01:00.
  assert.equal(businessMidnight(2026, 1, 1), '2025-12-31T23:00:00.000Z')
  // Month 13 is next January, so callers never do their own calendar arithmetic.
  assert.equal(businessMidnight(2026, 13, 1), businessMidnight(2027, 1, 1))
  // Day 0 is the last day of the previous month, which is what `last30Days` relies on.
  assert.equal(businessMidnight(2026, 8, 0), businessMidnight(2026, 7, 31))
})

check('lib/period.ts: a period that crosses the clock change keeps its last day', () => {
  // Vienna went back to CET on 25 October 2026, so October opens at +02:00 and closes at
  // +01:00 and is 31 days AND one hour long. A single fixed offset loses 31 October.
  const october = periodRange('thisMonth', new Date('2026-10-15T12:00:00Z'))
  assert.deepEqual(october, { from: '2026-09-30T22:00:00.000Z', to: '2026-10-31T23:00:00.000Z' })
  assert.equal(
    Date.parse(october.to) - Date.parse(october.from),
    (31 * 24 + 1) * 3_600_000,
    'October in Vienna is 745 hours long',
  )
  assert.ok(withinRange('2026-10-31T22:30:00Z', october), '23:30 on 31 October is October')
  assert.ok(!withinRange('2026-09-30T21:30:00Z', october), '23:30 on 30 September is not')
})

check('lib/period.ts: the default browsing period cannot hide yesterday', () => {
  // THE REPORTED DEFECT, as data. On 3 August 2026 the shift log defaulted to the calendar
  // month, and all five recorded shifts were dated 30 July, so the table was empty.
  const now = new Date('2026-08-03T10:00:00Z')
  const liveShift = '2026-07-30T15:53:22Z'
  assert.ok(!withinRange(liveShift, periodRange('thisMonth', now)), 'the old default hid it')
  assert.ok(withinRange(liveShift, periodRange('last30Days', now)), 'the new default shows it')

  // On the 1st of a month a rolling window still contains the whole of yesterday.
  const firstOfMonth = new Date('2026-09-01T06:00:00Z')
  assert.ok(withinRange('2026-08-31T14:00:00Z', periodRange('last30Days', firstOfMonth)))
  // ...and today, right up to the last minute of the Vienna day.
  assert.ok(withinRange('2026-09-01T21:59:00Z', periodRange('last30Days', firstOfMonth)))
  assert.ok(!withinRange('2026-09-01T22:00:00Z', periodRange('last30Days', firstOfMonth)))
})

check('lib/period.ts: quarter and year are calendar periods in Vienna', () => {
  const q = periodRange('thisQuarter', new Date('2026-08-03T10:00:00Z'))
  assert.deepEqual(q, { from: '2026-06-30T22:00:00.000Z', to: '2026-09-30T22:00:00.000Z' })
  const y = periodRange('thisYear', new Date('2026-08-03T10:00:00Z'))
  assert.deepEqual(y, { from: '2025-12-31T23:00:00.000Z', to: '2026-12-31T23:00:00.000Z' })
  assert.deepEqual(periodRange('all', new Date()), { from: null, to: null })
})

// --- 5. enrolment code state (lib/enrolment.ts, decision-26) ----------------------------

const { codeStateOf } = await import(pathToFileURL(join(ROOT, 'lib/enrolment.ts')).href)

check('lib/enrolment.ts: a code that has run out is not reported as a live one', () => {
  const now = Date.parse('2026-08-03T12:00:00Z')
  const state = (expires, redeemed) =>
    codeStateOf({ enrolment_code_expires_at: expires, enrolment_code_redeemed_at: redeemed }, now)

  assert.equal(state(null, null), 'none', 'never issued, or issued and then revoked')
  assert.equal(state('2026-08-03T12:30:00Z', null), 'live')
  // THE ONE THAT MATTERS: codes live an hour, the director asks "did I already send Ivan
  // one?", and an expiry read as live answers that question wrongly for 59 minutes.
  assert.equal(state('2026-08-03T11:30:00Z', null), 'expired')
  assert.equal(state('2026-08-03T12:00:00Z', null), 'expired', 'the deadline itself is past')
  assert.equal(state(null, '2026-08-01T09:00:00Z'), 'redeemed')
  // Issuing resets redeemed_at, so a live code never carries a redemption from an older
  // one; if that pairing ever appears anyway, the LIVE code is what the director can act on.
  assert.equal(state('2026-08-03T12:30:00Z', '2026-08-01T09:00:00Z'), 'live')
})

// --- 6. P&L arithmetic (lib/pl.ts) ------------------------------------------------------

const { bpToPlainPercent, parsePercentToBp, plTotals, shareBp, shortfallBp } = await import(
  pathToFileURL(join(ROOT, 'lib/pl.ts')).href
)

check('lib/pl.ts: a target margin survives the round trip through the input field', () => {
  assert.equal(parsePercentToBp('15'), 1500)
  // German keyboards produce the comma. Both separators, same answer.
  assert.equal(parsePercentToBp('12,5'), 1250)
  assert.equal(parsePercentToBp('12.5'), 1250)
  // THE FLOAT TRAP: `2.03 * 100` is 202.99999999999997, and a baseline one basis point out
  // puts a building on the wrong side of a flag the director has to defend to a client.
  assert.equal(parsePercentToBp('2,03'), 203)
  // Signed on purpose: "do not lose more than 5%" is a real target for a building being
  // won back. `-0` is break-even and must not round-trip as the string "-0".
  assert.equal(parsePercentToBp('-5'), -500)
  assert.equal(Object.is(parsePercentToBp('-0'), 0), true)
  // Rejections are never a silent 0 — a silent 0 sets the floor to break-even and flags
  // half the portfolio.
  assert.equal(parsePercentToBp(''), null)
  assert.equal(parsePercentToBp('abc'), null)
  assert.equal(parsePercentToBp('101'), null, '101% is past the server\u2019s own bound')
  assert.equal(parsePercentToBp('100'), 10_000)

  assert.equal(bpToPlainPercent(1250), '12.5')
  assert.equal(bpToPlainPercent(1200), '12', 'not "12.0", which reads as an unsaved edit')
  assert.equal(bpToPlainPercent(1234), '12.34')
  assert.equal(bpToPlainPercent(5), '0.05')
  assert.equal(bpToPlainPercent(-500), '-5')
  for (const bp of [0, 5, 203, 1200, 1250, 1234, -500, 10_000]) {
    assert.equal(parsePercentToBp(bpToPlainPercent(bp)), bp, `round trip of ${bp}`)
  }
})

check('lib/pl.ts: a share of nothing is unknown, not zero', () => {
  assert.equal(shareBp(5_000, 10_000), 5_000)
  assert.equal(shareBp(1, 3), 3_333)
  // "Labour was 0% of revenue" for a building nobody has priced is a sentence a director
  // cannot defend. So is a division by zero.
  assert.equal(shareBp(1, 0), null)
  assert.equal(shareBp(1, null), null)

  assert.equal(shortfallBp(1_000, 1_500), 500)
  assert.equal(shortfallBp(2_000, 1_500), -500)
  // Either half unknown => NOT ASSESSABLE. Zero here would claim the building sits exactly
  // on target, which is the same lie as `below_baseline: false`.
  assert.equal(shortfallBp(null, 1_500), null)
  assert.equal(shortfallBp(1_000, null), null)
})

check('lib/pl.ts: a building nobody has priced is not summed as if it earned zero', () => {
  const building = (over) => ({
    location_id: over.location_id,
    labour_cents: 0,
    material_cents: 0,
    revenue_cents: null,
    below_baseline: null,
    excluded_unresolved_shifts: 0,
    open_shifts: 0,
    labour_unpriced_seconds: 0,
    ...over,
  })
  const totals = plTotals([
    building({
      location_id: 'a',
      revenue_cents: 100_000,
      labour_cents: 60_000,
      material_cents: 10_000,
      below_baseline: false,
    }),
    // No contract on file. Real cost, unknown income.
    building({
      location_id: 'b',
      labour_cents: 50_000,
      material_cents: 5_000,
      excluded_unresolved_shifts: 2,
      open_shifts: 1,
    }),
  ])

  assert.equal(totals.revenueCents, 100_000, 'only the priced building contributes revenue')
  assert.equal(totals.unpricedBuildings, 1)
  assert.equal(totals.costCentsUnpriced, 55_000, 'its cost is reported, not discarded')
  // Whole-period cost is still available for the methodology note...
  assert.equal(totals.labourCents, 110_000)
  assert.equal(totals.materialCents, 15_000)
  // ...but the bottom line is taken over the priced buildings ALONE. Counting b's revenue
  // as 0 would report EUR -250.00 and a -25% margin for a portfolio that made +30%.
  assert.equal(totals.profitCents, 30_000)
  assert.equal(totals.marginBp, 3_000)
  assert.equal(totals.notAssessable, 1, 'null below_baseline is counted, never read as a pass')
  assert.equal(totals.flagged, 0)
  assert.equal(totals.excludedUnresolvedShifts, 2)
  assert.equal(totals.openShifts, 1)
  assert.equal(totals.unpricedLabourBuildings, 0, 'nothing to caveat when every hour has a rate')

  // A worker with no hourly rate: her hours are in `labour_seconds` and her pay is in
  // NOBODY's cents, so the building's cost is too low and its margin too high. Counted so
  // the screen can say so — BUILDINGS, because one person can clean several of them and the
  // head count to go and fix is the server's own distinct one.
  const unpriced = plTotals([
    building({ location_id: 'd', revenue_cents: 100_000, labour_cents: 60_000 }),
    building({
      location_id: 'e',
      revenue_cents: 100_000,
      labour_cents: 60_000,
      labour_unpriced_seconds: 37_800,
    }),
  ])
  assert.equal(unpriced.unpricedLabourBuildings, 1, 'only the building with unpriced hours counts')

  // Nothing priced at all => no bottom line is claimed.
  const none = plTotals([building({ location_id: 'c', labour_cents: 900 })])
  assert.equal(none.profitCents, null)
  assert.equal(none.marginBp, null)
  assert.deepEqual(plTotals([]).profitCents, null)
})

// --- 7. material lifecycle (lib/materials.ts) -------------------------------------------

const { MATERIAL_TRANSITIONS, isOpen, isUnpriced, nextStatuses, stageOf } = await import(
  pathToFileURL(join(ROOT, 'lib/materials.ts')).href
)

check('lib/materials.ts: the lifecycle table still matches server/lib/materials.js', () => {
  // The browser holds a COPY, because the queue screen has to know which buttons to draw
  // BEFORE it clicks anything. A copy nobody compares is a copy that drifts, and the drift
  // shows up as a button that produces a 409 the director cannot act on.
  //
  // Read out of the server source rather than imported: server/ is a separate package with
  // its own node_modules, and importing across that boundary would drag lib/http.js and
  // therefore Sentry into a build check. FAILS LOUDLY if the file moves — a silently
  // skipped check on a lifecycle is worse than no check.
  const source = readFileSync(join(ROOT, '../server/lib/materials.js'), 'utf8')
  const match = source.match(/export const MATERIAL_TRANSITIONS = (\{[\s\S]*?\n\});/)
  assert.ok(match, 'MATERIAL_TRANSITIONS not found in server/lib/materials.js')
  // A plain object literal of string arrays. `Function` rather than JSON.parse because the
  // keys are unquoted in the source.
  const server = new Function(`return ${match[1]}`)()
  assert.deepEqual(MATERIAL_TRANSITIONS, server)
})

check('lib/materials.ts: terminal states offer no action, open ones do', () => {
  assert.deepEqual(nextStatuses('submitted'), ['approved', 'rejected'])
  assert.deepEqual(nextStatuses('approved'), ['ordered', 'rejected'])
  assert.deepEqual(nextStatuses('ordered'), ['arrived'])
  // No un-reject and no un-deliver: the refusal stays where a dispute can find it.
  assert.deepEqual(nextStatuses('arrived'), [])
  assert.deepEqual(nextStatuses('rejected'), [])

  assert.deepEqual(['submitted', 'approved', 'ordered', 'arrived', 'rejected'].map(isOpen), [
    true,
    true,
    true,
    false,
    false,
  ])
  assert.deepEqual(['submitted', 'approved', 'ordered', 'arrived', 'rejected'].map(stageOf), [
    'decide',
    'order',
    'deliver',
    'done',
    'refused',
  ])
})

check('lib/materials.ts: unpriced means money was committed and nobody typed the invoice', () => {
  // These two are what the P&L silently counts as zero, so they are what the screen counts
  // out loud.
  assert.equal(isUnpriced({ status: 'ordered', cost_cents: null }), true)
  assert.equal(isUnpriced({ status: 'arrived', cost_cents: null }), true)
  // Nothing was committed yet, so there is nothing to price.
  assert.equal(isUnpriced({ status: 'submitted', cost_cents: null }), false)
  assert.equal(isUnpriced({ status: 'approved', cost_cents: null }), false)
  assert.equal(isUnpriced({ status: 'rejected', cost_cents: null }), false)
  // 0 is a real price — a free sample — and is NOT the same as "nobody has said".
  assert.equal(isUnpriced({ status: 'ordered', cost_cents: 0 }), false)
})

// --- 8. the building photograph gate (lib/map.ts) ---------------------------------------

const mapUrl = pathToFileURL(join(ROOT, 'lib/map.ts')).href

// `MAPS_API_KEY` is read once at module scope, so the two key states are two module
// instances. A distinct URL query is what makes Node load it twice.
delete process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY
const mapWithoutKey = await import(`${mapUrl}?nokey`)
process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY = 'test-browser-key'
const mapWithKey = await import(`${mapUrl}?withkey`)

check('lib/map.ts: no photo is requested unless Street View said there is one', () => {
  const at = { lat: 48.2082, lng: 16.3738 }
  const url = mapWithKey.streetViewUrl({ ...at, street_view_status: 'OK' })
  assert.ok(url?.startsWith('https://maps.googleapis.com/maps/api/streetview?'))
  assert.match(url, /location=48\.2082%2C16\.3738/)
  assert.match(url, /key=test-browser-key/)
  // A late refusal becomes a real 404 the <img> onError can see, instead of a grey tile.
  assert.match(url, /return_error_code=true/)

  // THE RULE. The static image endpoint answers HTTP 200 with a grey "no imagery" tile, so
  // anything looser than an explicit OK from the METADATA endpoint ships that tile and
  // presents it as a photograph of the client's building.
  for (const status of [null, 'ZERO_RESULTS', 'REQUEST_DENIED', 'OVER_QUERY_LIMIT', 'ok']) {
    assert.equal(mapWithKey.streetViewUrl({ ...at, street_view_status: status }), null, status)
  }
  // OK with no coordinates cannot be asked for at all.
  assert.equal(mapWithKey.streetViewUrl({ lat: null, lng: null, street_view_status: 'OK' }), null)
  assert.equal(mapWithKey.streetViewUrl({ lat: 48.2, lng: null, street_view_status: 'OK' }), null)
  // No key in the build => no request, and the screen says why.
  assert.equal(mapWithoutKey.MAPS_API_KEY, '')
  assert.equal(mapWithoutKey.streetViewUrl({ ...at, street_view_status: 'OK' }), null)
})

check('lib/map.ts: a pin needs BOTH coordinates, and a failure has a name', () => {
  assert.equal(mapWithKey.isPinned({ lat: 48.2, lng: 16.3 }), true)
  assert.equal(mapWithKey.isPinned({ lat: 48.2, lng: null }), false)
  assert.equal(mapWithKey.isPinned({ lat: null, lng: 16.3 }), false)
  // Every load failure lands on a state the screen has words for; the default is `auth`,
  // because Google's own rejection is the one that arrives without an Error we threw.
  assert.equal(mapWithKey.failureOf(new Error('timeout')), 'timeout')
  assert.equal(mapWithKey.failureOf(new Error('network')), 'network')
  assert.equal(mapWithKey.failureOf(new Error('failed')), 'auth')
  assert.equal(mapWithKey.failureOf(undefined), 'auth')
})

// --- report -----------------------------------------------------------------------------

if (failures.length > 0) {
  process.stderr.write(`\n${failures.length} check(s) failed.\n`)
  process.exit(1)
}
process.stdout.write('\nAll checks passed.\n')
