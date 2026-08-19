// A MONTH NOBODY TYPED IS NEVER 0,00 EUR - ON EVERY SURFACE THAT PRINTS MONEY.
//
//   cd web && pnpm build
//   DATABASE_URL=postgres:///nfc_demo APP_KEY=… PORT=8080 PUBLIC_DIR="$PWD/web/out" \
//     node server/server.js &
//   DATABASE_URL=postgres:///nfc_demo node demo/check-revenue-unknown.mjs
//
// WHY A BROAD CHECK AND NOT ANOTHER TARGETED ONE. This exact confusion - the unknown
// rendered as a confident zero - has been shipped and re-found four times in this project,
// and every time the assertion that existed was pointed at the surface somebody had thought
// of. The one that caught it was always the broad one. decision-42 states the rule in one
// line: THE ABSENCE OF A ROW IS THE UNKNOWN, and 0 is a different, real answer meaning "they
// paid nothing this month".
//
// SO THE LIST OF SURFACES IS NOT WRITTEN DOWN HERE. It is GREPPED out of web/ - every file
// that formats a currency - and mapped to the route that renders it. A new money surface is
// therefore in scope the moment it exists, and a file this check cannot place fails it
// rather than being skipped. That is the whole design: the failure mode being defended
// against is somebody adding a seventh screen, not somebody breaking the six.
//
// THE STATE IT DRIVES, and it drives it for real rather than mocking it: every
// location_revenue row in nfc_demo is stamped superseded_at, which is decision-42's own
// retraction path - "the month reverts to UNKNOWN rather than to 0". So the whole portfolio
// is unknown, on every screen, at once. Restored in `finally`, and the row counts are
// compared before and after.
//
// TWO WAYS TO PASS FOR THE WRONG REASON, both closed:
//   1. a screen that renders NO money at all trivially renders no wrong money. So the same
//      sweep runs a SECOND time with the rows live, and every surface must then print at
//      least one amount. A surface that is silent both times is reported, not passed.
//   2. "0,00" reached by grepping innerText would also match a genuine typed zero. So the
//      genuine zero is left in place (nfc_demo seeds one) and asserted to still be there.
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { attach, launchChrome, sleep } from './cdp.mjs'
import { assertDemoDatabase } from './db-guard.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:8080'
const EMAIL = process.env.DEMO_EMAIL ?? 'demo@example.test'
const PASSWORD = process.env.DEMO_PASSWORD ?? 'demo-nur-lokal-2026'
const DATABASE_URL = process.env.DATABASE_URL ?? ''

if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(BASE)) {
  throw new Error(`refusing a non-loopback target: ${BASE}`)
}
// This file WRITES to the database (it retracts every revenue row and puts them back), so
// the same guard demo/seed.sql and demo/make-admin.mjs carry, before the first query.
assertDemoDatabase(DATABASE_URL, (why) => {
  console.error(`check-revenue-unknown: ${why}`)
  process.exit(1)
})

const sql = (q) =>
  execFileSync('psql', [DATABASE_URL, '-v', 'ON_ERROR_STOP=1', '-q', '-t', '-A', '-c', q], {
    encoding: 'utf8',
  }).trim()

