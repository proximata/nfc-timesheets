import type { Worker } from '@/lib/api'

/**
 * What the workers screen says about one person's enrolment code (decision-26).
 *
 * Derived from the ONLY two facts the server discloses — `enrolment_code_expires_at` and
 * `enrolment_code_redeemed_at`. The code itself is a digest on the server and is handed
 * back exactly once, at creation, so this is all a screen can ever know about it.
 *
 * `none` covers two histories that are genuinely indistinguishable here: never issued, and
 * issued then revoked. Revoking clears the expiry and leaves nothing behind, which is the
 * point — both mean "there is no code this person could type right now", and that is the
 * only thing the director can act on. The audit trail of who issued what lives in the
 * database and is deliberately not part of this payload.
 */
export type CodeState = 'none' | 'live' | 'expired' | 'redeemed'

/**
 * `now` is passed in rather than read, so the screen can re-evaluate on a timer: a code
 * lives one hour, and a panel that still reads "valid until 15:32" at 15:40 answers the
 * one question this column exists for — "did I already send Ivan a code?" — wrongly.
 */
export function codeStateOf(
  worker: Pick<Worker, 'enrolment_code_expires_at' | 'enrolment_code_redeemed_at'>,
  now: number,
): CodeState {
  if (worker.enrolment_code_expires_at !== null) {
    // An expiry with no hash cannot exist (the CHECK constraint in migration 004), so a
    // date here is a real code and only the clock decides whether it still works.
    return Date.parse(worker.enrolment_code_expires_at) > now ? 'live' : 'expired'
  }
  return worker.enrolment_code_redeemed_at === null ? 'none' : 'redeemed'
}
