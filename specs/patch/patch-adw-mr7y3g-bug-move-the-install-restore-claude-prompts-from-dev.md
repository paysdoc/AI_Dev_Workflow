# Patch: Restore the eleven `.claude/` prompt files that plan commit `3031342b` reverted to the runner's stale `main`

## Metadata
adwId: `mr7y3g-bug-move-the-install`
reviewChangeRequest: `` Issue #1: Plan commit 3031342b committed older copies of 11 framework files that the plan does not name: .claude/commands/{adw_init,clean_local_repo,document,feature,generate_step_definitions,resolve_conflict,resolve_failed_test,review,scenario_writer}.md and .claude/skills/{depaudit-triage,implement-tdd}/SKILL.md. Their contents match blobs from before dev's latest prompt changes, so merging this PR would roll those changes back on dev. Examples: review.md loses Step 4 (the step-definition independence check); clean_local_repo.md goes back to deleting every branch except main and develop, which in this repo includes `dev`; resolve_failed_test.md goes back to diffing against origin/main; implement-tdd goes back to reading `.adw/project.md` instead of the `.github/adw.yml` unitTests gate. The committed tree fails 5 unit tests. adws/__tests__/adwInitPrompt.test.ts fails 2 because the .github/adw.yml heredoc and the Comments entry are missing. adws/__tests__/depauditTriageSkill.test.ts fails 3 because the skill names /adw_sdlc and lacks the adw:bug label calls. This was confirmed by running both files against an extracted copy of HEAD. The local `bun run test:unit` passes only because the working tree has uncommitted restorations of adw_init.md and depaudit-triage/SKILL.md. The spec's `git status --porcelain` check, which allows only the files the plan names, also fails. Earlier patches on dev (e.g. 6b14a893 'restore .claude prompts to origin/dev') fixed the same plan-commit leak.
Resolution: Restore the 11 files to dev's versions and commit: `git checkout origin/dev -- .claude/commands/adw_init.md .claude/commands/clean_local_repo.md .claude/commands/document.md .claude/commands/feature.md .claude/commands/generate_step_definitions.md .claude/commands/resolve_conflict.md .claude/commands/resolve_failed_test.md .claude/commands/review.md .claude/commands/scenario_writer.md .claude/skills/depaudit-triage/SKILL.md .claude/skills/implement-tdd/SKILL.md`. Then confirm that `git diff origin/dev --stat -- .claude/` is empty, and that adws/__tests__/adwInitPrompt.test.ts and adws/__tests__/depauditTriageSkill.test.ts pass with a clean working tree. ``

## Issue Summary
**Original Spec:** `specs/issue-965-adw-mr7y3g-bug-move-the-install-sdlc_planner-phase-harness-surface-rows-migration.md`

**Issue:** Plan commit `3031342b` (`HEAD~2`) is the only commit on the branch that touches `.claude/`. It modifies eleven prompt and skill files that the spec never names, and adds or deletes none. Each committed copy is byte-identical to `main` at `3d43b81a`, which is the checkout the ADW runner runs from. `origin/dev` is the merge base `d96d7c72`, so merging would replace dev's prompts with main's older copies. Planning confirmed every effect the review lists:
- **The pinned prompt tests fail on the committed tree.** In a throwaway export of `HEAD`, 5 of the 6 tests in `adws/__tests__/adwInitPrompt.test.ts` and `adws/__tests__/depauditTriageSkill.test.ts` fail. Only `routes adw:bug to the full SDLC orchestrator` passes. The build's own unit runs failed on exactly these two files: `/tmp/adw-965-unit.before` (`2 failed | 209 passed (211)`) and `/tmp/adw-965-unit.after` (`2 failed | 210 passed (212)`). The review's run in the worktree passes (212 files, 3313 tests) only because `adw_init.md` and `depaudit-triage/SKILL.md` are restored there but not staged.
- **Dev's text is missing from the committed copies.** Counts are dev → committed:
  - `review.md`: `## Step 4: Step Definition Independence Check`, at line 47 on dev, is gone.
  - `clean_local_repo.md:12`: deletes every branch `except main and develop`, which includes `dev`. Dev keeps the default branch, read from `git remote show origin`, and the current branch.
  - `resolve_failed_test.md:16`: diffs against `origin/main` instead of `origin/<defaultBranch>`.
  - `implement-tdd/SKILL.md:65`: reads the `## Unit Tests` section of `.adw/project.md` instead of the `unitTests` key of `.github/adw.yml`. Mentions of `.github/adw.yml`: 1 → 0 here, and 2 → 0 in `feature.md`.
  - `adw_init.md`: `adw.yml` 9 → 0, and the `- **Comments** —` guideline entry 1 → 0.
  - `depaudit-triage/SKILL.md`: `/adw_*` commands 0 → 3, and `--label adw:bug` 1 → 0.
  - Dev's changes to `/document`, `/generate_step_definitions`, `/resolve_conflict` and `/scenario_writer` would be lost too.
