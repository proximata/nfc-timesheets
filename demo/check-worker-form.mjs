// THE WORKER FORM'S PROMISES, driven: which fields are mandatory, whether the screen SAYS so,
// and whether the wage can be skipped past.
//
//   DEMO_BASE=http://127.0.0.1:8080 node demo/check-worker-form.mjs
//
// READ-ONLY against nfc_demo. It opens the create drawer and submits it ONCE with an empty
// wage, which the screen refuses client-side — no worker is created, nothing is written, and
// the check asserts the row count is unchanged rather than assuming it.
//
// WHY A SEPARATE FILE FROM demo/check-operators.mjs. Two different claims about two screens,
// and this one is downstream of a decision that IS NOT SETTLED: decision-41 ("a worker's rate
// is REQUIRED and strictly positive") is still PROPOSED, and decision-43 SUPERSEDES the
// accepted decision-37. NOTHING HERE RULES ON THAT. What it measures is narrower and is true
// either way: the screen as built today marks the wage mandatory, says why in words, and
// refuses to submit without it. If the owner rules against decision-41, this file is what
// says exactly which sentences have to come back out.
//
//   1. EVERY field on the worker form is marked required OR optional — never neither. An
//      unmarked field reads as mandatory, so a form of unmarked fields is a form that lies
//      about all of them (TASK-51, components/Field.tsx's own comment).
//   2. The visible `*` is backed by a native `required` on the control, so the marker and
//      the browser agree.
//   3. The wage says, in prose, that it is mandatory AND that zero is not a rate. Not a red
//      asterisk on its own: decision-41's whole argument is that an invented rate is worse
//      than a missing person, and that argument has to reach the person typing.
//   4. Submitting with the wage empty is REFUSED, in the field, with the drawer still open —
//      and no worker row appears.
//   5. The off-nav route wired in W1 is reachable: /workers/ carries the only inbound link to
//      /operators/, and lib/nav.ts's OFF_NAV_ROUTES claims exactly that.
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { attach, launchChrome, sleep } from './cdp.mjs'
import { assertFreshBuild } from './build-guard.mjs'

const BASE = process.env.DEMO_BASE ?? 'http://127.0.0.1:8080'
const DB = process.env.DEMO_DB ?? 'nfc_demo'
const SHOTS = '/tmp/ts-demo/worker-form'
const ADMIN = { email: 'demo@example.test', password: 'demo-nur-lokal-2026' }

const host = new URL(BASE).hostname
if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(host)) {
  console.error(`check-worker-form: refusing to run against "${host}" — loopback only.`)
  process.exit(1)
}

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

/**
 * CHECKBOXES ARE OUT OF SCOPE FOR THE REQUIRED/OPTIONAL MARKER, and that is a correction to
 * this file rather than a defect on the screen.
 *
 * `.field-check` is a hand-rolled div, not the <Field> component, on five screens
 * (workers, clients ×2, locations ×3, inventory). A checkbox ALWAYS has a value — checked or
 * unchecked — so there is nothing it can be missing, and "optional" next to "Aktiv – darf
 * sich anmelden" would be answering a question nobody asked. The rule TASK-51 states is
 * about fields that can be left EMPTY, so this measures exactly those.
 */
const FIELDS_PROBE = `(() => {
  return [...document.querySelectorAll('.drawer .field')].map((f) => {
    const control = f.querySelector('input,select,textarea')
    return {
      kind: control?.type ?? control?.tagName?.toLowerCase() ?? 'none',
      label: (f.querySelector('label')?.childNodes[0]?.nodeValue || '').trim()
        || (f.querySelector('label')?.textContent || '').trim(),
      star: !!f.querySelector('.req'),
      optional: !!f.querySelector('.opt'),
      nativeRequired: control?.required === true,
      hint: (f.querySelector('.field-hint')?.textContent || '').trim(),
      error: (f.querySelector('.field-error')?.textContent || '').trim(),
      invalid: control?.getAttribute('aria-invalid'),
    }
  })
})()`

