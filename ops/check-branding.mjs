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

process.stdout.write(`branding: host=${branding.host} team=${branding.apple.teamId}\n\n`)

// 1. The two association files ARE what branding.json says. Delegated to the generator so
//    there is exactly one renderer; a second copy of the AASA shape is a second thing to get
//    wrong. This is the check that stops a hand-edit of a served file from surviving.
for (const { path, body } of targets(branding)) {
  const rel = path.slice(ROOT.length + 1)
  check(`${rel} matches ops/branding.json`, () => {
    assert.strictEqual(readFileSync(path, 'utf8'), body, 'run `node ops/gen-wellknown.mjs --write`')
  })
}

// 2. THE AMENDMENT. The Associated Domains entitlement cannot be templated: an undefined
//    Xcode build setting expands to the EMPTY STRING, so `applinks:$(TS_TAG_HOST)` with the
//    xcconfig detached becomes `applinks:` and universal links die on the next build - green,
//    silent, shippable to TestFlight. So the entitlement keeps a literal and this assertion
//    is what keeps the literal honest. Editing it is a manual step in ops/REBRAND.md.
check('NFCTimeSheets.entitlements applinks host == branding.host', () => {
  const text = read('NFCTimeSheets/NFCTimeSheets/NFCTimeSheets.entitlements')
  const found = Array.from(text.matchAll(/<string>applinks:([^<]*)<\/string>/g), (m) => m[1])
  assert.deepStrictEqual(found, [branding.host], `entitlement lists ${JSON.stringify(found)}`)
})

// 3. The iOS knob. Values here are what a rebuild picks up once the xcconfig is attached.
check('Branding.xcconfig matches ops/branding.json', () => {
  const xc = read('NFCTimeSheets/Branding.xcconfig')
  assert.strictEqual(xcconfigValue(xc, 'TS_TEAM_ID'), branding.apple.teamId, 'TS_TEAM_ID')
  assert.strictEqual(xcconfigValue(xc, 'TS_TAG_HOST'), branding.host, 'TS_TAG_HOST')
  assert.strictEqual(xcconfigValue(xc, 'TS_APP_NAME'), branding.appName, 'TS_APP_NAME')
  assert.ok(
    branding.apple.bundleIds.includes(xcconfigValue(xc, 'TS_BUNDLE_ID')),
    `TS_BUNDLE_ID ${xcconfigValue(xc, 'TS_BUNDLE_ID')} is not in apple.bundleIds ${branding.apple.bundleIds.join(', ')}`,
  )
})

// 4. The iOS FALLBACKS - what an unconfigured build uses, i.e. what is live on TestFlight
//    today. These must track branding.json too, or "inert by default" quietly means "wrong
//    by default" after the first rebrand.
check('Branding.swift fallbacks match ops/branding.json', () => {
  const swift = read('NFCTimeSheets/NFCTimeSheets/Branding.swift')
  const value = (name) => {
    const m = swift.match(new RegExp(`static let ${name} = "([^"]*)"`))
    assert.ok(m, `Branding.swift has no ${name}`)
    return m[1]
  }
  assert.strictEqual(value('defaultTagHost'), branding.host, 'defaultTagHost')
  assert.ok(
    branding.apple.bundleIds.includes(value('defaultBundleId')),
    `defaultBundleId ${value('defaultBundleId')} is not in apple.bundleIds`,
  )
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
//    the wall - the only failure in this product whose fix is a site visit.
check('web/lib/tag.ts default origin == https://branding.host', () => {
  const m = read('web/lib/tag.ts').match(/NEXT_PUBLIC_TAG_BASE_URL\s*\?\?\s*'([^']+)'/)
  assert.ok(m, 'default for NEXT_PUBLIC_TAG_BASE_URL not found')
  assert.strictEqual(m[1], `https://${branding.host}`)
})

// 7. Android. Absent until the android/ skeleton lands; a skip is honest, a pass is not.
if (has('android/branding.properties')) {
  check('android/branding.properties matches ops/branding.json', () => {
    const p = read('android/branding.properties')
    assert.strictEqual(propertiesValue(p, 'ts.applicationId'), branding.android.packageName)
    assert.strictEqual(propertiesValue(p, 'ts.tagHost'), branding.host)
    assert.strictEqual(propertiesValue(p, 'ts.appName'), branding.appName)
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
check(`host ${branding.host} has one home in Swift (Branding.swift)`, () => {
  const stripComments = (text) =>
    text
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('//') && !l.trimStart().startsWith('*'))
      .join('\n')
  const hits = sourceFiles()
    .filter((f) => f.endsWith('.swift') && !f.endsWith('Branding.swift'))
    .filter((f) => stripComments(read(f)).includes(branding.host))
  assert.deepStrictEqual(hits, [], 'read Branding.tagHost / TagLink.host instead')
})

process.stdout.write('\n')
if (failures.length > 0) {
  process.stdout.write(`check-branding: ${failures.length} FAILED\n  ${failures.join('\n  ')}\n`)
  process.stdout.write('A mismatch here is a tap that dies silently. Fix before deploying.\n')
  process.exit(1)
}
process.stdout.write(`check-branding: OK${skipped.length > 0 ? ` (${skipped.length} skipped)` : ''}\n`)
