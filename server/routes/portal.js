// Client portal. ONE route, unauthenticated, PUBLIC TRUST BOUNDARY.
//
// The point of contact at a client company asks one question — "was my building cleaned,
// by whom, for how long?" — and this answers exactly that, for exactly the ONE building
// they were granted, and nothing else.
//
// ponytail: A SHAREABLE LINK IS THE WHOLE AUTH MODEL.
//   The token in the URL IS the credential. No session, no cookie, no login, no account.
//   WHY: accounts would mean the cleaning-company director administering passwords for
//   other companies' staff (they will not do it, and it is not their job), and a
//   magic-link flow would mean running SMTP on the VM — a mail server, a domain
//   reputation and a bounce queue we do not have and cannot support.
//   CEILING: anyone holding the link sees that building's cleaning history. The link WILL
//   be forwarded, screenshotted and pasted into a group chat; assume it already has been.
//   ACCEPTABLE because the payload below is deliberately minimal and the grant is
//   revocable in one click (DELETE /admin/portal-grants/:token_hash).
//   UPGRADE PATH if that stops being acceptable: real contact accounts keyed on
//   contacts.id + magic-link email. This route becomes the legacy path.
//
// WHAT THIS ROUTE MUST NEVER EXPOSE — the client is an OUTSIDER, not staff:
//   worker surname, worker email, worker phone, apple_sub, hourly_rate_cents,
//   any other building, any client, any contract figure, any inventory item,
//   shift ids, worker ids, location ids (nothing enumerable at all).
//
// GDPR (Austria/EU, real employees): a first name plus a duration is the MINIMUM that
// answers the client's question, and the minimum is the lawful amount. A surname turns
// "the building was cleaned for 90 minutes" into an identified performance record held by
// a third party who has no basis for it. DO NOT ENRICH THIS PAYLOAD. If a future request
// is "the client wants to know which team", the answer is a team label, not a full name.
import { randomBytes } from "node:crypto";
import { checkLoginRate, hashToken, recordLoginFailure } from "../lib/auth.js";
import { all, one } from "../lib/db.js";
import { fail } from "../lib/http.js";

// 32 bytes of CSPRNG output, base64url => 43 URL-safe characters, no percent-encoding and
// nothing that breaks when the director pastes the link into WhatsApp.
const TOKEN_BYTES = 32;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

// How much history the client sees. Enough to show a pattern, not enough to be a dataset.
const RECENT_CLEANINGS = 20;

// The company is in Vienna and so is every building (decision context, not a guess): the
// client reads "cleaned on the 14th" in their own calendar day, not in UTC. Hardcoded
// rather than made configurable — one city, one timezone, and a wrong-by-two-hours date
// at 23:30 is a support call.
const TZ = "Europe/Vienna";

export function newPortalToken() {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export const portalPath = (token) => `/portal/${token}`;

/**
 * GET /portal/:token -> { building: { name }, cleanings: [{ date, first_name, minutes }] }
 *
 * A REVOKED token and an UNKNOWN token answer 404 not_found IDENTICALLY, with no field,
 * no message and no timing difference worth measuring: "this link used to work" is itself
 * information about our client relationships.
 *
 * The token is NEVER logged. server.js redacts it from the 500 log line, which is the only
 * place a request path is written out.
 */
async function portalView({ params, ip }) {
  // The existing login limiter, in its own bucket. A public unauthenticated route that
  // hits Postgres once per call is a free DoS lever otherwise, and 43 base64url characters
  // are not brute-forceable but a flood of misses still costs us a query each. The
  // `portal:` prefix keeps a stranger guessing links from locking the director out of
  // /admin/login from a shared office address.
  const bucket = `portal:${ip}`;
  checkLoginRate(bucket);

  const token = params.token;
  if (typeof token !== "string" || !TOKEN_RE.test(token)) {
    // Shape-check before SQL: a garbage path segment is not worth a round trip.
    recordLoginFailure(bucket);
    fail(404, "not_found");
  }

  // location_id comes from the GRANT ROW, never from the request. There is therefore no
  // parameter an outsider can tamper with to see a different building — the link they hold
  // is the only building they can name.
  const grant = await one(
    `SELECT g.location_id, l.name
       FROM portal_grants g
       JOIN locations l ON l.id = g.location_id
      WHERE g.token_hash = $1 AND g.revoked_at IS NULL`,
    [hashToken(token)],
  );
  if (!grant) {
    recordLoginFailure(bucket);
    fail(404, "not_found");
  }

  // Completed cleanings only, and NOT the ones the 8h timer guessed at and nobody has
  // confirmed yet (decision-10) — the same predicate payroll uses. A start+8h stub is a
  // placeholder, and telling a client "we cleaned for 8 hours" when we do not know that is
  // worse than telling them nothing.
  //
  // split_part(name, ' ', 1) is the first name. Deliberately crude: it is the whole
  // minimisation. Nothing here selects s.id, w.id or l.id, so there is nothing in the
  // response to enumerate.
  const cleanings = await all(
    `SELECT to_char(s.end_time AT TIME ZONE $3, 'YYYY-MM-DD')          AS date,
            split_part(btrim(w.name), ' ', 1)                          AS first_name,
            (EXTRACT(EPOCH FROM (s.end_time - s.start_time)) / 60)::int AS minutes
       FROM shifts s
       JOIN workers w ON w.id = s.worker_id
      WHERE s.location_id = $1
        AND s.end_time IS NOT NULL
        AND NOT (s.auto_closed AND s.corrected_at IS NULL)
      ORDER BY s.end_time DESC
      LIMIT $2`,
    [grant.location_id, RECENT_CLEANINGS, TZ],
  );

  return { status: 200, body: { building: { name: grant.name }, cleanings } };
}

export const portalRoutes = [{ method: "GET", path: "/portal/:token", auth: null, handler: portalView }];
