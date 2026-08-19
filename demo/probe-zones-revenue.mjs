// GEOMETRY, MEASURED, for the three surfaces this run added: the zone list and the zone
// drawer on /locations/, and the revenue ledger and its drawer on /pl/.
//
// It answers the questions a screenshot cannot: does anything overflow 390px, is every new
// control reachable by keyboard, is focus trapped inside a drawer and restored when it
// closes, does Escape close it, and does every new sentence survive both themes.
//
// Numbers, not adjectives. Every assertion prints what it measured, so a regression shows
// up as a changed number in a diff rather than as a screenshot somebody has to compare by
// eye.
//
//   node demo/probe-zones-revenue.mjs            (server on 127.0.0.1:4319, DB nfc_demo)
//   BASE=http://127.0.0.1:4319 node demo/probe-zones-revenue.mjs
import { assertFreshBuild } from './build-guard.mjs'
import { attach, launchChrome, sleep } from './cdp.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4319'
const EMAIL = process.env.DEMO_EMAIL ?? 'demo@example.test'
const PASSWORD = process.env.DEMO_PASSWORD ?? 'demo-nur-lokal-2026'

// Loopback only. Same guard every other demo/*.mjs carries: this script logs in.
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(BASE)) {
  throw new Error(`refusing a non-loopback target: ${BASE}`)
}
// BEFORE Chrome is launched: every number below is about the bundle in web/out, and a
// bundle older than the tree makes both a pass and a fail describe code nobody is reading.
assertFreshBuild()

const WIDTHS = [
  // decision-7's desktop case, at the width the owner named.
  { name: '1680', width: 1680, height: 1050 },
  // THE LAPTOP, and it is here for the map info box specifically. The box is as tall as
  // the MAP REGION lets it be, and the map region scales with the VIEWPORT HEIGHT — so a
  // 1050px-tall screen and a 900px-tall one give different boxes, and a fold that appears
  // on the shorter one is invisible on the taller. Width is not the variable this surface
  // is sensitive to, which is why the two sizes above could not see it.
  { name: '1440x900', width: 1440, height: 900 },
  // decision-28: the admin panel works on a phone. 390 is the iPhone the director carries.
  { name: '390', width: 390, height: 844 },
]
const THEMES = ['dark', 'light']

