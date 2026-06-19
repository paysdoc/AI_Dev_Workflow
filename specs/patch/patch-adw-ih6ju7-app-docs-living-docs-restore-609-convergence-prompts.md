# Patch: Restore #609 convergence prompts reverted by this branch

## Metadata
adwId: `ih6ju7-app-docs-living-docs`
reviewChangeRequest: `Issue #1: Branch commit 8484225 reverts .claude/commands/document.md and .claude/commands/adw_init.md to their pre-#609 format: /document loses its 'Route by ownership / rewrite-in-place' convergence and its Owns: glob emission, the current-state module-reference template reverts to the old per-run-snapshot template (ADW ID/Date/What Was Built/Files Modified), and document.md is dropped from adw_init.md's hashInputs. origin/dev already contains the merged #609 versions (verified: the #609 merge 8b6af53 is an ancestor of origin/dev), so this diff is a net regression of merged work. The spec's Notes section (line 237) explicitly warned: 'Do not let this slice silently re-commit the reversion.' This is not cosmetic — it defeats #611's own regrowth guard: checkRegrowth only considers entries with non-empty ownedGlobs, but the reverted prompts no longer emit Owns: blocks, so future index entries parse as legacy (empty globs) and regrowth can never fire on real runs, breaking the issue's stated end-to-end outcome that a run producing an overlapping entry emits a regrowth flag. The @adw-611 scenarios still pass only because they seed Owns: globs directly via serializeConditionalDocs rather than through the /document prompt. Resolution: Restore both command files to their origin/dev (#609) state and re-commit, e.g. run git checkout origin/dev -- .claude/commands/document.md .claude/commands/adw_init.md then commit. Do not ship the reversion. The guards module, self-check wiring, unit tests, and BDD scenarios are correct and require no changes.`

## Issue Summary
**Original Spec:** `specs/issue-611-adw-ih6ju7-app-docs-living-docs-sdlc_planner-app-docs-post-write-guards.md`

**Issue:** Branch commit `8484225` ("plan-orchestrator: feat: add post-write guards spec and BDD scenarios") silently reverted two already-merged #609 prompt files back to their pre-#609 format. Verified against the tree:
- `.claude/commands/document.md` — lost the "Route by ownership" + "Rewrite in place" convergence steps and the `Owns:` glob emission; the current-state module-reference template reverted to the old per-run-snapshot template (`ADW ID` / `Date` / `What Was Built` / `Files Modified`); the entry-format block dropped its `Owns:` glob block.
- `.claude/commands/adw_init.md` — dropped `.claude/commands/document.md` from `hashInputs`, and removed the instruction telling `/adw_init` to emit `Owns:` glob blocks per index entry.

`origin/dev` already contains the merged #609 versions (confirmed: the #609 merge `8b6af53` is an ancestor of `origin/dev`, and `8484225` is the only commit on this branch that touched these two files). The diff `origin/dev...HEAD` for these files is therefore a **net regression of merged work**, which the spec's Notes (line 237) explicitly warned against: *"Do not let this slice silently re-commit the reversion."*

**Why it matters (not cosmetic):** it defeats #611's own regrowth guard. `checkRegrowth` only considers entries with non-empty `ownedGlobs`; if `/document` and `/adw_init` no longer emit `Owns:` blocks, real-run index entries parse as legacy (empty globs) and regrowth can never fire in production — breaking the issue's stated end-to-end outcome (a run producing an overlapping entry emits a regrowth flag). The `@adw-611` scenarios still pass only because they seed `Owns:` globs directly via `serializeConditionalDocs`, not through the `/document` prompt — so the green suite masks the regression.

