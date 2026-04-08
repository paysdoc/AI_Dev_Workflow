# Feature: scenarioTestPhase + scenarioFixPhase wired into adwSdlc

## Metadata
issueNumber: `399`
adwId: `1bg58c-scenariotestphase-sc`
issueJson: `{"number":399,"title":"scenarioTestPhase + scenarioFixPhase wired into adwSdlc","body":"## Parent PRD\n\n`specs/prd/test-review-refactor.md`\n\n## What to build\n\nAdd the new test architecture and wire it into `adwSdlc.tsx` as the first consumer.\n\n**New phase: `phases/scenarioTestPhase.ts`**\n- Reads `## Run Scenarios by Tag` from `.adw/commands.md` (target repo) with the tag filter `@adw-{issue} or @regression`\n- Conditionally wraps the scenario execution in `withDevServer` (from slice 2) when `## Start Dev Server` is non-`N/A`\n- Spawns the scenario test command via `child_process.spawn`\n- Produces `scenario_proof.md` in the agent state directory (same format as today's `runScenarioProof` output)\n- Returns structured pass/fail per tag plus path to the proof file\n\nThis is a deep module — unit-tested by mocking `withDevServer`, the subprocess executor, and the proof writer.\n\n**New phase: `phases/scenarioFixPhase.ts`**\n- Takes the failure list from a previous `scenarioTestPhase` run\n- Invokes the resolver agent (renamed in this slice) for each failed scenario\n- Commits fixes\n- Returns\n\n**Renames:**\n- `agents/testAgent.ts:runResolveE2ETestAgent` → `runResolveScenarioAgent`\n- `.claude/commands/resolve_failed_e2e_test.md` → `.claude/commands/resolve_failed_scenario.md`\n- `phases/testPhase.ts` → `phases/unitTestPhase.ts`\n\n**Wire into `adwSdlc.tsx`:**\n- Replace `executeTestPhase` import with `executeUnitTestPhase`\n- Add `executeScenarioTestPhase` and `executeScenarioFixPhase` imports\n- Insert `unitTestPhase` then `scenarioTestPhase` between stepDef and review\n- Wrap scenarioTest in an orchestrator-level retry loop calling `scenarioFixPhase` on failure (max retries from `MAX_TEST_RETRY_ATTEMPTS`)\n- Strip scenario execution from review's `runReviewWithRetry` call by passing empty `scenariosMd` for SDLC orchestrator only (other orchestrators still use the old code path until slice 7)\n\nThis is the tracer bullet end-to-end. After this slice merges, an SDLC run executes scenarios in the test phase and review reads the proof.\n\n## Acceptance criteria\n\n- [ ] `phases/scenarioTestPhase.ts` exists with unit tests (covers dev-server-decision branch, tag filter, proof generation, mocked subprocess output)\n- [ ] `phases/scenarioFixPhase.ts` exists\n- [ ] `runResolveE2ETestAgent` renamed to `runResolveScenarioAgent` (file `agents/testAgent.ts`); all callers updated\n- [ ] `resolve_failed_e2e_test.md` renamed to `resolve_failed_scenario.md`\n- [ ] `phases/testPhase.ts` renamed to `phases/unitTestPhase.ts`; export name updated; all imports updated\n- [ ] `adwSdlc.tsx` wires the new sequence: install → plan+scenario → alignment → build → stepDef → unitTest → scenarioTest [→ scenarioFix → loop] → review → ...\n- [ ] Orchestrator-level retry loop bounded by `MAX_TEST_RETRY_ATTEMPTS`\n- [ ] Other orchestrators (adwPlanBuildTest, adwPlanBuildTestReview, adwChore, adwPrReview) untouched in this slice\n- [ ] Existing tests still pass\n- [ ] Manual smoke test: run `bunx tsx adws/adwSdlc.tsx <issue>` against a feature issue with both `@adw-{N}` and `@regression` scenarios; confirm the scenario phase produces `scenario_proof.md` with both tags' results, the dev server is started/stopped cleanly, and the workflow completes\n\n## Blocked by\n\n- Blocked by #395\n- Blocked by #397\n\n## User stories addressed\n\n- User story 6\n- User story 7\n- User story 17\n- User story 18\n- User story 29\n- User story 32\n- User story 38\n- User story 40","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-04-08T12:04:35Z","comments":[],"actionableComment":null}`

