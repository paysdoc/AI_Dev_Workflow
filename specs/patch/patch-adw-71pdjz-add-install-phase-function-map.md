# Patch: Add 'install' entry to PHASE_FUNCTION_MAP

## Metadata
adwId: `71pdjz-cache-install-contex`
reviewChangeRequest: `Issue #1: 6 @regression scenarios fail with 'Unknown phase name: install' in stepDefGenReviewGatingSteps.ts:277. The PHASE_FUNCTION_MAP (line 18) is missing an entry for 'install'. Resolution: Add 'install': 'executeInstallPhase' to the PHASE_FUNCTION_MAP.`

## Issue Summary
**Original Spec:** specs/issue-253-adw-71pdjz-cache-install-contex-sdlc_planner-cache-install-context.md
**Issue:** The `PHASE_FUNCTION_MAP` in `features/step_definitions/stepDefGenReviewGatingSteps.ts` does not contain an `'install'` entry, causing 6 `@regression` scenarios to fail with `Unknown phase name: "install"` when the feature file phase ordering tables include `install`.
**Solution:** Add `'install': 'executeInstallPhase'` as the first entry in `PHASE_FUNCTION_MAP` (before `'plan'`), matching the function name used in all orchestrators.

## Files to Modify
- `features/step_definitions/stepDefGenReviewGatingSteps.ts` — Add `'install': 'executeInstallPhase'` to `PHASE_FUNCTION_MAP` at line 19.

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Add 'install' entry to PHASE_FUNCTION_MAP
- Open `features/step_definitions/stepDefGenReviewGatingSteps.ts`
- At line 19, before the `'plan'` entry, insert: `'install': 'executeInstallPhase',`
- The resulting map should begin with:
  ```ts
  const PHASE_FUNCTION_MAP: Record<string, string> = {
    'install': 'executeInstallPhase',
    'plan': 'executePlanPhase',
    ...
  };
  ```

## Validation
Execute every command to validate the patch is complete with zero regressions.

1. `bunx tsc --noEmit` — Verify no TypeScript compilation errors
2. `bunx cucumber-js --tags "@regression"` — Verify all 6 previously-failing regression scenarios now pass

## Patch Scope
**Lines of code to change:** 1
**Risk level:** low
**Testing required:** Run regression BDD scenarios to confirm the 6 failing scenarios pass
