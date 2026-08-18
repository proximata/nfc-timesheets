// EVERY URL parameter, hand-mangled, on EVERY screen that reads it.
//
//   node demo/audit-params.mjs                    # against http://127.0.0.1:8080
//
// demo/check-filters.mjs already proves that eleven mangled URLs still render. This file is
// the other half of decision-38 §4, and it is the half that is actually dangerous:
//
//   A MANGLED PARAMETER MUST DEGRADE TO THE SCREEN'S OWN DEFAULT — not to a DIFFERENT
//   OBJECT'S SLICE. „Renders without an error" is satisfied by a screen showing somebody
//   else's building. So every case is measured against the screen's UNFILTERED baseline:
//   the row count must come back to the baseline AND the first row must be the baseline's
//   first row. A filter that half-applies is the failure this is written for.
//
//   A WELL-FORMED ID THAT NAMES NOTHING MUST SAY SO. Two wrongs, two different answers
//   (lib/filters.ts): unparseable is dropped silently, well-formed-but-unknown is stated in
//   the chip. Silently showing the whole table when the URL asked for one building is worse
//   than an error, because the director reads it as that building's numbers.
//
// THE MANGLES ARE NOT ALL TYPOS. Four of them are the ones a validator gets wrong:
//
//   duplicate       ?location=A&location=B   URLSearchParams.get returns the FIRST. A screen
//                                            reading the last would open a different building
//                                            than the one the link named.
//   uppercase uuid  the regex is case-insensitive, the row lookup is not. A `?location=` that
//                   PARSES but matches no row is the „unbekannt" path reached from a URL that
//                   is, to any human reading it, correct.
//   nul byte        %00 truncates in a surprising number of string handlers.
//   markup          <script>, ../, and a 4000-character value: the three things a URL
//                   parameter has historically been used to do to a page.
//
// READ-ONLY. It navigates and reads; it submits nothing.
import { attach, launchChrome, sleep } from './cdp.mjs'

const BASE = process.env.AUDIT_BASE ?? 'http://127.0.0.1:8080'
const ADMIN = { email: 'demo@example.test', password: 'demo-nur-lokal-2026' }

if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(new URL(BASE).hostname)) {
  console.error('audit-params: loopback only.')
  process.exit(1)
}

