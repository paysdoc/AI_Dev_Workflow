# Feature: Refactor test phase — run relevant BDD scenarios after build, before PR creation

## Metadata
issueNumber: `167`
adwId: `q9kms5-refactor-test-phase`
issueJson: `{"number":167,"title":"Refactor test phase: run relevant BDD scenarios after build, before PR creation","body":"## Context\n\nCurrently the pipeline order is: Build → PR → Tests → Review. This is inverted: a PR should not be created for untested work. This issue moves BDD scenario execution to after build and before PR creation. Unit tests become opt-in via a flag in \\`.adw/project.md\\`.\n\n## Depends on\n\n- #164 (BDD scenario configuration and tagging conventions)\n- #165 (Scenario Planner Agent — scenarios must exist before they can be run)\n\n## Requirements\n\n### Pipeline reorder\n\nNew order: **Build → Relevant BDD Scenarios → PR → Review**\n\n- After build, run all scenarios tagged \\`@adw-{issueNumber}\\` using the command from \\`.adw/scenarios.md\\` / \\`commands.md\\`\n- PR is only created if relevant scenarios pass\n- Retry behaviour: scenario failures trigger the existing resolve-agent retry mechanism (equivalent to current E2E retry)\n\n### Unit test opt-in\n\n- New indicator in \\`.adw/project.md\\`: \\`## Unit Tests\\` with value \\`enabled\\` or \\`disabled\\`\n- If \\`enabled\\`: unit tests run before BDD scenarios as a fast first gate\n- If \\`disabled\\` (or indicator absent): unit tests are skipped entirely\n- Default when indicator is absent: \\`disabled\\`\n\n### Orchestrator updates\n\nAll orchestrators updated to reflect the new phase order:\n- \\`adwPlanBuild\\`, \\`adwPlanBuildTest\\`, \\`adwPlanBuildReview\\`, \\`adwPlanBuildDocument\\`, \\`adwPlanBuildTestReview\\`, \\`adwSdlc\\`\n- Existing \\`testPhase.ts\\` refactored or replaced to reflect BDD-first execution\n\n## Acceptance Criteria\n\n- Relevant BDD scenarios (\\`@adw-{issueNumber}\\`) run after build and before PR creation\n- PR is not created if relevant scenarios fail after retries\n- Unit tests only run when \\`.adw/project.md\\` has \\`## Unit Tests: enabled\\`\n- All orchestrators reflect the new order\n- Existing retry and error-reporting mechanisms work with BDD scenario failures","state":"OPEN","author":"paysdoc","labels":["enhancement"],"createdAt":"2026-03-13T07:02:17Z","comments":[],"actionableComment":null}`

## Feature Description
This feature refactors the ADW test phase to prioritise BDD scenario execution over unit tests. The current pipeline runs tests _after_ PR creation (`Build → PR → Tests → Review`), which means PRs are opened for untested work. The new pipeline runs relevant BDD scenarios _before_ PR creation (`Build → [Unit Tests] → BDD Scenarios → PR → Review`), gating PR creation on scenario success.

Unit tests become opt-in via a `## Unit Tests` indicator in `.adw/project.md`. When enabled, they run as a fast first gate before BDD scenarios. When disabled (the default), they are skipped entirely.

All orchestrators that include a test or PR phase are updated to reflect the new ordering.

## User Story
As an ADW operator
I want BDD scenarios for my issue to run and pass before a PR is created
So that untested work is never pushed as a pull request and I get faster feedback on scenario failures

## Problem Statement
The current pipeline creates a PR before running tests, which means reviewers (and CI) see untested code. BDD scenarios are the primary quality gate (per coding guidelines, agent-written unit tests are unreliable), yet they run too late in the pipeline. Additionally, unit tests always run even for repos that have opted out, wasting time and cost.

