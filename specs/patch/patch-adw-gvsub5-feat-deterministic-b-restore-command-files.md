# Patch: Restore reverted `/document` and `/adw_init` command files to dev baseline

## Metadata
adwId: `gvsub5-feat-deterministic-b`
reviewChangeRequest: `Issue #1: Out-of-scope regression unrelated to issue #641, introduced by the plan/spec commit f23b85f (not the build commit d23539b, which is clean). The diff against origin/dev reverts two slash-command files that origin/dev already carries from #611/#635: (1) .claude/commands/document.md is rolled back from the current semantic-routing / sibling-collapse / current-state module-reference format to the old 'What Was Built / changelog' format; (2) .claude/commands/adw_init.md drops the Owns: glob-block generation instructions. Merging this branch would silently regress the /document and /adw_init commands. Neither file is in the spec's Relevant Files or New Files lists. This is the known 'worktree born with dependency reversion' pattern — the exact same two files as the prior #612→#610 incident. Resolution: Restore both files to the dev baseline and drop them from this branch's diff: git checkout origin/dev -- .claude/commands/document.md .claude/commands/adw_init.md, then commit. Keep all #641 feature files as-is. Do NOT revert README.md (see issue 2).`

## Issue Summary
**Original Spec:** `specs/issue-641-adw-gvsub5-feat-deterministic-b-sdlc_planner-deterministic-branch-identity-fallback.md`

**Issue:** The plan/spec commit `f23b85f` ("plan-orchestrator: feat: add deterministic branch-identity fallback spec") silently reverted two slash-command files that `origin/dev` already carries from PRs #611/#635. These files are **out of scope** for issue #641 — they appear in neither the spec's `## Relevant Files` nor `### New Files` lists. This is the recurring "worktree born with dependency reversion" pattern (same two files as the prior #612→#610 incident). The reversion was **committed in the plan commit**, so a `git diff HEAD` would miss it; it is only visible against `origin/dev`.

Verified regressions (against `origin/dev`):
- `.claude/commands/document.md` — rolled back from the current semantic-routing / sibling-collapse / current-state module-reference format to the old "What Was Built / changelog" format. Confirmed: `git show origin/dev:.claude/commands/document.md` contains `Collapse sibling` (1 hit); `HEAD` contains 0. The 120-line churn in `f23b85f` is a pure revert.
- `.claude/commands/adw_init.md` — drops the `Owns:` glob-block generation instructions. Confirmed: `origin/dev` contains `Owns:` (2 hits); `HEAD` contains 0. The 11-line deletion in `f23b85f` is the regression.

Both reverts live entirely in `f23b85f`; the build commit `d23539b` is clean and touches neither file.

**Solution:** Restore both files to the `origin/dev` baseline (`git checkout origin/dev -- …`) and commit, dropping them from this branch's diff. Keep every #641 feature file as-is. Do **not** touch `README.md` (its +2 lines legitimately add `docsGuards.ts`/`docsSelfCheck.ts` entries from #611/#635 and are handled under a separate issue).

## Files to Modify
Restore these two files to the `origin/dev` baseline (no hand-editing — wholesale checkout):

- `.claude/commands/document.md` — restore the semantic-routing / sibling-collapse / current-state module-reference format.
- `.claude/commands/adw_init.md` — restore the `Owns:` glob-block generation instructions.

Do **not** modify (must remain exactly as they are on this branch):
- `README.md` — out of scope for this patch (separate issue #2).
- All #641 feature files: `adws/vcs/branchIdentity.ts`, `adws/vcs/index.ts`, `adws/phases/branchIdentityFallback.ts`, `adws/phases/branchNameResolution.ts`, `adws/phases/workflowInit.ts`, `adws/vcs/__tests__/branchIdentity.test.ts`, `adws/phases/__tests__/branchIdentityFallback.test.ts`, `adws/phases/__tests__/branchNameResolution.test.ts`, `features/per-issue/feature-641.feature`, `features/per-issue/step_definitions/feature-641.steps.ts`, and the spec file.

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Restore the two command files from the dev baseline
- Ensure the latest `origin/dev` is available locally: `git fetch origin dev`.
- Restore both files in a single command:
  - `git checkout origin/dev -- .claude/commands/document.md .claude/commands/adw_init.md`
- This stages the restored content (the checkout writes to the working tree and index), reverting the regression introduced by `f23b85f`.

### Step 2: Confirm the regression is gone and feature files are untouched
- `git diff origin/dev -- .claude/commands/document.md .claude/commands/adw_init.md` must produce **no output** (both files now equal the dev baseline).
- `git show :.claude/commands/document.md | grep -c 'Collapse sibling'` returns `1` (the current format is restored).
- `git show :.claude/commands/adw_init.md | grep -c 'Owns:'` returns `2` (the glob-block instructions are restored).
- `git diff origin/dev -- README.md` must still show the `+2` `docsGuards.ts`/`docsSelfCheck.ts` lines (proving README.md was **not** reverted).
- `git status --porcelain` should list only the two command files as staged changes.

### Step 3: Commit the restore
- Commit with a message that records the scope and intent, e.g.:
  - `patchAgent: fix: restore /document and /adw_init command files to dev baseline (out-of-scope reversion from f23b85f)`
- Do not stage or amend any feature file, the spec, or `README.md`.

## Validation
Execute every command to validate the patch is complete with zero regressions.

1. `git diff origin/dev -- .claude/commands/document.md .claude/commands/adw_init.md` → **empty output** (both files match dev).
2. `git show HEAD:.claude/commands/document.md | grep -c 'Collapse sibling'` → `1`; `git show HEAD:.claude/commands/adw_init.md | grep -c 'Owns:'` → `2`.
3. `git diff --name-only origin/dev | grep -E '\.claude/commands/(document|adw_init)\.md'` → **empty output** (the two files no longer appear in the branch diff).
4. `git diff origin/dev -- README.md` → still shows the two added doc-tree lines (README.md preserved, not reverted).
5. `bun run lint` → zero errors (command-file restore must not affect lint; confirms no collateral damage).
6. `bunx vitest run adws/vcs/__tests__/branchIdentity.test.ts adws/phases/__tests__/branchIdentityFallback.test.ts adws/phases/__tests__/branchNameResolution.test.ts` → all green (the #641 feature suite is untouched and still passes).

## Patch Scope
**Lines of code to change:** ~135 lines restored across 2 markdown command files (document.md ≈122, adw_init.md ≈13); 0 lines of TypeScript/feature code changed.
**Risk level:** low — a mechanical `git checkout` to a known-good baseline that only reverts an out-of-scope regression; no feature code, tests, or `README.md` are touched.
**Testing required:** Diff assertions that both files equal `origin/dev` and have dropped out of the branch diff, that `README.md` is preserved, plus a lint pass and the #641 targeted vitest run to confirm zero regressions.
