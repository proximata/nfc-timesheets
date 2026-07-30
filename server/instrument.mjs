// Sentry init. Loaded BEFORE anything else via `node --import ./instrument.mjs server.js`
// (ops/systemd/nfc-api.service). `import "./instrument.mjs"` from inside server.js is NOT
// equivalent: `pg` and `node:http` would already be loaded and would never get patched.
//
// WHY THIS EXISTS (decision-23): a real NFC tap failed in production and the server had
// NOTHING to say about it. journalctl showed a startup line and nothing else, because
// server.js only ever logged 500s. Diagnosing it meant reading iOS source. Half the fix
// is the access log in server.js; this is the other half — the half that ties the phone's
// record of a tap to this process's record of the request, in ONE trace.
//
// WHAT IT COSTS, honestly:
//   - a dependency in the request path: ~33 packages, mostly @opentelemetry/*
//   - ~30-60 MB RSS on a VM that also runs Postgres 16
//   - microsecond-scale span creation + AsyncLocalStorage context per request and per
//     `pg` query. Not zero, and it is on the clock-in path.
//   - node_modules is built on macOS and rsynced to Linux (ops/deploy.sh). That stays
//     safe only while every dep is pure JS. @sentry/profiling-node is a NATIVE ADDON and
//     must never be added here. Gate: `find server/node_modules -name '*.node'` prints
//     nothing.
//
// HOW IT FAILS:
//   - SENTRY_DSN unset (the state this ships in) -> the SDK is disabled. No transport, no
//     integrations, no network. The API boots and serves identically to before.
//   - ingest unreachable/slow -> the transport retries and drops on its own timer. Nothing
//     in a request handler ever awaits Sentry.
//   - THIS FILE THROWING -> Restart=always + RestartSec=5 = a crash loop that takes the API
//     down for telemetry. So: no await, no I/O, no DSN parsing, nothing that can throw.
//     Verify before deploying: `node --import ./instrument.mjs -e "0"` must exit 0.
import * as Sentry from "@sentry/node";
import { scrubBreadcrumb, scrubEvent, scrubLogAttributes } from "./lib/scrub.js";

Sentry.init({
  // Optional on purpose, and NOT in server.js's REQUIRED_ENV. No credential exists yet;
  // the API must be shippable and debuggable without one.
  dsn: process.env.SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT ?? "production",
  release: process.env.SENTRY_RELEASE,

  // NO `dataCollection` KEY. The SDK falls back to sendDefaultPii when it is OMITTED;
  // passing the object AT ALL — even `{}` — flips every unset category to its PERMISSIVE
  // default, which means cookies and request bodies. The quickstart template in the
  // Sentry skill pastes a commented-out `dataCollection: {}`. Copying it would ship the
  // ts_worker cookie and Apple identity tokens to Sentry. Do not add it back.
  sendDefaultPii: false,

  // The skill's template sets this true. `requireWorkerSession` has `token` in scope and
  // `verifyPassword` has `password`; local variables in a stack frame are exactly those
  // values. Off.
  includeLocalVariables: false,

  enableLogs: true,

  // strictTraceContinuation IS DELIBERATELY OFF. It was set to `true` here, and that one
  // line would have silently broken the single thing the owner asked for.
  //
  // Read @sentry/core 10.68.0 `shouldContinueTrace`:
  //   if (baggageOrgId && clientOrgId && baggageOrgId !== clientOrgId) return false;   // ALWAYS
  //   if (strict && ((baggageOrgId && !clientOrgId) || (!baggageOrgId && clientOrgId))) return false;
  // The cross-org rejection — the actual security property, and the reason strict looks
  // attractive on a public endpoint — is the FIRST branch and applies whether or not this
  // option is set. All `strict` adds is: reject when exactly ONE side knows its org id.
  //
  // Our DSN will be an `o<orgId>.ingest...` host, so clientOrgId is set. If sentry-cocoa
  // does not put `sentry-org_id` in its outgoing baggage, every single tap from the phone
  // hits that second branch, a NEW trace is started, and the phone's record and this
  // process's record of the same clock-in land in two unconnected traces — which is the
  // exact failure this work exists to fix, arriving silently and only in production.
  // Nobody can verify which way cocoa behaves until a DSN exists.
  // So: take the property that is free and unconditional, and do not bet the merged view
  // on an unverifiable header field.
  // UPGRADE PATH: once both DSNs exist and one tap is confirmed to land as ONE trace,
  // turning this on is a one-line change with a known-good baseline to check against.
  strictTraceContinuation: false,

  // Sampling is about volume, not about what matters: a cleaning crew makes tens of taps
  // a day, so the clock-in path is kept at 1.0. Sampling a clock-in away is the exact
  // failure this whole exercise exists to stop.
  tracesSampler: ({ name, inheritOrSampleWith }) => {
    if (name.includes("/health") || name.includes("/.well-known/") || name.includes("/_next/")) return 0;
    if (name.includes("/shifts") || name.includes("/auth/") || name.includes("/roster")) return 1.0;
    // A GET on /t means the universal link FELL BACK TO SAFARI - the app did not open.
    // That is a first-class failure signal, not traffic.
    if (name.endsWith(" /t") || name.endsWith(" /t/")) return 1.0;
    return inheritOrSampleWith(0.1);
  },

  // KEEP 401 AND 403. This is not a preference, it is a defect fix.
  //
  // @sentry/node 10.68.0 defaults `dropSpansForIncomingRequestStatusCodes` to
  //   [[401, 404], [301, 303], [305, 399]]
  // (node-core/integrations/http/httpServerSpansIntegration.js). That is an INCLUSIVE
  // RANGE 401-404, so out of the box the SDK throws away the server transaction for
  // every 401 and 403. Measured, not assumed: with the default, `POST /shifts/open` -> 401
  // and `GET /roster` -> 401 produced NO transaction at all while `GET /t` -> 200 did.
  //
  // An expired session is the most ordinary way a real clock-in fails. Under the default
  // the phone's `nfc.tap` trace would show an http.client span with a 401 and there would
  // be NOTHING on the server end of it — defect 3 all over again, for the commonest
  // failure, in the one view this whole change exists to produce.
  //
  // 404 stays dropped: that is scanner traffic and mistyped URLs, and the access log in
  // server.js keeps every one of them anyway. Redirect ranges stay dropped as shipped.
  integrations: [
    Sentry.httpIntegration({
      dropSpansForIncomingRequestStatusCodes: [404, [301, 303], [305, 399]],
    }),
  ],

  // Client-side noise, not faults: a dropped socket is the network, and `//` is a scanner.
  ignoreErrors: [/^ECONNRESET/, /^EPIPE/],

  // The trust boundary. Everything leaving this process is scrubbed HERE, not by whoever
  // remembers to. See lib/scrub.js for the denylist and the reasoning.
  beforeSend: scrubEvent,
  beforeSendTransaction: scrubEvent,
  beforeSendLog: (log) => {
    log.attributes = scrubLogAttributes(log.attributes);
    return log;
  },
  beforeBreadcrumb: scrubBreadcrumb,
});
