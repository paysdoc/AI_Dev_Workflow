# Patch: Restore out-of-scope reverts of `document.md` and `adw_init.md` to origin/dev

## Metadata
adwId: `d0hv98-refactor-exhaustive`
reviewChangeRequest: `Issue #1: Out-of-scope reversion of already-merged work in two command files, committed in plan commit e268c5e (NOT in the in-scope build commit 95e085d, so git diff HEAD misses it — only git diff origin/dev surfaces it). Issue #636 is purely the stage classifier and its Relevant/New Files list does not include either command file. (1) .claude/commands/document.md is rolled back from the semantic-first routing / collapse-siblings / rewrite-in-place / current-state-module-reference template to the old "Generate Documentation / What Was Built / changelog" form, re-breaking /document convergence (duplicate conditional_docs entries instead of one converged entry per module). (2) .claude/commands/adw_init.md is stripped of its Owns: glob-seeding instructions and drops document.md from its hashInputs. The convergent-docs system being reverted (commit 17f8548) is an ancestor of the fork point (merge-base 6c42a32), confirming an active revert of merged work rather than a stale branch. This is the third occurrence of this exact reversion (#612, #641, now #636) on these same two files. Resolution: Restore both files to their origin/dev state — the #636 stage-classifier work must not touch them. Run: git checkout origin/dev -- .claude/commands/document.md .claude/commands/adw_init.md, then commit. Verify with git diff origin/dev -- .claude/commands/ showing no changes.`

## Issue Summary
**Original Spec:** `specs/issue-636-adw-d0hv98-refactor-exhaustive-sdlc_planner-exhaustive-stage-classifier.md`

**Issue:** The #636 branch carries an out-of-scope reversion of two already-merged command-prompt files. Issue #636 is *purely* the exhaustive stage classifier (`adws/core/stageClassifier.ts` + cron/takeover rerouting); its "Relevant Files" / "New Files" lists name only `adws/` modules — neither command file appears anywhere in scope. Yet the branch reverts:
1. **`.claude/commands/document.md`** — rolled back from the semantic-first routing / collapse-siblings / rewrite-in-place / current-state-module-reference template to the legacy "Generate Documentation / What Was Built" form. This re-breaks `/document` convergence (each run appends a *new* `conditional_docs` entry instead of converging to one entry per module).
2. **`.claude/commands/adw_init.md`** — strips the `Owns:` glob-seeding instructions from the conditional-docs seeding step and drops `.claude/commands/document.md` from its `hashInputs` (so `document.md` changes no longer retrigger `adw_init` regen).

The reversion is **committed in the plan commit `e268c5e`** (not the in-scope build commit `95e085d`), so the working tree is clean and `git diff HEAD` shows nothing — only `git diff origin/dev` surfaces it. Verified active-revert (not stale-branch): the convergent-docs commit `17f8548` is an ancestor of the fork point (`git merge-base --is-ancestor 17f8548 6c42a32` → true). This is the **third occurrence** of this exact reversion on these same two files (#612, #641, now #636).

**Solution:** Restore both files verbatim to their `origin/dev` state with a single `git checkout origin/dev -- …`. This is the minimal change (no hand-editing, no source-code touch) and is exactly the resolution prescribed in the review. The #636 classifier work (the other 10 changed files) is untouched.

## Files to Modify
Restore these two files only — both fully reverted to their `origin/dev` blobs:

- `.claude/commands/document.md` — restore the semantic-first routing / collapse-siblings / rewrite-in-place / current-state-module-reference template.
- `.claude/commands/adw_init.md` — restore the `Owns:` glob-seeding instructions and re-add `.claude/commands/document.md` to `hashInputs`.

No `adws/` source, test, feature, or spec files are touched by this patch.

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Restore both command files from origin/dev
- Run exactly:
  ```bash
  git checkout origin/dev -- .claude/commands/document.md .claude/commands/adw_init.md
  ```
- This is the whole fix — it overwrites the two reverted files with their merged `origin/dev` content. Use `git checkout` (not hand-editing) so the restoration is byte-exact and cannot reintroduce drift.

### Step 2: Verify the out-of-scope reversion is gone and #636 work is intact
- Confirm the two command files now match `origin/dev` exactly (empty output expected):
  ```bash
  git diff origin/dev -- .claude/commands/
  ```
- Confirm `adw_init.md`'s `hashInputs` once again lists `document.md` (non-empty match expected):
  ```bash
  grep -n "document.md" .claude/commands/adw_init.md
  ```
- Confirm the in-scope #636 classifier work is still present and unchanged (should still list `adws/core/stageClassifier.ts`, the cron/takeover files, `features/per-issue/feature-636.*`, and the spec — and must NOT list either `.claude/commands/*.md`):
  ```bash
  git diff --stat origin/dev -- adws/ features/ specs/
  git diff --stat origin/dev -- .claude/commands/   # must be empty
  ```

### Step 3: Commit the restoration
- Stage and commit only the two restored files (the ADW commit phase may also handle this; if committing here, scope the commit to these paths):
  ```bash
  git add .claude/commands/document.md .claude/commands/adw_init.md
  git commit -m "patch: restore out-of-scope reverts of document.md and adw_init.md to origin/dev (#636)"
  ```

## Validation
Execute every command to validate the patch is complete with zero regressions. The first two commands are the primary acceptance proof; the rest confirm the in-scope #636 work is unaffected. (No TypeScript changed, so the typecheck/test commands are a regression sanity check only — markdown command-prompt files cannot affect `tsc`/Vitest.)

- `git diff origin/dev -- .claude/commands/` — **primary proof; MUST print nothing** (both command files match merged `origin/dev`).
- `grep -n "document.md" .claude/commands/adw_init.md` — confirms `hashInputs` restored (non-empty).
- `git diff --stat origin/dev -- .claude/commands/` — MUST be empty (no command-file delta remains on the branch).
- `git diff --stat origin/dev -- adws/ features/ specs/` — confirms the #636 classifier work (`stageClassifier.ts`, cron/takeover reroute, `feature-636.*`, spec) is still intact and untouched by this patch.
- `bunx tsc --noEmit -p adws/tsconfig.json` — regression sanity: the exhaustiveness `never` guard still compiles (unaffected by the revert, must stay green).
- `bunx vitest run adws/core/__tests__/stageClassifier.test.ts` — regression sanity: the classifier suite still passes (unaffected by the revert).

## Patch Scope
**Lines of code to change:** 0 source lines. Restores ~131 lines across 2 prompt-only files (120 in `document.md`, 11 in `adw_init.md`) via `git checkout` — restoration, not authored code.
**Risk level:** low — pure revert-of-a-revert of two non-executable command-prompt files back to their already-merged state; no `adws/` source, test, or build artifact is touched.
**Testing required:** Git-diff verification that both command files equal `origin/dev` and that the in-scope #636 classifier work is unchanged, plus an ADW typecheck + classifier-test sanity pass (expected green, unaffected by markdown changes).
