'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { ApiError } from '@/lib/api'
import type { ErrorKey } from '@/lib/locale'
import { loginPathWithReturn } from '@/lib/nav'
import type { Period } from '@/lib/period'
import { fetchWorkspace, type Workspace } from '@/lib/workspaces'

export function useWorkspace(
  period: Period = 'thisMonth',
  start: string | null = null,
  end: string | null = null,
) {
  const router = useRouter()
  const [data, setData] = useState<Workspace | null>(null)
  const [error, setError] = useState<ErrorKey | null>(null)
  const [loading, setLoading] = useState(true)
  const [revision, setRevision] = useState(0)
  const reload = useCallback(() => setRevision((current) => current + 1), [])
  // revision deliberately refreshes the authoritative facts after a save.
  // biome-ignore lint/correctness/useExhaustiveDependencies: revision is the explicit refresh trigger.
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    void fetchWorkspace(period, start && end ? { start, end } : undefined, controller.signal)
      .then(setData)
      .catch((cause) => {
        if (controller.signal.aborted) return
        if (cause instanceof ApiError && cause.status === 401) router.replace(loginPathWithReturn())
        setError(cause instanceof ApiError ? cause.messageKey : 'server')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [period, start, end, router, revision])
  return { data, error, loading, reload }
}