## Feature Description
Introduces two new workflow phases — `scenarioTestPhase` and `scenarioFixPhase` — and wires them into `adwSdlc.tsx` as the first consumer. The scenario test phase reads the tag-filtered scenario command from the target repo's project config, conditionally wraps execution in `withDevServer` for web apps, spawns the scenario runner subprocess, and produces a `scenario_proof.md` proof file. The scenario fix phase takes failures from the test phase, invokes a resolver agent for each, and commits fixes. An orchestrator-level retry loop in `adwSdlc.tsx` bounds test→fix cycles by `MAX_TEST_RETRY_ATTEMPTS`. Several renames align the codebase with the new test architecture: `testPhase` → `unitTestPhase`, `runResolveE2ETestAgent` → `runResolveScenarioAgent`, `resolve_failed_e2e_test.md` → `resolve_failed_scenario.md`. Only `adwSdlc.tsx` is rewired; other orchestrators remain untouched.

## User Story
As a workflow operator
I want scenario tests to run as a dedicated phase before review, with automatic fix-and-retry on failure
So that BDD scenario failures are caught and resolved before the review phase, reducing review noise and ensuring scenario coverage is validated independently

## Problem Statement
BDD scenario execution currently lives inside the review retry loop (`runReviewWithRetry`), coupling scenario testing with code review. This means scenario failures are patched by the review agent (which has a different purpose), scenario results are not independently retried, and the naming of test-related modules (`testPhase`, `runResolveE2ETestAgent`) no longer reflects their actual role in the architecture.

## Solution Statement
Extract scenario execution into its own phase (`scenarioTestPhase`) with a dedicated fix phase (`scenarioFixPhase`), wire them into `adwSdlc.tsx` between step definitions and review, and implement an orchestrator-level retry loop. Rename existing modules to reflect the new separation: `testPhase` → `unitTestPhase` (unit tests only), `runResolveE2ETestAgent` → `runResolveScenarioAgent`, and `resolve_failed_e2e_test.md` → `resolve_failed_scenario.md`. For the SDLC orchestrator only, pass empty `scenariosMd` to the review phase so it skips scenario execution (other orchestrators continue using the old code path until a later slice).

## Relevant Files
Use these files to implement the feature:

### Existing Files (modify)
- `adws/agents/testAgent.ts` — rename `runResolveE2ETestAgent` → `runResolveScenarioAgent`, change command reference from `/resolve_failed_e2e_test` → `/resolve_failed_scenario`
- `adws/agents/testRetry.ts` — update all calls from `runResolveE2ETestAgent` → `runResolveScenarioAgent`
- `adws/agents/index.ts` — update export from `runResolveE2ETestAgent` → `runResolveScenarioAgent`
- `adws/phases/testPhase.ts` — rename file to `unitTestPhase.ts`, rename export `executeTestPhase` → `executeUnitTestPhase`
- `adws/phases/index.ts` — update exports: replace `executeTestPhase` with `executeUnitTestPhase`, add `executeScenarioTestPhase`, add `executeScenarioFixPhase`
- `adws/workflowPhases.ts` — update re-exports: replace `executeTestPhase` with `executeUnitTestPhase`, add `executeScenarioTestPhase`, add `executeScenarioFixPhase`
- `adws/index.ts` — update re-exports: replace `executeTestPhase` with `executeUnitTestPhase`
- `adws/adwSdlc.tsx` — replace `executeTestPhase` with `executeUnitTestPhase`, import and wire `executeScenarioTestPhase` + `executeScenarioFixPhase`, add retry loop, pass empty `scenariosMd` to review
- `.claude/commands/resolve_failed_e2e_test.md` — rename to `resolve_failed_scenario.md`
- `adws/core/modelRouting.ts` — rename `/resolve_failed_e2e_test` → `/resolve_failed_scenario` in all model/effort maps
- `adws/types/issueTypes.ts` — rename `/resolve_failed_e2e_test` → `/resolve_failed_scenario` in `SlashCommand` union type
- `adws/adwPlanBuildTest.tsx` — update `executeTestPhase` → `executeUnitTestPhase` import (no new phases added)
- `adws/adwPlanBuildTestReview.tsx` — update `executeTestPhase` → `executeUnitTestPhase` import (no new phases added)
- `adws/adwPlanBuildReview.tsx` — update `executeTestPhase` → `executeUnitTestPhase` import if present (no new phases added)
- `adws/adwPlanBuildDocument.tsx` — update `executeTestPhase` → `executeUnitTestPhase` import if present (no new phases added)
- `adws/adwPlanBuild.tsx` — update `executeTestPhase` → `executeUnitTestPhase` import if present (no new phases added)
- `adws/adwChore.tsx` — update `executeTestPhase` → `executeUnitTestPhase` import (no new phases added)
- `adws/adwTest.tsx` — update `executeTestPhase` → `executeUnitTestPhase` import
- `README.md` — update project structure: rename `testPhase.ts` → `unitTestPhase.ts`, `resolve_failed_e2e_test.md` → `resolve_failed_scenario.md`, add `scenarioTestPhase.ts`, `scenarioFixPhase.ts`

