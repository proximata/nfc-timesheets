'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useFormatter, useTranslations } from 'next-intl'
import { useCallback, useEffect, useState } from 'react'
import { ConfirmModal } from '@/components/ConfirmModal'
import { Drawer } from '@/components/Drawer'
import { ScheduleCost } from '@/components/ScheduleCost'
import { type PlanInput, ScheduleForm } from '@/components/ScheduleForm'
import { ApiError, apiFetch, type Location, type Worker } from '@/lib/api'
import { loginPathWithReturn } from '@/lib/nav'
import {
  type Assignment,
  calendarDay,
  dayStart,
  fetchSchedule,
  today,
  weekStart,
} from '@/lib/schedule'
import { toBusinessInput } from '@/lib/shifts'
import './schedule.css'

export default function SchedulePage() {
  const t = useTranslations('schedule')
  const errors = useTranslations('error')
  const format = useFormatter()
  const router = useRouter()
  const [week, setWeek] = useState('')
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [workers, setWorkers] = useState<Worker[]>([])
  const [locations, setLocations] = useState<Location[]>([])
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState<'' | 'saved' | 'cancelledNotice'>('')
  const [truncated, setTruncated] = useState(false)
  const [filter, setFilter] = useState('')
  const [revision, setRevision] = useState(0)
  const [editor, setEditor] = useState<{ assignment: Assignment | null; date: string } | null>(null)
  const [cancel, setCancel] = useState<Assignment | null>(null)
  const [formError, setFormError] = useState('')
  const failure = useCallback(
    (cause: unknown) => {
      if (cause instanceof ApiError) {
        if (cause.status === 401) router.replace(loginPathWithReturn())
        if (cause.code === 'schedule_overlap') return t('overlap')
        if (cause.code === 'schedule_changed') return t('changed')
        if (cause.code === 'schedule_in_past') return t('past')
        if (cause.code === 'schedule_target_unavailable') return t('unavailable')
        return errors(cause.messageKey)
      }
      return errors('network')
    },
    [errors, router, t],
  )
  useEffect(() => setWeek(weekStart(today())), [])
  // biome-ignore lint/correctness/useExhaustiveDependencies: revision explicitly reloads the server snapshot after a mutation or Refresh.
  useEffect(() => {
    if (!week) return
    const controller = new AbortController()
    setLoading(true)
    setError('')
    Promise.all([
      fetchSchedule(week, controller.signal),
      apiFetch<{ workers: Worker[]; locations: Location[] }>('/admin/data', {
        signal: controller.signal,
      }),
    ])
      .then(([plans, roster]) => {
        if (controller.signal.aborted) return
        setAssignments(plans.assignments)
        setTruncated(plans.truncated)
        setWorkers(roster.workers)
        setLocations(roster.locations)
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(failure(cause))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [week, revision, failure])
  async function save(plan: PlanInput) {
    setPending(true)
    setFormError('')
    setNotice('')
    try {
      await apiFetch(editor?.assignment ? `/admin/schedule/${plan.id}` : '/admin/schedule', {
        method: editor?.assignment ? 'PUT' : 'POST',
        body: plan,
      })
      setEditor(null)
      setWeek(weekStart(toBusinessInput(plan.starts_at).slice(0, 10)))
      setNotice('saved')
      setRevision((value) => value + 1)
    } catch (cause) {
      setFormError(failure(cause))
    } finally {
      setPending(false)
    }
  }
  async function cancelPlan() {
    if (!cancel) return
    setPending(true)
    setNotice('')
    try {
      await apiFetch(`/admin/schedule/${cancel.id}/cancel`, {
        method: 'POST',
        body: { version: cancel.version },
      })
      setCancel(null)
      setNotice('cancelledNotice')
      setRevision((value) => value + 1)
    } catch (cause) {
      setError(failure(cause))
      setCancel(null)
    } finally {
      setPending(false)
    }
  }
  function openEditor(assignment: Assignment | null, date: string) {
    setFormError('')
    setEditor({ assignment, date })
  }
  const visible = assignments.filter((plan) => !filter || String(plan.worker_id) === filter)
  const active = visible.filter((plan) => !plan.cancelled_at)
  const days = week ? Array.from({ length: 7 }, (_, offset) => calendarDay(week, offset)) : []
  const dayLabel = (day: string) =>
    format.dateTime(new Date(`${day}T12:00:00Z`), {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: 'Europe/Vienna',
    })
  const timeLabel = (iso: string) =>
    format.dateTime(new Date(iso), {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/Vienna',
    })
  return (
    <div className="workspace-page schedule-page">
      <header className="workspace-heading">
        <div>
          <p className="workspace-eyebrow">{t('eyebrow')}</p>
          <h1>{t('title')}</h1>
          <p className="lede">{t('intro')}</p>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          disabled={loading || !!error || pending}
          onClick={() => openEditor(null, today())}
        >
          {t('add')}
        </button>
      </header>
      <div className="schedule-notice">
        <span aria-hidden="true">◷</span>
        <p>
          {t('planOnly')} <Link href="/shifts/">{t('actual')}</Link>
        </p>
      </div>
      <div className="schedule-toolbar">
        <div className="workspace-actions">
          <button
            type="button"
            className="btn btn-ghost"
            aria-label={t('previous')}
            disabled={!week || pending}
            onClick={() => setWeek(calendarDay(week, -7))}
          >
            ←
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={pending}
            onClick={() => setWeek(weekStart(today()))}
          >
            {t('thisWeek')}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            aria-label={t('next')}
            disabled={!week || pending}
            onClick={() => setWeek(calendarDay(week, 7))}
          >
            →
          </button>
        </div>
        <label>
          {t('weekOf')}
          <input
            type="date"
            value={week}
            disabled={pending}
            onChange={(e) => {
              if (e.target.value) setWeek(weekStart(e.target.value))
            }}
          />
        </label>
        <label>
          {t('worker')}
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="">{t('allWorkers')}</option>
            {workers.map((worker) => (
              <option key={worker.id} value={worker.id}>
                {worker.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={loading || pending}
          onClick={() => setRevision((value) => value + 1)}
        >
          {t('refresh')}
        </button>
      </div>
      <p role="status">{notice ? t(notice) : ''}</p>
      <div role="alert" className="form-error">
        {error}
      </div>
      {loading ? (
        <p role="status">{t('loading')}</p>
      ) : !error ? (
        <>
          <div className="schedule-summary">
            <strong>{t('count', { count: active.length })}</strong>
            <span>{t('timeZone')}</span>
          </div>
          {!truncated && week ? (
            <ScheduleCost
              assignments={visible}
              workers={workers}
              from={dayStart(week)}
              to={dayStart(calendarDay(week, 7))}
            />
          ) : null}
          {truncated ? <p className="form-error">{t('truncated')}</p> : null}
          {workers.every((w) => !w.active) || locations.every((l) => !l.active) ? (
            <p className="workspace-callout">
              {t('setupNeeded')} <Link href="/setup/">{t('setup')}</Link>
            </p>
          ) : null}
          <div className="schedule-week">
            {days.map((day) => {
              const start = dayStart(day)
              const end = dayStart(calendarDay(day, 1))
              const plans = visible.filter((plan) => plan.starts_at < end && plan.ends_at > start)
              return (
                <section
                  className={`schedule-day${day === today() ? ' schedule-today' : ''}`}
                  key={day}
                >
                  <h2>{dayLabel(day)}</h2>
                  {plans.length === 0 ? (
                    <p className="schedule-empty">{t('emptyDay')}</p>
                  ) : (
                    plans.map((plan) => (
                      <article
                        className={`schedule-card${plan.cancelled_at ? ' schedule-cancelled' : ''}`}
                        key={plan.id}
                      >
                        <span className="schedule-card-time">
                          {timeLabel(plan.starts_at)} – {timeLabel(plan.ends_at)}
                        </span>
                        <h3>{plan.worker_name}</h3>
                        <p>{plan.location_name}</p>
                        {plan.note ? <p className="schedule-card-note">{plan.note}</p> : null}
                        {plan.cancelled_at ? (
                          <span className="schedule-status">{t('cancelled')}</span>
                        ) : (
                          <div className="schedule-card-actions">
                            <button
                              type="button"
                              disabled={pending || Date.parse(plan.starts_at) < Date.now()}
                              onClick={() => openEditor(plan, day)}
                            >
                              {t('edit')}
                            </button>
                            <button
                              type="button"
                              disabled={pending}
                              onClick={() => setCancel(plan)}
                            >
                              {t('cancelPlan')}
                            </button>
                          </div>
                        )}
                      </article>
                    ))
                  )}
                  {day >= today() ? (
                    <button
                      type="button"
                      className="schedule-day-add"
                      disabled={pending}
                      onClick={() => openEditor(null, day)}
                    >
                      {t('addDay')}
                    </button>
                  ) : null}
                </section>
              )
            })}
          </div>
        </>
      ) : null}
      <Drawer
        open={editor !== null}
        onClose={() => {
          if (!pending) setEditor(null)
        }}
        title={t(editor?.assignment ? 'editTitle' : 'add')}
        busy={pending}
        footer={
          <>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={pending}
              onClick={() => setEditor(null)}
            >
              {t('close')}
            </button>
            <button
              type="submit"
              form="schedule-form"
              className="btn btn-primary"
              disabled={pending}
            >
              {t(pending ? 'saving' : 'save')}
            </button>
          </>
        }
      >
        <p role="alert" className="form-error">
          {formError}
        </p>
        {editor ? (
          <ScheduleForm
            key={editor.assignment?.id ?? editor.date}
            {...editor}
            workers={workers}
            locations={locations}
            pending={pending}
            onSave={save}
            onError={setFormError}
          />
        ) : null}
      </Drawer>
      <ConfirmModal
        open={cancel !== null}
        onClose={() => {
          if (!pending) setCancel(null)
        }}
        onConfirm={cancelPlan}
        title={t('cancelTitle')}
        body={t('cancelBody', {
          worker: cancel?.worker_name ?? '',
          location: cancel?.location_name ?? '',
        })}
        confirmLabel={t('cancelPlan')}
        busy={pending}
        destructive
      />
    </div>
  )
}