const failures = []
const notes = []
const ok = (label, detail) => notes.push(`  ok   ${label}${detail ? ` — ${detail}` : ''}`)
const bad = (label, detail) => {
  notes.push(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  failures.push(label)
}

// ---------------------------------------------------------------------------------------
// 1 · THE SURFACES, GREPPED. Not a list somebody maintains.
// ---------------------------------------------------------------------------------------
// Anything that asks Intl for a currency renders money. `money(` alone would miss the four
// screens that inline the formatter, and a hand-list would miss the next one.
const MONEY = /style:\s*['"]currency['"]|currency:\s*['"]EUR['"]/

/** file -> the route that renders it. A component is placed by the routes that mount it. */
const ROUTE_OF = {
  'app/pl/page.tsx': ['/pl/?period=thisYear', '/pl/?period=lastMonth', '/pl/'],
  'app/payroll/page.tsx': ['/payroll/?period=thisYear', '/payroll/'],
  'app/contracts/page.tsx': ['/contracts/'],
  'app/locations/page.tsx': ['/locations/'],
  'app/inventory/page.tsx': ['/inventory/'],
  'app/workers/page.tsx': ['/workers/'],
  'app/material-requests/page.tsx': ['/material-requests/'],
  // Mounted on the dashboard (the map info box and the building panel) and on /locations/.
  'components/BuildingFacts.tsx': ['/', '/locations/'],
  // The worker panel opens from /workers/ and from the shift log.
  'components/WorkerPanel.tsx': ['/workers/', '/shifts/'],
}

const walk = (dir, out = []) => {
  for (const e of readdirSync(new URL(`../web/${dir}/`, import.meta.url), {
    withFileTypes: true,
  })) {
    if (e.name === 'node_modules') continue
    if (e.isDirectory()) walk(`${dir}/${e.name}`, out)
    else if (/\.tsx?$/.test(e.name)) out.push(`${dir}/${e.name}`)
  }
  return out
}

const moneyFiles = [...walk('app'), ...walk('components')].filter((f) =>
  MONEY.test(readFileSync(new URL(`../web/${f}`, import.meta.url), 'utf8')),
)
const unplaced = moneyFiles.filter((f) => ROUTE_OF[f] === undefined)
if (unplaced.length > 0) {
  bad(
    'every file that formats money is placed on a route this check drives',
    `${unplaced.join(', ')} — add it to ROUTE_OF, do not delete this assertion`,
  )
} else {
  ok(
    'every file that formats money is placed on a route this check drives',
    `${moneyFiles.length} files: ${moneyFiles.map((f) => f.replace(/^app\/|\/page\.tsx$|^components\//, '')).join(', ')}`,
  )
}
const ROUTES = [...new Set(moneyFiles.flatMap((f) => ROUTE_OF[f] ?? []))]

// ---------------------------------------------------------------------------------------
// 2 · THE SWEEP
// ---------------------------------------------------------------------------------------
/**
 * Every amount on the page, with the words around it.
 *
 * IT WALKS TEXT NODES, and the first version did not. That version took every ELEMENT whose
 * textContent held money and whose children held none - which sounds like "the leaf that
 * owns the amount" and is not. On /pl/ the building row is
 *
 *     <td>0,00\u00a0€<span class="shift-state-note">Vereinbart 10.200,00\u00a0€</span></td>
 *
 * so the `0,00 €` is a BARE TEXT NODE of the td and the td was excluded for having a
 * money-bearing child. The zero - the whole thing this file exists to find - was invisible,
 * and the check reported OK against a bundle deliberately mutated to render exactly it.
 * It only went red once an unrelated fixture change removed the sibling span.
 *
 * A check that can be blinded by a sibling is not broad. So: every text node, judged on its
 * OWN text, with its owning element for context.
 */
const AMOUNTS = `(() => {
  const money = /(\\d{1,3}(?:\\.\\d{3})*|\\d+),(\\d{2})\\s*[\\u00a0 ]?€/
  const out = []
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
    const m = (n.nodeValue || '').match(money)
    if (m === null) continue
    const el = n.parentElement
    if (el === null) continue
    // A screen-reader-only duplicate of a visible amount is not a second amount.
    if (el.closest('.visually-hidden') !== null) continue
    const cell = el.closest('td, th, dd, li, p, div') || el
    const td = el.closest('td, th')
    let column = ''
    let row = ''
    if (td !== null) {
      const table = td.closest('table')
      const i = Array.from(td.parentElement.children).indexOf(td)
      const head = table && table.tHead ? table.tHead.rows[0] : null
      if (head && head.cells[i]) column = (head.cells[i].textContent || '').trim()
      // WHICH ROW, so the two passes are compared cell by cell rather than by a count that
      // a re-ordering would smear. The row header is the building or the person.
      const first = td.parentElement.cells[0]
      row = first ? (first.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 40) : ''
    }
    out.push({
      amount: m[0].trim(),
      zero: m[1] === '0' && m[2] === '00',
      // The OWNING text node's words, then the cell's, so a sub-line that explains a
      // sibling cannot be borrowed to explain this one.
      own: (n.nodeValue || '').replace(/\\s+/g, ' ').trim().slice(0, 80),
      where: (cell.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 120),
      column,
      // NOT OPTIONAL, and leaving it out of this object is how the differential below went
      // green against a live mutant: every /contracts/ amount keyed as (route, column,
      // undefined), one row already had a true zero, and all six of the mutant's zeros
      // collided with it and were forgiven as "already true".
      row,
    })
  }
  return out
})()`

/** The words a screen is allowed to use for "nobody has told me". Both locales. */
const UNKNOWN_WORDS =
  /Nicht eingetragen|Noch nicht eingetragen|Kein Wert|Not entered|No figure|Unbekannt|Unknown/i
/**
 * THERE IS NO LIST OF "REVENUE COLUMNS" HERE, AND THERE WAS, AND THAT WAS THE BUG.
 *
 * The first version decided whether a zero mattered by matching the column heading against
 * /Umsatz|Erlös|Revenue|Vertrag|vereinbart|.../ . A mutant that rendered a null contract as
 * 0,00 € on /contracts/ passed it, because that column is headed „Aktueller Preis pro
 * Monat“ — a heading nobody had thought of. Deciding by vocabulary IS the targeted
 * assertion this file exists to replace; it just moved the target from the screen to the
 * word list.
 *
 * SO THE ORACLE IS DIFFERENTIAL AND HAS NO VOCABULARY IN IT AT ALL:
 *
 *   sweep once with every figure entered      -> the zeros that are TRUE
 *   retract every figure, sweep again         -> the zeros that are there NOW
 *   any zero the retraction ADDED is a null being rendered as a confident 0,00 €
 *
 * Labour, material, stock value and payouts are untouched by the retraction, so their real
 * zeros appear in both passes and cancel. A screen that correctly says „Nicht eingetragen“
 * adds none. A screen that prints 0,00 € adds one, whatever its column is called, on a
 * route added next year, in either locale.
 */
const zeroKey = (route, a) => `${route}\u0000${a.column}\u0000${a.row}`

/**
 * THE PANELS COUNT AS SURFACES, and on two routes they are the ONLY surface.
 *
 * BuildingFacts and WorkerPanel are where the dashboard and the shift log print money, and
 * both are behind a row control. A sweep that only reads the page as loaded finds nothing
 * on `/` and `/shifts/` and would then have to be told that silence is fine there — which
 * is precisely the exemption that lets a defect live behind a click.
 */
const OPEN_PANEL = `(() => {
  const hit = Array.from(document.querySelectorAll('button, a, [role=button]'))
    .find((el) => /panel \u00f6ffnen|open panel|Objektpanel|Mitarbeiterpanel/i.test(el.getAttribute('aria-label') || el.textContent || ''))
  if (!hit) return false
  hit.click()
  return true
})()`

async function sweep(page) {
  const seen = []
  for (const route of ROUTES) {
    await page.goto(`${BASE}${route}`, { settle: 1400 })
    const amounts = await page.eval(AMOUNTS)
    // ...and then again with the first panel open, merged. Opening it unconditionally
    // rather than only when the page looked empty means the panel is swept on the routes
    // that ALSO print money in the table, where a defect would otherwise hide behind a
    // green table.
    const opened = await page.eval(OPEN_PANEL)
    if (opened) {
      await sleep(700)
      const inPanel = await page.eval(AMOUNTS)
      const seenText = new Set(amounts.map((a) => `${a.amount}|${a.own}|${a.where}`))
      for (const a of inPanel) if (!seenText.has(`${a.amount}|${a.own}|${a.where}`)) amounts.push(a)
      await page.send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'Escape',
        code: 'Escape',
        windowsVirtualKeyCode: 27,
      })
      await page.send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: 'Escape',
        code: 'Escape',
        windowsVirtualKeyCode: 27,
      })
      await sleep(250)
    }
    seen.push({ route, amounts, panel: opened })
  }
  return seen
}

