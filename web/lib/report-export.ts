import type { Cell, SheetData } from 'write-excel-file/universal'
import { payrollFor } from '@/lib/payroll'
import type { AdminSnapshot, PlReport } from './api'

export type ExportSelection = {
  worker: number | null
  location: string | null
  employees: boolean
  buildings: boolean
  zones: boolean
}
export type ReportTable = {
  key: 'employees' | 'buildings' | 'zones'
  headers: string[]
  rows: (string | number | null)[][]
}

/** Build both the on-screen preview and workbook from the same selected rows. */
export function exportTables(
  snapshot: AdminSnapshot,
  pl: PlReport,
  selection: ExportSelection,
  t: (key: string) => string,
): ReportTable[] {
  const shifts = snapshot.shifts.filter(
    (s) =>
      (!selection.worker || s.worker_id === selection.worker) &&
      (!selection.location || s.location_id === selection.location),
  )
  const workers = snapshot.workers.filter((w) => !selection.worker || w.id === selection.worker)
  const totals = payrollFor(workers, shifts)
  const tables: ReportTable[] = []
  if (selection.employees)
    tables.push({
      key: 'employees',
      headers: [
        'worker',
        'hours',
        'rate',
        'labour',
        'open',
        'unresolved',
        'manualEntries',
        'manualStarts',
        'manualEnds',
      ].map(t),
      rows: totals.lines.map((l) => [
        l.worker.name,
        l.payableMs / 3_600_000,
        l.worker.hourly_rate_cents / 100,
        l.payCents / 100,
        l.openShifts,
        l.unresolvedShifts,
        l.manualShifts,
        shifts.filter((s) => s.worker_id === l.worker.id && s.manual_start).length,
        shifts.filter((s) => s.worker_id === l.worker.id && s.manual_close).length,
      ]),
    })
  const buildings = pl.buildings.filter(
    (b) =>
      (!selection.location || b.location_id === selection.location) &&
      (!selection.worker || shifts.some((s) => s.location_id === b.location_id)),
  )
  if (selection.buildings)
    tables.push({
      key: 'buildings',
      headers: ['building', 'hours', 'labour', 'materials', 'total', 'open', 'unresolved'].map(t),
      rows: buildings.map((b) => {
        if (!selection.worker)
          return [
            b.name,
            b.labour_seconds / 3600,
            b.labour_cents / 100,
            b.material_cents / 100,
            (b.labour_cents + b.material_cents) / 100,
            b.open_shifts,
            b.excluded_unresolved_shifts,
          ]
        const subtotal = payrollFor(
          workers,
          shifts.filter((s) => s.location_id === b.location_id),
        )
        // Material allocations belong to the building, not to a worker. Never filter the pool.
        return [
          b.name,
          subtotal.payableMs / 3_600_000,
          subtotal.payCents / 100,
          null,
          null,
          subtotal.openShifts,
          subtotal.unresolvedShifts,
        ]
      }),
    })
  if (selection.zones)
    tables.push({
      key: 'zones',
      headers: ['building', 'zone', 'area', 'zoneCosts'].map(t),
      rows: snapshot.zones
        .filter(
          (z) =>
            (!selection.location || z.location_id === selection.location) &&
            (!selection.worker || buildings.some((b) => b.location_id === z.location_id)),
        )
        .map((z) => [
          snapshot.locations.find((l) => l.id === z.location_id)?.name ?? t('unbound'),
          z.name,
          z.area_sqm,
          t('unavailable'),
        ]),
    })
  for (const table of tables) {
    if (table.key === 'zones' || table.rows.length === 0) continue
    const sum = table.headers.map((_, index) => {
      if (index === 0) return t('sum')
      if (table.key === 'employees' && index === 2) return null
      const values = table.rows.map((row) => row[index])
      if (values.some((value) => value === null)) return null
      const total = values.reduce<number>(
        (value, next) => value + (typeof next === 'number' ? next : 0),
        0,
      )
      return index === 1 ? total : Math.round(total * 100) / 100
    })
    table.rows.push(sum)
  }
  return tables
}

export function workbookSheets(
  tables: ReportTable[],
  notes: string[],
  t: (key: string) => string,
  from: string,
  to: string,
) {
  const cell = (value: string | number | null, money: boolean): Cell =>
    value === null
      ? null
      : typeof value === 'number'
        ? { value, type: Number, format: money ? '#,##0.00 "EUR"' : '#,##0.00' }
        : { value, type: String, wrap: true }
  const sheets = tables.map((table) => ({
    sheet: t(table.key),
    columns: table.headers.map((_, i) => ({ width: i === 0 ? 32 : 25 })),
    data: [
      table.headers.map((value) => ({ value, type: String, fontWeight: 'bold' as const })),
      ...table.rows.map((row) =>
        row.map((value, index) =>
          cell(
            value,
            table.key === 'employees'
              ? index === 2 || index === 3
              : table.key === 'buildings' && index >= 2 && index <= 4,
          ),
        ),
      ),
    ] as SheetData,
  }))
  sheets.push({
    sheet: t('notes'),
    columns: [{ width: 100 }],
    data: [
      [{ value: t('notes'), fontWeight: 'bold' }],
      [{ value: new Date(from), type: Date, format: 'yyyy-mm-dd' }],
      [{ value: new Date(to), type: Date, format: 'yyyy-mm-dd' }],
      ...notes.map((value) => [{ value, type: String, wrap: true }]),
    ] as SheetData,
  })
  return sheets
}
