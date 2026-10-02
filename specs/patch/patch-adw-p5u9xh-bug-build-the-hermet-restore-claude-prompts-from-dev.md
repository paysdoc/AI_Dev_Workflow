# Patch: Restore the eleven `.claude/` prompt files that plan commit `764fbdd0` rolled back to the runner's stale `main`

## Metadata
adwId: `p5u9xh-bug-build-the-hermet`
reviewChangeRequest: `` Issue #1: The plan commit 764fbdd0 committed stale copies of 11 `.claude/` files and rolls back changes dev already has. The spec says the plan commit must not touch `.claude/` and that unrelated working-tree changes stay out of the branch. dev has not changed `.claude/` since the merge base, so every difference comes from this branch. Files that differ from origin/dev at HEAD: `.claude/commands/adw_init.md`, `clean_local_repo.md`, `document.md`, `feature.md`, `generate_step_definitions.md`, `resolve_conflict.md`, `resolve_failed_test.md`, `review.md`, `scenario_writer.md`, `.claude/skills/depaudit-triage/SKILL.md` and `.claude/skills/implement-tdd/SKILL.md`. Merged as they are, they would:
- remove review.md's Step 4 (the step-definition independence check);
- remove document.md's ADR `Decisions:` handling, and make document.md and resolve_failed_test.md diff against a hard-coded `origin/main`;
- point feature.md and implement-tdd at `.adw/project.md` for the unit-test switch instead of `.github/adw.yml`, so unit tests become off by default;
- drop adw_init.md's `.github/adw.yml` step and Comments-entry step;
- drop generate_step_definitions.md's BDD-framework handling and its instruction to read the per-issue and regression step directories;
- make clean_local_repo.md delete every branch except `main` and `develop`, which includes this repo's default branch `dev` and the current branch.
On a clean copy of HEAD, `adws/__tests__/adwInitPrompt.test.ts` and `adws/__tests__/depauditTriageSkill.test.ts` fail 5 tests. The working tree passes only because the test phase restored those two files in the index without committing them; the other nine files are still rolled back.
Resolution: Restore all 11 files from origin/dev and commit them: `git checkout origin/dev -- .claude/commands/adw_init.md .claude/commands/clean_local_repo.md .claude/commands/document.md .claude/commands/feature.md .claude/commands/generate_step_definitions.md .claude/commands/resolve_conflict.md .claude/commands/resolve_failed_test.md .claude/commands/review.md .claude/commands/scenario_writer.md .claude/skills/depaudit-triage/SKILL.md .claude/skills/implement-tdd/SKILL.md`. Then confirm `git diff origin/dev HEAD -- .claude` is empty and `bun run test:unit` passes on the committed tree. ``

## Issue Summary
**Original Spec:** `specs/issue-966-adw-p5u9xh-bug-build-the-hermet-sdlc_planner-hermetic-subprocess-harness-surface-rows.md`

**Issue:** Plan commit `764fbdd0` is the only commit on the branch that touches `.claude/`. It modifies eleven prompt and skill files that the spec never names, which breaks the spec's own rule (Notes, "Working tree": leave the unrelated `.claude/` changes alone; the plan commit must not touch `.claude/`). Each committed copy is byte-identical to `main` at `3d43b81a`, which is the ADW runner's checkout. Dev has not changed `.claude/` since the merge base `d96d7c72`. `origin/dev` is at `9a4b7671`, the remote's tip, and `git diff d96d7c72 origin/dev -- .claude/` is empty. So every difference is this branch rolling dev back. Planning confirmed every effect the review lists:
- **Dev's text is missing from the committed copies.** Counts are dev → `HEAD`:
  - `review.md`: `## Step 4: Step Definition Independence Check` (line 47 on dev) → absent.
  - `document.md`: lines naming `Decisions` 11 → 0; `origin/main` 0 → 3.
  - `resolve_failed_test.md`: `origin/main` 0 → 1.
  - `feature.md` and `implement-tdd/SKILL.md`: `.github/adw.yml` 2 → 0 and 1 → 0. Both read `## Unit Tests` from `.adw/project.md` instead, where an absent section means off.
  - `adw_init.md`: `adw.yml` 9 → 0; the `- **Comments** —` entry 1 → 0.
  - `generate_step_definitions.md`: `## BDD Framework` 3 → 0. Step 3's "the ones beside the per-issue and regression scenarios" is also gone (1 → 0).
  - `clean_local_repo.md:12`: back to deleting every branch `except main and develop`, which includes `dev` and the current branch.
  - `depaudit-triage/SKILL.md`: `/adw_*` commands 0 → 3; `--label adw:bug` 1 → 0.
  - Dev's edits to `resolve_conflict.md` and `scenario_writer.md` would be lost too.