// THE EXACT IDS THAT ARE IN FORCE, not a count. The restore below re-clears superseded_at
// on these rows and NO OTHERS: nfc_demo seeds a genuine correction, so a blanket
// `WHERE superseded_at IS NOT NULL -> NULL` would resurrect a retracted figure, put two
// live rows in one (building, month) and trip location_revenue_one_live_idx. It would also
// silently change the demo fixture's meaning for every later run.
const LIVE_IDS_SQL =
  "SELECT string_agg(id::text, ',' ORDER BY id) FROM location_revenue WHERE superseded_at IS NULL"
const LIVE_IDS = sql(LIVE_IDS_SQL)
// (id, valid_to) for every contract row, so the expiry below is reversed value by value
// rather than by a rule that would flatten a genuinely-ended contract into an open one.
const CONTRACTS_SQL =
  "SELECT id || '=' || coalesce(valid_to::text, '') FROM location_contracts ORDER BY id"
const contractsBefore = sql(CONTRACTS_SQL)
// ...AND the column on `locations`, which is the one four screens actually read. Expiring
// `location_contracts` alone changed nothing on /contracts/, /locations/ or the panels:
// `locations.monthly_contract_cents` is a stored column (003), not a view over the history
// (005). A retraction that misses it leaves the contract arm of this check as decoration -
// a mutant that renders a null contract as 0,00 € passed while it did.
const PRICES_SQL =
  "SELECT id || '=' || coalesce(monthly_contract_cents::text, '') FROM locations ORDER BY id"