const results = []
const record = (ok, label, detail = '') => {
  results.push({ ok, label, detail })
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `  — ${detail}` : ''}`)
}

/**
 * Which screen reads which parameter, read out of web/app/*.tsx rather than remembered.
 * `period` is deliberately not object-scoped and is listed separately below.
 */
const READS = {
  '/': ['location'],
  '/shifts/': ['location', 'worker', 'shift', 'state', 'period'],
  '/workers/': ['worker', 'state'],
  '/locations/': ['client', 'open', 'state'],
  '/clients/': ['client'],
  '/contracts/': ['location'],
  '/material-requests/': ['location', 'worker', 'status'],
  '/payroll/': ['location', 'worker', 'period'],
  '/pl/': ['location', 'period'],
  '/analytics/': ['location', 'period'],
}

/** The mangles. `%s` is nothing — every one of these is a value no parser should accept. */
const MANGLES = [
  ['empty', ''],
  ['whitespace', '%20%20'],
  ['word', 'nonsense'],
  ['zero', '0'],
  ['negative', '-1'],
  ['float', '1.5'],
  ['exponent', '1e3'],
  ['leading zero', '007'],
  ['huge', '99999999999999999999'],
  ['nul byte', 'abc%00def'],
  ['markup', '%3Cscript%3Ealert(1)%3C%2Fscript%3E'],
  ['traversal', '..%2F..%2Fetc%2Fpasswd'],
  ['long', 'a'.repeat(4000)],
  ['sql-ish', "1%20OR%201%3D1"],
  ['unicode', '%F0%9F%92%A5'],
]

const chrome = await launchChrome({
  port: Number(process.env.AUDIT_PORT ?? 9423),
  width: 1440,
  height: 950,
})
const page = await attach(chrome.port)

/**
 * What is ON SCREEN, reduced to the things a wrong filter would change. The FIRST ROW is
 * read as well as the count, because two different buildings can have the same number of
 * shifts and a count-only comparison would call that a pass.
 */
const SHAPE = `(() => {
  const table = document.querySelector('table.data-table')
  const rows = table ? [...table.querySelectorAll('tbody tr')] : []
  return {
    rows: rows.length,
    first: rows[0] ? rows[0].textContent.replace(/\\s+/g, ' ').trim().slice(0, 90) : '',
    // WHICH OBJECTS are on screen, as a SET. See the note on the comparison in section 1:
    // the first row alone is not a stable fingerprint, and the failure it invents looks
    // exactly like the failure this file exists to catch.
    names: rows
      .map((r) => (r.querySelector('th') ?? r.cells[0])?.textContent?.replace(/\\s+/g, ' ').trim().slice(0, 40) ?? '')
      .sort(),
    chips: [...document.querySelectorAll('.filter-chip-text')].map((c) => c.textContent.trim()),
    alerts: [...document.querySelectorAll('[role="alert"]')].map((p) => p.textContent.trim()).filter(Boolean),
    h1: document.querySelector('#main-content h1')?.textContent?.trim() ?? null,
    answer: document.querySelector('.answer, .answer-band')?.textContent?.replace(/\\s+/g, ' ').trim().slice(0, 90) ?? null,
    drawer: !!document.querySelector('.drawer'),
    // A message next-intl could not resolve renders as its own key path.
    keyLeak: (document.body.innerText.match(/\\b(home|shifts|workers|payroll|pl|analytics|locations|clients|materials|contracts|filters|overlay|nav)\\.[a-zA-Z]{3,}/g) || []).slice(0, 3),
    // Did anything we put in the URL end up unescaped in the DOM?
    scriptTags: document.querySelectorAll('#main-content script').length,
  }
})()`

async function login() {
  await page.goto(`${BASE}/login/`, { settle: 600 })
  await page.type('input[name="email"]', ADMIN.email, { perChar: 0 })
  await page.type('input[name="password"]', ADMIN.password, { perChar: 0 })
  await page.clickText('Anmelden', { selector: 'form button[type="submit"]' })
  await page.waitFor(`location.pathname === '/'`, { timeout: 15000, label: 'the dashboard' })
}

async function shapeOf(url, settle = 1100) {
  await page.goto(`${BASE}${url}`, { settle })
  return page.eval(SHAPE)
}

await login()

// ---------------------------------------------------------------------------------------
console.log('\n=== 0 · the baselines every mangled case is compared against ===')
const baseline = {}
for (const path of Object.keys(READS)) {
  baseline[path] = await shapeOf(path)
  console.log(`       ${path}  rows=${baseline[path].rows}  first="${baseline[path].first.slice(0, 48)}"`)
}
// A baseline with no rows cannot detect a filter that half-applied — every comparison below
// would be 0 === 0. Say so rather than reporting a green nothing.
const empty = Object.entries(baseline).filter(([, b]) => b.rows === 0 && b.answer === null)
record(empty.length === 0, 'fixture: every screen has something on it to compare against', empty.map(([p]) => p).join(' ') || 'all screens carry rows or an answer band')

// ---------------------------------------------------------------------------------------
console.log('\n=== 1 · every parameter × every mangle, on every screen that reads it ===')
for (const [path, params] of Object.entries(READS)) {
  const base = baseline[path]
  for (const param of params) {
    const bad = []
    for (const [name, value] of MANGLES) {
      const url = `${path}?${param}=${value}`
      const shape = await shapeOf(url, 900)
      const problems = []
      if (shape.h1 === null) problems.push('the screen did not render')
      if (shape.alerts.length) problems.push(`alert: ${shape.alerts.join(' / ')}`)
      if (shape.keyLeak.length) problems.push(`untranslated: ${shape.keyLeak.join(' ')}`)
      if (shape.scriptTags > 0) problems.push(`${shape.scriptTags} <script> injected into main`)
      // THE ONE THAT MATTERS: the screen came back to its OWN default, not to somebody
      // else's slice. Row count AND WHICH OBJECTS, compared as a SET.
      //
      // NOT the first row, which is what this compared until it produced three failures
      // whose printed evidence was two IDENTICAL strings. Two causes, both real and neither
      // a filter leak: /contracts/ holds two contracts for one building (decision-28's
      // history) and the query has no tiebreak, so the same screen renders them in either
      // order; and `/`'s Objektliste re-sorts once the occupancy fetch lands, so a
      // fingerprint taken at 1100 ms is a fingerprint of a half-loaded list. A check that
      // cries leak at a sort order is a check that will be ignored the day it is right.
      //
      // The SET still answers the actual question. A filter that half-applied removes rows;
      // a filter that applied somebody else's id substitutes them. Both change the set.
      if (shape.rows !== base.rows) problems.push(`${shape.rows} rows, baseline ${base.rows}`)
      if (shape.names.join('|') !== base.names.join('|')) {
        const gone = base.names.filter((n) => !shape.names.includes(n))
        const extra = shape.names.filter((n) => !base.names.includes(n))
        problems.push(`objects differ — missing [${gone.join(', ')}] unexpected [${extra.join(', ')}]`)
      }
      if (shape.chips.length !== base.chips.length) problems.push(`chips ${JSON.stringify(shape.chips)}`)
      if (problems.length) bad.push(`${name}: ${problems.join('; ')}`)
    }
    record(bad.length === 0, `${path} ?${param}= — ${MANGLES.length} mangles all degrade to the default`, bad.join(' || '))
  }
}

// ---------------------------------------------------------------------------------------
console.log('\n=== 2 · the duplicate-parameter trap ===')
// `?location=A&location=B`. Whatever the screen picks it must pick the SAME one the chip
// names, or the URL and the screen disagree about which building is on display.
{
  await page.goto(`${BASE}/locations/`, { settle: 1200 })
  await page.waitFor(`document.querySelectorAll('table.data-table tbody th a').length > 1`, { label: 'two buildings' })
  const [uuidA, uuidB] = await page.eval(
    `[...document.querySelectorAll('table.data-table tbody th a')].slice(0, 2)
       .map((a) => a.getAttribute('href').split('=')[1])`,
  )
  // The FIRST TEXT NODE, not textContent: the link carries a visually-hidden „Objektpanel
  // öffnen" after the name, and comparing that against the chip's text fails for a reason
  // that has nothing to do with duplicate parameters.
  const [nameA, nameB] = await page.eval(
    `[...document.querySelectorAll('table.data-table tbody th a')].slice(0, 2)
       .map((a) => (a.childNodes[0].textContent || '').trim())`,
  )
  const dup = await shapeOf(`/?location=${uuidA}&location=${uuidB}`, 1400)
  const chip = dup.chips.join(' ')
  record(
    chip.includes(nameA) && !chip.includes(nameB),
    'duplicate ?location= takes the FIRST, and the chip names the one it took',
    `chip="${chip}" first=${nameA} second=${nameB}`,
  )
}

// ---------------------------------------------------------------------------------------
console.log('\n=== 2b · an UPPERCASED uuid: parses one way, matches the other ===')
// `UUID_RE` in lib/filters.ts is case-INSENSITIVE, so `?location=DA39EA4D-…` is accepted as
// well formed; the row lookup is `location.id === filters.location`, which is case-SENSITIVE.
// A URL a human would call correct therefore lands on „unbekannt". That is not a crash and it
// is not another object's data — the „two wrongs, two answers" contract still holds — but it
// is a linkable URL that stops working when a mail client, a spreadsheet or a phone keyboard
// changes its case. Asserted so the behaviour is pinned rather than discovered twice.
{
  await page.goto(`${BASE}/locations/`, { settle: 1200 })
  const uuid = await page.eval(
    `document.querySelector('table.data-table tbody th a').getAttribute('href').split('=')[1]`,
  )
  const upper = await shapeOf(`/?location=${uuid.toUpperCase()}`, 1400)
  const lower = await shapeOf(`/?location=${uuid}`, 1400)
  const upperUnknown = upper.chips.some((c) => /unbekannt|unknown/i.test(c))
  const lowerNamed = lower.chips.some((c) => !/unbekannt|unknown/i.test(c) && c.length > 8)
  record(
    lowerNamed,
    'fixture: the lower-case uuid DOES name its building (so the case below is about case)',
    lower.chips.join(' | '),
  )
  record(
    !upperUnknown,
    'an UPPERCASED but otherwise identical uuid still finds its building',
    upperUnknown
      ? `„unbekannt" — the shape check is case-insensitive, the row lookup is not: ${upper.chips.join(' | ')}`
      : upper.chips.join(' | '),
  )
  record(
    upper.rows === lower.rows && upper.drawer === false,
    '…and whatever it decides, it never shows another building',
    `upper rows=${upper.rows} lower rows=${lower.rows}`,
  )
}

