---
id: decision-40
title: >-
  The tag host is permanent and separate from the API host a hostname written
  onto a physical card is not a server name
date: '2026-08-19 11:38'
status: proposed
---
**PROPOSED. Not accepted. The owner accepts decisions.**

Amends decision-15 (which fixed the tag hostname at `timesheets.exe.xyz` and kept tags
unlocked as migration insurance) and decision-24 (which made `ops/branding.json` the single
source of operator identity). Relates to decision-4 (AASA on exe.xyz), decision-5 and
decision-21 (the tag URI carries the location UUID), decision-16 (one VM, no framework).
**Supersedes nothing.** It splits one field in `ops/branding.json` into two.

## Context

`ops/branding.json` had a single field, `host`, and its `_readme` described it as *"the tag
URI host … MUST be the host that actually serves the two well-known files … and MUST match
the app's Associated Domains entitlement"*. One value, three jobs: the string written onto
physical NFC cards, the origin of the association files, and the API the app calls.

That coupling has already cost a live tag.

In July the owner wrote a blank NTAG-class card with NFC Tools:

```
https://timesheets.exe.xyz/t?l=c3c37d4a-ca0a-42c5-b248-9704b9907ec7
```

It worked, passive tap included, and it was promised to a client. Later the VM was renamed
`timesheets` → `schimmer-glanz`, because the API box's name should say whose product it is.
The rename took one command and moved the server correctly. It also silently killed the
card: the hostname in its NDEF record no longer resolved, so Android could not fetch
`assetlinks.json` from it and stopped handing the tap to the app, and the app's own parser —
which compared against a single host — began answering "not one of ours" to a tag that was
never wrong.

Nothing errored. No log, no crash, no red check. The failure surfaces as a worker standing
at a door tapping a card that does nothing.

The asymmetry is the whole point:

- A **server** name is metadata. Renaming it is a keyboard operation and should stay one:
  the box is `schimmer-glanz` because the operator is Schimmer und Glanz, and if the company
  rebrands, or the box moves, or a second client needs their own, that must remain cheap.
- A **tag** name is not metadata. It is ink, on a card, screwed to a wall, in a building
  whose key someone has to borrow. Changing it costs a site visit **per building** and is
  only possible at all because decision-15 left the tags unlocked.

Tying the second to the first means every future rename of a server is a silent
re-invalidation of physical infrastructure. It happened once with one tag and one client. It
would happen again at the moment it is most expensive: with tags in many buildings.

Two further facts sharpen this. First, **App Link verification is all-or-nothing** across
the hosts named in an `autoVerify` intent-filter — one host that stops serving
`assetlinks.json` and Android marks the app unverified for *every* host in that filter. So
"just list both hosts" is not a fix; it makes a renameable host able to break the permanent
one. Second, the client onboards next week, so this is the last cheap moment: one card
exists, and it is one the owner can reach.

## Decision

**`ops/branding.json` carries two hosts, and they mean different things.**

| | `tagHost` | `apiHost` |
|---|---|---|
| today | `timesheets.exe.xyz` | `schimmer-glanz.exe.xyz` |
| serves | the two association files and `/t` — **nothing else** | admin panel, REST API, Postgres |
| written onto | **physical cards, on walls** | nothing |
| **renameable?** | **NO** | **yes, freely** |
| cost to move | a site visit **per building** | a redeploy |
| deployed by | `ops/tag-host/deploy.sh` | `ops/deploy.sh` |

**THE RULE: the tag host is written onto physical objects and is therefore permanent.**
Treat it as immutable. It has no database, no admin panel, no application code and no
credentials, so there is never an operational reason to rename it — which is exactly why it
is safe to promise that it will not be.

Four things follow, and they are binding:

1. **The app parses one host and talks to the other.** `TagLink` and the Android manifest
   intent filters use the tag host; `net/Api.kt` builds its base from `BuildConfig.API_HOST`.
   Before this, `Api.kt` read `BuildConfig.TAG_HOST` — that one line *was* the coupling.
2. **The API host must never appear in an `autoVerify` intent-filter.** It is renameable, and
   verification is all-or-nothing across the hosts in a filter.
3. **The admin panel prints the tag host, never the host it is being served from.**
   `web/lib/tag.ts` defaults to `https://<tagHost>`. Deriving it from `window.location` would
   make a tag written during a localhost session dead on arrival.
4. **Hosts we have already written onto cards live in `ts.legacyTagHosts`** — a *parser*
   widening only. It buys manual scan on such a card (the app never fetches the tag URL; it
   parses the uuid out and calls `apiHost`). It does not buy passive tap, and per rule 2 the
   answer to that is not the manifest.

