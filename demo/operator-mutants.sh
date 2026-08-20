#!/bin/sh
# THE NEGATIVE CASE FOR EVERY CLAIM demo/check-operators.mjs MAKES.
#
#   «stack» seeded nfc_demo + the API serving a build of web/ on 127.0.0.1:8080 (loopback)
#   sh demo/operator-mutants.sh                 # all of them
#   sh demo/operator-mutants.sh trap muted      # a subset
#
# A CHECK WHOSE NEGATIVE CASE CANNOT FAIL IS NOT A CHECK, and this tree has shipped five that
# passed over zero rows. Every mutant below REVERTS ONE TRUE THING about the /operators/
# screen, rebuilds, and requires the check to name it. Then it is restored and the tree is
# rebuilt from the real source.
#
# „Real inverse" matters: a mutant that deletes the whole screen proves only that the check
# notices a blank page. Each one here leaves the screen working and takes away exactly the
# property being claimed.
#
#   hide-inactive  fetchOperators drops inactive people. The list still renders, still has a
#                  Status column, still says „Aktiv" — Petra Illek is simply gone, which is
#                  the „nothing true deleted to lighten a screen" failure, not a crash.
#   unmarked       the phone Field loses its `required` PROP but keeps the native `required`
#                  on the input. The form still refuses an empty phone; it just stops SAYING
#                  the field is mandatory, so the two assertions have to disagree with each
#                  other rather than with an empty screen.
#   generic-409    reportSaveFailure loses its phone_claimed branch. The refusal is still
#                  shown, still German, still in the drawer — it just no longer lands ON the
#                  phone field, which is the difference between „fix this box" and „something
#                  was wrong".
#   raw-token      the refusal prints the server's own `code` instead of the translated
#                  sentence. This is D3's defect (`Keine Koordinaten · no_key`) transplanted
#                  onto this screen, and it is the reason the check greps for tokens at all.
#   no-phone-col   the table stops printing the number it just stored.
#   no-preview     the drawer stops showing what the typed number will be STORED as, so a
#                  director cannot see +43 being applied before committing to it.
#   no-notice      the successful create says nothing in the page's live region. The drawer
#                  closes and the row appears, so a sighted user still sees it — this is a
#                  screen-reader-only defect, which is exactly the kind that survives review.
#   code-no-focus  the fresh code is rendered but focus stays where it was: the director is
#                  reading a code out over the phone and has to hunt for it.
#   code-no-once   the panel drops the sentence saying the code is shown once and what to do
#                  if it leaks. The code still works.
#   revoke-direct  „Zugangscode sperren" revokes IMMEDIATELY, with no confirmation. This is
#                  the one mutant whose check-side failure arrives as a timed-out wait, which
#                  is why check-operators records a crash as a named FAIL.
#   soft-consequence  the deactivate confirmation keeps the person's name and loses the
#                  sentence admitting it cannot be undone from that screen.
#   no-trap        useOverlay stops handling Tab. Escape still closes, focus still moves in;
#                  only the trap is gone, so Tab walks out into the page behind.
#   no-restore     useOverlay's restoration lands on <body>. The overlay still closes.
#   by-label       restoration stops using the node and always re-finds the opener BY TAG AND
#                  LABEL — useOverlay's own `again()` fallback. EXPLORATORY, printed and not
#                  counted: on this screen React does not replace the button, so the two are
#                  the same node and the check CANNOT tell them apart. That is the honest
#                  ceiling of „focus returns to the EXACT node".
#   wide-table     .data-table gets a 1100px floor. Nothing overflows at 1152 and up, so this
#                  can only be caught by a probe that measures the MIDDLE of the band — the
#                  band that has broken twice because only its endpoints were checked.
#   dim-muted      the dark theme's --text-muted goes to #26282c: still legible-ish on a good
#                  monitor, 1.5:1 on the panel. audit-contrast's own recipe.
#   dot-not-word   Status becomes a coloured dot instead of „Aktiv"/„Inaktiv". Colour is then
#                  the ONLY signal, which decision-43 forbids and greyscale exposes.
#   gap-closed     the OPPOSITE direction: TASK-215's sentence is added to both locales, and
#                  the KNOWN_GAPS entry must go STALE and exit 1. A named gap that cannot
#                  detect its own fix is an excuse with no expiry date.
#
# Every mutant is restored in an EXIT trap and the run ends by asserting `git status
# --porcelain web/` is empty. A mutant left on disk is worse than no mutation test, because
# the next run measures it and believes it.
set -u
cd "$(dirname "$0")/.."

