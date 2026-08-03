// A throwaway HTTPS front for the demo API, so a phone can talk to it.
//
//   node demo/tls-front.mjs --cert /tmp/ts-demo/tls --port 8443 --upstream 127.0.0.1:8082
//
// WHY THIS EXISTS: both apps build their base URL as `https://<tagHost>` and nothing else.
// That is correct — a worker's hours must not travel in cleartext — and it is not going to
// be weakened for a screen recording. So the demo puts TLS in front of the plain HTTP API
// instead, with a certificate generated on the spot (see backlog/docs/DEMO.md) and trusted
// only inside the emulator.
//
// It is NOT part of the product. server/server.js has no TLS in it and must not grow any:
// in production the exe.dev proxy terminates TLS (decision-16, runbook §4). This file is a
// demo prop and lives in demo/ for that reason.
//
// Loopback only, and it says so if you try otherwise.
import { readFileSync } from "node:fs";
import { request } from "node:http";
import { createServer } from "node:https";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};

const certDir = arg("cert", "/tmp/ts-demo/tls");
const port = Number(arg("port", "8443"));
const [upHost, upPort] = arg("upstream", "127.0.0.1:8082").split(":");

if (!["127.0.0.1", "localhost", "::1"].includes(upHost)) {
  console.error(`tls-front: refusing to proxy to "${upHost}" — loopback only.`);
  process.exit(1);
}

const server = createServer(
  {
    key: readFileSync(`${certDir}/server.key`),
    cert: readFileSync(`${certDir}/server.pem`),
  },
  (req, res) => {
    // Straight pass-through. No rewriting of headers, no injected CORS, no fake latency:
    // whatever the app sends is what the API answers, so the recording shows the real
    // request path and the real status codes.
    const up = request(
      { host: upHost, port: Number(upPort), method: req.method, path: req.url, headers: req.headers },
      (upRes) => {
        res.writeHead(upRes.statusCode, upRes.headers);
        upRes.pipe(res);
      },
    );
    up.on("error", (err) => {
      console.error("tls-front: upstream", err.message);
      if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
      res.end("upstream unavailable\n");
    });
    req.pipe(up);
  },
);

server.listen(port, "0.0.0.0", () => {
  console.log(`tls-front: https on :${port} -> http://${upHost}:${upPort}`);
});
