'use client'

import { useTranslations } from 'next-intl'
import { useEffect, useId, useState } from 'react'
import { isCalendarRange, PAYROLL_PERIODS, PERIODS, type Period } from '@/lib/period'

type Selection = { period: Period; start: string | null; end: string | null }

/** Shared report control. Native date inputs provide the calendar UI on every supported browser. */
export function PeriodPicker({
  value,
  onChange,
  allowAll = false,
  label,
  help,
}: {
  value: Selection
  onChange: (next: Selection) => void
  allowAll?: boolean
  label: string
  help?: string
}) {
  const t = useTranslations('periodPicker')
  const id = useId()
  const [choice, setChoice] = useState<Period>(value.period)
  const [start, setStart] = useState(value.start ?? '')
  const [end, setEnd] = useState(value.end ?? '')
  useEffect(() => {
    setChoice(value.period)
    setStart(value.start ?? '')
    setEnd(value.end ?? '')
  }, [value.period, value.start, value.end])
  const labels: Record<Period, string> = {
    last30Days: t('last30Days'),
    thisWeek: t('thisWeek'),
    lastWeek: t('lastWeek'),
    thisMonth: t('thisMonth'),
    lastMonth: t('lastMonth'),
    thisQuarter: t('thisQuarter'),
    thisYear: t('thisYear'),
    custom: t('custom'),
    all: t('all'),
  }
  const valid = isCalendarRange(start, end)
  return (
    <div className="field period-picker">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        value={choice}
        onChange={(event) => {
          const selected = event.target.value as Period
          setChoice(selected)
          if (selected !== 'custom') onChange({ period: selected, start: null, end: null })
        }}
      >
        {(allowAll ? PERIODS : PAYROLL_PERIODS).map((period) => (
          <option key={period} value={period}>
            {labels[period]}
          </option>
        ))}
      </select>
      {choice === 'custom' && (
        <div className="period-picker-dates">
          <label>
            {t('start')}
            <input type="date" value={start} onChange={(event) => setStart(event.target.value)} />
          </label>
          <label>
            {t('end')}
            <input
              type="date"
              min={start || undefined}
              value={end}
              onChange={(event) => setEnd(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={!valid}
            onClick={() => onChange({ period: 'custom', start, end })}
          >
            {t('apply')}
          </button>
          {start && end && !valid && (
            <p className="field-hint" role="alert">
              {t('invalid')}
            </p>
          )}
        </div>
      )}
      {help && <p className="field-hint">{help}</p>}
    </div>
  )
}