BASE="${DEMO_BASE:-http://127.0.0.1:8080}"
case "$(printf '%s' "$BASE" | sed 's|https\{0,1\}://||; s|[:/].*||')" in
  127.0.0.1|localhost) ;;
  *) echo "operator-mutants: loopback only."; exit 1 ;;
esac

# The maps key is not needed by /operators/ — but a keyless rebuild would silently disarm
# every OTHER browser check on this machine afterwards (build-guard.mjs's own warning), and
# this script rebuilds web/out eighteen times. So it is required, and it is put back.
MAPS_KEY="${NEXT_PUBLIC_GOOGLE_MAPS_KEY:-}"
if [ -z "$MAPS_KEY" ]; then
  MAPS_KEY="$(psst get NEXT_PUBLIC_GOOGLE_MAPS_KEY 2>/dev/null || true)"
fi
if [ -z "$MAPS_KEY" ]; then
  echo "operator-mutants: NEXT_PUBLIC_GOOGLE_MAPS_KEY is empty — rebuilding without it would"
  echo "  leave a keyless bundle behind and every map assertion on this machine would go quiet."
  exit 1
fi

PAGE=web/app/operators/page.tsx
API=web/lib/api.ts
OVERLAY=web/lib/useOverlay.ts
CSS=web/app/globals.css
DE=web/messages/de.json
EN=web/messages/en.json
FILES="$PAGE $API $OVERLAY $CSS $DE $EN"
LOG=/tmp/operator-mutants
mkdir -p "$LOG"

restore() { git checkout -- $FILES 2>/dev/null; }
rebuild() {
  ( cd web && NEXT_PUBLIC_GOOGLE_MAPS_KEY="$MAPS_KEY" pnpm build ) >/dev/null 2>&1
}
cleanup() { restore; echo "  … rebuilding the real tree"; rebuild; }
trap cleanup EXIT

fails=0
WANTED="${*:-}"
selected() {
  [ -z "$WANTED" ] && return 0
  case " $WANTED " in *" $1 "*) return 0 ;; *) return 1 ;; esac
}

apply() { python3 - "$@"; }

# run <id> <what-must-go-red> — rebuild, run the check, require a NAMED failure.
#
# A non-zero exit is not enough: a check that dies on a hung CDP session exits 1 with every
# assertion it reached still green, and counting that as „the negative case fires" is the
# vacuous pass this file exists to rule out. So the log must carry a FAIL line, and the line
# must MENTION the property this mutant took away — otherwise the mutant was caught by
# something unrelated and the assertion under test is still unproven.
run() {
  id=$1; want=$2
  rebuild || { echo "  FAIL $id: the mutant did not build"; fails=$((fails + 1)); restore; return; }
  DEMO_BASE="$BASE" node demo/check-operators.mjs > "$LOG/$id.log" 2>&1
  rc=$?
  caught=$(grep -cE '^ +(FAIL|STALE-GAP)' "$LOG/$id.log")
  named=$(grep -E '^ +(FAIL|STALE-GAP)' "$LOG/$id.log" | grep -ci "$want")
  if [ "$rc" -eq 0 ]; then
    echo "  FAIL $id is GREEN with the truth reverted — nothing tests it"
    fails=$((fails + 1))
  elif [ "$named" -gt 0 ]; then
    echo "  ok   $id goes RED and NAMES it ($caught failed assertion(s)):"
    grep -E '^ +(FAIL|STALE-GAP)' "$LOG/$id.log" | head -3 | sed 's/^/       /'
  elif [ "$caught" -gt 0 ]; then
    echo "  FAIL $id went red for the WRONG reason — no failure mentions \"$want\""
    grep -E '^ +(FAIL|STALE-GAP)' "$LOG/$id.log" | head -3 | sed 's/^/       /'
    fails=$((fails + 1))
  else
    echo "  FAIL $id: exit $rc with no failed assertion — INCONCLUSIVE, not caught"
    tail -3 "$LOG/$id.log" | sed 's/^/       /'
    fails=$((fails + 1))
  fi
  restore
}

