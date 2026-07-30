'use client'

import { useRouter } from 'next/navigation'
import { useFormatter, useTranslations } from 'next-intl'
import { type FormEvent, useCallback, useEffect, useId, useRef, useState } from 'react'
import {
  ApiError,
  fetchInventory,
  INVENTORY_KINDS,
  type InventoryItem,
  type InventoryKind,
  isInventoryKind,
  saveInventoryItem,
} from '@/lib/api'
import type { ErrorKey } from '@/lib/locale'
import { centsToPlainEuros, parseEuroToCents } from '@/lib/money'
import { LOGIN_PATH } from '@/lib/nav'

/**
 * Inventory — the cleaning products and the equipment, with what each one costs.
 *
 * ONE screen for both, because they differ by one word: a mop and a bottle of degreaser are
 * both a name and a price, and splitting them would mean a director hunting through two
 * lists to answer one question. The type is a control on the row, not a navigation choice.
 *
 * Cost is typed in euros and stored as integer cents (`parseEuroToCents`). This is the price
 * of ONE unit; consumption per building is not tracked in this version, so nothing here
 * feeds payroll yet — decision-6 will divide these costs pro-rata by labour hours when the
 * material-request screen exists.
 */

type Draft = {
  /** Absent = create. Present = update that row. */
  id?: number
  name: string
  kind: InventoryKind
  /** Euros as typed. Converted to integer cents at submit, never held as a float. */
  cost: string
  active: boolean
}

const EMPTY_DRAFT: Draft = { name: '', kind: 'product', cost: '', active: true }

function draftOf(item: InventoryItem): Draft {
  return {
    id: item.id,
    name: item.name,
    kind: item.kind,
    cost: centsToPlainEuros(item.unit_cost_cents),
    active: item.active,
  }
}

/** Message keys inside the `inventory` namespace, so field errors stay translatable. */
type ErrorMessage = 'errorNameRequired' | 'errorCostInvalid' | 'errorGone' | 'errorRejected'

type FieldErrors = { name?: ErrorMessage; cost?: ErrorMessage }

