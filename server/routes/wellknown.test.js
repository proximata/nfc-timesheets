// Local check for the wellknown handler. No framework: node routes/wellknown.test.js
// Live-host equivalent (the TASK-6 gate) is wellknown/verify.sh.
import assert from "node:assert/strict";
import http from "node:http";
import { wellknown } from "./wellknown.js";

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

  // AASA: 200, exact content-type, correct appID + paths. Wrong = every tag rewritten.
  let r = await get("/.well-known/apple-app-site-association");
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.headers["content-type"], "application/json");
  const aasa = JSON.parse(r.body);
  assert.strictEqual(aasa.applinks.details[0].appID, "6Y842FE8Q4.io.github.qwadratic.NFCTimeSheets");
  assert.deepStrictEqual(aasa.applinks.details[0].paths, ["/t*"]);

  // assetlinks: valid JSON, empty fingerprints until an Android key exists.
  r = await get("/.well-known/assetlinks.json");
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.headers["content-type"], "application/json");
  const links = JSON.parse(r.body);
  assert.deepStrictEqual(links[0].relation, ["delegate_permission/common.handle_all_urls"]);
  assert.strictEqual(links[0].target.package_name, "io.github.qwadratic.NFCTimeSheets");
  assert.deepStrictEqual(links[0].target.sha256_cert_fingerprints, []);

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