# note <id> — the same, but the outcome is REPORTED and not counted. For a mutant whose
# point is to find out whether an assertion can tell the difference at all.
note() {
  id=$1
  rebuild || { echo "  ·    $id did not build"; restore; return; }
  DEMO_BASE="$BASE" node demo/check-operators.mjs > "$LOG/$id.log" 2>&1
  if [ "$?" -eq 0 ]; then
    echo "  ·    $id stays GREEN — the check cannot distinguish this (ceiling, reported not counted)"
  else
    echo "  ·    $id goes RED:"
    grep -E '^ +(FAIL|STALE-GAP)' "$LOG/$id.log" | head -3 | sed 's/^/       /'
  fi
  restore
}

# --- hide-inactive ---------------------------------------------------------------------
if selected hide-inactive; then
echo "=== MUTANT hide-inactive · a deactivated operator quietly leaves the list ==="
apply "$API" <<'PY'
import sys
p = sys.argv[1]; s = open(p, encoding='utf-8').read()
old = """  return apiFetch<{ operators: Operator[] }>('/admin/data', { signal }).then(
    (data) => data.operators,
  )"""
new = """  return apiFetch<{ operators: Operator[] }>('/admin/data', { signal }).then(
    (data) => data.operators.filter((o) => o.active),
  )"""
assert old in s, 'hide-inactive site not found — fetchOperators moved'
open(p, 'w', encoding='utf-8').write(s.replace(old, new, 1))
PY
[ $? -eq 0 ] || exit 1
run hide-inactive "every seeded operator is on screen"
fi

# --- unmarked --------------------------------------------------------------------------
if selected unmarked; then
echo ""
echo "=== MUTANT unmarked · the phone field stops SAYING it is mandatory ==="
apply "$PAGE" <<'PY'
import sys
p = sys.argv[1]; s = open(p, encoding='utf-8').read()
old = """            <Field
              id={phoneId}
              label={t('fieldPhone')}
              required
              help={"""
new = """            <Field
              id={phoneId}
              label={t('fieldPhone')}
              help={"""
assert old in s, 'unmarked site not found — the phone Field moved'
open(p, 'w', encoding='utf-8').write(s.replace(old, new, 1))
PY
[ $? -eq 0 ] || exit 1
run unmarked "marked required or optional"
fi

# --- generic-409 -----------------------------------------------------------------------
if selected generic-409; then
echo ""
echo "=== MUTANT generic-409 · the refusal stops landing on the phone field ==="
apply "$PAGE" <<'PY'
import sys
p = sys.argv[1]; s = open(p, encoding='utf-8').read()
old = """    if (cause instanceof ApiError && cause.status === 409 && cause.code === 'phone_claimed') {
      setFieldErrors({ phone: 'errorPhoneClaimed' })
      setFormError('errorPhoneClaimed')
      return
    }"""
new = """"""
assert old in s, 'generic-409 site not found — reportSaveFailure moved'
open(p, 'w', encoding='utf-8').write(s.replace(old, new, 1))
PY
[ $? -eq 0 ] || exit 1
run generic-409 "phone field is marked invalid"
fi

