import { checkLoginRate, recordLoginFailure } from "../lib/auth.js";
import { all, query } from "../lib/db.js";
import { fail } from "../lib/http.js";
import * as v from "../lib/validate.js";

async function requestTrial({ body, ip }) {
  // Count every submission, including successful and invalid requests. Separate
  // namespace so lead spam cannot lock out an administrator or worker login.
  const bucket = `trial-request:${ip}`;
  checkLoginRate(bucket);
  recordLoginFailure(bucket);
  const email = v.identityEmail(body.email, "email");
  if (!email) fail(400, "invalid_email");
  const company = v.str(body.company, "company");
  const locale = v.oneOf(body.locale ?? "de", "locale", ["de", "en"]);
  await query(
    `INSERT INTO trial_requests (email,company,locale) VALUES ($1,$2,$3)
    ON CONFLICT (email) DO NOTHING`,
    [email, company, locale],
  );
  // Same result for a retry: never disclose whether an email already exists.
  return { status: 202, body: { ok: true } };
}

async function listRequests() {
  const requests = await all(
    "SELECT id,email,company,locale,created_at FROM trial_requests ORDER BY id DESC LIMIT 200",
  );
  return { status: 200, body: { requests } };
}

export const trialRequestRoutes = [
  {
    method: "POST",
    path: "/public/trial-requests",
    auth: null,
    bootstrap: true,
    handler: requestTrial,
  },
  {
    method: "GET",
    path: "/platform/trial-requests",
    auth: "platform",
    handler: listRequests,
  },
];