- **The branch-name guard fails, so CI fails too.** The review does not name this check, but its `clean_local_repo` and `resolve_failed_test` examples are what `bun run lint:branch-names` looks for. On the committed tree it exits 1 with 8 violations: `clean_local_repo.md:12`, `document.md:6`, `:17`, `:18`, `:19`, `resolve_conflict.md:12`, `resolve_failed_test.md:16` and `review.md:17`. The `branch-names` job of `.github/workflows/git-cli-guard.yml` (`:42-57`) runs this guard on every pull request.
- **The spec's `git status --porcelain` check fails**, because of the two unstaged restorations.

**Solution:** Run the review's `git checkout origin/dev` of the eleven files, then commit only those paths on top of `HEAD`. No history rewrite is needed.
- `origin/dev` is the merge base `d96d7c72`, and dev has not changed `.claude/` since. So the checkout returns each file to the content the branch started from, and the pull request carries no `.claude/` change.
- **Measured in advance** on a throwaway export of `HEAD` with `origin/dev`'s `.claude/` on top:
  - both pinned test files pass, 6 of 6;
  - the branch-name guard prints `✔ PASS  No file names a branch to act on.`;
  - the whole Vitest suite runs 212 files and 3313 tests. The only failures are 7 `checkGitRepository` tests in `adws/__tests__/healthCheckChecks.test.ts`, which need a `.git` directory that the export lacks. They pass in the worktree, as the review's run shows.
- **The restore persists for this run.** Main's `workflowInit.ts` copies the runner's prompts only when it creates a worktree (`main:adws/phases/workflowInit.ts:256`, `:278`). Reusing a worktree only merges the default branch and copies `.env` (`:262-275`).

Alternatives considered and rejected:
- `git revert 3031342b`. It also deletes the spec and `feature-965.feature`, and undoes the amendment of `feature-960.feature` and the ten rewritten surface rows.
- A rebase that drops the files from `3031342b`. It gives the same net tree but needs a force-push.
- Hand edits.

## Files to Modify
Use these files to implement the patch:

Restore each file to `origin/dev`'s content with `git checkout`. Do not edit them by hand.
- `.claude/commands/adw_init.md`
- `.claude/commands/clean_local_repo.md`
- `.claude/commands/document.md`
- `.claude/commands/feature.md`
- `.claude/commands/generate_step_definitions.md`
- `.claude/commands/resolve_conflict.md`
- `.claude/commands/resolve_failed_test.md`
- `.claude/commands/review.md`
- `.claude/commands/scenario_writer.md`
- `.claude/skills/depaudit-triage/SKILL.md`
- `.claude/skills/implement-tdd/SKILL.md`

Nothing else changes:
- Keep the #965 fix as committed: the spec, and the files under `features/` and `test/`.
- Leave `.adw-version` alone (see Notes).
- Do not merge dev into the branch, rebase, amend or push.

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

Run every command from the worktree root. This patch changes no behaviour, so even in TDD mode it has no RED step. Do not add or change tests, step definitions or `.feature` files.

### Step 1: Confirm the starting state
- `git rev-parse HEAD` prints `951e62da36083007c75d3a2b9d3c8b6ff30a41e4`. `git rev-parse origin/dev` and `git merge-base HEAD origin/dev` both print `d96d7c72e6500f8c0307ed6c9bc49032f35bfa96`. Do not fetch.
- Only the plan commit touches `.claude/` on the branch. This lists only `3031342b plan-orchestrator: fix: move surface rows onto phase harness`:
  ```sh
  git log --oneline "$(git merge-base HEAD origin/dev)"..HEAD -- .claude/
  ```
