import { all, one, query, transaction } from "../lib/db.js";
import { fail } from "../lib/http.js";
import * as v from "../lib/validate.js";

const SELECT = `SELECT p.*,w.name AS worker_name,l.name AS location_name
  FROM planned_shifts p JOIN workers w ON w.id=p.worker_id
  JOIN locations l ON l.id=p.location_id`;

async function calendar({ query: params }) {
  const { from, to } = v.requiredRange(params.get("from"), params.get("to"));
  if (to - from > 93 * 86400000) fail(400, "schedule_range_too_long");
  const rows = await all(
    `${SELECT} WHERE p.starts_at<$2 AND p.ends_at>$1
    ORDER BY p.starts_at,p.id LIMIT 501`,
    [from, to],
  );
  return {
    status: 200,
    body: { assignments: rows.slice(0, 500), truncated: rows.length > 500 },
  };
}

async function mine({ session }) {
  const assignments = await all(
    `${SELECT} WHERE p.worker_id=$1 AND p.cancelled_at IS NULL
    AND p.ends_at>now() AND p.starts_at<now()+interval '31 days'
    ORDER BY p.starts_at,p.id LIMIT 200`,
    [session.workerId],
  );
  return { status: 200, body: { assignments } };
}

function readPlan(body) {
  const starts = v.rangeBound(body.starts_at, "starts_at");
  const ends = v.rangeBound(body.ends_at, "ends_at");
  if (ends <= starts || ends - starts > 86400000)
    fail(400, "invalid_schedule_time");
  return {
    worker: v.id(body.worker_id, "worker_id"),
    location: v.uuid(body.location_id, "location_id"),
    starts,
    ends,
    note: v.str(body.note ?? "", "note", { min: 0, max: 1000 }),
  };
}

// Serialize plan mutations within one company, including retries and moves between
// workers. No extension needed and no impact on actual NFC clock-in transactions.
async function lockCompany(session) {
  await query(
    "SELECT pg_advisory_xact_lock(hashtextextended('schedule:' || $1::text,0))",
    [session.tenantId],
  );
}

async function validateAssignment(plan, id) {
  if (plan.starts.getTime() < Date.now()) fail(400, "schedule_in_past");
  const worker = await one(
    "SELECT id FROM workers WHERE id=$1 AND active FOR SHARE",
    [plan.worker],
  );
  const location = await one(
    "SELECT id FROM locations WHERE id=$1 AND active FOR SHARE",
    [plan.location],
  );
  if (!worker || !location) fail(404, "schedule_target_unavailable");
  const overlap = await one(
    `SELECT id FROM planned_shifts WHERE worker_id=$1
    AND cancelled_at IS NULL AND id<>$4 AND starts_at<$3 AND ends_at>$2 LIMIT 1`,
    [plan.worker, plan.starts, plan.ends, id],
  );
  if (overlap) fail(409, "schedule_overlap");
}

async function create({ body, session }) {
  const id = v.uuid(body.id, "id");
  const plan = readPlan(body);
  return transaction(async () => {
    await lockCompany(session);
    const existing = await one("SELECT * FROM planned_shifts WHERE id=$1", [
      id,
    ]);
    if (existing) {
      if (
        existing.worker_id !== plan.worker ||
        existing.location_id !== plan.location ||
        existing.starts_at.getTime() !== plan.starts.getTime() ||
        existing.ends_at.getTime() !== plan.ends.getTime() ||
        existing.note !== plan.note ||
        existing.cancelled_at
      )
        fail(409, "schedule_changed");
      return { status: 200, body: { assignment: existing } };
    }
    await validateAssignment(plan, id);
    let assignment;
    try {
      assignment = await one(
        `INSERT INTO planned_shifts (id,worker_id,location_id,starts_at,ends_at,note)
        VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [id, plan.worker, plan.location, plan.starts, plan.ends, plan.note],
      );
    } catch (error) {
      if (error.code === "23505") fail(409, "schedule_changed");
      throw error;
    }
    return { status: 201, body: { assignment } };
  });
}

async function update({ params, body, session }) {
  const id = v.uuid(params.id, "id");
  const version = v.id(body.version, "version");
  const plan = readPlan(body);
  return transaction(async () => {
    await lockCompany(session);
    const existing = await one("SELECT * FROM planned_shifts WHERE id=$1", [
      id,
    ]);
    if (!existing) fail(404, "not_found");
    if (existing.version !== version || existing.cancelled_at)
      fail(409, "schedule_changed");
    if (existing.starts_at.getTime() < Date.now())
      fail(400, "schedule_in_past");
    await validateAssignment(plan, id);
    const assignment = await one(
      `UPDATE planned_shifts SET worker_id=$2,location_id=$3,starts_at=$4,
      ends_at=$5,note=$6,version=version+1,updated_at=now() WHERE id=$1 RETURNING *`,
      [id, plan.worker, plan.location, plan.starts, plan.ends, plan.note],
    );
    return { status: 200, body: { assignment } };
  });
}

async function cancel({ params, body, session }) {
  const id = v.uuid(params.id, "id");
  const version = v.id(body.version, "version");
  return transaction(async () => {
    await lockCompany(session);
    const existing = await one("SELECT * FROM planned_shifts WHERE id=$1", [
      id,
    ]);
    if (!existing) fail(404, "not_found");
    if (existing.cancelled_at)
      return { status: 200, body: { assignment: existing } };
    if (existing.version !== version) fail(409, "schedule_changed");
    const assignment = await one(
      `UPDATE planned_shifts SET cancelled_at=now(),updated_at=now(),version=version+1
      WHERE id=$1 RETURNING *`,
      [id],
    );
    return { status: 200, body: { assignment } };
  });
}

export const scheduleRoutes = [
  { method: "GET", path: "/admin/schedule", auth: "admin", handler: calendar },
  { method: "POST", path: "/admin/schedule", auth: "admin", handler: create },
  {
    method: "PUT",
    path: "/admin/schedule/:id",
    auth: "admin",
    handler: update,
  },
  {
    method: "POST",
    path: "/admin/schedule/:id/cancel",
    auth: "admin",
    handler: cancel,
  },
  { method: "GET", path: "/me/schedule", auth: "worker", handler: mine },
];
