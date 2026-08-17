// A Chrome DevTools Protocol client in one file, with no dependencies.
//
// Why not Puppeteer/Playwright: this repo's whole dependency budget is `pg` and
// `@sentry/node` on the server and Next + next-intl on the web (decision-16, decision-23).
// A screen recorder is not a reason to add a browser automation framework and a second
// Chromium download to a public repo. Node 22+ ships a global WebSocket, Chrome ships the
// protocol, and everything below is four methods.
//
// It captures ONLY the page: headless Chrome has no window chrome, no tab strip, no
// desktop, no notifications and no other application. That is the point. The previous
// recording in this repo was made with a desktop screen recorder and leaked a chat list
// and a banking app into a public README.
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Chrome, headless, in a throwaway profile. No profile of a real person is ever opened. */
export async function launchChrome({ port = 9333, width = 1280, height = 800 } = {}) {
  const profile = `/tmp/ts-demo/chrome-profile-${port}`;
  rmSync(profile, { recursive: true, force: true });
  mkdirSync(profile, { recursive: true });

  const child = spawn(
    CHROME,
    [
      "--headless=new",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      `--window-size=${width},${height}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--hide-scrollbars",
      "--force-color-profile=srgb",
      "--font-render-hinting=none",
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  // Chrome writes the port to the profile, but polling /json/version is simpler and is
  // the only thing that actually proves the endpoint is answering.
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) return { child, port };
    } catch {
      /* not up yet */
    }
    await sleep(100);
  }
  child.kill();
  throw new Error("chrome did not open a debugging port");
}

/** One page target, with the handful of protocol calls this demo needs. */
export async function attach(port) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = targets.find((t) => t.type === "page");
  if (!page) throw new Error("no page target");

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener("open", res, { once: true });
    ws.addEventListener("error", rej, { once: true });
  });

  let nextId = 1;
  const pending = new Map();
  const listeners = new Map();

  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(`${msg.error.message}`)) : resolve(msg.result);
      return;
    }
    for (const fn of listeners.get(msg.method) ?? []) fn(msg.params);
  });

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });

  const on = (method, fn) => {
    if (!listeners.has(method)) listeners.set(method, []);
    listeners.get(method).push(fn);
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");

  return {
    send,
    on,
    close: () => ws.close(),

    /** Navigate and wait for the load event AND for React to have painted something. */
    async goto(url, { settle = 900 } = {}) {
      const loaded = new Promise((res) => on("Page.loadEventFired", res));
      await send("Page.navigate", { url });
      await loaded;
      await sleep(settle);
    },

    /** Run JS in the page. Throws with the page's own message so a broken selector is loud. */
    async eval(expression) {
      const r = await send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (r.exceptionDetails) {
        throw new Error(r.exceptionDetails.exception?.description ?? "page threw");
      }
      return r.result.value;
    },

    /**
     * Wait until `expression` is truthy. Polling, not a mutation observer: this drives a
     * static export whose every screen is one fetch and one render.
     */
    async waitFor(expression, { timeout = 15000, label = expression } = {}) {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        if (await this.eval(`!!(${expression})`)) return;
        await sleep(120);
      }
      throw new Error(`timed out waiting for: ${label}`);
    },

    async screenshot(path) {
      const { data } = await send("Page.captureScreenshot", { format: "png" });
      writeFileSync(path, Buffer.from(data, "base64"));
    },

    /**
     * Type into a field one character at a time, through real key events.
     *
     * Setting `.value` would be one line, but it produces a video in which text appears
     * fully formed, which reads as a mock-up rather than as software. It also skips the
     * events a controlled React input listens to.
     */
    async type(selector, text, { perChar = 45 } = {}) {
      await this.eval(`document.querySelector(${JSON.stringify(selector)}).focus()`);
      for (const ch of text) {
        await send("Input.insertText", { text: ch });
        await sleep(perChar);
      }
    },

    /** Click the one element whose accessible name / text contains `text`. */
    async clickText(text, { selector = "button, a" } = {}) {
      const ok = await this.eval(`(() => {
        const wanted = ${JSON.stringify(text)}
        const hit = Array.from(document.querySelectorAll(${JSON.stringify(selector)}))
          .find((el) => ((el.getAttribute('aria-label') || el.textContent || '')).includes(wanted))
        if (!hit) return false
        hit.click()
        return true
      })()`);
      if (!ok) throw new Error(`no clickable element containing: ${text}`);
    },

    /** Pick a <select> option by value and fire the change React is listening for. */
    async select(selector, value) {
      const ok = await this.eval(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)})
        if (!el) return false
        const set = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set
        set.call(el, ${JSON.stringify(value)})
        el.dispatchEvent(new Event('change', { bubbles: true }))
        return true
      })()`);
      if (!ok) throw new Error(`no select matching: ${selector}`);
    },

    /** Scroll an element into view the way a person scrolls: visibly, and then a pause. */
    async scrollTo(selector, { pause = 900, block = "start" } = {}) {
      await this.eval(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)})
        if (el) el.scrollIntoView({ behavior: 'smooth', block: ${JSON.stringify(block)} })
        return !!el
      })()`);
      await sleep(pause);
    },
  };
}

/**
 * Records frames while `drive` runs, then hands them to ffmpeg.
 *
 * Screencast frames arrive only when something changes, so a still page emits nothing.
 * Each frame is written with the wall-clock ms it arrived and the concat demuxer is given
 * real durations — otherwise a 20-second walkthrough plays back as a 2-second flicker.
 */
export async function record(page, dir, drive) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  const frames = [];
  // `on` has no unsubscribe, so a page that records SEVERAL clips in one session ends up
  // with one live listener per finished clip, each still pushing frames into an array that
  // has already been written out and still acking a session it no longer owns. `live` is
  // the off switch: a finished recorder ignores everything. Without it, demo/record-
  // redesign.mjs's seven clips each carried the frames of every clip after them.
  let live = true;
  page.on("Page.screencastFrame", async (p) => {
    if (!live) return;
    frames.push({ at: Date.now(), data: p.data });
    try {
      await page.send("Page.screencastFrameAck", { sessionId: p.sessionId });
    } catch {
      /* cast already stopped */
    }
  });

  await page.send("Page.startScreencast", { format: "jpeg", quality: 92, everyNthFrame: 1 });
  const started = Date.now();
  await drive();
  await sleep(400);
  await page.send("Page.stopScreencast");
  live = false;

  if (frames.length === 0) throw new Error("no frames captured");

  const lines = [];
  frames.forEach((f, i) => {
    const name = `f${String(i).padStart(5, "0")}.jpg`;
    writeFileSync(`${dir}/${name}`, Buffer.from(f.data, "base64"));
    // The tail is NOT reconstructed here, and that is deliberate. Screencast frames arrive
    // only when something CHANGES, so a recording that ends on a still screen — which is
    // most of them, since a caption is read while nothing moves — is SHORTER than the drive
    // that produced it: /payroll/ drove 27.9 s and encoded to 15.4 s, taking its last two
    // captions off the end and onto the next segment's footage.
    //
    // Trying to fix it here does not work: this list's FINAL `duration` is handled
    // inconsistently by the concat demuxer — dropped without the repeated file, applied
    // TWICE with it (measured: a 3.996 s tail turned a 20.0 s list into a 24.0 s clip). So
    // the tail is held in the FILTER instead, where it can be measured after the fact —
    // see `clipOf` in demo/record-redesign.mjs, which pads to the drive's own duration and
    // then asserts the encoded length matches it.
    const next = frames[i + 1]?.at ?? f.at + 500;
    lines.push(`file '${name}'`, `duration ${Math.max(0.02, (next - f.at) / 1000).toFixed(3)}`);
  });
  // The concat demuxer ignores the last duration unless the last file is repeated.
  lines.push(`file 'f${String(frames.length - 1).padStart(5, "0")}.jpg'`);
  writeFileSync(`${dir}/frames.txt`, `${lines.join("\n")}\n`);

  return { dir, frames: frames.length, seconds: (Date.now() - started) / 1000 };
}
