# Scenario-Authoring Skip Gate

## Overview

Promotion issues (those carrying the `regression-promotion` label) relocate an already-existing per-issue BDD scenario into the regression suite — they never need a freshly authored scenario. This module is a deterministic, orchestration-level gate that stops the SDLC pipeline's scenario-authoring phases from running for such issues, so they never invent a junk `features/per-issue/feature-<N>.feature` file.

## Responsibilities

- `shouldSkipScenarioAuthoring(labels)` (`adws/github/labelManager.ts`) — pure predicate, `true` when the issue's labels contain `ADW_REGRESSION_PROMOTION_LABEL` (`'regression-promotion'`). No I/O, no logging.
- `executeScenarioPhase` (`adws/phases/scenarioPhase.ts`) — the load-bearing wiring point: early-returns a zero-cost no-op result before `/scenario_writer` is invoked when `shouldSkipScenarioAuthoring(issue.labels)` is true.
- `executeAlignmentPhase` (`adws/phases/alignmentPhase.ts`) — an explicit defense-in-depth gate, placed immediately after the existing resume-skip guard, that early-returns the same zero-cost shape for promotion issues (on top of its pre-existing implicit skip when `findScenarioFiles(issueNumber)` is empty).

## Contracts & Invariants

- Both phase-level gates return the exact zero-cost shape (`{ costUsd: 0, modelUsage: emptyModelUsageMap(), phaseCostRecords: [] }`) that the phases' own resume-skip guards already return, so cost/token/state accounting is unaffected.
- The gate is independent of `shouldExecuteStage`/resume state — it fires identically on a fresh run and a resumed run.
- No orchestrator (`adwSdlc.tsx`) change was needed: the gate lives inside the two phase functions, so it fires correctly even though the scenario phase runs in parallel with planning (`runPhasesParallel([executePlanPhase, executeScenarioPhase])`).
- The gate is match-exact (`l.name === ADW_REGRESSION_PROMOTION_LABEL`), not substring — a hypothetical `regression-promotion-foo` label does not trigger it, and an empty label array never skips.
- The downstream cascade (validation, gherkin-freeze, fidelity) requires no gate of its own: all of it keys off `findScenarioFiles(issueNumber, worktreePath).length === 0`, which is guaranteed once no `@adw-<promotionIssueN>` scenario is authored. With zero scenarios, the `@adw-{issueNumber}` review-proof tag defaults to `optional: true`, so a zero-testcase run of it is `{passed:true, skipped:true}` and never contributes to `hasBlockerFailures` — the pipeline stays green. The promotion issue's `@regression` tag pass (the relocated scenario) still runs and proves green normally.
- `regression-promotion` is deliberately kept out of `ADW_CLASSIFICATION_LABELS`/`LABEL_TO_COMMAND` (invisible to issue-type routing) and out of `ADW_LABEL_DEFINITIONS` — the gate only reads presence, it does not participate in classification.

## Configuration

None — the gate has no environment variables or project config; it is purely a function of the issue's GitHub labels.

## Gotchas

- A normal `/feature` issue (no `regression-promotion` label) is completely unaffected — scenario authoring and alignment run exactly as before.
- This gate does not require or introduce a `scenarioPhase.test.ts`/`alignmentPhase.test.ts` unit test; per the parent PRD's Testing Decisions, both the pure gate and its wiring are integration-covered by `@adw-742`-tagged BDD scenarios rather than isolated units.
- Do not make the `@adw-{issueNumber}` review-proof tag non-optional without explicitly exempting promotion issues — doing so would redden every promotion run once scenario authoring stops producing a matching scenario.
