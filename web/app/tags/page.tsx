'use client'

import { useRouter } from 'next/navigation'
import { useFormatter, useTranslations } from 'next-intl'
import { type FormEvent, useCallback, useEffect, useId, useState } from 'react'
import { Drawer } from '@/components/Drawer'
import { EmptyState } from '@/components/EmptyState'
import { Field } from '@/components/Field'
import { ListPanel } from '@/components/ListPanel'
import { PageHeader } from '@/components/PageHeader'
import {
  ApiError,
  fetchTagsSnapshot,
  type ReportedTag,
  resolveTagToExistingZone,
  type TagsSnapshot,
} from '@/lib/api'
import type { ErrorKey } from '@/lib/locale'
import { loginPathWithReturn } from '@/lib/nav'
import { BUSINESS_TIME_ZONE } from '@/lib/shifts'

/**
 * Unzugeordnete Tags (unbound tags) — the admin's worklist for
 * server/db/migrations/008_reported_tags.sql: a tag an operator's phone WROTE AND REPORTED
 * that nobody has turned into a zone yet.
 *
 * REDESIGNED to house style (TASK-255): PageHeader/ListPanel/Drawer, next-intl throughout,
 * one row resolved at a time in the Drawer instead of an inline per-row form. `/workers/`
 * and `/operators/` are the reference this mirrors.
 *
 * decision-47 — „Neues Gebäude" IS GONE, and with it POST /admin/tags/:id/resolve-building.
 * A card can no longer become a BUILDING's own tap surface.
 *
 * decision-54 §2 — „Neue Zone" IS GONE TOO, and with it POST /admin/tags/:id/resolve-zone.
 * A zone is born in an OPERATOR's hand, at the door, and this desk cannot mint one any
 * more. What is left here is the ONE thing that was never zone creation: pointing a second
 * physical card at an ALREADY-EXISTING zone (`tag_aliases`). The capability is not deleted,
 * it moved — `operatorNote` below says where.
 *
 * Not in the sidebar (decision-39 style off-nav utility). Reached by URL (`/tags/`), via
 * the link on `/locations/`'s panel header — see `OFF_NAV_ROUTES` in lib/nav.ts.
 */

type ActionDraft = {
  zoneId: string
}

const EMPTY_DRAFT: ActionDraft = { zoneId: '' }

/** Message keys inside the `tags` namespace for the drawer's own client-side checks. */
type FieldErrorKey = 'errorZoneRequired'

type FieldErrors = {
  zoneId?: FieldErrorKey
}

/** Every code the one remaining resolve route can answer (server/routes/admin.js
 *  resolveTagToExistingZone), mapped onto a sentence in the `tags` namespace — never the
 *  bare code (LOOK.md C4: a raw internal token in a German panel). */
type ResolveErrorKey =
  | 'errorInvalidField'
  | 'errorInvalidUuid'
  | 'errorUnknownZone'
  | 'errorAlreadyResolved'
  | 'errorUnknownReportedTag'
  | 'errorRejected'

const RESOLVE_ERROR_KEYS: Record<string, ResolveErrorKey> = {
  invalid_field: 'errorInvalidField',
  invalid_uuid: 'errorInvalidUuid',
  unknown_zone: 'errorUnknownZone',
  already_resolved: 'errorAlreadyResolved',
  unknown_reported_tag: 'errorUnknownReportedTag',
}

