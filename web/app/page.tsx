'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useFormatter, useTranslations } from 'next-intl'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnswerBand } from '@/components/AnswerBand'
import { type AttentionItem, AttentionList } from '@/components/AttentionList'
import { BuildingFacts } from '@/components/BuildingFacts'
import { BuildingPanel } from '@/components/BuildingPanel'
import { EmptyState } from '@/components/EmptyState'
import { FilterChips } from '@/components/FilterChips'
import { HomeMap } from '@/components/HomeMap'
import { ListPanel } from '@/components/ListPanel'
import { Objektliste } from '@/components/Objektliste'
import { PageHeader } from '@/components/PageHeader'
import { StateBadge } from '@/components/StateBadge'
import {
  type AdminSnapshot,
  ApiError,
  fetchAdminSnapshot,
  fetchMaterialSnapshot,
  geocodeLocation,
  type Shift,
} from '@/lib/api'
import { filterHref, useFilters } from '@/lib/filters'
import type { ErrorKey } from '@/lib/locale'
import { isPinned } from '@/lib/map'
import { isOpen as isOpenMaterial } from '@/lib/materials'
import { loginPathWithReturn } from '@/lib/nav'
import { summariseBuildings } from '@/lib/objects'
import {
  BUSINESS_TIME_ZONE,
  blocksPayroll,
  durationMinutes,
  formatDuration,
  manualEnds,
  shiftState,
} from '@/lib/shifts'

/**
 * Dashboard — „Muss ich gerade etwas tun?", answered in that order: the ANSWER first, then
 * the exceptions, then the reassurance.
 *
 * Deliberately not a metrics wall. Every block above the last one is either a person
 * currently on site, something that will cost somebody money if it is ignored, or a thing
 * that is already broken; and every one of them opens the screen that fixes it.
 *
 * THE LAST BLOCK IS THE EXCEPTION AND IT IS BOUNDED ON PURPOSE. The director opened an
 * admin panel that showed him nothing at all and concluded his data was gone; in fact five
 * clean shifts existed and the exception view correctly had nothing to report. So there is
 * now a recent-activity list. It carries NO period filter — every period filter in this app
 * is exactly what produced that misreading — no total, no badge, no colour and no count,
 * and it is not part of `problemCount`. It goes LAST so that "something is wrong" keeps the
 * top of the page. A "hours this month" tile was rejected for the same reason: on the 3rd
 * of August it would have read EUR 0,00 and raised the alarm all over again. The prototype's
 * third answer cell ("Diese Woche 38:20") is the same tile in a different hat and is
 * deliberately NOT built: on a Monday morning it reads 0:00 and means nothing.
 *
 * AN EMPTY „ZU ERLEDIGEN" LIST MUST READ AS „NICHTS ZU TUN", never as a screen that failed
 * to load. That is why the empty case is a sentence about the company and not a dash, and
 * why the checks that came back clean are still named — smaller — when something else did not.
 *
 * SINCE decision-39 THE MAP IS THE LANDING SURFACE AND THIS LEDGER STAYS UNDER IT, on the
 * same route, in the same order, with the same strings. Nothing was moved to a new screen
 * and nothing was deleted: a `/heute/` for the ledger would be a fifteenth screen and would
 * make the daily check two clicks, which is the complaint this work exists to end. The map
 * owns the top of the fold; it is never `100vh`; and every correctness property below was
 * bought with an incident and is carried verbatim — `asOf`, `recentScope`, `truncatedNote`,
 * `overdueFlag` as a WORD, the NAMED lists in the triage rows, and the standing refusal of
 * an „Stunden diese Woche" tile.
 *
 * ORDER: answer band (two cells) → map region (optional) → Objektliste (always) → the ledger.
 *
 * ONE WRITE, and it is new: „Koordinaten holen" on a building with no pin. It is here
 * because this is the screen where the missing pin is visible, and because with zero
 * geocoded buildings in production a map with no way to fix that is a decoration. Everything
 * else is still one round trip, `GET /admin/data`, sliced six ways, plus a refresh.
 */

/** ops/sql/autoclose.sql closes an open shift at start + 8h (decision-10). */
const AUTO_CLOSE_MINUTES = 8 * 60

