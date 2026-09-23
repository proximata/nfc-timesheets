// Postgres pool (decision-2). Local socket / 127.0.0.1 only (decision-16).
// Every query below is parameterised. Never build SQL by string concatenation.
import pg from "pg";
import { AsyncLocalStorage } from "node:async_hooks";

// int8 (BIGSERIAL ids, COUNT) -> JS number instead of string.
// ponytail: ceiling is 2^53 rows; a cleaning crew will not get there. Upgrade path:
// drop this parser and treat ids as strings end-to-end.
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));
// numeric -> number (used by hour sums). Same ceiling reasoning.
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
// date -> the literal 'YYYY-MM-DD' STRING, not a Date.
//
// This is not a style choice. pg's default parser turns a `date` into a JS Date at LOCAL
// midnight, so `location_contracts.valid_from = '2026-03-15'` becomes 2026-03-14T23:00:00Z
// in Vienna and JSON.stringify ships "2026-03-14" to the panel — every contract period
// silently one day early, and a price change landing in the wrong month. A DATE has no
// time and no zone; keeping it a string is the only representation that preserves that.
pg.types.setTypeParser(1082, (v) => v);

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.PG_POOL_MAX ?? 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on("error", (err) => {
  console.error("[db] idle client error:", err.message);
});

const scope = new AsyncLocalStorage();
const checkedClients = new WeakSet();

export function withWorkspace(tenantId, callback) {
  if (!Number.isSafeInteger(tenantId) || tenantId < 0) throw new Error("Invalid workspace scope");
  return scope.run({ tenantId, system: false }, callback);
}

// Only credential resolution, explicit platform routes and maintenance may use this.
// A missing context is deliberately NOT a system context.
export function withSystem(callback) {
  return scope.run({ tenantId: null, system: true }, callback);
}

export async function transaction(callback) {
  const context = scope.getStore();
  if (!context) throw new Error("Database query without a verified workspace scope");
  if (context.client) return callback(context.client);
  const client = await pool.connect();
  try {
    if (!checkedClients.has(client)) {
      const { rows: [role] } = await client.query("SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user");
      if (!role || role.rolsuper || role.rolbypassrls) {
        throw new Error("API database role must be NOSUPERUSER NOBYPASSRLS");
      }
      checkedClients.add(client);
    }
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, true), set_config('app.system', $2, true)", [
      context.tenantId === null ? "" : String(context.tenantId), context.system ? "on" : "off",
    ]);
    const result = await scope.run({ ...context, client }, () => callback(client));
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function query(text, params) {
  return transaction((client) => client.query(text, params));
}

export async function all(text, params) {
  return (await query(text, params)).rows;
}

export async function one(text, params) {
  return (await query(text, params)).rows[0] ?? null;
}