const failures = []
const skipped = []
const lines = []
function record(ok, label, detail) {
  lines.push(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(`${label}: ${detail}`)
}

/**
 * NOT A PASS. A surface this build cannot render, named out loud.
 *
 * The map is the case: `NEXT_PUBLIC_GOOGLE_MAPS_KEY` is not in `ops/deploy.sh`, so the
 * default build draws no pin at all, and an assertion about pins written as
 * `pins === 0 || <the real test>` is green on a screen that never existed. That is worse
 * than a red one — it is a check reporting that it checked something.
 *
 * So the pin assertions SKIP, loudly, and the run prints how to make them run for real:
 *
 *   cd web && NEXT_PUBLIC_GOOGLE_MAPS_KEY=$(psst get NEXT_PUBLIC_GOOGLE_MAPS_KEY) pnpm build
 *   DATABASE_URL=postgres:///nfc_demo APP_KEY=… PORT=8080 PUBLIC_DIR="$PWD/web/out" \
 *     node demo/demo-server.mjs &
 *   BASE=http://127.0.0.1:8080 node demo/probe-zones-revenue.mjs
 *
 * PORT 8080 IS PART OF THE FIXTURE and the default port for this file is NOT. The browser
 * key's HTTP-referrer allowlist contains exactly one loopback origin, `http://127.0.0.1:8080/*`
 * (measured origin by origin — the table is in demo/check-map-home.mjs's header). On :4319,
 * which is what the line above defaults to, Google answers `RefererNotAllowedMapError`, no
 * pin is drawn, and every map assertion here SKIPS. Two consecutive runs read those skips as
 * "the key rejects loopback" and wrote it down as measured. It does not. Run this file on
 * 8080 or its map coverage is zero.
 */
function skip(label, why) {
  lines.push(`SKIP ${label} — ${why}`)
  skipped.push(label)
}

/**
 * DOES THE PAGE OVERFLOW, and who did it.
 *
 * VERBATIM the definition demo/audit-widths.mjs uses, deliberately: `scrollWidth -
 * clientWidth` with a 1px tolerance, and culprits filtered through a CLIPPING-ancestor test.
 * A first version of this probe measured raw `getBoundingClientRect().right` against the
 * viewport and reported +871px on every screen at 390 - it was reading the table inside its
 * own `overflow-x: auto` panel and the off-canvas sidebar, neither of which a user can
 * scroll the PAGE to. Two definitions of "fits" is how two audits come to disagree.
 */
const OVERFLOW = `(() => {
  const by = document.documentElement.scrollWidth - document.documentElement.clientWidth
  const limit = window.innerWidth + 1
  const clipped = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const o = getComputedStyle(p)
      if (/hidden|clip|auto|scroll/.test(o.overflowX)) return true
    }
    return false
  }
  const over = [...document.querySelectorAll('body *')].filter((el) => {
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.right > limit && !clipped(el)
  })
  const overSet = new Set(over)
  const culprits = over
    .filter((el) => ![...el.children].some((c) => overSet.has(c)))
    .sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right)
    .slice(0, 3)
    .map((el) => {
      const r = el.getBoundingClientRect()
      const cls = String(el.className).split(' ').filter(Boolean).slice(0, 2).join('.')
      return el.tagName.toLowerCase() + (cls ? '.' + cls : '') + ' right=' + Math.round(r.right)
    })
  return { over: by > 1 ? by : 0, what: culprits.join(' | ') }
})()`

/**
 * DOES A FOLD ANNOUNCE ITSELF.
 *
 * The info box on a pin is as tall as the map region lets it be, and on a 900px-tall screen
 * the region is 324px — so the numbers face folds by 6px on most buildings and by 27px on
 * the one with somebody standing in it. There is no room to give it (`--map-info-max` is
 * already the whole region less INFO_MARGIN twice), and HomeMap's INFO_MIN_HEIGHT comment
 * accepts scrolling by design. What is NOT acceptable is scrolling with nothing drawn:
 * macOS overlay scrollbars paint nothing until a gesture starts, so the cut row reads as
 * the end of the list.
 *
 * So the rule is not "never fold". It is: FOLD ONLY WITH A CUE. The cue is the two-layer
 * `background-attachment: local, scroll` shadow in globals.css, which draws if and only if
 * there is content below the fold — so this reads the computed style rather than a class,
 * and a stylesheet that loses the rule fails here even though the DOM is unchanged.
 *
 * `--hide-scrollbars` is on every Chrome this repo launches, which is exactly why a
 * scrollbar-width assertion would be worthless and this one is not.
 */
const FOLD_CUE = `(face) => {
  if (!face) return { cued: false, cue: 'no visible face' }
  const over = face.scrollHeight - face.clientHeight
  if (over <= 2) return { cued: true, cue: 'no fold (+' + over + 'px)' }
  const s = getComputedStyle(face)
  const layers = s.backgroundAttachment.split(',').map((x) => x.trim())
  const drawn = /gradient/.test(s.backgroundImage) && layers.includes('local') && layers.includes('scroll')
  return {
    cued: drawn,
    cue: '+' + over + 'px folded — cue ' + (drawn ? 'drawn' : 'MISSING') + ' [' + layers.join('|') + ']',
  }
}`

/** Everything the keyboard can reach, in tab order, as text. */
const FOCUSABLES = `(() => {
  const sel = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  return Array.from(document.querySelectorAll(sel))
    .filter((el) => el.offsetParent !== null || getComputedStyle(el).position === 'fixed')
    .map((el) => (el.getAttribute('aria-label') || el.textContent || el.name || el.type || el.tagName).trim().slice(0, 40))
})()`

/** Signed in the way the director does: two fields and a button, not an injected cookie. */
async function login(page) {
  await page.goto(`${BASE}/login/`, { settle: 700 })
  await page.type('input[name="email"]', EMAIL, { perChar: 5 })
  await page.type('input[name="password"]', PASSWORD, { perChar: 5 })
  await sleep(200)
  await page.eval(`document.querySelector('form button[type="submit"]').click()`)
  await page.waitFor(`location.pathname === '/'`, { label: 'the dashboard after sign-in' })
  await sleep(1000)
}

async function setTheme(page, theme) {
  await page.eval(`(() => {
    document.documentElement.dataset.theme = ${JSON.stringify(theme)}
    try { localStorage.setItem('ts-theme', ${JSON.stringify(theme)}) } catch {}
    return document.documentElement.dataset.theme
  })()`)
  await sleep(150)
}

// CONTRAST IS NOT MEASURED HERE. demo/audit-contrast.mjs already resolves every token
// THROUGH Chrome and composites the translucent ones over what is actually behind them,
// which is the part a hand-rolled version gets wrong: `--accent-weak` is
// `oklch(0.55 0.12 250 / 0.12)`, and a naive `rgb()` parser reads "0.55, 0.12, 250" as the
// background and reports 2.2:1 for a panel that is fine. That audit is the authority; this
// probe measures what it cannot know about.

async function run() {
  const { child, port } = await launchChrome({ port: 9341, width: 1680, height: 1050 })
  const page = await attach(port)
  try {
    await login(page)

    for (const { name, width, height } of WIDTHS) {
      await page.send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: width < 700,
      })

      for (const theme of THEMES) {
        const tag = `${name}/${theme}`

        // ---- /locations/, the zone list -------------------------------------------
        await page.goto(`${BASE}/locations/`)
        await setTheme(page, theme)
        await page.waitFor(`document.querySelectorAll('table.data-table tbody tr').length > 0`)

        let over = await page.eval(OVERFLOW)
        record(
          over.over <= 0,
          `${tag} /locations/ fits ${width}px`,
          `worst +${over.over}px ${over.what}`,
        )

        // The zone column exists on every row and names the area state in WORDS.
        const zoneWords = await page.eval(`(() => {
          const rows = Array.from(document.querySelectorAll('table.data-table tbody tr'))
          return rows.map((r) => (r.children[4]?.textContent || '').trim().slice(0, 70))
        })()`)
        record(
          zoneWords.every((w) => w.length > 0),
          `${tag} every building states its zone/area state`,
          `${zoneWords.length} rows, e.g. "${zoneWords[0]}"`,
        )
        // GREY IS NEVER THE ONLY SIGNAL, and this counts rather than greps.
        //
        // A `body.innerText.includes(...)` version of this assertion passed for the wrong
        // reason twice: once because the phrase appeared in a hint paragraph belonging to no
        // row, and once because the copy was reworded and the check silently went looking
        // for a string nothing rendered any more. So the number of ROWS carrying the words
        // is compared against the number of buildings the API says have no live zone. Both
        // sides are measured; neither is a constant.
        const zoneTruth = await page.eval(`(async () => {
          const res = await fetch('/admin/data?limit=2000', { credentials: 'include' })
          const data = await res.json()
          const live = new Map()
          for (const z of data.zones) {
            if (!z.active) continue
            live.set(z.location_id, (live.get(z.location_id) || 0) + 1)
          }
          const unzoned = data.locations.filter((l) => (live.get(l.id) || 0) === 0)
          const rows = Array.from(document.querySelectorAll('table.data-table tbody tr'))
          const said = rows.filter((r) => unzoned.some((l) => r.textContent.includes(l.name)) && /Noch keine Zone angelegt|No zone recorded yet/.test(r.textContent))
          return {
            unzoned: unzoned.length,
            unzonedActive: unzoned.filter((l) => l.active).length,
            said: said.length,
            names: unzoned.map((l) => l.name),
          }
        })()`)
        record(
          zoneTruth.unzoned > 0 && zoneTruth.said === zoneTruth.unzoned,
          `${tag} every unzoned building says so in words, not only in grey`,
          `${zoneTruth.said}/${zoneTruth.unzoned} rows carry the sentence — ${zoneTruth.names.join(', ')}`,
        )
        // ...AND THE BUILDING IS STILL ACTIVE. The rule the owner stated operationally would
        // refuse the tap from the card on the HOIV wall (decision-43 section 3), so the
        // fixture that proves the words are there also proves the state was not merged.
        record(
          zoneTruth.unzonedActive === zoneTruth.unzoned,
          `${tag} ...and every one of them is still ACTIVE, not silently stood down`,
          `${zoneTruth.unzonedActive} of ${zoneTruth.unzoned} active`,
        )

        // THE AREA ON SCREEN IS THE SUM OF THE ZONES, AND AN UNMEASURED ZONE MAKES IT SAY SO.
        //
        // decision-43: the building stores no area, so this number is derived twice — by
        // `lib/area.ts` for this table and by `SUM(z.area_sqm)` in server/lib/reporting.js
        // for /pl/. Two derivations of one fact drift, and the drift shows up as a director
        // quoting a EUR/m2 from one screen that the other screen disagrees with.
        //
        // INDEPENDENT ORACLE. The expected sentence is computed HERE, from /admin/data's raw
        // zone rows, in integer hundredths — never by re-reading the number off the screen and
        // then agreeing with it. That is the mistake check-money.mjs's own „Nicht gezählt"
        // assertion made: it matched vocabulary that the failing case also contains.
        //
        // THE FLOOR CASE IS THE POINT. A building with one unmeasured zone must NOT print the
        // measured subtotal as though it were the building: 980 m2 stated as a total for a
        // building whose Tiefgarage nobody has measured is a confidently wrong benchmark, and
        // it is the denominator of every EUR/m2 figure quoted from it.
        const areaTruth = await page.eval(`(async () => {
          const data = await (await fetch('/admin/data?limit=2000', { credentials: 'include' })).json()
          // Integer hundredths, by string slicing. The wire value is a JS number, and
          // 12.10 + 0.20 as floats is 12.299999999999999.
          const hundredths = (v) => {
            if (v === null || v === undefined) return null
            const [w, f = ''] = String(v).split('.')
            return Number.parseInt(w, 10) * 100 + Number.parseInt((f + '00').slice(0, 2), 10)
          }
          const rows = Array.from(document.querySelectorAll('table.data-table tbody tr'))
          const out = []
          for (const l of data.locations) {
            const live = data.zones.filter((z) => z.active && z.location_id === l.id)
            const measured = live.filter((z) => z.area_sqm !== null && z.area_sqm !== undefined)
            const sum = measured.reduce((a, z) => a + hundredths(z.area_sqm), 0)
            const state = live.length === 0 ? 'none' : measured.length < live.length ? 'incomplete' : 'complete'
            const row = rows.find((r) => r.textContent.includes(l.name))
            if (!row) continue
            const said = (row.children[4]?.textContent || '')
            // COMPARED AS A VALUE, NOT AS A STRING. The screen formats through next-intl and
            // Austrian German groups with a narrow no-break space in some builds and a dot in
            // others; a string comparison would fail on the SEPARATOR and say the area was
            // wrong. So the number is read back OFF the sentence, stripped of every grouping
            // character, and compared in integer hundredths against the oracle.
            // NO BACKSLASH ESCAPES IN THIS REGEX, and that is not a style choice: this whole
            // expression is a TEMPLATE LITERAL evaluated in the page, so a lone d here is
            // eaten by the template and reaches Chrome as a bare 'd'. The first version of
            // this line did exactly that, matched nothing, and reported every measured
            // building as having no number on screen. Explicit classes cannot be eaten.
            const token = (said.match(/[0-9][0-9.,\u00a0\u202f ]*(?=[ ]*m\u00b2)/) || [null])[0]
            const shownHundredths = token === null
              ? null
              : (() => {
                  const plain = token.replace(/[^0-9,.]/g, '')
                  // The LAST separator is the decimal one; everything before it groups.
                  const cut = Math.max(plain.lastIndexOf(','), plain.lastIndexOf('.'))
                  const hasDecimals = cut !== -1 && plain.length - cut - 1 <= 2
                  const whole = (hasDecimals ? plain.slice(0, cut) : plain).replace(/[.,]/g, '')
                  const frac = hasDecimals ? (plain.slice(cut + 1) + '00').slice(0, 2) : '00'
                  return Number.parseInt(whole, 10) * 100 + Number.parseInt(frac, 10)
                })()
            out.push({
              name: l.name,
              state,
              zones: live.length,
              unmeasured: live.length - measured.length,
              shown: token === null ? null : token.trim(),
              expected: sum,
              got: shownHundredths,
              hasNumber: sum > 0 && shownHundredths === sum,
              saysFloor: /Mindestens|At least/.test(said) && /keine Gesamtfläche|not a total/.test(said),
              saysTotal: /gesamt aus|in total across/.test(said),
              saysNone: /Fläche unbekannt|area unknown/.test(said),
              said: said.trim().slice(0, 90),
            })
          }
          return out
        })()`)

        const complete = areaTruth.filter((b) => b.state === 'complete')
        const incomplete = areaTruth.filter((b) => b.state === 'incomplete')
        const none = areaTruth.filter((b) => b.state === 'none')
        record(
          complete.length > 0 && complete.every((b) => b.hasNumber && b.saysTotal && !b.saysFloor),
          `${tag} a fully measured building states the SUM of its zones as a total`,
          complete
            .map(
              (b) =>
                `${b.name}: ${b.zones} zones, db ${b.expected / 100} m², screen ${b.got === null ? 'none' : b.got / 100} m² ("${b.shown}")`,
            )
            .join(' | ') || 'no such building in the fixture',
        )
        record(
          incomplete.length > 0 &&
            incomplete.every((b) => b.saysFloor && !b.saysTotal && b.got === b.expected),
          `${tag} a building with an unmeasured zone says INCOMPLETE, never a total`,
          incomplete
            .map(
              (b) =>
                `${b.name}: ${b.unmeasured}/${b.zones} unmeasured, floor ${b.got === null ? 'none' : b.got / 100} m² = db ${b.expected / 100} — "${b.said}"`,
            )
            .join(' | ') || 'no such building in the fixture',
        )
        record(
          none.length > 0 && none.every((b) => b.saysNone && !b.saysTotal && !b.saysFloor),
          `${tag} a building with no zone has NO area — and that is not 0 m²`,
          none.map((b) => `${b.name}: "${b.said}"`).join(' | ') ||
            'no such building in the fixture',
        )

        // ...AND THE OTHER SCREEN DERIVES THE SAME NUMBER A DIFFERENT WAY.
        //
        // decision-43 stores no area on the building, so it is derived TWICE: by
        // `web/lib/area.ts` for the table above, and by `SUM(z.area_sqm)` in
        // server/lib/reporting.js for /pl/. The block above proves the CLIENT derivation
        // against the raw zone rows and says out loud that two derivations of one fact
        // drift — and then never compared them. A drift here is a director reading
        // 980 m² on one screen and quoting €/m² computed from 1.240 m² on the other.
        //
        // COMPARED AS THE STATE AND AS THE NUMBER. Matching only the number would let
        // /pl/ state a floor as a total, which is the same defect the block above exists
        // for, moved one screen sideways.
        const plArea = await page.eval(`(async () => {
          const y = new Date().getFullYear()
          const [data, pl] = await Promise.all([
            (await fetch('/admin/data?limit=2000', { credentials: 'include' })).json(),
            (await fetch('/admin/pl?from=' + y + '-01-01T00:00:00.000Z&to=' + y + '-12-31T23:59:59.999Z', { credentials: 'include' })).json(),
          ])
          const hundredths = (v) => {
            if (v === null || v === undefined) return null
            const [w, f = ''] = String(v).split('.')
            return Number.parseInt(w, 10) * 100 + Number.parseInt((f + '00').slice(0, 2), 10)
          }
          return (pl.buildings || []).map((b) => {
            const live = data.zones.filter((z) => z.active && z.location_id === b.location_id)
            const measured = live.filter((z) => z.area_sqm !== null && z.area_sqm !== undefined)
            const expected = measured.reduce((a, z) => a + hundredths(z.area_sqm), 0)
            const clientState = live.length === 0 ? 'none' : measured.length < live.length ? 'incomplete' : 'complete'
            // The server's own words for the same three states.
            const serverState =
              b.area_unknown_reason === 'no_zones' ? 'none'
              : b.area_unknown_reason === 'area_incomplete' ? 'incomplete'
              : b.building_m2 === null ? 'none' : 'complete'
            return {
              name: b.name,
              clientState,
              serverState,
              agreeState: clientState === serverState,
              // The server states a number ONLY when it is a total, so an incomplete or
              // zoneless building must carry no m2 at all rather than a floor.
              serverHundredths: hundredths(b.building_m2),
              expected,
              agreeNumber:
                serverState === 'complete'
                  ? hundredths(b.building_m2) === expected
                  : b.building_m2 === null,
              // ...and every per-m2 figure derived from a non-total must be refused.
              perM2Refused:
                serverState === 'complete' || (b.cost_cents_per_m2 === null && b.revenue_cents_per_m2 === null),
            }
          })
        })()`)
        record(
          plArea.length > 0 && plArea.every((b) => b.agreeState && b.agreeNumber && b.perM2Refused),
          `${tag} /pl/ derives the SAME area as /locations/, state and number`,
          plArea
            .map(
              (b) =>
                `${b.name.split(',')[0]}: ${b.clientState}${b.agreeState ? '' : `≠${b.serverState}`} ` +
                `${b.serverHundredths === null ? 'no m²' : `${b.serverHundredths / 100} m²`}` +
                `${b.agreeNumber ? '' : ` ≠ db ${b.expected / 100}`}${b.perM2Refused ? '' : ' €/m² NOT REFUSED'}`,
            )
            .join(' | '),
        )

        // The building tag is a COLLAPSED disclosure, and it still contains the URI.
        const disclosure = await page.eval(`(() => {
          const d = document.querySelector('details.tag-disclosure')
          if (!d) return null
          const r = d.querySelector('summary').getBoundingClientRect()
          return { open: d.open, h: Math.round(r.height), w: Math.round(r.width) }
        })()`)
        record(
          disclosure !== null && disclosure.open === false && disclosure.h >= 24,
          `${tag} building tag is collapsed, summary is a real target`,
          disclosure === null
            ? 'missing'
            : `${disclosure.w}x${disclosure.h}px, open=${disclosure.open}`,
        )

        // Open the zone list for a building that HAS zones.
        await page.eval(`(() => {
          const b = Array.from(document.querySelectorAll('button, a')).find((n) => /Zonen verwalten|Manage zones/.test(n.textContent))
          if (!b) throw new Error('no zone-list control on any row')
          b.click()
          return true
        })()`)
        await sleep(900)
        await page.waitFor(
          `document.body.innerText.includes('m²') || document.body.innerText.includes('Keine Zone')`,
        )

        over = await page.eval(OVERFLOW)
        record(
          over.over <= 0,
          `${tag} zone list fits ${width}px`,
          `worst +${over.over}px ${over.what}`,
        )

        // The zone tag URI is on the PERMANENT tag host, verbatim, never elided.
        const uri = await page.eval(`(() => {
          const c = Array.from(document.querySelectorAll('code.code-block')).find((n) => n.textContent.includes('/t?l='))
          if (!c) return null
          const r = c.getBoundingClientRect()
          return { text: c.textContent, clipped: c.scrollWidth > Math.ceil(r.width) + 1, w: Math.round(r.width) }
        })()`)
        record(
          uri !== null && uri.text.startsWith('https://timesheets.exe.xyz/t?l=') && !uri.clipped,
          `${tag} zone tag URI is whole and on the tag host`,
          uri === null ? 'missing' : `${uri.w}px wide, clipped=${uri.clipped}, ${uri.text}`,
        )

        // Both warnings a director must not discover at the wall.
        const warnings = await page.eval(`(() => {
          const t = document.body.innerText
          return {
            secondTag: /ZWEITER Tag|SECOND tag/.test(t),
            testTap: /Test-Tippen|test tap/i.test(t),
          }
        })()`)
        record(
          warnings.secondTag && warnings.testTap,
          `${tag} the deployment order and the test-tap cost are both stated`,
          JSON.stringify(warnings),
        )

        // ---- the zone drawer: focus trapped, Escape works, focus restored ----------
        const opener = await page.eval(`(() => {
          const b = Array.from(document.querySelectorAll('button')).find((x) => /Zone anlegen|Add a zone/.test(x.textContent))
          if (!b) return null
          b.id = b.id || 'probe-zone-opener'
          // FOCUS, THEN CLICK. A bare .click() leaves document.activeElement on <body>, and
          // then "focus was restored to the opener" is a question about the probe rather
          // than about the drawer. A director reaches this button with Tab.
          b.focus()
          b.click()
          return b.id
        })()`)
        await sleep(600)

        const drawer = await page.eval(`(() => {
          const d = document.querySelector('aside.drawer')
          if (!d) return null
          const r = d.getBoundingClientRect()
          return {
            w: Math.round(r.width),
            modal: d.getAttribute('aria-modal'),
            focusInside: d.contains(document.activeElement),
            active: (document.activeElement.textContent || document.activeElement.tagName).trim().slice(0, 30),
          }
        })()`)
        record(
          drawer !== null && drawer.modal === 'true' && drawer.focusInside,
          `${tag} zone drawer opens, is modal, takes focus`,
          drawer === null ? 'missing' : `${drawer.w}px, focus on "${drawer.active}"`,
        )
        record(
          drawer !== null && drawer.w <= width,
          `${tag} zone drawer fits the viewport`,
          drawer === null ? 'missing' : `${drawer.w} <= ${width}`,
        )

        over = await page.eval(OVERFLOW)
        record(
          over.over <= 0,
          `${tag} zone drawer fits ${width}px`,
          `worst +${over.over}px ${over.what}`,
        )

        // Every control in the drawer is reachable, and the trap holds: tabbing past the
        // last control comes back to the first.
        const trap = await page.eval(`(() => {
          const d = document.querySelector('aside.drawer')
          if (!d) return { count: 0, names: ['(no drawer)'] }
          const sel = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])'
          const inside = Array.from(d.querySelectorAll(sel)).filter((el) => el.offsetParent !== null)
          return { count: inside.length, names: inside.map((e) => (e.getAttribute('aria-label') || e.textContent || e.type).trim().slice(0, 22)) }
        })()`)
        record(
          trap.count >= 5,
          `${tag} zone drawer controls reachable`,
          `${trap.count}: ${trap.names.join(' | ')}`,
        )

        // ESCAPE closes it and focus goes back to the button that opened it.
        await page.send('Input.dispatchKeyEvent', {
          type: 'keyDown',
          key: 'Escape',
          code: 'Escape',
          windowsVirtualKeyCode: 27,
        })
        await page.send('Input.dispatchKeyEvent', {
          type: 'keyUp',
          key: 'Escape',
          code: 'Escape',
          windowsVirtualKeyCode: 27,
        })
        await sleep(400)
        const restored = await page.eval(`(() => ({
          closed: document.querySelector('aside.drawer') === null,
          focus: document.activeElement.id,
        }))()`)
        record(
          restored.closed && restored.focus === opener,
          `${tag} Escape closes the zone drawer and restores focus`,
          `closed=${restored.closed} focus=${restored.focus || '(body)'} expected=${opener}`,
        )

        // ---- /pl/, the revenue ledger ---------------------------------------------
        await page.goto(`${BASE}/pl/`)
        await setTheme(page, theme)
        await page.waitFor(
          `document.body.innerText.includes('Umsatz erfassen') || document.body.innerText.includes('Enter revenue')`,
        )

        over = await page.eval(OVERFLOW)
        record(over.over <= 0, `${tag} /pl/ fits ${width}px`, `worst +${over.over}px ${over.what}`)

        // A MONTH WITH NO ENTRY NEVER RENDERS AS 0,00 EUR. This is the assertion the whole
        // decision-42 change exists for, checked against the cells themselves.
        //
        // Scoped to the LEDGER table by its caption, and the amount read from its FIRST LINE
        // only. A first version matched the whole cell text and counted the sub-line
        // "Vereinbart 960,00 EUR" as a zero, which is a substring and not an amount.
        const received = await page.eval(`(() => {
          const table = Array.from(document.querySelectorAll('table.data-table'))
            .find((t) => /Eingetragener Umsatz|Entered revenue/.test(t.querySelector('caption')?.textContent || ''))
          if (!table) return null
          const cells = Array.from(table.querySelectorAll('tbody tr')).map((r) =>
            (r.children[2]?.innerText || r.children[2]?.textContent || '').trim().split('\\n')[0].trim(),
          )
          const isUnknown = (c) => /^(Nicht eingetragen|Not entered)/.test(c)
          const isZero = (c) => /^0[,.]00/.test(c)
          return {
            rows: cells.length,
            sample: cells.slice(0, 6),
            unknown: cells.filter(isUnknown).length,
            zeros: cells.filter(isZero).length,
            // A cell that manages to be both is exactly the failure this change exists to
            // prevent: the unknown rendered as a confident nothing.
            confusions: cells.filter((c) => isUnknown(c) && /0[,.]00/.test(c)).length,
          }
        })()`)
        record(
          received !== null && received.unknown > 0 && received.confusions === 0,
          `${tag} an unentered month says so and is never 0,00`,
          received === null
            ? 'ledger table not found'
            : `${received.rows} rows: ${received.unknown} unentered, ${received.zeros} typed zeros, ${received.confusions} confusions | ${received.sample.join(' / ')}`,
        )

        // A TYPED ZERO IS STILL SHOWN AS A NUMBER, on the same screen, in the same column.
        record(
          received !== null && received.zeros > 0,
          `${tag} a typed 0 renders as an amount, not as the unknown`,
          received === null ? 'ledger table not found' : `${received.zeros} genuine zeros`,
        )

        // Provenance: when it was touched, and what it replaced.
        const provenance = await page.eval(`(() => {
          const t = document.body.innerText
          return { entered: /Eingetragen \\d|Entered \\d/.test(t), changed: /Geändert \\d|Changed \\d/.test(t), previous: /vorher|previously/.test(t) }
        })()`)
        record(
          provenance.entered && provenance.changed && provenance.previous,
          `${tag} /pl/ says when a figure was entered, changed, and what it replaced`,
          JSON.stringify(provenance),
        )

        // ---- the revenue drawer ----------------------------------------------------
        const revOpener = await page.eval(`(() => {
          const b = Array.from(document.querySelectorAll('button')).find((x) => /^Eintragen|^Enter$/.test(x.textContent.trim()))
          if (!b) return null
          b.id = b.id || 'probe-rev-opener'
          b.focus()
          b.click()
          return b.id
        })()`)
        await sleep(600)

        const revDrawer = await page.eval(`(() => {
          const d = document.querySelector('aside.drawer')
          if (!d) return null
          const r = d.getBoundingClientRect()
          const amount = d.querySelector('input[inputmode="decimal"]')
          return {
            w: Math.round(r.width),
            focusInside: d.contains(document.activeElement),
            // THE SUGGESTION IS NOT PRE-FILLED. An agreed number sitting in a field
            // labelled "received", one Enter from being stored, is the accrual decision-42
            // deleted, rebuilt out of a default value.
            amountEmpty: amount !== null && amount.value === '',
            suggestionOffered: /Vertragswert|contract value/.test(d.innerText),
            step: (d.querySelector('.step')?.textContent || '').trim(),
          }
        })()`)
        record(
          revDrawer !== null && revDrawer.focusInside,
          `${tag} revenue drawer opens and takes focus`,
          revDrawer === null ? 'missing' : `${revDrawer.w}px, step "${revDrawer.step}"`,
        )
        record(
          revDrawer !== null && revDrawer.amountEmpty,
          `${tag} the contract value is NOT pre-filled into the amount`,
          revDrawer === null
            ? 'missing'
            : `value="" is ${revDrawer.amountEmpty}, suggestion offered ${revDrawer.suggestionOffered}`,
        )

        over = await page.eval(OVERFLOW)
        record(
          over.over <= 0,
          `${tag} revenue drawer fits ${width}px`,
          `worst +${over.over}px ${over.what}`,
        )

        await page.send('Input.dispatchKeyEvent', {
          type: 'keyDown',
          key: 'Escape',
          code: 'Escape',
          windowsVirtualKeyCode: 27,
        })
        await page.send('Input.dispatchKeyEvent', {
          type: 'keyUp',
          key: 'Escape',
          code: 'Escape',
          windowsVirtualKeyCode: 27,
        })
        await sleep(400)
        const revRestored = await page.eval(`(() => ({
          closed: document.querySelector('aside.drawer') === null,
          focus: document.activeElement.id,
        }))()`)
        record(
          revRestored.closed && revRestored.focus === revOpener,
          `${tag} Escape closes the revenue drawer and restores focus`,
          `closed=${revRestored.closed} focus=${revRestored.focus || '(body)'} expected=${revOpener}`,
        )

        // ---- /, the dashboard: the grey pin and the words behind it ----------------
        //
        // THE SURFACE THE OWNER NAMED. A building with a contract and a contact but no zones
        // is legitimate, is drawn, and is drawn GREY -- and the grey is the SECOND signal.
        // The pin, the Objektliste row and the info box each have to carry the state in
        // words, because a director who desaturates nothing still reads the list on a phone
        // in sunlight.
        await page.goto(`${BASE}/`)
        await setTheme(page, theme)
        await page.waitFor(`document.querySelectorAll('table.objects-table tbody tr').length > 0`)
        await sleep(400)

        over = await page.eval(OVERFLOW)
        record(over.over <= 0, `${tag} / fits ${width}px`, `worst +${over.over}px ${over.what}`)

        // Counted against the API again, not grepped: the Objektliste only lists ACTIVE
        // buildings, so the expected number is the active unzoned ones.
        const home = await page.eval(`(async () => {
          const data = await (await fetch('/admin/data?limit=2000', { credentials: 'include' })).json()
          const live = new Map()
          for (const z of data.zones) {
            if (!z.active) continue
            live.set(z.location_id, (live.get(z.location_id) || 0) + 1)
          }
          const unzoned = data.locations.filter((l) => l.active && (live.get(l.id) || 0) === 0)
          const pinnableUnzoned = unzoned.filter((l) => l.lat !== null && l.lng !== null).length
          const rows = Array.from(document.querySelectorAll('table.objects-table tbody tr'))
          const said = rows.filter((r) => unzoned.some((l) => r.textContent.includes(l.name)) && /Noch keine Zone angelegt|No zone recorded yet/.test(r.textContent))
          const pins = Array.from(document.querySelectorAll('.map-pin'))
          return {
            expected: unzoned.length,
            said: said.length,
            rows: rows.length,
            pins: pins.length,
            pinnableUnzoned,
            mapCollapsed: /Karte ist eingeklappt|map is collapsed/.test(document.body.innerText),
            greyPins: pins.filter((p) => p.dataset.zone === 'unzoned').length,
            pinsSayIt: pins.filter((p) => /ohne Zone|no zone/.test(p.textContent)).length,
            names: unzoned.map((l) => l.name),
          }
        })()`)
        record(
          home.expected > 0 && home.said === home.expected,
          `${tag} / every unzoned building says so in the Objektliste, in words`,
          `${home.said}/${home.expected} rows -- ${home.names.join(', ')}`,
        )
        // THE PINS, and only when Google actually drew some. See `skip` above for why this
        // is not written as `pins === 0 || ...`.
        //
        // The three numbers have to agree: the buildings the API says are unzoned AND
        // pinnable, the pins carrying the grey styling hook, and the pins carrying the WORD.
        // Grey without the word is the failure the owner named; the word without the grey
        // would be the styling silently dropped. Both are one comparison.
        if (home.pins === 0) {
          // TWO DIFFERENT REASONS FOR NO PIN, and they are not interchangeable. On a phone
          // the map is COLLAPSED BY DESIGN (decision-39 §3, IA-PLAN §9) and the Objektliste
          // is the whole answer — which is why the row assertions above are the ones that
          // matter at 390 and they ran. A desktop with no pin is the missing Maps key.
          skip(
            `${tag} / the grey pin`,
            home.mapCollapsed
              ? 'the map is collapsed on a phone by design — the Objektliste above IS the surface here, and it was asserted'
              : 'this build has no Google Maps key, so no pin was drawn — rebuild with the key and re-run against :8080',
          )
        } else {
          record(
            home.greyPins === home.pinnableUnzoned && home.pinsSayIt === home.pinnableUnzoned,
            `${tag} / a pin is grey and SAYS the word, or it is neither`,
            `${home.pins} pins drawn · ${home.pinnableUnzoned} unzoned+pinnable · ${home.greyPins} grey · ${home.pinsSayIt} carrying the word`,
          )

          // EVERY PIN, not the one pin the assertions below happen to pick.
          //
          // The fold assertion further down opens the box on the UNZONED building, so it
          // measured 6px and never saw the 27px one: the box on the building with somebody
          // standing in it carries an extra worker link and is the worst case on the
          // screen. A defect that is only on the busiest building is the one a director
          // meets first. Opening all of them costs ~1s per pin and removes the sampling.
          const everyBox = []
          for (let i = 0; i < home.pins; i++) {
            await page.eval(`(() => {
              const p = document.querySelectorAll('.map-pin')[${i}]
              ;(p.querySelector('button, [role=button]') ?? p).click()
              return true
            })()`)
            await sleep(450)
            everyBox.push(
              await page.eval(`(() => {
                const box = document.querySelector('.map-info')
                if (!box) return { cued: false, cue: 'pin ${i}: no box opened' }
                const name = (box.querySelector('h3')?.textContent ?? '?').split(',')[0].trim()
                const r = (${FOLD_CUE})(box.querySelector('.map-info-face:not([hidden])'))
                return { cued: r.cued, cue: name + ': ' + r.cue }
              })()`),
            )
            await page.send('Input.dispatchKeyEvent', {
              type: 'keyDown',
              key: 'Escape',
              code: 'Escape',
              windowsVirtualKeyCode: 27,
            })
            await page.send('Input.dispatchKeyEvent', {
              type: 'keyUp',
              key: 'Escape',
              code: 'Escape',
              windowsVirtualKeyCode: 27,
            })
            await sleep(250)
          }
          record(
            everyBox.length > 0 && everyBox.every((b) => b.cued),
            `${tag} / EVERY pin's box: a fold is drawn or there is no fold`,
            everyBox.map((b) => b.cue).join(' | '),
          )
        }

        // THE INFO BOX ON A PIN IS A SEPARATE SURFACE AND IT IS ASSERTED SEPARATELY.
        //
        // It is 323px tall at most, it already held five facts, and the numbers face had 14
        // pixels of slack — so the zone sentences are NOT in it, deliberately, and
        // demo/check-map-home.mjs is the check that says why. What the box owes instead is
        // that the state is still readable from it WITHOUT COLOUR: the pin it hangs off
        // carries the word, and the links face behind the disclosure carries the fix.
        //
        // Without this, the box path for an unzoned building is never exercised at all: the
        // drawer assertion below happens to pick a building with no coordinates, which is
        // exactly the case that CANNOT have a box.
        const boxTarget = await page.eval(`(async () => {
          const data = await (await fetch('/admin/data?limit=2000', { credentials: 'include' })).json()
          const liveIds = new Set(data.zones.filter((z) => z.active).map((z) => z.location_id))
          const t = data.locations.find((l) => l.active && !liveIds.has(l.id) && l.lat !== null && l.lng !== null)
          if (!t) return null
          const short = t.name.split(',')[0].trim()
          const pin = Array.from(document.querySelectorAll('.map-pin')).find((p) => p.textContent.includes(short))
          if (!pin) return null
          pin.querySelector('.map-pin-label').click()
          return { name: t.name, short }
        })()`)
        if (boxTarget === null) {
          skip(
            `${tag} / the info box of an unzoned pin`,
            'no unzoned building has coordinates on this map, or none was drawn',
          )
        } else {
          await sleep(600)
          // MEASURED BEFORE THE DISCLOSURE IS TOUCHED, and that ordering is the assertion.
          // A first version clicked `.map-info-expand` inside this same function and then
          // counted the folds, so it measured the LINKS face and reported 0 while the
          // NUMBERS face was 19px over — the exact defect it was written for, passing.
          // `.visually-hidden` is a 1px clipping rectangle by construction and is excluded,
          // the same way demo/check-map-home.mjs excludes it.
          const infoBox = await page.eval(`(() => {
            const box = document.querySelector('.map-info')
            if (!box) return null
            const pin = box.closest('.map-pin')
            return {
              h: Math.round(box.getBoundingClientRect().height),
              pinSaysIt: /ohne Zone|no zone/.test(pin.querySelector('.map-pin-label').textContent),
              grey: pin.dataset.zone === 'unzoned',
              folds: [box, ...box.querySelectorAll('*')]
                .filter((el) => !el.classList.contains('visually-hidden') && el.scrollHeight > el.clientHeight + 2)
                .map((el) => String(el.className) + ' +' + (el.scrollHeight - el.clientHeight) + 'px'),
              ...(${FOLD_CUE})(box.querySelector('.map-info-face:not([hidden])')),
            }
          })()`)
          // ...and only NOW open the links face.
          await page.eval(
            `(() => { const e = document.querySelector('.map-info-expand'); if (e) e.click(); return true })()`,
          )
          await sleep(400)
          const boxFix = await page.eval(`(() => {
            const box = document.querySelector('.map-info')
            if (!box) return null
            const link = Array.from(box.querySelectorAll('a')).find((a) => /Erste Zone anlegen|Create the first zone/.test(a.textContent))
            if (!link) return { found: false, inside: false }
            const l = link.getBoundingClientRect(), b = box.getBoundingClientRect()
            return { found: true, inside: l.top >= b.top - 1 && l.bottom <= b.bottom + 1 }
          })()`)
          record(
            infoBox !== null && infoBox.grey && infoBox.pinSaysIt,
            `${tag} / the info box hangs off a pin that is grey AND says the word`,
            infoBox === null
              ? 'no box opened'
              : `${infoBox.h}px, grey=${infoBox.grey}, word=${infoBox.pinSaysIt} — ${boxTarget.name}`,
          )
          // WHAT THIS USED TO ASSERT, and why it was replaced rather than relaxed.
          //
          // It was `folds.length === 0` — nothing on the numbers face may scroll, at all.
          // That claim is FALSE at 1440x900 and always was: the box gets the whole map
          // region less INFO_MARGIN twice, the region is 324px on a 900px-tall screen, and
          // the numbers are 204px against 198px of face. The assertion had never been run
          // with a Maps key on this size, so it had never been able to say so.
          //
          // "No fold anywhere" is also not what the design claims. HomeMap's
          // INFO_MIN_HEIGHT comment accepts a scrolling box outright. What it cannot accept
          // is a fold nobody can SEE, so that is what is asserted now — on every pin rather
          // than on this one, which is where the 27px case was hiding.
          record(
            infoBox !== null && infoBox.cued,
            `${tag} / ...and if it DOES fold, the fold is drawn, not silent`,
            infoBox === null ? 'no box opened' : infoBox.cue,
          )
          record(
            boxFix !== null && boxFix.found && boxFix.inside,
            `${tag} / ...and its links face carries the first-zone route, inside the box`,
            boxFix === null ? 'no box' : `found=${boxFix.found} inside=${boxFix.inside}`,
          )
          await page.send('Input.dispatchKeyEvent', {
            type: 'keyDown',
            key: 'Escape',
            code: 'Escape',
            windowsVirtualKeyCode: 27,
          })
          await page.send('Input.dispatchKeyEvent', {
            type: 'keyUp',
            key: 'Escape',
            code: 'Escape',
            windowsVirtualKeyCode: 27,
          })
          await sleep(400)
        }

        // THE INFO BOX / DRAWER: what is missing, what still works, and the route that fixes
        // it. Opened from the row, which is the keyboard path and the only set of tab stops.
        const boxOpener = await page.eval(`(async () => {
          const data = await (await fetch('/admin/data?limit=2000', { credentials: 'include' })).json()
          const live = new Set(data.zones.filter((z) => z.active).map((z) => z.location_id))
          const target = data.locations.find((l) => l.active && !live.has(l.id))
          if (!target) return null
          const row = Array.from(document.querySelectorAll('table.objects-table tbody tr')).find((r) => r.textContent.includes(target.name))
          const b = Array.from(row.querySelectorAll('button')).find((x) => /Öffnen|Open/.test(x.textContent))
          b.id = b.id || 'probe-home-opener'
          b.focus()
          b.click()
          return { id: b.id, name: target.name }
        })()`)
        await sleep(700)
        const box = await page.eval(`(() => {
          const d = document.querySelector('aside.drawer, .map-info')
          if (!d) return null
          const text = d.innerText
          return {
            w: Math.round(d.getBoundingClientRect().width),
            focusInside: d.contains(document.activeElement),
            saysMissing: /Noch keine Zone angelegt|No zone recorded yet/.test(text),
            saysStillWorks: /startet trotzdem eine Schicht|still starts a shift/.test(text),
            // NEVER the word for the operational state: 'inaktiv' here would be the merge
            // decision-43 section 3 forbids, printed at the reader.
            saysInactive: /inaktiv|inactive/i.test(text),
            fixLink: Array.from(d.querySelectorAll('a')).some((a) => /Erste Zone anlegen|Create the first zone/.test(a.textContent)),
          }
        })()`)
        record(
          box !== null && box.saysMissing && box.saysStillWorks && !box.saysInactive,
          `${tag} / the panel says what is missing AND what still works, and never says inactive`,
          box === null ? `no panel for ${boxOpener && boxOpener.name}` : JSON.stringify(box),
        )
        record(
          box !== null && box.fixLink,
          `${tag} / ...and offers the route that fixes it`,
          box === null ? 'missing' : `first-zone link ${box.fixLink}`,
        )
        over = await page.eval(OVERFLOW)
        record(
          over.over <= 0,
          `${tag} / with the panel open fits ${width}px`,
          `worst +${over.over}px ${over.what}`,
        )

        await page.send('Input.dispatchKeyEvent', {
          type: 'keyDown',
          key: 'Escape',
          code: 'Escape',
          windowsVirtualKeyCode: 27,
        })
        await page.send('Input.dispatchKeyEvent', {
          type: 'keyUp',
          key: 'Escape',
          code: 'Escape',
          windowsVirtualKeyCode: 27,
        })
        await sleep(400)
        const homeRestored = await page.eval(`(() => ({
          closed: document.querySelector('aside.drawer') === null && document.querySelector('.map-info') === null,
          focus: document.activeElement.id,
        }))()`)
        record(
          homeRestored.closed && homeRestored.focus === (boxOpener && boxOpener.id),
          `${tag} / Escape closes the building panel and restores focus`,
          `closed=${homeRestored.closed} focus=${homeRestored.focus || '(body)'} expected=${boxOpener && boxOpener.id}`,
        )

        // ---- /workers/, the required rate ------------------------------------------
        await page.goto(`${BASE}/workers/`)
        await setTheme(page, theme)
        await page.waitFor(`document.querySelectorAll('table.data-table tbody tr').length > 0`)
        const rate = await page.eval(`(() => {
          const b = Array.from(document.querySelectorAll('button')).find((x) => /Mitarbeiter anlegen|Add a worker|Add worker/.test(x.textContent))
          b.click()
          return true
        })()`)
        await sleep(500)
        const rateField = await page.eval(`(() => {
          const d = document.querySelector('aside.drawer')
          if (!d) return null
          const labels = Array.from(d.querySelectorAll('label'))
          const l = labels.find((x) => /Stundensatz|Hourly rate/.test(x.textContent))
          if (!l) return null
          const input = d.querySelector('#' + CSS.escape(l.getAttribute('for')))
          return {
            marker: l.textContent.includes('*'),
            optionalWord: /optional/i.test(l.textContent),
            required: input?.required === true,
          }
        })()`)
        record(
          rateField !== null && rateField.marker && rateField.required && !rateField.optionalWord,
          `${tag} the hourly rate is marked required on the label AND the control`,
          JSON.stringify(rateField),
        )
        record(rate === true, `${tag} worker drawer reachable`)
        await page.send('Input.dispatchKeyEvent', {
          type: 'keyDown',
          key: 'Escape',
          code: 'Escape',
          windowsVirtualKeyCode: 27,
        })
        await page.send('Input.dispatchKeyEvent', {
          type: 'keyUp',
          key: 'Escape',
          code: 'Escape',
          windowsVirtualKeyCode: 27,
        })
        await sleep(300)
      }
    }
  } finally {
    page.close()
    child.kill()
  }

  process.stdout.write(`${lines.join('\n')}\n\n`)
  if (failures.length > 0) {
    process.stderr.write(`${failures.length} probe(s) failed.\n`)
    process.exit(1)
  }
  // A SKIP IS REPORTED IN THE SUCCESS LINE, not swallowed by it. A run that says "all
  // passed" while four assertions never executed is the report this whole file exists to
  // stop being possible.
  process.stdout.write(
    skipped.length === 0
      ? 'All geometry probes passed.\n'
      : `All geometry probes passed — ${skipped.length} SKIPPED and NOT proven: ${skipped.join(', ')}\n`,
  )
}

await run()