### Reference Files (read, do not modify)
- `adws/core/devServerLifecycle.ts` — `withDevServer` function to conditionally wrap scenario execution
- `adws/agents/bddScenarioRunner.ts` — `runScenariosByTag` subprocess executor used by scenarioTestPhase
- `adws/agents/regressionScenarioProof.ts` — `runScenarioProof` proof generation pattern to follow for proof file format
- `adws/core/phaseRunner.ts` — `runPhase`, `CostTracker`, `PhaseResult` interface for phase compliance
- `adws/phases/workflowInit.ts` — `WorkflowConfig` type the new phases must accept
- `adws/core/projectConfig.ts` — `ProjectConfig`, `CommandsConfig` types for accessing scenario commands and dev server config
- `adws/core/config.ts` — `MAX_TEST_RETRY_ATTEMPTS` constant for retry loop bound
- `adws/phases/workflowCompletion.ts` — `executeReviewPhase` to understand how `scenariosMd` is currently passed to `runReviewWithRetry`
- `guidelines/coding_guidelines.md` — coding guidelines to follow
- `app_docs/feature-dd5jfe-dev-server-lifecycle.md` — dev server lifecycle documentation (conditional doc: triggered by `withDevServer` integration)
- `features/scenario_test_fix_phases.feature` — BDD scenarios for this issue

### New Files
- `adws/phases/scenarioTestPhase.ts` — new scenario test phase
- `adws/phases/scenarioFixPhase.ts` — new scenario fix phase
- `.claude/commands/resolve_failed_scenario.md` — renamed command file (from `resolve_failed_e2e_test.md`)
- `adws/phases/unitTestPhase.ts` — renamed from `testPhase.ts`
- `adws/phases/__tests__/scenarioTestPhase.test.ts` — unit tests for scenarioTestPhase

## Implementation Plan
### Phase 1: Foundation — Renames
Rename existing files and update all imports/exports to reflect the new test architecture naming. This must happen first because both new phases and the orchestrator wiring depend on the renamed symbols.

1. Rename `resolve_failed_e2e_test.md` → `resolve_failed_scenario.md`
2. Rename `runResolveE2ETestAgent` → `runResolveScenarioAgent` in `testAgent.ts`, update its command reference to `/resolve_failed_scenario`
3. Update all callers: `testRetry.ts`, `agents/index.ts`
4. Update `modelRouting.ts` and `issueTypes.ts` for the command rename
5. Rename `testPhase.ts` → `unitTestPhase.ts`, rename export `executeTestPhase` → `executeUnitTestPhase`
6. Update all importers of `executeTestPhase` across all orchestrators and barrel exports