export default function InventoryPage() {
  const t = useTranslations('inventory')
  const tError = useTranslations('error')
  const format = useFormatter()
  const router = useRouter()

  const nameId = useId()
  const kindId = useId()
  const kindHintId = useId()
  const costId = useId()
  const costHintId = useId()
  const activeId = useId()
  const errorId = useId()
  const statusId = useId()
  const formHeadingId = useId()
  const nameRef = useRef<HTMLInputElement>(null)

  // null = still loading. [] = loaded and genuinely empty, which is the first-run state.
  const [items, setItems] = useState<InventoryItem[] | null>(null)
  const [loadError, setLoadError] = useState<ErrorKey | null>(null)
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<ErrorMessage | null>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  /** A dead session must not render an empty table that looks like "nothing in stock". */
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
        setItems(await fetchInventory(signal))
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

  function editItem(item: InventoryItem) {
    setDraft(draftOf(item))
    setFieldErrors({})
    setFormError(null)
    setSaved(false)
    nameRef.current?.focus()
  }

  function cancelEdit() {
    setDraft(EMPTY_DRAFT)
    setFieldErrors({})
    setFormError(null)
    nameRef.current?.focus()
  }

  function reportSaveFailure(cause: unknown) {
    if (handleAuthLoss(cause)) return
    if (cause instanceof ApiError && cause.status === 404) {
      setFormError('errorGone')
      return
    }
    if (cause instanceof ApiError && cause.status >= 400 && cause.status < 500) {
      setFormError('errorRejected')
      return
    }
    setFormError(null)
    setLoadError(cause instanceof ApiError ? cause.messageKey : 'server')
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return

    const name = draft.name.trim()
    // Empty is allowed and means 0 = "not priced yet", which is a real answer the server
    // stores as such. A typo is not: it must not silently become zero.
    const cost = draft.cost.trim() === '' ? 0 : parseEuroToCents(draft.cost)

    // Client-side validation is UX only — server/lib/validate.js decides for real.
    const errors: FieldErrors = {}
    if (name === '') errors.name = 'errorNameRequired'
    if (cost === null) errors.cost = 'errorCostInvalid'
    setFieldErrors(errors)
    setFormError(null)
    setSaved(false)
    if (Object.keys(errors).length > 0 || cost === null) return

    setBusy(true)
    try {
      await saveInventoryItem({
        ...(draft.id === undefined ? {} : { id: draft.id }),
        name,
        kind: draft.kind,
        unit_cost_cents: cost,
        active: draft.active,
      })
      setDraft(EMPTY_DRAFT)
      setSaved(true)
      await load()
      // The submit button is disabled while saving, so focus would otherwise fall to
      // <body>. Put it back where the next item gets typed.
      nameRef.current?.focus()
    } catch (cause) {
      reportSaveFailure(cause)
    } finally {
      setBusy(false)
    }
  }

  /**
   * Soft delete / undo, through the same upsert route. Nothing is ever destroyed: a price
   * that was paid last month has to stay explicable next month.
   */
  async function toggleActive(item: InventoryItem) {
    if (busy) return
    setBusy(true)
    setSaved(false)
    setFormError(null)
    try {
      await saveInventoryItem({
        id: item.id,
        name: item.name,
        kind: item.kind,
        unit_cost_cents: item.unit_cost_cents,
        active: !item.active,
      })
      await load()
    } catch (cause) {
      reportSaveFailure(cause)
    } finally {
      setBusy(false)
    }
  }

  const kindLabel: Record<InventoryKind, string> = {
    product: t('kindProduct'),
    equipment: t('kindEquipment'),
  }

  const editing = draft.id !== undefined
  const formErrorText = formError === null ? '' : t(formError)

  return (
    <>
      <h1>{t('heading')}</h1>
      <p className="lede">{t('intro')}</p>

      <section aria-labelledby={formHeadingId}>
        <h2 id={formHeadingId}>{editing ? t('editHeading') : t('createHeading')}</h2>

        <form className="worker-form" onSubmit={onSubmit} noValidate>
          {/* Permanent live regions: a text change inside an existing region is announced
              far more reliably than a node that appears and disappears. */}
          <p className="form-error" id={errorId} role="alert">
            {formErrorText}
          </p>
          <p className="form-status" id={statusId} role="status">
            {saved ? t('saved') : ''}
          </p>

          <div className="field">
            <label htmlFor={nameId}>{t('fieldName')}</label>
            <input
              id={nameId}
              ref={nameRef}
              type="text"
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              maxLength={160}
              autoComplete="off"
              aria-describedby={`${nameId}-error`}
              aria-invalid={fieldErrors.name !== undefined}
              disabled={busy}
            />
            <p className="field-error" id={`${nameId}-error`} role="alert">
              {fieldErrors.name === undefined ? '' : t(fieldErrors.name)}
            </p>
          </div>

          <div className="field">
            <label htmlFor={kindId}>{t('fieldKind')}</label>
            <select
              id={kindId}
              value={draft.kind}
              onChange={(event) => {
                if (isInventoryKind(event.target.value)) {
                  setDraft({ ...draft, kind: event.target.value })
                }
              }}
              aria-describedby={kindHintId}
              disabled={busy}
            >
              {INVENTORY_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {kindLabel[kind]}
                </option>
              ))}
            </select>
            <p className="field-hint" id={kindHintId}>
              {t('kindHint')}
            </p>
          </div>

          <div className="field">
            <label htmlFor={costId}>{t('fieldCost')}</label>
            <input
              id={costId}
              type="text"
              inputMode="decimal"
              value={draft.cost}
              onChange={(event) => setDraft({ ...draft, cost: event.target.value })}
              aria-describedby={`${costHintId} ${costId}-error`}
              aria-invalid={fieldErrors.cost !== undefined}
              disabled={busy}
            />
            <p className="field-hint" id={costHintId}>
              {t('costHint')}
            </p>
            <p className="field-error" id={`${costId}-error`} role="alert">
              {fieldErrors.cost === undefined ? '' : t(fieldErrors.cost)}
            </p>
          </div>

          <div className="field field-check">
            <input
              id={activeId}
              type="checkbox"
              checked={draft.active}
              onChange={(event) => setDraft({ ...draft, active: event.target.checked })}
              disabled={busy}
            />
            <label htmlFor={activeId}>{t('fieldActive')}</label>
          </div>

          <div className="form-actions">
            <button type="submit" className="button-primary" disabled={busy}>
              {busy ? t('submitting') : editing ? t('submitSave') : t('submitCreate')}
            </button>
            {editing ? (
              <button type="button" className="button-secondary" onClick={cancelEdit}>
                {t('cancel')}
              </button>
            ) : null}
          </div>
        </form>
      </section>

      <section aria-labelledby="inventory-list-heading">
        <h2 id="inventory-list-heading">{t('listHeading')}</h2>

        {loadError !== null ? (
          <p className="form-error" role="alert">
            {tError(loadError)}
          </p>
        ) : null}

        {items === null ? (
          <p role="status">{t('loading')}</p>
        ) : items.length === 0 ? (
          <p>{t('emptyBody')}</p>
        ) : (
          <table className="data-table" aria-busy={busy}>
            <caption className="visually-hidden">{t('tableCaption')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('colName')}</th>
                <th scope="col">{t('colKind')}</th>
                <th scope="col">{t('colCost')}</th>
                <th scope="col">{t('colStatus')}</th>
                <th scope="col">{t('colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className={item.active ? undefined : 'row-inactive'}>
                  <th scope="row">{item.name}</th>
                  <td>{kindLabel[item.kind]}</td>
                  <td>
                    {/* 0 cents is "nobody has priced this yet", not "free". Saying EUR 0.00
                        would put a wrong number into a later cost calculation unchallenged. */}
                    {item.unit_cost_cents === 0 ? (
                      <span className="cell-muted">{t('noCost')}</span>
                    ) : (
                      format.number(item.unit_cost_cents / 100, {
                        style: 'currency',
                        currency: 'EUR',
                      })
                    )}
                  </td>
                  {/* Text, not a colour: the status has to survive greyscale and a screen reader. */}
                  <td>{item.active ? t('statusActive') : t('statusInactive')}</td>
                  <td className="cell-actions">
                    <button
                      type="button"
                      className="button-secondary"
                      onClick={() => editItem(item)}
                    >
                      {t('edit')}
                      <span className="visually-hidden">{t('forItem', { name: item.name })}</span>
                    </button>
                    <button
                      type="button"
                      className="button-secondary"
                      onClick={() => toggleActive(item)}
                    >
                      {item.active ? t('deactivate') : t('activate')}
                      <span className="visually-hidden">{t('forItem', { name: item.name })}</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  )
}