// ---------------------------------------------------------------------------------------
console.log('\n=== 3 · a well-formed id that names nothing SAYS SO, on every screen ===')
{
  const ghostUuid = '00000000-0000-0000-0000-000000000000'
  const ghostRow = '999999'
  const cases = [
    ['/', 'location', ghostUuid],
    ['/shifts/', 'location', ghostUuid],
    ['/shifts/', 'worker', ghostRow],
    ['/shifts/', 'shift', ghostRow],
    ['/workers/', 'worker', ghostRow],
    ['/clients/', 'client', ghostRow],
    ['/contracts/', 'location', ghostUuid],
    ['/locations/', 'client', ghostRow],
    ['/locations/', 'open', ghostUuid],
    ['/material-requests/', 'location', ghostUuid],
    ['/material-requests/', 'worker', ghostRow],
    ['/payroll/', 'location', ghostUuid],
    ['/payroll/', 'worker', ghostRow],
    ['/pl/', 'location', ghostUuid],
    ['/analytics/', 'location', ghostUuid],
  ]
  for (const [path, param, value] of cases) {
    const shape = await shapeOf(`${path}?${param}=${value}`, 1300)
    const inChip = shape.chips.some((c) => /unbekannt|unknown/i.test(c))
    const notice = await page.eval(
      `document.querySelector('.notice.bad')?.textContent?.trim() ?? ''`,
    )
    // WHICH mechanism said it is part of the evidence. A screen that has no chip row at all
    // (`/contracts/`, and `?open=` on `/locations/`) has to carry the sentence somewhere
    // else, and „somewhere" is not good enough to write down as proof.
    record(
      inChip || notice.length > 20,
      `${path} ?${param}=<well-formed, names nothing> → the screen says it is unknown`,
      `via=${inChip ? 'chip' : notice ? 'notice' : 'NOTHING'} ` +
        `chips=${JSON.stringify(shape.chips)} notice=${JSON.stringify(notice.slice(0, 60))} ` +
        `rows=${shape.rows} (baseline ${baseline[path].rows})`,
    )
    // …and it must not have opened a panel on somebody else's object.
    record(
      shape.drawer === false,
      `${path} ?${param}=<names nothing> → no panel opens on another object`,
      shape.drawer ? 'a drawer is open' : '',
    )
  }
}

