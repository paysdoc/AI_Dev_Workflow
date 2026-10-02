# Patch: Restore the eleven `.claude/` prompt files that the plan commit reverted to the runner's stale `main`

## Metadata
adwId: `f2mx98-bug-regression-then`
reviewChangeRequest: `` Issue #1: Plan commit 2afe206e makes changes outside the spec. It replaced 11 prompt files with byte-identical copies from the main checkout, which is on `main` at 3d43b81a, behind dev: `.claude/commands/{adw_init,clean_local_repo,document,feature,generate_step_definitions,resolve_conflict,resolve_failed_test,review,scenario_writer}.md` and `.claude/skills/{depaudit-triage,implement-tdd}/SKILL.md`. The spec says nothing else changes, and merging would undo dev's versions. (1) `bun run lint:branch-names` exits 1 with 8 violations, none of them present at merge base ddaf010a. They are at clean_local_repo.md:12, document.md:6/17/18/19, resolve_conflict.md:12, resolve_failed_test.md:16 and review.md:17, all hard-coded `main`, `develop` or `origin/main`. The `branch-names` job in `.github/workflows/git-cli-guard.yml` runs this check. (2) The committed `adw_init.md` has no `.github/adw.yml` heredoc and no Comments entry. The committed depaudit-triage SKILL.md still contains `/adw_sdlc` and has no `--label adw:bug`. So `adws/__tests__/adwInitPrompt.test.ts` and `adws/__tests__/depauditTriageSkill.test.ts` fail against the committed tree. `bun run test:unit` (203 files, 3114 tests) passes locally only because those two files are restored in the working tree but not committed: one staged, one unstaged. (3) `review.md` loses its Step 4 step-definition independence check. `feature.md` and `implement-tdd/SKILL.md` go back to reading the unit-test switch from `.adw/project.md` instead of `unitTests` in `.github/adw.yml`. The README.md additions in the same commit are also out of scope, but every file they name exists, so they are harmless.
Resolution: Restore `.claude/` from dev, which has not changed it since the merge base: `git checkout origin/dev -- .claude/`. This also picks up the two restorations that are still uncommitted. Commit the result. Then confirm that `git diff origin/dev...HEAD --name-only -- .claude/` prints nothing, and that `bun run lint:branch-names` and `bun run test:unit` both pass. ``

## Issue Summary
**Original Spec:** `specs/issue-960-adw-f2mx98-bug-regression-then-sdlc_planner-then-steps-assert-runtime-artefacts.md`

**Issue:** The plan commit `2afe206e` (`HEAD~2`) carries eleven `.claude/` prompt files that the #960 fix never touches. The spec's Solution Statement says "Nothing else changes". All eleven are modifications; nothing is added or deleted. Each one is byte-identical to the runner's checkout on `main` at `3d43b81a`. That checkout runs main's `copyClaudeAssetsToWorktree`, which has no tracked-path guard. It copied the runner's prompts over the worktree's tracked copies when the worktree was created (main's `adws/phases/workflowInit.ts:278`), and the plan commit's `git add -A` then staged them. Planning confirmed every effect the review lists:
- `bun run lint:branch-names` exits 1 with the 8 violations listed: `clean_local_repo.md:12`, `document.md:6`, `:17`, `:18`, `:19`, `resolve_conflict.md:12`, `resolve_failed_test.md:16` and `review.md:17`. None of them exists at the merge base. The `branch-names` job of `.github/workflows/git-cli-guard.yml` runs this guard on every pull request.
- In a throwaway export of the committed tree, 5 of the 6 tests in `adws/__tests__/adwInitPrompt.test.ts` and `adws/__tests__/depauditTriageSkill.test.ts` fail. The committed `adw_init.md` mentions `adw.yml` 0 times, against 9 on dev. The committed depaudit-triage skill names `/adw_sdlc` on 3 lines and has no `--label adw:bug`. `bun run test:unit` passes in the worktree only because `adw_init.md` (staged) and `depaudit-triage/SKILL.md` (unstaged) are restored but not committed.
- Merging would strip dev's newer text: `/review` Step 4, the step-definition independence check; the `unitTests` switch in `.github/adw.yml` that `/feature` and `implement-tdd` read; `/adw_init`'s `.github/adw.yml` heredoc and Comments entry; and depaudit-triage's `adw:bug` routing. Dev's changes to `/document`, `/generate_step_definitions` and `/scenario_writer` would be lost too.