- **The pinned prompt tests fail on the committed tree.** In a throwaway `git archive HEAD` export, 5 of the 6 tests in `adws/__tests__/adwInitPrompt.test.ts` and `adws/__tests__/depauditTriageSkill.test.ts` fail. Only `routes adw:bug to the full SDLC orchestrator` passes.
  - The build's own unit run failed the same way. `/tmp/adw-966-v-unit.out` reports `2 failed | 209 passed (211)` test files and `5 failed | 3285 passed (3290)` tests.
  - The current worktree passes, with 211 files and 3290 tests (`/tmp/adw-966-patchplan-unit.worktree`). It passes only because `adw_init.md` and `depaudit-triage/SKILL.md` are restored in the index and not committed.
- **The branch-name guard fails, so CI would fail too.** `bun run lint:branch-names` exits 1 on the committed tree, and still exits 1 on the current worktree, with 8 violations:
  - `clean_local_repo.md:12`
  - `document.md:6`, `:17`, `:18`, `:19`
  - `resolve_conflict.md:12`
  - `resolve_failed_test.md:16`
  - `review.md:17`

  The `branch-names` job of `.github/workflows/git-cli-guard.yml` (`:42-57`) runs this guard on every pull request.
- **The pull request carries the rollback.** `git diff origin/dev...HEAD --name-only` lists 58 files, 11 of them under `.claude/`.

**Solution:** Run the review's `git checkout origin/dev` of the eleven files, then commit only `.claude/` on top of `HEAD`. No history rewrite is needed.
- Dev's `.claude/` equals the merge base's, so the checkout returns each file to the content the branch started from. The pull request then carries no `.claude/` change.
- **Measured in advance** on a `git archive HEAD` export with `origin/dev`'s `.claude/` on top:
  - both pinned test files pass, 6 of 6;
  - `bunx tsx adws/checkBranchNames.ts <export>` exits 0 with `✔ PASS  No file names a branch to act on.`
- **Rejected alternatives:**
  - `git revert 764fbdd0`. That commit also carries the spec, 12 files under `features/` and the `README.md` update.
  - A rebase that drops the files from `764fbdd0`. It gives the same tree but needs a force-push.
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
- Keep the #966 work as committed: the spec, `README.md`, `adws/adwPatch.tsx`, and the files under `features/` and `test/`.
  - `README.md` is not part of the rollback. `764fbdd0` only removed two entries that dev's README lists twice (`startupFailureLog.test.ts` and `strandedStartingRecovery.test.ts`) and widened one description. The build added the harness entries.
- Leave `.adw-version` alone (see Notes).
- Do not fetch, merge dev, rebase, amend or push.

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

Run every command from the worktree root. This patch changes no behaviour, so even in TDD mode it has no RED step. Do not add or change tests, step definitions or `.feature` files.

### Step 1: Confirm the starting state
- Check the refs. Do not fetch.
  - `git rev-parse HEAD` prints `2c5dc308d7ffd9c720ac46e10e695e016e084f43`.
  - `git rev-parse origin/dev` prints `9a4b7671bf5cec047273c42132b2464113259651`.
  - `git merge-base HEAD origin/dev` prints `d96d7c72e6500f8c0307ed6c9bc49032f35bfa96`.
- `git log --oneline d96d7c72..HEAD -- .claude/` lists only `764fbdd0 plan-orchestrator: feat: add hermetic subprocess harness surface rows`.
- `git diff --name-only d96d7c72 origin/dev -- .claude/` prints nothing, so dev has not changed `.claude/` since the merge base.
- `git status --porcelain` prints exactly these three lines:
  ```
  M  .claude/commands/adw_init.md
  M  .claude/skills/depaudit-triage/SKILL.md
  ?? specs/patch/patch-adw-p5u9xh-bug-build-the-hermet-restore-claude-prompts-from-dev.md
  ```
  The two staged files already hold `origin/dev`'s content: `git diff --cached --name-only origin/dev -- .claude/` lists only the other nine.
