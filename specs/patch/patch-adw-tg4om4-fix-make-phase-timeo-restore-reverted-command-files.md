# Patch: Restore three out-of-scope command/doc files reverted by the #637 worktree

## Metadata
adwId: `tg4om4-fix-make-phase-timeo`
reviewChangeRequest: `Issue #1: This branch's commits revert merged out-of-scope work that is unrelated to issue #637, exactly the 'worktree born with dependency reversion' hazard the plan's Worktree-Hygiene note said to blocker. Evidence (merge-base = d624634, the #636/#644 merge; origin/dev's 7 newer commits never touch these files, so origin/dev == merge-base for them): (1) .claude/commands/adw_init.md — removes the Owns:/Conditions: semantic-routing instruction block and drops .claude/commands/document.md from hashInputs; that content was added by merged commits 17f8548/6fc0597/e9b82d4 ('semantic routing and sibling collapse' / 'conditional docs registry'), all ancestors of the merge-base and still present on origin/dev — i.e. an active revert of merged work, not stale-branch drift. (2) .claude/commands/document.md — a 120-line rewrite (63 lines that origin/dev has removed, 57 added) of the same merged /document semantic-routing command. (3) README.md — an out-of-scope additive edit (4 lines to the file-tree listing) not part of #637. Merging this branch would re-revert document.md/adw_init.md on dev, re-introducing the conditional-docs regression that commit 6ea6a6f ('restore reverted command files') already fixed. The in-scope #637 stage-recovery source/test/spec/feature changes are correct and should be kept. Resolution: Restore the three out-of-scope command files to their origin/dev state and drop them from this PR — e.g. git checkout origin/dev -- .claude/commands/document.md .claude/commands/adw_init.md README.md — then re-commit so git diff origin/dev (modulo the 7-commit divergence) shows only the #637 stage-recovery files.`

## Issue Summary
**Original Spec:** `specs/issue-637-adw-tg4om4-fix-make-phase-timeo-sdlc_planner-recover-phase-timeout-stage.md`

**Issue:** The two plan commits on this branch (`4c5b43d`, `c607c07`) swept three out-of-scope files into the #637 PR — the recurring "worktree born with dependency reversion" hazard the spec's own Worktree-Hygiene note (`## Notes`) warned about:
- `.claude/commands/adw_init.md` — **active revert of merged work**: removes the `Owns:`/`Conditions:` semantic-routing instruction block and drops `.claude/commands/document.md` from `hashInputs`. That content was introduced by merged commits `17f8548`/`6fc0597`/`e9b82d4` (verified **ancestors of merge-base `d624634`** and still present on `origin/dev`).
- `.claude/commands/document.md` — **active revert of merged work**: a ~120-line rewrite of the merged `/document` semantic-routing command (57 insertions / 63 deletions vs `origin/dev`).
- `README.md` — **out-of-scope additive edit**: 4 lines added to the file-tree listing (documenting `docsGuards.ts`/`stageClassifier.ts`), unrelated to #637.

Merging as-is would re-revert `document.md`/`adw_init.md` on `dev`, re-introducing the conditional-docs regression that commit `6ea6a6f` ("restore reverted command files") already fixed.

**Verified facts** (`git`): merge-base = `d624634`; `origin/dev`'s 7 post-merge-base commits do **not** touch any of the three files (so `origin/dev` == merge-base for them); the branch's own contribution (`git diff d624634..HEAD`) is exactly the three out-of-scope files plus the correct in-scope #637 stage-recovery files.

**Solution:** Restore the three files to their `origin/dev` state and re-commit, so the branch contributes **only** the in-scope #637 stage-recovery files. The in-scope #637 source/test/spec/feature changes are correct and must be kept untouched.

## Files to Modify
Restore each of these to its `origin/dev` (== merge-base `d624634`) content — no hand-editing, no partial changes:

- `.claude/commands/adw_init.md` — discard the branch's revert; restore merged `Owns:`/`Conditions:` block and the `document.md` `hashInputs` entry.
- `.claude/commands/document.md` — discard the branch's ~120-line rewrite; restore the merged `/document` command.
- `README.md` — discard the 4-line file-tree addition; restore the merged listing.

