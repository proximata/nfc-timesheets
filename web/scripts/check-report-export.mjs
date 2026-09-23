import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('@/'))
      return next(pathToFileURL(resolve(root, `${specifier.slice(2)}.ts`)).href, context)
    return next(specifier, context)
  },
})
const { plannedCost } = await import('../lib/schedule-cost.ts')
const { businessMidnight } = await import('../lib/period.ts')
const { exportTables, workbookSheets } = await import('../lib/report-export.ts')
const workers = [
  { id: 1, name: '=1+1', hourly_rate_cents: 1234 },
  { id: 2, name: 'Anna', hourly_rate_cents: 2000 },
]
const plan = (worker_id, starts_at, ends_at, cancelled_at = null) => ({
  worker_id,
  worker_name: 'Example',
  starts_at,
  ends_at,
  cancelled_at,
})
for (const [month, day, hours] of [
  [3, 29, 23],
  [10, 25, 25],
]) {
  const from = businessMidnight(2026, month, day),
    to = businessMidnight(2026, month, day + 1)
  const result = plannedCost([plan(1, from, to)], workers, from, to)
  assert.equal(result.ms / 3600000, hours)
  assert.equal(result.cents, 1234 * hours)
}
const from = '2026-09-20T22:00:00Z',
  to = '2026-09-27T22:00:00Z'
assert.equal(
  plannedCost(
    [
      plan(1, '2026-09-20T21:00:00Z', '2026-09-20T23:00:00Z'),
      plan(2, '2026-09-27T21:00:00Z', '2026-09-27T23:00:00Z'),
    ],
    workers,
    from,
    to,
  ).cents,
  3234,
)
assert.equal(plannedCost([plan(1, from, to, 'cancelled')], workers, from, to).cents, 0)
assert.equal(plannedCost([plan(9, from, to)], workers, from, to).cents, null)
assert.equal(
  plannedCost(
    [
      plan(1, from, '2026-09-20T22:00:01Z'),
      plan(1, '2026-09-20T22:00:01Z', '2026-09-20T22:00:02Z'),
    ],
    workers,
    from,
    to,
  ).cents,
  1,
)
const shift = (worker_id, location_id, end_time, auto_closed = false) => ({
  worker_id,
  location_id,
  start_time: '2026-09-21T08:00:00Z',
  end_time,
  auto_closed,
  corrected_at: null,
  client_uuid: 'a',
})
const snapshot = {
  workers,
  shifts: [
    shift(1, 'a', '2026-09-21T10:00:00Z'),
    shift(2, 'b', '2026-09-21T09:00:00Z'),
    shift(1, 'a', null),
    shift(2, 'b', '2026-09-21T16:00:00Z', true),
  ],
  locations: [
    { id: 'a', name: 'A' },
    { id: 'b', name: 'B' },
  ],
  zones: [
    { id: 'z', name: '=HYPERLINK("https://invalid.test")', location_id: 'a', area_sqm: null },
  ],
}
snapshot.shifts[0].manual_start = true
snapshot.shifts[0].client_uuid = null
snapshot.shifts[2].manual_close = true
const pl = {
  buildings: [
    {
      location_id: 'a',
      name: 'A',
      labour_seconds: 7200,
      labour_cents: 2468,
      material_cents: 100,
      open_shifts: 1,
      excluded_unresolved_shifts: 0,
    },
    {
      location_id: 'b',
      name: 'B',
      labour_seconds: 3600,
      labour_cents: 2000,
      material_cents: 50,
      open_shifts: 0,
      excluded_unresolved_shifts: 1,
    },
  ],
}
const selection = { worker: null, location: null, employees: true, buildings: true, zones: true }
const t = (key) => key
const tables = exportTables(snapshot, pl, selection, t)
assert.equal(tables[0].rows.at(-1)[3], 44.68)
assert.equal(tables[0].rows[0][6], 1)
assert.equal(tables[0].rows[0][7], 1)
assert.equal(tables[0].rows[0][8], 1)
assert.equal(tables[1].rows.at(-1)[4], 46.18)
assert.equal(tables[2].rows[0][2], null)
assert.equal(tables[2].rows[0][3], 'unavailable')
const filtered = exportTables(snapshot, pl, { ...selection, worker: 1, location: 'a' }, t)
assert.equal(filtered[0].rows[0][1], 2)
assert.equal(filtered[1].rows[0][3], null)
assert.equal(filtered[1].rows[0][4], null)
assert.equal(
  exportTables(snapshot, pl, { ...selection, location: 'unknown' }, t).every(
    (table) => table.rows.length === 0,
  ),
  true,
)
assert.equal(
  exportTables(snapshot, pl, { ...selection, employees: false, buildings: false, zones: false }, t)
    .length,
  0,
)
const { default: writeExcel } = await import('write-excel-file/universal')
const out = resolve(root, '../tmp/report-export')
mkdirSync(out, { recursive: true })
for (const language of ['de', 'en']) {
  const messages = JSON.parse(
    readFileSync(resolve(root, `messages/${language}.json`), 'utf8'),
  ).reportExport
  const sheets = workbookSheets(
    tables,
    ['Fixture report; test data only'],
    (key) => messages[key] ?? key,
    '2026-09-21T12:00:00Z',
    '2026-09-27T12:00:00Z',
  )
  const workbook = await writeExcel(sheets)
  const blob = await workbook.toBlob()
  writeFileSync(resolve(out, `${language}.xlsx`), Buffer.from(await blob.arrayBuffer()))
}
// biome-ignore lint/suspicious/noConsole: command-line verification result.
console.log(
  'PASS: DST 23/25h, clipping, cancellation, missing rate, per-worker rounding; filtered report/exclusions/unknown costs; DE+EN XLSX produced.',
)
