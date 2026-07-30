---
id: decision-23
title: >-
  Sentry on the API and the iOS app - amends the pg-only server dependency
  budget of decision-16
date: '2026-07-30 10:31'
status: accepted
---
## Context

A worker tapped a real tag at a real building. The banner appeared, the app opened, and **no
shift was created** — not on the server, and not even on the phone. Live state at the time:
1 location, 1 worker, 1 worker session, **0 shifts**.

Diagnosing it took reading iOS source, because **the server had nothing to say**. `server.js`
logged exactly two things: a startup line and 500s. There was no access log, so `journalctl -u
nfc-api` was empty for the minute in question. "The tap did not work" produced **zero
server-side evidence**, and the cause turned out to be a client-side guard that refused a valid
tag against an empty local cache — so the request was never made at all.

That is the shape of the problem: **the evidence for a tap that never arrived can only come from
the client.** A server-side log alone would not have found this, and a client-side log alone
would not explain a shift the server rejected. The owner asked for Sentry on **both** halves,
with client and server records for one action **correlated in one view**, explicitly as
debugging practice rather than as a feature.

decision-16 set the server dependency budget at **`pg` + node builtins** — no express, no ORM,
no router, no logging library. That budget has held through decisions 18–22. This is a real
change to it and is recorded rather than quietly taken.

No Sentry account, DSN, `sentry-cli` or auth token existed when this was written.

## Decision

**Add `@sentry/node` to the API and `sentry-cocoa` to the iOS app.** One Sentry organisation,
two projects, joined by the `sentry-trace` + `baggage` headers the app already gets for free on
`URLSession`, so one tap is **one trace** across the phone and the API.

Concretely, on the server side (this is the half in `server/` and `ops/`):

- `@sentry/node` pinned **exact** at `10.68.0` — latest stable minus one minor (decision-9,
  `server/.npmrc` already has `save-exact=true`).
- `server/instrument.mjs` loaded via `node --import`, which is **required** and not cosmetic:
  the package is `"type": "module"`, so importing it from inside `server.js` would run after
  `pg` and `node:http` are already loaded and nothing would be instrumented.
  `ExecStart` in `ops/systemd/nfc-api.service` carries the flag.
- **DSN-agnostic and fail-soft.** `SENTRY_DSN` is read from the environment, lives in
  `/etc/nfc/env`, and is **not** in the server's `REQUIRED_ENV`. Unset — which is the state this
  ships in — the SDK installs nothing, opens no socket, and the API boots and serves
  identically. Nothing in a request handler ever awaits Sentry.
- **A journald access log that does not depend on Sentry at all.** One `console.log` line per
  request — method, redacted path, status, duration, worker id, error code — emitted iff the
  request failed, matched a route, or was answered by `wellknown()`. Static 2xx from the admin
  export is silent, or `/_next/*` would bury every API line. This is the piece that fixes the
  original defect, and it works on a box with no Sentry credential.
- **PII is scrubbed at the SDK boundary, in pure tested functions** (`server/lib/scrub.js`), not
  by remembering: `sendDefaultPii: false`, `includeLocalVariables: false`, `dataCollection`
  **omitted entirely** (passing that object — even `{}` — flips cookies and request bodies back
  **on**), and `beforeSend` / `beforeSendTransaction` / `beforeSendLog` / `beforeBreadcrumb` all
  run one denylist. Never leaves the process: Apple identity tokens and nonces, `apple_sub`,
  `ts_worker` / `ts_session` cookies, `X-App-Key`, passwords and scrypt hashes, worker emails,
  `hourly_rate_cents`, and client-portal tokens. `Sentry.setUser` carries the **worker id and
  nothing else**.

## Consequences

**What it costs — a dependency in the request path, honestly accounted:**

- ~33 transitive packages, almost all `@opentelemetry/*`, against a budget that was one package.
- ~30–60 MB RSS on a single small VM that also runs Postgres 16. Watch it after deploy.
- Microsecond-scale OTel span creation plus `AsyncLocalStorage` context propagation on every
  incoming request and every `pg` query. Not zero, and it is on the clock-in path. There is no
  per-request network call: the SDK buffers and batches on its own timer.
- `ExecStart` now depends on `--import`. Drop the flag and tracing silently disappears while
  everything still looks healthy.
- `ops/deploy.sh` builds `node_modules` on macOS and rsyncs it to Linux. That is only safe while
  every dependency is pure JS. `@sentry/node` is; `@sentry/profiling-node` is a **native addon**
  and must never be added. The deploy now **gates** on `find server/node_modules -name '*.node'`
  finding nothing, and fails rather than shipping a darwin binary to an x86 VM.

**How it fails:**

- No DSN → the SDK is disabled. No integrations, no transport, no network, byte-identical
  behaviour. This is the state it ships in and it is a supported state, not a misconfiguration.
- Ingest unreachable or slow → the transport retries and drops on its own timer. No request is
  slowed, blocked or failed. A clock-in cannot fail because telemetry is down.
- `instrument.mjs` throwing → `Restart=always` + `RestartSec=5` is a crash loop that takes the
  API down **for telemetry**. Mitigated by the rule that the file contains nothing that can
  throw (no `await`, no I/O, no DSN parsing) and by a check that runs
  `node --import ./instrument.mjs -e "0"` and asserts it exits silently.

**What it explicitly does not include:** profiling (native addon, breaks the macOS→Linux rsync),
session replay (these are payroll screens), metrics, crons, `@sentry/nextjs` on the admin panel,
and source-map / dSYM upload — the last needs a `SENTRY_AUTH_TOKEN`, which does not exist, so
iOS stack traces will be **unsymbolicated** until someone creates one. Half-wiring it would be
worse than saying so here.

**The iOS half is the load-bearing half.** A request that never leaves the phone cannot produce
server-side evidence, by definition. The server half gives correlation and a floor of
request-level truth; only the client can show a tap that decided not to POST.

**Amends decision-16** — it does not supersede it. Everything still runs on the one exe.dev VM,
still with no framework, no ORM and no router; the budget moves from "`pg` only" to "`pg` +
`@sentry/node`, both pure JS", and stays closed to anything else without another decision.
**Reaffirms decision-9** (exact pins) and **decision-1 / decision-18** (no Docker, systemd).

**A Sentry DSN is not a secret and is not going in the psst vault.** It is write-only ingest
identification: worst case someone extracts it and burns quota, which is answered by Sentry-side
inbound filters and a rotated DSN. The server's lives in `/etc/nfc/env` because that is where
server config lives, not because it needs protecting — same reasoning already applied to
`API.appKey`, which was kept out of the vault after it blocked every commit touching that file
for no security gain.