const pricesBefore = sql(PRICES_SQL)
const before = {
  revenueRows: sql('SELECT count(*) FROM location_revenue'),
  live: sql('SELECT count(*) FROM location_revenue WHERE superseded_at IS NULL'),
  supersededAlready: sql('SELECT count(*) FROM location_revenue WHERE superseded_at IS NOT NULL'),
  typedZeros: sql(
    'SELECT count(*) FROM location_revenue WHERE superseded_at IS NULL AND amount_cents = 0',
  ),
}
if (LIVE_IDS === '' || before.live === '0') {
  console.log(
    'SKIP check-revenue-unknown: nfc_demo has no revenue figure in force — nothing to retract',
  )
  process.exit(0)
}

let chrome
try {
  chrome = await launchChrome({ port: 9430, width: 1680, height: 1050 })
  const page = await attach(9430)
  await page.goto(`${BASE}/login/`, { settle: 700 })
  await page.type('input[name="email"]', EMAIL, { perChar: 4 })
  await page.type('input[name="password"]', PASSWORD, { perChar: 4 })
  await page.eval(`document.querySelector('form button[type="submit"]').click()`)
  await page.waitFor(`location.pathname === '/'`, { label: 'the dashboard after sign-in' })
  await sleep(800)

  // ---- PASS A: the rows are live. Every money surface must actually PRINT money. -------
  const withRows = await sweep(page)
  const silent = withRows.filter((r) => r.amounts.length === 0).map((r) => r.route)
  if (silent.length > 0) {
    bad(
      'with revenue entered, every money route prints at least one amount',
      `silent: ${silent.join(', ')} — a screen with no money on it cannot prove the rule below`,
    )
  } else {
    ok(
      'with revenue entered, every money route prints at least one amount',
      withRows.map((r) => `${r.route} ${r.amounts.length}`).join(' · '),
    )
  }
  // A GENUINE TYPED ZERO IS STILL AN AMOUNT. nfc_demo seeds one; if the seed ever stops
  // seeding it, the zero-hunt below would be hunting nothing and would pass emptily.
  const genuineZeros = withRows.flatMap((r) => r.amounts.filter((a) => a.zero))
  if (Number(before.typedZeros) > 0 && genuineZeros.length === 0) {
    bad(
      'a TYPED zero still renders as 0,00 € — it is an answer, not the unknown',
      `${before.typedZeros} typed zero(s) in the database and none on any screen`,
    )
  } else {
    ok(
      'a TYPED zero still renders as 0,00 € — it is an answer, not the unknown',
      `${before.typedZeros} in the database, ${genuineZeros.length} on screen`,
    )
  }

  // ---- retract every figure. decision-42's own path: the month reverts to UNKNOWN. -----
  sql(`UPDATE location_revenue SET superseded_at = now() WHERE id IN (${LIVE_IDS})`)
  const nowLive = sql('SELECT count(*) FROM location_revenue WHERE superseded_at IS NULL')
  ok(
    'every revenue figure retracted (decision-42 §1), so the portfolio is UNKNOWN',
    `${before.live} live -> ${nowLive} live`,
  )
  // AND EVERY CONTRACT EXPIRED. `monthly_contract_cents` is NOT NULL, so "unknown" for a
  // contract is the ABSENCE OF A CURRENT ROW, not a null column - expiring them all is the
  // only honest way to reach that state without deleting history. Reversed from the map
  // captured above, value by value.
  sql('UPDATE location_contracts SET valid_to = valid_from')
  sql('UPDATE locations SET monthly_contract_cents = NULL')
  ok(
    'every contract retracted too, so the OTHER unknown is on screen in the same sweep',
    `${contractsBefore.split('\n').filter(Boolean).length} history row(s) expired, ` +
      `${pricesBefore.split('\n').filter(Boolean).length} building price(s) cleared`,
  )

  // ---- PASS B: nothing anywhere may print a revenue zero -------------------------------
  const without = await sweep(page)
  // The zeros that were ALREADY true, keyed by where they were. Everything in pass B that
  // is not in here appeared BECAUSE a fact became unknown.
  const zerosBefore = new Set()
  for (const { route, amounts } of withRows) {
    for (const a of amounts) if (a.zero) zerosBefore.add(zeroKey(route, a))
  }
  const wrong = []
  for (const { route, amounts } of without) {
    for (const a of amounts) {
      if (!a.zero) continue
      if (zerosBefore.has(zeroKey(route, a))) continue // a true zero, unchanged by retraction
      wrong.push(`${route} [${a.column || '—'}] ${a.row ? `${a.row}: ` : ''}"${a.own}"`)
    }
  }
  const swept = without.reduce((n, r) => n + r.amounts.length, 0)
  if (wrong.length > 0) {
    bad(
      'retracting a figure never turns an amount into 0,00 € — on ANY money surface',
      `${wrong.length} new zero(s): ${wrong.slice(0, 6).join(' | ')}`,
    )
  } else {
    ok(
      'retracting a figure never turns an amount into 0,00 € — on ANY money surface',
      `${swept} amounts across ${ROUTES.length} routes, ${zerosBefore.size} zero(s) true before and after, 0 new`,
    )
  }
  // ...and it must SAY so, or "no zero" is satisfied by printing nothing at all.
  await page.goto(`${BASE}/pl/?period=thisYear`, { settle: 1400 })
  const says = await page.eval(
    `new RegExp(${JSON.stringify(UNKNOWN_WORDS.source)}, 'i').test(document.body.innerText)`,
  )
  if (says) ok('...and the screen SAYS the figure is missing rather than going quiet')
  else
    bad(
      '...and the screen SAYS the figure is missing rather than going quiet',
      'no unknown wording on /pl/',
    )
} finally {
  // PUT IT BACK. A check that leaves the demo database retracted poisons every later run,
  // and this one runs inside `finally` so a probe killed mid-sweep still restores.
  sql(`UPDATE location_revenue SET superseded_at = NULL WHERE id IN (${LIVE_IDS})`)
  for (const pair of contractsBefore.split('\n').filter(Boolean)) {
    const [id, validTo] = pair.split('=')
    sql(
      `UPDATE location_contracts SET valid_to = ${validTo === '' ? 'NULL' : `'${validTo}'`} WHERE id = ${id}`,
    )
  }
  for (const pair of pricesBefore.split('\n').filter(Boolean)) {
    const [id, cents] = pair.split('=')
    sql(
      `UPDATE locations SET monthly_contract_cents = ${cents === '' ? 'NULL' : cents} WHERE id = '${id}'`,
    )
  }
  if (chrome) chrome.child.kill()
}