### Phase 2: Core Implementation — New Phases
Create the two new phase modules.

**`scenarioTestPhase.ts`**:
- Reads `config.projectConfig.commands.runScenariosByTag` for the tag command
- Constructs tag filter: runs both `@adw-{issueNumber}` and `@regression` tags via `runScenariosByTag`
- Checks `config.projectConfig.commands.startDevServer` — if non-`N/A`, wraps scenario execution in `withDevServer` from `adws/core/devServerLifecycle.ts` using `config.applicationUrl` port and `config.projectConfig.commands.healthCheckPath`
- Uses `runScenarioProof` from `regressionScenarioProof.ts` to run tag-driven scenarios and generate `scenario_proof.md` in the agent state directory
- Returns `PhaseResult` with additional fields: `scenariosPassed`, `totalRetries`, `proofPath`
- Follows the same pattern as `testPhase.ts` for cost tracking, state logging, and board status

**`scenarioFixPhase.ts`**:
- Accepts `WorkflowConfig` plus a failure description from the previous `scenarioTestPhase` run
- Invokes `runResolveScenarioAgent` for each failed scenario tag
- Calls `runCommitAgent` to commit fixes
- Calls `pushBranch` to push to remote
- Returns `PhaseResult` with cost/model usage

### Phase 3: Integration — Wire into adwSdlc.tsx
Wire the new phases into the SDLC orchestrator with the retry loop.

1. Replace `executeTestPhase` import with `executeUnitTestPhase`
2. Import `executeScenarioTestPhase` and `executeScenarioFixPhase`
3. After `executeStepDefPhase`, run `executeUnitTestPhase` (renamed, same behavior)
4. After unit tests, implement the scenario test/fix retry loop:
   - Run `executeScenarioTestPhase`
   - If scenarios fail and retry count < `MAX_TEST_RETRY_ATTEMPTS`, run `executeScenarioFixPhase`, then re-run `executeScenarioTestPhase`
   - Loop until pass or max retries exhausted
   - On exhaustion, report failure and exit
5. Override `scenariosMd` to empty string when calling `executeReviewPhase` so the review phase skips scenario execution (SDLC only — scenarios already ran in the dedicated phase)
6. Pass `scenarioTestResult.proofPath` to review or store it in the workflow context for the review to read

## Step by Step Tasks
Execute every step in order, top to bottom.

### Step 1: Read reference files
- Read `guidelines/coding_guidelines.md` to ensure compliance
- Read `app_docs/feature-dd5jfe-dev-server-lifecycle.md` for `withDevServer` usage patterns
- Read `adws/core/devServerLifecycle.ts` for `withDevServer` and `DevServerConfig` interface
- Read `adws/agents/regressionScenarioProof.ts` for `runScenarioProof` and `ScenarioProofResult` types
- Read `adws/agents/bddScenarioRunner.ts` for `runScenariosByTag` interface
- Read `adws/core/phaseRunner.ts` for `PhaseResult` interface
- Read `adws/phases/workflowInit.ts` for `WorkflowConfig` type
- Read `features/scenario_test_fix_phases.feature` for BDD acceptance scenarios

### Step 2: Rename command file
- Git rename `.claude/commands/resolve_failed_e2e_test.md` → `.claude/commands/resolve_failed_scenario.md`
- Update the title/heading inside the file from "Resolve Failed E2E Test" to "Resolve Failed Scenario" (keep the body instructions the same — they are generic enough)
- Verify the file content is correct

### Step 3: Rename `runResolveE2ETestAgent` → `runResolveScenarioAgent`
- In `adws/agents/testAgent.ts`: rename the function `runResolveE2ETestAgent` → `runResolveScenarioAgent`, update the command from `'/resolve_failed_e2e_test'` → `'/resolve_failed_scenario'`
- In `adws/agents/testRetry.ts`: update all references from `runResolveE2ETestAgent` → `runResolveScenarioAgent` (import and usage in `runE2ETestsWithRetry` and `runBddScenariosWithRetry`)
- In `adws/agents/index.ts`: update the export from `runResolveE2ETestAgent` → `runResolveScenarioAgent`
- In `adws/types/issueTypes.ts`: rename `'/resolve_failed_e2e_test'` → `'/resolve_failed_scenario'` in the `SlashCommand` union type
- In `adws/core/modelRouting.ts`: rename `'/resolve_failed_e2e_test'` → `'/resolve_failed_scenario'` in all model maps and effort maps (4 occurrences)

