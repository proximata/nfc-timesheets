'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import {
  ApiError,
  fetchTagsSnapshot,
  type ReportedTag,
  resolveTagToExistingZone,
  resolveTagToZone,
  type TagsSnapshot,
} from '@/lib/api'
import { loginPathWithReturn } from '@/lib/nav'
import { BUSINESS_TIME_ZONE } from '@/lib/shifts'

/**
 * Vienna, explicitly, on a screen that has no next-intl `format.dateTime` to reach for
 * (this page carries no i18n on purpose — see the file header). Every OTHER boundary in
 * this product pins Europe/Vienna; a raw `toISOString()` string here showed the previous
 * calendar day for anything reported 00:00-02:00 Vienna time (UTC is behind Vienna), which
 * is exactly when a night crew mounts cards (LOOK.md W7).
 */
const REPORTED_AT_FORMAT = new Intl.DateTimeFormat('de-AT', {
  timeZone: BUSINESS_TIME_ZONE,
  dateStyle: 'medium',
  timeStyle: 'short',
})

/**
 * Unzugeordnete Tags (unbound tags) — the admin's worklist for
 * server/db/migrations/008_reported_tags.sql: a tag an operator's phone WROTE AND REPORTED
 * that nobody has turned into a building or a zone yet.
 *
 * DELIBERATELY THE PLAINEST POSSIBLE SCREEN, not the house style used everywhere else in
 * this bundle (no PageHeader, no ListPanel, no Drawer, no next-intl — see the file's own
 * short iteration note). It exists to prove the WRITE -> REPORT -> RESOLVE flow end to end
 * on a real admin session, not to be a finished screen. `/workers/`, `/operators/` and
 * `/locations/` are the reference for the polished version this becomes later.
 *
 * Not in the sidebar. Reached by URL (`/tags/`) until it earns a place in lib/nav.ts.
 */

/**
 * decision-47 — „Neues Gebäude" IS GONE, and with it POST /admin/tags/:id/resolve-building.
 * A card can no longer become a BUILDING's own tap surface: a new building is created
 * tag-free under „Objekte", and the reported card then becomes its FIRST ZONE. The
 * capability is not deleted, it moved — the sentence under the radios says where.
 */
type Action = 'zone' | 'existing'

type Drafts = Record<string, { action: Action; name: string; locationId: string; zoneId: string }>

/**
 * Every code the two resolve routes can answer (server/routes/admin.js
 * resolveTagToZone / resolveTagToExistingZone), as a sentence that
 * says what to DO — never the code itself. This screen carries no next-intl (see the file
 * header), so the map lives here rather than in a message catalogue; the rule it follows
 * is the same one every other screen's ApiFailure/messageKey mapping follows (LOOK.md C4:
 * `Abgelehnt: slug_taken` was a raw internal token in a German admin panel).
 */
const RESOLVE_ERROR_SENTENCES: Record<string, string> = {
  invalid_field: 'Mindestens ein Feld ist ungültig oder fehlt. Bitte prüfen und erneut versuchen.',
  invalid_uuid: 'Eine der IDs ist ungültig. Bitte die Seite neu laden und erneut versuchen.',
  id_in_use: 'Diese ID wird bereits verwendet. Bitte bei der Verwaltung melden.',
  duplicate_zone_name:
    'In diesem Gebäude gibt es schon eine Zone mit diesem Namen. Bitte einen anderen Namen wählen.',
  unknown_location:
    'Dieses Gebäude wurde nicht gefunden. Bitte die Auswahl aktualisieren und erneut versuchen.',
  unknown_zone:
    'Diese Zone wurde nicht gefunden. Bitte die Auswahl aktualisieren und erneut versuchen.',
  already_resolved:
    'Dieser Tag wurde inzwischen von jemand anderem zugeordnet. Bitte die Seite neu laden.',
  unknown_reported_tag: 'Dieser Tag ist dem Server nicht mehr bekannt. Bitte die Seite neu laden.',
}

/** A code this screen has never seen still gets a sentence, never the bare identifier. */
function resolveErrorSentence(code: string | null): string {
  if (code === null) return 'Abgelehnt vom Server. Bitte erneut versuchen.'
  return RESOLVE_ERROR_SENTENCES[code] ?? 'Abgelehnt vom Server. Bitte erneut versuchen.'
}

