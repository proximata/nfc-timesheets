'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useFormatter, useTranslations } from 'next-intl'
import { type FormEvent, useCallback, useEffect, useId, useMemo, useState } from 'react'
import { AnswerBand } from '@/components/AnswerBand'
import { type AttentionItem, AttentionList } from '@/components/AttentionList'
import { Drawer } from '@/components/Drawer'
import { EmptyState } from '@/components/EmptyState'
import { Field } from '@/components/Field'
import { FilterChips } from '@/components/FilterChips'
import { ListPanel } from '@/components/ListPanel'
import { LoadStatus } from '@/components/LoadStatus'
import { PageHeader } from '@/components/PageHeader'
import { type BadgeState, StateBadge } from '@/components/StateBadge'
import {
  ApiError,
  createShift,
  fetchShiftSnapshot,
  SHIFT_PAGE_SIZE,
  type Shift,
  type ShiftPatch,
  type ShiftSnapshot,
  updateShift,
} from '@/lib/api'
import {
  type AdminFilters,
  filterHref,
  type ShiftSort,
  type SortDir,
  useFilters,
} from '@/lib/filters'
import type { ErrorKey } from '@/lib/locale'
import { loginPathWithReturn } from '@/lib/nav'
import { isPeriod, PERIODS, type Period, periodContaining, periodRange } from '@/lib/period'
import {
  BUSINESS_TIME_ZONE,
  blocksPayroll,
  durationMinutes,
  formatDuration,
  fromBusinessInput,
  isManualEntry,
  manualEnds,
  overlappingShift,
  type ShiftState,
  shiftState,
  toBusinessInput,
} from '@/lib/shifts'

/**
 * Shift log — „Welche Schichten brauchen eine Entscheidung?"
 *
 * Two jobs. (1) Month-end verification: before payroll runs, every shift must be closed
 * and every auto-closed one resolved, because decision-10 keeps the rest out of the pay
 * total silently. Silence is the danger, so state is spelled out in words in its own
 * column, the shifts that block payroll are counted in the answer band at the top, and the
 * ones that need a decision are listed by name above the log.
 * (2) Correction: `PATCH /admin/shifts/:id` is how a forgotten tap-out becomes a paid
 * shift and how a shift filed against the wrong building gets moved.
 *
 * (3) Entry by hand: `POST /admin/shifts` files the day of a worker whose phone died or
 * whose tag was destroyed. Without it that person is paid EUR 0 and the only recovery is
 * SQL on the production box. Such a shift is labelled as hand-entered in the drawer AND in
 * its own column in the log, because payroll gets audited and a typed shift must never be
 * read as a tapped one.
 *
 * TWO DRAWERS, ONE JOB EACH, AND DELIBERATELY NOT ONE DRAWER BEHIND A MODE FLAG. Correcting
 * a shift allows an EMPTY end time (that is how a shift is put back to running); filing one
 * by hand REQUIRES it (the server refuses to open a shift by hand). One component holding
 * both rules is exactly how the two drift apart and start disagreeing about what a shift is.
 * Owner decision, this turn, and it is not an implementation detail.
 *
 * FILTERING, ORDERING AND PAGING ALL HAPPEN IN POSTGRES (TASK-235, then TASK-18). This screen
 * once fetched one UNBOUNDED payload and filtered it in the browser, on the argument that only
 * the browser could say "no shifts in August — 5 exist in earlier periods". That argument
 * ended when `/admin/data` learned to COUNT what it does not return: `shift_outside_count`
 * answers exactly that question over the same filter, and `shift_matching_count` answers "how
 * many rows does this period really have" without shipping them.
 *
 * The consequence for every headline on this screen: a number computed from the ROWS IN HAND
 * now means "on this page", which is a different and quieter claim than the one it looks like.
 * `blocked` and the triage overflow therefore read the SERVER's counts. Only the triage LIST
 * itself is built from the rows here, because a list can only name what it holds.
 *
 * There is no "truncated" notice on this screen any more, and its absence is deliberate: with
 * a fixed page size `rows.length >= limit` is true on every full page, so the notice would
 * shout permanently. The pager IS that disclosure now. The four screens that still fetch
 * unpaged (`/`, `/payroll/`, `/workers/`, `/locations/`) keep theirs.
 *
 * EVERY time on this screen — shown or typed — is Vienna wall-clock time, converted to and
 * from UTC in lib/shifts.ts and labelled as such. See BUSINESS_TIME_ZONE for why it is not
 * the browser's zone.
 */

type Draft = {
  id: number
  workerId: number
  locationId: string
  /** `YYYY-MM-DDTHH:mm` local time, as `<input type="datetime-local">` produces it. */
  start: string
  end: string
  /** The row as loaded, so only genuinely changed fields are sent. */
  original: Shift
}

/** Message keys inside the `shifts` namespace. */
type ErrorMessage =
  | 'errorStartRequired'
  | 'errorStartInvalid'
  | 'errorEndInvalid'
  | 'errorEndBeforeStart'
  | 'errorFuture'
  | 'errorGone'
  | 'errorRejected'

type FieldErrors = { start?: ErrorMessage; end?: ErrorMessage }

/**
 * The hand-entry drawer. Nothing is preselected: a wrong worker chosen by default is a wrong
 * payslip, so both selects start empty and the director has to name the person.
 */
type NewDraft = {
  workerId: string
  locationId: string
  /** `YYYY-MM-DDTHH:mm`, Vienna wall time. */
  start: string
  end: string
}

const EMPTY_NEW_DRAFT: NewDraft = { workerId: '', locationId: '', start: '', end: '' }

/** Message keys for the hand-entry drawer. */
type NewErrorMessage =
  | 'errorWorkerRequired'
  | 'errorLocationRequired'
  | 'errorStartRequired'
  | 'errorEndRequired'
  | 'errorStartInvalid'
  | 'errorEndInvalid'
  | 'errorEndBeforeStart'
  | 'errorFuture'
  | 'errorOverlapUnknown'
  | 'errorCreateRejected'

type NewFieldErrors = {
  worker?: NewErrorMessage
  location?: NewErrorMessage
  start?: NewErrorMessage
  end?: NewErrorMessage
}