// ---------------------------------------------------------------------------------------
console.log('\n=== 4 · SELF-TEST: a REAL id must move the screen, or nothing above proved anything ===')
// Every assertion in section 1 is „the screen looks like the baseline". If a filter never did
// anything at all, all of them would pass. So: the same comparison with a VALID value, which
// MUST come out different.
{
  await page.goto(`${BASE}/locations/`, { settle: 1200 })
  const uuid = await page.eval(
    `document.querySelector('table.data-table tbody th a').getAttribute('href').split('=')[1]`,
  )
  const real = await shapeOf(`/shifts/?location=${uuid}&period=all`, 1400)
  const unfiltered = await shapeOf(`/shifts/?period=all`, 1400)
  record(
    real.rows > 0 && real.rows < unfiltered.rows,
    'self-test: a REAL ?location= really filters (so „looks like the baseline" means something)',
    `${real.rows} of ${unfiltered.rows} rows`,
  )
  record(
    real.chips.length > 0,
    'self-test: …and it puts a chip on the screen that a mangled value does not',
    real.chips.join(' | '),
  )
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed, ${failed.length} FAILED`)
for (const f of failed) console.log(`  FAIL ${f.label}${f.detail ? ` — ${f.detail}` : ''}`)

page.close()
chrome.child.kill()
process.exit(failed.length === 0 ? 0 : 1)
