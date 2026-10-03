# Patch: Restore the eleven `.claude/` prompt files that plan commit `b5eada7e` reverted to the runner's stale `main`

## Metadata
adwId: `g53ol8-bug-build-the-in-pro`
reviewChangeRequest: `` Issue #1: Out-of-scope .claude changes would roll back dev's prompts. Plan commit b5eada7e committed old host-checkout copies of 11 prompt and skill files. This is the same leak 6b14a893 fixed on the #961 branch. The files are .claude/commands/{adw_init,clean_local_repo,document,feature,generate_step_definitions,resolve_conflict,resolve_failed_test,review,scenario_writer}.md and .claude/skills/{depaudit-triage,implement-tdd}/SKILL.md. Dev has not changed .claude since the merge base, so merging this PR would take the stale versions and revert: (1) review.md's Step 4 step-definition independence check; (2) the .github/adw.yml unitTests rule in feature.md and implement-tdd, which would go back to the removed '## Unit Tests' section of .adw/project.md; (3) the default-branch wording, bringing back hard-coded main/develop in clean_local_repo, resolve_conflict and review; (4) adw_init.md's adw.yml heredoc, Comments guideline entry and Test Directory/Test Framework sections; (5) the depaudit-triage routing contract, so a filed issue body would again embed /adw_sdlc. On the committed files, adws/__tests__/adwInitPrompt.test.ts and adws/__tests__/depauditTriageSkill.test.ts fail. The local unit run passes only because the working tree holds uncommitted restorations of adw_init.md and depaudit-triage/SKILL.md. The spec names none of these files.
Resolution: Restore every .claude file to origin/dev with `git checkout origin/dev -- .claude` and commit, so that `git diff origin/dev --stat -- .claude` is empty and the PR carries no .claude change. Dev's .claude is unchanged since the merge base, so this only undoes the stale copies. Keep the README additions from the same commit, because the files they list exist. Re-run `bun run test:unit` on the committed files to confirm adwInitPrompt.test.ts and depauditTriageSkill.test.ts pass. ``

## Issue Summary
**Original Spec:** `specs/issue-963-adw-g53ol8-bug-build-the-in-pro-sdlc_planner-in-process-phase-harness-surface-rows.md`

**Issue:** Plan commit `b5eada7e` (`HEAD~2`) is the only commit on the branch that touches `.claude/`. It modifies eleven prompt files that the spec never names, and adds or deletes none. Each one is byte-identical to `main` at `3d43b81a`, which is the checkout the ADW runner runs from. Dev's `.claude/` has not changed since the merge base `135c5682`, so merging would replace dev's prompts with main's older copies. Planning confirmed every effect the review lists:
- **The pinned prompt tests fail on the committed tree.** In a throwaway export of `HEAD`, 5 of the 6 tests in `adws/__tests__/adwInitPrompt.test.ts` and `adws/__tests__/depauditTriageSkill.test.ts` fail. The build's own unit runs (`/tmp/adw-963-unit.before`, `.after` and `.after2`) failed on exactly these two files. The suite passes in the worktree now (211 files, 3289 tests) only because `adw_init.md` and `depaudit-triage/SKILL.md` are restored there but not staged.
- **The branch-name guard fails, so CI fails too.** Review item (3) is what `bun run lint:branch-names` checks. It exits 1 with 8 violations, both on the committed tree and in the worktree: `clean_local_repo.md:12`, `document.md:6`, `:17`, `:18`, `:19`, `resolve_conflict.md:12`, `resolve_failed_test.md:16` and `review.md:17`. The `branch-names` job of `.github/workflows/git-cli-guard.yml` runs this guard on every pull request.
- **Dev's text is missing from the committed copies.** Counts are dev → committed:
  - `review.md`: `## Step 4: Step Definition Independence Check`, at line 47 on dev, is gone.
  - `.github/adw.yml` mentions: 2 → 0 in `feature.md`, 1 → 0 in `implement-tdd/SKILL.md`.
  - `adw_init.md`: `adw.yml` 9 → 0, `Test Directory` 2 → 0, `Test Framework` 2 → 0, `Comments` 4 → 0.
  - depaudit-triage: `/adw_sdlc` 0 → 3, `--label adw:bug` 1 → 0.
  - Dev's changes to `/document`, `/generate_step_definitions` and `/scenario_writer` would be lost too.

