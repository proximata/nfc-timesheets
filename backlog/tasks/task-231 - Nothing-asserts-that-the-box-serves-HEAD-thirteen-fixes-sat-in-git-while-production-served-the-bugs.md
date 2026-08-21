---
id: TASK-231
title: >-
  Nothing asserts that the box serves HEAD: thirteen fixes sat in git while
  production served the bugs
status: Done
assignee: []
created_date: '2026-08-21 03:24'
updated_date: '2026-08-21 12:20'
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
SHIPPED in 782761e, and this verdict pass found it could NEVER GO GREEN. Both causes were
the check's own:

1. Its documented invocation was 'cd web && pnpm build'. ops/deploy.sh builds with
   NEXT_PUBLIC_DEFAULT_LOCALE=de and the Maps key; a keyless build moves four content-hashed
   chunks, so the check reported a difference it had created itself.
2. Next's build id is RANDOM and is embedded in all 133 emitted .html/.txt files, so the same
   commit built twice does not equal itself. web/next.config.mjs now derives it from the
   commit (generateBuildId), and the export is reproducible: two builds of one commit, 176
   files, identical sha (ec44b83821befee4...).

Also fixed, and both were the same shape as the bug the task exists for -- a gate that stops
early and says nothing:
  - 'find chunks css media' exits 1 when media/ is absent; under set -e -o pipefail the whole
    check exited 0 after ONE ok: line, and deploy.sh step 7c called it that way.
  - 'diff | head -20' killed the script on SIGPIPE, so under --mutate sections 2, 3, 3a and 4
    had never run. The mutant still exited 1, for the right reason, which is why nobody saw it.

New assertions:
  - section 1a hashes _next/static/chunks+css alone -- the half that means 'the fix is live'
    -- so it is never buried in a 176-line diff. PROVEN identical while section 1 was red.
  - section 3a reads the BUILD ID OFF THE BOX and asks git whether anything under web/ has
    changed since: 'built at 2358102a6244, and nothing under web/ has changed since'. That
    answers the task's question without a redeploy after every unrelated commit.

Live now: CHECK-BOX-SERVES-HEAD OK, and RED on both halves under --mutate.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Done, then repaired. Commits 782761e, 4ecd225, 2358102, c988d3c. First green run in its life, and falsifiable on both halves.
<!-- SECTION:FINAL_SUMMARY:END -->
