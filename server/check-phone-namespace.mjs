#!/usr/bin/env node
// THE OWNER'S SENTENCE, TESTED FROM BOTH SIDES AND THROUGH EVERY DOOR.
//
//   "Operator phones and worker phones live in ONE namespace and may never collide, so
//    the uniqueness has to be enforced by the database, not by a screen."
//                                                (ops/workflows/ITERATIONS.md, decision-45)
//
//   node server/check-phone-namespace.mjs            # self-contained scratch database
//   node server/check-phone-namespace.mjs <dump>     # ...restored from a production dump
//
// WHY THIS EXISTS ALONGSIDE check-api.js's operator cases. check-api proves the OPERATOR
// direction: a phone already in `phone_identities` refuses a second operator, cross-kind
// included. It proves nothing about the WORKER direction, because it seeds the worker's
// claim with a raw `INSERT INTO phone_identities` of its own — a row no route in this tree
// can actually produce. This file walks all THREE doors the brief names (API, the panel's
// own create path, direct SQL), in BOTH directions, in two spellings, plus a concurrent
// race, and REPORTS THE ONE THAT DOES NOT REFUSE rather than asserting it away.
//
// The finding is section 3 and it is not a bug in what was built: `POST /admin/workers`
// writes `workers.phone` as free text (v.optionalPhone, "never normalised, because
// normalising means silently changing what the director typed") and claims nothing in the
// registry. That is decision-45 §2.3 exactly as designed. The consequence — that today's
// panel CAN put an operator's number on a worker row, because no worker row is ever an
// identity yet — is a REACHABLE STATE and is asserted here so it is a measured fact with a
// named ceiling instead of a surprise the day POST /operator/workers is unblocked.
//
// IT NEVER TOUCHES PRODUCTION. One throwaway local database, dropped in a finally AND on
// every early exit (process.exit does not run a pending finally — the lesson of 9072a8e:
// a failed pre-deploy check must not leave a copy of the client's payroll on a laptop).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB = `nfc_phonens_${process.pid}`;
const APP_KEY = "phone-namespace-check-key";

// THE TWO SPELLINGS. One human number, typed the two ways an Austrian actually types it.
// Every assertion below that says "the same number" means this pair, never one string
// compared with itself — a registry that only refuses byte-identical input would satisfy
// a same-string test while failing the owner's requirement completely.
const SPELLING_A = "0664 900 55 01";
const SPELLING_B = "+43 664/9005501";
const E164 = "+436649005501";

const sh = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts });

const created = [];
const clients = [];
const servers = [];
let failures = 0;

const ok = (m) => console.log(`  ok   ${m}`);
const note = (m) => console.log(`  --   ${m}`);
const skip = (why) => {
  console.log(`SKIP check-phone-namespace: ${why}`);
  process.exit(0);
};
function teardown() {
  for (const s of servers) s.close();
  for (const c of clients) c.end().catch(() => {});
  for (const name of created) {
    // --force, not a plain dropdb: `lib/db.js`'s pool is built at import time and this
    // file cannot close it from a synchronous teardown (die() runs on paths that are not
    // async). Without it the drop fails on "other users are connected", the message is a
    // warning nobody reads, and a database holding a copy of the client's data survives
    // the run — the exact residue 9072a8e removed from check-prod-restore.mjs.
    try {
      sh("dropdb", ["--force", "--if-exists", name]);
    } catch (e) {
      console.error(`       WARNING: could not drop ${name} — DROP IT BY HAND: dropdb --force ${name}`);
      console.error(`       ${String(e.stderr || e.message).trim().split("\n")[0]}`);
    }
  }
}
const die = (why, fix) => {
  console.error(`\nFAIL check-phone-namespace: ${why}`);
  if (fix) console.error(`       fix: ${fix}`);
  teardown();
  process.exit(1);
};

for (const bin of ["psql", "createdb", "dropdb"]) {
  try {
    sh(bin, ["--version"]);
  } catch {
    skip(`\`${bin}\` not on PATH — install the Postgres client tools`);
  }
}
try {
  sh("pg_isready", []);
} catch {
  skip("no Postgres server reachable (pg_isready failed)");
}

