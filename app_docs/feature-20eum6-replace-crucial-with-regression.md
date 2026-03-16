# Replace @crucial with @regression

**ADW ID:** 20eum6-replace-crucial-with
**Date:** 2026-03-16
**Specification:** specs/issue-194-adw-20eum6-replace-crucial-with-sdlc_planner-replace-crucial-with-regression.md

## Overview

Renames the BDD regression tag from `@crucial` to `@regression` across the entire ADW codebase. The previous name was vague; `@regression` is a well-known testing term that immediately communicates the purpose — these scenarios form the regression safety net that guards against regressions in existing functionality.

## What Was Built

- Renamed `adws/agents/crucialScenarioProof.ts` → `adws/agents/regressionScenarioProof.ts` with all internal identifiers updated
- Updated all TypeScript types (`crucialPassed` → `regressionPassed`, `runCrucialScenarios` → `runRegressionScenarios`, etc.)
- Updated all `.adw/` configuration files to use `@regression` and `## Run Regression Scenarios`
- Updated all `.claude/commands/` slash command prompts
- Updated all `.feature` files to use `@regression` tags
- Updated `README.md` and `adws/README.md` documentation
- Added `features/replace_crucial_with_regression.feature` BDD coverage for this change

## Technical Implementation

### Files Modified

- `adws/agents/regressionScenarioProof.ts`: Renamed from `crucialScenarioProof.ts`; all identifiers renamed to use "regression" prefix; tag passed to `runScenariosByTag` changed from `'crucial'` to `'regression'`
- `adws/agents/index.ts`: Updated import path and export names
- `adws/agents/reviewRetry.ts`: Updated import, `ReviewRetryOptions.runRegressionCommand`, log messages, blocker issue text
- `adws/core/projectConfig.ts`: Updated `CommandsConfig.runRegressionScenarios`, `ScenariosConfig.runRegression`, heading-to-key mappings (`'run regression scenarios'`), and default cucumber command strings
- `adws/phases/workflowCompletion.ts`: Updated reference to `commands.runRegressionScenarios`
- `adws/agents/bddScenarioRunner.ts`: Updated JSDoc comments
- `.adw/commands.md`, `.adw/scenarios.md`: `## Run Regression Scenarios` heading and `@regression` tag in commands
- `.adw/review_proof.md`, `.adw/conditional_docs.md`, `.adw/project.md`: All `@crucial` references replaced
- `.claude/commands/review.md`, `.claude/commands/scenario_writer.md`, `.claude/commands/adw_init.md`: All `@crucial` references replaced
- `features/*.feature`: All `@crucial` tags replaced with `@regression`
- `README.md`, `adws/README.md`: All references updated

### Key Changes

- **Core rename**: `crucialScenarioProof.ts` → `regressionScenarioProof.ts` with full identifier cascade (`crucialPassed`, `crucialOutput`, `crucialExitCode`, `runCrucialScenarioProof`, `runCrucialCommand`)
- **Config type rename**: `CommandsConfig.runCrucialScenarios` → `runRegressionScenarios`; `ScenariosConfig.runCrucial` → `runRegression`
- **Heading mapping updated**: `projectConfig.ts` heading-to-key maps now key on `'run regression scenarios'` for both commands and scenarios config
- **Tag string updated**: The `runScenariosByTag` call in the proof file now passes `'regression'` so cucumber runs `--tags "@regression"`
- **No functional behaviour change**: This is a pure rename — the review proof mechanism, scenario runner, and retry logic all work identically

## How to Use

The `@regression` tag works identically to the former `@crucial` tag:

1. Tag any BDD scenario that should be part of the regression suite with `@regression`
2. The review phase automatically runs all `@regression`-tagged scenarios as proof
3. Configure the regression command in `.adw/commands.md` under `## Run Regression Scenarios`
4. Configure the scenario tag list in `.adw/scenarios.md` under `## Run Regression Scenarios`

## Configuration

In `.adw/commands.md`:
```md
## Run Regression Scenarios
cucumber-js --tags "@regression"
```

In `.adw/scenarios.md`:
```md
## Run Regression Scenarios
cucumber-js --tags "@regression"
```

## Testing

Run the `@regression`-tagged BDD scenarios to validate:

```bash
# From the target project directory
cucumber-js --tags "@regression"
```

To verify no stale `@crucial` references remain in active source:
```bash
grep -ri "crucial" adws/ .adw/ .claude/commands/ features/ README.md \
  --include="*.ts" --include="*.md" --include="*.feature" \
  | grep -v "node_modules" | grep -v "specs/" | grep -v "app_docs/"
```

## Notes

- Historical files in `specs/` and `app_docs/` were intentionally left unchanged — they are immutable records of past planning and implementation
- `specs/patch/` files for this ADW run are also preserved as-is
- No new libraries or runtime behaviour were introduced — this is a pure rename
