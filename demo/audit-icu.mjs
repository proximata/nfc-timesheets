// ICU message parity, from the PARSED AST, in both locales. No browser, no database.
//
//   node demo/audit-icu.mjs
//
// `web/scripts/check.mjs` already proves three things and this file does not repeat them:
// the key sets are identical, the ARGUMENT sets survive translation (from the AST, not a
// regex), and a tallied `{count}` always selects a plural. What it does NOT prove is the
// SHAPE of the plural, and that is where half-applied translations hide:
//
//   1. PLURAL CATEGORY PARITY. `{n, plural, one {# Schicht} other {# Schichten}}` and
//      `{n, plural, other {# Schichten}}` have the SAME argument set, so argument parity is
//      green for a German string that says „1 Schichten" on the screen the director reads
//      before paying people. Every plural must carry every category its locale needs, in
//      BOTH files, and „a plural form is a separate string" is exactly why.
//   2. CLDR-REQUIRED CATEGORIES. `de` and `en` both need `one` and `other` (cardinal). A
//      category list is taken from Intl.PluralRules rather than typed in, so this is right
//      for whatever locale is added next rather than right for these two.
//   3. `#` PARITY. A branch that hardcodes the digit instead of `#` renders „1 Schicht" for
//      every count. Same argument set, same categories, wrong number.
//   4. ARGUMENT TYPE AND STYLE PARITY. `{amount, number, ::currency/EUR}` in one locale and
//      a bare `{amount}` in the other is one file formatting money and the other printing a
//      float. The argument NAME is identical, so name parity cannot see it.
//   5. OFFSET AND PLURAL TYPE PARITY. `offset:1` or `selectordinal` on one side only.
//   6. EVERY KEY THE CODE ASKS FOR EXISTS. A `t('foo')` with no `foo` renders the key path
//      on screen. The browser checks catch that only on the paths they happen to visit.
//   7. AUSTRIAN MONTH NAMES. „Jänner", not „Januar" — the one lexical difference that shows
//      up in a business document a Viennese client reads. Checked against the locale files
//      AND against Intl's own `de-AT` output, so a hardcoded month list cannot drift from
//      the one the runtime formats dates with.
//
// It fails loudly if the parser cannot be resolved. A silently skipped i18n check is worse
// than a broken one: it reports the skipping as success.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'web')
const LOCALES = ['en', 'de']
const REFERENCE = 'en'

const results = []
const record = (ok, label, detail = '') => {
  results.push({ ok, label, detail })
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `\n         ${detail}` : ''}`)
}

/**
 * The same parser next-intl formats with, reached through pnpm's store because it is a
 * transitive dependency and nothing hoists it. Identical resolution to web/scripts/check.mjs
 * on purpose — two different parsers would be two different grammars.
 */
const store = join(ROOT, 'node_modules/.pnpm')
const prefix = '@formatjs+icu-messageformat-parser@'
const dir = readdirSync(store).find((name) => name.startsWith(prefix))
if (dir === undefined) {
  console.error(`audit-icu: ${prefix}* not found under node_modules/.pnpm — run pnpm install`)
  process.exit(1)
}
const { parse, TYPE } = await import(
  pathToFileURL(join(store, dir, 'node_modules/@formatjs/icu-messageformat-parser/index.js')).href
)

const flatten = (value, prefix = '', out = {}) => {
  for (const [key, child] of Object.entries(value)) {
    const path = prefix === '' ? key : `${prefix}.${key}`
    if (child !== null && typeof child === 'object' && !Array.isArray(child)) {
      flatten(child, path, out)
    } else out[path] = child
  }
  return out
}

const dict = Object.fromEntries(
  LOCALES.map((locale) => [
    locale,
    flatten(JSON.parse(readFileSync(join(ROOT, `messages/${locale}.json`), 'utf8'))),
  ]),
)
const keys = Object.keys(dict[REFERENCE])

/**
 * Every plural/select node in a message, IN TRAVERSAL ORDER, with the facts that must match
 * across locales. Recursive: a plural inside a plural branch counts.
 *
 * A LIST, NOT A MAP KEYED BY ARGUMENT, and that is not tidiness. `pl.methodUnpricedLabour`
 * selects on `{workers}` TWICE in German („Für # Mitarbeiter…" and later „um diesen Lohn /
 * um diese Löhne") and once in English. Keyed by argument, the second occurrence silently
 * overwrote the first, the surviving one carried no `#`, and this file reported a defect in
 * a message that is correct. A walker that loses data reports the loss as a finding.
 */
