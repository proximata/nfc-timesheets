'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useFormatter, useTranslations } from 'next-intl'
import { type FormEvent, useCallback, useEffect, useId, useState } from 'react'
import { AnswerBand } from '@/components/AnswerBand'
import { ConfirmModal } from '@/components/ConfirmModal'
import { Drawer } from '@/components/Drawer'
import { EmptyState } from '@/components/EmptyState'
import { Field } from '@/components/Field'
import { FilterChips } from '@/components/FilterChips'
import { ListPanel } from '@/components/ListPanel'
import { PageHeader } from '@/components/PageHeader'
import { type BadgeState, StateBadge } from '@/components/StateBadge'
import {
  ApiError,
  fetchMaterialSnapshot,
  type InventoryItem,
  type Location,
  type MaterialRequestPatch,
  type MaterialRequestRow,
  type MaterialSnapshot,
  type MaterialStatus,
  patchMaterialRequest,
} from '@/lib/api'
import { filterHref, useFilters } from '@/lib/filters'
import type { ErrorKey } from '@/lib/locale'
import {
  isAcknowledged,
  isOpen,
  isUnpriced,
  type MaterialStage,
  nextStatuses,
  stageOf,
} from '@/lib/materials'
import { centsToPlainEuros, parseEuroToCents } from '@/lib/money'
import { LOGIN_PATH } from '@/lib/nav'
import { BUSINESS_TIME_ZONE } from '@/lib/shifts'

/**
 * Material requests — the queue a worker is standing in a building waiting on.
 *
 * THE POINT OF THIS SCREEN is that the next action is one click. A worker wrote "der blaue
 * Reiniger, der große" and cannot work without it; every extra step between the director
 * opening this page and that request moving is a step taken while somebody waits. So the
 * forward move stays a single button IN the row — never a dropdown of every status, never
 * behind a confirmation — and the paperwork (which catalogue item, how many, what it cost)
 * moved into a drawer that never blocks the move.
 *
 * The ONE exception is refusing: `rejected` is terminal, the server 409s every later edit of
 * a refused request, and the worker is told no. That gets a plain yes/no first.
 *
 * WHAT THIS SCREEN REFUSES TO DO:
 *
 *   * Guess. There is no fuzzy match from the worker's words onto `inventory_items`, no
 *     default quantity and no default cost. The server refuses too; this just does not
 *     offer a control that would invite it.
 *   * Promise a notification. There is no push in this system — the server's dependencies
 *     are `pg` + `@sentry/node` and nothing else (decision-23 amending decision-16), so the
 *     worker's app POLLS. "Arrived" means the row moved, not that a phone buzzed, and the
 *     copy says exactly that.
 *   * Attribute cost to the building the worker named. `location_id` is context — it helps
 *     the director decide whether to order — and decision-6 splits materials pro-rata by
 *     labour hours, having explicitly rejected per-request attribution. Charging a cost to
 *     that column would overturn a decision record from a UI file.
 *
 * The one number this screen owes the P&L is `cost_cents`. An ordered request with no cost
 * is silently worth zero in the material pool, so every building's margin comes out too
 * high — which is why unpriced requests are counted out loud here and on /pl/.
 */

const PL_PATH = '/pl/'
const INVENTORY_PATH = '/inventory/'
const WORKERS_PATH = '/workers/'
/** The building's object surface. `/?location=<uuid>` — there is no `/locations/<id>`. */
const HOME_PATH = '/'

/**
 * What the row filter offers, and it is the `status=` vocabulary of decision-38 rather than
 * a private one: `open` is the queue, `all` is the history, and the three stage values let a
 * link say „show me what is waiting to be ORDERED" without inventing a second parameter.
 */
const FILTERS = ['open', 'all', 'decide', 'order', 'deliver'] as const
type Filter = (typeof FILTERS)[number]

function isFilter(value: string): value is Filter {
  return (FILTERS as readonly string[]).includes(value)
}

/** The `submitted|approved|ordered` a stage filter keeps. `open`/`all` are handled apart. */
const STAGE_STATUS: Record<'decide' | 'order' | 'deliver', string> = {
  decide: 'submitted',
  order: 'approved',
  deliver: 'ordered',
}

