# BDD Scenario Review Proof

**ADW ID:** 9emriw-refactor-review-phas
**Date:** 2026-03-13
**Specification:** specs/issue-168-adw-9emriw-refactor-review-phas-sdlc_planner-bdd-scenario-review-proof.md

## Overview

Replaces the code-diff-based review proof with `@crucial` BDD scenario execution as the primary proof mechanism. Review agents now classify `@crucial` failures as blockers and current-issue (`@adw-{issueNumber}`) non-crucial failures as tech-debt. When `.adw/scenarios.md` is absent, the system falls back transparently to the existing code-diff proof behaviour.

## What Was Built

- `crucialScenarioProof.ts` — New orchestrator that runs `@crucial` and `@adw-{issueNumber}` scenarios, writes a structured `scenario_proof.md` file, and returns a typed `ScenarioProofResult`
- `runScenariosByTag` — New generic tag-based scenario runner in `bddScenarioRunner.ts` (replaces issue-number-specific logic with a `{tag}` placeholder)
- Review retry integration — `runReviewWithRetry` now runs scenario proof once per iteration before launching the 3 parallel review agents
- Scenario proof path forwarded to each review agent via `reviewAgent.ts` so the `/review` command can read and classify results
- `workflowCompletion.ts` updated to supply `issueNumber`, `scenariosMd`, `runCrucialCommand`, and `runByTagCommand` to the retry loop
- `.claude/commands/review.md` updated with scenario-aware proof instructions and fallback logic
- `.adw/review_proof.md` rewritten to describe the scenario-based proof format
- `features/review_phase.feature` — New BDD feature file covering review phase scenarios

## Technical Implementation

### Files Modified

- `adws/agents/crucialScenarioProof.ts`: New file — `ScenarioProofResult` interface, `shouldRunScenarioProof()`, `runCrucialScenarioProof()` orchestrator
- `adws/agents/bddScenarioRunner.ts`: Added `runScenariosByTag(tagCommand, tag, cwd?)` — generic tag-based subprocess runner with graceful skip for `'N/A'` commands
- `adws/agents/reviewAgent.ts`: Added optional `scenarioProofPath?` to `runReviewAgent` and `formatReviewArgs`; passes it as `$5` to the `/review` command
- `adws/agents/reviewRetry.ts`: Added `issueNumber`, `scenariosMd`, `runCrucialCommand`, `runByTagCommand` to `ReviewRetryOptions`; integrated scenario proof loop before parallel agents; added `scenarioProof?` to `ReviewRetryResult`
- `adws/agents/index.ts`: Exports `runScenariosByTag`, `runCrucialScenarioProof`, `shouldRunScenarioProof`, `ScenarioProofResult`
- `adws/phases/workflowCompletion.ts`: Passes four new fields from `WorkflowConfig.projectConfig` to `runReviewWithRetry`
- `.claude/commands/review.md`: Added `$5` variable (`scenarioProofPath`); scenario-aware proof section with fallback
- `.adw/review_proof.md`: Rewritten — scenario execution is primary proof; code-diff is fallback only
- `features/review_phase.feature`: BDD feature file for review phase acceptance scenarios

### Key Changes

- **Scenario proof runs once per iteration** before the 3 parallel review agents, writing results to `agents/{adwId}/scenario_proof/scenario_proof.md`
- **Early-exit on final attempt**: if `@crucial` scenarios fail on the last retry, a `blocker` `ReviewIssue` is returned immediately without launching review agents
- **Graceful fallback**: `shouldRunScenarioProof(scenariosMd)` returns `false` when `scenariosMd` is empty — review falls back to existing code-diff behaviour with no code changes required in target repos
- **Output truncation**: scenario stdout is capped at 10,000 characters in the proof file to prevent memory issues
- **Shared proof file**: all 3 review agents receive the same `resultsFilePath`, ensuring consistent classification without redundant scenario re-runs

## How to Use

1. Ensure `.adw/scenarios.md` exists in the target repo with non-empty content (presence enables scenario proof)
2. Ensure `.adw/commands.md` defines `runCrucialScenarios` and `runScenariosByTag` commands
3. Run the `/review` command as usual — the workflow automatically detects `scenarios.md` and runs `@crucial` scenarios first
4. Review agents receive the scenario proof path as `$5` and classify results:
   - `@crucial` failures → `blocker` issues
   - `@adw-{issueNumber}` non-crucial failures → `tech-debt` issues
5. The scenario proof file is written to `agents/{adwId}/scenario_proof/scenario_proof.md` and attached as a proof artifact in the PR review

## Configuration

| Setting | Location | Description |
|---|---|---|
| `runCrucialScenarios` | `.adw/commands.md` | Command to run `@crucial` scenarios (e.g. `cucumber-js --tags "@crucial"`) |
| `runScenariosByTag` | `.adw/commands.md` | Command template with `{tag}` placeholder (e.g. `cucumber-js --tags "@{tag}"`) |
| `scenariosMd` | `.adw/scenarios.md` | Non-empty content enables scenario proof; empty/absent triggers fallback |

## Testing

- Run `bun run lint` — linting must pass with no errors
- Run `bunx tsc --noEmit` — root-level type checking must pass
- Run `bunx tsc --noEmit -p adws/tsconfig.json` — adws type checking must pass
- Run `bun run build` — build must succeed
- BDD acceptance: `features/review_phase.feature` covers the review phase scenarios tagged `@adw-168`

## Notes

- The three parallel review agents all read the **same** scenario proof file — scenarios are not re-run per agent
- The patch-and-retry mechanism continues to work: if `@crucial` fail, the patch agent fixes the code and scenarios re-run on the next iteration
- Repos without `.adw/scenarios.md` continue to work unchanged — no migration required
- Depends on issue #165 (Scenario Planner Agent with `@crucial` tag maintenance) and #167 (BDD test infrastructure)
