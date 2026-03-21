# Patch: Fix regression BDD step for estimatedTokens/actualTokens type change

## Metadata
adwId: `7nl59l-ensurecronprocess-in`
reviewChangeRequest: `specs/issue-250-adw-0rndbm-ensurecronprocess-in-sdlc_planner-fix-cron-respawn-cache.md`

## Issue Summary
**Original Spec:** specs/issue-250-adw-0rndbm-ensurecronprocess-in-sdlc_planner-fix-cron-respawn-cache.md
**Issue:** The `@regression` scenario "PhaseCostRecord type includes all required fields" (features/phase_cost_record_csv.feature:17) fails because the BDD feature file asserts `estimatedTokens` and `actualTokens` are "of type number", but the `PhaseCostRecord` type in `adws/cost/types.ts` declares them as `TokenUsageMap | undefined` (i.e. `Record<string, number> | undefined`). The step definition at `phaseCostRecordCsvSteps.ts:30` checks for `readonly estimatedTokens: number` which does not match the actual type declaration.
**Solution:** Update the two feature file steps (lines 32–33) to use the existing step pattern `as a Record of string to number` instead of `of type number`. The existing step definition for this pattern (line 37) already passes for these fields because it checks `readonly ${fieldName}:` (matches) and `Record<string, number>` presence in the file (matches via `TokenUsageMap` alias).

## Files to Modify
Use these files to implement the patch:

- `features/phase_cost_record_csv.feature` — Lines 32–33: change step text from `of type number` to `as a Record of string to number`

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Update feature file steps for estimatedTokens and actualTokens
- Open `features/phase_cost_record_csv.feature`
- Line 32: change `And PhaseCostRecord includes field "estimatedTokens" of type number` to `And PhaseCostRecord includes field "estimatedTokens" as a Record of string to number`
- Line 33: change `And PhaseCostRecord includes field "actualTokens" of type number` to `And PhaseCostRecord includes field "actualTokens" as a Record of string to number`

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `bunx cucumber-js features/phase_cost_record_csv.feature --tags "@regression"` — Run only the failing scenario to confirm the fix
- `bunx cucumber-js --tags "@regression"` — Run all regression scenarios to verify no regressions
- `bun run lint` — Lint check
- `bunx tsc --noEmit` — Type check root project
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type check adws sub-project

## Patch Scope
**Lines of code to change:** 2
**Risk level:** low
**Testing required:** Run the failing @regression scenario to confirm it passes, then full @regression suite
