// The SMALLEST server WriteTagRestartUITests can be run against: two routes, no database,
// no server/ code, nothing that can open a shift.
//
//   node NFCTimeSheets/checks/write-tag-uitest-stub.mjs --port 8082
//   node demo/tls-front.mjs --cert /tmp/ts-demo/tls --port 8444 --upstream 127.0.0.1:8082
//   xcrun simctl keychain booted add-root-cert /tmp/ts-demo/tls/ca.pem
//
// WHY IT EXISTS AND WHY IT IS NOT demo/demo-server.mjs. The UI test's subject is the Write
// a tag screen's LAST STEP - can an operator start a second card - and the only thing
// standing between a launched app and that screen is OperatorHomeScreen's gate, which is
// the `ts_operator` cookie and nothing else. So the test needs a server that can hand out
// that ONE cookie, and needs nothing else from a server at all: the write itself is a radio
// the simulator does not have, and everything after it is answered by OperatorFlowAPI's
// DEBUG half in-process.
//
// It therefore serves exactly:
//   GET  /auth/capabilities   -> {"sms": false}     (both sign-in doors read this on appear)
//   POST /auth/operator-code  -> the operator, plus Set-Cookie ts_operator
//
// Any other path is a 404, on purpose - if a run starts failing because this returns 404
// somewhere new, the app grew a dependency the test should be told about rather than
// silently satisfied. LOOPBACK ONLY, same rule as demo/tls-front.mjs, and for the same
// reason: this thing hands out a session cookie to anybody who asks.
import { createServer } from "node:http";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};
const port = Number(arg("port", "8082"));

const json = (res, status, body, headers = {}) => {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(text);
};

const server = createServer((req, res) => {
  const path = (req.url || "").split("?")[0];
  console.log(`${req.method} ${path}`);

  if (req.method === "GET" && path === "/auth/capabilities") {
    // False, so the test never depends on an SMS door it is not about.
    return json(res, 200, { sms: false });
  }

  if (req.method === "POST" && path === "/auth/operator-code") {
    // ANY code is accepted. This stub is not testing the credential - server/routes/auth.js
    // does that, against a real database, and nothing here should be mistaken for a second
    // implementation of it. The cookie is the whole point: `HttpOnly` and no `Secure`, so
    // it survives the loopback TLS front either way.
    return json(res, 200, { operator: { id: 1, name: "UI test operator" }, expires_at: null }, {
      "set-cookie": "ts_operator=uitest; Path=/; HttpOnly",
    });
  }

  json(res, 404, { error: "not_found" });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`write-tag-uitest-stub: http://127.0.0.1:${port}`);
});