# --- raw-token -------------------------------------------------------------------------
if selected raw-token; then
echo ""
echo "=== MUTANT raw-token · the server's own word is printed at the director ==="
apply "$PAGE" <<'PY'
import sys
p = sys.argv[1]; s = open(p, encoding='utf-8').read()
old = """            <p className="form-error" role="alert">
              {formError !== null ? t(formError) : saveError !== null ? tError(saveError) : ''}
            </p>"""
new = """            <p className="form-error" role="alert">
              {formError !== null ? 'phone_claimed' : saveError !== null ? tError(saveError) : ''}
            </p>"""
assert old in s, 'raw-token site not found — the drawer form-error moved'
open(p, 'w', encoding='utf-8').write(s.replace(old, new, 1))
PY
[ $? -eq 0 ] || exit 1
run raw-token "no raw server token"
fi

# --- no-phone-col ----------------------------------------------------------------------
if selected no-phone-col; then
echo ""
echo "=== MUTANT no-phone-col · the table stops printing the number it stored ==="
apply "$PAGE" <<'PY'
import sys
p = sys.argv[1]; s = open(p, encoding='utf-8').read()
old = "                  <td>{operator.phone_e164}</td>"
new = "                  <td />"
assert old in s, 'no-phone-col site not found'
open(p, 'w', encoding='utf-8').write(s.replace(old, new, 1))
PY
[ $? -eq 0 ] || exit 1
run no-phone-col "with the phone in E.164"
fi

# --- no-preview ------------------------------------------------------------------------
if selected no-preview; then
echo ""
echo "=== MUTANT no-preview · the drawer stops showing what will be STORED ==="
apply "$PAGE" <<'PY'
import sys
p = sys.argv[1]; s = open(p, encoding='utf-8').read()
old = "                phonePreview === null ? t('phoneHint') : t('phonePreview', { phone: phonePreview })"
new = "                t('phoneHint')"
assert old in s, 'no-preview site not found'
open(p, 'w', encoding='utf-8').write(s.replace(old, new, 1))
PY
[ $? -eq 0 ] || exit 1
run no-preview "previewed the normalised number"
fi

# --- no-notice -------------------------------------------------------------------------
if selected no-notice; then
echo ""
echo "=== MUTANT no-notice · the successful create is announced to nobody ==="
apply "$PAGE" <<'PY'
import sys
p = sys.argv[1]; s = open(p, encoding='utf-8').read()
old = """      await saveOperator({ name, phone })
      setNotice({ ok: true, text: t('saved') })"""
new = """      await saveOperator({ name, phone })"""
assert old in s, 'no-notice site not found'
open(p, 'w', encoding='utf-8').write(s.replace(old, new, 1))
PY
[ $? -eq 0 ] || exit 1
run no-notice "live region"
fi

# --- code-no-focus ---------------------------------------------------------------------
if selected code-no-focus; then
echo ""
echo "=== MUTANT code-no-focus · the code appears and focus stays where it was ==="
apply "$PAGE" <<'PY'
import sys
p = sys.argv[1]; s = open(p, encoding='utf-8').read()
old = "    if (freshCode !== null) codePanelRef.current?.focus()"
new = "    if (freshCode !== null) void 0"
assert old in s, 'code-no-focus site not found'
open(p, 'w', encoding='utf-8').write(s.replace(old, new, 1))
PY
[ $? -eq 0 ] || exit 1
run code-no-focus "focus lands on the panel"
fi

# --- code-no-once ----------------------------------------------------------------------
if selected code-no-once; then
echo ""
echo "=== MUTANT code-no-once · the panel stops saying the code is shown once ==="
apply "$PAGE" <<'PY'
import sys
p = sys.argv[1]; s = open(p, encoding='utf-8').read()
old = "          <p id={codeOnceId}>{t('codeOnce')}</p>"
new = "          <p id={codeOnceId} />"
assert old in s, 'code-no-once site not found'
open(p, 'w', encoding='utf-8').write(s.replace(old, new, 1))
PY
[ $? -eq 0 ] || exit 1
run code-no-once "only time it is shown"
fi