export default function TagsPage() {
  const router = useRouter()
  const [snapshot, setSnapshot] = useState<TagsSnapshot | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Drafts>({})
  const [busyId, setBusyId] = useState<string | null>(null)
  const [rowError, setRowError] = useState<Record<string, string>>({})
  const [notice, setNotice] = useState<string | null>(null)

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
        setLoadError('Konnte die Liste nicht laden.')
      }
    },
    [handleAuthLoss],
  )

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  const EMPTY_DRAFT: Drafts[string] = {
    action: 'zone',
    name: '',
    locationId: '',
    zoneId: '',
  }

  function draftOf(tag: ReportedTag): Drafts[string] {
    return drafts[tag.id] ?? EMPTY_DRAFT
  }

  function setDraft(id: string, patch: Partial<Drafts[string]>) {
    setDrafts((prev) => ({ ...prev, [id]: { ...(prev[id] ?? EMPTY_DRAFT), ...patch } }))
  }

  async function resolve(tag: ReportedTag) {
    const draft = draftOf(tag)
    setRowError((prev) => ({ ...prev, [tag.id]: '' }))
    setBusyId(tag.id)
    setNotice(null)
    try {
      if (draft.action === 'zone') {
        const name = draft.name.trim()
        if (draft.locationId === '' || name === '') {
          setRowError((prev) => ({ ...prev, [tag.id]: 'Gebäude und Name sind erforderlich.' }))
          return
        }
        await resolveTagToZone(tag.id, { location_id: draft.locationId, name })
        setNotice(`Tag ${tag.id} ist jetzt eine neue Zone „${name}".`)
      } else {
        if (draft.zoneId === '') {
          setRowError((prev) => ({ ...prev, [tag.id]: 'Zone ist erforderlich.' }))
          return
        }
        await resolveTagToExistingZone(tag.id, draft.zoneId)
        setNotice(`Tag ${tag.id} zeigt jetzt zusätzlich auf die gewählte Zone.`)
      }
      setDrafts((prev) => {
        const next = { ...prev }
        delete next[tag.id]
        return next
      })
      await load()
    } catch (cause) {
      if (handleAuthLoss(cause)) return
      const code = cause instanceof ApiError ? cause.code : null
      setRowError((prev) => ({
        ...prev,
        [tag.id]: resolveErrorSentence(code),
      }))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <>
      <h1>Unzugeordnete Tags</h1>
      <p>
        Tags, die ein Betreiber-Handy geschrieben und gemeldet hat, aber die noch keinem Gebäude
        oder keiner Zone zugeordnet sind.
      </p>

      <p role="alert">{loadError ?? ''}</p>
      <p role="status">{notice ?? ''}</p>

      {snapshot === null ? (
        <p>Lädt…</p>
      ) : snapshot.reported_tags.length === 0 ? (
        <p>Keine unzugeordneten Tags.</p>
      ) : (
        <table border={1} cellPadding={4}>
          <thead>
            <tr>
              <th>Tag-ID</th>
              <th>Gemeldet am</th>
              <th>Gemeldet von</th>
              <th>Aktion</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.reported_tags.map((tag) => {
              const draft = draftOf(tag)
              const busy = busyId === tag.id
              return (
                <tr key={tag.id}>
                  <td>
                    <code>{tag.id}</code>
                    {/* The two humans in this procedure have no shared handle otherwise
                        (LOOK.md C3): the admin sees the full 36-character id, the
                        operator's phone shows only the last six
                        (core/WriteGuard.kt: token = locationId.takeLast(6)) — "token
                        907ec7" is how CORE-FLOW.md itself refers to a card. Same rule,
                        same word, here. */}
                    <div>
                      Token: <code>{tag.id.slice(-6)}</code>
                    </div>
                  </td>
                  <td>{REPORTED_AT_FORMAT.format(new Date(tag.reported_at))}</td>
                  <td>{tag.reported_by_operator_name ?? '(unbekannt)'}</td>
                  <td>
                    <div>
                      <label>
                        <input
                          type="radio"
                          name={`action-${tag.id}`}
                          checked={draft.action === 'zone'}
                          onChange={() => setDraft(tag.id, { action: 'zone' })}
                          disabled={busy}
                        />
                        Neue Zone in bestehendem Gebäude
                      </label>
                      <label>
                        <input
                          type="radio"
                          name={`action-${tag.id}`}
                          checked={draft.action === 'existing'}
                          onChange={() => setDraft(tag.id, { action: 'existing' })}
                          disabled={busy}
                        />
                        Bestehende Zone (zweiter Tag)
                      </label>
                      {/* NOTHING TRUE IS DELETED TO LIGHTEN A SCREEN: the capability the
                          „Neues Gebäude“ radio used to offer still exists, it just does not
                          start with a card any more (decision-47). Say where it went, AND
                          take the admin there — a sentence naming another screen with no
                          way to reach it is the dead end the owner's own brief warned this
                          screen must not become. */}
                      <p>
                        Ein NEUES Gebäude wird zuerst unter <Link href="/locations/">Objekte</Link>{' '}
                        angelegt — ohne Tag. Danach kann dieser Tag hier als erste Zone darin
                        zugeordnet werden.
                      </p>
                    </div>

                    {draft.action === 'zone' ? (
                      <div>
                        <label>
                          Gebäude{' '}
                          <select
                            value={draft.locationId}
                            onChange={(e) => setDraft(tag.id, { locationId: e.target.value })}
                            disabled={busy}
                          >
                            <option value="">– wählen –</option>
                            {snapshot.locations
                              .filter((l) => l.active)
                              .map((l) => (
                                <option key={l.id} value={l.id}>
                                  {l.name}
                                </option>
                              ))}
                          </select>
                        </label>
                        <label>
                          Name{' '}
                          <input
                            value={draft.name}
                            onChange={(e) => setDraft(tag.id, { name: e.target.value })}
                            disabled={busy}
                          />
                        </label>
                      </div>
                    ) : (
                      <div>
                        <label>
                          Zone{' '}
                          <select
                            value={draft.zoneId}
                            onChange={(e) => setDraft(tag.id, { zoneId: e.target.value })}
                            disabled={busy}
                          >
                            <option value="">– wählen –</option>
                            {snapshot.zones
                              .filter((z) => z.active)
                              .map((z) => (
                                <option key={z.id} value={z.id}>
                                  {z.name}
                                </option>
                              ))}
                          </select>
                        </label>
                      </div>
                    )}

                    <p role="alert">{rowError[tag.id] ?? ''}</p>

                    <button type="button" disabled={busy} onClick={() => resolve(tag)}>
                      {busy ? 'Wird gespeichert…' : 'Zuordnen'}
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </>
  )
}
