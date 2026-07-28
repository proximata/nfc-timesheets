#!/usr/bin/env node
/**
 * Two mechanical rules that WILL drift if nobody enforces them:
 *
 *   1. decision-9 - every dependency version in package.json is exact. No ^, no ~, no ranges.
 *   2. decision-8 - every locale file has the identical key set to en.json, and every
 *      {placeholder} in an English string survives translation.
 *   3. decision-20 - the admin PIN is gone and stays gone: no PIN header, no credential in
 *      web storage, and the API client keeps sending the session cookie.
 *
 * Message files are nested objects (next-intl's namespace format, decision-17); they are
 * flattened to dotted paths here so the comparison stays a plain set difference.
 *
 * Plain node, no framework, no dependencies. Run: `pnpm check`. Exits non-zero on failure.
 */

import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const REFERENCE_LOCALE = 'en'
const LOCALES = ['en', 'de']

const failures = []

function check(name, fn) {
  try {
    fn()
    process.stdout.write(`  ok   ${name}\n`)
  } catch (error) {
    failures.push(name)
    process.stdout.write(
      `  FAIL ${name}\n         ${error.message.replace(/\n/g, '\n         ')}\n`,
    )
  }
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(join(ROOT, relativePath), 'utf8'))
}

function placeholders(value) {
  return new Set(Array.from(value.matchAll(/\{(\w+)\}/g), (match) => match[1]))
}

/** {a: {b: 'x'}} -> {'a.b': 'x'}. Non-string leaves are kept so they can be reported. */
function flatten(value, prefix = '', out = {}) {
  for (const [key, child] of Object.entries(value)) {
    const path = prefix === '' ? key : `${prefix}.${key}`
    if (child !== null && typeof child === 'object' && !Array.isArray(child)) {
      flatten(child, path, out)
    } else {
      out[path] = child
    }
  }
  return out
}

// One runnable check of the only non-trivial function in this file.
assert.deepEqual(flatten({ a: { b: 'x', c: { d: 'y' } }, e: 'z' }), {
  'a.b': 'x',
  'a.c.d': 'y',
  e: 'z',
})

// --- 1. exact version pins (decision-9) ------------------------------------------------

const pkg = readJson('package.json')
const DEP_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

check('package.json: all dependency versions are exact (no ^ or ~ or ranges)', () => {
  const offenders = []
  for (const field of DEP_FIELDS) {
    for (const [name, range] of Object.entries(pkg[field] ?? {})) {
      if (!EXACT_VERSION.test(range)) offenders.push(`${field}.${name} = "${range}"`)
    }
  }
  assert.deepEqual(offenders, [], `not pinned to an exact version:\n- ${offenders.join('\n- ')}`)
})

check('.npmrc: save-exact=true', () => {
  const npmrc = readFileSync(join(ROOT, '.npmrc'), 'utf8')
  assert.match(npmrc, /^save-exact\s*=\s*true$/m, '.npmrc must contain save-exact=true')
})

// --- 2. locale key parity (decision-8) -------------------------------------------------

const dictionaries = Object.fromEntries(
  LOCALES.map((locale) => [locale, flatten(readJson(`messages/${locale}.json`))]),
)
const reference = dictionaries[REFERENCE_LOCALE]
const referenceKeys = Object.keys(reference)

check(`messages/${REFERENCE_LOCALE}.json: non-empty, every leaf is a string`, () => {
  assert.ok(referenceKeys.length > 0, 'reference dictionary is empty')
  const bad = referenceKeys.filter(
    (key) => typeof reference[key] !== 'string' || reference[key].trim() === '',
  )
  assert.deepEqual(bad, [], `keys must map to a non-empty string: ${bad.join(', ')}`)
})

for (const locale of LOCALES.filter((l) => l !== REFERENCE_LOCALE)) {
  const dictionary = dictionaries[locale]

  check(`messages/${locale}.json: key set identical to ${REFERENCE_LOCALE}.json`, () => {
    const keys = Object.keys(dictionary)
    const missing = referenceKeys.filter((key) => !(key in dictionary))
    const extra = keys.filter((key) => !(key in reference))
    assert.deepEqual(
      { missing, extra },
      { missing: [], extra: [] },
      `missing: [${missing.join(', ')}]\nextra:   [${extra.join(', ')}]`,
    )
  })

  check(`messages/${locale}.json: all values are non-empty strings`, () => {
    const bad = Object.keys(dictionary).filter(
      (key) => typeof dictionary[key] !== 'string' || dictionary[key].trim() === '',
    )
    assert.deepEqual(bad, [], `keys must map to a non-empty string: ${bad.join(', ')}`)
  })

  check(`messages/${locale}.json: {placeholders} preserved`, () => {
    const broken = []
    for (const key of referenceKeys) {
      const expected = placeholders(reference[key])
      const actual = placeholders(dictionary[key] ?? '')
      const lost = [...expected].filter((name) => !actual.has(name))
      const invented = [...actual].filter((name) => !expected.has(name))
      if (lost.length > 0 || invented.length > 0) {
        broken.push(
          `${key} (lost: ${lost.join(',') || '-'}, unknown: ${invented.join(',') || '-'})`,
        )
      }
    }
    assert.deepEqual(broken, [], `placeholder mismatch:\n- ${broken.join('\n- ')}`)
  })
}

// --- 3. auth hygiene (decision-20) -----------------------------------------------------

const SOURCE_DIRS = ['app', 'components', 'lib']
const SOURCE_EXT = /\.(ts|tsx)$/

function sourceFiles(dir, out = []) {
  for (const entry of readdirSync(join(ROOT, dir))) {
    const path = join(dir, entry)
    if (statSync(join(ROOT, path)).isDirectory()) sourceFiles(path, out)
    else if (SOURCE_EXT.test(entry)) out.push(path)
  }
  return out
}

const sources = SOURCE_DIRS.flatMap((dir) => sourceFiles(dir)).map((path) => ({
  path,
  text: readFileSync(join(ROOT, path), 'utf8'),
}))

check('no admin PIN and no client-stored credential survives anywhere in the app', () => {
  // The session is an httpOnly cookie the browser owns. Anything below means someone
  // reintroduced a secret this bundle can read - i.e. one that XSS can read too.
  const banned = [/x-admin-pin/i, /adminPin/, /sessionStorage/, /document\.cookie/]
  const offenders = sources.flatMap(({ path, text }) =>
    banned.filter((pattern) => pattern.test(text)).map((pattern) => `${path}: ${pattern}`),
  )
  assert.deepEqual(offenders, [], `forbidden auth plumbing:\n- ${offenders.join('\n- ')}`)
})

check('lib/api.ts sends the session cookie', () => {
  const api = sources.find(({ path }) => relative('lib', path) === 'api.ts')
  assert.ok(api, 'lib/api.ts is missing')
  assert.match(api.text, /credentials: 'include'/, "fetch must use credentials: 'include'")
})

// --- report -----------------------------------------------------------------------------

if (failures.length > 0) {
  process.stderr.write(`\n${failures.length} check(s) failed.\n`)
  process.exit(1)
}
process.stdout.write('\nAll checks passed.\n')
