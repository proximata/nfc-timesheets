// The demo API. `server/server.js` with ONE thing swapped: where Apple's public keys
// come from.
//
//   DATABASE_URL=postgres:///nfc_demo APP_KEY=... PORT=8082 PUBLIC_DIR=../web/out \
//     node demo/demo-server.mjs --issue marta@example.test
//
// WHY THIS EXISTS. The iOS app signs in with Sign in with Apple and nothing else, and an
// iOS Simulator has no Apple ID — signing one in needs a human, a password and a 2FA
// code, which is the opposite of a scripted recording. So the demo mints its OWN Apple
// identity token with a locally generated RSA key and tells THIS process, and only this
// process, that the key is Apple's.
//
// WHAT IS NOT WEAKENED. Nothing in server/lib/apple.js changes. The signature check, the
// issuer check, the audience check, the exp/iat checks and the nonce check all run exactly
// as they do in production, against a real RS256 signature. The single substitution is the
// JWKS, through `setKeyFetcherForTest` — the seam server/check-api.js already uses so the
// API self-check does not depend on appleid.apple.com being up. A token minted here is
// rejected by the live server, because the live server fetches Apple's real keys.
//
// THE REASON THIS IS SAFE IS THE GUARD BELOW, NOT THE COMMENT ABOVE. A process that
// accepts forged Apple tokens must be unable to reach a real database or a real network
// interface, so it refuses to start unless the database is literally named `nfc_demo` and
// every host in play is loopback. `sh demo/check-guards.sh` runs those refusals for real.
//
// Deps: whatever server/ already has. No new ones (decision-16, decision-23).
import { createHash, generateKeyPairSync, sign as rsaSign } from "node:crypto";
import { writeFileSync } from "node:fs";
import { assertDemoDatabase } from "./db-guard.mjs";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};

const LOOPBACK = ["127.0.0.1", "localhost", "::1", ""];
const refuse = (why) => {
  console.error(`demo-server: ${why}`);
  process.exit(1);
};

// ---- the guard ---------------------------------------------------------------------
// Same shape as demo/seed.sql and demo/make-admin.mjs: the database has to be called
// nfc_demo, spelled out, or nothing happens at all. demo/db-guard.mjs also covers the
// two ways the DRIVER's host can differ from the URL's host (a `?host=` query parameter
// and $PGHOST), both of which reached the live database before it existed.
const dbName = assertDemoDatabase(process.env.DATABASE_URL ?? "", refuse);

const host = arg("host", "127.0.0.1");
if (!LOOPBACK.includes(host)) {
  refuse(`refusing to listen on "${host}" — loopback only.`);
}

// ---- the demo Apple key --------------------------------------------------------------
// Generated per process and never written to disk. It exists for as long as this server
// does; there is nothing to leak and nothing to revoke.
const KEY = generateKeyPairSync("rsa", { modulusLength: 2048 });
const KID = "demo-apple-key-1";
const JWK = { ...KEY.publicKey.export({ format: "jwk" }), kid: KID, alg: "RS256", use: "sig" };

const APPLE_ISS = "https://appleid.apple.com";
const b64url = (obj) => Buffer.from(JSON.stringify(obj), "utf8").toString("base64url");
const sha256hex = (s) => createHash("sha256").update(s, "utf8").digest("hex");

/**
 * A real RS256 identity token for an invented Apple ID.
 *
 * `sub` is derived from the email so a re-run binds to the SAME workers row instead of
 * colliding with the apple_sub compare-and-set in routes/auth.js resolveWorker.
 * The nonce claim carries SHA-256(raw), byte for byte what iOS AppleNonce.hashed
 * produces, so the server's replay check runs for real rather than being skipped.
 */
function mintIdentityToken(email, rawNonce, ttlSeconds) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url({ alg: "RS256", kid: KID, typ: "JWT" });
  const payload = b64url({
    iss: APPLE_ISS,
    aud: "io.github.qwadratic.NFCTimeSheets",
    sub: `demo.${sha256hex(email).slice(0, 32)}`,
    email,
    email_verified: true,
    nonce: sha256hex(rawNonce),
    iat: now,
    exp: now + ttlSeconds,
  });
  const signature = rsaSign("RSA-SHA256", Buffer.from(`${header}.${payload}`, "ascii"), KEY.privateKey);
  return `${header}.${payload}.${signature.toString("base64url")}`;
}

// ---- boot ----------------------------------------------------------------------------
const { setKeyFetcherForTest } = await import("../server/lib/apple.js");
setKeyFetcherForTest(async () => new Map([[KID, JWK]]));

const { createServer, assertEnv } = await import("../server/server.js");
assertEnv();

const port = Number(process.env.PORT);
const server = createServer();

// The identity the recording signs in as. Written to a file rather than printed alone so
// demo/record-ios.mjs can pick it up without parsing log output.
const email = arg("issue", "marta@example.test");
const tokenOut = arg("token-out", "/tmp/ts-demo/identity.json");
const ttl = Number(arg("ttl", "3600"));

// WRITTEN FROM INSIDE THE LISTEN CALLBACK, AND THAT IS THE WHOLE POINT.
//
// The signing key is generated per process and never leaves it, so a token is only worth
// anything to the process that minted it. `listen` is asynchronous: writing the file right
// after CALLING it meant a second demo-server that could not bind still overwrote
// identity.json with a token signed by its own throwaway key and then died on EADDRINUSE,
// leaving the server that IS running unable to verify the file on disk. Every sign-in
// after that returned 401 and the app said only "Apple sign-in failed. Try again."
// Measured, not theorised — it cost a debugging session. The callback runs on success
// only, so a server that does not own the port cannot touch the file.
server.listen(port, host, () => {
  console.log(`demo-server: http on ${host}:${port} (db ${dbName}, demo Apple JWKS)`);
  const rawNonce = sha256hex(`${email}:${process.pid}:${Date.now()}`);
  writeFileSync(
    tokenOut,
    `${JSON.stringify(
      {
        email,
        nonce: rawNonce,
        identity_token: mintIdentityToken(email, rawNonce, ttl),
        expires_at: new Date(Date.now() + ttl * 1000).toISOString(),
      },
      null,
      2,
    )}\n`,
  );
  console.log(`demo-server: demo Apple identity for ${email} -> ${tokenOut}`);
});

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