/** The paperwork form. Everything optional — none of it gates a lifecycle move. */
type Draft = {
  request: MaterialRequestRow
  /** Catalogue item id as a select value; '' = leave unmapped. */
  itemId: string
  quantity: string
  /** Euros as typed. Converted to integer cents at submit, never held as a float. */
  cost: string
  locationId: string
  note: string
}

type ErrorMessage = 'errorQuantityInvalid' | 'errorCostInvalid' | 'errorRejected' | 'errorMoved'

type FieldErrors = { quantity?: ErrorMessage; cost?: ErrorMessage }

function draftOf(request: MaterialRequestRow): Draft {
  return {
    request,
    itemId: request.inventory_item_id === null ? '' : String(request.inventory_item_id),
    quantity: request.quantity === null ? '' : String(request.quantity),
    cost: request.cost_cents === null ? '' : centsToPlainEuros(request.cost_cents),
    locationId: request.location_id ?? '',
    note: request.admin_note ?? '',
  }
}

/**
 * The stage, as a badge and as a row rule. COLOUR IS THE SECOND SIGNAL: the cell always
 * carries the word, the rule repeats it, and the sort order carries the rest.
 *
 * Amber = waiting on the director. Blue = in flight, somebody else's move. Nothing = done.
 */
const BADGE_OF: Record<MaterialStage, BadgeState> = {
  decide: 'unres',
  order: 'open',
  deliver: 'open',
  done: 'muted',
  refused: 'muted',
}

const ROW_CLASS_OF: Record<MaterialStage, string | undefined> = {
  decide: 'is-unres',
  order: 'is-open',
  deliver: 'is-open',
  done: undefined,
  refused: 'is-muted',
}

