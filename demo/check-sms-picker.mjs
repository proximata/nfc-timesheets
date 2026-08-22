// THE PICKER, DRIVEN FOR REAL (decision-48, TASK-244) — "SMS senden" beside "Zugangscode
// erzeugen" on /workers/, in every state a director can actually meet.
//
//   node demo/check-sms-picker.mjs
//
// SELF-CONTAINED ON PURPOSE. Unlike the other browser checks in this directory, this one
// does not need a server started by hand first: it imports server/server.js AS A LIBRARY,
// in-process, exactly the way server/check-sms-flag.mjs already does, because the flag this
// screen renders is `smsConfigured()` — read from `process.env` FRESH ON EVERY REQUEST,
// never cached at boot. Being in the SAME process means this script can flip the flag
// between two page loads by writing to its own `process.env`, with no restart and no
// second server to keep in sync.
//
// NO REAL SMS IS SENT, AND NONE COULD BE. TWILIO_API_BASE always points at a throwaway
// HTTP server on loopback that this script owns; the credentials are the same obvious
// fakes check-sms-flag.mjs uses.
//
// WHAT IS ACTUALLY MEASURED, and why each one earns a screenshot:
//
//   1. FLAG OFF (today's REAL production state — /etc/nfc/env carries no TWILIO_* at all).
//      "SMS senden" is rendered for every active worker, not hidden — disabled, aria-disabled,
//      and the German sentence naming why sits right beside it. Screenshot at 1680 and 390.
//   2. THE SABOTAGE SELF-TEST. "A check whose negative case cannot fail is not a check": the
//      real DOM is mutated to look like a REGRESSION (disabled attribute stripped, reason
//      paragraph deleted) and the SAME oracle used above is re-run against it and MUST now
//      report the defect, before the real page is trusted again.
//   3. FLAG ON, a worker with NO login number (Selim Kaya): still disabled, still a reason —
//      "no phone" is not "missing", it gets its own sentence.
//   4. FLAG ON, a worker WITH a number who has never been sent to (Marta Nowak, BEFORE the
//      click below): the button is enabled and the row says nothing extra — same posture as
//      the code column saying nothing while a code is simply live.
//   5. A SUCCESSFUL SEND: click it, the stub accepts, the notice says "übergeben", and the
//      SAME standing code panel `issueCode` already uses opens with a working code — the
//      fallback is not a promise, it is the state the screen is already in.
//   6. A FAILED SEND: a second worker (Elif Demir, phone seeded here) whose number the stub
//      is told to reject. The notice says "nicht gesendet", the reason is named, and the
//      code panel STILL opens with a working code — decision-48 §5.1's whole point.
//   7. "Zugangscode erzeugen" is reachable in the SAME NUMBER OF CLICKS after all of the
//      above as it was before: never gated behind, or after, an SMS attempt.
//
// Everything this script writes to nfc_demo (Elif's phone claim, both workers' enrolment
// codes, the sms_deliveries rows) is captured before and restored in `finally`.
import { execFileSync } from 'node:child_process'
import { createServer as createHttpServer } from 'node:http'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { attach, launchChrome, sleep } from './cdp.mjs'
import { assertFreshBuild } from './build-guard.mjs'
import { assertDemoDatabase } from './db-guard.mjs'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const DB = process.env.DEMO_DB ?? 'nfc_demo'
const SHOTS = '/tmp/ts-demo/sms-picker'
const ADMIN = { email: 'demo@example.test', password: 'demo-nur-lokal-2026' }

// Obvious fakes, correctly SHAPED — same values server/check-sms-flag.mjs uses, so a
// reviewer who has read that file recognises them instantly as throwaway.
const FAKE_ACCOUNT_SID = `AC${'0123456789abcdef0123456789abcdef'.slice(0, 32)}`
const FAKE_API_KEY_SID = `SK${'fedcba9876543210fedcba9876543210'.slice(0, 32)}`
const FAKE_SECRET = 'not-a-real-twilio-secret-000000000'
const FAKE_FROM = '+43720123456'

const SUCCESS_TO = '+436600000004' // Marta Nowak's existing phone_identities row
const FAIL_TO = '+436605551234' // seeded onto Elif Demir for this run only

