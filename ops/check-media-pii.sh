#!/usr/bin/env bash
#
# NO COMMITTED SCREENSHOT MAY CARRY A REAL PERSON, ADDRESS OR RATE.
#
#   ./ops/check-media-pii.sh [host]
#   ./ops/check-media-pii.sh --mutate     # show it red against the file it was written for
#
# WHAT IT FOUND, and the shape of it is the point. `docs/media/prove-live/README.md` ended
# with this sentence, in the repo, committed:
#
#   "Nothing here carries a real customer name, address or rate: production holds one
#    building (HOIV) and everything else on these screens is marked PROVE-DELETE-ME and
#    was deleted."
#
# `docs/media/prove-live/02-building-created.png` and its `.txt` sibling carried, legibly:
# the client contact's FULL NAME, the building's street address, and the monthly contract
# value — on github.com/proximata/nfc-timesheets, which is PUBLIC. The claim was prose. It
# was written by the run that made the files, it was believed by every run after it, and
# nothing could ever have contradicted it.
#
# TASK-37 is the neighbouring problem and is NOT this one: it is about a blob that was
# DELETED from the tree and is still fetchable from history, and it is blocked on the owner
# because it needs a force push to a public repo. This is about what is in HEAD right now,
# which anybody can fix without rewriting anything.
#
# HOW IT KNOWS WHAT IS REAL WITHOUT WRITING ANYTHING REAL DOWN. The needles are read from
# PRODUCTION at run time — contact names, client names, street addresses, and the contract
# value in euros as the UI formats it — and thrown away when it exits. Hard-coding them here
# would put the leak in the file whose job is to prevent it.
#
#   psql (read-only, over ssh)  ->  needles in memory  ->  grep the TRACKED media
#
# PNGs are covered too, and that is most of the risk: a name in an image survives every text
# grep anybody will ever run. Images go through `strings` on the decompressed pixels? No —
# the text is PAINTED, so it is not in the file as text at all. What IS reliable is the .txt
# rendering that ops/prove-live.sh writes beside every screenshot: same page, same run, and
# it is a faithful transcript. So the rule is stated as: an image may be committed only if
# its .txt sibling is committed AND clean. An image with no transcript cannot be cleared by
# this check and is refused.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

MUTATE=0
if [ "${1:-}" = "--mutate" ]; then MUTATE=1; shift; fi
HOST="${1:-$(node -e 'process.stdout.write(require("./ops/branding.json").apiHost)')}"

FAILED=0
ok()  { echo "  ok:   $*"; }
bad() { echo "  FAIL: $*"; FAILED=1; }

echo "does anything committed under docs/media name a real person, address or rate?"