**Solution:** Restore `.claude/` with one `git checkout` from the merge base, then commit only `.claude/` on top of `HEAD`. No history rewrite is needed.
- **Same content as the review's command.** `git diff --name-only 135c5682 origin/dev -- .claude/` prints nothing (`origin/dev` is `911c6134`, PR #972). So the result is exactly that of `git checkout origin/dev -- .claude`. The merge base is a fixed commit, while `origin/dev` is a ref that every worktree shares and any fetch can move.
- **Measured in advance.** The `HEAD` export with the merge base's `.claude/` on top passes both pinned test files (6 of 6). There the branch-name guard prints `✔ PASS  No file names a branch to act on.`
- **The restore persists for this run.** Main's `workflowInit.ts` copies prompts only when it creates a worktree (`:278`). Reusing a worktree only merges the default branch and copies `.env` (`:262-275`).

Alternatives considered and rejected:
- `git revert b5eada7e`. It also deletes the spec, `feature-963.feature`, the six rewritten surface rows and the README additions.
- A rebase that drops the files from `b5eada7e`. It gives the same net tree but needs a force-push.
- Hand edits.

## Files to Modify
Use these files to implement the patch:

Restore each file to its merge-base content with `git checkout`. Do not edit them by hand.
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
- Keep `README.md` as committed. Every path its additions list exists, from `adws/__tests__/regressionWorkflow.test.ts` to `test/mocks/stubArgs.ts`.
- Keep the #963 fix as committed: `features/`, `test/` and the spec.
- Leave `.adw-version` alone. The branch does not change it.
- Do not merge dev into the branch, rebase, amend or push.

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

Run every command from the worktree root. This patch changes no behaviour, so even in TDD mode it has no RED step. Do not add or change tests, step definitions or `.feature` files.

### Step 1: Confirm the starting state
- `git rev-parse HEAD` prints `b0659c8ea33dfa1fbfbf478dcb30bd08aae406cc`, and `git merge-base HEAD origin/dev` prints `135c5682fbe4fdb29a507ec99ea3c332338e68c2`.
- Only the plan commit touches `.claude/` on the branch. This lists only `b5eada7e plan-orchestrator: fix: add in-process phase harness for surface rows`:
  ```sh
  git log --oneline "$(git merge-base HEAD origin/dev)"..HEAD -- .claude/
  ```
- Dev has not changed `.claude/` since the merge base. This prints nothing:
  ```sh
  git diff --name-only "$(git merge-base HEAD origin/dev)" origin/dev -- .claude/
  ```
- `git status --porcelain` prints exactly these three lines and nothing else:
  ```
   M .claude/commands/adw_init.md
   M .claude/skills/depaudit-triage/SKILL.md
  ?? specs/patch/patch-adw-g53ol8-bug-build-the-in-pro-restore-claude-prompts-from-dev.md
  ```
- If `HEAD` or the merge base differs, the steps still apply as long as the two checks above hold. If either check fails, stop and report. Do not fall back to hand edits.

### Step 2: Restore `.claude/` from the merge base
- Run exactly:
  ```sh
  git checkout "$(git merge-base HEAD origin/dev)" -- .claude/
  ```
- This sets the index and the working tree of every tracked path under `.claude/` to the merge base's content. Only the eleven files differ, so only they change.
  - The two unstaged restorations already hold that content, and the checkout stages them.
  - `.claude/` holds no untracked or ignored files. `adw_init.md` matches `.gitignore:41` but is tracked, so no `-f` is needed.
- Check the result:
  - `git diff --cached --stat` lists exactly the eleven paths and ends with `11 files changed, 182 insertions(+), 75 deletions(-)`.
  - `git diff --name-only -- .claude/` prints nothing, so nothing under `.claude/` is left unstaged.

### Step 3: Commit only `.claude/`
- Run:
  ```sh
  git commit \
    -m "patchAgent: fix: restore .claude prompts to origin/dev" \
    -m "Creating the worktree copied the ADW runner's stale main checkout over the tracked .claude/ prompts, and plan commit b5eada7e picked them up. Restore them to the merge base, which dev has not changed since, so the pull request carries no .claude change, the adw_init and depaudit-triage prompt tests and the branch-name guard pass, and merging keeps dev's text in all eleven prompts." \
    -- .claude/
  ```
- The pathspec commits the tracked paths under `.claude/`, which are the eleven restored files, and nothing else.
- Do not use `git add -A`, `git commit -a`, `--amend`, `git revert`, a rebase or a push.
- Leave this plan file untracked. The runner's review-patch loop commits it right after this build and then pushes the branch: `runCommitAgent('review-patch-agent', …)` followed by `gitCtx.pushBranch` (`main:adws/phases/reviewPhase.ts:244-255`).

### Step 4: Run the validation
- Run every command under `## Validation`.
- This patch changes only prompt text. If a gate fails for a reason outside `.claude/`, report it. Do not change any other file to fix it.

## Validation
Execute every command to validate the patch is complete with zero regressions.