/** How many recent shifts the activity block shows. Named in the heading, never summed. */
const RECENT_SHIFTS = 10

/**
 * How many rows „Zu erledigen" shows before it stops listing and starts counting. A payload
 * capped at 2000 shifts can carry more unresolved ones than a screen should scroll through,
 * and a list you have to scroll is not an answer. The remainder is stated in words.
 */
const TRIAGE_ROWS = 8

/** How many people the answer band names before it counts the rest. */
const ONSITE_NAMES = 3

const SHIFTS_PATH = '/shifts/'
/**
 * Unresolved shifts are frequently OLDER than 30 days — that is what makes them unresolved —
 * and `/shifts/` defaults to the last 30 days. Jumping without a period would land the
 * director on an empty table, which is the one reading this whole product must never
 * produce. `/shifts/` reads these parameters on mount.
 *
 * `state=unresolved` was added with the filter contract (decision-38): the triage row says
 * „3 Schichten zu bestätigen", so the screen it opens must show those three and not the
 * whole log with them somewhere in it.
 */
const SHIFTS_UNRESOLVED_PATH = filterHref(SHIFTS_PATH, {
  period: 'all',
  state: 'unresolved',
})
const WORKERS_NO_EMAIL_PATH = filterHref('/workers/', { state: 'noEmail' })
const LOCATIONS_NO_TAG_PATH = filterHref('/locations/', { state: 'noTag' })

