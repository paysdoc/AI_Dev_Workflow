# Patch: Revert estimatedTokens/actualTokens field assertions to Record type

## Metadata
adwId: `ex60ng-make-bdd-scenarios-r`
reviewChangeRequest: `specs/issue-249-adw-vlphr9-make-bdd-scenarios-r-sdlc_planner-step-def-gen-review-gating.md`

## Issue Summary
**Original Spec:** specs/issue-249-adw-vlphr9-make-bdd-scenarios-r-sdlc_planner-step-def-gen-review-gating.md
**Issue:** The @regression scenario "PhaseCostRecord type includes all required fields" (features/phase_cost_record_csv.feature:17) fails at step `PhaseCostRecord includes field "estimatedTokens" of type number`. The feature file was incorrectly changed from `as a Record of string to number` to `of type number`, but `PhaseCostRecord.estimatedTokens` is typed `TokenUsageMap | undefined` (`Record<string, number> | undefined`). Same issue affects `actualTokens` (skipped step).
**Solution:** Revert lines 32-33 to their original form using the `as a Record of string to number` step pattern, which matches the existing step definition at `phaseCostRecordCsvSteps.ts:37` and the actual TypeScript type.

## Files to Modify

- `features/phase_cost_record_csv.feature` — Lines 32-33: revert field type assertions for `estimatedTokens` and `actualTokens`

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Revert estimatedTokens assertion (line 32)
- Change `And PhaseCostRecord includes field "estimatedTokens" of type number` to `And PhaseCostRecord includes field "estimatedTokens" as a Record of string to number`

### Step 2: Revert actualTokens assertion (line 33)
- Change `And PhaseCostRecord includes field "actualTokens" of type number` to `And PhaseCostRecord includes field "actualTokens" as a Record of string to number`

**Note:** The working tree already contains this fix (confirmed via `git diff`). Implementation steps confirm the change is correct and ready to commit.

## Validation
Execute every command to validate the patch is complete with zero regressions.

1. `bunx cucumber-js --tags '@regression and @adw-l1x9x9-cost-revamp-phasecos'` — Verify the PhaseCostRecord regression scenarios pass (previously failing scenario)
2. `bunx cucumber-js --tags '@regression'` — Verify all regression scenarios pass with zero failures
3. `bun run lint` — Verify no lint errors
4. `bun run build` — Verify no build errors

## Patch Scope
**Lines of code to change:** 2
**Risk level:** low
**Testing required:** Run the @regression BDD scenarios to confirm the PhaseCostRecord type assertion passes