- **If the state differs:**
  - If `HEAD` differs, continue only if the `git log` check still lists just `764fbdd0` and nothing else under `.claude/` is modified.
  - If the `git diff d96d7c72 origin/dev` check lists files, dev changed its prompts after the merge base. Run Step 2 with `d96d7c72` in place of `origin/dev`. Then report that Validation 1's two-dot check now lists only dev's newer changes.
  - Otherwise stop and report. Never fall back to hand edits.

### Step 2: Restore the eleven files from `origin/dev`
- Run the review's command exactly:
  ```sh
  git checkout origin/dev -- .claude/commands/adw_init.md .claude/commands/clean_local_repo.md .claude/commands/document.md .claude/commands/feature.md .claude/commands/generate_step_definitions.md .claude/commands/resolve_conflict.md .claude/commands/resolve_failed_test.md .claude/commands/review.md .claude/commands/scenario_writer.md .claude/skills/depaudit-triage/SKILL.md .claude/skills/implement-tdd/SKILL.md
  ```
- It sets the index and the working tree of all eleven paths. The two already-staged files keep the content they have.
- Check the result:
  - `git diff --cached --stat` lists exactly the eleven paths and ends with `11 files changed, 182 insertions(+), 75 deletions(-)`;
  - `git diff --name-only -- .claude/` prints nothing, so nothing under `.claude/` is left unstaged.

### Step 3: Commit only `.claude/`
- Run:
  ```sh
  git commit \
    -m "patchAgent: fix: restore .claude prompts to origin/dev" \
    -m "Creating the worktree copied the ADW runner's stale main checkout over the tracked .claude/ prompts, and plan commit 764fbdd0 picked up eleven of them. Restore them to origin/dev, which matches the merge base under .claude/, so the pull request carries no .claude change, the adw_init and depaudit-triage prompt tests and the branch-name guard pass on the committed tree, and merging keeps dev's text in all eleven prompts." \
    -- .claude/
  ```
- The pathspec commits the tracked paths under `.claude/`, which are the eleven restored files, and nothing else. No untracked or ignored file exists under `.claude/`.
- Do not use `git add -A`, `git commit -a`, `--amend`, `git revert`, a rebase or a push.
- Leave this plan file untracked. The runner's review-patch commit adds it after the build, as with `133866bc` and then `b90ae972` on dev.

### Step 4: Run the validation
- Run every command under `## Validation`, in order.
- This patch changes only prompt text, so a failing gate means the restore went wrong. Re-check Steps 2 and 3 and fix it there.
- Do not edit any other file to make a gate pass. If a gate fails for a reason outside `.claude/`, report it with its output.

## Validation
Execute every command to validate the patch is complete with zero regressions.

Run each command from the worktree root, one at a time, against `origin/dev` as it stands, without fetching. Never run two Cucumber processes from this checkout at once.

1. **The restore is one commit of exactly the eleven files, and the branch no longer changes `.claude/`.**
   - `git show --format= --name-only HEAD` and `git diff --name-only 2c5dc308 HEAD` each print exactly the eleven paths of `Files to Modify`.
   - `git diff origin/dev HEAD -- .claude` prints nothing. This is the review's check; before the patch it lists all eleven.
   - `git diff origin/dev...HEAD --name-only -- .claude/` prints nothing. This is the pull request's view; before the patch it lists all eleven.
   - `git status --porcelain -- .claude/` prints nothing, so the gates below test the committed prompts.
   - `git diff origin/dev...HEAD --name-only | wc -l` prints `47`. That is the spec, `README.md`, `adws/adwPatch.tsx`, 35 files under `features/` and 9 under `test/`. Before the patch it prints `58`.
2. **The pinned prompt tests pass on the committed tree.** `bunx vitest run adws/__tests__/adwInitPrompt.test.ts adws/__tests__/depauditTriageSkill.test.ts` reports `Test Files  2 passed (2)` and `Tests  6 passed (6)`.
3. **Dev's unpinned text is back.** No test pins it, so run each of these and compare its output:
   - `grep -n '^## Step 4: Step Definition Independence Check' .claude/commands/review.md` matches line 47.
   - `grep -c 'Decisions' .claude/commands/document.md` prints `11`.
   - `grep -c '\.github/adw\.yml' .claude/commands/feature.md .claude/skills/implement-tdd/SKILL.md` prints `2` and `1`.
   - `grep -c 'adw\.yml' .claude/commands/adw_init.md` prints `9`.
   - `grep -c '## BDD Framework' .claude/commands/generate_step_definitions.md` prints `3`.
   - `grep -c -e 'except main and develop' -e 'origin/main' .claude/commands/clean_local_repo.md .claude/commands/document.md .claude/commands/resolve_failed_test.md` prints `0` for each file. Before the patch it prints `1`, `3` and `1`.