function selectorsOf(value) {
  const found = []
  const walk = (nodes) => {
    for (const node of nodes) {
      if (node.type === TYPE.plural || node.type === TYPE.select) {
        const branches = Object.keys(node.options ?? {}).sort()
        found.push({
          arg: node.value,
          kind: node.type === TYPE.plural ? 'plural' : 'select',
          pluralType: node.pluralType ?? null,
          offset: node.offset ?? 0,
          branches,
          // Which branches carry a `#`. A branch that spells the digit out renders the same
          // number for every count.
          pound: branches.filter((b) => hasPound(node.options[b].value)),
        })
      }
      if (node.options) for (const option of Object.values(node.options)) walk(option.value)
      if (node.type === TYPE.tag && node.children) walk(node.children)
    }
  }
  walk(parse(value))
  return found
}

/** The occurrences of one argument, collapsed into the facts that must agree across files. */
function summarise(occurrences) {
  if (occurrences.length === 0) return null
  return {
    count: occurrences.length,
    kinds: [...new Set(occurrences.map((o) => o.kind))].sort().join('+'),
    pluralTypes: [...new Set(occurrences.map((o) => String(o.pluralType)))].sort().join('+'),
    offsets: [...new Set(occurrences.map((o) => o.offset))].sort().join('+'),
    branches: [...new Set(occurrences.flatMap((o) => o.branches))].sort().join(','),
    // „Is the number printed AT ALL for this argument" — not „is it printed in every
    // occurrence", because a second, purely grammatical selection („um diesen Lohn") is a
    // legitimate reason for one occurrence to carry no `#`.
    anyPound: occurrences.some((o) => o.pound.length > 0),
  }
}

function hasPound(nodes) {
  for (const node of nodes) {
    if (node.type === TYPE.pound) return true
    if (node.options) {
      for (const option of Object.values(node.options)) if (hasPound(option.value)) return true
    }
    if (node.type === TYPE.tag && node.children && hasPound(node.children)) return true
  }
  return false
}

/** Every simple argument and how it is formatted: `{a}` vs `{a, number}` vs a skeleton. */
function typedArgumentsOf(value) {
  const found = new Map()
  const walk = (nodes) => {
    for (const node of nodes) {
      if (node.type === TYPE.argument) found.set(node.value, 'plain')
      if (node.type === TYPE.number) found.set(node.value, `number:${styleOf(node)}`)
      if (node.type === TYPE.date) found.set(node.value, `date:${styleOf(node)}`)
      if (node.type === TYPE.time) found.set(node.value, `time:${styleOf(node)}`)
      if (node.options) for (const option of Object.values(node.options)) walk(option.value)
      if (node.type === TYPE.tag && node.children) walk(node.children)
    }
  }
  walk(parse(value))
  return found
}

const styleOf = (node) => {
  const style = node.style
  if (style === null || style === undefined) return 'default'
  if (typeof style === 'string') return style
  // A skeleton is an object; its `parsedOptions` is what actually decides the formatting.
  return JSON.stringify(style.parsedOptions ?? style.tokens ?? style).slice(0, 60)
}

/** Self-test of the three walkers, so a walker that sees nothing cannot report parity. */
{
  const one = selectorsOf('{n, plural, offset:1 one {# Schicht} other {# Schichten}}')[0]
  const ok =
    one?.branches.join(',') === 'one,other' && one.offset === 1 && one.pound.join(',') === 'one,other'
  record(ok, 'self-test: the plural walker reads branches, offset and #', JSON.stringify(one))
  const noPound = selectorsOf('{n, plural, one {eine Schicht} other {# Schichten}}')[0]
  record(
    noPound?.pound.join(',') === 'other',
    'self-test: a branch that spells the number out is seen as having no #',
    JSON.stringify(noPound?.pound),
  )
  const twice = selectorsOf('{n, plural, one {# Lohn} other {# Löhne}} und {n, plural, one {dieser} other {diese}}')
  record(
    twice.length === 2 && summarise(twice).anyPound === true,
    'self-test: TWO selections on one argument are both kept, and one # is enough',
    `${twice.length} occurrences, anyPound=${summarise(twice).anyPound}`,
  )
  const typed = typedArgumentsOf('{a} {b, number, ::currency/EUR} {c, date, medium}')
  record(
    typed.get('a') === 'plain' && String(typed.get('b')).startsWith('number:') && String(typed.get('c')).startsWith('date:'),
    'self-test: the argument walker separates a bare argument from a formatted one',
    [...typed].map(([k, v]) => `${k}=${v}`).join(' '),
  )
  const nested = selectorsOf('{a, plural, one {{b, plural, one {#} other {#}}} other {x}}')
  record(
    nested.some((n) => n.arg === 'a') && nested.some((n) => n.arg === 'b'),
    'self-test: a plural nested inside a plural is seen',
    nested.map((n) => n.arg).join(','),
  )
}

