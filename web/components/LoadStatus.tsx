'use client'

/**
 * The `role="status"` fallback a screen renders while it has no data yet: "loading" if
 * nothing has failed, the error sentence AND a retry control if something has.
 *
 * Before this, `/payroll/`, `/shifts/`, `/pl/` and `/locations/` rendered the error text
 * here with no control attached to it — "Bitte versuchen Sie es noch einmal" instructing a
 * director to do something the screen gave him no way to do. The only ways to retry were
 * changing a filter (which most people would not think to do on a screen that is not about
 * filters) or reloading the page (which, before the phone nav-strip fix, landed him on a
 * blank screen). C5 / PHONE #5, LOOK.md / LOOK-PHONE.md.
 *
 * One component so the four screens that fetch their OWN page say and do the same thing
 * here, rather than four near-identical hand-written retry buttons drifting apart. `/`
 * already has this covered by its own always-visible header "Aktualisieren" button.
 */
export function LoadStatus({
  loading,
  error,
  retryLabel,
  onRetry,
}: {
  loading: string
  error: string | null
  retryLabel: string
  onRetry: () => void
}) {
  return (
    <p role="status">
      {error === null ? (
        loading
      ) : (
        <>
          {error}{' '}
          <button type="button" className="btn btn-ghost" onClick={onRetry}>
            {retryLabel}
          </button>
        </>
      )}
    </p>
  )
}
