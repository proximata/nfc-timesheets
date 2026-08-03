# decision-27: Google Play account is PERSONAL, and Android ships on the internal testing track

status: accepted
date: 2026-08-03
supersedes: nothing
relates to: decision-24 (operator identity is configuration), decision-26 (enrolment codes)

## Decision

The Google Play developer account is a **personal** account ($25 once), not an organisation account.

The consequence people expect from that — the 12-tester / 14-day gate — **does not apply to us**,
because this app ships on the **internal testing track** and is not intended for public
distribution.

## Why personal, and why it costs nothing here

An organisation account is exempt from the closed-testing gate, but requires a **D-U-N-S number**
(free, up to 30 days from Dun & Bradstreet) plus payment verification. That is a month of waiting
to publish an internal tool to about a dozen cleaners.

The gate we avoided, from Google's own documentation:

| track | requirement to use it |
|---|---|
| **Internal testing** | **None.** |
| Closed testing | Must have finished setting up the app. |
| Production | A closed test with **12 testers opted in for 14 consecutive days** first. |

Source: support.google.com/googleplay/android-developer/answer/14151465

Internal testing takes **up to 100 testers**, added by Google account email. This company has
5–20 cleaners. The track that carries no requirement at all is larger than the workforce by a
factor of five, so the requirement we were worried about never binds.

Emulators and duplicate accounts do not count as testers, which is exactly why the 12/14 gate
would have been genuinely painful: it needs twelve real humans with real Google accounts holding
real devices, for two uninterrupted weeks, to distribute an app to a cleaning crew.

## What this means in practice

- Workers are added as internal testers by email and install from a Play link. No public listing.
- Because the app is never publicly listed, the personal account's **legal name, country and
  developer email are not put on a public store page**. Google displays those for published apps,
  and the **full address** additionally if the app monetises. We do neither.
- A privacy policy URL, the data safety form and a content rating are still required to set the
  app up, even for internal testing. The app collects worker identity and location-of-work data,
  so the data safety answers must be truthful — see the portal's GDPR reasoning in decision-25.
- The signing keystore is the owner's and must be backed up. Losing it means a new listing under
  a new package name, forever. `assetlinks.json` needs **both** SHA-256 fingerprints (upload key
  and Play App Signing key) or App Links stay unverified and every tag tap opens a browser.

## The ceiling, and the upgrade path

This holds only while the app serves **our own** workers.

The moment the product is sold to another cleaning company — which decision-24 (white-label
operator identity) exists to make possible — that operator's crew are not our internal testers,
and internal testing stops being the right track. At that point the options are:

1. Run the closed test properly: 12 testers, 14 consecutive days, then apply for production.
2. Move to an organisation account (start the D-U-N-S application *before* it is urgent, since it
   can take 30 days).

Account type cannot simply be flipped later; it means a new account and an app transfer. So if
selling the product is ever more than hypothetical, **start the D-U-N-S paperwork early** — it is
free, and having it and not needing it costs nothing.

## Cost of this decision

We have chosen the account type that is wrong for a company that sells software, on the grounds
that we are a cleaning company that uses software. That is the honest trade, and it is revisited
the first time someone asks to buy this.
