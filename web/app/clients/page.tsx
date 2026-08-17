'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { type FormEvent, Fragment, useCallback, useEffect, useId, useState } from 'react'
import { ConfirmModal } from '@/components/ConfirmModal'
import { Drawer } from '@/components/Drawer'
import { EmptyState } from '@/components/EmptyState'
import { Field } from '@/components/Field'
import { ListPanel } from '@/components/ListPanel'
import { PageHeader } from '@/components/PageHeader'
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
 * company and must stop seeing our work that same minute. That used to live in a code
 * comment and in one sentence of intro prose; it is now the body of the confirmation, which
 * is the only moment it can still change the answer.
 *
 * REDESIGN, owner's answer Q3: ONE list. The two tables and their two permanently-open forms
 * were literally the "two white containers" complaint, and a segmented control would have
 * been worse — hiding half the data to look tidy makes the screen worse, not lighter. So a
 * client is a row and its people are the rows underneath it, and both writes are drawers.
 *
 * WHY EACH CONTACT SUB-ROW STILL HAS AN EMPTY "Objekte" CELL: the column belongs to the
 * client, a person has no buildings of their own, and `ResponsiveTableLabels` captions the
 * ≤767px cards BY CELL POSITION. Dropping the cell would shift every later label one column
 * left and confidently caption a phone number "Objekte" — readable, and false.
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

  const clientFormId = useId()
  const clientNameId = useId()
  const clientActiveId = useId()
  const contactFormId = useId()
  const contactClientId = useId()
  const contactNameId = useId()
  const contactEmailId = useId()
  const contactPhoneId = useId()
  const contactActiveId = useId()

  // null = still loading. Empty lists = loaded and genuinely empty, the first-run state.
  const [snapshot, setSnapshot] = useState<ClientsSnapshot | null>(null)
  const [loadError, setLoadError] = useState<ErrorKey | null>(null)
  const [busy, setBusy] = useState(false)

  /** null = that drawer is closed. No separate "is the form open" flag exists. */
  const [clientDraft, setClientDraft] = useState<ClientDraft | null>(null)
  const [clientError, setClientError] = useState<ErrorMessage | null>(null)

  const [contactDraft, setContactDraft] = useState<ContactDraft | null>(null)
  const [contactErrors, setContactErrors] = useState<{
    client?: ErrorMessage
    name?: ErrorMessage
    email?: ErrorMessage
    phone?: ErrorMessage
  }>({})
  const [contactError, setContactError] = useState<ErrorMessage | null>(null)

  /** The person about to lose their links. Deactivation is the one irreversible write here. */
  const [confirming, setConfirming] = useState<Contact | null>(null)

  /** What the page's one live region is currently saying. '' = nothing happened yet. */
  const [status, setStatus] = useState('')

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

  /** 4xx belongs to the open drawer, 5xx and offline belong to the page-level error. */
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
    if (busy || clientDraft === null) return
    const name = clientDraft.name.trim()
    setStatus('')
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
      // The drawer closes on success and would take its own confirmation with it unread,
      // so the outcome is announced by the page's live region. Focus goes back to the
      // control that opened the drawer — components/Drawer.tsx, lib/useOverlay.ts.
      setClientDraft(null)
      setStatus(t('clientSaved'))
      await load()
    } catch (cause) {
      reportFailure(cause, setClientError)
    } finally {
      setBusy(false)
    }
  }

  async function onSubmitContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || contactDraft === null) return
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
    setStatus('')
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
      setContactDraft(null)
      setStatus(t('contactSaved'))
      await load()
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
   *
   * A client is reversible in one click and asks nothing first. A contact is not — the
   * links do not come back — so that one goes through the confirmation below.
   */
  async function toggleClient(client: Client) {
    if (busy) return
    setBusy(true)
    setStatus('')
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
    setStatus('')
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
      setConfirming(null)
      await load()
    } catch (cause) {
      setConfirming(null)
      reportFailure(cause, setContactError)
    } finally {
      setBusy(false)
    }
  }

  /** Open / close, one pair per drawer. Escape, the scrim and Cancel all land in `close`. */
  function openClient(draft: ClientDraft) {
    setClientDraft(draft)
    setClientError(null)
    setStatus('')
  }

  function closeClient() {
    setClientDraft(null)
    setClientError(null)
  }

  function openContact(draft: ContactDraft) {
    setContactDraft(draft)
    setContactErrors({})
    setContactError(null)
    setStatus('')
  }

  function closeContact() {
    setContactDraft(null)
    setContactErrors({})
    setContactError(null)
  }

  function editContact(contact: Contact) {
    openContact({
      id: contact.id,
      clientChoice: String(contact.client_id),
      name: contact.name,
      email: contact.email ?? '',
      phone: contact.phone ?? '',
      active: contact.active,
    })
  }

  /**
   * One group per client, its people underneath it. A contact whose client is missing from
   * the payload keeps its own group rather than vanishing from the screen — an invisible
   * row is how a person nobody can see keeps a link nobody remembers giving them.
   */
  const groups = clients.map((client) => ({
    client,
    people: contacts.filter((contact) => contact.client_id === client.id),
    buildings: locations.filter((row) => row.client_id === client.id).map((row) => row.name),
  }))
  const orphans = contacts.filter(
    (contact) => !clients.some((client) => client.id === contact.client_id),
  )

  /** The cell exists so the columns keep lining up; a person has no buildings of their own. */
  const notApplicable = <span className="cell-muted">{t('notApplicable')}</span>

  function contactRow(contact: Contact) {
    return (
      <tr key={`contact-${contact.id}`} className={contact.active ? undefined : 'is-muted'}>
        {/* The status lives in the row header rather than in a column of its own: with five
            columns the buildings list and the contact details ate the width and „Status"
            broke MID-WORD in the header (`.data-table th` sets `overflow-wrap: anywhere`).
            Here the word sits next to the name it describes, which is also where a screen
            reader announces it. */}
        <th scope="row">
          <span aria-hidden="true">↳ </span>
          {contact.name} <span className="badge muted">{t('rolePerson')}</span>{' '}
          {contact.active ? (
            /* Active is the normal case and gets no chip — a column of „Aktiv" chips is the
               noise this redesign is removing. It stays in the accessibility tree, because
               "nothing said" is not the same as "active" to somebody who cannot see the row. */
            <span className="visually-hidden">{t('statusActive')}</span>
          ) : (
            <span className="badge muted">{t('statusInactivePerson')}</span>
          )}
        </th>
        <td>{notApplicable}</td>
        <td>
          {contact.email === null ? (
            <span className="cell-muted">{t('noEmail')}</span>
          ) : (
            contact.email
          )}
          {' · '}
          {contact.phone === null ? (
            <span className="cell-muted">{t('noPhone')}</span>
          ) : (
            contact.phone
          )}
        </td>
        <td className="cell-actions">
          <button type="button" className="btn btn-quiet" onClick={() => editContact(contact)}>
            {/* .visually-hidden disambiguator: nine buttons on this screen say „Bearbeiten". */}
            {t('edit')}
            <span className="visually-hidden">{t('forName', { name: contact.name })}</span>
          </button>
          <button
            type="button"
            className="btn btn-quiet"
            onClick={() => (contact.active ? setConfirming(contact) : toggleContact(contact))}
          >
            {contact.active ? t('deactivate') : t('activate')}
            <span className="visually-hidden">{t('forName', { name: contact.name })}</span>
          </button>
        </td>
      </tr>
    )
  }

  return (
    <>
      <PageHeader
        title={t('heading')}
        question={t('question')}
        action={
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => openClient(EMPTY_CLIENT)}
          >
            {t('clientCreateHeading')}
          </button>
        }
      />

      {/* Load-bearing: this page is never a prerequisite. Both things can be created from
          the buildings form, and this screen is where they get corrected afterwards. */}
      <p className="note">
        {t('intro')} <Link href="/locations/">{t('buildingsLink')}</Link>
      </p>

      {/* Permanent live regions: a text change inside an existing region is announced far
          more reliably than a node that appears and disappears. */}
      <p className="form-error" role="alert">
        {loadError === null ? '' : tError(loadError)}
      </p>
      <p className="form-status" role="status">
        {status}
      </p>

      <ListPanel
        title={t('listHeading')}
        action={
          <button
            type="button"
            className="btn btn-quiet"
            onClick={() => openContact(EMPTY_CONTACT)}
          >
            {t('contactCreateHeading')}
          </button>
        }
      >
        {snapshot === null ? (
          <p className="empty-state" role="status">
            {t('loading')}
          </p>
        ) : clients.length === 0 && orphans.length === 0 ? (
          <EmptyState>{t('empty')}</EmptyState>
        ) : (
          <table className="data-table" aria-busy={busy}>
            <caption className="visually-hidden">{t('tableCaption')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('colNameNested')}</th>
                <th scope="col">{t('colBuildings')}</th>
                <th scope="col">{t('colContact')}</th>
                <th scope="col">{t('colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {groups.map(({ client, people, buildings }) => (
                <Fragment key={`client-${client.id}`}>
                  <tr className={client.active ? undefined : 'is-muted'}>
                    <th scope="row">
                      {client.name}{' '}
                      {client.active ? (
                        <span className="visually-hidden">{t('statusActive')}</span>
                      ) : (
                        <span className="badge muted">{t('statusInactiveClient')}</span>
                      )}
                    </th>
                    <td>
                      {buildings.length === 0 ? (
                        <span className="cell-muted">{t('noBuildings')}</span>
                      ) : (
                        buildings.join(', ')
                      )}
                    </td>
                    <td>
                      {people.length === 0 ? (
                        <span className="cell-muted">{t('noPeople')}</span>
                      ) : (
                        t('peopleCount', { count: people.length })
                      )}
                    </td>
                    <td className="cell-actions">
                      <button
                        type="button"
                        className="btn btn-quiet"
                        onClick={() =>
                          openClient({ id: client.id, name: client.name, active: client.active })
                        }
                      >
                        {t('edit')}
                        <span className="visually-hidden">
                          {t('forName', { name: client.name })}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="btn btn-quiet"
                        onClick={() => toggleClient(client)}
                      >
                        {client.active ? t('deactivate') : t('activate')}
                        <span className="visually-hidden">
                          {t('forName', { name: client.name })}
                        </span>
                      </button>
                    </td>
                  </tr>
                  {people.map(contactRow)}
                </Fragment>
              ))}

              {orphans.length === 0 ? null : (
                <Fragment key="unknown-client">
                  <tr>
                    <th scope="row">{t('unknownClient')}</th>
                    <td>{notApplicable}</td>
                    <td>{t('peopleCount', { count: orphans.length })}</td>
                    <td className="cell-actions">{notApplicable}</td>
                  </tr>
                  {orphans.map(contactRow)}
                </Fragment>
              )}
            </tbody>
          </table>
        )}
      </ListPanel>

      <Drawer
        open={clientDraft !== null}
        onClose={closeClient}
        title={clientDraft?.id === undefined ? t('clientCreateHeading') : t('clientEditHeading')}
        busy={busy}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={closeClient}>
              {t('cancel')}
            </button>
            <button type="submit" form={clientFormId} className="btn btn-primary" disabled={busy}>
              {busy
                ? t('submitting')
                : clientDraft?.id === undefined
                  ? t('clientSubmitCreate')
                  : t('submitSave')}
            </button>
          </>
        }
      >
        {clientDraft === null ? null : (
          <form id={clientFormId} onSubmit={onSubmitClient} noValidate>
            {/* The drawer stays open when the server refuses, so the refusal stays with it:
                on a phone the drawer IS the screen, and a message on the page behind it
                would be announced into something the reader can no longer see. */}
            <p className="form-error" role="alert">
              {/* Only what belongs to the FORM. A field error is announced once, on its own
                  field — printing it here as well says the same sentence twice. */}
              {clientError === 'errorRejected' ? t(clientError) : ''}
            </p>

            <Field
              id={clientNameId}
              label={t('fieldClientName')}
              required
              error={clientError === 'errorNameRequired' ? t('errorNameRequired') : null}
            >
              <input
                type="text"
                required
                value={clientDraft.name}
                onChange={(event) => setClientDraft({ ...clientDraft, name: event.target.value })}
                maxLength={160}
                autoComplete="off"
                disabled={busy}
              />
            </Field>

            {/* `.field-check` WITHOUT `.field`: `.field input` is width:100% + min-height:44px,
                which turns a checkbox into a 44px blue slab. Verified by looking at it. */}
            <div className="field-check">
              <input
                id={clientActiveId}
                type="checkbox"
                checked={clientDraft.active}
                onChange={(event) =>
                  setClientDraft({ ...clientDraft, active: event.target.checked })
                }
                disabled={busy}
              />
              <label htmlFor={clientActiveId}>{t('fieldClientActive')}</label>
            </div>
          </form>
        )}
      </Drawer>

      <Drawer
        open={contactDraft !== null}
        onClose={closeContact}
        title={contactDraft?.id === undefined ? t('contactCreateHeading') : t('contactEditHeading')}
        busy={busy}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={closeContact}>
              {t('cancel')}
            </button>
            <button type="submit" form={contactFormId} className="btn btn-primary" disabled={busy}>
              {busy
                ? t('submitting')
                : contactDraft?.id === undefined
                  ? t('contactSubmitCreate')
                  : t('submitSave')}
            </button>
          </>
        }
      >
        {contactDraft === null ? null : (
          <form id={contactFormId} onSubmit={onSubmitContact} noValidate>
            <p className="form-error" role="alert">
              {contactError === null ? '' : t(contactError)}
            </p>

            <Field
              id={contactClientId}
              label={t('fieldContactClient')}
              required
              error={contactErrors.client === undefined ? null : t(contactErrors.client)}
            >
              <select
                required
                value={contactDraft.clientChoice}
                onChange={(event) =>
                  setContactDraft({ ...contactDraft, clientChoice: event.target.value })
                }
                disabled={busy}
              >
                <option value="">{t('pickClient')}</option>
                {clients.map((client) => (
                  <option key={client.id} value={String(client.id)}>
                    {client.active ? client.name : t('optionInactive', { name: client.name })}
                  </option>
                ))}
              </select>
            </Field>

            <Field
              id={contactNameId}
              label={t('fieldContactName')}
              required
              error={contactErrors.name === undefined ? null : t(contactErrors.name)}
            >
              <input
                type="text"
                required
                value={contactDraft.name}
                onChange={(event) => setContactDraft({ ...contactDraft, name: event.target.value })}
                maxLength={160}
                autoComplete="off"
                disabled={busy}
              />
            </Field>

            <Field
              id={contactEmailId}
              label={t('fieldContactEmail')}
              optional
              help={t('contactEmailHint')}
              error={contactErrors.email === undefined ? null : t(contactErrors.email)}
            >
              <input
                type="email"
                value={contactDraft.email}
                onChange={(event) =>
                  setContactDraft({ ...contactDraft, email: event.target.value })
                }
                maxLength={320}
                autoComplete="off"
                disabled={busy}
              />
            </Field>

            <Field
              id={contactPhoneId}
              label={t('fieldContactPhone')}
              optional
              error={contactErrors.phone === undefined ? null : t(contactErrors.phone)}
            >
              <input
                type="tel"
                value={contactDraft.phone}
                onChange={(event) =>
                  setContactDraft({ ...contactDraft, phone: event.target.value })
                }
                maxLength={40}
                autoComplete="off"
                disabled={busy}
              />
            </Field>

            <div className="field-check">
              <input
                id={contactActiveId}
                type="checkbox"
                checked={contactDraft.active}
                onChange={(event) =>
                  setContactDraft({ ...contactDraft, active: event.target.checked })
                }
                aria-describedby={`${contactActiveId}-hint`}
                disabled={busy}
              />
              <label htmlFor={contactActiveId}>{t('fieldContactActive')}</label>
            </div>
            {/* The link revocation, said where the checkbox that triggers it lives. The
                confirmation says it again at the moment of the decision. */}
            <p className="field-hint" id={`${contactActiveId}-hint`}>
              {t('contactIntro')}
            </p>
          </form>
        )}
      </Drawer>

      {/* The one irreversible write on this screen: the links do not come back. */}
      <ConfirmModal
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        onConfirm={() => {
          if (confirming !== null) void toggleContact(confirming)
        }}
        title={t('confirmDeactivateTitle', { name: confirming?.name ?? '' })}
        body={t('confirmDeactivateBody')}
        confirmLabel={t('confirmDeactivateConfirm')}
        destructive
        busy={busy}
      />
    </>
  )
}
