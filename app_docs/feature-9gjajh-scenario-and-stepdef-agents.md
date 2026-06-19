# Scenario & Step Def Agents

## Overview

This module provides the agent layer for BDD scenario authorship, step definition generation, test execution, and failure resolution. It bridges GitHub issues to runnable Cucumber scenarios by dispatching Claude slash-command agents and subprocess BDD runners inside target-repo worktrees.

## Responsibilities

- `scenarioAgent.ts`: Invokes the `/scenario_writer` skill against a GitHub issue, filtering out ADW system comments and surfacing only human comments and the latest actionable content before passing issue JSON to the agent. Writes output to `scenario-agent.jsonl` in the logs directory.
- `stepDefAgent.ts`: Invokes the `/generate_step_definitions` skill for a given issue number and ADW ID, parses the agent's JSON output to extract a list of removed scenarios (with feature file, scenario name, and reason), and returns a `StepDefAgentResult` that extends `AgentResult`. Writes output to `step-def-agent.jsonl`.
- `testAgent.ts`: Invokes the `/test` skill, parses the returned JSON array of `TestResult` objects, computes `allPassed` and `failedTests`, and extracts `applicationTestcaseCount` from the `app_tests` entry. Provides two resolution agents: `runResolveTestAgent` (unit test failures via `/resolve_failed_test`) and `runResolveScenarioAgent` (E2E failures via `/resolve_failed_scenario`). Model and effort level for resolvers are looked up from `getModelForCommand`/`getEffortForCommand`.
- `bddScenarioRunner.ts`: Executes an arbitrary tag-filtered BDD command as a subprocess (`shell: true`), substitutes `{tag}` in the command template with a concrete tag value, captures stdout/stderr, and returns a `BddScenarioResult`. Skips execution gracefully when the command is `'N/A'` or empty.

## Contracts & Invariants

- All agents accept an optional `cwd` that defaults to `process.cwd()` — callers must pass the worktree path to ensure agents read and write files in the target repository, not the ADW repo.
- `runScenariosByTag` returns `allPassed: true` with exit code `0` when `tagCommand` is `'N/A'` or empty — consumers must treat this as a no-op pass, not an actual passing run.
- `StepDefAgentResult.removedScenarios` is always an array (never `null` or `undefined`); parse failures produce an empty array and surface the error through `AgentResult` rather than throwing.
- `TestAgentResult.allPassed` is `false` when `testResults` is empty — zero-length result sets are not treated as a success.
- `runResolveScenarioAgent` sanitises the `testName` field before using it in a log file path: undefined or empty names fall back to `'unknown-test'` to avoid path errors.
- The step def agent outputs a JSON object matching `removedScenariosSchema`; callers should not assume the agent emits pure JSON — `parseRemovedScenarios` uses a regex to locate the first `{...}` block in the raw output.

## Configuration

All agents delegate model selection and effort level to `getModelForCommand` / `getEffortForCommand` from `../core`. No agent-specific configuration is required; the `cwd`, `logsDir`, `statePath`, and `contextPreamble` parameters are supplied by the orchestrator at call time.

## Gotchas

- `bddScenarioRunner.ts` spawns the full tag command with `shell: true`. The command string is template-substituted but not otherwise escaped — malformed or attacker-controlled `tagCommand` values could be hazardous in non-hermetic environments.
- The `{tag}` placeholder replacement in `runScenariosByTag` is global (`/\{tag\}/g`), so commands with multiple `{tag}` occurrences all get replaced with the same value.
- `scenarioAgent.ts` reverses the comments array and uses `reduce` with a short-circuit to find the latest actionable comment; only the single most-recent actionable comment is passed, not all of them.
- `testAgent.ts` distinguishes between an empty JSON array `[]` (valid — no tests found) and missing JSON (error): a regex check for `/\[[\s\S]*\]/` determines which branch is taken before returning a structured error.
- `runResolveScenarioAgent` embeds `applicationUrl` inside the failure JSON payload rather than passing it as a separate argument — the resolver skill must know to read `applicationUrl` from the JSON body.
- Log file names for `runResolveTestAgent` include `failedTest.test_name` directly; names with path separators or special characters could produce unexpected file locations.