- `git status --porcelain` prints exactly these three lines:
  ```
   M .claude/commands/adw_init.md
   M .claude/skills/depaudit-triage/SKILL.md
  ?? specs/patch/patch-adw-mr7y3g-bug-move-the-install-restore-claude-prompts-from-dev.md
  ```
- If `HEAD` differs, continue as long as the `git log` check lists only `3031342b` and nothing else under `.claude/` is modified. Otherwise stop and report; do not fall back to hand edits.
- If `origin/dev` has moved, `git diff --name-only d96d7c72 origin/dev -- .claude/` must print nothing. If it lists files, dev changed its prompts after the merge base. Then run Step 2 with `d96d7c72` in place of `origin/dev`, and report that the review's check in Validation 1 now lists only dev's newer changes.

### Step 2: Restore the eleven files from `origin/dev`
- Run the review's command exactly:
  ```sh
  git checkout origin/dev -- .claude/commands/adw_init.md .claude/commands/clean_local_repo.md .claude/commands/document.md .claude/commands/feature.md .claude/commands/generate_step_definitions.md .claude/commands/resolve_conflict.md .claude/commands/resolve_failed_test.md .claude/commands/review.md .claude/commands/scenario_writer.md .claude/skills/depaudit-triage/SKILL.md .claude/skills/implement-tdd/SKILL.md
  ```
- This sets the index and the working tree of the eleven paths to `origin/dev`'s content.
  - The two unstaged restorations already hold that content, and the checkout stages them.
  - `adw_init.md` matches `.gitignore:41` but is tracked, so no `-f` is needed.
- Check the result:
  - `git diff --cached --stat` lists exactly the eleven paths and ends with `11 files changed, 182 insertions(+), 75 deletions(-)`.
  - `git diff --name-only -- .claude/` prints nothing, so nothing under `.claude/` is left unstaged.

### Step 3: Commit only `.claude/`
- Run:
  ```sh
  git commit \
    -m "patchAgent: fix: restore .claude prompts to origin/dev" \
    -m "Creating the worktree copied the ADW runner's stale main checkout over the tracked .claude/ prompts, and plan commit 3031342b picked up eleven of them. Restore them to origin/dev, the merge base, so the pull request carries no .claude change, the adw_init and depaudit-triage prompt tests and the branch-name guard pass on the committed tree, and merging keeps dev's text in all eleven prompts." \
    -- .claude/
  ```
- The pathspec commits the tracked paths under `.claude/`, which are the eleven restored files, and nothing else.
- Do not use `git add -A`, `git commit -a`, `--amend`, `git revert`, a rebase or a push.
- Leave this plan file untracked. Right after this build, the runner's review-patch loop commits it and pushes the branch: `runCommitAgent('review-patch-agent', …)`, then `gitCtx.pushBranch` (`main:adws/phases/reviewPhase.ts:244-255`).

### Step 4: Run the validation
- Run every command under `## Validation`, in order.
- This patch changes only prompt text, so a failing gate means the restore went wrong. Re-check Steps 2 and 3 and fix it there. Do not edit any other file to make a gate pass; if a gate fails for a reason outside `.claude/`, report it with its output.

## Validation
Execute every command to validate the patch is complete with zero regressions.

Run each command from the worktree root, one at a time, against `origin/dev` as it stands, without fetching. Never run two Cucumber processes from this checkout at once.

1. **The restore is one commit of exactly the eleven files, and the branch no longer changes `.claude/`.**
   - `git show --format= --name-only HEAD` and `git diff --name-only 951e62da HEAD` each print exactly the eleven paths of `Files to Modify`.
   - `git diff origin/dev --stat -- .claude/` prints nothing. This is the review's check. Before the patch it lists 9 paths; the two unstaged restorations are the missing two.
   - `git diff origin/dev...HEAD --name-only -- .claude/` prints nothing. This is the pull request's view. Before the patch it lists all eleven.
   - `git status --porcelain -- .claude/` prints nothing. So the checks below test the committed prompts, not uncommitted restorations.
   - `git diff origin/dev...HEAD --name-only | wc -l` prints `41`: the spec, 25 files under `features/` and 15 under `test/`, none under `.claude/`. Before the patch it prints `52`.