export default function DashboardPage() {
  const t = useTranslations('home')
  const tFilter = useTranslations('filters')
  const tError = useTranslations('error')
  // decision-56's two flag labels are the shift log's words; borrowed rather than
  // duplicated into `home`, so the two screens can never drift apart.
  const tShift = useTranslations('shifts')
  const format = useFormatter()
  const router = useRouter()

  const [snapshot, setSnapshot] = useState<AdminSnapshot | null>(null)
  const [loadError, setLoadError] = useState<ErrorKey | null>(null)
  const [busy, setBusy] = useState(false)
  /**
   * `?location=<uuid>` — the Objektpanel. This route is the building's object surface
   * (decision-38): no `/locations/<id>` page exists and none can, because the admin is a
   * static export. Read from the URL, so the panel can be bookmarked and sent to somebody.
   */
  const [filters, setFilters] = useFilters()
  /**
   * The open-material count the panel needs, fetched ONCE, LAZILY, on the first time a
   * panel is opened. Not on page load: the dashboard is the screen the director leaves open
   * all day, and it would pay for a list nobody asked for on every refresh. Null = not
   * fetched yet, which the panel renders as „wird geladen" rather than as a zero — a zero
   * would suppress the material link under decision-38's „no link to an empty target" rule
   * and hide a queue somebody is standing in a building waiting for.
   */
  const [openMaterials, setOpenMaterials] = useState<Record<string, number> | null>(null)
  /**
   * "How long has this person been on site" is read against the clock at load time, not a
   * ticking one: a per-second re-render of a live region is a screen-reader denial of
   * service. The refresh button is the way to get a newer answer, and it says so.
   */
  const [loadedAt, setLoadedAt] = useState<Date | null>(null)
  /** The outcome of „Koordinaten holen", announced on the page and not inside an overlay. */
  const [geoNotice, setGeoNotice] = useState<{ ok: boolean; text: string } | null>(null)
  const [geoBusy, setGeoBusy] = useState(false)

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
      setBusy(true)
      try {
        setSnapshot(await fetchAdminSnapshot(signal))
        setLoadedAt(new Date())
        setLoadError(null)
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === 'AbortError') return
        if (handleAuthLoss(cause)) return
        setLoadError(cause instanceof ApiError ? cause.messageKey : 'server')
      } finally {
        setBusy(false)
      }
    },
    [handleAuthLoss],
  )

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  /**
   * Materials, on demand. A failure here is deliberately SILENT and leaves the count null:
   * the panel then says the material line is still loading and offers no link, which is the
   * honest state. Turning a failed side fetch into a page-level error would make the
   * dashboard look broken because of a panel nobody may have opened.
   */
  useEffect(() => {
    if (filters.location === null || openMaterials !== null) return
    const controller = new AbortController()
    void (async () => {
      try {
        const material = await fetchMaterialSnapshot(controller.signal)
        const counts: Record<string, number> = {}
        for (const request of material.material_requests) {
          if (request.location_id === null || !isOpenMaterial(request.status)) continue
          counts[request.location_id] = (counts[request.location_id] ?? 0) + 1
        }
        setOpenMaterials(counts)
      } catch {
        /* stays null: „noch nicht geladen", never a false zero */
      }
    })()
    return () => controller.abort()
  }, [filters.location, openMaterials])

  const asOf = loadedAt ?? new Date()

  // Oldest first: the person most likely to be about to trip the 8h timer is at the top.
  const openShifts =
    snapshot === null
      ? []
      : snapshot.shifts
          .filter((shift) => shift.end_time === null)
          .sort((a, b) => a.start_time.localeCompare(b.start_time))

  const unresolvedShifts =
    snapshot === null ? [] : snapshot.shifts.filter((shift) => shiftState(shift) === 'unresolved')

  // A worker with no email can never sign in at all (decision-22), so they can never file
  // an hour. Silent and permanent until somebody notices it here.
  const workersWithoutEmail =
    snapshot === null ? [] : snapshot.workers.filter((w) => w.active && w.email === null)

  // An active building that appears in no loaded shift has probably never had a working
  // tag on the wall. Scoped to what was loaded, and the wording says so.
  const seenLocationIds = new Set(snapshot?.shifts.map((shift) => shift.location_id) ?? [])
  const locationsWithoutShifts =
    snapshot === null
      ? []
      : snapshot.locations.filter(
          (location) => location.active && !seenLocationIds.has(location.id),
        )

  /**
   * The last completed shifts, newest first. `/admin/data` already returns shifts in
   * `start_time DESC`, so this is a slice and not a sort.
   *
   * Completed means the same thing it means everywhere else: an end time that counts
   * towards pay. An open or unconfirmed shift is an EXCEPTION and belongs to the blocks
   * above, not to a list whose only job is to prove that recording works.
   */
  const recentShifts =
    snapshot === null
      ? []
      : snapshot.shifts
          .filter(
            // Narrowed, not cast: the duration column below must not be able to compile
            // against a null end time.
            (shift): shift is Shift & { end_time: string } =>
              shift.end_time !== null && !blocksPayroll(shiftState(shift)),
          )
          .slice(0, RECENT_SHIFTS)

  const minutesOnSite = (startIso: string) =>
    Math.round((asOf.getTime() - new Date(startIso).getTime()) / 60_000)

  // Vienna, explicitly — not the browser's zone. The shift log pins it too, and two screens
  // that name the same shift two hours (or one DAY, near midnight) apart is how a director
  // stops believing either of them.
  const clockTime = (iso: string) =>
    format.dateTime(new Date(iso), {
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: BUSINESS_TIME_ZONE,
    })

  const hourMinute = (iso: string) =>
    format.dateTime(new Date(iso), {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: BUSINESS_TIME_ZONE,
    })

  const dayTime = (iso: string) =>
    format.dateTime(new Date(iso), {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: BUSINESS_TIME_ZONE,
    })

  const problemCount =
    unresolvedShifts.length + workersWithoutEmail.length + locationsWithoutShifts.length

  /**
   * One row per NAMED thing that needs doing. A count alone is not actionable — "3 Objekte
   * ohne Schicht" tells the director nothing he can act on this morning, and the names do.
   * Every row opens the screen that owns the fix; this one owns none of them.
   */
  const todo: AttentionItem[] = [
    ...unresolvedShifts.map(
      (shift): AttentionItem => ({
        id: `shift-${shift.id}`,
        who: shift.worker_name,
        where: t('rowUnresolved', {
          location: shift.location_name,
          date: dayTime(shift.start_time),
        }),
        state: 'unres',
        trailing: <StateBadge state="unres" label={t('badgeUnresolved')} />,
        openLabel: t('unresolvedLink'),
        onOpen: () => router.push(SHIFTS_UNRESOLVED_PATH),
      }),
    ),
    ...workersWithoutEmail.map(
      (worker): AttentionItem => ({
        id: `worker-${worker.id}`,
        who: worker.name,
        where: t('rowNoEmail'),
        state: 'muted',
        trailing: <StateBadge state="muted" label={t('badgeNoEmail')} />,
        openLabel: t('noEmailLink'),
        onOpen: () => router.push(WORKERS_NO_EMAIL_PATH),
      }),
    ),
    ...locationsWithoutShifts.map(
      (location): AttentionItem => ({
        id: `location-${location.id}`,
        who: location.name,
        where: t('rowDeadTag'),
        state: 'muted',
        trailing: <StateBadge state="muted" label={t('badgeDeadTag')} />,
        openLabel: t('deadTagLink'),
        onOpen: () => router.push(LOCATIONS_NO_TAG_PATH),
      }),
    ),
  ]

  /** Which parts the number in the answer band is made of. Never just the total. */
  const todoParts = [
    unresolvedShifts.length === 0 ? null : t('toDoUnresolved', { count: unresolvedShifts.length }),
    workersWithoutEmail.length === 0
      ? null
      : t('toDoNoEmail', { count: workersWithoutEmail.length }),
    locationsWithoutShifts.length === 0
      ? null
      : t('toDoDeadTag', { count: locationsWithoutShifts.length }),
  ].filter((part) => part !== null)

  /**
   * The checks that came back clean, still named but typeset small. When EVERYTHING is
   * clean the list below says so on its own and this would be the same sentence twice.
   */
  const clearNotes =
    problemCount === 0
      ? []
      : [
          unresolvedShifts.length === 0 ? t('unresolvedNone') : null,
          workersWithoutEmail.length === 0 ? t('noEmailNone') : null,
          locationsWithoutShifts.length === 0 ? t('deadTagNone') : null,
        ].filter((note) => note !== null)

  const onSiteSub =
    openShifts.length === 0
      ? t('onSiteEmpty')
      : [
          ...openShifts
            .slice(0, ONSITE_NAMES)
            .map((shift) =>
              t('onSiteSince', { name: shift.worker_name, time: hourMinute(shift.start_time) }),
            ),
          openShifts.length > ONSITE_NAMES
            ? t('onSiteMore', { count: openShifts.length - ONSITE_NAMES })
            : null,
        ]
          .filter((part) => part !== null)
          .join(' · ')

  /**
   * `?location=` resolved against the data actually on screen. A well-formed uuid naming no
   * building is NOT ignored: the panel stays shut and the chip says „unbekannt", because
   * silently showing the dashboard as though no filter had been asked for is how a director
   * reads one building's state as another's.
   */
  const panelBuilding =
    filters.location === null
      ? null
      : (snapshot?.locations.find((location) => location.id === filters.location) ?? null)
  const panelUnknown = filters.location !== null && snapshot !== null && panelBuilding === null

  const openPanel = (id: string) => setFilters({ location: id }, 'push')
  // 'replace', not 'push': closing already removed the surface, and a second history entry
  // would mean pressing back TWICE to leave a screen you have already left.
  const closePanel = () => setFilters({ location: null }, 'replace')
  // One handler for both surfaces, so the map pin and the list row can never select
  // different things. `useCallback` because HomeMap holds it across a map that must not be
  // rebuilt: an unstable identity here is a billed Maps load on every render.
  const selectBuilding = useCallback(
    (id: string | null) => setFilters({ location: id }, id === null ? 'replace' : 'push'),
    [setFilters],
  )

  /**
   * Every active building, summarised ONCE for the pins and the list (lib/objects.ts).
   *
   * `useMemo` is not a micro-optimisation here and the measurement says so: a fresh array
   * identity on every render made <HomeMap>'s fit effect re-run on every render, which
   * fought the pan that opens an info box and re-entered `loadGoogleMaps()` per keystroke.
   */
  const objects = useMemo(
    () => summariseBuildings(snapshot?.locations ?? [], snapshot?.shifts ?? [], snapshot?.zones),
    [snapshot],
  )

  /**
   * WHICH SURFACE SHOWS THE SELECTED BUILDING. Exactly one, never both.
   *
   * The info box on the pin is the owner's chosen presentation (IA-PLAN §9) and it can only
   * exist where there is a pin. Everything else — no key in the build, nothing geocoded, a
   * key Google rejected, a building whose coordinates are NULL, a phone with the map
   * collapsed — falls back to the drawer, which is the same `<BuildingFacts>` in a
   * different frame. `mapShowsPanel` is reported UP from HomeMap rather than guessed here,
   * because only HomeMap knows whether Google actually answered.
   */
  const [mapDrawn, setMapDrawn] = useState(false)
  const panelOnMap = mapDrawn && panelBuilding !== null && isPinned(panelBuilding) && !panelUnknown

  /**
   * Ask Google again for one building's coordinates. A 200 does NOT mean a pin came back —
   * a failed geocode is a successful request with a null answer — so the ROW is read, not
   * the status code, and the reason is stated either way. Same contract `/analytics/` uses.
   */
  async function retryGeocode(id: string) {
    if (geoBusy) return
    const building = snapshot?.locations.find((location) => location.id === id) ?? null
    if (building === null) return
    setGeoBusy(true)
    setGeoNotice(null)
    try {
      const updated = await geocodeLocation(id)
      setGeoNotice(
        updated.lat === null
          ? {
              ok: false,
              text: t('geoNoPin', {
                name: building.name,
                status: updated.geocode_status ?? t('objectsGeoUnknown'),
              }),
            }
          : { ok: true, text: t('geoPinned', { name: building.name }) },
      )
      await load()
    } catch (cause) {
      if (handleAuthLoss(cause)) return
      setGeoNotice({
        ok: false,
        text:
          cause instanceof ApiError && cause.status === 422
            ? t('geoNoAddress', { name: building.name })
            : t('geoFailed', { name: building.name }),
      })
    } finally {
      setGeoBusy(false)
    }
  }

  return (
    <>
      <PageHeader
        title={t('heading')}
        question={t('question')}
        action={
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => void load()}
            disabled={busy}
          >
            {busy ? t('refreshing') : t('refresh')}
          </button>
        }
      />

      {/* Above the snapshot and independent of it: a failed refresh must not be able to
          present the previous payload as current without saying so. */}
      <p className="form-error" role="alert">
        {loadError === null ? '' : tError(loadError)}
      </p>

      {/* The geocode outcome. A page-level live region, not one inside the map or the
          panel: both of those can be gone by the time the answer arrives. */}
      <p className={geoNotice?.ok === false ? 'form-error' : 'form-status'} role="status">
        {geoNotice === null ? '' : geoNotice.text}
      </p>

      {/* The filter, echoed by the screen it landed on (decision-38 rule 3). On `/` the only
          filter is the panel itself, so the chip is also the way to close it with the
          keyboard from anywhere on the page. */}
      <FilterChips
        chips={
          filters.location === null
            ? []
            : [
                {
                  key: 'location',
                  label: tFilter('location'),
                  value: panelBuilding?.name ?? tFilter('unknownLocation'),
                  unknown: panelUnknown,
                  onRemove: closePanel,
                },
              ]
        }
      />
      {panelUnknown ? <p className="notice bad">{tFilter('unknownNotice')}</p> : null}

      {/* A FAILED LOAD MUST NOT GO ON SAYING "loading". This branch is reached whenever the
          page has no data, and a failed fetch leaves it with no data FOR EVER — so with the
          database stopped, the director got a red error line and, beneath it, a permanent
          "Wird geladen …" in brighter and larger type than the error. Two contradicting
          statements at once, the louder of them false. Desaturated it was worse: the failure
          read as the LESS important of the two, which is colour carrying the whole signal
          instead of being the second one. Measured by stopping postgresql on production and
          photographing this screen (ops/break-infra.sh § 2 puts the box in that state).
          Saying it HERE, and not only in the alert banner, is what makes it reachable: on
          /objekte that banner sits ~370px above this table, so a director reading the table
          never saw it at all. */}
      {snapshot === null ? (
        <p role="status">{loadError === null ? t('loading') : tError(loadError)}</p>
      ) : (
        <>
          {/* The answer, first. AnswerBand is the page's role="status" — it replaces the
              summary sentence this screen used to lead with, and it must not be wrapped
              in a second live region. */}
          <AnswerBand
            cells={[
              {
                k: t('triageHeading'),
                v: problemCount,
                sub: problemCount === 0 ? t('toDoNone') : todoParts.join(' · '),
              },
              {
                k: t('onSiteHeading'),
                v: openShifts.length,
                calm: true,
                sub: onSiteSub,
              },
            ]}
          />

          {/* THE MAP. Added above the ledger, never in place of it. It renders NOTHING at
              all when no building has coordinates — an empty grey frame over a complete
              list is a screen apologising for something that is not missing. */}
          <HomeMap
            buildings={objects}
            selectedId={filters.location}
            onSelect={selectBuilding}
            onDrawnChange={setMapDrawn}
            renderFacts={(id) => {
              const building = snapshot.locations.find((location) => location.id === id)
              if (building === undefined) return null
              return (
                <BuildingFacts
                  building={building}
                  shifts={snapshot.shifts}
                  zones={snapshot.zones}
                  openMaterials={openMaterials === null ? null : (openMaterials[id] ?? 0)}
                  truncated={snapshot.shifts.length >= snapshot.shift_limit}
                  asOf={asOf}
                  /* The box on a pin has ~300px of map to live in, so the same numbers and
                     the same links are laid out as a disclosure rather than as one column.
                     Content identical to the drawer's — it is one component. */
                  layout="box"
                />
              )
            }}
          />

          {/* ALWAYS RENDERED, on every path, whatever the map is doing. The map is the
              region above it that may or may not appear; this is the complete list. */}
          <ListPanel title={t('objectsHeading')} note={t('objectsNote')}>
            <Objektliste
              buildings={objects}
              selectedId={filters.location}
              onOpen={openPanel}
              onGeocode={(id) => void retryGeocode(id)}
              busy={geoBusy}
            />
          </ListPanel>

          <ListPanel
            title={t('triageHeading')}
            action={
              <Link className="btn btn-quiet" href={SHIFTS_UNRESOLVED_PATH}>
                {t('unresolvedLink')}
              </Link>
            }
          >
            {todo.length === 0 ? (
              /* „Leer heißt: nichts zu tun." Never a dash, never a blank panel: an empty
                 exception view is what a director once read as data loss.

                 Its `=0` branch used to append „Zurzeit ist niemand eingestempelt." — the
                 THIRD printing of that one sentence on an empty dashboard, after the answer
                 band's sub and the „Gerade im Einsatz" panel that owns it. Two statements of
                 a fact is a summary and its detail; four is a screen that has nothing to say
                 and says it anyway. The sentence is not gone, it is stated twice instead of
                 three times, and the branches that carry a COUNT are untouched. */
              <EmptyState>{t('allClear', { count: openShifts.length })}</EmptyState>
            ) : (
              <AttentionList items={todo.slice(0, TRIAGE_ROWS)} />
            )}
          </ListPanel>

          {todo.length > TRIAGE_ROWS ? (
            <p className="field-hint">{t('moreToDo', { count: todo.length - TRIAGE_ROWS })}</p>
          ) : null}

          {clearNotes.length > 0 ? <p className="field-hint">{clearNotes.join(' ')}</p> : null}

          {/* The shift list is capped by the server; do not let a truncated payload be
              read as "this building has never been cleaned". */}
          {snapshot.shifts.length >= snapshot.shift_limit ? (
            <p className="field-hint">{t('truncatedNote', { limit: snapshot.shift_limit })}</p>
          ) : null}

          {/* The elapsed column is frozen at load and says so — in the panel's own heading,
              because a footnote loose on the page is prose the eye has to sort out. */}
          <ListPanel
            title={t('onSiteHeading')}
            note={t('asOf', {
              time: format.dateTime(asOf, {
                hour: '2-digit',
                minute: '2-digit',
                timeZone: BUSINESS_TIME_ZONE,
              }),
            })}
          >
            {openShifts.length === 0 ? (
              <EmptyState>{t('onSiteEmpty')}</EmptyState>
            ) : (
              <table className="data-table" aria-busy={busy}>
                <caption className="visually-hidden">{t('onSiteCaption')}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t('colWorker')}</th>
                    <th scope="col">{t('colLocation')}</th>
                    <th scope="col">{t('colSince')}</th>
                    <th scope="col">{t('colElapsed')}</th>
                  </tr>
                </thead>
                <tbody>
                  {openShifts.map((shift) => {
                    const minutes = minutesOnSite(shift.start_time)
                    return (
                      <tr key={shift.id} className="is-open">
                        {/* The NAME is the link — no extra action column. Both panels are
                            one click from the row that named the person and the building,
                            which is the loop this admin did not have: read a name off one
                            table, find it again on another. */}
                        <th scope="row">
                          <Link href={filterHref('/workers/', { worker: shift.worker_id })}>
                            {shift.worker_name}
                          </Link>
                        </th>
                        <td>
                          <button
                            type="button"
                            className="btn btn-quiet"
                            onClick={() => openPanel(shift.location_id)}
                          >
                            {shift.location_name}
                            <span className="visually-hidden"> {t('panelOpen')}</span>
                          </button>
                        </td>
                        {/* decision-56: a shift started without a tag says so here, on the
                            one screen that claims somebody is on site right now. */}
                        <td>
                          {clockTime(shift.start_time)}
                          {shift.manual_start ? ` — ${tShift('manualStart')}` : ''}
                        </td>
                        {/* Text, not colour: the warning has to survive greyscale. */}
                        <td>
                          {t('elapsedValue', { duration: formatDuration(minutes) })}
                          {minutes >= AUTO_CLOSE_MINUTES ? ` — ${t('overdueFlag')}` : ''}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </ListPanel>

          {/* Last, and deliberately plain. Not a live region: it is not news, it is
              reassurance, and announcing it would compete with the answer band above. */}
          <ListPanel
            title={t('recentHeading', { count: RECENT_SHIFTS })}
            note={t('recentScope', { count: RECENT_SHIFTS })}
            action={
              <Link className="btn btn-quiet" href={SHIFTS_PATH}>
                {t('recentLink')}
              </Link>
            }
          >
            {recentShifts.length === 0 ? (
              <EmptyState>{t('recentEmpty')}</EmptyState>
            ) : (
              <table className="data-table">
                <caption className="visually-hidden">{t('recentCaption')}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t('colWhen')}</th>
                    <th scope="col">{t('colWorker')}</th>
                    <th scope="col">{t('colLocation')}</th>
                    <th scope="col">{t('colDuration')}</th>
                  </tr>
                </thead>
                <tbody>
                  {recentShifts.map((shift) => (
                    <tr key={shift.id}>
                      <th scope="row">{dayTime(shift.start_time)}</th>
                      <td>
                        <Link href={filterHref('/workers/', { worker: shift.worker_id })}>
                          {shift.worker_name}
                        </Link>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-quiet"
                          onClick={() => openPanel(shift.location_id)}
                        >
                          {shift.location_name}
                          <span className="visually-hidden"> {t('panelOpen')}</span>
                        </button>
                      </td>
                      <td>
                        {formatDuration(durationMinutes(shift.start_time, shift.end_time))}
                        {manualEnds(shift).map((end) => (
                          <span key={end} className="shift-manual-end">
                            {end === 'start' ? tShift('manualStart') : tShift('manualClose')}
                          </span>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </ListPanel>
        </>
      )}

      {/* THE OBJEKTPANEL, as a drawer — the rendering used whenever the map cannot hold the
          info box: no key, nothing geocoded, a rejected key, THIS building without
          coordinates, or a phone with the map collapsed. Rendered last so it is the last
          thing in the DOM, like every other overlay in this admin; <Drawer> moves focus in,
          traps it and restores it on close. Driven entirely by the URL, which is what makes
          it linkable at all — and `panelOnMap` guarantees the two renderings are never on
          screen together saying the same thing twice. */}
      <BuildingPanel
        building={panelOnMap ? null : panelBuilding}
        shifts={snapshot?.shifts ?? []}
        zones={snapshot?.zones ?? []}
        openMaterials={
          filters.location === null || openMaterials === null
            ? null
            : (openMaterials[filters.location] ?? 0)
        }
        truncated={snapshot !== null && snapshot.shifts.length >= snapshot.shift_limit}
        asOf={asOf}
        onClose={closePanel}
      />
    </>
  )
}