## Solution Statement
1. Refactor `testPhase.ts` to: (a) optionally run unit tests based on the `.adw/project.md` `## Unit Tests` indicator, then (b) run BDD scenarios tagged `@adw-{issueNumber}` using the command from `.adw/commands.md` (`## Run BDD Scenarios`).
2. Add a BDD scenario runner in `agents/` that executes the tag-filtered scenario command as a subprocess, parses results, and supports retry-with-resolution via the existing `retryWithResolution` infrastructure.
3. Add a `runBddScenarios` field to `CommandsConfig` and parse `## Run BDD Scenarios` from `.adw/commands.md`.
4. Add a `unitTestsEnabled` helper that reads the `## Unit Tests` section from `projectMd`.
5. Update every orchestrator to include the test phase between build and PR (for those that previously skipped it) and ensure the new ordering is reflected.

## Relevant Files
Use these files to implement the feature:

- `guidelines/coding_guidelines.md` — Coding standards to follow; confirms BDD scenarios are ADW's validation mechanism and unit tests are opt-in.
- `adws/phases/testPhase.ts` — **Primary file to refactor.** Currently runs unit tests then E2E tests sequentially; needs to become: optional unit tests → BDD scenarios.
- `adws/agents/testRetry.ts` — Contains `runUnitTestsWithRetry` and `runE2ETestsWithRetry`. Add `runBddScenariosWithRetry`.
- `adws/agents/testAgent.ts` — Test agent runners. Add a BDD scenario agent runner (or subprocess executor).
- `adws/agents/testDiscovery.ts` — E2E test discovery and Playwright runner. Add BDD scenario discovery/runner.
- `adws/agents/index.ts` — Agent barrel exports. Add new BDD exports.
- `adws/core/projectConfig.ts` — `CommandsConfig` type and `parseCommandsMd`. Add `runBddScenarios` field and `## Run BDD Scenarios` heading mapping. Add `parseUnitTestsEnabled` helper.
- `adws/core/constants.ts` — Orchestrator ID constants (no changes expected).
- `adws/core/retryOrchestrator.ts` — Generic `retryWithResolution` loop. Reuse for BDD scenario retries.
- `adws/phases/index.ts` — Phase barrel exports (may need updates if new phases are added).
- `adws/workflowPhases.ts` — Workflow phase re-exports.
- `adws/adwPlanBuild.tsx` — Orchestrator: currently `Plan → Build → PR`. Change to `Plan → Build → Test → PR`.
- `adws/adwPlanBuildTest.tsx` — Orchestrator: currently `Plan → Build → Test → PR`. Refactored test phase.
- `adws/adwPlanBuildReview.tsx` — Orchestrator: currently `Plan → Build → PR → Review`. Change to `Plan → Build → Test → PR → Review`.
- `adws/adwPlanBuildDocument.tsx` — Orchestrator: currently `Plan → Build → PR → Document`. Change to `Plan → Build → Test → PR → Document`.
- `adws/adwPlanBuildTestReview.tsx` — Orchestrator: currently `Plan → Build → Test → PR → Review`. Refactored test phase.
- `adws/adwSdlc.tsx` — Orchestrator: currently `Plan → Build → Test → PR → Review → Document → KPI`. Refactored test phase.
- `adws/adwTest.tsx` — Standalone test orchestrator. Refactor to match new test phase logic.
- `.adw/commands.md` — ADW project commands. Add `## Run BDD Scenarios` section.
- `.adw/project.md` — ADW project config. Already has `## Unit Tests: disabled`; clarify format.

### New Files
- `adws/agents/bddScenarioRunner.ts` — BDD scenario subprocess executor: runs the tag-filtered scenario command, parses exit code/output, returns structured results. Analogous to `testDiscovery.ts` for Playwright.

## Implementation Plan
### Phase 1: Foundation — Config and parsing
Extend `CommandsConfig` with a `runBddScenarios` field. Map the `## Run BDD Scenarios` heading in `commands.md`. Add a `parseUnitTestsEnabled(projectMd: string): boolean` helper to `projectConfig.ts` that reads the `## Unit Tests` section from the raw project markdown and returns `true` only when the value is `enabled`. Update `.adw/commands.md` to add the `## Run BDD Scenarios` section with a default command template.