// CHECKED, not assumed, and on all three numbers: a restore that put back the wrong rows
// would leave the same TOTAL while changing which month is in force.
const after = {
  revenueRows: sql('SELECT count(*) FROM location_revenue'),
  live: sql('SELECT count(*) FROM location_revenue WHERE superseded_at IS NULL'),
  supersededAlready: sql('SELECT count(*) FROM location_revenue WHERE superseded_at IS NOT NULL'),
}
const restored =
  sql(CONTRACTS_SQL) === contractsBefore &&
  sql(PRICES_SQL) === pricesBefore &&
  after.revenueRows === before.revenueRows &&
  after.live === before.live &&
  after.supersededAlready === before.supersededAlready &&
  sql(LIVE_IDS_SQL) === LIVE_IDS
if (restored) {
  ok(
    'teardown: nfc_demo is back where it started',
    `${after.revenueRows} rows, ${after.live} in force, the same ids`,
  )
} else {
  bad(
    'teardown: nfc_demo is back where it started',
    `rows ${before.revenueRows}->${after.revenueRows}, live ${before.live}->${after.live}, superseded ${before.supersededAlready}->${after.supersededAlready}`,
  )
}

console.log(notes.join('\n'))
if (failures.length > 0) {
  console.error(`\ncheck-revenue-unknown: ${failures.length} FAILED\n  ${failures.join('\n  ')}`)
  process.exit(1)
}
console.log('\ncheck-revenue-unknown: OK')