const WORKER_ALL = 'all'
const LOCATION_ALL = 'all'

/**
 * The submit button lives in the drawer's footer and the fields in its body, so the two are
 * tied together by `form=` rather than by nesting. Constant ids, not `useId()`: only one
 * drawer is ever open, and an IDREF is easier to read in a DOM inspector than `:r7:`.
 */
/** Where a building (and its tag URL) is created, and where a worker is. The day-zero
 *  empty state names both preconditions, so it links to both. */
const BUILDINGS_PATH = '/locations/'
const WORKERS_PATH = '/workers/'

const CORRECT_FORM_ID = 'shift-correct-form'
const CREATE_FORM_ID = 'shift-create-form'

/** How many rows „Zu entscheiden" names before it stops listing and starts counting. */
const TRIAGE_ROWS = 8

/**
 * The seven sortable columns, in the order they are printed. Each `column` is a key of both
 * `SHIFT_SORTS` (lib/filters.ts) and `SHIFT_SORT` (server/routes/admin.js) — one vocabulary,
 * three files. The actions column is not here: there is nothing to sort a button by.
 */
const SORTABLE_COLUMNS = [
  { column: 'worker', label: 'colWorker' },
  { column: 'location', label: 'colLocation' },
  { column: 'start', label: 'colStart' },
  { column: 'end', label: 'colEnd' },
  { column: 'duration', label: 'colDuration' },
  { column: 'state', label: 'colState' },
  { column: 'origin', label: 'colOrigin' },
] as const satisfies readonly { column: ShiftSort; label: string }[]

/**
 * One sortable column heading.
 *
 * THE HEADING'S TEXT MUST STAY EXACTLY THE COLUMN NAME, and that is a hard constraint rather
 * than a preference: ResponsiveTableLabels copies `thead th` textContent onto every cell as
 * the card caption below 1280px, and demo/audit-band-shape.mjs compares those captions to the
 * headings at six widths. An arrow glyph or a `visually-hidden` „aufsteigend sortiert“ inside
 * the `th` would print on every card and go red. So the direction indicator is a CSS `::after`
 * on `th[aria-sort]` (globals.css), and `aria-sort` carries it for a screen reader — which is
 * the correct mechanism for a sorted column anyway, not a workaround.
 *
 * Clicking the ALREADY sorted column flips the direction; clicking a new one starts at the
 * direction that column is useful in — newest first for a time, A–Z for a name.
 */
function SortHeader({
  column,
  label,
  sort,
  dir,
  onSort,
  hint,
}: {
  column: ShiftSort
  label: string
  sort: ShiftSort
  dir: SortDir
  onSort: (column: ShiftSort, dir: SortDir) => void
  hint: string
}) {
  const active = sort === column
  const next: SortDir = active
    ? dir === 'asc'
      ? 'desc'
      : 'asc'
    : column === 'worker' || column === 'location'
      ? 'asc'
      : 'desc'
  return (
    <th scope="col" aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className="th-sort" onClick={() => onSort(column, next)} title={hint}>
        {label}
      </button>
    </th>
  )
}

const ROW_CLASS: Record<ShiftState, string | undefined> = {
  open: 'is-open',
  unresolved: 'is-unres',
  resolved: 'is-corr',
  // A finished, payable shift is the normal case and gets no rule. Everything cannot be
  // highlighted; if it is, nothing is.
  complete: undefined,
}

const BADGE: Record<ShiftState, BadgeState> = {
  open: 'open',
  unresolved: 'unres',
  resolved: 'corr',
  complete: 'muted',
}

function draftOf(shift: Shift): Draft {
  return {
    id: shift.id,
    workerId: shift.worker_id,
    locationId: shift.location_id,
    start: toBusinessInput(shift.start_time),
    end: shift.end_time === null ? '' : toBusinessInput(shift.end_time),
    original: shift,
  }
}

