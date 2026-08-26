#!/usr/bin/env node
/**
 * One runnable check for the whole operator-identity surface.
 *
 *   node ops/check-branding.mjs        # exits non-zero on any drift
 *
 * ops/branding.json is the source of truth. Four other places have to agree with it and
 * NONE of them can read it at runtime - Xcode reads an xcconfig, codesign reads a plist,
 * Gradle reads a properties file, the browser reads a compiled bundle. So agreement is
 * asserted here rather than assumed.
 *
 * Every assertion below corresponds to a way a tap dies SILENTLY. That is the whole point:
 * a wrong host or a wrong appID does not throw, it just makes iOS open Safari and Android
 * open Chrome, with tags already glued to walls and no error anywhere.
 *
 * ponytail: node stdlib, string matching, no parsers for xcconfig/plist/properties - those
 *   formats are read here with one regex each because we only ever look up 4, 1 and 2 keys
 *   respectively. Ceiling: a value containing a `#`, a quoted plist entity, or a properties
 *   line continuation would be misread. Upgrade path: `plutil -convert json` and a real
 *   properties parser, both of which cost more than they buy today.
 * Style mirrors web/scripts/check.mjs deliberately - same shape, same output, one less thing
 *   for the next reader to learn.
 */

import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, readBranding, targets } from './gen-wellknown.mjs'

const failures = []
const skipped = []

function check(name, fn) {
  try {
    fn()
    process.stdout.write(`  ok   ${name}\n`)
  } catch (error) {
    failures.push(name)
    process.stdout.write(`  FAIL ${name}\n         ${error.message.replace(/\n/g, '\n         ')}\n`)
  }
}

function skip(name, why) {
  skipped.push(name)
  process.stdout.write(`  skip ${name} — ${why}\n`)
}

const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')
const has = (rel) => existsSync(join(ROOT, rel))

/** `KEY = value` out of an xcconfig. Trailing `//` comments stripped. */
function xcconfigValue(text, key) {
  const line = text.split('\n').find((l) => new RegExp(`^\\s*${key}\\s*=`).test(l))
  assert.ok(line !== undefined, `Branding.xcconfig has no ${key}`)
  return line.slice(line.indexOf('=') + 1).replace(/\/\/.*$/, '').trim()
}

/** `key=value` out of a java .properties file. */
function propertiesValue(text, key) {
  const line = text.split('\n').find((l) => l.trimStart().startsWith(`${key}=`))
  assert.ok(line !== undefined, `branding.properties has no ${key}`)
  return line.slice(line.indexOf('=') + 1).trim()
}

let branding
try {
  branding = readBranding()
} catch (error) {
  process.stderr.write(`FATAL: ${error.message}\n`)
  process.exit(1)
}

process.stdout.write(
  `branding: tagHost=${branding.tagHost} (permanent) apiHost=${branding.apiHost} (renameable) team=${branding.apple.teamId}\n\n`,
)

// 0. THE TWO HOSTS ARE TWO HOSTS. Collapsing them back into one value is the regression
//    decision-40 exists to stop: the moment they are equal, renaming the API box renames the
//    host printed on every tag, which is the failure that already happened once. They are
//    allowed to be equal only for an operator who genuinely runs one box - and that operator
//    has to say so out loud by setting `singleHost: true`, not by leaving two fields the same.
check('tagHost != apiHost (or singleHost is declared)', () => {
  assert.ok(
    branding.tagHost !== branding.apiHost || branding.singleHost === true,
    `both are ${branding.tagHost}. A tag carries the tag host in ink; the API box gets renamed. ` +
      'Split them, or set "singleHost": true in ops/branding.json to accept the coupling.',
  )
})

// 1. The two association files ARE what branding.json says. Delegated to the generator so
//    there is exactly one renderer; a second copy of the AASA shape is a second thing to get
//    wrong. This is the check that stops a hand-edit of a served file from surviving.
for (const { path, body } of targets(branding)) {
  const rel = path.slice(ROOT.length + 1)
  check(`${rel} matches ops/branding.json`, () => {
    assert.strictEqual(readFileSync(path, 'utf8'), body, 'run `node ops/gen-wellknown.mjs --write`')
  })
}

