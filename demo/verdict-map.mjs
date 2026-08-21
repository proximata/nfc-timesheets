// DID THE MAP ACTUALLY DRAW, or did something merely say it did?
//
// The verdict pass photographed the live home screen and the map was a BLACK RECTANGLE,
// while `.gm-style` existed in the DOM and the banner read „Auf der Karte: 1". A container
// element is not a drawn map: `.gm-style` is created by the loader before a single tile is
// requested, so every check in this repo that asserts on it can pass over an empty box.
//
// This asks four separate questions and prints all four, because each alone lies:
//   tiles    how many googleusercontent/maps tile requests the network layer actually saw
//   canvas   whether the map's own <canvas>/tile <img> nodes exist
//   pixels   whether the captured PNG of the map rectangle is more than one flat colour
//   pin      whether the marker for the building is in the DOM
//
// The pixel test is the one that matters and the one nothing else in this repo does: a
// WebGL map that fails to composite in headless Chrome looks identical, to every DOM
// assertion, to one that drew.
//
//   ADMIN_EMAIL=… ADMIN_PASSWORD=… node demo/verdict-map.mjs [base]
import { mkdirSync, writeFileSync } from "node:fs";
import { attach, launchChrome, sleep } from "./cdp.mjs";

const BASE = process.argv[2] ?? "https://schimmer-glanz.exe.xyz";
const OUT = process.env.VERDICT_OUT ?? "docs/media/verdict";
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;
if (!EMAIL || !PASSWORD) {
  console.error("ADMIN_EMAIL and ADMIN_PASSWORD must be in the environment");
  process.exit(2);
}

mkdirSync(OUT, { recursive: true });
const chrome = await launchChrome({ port: 9457, width: 1680, height: 1200 });
const page = await attach(chrome.port);

const tileUrls = [];
page.on("Network.requestWillBeSent", (p) => {
  const u = p.request?.url ?? "";
  if (/maps\.googleapis\.com\/maps\/vt|khms\d|googleusercontent.*tile/i.test(u)) tileUrls.push(u);
});
const consoleErrors = [];
page.on("Log.entryAdded", (p) => consoleErrors.push(p.entry?.text ?? ""));
await page.send("Log.enable").catch(() => {});

try {
  await page.goto(`${BASE}/login/`);
  await page.waitFor("document.querySelector('input[name=password]')");
  await page.eval(`(() => {
    const set = (el, v) => {
      const d = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set
      d.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true }))
    }
    set(document.querySelector('input[name=email]'), ${JSON.stringify(EMAIL)})
    set(document.querySelector('input[name=password]'), ${JSON.stringify(PASSWORD)})
    document.querySelector('form').requestSubmit()
    return true
  })()`);
  await page.waitFor("!document.querySelector('input[name=password]')", { timeout: 20000 });

  await page.goto(`${BASE}/`, { settle: 1000 });
  // Ten seconds, not one: tiles are network, and the question here is whether they EVER
  // arrive, not whether they arrive fast.
  await sleep(10000);

  const dom = await page.eval(`(() => {
    const el = document.querySelector('.gm-style') || document.querySelector('[data-map], .map-canvas')
    const r = el ? el.getBoundingClientRect() : null
    return {
      gmStyle: !!document.querySelector('.gm-style'),
      canvas: document.querySelectorAll('.gm-style canvas').length,
      tileImgs: document.querySelectorAll('.gm-style img').length,
      markers: document.querySelectorAll('.gm-style [role=button], .gm-style area, gmp-advanced-marker').length,
      googleLogo: !!document.querySelector('.gm-style a[href*="maps.google"], img[src*="google_white"], img[alt="Google"]'),
      rect: r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null,
    }
  })()`);
  console.log("dom:   ", JSON.stringify(dom));
  // The key is REDACTED even though a browser key is public by construction and referrer-
  // locked (it ships in the bundle). Printing it here would put it into a terminal log and
  // from there into a committed report, which is where a public thing becomes a searchable
  // one.
  console.log("tiles: ", tileUrls.length, (tileUrls[0] ?? "").replace(/key=[^&]+/, "key=<redacted>").slice(0, 120));
  console.log("errors:", consoleErrors.filter((e) => /Maps|Referer|Api/i.test(e)).slice(0, 3));

  // The pixels. Clip exactly the map rectangle and count distinct colours: a map that drew
  // is thousands; an empty box is one or two.
  if (dom.rect && dom.rect.w > 100) {
    const { data } = await page.send("Page.captureScreenshot", {
      format: "png",
      // CDP wants width/height, not w/h. Passing the rect straight through is how the
      // first run of this file died with "Invalid parameters" after ten seconds of waiting.
      clip: { x: dom.rect.x, y: dom.rect.y, width: dom.rect.w, height: dom.rect.h, scale: 1 },
    });
    const buf = Buffer.from(data, "base64");
    writeFileSync(`${OUT}/map-clip.png`, buf);
    // Decode via the page itself — no image library, decision-16.
    const colours = await page.eval(`(async () => {
      const b64 = ${JSON.stringify(data)}
      const img = new Image()
      img.src = 'data:image/png;base64,' + b64
      await img.decode()
      const c = document.createElement('canvas')
      c.width = img.width; c.height = img.height
      c.getContext('2d').drawImage(img, 0, 0)
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
      const seen = new Set()
      for (let i = 0; i < d.length; i += 4 * 37) {
        seen.add((d[i] << 16) | (d[i+1] << 8) | d[i+2])
        if (seen.size > 5000) break
      }
      return { w: img.width, h: img.height, distinct: seen.size }
    })()`);
    console.log("pixels:", JSON.stringify(colours), "->", `${OUT}/map-clip.png`);
    console.log(
      colours.distinct > 50
        ? "VERDICT: the map DREW — the rectangle holds a picture"
        : "VERDICT: the map is a FLAT RECTANGLE — nothing was drawn, whatever the DOM says",
    );
  } else {
    console.log("VERDICT: no map element with a usable rectangle at all");
  }
} finally {
  await sleep(200);
  page.close();
  chrome.child.kill();
}
