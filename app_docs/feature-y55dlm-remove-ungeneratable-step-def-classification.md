# Remove Ungeneratable Step Def Classification

**ADW ID:** y55dlm-remove-ungeneratable
**Date:** 2026-03-25
**Specification:** specs/issue-303-adw-y55dlm-remove-ungeneratable-sdlc_planner-remove-ungeneratable-step-def-classification.md

## Overview

Removes the generatable/ungeneratable scenario classification from the `/generate_step_definitions` command and replaces it with documentation about the mock test harness infrastructure. Previously, scenarios requiring runtime dependencies (mock servers, LLM stubs, git remotes) were deleted from feature files; now they are all generated using the test harness mocks.

## What Was Built

- Removed the two-category scenario classification ("Generatable" / "Ungeneratable") from `generate_step_definitions.md`
- Removed the instruction to delete ungeneratable scenario blocks from `.feature` files
- Added a "Test harness infrastructure" section documenting all four mock components and how to use them
- Removed the `removedScenarios` warning comment logic from `stepDefPhase.ts` (dead code after this change)
- Updated the regression scenario and its step definitions to validate the new behavior
- New feature file `features/remove_ungeneratable_step_def_classification.feature` with full BDD coverage

## Technical Implementation

### Files Modified

- `.claude/commands/generate_step_definitions.md`: Removed steps 5 ("Classify scenarios") and 6 ("Remove ungeneratable scenarios"); replaced with new step 5 ("Test harness infrastructure") documenting mock GitHub API server, Claude CLI stub, git remote mock, and fixture repo setup. `removedScenarios` retained in JSON output spec as always-empty array.
- `adws/phases/stepDefPhase.ts`: Removed the `if (result.removedScenarios.length > 0)` block that posted a warning comment on the issue. Removed unused `repoContext` destructure.
- `features/step_def_generation_review_gating.feature`: Updated scenario "generates step definitions for all scenarios" (was "removes ungeneratable scenarios"); added `@adw-y55dlm-remove-ungeneratable` tag.
- `features/step_definitions/stepDefGenReviewGatingSteps.ts`: Updated two step definitions — now assert classification terms are absent and that `removedScenarios` is documented as always an empty array.
- `features/step_definitions/removeUngeneratableSteps.ts`: New step definition file with ~15 steps covering classification removal and test harness documentation assertions.

### Key Changes

- The agent command no longer classifies or removes any scenarios — all tagged scenarios receive generated step definitions.
- The `removedScenarios` JSON field is kept in the output spec (backward compatibility with `stepDefAgent.ts`) but always returns `[]`.
- `stepDefPhase.ts` still reads `result.removedScenarios` for resilience but no longer acts on it.
- The test harness section in the command documents `setupMockInfrastructure()`, `teardownMockInfrastructure()`, `setupFixtureRepo()`, and `teardownFixtureRepo()` and instructs using Cucumber `Before`/`After` hooks when runtime infrastructure is needed.
- Regression scenario updated in-place (not deleted) to maintain `@regression` tag coverage.

## How to Use

The change is transparent to most workflows — the step definition generation phase behaves identically except:

1. No scenarios will ever be removed from `.feature` files during step def generation.
2. For scenarios that need runtime infrastructure, the generated step definitions will import and use the test harness:
   ```ts
   import { setupMockInfrastructure, teardownMockInfrastructure } from '../../test/mocks/test-harness.ts';

   Before(async function () {
     this.mockCtx = await setupMockInfrastructure();
   });

   After(async function () {
     await teardownMockInfrastructure(this.mockCtx);
   });
   ```
3. `removedScenarios` in the agent JSON output will always be `[]`.

## Configuration

No configuration changes required. The test harness infrastructure is already present in `test/mocks/`.

## Testing

Run the regression suite to verify:

```sh
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"
```

The scenario `generate_step_definitions command generates step definitions for all scenarios` (tagged `@adw-249 @adw-y55dlm-remove-ungeneratable @regression`) validates:
- No classification terms (`Ungeneratable`) appear in the command
- The command documents the test harness (`setupMockInfrastructure`)
- `removedScenarios` is retained but documented as an empty array

## Notes

- `RemovedScenario` interface and `parseRemovedScenarios` in `stepDefAgent.ts` are intentionally unchanged — the agent may still return the field from older prompts and the parser must handle it gracefully.
- The warning comment path in `stepDefPhase.ts` was dead code once this change lands; removing it follows the coding guideline of removing unused code paths.
