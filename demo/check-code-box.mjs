// LOOK-PHONE.md #4 — the `.code` box strikes through its own expiry line.
//
// `<code>` is INLINE by default; `.code` in globals.css never set `display`, so its
// `margin` (meant to separate it from the heading above and the expiry paragraph below)
// had no layout effect, and its `padding-top`/`padding-bottom` painted the background and
// border OUTSIDE the line box without pushing the neighbouring <p> elements away. The
// box's own bottom border ran straight across the "Gültig bis …" text right after it.
//
//   DEMO_BASE=http://127.0.0.1:8092 node demo/check-code-box.mjs
//
// Issues a real enrolment code on /operators/ and /workers/ (idempotent: re-issuing just
// invalidates the previous one, which nothing in nfc_demo depends on) and measures the
// rendered box against the paragraph right after it.
//
// No new dependency: demo/cdp.mjs, Node, the Chrome already on the machine.
import { attach, launchChrome, sleep } from "./cdp.mjs";

const BASE = process.env.DEMO_BASE ?? "http://127.0.0.1:8092";
const host = new URL(BASE).hostname;
if (!["127.0.0.1", "localhost", "[::1]", "::1"].includes(host)) {
  console.error(`check-code-box: refusing "${host}" — loopback only.`);
  process.exit(1);
}

const ADMIN = { email: "demo@example.test", password: "demo-nur-lokal-2026" };

let failures = 0;
const assert = (name, cond, detail) => {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${detail ? `  ${detail}` : ""}`);
  }
};

async function issueAndMeasure(page, path, issueButtonText) {
  await page.goto(`${BASE}${path}`, { settle: 900 });
  await page.waitFor(`document.body.textContent.includes('Zugangscode')`, { timeout: 15000, label: "loaded" });

  const clickedIssue = await page.eval(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes(${JSON.stringify(issueButtonText)}))
    if (!b) return false
    b.click()
    return true
  })()`);
  if (!clickedIssue) throw new Error(`${path}: no "${issueButtonText}" button found`);
  await sleep(400);

  // A fresh code needs no confirm; re-issuing an existing one opens a ConfirmModal first —
  // its confirm button also carries this text, scoped to .btn-primary/.btn-danger so the
  // dimmed, inert row link with the same words sitting behind the modal is never the one
  // that gets clicked (it silently eats the click otherwise: same text, wrong element).
  const modalOpen = await page.eval(`!!document.querySelector('.btn-danger, [role="dialog"] .btn-primary')`);
  if (modalOpen) {
    await page.eval(`(() => {
      const b = [...document.querySelectorAll('.btn-primary, .btn-danger')].find((x) => x.textContent.includes(${JSON.stringify(issueButtonText)}))
      b?.click()
    })()`);
    await sleep(600);
  }

  await page.waitFor(`document.querySelector('.code')`, { timeout: 10000, label: "the issued code" });
  await sleep(200);

  return await page.eval(`(() => {
    const toBox = (r) => r ? { top: r.top, bottom: r.bottom } : null
    const code = document.querySelector('.code')
    const panel = code.closest('.share-panel')
    const after = panel ? [...panel.querySelectorAll('p')].find((p) => p.compareDocumentPosition(code) & Node.DOCUMENT_POSITION_PRECEDING) : null
    return { display: getComputedStyle(code).display, code: toBox(code.getBoundingClientRect()), afterText: after ? after.textContent.slice(0, 40) : null, after: after ? toBox(after.getBoundingClientRect()) : null }
  })()`);
}

async function main() {
  const { child, port } = await launchChrome({ port: 9740 + (process.pid % 200), width: 390, height: 900 });
  const page = await attach(port);
  try {
    await page.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 900, deviceScaleFactor: 1, mobile: true });
    await page.goto(`${BASE}/login/`, { settle: 700 });
    await page.waitFor(`document.querySelector('form button[type="submit"]')`, { label: "sign-in button" });
    await page.type('input[name="email"]', ADMIN.email, { perChar: 0 });
    await page.type('input[name="password"]', ADMIN.password, { perChar: 0 });
    await page.clickText("Anmelden", { selector: 'form button[type="submit"]' });
    await page.waitFor("location.pathname === '/'", { timeout: 15000, label: "the dashboard" });

    for (const [path, issueText] of [
      ["/operators/", "Zugangscode erstellen"],
      ["/workers/", "Zugangscode erstellen"],
    ]) {
      console.log(`\n${path}`);
      const m = await issueAndMeasure(page, path, issueText);
      console.log(`  .code display=${m.display} bottom=${Math.round(m.code?.bottom ?? -1)}  next „${m.afterText}" top=${Math.round(m.after?.top ?? -1)}`);
      assert(`${path}: .code is a block box (margin/padding actually reserve space)`, m.display === "block", `display=${m.display}`);
      assert(
        `${path}: .code does not overlap the paragraph right after it`,
        m.code !== null && m.after !== null && m.code.bottom <= m.after.top,
        `code.bottom=${m.code?.bottom} > next.top=${m.after?.top}`,
      );
    }
  } finally {
    child.kill("SIGKILL");
  }

  console.log(failures ? `\ncheck-code-box: FAIL (${failures})` : "\ncheck-code-box: all checks green");
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