// 2-4. THE iOS SURFACE, HALF MIGRATED ON PURPOSE.
//
//    Three files name the host iOS parses and associates: the entitlement (a literal - an
//    undefined Xcode build setting expands to the EMPTY STRING, so `applinks:$(TS_TAG_HOST)`
//    with the xcconfig detached becomes `applinks:` and universal links die on the next
//    build, green and silent), Branding.xcconfig, and the Branding.swift fallback.
//
//    Branding.xcconfig and Branding.swift are ordinary source - an agent edits them like any
//    other file, and TASK-188's fix (decision-40) moved both to the permanent tag host. The
//    entitlement is different: it is codesign input, owner-only (decision-49), and moving it
//    is one atomic Xcode click (+ Capability, re-provision) that also re-syncs the Apple
//    Developer portal - editing the XML by hand without that click is worse than leaving it,
//    because automatic signing can silently strip an entitlement it does not recognise as a
//    ticked capability.
//
//    So the two agent-controlled files are held to the REAL answer unconditionally - they
//    have no excuse to lag ops/branding.json - and the entitlement is allowed to still name
//    the apiHost, with the gap printed rather than asserted away.
const iosHosts = {}
check('Branding.xcconfig and Branding.swift both name the PERMANENT tag host', () => {
  iosHosts.xcconfig = xcconfigValue(read('NFCTimeSheets/Branding.xcconfig'), 'TS_TAG_HOST')
  const m = read('NFCTimeSheets/NFCTimeSheets/Branding.swift').match(/static let defaultTagHost = "([^"]*)"/)
  assert.ok(m, 'Branding.swift has no defaultTagHost')
  iosHosts.swift = m[1]

  assert.strictEqual(iosHosts.xcconfig, branding.tagHost, 'Branding.xcconfig TS_TAG_HOST != ops/branding.json tagHost')
  assert.strictEqual(iosHosts.swift, branding.tagHost, 'Branding.swift defaultTagHost != ops/branding.json tagHost')
})

// The split, on the iOS side, asserted as text — same reasoning as the Android mirror
// below: building the app is not this script's job, but API.swift silently reverting to
// TagLink.host is exactly the bug TASK-188 exposed, and it must never be free to recur.
check('iOS talks to apiHost and claims tagHost', () => {
  const api = read('NFCTimeSheets/NFCTimeSheets/API.swift')
  assert.match(
    api,
    /static let base = URL\(string: "https:\/\/\\\(Branding\.apiHost\)"\)/,
    'API.swift must build its base from Branding.apiHost, never TagLink.host or Branding.tagHost',
  )
})

check('the entitlement names a host this project actually serves (tagHost or apiHost)', () => {
  const entitlement = Array.from(
    read('NFCTimeSheets/NFCTimeSheets/NFCTimeSheets.entitlements').matchAll(
      /<string>applinks:([^<]*)<\/string>/g,
    ),
    (m) => m[1],
  )
  assert.strictEqual(entitlement.length, 1, `entitlement lists ${JSON.stringify(entitlement)}`)
  iosHosts.entitlement = entitlement[0]
  assert.ok(
    [branding.tagHost, branding.apiHost].includes(iosHosts.entitlement),
    `iOS names ${iosHosts.entitlement}, which is neither tagHost ${branding.tagHost} nor apiHost ${branding.apiHost}`,
  )
})

if (iosHosts.entitlement !== undefined && iosHosts.entitlement !== branding.tagHost) {
  process.stdout.write(
    `  TODO the entitlement still names the RENAMEABLE host ${iosHosts.entitlement}, not the ` +
      `permanent tag host ${branding.tagHost}.\n` +
      '       Branding.xcconfig and Branding.swift already name the permanent host - only the\n' +
      '       entitlement lags, and it is owner-only: Signing & Capabilities in Xcode, which\n' +
      '       also re-provisions. Universal links keep working meanwhile because the API host\n' +
      '       still serves the association files too.\n' +
      '       Passive tap on a card written to the permanent host will not work until this moves.\n',
  )
}

// 3. The rest of the iOS knob. Values here are what a rebuild picks up once the xcconfig is
//    attached; the host is handled above.
check('Branding.xcconfig matches ops/branding.json', () => {
  const xc = read('NFCTimeSheets/Branding.xcconfig')
  assert.strictEqual(xcconfigValue(xc, 'TS_TEAM_ID'), branding.apple.teamId, 'TS_TEAM_ID')
  assert.strictEqual(xcconfigValue(xc, 'TS_APP_NAME'), branding.appName, 'TS_APP_NAME')
  assert.ok(
    branding.apple.bundleIds.includes(xcconfigValue(xc, 'TS_BUNDLE_ID')),
    `TS_BUNDLE_ID ${xcconfigValue(xc, 'TS_BUNDLE_ID')} is not in apple.bundleIds ${branding.apple.bundleIds.join(', ')}`,
  )
})

// 4. The iOS FALLBACK bundle id - what an unconfigured build uses, i.e. what is live on
//    TestFlight today. Must track branding.json, or "inert by default" quietly means "wrong
//    by default" after the first rebrand.
check('Branding.swift fallback bundle id matches ops/branding.json', () => {
  const swift = read('NFCTimeSheets/NFCTimeSheets/Branding.swift')
  const m = swift.match(/static let defaultBundleId = "([^"]*)"/)
  assert.ok(m, 'Branding.swift has no defaultBundleId')
  assert.ok(branding.apple.bundleIds.includes(m[1]), `defaultBundleId ${m[1]} is not in apple.bundleIds`)
})

// 5. Trust boundary. `aud` on the Apple identity token is checked against this constant; if
//    it is not one of our bundle ids, EVERY worker sign-in 401s and nobody can clock in.
check('server/lib/apple.js APPLE_AUDIENCE is one of apple.bundleIds', () => {
  const m = read('server/lib/apple.js').match(/APPLE_AUDIENCE\s*=\s*"([^"]+)"/)
  assert.ok(m, 'APPLE_AUDIENCE not found')
  assert.ok(
    branding.apple.bundleIds.includes(m[1]),
    `APPLE_AUDIENCE ${m[1]} is not in apple.bundleIds ${branding.apple.bundleIds.join(', ')}`,
  )
})

