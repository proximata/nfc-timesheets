// Material requests: the one shape and the one lifecycle, shared by the worker routes
// (routes/app.js) and the admin route (routes/admin.js).
//
// It lives here rather than in either route file for the same reason ADMIN_SHIFT_COLS
// exists: a field returned by one side and silently missing from the other is a bug the
// type system will not catch, and "which statuses may follow which" written down twice is
// written down wrong once.
import { fail } from "./http.js";

// What a request looks like on the wire. `decided_by` is an admin id and stays server-side
// only in the sense that a worker has no use for it — it is not a credential, and the
// admin panel needs it to say who approved what. Nothing here is secret; the free-text
// `body` is the worker's own words and is never logged (server.js logs paths only, and
// lib/scrub.js deletes request bodies before anything reaches Sentry).
export const MATERIAL_REQUEST_FIELDS = [
  "id",
  "worker_id",
  "location_id",
  "body",
  "status",
  "admin_note",
  "inventory_item_id",
  "quantity",
  "cost_cents",
  "decided_by",
  "decided_at",
  "ordered_at",
  "arrived_at",
  "seen_at",
  "created_at",
];

export const MATERIAL_REQUEST_COLS = MATERIAL_REQUEST_FIELDS.join(", ");
export const M_MATERIAL_REQUEST_COLS = MATERIAL_REQUEST_FIELDS.map((c) => `m.${c}`).join(", ");

/**
 * THE LIFECYCLE, as an explicit table.
 *
 * A client never assigns `status` freely. The admin says "approve this" and the server
 * decides whether that is legal from where the row currently is — otherwise a panel bug,
 * a double-clicked button or a replayed request can move a request straight from
 * `submitted` to `arrived` and put a cost into a period nobody ever ordered anything in.
 *
 * `arrived` and `rejected` are TERMINAL. There is no un-reject: the worker asks again, and
 * the refusal stays in the history where a dispute can find it.
 */
export const MATERIAL_TRANSITIONS = {
  submitted: ["approved", "rejected"],
  approved: ["ordered", "rejected"],
  ordered: ["arrived"],
  arrived: [],
  rejected: [],
};

export const MATERIAL_STATUSES = Object.keys(MATERIAL_TRANSITIONS);

/** Statuses still awaiting somebody. Derived from the table above, never a second list. */
export const MATERIAL_OPEN_STATUSES = MATERIAL_STATUSES.filter((s) => MATERIAL_TRANSITIONS[s].length > 0);

/**
 * 409 with the two statuses named, so the panel can say "already ordered" instead of an
 * opaque failure the director cannot act on.
 */
export function assertTransition(current, next) {
  if (!MATERIAL_TRANSITIONS[current]?.includes(next)) {
    fail(409, "invalid_transition", `${current}->${next}`);
  }
}
