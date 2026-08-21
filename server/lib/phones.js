// WHAT A PHONE IS STILL HOLDING (TASK-225, migration 009).
//
// A cleaner taps in with no signal. The row is written on the phone and delivered later
// by a background job. That is the delivery half and it needs no server code at all.
//
// This is the OTHER half — the one the office cannot get any other way:
//
//     "Anna has filed nothing since Tuesday. Is she off sick, or is her phone holding
//      three shifts in a basement?"
//
// Both answers used to produce identical evidence: no rows. Now the phone says so, on
// every request it already makes, in three headers.
//
// WHY HEADERS AND NOT AN ENDPOINT, spelled out because it is load-bearing:
//   - no extra round trip, so nothing new sits on the clock-in path;
//   - an OLDER SERVER IGNORES THEM. Every HTTP server drops request headers it does not
//     know, silently. So an app newer than the box degrades to exactly today's behaviour
//     instead of failing — no version negotiation, no feature flag, no dead phone.
//
// NOTHING HERE MAY EVER FAIL A REQUEST. It is called fire-and-forget from the dispatcher
// (server.js) with its promise deliberately unawaited: a clock-in must not get slower or
// more fragile because the office wanted a number. Every path below either writes or
// returns, and none throws.
import { query } from "./db.js";

// A phone reporting 40 000 pending shifts is a phone with a bug or a header somebody
// typed by hand. Clamped rather than rejected: the honest floor of "something is very
// wrong here" is a big number the panel will show, not a dropped heartbeat.
const MAX_PENDING = 10_000;

/** @returns {number|null} null when the header is absent or is not a plain integer. */
function count(raw) {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  if (!/^\d{1,6}$/.test(raw.trim())) return null;
  return Math.min(Number(raw.trim()), MAX_PENDING);
}

/**
 * @returns {Date|null} null for absent, malformed, or a date far enough out that it is a
 *          broken phone clock rather than a fact. A wrong timestamp on this column would
 *          be read as "work done in 2087 is still undelivered", which is worse than none.
 */
function when(raw) {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const at = new Date(raw.trim());
  if (Number.isNaN(at.getTime())) return null;
  const skew = at.getTime() - Date.now();
  if (skew > 24 * 60 * 60 * 1000) return null; // more than a day in the future: a bad clock
  return at;
}

/**
 * Record what this worker's phone just told us.
 *
 * TWO DIFFERENT WRITES ON PURPOSE:
 *
 *   - headers present -> record the counts AND the last-seen moment.
 *   - headers absent  -> record ONLY the last-seen moment. A client that does not report
 *     (an iOS build, a curl, an older Android) must not zero a real Android count merely
 *     by existing. "We heard from this phone" is a fact independent of what it had to say,
 *     and it is the fact that separates "absent" from "phone in a pocket".
 *
 * @param {number} workerId from the SESSION, never from a body (decision-22).
 * @param {Record<string,string|string[]|undefined>} headers raw node request headers.
 */
export async function recordPhoneHeartbeat(workerId, headers) {
  const waiting = count(headers["x-pending-shifts"]);
  const blocked = count(headers["x-pending-blocked"]);

  if (waiting === null && blocked === null) {
    await query("UPDATE workers SET phone_last_seen_at = now() WHERE id = $1", [workerId]);
    return;
  }

  // X-Pending-Oldest is omitted, never sent empty, when there is nothing pending — so a
  // NULL here is a statement ("nothing outstanding"), not a missing value, and it is
  // written as NULL rather than left standing at yesterday's date.
  await query(
    `UPDATE workers
        SET phone_last_seen_at         = now(),
            phone_pending_shifts       = $2,
            phone_pending_blocked      = $3,
            phone_pending_oldest_start = $4
      WHERE id = $1`,
    [workerId, waiting ?? 0, blocked ?? 0, when(headers["x-pending-oldest"])],
  );
}
