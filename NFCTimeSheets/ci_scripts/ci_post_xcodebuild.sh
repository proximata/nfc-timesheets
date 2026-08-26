#!/bin/sh
# ci_post_xcodebuild.sh — Xcode Cloud custom build script.
#
# INTENTIONALLY EMPTY. This hook used to carry ~150 lines of curl+openssl calling the App
# Store Connect API to auto-add each new archive to the TestFlight "me" internal group
# (Xcode Cloud builds are never added to a group automatically — Apple's own docs say so).
# That approach is structurally impossible from THIS hook: ci_post_xcodebuild runs before
# Xcode Cloud's own "Prepare Build for App Store Connect" step, i.e. before the archive it's
# trying to distribute has even been uploaded — the build does not exist in the API yet. A
# real build (37) proved this the hard way: a polling loop here ran until Xcode Cloud's own
# ~15 minute step timeout killed it, failing that entire archive and keeping that commit's
# code out of TestFlight altogether.
#
# THE REAL FIX (live since 2026-08-26): an App Store Connect Webhook (Users and Access >
# Integrations > Webhooks, event "TestFlight Build Status") POSTs to this project's own
# server at /webhooks/appstoreconnect once Apple finishes processing a build — i.e. from
# OUTSIDE this pipeline, after the deadlock window this hook could never get past. See
# server/routes/webhooks.js (HMAC-SHA256 signature verification against ASC_WEBHOOK_SECRET)
# and server/lib/appstoreconnect.js (the same JWT-signed API calls, minus the poll loop,
# since the webhook only fires once a build is already VALID).
#
# Nothing to do here. Kept only so a future workflow edit has an obvious place to look and
# an obvious reason not to put polling logic back in it.
exit 0
