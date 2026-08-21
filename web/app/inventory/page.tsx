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
  fetchInventory,
  INVENTORY_KINDS,
  type InventoryItem,
  type InventoryKind,
  isInventoryKind,
  saveInventoryItem,
} from '@/lib/api'
import type { ErrorKey } from '@/lib/locale'
import { centsToPlainEuros, parseEuroToCents } from '@/lib/money'
import { loginPathWithReturn } from '@/lib/nav'

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
 *
 * REDESIGN: the list READS and the drawer WRITES. The create form used to be mounted above
 * the table at all times, which is half of what the owner meant by "I read a whole screen
 * instead of skimming it". There is exactly one drawer because create and update have the
 * SAME validation — a second one would be two copies of one rule waiting to disagree.
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

  const formId = useId()
  const nameId = useId()
  const kindId = useId()
  const costId = useId()
  const activeId = useId()

  // null = still loading. [] = loaded and genuinely empty, which is the first-run state.
  const [items, setItems] = useState<InventoryItem[] | null>(null)
  const [loadError, setLoadError] = useState<ErrorKey | null>(null)
  /** null = the drawer is closed. There is no other "is the form open" flag. */
  const [draft, setDraft] = useState<Draft | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<ErrorMessage | null>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  /** A dead session must not render an empty table that looks like "nothing in stock". */
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

  function openDrawer(next: Draft) {
    setDraft(next)
    setFieldErrors({})
    setFormError(null)
    setSaved(false)
  }

  /** Escape, the scrim and Cancel all land here — including mid-save, by design. */
  function closeDrawer() {
    setDraft(null)
    setFieldErrors({})
    setFormError(null)
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
    if (busy || draft === null) return

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
      // The drawer closes on success and takes anything written inside it with it, so the
      // outcome is announced by the PAGE's live region below the header. A failure keeps
      // the drawer open, which is why the failure text stays in the drawer.
      setDraft(null)
      setSaved(true)
      await load()
    } catch (cause) {
      reportSaveFailure(cause)
    } finally {
      setBusy(false)
    }
  }

  /**
   * Soft delete / undo, through the same upsert route. Nothing is ever destroyed: a price
   * that was paid last month has to stay explicable next month. Reversible in one click, so
   * it asks nothing first — a confirmation for a reversible action teaches people to
   * dismiss confirmations.
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

  return (
    <>
      <PageHeader
        title={t('heading')}
        question={t('question')}
        action={
          <button type="button" className="btn btn-primary" onClick={() => openDrawer(EMPTY_DRAFT)}>
            {t('createHeading')}
          </button>
        }
      />

      {/* Permanent live regions: a text change inside an existing region is announced far
          more reliably than a node that appears and disappears. */}
      <p className="form-error" role="alert">
        {loadError === null ? '' : tError(loadError)}
      </p>
      <p className="form-status" role="status">
        {saved ? t('saved') : ''}
      </p>

      <ListPanel title={t('listHeading')}>
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
        {items === null ? (
          <p className="empty-state" role="status">
            {loadError === null ? t('loading') : tError(loadError)}
          </p>
        ) : items.length === 0 ? (
          <EmptyState>{t('empty')}</EmptyState>
        ) : (
          <table className="data-table" aria-busy={busy}>
            <caption className="visually-hidden">{t('tableCaption')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('colName')}</th>
                <th scope="col">{t('colKind')}</th>
                <th scope="col" className="col-numeric">
                  {t('colCost')}
                </th>
                <th scope="col">{t('colStatus')}</th>
                <th scope="col">{t('colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className={item.active ? undefined : 'is-muted'}>
                  <th scope="row">{item.name}</th>
                  <td>{kindLabel[item.kind]}</td>
                  <td className="col-numeric">
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
                  {/* The WORD, in a chip that does not wrap. Text, not a colour: the status
                      has to survive greyscale and a screen reader. */}
                  <td>
                    <span className={item.active ? 'badge' : 'badge muted'}>
                      {item.active ? t('statusActive') : t('statusInactive')}
                    </span>
                  </td>
                  <td className="cell-actions">
                    <button
                      type="button"
                      className="btn btn-quiet"
                      onClick={() => openDrawer(draftOf(item))}
                    >
                      {t('edit')}
                      <span className="visually-hidden">{t('forItem', { name: item.name })}</span>
                    </button>
                    <button
                      type="button"
                      className="btn btn-quiet"
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
      </ListPanel>

      <Drawer
        open={draft !== null}
        onClose={closeDrawer}
        title={draft?.id === undefined ? t('createHeading') : t('editHeading')}
        busy={busy}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={closeDrawer}>
              {t('cancel')}
            </button>
            <button type="submit" form={formId} className="btn btn-primary" disabled={busy}>
              {busy
                ? t('submitting')
                : draft?.id === undefined
                  ? t('submitCreate')
                  : t('submitSave')}
            </button>
          </>
        }
      >
        {draft === null ? null : (
          <form id={formId} onSubmit={onSubmit} noValidate>
            {/* The drawer stays open when the server refuses, so this belongs here rather
                than in the page's region behind it — on a phone the drawer IS the screen. */}
            <p className="form-error" role="alert">
              {formError === null ? '' : t(formError)}
            </p>

            <Field
              id={nameId}
              label={t('fieldName')}
              required
              error={fieldErrors.name === undefined ? null : t(fieldErrors.name)}
            >
              <input
                type="text"
                required
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                maxLength={160}
                autoComplete="off"
                disabled={busy}
              />
            </Field>

            <Field id={kindId} label={t('fieldKind')} help={t('kindHint')}>
              <select
                value={draft.kind}
                onChange={(event) => {
                  if (isInventoryKind(event.target.value)) {
                    setDraft({ ...draft, kind: event.target.value })
                  }
                }}
                disabled={busy}
              >
                {INVENTORY_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {kindLabel[kind]}
                  </option>
                ))}
              </select>
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
                onChange={(event) => setDraft({ ...draft, cost: event.target.value })}
                disabled={busy}
              />
            </Field>

            {/* `.field-check` WITHOUT `.field`: `.field input` is width:100% + min-height:44px,
                which turns a checkbox into a 44px blue slab. Verified by looking at it. */}
            <div className="field-check">
              <input
                id={activeId}
                type="checkbox"
                checked={draft.active}
                onChange={(event) => setDraft({ ...draft, active: event.target.checked })}
                disabled={busy}
              />
              <label htmlFor={activeId}>{t('fieldActive')}</label>
            </div>
          </form>
        )}
      </Drawer>
    </>
  )
}
