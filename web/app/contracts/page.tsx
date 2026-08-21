'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useFormatter, useLocale, useTranslations } from 'next-intl'
import { type FormEvent, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { ConfirmModal } from '@/components/ConfirmModal'
import { Drawer } from '@/components/Drawer'
import { EmptyState } from '@/components/EmptyState'
import { Field } from '@/components/Field'
import { ListPanel } from '@/components/ListPanel'
import { PageHeader } from '@/components/PageHeader'
import { StateBadge } from '@/components/StateBadge'
import {
  ApiError,
  type ClientsSnapshot,
  type Contract,
  type ContractInput,
  createContract,
  deleteContract,
  fetchClientsSnapshot,
  fetchContracts,
} from '@/lib/api'
import { useFilters } from '@/lib/filters'
import { type ErrorKey, htmlLang, isLocale } from '@/lib/locale'
import { parseEuroToCents } from '@/lib/money'
import { loginPathWithReturn } from '@/lib/nav'
import { BUSINESS_TIME_ZONE, formatDuration } from '@/lib/shifts'

/**
 * Contract management — what a building was priced at, WHEN.
 *
 * WHY IT EXISTS. `locations.monthly_contract_cents` is a single mutable number, so raising
 * a price in September used to silently rewrite every earlier month's revenue: a March P&L
 * printed in October did not match the March P&L printed in April, and nothing said why.
 * A period-scoped row means March is valued at the March price for ever.
 *
 * WHAT IT DOES NOT FIX, and this notice is permanent on this screen rather than a release
 * note: labour. `workers.hourly_rate_cents` is still one mutable column with no history, so
 * raising a wage still rewrites what every past month appears to have COST. Revenue is
 * period-correct; cost is not. That is decision-28, deliberately: fixing it means a
 * `worker_rates` table that PAYROLL reads, i.e. changing the arithmetic of a system in
 * daily use with real money attached.
 *
 * DATES ARE VIENNA CALENDAR DAYS, half-open `[valid_from, valid_to)`. A contract changes on
 * a day, not at an instant, and a date has no daylight saving to get wrong. The last day of
 * the old price is the day BEFORE the new one starts, and the table says so in words rather
 * than making the director work it out from an exclusive bound.
 *
 * DELETING is only ever the CURRENT period, and it reopens its predecessor. A closed period
 * has already valued a month somebody has seen a report for; removing it would rewrite that
 * month with no trace. The server enforces this — the button is simply not drawn elsewhere.
 *
 * REDESIGN: both tables READ. The create form moved into a drawer and the undo behind a
 * confirmation, because it is the one write here that cannot be taken back. The HISTORY
 * stays on the page rather than becoming a drawer: it is six columns wide, a drawer is
 * 440px, and it is the thing you read WHILE deciding what the next period should be.
 */

const BUILDINGS_PATH = '/locations/'
const PL_PATH = '/pl/'

/** `YYYY-MM-DD`, what `<input type="date">` produces and what the API takes. */
const ISO_DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/

/**
 * A real calendar day, not merely a well-shaped one. The regex above happily accepts
 * `2026-02-31`, and `new Date` rolls that forward to 2 March rather than answering NaN —
 * so without the round trip a contract silently starts on a day the director never typed.
 * Mirrors `isoDate` in server/lib/validate.js, which is the authority.
 */
function isCalendarDate(value: string): boolean {
  if (!ISO_DATE_RE.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

type Draft = {
  validFrom: string
  /** Euros as typed. Converted to integer cents at submit, never held as a float. */
  monthly: string
  /** WHOLE HOURS per month, as on /locations/. Stored as minutes. */
  targetHours: string
  /** Client id as a select value; '' = none on file for this period. */
  clientId: string
  note: string
}

const EMPTY_DRAFT: Draft = {
  validFrom: '',
  monthly: '',
  targetHours: '',
  clientId: '',
  note: '',
}

type ErrorMessage =
  | 'errorDateRequired'
  | 'errorDateShape'
  | 'errorMonthlyInvalid'
  | 'errorTargetInvalid'
  | 'errorOverlap'
  | 'errorNotCurrent'
  | 'errorRejected'

type FieldErrors = { validFrom?: ErrorMessage; monthly?: ErrorMessage; targetHours?: ErrorMessage }

export default function ContractsPage() {
  const t = useTranslations('contracts')
  const tFilter = useTranslations('filters')
  const tError = useTranslations('error')
  const format = useFormatter()
  const locale = useLocale()
  const router = useRouter()

  const buildingId = useId()
  const formId = useId()
  const validFromId = useId()
  const monthlyId = useId()
  const targetId = useId()
  const clientId = useId()
  const noteId = useId()
  const panelRef = useRef<HTMLDivElement>(null)

  const [snapshot, setSnapshot] = useState<ClientsSnapshot | null>(null)
  const [loadError, setLoadError] = useState<ErrorKey | null>(null)
  /** '' = nothing selected; the buildings table is then the whole page. */
  const [selected, setSelected] = useState('')
  // null = the history for `selected` is still loading. [] = a building with no price ever.
  const [contracts, setContracts] = useState<Contract[] | null>(null)
  /** null = the drawer is closed. There is no other "is the form open" flag. */
  const [draft, setDraft] = useState<Draft | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<ErrorMessage | null>(null)
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)
  /** The period about to be removed. The only irreversible write on this screen. */
  const [confirming, setConfirming] = useState<Contract | null>(null)
  const [busy, setBusy] = useState(false)

  /** Austrian month names — see /payroll/ for why `htmlLang` and not the message key. */
  const dayFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(htmlLang(isLocale(locale) ? locale : 'de'), {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: BUSINESS_TIME_ZONE,
      }),
    [locale],
  )

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
        setSnapshot(await fetchClientsSnapshot(signal))
        setLoadError(null)
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === 'AbortError') return
        if (handleAuthLoss(cause)) return
        setLoadError(cause instanceof ApiError ? cause.messageKey : 'server')
      }
    },
    [handleAuthLoss],
  )

  const loadContracts = useCallback(
    async (locationId: string, signal?: AbortSignal) => {
      try {
        setContracts(await fetchContracts(locationId, signal))
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

  useEffect(() => {
    if (selected === '') {
      setContracts(null)
      return
    }
    const controller = new AbortController()
    setContracts(null)
    void loadContracts(selected, controller.signal)
    return () => controller.abort()
  }, [selected, loadContracts])

  // The panel renders BELOW the buildings table and replaces the page's centre of gravity.
  // Focus follows it so a keyboard user is not left on a row button somewhere above.
  useEffect(() => {
    if (selected !== '') panelRef.current?.focus()
  }, [selected])

  const locations = snapshot?.locations ?? []
  const clients = snapshot?.clients ?? []
  const building = locations.find((location) => location.id === selected) ?? null
  const current = contracts?.find((contract) => contract.valid_to === null) ?? null

  /**
   * `?location=<uuid>` — pre-select the building (decision-38). `/contracts/` left the
   * sidebar (decision-39) and is now reached from the object that needs it: the Objektpanel,
   * a flagged row on `/pl/`, the contract cell on `/locations/` and the analytics panel.
   * Every one of them names a building, so arriving at an empty select would throw the
   * context away and make the director find it again in a list of forty.
   *
   * Applied ONCE per id: re-applying would fight the select the moment somebody used it.
   */
  const [filters, setFilters] = useFilters()
  const [preselectedFor, setPreselectedFor] = useState<string | null>(null)
  useEffect(() => {
    if (filters.location === null || filters.location === preselectedFor) return
    setPreselectedFor(filters.location)
    setSelected(filters.location)
  }, [filters.location, preselectedFor])

  /** A well-formed building id that is in no row here. Said, never silently ignored. */
  const preselectUnknown =
    filters.location !== null &&
    snapshot !== null &&
    !locations.some((location) => location.id === filters.location)

  function select(locationId: string) {
    setSelected(locationId)
    setDraft(null)
    setFieldErrors({})
    setFormError(null)
    setNotice(null)
    // Keep the URL and the selection in step, so a chosen building is linkable too.
    // 'replace': this is a control on the screen you are already on.
    setFilters({ location: locationId === '' ? null : locationId }, 'replace')
  }

  /**
   * Prefill the payer with the building's CURRENT client, which is what the server would
   * default to anyway. Doing it here means the select shows the real answer instead of
   * "none on file", which a director would read as "this period has no payer" and
   * "correct" by saving — turning a default into an explicit null.
   */
  function openDrawer() {
    if (building === null) return
    setDraft({
      ...EMPTY_DRAFT,
      clientId: building.client_id === null ? '' : String(building.client_id),
    })
    setFieldErrors({})
    setFormError(null)
    setNotice(null)
  }

  function closeDrawer() {
    setDraft(null)
    setFieldErrors({})
    setFormError(null)
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || building === null || draft === null) return

    const validFrom = draft.validFrom.trim()
    const monthlyText = draft.monthly.trim()
    const targetText = draft.targetHours.trim()

    const errors: FieldErrors = {}
    if (validFrom === '') errors.validFrom = 'errorDateRequired'
    else if (!isCalendarDate(validFrom)) errors.validFrom = 'errorDateShape'

    const cents = parseEuroToCents(monthlyText)
    if (cents === null) errors.monthly = 'errorMonthlyInvalid'

    const hours = targetText === '' ? null : Number(targetText)
    if (targetText !== '' && (hours === null || !Number.isSafeInteger(hours) || hours < 0)) {
      errors.targetHours = 'errorTargetInvalid'
    }

    setFieldErrors(errors)
    setFormError(null)
    if (Object.keys(errors).length > 0 || cents === null) return

    const input: ContractInput = {
      monthly_contract_cents: cents,
      target_minutes_per_month: hours === null ? null : hours * 60,
      valid_from: validFrom,
      note: draft.note.trim(),
      // Who was paying AT THE TIME. Defaults to the building's current client because that
      // is nearly always right, and is overridable because a handover is exactly when a
      // new contract period gets recorded.
      client_id: draft.clientId === '' ? null : Number(draft.clientId),
    }

    setBusy(true)
    try {
      await createContract(building.id, input)
      // The drawer closes on success, so the outcome is announced by the page's own live
      // region rather than by something that is no longer on screen to read.
      setNotice({
        ok: true,
        text: t('created', {
          building: building.name,
          from: dayFormat.format(new Date(`${validFrom}T12:00:00Z`)),
        }),
      })
      setDraft(null)
      await loadContracts(building.id)
      // The buildings table shows the mirrored current price, so it is stale now too.
      await load()
    } catch (cause) {
      if (handleAuthLoss(cause)) return
      // The only 409 this route raises is an overlapping period — the server refusing to
      // let "the price on 3 March" have two answers.
      setFormError(
        cause instanceof ApiError && cause.status === 409 ? 'errorOverlap' : 'errorRejected',
      )
      if (cause instanceof ApiError && cause.status === 409) {
        setFieldErrors({ validFrom: 'errorOverlap' })
      }
    } finally {
      setBusy(false)
    }
  }

  async function removeCurrent(contract: Contract) {
    if (busy || building === null) return
    setBusy(true)
    setNotice(null)
    setFormError(null)
    try {
      await deleteContract(contract.id)
      setConfirming(null)
      setNotice({ ok: true, text: t('deleted', { building: building.name }) })
      await loadContracts(building.id)
      await load()
    } catch (cause) {
      setConfirming(null)
      if (handleAuthLoss(cause)) return
      setNotice({
        ok: false,
        text:
          cause instanceof ApiError && cause.status === 409
            ? t('errorNotCurrent')
            : t('errorRejected'),
      })
    } finally {
      setBusy(false)
    }
  }

  const money = (cents: number) =>
    format.number(cents / 100, { style: 'currency', currency: 'EUR' })
  /** A `YYYY-MM-DD` calendar date, read at midday so no zone can move it onto another day. */
  const day = (date: string) => dayFormat.format(new Date(`${date}T12:00:00Z`))
  /** The last day the OLD price applied: `valid_to` is exclusive. */
  const dayBefore = (date: string) =>
    dayFormat.format(new Date(new Date(`${date}T12:00:00Z`).getTime() - 86_400_000))

  return (
    <>
      <PageHeader title={t('heading')} question={t('question')} />

      {/* Permanent live regions: a text change inside an existing region is announced far
          more reliably than a node that appears and disappears. */}
      <p className="form-error" role="alert">
        {loadError === null ? '' : tError(loadError)}
      </p>
      <p className={notice?.ok === false ? 'form-error' : 'form-status'} role="status">
        {notice === null ? '' : notice.text}
      </p>

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
        <p className="empty-state" role="status">
          {loadError === null ? t('loading') : tError(loadError)}
        </p>
      ) : locations.length === 0 ? (
        <EmptyState>
          {t('noBuildings')} <Link href={BUILDINGS_PATH}>{t('noBuildingsLink')}</Link>
        </EmptyState>
      ) : (
        <>
          {/* Arriving pre-selected is the point of the link; saying so is what stops it
              reading as a screen that remembered something it should not have. */}
          {filters.location !== null && !preselectUnknown ? (
            <p className="notice">{t('preselected')}</p>
          ) : null}
          {preselectUnknown ? <p className="notice bad">{tFilter('unknownNotice')}</p> : null}

          {/* A select AND the table below it: the table is how a director spots the building
              with no price at all, the select is how they get to one of forty without
              scrolling. Both drive the same state. */}
          <div className="field toolbar-field">
            <label htmlFor={buildingId}>{t('fieldBuilding')}</label>
            <select
              id={buildingId}
              value={selected}
              onChange={(event) => select(event.target.value)}
            >
              <option value="">{t('buildingNone')}</option>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.active ? location.name : t('optionInactive', { name: location.name })}
                </option>
              ))}
            </select>
          </div>

          <ListPanel title={t('buildingsHeading')}>
            <table className="data-table">
              <caption className="visually-hidden">{t('buildingsCaption')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('colBuilding')}</th>
                  <th scope="col">{t('colClient')}</th>
                  <th scope="col" className="col-numeric">
                    {t('colCurrentPrice')}
                  </th>
                  <th scope="col" className="col-numeric">
                    {t('colTarget')}
                  </th>
                  <th scope="col">{t('colActions')}</th>
                </tr>
              </thead>
              <tbody>
                {locations.map((location) => (
                  <tr
                    key={location.id}
                    className={
                      location.monthly_contract_cents === null && location.active
                        ? 'is-unres'
                        : location.active
                          ? undefined
                          : 'is-muted'
                    }
                  >
                    <th scope="row">
                      {location.name}{' '}
                      {location.active ? null : (
                        <StateBadge state="muted" label={t('buildingInactive')} />
                      )}
                    </th>
                    <td>
                      {location.client_name ?? <span className="cell-muted">{t('noClient')}</span>}
                    </td>
                    <td className="col-numeric">
                      {/* The word first, the tint second: a building nobody has priced is not
                          a building priced at zero, and greyscale must still say so. */}
                      {location.monthly_contract_cents === null ? (
                        <StateBadge state="unres" label={t('noPrice')} />
                      ) : (
                        money(location.monthly_contract_cents)
                      )}
                    </td>
                    <td className="col-numeric">
                      {location.target_minutes_per_month === null ? (
                        <span className="cell-muted">{t('noTarget')}</span>
                      ) : (
                        formatDuration(location.target_minutes_per_month)
                      )}
                    </td>
                    <td className="cell-actions">
                      <button
                        type="button"
                        className="btn btn-quiet"
                        aria-pressed={selected === location.id}
                        onClick={() => select(location.id)}
                      >
                        {t('openHistory')}
                        <span className="visually-hidden">
                          {t('forBuilding', { name: location.name })}
                        </span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ListPanel>
        </>
      )}

      {/* decision-28, permanently on screen. Half the point of this page is revenue history;
          the other half is that labour history still does not exist. All four sentences
          survive verbatim — MOVED below the table and typeset small, never fewer of them.
          Above the table they filled the whole first screen of a phone, so the answer to the
          screen's own question was two scrolls down. */}
      <div className="callout">
        <h2>{t('standingHeading')}</h2>
        <ul>
          <li>{t('noteRevenueHistory')}</li>
          <li>{t('noteLabourNoHistory')}</li>
          <li>{t('noteDates')}</li>
          <li>
            {t('noteMirror')} <Link href={BUILDINGS_PATH}>{t('noteMirrorLink')}</Link>
          </li>
        </ul>
      </div>

      {building === null ? null : (
        // tabIndex -1 so the deliberate focus move above lands somewhere real: the panel is
        // below the table and is the new centre of gravity, and a keyboard user who picked a
        // building from the select must not be left forty rows above what they just opened.
        <div ref={panelRef} tabIndex={-1}>
          <ListPanel
            title={t('panelHeading', { name: building.name })}
            action={
              <>
                <button type="button" className="btn btn-primary" onClick={openDrawer}>
                  {t('newHeading')}
                </button>
                <button type="button" className="btn btn-quiet" onClick={() => select('')}>
                  {t('close')}
                </button>
              </>
            }
          >
            {contracts === null ? (
              <p className="empty-state" role="status">
                {t('historyLoading')}
              </p>
            ) : contracts.length === 0 ? (
              /* Not an error, and not data loss: a building nobody has priced yet. The P&L
                 reports its revenue as UNKNOWN, which is why this sentence says what follows
                 rather than just "empty". */
              <EmptyState>
                {t('historyEmpty', { name: building.name })} {t('historyEmptyConsequence')}{' '}
                <Link href={PL_PATH}>{t('historyEmptyLink')}</Link>
              </EmptyState>
            ) : (
              <table className="data-table" aria-busy={busy}>
                <caption className="visually-hidden">
                  {t('historyCaption', { name: building.name })}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">{t('colPeriod')}</th>
                    <th scope="col" className="col-numeric">
                      {t('colMonthly')}
                    </th>
                    <th scope="col" className="col-numeric">
                      {t('colTarget')}
                    </th>
                    <th scope="col">{t('colPayer')}</th>
                    <th scope="col">{t('colNote')}</th>
                    <th scope="col">{t('colActions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {contracts.map((contract) => (
                    <tr
                      key={contract.id}
                      className={contract.valid_to === null ? 'is-open' : undefined}
                    >
                      <th scope="row">
                        {contract.valid_to === null
                          ? t('periodCurrent', { from: day(contract.valid_from) })
                          : t('periodClosed', {
                              from: day(contract.valid_from),
                              to: dayBefore(contract.valid_to),
                            })}
                      </th>
                      <td className="col-numeric">{money(contract.monthly_contract_cents)}</td>
                      <td className="col-numeric">
                        {contract.target_minutes_per_month === null ? (
                          <span className="cell-muted">{t('noTarget')}</span>
                        ) : (
                          formatDuration(contract.target_minutes_per_month)
                        )}
                      </td>
                      <td>
                        {clients.find((client) => client.id === contract.client_id)?.name ?? (
                          <span className="cell-muted">{t('noClient')}</span>
                        )}
                      </td>
                      <td>
                        {contract.note === null ? (
                          <span className="cell-muted">{t('noNote')}</span>
                        ) : (
                          contract.note
                        )}
                      </td>
                      <td className="cell-actions">
                        {contract.valid_to === null ? (
                          <button
                            type="button"
                            className="btn btn-quiet"
                            disabled={busy}
                            onClick={() => setConfirming(contract)}
                          >
                            {t('undo')}
                            <span className="visually-hidden">
                              {t('forPeriod', { from: day(contract.valid_from) })}
                            </span>
                          </button>
                        ) : (
                          <span className="cell-muted">{t('closedNoUndo')}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </ListPanel>
        </div>
      )}

      <Drawer
        open={draft !== null && building !== null}
        onClose={closeDrawer}
        title={t('newHeading')}
        step={building?.name}
        busy={busy}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={closeDrawer}>
              {t('close')}
            </button>
            <button type="submit" form={formId} className="btn btn-primary" disabled={busy}>
              {busy ? t('submitting') : t('submitCreate')}
            </button>
          </>
        }
      >
        {draft === null ? null : (
          <form id={formId} onSubmit={submit} noValidate>
            {/* What this period replaces, said before it is typed rather than after it is
                saved: the current price ends the day before the new one starts. */}
            <p className="note">
              {current === null
                ? t('newIntroFirst')
                : t('newIntroReplaces', {
                    amount: money(current.monthly_contract_cents),
                    from: day(current.valid_from),
                  })}
            </p>

            {/* The drawer stays open when the server refuses, so the refusal stays with it. */}
            <p className="form-error" role="alert">
              {formError === null ? '' : t(formError)}
            </p>

            <Field
              id={validFromId}
              label={t('fieldValidFrom')}
              required
              help={t('validFromHint')}
              error={fieldErrors.validFrom === undefined ? null : t(fieldErrors.validFrom)}
            >
              <input
                type="date"
                required
                value={draft.validFrom}
                disabled={busy}
                onChange={(event) => setDraft({ ...draft, validFrom: event.target.value })}
              />
            </Field>

            <Field
              id={monthlyId}
              label={t('fieldMonthly')}
              required
              help={t('monthlyHint')}
              error={fieldErrors.monthly === undefined ? null : t(fieldErrors.monthly)}
            >
              <input
                type="text"
                inputMode="decimal"
                required
                value={draft.monthly}
                disabled={busy}
                onChange={(event) => setDraft({ ...draft, monthly: event.target.value })}
              />
            </Field>

            <Field
              id={targetId}
              label={t('fieldTarget')}
              optional
              help={t('targetHint')}
              error={fieldErrors.targetHours === undefined ? null : t(fieldErrors.targetHours)}
            >
              <input
                type="text"
                inputMode="numeric"
                value={draft.targetHours}
                disabled={busy}
                onChange={(event) => setDraft({ ...draft, targetHours: event.target.value })}
              />
            </Field>

            <Field id={clientId} label={t('fieldClient')} help={t('clientHint')}>
              <select
                value={draft.clientId}
                disabled={busy}
                onChange={(event) => setDraft({ ...draft, clientId: event.target.value })}
              >
                <option value="">{t('clientNone')}</option>
                {clients.map((client) => (
                  <option key={client.id} value={String(client.id)}>
                    {client.active ? client.name : t('optionInactive', { name: client.name })}
                  </option>
                ))}
              </select>
            </Field>

            <Field id={noteId} label={t('fieldNote')} optional help={t('noteHint')}>
              <input
                type="text"
                maxLength={500}
                value={draft.note}
                disabled={busy}
                onChange={(event) => setDraft({ ...draft, note: event.target.value })}
              />
            </Field>
          </form>
        )}
      </Drawer>

      {/* The one irreversible write on this screen. The server refuses it for a closed
          period, which is why the button that opens this is only drawn on the current one. */}
      <ConfirmModal
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        onConfirm={() => {
          if (confirming !== null) void removeCurrent(confirming)
        }}
        title={t('confirmUndoTitle', {
          from: confirming === null ? '' : day(confirming.valid_from),
        })}
        body={t('confirmUndoBody')}
        confirmLabel={t('undo')}
        destructive
        busy={busy}
      />
    </>
  )
}