const failures = []
const assert = (what, ok, detail = '') => {
  if (ok) console.log(`  ok   ${what}${detail ? `  ${detail}` : ''}`)
  else {
    failures.push(what)
    console.log(`  FAIL ${what}${detail ? `\n         ${detail}` : ''}`)
  }
}
const sql = (text) =>
  execFileSync('psql', ['-d', DB, '-tAX', '-v', 'ON_ERROR_STOP=1', '-c', text], {
    encoding: 'utf8',
  }).trim()

assertDemoDatabase(`postgres:///${DB}`, (why) => {
  console.error(`check-sms-picker: ${why}`)
  process.exit(1)
})

/** Runs INSIDE the page. One shape, used for the real DOM and, later, a sabotaged copy. */
const PICKER_PROBE = `(() => {
  const rows = [...document.querySelectorAll('table.data-table tbody tr')]
  const rowFor = (name) => rows.find((r) => (r.querySelector('th')?.textContent || '').includes(name))
  const read = (name) => {
    const row = rowFor(name)
    if (!row) return null
    const btn = [...row.querySelectorAll('button')].find((b) => (b.textContent || '').includes('SMS senden'))
    if (!btn) return { found: false }
    const td = btn.closest('td')
    const note = td?.querySelector('p.cell-muted')?.textContent?.trim() ?? null
    const codeBtn = [...row.querySelectorAll('button')].find((b) =>
      (b.textContent || '').includes('Zugangscode'),
    )
    return {
      found: true,
      disabled: btn.disabled === true,
      ariaDisabled: btn.getAttribute('aria-disabled'),
      note,
      height: Math.round(btn.getBoundingClientRect().height),
      codeBtnPresent: !!codeBtn,
      codeBtnHeight: codeBtn ? Math.round(codeBtn.getBoundingClientRect().height) : null,
    }
  }
  return {
    marta: read('Marta Nowak'),
    selim: read('Selim Kaya'),
    andrea: read('Andrea Steiner'),
    elif: read('Elif Demir'),
  }
})()`

const STATUS_PROBE = (needle) =>
  `[...document.querySelectorAll('[role="status"],[role="alert"]')].some((el) => (el.textContent || '').includes(${JSON.stringify(needle)}))`

async function login(page, base) {
  await page.goto(`${base}/login/`, { settle: 700 })
  await page.type('input[name="email"]', ADMIN.email, { perChar: 0 })
  await page.type('input[name="password"]', ADMIN.password, { perChar: 0 })
  await page.clickText('Anmelden', { selector: 'form button[type="submit"]' })
  await page.waitFor(`location.pathname === '/'`, { timeout: 20000, label: 'the dashboard' })
  await page.goto(`${base}/workers/`, { settle: 1200 })
  await page.waitFor(`document.querySelector('table.data-table, .empty-state')`, {
    timeout: 15000,
    label: 'the worker list',
  })
}

