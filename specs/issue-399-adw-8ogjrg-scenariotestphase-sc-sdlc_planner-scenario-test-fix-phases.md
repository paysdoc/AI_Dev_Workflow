# Feature: scenarioTestPhase + scenarioFixPhase wired into adwSdlc

## Metadata
issueNumber: `399`
adwId: `8ogjrg-scenariotestphase-sc`
issueJson: `{"number":399,"title":"scenarioTestPhase + scenarioFixPhase wired into adwSdlc","body":"## Parent PRD\n\n`specs/prd/test-review-refactor.md`\n\n## What to build\n\nAdd the new test architecture and wire it into `adwSdlc.tsx` as the first consumer.\n\n**New phase: `phases/scenarioTestPhase.ts`**\n- Reads `## Run Scenarios by Tag` from `.adw/commands.md` (target repo) with the tag filter `@adw-{issue} or @regression`\n- Conditionally wraps the scenario execution in `withDevServer` (from slice 2) when `## Start Dev Server` is non-`N/A`\n- Spawns the scenario test command via `child_process.spawn`\n- Produces `scenario_proof.md` in the agent state directory (same format as today's `runScenarioProof` output)\n- Returns structured pass/fail per tag plus path to the proof file\n\nThis is a deep module — unit-tested by mocking `withDevServer`, the subprocess executor, and the proof writer.\n\n**New phase: `phases/scenarioFixPhase.ts`**\n- Takes the failure list from a previous `scenarioTestPhase` run\n- Invokes the resolver agent (renamed in this slice) for each failed scenario\n- Commits fixes\n- Returns\n\n**Renames:**\n- `agents/testAgent.ts:runResolveE2ETestAgent` → `runResolveScenarioAgent`\n- `.claude/commands/resolve_failed_e2e_test.md` → `.claude/commands/resolve_failed_scenario.md`\n- `phases/testPhase.ts` → `phases/unitTestPhase.ts`\n\n**Wire into `adwSdlc.tsx`:**\n- Replace `executeTestPhase` import with `executeUnitTestPhase`\n- Add `executeScenarioTestPhase` and `executeScenarioFixPhase` imports\n- Insert `unitTestPhase` then `scenarioTestPhase` between stepDef and review\n- Wrap scenarioTest in an orchestrator-level retry loop calling `scenarioFixPhase` on failure (max retries from `MAX_TEST_RETRY_ATTEMPTS`)\n- Strip scenario execution from review's `runReviewWithRetry` call by passing empty `scenariosMd` for SDLC orchestrator only (other orchestrators still use the old code path until slice 7)\n\nThis is the tracer bullet end-to-end. After this slice merges, an SDLC run executes scenarios in the test phase and review reads the proof.\n\n## Acceptance criteria\n\n- [ ] `phases/scenarioTestPhase.ts` exists with unit tests (covers dev-server-decision branch, tag filter, proof generation, mocked subprocess output)\n- [ ] `phases/scenarioFixPhase.ts` exists\n- [ ] `runResolveE2ETestAgent` renamed to `runResolveScenarioAgent` (file `agents/testAgent.ts`); all callers updated\n- [ ] `resolve_failed_e2e_test.md` renamed to `resolve_failed_scenario.md`\n- [ ] `phases/testPhase.ts` renamed to `phases/unitTestPhase.ts`; export name updated; all imports updated\n- [ ] `adwSdlc.tsx` wires the new sequence: install → plan+scenario → alignment → build → stepDef → unitTest → scenarioTest [→ scenarioFix → loop] → review → ...\n- [ ] Orchestrator-level retry loop bounded by `MAX_TEST_RETRY_ATTEMPTS`\n- [ ] Other orchestrators (adwPlanBuildTest, adwPlanBuildTestReview, adwChore, adwPrReview) untouched in this slice\n- [ ] Existing tests still pass\n- [ ] Manual smoke test: run `bunx tsx adws/adwSdlc.tsx <issue>` against a feature issue with both `@adw-{N}` and `@regression` scenarios; confirm the scenario phase produces `scenario_proof.md` with both tags' results, the dev server is started/stopped cleanly, and the workflow completes\n\n## Blocked by\n\n- Blocked by #395\n- Blocked by #397\n\n## User stories addressed\n\n- User story 6\n- User story 7\n- User story 17\n- User story 18\n- User story 29\n- User story 32\n- User story 38\n- User story 40","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-04-08T12:04:35Z","comments":[],"actionableComment":null}`

