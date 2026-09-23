'use client'
import { useFormatter, useTranslations } from 'next-intl'
import type { Worker } from '@/lib/api'
import { type CostAssignment, plannedCost } from '@/lib/schedule-cost'

export function ScheduleCost({
  assignments,
  workers,
  from,
  to,
  preview = false,
}: {
  assignments: CostAssignment[]
  workers: Worker[]
  from: string
  to: string
  preview?: boolean
}) {
  const t = useTranslations('schedule')
  const format = useFormatter()
  const result = plannedCost(assignments, workers, from, to)
  const hours = (ms: number) => format.number(ms / 3_600_000, { maximumFractionDigits: 2 })
  const money = (cents: number | null) =>
    cents === null
      ? t('costUnknown')
      : format.number(cents / 100, { style: 'currency', currency: 'EUR' })
  return (
    <section className="callout" aria-live={preview ? 'polite' : undefined}>
      <h2>{t(preview ? 'costPreview' : 'costTitle')}</h2>
      <p>{t('costTotal', { hours: hours(result.ms), amount: money(result.cents) })}</p>
      {result.lines.length === 0 ? (
        <p>{t('costEmpty')}</p>
      ) : (
        <ul>
          {result.lines.map((row) => (
            <li key={row.id}>
              {row.name}: {t('costTotal', { hours: hours(row.ms), amount: money(row.cents) })}
            </li>
          ))}
        </ul>
      )}
      <p>{t('costRule')}</p>
    </section>
  )
}