async function main() {
  mkdirSync(SHOTS, { recursive: true })
  assertFreshBuild()
  const workersBefore = sql('SELECT count(*) FROM workers')

  const chrome = await launchChrome({ port: 9423, width: 1680, height: 1050 })
  const page = await attach(chrome.port)
  try {
    await page.goto(`${BASE}/login/`, { settle: 700 })
    await page.type('input[name="email"]', ADMIN.email, { perChar: 0 })
    await page.type('input[name="password"]', ADMIN.password, { perChar: 0 })
    await page.clickText('Anmelden', { selector: 'form button[type="submit"]' })
    await page.waitFor(`location.pathname === '/'`, { timeout: 20000, label: 'the dashboard' })

    await page.goto(`${BASE}/workers/`, { settle: 1200 })
    await page.waitFor(`document.querySelector('table.data-table, .empty-state')`, {
      timeout: 15000,
      label: 'the worker list',
    })

    // ---- 5 · the inbound link W1 wired --------------------------------------------------
    const link = await page.eval(`(() => {
      const a = [...document.querySelectorAll('a[href]')].find((el) => el.getAttribute('href') === '/operators/')
      return a ? { text: (a.textContent || '').trim(), visible: a.getClientRects().length > 0 } : null
    })()`)
    assert(
      'nav: /workers/ carries the only inbound link to the off-nav /operators/',
      link !== null && link.visible && link.text !== '',
      link === null ? 'no anchor with href="/operators/" on the page' : JSON.stringify(link),
    )

    // ---- 1-3 · the form ------------------------------------------------------------------
    await page.eval(`document.querySelector('.topline-action button').click()`)
    await page.waitFor(`document.querySelector('.drawer form')`, {
      timeout: 8000,
      label: 'the worker drawer',
    })
    await page.eval(`document.querySelector('.drawer').getAnimations().forEach((a) => a.finish())`)
    await sleep(200)
    await page.screenshot(`${SHOTS}/worker-drawer.png`)

    const all = await page.eval(FIELDS_PROBE)
    const fields = all.filter((f) => f.kind !== 'checkbox')
    assert(
      'form[workers]: every field that can be left empty is marked required or optional',
      fields.length >= 4 && fields.every((f) => f.star !== f.optional),
      `${fields
        .map((f) => `${f.label}: ${f.star ? '*' : f.optional ? 'optional' : 'UNMARKED'}`)
        .join(' · ')}  |  not asked about: ${
        all
          .filter((f) => f.kind === 'checkbox')
          .map((f) => f.label)
          .join(', ') || 'none'
      }`,
    )
    assert(
      'form[workers]: the visible * and the native required agree, field by field',
      fields.every((f) => f.star === f.nativeRequired),
      fields.map((f) => `${f.label}: star=${f.star} required=${f.nativeRequired}`).join(' · '),
    )

    const rate = fields.find((f) => /Stundensatz|rate/i.test(f.label))
    assert(
      'wage: the hourly rate is marked mandatory, and the control agrees',
      rate !== undefined && rate.star && rate.nativeRequired && !rate.optional,
      rate === undefined ? `no wage field among: ${fields.map((f) => f.label).join(', ')}` : JSON.stringify(rate),
    )
    assert(
      'wage: the hint says in words that it is required AND that zero is not a rate',
      rate !== undefined && /Pflichtfeld/.test(rate.hint) && /0,00/.test(rate.hint),
      rate === undefined ? '' : `"${rate.hint}"`,
    )

    // ---- 4 · it cannot be skipped past ----------------------------------------------------
    await page.type('.drawer input[type="text"]', 'PROBE Ohne Satz', { perChar: 0 })
    await page.clickText('Mitarbeiter anlegen', {
      selector: '.drawer footer button[type="submit"]',
    })
    await sleep(1200)
    const after = await page.eval(FIELDS_PROBE)
    const rateAfter = after.find((f) => /Stundensatz|rate/i.test(f.label))
    await page.screenshot(`${SHOTS}/worker-drawer-refused.png`)
    assert(
      'wage: an empty rate is refused IN THE FIELD, with the drawer still open',
      (await page.eval(`document.querySelector('.drawer') !== null`)) &&
        rateAfter !== undefined &&
        rateAfter.invalid === 'true' &&
        /Stundensatz/.test(rateAfter.error),
      rateAfter === undefined ? 'the wage field is gone' : JSON.stringify(rateAfter),
    )
    assert(
      'wage: the refusal explains the consequence, not just "required"',
      rateAfter !== undefined && /abgerechnet|bezahlt/.test(rateAfter.error),
      rateAfter === undefined ? '' : `"${rateAfter.error}"`,
    )
    assert(
      'wage: nothing was written — the worker count is unchanged',
      sql('SELECT count(*) FROM workers') === workersBefore,
      `${sql('SELECT count(*) FROM workers')} vs ${workersBefore} before`,
    )
    // NON-VACUITY for the line above: the same oracle, asked about a row that does exist.
    assert(
      'wage: that count oracle can see a worker at all (non-vacuity)',
      Number(workersBefore) > 0,
      `${workersBefore} worker(s) in ${DB}`,
    )
  } catch (cause) {
    assert(
      'the probe reached the end of the run',
      false,
      `${String(cause?.message ?? cause).slice(0, 300)}\n         everything after this point was NOT measured`,
    )
  } finally {
    try {
      await page.close()
    } catch {
      /* already gone */
    }
    chrome.child.kill()
  }

  console.log('')
  if (failures.length > 0) {
    console.log(`check-worker-form: ${failures.length} FAIL`)
    for (const f of failures) console.log(`  - ${f}`)
    process.exitCode = 1
  } else {
    console.log('check-worker-form: all checks green')
  }
}

await main()