**Solution:** Restore both command files to their `origin/dev` (#609) state and re-commit. Do not ship the reversion. The #611 deliverables (guards module, self-check wiring, unit tests, BDD scenarios) are correct and require **no** changes.

## Files to Modify
Restore these two files to their `origin/dev` (#609) content — no hand-editing; the restore is a verbatim checkout of the merged versions:

- `.claude/commands/document.md` — restore the convergence prompt (Route by ownership → Rewrite in place → Create new, `Owns:` glob emission, current-state module-reference template).
- `.claude/commands/adw_init.md` — restore `.claude/commands/document.md` to `hashInputs` and the per-entry `Owns:` glob-block instruction.

No other files change. Per the review, the guards module (`adws/core/docsGuards.ts`), self-check wiring (`adws/phases/docsSelfCheck.ts`), document-phase integration (`adws/phases/documentPhase.ts`), unit tests, and `@adw-611` BDD scenarios are correct and must be left untouched.

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Restore both command files from origin/dev
- Ensure the remote ref is current: `git fetch origin dev`.
- Restore the two files verbatim from the merged #609 state:
  - `git checkout origin/dev -- .claude/commands/document.md .claude/commands/adw_init.md`
- This stages the restored content. Do **not** touch any other path.

### Step 2: Confirm the reversion is gone and #609 content is back
- `git diff --cached --stat` should show only `.claude/commands/document.md` and `.claude/commands/adw_init.md`.
- `git diff origin/dev -- .claude/commands/document.md .claude/commands/adw_init.md` must print **nothing** (the files now match origin/dev exactly).
- Spot-check the restored markers are present in `.claude/commands/document.md`:
  - `### 4. Route by ownership` and `### 5. Rewrite in place (area already owned)` headings.
  - The entry-format block contains an `Owns:` glob block.
  - The doc template uses the current-state module-reference headings (`## Responsibilities`, `## Contracts & Invariants`, `## Gotchas`) and does **not** reintroduce `**ADW ID:**` / `**Date:**` / `## What Was Built` / `### Files Modified`.
- Spot-check `.claude/commands/adw_init.md`:
  - `hashInputs:` again lists `- .claude/commands/document.md`.
  - The `Owns:` glob-block instruction for new index entries is restored.

### Step 3: Commit the restoration (do not ship the reversion)
- Commit only the two restored files (and this patch plan if the workflow bundles it):
  - `git add .claude/commands/document.md .claude/commands/adw_init.md`
  - Commit with a message recording the fix, following the repo's agent-prefixed convention, e.g.:
    `patchAgent: fix: restore #609 convergence /document and /adw_init prompts (undo 8484225 reversion)`
- The body should note: restores merged #609 prompts so `/document` and `/adw_init` again emit `Owns:` globs that #611's `checkRegrowth` depends on; no behavioural code changed.

## Validation
Execute every command to validate the patch is complete with zero regressions (validation set from the spec's `## Validation Commands`). The patch touches only two `.md` prompt files, so the TypeScript/BDD surfaces should be unaffected — run them to prove it.

- `git diff origin/dev -- .claude/commands/document.md .claude/commands/adw_init.md` — must be **empty** (the two files now match merged #609 exactly; the reversion is gone).
- `bun run lint` — ESLint; zero errors.
- `bunx tsc --noEmit` — root type-check; zero errors.
- `bunx tsc --noEmit -p adws/tsconfig.json` — `adws/` type-check; zero errors.
- `bun run test:unit` — vitest; full suite green (no regressions; `docsGuards.test.ts` still passes).
- `bun run build` — `tsc` build; succeeds.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-611"` — the 6 frozen per-issue scenarios still pass (they seed `Owns:` globs directly, so restoring the prompt does not affect them).
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — regression suite stays green.

## Patch Scope
**Lines of code to change:** ~116 lines restored across 2 prompt files (≈106 in `document.md`, ≈10 in `adw_init.md`), via `git checkout` — no hand-authored content.
**Risk level:** low — restores already-merged, already-reviewed #609 content from `origin/dev`; no TypeScript or test code touched; `@adw-611` scenarios are independent of the `/document` prompt.
**Testing required:** confirm the two files match `origin/dev` (empty diff), then run the full validation suite (lint, root + adws type-check, unit, build, `@adw-611`, `@regression`) to confirm zero regressions.
