---
id: TASK-231
title: >-
  Nothing asserts that the box serves HEAD: thirteen fixes sat in git while
  production served the bugs
status: Done
assignee: []
created_date: '2026-08-21 03:24'
updated_date: '2026-08-21 13:04'
labels:
  - ops
  - deploy
dependencies: []
priority: high
ordinal: 149000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
THE MEASUREMENT. On 2026-08-21 a fix run produced thirteen commits, seven of which were the WRONG findings in backlog/docs/LOOK.md, and deployed none of them.

  /srv/nfc/public   last written   2026-08-21 00:16 UTC  (= 02:16 Vienna)
  web/ fixes        committed      04:19 - 04:57 Vienna

Eight files under web/ — every WRONG finding, the phone nav strip, the /tags/ link — were in git and not on the box the director opens. The run's own report said 'production touched only for TASK-206', which was true and was the problem. The verdict pass deployed them.

WHY NOTHING CAUGHT IT. ops/smoke-live.sh and ops/prove-live.sh drive the HTTP surface and pass perfectly against a STALE bundle: they assert behaviour the old build also had. web && pnpm verify checks the tree, not the box. There is no artefact id, no build stamp and no deployed-sha marker anywhere (`cat /srv/nfc/DEPLOYED_SHA` -> none), so 'is production running this tree' is currently answered by reading mtimes over ssh.

THE TRAP THIS MUST AVOID, because the verdict pass fell into it for ten minutes: you cannot answer this by grepping the served CSS for a source line. The minifier folds the phone fix's `grid-template-rows: auto auto minmax(0,1fr) auto` into the `grid-template` shorthand, so a grep for the fixed line comes back EMPTY on a box that HAS the fix. Compare BYTES, not text.

WHAT TO BUILD: ops/check-deployed.sh, run at the end of ops/deploy.sh and callable alone.
- build web/out locally (or require it fresh), then for every file in web/out/_next/static/chunks/*.css and the top-level *.html, compare sha256 against the same path fetched over https from apiHost. Any mismatch or 404 is a failure that names the file.
- write /srv/nfc/DEPLOYED_SHA (git rev-parse HEAD + `git status --porcelain` emptiness) during deploy, and have the check read it back over ssh and compare to the local HEAD, reporting DIRTY when the tree had uncommitted changes at deploy time.
- ops/smoke-live.sh calls it first and refuses to report OK against a bundle that is not this tree.

ACCEPTANCE, and it must be shown RED before it is believed:
- with the box deliberately one commit behind (deploy, then commit a one-character change to a web/ file and rebuild), the check FAILS and names the differing chunk. Restore by deploying.
- with the box current, it passes.
- no new dependency: curl, shasum, ssh. The check must not need a browser.

NOT IN SCOPE: rollback, build ids, CI. decision-16 stands — this is four shasums, not a pipeline.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
EARNED ITS KEEP ON THE VERY NEXT RUN. The verdict pass 2026-08-21 found the box serving a bundle built at 2358102a6244 while HEAD was 64f6f3f. § 3a correctly reported that nothing under web/ had changed between the two, so nothing was actually stale — which is exactly the distinction the earlier three incidents lacked an instrument for. Deployed anyway; the box now hashes identical to this tree file for file, including the APK. Both --mutate paths still red.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Done, then repaired. Commits 782761e, 4ecd225, 2358102, c988d3c. First green run in its life, and falsifiable on both halves.
<!-- SECTION:FINAL_SUMMARY:END -->
