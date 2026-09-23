'use client'

import { useFormatter, useTranslations } from 'next-intl'
import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'

type TrialRequest = {
  id: number
  email: string
  company: string
  locale: 'de' | 'en'
  created_at: string
}

export function TrialRequestsInbox() {
  const t = useTranslations('landing')
  const format = useFormatter()
  const [requests, setRequests] = useState<TrialRequest[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const load = useCallback(async (signal?: AbortSignal) => {
    setStatus('loading')
    try {
      const response = await apiFetch<{ requests: TrialRequest[] }>('/platform/trial-requests', {
        signal,
      })
      if (!signal?.aborted) {
        setRequests(response.requests)
        setStatus('ready')
      }
    } catch {
      if (!signal?.aborted) setStatus('error')
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  return (
    <section className="workspace-panel">
      <div className="trial-inbox-heading">
        <h2>{t('inboxTitle')}</h2>
        <button
          className="btn btn-ghost"
          type="button"
          onClick={() => void load()}
          disabled={status === 'loading'}
        >
          {t('inboxRefresh')}
        </button>
      </div>
      {status === 'loading' && <p role="status">{t('inboxLoading')}</p>}
      {status === 'error' && (
        <p role="alert" className="form-error">
          {t('inboxError')}
        </p>
      )}
      {status === 'ready' && requests.length === 0 && <p>{t('inboxEmpty')}</p>}
      {status === 'ready' && requests.length > 0 && (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('inboxCompany')}</th>
                <th>{t('inboxEmail')}</th>
                <th>{t('inboxLanguage')}</th>
                <th>{t('inboxReceived')}</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((request) => (
                <tr key={request.id}>
                  <td>{request.company}</td>
                  <td>
                    <a href={`mailto:${request.email}`}>{request.email}</a>
                  </td>
                  <td>{request.locale.toUpperCase()}</td>
                  <td>
                    {format.dateTime(new Date(request.created_at), {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                      timeZone: 'Europe/Vienna',
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {status === 'ready' && requests.length === 200 && <p>{t('inboxLimit')}</p>}
    </section>
  )
}