## Feature Description
Add two new Phases — `scenarioTestPhase` and `scenarioFixPhase` — to the ADW Phase library, rename the existing test Phase to `unitTestPhase`, rename the resolve-E2E-test Agent to `runResolveScenarioAgent`, and wire the new sequence into the SDLC Orchestrator. After this slice, the SDLC Orchestrator executes BDD Scenarios in a dedicated test Phase (with optional dev server lifecycle management via `withDevServer`), retries failures through the fix Phase, and the Review Phase reads the proof instead of executing Scenarios itself.

## User Story
As an ADW Orchestrator maintainer
I want Scenario execution and failure resolution in dedicated Phases before Review
So that Review Agents can focus on code quality without also managing Scenario execution, and the test-fix loop is explicit and bounded.

## Problem Statement
Currently, BDD Scenario execution is embedded inside the Review Phase (`runReviewWithRetry`). This conflates two responsibilities: running Scenarios for correctness and reviewing code quality. It makes the Review Phase heavier, harder to reason about, and prevents independent retries of Scenario failures vs. Review Blockers. The test Phase (`testPhase.ts`) only runs unit tests; there is no dedicated Phase for Scenario execution.

## Solution Statement
1. Rename `testPhase.ts` → `unitTestPhase.ts` and its export to `executeUnitTestPhase` for clarity.
2. Rename `runResolveE2ETestAgent` → `runResolveScenarioAgent` and the backing slash command file to `resolve_failed_scenario.md`.
3. Create `scenarioTestPhase.ts` — a new Phase that:
   - Reads `runScenariosByTag` from `projectConfig.commands`
   - Conditionally wraps execution in `withDevServer` when `startDevServer` is non-`N/A`
   - Runs Scenarios for `@adw-{issueNumber}` and `@regression` tags via `runScenarioProof`
   - Writes `scenario_proof.md` to the agent state directory
   - Returns structured pass/fail per tag plus the proof file path
4. Create `scenarioFixPhase.ts` — a new Phase that takes failures from `scenarioTestPhase`, invokes `runResolveScenarioAgent` for each, commits fixes, and returns.
5. Wire into `adwSdlc.tsx`: install → plan+scenario → alignment → build → stepDef → unitTest → scenarioTest [→ scenarioFix → retry loop] → review → document → kpi → PR.
6. In the SDLC Orchestrator only, pass empty `scenariosMd` to `executeReviewPhase` so Review no longer runs Scenarios itself. Other Orchestrators are untouched.

## Relevant Files
Use these files to implement the feature:

- `adws/phases/testPhase.ts` — Rename to `unitTestPhase.ts`; update export name to `executeUnitTestPhase`
- `adws/phases/index.ts` — Update re-exports: remove `testPhase`, add `unitTestPhase`, `scenarioTestPhase`, `scenarioFixPhase`
- `adws/workflowPhases.ts` — Update re-exports to match `phases/index.ts`
- `adws/agents/testAgent.ts` — Rename `runResolveE2ETestAgent` → `runResolveScenarioAgent`; update command reference from `/resolve_failed_e2e_test` to `/resolve_failed_scenario`
- `adws/agents/index.ts` — Update re-export name
- `adws/agents/testRetry.ts` — Update import and call site from `runResolveE2ETestAgent` → `runResolveScenarioAgent`
- `adws/agents/regressionScenarioProof.ts` — Existing Scenario proof orchestrator; consumed by `scenarioTestPhase`
- `adws/agents/bddScenarioRunner.ts` — Existing subprocess executor; consumed by Scenario proof
- `adws/core/devServerLifecycle.ts` — `withDevServer` helper; consumed by `scenarioTestPhase` when dev server is configured
- `adws/core/projectConfig.ts` — `ProjectConfig`, `CommandsConfig` types; read by `scenarioTestPhase`
- `adws/core/config.ts` — `MAX_TEST_RETRY_ATTEMPTS` constant; used for retry bound
- `adws/core/index.ts` — Re-exports core utilities
- `adws/adwSdlc.tsx` — SDLC Orchestrator; wire new phase sequence
- `adws/phases/workflowCompletion.ts` — `executeReviewPhase`; SDLC will pass empty `scenariosMd`
- `adws/agents/reviewRetry.ts` — `runReviewWithRetry`; already accepts `scenariosMd` (empty string disables Scenario proof in Review)
- `.claude/commands/resolve_failed_e2e_test.md` — Rename to `resolve_failed_scenario.md`
- `adws/core/modelRouting.ts` — Add `/resolve_failed_scenario` mapping (same as current `/resolve_failed_e2e_test`)
- `adws/types/issueTypes.ts` — Add `/resolve_failed_scenario` to `SlashCommand` union if needed
- `guidelines/coding_guidelines.md` — Coding guidelines to follow
- `app_docs/feature-dd5jfe-dev-server-lifecycle.md` — Conditional doc: how `withDevServer` works
- `app_docs/feature-zqb2k1-wire-stepdefphase-into-orchestrators.md` — Conditional doc: orchestrator phase ordering patterns

