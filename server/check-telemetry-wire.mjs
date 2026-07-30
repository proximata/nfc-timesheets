// Check: what the Sentry SDK ACTUALLY puts on the wire for a real request.
//
//   cd server && node --import ./instrument.mjs check-telemetry-wire.mjs
//   (check-api.js runs it as a child process; it needs no database and no network)
//
// WHY THIS EXISTS AND WHY THE SYNTHETIC SCRUBBER TEST IS NOT ENOUGH.
// check-api.js hands scrubEvent() an event WE wrote, so it can only prove the scrubber
// cleans the fields we already thought of. The leak it missed was a field the SDK adds by
// itself: the auto-instrumented `http.server` span carries the query string TWICE — once
// inside `http.url` (which the URL rule drops) and once alone as `http.query`, which
// matched no rule and went out verbatim:
//
//   "http.query": "token=SHOULDNOTAPPEAR&email=ivan@example.com"
//
// So this drives a REAL request through the REAL server with the REAL init from
// instrument.mjs, intercepts the finished payload at the transport boundary, and asserts
// on the serialised bytes. It is the only check here that can catch the next field the
// SDK decides to add. NOTHING IS EVER TRANSMITTED: every hook returns null.
//
// It also pins the other half of the owner's ask — that a `sentry-trace` header from the
// phone produces ONE trace, not two.
import assert from "node:assert/strict";
import * as Sentry from "@sentry/node";
import { createServer } from "./server.js";

// Values that must never appear in a payload. Shaped like the real thing so a regex that
// keys off shape rather than name is exercised too.
const SECRETS = {
  appKey: "tsk_wirecheckappkey",
  cookieValue: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
  identityToken: "eyJraWQiOiJXNldjT0tCIn0.eyJzdWIiOiIwMDEyMzQifQ.SIGNATURE",
  email: "ivan.kotelnikov@example.test",
  portalToken: "Zm9vYmFyTElWRUNSRURFTlRJQUxfNDNjaGFyc19hYWFh",
};

const IOS_TRACE_ID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const IOS_SPAN_ID = "bbbbbbbbbbbbbbbb";

const client = Sentry.getClient();
assert.ok(client, "instrument.mjs must be loaded with --import, or nothing is instrumented");

const wire = [];
const capture = (hook) => {
  const original = client.getOptions()[hook];
  client.getOptions()[hook] = (payload) => {
    const scrubbed = original(payload); // scrubbed exactly as it would be sent...
    // ...minus the one thing the transport itself removes. `createEventEnvelope` does
    // `delete event.sdkProcessingMetadata` (@sentry/core envelope.js:44); it holds live
    // node objects (a Timeout with a circular list, the raw IncomingMessage) and is not
    // transmitted. Dropping it here mirrors the transport instead of failing this check
    // on data that never leaves the process.
    delete scrubbed.sdkProcessingMetadata;
    wire.push(scrubbed);
    return null; // A check never transmits.
  };
};
capture("beforeSendTransaction");
capture("beforeSend");

process.env.APP_KEY = SECRETS.appKey;
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;

// One tap as the phone makes it: our headers, our trace headers, and a query string
// stuffed with things that must not survive. /t and /shifts/open both answer without
// touching Postgres, so this needs no database.
await fetch(`${base}/t?l=c3c37d4a-ca0a-42c5-b248-9704b9907ec7&token=${SECRETS.portalToken}&email=${SECRETS.email}`, {
  headers: {
    "x-app-key": SECRETS.appKey,
    cookie: `ts_worker=${SECRETS.cookieValue}`,
    authorization: `Bearer ${SECRETS.identityToken}`,
    "sentry-trace": `${IOS_TRACE_ID}-${IOS_SPAN_ID}-1`,
    baggage: `sentry-trace_id=${IOS_TRACE_ID},sentry-public_key=abc123,sentry-sample_rate=1`,
  },
});

// A rejected clock-in. 401 is the commonest real failure (an expired session) and the SDK
// throws its transaction away by default — see dropSpansForIncomingRequestStatusCodes in
// instrument.mjs. If this transaction is missing, the merged view has lost its server half
// for the exact case it was built to explain.
await fetch(`${base}/shifts/open`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "sentry-trace": `${IOS_TRACE_ID}-${IOS_SPAN_ID}-1`,
    baggage: `sentry-trace_id=${IOS_TRACE_ID},sentry-public_key=abc123,sentry-sample_rate=1`,
  },
  body: JSON.stringify({ identity_token: SECRETS.identityToken, email: SECRETS.email }),
});

await Sentry.flush(5000); // deterministic: assert on a settled queue, never on a sleep
server.close();

let failures = 0;
const t = (name, fn) => {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures++;
    console.log(`  FAIL ${name}\n       ${err.message}`);
  }
};

const serialised = JSON.stringify(wire);

t("the SDK produced payloads at all (an empty check passes for the wrong reason)", () => {
  assert.ok(wire.length >= 2, `expected >= 2 payloads, got ${wire.length}: ${serialised.slice(0, 400)}`);
});

t("nothing forbidden survives on the wire, in ANY field the SDK invented", () => {
  for (const [name, value] of Object.entries(SECRETS)) {
    assert.ok(!serialised.includes(value), `${name} reached the transport: ${serialised}`);
  }
});

t("a rejected clock-in still produces a server transaction (401 is not dropped)", () => {
  const rejected = wire.find((e) => e.transaction === "POST /shifts/open");
  assert.ok(rejected, `no transaction for the 401: ${wire.map((e) => e.transaction).join(", ")}`);
  assert.equal(rejected.contexts.trace.data["http.response.status_code"], 401);
});

t("the phone's trace is CONTINUED, so one tap is one trace and not two", () => {
  for (const event of wire) {
    assert.equal(event.contexts.trace.trace_id, IOS_TRACE_ID, `${event.transaction} started its own trace`);
    assert.equal(event.contexts.trace.parent_span_id, IOS_SPAN_ID, `${event.transaction} lost its parent`);
  }
});

t("the transaction is named by ROUTE PATTERN, not by a concrete URL", () => {
  const names = wire.map((e) => e.transaction);
  assert.ok(names.includes("GET /t"), names.join(", "));
  assert.ok(names.includes("POST /shifts/open"), names.join(", "));
});

t("scrubbing did not empty the payload out - it is still diagnosable", () => {
  const tap = wire.find((e) => e.transaction === "GET /t");
  assert.equal(tap.contexts.trace.data["http.method"], "GET");
  assert.equal(tap.contexts.trace.data["http.response.status_code"], 200);
  assert.equal(tap.contexts.trace.data["url.path"], "/t");
});

console.log(failures ? `check-telemetry-wire: FAIL (${failures})` : "check-telemetry-wire: PASS");
process.exit(failures ? 1 : 0);
