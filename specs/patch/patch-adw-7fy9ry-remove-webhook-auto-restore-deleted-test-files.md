# Patch: Restore deleted #389 test and feature files

## Metadata
adwId: `7fy9ry-remove-webhook-auto`
reviewChangeRequest: `Issue #3: Deletion of features/fix_fail_open_dependency_check.feature, features/step_definitions/fixFailOpenDependencyCheckSteps.ts, adws/__tests__/issueDependencies.test.ts, and adws/__tests__/triggerWebhook.test.ts`

## Issue Summary
**Original Spec:** `specs/issue-382-adw-7fy9ry-remove-webhook-auto-sdlc_planner-simplify-webhook-handlers.md`
**Issue:** Four files belonging to issue #389 (fail-open dependency check fix) are missing from this branch. These files were added in commit `e0243aa` on `origin/dev` and provide regression protection for the fail-closed dependency behavior and the webhook eligibility bypass removal. Combined with the behavioral reverts addressed in patch issues 1 and 2, their absence removes all regression protection for the #389 fix.
**Solution:** Restore all four files from commit `e0243aa` (origin/dev). These files belong to #389, not #382, and must be present to guard against the fail-open dependency race condition.

## Files to Modify

- `features/fix_fail_open_dependency_check.feature` — **Restore** (121 lines) — BDD feature file for fail-open dependency check scenarios.
- `features/step_definitions/fixFailOpenDependencyCheckSteps.ts` — **Restore** (273 lines) — Step definitions for the above feature.
- `adws/__tests__/issueDependencies.test.ts` — **Restore** (95 lines) — Unit tests for `findOpenDependencies()` fail-closed behavior.
- `adws/__tests__/triggerWebhook.test.ts` — **Restore** (65 lines) — Unit tests for webhook handler catch block behavior.

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Restore all four files from commit `e0243aa`
- Run `git checkout e0243aa -- features/fix_fail_open_dependency_check.feature features/step_definitions/fixFailOpenDependencyCheckSteps.ts adws/__tests__/issueDependencies.test.ts adws/__tests__/triggerWebhook.test.ts`
- This restores all four files exactly as they exist on `origin/dev` at the commit where #389 added them.

### Step 2: Verify restored file content is compatible with current branch
- Read each restored file to confirm imports resolve against the current branch's module structure.
- Specifically check:
  - `adws/__tests__/issueDependencies.test.ts` imports from `../triggers/issueDependencies` — confirm `findOpenDependencies` is exported.
  - `adws/__tests__/triggerWebhook.test.ts` references to `trigger_webhook.ts` — confirm the catch block structure matches after patch issues 1 and 2 are applied.
  - `features/step_definitions/fixFailOpenDependencyCheckSteps.ts` imports — confirm they resolve.
- If any imports need adjustment due to #382 changes (e.g., renamed exports, moved functions), update only the import paths. Do not change test logic.

### Step 3: Run type check and unit tests
- Run `bunx tsc --noEmit -p adws/tsconfig.json` to verify the restored test files type-check.
- Run `bun vitest run` to verify unit tests pass (including the two restored test files).

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `bunx tsc --noEmit -p adws/tsconfig.json` — Type check adws subproject including restored test files.
- `bun vitest run` — Run all unit tests including restored `issueDependencies.test.ts` and `triggerWebhook.test.ts`.
- `bun run lint` — Run linter to check for code quality issues.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-389"` — Run #389 BDD scenarios to validate the restored feature file and step definitions work.

## Patch Scope
**Lines of code to change:** ~554 lines added (file restorations, 0 modifications expected)
**Risk level:** low
**Testing required:** Type check, unit tests, and BDD scenario run for `@adw-389` tag. The files are exact copies from `origin/dev` where they already pass. The only risk is import incompatibility with #382 changes, addressed in Step 2.
