# Patch: Remove unit-test BDD scenarios (unit tests disabled)

## Metadata
adwId: `nnn7js-r2-upload-utility-sc`
reviewChangeRequest: `Issue #1: @regression scenario 'Unit tests exist for R2 upload utility' (features/r2_upload_screenshot_router.feature:105) FAILED. The step 'Given unit test files exist for the R2 upload utility' asserts that unit test files exist at adws/r2/__tests__/ but no such directory or files were created. The spec notes 'Unit tests disabled: Per .adw/project.md, unit tests are disabled for this project' which contradicts the @regression-tagged scenario that expects them to exist.`

## Issue Summary
**Original Spec:** specs/issue-274-adw-nnn7js-r2-upload-utility-sc-sdlc_planner-r2-upload-screenshot-router.md
**Issue:** The @regression scenario "Unit tests exist for R2 upload utility" (r2_upload_screenshot_router.feature:105) fails because it expects unit test files at `adws/r2/__tests__/`, but unit tests are disabled per `.adw/project.md` (`## Unit Tests: disabled`). The spec Notes section confirms: "Per .adw/project.md, unit tests are disabled for this project." A second scenario "Unit tests cover lifecycle rule configuration" has the same dependency.
**Solution:** Remove both unit-test BDD scenarios and the `# --- Unit Tests ---` section header from the feature file. Ensure the step definitions file (`r2UploadScreenshotRouterSteps.ts`) does not contain orphaned unit-test step definitions.

## Files to Modify
Use these files to implement the patch:

- `features/r2_upload_screenshot_router.feature` — Remove the `# --- Unit Tests ---` section containing both unit-test scenarios
- `features/step_definitions/r2UploadScreenshotRouterSteps.ts` — Ensure no orphaned step definitions exist for removed unit-test scenarios

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Remove unit-test scenarios from the feature file
- Delete the entire `# --- Unit Tests ---` section from `features/r2_upload_screenshot_router.feature`, which includes:
  - The `# --- Unit Tests ---` comment header
  - The `@adw-nnn7js-r2-upload-utility-sc @regression` scenario "Unit tests exist for R2 upload utility" (5 steps: asserts files in `adws/r2/__tests__/`, mock S3 client, bucket name construction, key construction, URL construction)
  - The `@adw-nnn7js-r2-upload-utility-sc` scenario "Unit tests cover lifecycle rule configuration" (2 steps: asserts test files exist and verifies 30-day lifecycle rule test)
- Preserve the blank line before the `# --- Type Safety ---` section that follows

### Step 2: Verify step definitions have no orphaned unit-test steps
- Check `features/step_definitions/r2UploadScreenshotRouterSteps.ts` for any step definitions matching the removed scenarios:
  - `Given('unit test files exist for the R2 upload utility', ...)`
  - `Then('there are tests that mock the S3 client', ...)`
  - `Then('there are tests that assert bucket name construction', ...)`
  - `Then('there are tests that assert key construction', ...)`
  - `Then('there are tests that assert URL construction', ...)`
  - `Then('there is a test that verifies the 30-day lifecycle rule is applied on bucket creation', ...)`
- If any of these step definitions exist, delete them. Preserve the TypeScript type-check scenario steps that follow.

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `bun run lint` — Verify no linting errors
- `bunx tsc --noEmit` — TypeScript type-check the root project
- `bunx tsc --noEmit -p adws/tsconfig.json` — TypeScript type-check the ADW module
- `bun run build` — Verify the project builds without errors
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-nnn7js-r2-upload-utility-sc and @regression"` — Run the feature-specific @regression scenarios to confirm the failing unit-test scenario is gone and remaining scenarios pass

## Patch Scope
**Lines of code to change:** ~14 lines deleted from feature file; 0-70 lines deleted from step definitions (depending on whether orphaned steps exist)
**Risk level:** low
**Testing required:** Run @regression BDD scenarios for this feature tag to confirm zero failures; lint, type-check, and build pass
