# Patch: Add @adw-307 tag to feature file

## Metadata
adwId: `x2q5aa-review-phase-step-de`
reviewChangeRequest: `specs/issue-307-adw-yxq5og-review-phase-step-de-sdlc_planner-step-def-independence-check.md`

## Issue Summary
**Original Spec:** specs/issue-307-adw-yxq5og-review-phase-step-de-sdlc_planner-step-def-independence-check.md
**Issue:** `features/review_step_def_independence.feature` uses `@adw-yxq5og-review-phase-step-de` as its tag but the spec (Task 3) requires all scenarios to be tagged with `@adw-307`. The scenario proof ran `@adw-307` and found no matching scenarios, meaning the new feature scenarios were never validated.
**Solution:** Add `@adw-307` to the file-level tag in `features/review_step_def_independence.feature`. In Cucumber, file-level tags are inherited by all scenarios, so a single line change propagates to every scenario in the file.

## Files to Modify
Use these files to implement the patch:

- `features/review_step_def_independence.feature` — Add `@adw-307` to the file-level tag on line 1

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Add @adw-307 to the file-level tag
- Open `features/review_step_def_independence.feature`
- Change line 1 from `@adw-yxq5og-review-phase-step-de` to `@adw-307 @adw-yxq5og-review-phase-step-de`
- This single change makes all scenarios in the file match `--tags "@adw-307"` via Cucumber tag inheritance

### Step 2: Verify the tag change
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-307" --dry-run` to confirm scenarios are now matched (should be >0 scenarios, not "no matching scenarios")

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-307" --dry-run` — Verify scenarios are found (must show >0 scenarios)
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-307"` — Run feature scenarios tagged @adw-307
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — Run regression scenarios to verify zero regressions
- `bunx tsc --noEmit` — TypeScript type check (root config)
- `bunx tsc --noEmit -p adws/tsconfig.json` — TypeScript type check (adws config)

## Patch Scope
**Lines of code to change:** 1 line modified
**Risk level:** low
**Testing required:** `@adw-307` tagged scenarios must be found and pass; regression scenarios must remain green
