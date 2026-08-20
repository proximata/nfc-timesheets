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
  console.error("usage: screenshot.mjs <url> <out.png> [--cookie n=v] [--wait-text s] [--wait-gone s] [--height N]");
  process.exit(2);
}
const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const cookie = arg("--cookie");
const waitText = arg("--wait-text");
// WAIT FOR A TRANSIENT STATE TO END, not just for a final one to appear. The home screen's
// map says "Karte wird geladen" and resolves seconds later into ready / blocked / timeout;
// shooting as soon as the building list appears catches it mid-flight and reports whichever
// state the race happened to land in. Naming the LOADING text and waiting for it to go is
// the only way to photograph a terminal state.
const waitGone = arg("--wait-gone");
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
  // THE CONSOLE, KEPT. A page can render every row it was asked for and still be broken in
  // a way only the console names — the Google Maps loader reports a referrer-key rejection
  // as `RefererNotAllowedMapError` and otherwise just leaves an empty grey box, which looks
  // exactly like "still loading". Written next to the screenshot so the caller can assert
  // on it instead of squinting at a png.
  await send("Log.enable").catch(() => {});
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
    const text = String(result.value ?? "");
    const appeared = !waitText || text.includes(waitText);
    const gone = !waitGone || !text.includes(waitGone);
    if (appeared && gone) seen = true;
  }
  // THE SHOT IS TAKEN EVEN WHEN THE WAIT FAILED. A page that never rendered what it was
  // asked for is exactly the page somebody will want to look at, and throwing before the
  // capture leaves the caller with a sentence instead of the evidence.
  const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  await writeFile(out, Buffer.from(shot.data, "base64"));

  // The text is emitted too: a png cannot be grepped by the caller, and an assertion about
  // a screenshot nobody reads is not an assertion.
  const { result } = await send("Runtime.evaluate", {
    expression: "document.body.innerText",
    returnByValue: true,
  });
  await writeFile(out.replace(/\.png$/, ".txt"), String(result.value ?? ""));

  // Every request the page made that came back 4xx/5xx, with its URL. A bare "[error]
  // Failed to load resource: 404" in the console names nothing, and a page whose map is a
  // grey box because ONE script 404'd is indistinguishable from one that is still loading.
  const failedRequests = events
    .filter((e) => e.method === "Network.responseReceived" && e.params.response.status >= 400)
    .map((e) => `${e.params.response.status} ${e.params.response.url}`)
    .join("\n");

  const console_ = events
    .filter((e) => e.method === "Runtime.consoleAPICalled" || e.method === "Log.entryAdded")
    .map((e) => e.method === "Log.entryAdded"
      ? `[${e.params.entry.level}] ${e.params.entry.text}`
      : `[${e.params.type}] ${(e.params.args ?? []).map((a) => a.value ?? a.description ?? a.type).join(" ")}`)
    .join("\n");
  await writeFile(out.replace(/\.png$/, ".console.txt"), `${console_}\n${failedRequests}\n`);
  if (!seen) throw new Error(`never settled (want "${waitText}", without "${waitGone}") — see ${out} and its .txt`);
  console.log(out);
}

try {
  await main();
} catch (err) {
  console.error(`screenshot: ${err.message}`);
  process.exitCode = 1;
} finally {
  chrome.kill();
  // Chrome is still flushing its profile when kill() returns, so a straight rm races it and
  // dies ENOTEMPTY — which then buries whatever the real failure was under a stack trace.
  for (let i = 0; i < 20; i++) {
    try {
      await rm(profile, { recursive: true, force: true });
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}
