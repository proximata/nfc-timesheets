'use client'

import { useFormatter, useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { Drawer } from '@/components/Drawer'
import { Field } from '@/components/Field'
import { PeriodPicker } from '@/components/PeriodPicker'
import { type AdminSnapshot, fetchPl, isClosedRange, type PlReport } from '@/lib/api'
import type { Period, PeriodRange } from '@/lib/period'
import { type ExportSelection, exportTables, workbookSheets } from '@/lib/report-export'
import { toBusinessInput } from '@/lib/shifts'

export function ReportExport({
  snapshot,
  range,
  selection,
  onChange,
  snapshotError,
  onRetry,
}: {
  snapshot: AdminSnapshot | null
  snapshotError: boolean
  onRetry: () => void
  range: PeriodRange
  selection: {
    worker: number | null
    location: string | null
    period: Period
    start: string | null
    end: string | null
  }
  onChange: (next: Partial<typeof selection>) => void
}) {
  const t = useTranslations('reportExport')
  const format = useFormatter()
  const [open, setOpen] = useState(false)
  const [sections, setSections] = useState({ employees: true, buildings: true, zones: false })
  const [report, setReport] = useState<PlReport | null>(null)
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [retry, setRetry] = useState(0)
  // biome-ignore lint/correctness/useExhaustiveDependencies: retry explicitly reloads a failed report.
  useEffect(() => {
    setReport(null)
    setError(false)
    setDone(false)
    if (!open || !isClosedRange(range)) return
    const controller = new AbortController()
    fetchPl(range, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setReport(value)
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true)
      })
    return () => controller.abort()
  }, [open, range.from, range.to, retry])
  const ready =
    snapshot &&
    report &&
    range.from &&
    range.to &&
    snapshot.shift_range.from &&
    snapshot.shift_range.to &&
    Date.parse(snapshot.shift_range.from) === Date.parse(range.from) &&
    Date.parse(snapshot.shift_range.to) === Date.parse(range.to) &&
    Date.parse(report.range.from) === Date.parse(range.from) &&
    Date.parse(report.range.to) === Date.parse(range.to)
  const truncated = snapshot !== null && snapshot.shifts.length >= snapshot.shift_limit
  const selected: ExportSelection = { ...selection, ...sections }
  const translate = (key: string) => t(key as Parameters<typeof t>[0])
  const tables = ready ? exportTables(snapshot, report, selected, translate) : []
  const notes = [
    t('rules'),
    t('rounding'),
    t('zoneNote'),
    t('phoneNote'),
    t('manualNote'),
    ...(selection.worker ? [t('workerMaterials')] : []),
    ...(report
      ? [
          t('materialNote', {
            unpriced: report.materials.unpriced_requests,
            unallocated: format.number(report.materials.unallocated_cents / 100, {
              style: 'currency',
              currency: 'EUR',
            }),
          }),
        ]
      : []),
  ]
  async function download() {
    if (!ready || truncated || !isClosedRange(range) || !tables.length) return
    setBusy(true)
    setError(false)
    setDone(false)
    try {
      const { default: writeExcel } = await import('write-excel-file/universal')
      const from = toBusinessInput(range.from).slice(0, 10)
      const end = toBusinessInput(new Date(Date.parse(range.to) - 1).toISOString()).slice(0, 10)
      const context = [
        t('range', { from, to: end }),
        t('selection', {
          worker: snapshot.workers.find((w) => w.id === selection.worker)?.name ?? t('all'),
          building: snapshot.locations.find((l) => l.id === selection.location)?.name ?? t('all'),
        }),
        ...notes,
      ]
      const workbook = await writeExcel(
        workbookSheets(tables, context, translate, `${from}T12:00:00Z`, `${end}T12:00:00Z`),
      )
      const blob = await workbook.toBlob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      try {
        anchor.href = url
        anchor.download = `timesheets-${from}-${end}.xlsx`
        document.body.append(anchor)
        anchor.click()
        setDone(true)
      } finally {
        window.setTimeout(() => {
          anchor.remove()
          URL.revokeObjectURL(url)
        }, 1000)
      }
    } catch {
      setError(true)
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <button className="btn btn-primary" type="button" onClick={() => setOpen(true)}>
        {t('openExport')}
      </button>
      <p role="status">{done ? t('downloadStarted') : ''}</p>
      <Drawer
        open={open}
        title={t('title')}
        busy={busy}
        onClose={() => {
          if (!busy) setOpen(false)
        }}
        footer={
          <button
            className="btn btn-primary"
            type="button"
            disabled={
              !ready ||
              busy ||
              truncated ||
              !tables.length ||
              !tables.some((table) => table.rows.length)
            }
            onClick={() => void download()}
          >
            {t(busy ? 'creating' : 'download')}
          </button>
        }
      >
        <fieldset disabled={busy} style={{ display: 'grid', gap: 16, border: 0, padding: 0 }}>
          <legend>{t('filters')}</legend>
          <PeriodPicker label={t('period')} value={selection} onChange={onChange} />
          <Field id="export-worker" label={t('worker')}>
            <select
              value={selection.worker ?? ''}
              onChange={(e) => {
                setDone(false)
                onChange({ worker: e.target.value ? Number(e.target.value) : null })
              }}
            >
              <option value="">{t('all')}</option>
              {snapshot?.workers.map((w) => (
                <option value={w.id} key={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </Field>
          <Field id="export-building" label={t('building')}>
            <select
              value={selection.location ?? ''}
              onChange={(e) => {
                setDone(false)
                onChange({ location: e.target.value || null })
              }}
            >
              <option value="">{t('all')}</option>
              {snapshot?.locations.map((l) => (
                <option value={l.id} key={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </Field>
          {(['employees', 'buildings', 'zones'] as const).map((key) => (
            <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input
                type="checkbox"
                checked={sections[key]}
                onChange={(e) => {
                  setDone(false)
                  setSections({ ...sections, [key]: e.target.checked })
                }}
              />
              {t(key)}
            </label>
          ))}
        </fieldset>
        <p>{t('sharedFilters')}</p>
        {notes.map((note) => (
          <p key={note}>{note}</p>
        ))}
        {error || snapshotError ? (
          <p role="alert">
            {t('error')}{' '}
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setRetry((value) => value + 1)
                onRetry()
              }}
            >
              {t('retry')}
            </button>
          </p>
        ) : !ready ? (
          <p role="status">{t('loading')}</p>
        ) : null}
        {truncated ? <p role="alert">{t('truncated')}</p> : null}
        {ready && !tables.some((table) => table.rows.length) ? (
          <p role="status">{t('empty')}</p>
        ) : null}
        {tables.map((table) => (
          <section key={table.key}>
            <h3>{t(table.key)}</h3>
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    {table.headers.map((header) => (
                      <th key={header} scope="col">
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((row, index) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: immutable read-only snapshot rows have no local state or controls.
                    <tr key={`${table.key}-${index}`}>
                      {row.map((value, column) => (
                        <td key={table.headers[column]}>
                          {value === null
                            ? t('unavailable')
                            : typeof value === 'number'
                              ? format.number(value, { maximumFractionDigits: 2 })
                              : value}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </Drawer>
    </>
  )
}