// --- 1 · every message parses, in both locales ------------------------------------------
console.log('\n=== 1 · every message parses as ICU ===')
for (const locale of LOCALES) {
  const broken = []
  for (const key of Object.keys(dict[locale])) {
    const value = dict[locale][key]
    if (typeof value !== 'string') {
      broken.push(`${key}: not a string`)
      continue
    }
    try {
      parse(value)
    } catch (error) {
      broken.push(`${key}: ${String(error.message).split('\n')[0]}`)
    }
  }
  record(broken.length === 0, `${locale}: all ${Object.keys(dict[locale]).length} messages parse`, broken.join('\n         '))
}

// --- 2 · key parity, both directions ----------------------------------------------------
console.log('\n=== 2 · key parity ===')
for (const locale of LOCALES.filter((l) => l !== REFERENCE)) {
  const mine = Object.keys(dict[locale])
  const missing = keys.filter((k) => !(k in dict[locale]))
  const extra = mine.filter((k) => !(k in dict[REFERENCE]))
  record(
    missing.length === 0 && extra.length === 0,
    `${locale}: exactly the same ${keys.length} keys as ${REFERENCE}`,
    `missing: ${missing.join(', ') || '-'}\n         extra:   ${extra.join(', ') || '-'}`,
  )
}

// --- 3 · plural shape parity ------------------------------------------------------------
console.log('\n=== 3 · plural shape: categories, offset, type, and # ===')
{
  const problems = []
  let compared = 0
  for (const key of keys) {
    const shapes = Object.fromEntries(
      LOCALES.map((locale) => [locale, selectorsOf(String(dict[locale][key] ?? ''))]),
    )
    const argNames = new Set(LOCALES.flatMap((l) => shapes[l].map((o) => o.arg)))
    for (const arg of argNames) {
      compared++
      const ref = summarise(shapes[REFERENCE].filter((o) => o.arg === arg))
      for (const locale of LOCALES.filter((l) => l !== REFERENCE)) {
        const mine = summarise(shapes[locale].filter((o) => o.arg === arg))
        if (ref === null) {
          problems.push(`${key} {${arg}}: ${locale} selects on it, ${REFERENCE} does not`)
          continue
        }
        if (mine === null) {
          problems.push(`${key} {${arg}}: ${REFERENCE} is a ${ref.kinds}, ${locale} is a bare argument — this is where „1 Schichten" comes from`)
          continue
        }
        if (mine.kinds !== ref.kinds) problems.push(`${key} {${arg}}: ${ref.kinds} vs ${mine.kinds}`)
        if (mine.pluralTypes !== ref.pluralTypes) {
          problems.push(`${key} {${arg}}: pluralType ${ref.pluralTypes} vs ${mine.pluralTypes}`)
        }
        if (mine.offsets !== ref.offsets) {
          problems.push(`${key} {${arg}}: offset ${ref.offsets} vs ${mine.offsets}`)
        }
        if (mine.branches !== ref.branches) {
          problems.push(`${key} {${arg}}: branches [${ref.branches}] vs [${mine.branches}]`)
        }
        if (mine.anyPound !== ref.anyPound) {
          problems.push(`${key} {${arg}}: the number is printed in ${REFERENCE}=${ref.anyPound} ${locale}=${mine.anyPound} — one locale spells it out`)
        }
      }
    }
  }
  record(problems.length === 0, `plural shape identical across locales (${compared} selected arguments compared)`, problems.join('\n         '))
}