const dump = process.argv[2];
if (dump && !fs.existsSync(dump)) die(`${dump} does not exist`);

async function test(name, fn) {
  try {
    await fn();
  } catch (err) {
    failures += 1;
    console.error(`  FAIL ${name}\n       ${String(err.message).split("\n").join("\n       ")}`);
  }
}

let db;
try {
  // ---- 0 · a database at HEAD's full migration set ---------------------------------
  sh("createdb", [DB]);
  created.push(DB);
  if (dump) {
    const sql = dump.endsWith(".gz") ? sh("gunzip", ["-c", dump]) : fs.readFileSync(dump, "utf8");
    try {
      sh("psql", [`postgres:///${DB}`, "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], { input: sql, stdio: ["pipe", "pipe", "pipe"] });
    } catch (e) {
      const message = String(e.stderr || e.message);
      const missingRole = message.match(/role "([^"]+)" does not exist/);
      if (missingRole) die(`the dump needs a local role "${missingRole[1]}" and this machine has none`, `createuser ${missingRole[1]}`);
      die(`the dump did not restore: ${message.trim().split("\n").slice(0, 3).join(" / ")}`);
    }
    // 006 refuses a rate-less worker, which a production dump carries. That refusal is
    // check-prod-restore.mjs's assertion; reproducing the documented ops step on the
    // SCRATCH copy is what lets this file get to its own subject.
    const rateless = Number(sh("psql", [`postgres:///${DB}`, "-t", "-A", "-c", "SELECT count(*) FROM workers WHERE hourly_rate_cents <= 0"]).trim());
    if (rateless > 0) {
      sh("psql", [`postgres:///${DB}`, "-q", "-c", "DELETE FROM workers WHERE hourly_rate_cents <= 0"]);
      note(`${rateless} rate-less worker(s) removed from the SCRATCH copy so 006 can apply here`);
    }
  }
  sh("node", [path.join(__dirname, "db", "migrate.js")], { env: { ...process.env, DATABASE_URL: `postgres:///${DB}` } });

  db = new pg.Client({ connectionString: `postgres:///${DB}` });
  await db.connect();
  clients.push(db);

  // Every migration file applied — a magic count would say nothing about 008.
  const wantMigrations = fs.readdirSync(path.join(__dirname, "db", "migrations")).filter((f) => f.endsWith(".sql")).sort();
  const haveMigrations = (await db.query("SELECT filename FROM schema_migrations ORDER BY filename")).rows.map((r) => r.filename);
  assert.deepEqual(haveMigrations, wantMigrations, "every migration must be applied before any assertion below means anything");
  ok(`${haveMigrations.length} migration(s) applied${dump ? `, on a database restored from ${path.basename(dump)}` : ""}`);

  // ---- fixtures: one admin with a known password, one worker with a real rate -------
  // ENV BEFORE THE FIRST IMPORT OF ANYTHING UNDER lib/. `lib/db.js` builds its pool from
  // process.env.DATABASE_URL at IMPORT time and the ESM cache hands the same module to
  // every later importer, so importing lib/auth.js (which pulls in db.js) one line too
  // early leaves the whole server pointed at the default database for the rest of the run.
  process.env.DATABASE_URL = `postgres:///${DB}`;
  process.env.APP_KEY = APP_KEY;
  process.env.PORT = "0";
  const { hashPassword, hashToken } = await import("./lib/auth.js");
  const ADMIN_PASSWORD = `check-${randomBytes(9).toString("hex")}`;
  const adminEmail = `phonens-${process.pid}@example.test`;
  const adminId = Number(
    (await db.query("INSERT INTO admins (email, password_hash) VALUES ($1, $2) RETURNING id", [adminEmail, await hashPassword(ADMIN_PASSWORD)])).rows[0].id,
  );
  const adminToken = randomBytes(32).toString("hex");
  await db.query("INSERT INTO sessions (token, admin_id, expires_at) VALUES ($1, $2, now() + interval '1 hour')", [hashToken(adminToken), adminId]);
  const workerId = Number(
    (await db.query("INSERT INTO workers (name, hourly_rate_cents) VALUES ('Namespace Check Cleaner', 1500) RETURNING id")).rows[0].id,
  );

  // ---- boot the API -----------------------------------------------------------------
  const { createServer } = await import("./server.js");
  const server = createServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  const base = `http://127.0.0.1:${server.address().port}`;

  const call = (p, { method = "GET", body, cookie, key = APP_KEY } = {}) =>
    fetch(base + p, {
      method,
      headers: {
        ...(key ? { "X-App-Key": key } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
  const asAdmin = (p, opts = {}) => call(p, { ...opts, cookie: `ts_session=${adminToken}` });

  // ===================================================================================
  // 1 · DOOR ONE, THE ADMIN API: an operator claims the number, and NOTHING may claim it
  //     again — in EITHER spelling, in EITHER direction.
  // ===================================================================================
  await test("an operator claims a phone; a second operator in the OTHER spelling is refused", async () => {
    const first = await asAdmin("/admin/operators", { method: "POST", body: { name: "Feldleiter Eins", phone: SPELLING_A } });
    assert.equal(first.status, 201, `the first claim must succeed: ${JSON.stringify(first.body)}`);
    assert.equal(first.body.operator.phone_e164, E164, "the route must normalise on the way in, not store what was typed");

    // THE COLLISION THE DESIGN EXISTS FOR: a DIFFERENT STRING that is the SAME NUMBER.
    // A registry keyed on raw input would let this through; this is what a same-string
    // duplicate test cannot tell you.
    const second = await asAdmin("/admin/operators", { method: "POST", body: { name: "Feldleiter Zwei", phone: SPELLING_B } });
    assert.equal(second.status, 409, `the same number spelled differently must be refused: ${JSON.stringify(second.body)}`);
    assert.equal(second.body.error, "phone_claimed");
    assert.deepEqual(Object.keys(second.body), ["error"], "the 409 must name nothing about who holds the number");
    assert.equal(
      Number((await db.query("SELECT count(*) AS n FROM operators WHERE name = 'Feldleiter Zwei'")).rows[0].n),
      0,
      "a refused claim must leave no orphan operators row",
    );
    ok(`${JSON.stringify(SPELLING_A)} and ${JSON.stringify(SPELLING_B)} are ONE identity: second claim -> 409 phone_claimed`);
  });

  await test("a phone claimed by a WORKER refuses an operator — the same wall, from the other side", async () => {
    // The only way a worker holds a registry claim today is a direct INSERT: no route in
    // this tree writes one (section 3). That is itself the finding, not a shortcut.
    await db.query("INSERT INTO phone_identities (phone_e164, worker_id) VALUES ('+436649005502', $1)", [workerId]);
    const res = await asAdmin("/admin/operators", { method: "POST", body: { name: "Claims The Cleaner", phone: "0664 900 55 02" } });
    assert.equal(res.status, 409, `an operator must not be able to claim a worker's number: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.error, "phone_claimed");

    // ANTI-ENUMERATION, BOTH DIRECTIONS COMPARED BYTE FOR BYTE. If the worker-held and
    // operator-held refusals differed by one character, the panel would be a directory of
    // who is enrolled — decision-45 §7's whole reason for a bare {"error"} body.
    const operatorHeld = await asAdmin("/admin/operators", { method: "POST", body: { name: "Claims The Operator", phone: SPELLING_B } });
    assert.equal(JSON.stringify(operatorHeld.body), JSON.stringify(res.body), "a worker-held and an operator-held number must refuse IDENTICALLY");
    assert.equal(operatorHeld.status, res.status);
    await db.query("DELETE FROM phone_identities WHERE phone_e164 = '+436649005502'");
    ok("worker-held and operator-held numbers produce byte-identical 409s — nothing is enumerable");
  });

  // ===================================================================================
  // 2 · DOOR TWO, DIRECT SQL. The owner asked for the DATABASE to be the boundary, so the
  //     assertion has to be made where a screen cannot help.
  // ===================================================================================
  await test("direct SQL cannot seat the same number twice, in either kind or either order", async () => {
    const opId = Number((await db.query("INSERT INTO operators (name) VALUES ('SQL Direct') RETURNING id")).rows[0].id);
    await db.query("INSERT INTO phone_identities (phone_e164, operator_id) VALUES ('+436649005503', $1)", [opId]);

    // same number, other kind
    await assert.rejects(
      () => db.query("INSERT INTO phone_identities (phone_e164, worker_id) VALUES ('+436649005503', $1)", [workerId]),
      (e) => e.code === "23505",
      "a worker claiming an operator's number by raw INSERT must hit phone_identities_pkey",
    );
    // ...and the reverse. A second operators row cannot hold the same number either,
    // because operator_id is UNIQUE and phone_e164 is the PK — belt and braces, and both
    // are asserted because dropping either one reopens decision-45 §13 case 3.
    const opId2 = Number((await db.query("INSERT INTO operators (name) VALUES ('SQL Direct 2') RETURNING id")).rows[0].id);
    await assert.rejects(
      () => db.query("INSERT INTO phone_identities (phone_e164, operator_id) VALUES ('+436649005503', $1)", [opId2]),
      (e) => e.code === "23505",
    );
    // A SECOND, DIFFERENT number pointed at an operator who already holds one: refused by
    // operator_id's own UNIQUE, not by the PK. "Multiple operator phones allowed" means
    // multiple operators each with a phone, never one operator with two.
    await assert.rejects(
      () => db.query("INSERT INTO phone_identities (phone_e164, operator_id) VALUES ('+436649005599', $1)", [opId]),
      (e) => e.code === "23505",
      "operator_id UNIQUE must forbid one operator holding two numbers",
    );
    await db.query("DELETE FROM phone_identities WHERE phone_e164 = '+436649005503'");
    await db.query("DELETE FROM operators WHERE name IN ('SQL Direct', 'SQL Direct 2')");
    ok("phone_identities_pkey + both UNIQUEs refuse every direct-SQL seating of a taken number");
  });

  await test("a CONCURRENT cross-kind race: the loser is blocked on a row lock, then loses on the PK", async () => {
    // Two REAL connections. `psql -c` cannot hold a lock open across statements, so a
    // subprocess pair would prove serialisation-after-the-fact, never "B waited on A".
    const a = new pg.Client({ connectionString: `postgres:///${DB}` });
    const b = new pg.Client({ connectionString: `postgres:///${DB}` });
    await a.connect();
    await b.connect();
    clients.push(a, b);
    const BLOCKED = Symbol("still blocked");
    try {
      await a.query("BEGIN");
      const aOp = Number((await a.query("INSERT INTO operators (name) VALUES ('Race A') RETURNING id")).rows[0].id);
      await a.query("INSERT INTO phone_identities (phone_e164, operator_id) VALUES ('+436649005504', $1)", [aOp]);

      await b.query("BEGIN");
      const bPromise = b
        .query("INSERT INTO phone_identities (phone_e164, worker_id) VALUES ('+436649005504', $1)", [workerId])
        .then(() => ({ blocked: false }), (err) => ({ blocked: true, err }));

      assert.equal(
        await Promise.race([bPromise, new Promise((r) => setTimeout(() => r(BLOCKED), 250))]),
        BLOCKED,
        "B must WAIT on A's uncommitted row — if it returns immediately the PK is not doing the work",
      );
      await a.query("COMMIT");
      const bResult = await bPromise;
      assert.equal(bResult.blocked, true, "exactly one of two racing claims may survive");
      assert.match(String(bResult.err.message), /duplicate key|phone_identities_pkey/, "B must lose on the PRIMARY KEY, not on something incidental");
      await b.query("ROLLBACK");
      await a.query("DELETE FROM phone_identities WHERE phone_e164 = '+436649005504'");
      await a.query("DELETE FROM operators WHERE name = 'Race A'");
      ok("a worker and an operator racing for one number: B blocks on A's lock, then 23505 — no app-level read-then-write anywhere");
    } finally {
      await a.end().catch(() => {});
      await b.end().catch(() => {});
    }
  });

  // ===================================================================================
  // 3 · DOOR THREE, THE PANEL'S OWN WORKER-CREATE PATH — AND THE HOLE.
  //
  //     THE MEASURED FACT: POST /admin/workers accepts an operator's number today and
  //     stores it, because `workers.phone` is free contact text and no route in this tree
  //     writes a worker's registry claim. That is decision-45 §2.3 as designed, and it is
  //     ALSO the reason the owner's sentence is only half-true in the deployed system: the
  //     namespace is closed over `phone_identities`, not over `workers.phone`.
  //
  //     CEILING: the day POST /operator/workers is built (TASK-212, blocked on
  //     OPERATOR-MODEL §8 / decision-41), a worker created THAT way DOES take a registry
  //     row and this hole closes for new rows — but every row created through the panel
  //     before then still holds an unclaimed string, and W5's SMS login will have to decide
  //     what to do with a number that two person-rows can both display.
  // ===================================================================================
  await test("MEASURED: POST /admin/workers stores an operator's number as free text and claims nothing", async () => {
    const claim = await asAdmin("/admin/operators", { method: "POST", body: { name: "Feldleiter Drei", phone: "0664 900 55 05" } });
    assert.equal(claim.status, 201);

    const w = await asAdmin("/admin/workers", { method: "POST", body: { name: "Cleaner With The Same Number", phone: "0664 900 55 05", hourly_rate_cents: 1500 } });
    // NOT asserted as a refusal: it is not one, and writing this as `assert.equal(409)`
    // would make the file red about a design decision instead of measuring the system.
    assert.equal(w.status, 201, "today this SUCCEEDS — if it ever starts refusing, that is a new decision and this line must change with it");
    assert.equal(w.body.worker.phone, "0664 900 55 05", "and it is stored VERBATIM: optionalPhone never normalises (decision-45 §2.3)");
    assert.equal(
      Number((await db.query("SELECT count(*) AS n FROM phone_identities WHERE worker_id = $1", [w.body.worker.id])).rows[0].n),
      0,
      "the worker takes NO registry claim — which is exactly why the collision above was not detected",
    );
    // The registry itself is still intact: the operator still holds the number.
    assert.equal(
      (await db.query("SELECT operator_id IS NOT NULL AS held FROM phone_identities WHERE phone_e164 = '+436649005505'")).rows[0].held,
      true,
    );
    note("HOLE (by design, decision-45 §2.3): workers.phone is contact text, not identity —");
    note("     the panel CAN put an operator's number on a worker row. Closed only when a");
    note("     worker's number becomes a registry claim (POST /operator/workers, TASK-212).");
    ok("measured and pinned: worker-side phone is free text, registry untouched, operator's claim intact");
  });

  await test("POST /operator/workers does not exist — the §8 conflict was not built past", async () => {
    // decision-41 is PROPOSED and contradicts "just a name and a phone" on the rate field.
    // A 404 here is the CORRECT state of the tree, and this assertion is what makes it
    // deliberate: the day the route appears, this file fails and whoever added it has to
    // come back and write the worker-side collision assertions this hole is waiting for.
    const res = await call("/operator/workers", { method: "POST", body: { name: "X", phone: SPELLING_A } });
    assert.equal(res.status, 404, "if this route now exists, OPERATOR-MODEL.md §8 has been resolved and section 3 above must be rewritten");
    assert.equal(res.body.error, "not_found");
    ok("POST /operator/workers is absent (404) — TASK-212 stays blocked on OPERATOR-MODEL §8 / decision-41");
  });

  // ===================================================================================
  // 4 · AN OPERATOR DOES NOT CLOCK IN — by session, and by forged body.
  // ===================================================================================
  await test("an operator session opens no shift, and naming a worker in the body does not help", async () => {
    const op = await asAdmin("/admin/operators", { method: "POST", body: { name: "Feldleiter Ohne Dienst", phone: "0664 900 55 06" } });
    assert.equal(op.status, 201);
    const issued = await asAdmin(`/admin/operators/${op.body.operator.id}/enrolment-code`, { method: "POST" });
    assert.equal(issued.status, 201);
    const redeemed = await fetch(`${base}/auth/operator-code`, {
      method: "POST",
      headers: { "X-App-Key": APP_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ code: issued.body.code }),
    });
    const rawCookie = redeemed.headers.getSetCookie().find((c) => c.startsWith("ts_operator="));
    assert.ok(rawCookie, "redeeming an operator code must mint ts_operator");
    const opCookie = rawCookie.split(";")[0];

    const locationId = (await db.query("INSERT INTO locations (slug, name) VALUES ($1, 'Namespace Check Haus') RETURNING id", [`ns-check-${process.pid}`])).rows[0].id;
    const before = Number((await db.query("SELECT count(*) AS n FROM shifts")).rows[0].n);

    for (const [label, body] of [
      ["an empty body", {}],
      ["a fully-formed clock-in naming a real worker", { worker_id: workerId, client_uuid: "c0000000-0000-4000-8000-0000000000aa", location_uuid: locationId, start_time: new Date().toISOString() }],
      ["a clock-in naming the operator's own id as the worker", { worker_id: op.body.operator.id, client_uuid: "c0000000-0000-4000-8000-0000000000ab", location_uuid: locationId, start_time: new Date().toISOString() }],
    ]) {
      const res = await call("/shifts/open", { method: "POST", cookie: opCookie, body });
      assert.equal(res.status, 401, `${label} under an operator session must be 401, got ${res.status} ${JSON.stringify(res.body)}`);
    }
    // ...and the same cookie presented as if it were a worker's.
    const disguised = await call("/shifts/open", { method: "POST", cookie: `ts_worker=${opCookie.split("=")[1]}`, body: {} });
    assert.equal(disguised.status, 401, "an operator session token replayed in the ts_worker cookie must not authenticate a worker");

    assert.equal(Number((await db.query("SELECT count(*) AS n FROM shifts")).rows[0].n), before, "not one of those refusals may have written a shift");

    // NON-VACUITY: the 401s above prove nothing unless the SAME cookie can be made to get
    // past auth. Mutating the live route object is the only way to establish that without
    // shipping a bypass. Restored in the finally, and re-asserted afterwards.
    const { appRoutes } = await import("./routes/app.js");
    const openRoute = appRoutes.find((r) => r.method === "POST" && r.path === "/shifts/open");
    assert.equal(openRoute.auth, "worker");
    try {
      openRoute.auth = "operator";
      const mutated = await call("/shifts/open", { method: "POST", cookie: opCookie, body: {} });
      assert.notEqual(mutated.status, 401, "with auth mutated to 'operator' the same cookie MUST get past auth — otherwise the 401s above are unfalsifiable");
    } finally {
      openRoute.auth = "worker";
    }
    assert.equal((await call("/shifts/open", { method: "POST", cookie: opCookie, body: {} })).status, 401, "restoring auth: 'worker' must restore the refusal");

    ok("operator session: 401 on every clock-in shape incl. a forged worker_id and a replayed cookie — and the mutation proves it is auth doing it");
  });

  await test("NO route anywhere in the tree grants an operator a shift-writing path", async () => {
    // The absence, asserted over the actual route table — decision-45 §3's "structural,
    // not a promise a handler could forget". A grep would read the source; this reads the
    // objects the dispatcher will consult.
    const { appRoutes } = await import("./routes/app.js");
    const { authRoutes } = await import("./routes/auth.js");
    const { adminRoutes } = await import("./routes/admin.js");
    const all = [...appRoutes, ...authRoutes, ...adminRoutes];
    const operatorRoutes = all.filter((r) => r.auth === "operator");
    assert.ok(operatorRoutes.length > 0, "there must BE operator routes, or this assertion is vacuous");
    for (const r of operatorRoutes) {
      assert.ok(!/shift/i.test(r.path), `an operator-auth route must not touch shifts: ${r.method} ${r.path}`);
    }
    ok(`${operatorRoutes.length} operator-auth route(s), none of them anywhere near a shift: ${operatorRoutes.map((r) => r.path).join(", ")}`);
  });
} catch (err) {
  failures += 1;
  console.error(`\n${String(err.stack || err.message)}`);
} finally {
  teardown();
}

console.log(failures === 0 ? "check-phone-namespace: PASS" : `check-phone-namespace: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