# --- revoke-direct ---------------------------------------------------------------------
if selected revoke-direct; then
echo ""
echo "=== MUTANT revoke-direct · blocking a code no longer asks ==="
apply "$PAGE" <<'PY'
import sys
p = sys.argv[1]; s = open(p, encoding='utf-8').read()
old = "                          onClick={() => setPending({ kind: 'revoke', operator })}"
new = "                          onClick={() => void revokeCode(operator)}"
assert old in s, 'revoke-direct site not found'
open(p, 'w', encoding='utf-8').write(s.replace(old, new, 1))
PY
[ $? -eq 0 ] || exit 1
run revoke-direct "confirmation names the person"
fi

# --- soft-consequence ------------------------------------------------------------------
if selected soft-consequence; then
echo ""
echo "=== MUTANT soft-consequence · the deactivate confirmation stops admitting it is final ==="
apply "$DE" <<'PY'
import sys, json, collections
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
old = "Diese Aktion lässt sich auf diesem Bildschirm nicht rückgängig machen."
assert old in s, 'soft-consequence site not found in de.json'
open(p, 'w', encoding='utf-8').write(s.replace(old, "", 1))
PY
[ $? -eq 0 ] || exit 1
run soft-consequence "cannot be undone here"
fi

# --- no-trap ---------------------------------------------------------------------------
if selected no-trap; then
echo ""
echo "=== MUTANT no-trap · Tab walks out of the overlay into the page behind ==="
apply "$OVERLAY" <<'PY'
import sys
p = sys.argv[1]; s = open(p, encoding='utf-8').read()
old = "      if (event.key !== 'Tab') return"
new = "      if (event.key !== 'Tab') return\n      return"
assert old in s, 'no-trap site not found'
open(p, 'w', encoding='utf-8').write(s.replace(old, new, 1))
PY
[ $? -eq 0 ] || exit 1
run no-trap "cycles inside"
fi

# --- no-restore ------------------------------------------------------------------------
if selected no-restore; then
echo ""
echo "=== MUTANT no-restore · the closed overlay drops the keyboard on <body> ==="
apply "$OVERLAY" <<'PY'
import sys
p = sys.argv[1]; s = open(p, encoding='utf-8').read()
old = """  const land = () => {
    const target = opener?.isConnected === true ? opener : again()
    if (target?.isConnected === true) target.focus()
    else document.getElementById('main-content')?.focus()
  }"""
new = """  const land = () => {
    document.body.focus()
  }"""
assert old in s, 'no-restore site not found'
open(p, 'w', encoding='utf-8').write(s.replace(old, new, 1))
PY
[ $? -eq 0 ] || exit 1
run no-restore "returns to the EXACT node"
fi

# --- by-label (exploratory) ------------------------------------------------------------
if selected by-label; then
echo ""
echo "=== MUTANT by-label · restoration always re-finds the opener by tag+label (EXPLORATORY) ==="
apply "$OVERLAY" <<'PY'
import sys
p = sys.argv[1]; s = open(p, encoding='utf-8').read()
old = "    const target = opener?.isConnected === true ? opener : again()"
new = "    const target = again()"
assert old in s, 'by-label site not found'
open(p, 'w', encoding='utf-8').write(s.replace(old, new, 1))
PY
[ $? -eq 0 ] || exit 1
note by-label
fi

# --- wide-table ------------------------------------------------------------------------
if selected wide-table; then
echo ""
echo "=== MUTANT wide-table · the table gets an 1100px floor (only the MIDDLE band breaks) ==="
apply "$CSS" <<'PY'
import sys
p = sys.argv[1]; s = open(p, encoding='utf-8').read()
old = ".data-table {\n"
new = ".data-table {\n  min-width: 1100px;\n"
assert old in s, 'wide-table site not found'
open(p, 'w', encoding='utf-8').write(s.replace(old, new, 1))
PY
[ $? -eq 0 ] || exit 1
run wide-table "no sideways scroll"
fi

