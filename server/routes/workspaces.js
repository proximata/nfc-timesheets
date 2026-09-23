import { randomBytes } from "node:crypto";
import { checkLoginRate, clearLoginFailures, createSession, hashPassword, hashToken, recordLoginFailure, sessionCookie } from "../lib/auth.js";
import { all, one } from "../lib/db.js";
import { fail } from "../lib/http.js";
import * as v from "../lib/validate.js";

async function listWorkspaces() {
  const workspaces = await all(`SELECT t.id, t.name, t.locale, t.active, t.created_at,
    i.email AS owner_email, i.expires_at AS invitation_expires_at, i.consumed_at AS activated_at
    FROM tenants t LEFT JOIN workspace_invitations i ON i.tenant_id = t.id
    WHERE t.id > 0 ORDER BY t.created_at DESC, t.id DESC`);
  return { status: 200, body: { workspaces } };
}

async function provision({ body, session }) {
  const name = v.str(body.name, "name");
  const email = v.identityEmail(body.email, "email");
  if (!email) fail(400, "invalid_email");
  const key = v.uuid(body.request_id, "request_id");
  const locale = v.oneOf(body.locale ?? "de", "locale", ["de", "en"]);
  const occupied = await one(`SELECT 1 FROM admins WHERE email=$1
    UNION ALL SELECT 1 FROM workspace_invitations i JOIN tenants t ON t.id=i.tenant_id
    WHERE i.email=$1 AND i.consumed_at IS NULL AND t.provisioning_key IS DISTINCT FROM $2::uuid LIMIT 1`, [email,key]);
  if (occupied) fail(409, "owner_email_taken");
  // Retries reuse a company instead of creating duplicates. A redeemed invitation is
  // never reopened, and the company identity cannot change on an accidental retry.
  const token = randomBytes(32).toString("base64url");
  let row;
  try {
  row = await one(`WITH company AS (
      INSERT INTO tenants (name, locale, provisioning_key) VALUES ($1,$2,$3)
      ON CONFLICT (provisioning_key) DO UPDATE SET provisioning_key = EXCLUDED.provisioning_key
      RETURNING id, name, locale
    ), invitation AS (
      INSERT INTO workspace_invitations (tenant_id,email,token_hash,expires_at,created_by)
      SELECT id,$4,$5,now()+interval '72 hours',$6 FROM company
      ON CONFLICT (tenant_id) DO UPDATE SET token_hash = EXCLUDED.token_hash,
        expires_at = EXCLUDED.expires_at, created_by = EXCLUDED.created_by
        WHERE workspace_invitations.consumed_at IS NULL
      RETURNING expires_at
    ), audit AS (
      INSERT INTO action_log (tenant_id,actor_type,actor_id,origin,action,target_table,target_id) SELECT id,'admin',$6,'superadmin','workspace.created','tenants',id::text FROM company
    ) SELECT company.*, invitation.expires_at FROM company LEFT JOIN invitation ON true`,
  [name, locale, key, email, hashToken(token), session.adminId]);
  } catch (error) {
    if (error.code === "23505") fail(409, "owner_email_taken");
    throw error;
  }
  return { status: 201, body: { workspace: row, invitation_token: row.expires_at ? token : null } };
}

async function reinvite({ params, session }) {
  const tenantId = v.id(params.id, "id");
  const token = randomBytes(32).toString("base64url");
  const row = await one(`WITH renewed AS (
    UPDATE workspace_invitations SET token_hash=$2, expires_at=now()+interval '72 hours', created_by=$3
    WHERE tenant_id=$1 AND consumed_at IS NULL
      AND EXISTS (SELECT 1 FROM tenants WHERE id=$1 AND active)
    RETURNING tenant_id, expires_at
  ), audit AS (
    INSERT INTO action_log (tenant_id,actor_type,actor_id,origin,action,target_table,target_id) SELECT tenant_id,'admin',$3,'superadmin','workspace.invited','workspace_invitations',tenant_id::text FROM renewed
  ) SELECT * FROM renewed`, [tenantId, hashToken(token), session.adminId]);
  if (!row) fail(409, "invitation_unavailable");
  return { status: 200, body: { invitation_token: token, expires_at: row.expires_at } };
}

