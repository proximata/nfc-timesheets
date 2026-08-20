#!/usr/bin/env node
//
// SCREENSHOT A PAGE OF THE LIVE ADMIN PANEL, LOGGED IN. Zero dependencies.
//
//   node ops/screenshot.mjs <url> <out.png> [--cookie name=value] [--wait-text "..."] [--height N]
//
// WHY THIS EXISTS. "The tag appears in the admin" is a claim about a SCREEN, and every
// check in this repo answers it with a row or a JSON payload instead. Those are the inputs
// to the screen, not the screen: a page that renders `reported_tags` into a table nobody
// can see, or throws in a client component and shows an empty state, satisfies every
// assertion about /admin/data and still leaves the director looking at nothing.
//
// WHY NOT PUPPETEER. decision-16's posture is no framework and no dependency the job does
// not require, and it does not require one here: Chrome's own DevTools Protocol is a
// WebSocket, node has had a WebSocket client built in since 22, and the whole driver is the
// forty lines below. Nothing is installed, nothing is pinned, nothing to audit.
//
// WHY THE LIVE HOST AND NOT A LOCAL BUILD. The Google Maps browser key is REFERRER-LOCKED
// to 127.0.0.1:8080 and the production host. A screenshot of the same bundle served from
// any other origin shows a map with no pins and looks exactly like a defect — this has been
// misdiagnosed twice. Point it at production and the map is the real one.
//
// THE COOKIE IS A LIVE CREDENTIAL. It is passed on argv by ops/prove-live.sh, which owns a
// THROWAWAY admin session it deletes minutes later, and it is never printed. Chrome runs in
// a fresh --user-data-dir that is removed on exit, so nothing is left logged in.
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const [url, out] = process.argv.slice(2);
if (!url || !out) {
  console.error("usage: screenshot.mjs <url> <out.png> [--cookie n=v] [--wait-text s] [--height N]");
  process.exit(2);
}
const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const cookie = arg("--cookie");
const waitText = arg("--wait-text");
const height = Number(arg("--height", "1600"));

const CHROME = process.env.CHROME_BIN
  ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9333 + (process.pid % 500);

const profile = await mkdtemp(path.join(tmpdir(), "shot-"));
const chrome = spawn(CHROME, [
  "--headless=new",
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-extensions",
  "--hide-scrollbars",
  `--window-size=1440,${height}`,
  "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll the debugging port: Chrome takes a moment to bind it, and there is no signal. */
async function target() {
  for (let i = 0; i < 100; i++) {
    try {
      const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json());
      const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      /* not up yet */
    }
    await sleep(100);
  }
  throw new Error("chrome never opened its debugging port");
}

let ws;
let nextId = 1;
const pending = new Map();
const events = [];

function send(method, params = {}) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

async function main() {
  ws = new WebSocket(await target());
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  ws.addEventListener("message", (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    } else {
      events.push(msg);
    }
  });

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");
  if (cookie) {
    const eq = cookie.indexOf("=");
    await send("Network.setCookie", {
      name: cookie.slice(0, eq),
      value: cookie.slice(eq + 1),
      url,
      httpOnly: true,
      secure: url.startsWith("https:"),
    });
  }

  const loaded = new Promise((resolve) => {
    const on = (m) => {
      if (JSON.parse(m.data).method === "Page.loadEventFired") {
        ws.removeEventListener("message", on);
        resolve();
      }
    };
    ws.addEventListener("message", on);
  });
  await send("Page.navigate", { url });
  await loaded;

  // The admin panel is a static export that fetches /admin/data on the client, so the load
  // event fires on an EMPTY table. Wait for the text that only appears once the fetch has
  // landed; a screenshot taken before it is a screenshot of a skeleton, which would make
  // every "it appears in the admin" assertion vacuous.
  let seen = false;
  for (let i = 0; i < 150 && !seen; i++) {
    await sleep(200);
    const { result } = await send("Runtime.evaluate", {
      expression: "document.body.innerText",
      returnByValue: true,
    });
    if (!waitText || String(result.value ?? "").includes(waitText)) seen = true;
  }
  if (!seen) {
    const { result } = await send("Runtime.evaluate", {
      expression: "document.body.innerText.slice(0, 600)",
      returnByValue: true,
    });
    throw new Error(`never rendered "${waitText}". Page said:\n${result.value}`);
  }

  const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  await writeFile(out, Buffer.from(shot.data, "base64"));

  // The text is emitted too: a png cannot be grepped by the caller, and an assertion about
  // a screenshot nobody reads is not an assertion.
  const { result } = await send("Runtime.evaluate", {
    expression: "document.body.innerText",
    returnByValue: true,
  });
  await writeFile(out.replace(/\.png$/, ".txt"), String(result.value ?? ""));
  console.log(out);
}

try {
  await main();
} catch (err) {
  console.error(`screenshot: ${err.message}`);
  process.exitCode = 1;
} finally {
  chrome.kill();
  await rm(profile, { recursive: true, force: true });
}
