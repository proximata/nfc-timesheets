// Check: what the Sentry SDK ACTUALLY puts on the wire for a real request.
//
//   cd server && SENTRY_DSN='https://check@o4509000000000000.ingest.de.sentry.io/451' \
//     node --import ./instrument.mjs check-telemetry-wire.mjs
//   (check-api.js runs it as a child process and sets exactly that DSN; it needs no
//   database and no network)
//
//   THE DSN IS NOT OPTIONAL. With SENTRY_DSN unset the SDK is disabled by design
//   (instrument.mjs), so it emits no payloads and four cases here fail with "got 0" —
//   which looks like a broken scrubber and is really just an unset variable. The DSN is
//   a syntactically valid fake; nothing is ever transmitted (every transport hook
//   returns null).
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
import { createServer as createHttpServer } from "node:http";
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
  enrolmentCode: "K7QF-3MZ2", // decision-26: redeeming one mints a worker session
  // decision-48. A telephone number is personal data under any reading, and the Twilio
  // secret is a credential that can send messages on the operator's bill. Both travel on
  // the SMS routes: the number in a request BODY, the secret in an Authorization header
  // this process builds itself.
  workerPhone: "+436649001234",
  twilioSecret: "wire-check-twilio-secret-abcdefgh",
  twilioApiKeySid: "SKxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
};

const IOS_TRACE_ID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const IOS_SPAN_ID = "bbbbbbbbbbbbbbbb";

// This check needs the SDK actually initialised AND actually able to send: run it any
// other way and every case below fails for the SAME one reason, dressed up as a dozen
// different assertion messages plus (with no --import at all) a raw Node stack. Catch
// both misinvocations here, in one line, before that happens. TASK-223.
const REQUIRED_INVOCATION =
  "cd server && SENTRY_DSN='https://check@o4509000000000000.ingest.de.sentry.io/451' " +
  "node --import ./instrument.mjs check-telemetry-wire.mjs";
const client = Sentry.getClient();
if (!client || !client.getOptions().dsn) {
  console.error(`check-telemetry-wire: run with: ${REQUIRED_INVOCATION}`);
  process.exit(1);
}

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

// A rejected enrolment. The code is in the BODY, which is exactly where the SDK's
// requestDataIntegration goes looking. 401 with no app key, so it needs no database.
//
// CARRIES THE TRACE HEADERS like every other request here, and not as decoration: the
// continuation case below asserts over EVERY payload, so a request sent without them
// starts its own trace and fails it. Which is correct — the phone sends them on enrolment
// too, and a first launch that lands as two unconnected traces is exactly the split view
// decision-23 exists to prevent, on the one request a worker only ever makes once.
await fetch(`${base}/auth/code`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "sentry-trace": `${IOS_TRACE_ID}-${IOS_SPAN_ID}-1`,
    baggage: `sentry-trace_id=${IOS_TRACE_ID},sentry-public_key=abc123,sentry-sample_rate=1`,
  },
  body: JSON.stringify({ code: SECRETS.enrolmentCode }),
});

// An SMS sign-in request. The phone number is in the BODY, which is where the SDK's
// requestDataIntegration goes looking, and the route answers 503 (SMS is not configured in
// this process, which is also production's state) — so it needs no database and no carrier.
await fetch(`${base}/auth/sms/request`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-app-key": SECRETS.appKey,
    "sentry-trace": `${IOS_TRACE_ID}-${IOS_SPAN_ID}-1`,
    baggage: `sentry-trace_id=${IOS_TRACE_ID},sentry-public_key=abc123,sentry-sample_rate=1`,
  },
  body: JSON.stringify({ phone: SECRETS.workerPhone }),
});

