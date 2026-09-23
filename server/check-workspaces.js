// Real PostgreSQL + HTTP journeys, isolated from all existing schemas and accounts.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { prepareWorkspaceTestDb } from "./db/workspace-test-db.js";
import { checkProductFeatures } from "./check-product-features.js";

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl || !["127.0.0.1", "localhost", "[::1]"].includes(new URL(baseUrl).hostname)) {
  throw new Error("Workspace verification requires an explicit loopback PostgreSQL URL");
}
const schema = `workspace_check_${process.pid}`;
const owner = new pg.Client({ connectionString: baseUrl });
await owner.connect();
let server;
let runtimeRole;
const keep = process.argv.includes("--serve");
try {
  await owner.query(`CREATE SCHEMA ${schema}`);
  await owner.query(`SET search_path TO ${schema}`);
  const migrations = new URL("./db/migrations/", import.meta.url);
  for (const file of readdirSync(migrations).filter((name) => name.endsWith(".sql") && name < "022").sort()) {
    await owner.query(readFileSync(new URL(file, migrations), "utf8"));
  }
  const legacy = (await owner.query("INSERT INTO workers (name,hourly_rate_cents) VALUES ('Legacy worker',1500) RETURNING id")).rows[0];
  runtimeRole = await prepareWorkspaceTestDb(owner, schema);
  assert.equal(Number((await owner.query("SELECT tenant_id FROM workers WHERE id=$1", [legacy.id])).rows[0].tenant_id), 1);
  const scoped = new URL(baseUrl);
  scoped.searchParams.set("options", `-c search_path=${schema} -c role=${runtimeRole}`);
  process.env.DATABASE_URL = scoped.toString();
  process.env.APP_KEY = "local-workspace-check";
  process.env.PUBLIC_DIR = new URL("../web/out/", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
  process.env.SMS_ENABLED = "false";
  delete process.env.SENTRY_DSN;
  const { hashPassword, hashToken, resetLoginRate } = await import("./lib/auth.js");
  const password = "Workspace-test-2026!";
  await owner.query("INSERT INTO admins (email,password_hash,tenant_id,role) VALUES ('platform@example.test',$1,0,'superadmin'),('legacy@example.test',$1,1,'admin')", [await hashPassword(password)]);
  const { createServer } = await import("./server.js");
  server = createServer();
  await new Promise((resolve) => server.listen(keep ? 8080 : 0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function call(path, { cookie, body, method = body ? "POST" : "GET" } = {}) {
    const response = await fetch(base + path, { method, headers: {
      "content-type": "application/json", "x-app-key": process.env.APP_KEY, ...(cookie ? { cookie } : {}),
    }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, data: await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] };
  }
  const platform = await call("/admin/login", { body: { email: "platform@example.test", password } });
  assert.equal(platform.status, 200);
  const legacyLogin = await call("/admin/login", { body: { email: "legacy@example.test", password } });
  assert.equal((await call("/platform/workspaces", { cookie: legacyLogin.cookie })).status, 401);
  assert.equal((await call("/admin/data", { cookie: platform.cookie })).status, 401);
  const companies = [];
  for (const label of ["a", "b"]) {
    const request = { name: `Clean ${label.toUpperCase()}`, email: `${label}@example.test`, request_id: randomUUID(), locale: "de" };
    const first = await call("/platform/workspaces", { cookie: platform.cookie, body: request });
    assert.equal(first.status, 201, JSON.stringify(first.data));
    const retry = await call("/platform/workspaces", { cookie: platform.cookie, body: request });
    assert.equal(retry.data.workspace.id, first.data.workspace.id, "retry must not duplicate a company");
    assert.equal((await call("/workspace-invitations/accept", { body: { token: first.data.invitation_token, password } })).status, 400, "rotated invite is invalid");
    const accepted = await call("/workspace-invitations/accept", { body: { token: retry.data.invitation_token, password } });
    assert.equal(accepted.status, 200, JSON.stringify(accepted.data));
    assert.equal((await call("/workspace-invitations/accept", { body: { token: retry.data.invitation_token, password } })).status, 400, "single use");
    resetLoginRate();
    const cookie = accepted.cookie;
    const empty = await call("/admin/data", { cookie });
    assert.equal(empty.data.workers.length, 0);
    const saved = await call("/admin/workspace", { cookie, body: { name: request.name, locale: "de" } });
    assert.equal(saved.status, 200);
    const worker = await call("/admin/workers", { cookie, body: { name: `Anna ${label}`, hourly_rate_cents: 1500 } });
    assert.equal(worker.status, 201, JSON.stringify(worker.data));
    const location = await call("/admin/locations", { cookie, body: { name: `Haus ${label}`, slug: "same-building-slug", address: "Testgasse 1, Wien" } });
    assert.equal(location.status, 201, JSON.stringify(location.data));
    const zone = (await owner.query("INSERT INTO zones (tenant_id,location_id,name,verified_at) VALUES ($1,$2,'Eingang',now()) RETURNING id", [saved.data.company.id, location.data.location.id])).rows[0];
    const workerToken = label.repeat(64);
    await owner.query("INSERT INTO worker_sessions (tenant_id,worker_id,token,expires_at) VALUES ($1,$2,$3,now()+interval '1 day')", [saved.data.company.id, worker.data.worker.id, hashToken(workerToken)]);
    companies.push({ id: saved.data.company.id, cookie, worker: worker.data.worker, location: location.data.location, zone, workerCookie: `ts_worker=${workerToken}` });
  }
  const [a,b] = companies;
  await checkProductFeatures({call,owner,a,b,platform,resetLoginRate});
  const phoneB = '+436641234567';
  const operatorB = await call('/admin/operators', { cookie: b.cookie, body: {name:'Operator B',phone:phoneB} });
  assert.equal(operatorB.status,201);
  const emailB = 'operator-b@example.test';
  assert.equal((await call('/admin/operators/'+operatorB.data.operator.id+'/email', {cookie:b.cookie,method:'PUT',body:{email:emailB}})).status,200);
  const phoneA = '+436649876543';
  const emailA = 'worker-a@example.test';
  for (const [kind,value,foreign] of [['phone',phoneA,phoneB],['email',emailA,emailB]]) {
    const path='/admin/workers/'+a.worker.id+'/'+kind;
    assert.equal((await call(path,{cookie:a.cookie,method:'PUT',body:{[kind]:value}})).status,200);
    const conflict=await call(path,{cookie:a.cookie,method:'PUT',body:{[kind]:foreign}});
    assert.equal(conflict.status,409,JSON.stringify(conflict.data));
    const table=kind==='phone'?'phone_identities':'email_identities';
    const column=kind==='phone'?'phone_e164':'email';
    assert.equal((await owner.query('SELECT '+column+' AS identity FROM '+table+' WHERE worker_id=$1',[a.worker.id])).rows[0].identity,value,'refused replacement preserves previous login');
  }
  const operatorA=await call('/admin/operators',{cookie:a.cookie,body:{name:'Operator A',phone:'+436641119999'}});
  assert.equal(operatorA.status,201);
  const ownOperatorEmail='operator-a@example.test';
  const operatorEmailPath='/admin/operators/'+operatorA.data.operator.id+'/email';
  assert.equal((await call(operatorEmailPath,{cookie:a.cookie,method:'PUT',body:{email:ownOperatorEmail}})).status,200);
  assert.equal((await call(operatorEmailPath,{cookie:a.cookie,method:'PUT',body:{email:emailB}})).status,409);
  assert.equal((await owner.query('SELECT email FROM email_identities WHERE operator_id=$1',[operatorA.data.operator.id])).rows[0].email,ownOperatorEmail);
  assert.equal((await call('/admin/operators',{cookie:a.cookie,body:{name:'Must not exist',phone:phoneB}})).status,409);
  assert.equal(Number((await owner.query('SELECT count(*) FROM operators WHERE tenant_id=$1',[a.id])).rows[0].count),1);
  const operatorToken='c'.repeat(64);
  await owner.query("INSERT INTO operator_sessions (tenant_id,operator_id,token,expires_at) VALUES ($1,$2,$3,now()+interval '1 day')",[b.id,operatorB.data.operator.id,hashToken(operatorToken)]);
  const reportId=randomUUID();
  const reports=await Promise.all([1,2].map(()=>call('/operator/tags',{cookie:'ts_operator='+operatorToken,body:{id:reportId}})));
  assert.deepEqual(reports.map(r=>r.status).sort(),[200,201]);
  const duplicate = await call("/platform/workspaces", { cookie: platform.cookie,
    body: { name: "Must not exist", email: "a@example.test", request_id: randomUUID() } });
  assert.equal(duplicate.status, 409);
  for (const [self, other] of [[a,b],[b,a]]) {
    const data = await call("/admin/data", { cookie: self.cookie });
    assert.deepEqual(data.data.workers.map((w) => w.id), [self.worker.id]);
    assert.deepEqual(data.data.locations.map((l) => l.id), [self.location.id]);
    assert.equal((await call("/admin/workers", { cookie: self.cookie, body: { id: other.worker.id, name: "Tampered", hourly_rate_cents: 1 } })).status, 404);
    assert.equal((await call(`/admin/locations/${other.location.id}`, { cookie: self.cookie, method: "DELETE" })).status, 404);
    assert.equal((await call("/admin/flags/sms_login", { cookie: self.cookie, method: "PATCH", body: { enabled: true } })).status, 401);
    assert.equal((await call("/platform/workspaces", { cookie: self.cookie })).status, 401);
    const roster = await call("/roster", { cookie: self.workerCookie });
    assert.ok(!JSON.stringify(roster.data).includes(other.location.id));
    const badTap = await call("/shifts/open", { cookie: self.workerCookie, body: { location_uuid: other.zone.id, client_uuid: randomUUID(), start_time: new Date().toISOString() } });
    assert.ok(badTap.status >= 400 && badTap.status < 500, JSON.stringify(badTap));
    assert.equal(badTap.data.error, "unknown_location");
    const ownShift = randomUUID();
    const startTime = new Date(Date.now() - 2 * 3600000).toISOString();
    const endTime = new Date(new Date(startTime).getTime() + 90 * 60000).toISOString();
    assert.equal((await call("/shifts/open", { cookie: self.workerCookie, body: { location_uuid: self.zone.id, client_uuid: ownShift, start_time: startTime } })).status, 201);
    assert.equal((await call("/shifts/close", { cookie: self.workerCookie, body: { location_uuid: self.zone.id, client_uuid: ownShift, end_time: endTime } })).status, 200);
    await owner.query(`INSERT INTO material_requests (tenant_id,worker_id,location_id,body,status,cost_cents,ordered_at)
      VALUES ($1,$2,$3,'Reinigungsmittel','ordered',2590,now()),($1,$2,$3,'Handschuhe','arrived',NULL,now())`, [self.id,self.worker.id,self.location.id]);
    const flagList = await call("/admin/flags", { cookie: self.cookie });
    assert.ok(flagList.data.flags.every((flag) => flag.updated_by === null && flag.can_edit === false));
    assert.equal((await call("/admin/settings", { cookie: self.cookie, body: { key: "sms_otp_requests_per_5min", value: 5 } })).status, 403);
    const overview = await call("/admin/workspace", { cookie: self.cookie });
    assert.equal(overview.status, 200, JSON.stringify(overview));
    assert.equal(overview.data.setup.workers, 1);
    assert.equal(overview.data.setup.verified_zones, 1);
    assert.equal(overview.data.workers[0].estimated_cents, 2250);
    assert.equal(overview.data.materials.known_material_cents, 2590);
    assert.equal(overview.data.materials.unpriced_count, 1);
    assert.equal(overview.data.material_orders.length, 2);
  }
  const { query, withWorkspace, pool } = await import("./lib/db.js");
  await assert.rejects(query("SELECT * FROM workers"), /without a verified/);
  await assert.rejects(withWorkspace(a.id, () => query("INSERT INTO zones (name,location_id) VALUES ('Cross-company',$1)", [b.location.id])), { code: "23503" });
  await assert.rejects(withWorkspace(a.id, () => query("INSERT INTO workers (tenant_id,name,hourly_rate_cents) VALUES ($1,'Cross-company',1)", [b.id])), { code: "42501" });
  const parallel = await Promise.all(Array.from({ length: 30 }, (_, i) => {
    const tenant = i % 2 ? a : b;
    return withWorkspace(tenant.id, async () => {
      const rows = (await query("SELECT id FROM workers")).rows;
      assert.deepEqual(rows.map((row) => row.id), [tenant.worker.id]);
    });
  }));
  assert.equal(parallel.length, 30);
  const orphan = await pool.query("SELECT id FROM workers");
  assert.equal(orphan.rows.length, 0, "pool reuse must leave no scope behind");
  console.log("check-workspaces: PASS (migration, invites, two-company API, tag rejection, RLS, cross-company FK, concurrent pooled requests)");
  if (keep) {
    console.log(`WORKSPACE_PREVIEW ${base} | platform@example.test / a@example.test / b@example.test | ${password}`);
    await new Promise((resolve) => { process.once("SIGINT", resolve); process.once("SIGTERM", resolve); });
  }
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  const { pool } = await import("./lib/db.js");
  await pool.end();
  await owner.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  if (runtimeRole) await owner.query(`DROP ROLE ${runtimeRole}`);
  await owner.end();
}