### Step 4: Rename `testPhase.ts` → `unitTestPhase.ts`
- Git rename `adws/phases/testPhase.ts` → `adws/phases/unitTestPhase.ts`
- Inside the file: rename the exported function `executeTestPhase` → `executeUnitTestPhase`
- Update `adws/phases/index.ts`: change `export { executeTestPhase } from './testPhase'` → `export { executeUnitTestPhase } from './unitTestPhase'`
- Update `adws/workflowPhases.ts`: change `executeTestPhase` → `executeUnitTestPhase` in the re-export
- Update `adws/index.ts`: change `executeTestPhase` → `executeUnitTestPhase` in the re-export
- Update all orchestrators that import `executeTestPhase`:
  - `adws/adwSdlc.tsx` — will be fully rewired in Step 8, but update the import name now
  - `adws/adwPlanBuildTest.tsx` — update import only
  - `adws/adwPlanBuildTestReview.tsx` — update import only
  - `adws/adwChore.tsx` — update import only
  - `adws/adwTest.tsx` — update import only
  - `adws/adwPlanBuild.tsx` — update import if `executeTestPhase` is referenced
  - `adws/adwPlanBuildReview.tsx` — update import if `executeTestPhase` is referenced
  - `adws/adwPlanBuildDocument.tsx` — update import if `executeTestPhase` is referenced
- Verify no remaining references to `executeTestPhase` in `adws/` TypeScript files (except specs/docs/features which are not code)

### Step 5: Create `adws/phases/scenarioTestPhase.ts`
- Create the new phase file following the `PhaseResult` interface pattern from `testPhase.ts` and `regressionScenarioProof.ts`
- The function signature: `export async function executeScenarioTestPhase(config: WorkflowConfig): Promise<ScenarioTestPhaseResult>`
- `ScenarioTestPhaseResult` extends `PhaseResult` with: `scenariosPassed: boolean`, `totalRetries: number`, `proofPath: string`
- Implementation:
  1. Read `config.projectConfig.commands.runScenariosByTag` — if `N/A` or empty, skip gracefully (return passed with no proof)
  2. Move board status to InProgress
  3. Log phase start
  4. Determine whether dev server is needed: `config.projectConfig.commands.startDevServer !== 'N/A'`
  5. Define the `runScenarios` work function that calls `runScenarioProof` with the target repo's review proof config, tag command, issue number, and proof output directory (`agents/{adwId}/scenario-test/scenario_proof`)
  6. If dev server needed, wrap `runScenarios` in `withDevServer({ startCommand: config.projectConfig.commands.startDevServer, port: <extract from config.applicationUrl>, healthPath: config.projectConfig.commands.healthCheckPath, cwd: config.worktreePath })`
  7. If dev server not needed, call `runScenarios` directly
  8. Build `phaseCostRecords` using `createPhaseCostRecords`
  9. Return the structured result

### Step 6: Create `adws/phases/scenarioFixPhase.ts`
- Create the new phase file
- Function signature: `export async function executeScenarioFixPhase(config: WorkflowConfig, scenarioProof: ScenarioProofResult): Promise<PhaseResult>`
- Implementation:
  1. Log phase start
  2. For each failed tag in `scenarioProof.tagResults` (where `!passed && !skipped`):
     - Construct an `E2ETestResult`-compatible failure object from the tag result
     - Call `runResolveScenarioAgent` with the failure details
     - Accumulate cost and model usage
  3. After all resolutions, call `runCommitAgent` to commit fixes
  4. Call `pushBranch` to push to remote
  5. Build and return `phaseCostRecords`

