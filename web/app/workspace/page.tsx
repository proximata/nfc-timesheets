'use client'

import Link from 'next/link'
import { useFormatter, useTranslations } from 'next-intl'
import { PeriodPicker } from '@/components/PeriodPicker'
import { useWorkspace } from '@/components/useWorkspace'
import { filterHref, periodLink, useFilters } from '@/lib/filters'
import { completedSetup } from '@/lib/workspaces'

export default function WorkspacePage() {
  const t = useTranslations('workspace')
  const errors = useTranslations('error')
  const format = useFormatter()
  const [filters, setFilters] = useFilters()
  const period = filters.period !== null && filters.period !== 'all' ? filters.period : 'thisMonth'
  const carriedPeriod = periodLink(filters, period)
  const { data, error, loading, reload } = useWorkspace(period, filters.start, filters.end)
  const money = (cents: number) =>
    format.number(cents / 100, { style: 'currency', currency: 'EUR' })
  const hours = (minutes: number) => format.number(minutes / 60, { maximumFractionDigits: 1 })
  return (
    <div className="workspace-page">
      <header className="workspace-heading">
        <div>
          <p className="workspace-eyebrow">{t('eyebrow')}</p>
          <h1>{data?.company.name ?? t('overview')}</h1>
          <p className="lede">{t('intro')}</p>
        </div>
        <div className="workspace-actions">
          <PeriodPicker
            label={t('period')}
            value={{ period, start: filters.start, end: filters.end }}
            onChange={(selection) => setFilters(selection, 'replace')}
          />
          <button className="btn btn-ghost" type="button" onClick={reload} disabled={loading}>
            {t('refresh')}
          </button>
        </div>
      </header>
      <p role="alert" className="form-error">
        {error ? errors(error) : ''}
      </p>
      {loading && <p role="status">{t('loading')}</p>}
      {data && !loading && !error && (
        <>
          {!completedSetup(data).every(Boolean) && (
            <section className="workspace-callout">
              <div>
                <h2>{t('setupTitle')}</h2>
                <p>{t('setupProgress', { count: completedSetup(data).filter(Boolean).length })}</p>
              </div>
              <Link className="btn btn-primary" href="/setup/">
                {t('continueSetup')}
              </Link>
            </section>
          )}
          <section className="workspace-metrics" aria-label={t('monthSummary')}>
            <Link
              className="workspace-card"
              href={filterHref('/shifts/', { ...carriedPeriod, state: null })}
            >
              <span>{t('acceptedHours')}</span>
              <strong>{hours(data.workers.reduce((sum, row) => sum + row.minutes, 0))}</strong>
              <small>{t('hoursUnit')}</small>
            </Link>
            <Link className="workspace-card" href={filterHref('/payroll/', carriedPeriod)}>
              <span>{t('estimatedAccrual')}</span>
              <strong>
                {money(data.workers.reduce((sum, row) => sum + row.estimated_cents, 0))}
              </strong>
              <small>{t('rateHint')}</small>
            </Link>
            <a className="workspace-card" href="#workspace-materials">
              <span>{t('orderedMaterials')}</span>
              <strong>{money(data.materials.known_material_cents)}</strong>
              <small>
                {data.materials.unpriced_count
                  ? t('unpriced', { count: data.materials.unpriced_count })
                  : t('materialHint')}
              </small>
            </a>
          </section>
          <p className="workspace-note">{t('estimateHint')}</p>
          <div className="workspace-columns">
            <section className="workspace-panel">
              <h2>{t('today')}</h2>
              <p className="workspace-note">{t('todayHint')}</p>
              <ul className="workspace-action-list">
                <li>
                  <Link href="/shifts/?state=open&period=all">
                    <span>{t('clockedIn')}</span>
                    <strong>{data.setup.active_shifts}</strong>
                  </Link>
                </li>
                <li>
                  <Link href="/shifts/?state=unresolved&period=all">
                    <span>{t('needsReview')}</span>
                    <strong>{data.setup.unresolved_shifts}</strong>
                  </Link>
                </li>
                <li>
                  <Link href="/material-requests/">
                    <span>{t('materialQueue')}</span>
                    <strong>{data.setup.pending_materials}</strong>
                  </Link>
                </li>
              </ul>
              <Link className="link" href="/map/">
                {t('mapAndActivity')}
              </Link>
            </section>
            <section className="workspace-panel">
              <h2>{t('weeklyHours')}</h2>
              {data.weeks.length === 0 ? (
                <p className="workspace-empty">{t('noHours')}</p>
              ) : (
                <ul className="workspace-bars">
                  {data.weeks.map((row) => (
                    <li key={row.week}>
                      <span>
                        {format.dateTime(new Date(`${row.week}T12:00:00Z`), {
                          day: 'numeric',
                          month: 'short',
                          timeZone: 'Europe/Vienna',
                        })}
                      </span>
                      <meter
                        min={0}
                        max={Math.max(1, ...data.weeks.map((week) => week.hours))}
                        value={row.hours}
                        aria-label={t('weekHours', {
                          week: row.week,
                          hours: format.number(row.hours, { maximumFractionDigits: 1 }),
                        })}
                      />
                      <strong>{format.number(row.hours, { maximumFractionDigits: 1 })}</strong>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
          <section className="workspace-panel">
            <div className="workspace-heading">
              <h2>{t('workerCosts')}</h2>
              <Link className="link" href={filterHref('/payroll/', carriedPeriod)}>
                {t('openCalculations')}
              </Link>
            </div>
            {data.workers.length === 0 ? (
              <p className="workspace-empty">{t('noHours')}</p>
            ) : (
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>{t('worker')}</th>
                      <th>{t('acceptedHours')}</th>
                      <th>{t('estimatedAccrual')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.workers.map((row) => (
                      <tr key={row.id}>
                        <td>
                          <Link href={filterHref('/shifts/', { ...carriedPeriod, worker: row.id })}>
                            {row.name}
                          </Link>
                        </td>
                        <td>{hours(row.minutes)}</td>
                        <td>{money(row.estimated_cents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <section className="workspace-panel" id="workspace-materials">
            <div className="workspace-heading">
              <h2>{t('orderedMaterials')}</h2>
              <Link href="/material-requests/?status=all">{t('manageAllMaterials')}</Link>
            </div>
            <p className="workspace-note">{t('materialListHint')}</p>
            {data.material_orders.length === 0 ? (
              <p className="workspace-empty">{t('noOrders')}</p>
            ) : (
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>{t('materialOrder')}</th>
                      <th>{t('orderDate')}</th>
                      <th>{t('status')}</th>
                      <th>{t('knownCost')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.material_orders.map((row) => (
                      <tr key={row.id}>
                        <td>{row.body}</td>
                        <td>
                          {format.dateTime(new Date(row.ordered_at), {
                            dateStyle: 'medium',
                            timeZone: 'Europe/Vienna',
                          })}
                        </td>
                        <td>{t(row.status)}</td>
                        <td>
                          {row.cost_cents === null ? t('priceMissing') : money(row.cost_cents)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <p className="workspace-note">
            {t('freshness', {
              time: format.dateTime(new Date(data.fetched_at), {
                hour: '2-digit',
                minute: '2-digit',
                timeZone: 'Europe/Vienna',
              }),
            })}
          </p>
          <nav className="workspace-actions" aria-label={t('more')}>
            <Link href="/setup/">{t('setupTitle')}</Link>
            <Link href="/clients/">{t('clients')}</Link>
            <Link href={filterHref('/pl/', carriedPeriod)}>{t('profitability')}</Link>
          </nav>
        </>
      )}
    </div>
  )
}
