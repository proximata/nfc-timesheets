// Isolated real API for emulator journeys. Requires local PostgreSQL, never production.
// DATABASE_URL=postgres://...@127.0.0.1:55432/postgres node demo/android-worker-audit.mjs
// adb reverse tcp:8082 tcp:8082; debug-only override documented in android/README.md.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import pg from "../server/node_modules/pg/lib/index.js";
import { prepareWorkspaceTestDb } from "../server/db/workspace-test-db.js";

const url = process.env.DATABASE_URL;
if (!url || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname)) {
  throw new Error("This audit requires an explicitly configured loopback PostgreSQL URL");
}
const schema = `android_audit_${process.pid}`;
const db = new pg.Client({ connectionString: url });
await db.connect();
await db.query(`CREATE SCHEMA ${schema}`);
await db.query(`SET search_path TO ${schema}`);
const source = readFileSync(new URL("../server/check-api.js", import.meta.url), "utf8");
const ddl = source.match(/const DDL = `([\s\S]*?)`;/)[1];
// The source is a JS template literal; SQL regex backslashes need the same decoding.
await db.query(ddl.replaceAll("\\\\", "\\"));
const runtimeRole = await prepareWorkspaceTestDb(db, schema);
const hash = (value) => createHash("sha256").update(value).digest("hex");
await db.query("INSERT INTO workers (name,hourly_rate_cents,enrolment_code_hash,enrolment_code_expires_at) VALUES ('Anna Test',1500,$1,now()+interval '4 hours')", [hash("33901")]);
await db.query("INSERT INTO operators (name,enrolment_code_hash,enrolment_code_expires_at) VALUES ('Operator Test',$1,now()+interval '4 hours')", [hash("33902")]);
const buildingId = "33900000-0000-4000-8000-000000000001";
const zoneId = "33900000-0000-4000-8000-000000000002";
await db.query("INSERT INTO locations (id,name,slug,address) VALUES ($1,'Testhaus Wien','android-audit','Testgasse 1, Wien')", [buildingId]);
await db.query("INSERT INTO zones (id,location_id,name,verified_at) VALUES ($1,$2,'Eingang',now())", [zoneId, buildingId]);
const scoped = new URL(url);
scoped.searchParams.set("options", `-c search_path=${schema} -c role=${runtimeRole}`);
process.env.DATABASE_URL = scoped.toString();
const properties = readFileSync(new URL("../android/branding.properties", import.meta.url), "utf8");
process.env.APP_KEY = properties.match(/^ts\.appKey=(.*)$/m)?.[1].trim();
if (!process.env.APP_KEY) throw new Error("Android APP_KEY is not configured");
// Release metadata is optional in this audit. No external SMS/telemetry services.
process.env.SMS_ENABLED = "false";
delete process.env.SENTRY_DSN;
const { createServer } = await import("../server/server.js");
const server = createServer();
server.on("request", (req) => {
  const cookie = req.headers.cookie || "";
  console.log(req.method, req.url, cookie.includes("ts_worker=") ? "worker" : cookie.includes("ts_operator=") ? "operator" : "anonymous");
});
server.listen(8082, "127.0.0.1", () => {
  mkdirSync(new URL("../android/captures/worker-experience/", import.meta.url), { recursive: true });
  writeFileSync(new URL("../android/captures/worker-experience/fixture.json", import.meta.url), JSON.stringify({ schema, buildingId, zoneId }));
  console.log("ANDROID_AUDIT_READY", schema);
});
const cleanup = async () => {
  server.close();
  await db.query(`DROP SCHEMA ${schema} CASCADE`);
  await db.query(`DROP ROLE ${runtimeRole}`);
  await db.end();
  process.exit(0);
};
process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
