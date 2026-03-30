# Patch: Fix regex regression in parseOwnerRepoFromUrl for dotted repo names

## Metadata
adwId: `ce43gr-fix-missing-d1-cost`
reviewChangeRequest: `specs/issue-344-adw-ce43gr-fix-missing-d1-cost-sdlc_planner-fix-d1-cost-writes.md`

## Issue Summary
**Original Spec:** specs/issue-344-adw-ce43gr-fix-missing-d1-cost-sdlc_planner-fix-d1-cost-writes.md
**Issue:** Regex in `parseOwnerRepoFromUrl` (`adws/providers/repoContext.ts:143-145`) was changed from `([^/]+?)(?:\.git)?\/?$` to `([^/.]+)`, which stops matching at dots. For dotted repo names like `paysdoc.nl`, the repo is parsed as `paysdoc` instead of `paysdoc.nl`. This breaks cost record attribution in `adwPrReview.tsx`'s `commitPhaseToD1` which reads `config.repoContext?.repoId.repo`. The deleted test file (`repoContext.test.ts`) would have caught this regression.
**Solution:** Revert the regex patterns to the original greedy-match-with-git-strip versions, restore the deleted test file, and broaden the vitest include pattern to cover all adws tests.

## Files to Modify

- `adws/providers/repoContext.ts` — revert regex patterns on lines 143 and 145
- `adws/providers/__tests__/repoContext.test.ts` — restore deleted test file (create directory + file)
- `vitest.config.ts` — broaden include pattern from `adws/cost/__tests__/**/*.test.ts` to `adws/**/__tests__/**/*.test.ts`

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Revert regex in `adws/providers/repoContext.ts`
- Line 143: Change `(/https?:\/\/[^/]+\/([^/]+)\/([^/.]+)/)` to `(/https?:\/\/[^/]+\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/)`
- Line 145: Change `(/git@[^:]+:([^/]+)\/([^/.]+)/)` to `(/git@[^:]+:([^/]+)\/([^/]+?)(?:\.git)?\/?$/)`
- These are the only two lines that need changing in this file

### Step 2: Restore `adws/providers/__tests__/repoContext.test.ts`
- Create directory `adws/providers/__tests__/`
- Create `adws/providers/__tests__/repoContext.test.ts` with tests covering:
  - HTTPS URLs: standard repo, with `.git` suffix, dotted repo name, dotted repo with `.git`, multi-dot repo name
  - SSH URLs: standard repo, with `.git` suffix, dotted repo name, dotted repo with `.git`, multi-dot repo name
  - Edge case: unrecognised URL returns null
- Source: restore from commit `c981a74` content

### Step 3: Broaden `vitest.config.ts` include pattern
- Change `include: ['adws/cost/__tests__/**/*.test.ts']` to `include: ['adws/**/__tests__/**/*.test.ts']`
- This ensures the restored repoContext tests (and any future adws tests) are picked up by vitest

## Validation
Execute every command to validate the patch is complete with zero regressions.

1. `bun run lint` — Run linter to check for code quality issues
2. `bunx tsc --noEmit` — Type-check the main project
3. `bunx tsc --noEmit -p adws/tsconfig.json` — Type-check the adws module specifically
4. `bun run build` — Build the application to verify no build errors
5. `bunx vitest run` — Run vitest to confirm the restored repoContext tests pass (especially dotted repo name tests)

## Patch Scope
**Lines of code to change:** ~90 (2 lines changed in repoContext.ts, 1 line changed in vitest.config.ts, ~85 lines new test file restored)
**Risk level:** low
**Testing required:** Vitest unit tests for `parseOwnerRepoFromUrl` covering dotted repo names, plus existing lint/typecheck/build validation
