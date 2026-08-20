/**
 * Client-side mirror of `identityPhone` in `server/lib/validate.js` (decision-45 §4). UX
 * preview only — the server is the actual boundary and the collision check is server-only,
 * structurally, forever (OPERATOR-MODEL.md §7, `POST /admin/operators`'s own comment).
 *
 * Ladder: needed at all — yes, a director typing a phone number should see what it will be
 * stored as before submitting, the same way `parseEuroToCents`/`centsToPlainEuros` preview a
 * rate. stdlib — none; the browser has no phone parser. Already-installed dependency — none;
 * a phone-parsing library is the first non-`pg`/`@sentry` dependency question and it belongs
 * on the SERVER side of a decision record, not smuggled in here as a web-only import. One
 * line — no: the whole point is that this function and `identityPhone` never disagree about
 * what is rejected, and `identityPhone` itself isn't one line for the same reason.
 *
 * ponytail: hand-rolled, AUSTRIA-DEFAULT E.164 normaliser, not a general phone parser. Same
 * ceiling as the server function it mirrors: a number typed with neither a leading 0 nor a +
 * is REJECTED, not guessed at. Upgrade path: identical to `identityPhone`'s — a shared
 * decision record the day a non-Austrian phone is a real requirement.
 *
 * The five steps below are the SAME five steps, in the same order, as
 * `server/lib/validate.js:identityPhone` — a mismatch on any worked example there is a bug
 * here, not a style difference.
 *
 * Worked examples (decision-45 §4):
 *   "0664 123 45 67"     -> "+436641234567"
 *   "+43 664/1234567"    -> "+436641234567"   (same identity as the line above)
 *   "0043 664 1234567"   -> "+436641234567"
 *   "01 5055904"         -> "+4315055904"     (Vienna landline; still an identity)
 *   "664 1234567"        -> null (no leading 0 or + — ambiguous, not Austrian)
 *   "Anna"                -> null (fails the character-class check)
 *   "+43664"              -> null (5 digits after +43, below the 8-digit floor)
 *   ""                    -> null (required)
 */
export function normaliseIdentityPhone(raw: string): string | null {
  if (raw.trim() === '') return null

  const stripped = raw.replace(/[\s\-/()]/g, '')
  // Only digits, with at most one leading "+", may survive the strip.
  if (!/^\+?[0-9]+$/.test(stripped)) return null

  let digits = stripped.startsWith('00') ? `+${stripped.slice(2)}` : stripped

  if (!digits.startsWith('+')) {
    if (digits.startsWith('0')) {
      digits = `+43${digits.slice(1)}`
    } else {
      // A bare national number with neither a leading 0 nor a +. Never silently assumed
      // Austrian — the ambiguity is the director's to resolve by typing a 0 or a +.
      return null
    }
  }

  if (!/^\+[1-9][0-9]{7,14}$/.test(digits)) return null
  return digits
}