**Solution:** Restore `.claude/` with one `git checkout` from the branch's merge base with dev, then commit only `.claude/` on top of `HEAD`. No history rewrite is needed.
- **Restore source.** The source is the merge base (`ddaf010a`), not the moving `origin/dev` ref, and the content is the same:
  - After a fetch at planning time (`origin/dev` = `f35d68d4`, PR #969), `git diff --name-only ddaf010a origin/dev -- .claude/` printed nothing. Both refs hold identical `.claude/` content, so the result is exactly the review's `git checkout origin/dev -- .claude/`.
  - The merge base keeps the restore exact if dev changes `.claude/` before the build runs. In that case `origin/dev` would pull dev's newer prompts into the branch diff, and the review's three-dot check would list them.
- **Equivalent to dropping the files.** Only `2afe206e` touches `.claude/` on the branch, so a restore commit leaves the same net tree as dropping the eleven files from that commit.
- **Pending restorations.** The checkout also picks up the two restorations already pending in the worktree.
- **Measured in advance.** Planning built a throwaway export of the `HEAD` tree with the merge base's `.claude/` on top. There the two pinned test files pass (6 of 6) and the branch-name guard prints `✔ PASS  No file names a branch to act on.`
- **The restore persists.** On this repository's path, main's `workflowInit.ts` copies prompts only when it creates a worktree (`:278`). Reusing a worktree only merges the default branch and copies `.env` (`:272-275`). Agents read slash commands from the worktree, so this run's later phases use dev's `/review` and `/document`.

Alternatives considered and rejected:
- `git revert 2afe206e`. It also deletes the spec and the README additions.
- A rebase that drops the files from `2afe206e`. It gives the same net tree but needs a force-push.
- `git show 2afe206e -- .claude/ | git apply -R`. It gives the same result in more steps.
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
- Leave `README.md` alone. The review rules its additions harmless, and its resolution covers only `.claude/`.
- Leave the #960 fix exactly as committed: `features/`, `specs/adr/0037-tiered-regression-suite-with-fixed-vocabulary.md` and the spec.
- Leave `.adw-version` alone. The branch does not change it.
- Do not merge dev into the branch, rebase, amend or push.

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

Run every command from the worktree root. This patch changes no behaviour, so even in TDD mode it has no RED step. Do not add or change tests, step definitions or `.feature` files.

### Step 1: Confirm the starting state
- `git rev-parse HEAD` prints `ee84e005c00f2efc0861af814812de91200266fc`, and `git merge-base HEAD origin/dev` prints `ddaf010ada3f73b83a4b8b42a5e93b791f841d33`.
- Only the plan commit touches `.claude/` on the branch. This lists only `2afe206e plan-orchestrator: fix: add plan for runtime-artefact Then steps`:
  ```sh
  git log --oneline "$(git merge-base HEAD origin/dev)"..HEAD -- .claude/
  ```
- Dev has not changed `.claude/` since the merge base. This prints nothing:
  ```sh
  git diff --name-only "$(git merge-base HEAD origin/dev)" origin/dev -- .claude/
  ```
- `git status --porcelain` prints exactly these three lines and nothing else:
  ```
  M  .claude/commands/adw_init.md
   M .claude/skills/depaudit-triage/SKILL.md
  ?? specs/patch/patch-adw-f2mx98-bug-regression-then-restore-claude-prompts-from-dev.md
  ```
- If `HEAD` or the merge base differs, the steps still apply as long as the two checks above hold. If either check fails, stop and report. Do not fall back to hand edits.

### Step 2: Restore `.claude/` from the merge base
- Run exactly:
  ```sh
  git checkout "$(git merge-base HEAD origin/dev)" -- .claude/
  ```
- This sets the index and the working tree of every tracked path under `.claude/` to the merge base's content. Only the eleven files differ, so only they change.
  - Untracked and ignored files under `.claude/` are left alone. No fetch is needed.
  - `adw_init.md` is already staged at that content. `depaudit-triage/SKILL.md` already has it in the working tree, and the checkout stages it.
  - `.claude/commands/adw_init.md` matches a `.gitignore` entry but is tracked, so `git checkout` and the commit below treat it like the others. No `-f` is needed.
- Check the result:
  - `git diff --cached --stat` lists exactly the eleven paths and ends with `11 files changed, 182 insertions(+), 75 deletions(-)`.
  - `git diff --name-only -- .claude/` prints nothing, so nothing under `.claude/` is left unstaged.

### Step 3: Commit only `.claude/`
- Run:
  ```sh
  git commit \
    -m "patchAgent: fix: restore .claude prompts reverted by plan commit" \
    -m "Creating the worktree copied the ADW runner's stale main checkout over the tracked .claude/ prompts, and the plan commit picked them up. Restore them to the branch point so the branch-name guard and the adw_init and depaudit-triage prompt tests pass, and merging keeps dev's newer /review, /feature, /adw_init, /document, generate_step_definitions, scenario_writer, implement-tdd and depaudit-triage text." \
    -- .claude/
  ```
- The pathspec commits the tracked paths under `.claude/`, which are the eleven restored files, and nothing else.
- Do not use `git add -A`, `git commit -a`, `--amend`, `git revert`, a rebase or a push.
- Leave this plan file untracked. The review-patch loop commits it right after this build and then pushes the branch: `runCommitAgent('review-patch-agent', …)` followed by `gitCtx.pushBranch` (`adws/phases/reviewPhase.ts:260-271`).

### Step 4: Run the validation
- Run every command under `## Validation`.
- This patch changes only prompt text. If a gate fails for a reason outside `.claude/`, report it. Do not change any other file to fix it.

## Validation
Execute every command to validate the patch is complete with zero regressions.

Use `origin/dev` as it stands, without fetching.

1. **The restore is one commit of exactly the eleven files, and the branch no longer changes `.claude/`.**
   - `git show --format= --name-only HEAD` and `git diff --name-only ee84e005 HEAD` each print exactly the eleven paths of `Files to Modify`.
   - `git diff origin/dev...HEAD --name-only -- .claude/` prints nothing. This is the review's check. Before the patch it prints the eleven paths.
   - `git status --porcelain -- .claude/` prints nothing.
   - `git diff origin/dev...HEAD --name-only` lists 12 files, none of them under `.claude/`:
     - `README.md`, the spec and `specs/adr/0037-tiered-regression-suite-with-fixed-vocabulary.md`;
     - the nine `features/` files of the #960 fix.
2. **The branch-name guard passes.** `bun run lint:branch-names` exits 0 and prints `✔ PASS  No file names a branch to act on.` Before the patch it exits 1 with the 8 violations the review lists.
3. **Dev's prompt text is back.**
   - `bunx vitest run adws/__tests__/adwInitPrompt.test.ts adws/__tests__/depauditTriageSkill.test.ts` reports `Test Files  2 passed (2)` and `Tests  6 passed (6)`. In a throwaway export of the pre-patch committed tree, 5 of the 6 fail.
   - No test pins `review.md` Step 4 or the unit-test switch, so check them directly:
     - `grep -n "^## Step 4: Step Definition Independence Check" .claude/commands/review.md` matches line 47.
     - `grep -c '\.github/adw\.yml' .claude/commands/feature.md .claude/skills/implement-tdd/SKILL.md` prints `2` for `feature.md` and `1` for `SKILL.md`. Both print `0` before the patch.
4. **The unit suite passes on the committed content.** `bun run test:unit` passes: 203 files and 3114 tests at review time.
   - Validation 1 shows that nothing under `.claude/` is staged or modified any more, so this run tests the committed prompts and not uncommitted restorations.
5. **Zero regressions, using the spec's gates.** Run these one after the other:
   - `bun run lint`
   - `bunx tsc --noEmit`
   - `bunx tsc --noEmit -p adws/tsconfig.json`
   - `bun run build`
   - `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-960" > /tmp/adw-960-patch.after 2>&1; echo "exit=$?"; tail -n 3 /tmp/adw-960-patch.after`. Expect exit 0 and every scenario passed.

   No Cucumber scenario reads the wording of the eleven files, and the only unit tests that do are the two in Validation 3. Features 932, 937 and 938 defer to those vitest files under the rot rubric. So these gates give the same results as before the patch.

## Patch Scope
**Lines of code to change:** 0 written by hand. `git checkout` restores the merge-base content of eleven prompt files (182 lines added, 75 removed), all in one restore commit.
**Risk level:** low
**Testing required:**
- Git-state checks: the restore is one commit of exactly the eleven files, and the branch no longer changes `.claude/` (Validation 1).
- The branch-name guard passes (2).
- The two pinned prompt tests pass, and greps confirm the unpinned `/review` Step 4 and unit-test switch are back (3).
- The full unit suite passes on the committed tree (4).
- The spec's lint, type, build and `@adw-960` scenario gates show the #960 fix is untouched (5).

## Notes
- The root cause is out of scope and still open. The runner's checkout is still on `main` at `3d43b81a`, and its `copyClaudeAssetsToWorktree` overwrites tracked prompts when it creates a worktree. Dev's version of the same function leaves tracked `.claude/` paths alone in ADW's own repository (`adws/phases/worktreeSetup.ts:235-248`), so moving the runner's checkout to the current dev stops this recurring. Patches `axbb2a`, `3lva71` and `0mdjtu` fixed the same failure on other branches.
- Do not touch `.adw-version`. `adw_init.md` lists the framework hash's `hashInputs`, so the restore also returns the computed hash to dev's value.
