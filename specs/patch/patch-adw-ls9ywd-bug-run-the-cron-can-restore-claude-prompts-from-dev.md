# Patch: Restore the eleven `.claude/` prompt files that plan commit `fd1746c8` rolled back to the runner's stale `main`

## Metadata
adwId: `ls9ywd-bug-run-the-cron-can`
reviewChangeRequest: `` Issue #1: Out-of-scope regression: plan commit fd1746c8 replaced 11 .claude/ files with stale copies, reverting prompt work already merged on dev. The files are commands/adw_init.md, clean_local_repo.md, document.md, feature.md, generate_step_definitions.md, resolve_conflict.md, resolve_failed_test.md, review.md and scenario_writer.md, and skills/depaudit-triage/SKILL.md and skills/implement-tdd/SKILL.md. The stale copies hardcode main/origin/main instead of resolving the default branch, which is dev here, so /document would diff against the wrong base. They read the unit-test switch from .adw/project.md instead of .github/adw.yml, and they drop the adw:bug routing label, ADR Decisions handling, the review's step-definition independence check and the scenario writer's Gherkin and no-commentary rules. Effects: `bun run lint:branch-names`, which CI runs in .github/workflows/git-cli-guard.yml, fails with 8 violations, all in these files; it passes on origin/dev. features/per-issue/feature-933.feature:289 ('The branch-name check passes on the ADW checkout') passes on origin/dev but fails on this branch, which breaks the acceptance criterion that scenarios passing on dev still pass. On the committed HEAD, adws/__tests__/adwInitPrompt.test.ts and adws/__tests__/depauditTriageSkill.test.ts also fail; they pass locally only because of uncommitted working-tree restores of adw_init.md and depaudit-triage/SKILL.md.
Resolution: Restore the whole directory with `git checkout origin/dev -- .claude/` (issue 967 needs no .claude/ change) and commit it. Then confirm that `git diff origin/dev --stat -- .claude/` is empty, that `bun run lint:branch-names` and `bun run test:unit` pass on a clean tree, and that `NODE_OPTIONS='--import tsx' bunx cucumber-js --tags '@adw-933' --name 'The branch-name check passes on the ADW checkout'` passes. ``

## Issue Summary
**Original Spec:** `specs/issue-967-adw-ls9ywd-bug-run-the-cron-can-sdlc_planner-real-process-cron-cancel-promotion-smoke.md`

**Issue:** Plan commit `fd1746c8` is the only commit on the branch that touches `.claude/`. It replaced eleven prompt and skill files, none of which the spec names, with byte-identical copies of `main` at `3d43b81a`, the ADW runner's stale checkout. Issue 967 needs no `.claude/` change. `origin/dev` is `dd689964`, which is also the merge base, so every `.claude/` difference is this branch rolling dev back. Planning confirmed every effect the review lists:
- **Dev's text is missing from the committed copies.** Counts are dev → `HEAD`:
  - `review.md`: `## Step 4: Step Definition Independence Check` (line 47 on dev) → absent.
  - `document.md`: lines naming `Decisions` 11 → 0; `origin/main` 0 → 3.
  - `resolve_failed_test.md`: `origin/main` 0 → 1.
  - `clean_local_repo.md:12`: back to deleting every branch `except main and develop`, which includes `dev`.
  - `feature.md` and `implement-tdd/SKILL.md`: `.github/adw.yml` 2 → 0 and 1 → 0. Both read the unit-test switch from `.adw/project.md` instead.
  - `adw_init.md`: `adw.yml` 9 → 0.
  - `generate_step_definitions.md`: `## BDD Framework` 3 → 0.
  - `scenario_writer.md`: lines naming `Gherkin` or `commentary` 6 → 2.
  - `depaudit-triage/SKILL.md`: `--label adw:bug` 1 → 0; `/adw_*` orchestrator commands 0 → 3.
- **The branch-name guard fails, so CI fails.** `bun run lint:branch-names` exits 1 on a `git archive HEAD` export and on the current worktree. Both report the same 8 violations:
  - `clean_local_repo.md:12`
  - `document.md:6`, `:17`, `:18`, `:19`
  - `resolve_conflict.md:12`
  - `resolve_failed_test.md:16`
  - `review.md:17`

  The `branch-names` job of `.github/workflows/git-cli-guard.yml` runs this guard on every push and pull request.
