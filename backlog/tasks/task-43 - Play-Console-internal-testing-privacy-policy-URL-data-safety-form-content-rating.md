---
id: TASK-43
title: >-
  Play Console internal testing: privacy policy URL, data safety form, content
  rating
status: To Do
assignee: []
created_date: '2026-08-04 17:58'
updated_date: '2026-08-04 17:59'
labels:
  - android
  - deploy
  - compliance
dependencies: []
priority: medium
ordinal: 43000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-27 puts Android on the internal testing track, which carries no tester gate. It does NOT waive the store listing prerequisites. android/README.md:577 records them: a privacy policy URL, the data safety form and a content rating are required for setup even on internal testing.

The privacy policy URL is the only one that is engineering work - a page has to exist and be publicly reachable. Checked live: /privacy, /datenschutz and /privacy-policy all return 404 on timesheets.exe.xyz.

BLOCKED ON THE OWNER for the console itself: the data safety form and content rating questionnaire are declarations made by the account holder, and they are legal statements about the app. An agent must not answer them on his behalf.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A privacy policy page is publicly reachable over HTTPS and returns 200
- [ ] #2 It is written in German, since that is the users' language (decision-8)
- [ ] #3 It describes what is ACTUALLY collected: name, Apple sub or enrolment code, shift times, location UUIDs, Sentry diagnostics
- [ ] #4 Data safety form submitted and consistent with that page
- [ ] #5 Content rating questionnaire completed
- [ ] #6 The app reaches the internal testing track and installs from it on a real device
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
TRIAGE 2026-08-04 (agent 2) — OPEN. Verified against the live host, not just the docs.

  curl -o /dev/null -w '%{http_code}' https://timesheets.exe.xyz/privacy         -> 404
  curl -o /dev/null -w '%{http_code}' https://timesheets.exe.xyz/datenschutz     -> 404
  curl -o /dev/null -w '%{http_code}' https://timesheets.exe.xyz/privacy-policy  -> 404

No privacy policy exists anywhere. Google requires a URL, so this is a real blocker rather than
paperwork - the form cannot be submitted without a page to point at.

SPLIT OF WORK, because only part of this is owner-blocked:
  AGENT CAN DO   - write and serve the page. The server already serves static routes (/t and the
                   well-known files), so this is a route and a document, not new infrastructure.
  OWNER MUST DO  - the data safety form and the content rating. Both are declarations by the
                   account holder about what the app does with personal data. Getting them wrong
                   is a compliance problem, not a bug, and an agent must not answer them for him.

WHAT THE PAGE HAS TO SAY, from the actual schema on the production VM (read-only inspection of
database 'nfc'): workers(name, apple_sub, enrolment code columns, hourly_rate_cents),
shifts(worker_id, location_id, start_time, end_time, client_uuid), sessions / worker_sessions,
plus Sentry diagnostics when a DSN is configured. That is employment and location-adjacent data
about identified individuals, so the page has to be accurate rather than boilerplate - GDPR
applies and these are Austrian employees.

Write it in German. decision-8 makes German the default language; a privacy notice the subjects
cannot read does not do the job the law expects of it.

SEQUENCING: this is downstream of proving NFC on physical Android hardware. Do not spend the
owner's console time until one real tag tap has worked on a real phone.
<!-- SECTION:NOTES:END -->
