# Patch: Restore out-of-scope README.md to origin/dev

## Metadata
adwId: `ate77c-chore-comment-sweep`
reviewChangeRequest: ``Issue #1: Out-of-scope file changes committed by the plan orchestrator (commit e7c09c9b, 'sync README tree and drop stale rule') make the branch unmergeable. README.md carries a tree-sync edit that the spec explicitly says must not be staged, and it conflicts with origin/dev's own README edit (c3606f9e) on the .github/dependabot.yml description line: `git merge-tree --write-tree origin/dev HEAD` reports CONFLICT (content) in README.md. The same commit also modified .claude/commands/scenario_writer.md out of scope, but that file is now byte-identical to origin/dev and merges cleanly. The build-agent commit bdddf4b3 itself is in scope: it touches only 32 of the 37 listed files and nothing else. Resolution: Restore README.md to the default branch and commit: `git fetch origin dev && git checkout origin/dev -- README.md && git commit -m 'chore: restore out-of-scope README.md to origin/dev'`. A simulated merge with README.md restored (temporary index, no working-tree changes) merges into origin/dev with zero conflicts, so this single change unblocks the PR. No change is needed for .claude/commands/scenario_writer.md.``

## Issue Summary
**Original Spec:** specs/issue-881-adw-ate77c-chore-comment-sweep-sdlc_planner-comment-sweep-cost-types-guard-tests.md
**Issue:** The plan-orchestrator commit `e7c09c9b` ("sync README tree and drop stale rule") staged a README.md tree-sync edit that is outside the 37 Touched Files of issue #881. The spec's *Relevant Files* entry for README.md (L31) and task 9 (L320) both say README.md was already modified before the chore and must not be staged. Meanwhile origin/dev's `c3606f9e` independently added a `.github/dependabot.yml` line to the same README tree with different wording, so `git merge-tree --write-tree origin/dev HEAD` reports `CONFLICT (content): Merge conflict in README.md` and the PR cannot merge. The other out-of-scope path from that commit, `.claude/commands/scenario_writer.md`, is already byte-identical to origin/dev (`git diff origin/dev HEAD -- .claude/commands/scenario_writer.md` is empty) and needs nothing. The in-scope build-agent commit `bdddf4b3` touches only 32 of the 37 listed files and nothing else, so it stays as is.
**Solution:** Check out origin/dev's current README.md blob into this branch and commit only that file. Verified before writing this plan: a dangling simulation commit with README.md replaced by origin/dev's blob (built in a temporary index, working tree untouched) merges into origin/dev with `git merge-tree --write-tree` exit 0 and no conflicts. README.md is documentation only; no test, guard, or step definition reads the repository's README.md (the `docsIndexHealth` tests use fixture path lists), and every spec validation command already passes on the branch, so the change is docs-only and carries no regression surface. Follow the same shape as the #880 precedent on origin/dev (`31a26112 patch: restore README.md to origin/dev content`).

## Files to Modify
Use these files to implement the patch:

- `README.md` — replace this branch's copy with origin/dev's copy (a 9-line diff against HEAD: 5 insertions, 4 deletions, all inside the feature bullets and the repository tree listing). No other file changes. Do not edit `.claude/commands/scenario_writer.md`; it already matches origin/dev.

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Refresh origin/dev and confirm the conflict is still present
- Run `git fetch origin dev` so `origin/dev` is current.
- Run `git status --short` and confirm the working tree is clean apart from this patch spec under `specs/patch/`. Do not stash anything.
- Run `git merge-tree --write-tree origin/dev HEAD`; it must exit 1 and print `CONFLICT (content): Merge conflict in README.md`. If it already exits 0 with README.md absent from `git diff --name-only origin/dev HEAD`, the restore has already landed: skip to Step 4.

### Step 2: Restore README.md to origin/dev's content
- Run `git checkout origin/dev -- README.md`. This writes origin/dev's blob to the working tree and stages it.
- Run `git diff --quiet origin/dev -- README.md`; it must exit 0 (README.md now matches origin/dev byte for byte).
- Run `git diff --cached --name-only`; it must print exactly `README.md`. Do not run `git add -A` or `git add .`: the patch spec in `specs/patch/` must stay uncommitted so the orchestrator's `review-patch-agent` commit picks it up afterwards, as in the #880 precedent.

### Step 3: Commit only README.md
- Run `git commit -m 'chore: restore out-of-scope README.md to origin/dev'`, ending the message with the `Co-Authored-By` trailer your session's attribution guidance prescribes (pass it as a second `-m`).
- Run `git show --stat --format='%h %s' HEAD`; it must list README.md alone, with `1 file changed, 5 insertions(+), 4 deletions(-)`.
- Do not push. The orchestrator's `executeReviewPatchCycle` commits the remaining patch spec and pushes the branch.

### Step 4: Confirm the branch now merges cleanly into origin/dev
- Run `git merge-tree --write-tree origin/dev HEAD`; it must exit 0 and print a single tree OID with no `CONFLICT` line.
- Run `git diff --name-only origin/dev HEAD`; README.md and `.claude/commands/scenario_writer.md` must be absent. Every remaining path must be one of the spec's 37 Touched Files or the issue spec `specs/issue-881-adw-ate77c-chore-comment-sweep-sdlc_planner-comment-sweep-cost-types-guard-tests.md`.

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `git diff --quiet origin/dev -- README.md .claude/commands/scenario_writer.md && git merge-tree --write-tree origin/dev HEAD`
  - Must exit 0 and print only a tree OID: both out-of-scope files match origin/dev and the simulated merge has no conflicts.
- `xargs bun run lint:comment-only < /tmp/881files.txt`
  - The comment-only guard over all 37 Touched Files against `origin/dev`. Must print `✔ PASS` and exit 0. If `/tmp/881files.txt` is missing, recreate it from the spec's *Touched files* list (37 paths, one per line) before running.
- `bun run lint`
  - ESLint. Must report no errors.
- `bunx tsc --noEmit && bunx tsc --noEmit -p adws/tsconfig.json`
  - Both type checks from the spec (`bun run test` is an alias for the first). Must exit 0.
- `bun run test:unit && bun run lint:git-guard && bun run build`
  - Vitest, the git/gh guard (must still print `✔ PASS`), and the build. All must exit 0. Baseline before this patch: 145 test files and 2321 tests passing, guard PASS, build clean.

## Patch Scope
**Lines of code to change:** 0 code lines. README.md only: a 9-line documentation diff (5 insertions, 4 deletions) that makes the file identical to origin/dev.
**Risk level:** low
**Testing required:** Re-run the spec's validation commands to prove no regression, plus the `git merge-tree --write-tree origin/dev HEAD` check to prove the PR is mergeable again. README.md is not read by any test, guard, or step definition, so the spec suite is unaffected by the restore.