// A FAILED SEND, captured by lib/sms.js's own error path. This is the one place in the
// system that holds a Twilio credential and a recipient's number in the same function, and
// `captureSendFault` is the only thing standing between them and an event. Pointed at a
// port with nothing on it, so it fails in milliseconds and contacts no carrier.
{
  const dead = createHttpServer(() => {});
  await new Promise((r) => dead.listen(0, "127.0.0.1", r));
  const deadBase = `http://127.0.0.1:${dead.address().port}`;
  await new Promise((r) => dead.close(r));

  process.env.TWILIO_ACCOUNT_SID = "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
  process.env.TWILIO_SID = SECRETS.twilioApiKeySid;
  process.env.TWILIO_SECRET = SECRETS.twilioSecret;
  process.env.TWILIO_FROM = "+43720123456";
  process.env.TWILIO_API_BASE = deadBase;

  const { sendSms } = await import("./lib/sms.js");
  const result = await sendSms(SECRETS.workerPhone, `Ihr Zugangscode lautet ${SECRETS.enrolmentCode}.`);
  assert.equal(result.status, "failed", "the send must fail against a dead port");
  for (const k of ["TWILIO_ACCOUNT_SID", "TWILIO_SID", "TWILIO_SECRET", "TWILIO_FROM", "TWILIO_API_BASE"]) delete process.env[k];
}

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
  // TRANSACTIONS ONLY. decision-48's sendSms failure is captured OUTSIDE any request (it is
  // called here directly, and on the box it can also be reached from a route), so it is an
  // error event with a trace of its own. Asserting over every payload would fail on the one
  // event that is correct — and the case below is what keeps that from becoming a loophole.
  const transactions = wire.filter((e) => e.type === "transaction");
  assert.ok(transactions.length >= 2, `expected transactions, got ${wire.map((e) => e.type).join(", ")}`);
  for (const event of transactions) {
    assert.equal(event.contexts.trace.trace_id, IOS_TRACE_ID, `${event.transaction} started its own trace`);
    assert.equal(event.contexts.trace.parent_span_id, IOS_SPAN_ID, `${event.transaction} lost its parent`);
  }
});

t("a failed SMS reports the VOCABULARY WORD and nothing else — no recipient, no credential", () => {
  // decision-48 §5.4 / lib/geocode.js's rule, applied to the one function in this system
  // that holds a Twilio credential and a person's telephone number at the same moment.
  const fault = wire.find((e) => e.type !== "transaction" && JSON.stringify(e).includes("ts.sms.reason"));
  assert.ok(fault, `no sms failure event reached the wire: ${wire.map((e) => e.type).join(", ")}`);
  assert.match(fault.tags["ts.sms.reason"], /^(timeout|network(:[A-Z_]+)?|rejected|auth|unknown|malformed_response)$/);

  // The whole event, serialised, must contain none of: the number, the message, the code,
  // the API key sid, the secret, the Authorization header, or the URL we built.
  const raw = JSON.stringify(fault);
  for (const [name, value] of Object.entries(SECRETS)) {
    assert.ok(!raw.includes(value), `the sms failure event carries ${name}`);
  }
  // The URL and the Authorization header are BUILT in lib/sms.js and are the two things a
  // naive `captureException(err)` would drag along inside a fetch error's `cause`.
  for (const forbidden of ["Basic ", "/2010-04-01/", "api.twilio.com", "Messages.json"]) {
    assert.ok(!raw.includes(forbidden), `the sms failure event carries ${JSON.stringify(forbidden)}: ${raw.slice(0, 400)}`);
  }
  // MEASURED CEILING, stated rather than discovered later: the SDK's contextLines
  // integration attaches SOURCE LINES around each stack frame, so the German message
  // TEMPLATE in lib/sms.js can appear in a frame's pre_context. That is source, not data —
  // the assertions above are what keep the VALUES (the number, the code, the secret) out,
  // and they are the ones that matter. If a credential ever moves from process.env into a
  // source literal, this stops being harmless and check-branding/psst would catch it first.
  assert.ok(!("data" in (fault.request ?? {})), "a request body rode along on the failure event");
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