# --- dim-muted -------------------------------------------------------------------------
if selected dim-muted; then
echo ""
echo "=== MUTANT dim-muted · the dark theme's --text-muted sinks into the panel ==="
apply "$CSS" <<'PY'
import sys
p = sys.argv[1]; s = open(p, encoding='utf-8').read()
i = s.index('--text-muted:')
j = s.index(';', i)
old = s[i:j + 1]
s = s[:i] + '--text-muted: #26282c;' + s[j + 1:]
open(p, 'w', encoding='utf-8').write(s)
print('  (replaced ' + old + ')')
PY
[ $? -eq 0 ] || exit 1
run dim-muted "meet WCAG AA"
fi

# --- dot-not-word ----------------------------------------------------------------------
if selected dot-not-word; then
echo ""
echo "=== MUTANT dot-not-word · Status becomes a colour, and only a colour ==="
apply "$PAGE" <<'PY'
import sys
p = sys.argv[1]; s = open(p, encoding='utf-8').read()
old = "                  <td>{operator.active ? t('statusActive') : t('statusInactive')}</td>"
new = """                  <td>
                    <span
                      aria-hidden="true"
                      style={{
                        display: 'inline-block',
                        width: 10,
                        height: 10,
                        borderRadius: '50%',
                        background: operator.active ? 'var(--ok)' : 'var(--danger)',
                      }}
                    />
                  </td>"""
assert old in s, 'dot-not-word site not found'
open(p, 'w', encoding='utf-8').write(s.replace(old, new, 1))
PY
[ $? -eq 0 ] || exit 1
run dot-not-word "WORDS, not a colour"
fi

# --- gap-closed ------------------------------------------------------------------------
if selected gap-closed; then
echo ""
echo "=== MUTANT gap-closed · TASK-215's sentence is written, so the named gap must go STALE ==="
apply "$DE" <<'PY'
import sys
p = sys.argv[1]; s = open(p, encoding='utf-8').read()
old = '"phoneHint": "Mit 0 oder +43 beginnen, zum Beispiel 0664 1234567 oder +43 664 1234567.",\n    "phonePreview": "Wird gespeichert als: {phone}",\n    "errorNameRequired": "Bitte einen Namen eingeben.",\n    "errorPhoneRequired": "Bitte eine Telefonnummer eingeben.",\n    "errorPhoneInvalid": "Das ist keine gültige Telefonnummer. Bitte mit 0 oder +43 beginnen, zum Beispiel 0664 1234567.",\n    "errorPhoneClaimed": "Diese Telefonnummer ist bereits vergeben.",'
assert old in s, 'gap-closed site not found in de.json (operators namespace moved)'
new = old.replace(
  '"phoneHint": "Mit 0 oder +43 beginnen, zum Beispiel 0664 1234567 oder +43 664 1234567.",',
  '"phoneHint": "Mit 0 oder +43 beginnen, zum Beispiel 0664 1234567. Eine Nummer, die bereits einem Mitarbeiter gehört, kann hier nicht verwendet werden.",',
)
open(p, 'w', encoding='utf-8').write(s.replace(old, new, 1))
PY
[ $? -eq 0 ] || exit 1
run gap-closed "STALE-GAP"
fi

# --- the tree is clean again ------------------------------------------------------------
restore
dirty=$(git status --porcelain $FILES)
echo ""
if [ -n "$dirty" ]; then
  echo "operator-mutants: A MUTANT IS STILL ON DISK — the next run would measure it:"
  printf '%s\n' "$dirty"
  fails=$((fails + 1))
fi

if [ "$fails" -eq 0 ]; then
  echo "operator-mutants: every negative case fires."
else
  echo "operator-mutants: $fails PROBLEM(S) — see above."
  exit 1
fi