export default function ShiftsPage() {
  const t = useTranslations('shifts')
  const tFilter = useTranslations('filters')
  const tError = useTranslations('error')
  const format = useFormatter()
  const router = useRouter()

  const workerFilterId = useId()
  const locationFilterId = useId()
  const periodFilterId = useId()
  const periodRangeId = useId()
  const startId = useId()
  const endId = useId()
  const editWorkerId = useId()
  const editLocationId = useId()

  const newWorkerId = useId()
  const newLocationId = useId()
  const newStartId = useId()
  const newEndId = useId()

  // null = still loading. An empty list is a legitimate first-run state, not an error.
  const [snapshot, setSnapshot] = useState<ShiftSnapshot | null>(null)
  const [loadError, setLoadError] = useState<ErrorKey | null>(null)
  // Frozen at mount, so "last 30 days" cannot mean one thing at the top of the table and
  // another at the bottom, and cannot shift under a tab left open overnight.
  const [now] = useState(() => new Date())
  const [draft, setDraft] = useState<Draft | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<ErrorMessage | null>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  const [createOpen, setCreateOpen] = useState(false)
  const [newDraft, setNewDraft] = useState<NewDraft>(EMPTY_NEW_DRAFT)
  const [newFieldErrors, setNewFieldErrors] = useState<NewFieldErrors>({})
  const [newFormError, setNewFormError] = useState<NewErrorMessage | null>(null)
  // The shift the new one collides with, when we can name it. Beats an opaque refusal.
  const [clash, setClash] = useState<Shift | null>(null)
  const [created, setCreated] = useState(false)
  const [creating, setCreating] = useState(false)

  /**
   * THE FILTER CONTRACT (decision-38). This screen is the target of more cross-links than
   * any other in the admin — the dashboard's triage rows, payroll's three caveats, the P&L's
   * flagged buildings, both object panels — and every one of them now arrives with the
   * state that produced it: which building, which person, which period, which condition, and
   * for `?shift=` which exact row to open a correction on.
   *
   * `?period=all` was the first of these and its reason is the reason for all of them: an
   * unresolved shift is usually OLDER than the 30-day default — being old is what made it
   * unresolved — so arriving without a period lands on an empty table, which is the one
   * reading this product must never produce.
   *
   * The parameters ARE the server query (TASK-235/TASK-18), including `?shift=`: at 50 rows a
   * page the row a cross-link names is usually not on page one, so it is sent to Postgres as a
   * filter and the screen opens on exactly that shift. Its own „Schicht: 123 ✕“ chip is the
   * one click back to the whole log. Note this is a change of BEHAVIOUR from the unpaged era,
   * where the drawer opened over the full table.
   */
  const [filters, setFilters] = useFilters()

  /**
   * THE URL IS THE FILTER STATE. There is deliberately no second copy in `useState`: two
   * sources for one filter is how the address bar and the table start disagreeing, and it
   * is what makes the browser's back button appear to do nothing. `filters` is re-read on
   * `popstate`, so back and forward move the table.
   *
   * A ROLLING window is still the default, not the calendar month it used to be: on the 1st
   * of a month a calendar default renders an empty table to a company that worked all of
   * yesterday, and an empty table is exactly what a director reads as data loss.
   */
  const period: Period = filters.period ?? 'last30Days'
  const locationFilter = filters.location ?? LOCATION_ALL
  const workerFilter = filters.worker === null ? WORKER_ALL : String(filters.worker)
  const range = useMemo(() => periodRange(period, now), [period, now])

  /**
   * `?state=` — the condition the link was ABOUT. Payroll says „3 Schichten sind nicht
   * bestätigt" and links here; without this the director arrives at a log of everything and
   * has to find those three by eye, which is the work this contract removes.
   *
   * `noEmail` and `noTag` belong to other screens and are ignored here, silently, as
   * decision-38 §4 requires: a parameter a screen does not understand is not an error. Only
   * the three this screen understands are sent to the server (TASK-235) — the other two
   * fall through to `null`, i.e. no state filter, exactly the old client-side default branch.
   */
  const serverState: 'open' | 'unresolved' | 'manual' | null =
    filters.state === 'open' || filters.state === 'unresolved' || filters.state === 'manual'
      ? filters.state
      : null

  /**
   * WHICH PAGE, AND IN WHAT ORDER — view state, read from the URL like everything else on this
   * screen so a sorted page 3 is a link somebody can send. The defaults reproduce the order
   * this screen has always had (newest first) and are written as `null`, i.e. no parameter, so
   * an unsorted URL stays short and canonical.
   */
  const page = filters.page ?? 1
  const sort: ShiftSort = filters.sort ?? 'start'
  const dir: SortDir = filters.dir ?? 'desc'

  /**
   * Every filter write is a 'replace'. These are CONTROLS on the screen you are already
   * looking at, and pushing a history entry per dropdown twiddle means the back button walks
   * the director through four of them before it leaves the screen. Nobody presses back four
   * times; they close the tab.
   */
  const writeFilters = (patch: Partial<AdminFilters>) =>
    // EVERY filter or sort write drops back to page one. Page 7 of "August, Marta" is not a
    // meaningful position in "September, everyone" — it is an empty table with a pager on it.
    // Spread first so a patch that names `page` (the pager itself) still wins.
    setFilters({ page: null, ...patch }, 'replace')
  const setPeriod = (next: Period) => writeFilters({ period: next })

  /** A dead session must not render an empty table that reads as "no shifts". */
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

  /**
   * THE PAYLOAD IS THE PERIOD AND THE FILTER (TASK-235). `?from=&to=&worker=&location=&state=`
   * go on the SAME `/admin/data` request `/payroll/` already windows by period — see the file
   * header for why the old "fetch everything up to `shift_limit`, filter in the browser"
   * design stopped being honest at scale. Changing any of the four REFETCHES, same as payroll.
   */
  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        setSnapshot(
          await fetchShiftSnapshot(
            {
              range,
              worker: filters.worker,
              location: filters.location,
              state: serverState,
              shift: filters.shift,
              page,
              sort,
              dir,
            },
            signal,
          ),
        )
        setLoadError(null)
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === 'AbortError') return
        if (handleAuthLoss(cause)) return
        setLoadError(cause instanceof ApiError ? cause.messageKey : 'server')
      }
    },
    [
      handleAuthLoss,
      range,
      filters.worker,
      filters.location,
      filters.shift,
      serverState,
      page,
      sort,
      dir,
    ],
  )

  useEffect(() => {
    const controller = new AbortController()
    // The payload IS the selection. Clear it first, or the previous filter's rows stay on
    // screen under the new heading while the request is in flight — the same reason
    // /payroll/ clears its snapshot on every period change.
    setSnapshot(null)
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  const shifts = snapshot?.shifts ?? []

  /**
   * The rows on screen. Already windowed by the period AND narrowed by the worker/building/
   * state filters — the server applied all four to the same query that produced `shifts`, in
   * the same order (`ORDER BY start_time DESC`), so no client-side re-filtering or re-sorting
   * is needed or safe to duplicate: a second opinion here is exactly the kind of drift that
   * put July money beside an empty August table on 3 August 2026 (see /payroll/'s header).
   */
  const visible = shifts

  /**
   * Shifts this worker/building/state filter keeps OUTSIDE the selected period — the number
   * the screen was missing: without it "no rows" cannot be told apart from "everything is
   * gone", and the director has no reason to prefer the harmless reading. Computed by the
   * SERVER now (TASK-235), because the browser no longer holds those rows to count — it asked
   * for the period, not the ledger. See `shift_outside_count` in server/routes/admin.js.
   */
  const outsideCount = snapshot?.shift_outside_count ?? 0

  /**
   * The newest shift in the WHOLE ledger — not bounded by this period, not narrowed by any
   * filter, and not capped by the row limit — and the period that would show it. The
   * one-click escape from an empty table, and the sentence that proves the records are still
   * there.
   */
  const latestStart = snapshot?.shift_bounds.latest ?? null
  const latest = latestStart === null ? null : periodContaining(latestStart, now)
  const latestPeriod = latest === 'all' || latest === period ? null : latest

  /**
   * The shifts ON THIS PAGE the payroll total will silently leave out. Used ONLY to build the
   * triage list, which can name no row it does not hold. Every COUNT the screen states comes
   * from `blockedCount` below — see the file header.
   */
  const blocked = visible.filter((shift) => blocksPayroll(shiftState(shift)))

  /**
   * How many rows the period and the filter keep in total, and how many of those hold up
   * payroll. Both counted by Postgres over the WHOLE window, so paging cannot quietly turn
   * „40 halten die Abrechnung auf“ into „2“ by looking only at the rows in hand.
   */
  const matchingCount = snapshot?.shift_matching_count ?? 0
  const blockedCount = snapshot?.shift_blocked_count ?? 0
  const pageCount = Math.max(1, Math.ceil(matchingCount / SHIFT_PAGE_SIZE))

  /**
   * Opening a correction. There is no focus bookkeeping here on purpose: <Drawer> moves
   * focus in, traps it, and returns it to the control that opened it — and when a save
   * removes that control (a resolved shift leaves the triage list) lib/useOverlay.ts falls
   * back to #main-content instead of dropping the keyboard user on <body>.
   */
  function startCorrection(shift: Shift) {
    setCreateOpen(false)
    setDraft(draftOf(shift))
    setFieldErrors({})
    setFormError(null)
    setSaved(false)
  }

  function closeCorrection() {
    setDraft(null)
    setFieldErrors({})
    setFormError(null)
  }

  function openCreate() {
    setDraft(null)
    setNewFieldErrors({})
    setNewFormError(null)
    setClash(null)
    setCreated(false)
    setCreateOpen(true)
  }

  function closeCreate() {
    setCreateOpen(false)
    setNewFieldErrors({})
    setNewFormError(null)
    setClash(null)
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

    const start = fromBusinessInput(draft.start)
    const end = fromBusinessInput(draft.end)

    // Client-side validation is UX only — server/lib/validate.js decides for real.
    const errors: FieldErrors = {}
    if (draft.start.trim() === '') errors.start = 'errorStartRequired'
    else if (start === null) errors.start = 'errorStartInvalid'
    if (draft.end.trim() !== '' && end === null) errors.end = 'errorEndInvalid'
    if (start !== null && end !== null && new Date(end) <= new Date(start)) {
      errors.end = 'errorEndBeforeStart'
    }
    if (start !== null && new Date(start).getTime() > Date.now()) errors.start = 'errorFuture'
    if (end !== null && new Date(end).getTime() > Date.now()) errors.end = 'errorFuture'
    setFieldErrors(errors)
    setFormError(null)
    setSaved(false)
    if (Object.keys(errors).length > 0 || start === null) return

    // Only changed fields go on the wire: worker_id and location_id are re-validated
    // against ACTIVE rows, so resending an unchanged reference to a deactivated worker
    // or building would fail an edit that has nothing to do with either.
    const patch: ShiftPatch = {}
    if (start !== draft.original.start_time) patch.start_time = start
    if (end !== draft.original.end_time) patch.end_time = end
    if (draft.workerId !== draft.original.worker_id) patch.worker_id = draft.workerId
    if (draft.locationId !== draft.original.location_id) patch.location_id = draft.locationId

    setBusy(true)
    try {
      await updateShift(draft.id, patch)
      // The drawer closes and <Drawer> restores focus; the result is announced by the
      // PAGE's live region, which is still on screen after the drawer is gone.
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
   * Every timestamp on this screen, in Vienna time. Passed explicitly rather than left to
   * the browser, so the table and the two drawers cannot disagree by an hour.
   */
  function showDateTime(iso: string): string {
    return format.dateTime(new Date(iso), {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: BUSINESS_TIME_ZONE,
    })
  }

  function showTime(iso: string): string {
    return format.dateTime(new Date(iso), {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: BUSINESS_TIME_ZONE,
    })
  }

  /** File a shift that was never tapped. Its own drawer, its own validation rules. */
  async function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (creating) return

    const workerId = Number(newDraft.workerId)
    const start = fromBusinessInput(newDraft.start)
    const end = fromBusinessInput(newDraft.end)

    // Client-side validation is UX only — server/lib/validate.js decides for real.
    const errors: NewFieldErrors = {}
    if (!Number.isInteger(workerId) || workerId <= 0) errors.worker = 'errorWorkerRequired'
    if (newDraft.locationId === '') errors.location = 'errorLocationRequired'
    if (newDraft.start.trim() === '') errors.start = 'errorStartRequired'
    else if (start === null) errors.start = 'errorStartInvalid'
    // Required, unlike a correction: POST /admin/shifts refuses to open a shift by hand.
    if (newDraft.end.trim() === '') errors.end = 'errorEndRequired'
    else if (end === null) errors.end = 'errorEndInvalid'
    if (start !== null && end !== null && new Date(end) <= new Date(start)) {
      errors.end = 'errorEndBeforeStart'
    }
    if (start !== null && new Date(start).getTime() > Date.now()) errors.start = 'errorFuture'
    if (end !== null && new Date(end).getTime() > Date.now()) errors.end = 'errorFuture'

    setNewFormError(null)
    setClash(null)
    setCreated(false)

    // Named collision check before the round trip: the server answers 409 either way, but
    // its body cannot reach here (ApiError carries no server text), and "Anna is already
    // recorded at Neuhaus 09:00–13:00" is the only version the director can act on.
    if (Object.keys(errors).length === 0 && start !== null && end !== null) {
      const existing = overlappingShift(shifts, workerId, start, end)
      if (existing !== null) {
        setNewFieldErrors({})
        setClash(existing)
        return
      }
    }

    setNewFieldErrors(errors)
    if (Object.keys(errors).length > 0 || start === null || end === null) return

    setCreating(true)
    try {
      await createShift({
        worker_id: workerId,
        location_id: newDraft.locationId,
        start_time: start,
        end_time: end,
      })
      setNewDraft(EMPTY_NEW_DRAFT)
      setCreateOpen(false)
      setCreated(true)
      await load()
    } catch (cause) {
      if (handleAuthLoss(cause)) return
      if (cause instanceof ApiError && cause.status === 409) {
        // The clashing shift is outside the page we hold, so it cannot be named.
        setNewFormError('errorOverlapUnknown')
      } else if (cause instanceof ApiError && cause.status >= 400 && cause.status < 500) {
        setNewFormError('errorCreateRejected')
      } else {
        setLoadError(cause instanceof ApiError ? cause.messageKey : 'server')
      }
    } finally {
      setCreating(false)
    }
  }

  const periodLabel: Record<Period, string> = {
    last30Days: t('periodLast30Days'),
    thisMonth: t('periodThisMonth'),
    lastMonth: t('periodLastMonth'),
    thisQuarter: t('periodThisQuarter'),
    thisYear: t('periodThisYear'),
    all: t('periodAll'),
  }

  /** `1. Juli 2026 bis 31. Juli 2026`. The range is half-open, so the last day is one ms back. */
  const showDay = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: 'long', timeZone: BUSINESS_TIME_ZONE })
  const rangeLabel =
    range.from === null || range.to === null
      ? t('rangeAll')
      : t('rangeLabel', {
          from: showDay(range.from),
          to: showDay(new Date(new Date(range.to).getTime() - 1).toISOString()),
        })

  const stateLabel: Record<ShiftState, string> = {
    open: t('stateOpen'),
    unresolved: t('stateUnresolved'),
    resolved: t('stateResolved'),
    complete: t('stateComplete'),
  }

  const clashText =
    clash === null
      ? ''
      : t('errorOverlap', {
          worker: clash.worker_name,
          location: clash.location_name,
          from: showDateTime(clash.start_time),
          to: clash.end_time === null ? t('endMissing') : showDateTime(clash.end_time),
        })

  const correctErrorText = formError === null ? '' : t(formError)
  // One refusal, whichever applies, in one sentence.
  const createErrorText = `${clashText} ${newFormError === null ? '' : t(newFormError)}`.trim()

  /**
   * THE PAGE'S OWN LIVE REGIONS, and they are not inside either drawer on purpose: Escape
   * closes a drawer at any moment, including mid-save, and a message that leaves with the
   * thing it is reporting on has not been read. The drawers repeat the refusal visually
   * (aria-hidden, so it is announced once) because a drawer is the whole screen on a phone
   * and a refusal nobody can see is a refusal nobody can act on.
   */
  const pageErrorText = [
    loadError === null ? null : tError(loadError),
    correctErrorText === '' ? null : correctErrorText,
    createErrorText === '' ? null : createErrorText,
  ]
    .filter((part) => part !== null)
    .join(' ')

  const pageStatusText = [saved ? t('saved') : null, created ? t('createSaved') : null]
    .filter((part) => part !== null)
    .join(' ')

  /**
   * „Zu entscheiden": one row per shift that is holding up the payroll, named, with the
   * decision one click away. NOT a table — these are not columns that line up, they are
   * things to be dealt with. The full log below still lists every one of them.
   */
  const triage: AttentionItem[] = blocked.slice(0, TRIAGE_ROWS).map((shift) => {
    const state = shiftState(shift)
    return {
      id: String(shift.id),
      who: shift.worker_name,
      where:
        state === 'open'
          ? t('rowOpen', { location: shift.location_name, time: showTime(shift.start_time) })
          : t('rowUnresolved', {
              location: shift.location_name,
              date: showDateTime(shift.start_time),
            }),
      state: BADGE[state],
      trailing: <StateBadge state={BADGE[state]} label={stateLabel[state]} />,
      openLabel: t('correct'),
      onOpen: () => startCorrection(shift),
    }
  })

  const hasTable = snapshot !== null && visible.length > 0

  /**
   * `?shift=<id>` — open the correction drawer on that row, on arrival. This is what turns
   * „Marta could not clock out" into ONE action from a stairwell instead of a search through
   * a log. Runs once per id: reopening the drawer every render would make it impossible to
   * close, and clearing the parameter on open would break the back button.
   */
  const [linkedShift, setLinkedShift] = useState<number | null>(null)
  useEffect(() => {
    if (snapshot === null || filters.shift === null || filters.shift === linkedShift) return
    setLinkedShift(filters.shift)
    const wanted = snapshot.shifts.find((shift) => shift.id === filters.shift)
    if (wanted !== undefined) {
      setCreateOpen(false)
      setDraft(draftOf(wanted))
      setFieldErrors({})
      setFormError(null)
      setSaved(false)
    }
  }, [snapshot, filters.shift, linkedShift])

  /** A well-formed shift id that is in no loaded row. Said out loud, never ignored. */
  const linkedShiftMissing =
    snapshot !== null &&
    filters.shift !== null &&
    !snapshot.shifts.some((shift) => shift.id === filters.shift)

  const stateLabelOf: Record<'open' | 'unresolved' | 'manual', string> = {
    open: tFilter('stateOpen'),
    unresolved: tFilter('stateUnresolved'),
    manual: tFilter('stateManual'),
  }

  /**
   * The filter, echoed above the fold (decision-38 rule 3). The building and the worker are
   * ALSO in the selects below; the chip is deliberately the redundant copy, because at
   * 390px the filter bar is under the answer band and a filtered table read before it
   * scrolls into view is exactly the „all my data is gone" misreading. The period chip only
   * appears when a link moved it off this screen's own default — „Zeitraum: Letzte 30 Tage"
   * on every visit is noise, and noise is what makes a real chip invisible.
   */
  const chips = [
    filters.location === null
      ? null
      : {
          key: 'location',
          label: tFilter('location'),
          value:
            snapshot?.locations.find((location) => location.id === filters.location)?.name ??
            tFilter('unknownLocation'),
          unknown: snapshot !== null && !snapshot.locations.some((l) => l.id === filters.location),
          onRemove: () => writeFilters({ location: null }),
        },
    filters.worker === null
      ? null
      : {
          key: 'worker',
          label: tFilter('worker'),
          value:
            snapshot?.workers.find((worker) => worker.id === filters.worker)?.name ??
            tFilter('unknownWorker'),
          unknown: snapshot !== null && !snapshot.workers.some((w) => w.id === filters.worker),
          onRemove: () => writeFilters({ worker: null }),
        },
    filters.state === 'open' || filters.state === 'unresolved' || filters.state === 'manual'
      ? {
          key: 'state',
          label: tFilter('state'),
          value: stateLabelOf[filters.state],
          onRemove: () => writeFilters({ state: null }),
        }
      : null,
    filters.period === null || filters.period === 'last30Days'
      ? null
      : {
          key: 'period',
          label: tFilter('period'),
          value: periodLabel[filters.period],
          onRemove: () => writeFilters({ period: null }),
        },
    filters.shift === null
      ? null
      : {
          key: 'shift',
          label: tFilter('shift'),
          value: linkedShiftMissing ? tFilter('unknownShift') : String(filters.shift),
          unknown: linkedShiftMissing,
          onRemove: () => writeFilters({ shift: null }),
        },
  ].filter((chip) => chip !== null)

  return (
    <>
      <PageHeader
        title={t('heading')}
        question={t('question')}
        action={
          <button type="button" className="btn btn-primary" onClick={openCreate}>
            {t('createTitle')}
          </button>
        }
      />

      <p className="form-error" role="alert">
        {pageErrorText}
      </p>
      <p className="form-status" role="status">
        {pageStatusText}
      </p>

      <FilterChips chips={chips} />
      {/* A link that named a shift the payload does not hold. Stated, because the silent
          alternative is a drawer that never opens and a director who thinks he misclicked. */}
      {linkedShiftMissing ? <p className="notice bad">{t('linkedShiftMissing')}</p> : null}

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
        <LoadStatus
          loading={t('loading')}
          error={loadError === null ? null : tError(loadError)}
          retryLabel={tError('retry')}
          onRetry={() => void load()}
        />
      ) : (
        <>
          {/* The answer first: how much of what is on screen the pay total will leave out.
              AnswerBand IS this page's role="status" — it replaces the result sentence and
              must not be wrapped in a second live region. */}
          <AnswerBand
            cells={[
              {
                k: t('answerBlocked'),
                v: blockedCount,
                sub:
                  visible.length === 0
                    ? // A claim about an empty table is a claim about nothing, and saying
                      // "all of them count" over no rows is part of what made the empty
                      // table unreadable in the first place.
                      ''
                    : blockedCount === 0
                      ? t('noneBlocked')
                      : t('notPayable'),
              },
              {
                k: t('answerShown'),
                // „50 von 431“, not „50“. A page count printed alone reads as a period count.
                v: t('shownOfTotal', { shown: visible.length, total: matchingCount }),
                calm: true,
                sub: [
                  rangeLabel,
                  outsideCount === 0 ? null : t('outsideCount', { count: outsideCount }),
                ]
                  .filter((part) => part !== null)
                  .join(' '),
              },
            ]}
          />

          <section aria-labelledby="shift-filters-heading">
            <h2 className="visually-hidden" id="shift-filters-heading">
              {t('filterHeading')}
            </h2>

            {/* No submit: each control filters a list already in memory, so there is nothing
                to wait for and a submit button would only add a step. */}
            <div className="filter-bar">
              <div className="field">
                <label htmlFor={workerFilterId}>{t('filterWorker')}</label>
                <select
                  id={workerFilterId}
                  value={workerFilter}
                  onChange={(event) =>
                    writeFilters({
                      worker: event.target.value === WORKER_ALL ? null : Number(event.target.value),
                    })
                  }
                >
                  <option value={WORKER_ALL}>{t('allWorkers')}</option>
                  {(snapshot?.workers ?? []).map((worker) => (
                    <option key={worker.id} value={String(worker.id)}>
                      {worker.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label htmlFor={locationFilterId}>{t('filterLocation')}</label>
                <select
                  id={locationFilterId}
                  value={locationFilter}
                  onChange={(event) =>
                    writeFilters({
                      location: event.target.value === LOCATION_ALL ? null : event.target.value,
                    })
                  }
                >
                  <option value={LOCATION_ALL}>{t('allLocations')}</option>
                  {(snapshot?.locations ?? []).map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label htmlFor={periodFilterId}>{t('filterPeriod')}</label>
                <select
                  id={periodFilterId}
                  value={period}
                  aria-describedby={periodRangeId}
                  onChange={(event) => {
                    if (isPeriod(event.target.value)) setPeriod(event.target.value)
                  }}
                >
                  {PERIODS.map((value) => (
                    <option key={value} value={value}>
                      {periodLabel[value]}
                    </option>
                  ))}
                </select>
                <p className="field-hint" id={periodRangeId}>
                  {rangeLabel}
                </p>
              </div>
            </div>

            <p className="field-hint">{t('timeZoneHint')}</p>
          </section>

          {triage.length === 0 ? null : (
            <ListPanel title={t('triageHeading')}>
              <AttentionList items={triage} />
            </ListPanel>
          )}

          {blockedCount > triage.length ? (
            <p className="field-hint">{t('triageMore', { count: blockedCount - triage.length })}</p>
          ) : null}

          <ListPanel title={t('listHeading')} padded={!hasTable}>
            {shifts.length === 0 && latestStart === null ? (
              /* DAY ZERO, and the only empty state on this screen that is not about a
                 filter: no shift has ever been recorded, in any period. The sentence names
                 its precondition — „sobald ein Mitarbeiter einen Tag scannt“ — and that
                 needs two things nobody can do from here: a building with a tag URL, and a
                 person who can sign in. So both are offered. Every other empty state below
                 is a FILTER emptying the table and already carries its own way out; this
                 one had none, and it is the screen `/`'s most-used link lands on. */
              <EmptyState>
                {t('emptyBody')} <Link href={BUILDINGS_PATH}>{t('emptyLinkBuilding')}</Link>
                {' · '}
                <Link href={WORKERS_PATH}>{t('emptyLinkWorker')}</Link>
              </EmptyState>
            ) : visible.length === 0 ? (
              /* The empty state that started all of this. It states, in words, how many
                 shifts exist just outside the chosen period and when the most recent one
                 was, and puts the way out one keystroke away. "Nothing here" and
                 "everything is gone" must never render the same. */
              <>
                <EmptyState>
                  {outsideCount === 0
                    ? t('emptyFiltered')
                    : t('emptyOutside', { count: outsideCount })}
                </EmptyState>
                {latestStart === null ? null : (
                  <p className="field-hint">
                    {t('latestRecorded', { date: showDateTime(latestStart) })}
                  </p>
                )}
                {outsideCount === 0 && latestStart === null ? null : (
                  <div className="form-actions">
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => setPeriod('all')}
                    >
                      {t('showAll')}
                    </button>
                    {latestPeriod === null ? null : (
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => setPeriod(latestPeriod)}
                      >
                        {t('jumpToLatest', { period: periodLabel[latestPeriod] })}
                      </button>
                    )}
                  </div>
                )}
              </>
            ) : (
              <table className="data-table" aria-busy={busy || creating}>
                <caption className="visually-hidden">{t('tableCaption')}</caption>
                <thead>
                  <tr>
                    {SORTABLE_COLUMNS.map(({ column, label }) => (
                      <SortHeader
                        key={column}
                        column={column}
                        label={t(label)}
                        sort={sort}
                        dir={dir}
                        onSort={(next, nextDir) => writeFilters({ sort: next, dir: nextDir })}
                        hint={t('sortBy')}
                      />
                    ))}
                    <th scope="col">{t('colActions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((shift) => {
                    const state = shiftState(shift)
                    return (
                      <tr key={shift.id} className={ROW_CLASS[state]}>
                        {/* The two names are the cross-links, so the row gains no column:
                            at 390px a `.data-table` row is a card and a sixth action pushes
                            it sideways. Each carries its own object's id — this is the
                            „read the name here, find it again over there" loop, closed. */}
                        <th scope="row">
                          <Link href={filterHref('/workers/', { worker: shift.worker_id })}>
                            {shift.worker_name}
                            <span className="visually-hidden"> {t('openWorker')}</span>
                          </Link>
                        </th>
                        <td>
                          <Link href={filterHref('/', { location: shift.location_id })}>
                            {shift.location_name}
                            <span className="visually-hidden"> {t('openLocation')}</span>
                          </Link>
                        </td>
                        <td>{showDateTime(shift.start_time)}</td>
                        <td>
                          {shift.end_time === null ? (
                            <span className="cell-muted">{t('endMissing')}</span>
                          ) : (
                            showDateTime(shift.end_time)
                          )}
                        </td>
                        <td>
                          {/* An open shift has no duration yet, and showing one frozen at
                              page load would be a number the admin could not act on. */}
                          {shift.end_time === null ? (
                            <span className="cell-muted">{t('durationRunning')}</span>
                          ) : (
                            formatDuration(durationMinutes(shift.start_time, shift.end_time))
                          )}
                        </td>
                        {/* Words first. The badge tint and the 3px row rule are the second
                            and third signals only — this column has to survive greyscale,
                            a screen reader and a printed page. */}
                        <td>
                          <StateBadge state={BADGE[state]} label={stateLabel[state]} />
                          <span className="shift-state-note">
                            {blocksPayroll(state) ? t('notPayable') : t('payable')}
                          </span>
                        </td>
                        {/* Its own column, in words: an auditor comparing this log against
                            the tap history has to be able to see at a glance which rows a
                            human typed. `client_uuid IS NULL` is the only record of it. */}
                        <td>
                          {isManualEntry(shift) ? (
                            <span className="shift-origin-manual">{t('originManual')}</span>
                          ) : (
                            <span className="shift-origin-tap">{t('originTap')}</span>
                          )}
                          {/* decision-56: one line per END the worker pressed a button for.
                              Both flags set = both lines, so start-only, close-only and
                              both-ends read differently without relying on colour. */}
                          {manualEnds(shift).map((end) => (
                            <span key={end} className="shift-origin-manual shift-manual-end">
                              {end === 'start' ? t('manualStart') : t('manualClose')}
                            </span>
                          ))}
                          {/* TASK-316: the worker's own reason, right under the marker it
                              explains. Absent on a tapped shift and on a manual one where
                              they said nothing — an empty line would read as "no reason
                              given" when the truthful reading is "nothing was asked". */}
                          {shift.manual_note === null ? null : (
                            <span className="shift-manual-end shift-state-note">
                              {t('manualNote', { note: shift.manual_note })}
                            </span>
                          )}
                        </td>
                        <td className="cell-actions">
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => startCorrection(shift)}
                          >
                            {t('correct')}
                            <span className="visually-hidden">
                              {t('forShift', {
                                worker: shift.worker_name,
                                date: showDateTime(shift.start_time),
                              })}
                            </span>
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}

            {/* The pager, and the only disclosure that the table is a window onto something
                bigger. Inline rather than a <Pagination> component: exactly one screen in
                this admin pages. ponytail: extract when a second one does. */}
            {pageCount > 1 ? (
              <nav className="pager" aria-label={t('pagerLabel')}>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={page <= 1}
                  onClick={() => writeFilters({ page: page - 1 <= 1 ? null : page - 1 })}
                >
                  {t('pagePrev')}
                </button>
                <span aria-live="polite">{t('pageOf', { page, pages: pageCount })}</span>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={page >= pageCount}
                  onClick={() => writeFilters({ page: page + 1 })}
                >
                  {t('pageNext')}
                </button>
              </nav>
            ) : null}
          </ListPanel>
        </>
      )}

      {/* DRAWER 1 — correct an existing shift. End time OPTIONAL: clearing it puts the
          shift back to running, which is the only way to undo a wrong auto-close. */}
      <Drawer
        open={draft !== null}
        onClose={closeCorrection}
        title={t('correctHeading')}
        step={
          draft === null
            ? undefined
            : t('correctFor', {
                worker: draft.original.worker_name,
                location: draft.original.location_name,
              })
        }
        busy={busy}
        footer={
          <>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={closeCorrection}
              disabled={busy}
            >
              {t('cancel')}
            </button>
            <button
              type="submit"
              form={CORRECT_FORM_ID}
              className="btn btn-primary"
              disabled={busy}
            >
              {busy ? t('submitting') : t('submitSave')}
            </button>
          </>
        }
      >
        {draft === null ? null : (
          <form id={CORRECT_FORM_ID} onSubmit={onSubmit} noValidate>
            {/* Visual only — the page's role="alert" above does the announcing. */}
            {correctErrorText === '' ? null : (
              <p className="form-error" aria-hidden="true">
                {correctErrorText}
              </p>
            )}

            {/* PATCH /admin/shifts/:id stamps `corrected_at` whenever an edit leaves an
                auto-closed shift with an end time — including an edit that changes nothing.
                Saving here therefore RESOLVES this shift and puts its hours into payroll,
                whether the end time was retyped or accepted as it stands. That is the
                intended way to accept the timer's guess, but it must not be a surprise. */}
            {shiftState(draft.original) === 'unresolved' ? (
              <p className="notice">{t('correctUnresolvedNotice')}</p>
            ) : null}

            <Field
              id={startId}
              label={t('fieldStart')}
              required
              help={t('timeZoneHint')}
              error={fieldErrors.start === undefined ? null : t(fieldErrors.start)}
            >
              <input
                type="datetime-local"
                required
                value={draft.start}
                onChange={(event) => setDraft({ ...draft, start: event.target.value })}
                disabled={busy}
              />
            </Field>

            <Field
              id={endId}
              label={t('fieldEnd')}
              optional
              help={t('endHint')}
              error={fieldErrors.end === undefined ? null : t(fieldErrors.end)}
            >
              <input
                type="datetime-local"
                value={draft.end}
                onChange={(event) => setDraft({ ...draft, end: event.target.value })}
                disabled={busy}
              />
            </Field>

            {/* Only ACTIVE rows are offered: the server rejects a shift pointed at a
                deactivated worker or building. The current one is listed regardless so
                the select can show what the shift actually says today. */}
            <Field id={editWorkerId} label={t('fieldWorker')}>
              <select
                value={String(draft.workerId)}
                onChange={(event) => setDraft({ ...draft, workerId: Number(event.target.value) })}
                disabled={busy}
              >
                {(snapshot?.workers ?? [])
                  .filter((worker) => worker.active || worker.id === draft.original.worker_id)
                  .map((worker) => (
                    <option key={worker.id} value={String(worker.id)}>
                      {worker.active ? worker.name : t('inactiveOption', { name: worker.name })}
                    </option>
                  ))}
              </select>
            </Field>

            <Field id={editLocationId} label={t('fieldLocation')}>
              <select
                value={draft.locationId}
                onChange={(event) => setDraft({ ...draft, locationId: event.target.value })}
                disabled={busy}
              >
                {(snapshot?.locations ?? [])
                  .filter(
                    (location) => location.active || location.id === draft.original.location_id,
                  )
                  .map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.active
                        ? location.name
                        : t('inactiveOption', { name: location.name })}
                    </option>
                  ))}
              </select>
            </Field>
          </form>
        )}
      </Drawer>

      {/* DRAWER 2 — file a shift that was never tapped. End time REQUIRED, because
          POST /admin/shifts refuses to open a shift by hand. A SEPARATE drawer from the
          correction above, and not the same one behind a flag: that is how these two rules
          drift apart. */}
      <Drawer
        open={createOpen}
        onClose={closeCreate}
        title={t('createTitle')}
        busy={creating}
        footer={
          <>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={closeCreate}
              disabled={creating}
            >
              {t('cancel')}
            </button>
            <button
              type="submit"
              form={CREATE_FORM_ID}
              className="btn btn-primary"
              disabled={creating}
            >
              {creating ? t('submitting') : t('submitCreate')}
            </button>
          </>
        }
      >
        <form id={CREATE_FORM_ID} onSubmit={onCreate} noValidate>
          {/* Visual only — the page's role="alert" above does the announcing. */}
          {createErrorText === '' ? null : (
            <p className="form-error" aria-hidden="true">
              {createErrorText}
            </p>
          )}

          <p>{t('createIntro')}</p>

          {/* Said BEFORE the fields, not after them: what this button produces is a shift
              marked as hand-entered forever, and that is not something to discover later. */}
          <p className="notice">{t('createManualNotice')}</p>

          {/* ACTIVE rows only: the server refuses a shift pointed at a deactivated worker
              or building, and there is no existing value to preserve on a new shift. */}
          <Field
            id={newWorkerId}
            label={t('fieldWorker')}
            required
            error={newFieldErrors.worker === undefined ? null : t(newFieldErrors.worker)}
          >
            <select
              required
              value={newDraft.workerId}
              onChange={(event) => setNewDraft({ ...newDraft, workerId: event.target.value })}
              disabled={creating}
            >
              <option value="">{t('choosePlaceholder')}</option>
              {(snapshot?.workers ?? [])
                .filter((worker) => worker.active)
                .map((worker) => (
                  <option key={worker.id} value={String(worker.id)}>
                    {worker.name}
                  </option>
                ))}
            </select>
          </Field>

          <Field
            id={newLocationId}
            label={t('fieldLocation')}
            required
            error={newFieldErrors.location === undefined ? null : t(newFieldErrors.location)}
          >
            <select
              required
              value={newDraft.locationId}
              onChange={(event) => setNewDraft({ ...newDraft, locationId: event.target.value })}
              disabled={creating}
            >
              <option value="">{t('choosePlaceholder')}</option>
              {(snapshot?.locations ?? [])
                .filter((location) => location.active)
                .map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
            </select>
          </Field>

          <Field
            id={newStartId}
            label={t('fieldStart')}
            required
            help={t('timeZoneHint')}
            error={newFieldErrors.start === undefined ? null : t(newFieldErrors.start)}
          >
            <input
              type="datetime-local"
              required
              value={newDraft.start}
              onChange={(event) => setNewDraft({ ...newDraft, start: event.target.value })}
              disabled={creating}
            />
          </Field>

          <Field
            id={newEndId}
            label={t('fieldEnd')}
            required
            error={newFieldErrors.end === undefined ? null : t(newFieldErrors.end)}
          >
            <input
              type="datetime-local"
              required
              value={newDraft.end}
              onChange={(event) => setNewDraft({ ...newDraft, end: event.target.value })}
              disabled={creating}
            />
          </Field>
        </form>
      </Drawer>
    </>
  )
}