### Step 7: Update barrel exports for new phases
- In `adws/phases/index.ts`: add exports for `executeScenarioTestPhase` and `executeScenarioFixPhase`, and the `ScenarioTestPhaseResult` type
- In `adws/workflowPhases.ts`: add re-exports for `executeScenarioTestPhase`, `executeScenarioFixPhase`, and `ScenarioTestPhaseResult`

### Step 8: Wire into `adwSdlc.tsx`
- Import `executeUnitTestPhase`, `executeScenarioTestPhase`, `executeScenarioFixPhase` (replacing `executeTestPhase`)
- Import `MAX_TEST_RETRY_ATTEMPTS` from core
- Import `ScenarioTestPhaseResult` type
- Replace the single `executeTestPhase` call with:
  1. `executeUnitTestPhase` via `runPhase(config, tracker, executeUnitTestPhase, 'unitTest')`
  2. Scenario test/fix retry loop:
     ```
     let scenarioRetries = 0;
     let scenarioResult = await runPhase(config, tracker, executeScenarioTestPhase, 'scenarioTest');
     while (!scenarioResult.scenariosPassed && scenarioRetries < MAX_TEST_RETRY_ATTEMPTS) {
       const fixWrapper = (cfg) => executeScenarioFixPhase(cfg, scenarioResult.scenarioProof);
       await runPhase(config, tracker, fixWrapper, 'scenarioFix');
       scenarioResult = await runPhase(config, tracker, executeScenarioTestPhase);
       scenarioRetries++;
     }
     if (!scenarioResult.scenariosPassed) { /* report failure and exit */ }
     ```
- Override `scenariosMd` for the review phase: wrap `executeReviewPhase` in a closure that temporarily overrides `config.projectConfig.scenariosMd` to `''` before calling it, then restores it. Or more cleanly: create a wrapper function that modifies `config.projectConfig.scenariosMd` to `''`, calls `executeReviewPhase`, then restores the original value.
- Update the metadata written at workflow end to include `scenarioTestsPassed` from the scenario result

### Step 9: Update `README.md` project structure
- In the project structure section:
  - Rename `testPhase.ts` → `unitTestPhase.ts` entry
  - Rename `resolve_failed_e2e_test.md` → `resolve_failed_scenario.md` entry
  - Add `scenarioTestPhase.ts` and `scenarioFixPhase.ts` entries under `phases/`

### Step 10: Create unit tests for `scenarioTestPhase`
- Create `adws/phases/__tests__/scenarioTestPhase.test.ts`
- Test cases:
  1. **Skips gracefully when tag command is N/A** — returns passed with no proof
  2. **Calls `runScenarioProof` with correct tag command and issue number** — verify arguments
  3. **Wraps execution in `withDevServer` when startDevServer is non-N/A** — mock `withDevServer` and verify it's called with correct `DevServerConfig`
  4. **Does NOT wrap in `withDevServer` when startDevServer is N/A** — verify `withDevServer` is not called
  5. **Returns structured result with scenariosPassed, proofPath, cost** — verify return shape
  6. **Returns scenariosPassed false when proof has blocker failures** — mock failing scenario results
  7. **Writes proof file to correct agent state directory** — verify path construction
- Follow existing test patterns from `adws/core/__tests__/devServerLifecycle.test.ts` for mocking style

### Step 11: Run validation commands
- Run `bunx tsc --noEmit` — must pass
- Run `bunx tsc --noEmit -p adws/tsconfig.json` — must pass
- Run `bun run lint` — must pass
- Run `bun run test` — must pass (existing unit tests)
- Run `bun run build` — must pass

## Testing Strategy
### Unit Tests
Unit tests for `scenarioTestPhase.ts` covering:
- Dev-server-decision branching (non-N/A triggers `withDevServer`, N/A skips it)
- Tag filter construction (`@adw-{issueNumber}` and `@regression`)
- Proof generation via mocked `runScenarioProof`
- Mocked subprocess output handling (pass and fail scenarios)
- Graceful skip when tag command is N/A
- Correct port extraction from `applicationUrl` for `DevServerConfig`
- Cost record generation