export default function MaterialRequestsPage() {
  const t = useTranslations('materials')
  const tFilter = useTranslations('filters')
  const tError = useTranslations('error')
  const format = useFormatter()
  const router = useRouter()

  const filterId = useId()
  const filterHintId = useId()
  const formId = useId()
  const itemId = useId()
  const quantityId = useId()
  const costId = useId()
  const locationId = useId()
  const noteId = useId()

  // null = still loading. Never rendered as "no requests".
  const [snapshot, setSnapshot] = useState<MaterialSnapshot | null>(null)
  const [loadError, setLoadError] = useState<ErrorKey | null>(null)
  /**
   * `?status=` / `?location=` / `?worker=` (decision-38). The building panel links here with
   * `status=open` and a building, so „2 offene Materialanforderungen" opens THOSE two.
   *
   * THE URL IS THE FILTER: no second copy in state, so the address bar and the queue cannot
   * disagree and the back button moves the list.
   */
  const [filters, setFilters] = useFilters()
  const filter: Filter = filters.status ?? 'open'
  const setFilter = (next: Filter) =>
    // 'replace': a select on the screen you are already on. See lib/filters.ts.
    setFilters({ status: next }, 'replace')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [rejecting, setRejecting] = useState<MaterialRequestRow | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<ErrorMessage | null>(null)
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const handleAuthLoss = useCallback(
    (cause: unknown): boolean => {
      if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) {
        router.replace(LOGIN_PATH)
        return true
      }
      return false
    },
    [router],
  )

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        setSnapshot(await fetchMaterialSnapshot(signal))
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

  /**
   * A 409 here is the row having moved under us — somebody else advanced it, or a button
   * was double-clicked. `ApiError` carries no server text on purpose, and both readings
   * have the SAME correct action: look at the real state again. So this reloads.
   *
   * `into` is where the refusal belongs. With a drawer open the drawer IS the screen on a
   * phone, so a message on the page behind it would be announced into something the reader
   * can no longer see; with no drawer open the page's live region is the only place it can
   * go. Never both — two live regions saying the same sentence is announced twice.
   */
  function reportFailure(cause: unknown, into: 'drawer' | 'page') {
    if (handleAuthLoss(cause)) return
    const say = (key: ErrorMessage) => {
      if (into === 'drawer') setFormError(key)
      else setNotice({ ok: false, text: t(key) })
    }
    if (cause instanceof ApiError && cause.status === 409) {
      say('errorMoved')
      void load()
      return
    }
    if (cause instanceof ApiError && (cause.status === 0 || cause.status >= 500)) {
      setLoadError(cause.messageKey)
      return
    }
    say('errorRejected')
  }

  /** The one-click lifecycle move. Nothing else on the row is touched. */
  async function advance(request: MaterialRequestRow, status: MaterialStatus) {
    if (busy) return
    setBusy(true)
    setNotice(null)
    setFormError(null)
    try {
      await patchMaterialRequest(request.id, { status })
      setRejecting(null)
      setNotice({
        ok: true,
        text: t('moved', { worker: request.worker_name, state: stateLabel[status] }),
      })
      await load()
    } catch (cause) {
      setRejecting(null)
      reportFailure(cause, 'page')
    } finally {
      setBusy(false)
    }
  }

  function openDetail(request: MaterialRequestRow) {
    setDraft(draftOf(request))
    setFieldErrors({})
    setFormError(null)
    setNotice(null)
  }

  function closeDetail() {
    setDraft(null)
    setFieldErrors({})
    setFormError(null)
  }

  async function submitDetail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (draft === null || busy) return

    const quantityText = draft.quantity.trim()
    const costText = draft.cost.trim()
    const errors: FieldErrors = {}

    // Whole units only, and at least one: the column is `CHECK (quantity > 0)`.
    const quantity = quantityText === '' ? null : Number(quantityText)
    if (
      quantityText !== '' &&
      (!Number.isSafeInteger(quantity) || quantity === null || quantity < 1)
    ) {
      errors.quantity = 'errorQuantityInvalid'
    }
    const cents = costText === '' ? null : parseEuroToCents(costText)
    if (costText !== '' && cents === null) errors.cost = 'errorCostInvalid'

    setFieldErrors(errors)
    setFormError(null)
    if (Object.keys(errors).length > 0) return

    /**
     * Only what CHANGED goes on the wire. The route COALESCEs every field, so an omitted
     * one keeps its stored value — but sending the unchanged ones back anyway would make
     * two admins editing different fields of the same request overwrite each other, and
     * would re-send a cost the director did not retype.
     */
    const patch: MaterialRequestPatch = {}
    const nextItem = draft.itemId === '' ? null : Number(draft.itemId)
    if (nextItem !== draft.request.inventory_item_id) patch.inventory_item_id = nextItem
    if (quantity !== null && quantity !== draft.request.quantity) patch.quantity = quantity
    if (cents !== null && cents !== draft.request.cost_cents) patch.cost_cents = cents
    if (draft.locationId !== '' && draft.locationId !== draft.request.location_id) {
      patch.location_id = draft.locationId
    }
    if (draft.note.trim() !== (draft.request.admin_note ?? '')) patch.admin_note = draft.note.trim()

    if (Object.keys(patch).length === 0) {
      setNotice({ ok: true, text: t('detailUnchanged') })
      closeDetail()
      return
    }

    setBusy(true)
    try {
      await patchMaterialRequest(draft.request.id, patch)
      setNotice({ ok: true, text: t('detailSaved', { worker: draft.request.worker_name }) })
      closeDetail()
      await load()
    } catch (cause) {
      reportFailure(cause, 'drawer')
    } finally {
      setBusy(false)
    }
  }

  /**
   * The object filters narrow the queue BEFORE the stage filter, so the summary counts and
   * the „show everything" escape below still describe the same slice the table shows.
   */
  const requests = (snapshot?.material_requests ?? []).filter(
    (request) =>
      (filters.location === null || request.location_id === filters.location) &&
      (filters.worker === null || request.worker_id === filters.worker),
  )
  const visible =
    filter === 'all'
      ? requests
      : filter === 'open'
        ? requests.filter((r) => isOpen(r.status))
        : requests.filter((r) => r.status === STAGE_STATUS[filter])
  const truncated =
    snapshot !== null && snapshot.material_requests.length >= snapshot.material_request_limit

  const waiting = {
    decide: requests.filter((r) => r.status === 'submitted').length,
    order: requests.filter((r) => r.status === 'approved').length,
    deliver: requests.filter((r) => r.status === 'ordered').length,
  }
  const unpriced = requests.filter(isUnpriced).length

  /**
   * The names behind the two object filters. `null` = a well-formed id naming nothing in
   * this payload; the chip says „unbekannt" rather than the screen quietly showing the whole
   * queue as though nothing had been asked for. The worker name is taken from the requests
   * themselves because this screen never loads the roster.
   */
  const locationName =
    filters.location === null
      ? null
      : (snapshot?.locations.find((l) => l.id === filters.location)?.name ?? null)
  const workerName =
    filters.worker === null
      ? null
      : ((snapshot?.material_requests ?? []).find((r) => r.worker_id === filters.worker)
          ?.worker_name ?? null)

  const dayTime = (iso: string) =>
    format.dateTime(new Date(iso), {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: BUSINESS_TIME_ZONE,
    })
  const money = (cents: number) =>
    format.number(cents / 100, { style: 'currency', currency: 'EUR' })

  /** Explicit maps, not template-literal keys: messages are typed, and a typo must fail. */
  const stageLabel: Record<MaterialStage, string> = {
    decide: t('stageDecide'),
    order: t('stageOrder'),
    deliver: t('stageDeliver'),
    done: t('stageDone'),
    refused: t('stageRefused'),
  }
  const actionLabel: Record<MaterialStatus, string> = {
    submitted: t('actionSubmit'),
    approved: t('actionApprove'),
    ordered: t('actionOrder'),
    arrived: t('actionArrive'),
    rejected: t('actionReject'),
  }
  /** The resulting state, named in the confirmation. "Approved" is not "Approve". */
  const stateLabel: Record<MaterialStatus, string> = {
    submitted: t('stateSubmitted'),
    approved: t('stateApproved'),
    ordered: t('stateOrdered'),
    arrived: t('stateArrived'),
    rejected: t('stateRejected'),
  }

  /** The one-line history of a row: what happened, when, in words and in Vienna time. */
  function timeline(request: MaterialRequestRow): string {
    switch (request.status) {
      case 'submitted':
        return t('timelineSubmitted', { when: dayTime(request.created_at) })
      case 'approved':
        return t('timelineApproved', {
          when: dayTime(request.decided_at ?? request.created_at),
        })
      case 'ordered':
        return t('timelineOrdered', { when: dayTime(request.ordered_at ?? request.created_at) })
      case 'arrived':
        return isAcknowledged(request)
          ? t('timelineSeen', {
              when: dayTime(request.arrived_at ?? request.created_at),
              seen: dayTime(request.seen_at ?? request.created_at),
            })
          : t('timelineArrived', { when: dayTime(request.arrived_at ?? request.created_at) })
      case 'rejected':
        return t('timelineRejected', { when: dayTime(request.decided_at ?? request.created_at) })
    }
  }

  const locations: Location[] = snapshot?.locations ?? []
  const inventory: InventoryItem[] = snapshot?.inventory ?? []

  return (
    <>
      <PageHeader title={t('heading')} question={t('question')} />

      {/* Permanent live region: a text change inside an existing region is announced far
          more reliably than a node that appears and disappears. Empty is 0px high. */}
      <p className="form-error" role="alert">
        {loadError === null ? '' : tError(loadError)}
      </p>

      {/* Permanent live region: a text change inside an existing region is announced far
          more reliably than a node that appears and disappears. */}
      <p className={notice?.ok === false ? 'form-error' : 'form-status'} role="status">
        {notice === null ? '' : notice.text}
      </p>

      {snapshot === null ? (
        <p role="status">{t('loading')}</p>
      ) : (
        <>
          {/* Replaces the old `.page-summary` sentence and carries the same three numbers:
              who is waiting on the director, and who is waiting on a van. */}
          <AnswerBand
            cells={[
              { k: t('answerDecide'), v: waiting.decide, sub: t('answerDecideSub') },
              { k: t('answerOrder'), v: waiting.order, sub: t('answerOrderSub') },
              {
                k: t('answerDeliver'),
                v: waiting.deliver,
                sub: t('answerDeliverSub'),
                calm: true,
              },
            ]}
          />

          {/* The object filters, echoed and removable (decision-38 rule 3). Without them a
              queue narrowed to one building reads as a company with one open request. */}
          <FilterChips
            chips={[
              filters.location === null
                ? null
                : {
                    key: 'location',
                    label: tFilter('location'),
                    value: locationName ?? tFilter('unknownLocation'),
                    unknown: locationName === null,
                    onRemove: () => setFilters({ location: null }, 'replace'),
                  },
              filters.worker === null
                ? null
                : {
                    key: 'worker',
                    label: tFilter('worker'),
                    value: workerName ?? tFilter('unknownWorker'),
                    unknown: workerName === null,
                    onRemove: () => setFilters({ worker: null }, 'replace'),
                  },
            ].filter((chip) => chip !== null)}
          />

          {unpriced > 0 ? (
            <p className="note bad">
              {t('unpricedWarning', { unpriced })} <Link href={PL_PATH}>{t('plLink')}</Link>
            </p>
          ) : null}

          {truncated ? (
            <p className="note">{t('truncated', { limit: snapshot.material_request_limit })}</p>
          ) : null}

          {/* No submit: the filter re-slices a list already in memory. No `.filter-bar`
              card either — one select does not need a container, and a box around it is the
              second surface this redesign exists to remove. */}
          <div className="field toolbar-field">
            <label htmlFor={filterId}>{t('filterLabel')}</label>
            <select
              id={filterId}
              value={filter}
              aria-describedby={filterHintId}
              onChange={(event) => {
                if (isFilter(event.target.value)) setFilter(event.target.value)
              }}
            >
              <option value="open">{t('filterOpen')}</option>
              <option value="all">{t('filterAll')}</option>
              {/* The three stage values a link can carry. Offered as options too, so a
                  filter that arrived by URL is a control the reader can also reach. */}
              <option value="decide">{tFilter('statusDecide')}</option>
              <option value="order">{tFilter('statusOrder')}</option>
              <option value="deliver">{tFilter('statusDeliver')}</option>
            </select>
            <p className="field-hint" id={filterHintId}>
              {t('filterHint')}
            </p>
          </div>

          <ListPanel
            title={t('queueHeading')}
            /* /inventory/ left the sidebar (decision-39) and this is its permanent way in:
               the catalogue link used to exist only inside the paperwork drawer, which is a
               route reachable only by opening something else first. */
            action={
              <Link className="btn btn-quiet" href={INVENTORY_PATH}>
                {t('itemCatalogueLink')}
              </Link>
            }
          >
            {visible.length === 0 ? (
              /* Empty is NOT an error and must never read as one. Which empty it is
                 matters: an empty queue is the good day, an empty history is a feature
                 nobody has used yet, and neither is data loss. */
              <EmptyState>
                {filter === 'open' ? t('emptyOpen') : t('emptyAll')}
                {filter === 'open' && requests.length > 0 ? (
                  <>
                    {' '}
                    <button
                      type="button"
                      className="btn btn-quiet"
                      onClick={() => setFilter('all')}
                    >
                      {t('emptyShowAll', { total: requests.length })}
                    </button>
                  </>
                ) : null}
              </EmptyState>
            ) : (
              <table className="data-table" aria-busy={busy}>
                <caption className="visually-hidden">{t('tableCaption')}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t('colWorker')}</th>
                    <th scope="col">{t('colRequest')}</th>
                    <th scope="col">{t('colState')}</th>
                    <th scope="col">{t('colCost')}</th>
                    <th scope="col">{t('colActions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((request) => {
                    const stage = stageOf(request.status)
                    const moves = nextStatuses(request.status)
                    // ONE forward move per row. `rejected` is not a step forward, it is the
                    // end, so it is not offered as one.
                    const forward = moves.find((status) => status !== 'rejected')
                    return (
                      <tr key={request.id} className={ROW_CLASS_OF[stage]}>
                        <th scope="row">
                          {/* The person who is standing in a building waiting for this,
                              one click from their own panel. */}
                          <Link href={filterHref(WORKERS_PATH, { worker: request.worker_id })}>
                            {request.worker_name}
                            <span className="visually-hidden"> {t('openWorker')}</span>
                          </Link>
                          <span className="shift-state-note">
                            {t('askedAt', { when: dayTime(request.created_at) })}
                          </span>
                        </th>
                        {/*
                          The <div> is not decoration: a labelled cell is `display: flex` on a
                          phone, so four sibling children became four ~55px columns with
                          „Staubsa / uger" broken mid-word. One wrapper = one flex item and the
                          sentences stack. Inert on the desktop table.
                        */}
                        <td>
                          <div>
                            {/* The worker's own words, verbatim and quoted so it is obvious
                                they are not ours. */}
                            <q>{request.body}</q>
                            <span className="shift-state-note">
                              {request.location_name === null || request.location_id === null ? (
                                t('noLocationNamed')
                              ) : (
                                /* CONTEXT, not cost attribution (decision-6) — the link
                                   changes nothing about that; it opens the building the
                                   worker NAMED. */
                                <Link
                                  href={filterHref(HOME_PATH, { location: request.location_id })}
                                >
                                  {t('locationNamed', { name: request.location_name })}
                                  <span className="visually-hidden"> {t('openLocation')}</span>
                                </Link>
                              )}
                            </span>
                            {request.item_name === null ? (
                              <span className="shift-state-note">{t('itemUnmapped')}</span>
                            ) : (
                              <span className="shift-state-note">
                                {request.quantity === null
                                  ? t('itemMapped', { name: request.item_name })
                                  : t('itemMappedQuantity', {
                                      name: request.item_name,
                                      quantity: request.quantity,
                                    })}
                              </span>
                            )}
                            {request.admin_note === null ? null : (
                              <span className="shift-state-note">
                                {t('adminNote', { note: request.admin_note })}
                              </span>
                            )}
                          </div>
                        </td>
                        {/* Text, not colour: this survives greyscale and a screen reader. */}
                        <td>
                          <div>
                            {stage === 'refused' ? (
                              /* Refused is terminal and is not a warning: it is a decision
                                 that was made and recorded. The line-through is the signal
                                 that survives greyscale. */
                              <span className="badge muted material-stage-refused">
                                {stageLabel.refused}
                              </span>
                            ) : (
                              <StateBadge state={BADGE_OF[stage]} label={stageLabel[stage]} />
                            )}
                            <span className="shift-state-note">{timeline(request)}</span>
                          </div>
                        </td>
                        <td className="col-numeric">
                          {request.cost_cents === null ? (
                            <span className={isUnpriced(request) ? undefined : 'cell-muted'}>
                              {isUnpriced(request) ? t('costMissing') : t('costNotYet')}
                            </span>
                          ) : (
                            <span className="num">{money(request.cost_cents)}</span>
                          )}
                        </td>
                        {/*
                          Inert on the desktop table; load-bearing on a phone. ≤767px makes a
                          labelled cell `display: flex` while `.cell-actions` keeps
                          `white-space: nowrap`, so three German labels overflow the card and
                          the PAGE scrolls sideways — the failure decision-28 removed.
                          Measured at 360px: scrollWidth 501 without, 360 with. Pre-existing;
                          `git show HEAD:` on this file overflows too.

                          ponytail: one inert attribute instead of a stylesheet this batch does
                          not own. CEILING: every other screen with wide row actions has the
                          same overflow and no assertion. UPGRADE PATH: `flex-wrap: wrap` on
                          `.cell-actions` in the ≤767px block (Foundation), then delete this.
                        */}
                        <td className="cell-actions" style={{ flexWrap: 'wrap' }}>
                          {forward === undefined ? null : (
                            <button
                              type="button"
                              className="btn btn-primary"
                              disabled={busy}
                              onClick={() => advance(request, forward)}
                            >
                              {actionLabel[forward]}
                              <span className="visually-hidden">
                                {t('forRequest', { worker: request.worker_name })}
                              </span>
                            </button>
                          )}
                          {moves.includes('rejected') ? (
                            <button
                              type="button"
                              className="btn btn-quiet"
                              disabled={busy}
                              onClick={() => setRejecting(request)}
                            >
                              {actionLabel.rejected}
                              <span className="visually-hidden">
                                {t('forRequest', { worker: request.worker_name })}
                              </span>
                            </button>
                          ) : null}
                          {/* A refused request 409s on every edit, cost included: the
                              server will not attribute money to something we declined to
                              buy. So the control is not offered — a button whose only
                              possible outcome is a refusal is worse than no button. */}
                          {stage === 'refused' ? (
                            <span className="cell-muted">{t('refusedClosed')}</span>
                          ) : (
                            <button
                              type="button"
                              className="btn btn-quiet"
                              onClick={() => openDetail(request)}
                            >
                              {t('detailOpen')}
                              <span className="visually-hidden">
                                {t('forRequest', { worker: request.worker_name })}
                              </span>
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </ListPanel>

          {/* Standing facts, not transient status, and each one is something a director
              would otherwise reasonably assume the opposite of. Typeset small and placed
              after the queue — never removed. */}
          <ListPanel title={t('standingHeading')} padded>
            <ul className="triage-list">
              <li>{t('notePolling')}</li>
              <li>{t('noteAttribution')}</li>
              <li>{t('noteUnpriced')}</li>
            </ul>
          </ListPanel>
        </>
      )}

      <Drawer
        open={draft !== null}
        onClose={closeDetail}
        title={draft === null ? '' : t('detailHeading', { worker: draft.request.worker_name })}
        step={draft === null ? undefined : stageLabel[stageOf(draft.request.status)]}
        busy={busy}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={closeDetail}>
              {t('cancel')}
            </button>
            <button type="submit" form={formId} className="btn btn-primary" disabled={busy}>
              {busy ? t('submitting') : t('detailSubmit')}
            </button>
          </>
        }
      >
        {draft === null ? null : (
          <form id={formId} onSubmit={submitDetail} noValidate>
            {/* The drawer stays open when the server refuses, so the refusal stays with it:
                on a phone the drawer IS the screen, and a message on the page behind it
                would be announced into something the reader can no longer see. */}
            <p className="form-error" role="alert">
              {formError === null ? '' : t(formError)}
            </p>

            {/* The worker's words travel with the form, so the paperwork is filled in
                against what was actually asked for rather than from memory. */}
            <p>
              <q>{draft.request.body}</q>
            </p>

            <Field
              id={itemId}
              label={t('fieldItem')}
              optional
              help={
                <>
                  {t('itemHint')} <Link href={INVENTORY_PATH}>{t('itemCatalogueLink')}</Link>
                </>
              }
            >
              <select
                value={draft.itemId}
                disabled={busy}
                onChange={(event) => setDraft({ ...draft, itemId: event.target.value })}
              >
                <option value="">{t('itemNone')}</option>
                {inventory.map((item) => (
                  <option key={item.id} value={String(item.id)}>
                    {item.active ? item.name : t('optionInactive', { name: item.name })}
                  </option>
                ))}
              </select>
            </Field>

            <Field
              id={quantityId}
              label={t('fieldQuantity')}
              optional
              error={fieldErrors.quantity === undefined ? null : t(fieldErrors.quantity)}
            >
              <input
                type="text"
                inputMode="numeric"
                value={draft.quantity}
                disabled={busy}
                onChange={(event) => setDraft({ ...draft, quantity: event.target.value })}
              />
            </Field>

            <Field
              id={costId}
              label={t('fieldCost')}
              optional
              help={t('costHint')}
              error={fieldErrors.cost === undefined ? null : t(fieldErrors.cost)}
            >
              <input
                type="text"
                inputMode="decimal"
                value={draft.cost}
                disabled={busy}
                onChange={(event) => setDraft({ ...draft, cost: event.target.value })}
              />
            </Field>

            {/* decision-6, at the point of the control that would otherwise imply the
                opposite. A select labelled "building" next to a cost field reads as cost
                attribution unless it says, right here, that it is not. */}
            <Field id={locationId} label={t('fieldLocation')} optional help={t('locationHint')}>
              <select
                value={draft.locationId}
                disabled={busy}
                onChange={(event) => setDraft({ ...draft, locationId: event.target.value })}
              >
                <option value="">{t('locationNone')}</option>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.active ? location.name : t('optionInactive', { name: location.name })}
                  </option>
                ))}
              </select>
            </Field>

            <Field id={noteId} label={t('fieldNote')} optional help={t('noteHint')}>
              <textarea
                rows={3}
                maxLength={1000}
                value={draft.note}
                disabled={busy}
                onChange={(event) => setDraft({ ...draft, note: event.target.value })}
              />
            </Field>
          </form>
        )}
      </Drawer>

      <ConfirmModal
        open={rejecting !== null}
        onClose={() => setRejecting(null)}
        onConfirm={() => {
          if (rejecting !== null) void advance(rejecting, 'rejected')
        }}
        title={rejecting === null ? '' : t('confirmRejectTitle', { worker: rejecting.worker_name })}
        body={t('confirmRejectBody')}
        confirmLabel={t('actionReject')}
        destructive
        busy={busy}
      />
    </>
  )
}