### Phase 2: Core Implementation — BDD scenario runner and retry
Create `bddScenarioRunner.ts` with a function `runBddScenarios(command: string, issueNumber: number, cwd?: string)` that:
1. Substitutes `{issueNumber}` into the command template (for the `@adw-{issueNumber}` tag filter).
2. Spawns the command as a subprocess.
3. Returns a structured result (`BddScenarioResult`) with `allPassed`, `stdout`, `stderr`, `exitCode`.

Add `runBddScenariosWithRetry` to `testRetry.ts` that wraps the scenario runner with the existing `retryWithResolution` pattern, using the resolve-agent to fix failures and re-run.

### Phase 3: Integration — Test phase refactor and orchestrator updates
Refactor `testPhase.ts` to:
1. Read `projectConfig` from `config` to check `unitTestsEnabled`.
2. If unit tests are enabled, run `runUnitTestsWithRetry` as a fast first gate (exit on failure).
3. Run `runBddScenariosWithRetry` with the command from `config.projectConfig.commands.runBddScenarios` and `config.issueNumber`.
4. Return updated result shape including `unitTestsPassed`, `bddScenariosPassed`.

Update all six orchestrators:
- `adwPlanBuild`, `adwPlanBuildReview`, `adwPlanBuildDocument`: insert `executeTestPhase` between build and PR phases.
- `adwPlanBuildTest`, `adwPlanBuildTestReview`, `adwSdlc`: already have `executeTestPhase` in the right position; the refactored phase handles the new logic.
- `adwTest.tsx`: update standalone test orchestrator to match.

Update orchestrator JSDoc headers and workflow comments to reflect the new ordering.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Extend `CommandsConfig` with `runBddScenarios`
- In `adws/core/projectConfig.ts`:
  - Add `runBddScenarios: string` to the `CommandsConfig` interface.
  - Add a default value in `getDefaultCommandsConfig()`: `runBddScenarios: 'N/A'`.
  - Add `'run bdd scenarios': 'runBddScenarios'` to the `HEADING_TO_KEY` map.
