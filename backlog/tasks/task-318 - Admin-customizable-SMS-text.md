---
id: TASK-318
title: Admin-customizable SMS text
status: To Do
assignee: []
created_date: '2026-08-29 19:55'
labels:
  - 'for agent: clarify with operator'
dependencies: []
priority: medium
ordinal: 236000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
server/lib/sms.js hardcodes every message as a literal German template string - renderEnrolmentSms (Ihr Zugangscode/Anmeldecode lautet...) and the OTP message - with no admin-editable text anywhere. sms.js also deliberately restricts output to the GSM 03.38 basic charset (a documented invariant, since anything outside it silently doubles SMS segment cost/count) - any admin-free-text path must keep enforcing that, not bypass it.

Open questions for the operator before this is designed: customize per message type (enrolment code vs OTP) separately, or one shared template; fully free text, or fixed text with named placeholders only (name, code, expiry) so the code/expiry can never be typo-deleted from the message; German only, or does the admin edit per-locale text too; where does the admin edit it - a new settings page in web admin; what happens to messages already queued/sent under an old template if it changes mid-flight (nothing, presumably, but confirm).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Operator has confirmed: free text vs fixed placeholders, per-message-type vs shared template
- [ ] #2 GSM 03.38 charset enforcement confirmed as a hard constraint on whatever admin types, not optional
<!-- AC:END -->
