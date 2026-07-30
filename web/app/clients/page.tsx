'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { type FormEvent, useCallback, useEffect, useId, useRef, useState } from 'react'
import {
  ApiError,
  type Client,
  type ClientsSnapshot,
  type Contact,
  deactivateClient,
  deactivateContact,
  fetchClientsSnapshot,
  saveClient,
  saveContact,
} from '@/lib/api'
import type { ErrorKey } from '@/lib/locale'
import { LOGIN_PATH } from '@/lib/nav'

/**
 * Clients screen — the companies we have contracts with, and the people at them we report to.
 *
 * This screen is for TIDYING UP: fixing a spelling, adding a phone number, marking that
 * somebody has left. Both things can be created straight from the buildings form, and going
 * through here is never a prerequisite for filing a building — see app/locations/page.tsx.
 *
 * Deactivating a person also revokes any link they were given (the DELETE route does it
 * server-side), because the realistic reason to deactivate them is that they left the client
 * company and must stop seeing our work that same minute.
 */

/** Shape checks only, mirroring server/lib/validate.js. The server decides for real. */
const EMAIL_RE = /^[^\s@,]+@[^\s@,.]+(\.[^\s@,.]+)+$/
const PHONE_RE = /^[0-9+()/.\s-]+$/

type ClientDraft = { id?: number; name: string; active: boolean }
type ContactDraft = {
  id?: number
  /** '' until a company is picked. A contact belongs to exactly one company. */
  clientChoice: string
  name: string
  email: string
  phone: string
  active: boolean
}

const EMPTY_CLIENT: ClientDraft = { name: '', active: true }
const EMPTY_CONTACT: ContactDraft = {
  clientChoice: '',
  name: '',
  email: '',
  phone: '',
  active: true,
}

/** Message keys inside the `clients` namespace, so field errors stay translatable. */
type ErrorMessage =
  | 'errorNameRequired'
  | 'errorClientRequired'
  | 'errorEmailShape'
  | 'errorPhoneShape'
  | 'errorRejected'

