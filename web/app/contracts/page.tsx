'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useFormatter, useLocale, useTranslations } from 'next-intl'
import { type FormEvent, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
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
import { type ErrorKey, htmlLang, isLocale } from '@/lib/locale'
import { parseEuroToCents } from '@/lib/money'
import { LOGIN_PATH } from '@/lib/nav'
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
  const tError = useTranslations('error')
  const format = useFormatter()
  const locale = useLocale()
  const router = useRouter()

  const buildingId = useId()
  const validFromId = useId()
  const validFromHintId = useId()
  const monthlyId = useId()
  const monthlyHintId = useId()
  const targetId = useId()
  const targetHintId = useId()
  const clientId = useId()
  const clientHintId = useId()
  const noteId = useId()
  const noteHintId = useId()
  const panelHeadingId = useId()
  const panelRef = useRef<HTMLElement>(null)

  const [snapshot, setSnapshot] = useState<ClientsSnapshot | null>(null)
  const [loadError, setLoadError] = useState<ErrorKey | null>(null)
  /** '' = nothing selected; the buildings table is then the whole page. */
  const [selected, setSelected] = useState('')
  // null = the history for `selected` is still loading. [] = a building with no price ever.
  const [contracts, setContracts] = useState<Contract[] | null>(null)
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<ErrorMessage | null>(null)
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)
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

  function select(locationId: string) {
    setSelected(locationId)
    // Prefill the payer with the building's CURRENT client, which is what the server would
    // default to anyway. Doing it here means the select shows the real answer instead of
    // "none on file", which a director would read as "this period has no payer" and
    // "correct" by saving — turning a default into an explicit null.
    const next = locations.find((location) => location.id === locationId) ?? null
    setDraft({
      ...EMPTY_DRAFT,
      clientId: next?.client_id === null || next === null ? '' : String(next.client_id),
    })
    setFieldErrors({})
    setFormError(null)
    setNotice(null)
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || building === null) return

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
      setNotice({
        ok: true,
        text: t('created', {
          building: building.name,
          from: dayFormat.format(new Date(`${validFrom}T12:00:00Z`)),
        }),
      })
      setDraft(EMPTY_DRAFT)
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
      setNotice({ ok: true, text: t('deleted', { building: building.name }) })
      await loadContracts(building.id)
      await load()
    } catch (cause) {
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
      <h1>{t('heading')}</h1>
      <p className="lede">{t('intro')}</p>

      <div className="callout">
        <h2>{t('standingHeading')}</h2>
        <ul>
          {/* decision-28, permanently on screen. Half the point of this page is revenue
              history; the other half is that labour history still does not exist. */}
          <li>{t('noteRevenueHistory')}</li>
          <li>{t('noteLabourNoHistory')}</li>
          <li>{t('noteDates')}</li>
          <li>
            {t('noteMirror')} <Link href={BUILDINGS_PATH}>{t('noteMirrorLink')}</Link>
          </li>
        </ul>
      </div>

      {loadError !== null ? (
        <p className="form-error" role="alert">
          {tError(loadError)}
        </p>
      ) : null}

      <p className={notice?.ok === false ? 'form-error' : 'form-status'} role="status">
        {notice === null ? '' : notice.text}
      </p>

      <section aria-labelledby="contracts-buildings-heading">
        <h2 id="contracts-buildings-heading">{t('buildingsHeading')}</h2>

        {snapshot === null ? (
          <p role="status">{t('loading')}</p>
        ) : locations.length === 0 ? (
          <div className="notice">
            <p>{t('noBuildings')}</p>
            <p>
              <Link href={BUILDINGS_PATH}>{t('noBuildingsLink')}</Link>
            </p>
          </div>
        ) : (
          <>
            {/* A select AND the table below it: the table is how a director spots the
                building with no price at all, the select is how they get to one of forty
                without scrolling. Both drive the same state. */}
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
                        ? 'row-attention'
                        : location.active
                          ? undefined
                          : 'row-inactive'
                    }
                  >
                    <th scope="row">
                      {location.name}
                      {location.active ? null : (
                        <span className="shift-state-note">{t('buildingInactive')}</span>
                      )}
                    </th>
                    <td>
                      {location.client_name ?? <span className="cell-muted">{t('noClient')}</span>}
                    </td>
                    <td className="col-numeric">
                      {location.monthly_contract_cents === null ? (
                        <span className="cell-muted">{t('noPrice')}</span>
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
                        className="button-secondary"
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
          </>
        )}
      </section>

      {building === null ? null : (
        <section
          aria-labelledby={panelHeadingId}
          ref={panelRef}
          tabIndex={-1}
          className="contract-panel"
        >
          <h2 id={panelHeadingId}>{t('panelHeading', { name: building.name })}</h2>

          {contracts === null ? (
            <p role="status">{t('historyLoading')}</p>
          ) : contracts.length === 0 ? (
            /* Not an error, and not data loss: a building nobody has priced yet. The P&L
               reports its revenue as UNKNOWN, which is why this sentence says what follows
               rather than just "empty". */
            <div className="notice">
              <p>{t('historyEmpty', { name: building.name })}</p>
              <p>
                {t('historyEmptyConsequence')} <Link href={PL_PATH}>{t('historyEmptyLink')}</Link>
              </p>
            </div>
          ) : (
            <table className="data-table">
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
                  <tr key={contract.id}>
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
                          className="button-secondary"
                          disabled={busy}
                          onClick={() => removeCurrent(contract)}
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

          <h3>{t('newHeading')}</h3>
          <p>
            {current === null
              ? t('newIntroFirst')
              : t('newIntroReplaces', {
                  amount: money(current.monthly_contract_cents),
                  from: day(current.valid_from),
                })}
          </p>

          <form className="worker-form" onSubmit={submit} noValidate>
            <p className="form-error" role="alert">
              {formError === null ? '' : t(formError)}
            </p>

            <div className="field">
              <label htmlFor={validFromId}>{t('fieldValidFrom')}</label>
              <input
                id={validFromId}
                type="date"
                value={draft.validFrom}
                aria-describedby={`${validFromHintId} ${validFromId}-error`}
                aria-invalid={fieldErrors.validFrom !== undefined}
                disabled={busy}
                onChange={(event) => setDraft({ ...draft, validFrom: event.target.value })}
              />
              <p className="field-hint" id={validFromHintId}>
                {t('validFromHint')}
              </p>
              <p className="field-error" id={`${validFromId}-error`} role="alert">
                {fieldErrors.validFrom === undefined ? '' : t(fieldErrors.validFrom)}
              </p>
            </div>

            <div className="field">
              <label htmlFor={monthlyId}>{t('fieldMonthly')}</label>
              <input
                id={monthlyId}
                type="text"
                inputMode="decimal"
                value={draft.monthly}
                aria-describedby={`${monthlyHintId} ${monthlyId}-error`}
                aria-invalid={fieldErrors.monthly !== undefined}
                disabled={busy}
                onChange={(event) => setDraft({ ...draft, monthly: event.target.value })}
              />
              <p className="field-hint" id={monthlyHintId}>
                {t('monthlyHint')}
              </p>
              <p className="field-error" id={`${monthlyId}-error`} role="alert">
                {fieldErrors.monthly === undefined ? '' : t(fieldErrors.monthly)}
              </p>
            </div>

            <div className="field">
              <label htmlFor={targetId}>{t('fieldTarget')}</label>
              <input
                id={targetId}
                type="text"
                inputMode="numeric"
                value={draft.targetHours}
                aria-describedby={`${targetHintId} ${targetId}-error`}
                aria-invalid={fieldErrors.targetHours !== undefined}
                disabled={busy}
                onChange={(event) => setDraft({ ...draft, targetHours: event.target.value })}
              />
              <p className="field-hint" id={targetHintId}>
                {t('targetHint')}
              </p>
              <p className="field-error" id={`${targetId}-error`} role="alert">
                {fieldErrors.targetHours === undefined ? '' : t(fieldErrors.targetHours)}
              </p>
            </div>

            <div className="field">
              <label htmlFor={clientId}>{t('fieldClient')}</label>
              <select
                id={clientId}
                value={draft.clientId}
                aria-describedby={clientHintId}
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
              <p className="field-hint" id={clientHintId}>
                {t('clientHint')}
              </p>
            </div>

            <div className="field">
              <label htmlFor={noteId}>{t('fieldNote')}</label>
              <input
                id={noteId}
                type="text"
                maxLength={500}
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
                {busy ? t('submitting') : t('submitCreate')}
              </button>
              <button type="button" className="button-secondary" onClick={() => select('')}>
                {t('close')}
              </button>
            </div>
          </form>
        </section>
      )}
    </>
  )
}
