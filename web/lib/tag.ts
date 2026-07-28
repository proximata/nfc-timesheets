/**
 * The URI that gets written to a physical NFC tag.
 *
 * Exactly `https://<host>/t?l=<location uuid>` (decision-21, decision-5). The host has to be
 * the one in the app's Associated Domains and in the AASA file (decision-4), otherwise iOS
 * refuses to open the app and the worker sees a web page instead of a clock-in — a failure
 * that costs a site visit to fix. It is therefore NOT derived from `window.location`: the
 * admin panel can legitimately be opened on localhost during a build, and a tag written from
 * that page would be dead on the wall.
 */
const TAG_BASE_URL = (process.env.NEXT_PUBLIC_TAG_BASE_URL ?? 'https://timesheets.exe.xyz').replace(
  /\/+$/,
  '',
)

export function tagUri(locationId: string): string {
  return `${TAG_BASE_URL}/t?l=${encodeURIComponent(locationId)}`
}
