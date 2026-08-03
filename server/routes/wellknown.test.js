// Local check for the wellknown handler. No framework: node routes/wellknown.test.js
// Live-host equivalent (the TASK-6 gate) is wellknown/verify.sh.
import assert from "node:assert/strict";
import http from "node:http";
// Operator identity is configuration, not source: the expected bytes are RENDERED from
// ops/branding.json rather than spelled out here, so a rebrand cannot leave this test
// asserting the previous company's team id. dev-only import; the server never loads it.
import { readBranding, renderAASA, renderAssetlinks } from "../../ops/gen-wellknown.mjs";
import { wellknown } from "./wellknown.js";

const branding = readBranding();

const srv = http.createServer((req, res) => {
  if (wellknown(req, res)) return;
  res.writeHead(404);
  res.end("nope");
});

srv.listen(0, async () => {
  const port = srv.address().port;
  const get = (path, method = "GET") =>
    new Promise((resolve) => {
      http
        .request({ port, path, method }, (res) => {
          let b = "";
          res.on("data", (c) => (b += c));
          res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
        })
        .end();
    });

  // AASA: 200, exact content-type, and the EXACT bytes ops/branding.json renders. A
  // substring match would pass on a file that also carried a stale appID or a widened
  // `paths`; wrong bytes here means every tag in every building gets rewritten by hand.
  let r = await get("/.well-known/apple-app-site-association");
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.headers["content-type"], "application/json");
  assert.strictEqual(r.body, renderAASA(branding));
  const aasa = JSON.parse(r.body);
  assert.strictEqual(
    aasa.applinks.details[0].appID,
    `${branding.apple.teamId}.${branding.apple.bundleIds[0]}`,
  );
  assert.deepStrictEqual(aasa.applinks.details[0].paths, branding.apple.paths);

  // assetlinks: same, byte-exact. Fingerprints stay empty until an Android signing key
  // exists; empty is legal and simply means App Links are unverified.
  r = await get("/.well-known/assetlinks.json");
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.headers["content-type"], "application/json");
  assert.strictEqual(r.body, renderAssetlinks(branding));
  const links = JSON.parse(r.body);
  assert.deepStrictEqual(links[0].relation, ["delegate_permission/common.handle_all_urls"]);
  assert.strictEqual(links[0].target.package_name, branding.android.packageName);
  assert.deepStrictEqual(
    links[0].target.sha256_cert_fingerprints,
    branding.android.sha256CertFingerprints,
  );

  // /t: served for the shapes a tag can produce, never redirected.
  // A real tag carries the location UUID, never the slug (decision-21).
  for (const p of ["/t", "/t/", "/t?l=3f2504e0-4f89-11d3-9a0c-0305e82c3301"]) {
    r = await get(p);
    assert.strictEqual(r.status, 200, p);
    assert.strictEqual(r.headers["content-type"], "text/html; charset=utf-8");
    assert.ok(/<html lang="/.test(r.body), "lang attribute");
    assert.ok(/<h1>/.test(r.body), "heading");
  }

  r = await get("/.well-known/apple-app-site-association", "POST");
  assert.strictEqual(r.status, 405);

  // Anything else falls through to the main router untouched.
  r = await get("/roster");
  assert.strictEqual(r.status, 404);
  assert.strictEqual(r.body, "nope");

  console.log("wellknown route checks: OK");
  srv.close();
});
