# Translation files

`en.json` is the source of truth. `de.json` currently holds **English placeholder values**
(decision-8: infrastructure now, translation as a content task later; decision-17: MVP ships
English only).

Rules enforced by `pnpm check`:

- every locale file has the **exact same key set** as `en.json`
- every `{placeholder}` used in an English string is also present in the translated string

To translate: edit the *values* in `de.json` only. Never add, remove or rename keys there —
add them to `en.json` first, then mirror.

Keys are **nested namespaces** (`{"nav": {"shifts": "Shifts"}}`, addressed as `nav.shifts`),
because next-intl resolves a key by walking the path. `pnpm check` flattens both files to
dotted paths before comparing, so key parity stays a plain set difference, and the
`next-intl` module augmentation in `global.d.ts` derives the key type from `en.json`, so a
typo in `t('nav.shfits')` fails `pnpm typecheck`.

Values are ICU MessageFormat. `{width}` interpolates; a literal `{`, `}` or `'` must be
escaped per the ICU rules.
