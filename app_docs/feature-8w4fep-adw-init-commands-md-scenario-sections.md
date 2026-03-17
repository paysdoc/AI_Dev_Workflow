# adw_init commands.md Scenario Sections Fix

**ADW ID:** 8w4fep-adw-init-broken
**Date:** 2026-03-17
**Specification:** specs/issue-221-adw-8w4fep-adw-init-broken-sdlc_planner-fix-adw-init-commands-md.md

## Overview

When `/adw_init` is run on a target repository, the generated `.adw/commands.md` was missing two required sections: `## Run Scenarios by Tag` and `## Run Regression Scenarios`. This fix updates the `/adw_init` command template so these sections are explicitly listed and generated, ensuring `projectConfig.ts` reads project-specific BDD runner commands rather than falling back to hardcoded defaults.

## What Was Built

- Updated `.claude/commands/adw_init.md` step 2 to enumerate `## Run Scenarios by Tag` and `## Run Regression Scenarios` as required sections in `.adw/commands.md`
- Added a note that both section values must be consistent with the E2E tool detected in step 7 (Playwright, Cypress, Cucumber, or default Cucumber)
- Added BDD feature file (`features/adw_init_commands_md.feature`) with 7 scenarios tagged `@adw-221` and `@regression` validating the fix
- Added Cucumber step definitions (`features/step_definitions/adwInitCommandsMdSteps.ts`) covering template inspection, generated file contents, E2E tool consistency, and `projectConfig.ts` mapping verification

## Technical Implementation

### Files Modified

- `.claude/commands/adw_init.md`: Added two bullet points to step 2 listing `## Run Scenarios by Tag` and `## Run Regression Scenarios` with a cross-reference note to step 7 E2E tool detection
- `features/adw_init_commands_md.feature`: New BDD feature file with scenarios covering template correctness, generated file contents, E2E tool consistency, and `projectConfig.ts` mappings
- `features/step_definitions/adwInitCommandsMdSteps.ts`: New step definitions implementing file-read assertions, section presence checks, placeholder validation, and `projectConfig.ts` interface/map verification

### Key Changes

- The only runtime-affecting change is in `.claude/commands/adw_init.md` — a template-only edit with no TypeScript changes
- `projectConfig.ts` already mapped `'run scenarios by tag'` → `runScenariosByTag` and `'run regression scenarios'` → `runRegressionScenarios` (lines 99-100); the fix ensures the headings exist in newly generated `commands.md` files
- Previously, missing sections caused `projectConfig.ts` to silently fall back to hardcoded default Cucumber commands (lines 121-122) regardless of the project's detected E2E tool
- BDD scenarios tagged `@regression` are added to the regression safety net so future changes to `adw_init.md` are caught automatically

## How to Use

1. Run `/adw_init` on a target repository as usual
2. After completion, open `.adw/commands.md` in the target repo
3. Verify that `## Run Scenarios by Tag` and `## Run Regression Scenarios` sections are present with values matching the detected E2E tool
4. Compare with `.adw/scenarios.md` — both files should specify the same runner command for the detected E2E tool

## Configuration

No configuration changes are required. The values for both sections are determined automatically during `/adw_init` step 7 (E2E tool detection). The detected tool dictates the command written to both `.adw/scenarios.md` and `.adw/commands.md`.

## Testing

```bash
bunx cucumber-js --tags "@adw-221"
```

This runs all 7 BDD scenarios tagged for this issue. Two scenarios exercise `projectConfig.ts` interface and map assertions; five scenarios validate the template and generated file correctness. All scenarios are also tagged `@regression` (except the two `projectConfig.ts` introspection scenarios) and will be included in regression runs going forward.

## Notes

- This is a documentation/template-only fix — no runtime TypeScript code was modified
- Existing target repositories that already have a `.adw/commands.md` without these sections are not broken; `projectConfig.ts` defaults remain as a safety net
- The fix keeps changes minimal per `guidelines/coding_guidelines.md` (clarity over cleverness, minimal diff)