// 6. The URI the admin panel prints onto a PHYSICAL TAG. Wrong here and the tag is dead on
//    the wall - the only failure in this product whose fix is a site visit. It is the TAG
//    host, never the API host: the admin panel is served BY the API host, and a tag written
//    with the host you happen to be looking at is the exact mistake decision-40 removes.
check('web/lib/tag.ts default origin == https://branding.tagHost', () => {
  const m = read('web/lib/tag.ts').match(/NEXT_PUBLIC_TAG_BASE_URL\s*\?\?\s*'([^']+)'/)
  assert.ok(m, 'default for NEXT_PUBLIC_TAG_BASE_URL not found')
  assert.strictEqual(m[1], `https://${branding.tagHost}`)
})

// 7. Android. Absent until the android/ skeleton lands; a skip is honest, a pass is not.
if (has('android/branding.properties')) {
  check('android/branding.properties matches ops/branding.json', () => {
    const p = read('android/branding.properties')
    assert.strictEqual(propertiesValue(p, 'ts.applicationId'), branding.android.packageName)
    assert.strictEqual(propertiesValue(p, 'ts.tagHost'), branding.tagHost, 'ts.tagHost')
    assert.strictEqual(propertiesValue(p, 'ts.apiHost'), branding.apiHost, 'ts.apiHost')
    assert.strictEqual(propertiesValue(p, 'ts.appName'), branding.appName)
  })

  // The split, on the Android side, asserted as text because the only alternative is
  // building the app. Api.kt must reach the API host and the manifest must claim the TAG
  // host; swapping them is invisible until a worker taps a card at a door.
  check('android talks to apiHost and claims tagHost', () => {
    assert.match(
      read('android/app/src/main/kotlin/io/github/qwadratic/nfctimesheets/net/Api.kt'),
      /val base = "https:\/\/\$\{BuildConfig\.API_HOST\}"/,
      'Api.kt must build its base from BuildConfig.API_HOST, never TAG_HOST',
    )
    const manifest = read('android/app/src/main/AndroidManifest.xml')
    assert.match(manifest, /android:host="\$\{tagHost\}"/, 'the intent filters must use ${tagHost}')
    assert.ok(
      !manifest.includes('${apiHost}'),
      'the API host must NOT be in an autoVerify intent filter - it is renameable, and App Link ' +
        'verification is all-or-nothing across the hosts in a filter',
    )
  })
} else {
  skip('android/branding.properties matches ops/branding.json', 'android/ not present yet')
}

// 8. No identity literal creeping back into source. The team id has exactly three legitimate
//    homes - branding.json, Branding.xcconfig and the GENERATED AASA - plus project.pbxproj,
//    which no agent may touch. Anywhere else it is a copy that will not follow a rebrand.
const SOURCE_GLOBS = [
  'NFCTimeSheets/NFCTimeSheets',
  'server/lib',
  'server/routes',
  'web/lib',
  'web/app',
  'web/components',
]
function sourceFiles() {
  const out = []
  const walk = (dir) => {
    for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`
      if (entry.isDirectory()) walk(rel)
      else if (/\.(swift|js|mjs|ts|tsx)$/.test(entry.name)) out.push(rel)
    }
  }
  for (const g of SOURCE_GLOBS) if (has(g)) walk(g)
  return out
}

check(`team id ${branding.apple.teamId} appears in no source file`, () => {
  const hits = sourceFiles().filter((f) => read(f).includes(branding.apple.teamId))
  assert.deepStrictEqual(hits, [], 'move it to ops/branding.json + Branding.xcconfig')
})

// 9. The host, in Swift, outside comments. Branding.swift owns the one fallback literal; a
//    second one is how half the app ends up pointed at a host whose AASA does not name it.
//    checks/*.swift are excluded on purpose: those fixtures PIN the unconfigured default and
//    are the contract that an unconfigured build behaves exactly like today's TestFlight one.
check(`the iOS host ${iosHosts.entitlement} has one home in Swift (Branding.swift)`, () => {
  const stripComments = (text) =>
    text
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('//') && !l.trimStart().startsWith('*'))
      .join('\n')
  const hits = sourceFiles()
    .filter((f) => f.endsWith('.swift') && !f.endsWith('Branding.swift'))
    .filter((f) => stripComments(read(f)).includes(iosHosts.entitlement))
  assert.deepStrictEqual(hits, [], 'read Branding.tagHost / TagLink.host instead')
})

process.stdout.write('\n')
if (failures.length > 0) {
  process.stdout.write(`check-branding: ${failures.length} FAILED\n  ${failures.join('\n  ')}\n`)
  process.stdout.write('A mismatch here is a tap that dies silently. Fix before deploying.\n')
  process.exit(1)
}
process.stdout.write(`check-branding: OK${skipped.length > 0 ? ` (${skipped.length} skipped)` : ''}\n`)
