# BDD Step Definition Generation & Review-First Gating

**ADW ID:** ex60ng-make-bdd-scenarios-r
**Date:** 2026-03-21
**Specification:** specs/issue-249-adw-vlphr9-make-bdd-scenarios-r-sdlc_planner-step-def-gen-review-gating.md

## Overview

This feature closes the structural gap where BDD scenarios written by the scenario agent had no step definitions, causing Cucumber to fail with undefined steps and blocking PR creation. It introduces a new `/generate_step_definitions` slash command and phase, restructures the test phase to unit-tests-only, and gates PR creation behind a passing review phase.

## What Was Built

- **`/generate_step_definitions` slash command** — reads `@adw-{issueNumber}` tagged feature files, avoids duplicating existing step patterns, classifies and removes ungeneratable scenarios, and returns structured JSON output
- **`stepDefAgent.ts`** — agent wrapper that invokes the command and parses the `removedScenarios` JSON from the agent output
- **`stepDefPhase.ts`** — non-fatal phase orchestrator that runs the agent and posts a warning comment on the issue listing any removed scenarios
- **Review-first gating** — `executeReviewPhase` now calls `process.exit(1)` on failure, blocking PR creation; PR is only created after review passes
- **Test phase simplified** — BDD scenario execution removed from `testPhase.ts`; phase now runs unit tests only (BDD runs in the review phase via the existing proof system)
- **Coding guidelines check in review** — `review.md` now reads `.adw/coding_guidelines.md` (fallback: `guidelines/coding_guidelines.md`) and reports violations as `tech-debt` severity
- **Orchestrator rewiring** — review orchestrators (`adwSdlc`, `adwPlanBuildTestReview`, `adwPlanBuildReview`) reordered to: Plan → Scenarios → Validation → Build → Test → Step Def Gen → Review → [Document] → PR; non-review orchestrators (`adwPlanBuild`, `adwPlanBuildTest`, `adwPlanBuildDocument`) simplified by removing scenario, validation, and step def phases
- **BDD step definitions** — `features/step_definitions/stepDefGenReviewGatingSteps.ts` added for the new `step_def_generation_review_gating.feature` scenarios

## Technical Implementation

### Files Modified

- `.claude/commands/generate_step_definitions.md`: New slash command — reads feature files, classifies generatable vs ungeneratable scenarios, removes ungeneratable ones, generates step definitions, returns structured JSON
- `adws/agents/stepDefAgent.ts`: New agent wrapper — parses `removedScenarios` from JSON output, exports `StepDefAgentResult` and `RemovedScenario` types
- `adws/phases/stepDefPhase.ts`: New non-fatal phase — runs agent, posts warning comment for removed scenarios, creates `step-def-gen` cost records
- `adws/phases/workflowCompletion.ts`: `executeReviewPhase` now exits with `process.exit(1)` on review failure (hard fail, blocks PR)
- `adws/phases/testPhase.ts`: BDD scenario execution block removed; phase is now unit-tests-only
- `.claude/commands/review.md`: Added coding guidelines check section (reads `.adw/coding_guidelines.md` with fallback)
- `adws/adwSdlc.tsx`, `adws/adwPlanBuildTestReview.tsx`, `adws/adwPlanBuildReview.tsx`: Phase ordering updated — step def gen inserted after test, review moved before PR
- `adws/adwPlanBuild.tsx`, `adws/adwPlanBuildTest.tsx`, `adws/adwPlanBuildDocument.tsx`: Scenario, plan validation, and step def phases removed
- `adws/core/config.ts`: `/generate_step_definitions` added to `SLASH_COMMAND_MODEL_MAP` (sonnet) and `SLASH_COMMAND_EFFORT_MAP` (low)
- `adws/agents/index.ts`, `adws/phases/index.ts`, `adws/workflowPhases.ts`: New exports added
- `features/step_definitions/stepDefGenReviewGatingSteps.ts`: Cucumber step definitions for the new feature scenarios

### Key Changes

- **Non-fatal step def phase**: `stepDefPhase.ts` wraps everything in try-catch; failures log a warning but never abort the workflow — step definitions are best-effort
- **Ungeneratable scenario removal**: scenarios requiring live servers, databases, or LLM calls are removed from `.feature` files at generation time; a GitHub issue comment lists what was removed and why
- **Hard review gate**: a single `process.exit(1)` added in `executeReviewPhase` after the existing error-comment/state-write block ensures no PR survives a failed review
- **BDD in review, not test**: `testPhase.ts` no longer calls `runScenariosByTag`; the review proof system (`regressionScenarioProof.ts`, `reviewRetry.ts`) now owns all BDD execution
- **Leaner non-review paths**: three orchestrators shed the scenario writer, plan validation, and step def gen phases — saving one to three agent invocations per run

## How to Use

### Review-capable orchestrators (adwSdlc, adwPlanBuildTestReview, adwPlanBuildReview)

Phase order is now automatic:
1. Plan + Scenarios (parallel)
2. Plan Validation
3. Build
4. Unit Tests
5. **Step Definition Generation** ← new
6. **Review (BDD + regression)** ← gates PR
7. [Document — SDLC only]
8. PR
9. [KPI — SDLC only]

No configuration required. The step def agent reads `.adw/scenarios.md` for the scenario directory path (defaults to `features/`).

### Non-review orchestrators (adwPlanBuild, adwPlanBuildTest, adwPlanBuildDocument)

Phase order is simplified — scenario writing, plan validation, and step def gen are skipped entirely:
1. Plan
2. Build
3. Unit Tests
4. [Document — adwPlanBuildDocument only]
5. PR

### Coding guidelines check in review

Add a `.adw/coding_guidelines.md` file to the target repository to enable per-project guidelines. The review agent will read this file and report violations as `tech-debt` severity issues. If the file is absent, `guidelines/coding_guidelines.md` is used as a fallback; if neither exists, the check is silently skipped.

## Configuration

- **Step def agent model**: `sonnet` (set in `SLASH_COMMAND_MODEL_MAP`)
- **Step def agent effort**: `low` (set in `SLASH_COMMAND_EFFORT_MAP`)
- **Scenario directory**: read from `.adw/scenarios.md`; defaults to `features/`
- **Coding guidelines**: `.adw/coding_guidelines.md` in target repo, fallback `guidelines/coding_guidelines.md`

## Testing

```sh
# Verify step definitions parse (no undefined steps)
bunx cucumber-js --dry-run

# Run the new feature's scenarios
bunx cucumber-js --tags @adw-249

# Type check
bunx tsc --noEmit -p adws/tsconfig.json

# Lint
bun run lint
```

## Notes

- **Future work**: The step def agent uses static file-scanning to determine generatability. Runtime infrastructure (mocked LLM calls in Docker, live DB) for removed scenarios is tracked as a separate issue.
- **Review retry loop unchanged**: the existing `maxRetries` patch-and-retry loop in `reviewRetry.ts` is unaffected. The hard fail (`process.exit(1)`) only triggers after all retries are exhausted.
- **`@regression` tag convention unchanged**: the scenario writer already tags regression scenarios; `regressionScenarioProof.ts` already runs them during review — no changes needed to the proof system.
