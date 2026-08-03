// Turning a Vienna street address into a map pin, ONCE, server-side.
//
// THE ONE RULE: THIS MUST NEVER BLOCK SAVING A BUILDING. No key configured, an exhausted
// quota, a DNS failure, a slow response, an address Google has never heard of — every one
// of those ends with lat/lng NULL and the building created anyway. A building without a
// pin is fine; a building you cannot save because Google was down is not. Same rule as
// decision-23 gives telemetry: it may never be on the critical path.
//
// THE SECOND RULE: THE KEY NEVER LEAVES THIS FILE. It is read from process.env
// (/etc/nfc/env on the VM, runbook §5) and is NOT in ops/branding.json — decision-24 §9
// draws that line: branding.json is operator identity and is committed, a credential is
// neither. The key goes into the request URL, so no URL, no fetch error message and no
// response body may ever reach a log, a Sentry event or a client. Everything that leaves
// this file goes through `reason()`, which emits a fixed vocabulary and nothing else.
//
// ponytail: `fetch` is node stdlib (ladder step 2), so this adds NO dependency —
// server deps stay pg + @sentry/node exactly (decision-16 as amended by decision-23).
// CEILING: no retry, no backoff, no result cache. A transient failure means the admin
// presses "erneut geokodieren". UPGRADE PATH: a retry-with-jitter wrapper here, or the
// Places API if free-text addresses start missing.
import * as Sentry from "@sentry/node";

const GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";
const STREETVIEW_URL = "https://maps.googleapis.com/maps/api/streetview/metadata";

// SEPARATE budgets, not one shared deadline.
//
// A shared 5s budget was the first version and it was measured wrong: on an ordinary slow
// afternoon `curl` to this endpoint took 2.3s and node's `fetch` 5.8s, so every building
// came back unpinned and needed a human to notice and press retry. A save that takes eight
// seconds is annoying; a map that is quietly empty is a feature nobody trusts.
//
// The Street View call gets a short leash of its own because its failure costs nothing —
// the pin is already worth having without knowing whether there is a photograph.
//
// Worst case on the admin form is therefore GEOCODE + STREETVIEW. ponytail: this is an
// admin form save, not the clock-in path. CEILING: 11 seconds of spinner on a bad day.
// UPGRADE PATH: return 201 first and geocode on a queue — which needs a queue, a retry
// policy and a way to tell the panel the row changed underneath it.
const GEOCODE_TIMEOUT_MS = 8000;
const STREETVIEW_TIMEOUT_MS = 4000;

// Austria. `region` biases the results, `components=country:AT` constrains them: without
// it "Hauptstraße 1" is a real address in about forty countries and the pin lands in one
// of them. ponytail: hardcoded to AT because this is a Vienna cleaning company. CEILING:
// an operator in another country gets no results. UPGRADE PATH: a `geocode_region` key in
// app_settings, read by the caller and passed in.
const COUNTRY = "AT";

/**
 * Never let a Google URL, a key or a raw response body become a log line. Errors from
 * `fetch` are `TypeError: fetch failed` with the detail in `cause`, and an HTTP error
 * body from Google can echo the request back. Only the words below ever escape.
 */
function reason(err) {
  if (err?.name === "TimeoutError" || err?.name === "AbortError") return "timeout";
  const code = err?.cause?.code;
  if (typeof code === "string") return `network:${code}`;
  if (err?.name === "TypeError") return "network";
  return "unknown";
}

async function getJson(url, signal) {
  const res = await fetch(url, { signal, headers: { accept: "application/json" } });
  if (!res.ok) {
    // Status only. The body may quote the request, and the request holds the key.
    const err = new Error(`http_${res.status}`);
    err.httpStatus = res.status;
    throw err;
  }
  return res.json();
}

/** No pin, and the reason why. Shape-identical to a success so callers never branch on null. */
const noPin = (status) => ({ status, lat: null, lng: null, street_view_status: null });

/**
 * Look an address up. NEVER THROWS, ALWAYS ANSWERS.
 *
 * @returns {Promise<{status: string, lat: number|null, lng: number|null, street_view_status: string|null}>}
 *   `status` is stored on the row (locations.geocode_status). It is the difference between
 *   "fix the address you typed" and "try again later" — two things the admin must act on
 *   differently and cannot tell apart if both render as an empty map.
 */
