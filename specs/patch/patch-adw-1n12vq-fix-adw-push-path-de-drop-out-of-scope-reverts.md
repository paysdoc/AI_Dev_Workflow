# Patch: Drop out-of-scope command-file reverts bundled into the #648 plan commit

## Metadata
adwId: `1n12vq-fix-adw-push-path-de`
reviewChangeRequest: `Issue #1: Out-of-scope reverts of MERGED work are bundled into the #648 plan commit (770ceb6), exceeding the spec's scope. .claude/commands/document.md and .claude/commands/adw_init.md revert the merged convergent-docs/semantic-routing feature (already in origin/dev via 17f8548), and README.md adds unrelated additive doc changes. Restore all three to origin/dev state via restore-and-commit-on-top (the revert lives in non-HEAD plan commit 770ceb6 with two clean commits on top and a clean working tree), then re-run the Validation Commands to confirm the #648 fix and tests are unaffected.`

## Issue Summary
**Original Spec:** `specs/issue-648-adw-1n12vq-fix-adw-push-path-de-sdlc_planner-fix-push-force-with-lease.md`

**Issue:** The #648 plan commit `770ceb6` bundled three out-of-scope files that the spec never authorizes (the spec limits changes to `adws/vcs/commitOperations.ts`, its two test files, and the issue-648 spec/feature/steps files):
- `.claude/commands/document.md` — **reverts merged work (blocking harm).** Removes the convergent-docs / semantic-routing feature (`Route by ownership (semantic-first)`, `Collapse sibling entries`, the `Owns:` glob blocks, the rewrite-in-place/`collapseEntries` logic, the current-state module template) and restores the old changelog-style format. `origin/dev` already has this feature (merged via `17f8548`, confirmed an ancestor of `origin/dev`), so this branch would break `/document` convergent routing and re-introduce duplicate `conditional_docs` entries.
- `.claude/commands/adw_init.md` — **reverts merged work (blocking harm).** Removes `.claude/commands/document.md` from `hashInputs` and deletes the semantic-routing `Owns:`/`Conditions:` authoring instructions — same reverted feature.
- `README.md` — **out-of-scope but additive/benign.** Documents `resumePolicy.ts`/`stageClassifier.ts`/`branchIdentity.ts` and file-tree entries; not a revert, restored only for scope hygiene.

This is the recurring "worktree born with dependency reversion" pattern, this time living in a **non-HEAD plan commit** (`770ceb6`), not the working tree.

**Solution:** Restore the three files to `origin/dev` state and commit the restoration **on top** of the current HEAD. The revert lives in plan commit `770ceb6`, which is **not** HEAD — two clean commits sit above it (`e87a76b`, `6a605da`) and the working tree is clean — so amending is impossible and incorrect. Use `git checkout origin/dev -- <files>` to stage only those three files, then a plain `git commit` (no `--amend`, no `git add -A`). This preserves the in-scope #648 fix (`commitOperations.ts`, both test files, `feature-648.feature`, `feature-648.steps.ts`, spec) untouched.

## Files to Modify
Restore each to its `origin/dev` content via `git checkout origin/dev -- <file>` (no hand-editing):

- `.claude/commands/document.md` — undo the convergent-docs/semantic-routing revert (restores merged feature).
- `.claude/commands/adw_init.md` — undo the `hashInputs` + semantic-routing authoring-instruction revert (restores merged feature).
- `README.md` — drop the out-of-scope additive doc changes (scope hygiene).

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom. Run all commands from the repo root (`/Users/martin/projects/paysdoc/AI_Dev_Workflow/.worktrees/bugfix-issue-648-fix-push-force-with-lease`).

### Step 1: Confirm preconditions (clean tree, non-HEAD revert)
- Verify the working tree is clean: `git status --porcelain` returns nothing. (If not clean, stop — the restore-and-commit recipe assumes no unstaged work.)
- Confirm the out-of-scope changes live only in the non-HEAD plan commit: `git log --oneline origin/dev..HEAD -- .claude/commands/document.md .claude/commands/adw_init.md README.md` lists **only** `770ceb6`, and HEAD is `6a605da` (two commits above `770ceb6`). This is why we restore-and-commit-on-top rather than `--amend`.
- Confirm the merged feature is in the base: `git merge-base --is-ancestor 17f8548 origin/dev` exits 0 (convergent-docs is already merged, so the revert is genuinely undoing live functionality).

### Step 2: Restore the three files to origin/dev and commit on top
- Stage only the three files restored to their `origin/dev` content (do **not** `git add -A`, do **not** `git commit --amend`):
  ```
  git checkout origin/dev -- .claude/commands/document.md .claude/commands/adw_init.md README.md
  git commit -m "fix: drop out-of-scope command-file changes from #648"
  ```
- Only the three restored files are committed; the #648 fix commits (`770ceb6`, `e87a76b`, `6a605da`) remain intact below the new commit.

### Step 3: Verify scope is corrected and the #648 fix is intact
- The three files now match `origin/dev` (no diff): `git diff origin/dev HEAD -- .claude/commands/document.md .claude/commands/adw_init.md README.md` prints nothing.
- The branch-vs-base diff now contains **only** the in-scope #648 files: `git diff origin/dev HEAD --stat` lists exactly `adws/vcs/commitOperations.ts`, `adws/vcs/__tests__/commitOperations.test.ts`, `adws/vcs/__tests__/pushBranch.integration.test.ts`, `features/per-issue/feature-648.feature`, `features/step_definitions/feature-648.steps.ts`, and the issue-648 spec file — and no `.claude/commands/*` or `README.md` entries.

### Step 4: Re-run the spec's Validation Commands
- Run the commands in **Validation** below to confirm the #648 fix and its tests are unaffected by the restoration (the restored files are prompt/doc files and do not enter the TypeScript build or test graph, so zero regression is expected).

## Validation
Execute every command to validate the patch is complete with zero regressions. Run from the repo root.

- `git status --porcelain` — clean working tree after the commit (no stray changes).
- `git diff origin/dev HEAD -- .claude/commands/document.md .claude/commands/adw_init.md README.md` — **empty output** (the three files now equal `origin/dev`; the reverts are gone).
- `git diff origin/dev HEAD --stat` — lists **only** the in-scope #648 files (no `.claude/commands/*`, no `README.md`).
- `bun run lint` — ESLint (`eslint .`); no new lint errors.
- `bun run test` — type check (`bunx tsc --noEmit`); no type errors.
- `bunx tsc --noEmit -p adws/tsconfig.json` — additional ADW type check; no type errors.
- `bun run build` — build (`tsc`); compiles cleanly.
- `bunx vitest run adws/vcs/__tests__/commitOperations.test.ts` — the #648 `pushBranch` unit tests still pass.
- `bunx vitest run adws/vcs/__tests__/pushBranch.integration.test.ts` — the real-git integration test still passes.
- `bun run test:unit` — full unit suite (`vitest run`); all tests pass, zero regressions.

## Patch Scope
**Lines of code to change:** 0 hand-written; restoration of 3 files via `git checkout` (~`document.md` 120, `adw_init.md` 11, `README.md` 14 lines reverted to base), captured in one new commit.
**Risk level:** low — restores merged base content to non-code prompt/doc files; the in-scope #648 TypeScript fix and tests are untouched and re-validated.
**Testing required:** Git-state assertions (Steps 3 + first three Validation commands) prove the scope is corrected; re-running the full spec Validation suite proves the #648 fix and tests remain green.
