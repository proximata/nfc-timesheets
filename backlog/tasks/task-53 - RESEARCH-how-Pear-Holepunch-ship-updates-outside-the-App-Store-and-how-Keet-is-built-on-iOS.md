---
id: TASK-53
title: >-
  RESEARCH: how Pear/Holepunch ship updates outside the App Store, and how Keet
  is built on iOS
status: To Do
assignee: []
created_date: '2026-08-11 23:04'
labels:
  - research
  - ios
  - distribution
dependencies: []
priority: low
ordinal: 53000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
RESEARCH ONLY - no code, no shipping change. Companion to TASK-52: that one asks what the rules allow, this one studies somebody who appears to have solved it in production.

WHO. Pear (pears.com) and Keet, from Holepunch. Keet is a P2P messenger whose runtime is explicitly built around apps that update themselves peer-to-peer, which is exactly the mechanism TASK-52 asks whether we can have. If anyone has walked this path through App Review, it is them.

QUESTION ONE - THE UPDATE MECHANISM. How does a Pear application receive a new version
without an App Store release? Expected shape, to be confirmed rather than assumed: a native
shell hosting a JS runtime (Bare), with the application itself distributed as JS over
Hypercore, so what updates is interpreted code and never a new binary - which would place
it inside the 2.5.2 interpreted-code gap. CONFIRM OR REFUTE THIS. Establish specifically:
  - what is baked into the reviewed binary versus what arrives afterwards
  - whether the iOS build is meaningfully self-updating or only the desktop build is (this
    is the most likely place the neat story falls apart, and the answer that matters most
    to us)
  - how they present it to App Review, if that is publicly discoverable

QUESTION TWO - WHAT IS ACTUALLY OPEN. Start here, because it is free and may answer
everything: Hypercore, Hyperswarm, Bare and much of the Pear runtime are public. Read the
source before touching a packet. State plainly which parts of KEET ITSELF are open and
which are not - the answer determines whether question three is needed at all.

QUESTION THREE - only if the source does not answer it. A plan for observing the shipped
app's behaviour, written BEFORE any tool is run:
  - static first, and non-invasive: the IPA's Info.plist, entitlements, embedded
    frameworks, whether a JS bundle is present, code signature and what the App Store
    listing and release notes reveal about cadence (a native app that fixes bugs without a
    version bump is itself evidence).
  - network observation with the honest caveat stated UP FRONT: Keet is P2P and Noise-
    encrypted over Hyperswarm, so a TLS proxy will show little or nothing. Do not plan a
    fortnight of mitmproxy around an assumption that it will yield anything - decide first
    whether DNS, connection metadata and payload sizes could even answer the question.
  - dynamic instrumentation is the expensive tier and needs the same test: what specific
    question would it answer that the source and the IPA cannot.
  - BOUNDARIES, non-negotiable: our own devices and our own accounts, publicly available
    binaries, no circumventing protections, no touching other users' data. Study how their
    published system works; do not attack it. If a question can only be answered by
    crossing that line, the answer is that we ask them - Holepunch are unusually open and a
    direct question may cost one message and beat weeks of inference.

DELIVERABLE: a document answering 'can an app on iOS legitimately update itself, and how do
these people do it', with each claim marked as source-read, observed, or inferred. The
distinction is the entire value - an inferred mechanism presented as fact is how we would
end up designing against a story we made up.
<!-- SECTION:DESCRIPTION:END -->