**Collapsing them back is refused, not silently allowed.** A leftover `host` key is a hard
error in `readBranding` rather than a fallback, and `tagHost === apiHost` fails
`check-branding` unless the operator writes `"singleHost": true`. Two fields that quietly
happen to be equal is precisely how the old value survives a migration.

**The exe.dev proxy for the tag host must be PUBLIC.** exe.dev proxies are private by
default and answer an unauthenticated request with `401` plus a redirect to a login page.
Phones fetch association files with no credentials and no cookie jar, so a private proxy
means App Links and universal links **silently never verify**, on every phone. This was
observed red on `timesheets.exe.xyz` before `share set-public` and is asserted by
`server/wellknown/verify.sh`.

### If the tag host ever does move, every one of these changes together

Anything left behind is a dead tap, never an error.

| File / place | What it holds |
|---|---|
| `ops/branding.json` | `tagHost` — the source of truth |
| `android/branding.properties` | `ts.tagHost`, **and the old value appended to `ts.legacyTagHosts`** |
| `android/app/src/main/AndroidManifest.xml` | consumes `${tagHost}`; nothing to edit, but it is what breaks |
| `web/lib/tag.ts` | the default the admin panel prints onto cards |
| `NFCTimeSheets/NFCTimeSheets/NFCTimeSheets.entitlements` | the `applinks:` literal (hand-edited — a templated value expands to `applinks:` when undefined) |
| `NFCTimeSheets/Branding.xcconfig` | `TS_TAG_HOST` |
| `NFCTimeSheets/NFCTimeSheets/Branding.swift` | `defaultTagHost` |
| `ops/tag-host/nginx.conf` + `ops/tag-host/deploy.sh` | the box that serves the three files |
| exe.dev | the VM name, and `share set-public` on the new one |
| **every physical card, by hand** | the only step that is not a keyboard operation |

Gates: `node ops/check-branding.mjs`, `cd android && ./checks/run.sh` (it pins the exact URI
on the HOIV card as a *field fact*, deliberately not read from the file being checked), and
`./server/wellknown/verify.sh`.

### The tag host box

An exe.dev VM named `timesheets`, 1 vCPU / 2 GB (the platform floor), running the nginx that
is already installed in the exeuntu image. Three static files, one config file, no database,
no Node, no `node_modules`, no secrets, no TLS to renew (the exe.dev proxy terminates it), no
migrations. Updating it is an rsync and a reload.

nginx rather than thirty lines of our own Node: it is already on the box, security updates
arrive as an Ubuntu package, and there is no code of ours to maintain for five years. The
config uses exact-match locations with `absolute_redirect off` and an emptied `types { }` map
so the Content-Type is byte-exact and no path can ever redirect — the two ways this file
class dies.

### An exe.dev name is not owned by the company

`timesheets.exe.xyz` is permanent by *policy*, not by contract: it sits in someone else's
namespace, and if exe.dev disappears or reclaims it, no rule here helps. **A domain the
company actually owns is still the right long-term answer**, and moving to one will still be
a site visit per building. This decision is the cheap version of that: it costs one small VM
and removes the reason a rename would ever be *wanted*, which is the failure that has
actually happened. It does not remove the risk that the name is taken away.

## Consequences

**Good**

- The card already on the wall at HOIV works again — including passive tap — with no site
  visit. Reviving the host resurrected it.
- Renaming, moving or re-branding the API box is once again a keyboard operation with no
  physical consequence. That was the property the rename was supposed to have.
- The two failure domains are separated: a database outage, a bad migration or a rolled-back
  deploy on the API host cannot stop a phone from verifying App Links.
- The tag host has nothing worth attacking: no database, no credentials, no writable
  application code, and a 404 for every path it does not own.

**Costs and limits**

- One more VM to pay for and to remember exists. Mitigated by giving it nothing to maintain.
- One more deploy path (`ops/tag-host/deploy.sh`). `ops/deploy.sh` verifies the tag host but
  deliberately does not deploy or restart it: the boring box stays boring.
- **iOS is not migrated.** The entitlement, `Branding.xcconfig` and `Branding.swift` still
  name `schimmer-glanz.exe.xyz`. Universal links still work — the API host serves both
  association files with identical bytes — but iOS is associated with the renameable host,
  so renaming it would break iOS taps. `check-branding` asserts the three iOS files agree
  with each other and name a host this project actually serves, and prints the remaining
  move. Closing it needs an Xcode build, not a config edit.
- Any card written between the rename and this split carries `schimmer-glanz.exe.xyz`. Manual
  scan handles it via `ts.legacyTagHosts`; passive tap on such a card does not work and, per
  rule 2, will not be made to.
- The permanence promise is only as strong as exe.dev's namespace. See above.