**Do NOT touch** any in-scope #637 file (keep exactly as committed): `adws/triggers/cronIssueFilter.ts`, `adws/triggers/takeoverHandler.ts`, `adws/types/workflowTypes.ts`, `adws/github/workflowCommentsIssue.ts`, `adws/phases/workflowCompletion.ts`, `adws/triggers/__tests__/cronIssueFilter.test.ts`, `adws/triggers/__tests__/takeoverHandler.test.ts`, `features/per-issue/feature-636.feature`, `features/per-issue/feature-637.feature`, `features/per-issue/step_definitions/feature-637.steps.ts`, and the spec.

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Restore the three out-of-scope files to `origin/dev`
- Run exactly:
  ```sh
  git checkout origin/dev -- .claude/commands/document.md .claude/commands/adw_init.md README.md
  ```
- This restores all three files to `origin/dev`'s content and stages them. (`origin/dev` == merge-base `d624634` for these three files — verified the 7 newer `origin/dev` commits never touch them — so this restores the pre-revert merged content.)
- If `origin/dev` is not present locally, fetch first (`git fetch origin dev`) — do not substitute any other ref. (`d624634` is an equivalent fallback for these three files only.)
- Touch nothing else.

### Step 2: Confirm the restoration is scoped to exactly those three files
- Verify the three files now match `origin/dev` (expect **empty** output):
  ```sh
  git diff origin/dev -- .claude/commands/document.md .claude/commands/adw_init.md README.md
  ```
- Verify the working tree shows **only** those three paths changed (no in-scope #637 file appears):
  ```sh
  git status --porcelain
  ```
  Expect only: `.claude/commands/adw_init.md`, `.claude/commands/document.md`, `README.md`.

### Step 3: Re-commit so the branch contribution is #637-only
- The normal patch commit phase commits the staged restoration as a new commit on top (no history rewrite needed — the restoration cancels the earlier out-of-scope edits in the cumulative diff).
- After committing, the merge-base→HEAD contribution must list **only** #637 stage-recovery files:
  ```sh
  git diff $(git merge-base HEAD origin/dev)..HEAD --stat
  ```
  Expect: `adws/...` source/tests, `features/per-issue/feature-636.feature`, `feature-637.feature`, `feature-637.steps.ts`, and the spec — and **no** `.claude/commands/*` or `README.md`.

## Validation
Execute every command. The git-state checks are the primary proof of this patch; the typecheck/test runs prove zero regression (the restoration is command/doc-file-only and cannot affect TypeScript compilation or the unit suite).

- `git diff origin/dev -- .claude/commands/document.md .claude/commands/adw_init.md README.md` — **must be empty** (three files restored to `origin/dev`).
- `git status --porcelain` — before commit, lists **only** the three restored files; nothing in `adws/`, `features/`, or `specs/`.
- `git diff $(git merge-base HEAD origin/dev)..HEAD --stat` — after commit, lists **only** the in-scope #637 stage-recovery files (no `.claude/commands/*`, no `README.md`).
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW typecheck still passes (unaffected; restoration touches no `.ts`).
- `bunx vitest run adws/triggers/__tests__/takeoverHandler.test.ts adws/triggers/__tests__/cronIssueFilter.test.ts adws/core/__tests__/stageClassifier.test.ts` — the #637 stage-recovery tests still pass (kept intact).
- `bun run test:unit` — full Vitest suite passes (zero regression).

## Patch Scope
**Lines of code to change:** 0 source lines. Restores three command/doc files to their merged state (~135 lines of out-of-scope diff reverted: `document.md` ~120, `adw_init.md` ~11, `README.md` 4). No `.ts` changes.
**Risk level:** low — restoring command/markdown files to the already-merged `origin/dev` content; no source, type, or test-behavior change; verified `origin/dev` == merge-base for all three files. Net effect is removal of out-of-scope changes and reinstatement of merged conditional-docs work.
**Testing required:** git-state verification (three files match `origin/dev`; nothing else changed; merge-base→HEAD diff is #637-only) plus ADW typecheck and the #637 unit tests to confirm zero regression.