async function acceptInvitation({ body, ip }) {
  const bucket = `workspace-invite:${ip}`;
  checkLoginRate(bucket);
  const token = typeof body.token === "string" && /^[A-Za-z0-9_-]{43}$/.test(body.token) ? body.token : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (password.length < 12 || password.length > 1024) fail(422, "password_too_short");
  const hash = await hashPassword(password);
  let admin;
  try {
    admin = await one(`WITH claimed AS (
      UPDATE workspace_invitations i SET consumed_at=now()
      WHERE token_hash=$1 AND consumed_at IS NULL AND expires_at>now()
        AND EXISTS (SELECT 1 FROM tenants t WHERE t.id=i.tenant_id AND t.active)
      RETURNING tenant_id,email
    ), owner AS (
      INSERT INTO admins (tenant_id,email,password_hash,role)
      SELECT tenant_id,email,$2,'admin' FROM claimed RETURNING id,tenant_id
    ), audit AS (
      INSERT INTO action_log (tenant_id,actor_type,actor_id,origin,action,target_table,target_id) SELECT tenant_id,'admin',id,'tenant','workspace.activated','tenants',tenant_id::text FROM owner
    ) SELECT id FROM owner`, [hashToken(token), hash]);
  } catch (error) {
    if (error.code !== "23505") throw error;
    // The statement rolls back the claim if this email already owns an account.
  }
  if (!admin) {
    recordLoginFailure(bucket);
    fail(400, "invitation_unavailable");
  }
  clearLoginFailures(bucket);
  const { token: sessionToken, expiresAt } = await createSession(admin.id);
  return { status: 200, body: { ok: true }, headers: { "set-cookie": sessionCookie(sessionToken, expiresAt) } };
}

async function saveCompany({ body, session }) {
  const name = v.str(body.name, "name");
  const locale = v.oneOf(body.locale, "locale", ["de", "en"]);
  const company = await one(`UPDATE tenants SET name=$2,locale=$3,company_confirmed_at=coalesce(company_confirmed_at,now())
    WHERE id=$1 RETURNING id,name,locale,company_confirmed_at`, [session.tenantId, name, locale]);
  return { status: 200, body: { company } };
}