2. **The pinned prompt tests pass on a clean working tree.** `bunx vitest run adws/__tests__/adwInitPrompt.test.ts adws/__tests__/depauditTriageSkill.test.ts` reports `Test Files  2 passed (2)` and `Tests  6 passed (6)`. On the pre-patch committed tree, 5 of the 6 fail.
3. **Dev's unpinned text is back.** No test pins it, so check it directly:
   - `grep -n '^## Step 4: Step Definition Independence Check' .claude/commands/review.md` matches line 47.
   - `grep -c '\.github/adw\.yml' .claude/commands/feature.md .claude/skills/implement-tdd/SKILL.md` prints `2` for `feature.md` and `1` for `SKILL.md`. Both print `0` before the patch.
   - `grep -c -e 'except main and develop' -e 'origin/main' .claude/commands/clean_local_repo.md .claude/commands/resolve_failed_test.md` prints `0` for both files. Both print `1` before the patch.
4. **The branch-name guard passes.** `bun run lint:branch-names` exits 0 and prints `✔ PASS  No file names a branch to act on.` Before the patch it exits 1 with the 8 violations listed in the Issue Summary.
5. **The unit suite passes.** `bun run test:unit` reports `Test Files  212 passed (212)` and `Tests  3313 passed (3313)`, the same counts as the review's run.
6. **No regression on the spec's gates.** Each exits 0:
   - `bun run lint`
   - `bunx tsc --noEmit`
   - `bunx tsc --noEmit -p adws/tsconfig.json`
   - `bun run build`
   - `bun run lint:git-guard`
   - `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-965" > /tmp/adw-965-patch.after 2>&1; echo "exit=$?"; tail -n 3 /tmp/adw-965-patch.after`. Expect `exit=0` and `20 scenarios (20 passed)`, as in the build's `/tmp/adw-965-adw965.out`.

   The spec's other Cucumber gates are not needed: the ten-row loop, the per-row timing, `@adw-963`, the pause-queue tags and the full `@regression` run. No Cucumber step reads the text of the eleven files. Features 537, 729, 930 and 963 use fixture copies or throwaway worktrees, and features 932, 937 and 938 name the files only in their descriptions. `lint:git-guard` skips `.claude/` (`adws/checkGitGhGuard.ts:23`).
7. **Nothing is left over.** `git status --porcelain` prints only `?? specs/patch/patch-adw-mr7y3g-bug-move-the-install-restore-claude-prompts-from-dev.md`. Nothing is listed under `.claude/`, `agents/` or `logs/`. The runner's review-patch commit adds this plan right after the build.

## Patch Scope
**Lines of code to change:** 0 written by hand. `git checkout` restores dev's content of eleven prompt files (182 lines added, 75 removed), all in one commit.
**Risk level:** low
**Testing required:**
- Git-state checks: the restore is one commit of exactly the eleven files, and neither the review's two-dot view nor the pull request's three-dot view shows a `.claude/` change (Validation 1).
- The two pinned prompt tests pass on a clean working tree (2), and greps confirm dev's unpinned text is back (3).
- The branch-name guard passes (4), and so does the full unit suite (5).
- The spec's lint, type, build, git-guard and `@adw-965` gates show that the #965 fix is untouched (6), and the working tree is clean apart from this plan (7).

## Notes
- **The root cause is out of scope and still open.**
  - The runner's checkout is `main` at `3d43b81a`. Its `copyClaudeAssetsToWorktree` (`main:adws/phases/worktreeSetup.ts:212`) copies every runner prompt over a new worktree's tracked copies. Main has no `planCommitGuard.ts`, so nothing stopped the plan commit.
  - Dev has both safeguards. In ADW's own repository it leaves tracked `.claude/` paths alone (`adws/phases/worktreeSetup.ts:241-242`). It also fails a plan phase that changes `.claude/` or `.adw/` (`adws/phases/planCommitGuard.ts:9`, `:117`).
  - Until the runner's checkout moves to current dev, every new ADW worktree of this repository will pick up the same stale prompts. The #961 branch (`6b14a893`) and the #963 branch (`24221676`) needed the same restore.
- **Leave `.adw-version` alone.** `adw_init.md` and `document.md` are framework-hash inputs (`hashInputs:` in `adw_init.md`). So the restore moves the computed hash from `58ba2954…` back to dev's `bd150741…`. The committed `.adw-version` stays `58ba2954…`, which is its value on dev too (last regenerated by `c5dcff86`). That gap already exists on dev, and closing it is not this patch's job.
