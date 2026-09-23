'use client'

import { useTranslations } from 'next-intl'
import { type FormEvent, useRef, useState } from 'react'
import { Field } from '@/components/Field'
import { ScheduleCost } from '@/components/ScheduleCost'
import type { Location, Worker } from '@/lib/api'
import { type Assignment, today } from '@/lib/schedule'
import { fromBusinessInput, toBusinessInput } from '@/lib/shifts'

export type PlanInput = {
  id: string
  worker_id: number
  location_id: string
  starts_at: string
  ends_at: string
  note: string
  version?: number
}

export function ScheduleForm({
  assignment,
  date,
  workers,
  locations,
  pending,
  onSave,
  onError,
}: {
  assignment: Assignment | null
  date: string
  workers: Worker[]
  locations: Location[]
  pending: boolean
  onSave: (plan: PlanInput) => void
  onError: (message: string) => void
}) {
  const t = useTranslations('schedule')
  const id = useRef('')
  const nextHour = new Date(Math.ceil((Date.now() + 60_000) / 3_600_000) * 3_600_000)
  const initialStart = assignment
    ? toBusinessInput(assignment.starts_at)
    : date === today()
      ? toBusinessInput(nextHour.toISOString())
      : `${date}T08:00`
  const initialEnd = assignment
    ? toBusinessInput(assignment.ends_at)
    : date === today()
      ? toBusinessInput(new Date(nextHour.getTime() + 7_200_000).toISOString())
      : `${date}T10:00`
  const [preview, setPreview] = useState({
    worker: String(assignment?.worker_id ?? ''),
    start: initialStart,
    end: initialEnd,
  })
  const start = fromBusinessInput(preview.start)
  const end = fromBusinessInput(preview.end)
  const validPreview =
    start &&
    end &&
    end > start &&
    toBusinessInput(start) === preview.start &&
    toBusinessInput(end) === preview.end &&
    Date.parse(end) - Date.parse(start) <= 86400000
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const startText = String(data.get('starts'))
    const endText = String(data.get('ends'))
    const starts = fromBusinessInput(startText)
    const ends = fromBusinessInput(endText)
    // Refuse non-existent spring-clock times rather than silently moving a plan.
    if (
      !starts ||
      !ends ||
      toBusinessInput(starts) !== startText ||
      toBusinessInput(ends) !== endText ||
      ends <= starts ||
      Date.parse(ends) - Date.parse(starts) > 86400000
    ) {
      onError(t('invalidTime'))
      return
    }
    if (!id.current) id.current = assignment?.id ?? crypto.randomUUID()
    onSave({
      id: id.current,
      worker_id: Number(data.get('worker')),
      location_id: String(data.get('location')),
      starts_at: starts,
      ends_at: ends,
      note: String(data.get('note')),
      version: assignment?.version,
    })
  }
  return (
    <form
      id="schedule-form"
      className="schedule-form"
      onSubmit={submit}
      onChange={(event) => {
        const data = new FormData(event.currentTarget)
        setPreview({
          worker: String(data.get('worker') ?? ''),
          start: String(data.get('starts') ?? ''),
          end: String(data.get('ends') ?? ''),
        })
      }}
    >
      <p className="muted">{t('timeZone')}</p>
      <Field id="plan-worker" label={t('worker')} required>
        <select
          name="worker"
          required
          disabled={pending}
          defaultValue={assignment?.worker_id ?? ''}
        >
          <option value="" disabled>
            {t('chooseWorker')}
          </option>
          {workers
            .filter((w) => w.active || w.id === assignment?.worker_id)
            .map((w) => (
              <option value={w.id} key={w.id} disabled={!w.active}>
                {w.name}
              </option>
            ))}
        </select>
      </Field>
      <Field id="plan-location" label={t('location')} required>
        <select
          name="location"
          required
          disabled={pending}
          defaultValue={assignment?.location_id ?? ''}
        >
          <option value="" disabled>
            {t('chooseLocation')}
          </option>
          {locations
            .filter((l) => l.active || l.id === assignment?.location_id)
            .map((l) => (
              <option value={l.id} key={l.id} disabled={!l.active}>
                {l.name}
              </option>
            ))}
        </select>
      </Field>
      <Field id="plan-start" label={t('start')} required>
        <input
          name="starts"
          type="datetime-local"
          required
          disabled={pending}
          defaultValue={initialStart}
        />
      </Field>
      <Field id="plan-end" label={t('end')} required>
        <input
          name="ends"
          type="datetime-local"
          required
          disabled={pending}
          defaultValue={initialEnd}
        />
      </Field>
      <Field id="plan-note" label={t('note')} optional>
        <textarea
          name="note"
          maxLength={1000}
          rows={3}
          disabled={pending}
          defaultValue={assignment?.note ?? ''}
        />
      </Field>
      {validPreview && preview.worker ? (
        <ScheduleCost
          preview
          workers={workers}
          from={start}
          to={end}
          assignments={[
            {
              worker_id: Number(preview.worker),
              worker_name: workers.find((w) => w.id === Number(preview.worker))?.name ?? '',
              starts_at: start,
              ends_at: end,
              cancelled_at: null,
            },
          ]}
        />
      ) : (
        <p role="status">{t('costChoose')}</p>
      )}
    </form>
  )
}