### New Files
- `adws/phases/scenarioTestPhase.ts` — New Scenario test Phase
- `adws/phases/scenarioFixPhase.ts` — New Scenario fix Phase
- `.claude/commands/resolve_failed_scenario.md` — Renamed slash command (copy of `resolve_failed_e2e_test.md` with updated title/references)
- `adws/phases/__tests__/scenarioTestPhase.test.ts` — Unit tests for `scenarioTestPhase`

## Implementation Plan
### Phase 1: Foundation — Renames
Rename existing files and symbols to establish the new vocabulary before adding new code. This avoids circular rename-then-create conflicts.

1. Rename `phases/testPhase.ts` → `phases/unitTestPhase.ts` and update the exported function name from `executeTestPhase` to `executeUnitTestPhase`.
2. Rename `runResolveE2ETestAgent` → `runResolveScenarioAgent` in `agents/testAgent.ts`.
3. Rename `.claude/commands/resolve_failed_e2e_test.md` → `.claude/commands/resolve_failed_scenario.md` and update its title.
4. Update all import sites and re-export barrels (`agents/index.ts`, `phases/index.ts`, `workflowPhases.ts`, all orchestrators referencing `executeTestPhase`).
5. Update model and effort routing maps with the new slash command name `/resolve_failed_scenario`.

### Phase 2: Core Implementation — New Phases
Create the two new Phase files with their logic and unit tests.

1. `scenarioTestPhase.ts`: reads project config, decides dev server, runs Scenario proof, writes proof file, returns structured result.
2. `scenarioFixPhase.ts`: takes failure list, invokes `runResolveScenarioAgent` for each failing tag, commits fixes.
3. Unit tests for `scenarioTestPhase`: mock `withDevServer`, `runScenarioProof`, and validate dev-server-decision branching, tag filtering, proof file generation, and cost tracking.

### Phase 3: Integration — Wire into adwSdlc
Wire the new Phases into the SDLC Orchestrator with the retry loop, and disable Scenario execution in Review for the SDLC path.

1. Update `adwSdlc.tsx` imports and phase sequence.
2. Add orchestrator-level retry loop around `scenarioTestPhase` → `scenarioFixPhase`.
3. Pass empty `scenariosMd` to `executeReviewPhase` so Review skips Scenario proof.
4. Verify other orchestrators are untouched.

## Step by Step Tasks
Execute every step in order, top to bottom.

### Step 1: Read conditional documentation
- Read `app_docs/feature-dd5jfe-dev-server-lifecycle.md` to understand `withDevServer` integration
- Read `app_docs/feature-zqb2k1-wire-stepdefphase-into-orchestrators.md` to understand orchestrator wiring patterns