// --- 3b · within ONE plural, # is all-or-nothing ----------------------------------------
console.log('\n=== 3b · # is all-or-nothing inside a single plural ===')
// Check 3 is a PARITY check and parity cannot see this. `anyPound` is deliberately loose —
// „is the number printed AT ALL for this argument" — because pl.methodUnpricedLabour really
// does select on {workers} a second time for grammar alone („um diesen Lohn"/„um diese
// Löhne"), and a strict per-branch parity rule would report that correct message as broken.
//
// The cost of that looseness, measured: `one {1 Mitarbeiter ohne E-Mail} other {# Mitarbeiter
// ohne E-Mail}` was mutated into de.json and check 3 stayed green in BOTH directions. Same
// argument set, same categories, same anyPound — and the screen renders „1 Mitarbeiter" for
// every count. That is the exact defect this file's header claims to catch.
//
// So the rule here is not parity but an absolute, locale-independent one: inside a single
// plural selection, if ANY keyword branch prints the number then EVERY keyword branch must.
// EXACT-VALUE branches (`=0`) are exempt by construction — „keine offenen Schichten" naming
// no digit is the entire reason `=0` exists, and four real messages use it that way.
{
  const problems = []
  let plurals = 0
  const scan = (locale, key, nodes) => {
    for (const node of nodes) {
      if (node.type === TYPE.plural) {
        plurals++
        const keyword = Object.keys(node.options).filter((b) => !b.startsWith('='))
        const printing = keyword.filter((b) => hasPound(node.options[b].value))
        if (printing.length > 0 && printing.length < keyword.length) {
          const silent = keyword.filter((b) => !printing.includes(b))
          problems.push(
            `${locale} ${key} {${node.value}}: [${printing}] print the number, [${silent}] spell it out`,
          )
        }
      }
      if (node.options) for (const option of Object.values(node.options)) scan(locale, key, option.value)
      if (node.type === TYPE.tag && node.children) scan(locale, key, node.children)
    }
  }
  for (const locale of LOCALES) {
    for (const key of Object.keys(dict[locale])) scan(locale, key, parse(String(dict[locale][key] ?? '')))
  }
  record(
    problems.length === 0,
    `every plural prints # in all of its keyword branches or in none (${plurals} plurals scanned)`,
    problems.join('\n         '),
  )
}

// --- 4 · every CLDR category the locale needs -------------------------------------------
console.log('\n=== 4 · every plural form the locale requires ===')
// Taken from Intl, not typed in: `de` and `en` both need one+other today, and a locale added
// later gets the right list without anybody remembering to update this file.
for (const locale of LOCALES) {
  const required = new Set()
  const rules = new Intl.PluralRules(locale === 'de' ? 'de-AT' : locale)
  // Probe the numbers that actually appear in this admin — counts of shifts, workers and
  // euros — rather than the whole of CLDR's category list.
  for (const n of [0, 1, 2, 3, 5, 11, 21, 100, 1000]) required.add(rules.select(n))
  const missing = []
  let checked = 0
  for (const key of keys) {
    // EVERY occurrence, including a second selection on the same argument: a message that
    // gets „# Mitarbeiter" right and then says „um diese Löhne" for one worker is still
    // wrong, and keying by argument would have hidden exactly that.
    for (const shape of selectorsOf(String(dict[locale][key] ?? ''))) {
      if (shape.kind !== 'plural') continue
      checked++
      const have = new Set(shape.branches.map((b) => b.replace(/^=/, 'exact')))
      const lost = [...required].filter((c) => !have.has(c))
      if (lost.length) missing.push(`${key} {${shape.arg}}: has [${shape.branches}], needs [${[...required]}]`)
    }
  }
  record(
    missing.length === 0,
    `${locale}: all ${checked} plurals carry every category ${locale === 'de' ? 'de-AT' : locale} needs (${[...required].join(', ')})`,
    missing.join('\n         '),
  )
}

// --- 5 · argument type + style parity ---------------------------------------------------
console.log('\n=== 5 · argument type and style parity ===')
{
  const problems = []
  for (const key of keys) {
    const typed = Object.fromEntries(
      LOCALES.map((locale) => [locale, typedArgumentsOf(String(dict[locale][key] ?? ''))]),
    )
    const ref = typed[REFERENCE]
    for (const locale of LOCALES.filter((l) => l !== REFERENCE)) {
      for (const [arg, style] of ref) {
        const mine = typed[locale].get(arg)
        if (mine === undefined) problems.push(`${key} {${arg}}: missing in ${locale}`)
        else if (mine !== style) problems.push(`${key} {${arg}}: ${REFERENCE} formats it as ${style}, ${locale} as ${mine}`)
      }
      for (const [arg] of typed[locale]) {
        if (!ref.has(arg)) problems.push(`${key} {${arg}}: only in ${locale}`)
      }
    }
  }
  record(problems.length === 0, 'every argument is formatted the same way in both locales', problems.join('\n         '))
}