export default function ClientsPage() {
  const t = useTranslations('clients')
  const tError = useTranslations('error')
  const router = useRouter()

  const clientNameId = useId()
  const clientActiveId = useId()
  const clientFormHeadingId = useId()
  const contactClientId = useId()
  const contactNameId = useId()
  const contactEmailId = useId()
  const contactPhoneId = useId()
  const contactActiveId = useId()
  const contactFormHeadingId = useId()
  const clientNameRef = useRef<HTMLInputElement>(null)
  const contactNameRef = useRef<HTMLInputElement>(null)

  // null = still loading. Empty lists = loaded and genuinely empty, the first-run state.
  const [snapshot, setSnapshot] = useState<ClientsSnapshot | null>(null)
  const [loadError, setLoadError] = useState<ErrorKey | null>(null)
  const [busy, setBusy] = useState(false)

  const [clientDraft, setClientDraft] = useState<ClientDraft>(EMPTY_CLIENT)
  const [clientError, setClientError] = useState<ErrorMessage | null>(null)
  const [clientSaved, setClientSaved] = useState(false)

  const [contactDraft, setContactDraft] = useState<ContactDraft>(EMPTY_CONTACT)
  const [contactErrors, setContactErrors] = useState<{
    client?: ErrorMessage
    name?: ErrorMessage
    email?: ErrorMessage
    phone?: ErrorMessage
  }>({})
  const [contactError, setContactError] = useState<ErrorMessage | null>(null)
  const [contactSaved, setContactSaved] = useState(false)

  /** A dead session must not render empty tables that look like "nothing on file yet". */
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

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  const clients = snapshot?.clients ?? []
  const contacts = snapshot?.contacts ?? []
  const locations = snapshot?.locations ?? []

  /** 4xx belongs to the form, 5xx and offline belong to the page-level error. */
  function reportFailure(cause: unknown, setError: (value: ErrorMessage | null) => void) {
    if (handleAuthLoss(cause)) return
    if (cause instanceof ApiError && cause.status >= 400 && cause.status < 500) {
      setError('errorRejected')
      return
    }
    setError(null)
    setLoadError(cause instanceof ApiError ? cause.messageKey : 'server')
  }

  async function onSubmitClient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const name = clientDraft.name.trim()
    setClientSaved(false)
    if (name === '') {
      setClientError('errorNameRequired')
      return
    }
    setClientError(null)
    setBusy(true)
    try {
      await saveClient({
        ...(clientDraft.id === undefined ? {} : { id: clientDraft.id }),
        name,
        active: clientDraft.active,
      })
      setClientDraft(EMPTY_CLIENT)
      setClientSaved(true)
      await load()
      // The submit button is disabled while saving, so focus would otherwise fall to <body>.
      clientNameRef.current?.focus()
    } catch (cause) {
      reportFailure(cause, setClientError)
    } finally {
      setBusy(false)
    }
  }

  async function onSubmitContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const name = contactDraft.name.trim()
    const email = contactDraft.email.trim()
    const phone = contactDraft.phone.trim()

    const errors: typeof contactErrors = {}
    if (contactDraft.clientChoice === '') errors.client = 'errorClientRequired'
    if (name === '') errors.name = 'errorNameRequired'
    if (email !== '' && !EMAIL_RE.test(email)) errors.email = 'errorEmailShape'
    if (phone !== '' && !PHONE_RE.test(phone)) errors.phone = 'errorPhoneShape'
    setContactErrors(errors)
    setContactError(null)
    setContactSaved(false)
    if (Object.keys(errors).length > 0) return

    setBusy(true)
    try {
      await saveContact({
        ...(contactDraft.id === undefined ? {} : { id: contactDraft.id }),
        client_id: Number(contactDraft.clientChoice),
        name,
        email,
        phone,
        active: contactDraft.active,
      })
      setContactDraft(EMPTY_CONTACT)
      setContactSaved(true)
      await load()
      contactNameRef.current?.focus()
    } catch (cause) {
      reportFailure(cause, setContactError)
    } finally {
      setBusy(false)
    }
  }

  /**
   * Soft deactivate / reactivate. Deactivating goes through DELETE because for a contact
   * that route ALSO revokes their live links; reactivating is a normal save. Nothing is
   * ever destroyed: buildings and shifts keep naming who was paying and who we reported to.
   */
  async function toggleClient(client: Client) {
    if (busy) return
    setBusy(true)
    setClientSaved(false)
    try {
      if (client.active) await deactivateClient(client.id)
      else await saveClient({ id: client.id, name: client.name, active: true })
      await load()
    } catch (cause) {
      reportFailure(cause, setClientError)
    } finally {
      setBusy(false)
    }
  }

  async function toggleContact(contact: Contact) {
    if (busy) return
    setBusy(true)
    setContactSaved(false)
    try {
      if (contact.active) await deactivateContact(contact.id)
      else {
        await saveContact({
          id: contact.id,
          client_id: contact.client_id,
          name: contact.name,
          email: contact.email ?? '',
          phone: contact.phone ?? '',
          active: true,
        })
      }
      await load()
    } catch (cause) {
      reportFailure(cause, setContactError)
    } finally {
      setBusy(false)
    }
  }

  function editClient(client: Client) {
    setClientDraft({ id: client.id, name: client.name, active: client.active })
    setClientError(null)
    setClientSaved(false)
    clientNameRef.current?.focus()
  }

  function editContact(contact: Contact) {
    setContactDraft({
      id: contact.id,
      clientChoice: String(contact.client_id),
      name: contact.name,
      email: contact.email ?? '',
      phone: contact.phone ?? '',
      active: contact.active,
    })
    setContactErrors({})
    setContactError(null)
    setContactSaved(false)
    contactNameRef.current?.focus()
  }

  function clientName(id: number): string {
    return clients.find((client) => client.id === id)?.name ?? t('unknownClient')
  }

  return (
    <>
      <h1>{t('heading')}</h1>
      <p className="lede">{t('intro')}</p>
      <p>
        <Link href="/locations/">{t('buildingsLink')}</Link>
      </p>

      {loadError !== null ? (
        <p className="form-error" role="alert">
          {tError(loadError)}
        </p>
      ) : null}

      <section aria-labelledby={clientFormHeadingId}>
        <h2 id={clientFormHeadingId}>
          {clientDraft.id === undefined ? t('clientCreateHeading') : t('clientEditHeading')}
        </h2>

        <form className="worker-form" onSubmit={onSubmitClient} noValidate>
          {/* Permanent live regions: a text change inside an existing region is announced
              far more reliably than a node that appears and disappears. */}
          <p className="form-error" role="alert">
            {clientError === null ? '' : t(clientError)}
          </p>
          <p className="form-status" role="status">
            {clientSaved ? t('clientSaved') : ''}
          </p>

          <div className="field">
            <label htmlFor={clientNameId}>{t('fieldClientName')}</label>
            <input
              id={clientNameId}
              ref={clientNameRef}
              type="text"
              value={clientDraft.name}
              onChange={(event) => setClientDraft({ ...clientDraft, name: event.target.value })}
              maxLength={160}
              autoComplete="off"
              aria-describedby={`${clientNameId}-error`}
              aria-invalid={clientError === 'errorNameRequired'}
              disabled={busy}
            />
            <p className="field-error" id={`${clientNameId}-error`} role="alert">
              {clientError === 'errorNameRequired' ? t('errorNameRequired') : ''}
            </p>
          </div>

          <div className="field field-check">
            <input
              id={clientActiveId}
              type="checkbox"
              checked={clientDraft.active}
              onChange={(event) => setClientDraft({ ...clientDraft, active: event.target.checked })}
              disabled={busy}
            />
            <label htmlFor={clientActiveId}>{t('fieldClientActive')}</label>
          </div>

          <div className="form-actions">
            <button type="submit" className="button-primary" disabled={busy}>
              {busy
                ? t('submitting')
                : clientDraft.id === undefined
                  ? t('clientSubmitCreate')
                  : t('submitSave')}
            </button>
            {clientDraft.id === undefined ? null : (
              <button
                type="button"
                className="button-secondary"
                onClick={() => setClientDraft(EMPTY_CLIENT)}
              >
                {t('cancel')}
              </button>
            )}
          </div>
        </form>

        <h3>{t('clientListHeading')}</h3>
        {snapshot === null ? (
          <p role="status">{t('loading')}</p>
        ) : clients.length === 0 ? (
          <p>{t('clientEmptyBody')}</p>
        ) : (
          <table className="data-table" aria-busy={busy}>
            <caption className="visually-hidden">{t('clientTableCaption')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('colClient')}</th>
                <th scope="col">{t('colBuildings')}</th>
                <th scope="col">{t('colPeople')}</th>
                <th scope="col">{t('colStatus')}</th>
                <th scope="col">{t('colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((client) => {
                const buildings = locations.filter((row) => row.client_id === client.id)
                const people = contacts.filter((row) => row.client_id === client.id)
                return (
                  <tr key={client.id} className={client.active ? undefined : 'row-inactive'}>
                    <th scope="row">{client.name}</th>
                    <td>
                      {buildings.length === 0 ? (
                        <span className="cell-muted">{t('noBuildings')}</span>
                      ) : (
                        buildings.map((row) => row.name).join(', ')
                      )}
                    </td>
                    <td>
                      {people.length === 0 ? (
                        <span className="cell-muted">{t('noPeople')}</span>
                      ) : (
                        people.map((row) => row.name).join(', ')
                      )}
                    </td>
                    {/* Text, not a colour: the status must survive greyscale and a screen reader. */}
                    <td>{client.active ? t('statusActive') : t('statusInactiveClient')}</td>
                    <td className="cell-actions">
                      <button
                        type="button"
                        className="button-secondary"
                        onClick={() => editClient(client)}
                      >
                        {t('edit')}
                        <span className="visually-hidden">
                          {t('forName', { name: client.name })}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="button-secondary"
                        onClick={() => toggleClient(client)}
                      >
                        {client.active ? t('deactivate') : t('activate')}
                        <span className="visually-hidden">
                          {t('forName', { name: client.name })}
                        </span>
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </section>

      <section aria-labelledby={contactFormHeadingId}>
        <h2 id={contactFormHeadingId}>
          {contactDraft.id === undefined ? t('contactCreateHeading') : t('contactEditHeading')}
        </h2>
        <p>{t('contactIntro')}</p>

        <form className="worker-form" onSubmit={onSubmitContact} noValidate>
          <p className="form-error" role="alert">
            {contactError === null ? '' : t(contactError)}
          </p>
          <p className="form-status" role="status">
            {contactSaved ? t('contactSaved') : ''}
          </p>

          <div className="field">
            <label htmlFor={contactClientId}>{t('fieldContactClient')}</label>
            <select
              id={contactClientId}
              value={contactDraft.clientChoice}
              onChange={(event) =>
                setContactDraft({ ...contactDraft, clientChoice: event.target.value })
              }
              aria-describedby={`${contactClientId}-error`}
              aria-invalid={contactErrors.client !== undefined}
              disabled={busy}
            >
              <option value="">{t('pickClient')}</option>
              {clients.map((client) => (
                <option key={client.id} value={String(client.id)}>
                  {client.active ? client.name : t('optionInactive', { name: client.name })}
                </option>
              ))}
            </select>
            <p className="field-error" id={`${contactClientId}-error`} role="alert">
              {contactErrors.client === undefined ? '' : t(contactErrors.client)}
            </p>
          </div>

          <div className="field">
            <label htmlFor={contactNameId}>{t('fieldContactName')}</label>
            <input
              id={contactNameId}
              ref={contactNameRef}
              type="text"
              value={contactDraft.name}
              onChange={(event) => setContactDraft({ ...contactDraft, name: event.target.value })}
              maxLength={160}
              autoComplete="off"
              aria-describedby={`${contactNameId}-error`}
              aria-invalid={contactErrors.name !== undefined}
              disabled={busy}
            />
            <p className="field-error" id={`${contactNameId}-error`} role="alert">
              {contactErrors.name === undefined ? '' : t(contactErrors.name)}
            </p>
          </div>

          <div className="field">
            <label htmlFor={contactEmailId}>{t('fieldContactEmail')}</label>
            <input
              id={contactEmailId}
              type="email"
              value={contactDraft.email}
              onChange={(event) => setContactDraft({ ...contactDraft, email: event.target.value })}
              maxLength={320}
              autoComplete="off"
              aria-describedby={`${contactEmailId}-hint ${contactEmailId}-error`}
              aria-invalid={contactErrors.email !== undefined}
              disabled={busy}
            />
            <p className="field-hint" id={`${contactEmailId}-hint`}>
              {t('contactEmailHint')}
            </p>
            <p className="field-error" id={`${contactEmailId}-error`} role="alert">
              {contactErrors.email === undefined ? '' : t(contactErrors.email)}
            </p>
          </div>

          <div className="field">
            <label htmlFor={contactPhoneId}>{t('fieldContactPhone')}</label>
            <input
              id={contactPhoneId}
              type="tel"
              value={contactDraft.phone}
              onChange={(event) => setContactDraft({ ...contactDraft, phone: event.target.value })}
              maxLength={40}
              autoComplete="off"
              aria-describedby={`${contactPhoneId}-error`}
              aria-invalid={contactErrors.phone !== undefined}
              disabled={busy}
            />
            <p className="field-error" id={`${contactPhoneId}-error`} role="alert">
              {contactErrors.phone === undefined ? '' : t(contactErrors.phone)}
            </p>
          </div>

          <div className="field field-check">
            <input
              id={contactActiveId}
              type="checkbox"
              checked={contactDraft.active}
              onChange={(event) =>
                setContactDraft({ ...contactDraft, active: event.target.checked })
              }
              disabled={busy}
            />
            <label htmlFor={contactActiveId}>{t('fieldContactActive')}</label>
          </div>

          <div className="form-actions">
            <button type="submit" className="button-primary" disabled={busy}>
              {busy
                ? t('submitting')
                : contactDraft.id === undefined
                  ? t('contactSubmitCreate')
                  : t('submitSave')}
            </button>
            {contactDraft.id === undefined ? null : (
              <button
                type="button"
                className="button-secondary"
                onClick={() => setContactDraft(EMPTY_CONTACT)}
              >
                {t('cancel')}
              </button>
            )}
          </div>
        </form>

        <h3>{t('contactListHeading')}</h3>
        {snapshot === null ? (
          <p role="status">{t('loading')}</p>
        ) : contacts.length === 0 ? (
          <p>{t('contactEmptyBody')}</p>
        ) : (
          <table className="data-table" aria-busy={busy}>
            <caption className="visually-hidden">{t('contactTableCaption')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('colPerson')}</th>
                <th scope="col">{t('colClient')}</th>
                <th scope="col">{t('colEmail')}</th>
                <th scope="col">{t('colPhone')}</th>
                <th scope="col">{t('colStatus')}</th>
                <th scope="col">{t('colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((contact) => (
                <tr key={contact.id} className={contact.active ? undefined : 'row-inactive'}>
                  <th scope="row">{contact.name}</th>
                  <td>{clientName(contact.client_id)}</td>
                  <td>
                    {contact.email === null ? (
                      <span className="cell-muted">{t('noEmail')}</span>
                    ) : (
                      contact.email
                    )}
                  </td>
                  <td>
                    {contact.phone === null ? (
                      <span className="cell-muted">{t('noPhone')}</span>
                    ) : (
                      contact.phone
                    )}
                  </td>
                  <td>{contact.active ? t('statusActive') : t('statusInactivePerson')}</td>
                  <td className="cell-actions">
                    <button
                      type="button"
                      className="button-secondary"
                      onClick={() => editContact(contact)}
                    >
                      {t('edit')}
                      <span className="visually-hidden">
                        {t('forName', { name: contact.name })}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="button-secondary"
                      onClick={() => toggleContact(contact)}
                    >
                      {contact.active ? t('deactivate') : t('activate')}
                      <span className="visually-hidden">
                        {t('forName', { name: contact.name })}
                      </span>
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