### Step 2: Rename `testPhase.ts` → `unitTestPhase.ts`
- `git mv adws/phases/testPhase.ts adws/phases/unitTestPhase.ts`
- In the renamed file, rename the exported function `executeTestPhase` → `executeUnitTestPhase`
- Update `adws/phases/index.ts`: change the export from `'./testPhase'` to `'./unitTestPhase'` and update the exported name
- Update `adws/workflowPhases.ts`: update the re-exported name
- Update all orchestrators that import `executeTestPhase`:
  - `adws/adwSdlc.tsx`
  - `adws/adwPlanBuildTest.tsx`
  - `adws/adwPlanBuildTestReview.tsx`
  - `adws/adwChore.tsx`
  - `adws/adwTest.tsx`
  - `adws/adwPlanBuild.tsx`
  - `adws/adwPlanBuildReview.tsx`
  - `adws/adwPlanBuildDocument.tsx`
- Update any BDD step definition files that reference `executeTestPhase`

### Step 3: Rename `runResolveE2ETestAgent` → `runResolveScenarioAgent`
- In `adws/agents/testAgent.ts`: rename the function `runResolveE2ETestAgent` → `runResolveScenarioAgent`
- Update the command reference inside the function from `/resolve_failed_e2e_test` to `/resolve_failed_scenario`
- In `adws/agents/index.ts`: update the re-export name
- In `adws/agents/testRetry.ts`: update all imports and call sites from `runResolveE2ETestAgent` → `runResolveScenarioAgent`

### Step 4: Rename slash command file
- `git mv .claude/commands/resolve_failed_e2e_test.md .claude/commands/resolve_failed_scenario.md`
- Update the title in the renamed file from "Resolve Failed E2E Test" to "Resolve Failed Scenario"
- Update references from "E2E test" to "scenario" in the file body where contextually appropriate

### Step 5: Update model and effort routing
- In `adws/core/modelRouting.ts`: add `/resolve_failed_scenario` to `SLASH_COMMAND_MODEL_MAP` (same tier as current `/resolve_failed_e2e_test`: `'opus'`) and to `SLASH_COMMAND_EFFORT_MAP`
- Remove the old `/resolve_failed_e2e_test` entry from both maps
- In `adws/types/issueTypes.ts`: if `/resolve_failed_e2e_test` is in the `SlashCommand` union, replace with `/resolve_failed_scenario`

### Step 6: Create `scenarioTestPhase.ts`
- Create `adws/phases/scenarioTestPhase.ts` with exported function `executeScenarioTestPhase(config: WorkflowConfig)`
- Logic:
  1. Read `config.projectConfig.commands.runScenariosByTag` and `config.projectConfig.commands.startDevServer`
  2. Read `config.projectConfig.scenariosMd` and `config.projectConfig.reviewProofConfig`
  3. If `scenariosMd` is empty or `runScenariosByTag` is `'N/A'`, log "no scenarios configured — skipping" and return a passing result
  4. Define the work function that calls `runScenarioProof` with the appropriate options (using `config.projectConfig.reviewProofConfig`, `config.projectConfig.commands.runScenariosByTag`, `config.issueNumber`, proof dir under `agents/{adwId}/scenario-test/`, and `config.worktreePath`)
  5. If `startDevServer` is non-`N/A` and non-empty: wrap the work function in `withDevServer` using `config.applicationUrl`'s port, `config.projectConfig.commands.startDevServer`, `config.projectConfig.commands.healthCheckPath`, and `config.worktreePath`
  6. Otherwise: call the work function directly
  7. Write `scenario_proof.md` to proof dir (done by `runScenarioProof` itself)
  8. Return `{ costUsd, modelUsage, scenarioProof, phaseCostRecords }` — `costUsd` is 0 (subprocess-only, no Agent cost), include `hasBlockerFailures` flag
- Follow the existing phase cost record pattern (see `testPhase.ts`) for `createPhaseCostRecords`

### Step 7: Create `scenarioFixPhase.ts`
- Create `adws/phases/scenarioFixPhase.ts` with exported function `executeScenarioFixPhase(config: WorkflowConfig, scenarioProof: ScenarioProofResult)`
- Logic:
  1. Filter `scenarioProof.tagResults` for entries where `!passed && !skipped`
  2. For each failed tag result:
     - Construct an `E2ETestResult`-compatible payload with the tag name as `testName`, status `'failed'`, and output as `error`
     - Call `runResolveScenarioAgent(failedResult, logsDir, statePath, cwd, applicationUrl, issueBody)`
     - Accumulate cost and model usage
  3. After all resolutions, call `runCommitAgent` and `pushBranch` (follow `reviewRetry.ts` pattern)
  4. Return `{ costUsd, modelUsage, phaseCostRecords }`

