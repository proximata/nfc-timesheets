/**
 * The URI that gets written to a physical NFC tag.
 *
 * Exactly `https://<host>/t?l=<location uuid>` (decision-21, decision-5). The host has to be
 * the one in the app's Associated Domains and in the AASA file (decision-4), otherwise iOS
 * refuses to open the app and the worker sees a web page instead of a clock-in — a failure
 * that costs a site visit to fix. It is therefore NOT derived from `window.location`: the
 * admin panel can legitimately be opened on localhost during a build, and a tag written from
 * that page would be dead on the wall.
 *
 * The default below is the operator's tag host and its source of truth is `ops/branding.json`.
 * It is repeated here rather than imported because this string is baked into a static export
 * at build time and `web/` must stay buildable on its own; `node ops/check-branding.mjs`
 * fails if the two ever disagree.
 */
const TAG_BASE_URL = (
  process.env.NEXT_PUBLIC_TAG_BASE_URL ?? 'https://schimmer-glanz.exe.xyz'
).replace(/\/+$/, '')

export function tagUri(locationId: string): string {
  return `${TAG_BASE_URL}/t?l=${encodeURIComponent(locationId)}`
}
