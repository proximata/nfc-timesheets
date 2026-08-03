// Postgres pool (decision-2). Local socket / 127.0.0.1 only (decision-16).
// Every query below is parameterised. Never build SQL by string concatenation.
import pg from "pg";

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

export const query = (text, params) => pool.query(text, params);

export async function all(text, params) {
  return (await pool.query(text, params)).rows;
}

export async function one(text, params) {
  return (await pool.query(text, params)).rows[0] ?? null;
}