- **feature-933's scenario fails.** `features/per-issue/feature-933.feature:289` runs the guard over the checkout. On the current worktree it reports `1 scenario (1 failed)`.
- **The pinned prompt tests fail on the committed tree.** In a `git archive HEAD` export, 5 of the 6 tests in `adws/__tests__/adwInitPrompt.test.ts` and `adws/__tests__/depauditTriageSkill.test.ts` fail. Only `routes adw:bug to the full SDLC orchestrator` passes.
  - The current worktree passes: `bun run test:unit` reports 213 files and 3320 tests passed.
  - It passes only because `adw_init.md` and `depaudit-triage/SKILL.md` already hold dev's content as unstaged, uncommitted changes. The other nine files are still rolled back.
- **The pull request carries the rollback.** `git diff origin/dev...HEAD --name-only` lists 43 files, 11 of them under `.claude/`.

**Solution:** Run the review's `git checkout origin/dev -- .claude/`, then commit only `.claude/` on top of `HEAD`. No history rewrite is needed.
- `git diff --name-status origin/dev HEAD -- .claude/` lists exactly the eleven files, all `M`, and nothing under `.claude/` is untracked or ignored. The whole-directory checkout therefore changes only those eleven, back to the content the branch started from.
- **Measured in advance** on a `git archive HEAD` export with `origin/dev`'s `.claude/` on top:
  - its `.claude/` is identical to dev's (`diff -r`);
  - `bunx tsx adws/checkBranchNames.ts <export>` prints `✔ PASS  No file names a branch to act on.`;
  - the two pinned test files pass, 6 of 6;
  - feature-933's scenario reports `1 scenario (1 passed)`.
- **Rejected alternatives:**
  - `git revert fd1746c8`. That commit also carries the spec, `README.md` and the `features/` rewrites.
  - A rebase that drops the files from `fd1746c8`. It gives the same tree but needs a force-push.
  - Committing only the two working-tree restores. The other nine stay rolled back and the guard still fails.
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
- Keep the #967 work as committed: the spec, `README.md`, and the files under `features/` and `test/`.
- Leave `.adw-version` alone (see Notes).
- Do not fetch, merge dev, rebase, amend or push.

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

Run every command from the worktree root. This patch changes no behaviour, so even in TDD mode it has no RED step. Do not add or change tests, step definitions or `.feature` files.

### Step 1: Confirm the starting state
- Check the refs. Do not fetch.
  - `git rev-parse HEAD` prints `bd9da8c5742baaacc46a57810dcdfe013a767851`.
  - `git rev-parse origin/dev` and `git merge-base HEAD origin/dev` both print `dd6899646955193fc9041194b4f3ed871b8ba3d5`.
- `git log --oneline origin/dev..HEAD -- .claude/` lists only `fd1746c8 plan-orchestrator: fix: run cron, cancel, promotion smoke as real procs`.
- `git status --porcelain` prints these two lines, plus this plan file as `??` unless the runner has already committed it:
  ```
   M .claude/commands/adw_init.md
   M .claude/skills/depaudit-triage/SKILL.md
  ```
  Both files already hold dev's content: `git diff --name-only origin/dev -- .claude/` lists only the other nine.
- **If the state differs:**
  - If `HEAD` differs, continue only if the `git log` check still lists just `fd1746c8` and `git status` shows nothing else under `.claude/`.
  - If `origin/dev` no longer equals the merge base and `git diff --name-only dd689964 origin/dev -- .claude/` lists files, dev changed its prompts after the branch point. Run Step 2 with `dd689964` in place of `origin/dev`. Then report that Validation 1's `origin/dev` checks now list only dev's newer changes.
  - Otherwise stop and report. Never fall back to hand edits.

### Step 2: Restore `.claude/` from `origin/dev`
- Run the review's command exactly:
  ```sh
  git checkout origin/dev -- .claude/
  ```
- It sets the index and the working tree of every tracked path under `.claude/` to dev's content. Only the eleven files differ, so only they change. The two already-restored files keep the content they have.
- Check the result:
  - `git diff --cached --stat` lists exactly the eleven paths and ends with `11 files changed, 182 insertions(+), 75 deletions(-)`;
  - `git diff --name-only -- .claude/` prints nothing, so nothing under `.claude/` is left unstaged.