### Step 8: Update `phases/index.ts` and `workflowPhases.ts`
- Add exports for `executeScenarioTestPhase` from `'./scenarioTestPhase'`
- Add exports for `executeScenarioFixPhase` from `'./scenarioFixPhase'`
- Update `workflowPhases.ts` to re-export both new functions

### Step 9: Wire into `adwSdlc.tsx`
- Replace `executeTestPhase` import with `executeUnitTestPhase`
- Add imports for `executeScenarioTestPhase` and `executeScenarioFixPhase`
- Import `type ScenarioProofResult` from the appropriate module
- Update the phase sequence:
  ```
  await runPhase(config, tracker, executeInstallPhase);
  await runPhasesParallel(config, tracker, [executePlanPhase, executeScenarioPhase]);
  await runPhase(config, tracker, executeAlignmentPhase);
  await runPhase(config, tracker, executeBuildPhase);
  await runPhase(config, tracker, executeStepDefPhase, 'stepDef');
  const unitTestResult = await runPhase(config, tracker, executeUnitTestPhase);
  
  // Scenario test → fix retry loop
  let scenarioProof: ScenarioProofResult | undefined;
  let scenarioRetries = 0;
  for (let attempt = 0; attempt < MAX_TEST_RETRY_ATTEMPTS; attempt++) {
    const scenarioResult = await runPhase(config, tracker, executeScenarioTestPhase);
    scenarioProof = scenarioResult.scenarioProof;
    if (!scenarioResult.scenarioProof?.hasBlockerFailures) break;
    scenarioRetries++;
    if (attempt < MAX_TEST_RETRY_ATTEMPTS - 1) {
      const fixWrapper = (cfg: WorkflowConfig) =>
        executeScenarioFixPhase(cfg, scenarioResult.scenarioProof!);
      await runPhase(config, tracker, fixWrapper);
    }
  }
  
  // Pass empty scenariosMd to review so it reads proof instead of executing
  const executeReviewWithoutScenarios = (cfg: WorkflowConfig) => {
    const patchedConfig = { ...cfg, projectConfig: { ...cfg.projectConfig, scenariosMd: '' } };
    return executeReviewPhase(patchedConfig);
  };
  const reviewResult = await runPhase(config, tracker, executeReviewWithoutScenarios);
  ```
- Update the final metadata write to include `scenarioRetries`
- Ensure `unitTestResult` replaces the old `testResult` reference

### Step 10: Create unit tests for `scenarioTestPhase`
- Create `adws/phases/__tests__/scenarioTestPhase.test.ts`
- Test cases:
  1. **Skip when no scenarios configured**: `scenariosMd` is empty → returns passing result immediately
  2. **Skip when `runScenariosByTag` is `N/A`**: returns passing result immediately
  3. **Runs without dev server**: `startDevServer` is `N/A` → calls `runScenarioProof` directly, NOT wrapped in `withDevServer`
  4. **Runs with dev server**: `startDevServer` has a real command → wraps `runScenarioProof` in `withDevServer`
  5. **Returns structured result**: verify `hasBlockerFailures`, `tagResults`, `resultsFilePath` are propagated
  6. **Phase cost records created**: verify `createPhaseCostRecords` is called with correct phase name
- Mock `withDevServer` from `adws/core/devServerLifecycle.ts`
- Mock `runScenarioProof` from `adws/agents/regressionScenarioProof.ts`
- Mock `allocateRandomPort` from `adws/core/portAllocator.ts`

### Step 11: Validate — run all tests and checks
- Run `bun run lint` to check for lint errors
- Run `bun run build` to verify the build succeeds
- Run `bun run test` to verify all existing tests still pass
- Run `bunx tsc --noEmit` and `bunx tsc --noEmit -p adws/tsconfig.json` to verify type safety