export async function geocodeAddress(address) {
  const key = process.env.GOOGLE_GEOCODING_KEY;
  if (typeof address !== "string" || address.trim() === "") return noPin("no_address");
  // Not an error and not captured: running without a Maps key is a SUPPORTED
  // configuration. Reporting it as a fault would page someone every time a building is
  // added on a box that was never given a key.
  if (!key || String(key).trim() === "") return noPin("no_key");

  try {
    const params = new URLSearchParams({
      address: address.trim(),
      region: COUNTRY.toLowerCase(),
      components: `country:${COUNTRY}`,
      key,
    });
    const geo = await getJson(`${GEOCODE_URL}?${params}`, AbortSignal.timeout(GEOCODE_TIMEOUT_MS));

    // OVER_QUERY_LIMIT / REQUEST_DENIED / INVALID_REQUEST arrive as HTTP 200 with a status
    // field. Treated exactly like a network failure: no pin, building saved. Google's
    // status vocabulary is fixed and public, so echoing it carries nothing sensitive.
    if (geo?.status !== "OK" || !Array.isArray(geo.results) || geo.results.length === 0) {
      const status = typeof geo?.status === "string" ? geo.status : "malformed";
      // ZERO_RESULTS is a fact about the address the director typed, not a fault of ours,
      // so it is not captured. Everything else is worth knowing about.
      if (status !== "ZERO_RESULTS") {
        Sentry.captureException(new Error("geocode rejected"), { tags: { "ts.geocode.status": status } });
      }
      return noPin(status);
    }

    const best = geo.results[0];

    // THE LIE THIS GUARD EXISTS TO PREVENT, measured against the live key:
    //   "Nirgendwogasse 99999, 1010 Wien" -> status OK, partial_match: true,
    //                                        types ['postal_code'], APPROXIMATE,
    //                                        48.2083 / 16.3739 — the middle of the 1st district
    //   "Quatsch Quatsch Quatsch"         -> status OK, partial_match: true,
    //                                        types ['country'] — a pin in the middle of Austria
    // Both are HTTP 200 with status OK. Without this guard a typo would have put a
    // confident marker on the map and nothing on the screen would have said it was a guess.
    // `partial_match` means "we did not find what you asked for"; APPROXIMATE means "this
    // is a district, a city or a country". Neither is a building, so neither becomes a pin.
    if (best?.partial_match === true) return noPin("PARTIAL_MATCH");
    if (best?.geometry?.location_type === "APPROXIMATE") return noPin("APPROXIMATE_ONLY");

    const loc = best?.geometry?.location;
    const lat = Number(loc?.lat);
    const lng = Number(loc?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      Sentry.captureException(new Error("geocode returned no usable coordinate"));
      return noPin("malformed");
    }

    return { status: "OK", lat, lng, street_view_status: await streetViewStatus(lat, lng, key) };
  } catch (err) {
    const why = reason(err);
    Sentry.captureException(new Error("geocode failed"), { tags: { "ts.geocode.reason": why } });
    return noPin(why);
  }
}

/**
 * Does Street View actually have imagery here? The METADATA endpoint is free and is the
 * only honest answer — the image endpoint serves a grey "Sorry, we have no imagery here"
 * JPEG with HTTP 200, so a UI that just renders the image and hopes will ship a grey box
 * and call it a photograph of the building.
 *
 * A failure here costs nothing — the pin is already worth having without knowing whether
 * there is a photograph — but it still returns the REASON rather than null, in the same
 * vocabulary as `geocode_status`. Measured: this endpoint answers
 * `REQUEST_DENIED / "This API key is not authorized to use this service"` unless the Street
 * View Static API is enabled for the key, and it takes ~3.7s to say so. Swallowing that as
 * null would leave every building looking like "no imagery here" when the real answer is
 * "switch the API on in the Cloud Console".
 *
 * The consumer rule stays: render a photo ONLY when this is exactly 'OK'.
 */
async function streetViewStatus(lat, lng, key) {
  try {
    const params = new URLSearchParams({ location: `${lat},${lng}`, key });
    const meta = await getJson(`${STREETVIEW_URL}?${params}`, AbortSignal.timeout(STREETVIEW_TIMEOUT_MS));
    return typeof meta?.status === "string" ? meta.status : "malformed";
  } catch (err) {
    const why = reason(err);
    Sentry.captureException(new Error("street view metadata failed"), { tags: { "ts.geocode.reason": why } });
    return why;
  }
}

// ---- test seam --------------------------------------------------------------------
// Same pattern as lib/apple.js `setKeyFetcherForTest`, and for the same reason: a
// self-check that needs the internet is a self-check that fails on a train, and one that
// depends on Google's uptime reports their outage as our bug. check-api.js injects a
// geocoder that succeeds, one that throws and one that hangs, and asserts the building is
// created in all three cases.
let impl = geocodeAddress;

export function setGeocoderForTest(fn) {
  impl = fn ?? geocodeAddress;
}

/**
 * The call site. Always this, never `geocodeAddress` directly.
 *
 * The try/catch is belt-and-braces on top of geocodeAddress's own: this function is what
 * routes/admin.js awaits inside a create, and "a building you cannot save" is the one
 * outcome that is not allowed. A future refactor that lets an exception escape the
 * implementation must not be able to turn that into a 500 on the buildings form.
 */
export async function geocode(address) {
  try {
    return (await impl(address)) ?? noPin("malformed");
  } catch (err) {
    Sentry.captureException(new Error("geocode escaped its own error handling"), {
      tags: { "ts.geocode.reason": reason(err) },
    });
    return noPin(reason(err));
  }
}