### Step 3: Commit only `.claude/`
- Run:
  ```sh
  git commit \
    -m "patchAgent: fix: restore .claude prompts to origin/dev" \
    -m "Creating the worktree copied the ADW runner's stale main checkout over the tracked .claude/ prompts, and plan commit fd1746c8 picked up eleven of them. Restore them to origin/dev, which is also the merge base, so the pull request carries no .claude change, the branch-name guard and feature-933's branch-name scenario pass again, the adw_init and depaudit-triage prompt tests pass on the committed tree, and merging keeps dev's text in all eleven prompts." \
    -- .claude/
  ```
- If your harness asks for an attribution trailer, add it as a final `-m`.
- The pathspec commits only the tracked paths under `.claude/`, which are the eleven restored files.
- Do not use `git add -A`, `git commit -a`, `--amend`, `git revert`, a rebase or a push.
- Leave this plan file untracked. The runner's review-patch commit adds it after the build, as `07edd5b4` did for #966's restore plan.

### Step 4: Run the validation
- Run every command under `## Validation`, in order.
- This patch changes only prompt text, so a failing gate means the restore went wrong. Re-check Steps 2 and 3 and fix it there.
- Do not edit any other file to make a gate pass. If a gate fails for a reason outside `.claude/`, report it with its output.

## Validation
Execute every command to validate the patch is complete with zero regressions.

Run each command from the worktree root, one at a time, without fetching. Never run two Cucumber processes from this checkout at once.

1. **The restore is one commit of exactly the eleven files, and the branch no longer changes `.claude/`.**
   - `git show --format= --name-only HEAD` prints exactly the eleven paths of `Files to Modify`.
   - `git diff origin/dev --stat -- .claude/` prints nothing. This is the review's check; before the patch it lists nine files.
   - `git diff origin/dev HEAD -- .claude/` and `git diff origin/dev...HEAD --name-only -- .claude/` print nothing. These are the committed tree and the pull request's view; before the patch each lists all eleven.
   - `git status --porcelain -- .claude/` prints nothing, so the gates below test the committed prompts on a clean tree.
   - `git diff origin/dev...HEAD --name-only | wc -l` prints `32`: the spec, `README.md`, 24 files under `features/` and 6 under `test/`. Before the patch it prints `43`.
2. **The branch-name guard, its scenario and the rest of the CI guard pass.**
   - `bun run lint:branch-names` exits 0 and prints `✔ PASS  No file names a branch to act on.` Before the patch it exits 1 with the 8 violations listed in the Issue Summary.
   - `NODE_OPTIONS='--import tsx' bunx cucumber-js --tags '@adw-933' --name 'The branch-name check passes on the ADW checkout'` exits 0 with `1 scenario (1 passed)`. Before the patch it reports `1 scenario (1 failed)`.
   - `bun run lint:git-guard` and `bun run lint:docs-index` exit 0, so all three jobs of `.github/workflows/git-cli-guard.yml` pass.
3. **The unit suite passes on the committed tree.**
   - `bunx vitest run adws/__tests__/adwInitPrompt.test.ts adws/__tests__/depauditTriageSkill.test.ts` reports `Test Files  2 passed (2)` and `Tests  6 passed (6)`.
   - `bun run test:unit` reports `Test Files  213 passed (213)` and `Tests  3320 passed (3320)`.
4. **Dev's unpinned text is back.** No test pins it, so run each command and compare its output:
   - `grep -n '^## Step 4: Step Definition Independence Check' .claude/commands/review.md` matches line 47.
   - `grep -c 'Decisions' .claude/commands/document.md` prints `11`.
   - `grep -c '\.github/adw\.yml' .claude/commands/feature.md .claude/skills/implement-tdd/SKILL.md` prints `2` for `feature.md` and `1` for `SKILL.md`.
   - `grep -c 'adw\.yml' .claude/commands/adw_init.md` prints `9`.
   - `grep -c '## BDD Framework' .claude/commands/generate_step_definitions.md` prints `3`.
   - `grep -c -e 'Gherkin' -e 'commentary' .claude/commands/scenario_writer.md` prints `6`. Before the patch it prints `2`.
   - `grep -c -e '--label adw:bug' .claude/skills/depaudit-triage/SKILL.md` prints `1`.
   - `grep -c -e 'except main and develop' -e 'origin/main' .claude/commands/clean_local_repo.md .claude/commands/document.md .claude/commands/resolve_failed_test.md` prints `0` for each file. Before the patch it prints `1`, `3` and `1`.