export default function TagsPage() {
  const t = useTranslations('tags')
  const tError = useTranslations('error')
  const format = useFormatter()
  const router = useRouter()

  const formId = useId()
  const existingZoneFieldId = useId()

  const [snapshot, setSnapshot] = useState<TagsSnapshot | null>(null)
  const [loadError, setLoadError] = useState<ErrorKey | null>(null)
  /** null = the drawer is closed. There is no half-open form on this screen any more. */
  const [resolvingTag, setResolvingTag] = useState<ReportedTag | null>(null)
  const [draft, setDraft] = useState<ActionDraft>(EMPTY_DRAFT)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<ResolveErrorKey | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)

  const handleAuthLoss = useCallback(
    (cause: unknown): boolean => {
      if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) {
        router.replace(loginPathWithReturn())
        return true
      }
      return false
    },
    [router],
  )

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        setSnapshot(await fetchTagsSnapshot(signal))
        setLoadError(null)
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === 'AbortError') return
        if (handleAuthLoss(cause)) return
        setLoadError(cause instanceof ApiError ? cause.messageKey : 'server')
      }
    },
    [handleAuthLoss],
  )

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  function openResolve(tag: ReportedTag) {
    setResolvingTag(tag)
    setDraft(EMPTY_DRAFT)
    setFieldErrors({})
    setFormError(null)
  }

  /** Escape, the scrim and Cancel all land here. Focus restoration is the Drawer's job. */
  function closeDrawer() {
    setResolvingTag(null)
    setDraft(EMPTY_DRAFT)
    setFieldErrors({})
    setFormError(null)
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || resolvingTag === null) return

    const tag = resolvingTag

    // Client-side validation is UX only — the server decides for real.
    const errors: FieldErrors = {}
    if (draft.zoneId === '') errors.zoneId = 'errorZoneRequired'
    setFieldErrors(errors)
    setFormError(null)
    if (Object.keys(errors).length > 0) return

    const token = tag.id.slice(-6)
    setBusy(true)
    try {
      await resolveTagToExistingZone(tag.id, draft.zoneId)
      setNotice({ ok: true, text: t('resolvedExisting', { token }) })
      closeDrawer()
      await load()
    } catch (cause) {
      if (handleAuthLoss(cause)) return
      const code = cause instanceof ApiError ? cause.code : null
      setFormError((code === null ? undefined : RESOLVE_ERROR_KEYS[code]) ?? 'errorRejected')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader title={t('heading')} question={t('question')} />

      {/* Permanent live regions, on the PAGE and never inside the Drawer — an overlay that
          closes on success takes its own success message with it, unread. Same idiom as
          /workers/ and /operators/. */}
      <p className="form-error" role="alert">
        {loadError === null ? '' : tError(loadError)}
      </p>
      <p className={notice?.ok === false ? 'form-error' : 'form-status'} role="status">
        {notice === null ? '' : notice.text}
      </p>

      <ListPanel title={t('listHeading')}>
        {snapshot === null ? (
          <p role="status">{loadError === null ? t('loading') : tError(loadError)}</p>
        ) : snapshot.reported_tags.length === 0 ? (
          <EmptyState>{t('empty')}</EmptyState>
        ) : (
          <table className="data-table" aria-busy={busy}>
            <caption className="visually-hidden">{t('tableCaption')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('colToken')}</th>
                <th scope="col">{t('colReportedAt')}</th>
                <th scope="col">{t('colReportedBy')}</th>
                <th scope="col">{t('colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.reported_tags.map((tag) => (
                <tr key={tag.id}>
                  <td>
                    {/* The two humans in this procedure have no shared handle otherwise
                        (LOOK.md C3): the admin sees the full 36-character id, the
                        operator's phone shows only the last six
                        (core/WriteGuard.kt: token = locationId.takeLast(6)). Both stay
                        visible — nothing true is dropped to lighten the row. */}
                    <code className="cell-muted">{tag.id}</code>
                    <p className="cell-code">{t('tokenLabel', { token: tag.id.slice(-6) })}</p>
                  </td>
                  <td>
                    {format.dateTime(new Date(tag.reported_at), {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                      timeZone: BUSINESS_TIME_ZONE,
                    })}
                  </td>
                  <td>{tag.reported_by_operator_name ?? t('reportedByUnknown')}</td>
                  <td className="cell-actions">
                    <button
                      type="button"
                      className="btn btn-quiet"
                      onClick={() => openResolve(tag)}
                    >
                      {t('resolveAction')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ListPanel>

      {/* ONE drawer, ONE job — every write happens here, replacing the old inline per-row
          form. */}
      <Drawer
        open={resolvingTag !== null}
        onClose={closeDrawer}
        title={
          resolvingTag === null ? '' : t('resolveHeading', { token: resolvingTag.id.slice(-6) })
        }
        busy={busy}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={closeDrawer}>
              {t('cancel')}
            </button>
            <button type="submit" form={formId} className="btn btn-primary" disabled={busy}>
              {busy ? t('submitting') : t('resolveAction')}
            </button>
          </>
        }
      >
        {resolvingTag === null || snapshot === null ? null : (
          <form id={formId} onSubmit={onSubmit} noValidate>
            {/* Kept in the DOM so the live region survives a re-render. */}
            <p className="form-error" role="alert">
              {formError === null ? '' : t(formError)}
            </p>

            {/* NOTHING TRUE IS DELETED TO LIGHTEN A SCREEN, and nothing here scolds: the
                capability „Neue Zone" used to offer still exists, it just does not live at a
                desk any more (decision-54 §2). Say so plainly, because the honest answer to
                "why can I not create a zone here" is "an operator does that at the door",
                not an empty form. */}
            <p className="note">{t('operatorNote')}</p>

            <Field
              id={existingZoneFieldId}
              label={t('fieldExistingZone')}
              error={fieldErrors.zoneId === undefined ? undefined : t(fieldErrors.zoneId)}
            >
              <select
                value={draft.zoneId}
                onChange={(event) => setDraft({ ...draft, zoneId: event.target.value })}
                disabled={busy}
              >
                <option value="">{t('choosePlaceholder')}</option>
                {snapshot.zones
                  .filter((zone) => zone.active)
                  .map((zone) => (
                    <option key={zone.id} value={zone.id}>
                      {zone.name}
                    </option>
                  ))}
              </select>
            </Field>
          </form>
        )}
      </Drawer>
    </>
  )
}