- In `.adw/commands.md`:
  - Add a `## Run BDD Scenarios` section with the value `N/A` (ADW itself doesn't have BDD scenarios; target repos provide their own command).

### Step 2: Add `parseUnitTestsEnabled` helper
- In `adws/core/projectConfig.ts`:
  - Add an exported function `parseUnitTestsEnabled(projectMd: string): boolean` that:
    - Uses `parseMarkdownSections(projectMd)` to extract sections.
    - Checks for a key starting with `unit tests` (to handle both `## Unit Tests: enabled` heading-inline format and `## Unit Tests` with body `enabled`).
    - Returns `true` only when the resolved value is `'enabled'`.
    - Returns `false` for `'disabled'`, absent section, or any other value.
  - Export `parseUnitTestsEnabled` from `adws/core/index.ts`.

### Step 3: Create `bddScenarioRunner.ts`
- Create `adws/agents/bddScenarioRunner.ts` with:
  - `BddScenarioResult` interface: `{ allPassed: boolean; stdout: string; stderr: string; exitCode: number | null }`.
  - `runBddScenarios(command: string, issueNumber: number, cwd?: string): Promise<BddScenarioResult>` function:
    - If `command` is `'N/A'` or empty, return `{ allPassed: true, stdout: '', stderr: '', exitCode: 0 }` (no scenarios configured — skip gracefully).
    - Replace `{issueNumber}` in the command template with the actual issue number.
    - Spawn the command using `Bun.spawn` (or `child_process.spawn` for compatibility) with shell mode.
    - Capture stdout and stderr.
    - Return `allPassed: exitCode === 0`.
  - Export from `adws/agents/index.ts`.

### Step 4: Add `runBddScenariosWithRetry` to `testRetry.ts`
- In `adws/agents/testRetry.ts`:
  - Add `BddScenarioRetryOptions` extending `TestRetryOptions` with `scenarioCommand: string` and `issueNumber: number`.
  - Add `runBddScenariosWithRetry(opts: BddScenarioRetryOptions): Promise<TestRetryResult>` function:
    - Call `runBddScenarios(opts.scenarioCommand, opts.issueNumber, opts.cwd)`.
    - If `allPassed`, return immediately.
    - On failure, enter retry loop:
      - Use `runResolveE2ETestAgent` (or a new resolve agent) to attempt resolution of failures.
      - Re-run `runBddScenarios` after each resolution.
      - Track retries and cost.
      - Stop after `opts.maxRetries`.
    - Return `TestRetryResult` with `passed`, `costUsd`, `totalRetries`, `failedTests`, `modelUsage`.
  - Export from `adws/agents/index.ts`.

### Step 5: Refactor `testPhase.ts` — BDD-first execution
- Rewrite `adws/phases/testPhase.ts` `executeTestPhase`:
  - Extract `projectConfig` from `config` (already available on `WorkflowConfig`).
  - **Unit tests gate** (conditional):
    - Call `parseUnitTestsEnabled(config.projectConfig.projectMd)`.
    - If `true`: run `runUnitTestsWithRetry` as before. On failure, exit with error (existing logic).
    - If `false`: log "Unit tests disabled — skipping" and set `unitTestsPassed` to `true`.
  - **BDD scenarios gate** (always):
    - Read `config.projectConfig.commands.runBddScenarios`.
    - Call `runBddScenariosWithRetry` with the scenario command and `config.issueNumber`.
    - On failure after retries: post error comment, write state, `process.exit(1)` (same pattern as current unit test failure).
    - On success: log and continue.
  - Update return type: replace `e2eTestsPassed` with `bddScenariosPassed`.
  - Return `{ costUsd, modelUsage, unitTestsPassed, bddScenariosPassed, totalRetries }`.

### Step 6: Update `adwPlanBuild.tsx` — add test phase
- Import `executeTestPhase` from `./workflowPhases`.
- Insert test phase execution between build and PR phases.
- Pass `testResult` metadata to `completeWorkflow`.
- Update JSDoc header to reflect new workflow order: `Plan → Build → Test → PR`.

### Step 7: Update `adwPlanBuildReview.tsx` — add test phase
- Import `executeTestPhase` from `./workflowPhases`.
- Insert test phase execution between build and PR phases.
- Pass `testResult` metadata to `completeWorkflow` (merge with review metadata).
- Update JSDoc header to reflect new workflow order: `Plan → Build → Test → PR → Review`.

### Step 8: Update `adwPlanBuildDocument.tsx` — add test phase
- Import `executeTestPhase` from `./workflowPhases`.
- Insert test phase execution between build and PR phases.
- Pass `testResult` metadata to `completeWorkflow`.
- Update JSDoc header to reflect new workflow order: `Plan → Build → Test → PR → Document`.

### Step 9: Update `adwPlanBuildTest.tsx` — update JSDoc and metadata
- The test phase is already in the correct position (between build and PR).
- Update JSDoc header to clarify: "Test Phase: optionally run unit tests, then run BDD scenarios".
- Update `completeWorkflow` metadata: replace `e2eTestsPassed` with `bddScenariosPassed`.

### Step 10: Update `adwPlanBuildTestReview.tsx` — update JSDoc and metadata
- The test phase is already in the correct position.
- Update JSDoc header to clarify BDD-first test phase.
- Update `completeWorkflow` metadata: replace `e2eTestsPassed` with `bddScenariosPassed`.

### Step 11: Update `adwSdlc.tsx` — update JSDoc and metadata
- The test phase is already in the correct position.
- Update JSDoc header to clarify BDD-first test phase.
- Update `completeWorkflow` metadata: replace `e2eTestsPassed` with `bddScenariosPassed`.

### Step 12: Update `adwTest.tsx` — standalone test orchestrator
- Refactor to match the new test phase logic (optional unit tests → BDD scenarios).
- Ensure it reads project config to determine unit test opt-in status.

### Step 13: Update `completeWorkflow` metadata shape
- In `adws/phases/workflowCompletion.ts` (or wherever `completeWorkflow` accepts the test metadata):
  - Replace `e2eTestsPassed` with `bddScenariosPassed` in the metadata type.
  - Update any references in completion comments or state writes.

### Step 14: Run validation commands
- Run `bun run lint` to verify no lint errors.
- Run `bunx tsc --noEmit` to verify TypeScript compiles cleanly.
- Run `bunx tsc --noEmit -p adws/tsconfig.json` for the adws sub-project.
- Run `bun run build` to verify no build errors.
- Run `bun run test` to verify no regressions (if any tests exist).

## Testing Strategy
### Unit Tests
Unit tests are disabled for ADW itself (per `.adw/project.md`). Validation relies on TypeScript compilation, linting, and the BDD scenarios infrastructure being set up by dependency issues #164/#165.

### Edge Cases
- `.adw/commands.md` has no `## Run BDD Scenarios` section → default to `N/A` → scenarios skipped gracefully, PR proceeds.
- `.adw/project.md` has no `## Unit Tests` section → default to `disabled` → unit tests skipped.
- `.adw/project.md` has `## Unit Tests: enabled` (colon-inline format) → parsed as enabled.
- `.adw/project.md` has `## Unit Tests` with body text `enabled` → parsed as enabled.
- `.adw/project.md` has `## Unit Tests: disabled` → parsed as disabled.
- BDD scenario command returns non-zero exit code → treated as failure, triggers retry loop.
- BDD scenario command returns zero exit code → treated as pass, PR proceeds.
- No BDD scenarios tagged `@adw-{issueNumber}` exist → scenario command runs but finds nothing; exit code depends on the test framework (typically 0 for "no tests found").

## Acceptance Criteria
- Relevant BDD scenarios (`@adw-{issueNumber}`) run after build and before PR creation in all orchestrators.
- PR is not created if relevant BDD scenarios fail after maximum retries.
- Unit tests only run when `.adw/project.md` has `## Unit Tests: enabled` (or `## Unit Tests` with body `enabled`).
- When unit tests are disabled (default), they are skipped entirely with a log message.
- All six orchestrators (`adwPlanBuild`, `adwPlanBuildTest`, `adwPlanBuildReview`, `adwPlanBuildDocument`, `adwPlanBuildTestReview`, `adwSdlc`) reflect the new phase order: `Build → [Unit Tests] → BDD Scenarios → PR`.
- Existing retry and error-reporting mechanisms (state writes, issue comments, `process.exit(1)`) work with BDD scenario failures.
- `CommandsConfig` includes a `runBddScenarios` field parsed from `## Run BDD Scenarios` in `.adw/commands.md`.
- When `runBddScenarios` is `N/A` or absent, scenarios are skipped gracefully and PR proceeds.
- TypeScript compiles without errors (`bunx tsc --noEmit`).
- Linting passes (`bun run lint`).

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — Run linter to check for code quality issues.
- `bunx tsc --noEmit` — Type-check root project.
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type-check adws sub-project.
- `bun run build` — Build the application to verify no build errors.
- `bun run test` — Run tests to verify no regressions (tests may be empty/disabled but command must not error).

## Notes
- This feature depends on #164 (BDD scenario configuration and tagging conventions) and #165 (Scenario Planner Agent). The scenario command template and tag format (`@adw-{issueNumber}`) are defined by those issues. This implementation provides the plumbing to execute whatever command is configured.
- The `guidelines/coding_guidelines.md` file confirms that BDD scenarios are ADW's validation mechanism and agent-written unit tests are unreliable. This feature aligns the pipeline with that philosophy.
- The existing E2E test infrastructure (`testDiscovery.ts`, Playwright runner) is being superseded by BDD scenarios for ADW's own quality gate. The E2E infrastructure remains available for target repos that use Playwright, but `testPhase.ts` no longer calls `runE2ETestsWithRetry` — it calls `runBddScenariosWithRetry` instead.
- The `## Unit Tests: disabled` format currently in `.adw/project.md` uses a colon-inline heading. The `parseUnitTestsEnabled` helper must handle both this format (heading key `"unit tests: disabled"`) and the standard format (`## Unit Tests` heading with `disabled`/`enabled` body text).