## Testing Strategy
### Unit Tests
- `adws/phases/__tests__/scenarioTestPhase.test.ts`:
  - Dev server decision branch: verify `withDevServer` is called when `startDevServer` is non-`N/A`, and NOT called when `N/A`
  - Tag filter: verify `runScenarioProof` receives the correct `reviewProofConfig` and `runByTagCommand`
  - Proof generation: verify `scenario_proof.md` path is returned
  - Skip behavior: verify early return when `scenariosMd` is empty
  - Cost records: verify `createPhaseCostRecords` is called with phase `'scenarioTest'`

### Edge Cases
- `startDevServer` is empty string (treated as `N/A`, no dev server)
- `scenariosMd` is present but `runScenariosByTag` is `N/A` (skip)
- All scenarios pass on first attempt (no fix loop entered)
- All scenarios fail on every retry (loop exhausts `MAX_TEST_RETRY_ATTEMPTS`)
- `runScenarioProof` returns `hasBlockerFailures: false` but some tech-debt failures exist (should NOT trigger fix loop)
- No step definition files found (handled by `runScenarioProof`'s pre-flight check)

## Acceptance Criteria
- [ ] `phases/scenarioTestPhase.ts` exists with unit tests covering dev-server-decision branch, tag filter, proof generation, and mocked subprocess output
- [ ] `phases/scenarioFixPhase.ts` exists and invokes the renamed resolver agent
- [ ] `runResolveE2ETestAgent` renamed to `runResolveScenarioAgent` in `agents/testAgent.ts`; all callers updated
- [ ] `resolve_failed_e2e_test.md` renamed to `resolve_failed_scenario.md`; model routing updated
- [ ] `phases/testPhase.ts` renamed to `phases/unitTestPhase.ts`; export name `executeUnitTestPhase`; all imports updated across all orchestrators
- [ ] `adwSdlc.tsx` wires: install → plan+scenario → alignment → build → stepDef → unitTest → scenarioTest [→ scenarioFix → loop] → review → document → kpi → PR
- [ ] Orchestrator-level retry loop bounded by `MAX_TEST_RETRY_ATTEMPTS`
- [ ] Review phase in SDLC receives empty `scenariosMd` so it does not execute scenarios itself
- [ ] Other orchestrators (`adwPlanBuildTest`, `adwPlanBuildTestReview`, `adwChore`, `adwPrReview`, `adwTest`, `adwPlanBuild`, `adwPlanBuildReview`, `adwPlanBuildDocument`) still compile and use the renamed `executeUnitTestPhase` but are otherwise behaviorally unchanged
- [ ] `bun run lint`, `bun run build`, `bun run test`, `bunx tsc --noEmit` all pass with zero errors
- [ ] No new library dependencies required

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bun run build` — Build the application to verify no build errors
- `bunx tsc --noEmit` — Type check root config
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type check adws config
- `bun run test` — Run all Vitest tests to verify no regressions

## Notes
- **No new library dependencies** are needed. All required infrastructure (`withDevServer`, `runScenarioProof`, `runScenariosByTag`, `allocateRandomPort`) already exists.
- Follow `guidelines/coding_guidelines.md` strictly — especially: no decorators, prefer pure functions, keep files under 300 lines, isolate side effects at boundaries.
- The `scenarioTestPhase` is deliberately a **deep module**: the caller passes `WorkflowConfig` and gets back a result; all dev-server lifecycle, subprocess management, and proof file I/O are hidden inside.
- The `/resolve_failed_e2e_test` slash command name persists in old specs and app_docs — those are historical references and should NOT be updated. Only live code, model routing, and the actual command file are renamed.
- `scenarioFixPhase` reuses `runResolveScenarioAgent` which in turn invokes `/resolve_failed_scenario` — the same resolver Agent that was previously called `/resolve_failed_e2e_test`, just renamed for domain accuracy.
- The retry loop in `adwSdlc.tsx` is **orchestrator-level**, not inside the Phase itself. This keeps `scenarioTestPhase` and `scenarioFixPhase` as single-responsibility Phases that the Orchestrator composes.
- Passing empty `scenariosMd` to `executeReviewPhase` triggers the existing `shouldRunScenarioProof('')` → `false` guard in `runReviewWithRetry`, cleanly disabling Scenario execution during Review without modifying Review internals.
