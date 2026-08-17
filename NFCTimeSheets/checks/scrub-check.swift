// Runnable check: the telemetry PII boundary. No test framework, no Xcode.
//
//   cd NFCTimeSheets
//   cat NFCTimeSheets/Scrub.swift checks/scrub-check.swift \
//     > /tmp/scrub-check.swift && swift /tmp/scrub-check.swift
//
// This is EU/Austrian payroll data about named people. A leak into Sentry is a GDPR
// problem, not a bug, so the scrubber is not trusted on inspection - the denylisted
// literals are built into a payload and the assertion is that NONE of them survive
// serialisation. Runs whether or not sentry-cocoa is linked: Scrub.swift imports nothing
// but Foundation, on purpose.

func check(_ ok: Bool, _ what: String) {
    if !ok {
        FileHandle.standardError.write(Data("FAIL: \(what)\n".utf8))
        exit(1)
    }
}

// Every value in here is something that must never reach Sentry, spelled the way the
// real thing is spelled. Mirrors server/check-sentry-scrub.mjs.
let identityToken = "eyJraWQiOiJXNldjT0tCIn0.eyJpc3MiOiJodHRwczovL2FwcGxlaWQuYXBwbGUuY29t.SIGNATURE"
let sessionCookie = String(repeating: "a1b2c3d4", count: 8)          // 64 hex, our ts_worker value
let rawNonce = String(repeating: "9f", count: 32)                    // 64 hex
let appKey = "tsk_9880d49f83794967790deb8a2c8f3dd46633cc78104c2f65"
let workerEmail = "ivan.kotelnikov@example.com"
let scrypt = "scrypt$16384$8$1$YWJjZGVm$ZGVhZGJlZWY"
let appleSub = "001234.abcdef0123456789abcdef0123456789.0900"
let portalURL = "https://schimmer-glanz.exe.xyz/portal/8f3c1a7e5b2d4096/summary?week=31"

let secrets = [identityToken, sessionCookie, rawNonce, appKey, workerEmail, scrypt, "8f3c1a7e5b2d4096"]

// --- keys that are dropped whole ----------------------------------------------------
for key in ["identity_token", "Cookie", "set-cookie", "X-App-Key", "authorization",
            "nonce", "password", "password_hash", "apple_sub", "email", "worker_email",
            "hourly_rate_cents", "portal_token", "session_id", "credential"] {
    check(Scrub.isSensitiveKey(key), "must be treated as sensitive: \(key)")
}

// --- keys that must NOT be dropped, or the telemetry is useless ----------------------
for key in ["ts.location.id", "ts.shift.action", "ts.shift.client_uuid", "ts.api.status",
            "ts.api.code", "ts.roster.cached_locations", "ts.cold_launch",
            "ts.migration.version", "ts.shift.outcome", "ts.launch_id"] {
    check(!Scrub.isSensitiveKey(key), "must survive scrubbing: \(key)")
}

// --- the whole payload ---------------------------------------------------------------
let payload: [String: Any] = [
    "identity_token": identityToken,
    "cookie": "ts_worker=\(sessionCookie)",
    "x-app-key": appKey,
    "nonce": rawNonce,
    "worker_email": workerEmail,
    "password_hash": scrypt,
    "apple_sub": appleSub,
    "hourly_rate_cents": 1850,
    // Defence in depth: a token-shaped value under an entirely innocent key.
    "note": "sign-in failed for \(identityToken) with cookie \(sessionCookie)",
    "ts.request.url": portalURL,
    "ts.location.id": "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
    "ts.roster.cached_locations": 0,
]

let scrubbed = Scrub.attributes(payload)
let serialised = String(describing: scrubbed.sorted { $0.key < $1.key })

for secret in secrets {
    check(!serialised.contains(secret), "leaked \(secret.prefix(24))... in: \(serialised)")
}
check(!serialised.contains("1850"), "hourly rate must not survive")
check(!serialised.contains(appleSub), "apple sub is a stable per-person id: must not survive")

// The useful half has to still be there, or the scrubber has just turned telemetry off.
check(scrubbed["ts.location.id"] as? String == "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
      "location uuid survives - it is not PII and it is the whole point")
check(scrubbed["ts.roster.cached_locations"] as? Int == 0, "the diagnostic counter survives")

// --- URLs ----------------------------------------------------------------------------
check(Scrub.url(portalURL) == "https://schimmer-glanz.exe.xyz/portal/[redacted]/summary",
      "portal grant token redacted, query dropped: \(Scrub.url(portalURL))")
check(Scrub.url("https://schimmer-glanz.exe.xyz/t?l=3f2504e0-4f89-11d3-9a0c-0305e82c3301")
        == "https://schimmer-glanz.exe.xyz/t",
      "query is always dropped: \(Scrub.url("https://schimmer-glanz.exe.xyz/t?l=x"))")
check(Scrub.url("not a url at all ://") == "[redacted]", "an unparseable url is not passed through")

// --- free-text values -----------------------------------------------------------------
check(Scrub.value("plain text with no secrets") == "plain text with no secrets",
      "boring values are left alone")
check(!Scrub.value("bearer \(appKey)").contains(appKey), "tsk_ app key redacted anywhere")
check(!Scrub.value(identityToken).contains("eyJraWQ"), "jwt redacted anywhere")
// A location UUID is 32 hex WITH hyphens and must not be caught by the 64-hex rule.
check(Scrub.value("3f2504e0-4f89-11d3-9a0c-0305e82c3301") == "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
      "a uuid is not a secret")

print("scrub-check: OK")