// --- 6 · every key the code asks for exists ---------------------------------------------
console.log('\n=== 6 · every t() key the source asks for exists ===')
{
  const SOURCE_EXT = /\.(ts|tsx)$/
  const files = []
  const walk = (rel) => {
    for (const entry of readdirSync(join(ROOT, rel))) {
      const path = join(rel, entry)
      if (statSync(join(ROOT, path)).isDirectory()) walk(path)
      else if (SOURCE_EXT.test(entry)) files.push(path)
    }
  }
  for (const d of ['app', 'components', 'lib']) walk(d)

  const missing = []
  const dynamic = []
  for (const file of files) {
    const text = readFileSync(join(ROOT, file), 'utf8')
    // The namespace a file's `t` was created with. Several files hold more than one, so
    // every namespace in the file is tried and a key that matches ANY of them is fine —
    // this is a check for keys that exist NOWHERE, not a namespace-attribution exercise.
    const namespaces = [...text.matchAll(/useTranslations\(\s*'([^']+)'\s*\)/g)].map((m) => m[1])
    if (namespaces.length === 0) continue
    for (const match of text.matchAll(/\bt[A-Za-z]*\(\s*'([^']+)'/g)) {
      const key = match[1]
      if (namespaces.some((ns) => `${ns}.${key}` in dict[REFERENCE])) continue
      if (key in dict[REFERENCE]) continue
      missing.push(`${file}: t('${key}') — no ${namespaces.map((n) => `${n}.${key}`).join(' / ')}`)
    }
    // A key built at runtime cannot be checked here. Counted, and named, so „0 missing" is
    // never read as „every key is verified".
    for (const _ of text.matchAll(/\bt[A-Za-z]*\(\s*`/g)) dynamic.push(file)
  }
  record(missing.length === 0, `every literal t() key resolves (${files.length} files)`, missing.join('\n         '))
  console.log(`       ${dynamic.length} template-literal t() call(s) are NOT checkable here: ${[...new Set(dynamic)].join(', ') || 'none'}`)
}

// --- 7 · Austrian German ----------------------------------------------------------------
console.log('\n=== 7 · Austrian business German ===')
{
  // The month names the RUNTIME will actually print, so a hardcoded German list in a message
  // cannot drift away from the dates beside it.
  const atMonths = [...Array(12).keys()].map((m) =>
    new Intl.DateTimeFormat('de-AT', { month: 'long', timeZone: 'Europe/Vienna' }).format(
      new Date(Date.UTC(2026, m, 15)),
    ),
  )
  record(
    atMonths[0] === 'Jänner',
    'Intl de-AT really is Austrian (Jänner, not Januar) — the premise of the check below',
    atMonths.join(' '),
  )
  const germanisms = []
  for (const key of Object.keys(dict.de)) {
    const value = String(dict.de[key])
    // ONLY Jänner. „Feber" is dialect and legal archaism, not standard Austrian: `Intl`
    // itself formats de-AT February as „Februar", and a check that demanded „Feber" would
    // put the message files at odds with the dates rendered beside them.
    if (/\bJanuar\b/.test(value)) germanisms.push(`${key}: „Januar" — Austrian is „Jänner": ${value.slice(0, 60)}`)
  }
  record(germanisms.length === 0, 'de.json contains no German-German month name', germanisms.join('\n         '))

  // Every German message uses the polite form or none at all. „Du" in an admin the director
  // shares with an accountant is the wrong register, and it is a one-way door once shipped.
  const informal = Object.keys(dict.de).filter((k) => /\b(Du|Dein|Deine|Deinen|dich|dir)\b/.test(String(dict.de[k])))
  record(informal.length === 0, 'de.json stays in the formal register (no Du/Dein)', informal.join(', '))
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed, ${failed.length} FAILED`)
process.exit(failed.length === 0 ? 0 : 1)
