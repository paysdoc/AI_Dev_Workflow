# Fix BDD Scenarios Failure That Blocks PR Creation

**ADW ID:** 8fns89
**Date:** 2026-03-25
**Specification:** specs/issue-289-adw-8fns89-sdlc_planner-fix-bdd-scenarios-failure.md

## Overview

This fix hardens the BDD scenario execution pipeline to prevent undefined-step failures from aborting the workflow prematurely. Three targeted changes address a misleading log message in the test phase, the absence of a step-definition pre-flight check in the review proof, and missing version logging at orchestrator startup.

## What Was Built

- **Conditional "Unit tests passed!" log** — the success message in `testPhase.ts` now fires only when unit tests actually ran and passed, not when tests are disabled.
- **Step definition pre-flight check** — `regressionScenarioProof.ts` checks for at least one `.ts` file in `features/step_definitions/` before spawning Cucumber; if none are found, it writes a warning markdown file and returns `hasBlockerFailures: false` so the workflow continues.
- **Git commit hash logging** — `workflowInit.ts` logs `ADW version: <short-hash>` at startup using `execSync('git rev-parse --short HEAD')`, enabling stale-code diagnosis from error logs.
- **`BoardStatus.Testing` transition** — `testPhase.ts` now moves the issue to the correct `Testing` board status (was incorrectly using `InProgress`).
- **`nonBlockerIssues` field removed from `ReviewRetryResult`** — cleanup of an unused field in `reviewRetry.ts` and its callers.
- **BDD feature file** — `features/fix_bdd_scenarios_failure.feature` documents regression scenarios for all the above behaviours.

## Technical Implementation

### Files Modified

- `adws/phases/testPhase.ts`: Moved `log('Unit tests passed!')` inside the `if (unitTestsEnabled)` block; fixed board status from `InProgress` to `Testing`.
- `adws/agents/regressionScenarioProof.ts`: Added pre-flight check (lines 121–135) that short-circuits `runScenarioProof()` when no step definition files exist, writing a warning proof file and returning `hasBlockerFailures: false`.
- `adws/phases/workflowInit.ts`: Added `import { execSync }` and a try-catch block that logs `ADW version: <commitHash>` in the startup banner.
- `adws/agents/reviewRetry.ts`: Removed `nonBlockerIssues` field from `MergedReviewResult`, `ReviewRetryResult`, and all return sites in `runReviewWithRetry()`.

### New Files

- `features/fix_bdd_scenarios_failure.feature`: BDD regression scenarios covering 14 scenarios across 7 concern areas (phase ordering, error handling, retry diagnostics, blocker detection, step-def pre-flight, markdown proof output, orchestrator phase ordering).
- `features/step_definitions/fixBddScenariosFailureSteps.ts`: Generated step definitions for the above feature.

### Key Changes

- The pre-flight check in `regressionScenarioProof.ts` uses `fs.existsSync` + `fs.readdirSync(...).some(f => f.endsWith('.ts'))` — a cheap file-system check, not a full Cucumber dry-run.
- When step definitions are absent the proof writes `scenario_proof.md` with a human-readable warning and returns `{ tagResults: [], hasBlockerFailures: false }`, allowing review agents to proceed normally.
- The `git rev-parse --short HEAD` call is wrapped in try-catch so it never throws in non-git environments.
- Removing `nonBlockerIssues` simplifies the `ReviewRetryResult` contract; callers that previously read this field now derive the information directly from `mergedIssues` if needed.

## How to Use

This fix is transparent — no user action is required. The changed behaviour is:

1. When a workflow run reaches the review phase on a repo that has no step definitions yet, the BDD proof step logs `⚠️ No step definition files found in features/step_definitions/ — skipping BDD scenario proof` and continues rather than failing.
2. The orchestrator startup banner now includes a line like `ADW version: ca1cbdc` for every run.
3. `testPhase.ts` no longer logs a false "Unit tests passed!" when unit tests are disabled.

## Configuration

No new configuration is required. The pre-flight check uses `cwd` from `RunScenarioProofOptions` (defaulting to `process.cwd()`), which is already set by callers in `workflowCompletion.ts`.

## Testing

```bash
# Type-check the whole project
bunx tsc --noEmit

# Type-check the adws module
bunx tsc --noEmit -p adws/tsconfig.json

# Lint
bun run lint

# BDD dry-run (verifies all step definitions parse)
NODE_OPTIONS="--import tsx" bunx cucumber-js --dry-run
```

The BDD scenarios in `features/fix_bdd_scenarios_failure.feature` tagged `@adw-8fns89-error-in-issue-288` cover the regression cases for this fix.

## Notes

- The primary fix (moving BDD from test phase to review phase) was applied in commit `8507da4` (PR #252, 2026-03-21). This fix adds hardening on top of that.
- `adwTest.tsx` intentionally still runs BDD scenarios without a step-def generation phase because it targets repos that already have step definitions in place.
- The removed `nonBlockerIssues` field was never consumed by any caller in the current codebase; its removal is safe and reduces interface surface area.