Use `origin/dev` as it stands, without fetching.

1. **The restore is one commit of exactly the eleven files, and the branch no longer changes `.claude/`.**
   - `git show --format= --name-only HEAD` and `git diff --name-only b0659c8e HEAD` each print exactly the eleven paths of `Files to Modify`.
   - `git diff origin/dev --stat -- .claude` prints nothing. This is the review's check. Before the patch it lists 9 paths; the two unstaged restorations are the missing two.
   - `git diff origin/dev...HEAD --name-only -- .claude/` prints nothing. This is the pull request's view. Before the patch it lists all eleven.
   - `git status --porcelain -- .claude/` prints nothing.
   - `git diff origin/dev...HEAD --name-only` lists 54 files, none of them under `.claude/`: `README.md`, the spec, 32 files under `features/` and 20 under `test/`.
2. **The branch-name guard passes.** `bun run lint:branch-names` exits 0 and prints `✔ PASS  No file names a branch to act on.` Before the patch it exits 1 with the 8 violations listed in the Issue Summary.
3. **Dev's prompt text is back.**
   - `bunx vitest run adws/__tests__/adwInitPrompt.test.ts adws/__tests__/depauditTriageSkill.test.ts` reports `Test Files  2 passed (2)` and `Tests  6 passed (6)`. On the pre-patch committed tree, 5 of the 6 fail.
   - No test pins `review.md` Step 4 or the unit-test switch, so check them directly:
     - `grep -n "^## Step 4: Step Definition Independence Check" .claude/commands/review.md` matches line 47.
     - `grep -c '\.github/adw\.yml' .claude/commands/feature.md .claude/skills/implement-tdd/SKILL.md` prints `2` for `feature.md` and `1` for `SKILL.md`. Both print `0` before the patch.
4. **The unit suite passes on the committed content.** `bun run test:unit` reports `Test Files  211 passed (211)` and `Tests  3289 passed (3289)`.
   - Validation 1 shows that nothing under `.claude/` is staged or modified any more. So this run tests the committed prompts, not uncommitted restorations.
5. **Zero regressions, using the spec's gates.** Run these one after the other:
   - `bun run lint`
   - `bunx tsc --noEmit`
   - `bunx tsc --noEmit -p adws/tsconfig.json`
   - `bun run build`
   - `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-963" > /tmp/adw-963-patch.after 2>&1; echo "exit=$?"; tail -n 3 /tmp/adw-963-patch.after`. Expect `exit=0` and `47 scenarios (47 passed)`, the same as the build's run in `/tmp/adw-963-adw963.out2`.

   These gates should give the same results as before the patch:
   - No Cucumber step reads the real wording of the eleven files. The step definitions that name them, for features 537, 729, 930 and 933, write their own fixture copies or use only the command name.
   - `lint:git-guard` exempts `.claude/`.
   - The full `@regression` run is not needed. It exits 1 by design on the pending smoke and surface tier (ADR-0037 Divergence item 3).

## Patch Scope
**Lines of code to change:** 0 written by hand. `git checkout` restores the merge-base content of eleven prompt files (182 lines added, 75 removed), all in one restore commit.
**Risk level:** low
**Testing required:**
- Git-state checks: the restore is one commit of exactly the eleven files, and neither the review's two-dot view nor the pull request's three-dot view shows a `.claude/` change (Validation 1).
- The branch-name guard passes (2).
- The two pinned prompt tests pass, and greps confirm that the unpinned `/review` Step 4 and the unit-test switch are back (3).
- The full unit suite passes on the committed tree (4).
- The spec's lint, type, build and `@adw-963` gates show that the #963 fix is untouched (5).

## Notes
- **The root cause is out of scope and still open.**
  - The runner's checkout is on `main` at `3d43b81a`. Its `copyClaudeAssetsToWorktree` (`main:adws/phases/worktreeSetup.ts:212`) copies every runner prompt over the worktree's tracked copies.
  - Main has no `planCommitGuard.ts`, so nothing stopped the plan commit.
  - Dev has both safeguards. In ADW's own repository it leaves tracked `.claude/` paths alone (`adws/phases/worktreeSetup.ts:224-248`). It also fails a plan phase that changes `.claude/` or `.adw/` (`adws/phases/planCommitGuard.ts:9`, `:117`).
  - Until the runner's checkout moves to current dev, every new ADW worktree of this repository will pick up the same stale prompts. The #960 branch (patch `f2mx98`) and the #961 branch (commit `6b14a893`) needed the same restore.
- `adw_init.md` lists the framework hash's `hashInputs`, so the restore also returns the computed hash to dev's value. Do not touch `.adw-version`.