### Edge Cases
- Tag command is `N/A` or empty — phase should skip gracefully and return passed
- Dev server fails to start — `withDevServer` handles fallback (logged warning, work runs anyway)
- No scenarios match `@adw-{issueNumber}` tag — proof shows skipped, result is passed
- All scenarios fail on every retry — retry loop exhausts `MAX_TEST_RETRY_ATTEMPTS` and workflow reports failure
- `scenarioFixPhase` receives empty failure list — should be a no-op
- `runScenarioProof` returns only non-blocker failures (tech-debt severity) — should not trigger retry loop

## Acceptance Criteria
- `adws/phases/scenarioTestPhase.ts` exists and exports `executeScenarioTestPhase`
- `adws/phases/scenarioFixPhase.ts` exists and exports `executeScenarioFixPhase`
- `adws/phases/__tests__/scenarioTestPhase.test.ts` exists with tests covering dev-server decision, tag filter, proof generation, subprocess mocking
- `runResolveE2ETestAgent` renamed to `runResolveScenarioAgent` in `agents/testAgent.ts`; all callers updated
- `.claude/commands/resolve_failed_scenario.md` exists; `.claude/commands/resolve_failed_e2e_test.md` does not exist
- `adws/phases/unitTestPhase.ts` exists; `adws/phases/testPhase.ts` does not exist
- `executeUnitTestPhase` is exported; `executeTestPhase` is not exported from any barrel
- `adwSdlc.tsx` wires: install → plan+scenarios → alignment → build → stepDef → unitTest → scenarioTest [→ scenarioFix → loop] → review → document → kpi → pr
- Scenario test/fix retry loop bounded by `MAX_TEST_RETRY_ATTEMPTS`
- Review phase in SDLC orchestrator receives empty `scenariosMd`
- Other orchestrators (`adwPlanBuildTest`, `adwPlanBuildTestReview`, `adwChore`, `adwPrReview`) do NOT import or call `executeScenarioTestPhase` or `executeScenarioFixPhase`
- TypeScript type-check passes (`bunx tsc --noEmit` and `bunx tsc --noEmit -p adws/tsconfig.json`)
- Lint passes (`bun run lint`)
- Existing unit tests pass (`bun run test`)
- All BDD scenarios tagged `@adw-399 @regression` pass

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bunx tsc --noEmit` — root-level TypeScript type-check
- `bunx tsc --noEmit -p adws/tsconfig.json` — adws-specific TypeScript type-check
- `bun run lint` — ESLint check
- `bun run build` — build check
- `bun run test` — run all Vitest unit tests
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-399 and @regression"` — run regression BDD scenarios for this issue

## Notes
- Follow `guidelines/coding_guidelines.md` strictly: pure functions, no mutation, meaningful types, isolate side effects at boundaries.
- The `scenarioTestPhase` should reuse `runScenarioProof` from `regressionScenarioProof.ts` rather than reimplementing proof generation. This keeps the proof format consistent between the new scenario test phase and the existing review-phase proof.
- The `withDevServer` integration uses the port extracted from `config.applicationUrl` (which is set by `allocateRandomPort` during `initializeWorkflow`). Parse the port from the URL rather than allocating a new one.
- When overriding `scenariosMd` for the SDLC review phase, be careful to restore the original value after the review completes, or use a wrapper function approach so the original `config` is not permanently mutated.
- The command rename from `/resolve_failed_e2e_test` → `/resolve_failed_scenario` also requires updates to `modelRouting.ts` (model maps and effort maps) and `issueTypes.ts` (SlashCommand union).
- `scenarioFixPhase` should follow the same pattern as the BDD retry logic in `testRetry.ts:runBddScenariosWithRetry` for constructing failure objects and calling the resolver agent.
- The `ScenarioTestPhaseResult` type should include the full `ScenarioProofResult` (not just pass/fail) so the fix phase can inspect individual tag failures.