5. **No regression on the spec's gates that the restore can reach.**
   - Each exits 0: `bun run lint`, `bunx tsc --noEmit`, `bunx tsc --noEmit -p adws/tsconfig.json`, `bun run build`.
   - Run the four smoke scenarios with the spec's state snapshot around them:
     ```sh
     shasum agents/.auth_gate agents/paused_queue.json agents/cron/acme_widgets.json logs/agents/cron/acme_widgets.log > /tmp/adw-967-patch-state.before 2>&1 || true
     NODE_OPTIONS="--import tsx" bunx cucumber-js features/regression/smoke/cron_trigger_spawn.feature features/regression/smoke/cancel_directive.feature features/regression/smoke/promotion_threshold_auto_ramp.feature
     shasum agents/.auth_gate agents/paused_queue.json agents/cron/acme_widgets.json logs/agents/cron/acme_widgets.log > /tmp/adw-967-patch-state.after 2>&1 || true; diff /tmp/adw-967-patch-state.before /tmp/adw-967-patch-state.after
     ```
     The Cucumber run exits 0 with `4 scenarios (4 passed)`, and `diff` prints nothing.
   - `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression and @subprocess"` exits 0 with `10 scenarios (10 passed)`.
   - **Why these two Cucumber gates:**
     - `adw_init.md` and `document.md` are framework-hash inputs (`hashInputs:`). The restore moves the computed hash from `5a2892c8…`, the mixed worktree the build validated on, to dev's `bd150741…`.
     - The subprocess rows, which include the cron and promotion smoke scenarios, run only when the fixture's `.adw-version` matches the hash that the child's upgrade gate computes. Both sides compute it at run time (`features/regression/support/fixtureTargetRepo.ts:30`, `adws/phases/upgradeGate.ts:99`), so the rows should still pass. These runs confirm it.
     - The build's own runs reported `4 scenarios (4 passed)` and `10 scenarios (10 passed)`.
   - **The spec's other Cucumber gates are not needed.** No step reads the text of the eleven files from the checkout:
     - feature-930 writes its own fixture copies;
     - feature-933-cli names the commands only as strings;
     - `lint:git-guard` skips `.claude/`.
   - Last, `git status --porcelain` prints only this plan file as `??`, or nothing if the runner has committed it. Nothing is listed under `.claude/`, `agents/` or `logs/`.

## Patch Scope
**Lines of code to change:** 0 written by hand. `git checkout` restores dev's content of eleven prompt files (182 lines added, 75 removed), all in one commit.
**Risk level:** low
**Testing required:**
- Git-state checks: the branch no longer changes `.claude/` in the working tree, the committed tree or the pull request's view (Validation 1).
- The branch-name guard, feature-933's scenario and the other two CI guard jobs (2).
- The pinned prompt tests and the full unit suite on the committed tree (3), and greps for dev's unpinned text (4).
- The spec's lint, type and build gates, the four smoke scenarios with the state snapshot, and the hash-sensitive `@regression and @subprocess` rows (5).

## Notes
- **The root cause is out of scope and still open.** It is the same one #966 hit.
  - The runner's checkout is `main` at `3d43b81a`. Its `copyClaudeAssetsToWorktree` (`main:adws/phases/worktreeSetup.ts:212`) copies every runner prompt over the worktree's tracked copies. For this repository, main calls it when it creates the worktree (`main:adws/phases/workflowInit.ts:277-278`).
  - Main has no `planCommitGuard.ts`, so nothing stopped the plan commit.
  - Dev has both safeguards. In ADW's own repository it leaves tracked `.claude/` paths alone (`adws/phases/worktreeSetup.ts:237-242`). It also fails a plan phase that changes `.claude/` or `.adw/` (`adws/phases/planCommitGuard.ts:117`, ADR-0056).
  - Until the runner's checkout moves to current dev, every new ADW worktree of this repository picks up the same stale prompts. The #965 (`133866bc`) and #966 (`4e5ef7be`) branches needed this same restore.
- **The restore persists for this run.** When main reuses an existing worktree (`main:adws/phases/workflowInit.ts:262-267` and `:271-275`), it merges the default branch and copies `.env`, but does not copy prompts.
- **Leave `.adw-version` alone.**
  - The committed value is `58ba2954…` on both `HEAD` and dev.
  - After the restore, the tree computes dev's `bd150741…`, so the branch has the same gap dev already has. Closing it is not this patch's job.
  - No test pins the repository's own `.adw-version`.
