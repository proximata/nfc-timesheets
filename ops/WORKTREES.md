# Overlapping workflow runs: one worktree per run (TASK-210)

## Why

Two workflow runs sharing one working tree already did real damage, same night, on this
tree:

- one run's LIVE UNCOMMITTED mutant (`t(revenueUnknown) -> money(0)`, a decision-42
  violation) sat in `web/app/pl/page.tsx` while a second run's data probe was reading the
  same file. A `git add -A` in that minute would have shipped it.
- three files staged by one run went out inside another run's commit (`6757082`), under
  a commit message that described neither of them. Caught after the fact at `9d99966`.
- a headless Chrome and a `node server.js` were left orphaned on the two fixed ports the
  probes use (`:9341`, `:8080`). The next run's `launchChrome()` polled `/json/version`,
  attached to the ORPHAN, and died with "Error: Promise was collected" — a false green,
  not a crash.

`AGENTS.md` already says "never `git add -A`". That is necessary and not sufficient:
staging a path stages a path, but `git commit` without a pathspec commits the WHOLE
shared index — everything anyone has staged, not just what you meant to commit.

## Rule

Before launching a `workflow` run whose agents will EDIT files (not a read-only
research/report run), give it its own worktree:

```
git worktree add ../cleaning-timesheets-<run-name> HEAD
cd ../cleaning-timesheets-<run-name>
# point the run's agents at THIS directory (absolute paths), not the main tree
```

Merge back once the run's own Verify phase reports success:

```
cd ../cleaning-timesheets                 # the main tree
git merge --no-ff <run's-branch-or-commits>
git worktree remove ../cleaning-timesheets-<run-name>
```

Fixed ports (Chrome `:9341`, dev server `:8080`) are the same problem in a different
resource — a worktree does not fix them by itself. Either free the port on exit
(`demo/build-guard.mjs`'s `assertFreshServer` exists for exactly this) or have the second
run claim a different one.

## Fallback, when a worktree is overkill

For a short, single-purpose run (a doc edit, a one-file fix) a worktree is more ceremony
than the run is worth. Use this instead:

```
git commit -o <path> [<path> ...]        # --only also works
```

This commits EXACTLY the named paths and ignores whatever else is staged in the shared
index, even from another run's in-flight `git add`. It does not protect against reading a
half-written file mid-edit — only a worktree does that — but it closes the specific hole
that put three unrelated files inside commit `6757082`.

Never `git add -A` regardless of which of the two you use (see `AGENTS.md`). Staging
everything is not, by itself, the danger — `commit` without a pathspec against a tree
someone else is also writing to is.
