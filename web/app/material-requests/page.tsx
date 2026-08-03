'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useFormatter, useTranslations } from 'next-intl'
import { type FormEvent, useCallback, useEffect, useId, useRef, useState } from 'react'
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
import type { ErrorKey } from '@/lib/locale'
import { isAcknowledged, isOpen, isUnpriced, nextStatuses, stageOf } from '@/lib/materials'
import { centsToPlainEuros, parseEuroToCents } from '@/lib/money'
import { LOGIN_PATH } from '@/lib/nav'
import { BUSINESS_TIME_ZONE } from '@/lib/shifts'

/**
 * Material requests — the queue a worker is standing in a building waiting on.
 *
 * THE POINT OF THIS SCREEN is that the next action is one click. A worker wrote "der blaue
 * Reiniger, der große" and cannot work without it; every extra step between the director
 * opening this page and that request moving is a step taken while somebody waits. So the
 * lifecycle move is a button in the row, and the paperwork (which catalogue item, how many,
 * what it cost) is a separate, optional form that never blocks the move.
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

/** What the row filter offers. `open` first: the queue is the reason to be here. */
const FILTERS = ['open', 'all'] as const
type Filter = (typeof FILTERS)[number]

function isFilter(value: string): value is Filter {
  return (FILTERS as readonly string[]).includes(value)
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

export default function MaterialRequestsPage() {
  const t = useTranslations('materials')
  const tError = useTranslations('error')
  const format = useFormatter()
  const router = useRouter()

  const filterId = useId()
  const filterHintId = useId()
  const detailHeadingId = useId()
  const itemId = useId()
  const itemHintId = useId()
  const quantityId = useId()
  const costId = useId()
  const costHintId = useId()
  const locationId = useId()
  const locationHintId = useId()
  const noteId = useId()
  const noteHintId = useId()
  const detailRef = useRef<HTMLElement>(null)

  // null = still loading. Never rendered as "no requests".
  const [snapshot, setSnapshot] = useState<MaterialSnapshot | null>(null)
  const [loadError, setLoadError] = useState<ErrorKey | null>(null)
  const [filter, setFilter] = useState<Filter>('open')
  const [draft, setDraft] = useState<Draft | null>(null)
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

  // The detail form renders ABOVE the table, so a keyboard or screen-reader user would
  // otherwise be left on a button while the thing it opened scrolled out of sight.
  useEffect(() => {
    if (draft !== null) detailRef.current?.focus()
  }, [draft])

  /**
   * A 409 here is the row having moved under us — somebody else advanced it, or a button
   * was double-clicked. `ApiError` carries no server text on purpose, and both readings
   * have the SAME correct action: look at the real state again. So this reloads.
   */
  function reportFailure(cause: unknown) {
    if (handleAuthLoss(cause)) return
    if (cause instanceof ApiError && cause.status === 409) {
      setFormError('errorMoved')
      setNotice({ ok: false, text: t('errorMoved') })
      void load()
      return
    }
    if (cause instanceof ApiError && (cause.status === 0 || cause.status >= 500)) {
      setLoadError(cause.messageKey)
      return
    }
    setFormError('errorRejected')
    setNotice({ ok: false, text: t('errorRejected') })
  }

  /** The one-click lifecycle move. Nothing else on the row is touched. */
  async function advance(request: MaterialRequestRow, status: MaterialStatus) {
    if (busy) return
    setBusy(true)
    setNotice(null)
    setFormError(null)
    try {
      await patchMaterialRequest(request.id, { status })
      setNotice({
        ok: true,
        text: t('moved', { worker: request.worker_name, state: stateLabel[status] }),
      })
      await load()
    } catch (cause) {
      reportFailure(cause)
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
      reportFailure(cause)
    } finally {
      setBusy(false)
    }
  }

  const requests = snapshot?.material_requests ?? []
  const visible = filter === 'open' ? requests.filter((r) => isOpen(r.status)) : requests
  const truncated = snapshot !== null && requests.length >= snapshot.material_request_limit

  const waiting = {
    decide: requests.filter((r) => r.status === 'submitted').length,
    order: requests.filter((r) => r.status === 'approved').length,
    deliver: requests.filter((r) => r.status === 'ordered').length,
  }
  const unpriced = requests.filter(isUnpriced).length

  const dayTime = (iso: string) =>
    format.dateTime(new Date(iso), {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: BUSINESS_TIME_ZONE,
    })
  const money = (cents: number) =>
    format.number(cents / 100, { style: 'currency', currency: 'EUR' })

  /** Explicit maps, not template-literal keys: messages are typed, and a typo must fail. */
  const stageLabel: Record<ReturnType<typeof stageOf>, string> = {
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
      <h1>{t('heading')}</h1>
      <p className="lede">{t('intro')}</p>

      {/* Standing facts, not transient status. Both of these are things a director would
          otherwise reasonably assume the opposite of. */}
      <div className="callout">
        <h2>{t('standingHeading')}</h2>
        <ul>
          <li>{t('notePolling')}</li>
          <li>{t('noteAttribution')}</li>
          <li>{t('noteUnpriced')}</li>
        </ul>
      </div>

      {loadError !== null ? (
        <p className="form-error" role="alert">
          {tError(loadError)}
        </p>
      ) : null}

      {/* Permanent live region: a text change inside an existing region is announced far
          more reliably than a node that appears and disappears. */}
      <p className={notice?.ok === false ? 'form-error' : 'form-status'} role="status">
        {notice === null ? '' : notice.text}
      </p>

      {draft === null ? null : (
        <section
          className="notice share-panel"
          ref={detailRef}
          tabIndex={-1}
          aria-labelledby={detailHeadingId}
        >
          <h2 id={detailHeadingId}>{t('detailHeading', { worker: draft.request.worker_name })}</h2>
          <p>
            <q>{draft.request.body}</q>
          </p>

          <form className="worker-form" onSubmit={submitDetail} noValidate>
            <p className="form-error" role="alert">
              {formError === null ? '' : t(formError)}
            </p>

            <div className="field">
              <label htmlFor={itemId}>{t('fieldItem')}</label>
              <select
                id={itemId}
                value={draft.itemId}
                aria-describedby={itemHintId}
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
              <p className="field-hint" id={itemHintId}>
                {t('itemHint')} <Link href={INVENTORY_PATH}>{t('itemCatalogueLink')}</Link>
              </p>
            </div>

            <div className="field">
              <label htmlFor={quantityId}>{t('fieldQuantity')}</label>
              <input
                id={quantityId}
                type="text"
                inputMode="numeric"
                value={draft.quantity}
                aria-describedby={`${quantityId}-error`}
                aria-invalid={fieldErrors.quantity !== undefined}
                disabled={busy}
                onChange={(event) => setDraft({ ...draft, quantity: event.target.value })}
              />
              <p className="field-error" id={`${quantityId}-error`} role="alert">
                {fieldErrors.quantity === undefined ? '' : t(fieldErrors.quantity)}
              </p>
            </div>

            <div className="field">
              <label htmlFor={costId}>{t('fieldCost')}</label>
              <input
                id={costId}
                type="text"
                inputMode="decimal"
                value={draft.cost}
                aria-describedby={`${costHintId} ${costId}-error`}
                aria-invalid={fieldErrors.cost !== undefined}
                disabled={busy}
                onChange={(event) => setDraft({ ...draft, cost: event.target.value })}
              />
              <p className="field-hint" id={costHintId}>
                {t('costHint')}
              </p>
              <p className="field-error" id={`${costId}-error`} role="alert">
                {fieldErrors.cost === undefined ? '' : t(fieldErrors.cost)}
              </p>
            </div>

            <div className="field">
              <label htmlFor={locationId}>{t('fieldLocation')}</label>
              <select
                id={locationId}
                value={draft.locationId}
                aria-describedby={locationHintId}
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
              {/* decision-6, at the point of the control that would otherwise imply the
                  opposite. A select labelled "building" next to a cost field reads as cost
                  attribution unless it says, right here, that it is not. */}
              <p className="field-hint" id={locationHintId}>
                {t('locationHint')}
              </p>
            </div>

            <div className="field">
              <label htmlFor={noteId}>{t('fieldNote')}</label>
              <textarea
                id={noteId}
                rows={3}
                maxLength={1000}
                value={draft.note}
                aria-describedby={noteHintId}
                disabled={busy}
                onChange={(event) => setDraft({ ...draft, note: event.target.value })}
              />
              <p className="field-hint" id={noteHintId}>
                {t('noteHint')}
              </p>
            </div>

            <div className="form-actions">
              <button type="submit" className="button-primary" disabled={busy}>
                {busy ? t('submitting') : t('detailSubmit')}
              </button>
              <button type="button" className="button-secondary" onClick={closeDetail}>
                {t('cancel')}
              </button>
            </div>
          </form>
        </section>
      )}

      <section aria-labelledby="materials-queue-heading">
        <h2 id="materials-queue-heading">{t('queueHeading')}</h2>

        {snapshot === null ? (
          <p role="status">{t('loading')}</p>
        ) : (
          <>
            <p className="page-summary" role="status">
              {t('summary', {
                decide: waiting.decide,
                order: waiting.order,
                deliver: waiting.deliver,
              })}
            </p>

            {unpriced > 0 ? (
              <p className="notice">
                {t('unpricedWarning', { unpriced })} <Link href={PL_PATH}>{t('plLink')}</Link>
              </p>
            ) : null}

            {truncated ? (
              <p className="notice">{t('truncated', { limit: snapshot.material_request_limit })}</p>
            ) : null}

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
              </select>
              <p className="field-hint" id={filterHintId}>
                {t('filterHint')}
              </p>
            </div>

            {visible.length === 0 ? (
              /* Empty is NOT an error and must never read as one. Which empty it is
                 matters: an empty queue is the good day, an empty history is a feature
                 nobody has used yet, and neither is data loss. */
              <div className="notice">
                <p>{filter === 'open' ? t('emptyOpen') : t('emptyAll')}</p>
                {filter === 'open' && requests.length > 0 ? (
                  <p className="form-actions">
                    <button
                      type="button"
                      className="button-secondary"
                      onClick={() => setFilter('all')}
                    >
                      {t('emptyShowAll', { total: requests.length })}
                    </button>
                  </p>
                ) : null}
              </div>
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
                    return (
                      <tr
                        key={request.id}
                        className={stage === 'decide' ? 'row-attention' : undefined}
                      >
                        <th scope="row">
                          {request.worker_name}
                          <span className="shift-state-note">
                            {t('askedAt', { when: dayTime(request.created_at) })}
                          </span>
                        </th>
                        <td>
                          {/* The worker's own words, verbatim and quoted so it is obvious
                              they are not ours. */}
                          <q>{request.body}</q>
                          <span className="shift-state-note">
                            {request.location_name === null
                              ? t('noLocationNamed')
                              : t('locationNamed', { name: request.location_name })}
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
                        </td>
                        {/* Text, not colour: this survives greyscale and a screen reader. */}
                        <td>
                          <span className={`shift-state material-stage-${stage}`}>
                            {stageLabel[stage]}
                          </span>
                          <span className="shift-state-note">{timeline(request)}</span>
                        </td>
                        <td className="col-numeric">
                          {request.cost_cents === null ? (
                            <span className={isUnpriced(request) ? undefined : 'cell-muted'}>
                              {isUnpriced(request) ? t('costMissing') : t('costNotYet')}
                            </span>
                          ) : (
                            money(request.cost_cents)
                          )}
                        </td>
                        <td className="cell-actions">
                          {nextStatuses(request.status).map((status) => (
                            <button
                              key={status}
                              type="button"
                              className={
                                status === 'rejected' ? 'button-secondary' : 'button-primary'
                              }
                              disabled={busy}
                              onClick={() => advance(request, status)}
                            >
                              {actionLabel[status]}
                              <span className="visually-hidden">
                                {t('forRequest', { worker: request.worker_name })}
                              </span>
                            </button>
                          ))}
                          <button
                            type="button"
                            className="button-secondary"
                            onClick={() => openDetail(request)}
                          >
                            {t('detailOpen')}
                            <span className="visually-hidden">
                              {t('forRequest', { worker: request.worker_name })}
                            </span>
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </>
        )}
      </section>
    </>
  )
}