# ---- 1 · the needles, from the live database, never from this file ----------------------
needles=$(ssh "$HOST" 'sudo bash -euc "
  set -a; . /etc/nfc/env; set +a
  psql \"\$DATABASE_URL\" -At -c \"SELECT name FROM contacts WHERE name IS NOT NULL\"
  psql \"\$DATABASE_URL\" -At -c \"SELECT address FROM locations WHERE address IS NOT NULL\"
  psql \"\$DATABASE_URL\" -At -c \"SELECT email FROM contacts WHERE email IS NOT NULL\"
  psql \"\$DATABASE_URL\" -At -c \"SELECT phone FROM contacts WHERE phone IS NOT NULL\"
"' | sed '/^[[:space:]]*$/d')

# The contract value as a HUMAN reads it on the screen. The integer cents would never have
# matched: the leaked screenshot says „5.000,00 € pro Monat", not 500000. Formatted HERE, in
# de-AT, rather than in SQL — to_char's separators follow the SERVER locale, and a check that
# silently formats 500000 as "5,000.00" against a de-AT screenshot is a check that cannot
# fail. Measured: the first version of this line did exactly that and found only 2 of 3.
cents=$(ssh "$HOST" 'sudo bash -euc "
  set -a; . /etc/nfc/env; set +a
  psql \"\$DATABASE_URL\" -At -c \"SELECT monthly_contract_cents FROM locations WHERE monthly_contract_cents IS NOT NULL UNION SELECT monthly_contract_cents FROM location_contracts WHERE monthly_contract_cents IS NOT NULL\"
"' | sed '/^[[:space:]]*$/d')
# EVERY plausible rendering, not one. Node's de-AT groups with U+202F, the shipped bundle
# renders 5.000,00 with a full stop, and the two do not grep for each other. Measured: the
# de-AT-only version of this line read 3 needles and matched 2 — it missed the contract sum
# in the very file it was written for, and would have reported that file as clean once the
# name was redacted out of it.
euros=$(node -e '
  let s = "";
  process.stdin.on("data", (d) => (s += d)).on("end", () => {
    const out = new Set();
    for (const line of s.split("\n").map((x) => x.trim()).filter(Boolean)) {
      const v = Number(line) / 100;
      for (const loc of ["de-AT", "de-DE", "de-CH"]) {
        out.add(new Intl.NumberFormat(loc, { minimumFractionDigits: 2 }).format(v));
      }
    }
    for (const v of out) console.log(v);
  });
' <<< "$cents")
needles=$(printf '%s\n%s\n' "$needles" "$euros" | sed '/^[[:space:]]*$/d')

count=$(echo "$needles" | sed '/^$/d' | wc -l | tr -d ' ')
if [ "$count" = "0" ]; then
  bad "no needles came back from $HOST — this check would pass over anything, which is worse than no check"
  exit 1
fi
ok "$count real value(s) read from $HOST (names, addresses, contacts, contract sums) — none of them printed here"

# ---- 2 · the transcripts ----------------------------------------------------------------
texts=$(git ls-files 'docs/media/**/*.txt' 'docs/media/*.txt' || true)
if [ "$MUTATE" = "1" ]; then
  echo "  (mutant: the file this check was written for is restored from history and re-scanned)"
  mutant=$(mktemp -d)
  chmod 700 "$mutant"
  trap 'rm -rf "$mutant"' EXIT INT TERM
  # 2cc19b2 was the commit that added it, and TAKING IT FROM HISTORY IS THE POINT: the RED is
  # then the real bytes that were really committed, not a fabricated needle.
  #
  # *** THAT COMMIT NO LONGER EXISTS. *** The history containing it was rewritten (that was
  # the whole remediation), so `git show` fails — and with `|| true` swallowing it and an
  # empty file being scanned, THIS MUTANT PASSED GREEN and had been proving nothing since.
  # A check whose negative case cannot fail is not a check, and that applies to its mutant
  # too. So: try history, and if the blob is gone, FALL BACK to a needle read from production
  # in this same run and say which path was taken. Never silently.
  if git show 2cc19b2:docs/media/prove-live/02-building-created.txt > "$mutant/restored.txt" 2>/dev/null \
     && [ -s "$mutant/restored.txt" ]; then
    echo "  (the original blob, restored from history)"
  else
    # The needle is a REAL production value, so it goes in a 0700 temp directory OUTSIDE the
    # repo, is never echoed, and is deleted by the trap above. Writing it into the tree — even
    # briefly — would be the leak this file exists to prevent, one layer out.
    printf '%s\n' "$(printf '%s\n' "$needles" | sed '/^[[:space:]]*$/d' | head -1)" > "$mutant/restored.txt"
    chmod 600 "$mutant/restored.txt"
    [ -s "$mutant/restored.txt" ] || { echo "  FAIL: the mutant has NOTHING to scan — no historical blob and no needle"; exit 1; }
    echo "  (2cc19b2 is gone with the rewritten history — falling back to one live needle in a temp dir)"
  fi
  texts=$(printf '%s\n%s\n' "$texts" "$mutant/restored.txt")
fi

hits=0
while IFS= read -r needle; do
  [ -n "$needle" ] || continue
  # -F: a needle is data, never a pattern. An address with a '.' in it must not match a
  # different address.
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    [ -f "$f" ] || continue
    if grep -Fq -- "$needle" "$f" 2>/dev/null; then
      # The value is NOT echoed: printing it here would put it in the CI log and in every
      # terminal scrollback, which is the same failure one layer out.
      bad "$f contains a real value read from production (${#needle} characters, redacted)"
      hits=$((hits + 1))
    fi
  done <<< "$texts"
done <<< "$needles"
[ "$hits" = "0" ] && ok "no committed transcript under docs/media carries a value from the live database"

# ---- 3 · an image with no transcript cannot be cleared ----------------------------------
# Text in a PNG is painted, so no grep can read it. The only thing that can vouch for an
# image is the .txt of the same page from the same run. No sibling, no clearance.
orphans=0
while IFS= read -r png; do
  [ -n "$png" ] || continue
  sib="${png%.png}.txt"
  if ! git ls-files --error-unmatch "$sib" >/dev/null 2>&1; then
    orphans=$((orphans + 1))
    [ "$orphans" -le 5 ] && echo "        $png"
  fi
done <<< "$(git ls-files 'docs/media/prove-live/*.png' || true)"
if [ "$orphans" = "0" ]; then
  ok "every committed prove-live screenshot has a transcript this check can read"
else
  bad "$orphans prove-live screenshot(s) have no .txt sibling — nothing can vouch for what is painted in them"
fi

# ---- 4 · and the README no longer claims what nobody checked ---------------------------
#
# THREE STATES, AND THE THIRD ONE IS NOW THE REAL ONE. `docs/media` was later gitignored
# WHOLESALE and every file under it removed from the tree, so the README this arm was written
# to police does not exist — and the arm went RED over its absence, i.e. it failed the repo
# for having done the SAFER thing. That is a check disagreeing with its own purpose: the
# property is "no committed media asserts a safety claim nobody verified", and zero committed
# media satisfies it completely.
#
# The clearance is therefore conditional on there BEING committed media, and it is measured
# rather than assumed — `git ls-files docs/media`, the same source arms 2 and 3 grep. The
# moment one file comes back under docs/media, the README requirement comes back with it.
readme=docs/media/prove-live/README.md
tracked_media=$(git ls-files docs/media | wc -l | tr -d ' ')
if [ "$tracked_media" = "0" ]; then
  ok "docs/media is gitignored wholesale and nothing under it is tracked — there is no committed prose left to be false"
elif [ -f "$readme" ] && grep -q "check-media-pii" "$readme"; then
  ok "$readme points at this check instead of asserting the property in prose"
else
  bad "$tracked_media file(s) are tracked under docs/media but $readme does not point at this check — the last version of that sentence was false"
fi

echo
[ "$FAILED" = "0" ] && echo "CHECK-MEDIA-PII OK" || { echo "CHECK-MEDIA-PII FAILED"; exit 1; }