async function workspace({ query, session }) {
  const { from, to } = v.optionalRange(query.get("from"), query.get("to"));
  const [company, setup, totals, workers, weeks, materialOrders] = await Promise.all([
    one("SELECT id,name,locale,company_confirmed_at FROM tenants WHERE id=$1", [session.tenantId]),
    one(`SELECT
      (SELECT count(*) FROM locations WHERE active) AS locations,
      (SELECT count(*) FROM workers WHERE active) AS workers,
      (SELECT count(*) FROM operators WHERE active) AS operators,
      (SELECT count(*) FROM zones z JOIN locations l ON l.id=z.location_id WHERE z.active AND l.active AND z.verified_at IS NOT NULL) AS verified_zones,
      (SELECT count(*) FROM workers w WHERE w.active AND EXISTS (SELECT 1 FROM worker_sessions s WHERE s.worker_id=w.id AND s.expires_at>now())) AS joined_workers,
      (SELECT count(*) FROM shifts) AS shifts,
      (SELECT count(*) FROM shifts WHERE end_time IS NULL) AS active_shifts,
      (SELECT count(*) FROM shifts WHERE auto_closed AND corrected_at IS NULL) AS unresolved_shifts,
      (SELECT count(*) FROM material_requests WHERE status='submitted') AS pending_materials`),
    one(`SELECT
      count(*) FILTER (WHERE status IN ('ordered','arrived')) AS ordered_count,
      count(*) FILTER (WHERE status IN ('ordered','arrived') AND cost_cents IS NULL) AS unpriced_count,
      coalesce(sum(cost_cents) FILTER (WHERE status IN ('ordered','arrived')),0) AS known_material_cents
      FROM material_requests WHERE ordered_at >= coalesce($1::timestamptz,date_trunc('month',now() AT TIME ZONE 'Europe/Vienna') AT TIME ZONE 'Europe/Vienna')
      AND ordered_at < coalesce($2::timestamptz,(date_trunc('month',now() AT TIME ZONE 'Europe/Vienna')+interval '1 month') AT TIME ZONE 'Europe/Vienna')`, [from,to]),
    all(`SELECT w.id,w.name,w.hourly_rate_cents,
      sum(extract(epoch FROM (s.end_time-s.start_time))/60) AS minutes,
      round(sum(extract(epoch FROM (s.end_time-s.start_time))/3600)*w.hourly_rate_cents) AS estimated_cents
      FROM shifts s JOIN workers w ON w.id=s.worker_id
      WHERE s.end_time IS NOT NULL AND NOT(s.auto_closed AND s.corrected_at IS NULL)
      AND s.start_time >= coalesce($1::timestamptz,date_trunc('month',now() AT TIME ZONE 'Europe/Vienna') AT TIME ZONE 'Europe/Vienna')
      AND s.start_time < coalesce($2::timestamptz,(date_trunc('month',now() AT TIME ZONE 'Europe/Vienna')+interval '1 month') AT TIME ZONE 'Europe/Vienna')
      GROUP BY w.id ORDER BY estimated_cents DESC,w.id`, [from,to]),
    all(`SELECT to_char(date_trunc('week',start_time AT TIME ZONE 'Europe/Vienna'),'YYYY-MM-DD') AS week,
      sum(extract(epoch FROM (end_time-start_time))/3600) AS hours FROM shifts
      WHERE end_time IS NOT NULL AND NOT(auto_closed AND corrected_at IS NULL)
      AND start_time >= coalesce($1::timestamptz,date_trunc('month',now() AT TIME ZONE 'Europe/Vienna') AT TIME ZONE 'Europe/Vienna')
      AND start_time < coalesce($2::timestamptz,(date_trunc('month',now() AT TIME ZONE 'Europe/Vienna')+interval '1 month') AT TIME ZONE 'Europe/Vienna')
      GROUP BY week ORDER BY week`, [from,to]),
    all(`SELECT id,body,status,cost_cents,ordered_at FROM material_requests
      WHERE status IN ('ordered','arrived')
      AND ordered_at >= coalesce($1::timestamptz,date_trunc('month',now() AT TIME ZONE 'Europe/Vienna') AT TIME ZONE 'Europe/Vienna')
      AND ordered_at < coalesce($2::timestamptz,(date_trunc('month',now() AT TIME ZONE 'Europe/Vienna')+interval '1 month') AT TIME ZONE 'Europe/Vienna')
      ORDER BY ordered_at DESC,id DESC LIMIT 20`, [from,to]),
  ]);
  return { status: 200, body: { company, setup, materials: totals, workers, weeks, material_orders: materialOrders, fetched_at: new Date().toISOString() } };
}

export const workspaceRoutes = [
  { method: "GET", path: "/platform/workspaces", auth: "platform", handler: listWorkspaces },
  { method: "POST", path: "/platform/workspaces", auth: "platform", handler: provision },
  { method: "POST", path: "/platform/workspaces/:id/invitation", auth: "platform", handler: reinvite },
  { method: "POST", path: "/workspace-invitations/accept", auth: null, bootstrap: true, handler: acceptInvitation },
  { method: "GET", path: "/admin/workspace", auth: "admin", handler: workspace },
  { method: "POST", path: "/admin/workspace", auth: "admin", handler: saveCompany },
];