4. **The branch-name guard passes.** `bun run lint:branch-names` exits 0 and prints `✔ PASS  No file names a branch to act on.` Before the patch it exits 1 with the 8 violations listed in the Issue Summary.
5. **The unit suite passes on the committed tree.** `bun run test:unit` reports `Test Files  211 passed (211)` and `Tests  3290 passed (3290)`.
6. **No regression on the spec's gates.** Each exits 0:
   - `bun run lint`
   - `bunx tsc --noEmit`
   - `bunx tsc --noEmit -p adws/tsconfig.json`
   - `bun run build`
   - `bun run lint:git-guard`
   - `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-966" > /tmp/adw-966-patch.after 2>&1; echo "exit=$?"; tail -n 4 /tmp/adw-966-patch.after`. Expect `exit=0` and `64 scenarios (64 passed)`, as in the build's `/tmp/adw-966-v-adw966.out`.

   **Why `@adw-966` is the one Cucumber gate needed:**
   - `adw_init.md` and `document.md` are framework-hash inputs (`hashInputs:`). The seven subprocess rows run only when the fixture's `.adw-version` matches the hash that the child's upgrade gate computes.
   - Both sides compute the hash at run time (`features/regression/support/fixtureTargetRepo.ts:30`, `adws/phases/upgradeGate.ts:99`). So the rows must still pass now that the hash is dev's `bd150741…`.

   **The spec's other Cucumber gates are not needed.** No Cucumber step reads the text of the eleven files in the checkout:
   - features 537, 729 and 930 write their own fixture copies;
   - other steps name the commands only as strings;
   - `lint:git-guard` skips `.claude/` (`adws/checkGitGhGuard.ts:23`).
7. **Nothing is left over.** `git status --porcelain` prints only `?? specs/patch/patch-adw-p5u9xh-bug-build-the-hermet-restore-claude-prompts-from-dev.md`. Nothing is listed under `.claude/`, `agents/` or `logs/`.

## Patch Scope
**Lines of code to change:** 0 written by hand. `git checkout` restores dev's content of eleven prompt files (182 lines added, 75 removed), all in one commit.
**Risk level:** low
**Testing required:**
- Git-state checks: one commit of exactly the eleven files. Neither the review's two-dot view nor the pull request's three-dot view shows a `.claude/` change (Validation 1).
- The two pinned prompt tests (2), greps for dev's unpinned text (3), the branch-name guard (4) and the full unit suite (5), all on the committed tree.
- The spec's lint, type, build, git-guard and `@adw-966` gates (6), and a clean working tree apart from this plan (7).

## Notes
- **The root cause is out of scope and still open.**
  - The runner's checkout is `main` at `3d43b81a`. When main creates a worktree, its `copyClaudeAssetsToWorktree` copies the runner's prompts over the worktree's tracked copies (`main:adws/phases/worktreeSetup.ts:212`, called at `main:adws/phases/workflowInit.ts:256` and `:278`). Main has no `planCommitGuard.ts`, so nothing stopped the plan commit.
  - Dev has both safeguards. In ADW's own repository it leaves tracked `.claude/` paths alone (`adws/phases/worktreeSetup.ts:241-242`). It also fails a plan phase that changes `.claude/` or `.adw/` (`adws/phases/planCommitGuard.ts:9`, `:117`).
  - Until the runner's checkout moves to current dev, every new ADW worktree of this repository picks up the same stale prompts. The #961 (`6b14a893`), #963 (`24221676`) and #965 (`133866bc`) branches needed this same restore.
- **The restore persists for this run.** Main copies the runner's prompts only when it creates a worktree, and this worktree is reused.
- **Leave `.adw-version` alone.**
  - `adw_init.md` and `document.md` are `hashInputs:` files, so the restore changes the computed framework hash:
    - the committed tree computes `58ba2954…`;
    - the current mixed worktree computes `5a2892c8…`;
    - after the restore, it computes dev's `bd150741…`.
  - The committed `.adw-version` stays `58ba2954…`, which is also its value on dev, so dev already has the same gap. Closing it is not this patch's job.
  - No test pins the repository's own `.adw-version`.