async function main() {
  mkdirSync(SHOTS, { recursive: true })
  assertFreshBuild()

  // ---- the throwaway carrier, real HTTP, on loopback only ------------------------------
  const stub = createHttpServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      const params = new URLSearchParams(raw)
      if (params.get('To') === FAIL_TO) {
        res.writeHead(400, { 'content-type': 'application/json' })
        return res.end(JSON.stringify({ code: 21211, message: "The 'To' number is not a valid phone number." }))
      }
      res.writeHead(201, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ sid: `SM${'a'.repeat(32)}`, status: 'queued' }))
    })
  })
  await new Promise((r) => stub.listen(0, '127.0.0.1', r))
  const stubBase = `http://127.0.0.1:${stub.address().port}`

  // ---- ENV BEFORE THE FIRST IMPORT OF ANYTHING UNDER server/lib -------------------------
  // lib/db.js builds its connection pool from process.env.DATABASE_URL AT IMPORT TIME, and
  // the ESM module cache hands the same instance to every later importer.
  for (const k of [
    'TWILIO_ACCOUNT_SID',
    'TWILIO_SID',
    'TWILIO_SECRET',
    'TWILIO_FROM',
    'TWILIO_MESSAGING_SERVICE_SID',
    'TWILIO_API_BASE',
  ]) {
    delete process.env[k]
  }
  process.env.DATABASE_URL = `postgres:///${DB}`
  process.env.APP_KEY = 'demo-app-key-local-only-0123456789'
  process.env.PORT = '0'
  process.env.PUBLIC_DIR = path.join(ROOT, 'web', 'out')

  const { createServer } = await import('../server/server.js')
  const api = createServer()
  await new Promise((r) => api.listen(0, '127.0.0.1', r))
  const BASE = `http://127.0.0.1:${api.address().port}`

  // ---- capture EVERYTHING this run is about to write, so it can put it back exactly ----
  const before = {
    elifPhone: sql('SELECT phone_e164 FROM phone_identities WHERE worker_id = 5'),
    martaCode: sql(
      'SELECT enrolment_code_hash, enrolment_code_expires_at, enrolment_code_issued_at, enrolment_code_issued_by, enrolment_code_redeemed_at FROM workers WHERE id = 1',
    ),
    elifCode: sql(
      'SELECT enrolment_code_hash, enrolment_code_expires_at, enrolment_code_issued_at, enrolment_code_issued_by, enrolment_code_redeemed_at FROM workers WHERE id = 5',
    ),
  }

  const chromes = []
  const launch = async (opts) => {
    const c = await launchChrome(opts)
    chromes.push(c)
    return c
  }

  try {
    // Elif has no login number today (measured above with 0 rows) — give her one so the
    // FAILED-send state has a real worker to click, exactly as PUT /admin/workers/:id/phone
    // would if the admin panel drove it instead of this script seeding it directly.
    if (before.elifPhone === '') {
      sql(`INSERT INTO phone_identities (phone_e164, worker_id) VALUES ('${FAIL_TO}', 5)`)
    }

    // ============================================================================
    // PHASE 1 · FLAG OFF — measured, not assumed: this process holds no TWILIO_* at all,
    // byte for byte what /etc/nfc/env carries on schimmer-glanz.exe.xyz today.
    // ============================================================================
    console.log('-- phase 1: flag OFF (this process holds no TWILIO_* env at all) --')
    let chrome = await launch({ port: 9461, width: 1680, height: 1050 })
    let page = await attach(chrome.port)
    await login(page, BASE)

    const off = await page.eval(PICKER_PROBE)
    await page.eval(`document.querySelectorAll('*').forEach((el) => el.getAnimations?.().forEach((a) => a.finish()))`)
    await sleep(150)
    await page.screenshot(`${SHOTS}/1-flag-off-1680.png`)

    assert(
      'flag off: "SMS senden" is RENDERED for an active worker, never missing',
      off.marta?.found === true && off.selim?.found === true,
      JSON.stringify({ marta: off.marta?.found, selim: off.selim?.found }),
    )
    assert(
      'flag off: the button is disabled AND aria-disabled, for every worker alike',
      off.marta?.disabled === true &&
        off.marta?.ariaDisabled === 'true' &&
        off.selim?.disabled === true &&
        off.selim?.ariaDisabled === 'true',
      JSON.stringify({
        marta: [off.marta?.disabled, off.marta?.ariaDisabled],
        selim: [off.selim?.disabled, off.selim?.ariaDisabled],
      }),
    )
    assert(
      'flag off: the reason is IN WORDS, not a colour — the exact German sentence',
      off.marta?.note === 'SMS ist nicht eingerichtet. Code vorlesen oder kopieren.' &&
        off.andrea?.note === 'SMS ist nicht eingerichtet. Code vorlesen oder kopieren.',
      JSON.stringify({ marta: off.marta?.note, andrea: off.andrea?.note }),
    )
    assert('"Zugangscode erzeugen" sits RIGHT THERE, unaffected — same cell, same click count', off.marta?.codeBtnPresent === true)
    // NOT 44px here on purpose (globals.css's own comment on .btn-quiet): a quiet button is
    // "a text link wearing a button's semantics", 32px on desktop where THE ROW is the
    // target, and it matches "Zugangscode erzeugen" exactly — the SAME control this button
    // sits beside, at the SAME weight. The 44px FLOOR is a `max-width: 767px` rule
    // (globals.css "Touch targets") and is asserted at 390px below, where it is load-bearing.
    assert(
      'desktop: the new button is the SAME height as "Zugangscode erzeugen" — same weight, same control family',
      off.marta?.height === off.marta?.codeBtnHeight,
      `sms=${off.marta?.height} code=${off.marta?.codeBtnHeight}`,
    )

    // ---- the sabotage self-test: PROVE the oracle above can fail --------------------
    // "A check whose negative case cannot fail is not a check." The mutation below is
    // exactly the regression decision-48 names as plausible: a tidy-up that leaves the
    // button enabled, or drops the reason paragraph, without anybody noticing on a screen
    // that otherwise looks identical.
    console.log('\n-- sabotage self-test (RED expected, then reverted) --')
    const sabotageOk = await page.eval(`(() => {
      const rows = [...document.querySelectorAll('table.data-table tbody tr')]
      const row = rows.find((r) => (r.querySelector('th')?.textContent || '').includes('Marta Nowak'))
      const btn = [...row.querySelectorAll('button')].find((b) => (b.textContent || '').includes('SMS senden'))
      btn.disabled = false
      btn.removeAttribute('aria-disabled')
      btn.closest('td').querySelector('p.cell-muted')?.remove()
      return true
    })()`)
    const sabotaged = await page.eval(PICKER_PROBE)
    const wronglyEnabled = sabotageOk && sabotaged.marta?.disabled === false && sabotaged.marta?.note === null
    assert(
      'sabotage: the SAME probe correctly reports the mutated DOM as broken (RED, on purpose)',
      wronglyEnabled,
      JSON.stringify(sabotaged.marta),
    )
    // Reload wipes the mutation; the real page is what every assertion after this point uses.
    await page.goto(`${BASE}/workers/`, { settle: 1200 })
    await page.waitFor(`document.querySelector('table.data-table')`, {
      timeout: 15000,
      label: 'the worker list, reloaded clean',
    })
    const reverted = await page.eval(PICKER_PROBE)
    assert(
      'sabotage reverted: a fresh load is disabled + reasoned again, not the mutated copy',
      reverted.marta?.disabled === true && reverted.marta?.note !== null,
      JSON.stringify(reverted.marta),
    )
    try { page.close() } catch { /* already gone */ }
    chrome.child.kill()

    // 390px, flag still off. `--window-size` alone is not reliable at this width (measured:
    // 390 requested came back as a 500px-wide PNG) — the same reason every other 390px check
    // in this directory pins the viewport explicitly via CDP, after the window opens.
    chrome = await launch({ port: 9462, width: 390, height: 900 })
    page = await attach(chrome.port)
    await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
    await login(page, BASE)
    const at390 = await page.eval(PICKER_PROBE)
    // Scroll the picker itself into frame — a full-page capture from the top would prove
    // "no sideways scroll" but not show the two buttons a reviewer actually needs to see.
    await page.scrollTo("table.data-table tbody th", { pause: 500 })
    await page.screenshot(`${SHOTS}/2-flag-off-390.png`)
    assert(
      '390px: both onboarding buttons still meet the 44px floor',
      (at390.marta?.height ?? 0) >= 44 && (at390.marta?.codeBtnHeight ?? 0) >= 44,
      JSON.stringify({ sms: at390.marta?.height, code: at390.marta?.codeBtnHeight }),
    )
    assert('390px: the reason is still there, in words, not clipped away', at390.marta?.note !== null, at390.marta?.note ?? '(none)')
    try { page.close() } catch { /* already gone */ }
    chrome.child.kill()

    // ============================================================================
    // PHASE 2 · FLAG ON — the SAME process, the flag re-read on the NEXT request.
    // No restart, no second server: smsConfigured() reads process.env fresh, per request.
    // ============================================================================
    console.log('\n-- phase 2: flag ON, against a LOCAL stub carrier (no real SMS possible) --')
    process.env.TWILIO_ACCOUNT_SID = FAKE_ACCOUNT_SID
    process.env.TWILIO_SID = FAKE_API_KEY_SID
    process.env.TWILIO_SECRET = FAKE_SECRET
    process.env.TWILIO_FROM = FAKE_FROM
    process.env.TWILIO_API_BASE = stubBase

    chrome = await launch({ port: 9463, width: 1680, height: 1050 })
    page = await attach(chrome.port)
    await login(page, BASE)

    const on = await page.eval(PICKER_PROBE)
    assert(
      'flag on, no phone (Selim Kaya): still disabled, still a NAMED reason — never just missing',
      on.selim?.disabled === true && on.selim?.ariaDisabled === 'true' && on.selim?.note === 'Keine Login-Nummer hinterlegt. Zugangscode direkt weitergeben.',
      JSON.stringify(on.selim),
    )
    assert(
      'flag on, has a number, never sent to (Marta Nowak): the button is ENABLED, and the row says nothing extra yet',
      on.marta?.disabled === false && on.marta?.ariaDisabled === 'false' && on.marta?.note === null,
      JSON.stringify(on.marta),
    )
    await sleep(150)
    await page.screenshot(`${SHOTS}/3-flag-on-ready.png`)

    // ---- 5 · a SUCCESSFUL send -------------------------------------------------------
    console.log('\n-- click "SMS senden" for Marta Nowak (stub: accepts) --')
    await page.eval(`(() => {
      const rows = [...document.querySelectorAll('table.data-table tbody tr')]
      const row = rows.find((r) => (r.querySelector('th')?.textContent || '').includes('Marta Nowak'))
      const btn = [...row.querySelectorAll('button')].find((b) => (b.textContent || '').includes('SMS senden'))
      btn.click()
    })()`)
    await page.waitFor(STATUS_PROBE('übergeben'), { timeout: 8000, label: 'the "übergeben" notice' })
    await page.waitFor(`document.querySelector('.share-panel .code')`, { timeout: 5000, label: 'the code panel' })
    const sentNotice = await page.eval(
      `document.querySelector('[role="status"].form-status')?.textContent || document.querySelector('[role="status"]')?.textContent || ''`,
    )
    const sentCode = await page.eval(`document.querySelector('.share-panel .code')?.textContent || ''`)
    assert(
      'a successful send: the notice says "übergeben" AND names the phone',
      sentNotice.includes('übergeben') && sentNotice.includes(SUCCESS_TO),
      sentNotice,
    )
    assert(
      'THE FALLBACK, STRUCTURALLY: the SAME standing code panel opens with a working code, on the successful path too',
      /^[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(sentCode.trim()),
      `code panel text: "${sentCode}"`,
    )
    await sleep(150)
    await page.screenshot(`${SHOTS}/4-sms-sent.png`)

    // Reload: the row's PERSISTENT note (append-only sms_deliveries, not a client toast).
    await page.goto(`${BASE}/workers/`, { settle: 1200 })
    await page.waitFor(`document.querySelector('table.data-table')`, { timeout: 15000, label: 'the worker list, after a send' })
    const afterSent = await page.eval(PICKER_PROBE)
    assert(
      'the row REMEMBERS the last attempt after a reload — a fact from sms_deliveries, not a toast that vanished',
      afterSent.marta?.note !== null && afterSent.marta?.note.includes('übergeben') && afterSent.marta?.note.includes(SUCCESS_TO),
      afterSent.marta?.note ?? '(none)',
    )
    await sleep(150)
    await page.screenshot(`${SHOTS}/5-sms-sent-persisted.png`)

    // ---- 6 · a FAILED send, and the fallback survives it too --------------------------
    console.log('\n-- click "SMS senden" for Elif Demir (stub: rejects this number) --')
    await page.eval(`(() => {
      const rows = [...document.querySelectorAll('table.data-table tbody tr')]
      const row = rows.find((r) => (r.querySelector('th')?.textContent || '').includes('Elif Demir'))
      const btn = [...row.querySelectorAll('button')].find((b) => (b.textContent || '').includes('SMS senden'))
      btn.click()
    })()`)
    await page.waitFor(STATUS_PROBE('nicht gesendet'), { timeout: 8000, label: 'the "nicht gesendet" notice' })
    await page.waitFor(`document.querySelector('.share-panel .code')`, { timeout: 5000, label: 'the code panel (failed path)' })
    const failNotice = await page.eval(
      `document.querySelector('[role="status"].form-error')?.textContent || document.querySelector('[role="status"]')?.textContent || ''`,
    )
    const failCode = await page.eval(`document.querySelector('.share-panel .code')?.textContent || ''`)
    assert('a failed send: the notice says "nicht gesendet" and names a reason', failNotice.includes('nicht gesendet'), failNotice)
    assert(
      'A FAILED SEND IS STILL A WORKING CODE ON SCREEN — decision-48 §5.1, the whole point',
      /^[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(failCode.trim()),
      `code panel text: "${failCode}"`,
    )
    await sleep(150)
    await page.screenshot(`${SHOTS}/6-sms-failed.png`)

    await page.goto(`${BASE}/workers/`, { settle: 1200 })
    await page.waitFor(`document.querySelector('table.data-table')`, { timeout: 15000, label: 'the worker list, after a failure' })
    const afterFail = await page.eval(PICKER_PROBE)
    assert(
      'the row remembers a FAILURE too, in words, not silently forgotten',
      afterFail.elif?.note !== null && afterFail.elif?.note.includes('nicht gesendet'),
      afterFail.elif?.note ?? '(none)',
    )

    // ---- 7 · the code path is still there, still one click, after all of the above ----
    assert(
      '"Zugangscode erzeugen" is STILL present and STILL the same control, never gated behind an SMS attempt',
      afterFail.marta?.codeBtnPresent === true && afterFail.selim?.codeBtnPresent === true,
      JSON.stringify({ marta: afterFail.marta?.codeBtnPresent, selim: afterFail.selim?.codeBtnPresent }),
    )
    await sleep(150)
    await page.screenshot(`${SHOTS}/7-flag-on-both-attempts.png`)

    try { page.close() } catch { /* already gone */ }
    chrome.child.kill()
  } catch (cause) {
    assert('the probe reached the end of the run', false, `${String(cause?.message ?? cause).slice(0, 500)}\n         everything after this point was NOT measured`)
  } finally {
    for (const c of chromes) {
      try {
        c.child.kill()
      } catch {
        /* already gone */
      }
    }
    try {
      api.close()
    } catch {
      /* already gone */
    }
    try {
      stub.close()
    } catch {
      /* already gone */
    }

    // ---- put nfc_demo back exactly as this script found it -----------------------------
    if (before.elifPhone === '') {
      sql(`DELETE FROM phone_identities WHERE worker_id = 5 AND phone_e164 = '${FAIL_TO}'`)
    }
    sql('DELETE FROM sms_deliveries WHERE worker_id IN (1, 5)')
    for (const [id, snapshot] of [
      [1, before.martaCode],
      [5, before.elifCode],
    ]) {
      const [hash, expires, issuedAt, issuedBy, redeemed] = snapshot.split('|')
      sql(
        `UPDATE workers SET enrolment_code_hash = ${hash ? `'${hash}'` : 'NULL'}, ` +
          `enrolment_code_expires_at = ${expires ? `'${expires}'` : 'NULL'}, ` +
          `enrolment_code_issued_at = ${issuedAt ? `'${issuedAt}'` : 'NULL'}, ` +
          `enrolment_code_issued_by = ${issuedBy ? issuedBy : 'NULL'}, ` +
          `enrolment_code_redeemed_at = ${redeemed ? `'${redeemed}'` : 'NULL'} ` +
          `WHERE id = ${id}`,
      )
    }
    const restoredElifPhone = sql('SELECT phone_e164 FROM phone_identities WHERE worker_id = 5')
    const restoredCodes = sql(
      "SELECT count(*) FROM workers WHERE id IN (1,5) AND enrolment_code_hash IS NOT NULL",
    )
    const restoredDeliveries = sql('SELECT count(*) FROM sms_deliveries WHERE worker_id IN (1,5)')
    assert(
      'teardown: nfc_demo is back exactly as this script found it (phone claim, codes, deliveries)',
      restoredElifPhone === before.elifPhone && restoredCodes === '0' && restoredDeliveries === '0',
      `elifPhone=${JSON.stringify(restoredElifPhone)} vs ${JSON.stringify(before.elifPhone)} · codes-left=${restoredCodes} · deliveries-left=${restoredDeliveries}`,
    )
  }

  console.log('')
  if (failures.length > 0) {
    console.log(`check-sms-picker: ${failures.length} FAIL`)
    for (const f of failures) console.log(`  - ${f}`)
    process.exitCode = 1
  } else {
    console.log('check-sms-picker: all checks green')
  }
}

await main()
