# Chore: Delete Legacy E2E Machinery

## Metadata
issueNumber: `403`
adwId: `4omdx0-delete-e2e-machinery`
issueJson: `{"number":403,"title":"delete E2E machinery","body":"## Parent PRD\n\n`specs/prd/test-review-refactor.md`\n\n## What to build\n\nNow that all orchestrators have been migrated to scenarioTestPhase (#400), delete the legacy E2E machinery.\n\n**Delete from `agents/`:**\n- `runE2ETestsWithRetry` (in `agents/testRetry.ts`)\n- `runPlaywrightE2ETests` (in `agents/testDiscovery.ts`)\n- `discoverE2ETestFiles` (in `agents/testDiscovery.ts`)\n- `runBddScenariosWithRetry` (in `agents/testRetry.ts`) — verify dead first\n- The entire `agents/regressionScenarioProof.ts` file (logic moved to `phases/scenarioTestPhase.ts` in #399)\n- The `agents/testDiscovery.ts` file may be deletable entirely if nothing else lives in it\n\n**Delete from `core/projectConfig.ts`:**\n- `runE2ETests` field from `CommandsConfig` interface\n- The corresponding heading entry in `HEADING_TO_KEY`\n- The default value\n- Update tests that reference the old field\n\n**Delete the `e2e-tests/` convention:**\n- Remove any documentation or code that references `e2e-tests/*.spec.ts`\n- The directory itself is per-target-repo, so this is just removing the concept from ADW's vocabulary\n\n**Update re-exports:**\n- `agents/index.ts` removes deleted exports\n- `agents/testAgent.ts` removes its E2E-related re-export block\n\n**Verify no callers remain:**\n- `grep -r runE2ETestsWithRetry adws/` should return nothing\n- Same for `runPlaywrightE2ETests`, `discoverE2ETestFiles`, `runBddScenariosWithRetry`\n\n## Acceptance criteria\n\n- [ ] All listed functions and files deleted\n- [ ] `## Run E2E Tests` heading removed from `projectConfig.ts` schema\n- [ ] No remaining references to deleted symbols anywhere in `adws/` or `.claude/commands/`\n- [ ] Type check (`bunx tsc --noEmit`) passes\n- [ ] Existing tests still pass\n- [ ] Lint passes (`bun run lint`)\n\n## Blocked by\n\n- Blocked by #400\n\n## User stories addressed\n\n- User story 31","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-04-08T12:05:52Z","comments":[],"actionableComment":null}`

## Chore Description
Remove all legacy E2E test machinery from ADW now that all orchestrators have been migrated to `scenarioTestPhase` (#400). This includes deleting the Playwright-based E2E discovery/runner infrastructure, the E2E retry functions, the `runE2ETests` config field, and all references to the `e2e-tests/` convention in slash commands and documentation.

**Critical finding from research:** The issue requests deleting `agents/regressionScenarioProof.ts`, but this file is **actively used in production** by 7+ files (`scenarioTestPhase.ts`, `scenarioFixPhase.ts`, `reviewRetry.ts`, `adwSdlc.tsx`, `proofCommentFormatter.ts`, `workflowCommentsIssue.ts`, and its test). It is the current BDD scenario proof system, NOT legacy E2E machinery. **This file MUST NOT be deleted.**

**Second finding:** `prReviewCompletion.ts` actively calls `runE2ETestsWithRetry` — this call block must be removed (the function now only needs the unit test result).

**Third finding:** `runBddScenariosWithRetry` is confirmed dead — it is only defined in `testRetry.ts` and re-exported from `index.ts`; no production code calls it.

## Relevant Files
Use these files to resolve the chore:

### Files to Delete
- `adws/agents/testDiscovery.ts` — Entire file: contains `discoverE2ETestFiles`, `runPlaywrightE2ETests`, `isValidE2ETestResult`, `E2ETestResult`, `PlaywrightE2EResult`. All functions/types are either legacy or can be inlined elsewhere.
- `.claude/commands/test_e2e.md` — Legacy E2E test runner slash command. No longer needed.
- `.claude/commands/resolve_failed_e2e_test.md` — Legacy E2E test resolver slash command. Superseded by `/resolve_failed_scenario`.

### Files to Modify
- `adws/agents/testRetry.ts` — Delete `runE2ETestsWithRetry` (lines 99-226), `runBddScenariosWithRetry` (lines 228-324), and `BddScenarioRetryOptions` (lines 228-233). Remove all imports from `testDiscovery`. Keep `runUnitTestsWithRetry`, `TestRetryResult`, `TestRetryOptions`.
- `adws/agents/testAgent.ts` — Remove testDiscovery re-exports (lines 12-19) and re-import (lines 21-22). Inline the `E2ETestResult` interface (still needed by `runResolveScenarioAgent`). Fix JSDoc on `runResolveScenarioAgent` (line 159 incorrectly says `/resolve_failed_e2e_test`).
- `adws/agents/index.ts` — Remove "Test Discovery" export block (lines 40-47). Remove `runE2ETestsWithRetry`, `runBddScenariosWithRetry`, `BddScenarioRetryOptions` from "Test Retry" export block (lines 79-86).
- `adws/phases/prReviewCompletion.ts` — Remove `runE2ETestsWithRetry` import (line 14). Delete the entire E2E test call block (lines 76-100). Simplify cost merging (lines 108-111) since only unit test result remains.
- `adws/core/projectConfig.ts` — Remove `runE2ETests` field from `CommandsConfig` interface (line 30), from `HEADING_TO_KEY` (line 122), and from `getDefaultCommandsConfig()` (line 146).
- `.adw/commands.md` — Remove the `## Run E2E Tests` heading and its value (lines 27-28).
- `.claude/commands/feature.md` — Remove E2E test references (lines 27-30: the block about creating E2E test files in `e2e-tests/`).
- `.claude/commands/bug.md` — Remove E2E test references (lines 27-30: the block about creating E2E test files in `e2e-tests/`).
- `.claude/commands/resolve_failed_scenario.md` — Remove references to `test_e2e.md` (lines 20, 26). Update instructions to reference BDD scenario concepts directly.
- `.claude/commands/review.md` — Remove `e2e-examples/` reference (line 50).

### Files to NOT Delete (correction to issue)
- `adws/agents/regressionScenarioProof.ts` — **KEEP**. Actively used by `scenarioTestPhase.ts`, `scenarioFixPhase.ts`, `reviewRetry.ts`, `adwSdlc.tsx`, `proofCommentFormatter.ts`, `workflowCommentsIssue.ts`. This is the current BDD scenario proof system, not legacy E2E.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Delete `adws/agents/testDiscovery.ts`
- Delete the entire file. It contains only E2E-specific functions: `discoverE2ETestFiles`, `runPlaywrightE2ETests`, `isValidE2ETestResult`, and the types `E2ETestResult`, `PlaywrightE2EResult`.

### Step 2: Inline `E2ETestResult` into `adws/agents/testAgent.ts`
- Remove the backward-compatible re-export block (lines 12-19):
  ```typescript
  // Backward-compatible re-exports from testDiscovery
  export {
    discoverE2ETestFiles,
    isValidE2ETestResult,
    runPlaywrightE2ETests,
    type E2ETestResult,
    type PlaywrightE2EResult,
  } from './testDiscovery';
  ```
- Remove the re-import (lines 21-22):
  ```typescript
  // Re-import E2ETestResult for local use
  import type { E2ETestResult } from './testDiscovery';
  ```
- Add the `E2ETestResult` interface definition directly in `testAgent.ts` (it is still used as the parameter type for `runResolveScenarioAgent` on line 169, which is called by `scenarioTestPhase.ts` and `testRetry.ts`):
  ```typescript
  /**
   * Test result structure used by the scenario resolution agent.
   */
  export interface E2ETestResult {
    testName: string;
    status: 'passed' | 'failed';
    error: string | null;
    /** The path to the spec file */
    testPath?: string;
  }
  ```
- Fix the JSDoc on `runResolveScenarioAgent` (line 159): change "Runs the /resolve_failed_e2e_test command" to "Runs the /resolve_failed_scenario command"

### Step 3: Clean up `adws/agents/testRetry.ts`
- Remove imports that came from testDiscovery (via testAgent): `discoverE2ETestFiles`, `runPlaywrightE2ETests`, `isValidE2ETestResult`, `E2ETestResult` (lines 13-18). Keep the imports that are still needed: `runResolveScenarioAgent`, `TestResult`, `TestAgentResult`, `runTestAgent`, `runResolveTestAgent`.
- Also remove unused import: `runScenariosByTag` from `./bddScenarioRunner` (line 20) — only used by `runBddScenariosWithRetry` which is being deleted.
- Delete the entire `runE2ETestsWithRetry` function (lines 99-226).
- Delete the `BddScenarioRetryOptions` interface (lines 228-233).
- Delete the entire `runBddScenariosWithRetry` function (lines 241-324).
- Update the module JSDoc (line 1-4): remove "E2E" from "Shared test retry logic for unit and E2E tests". Remove "adwPrReview.tsx" mention since it will no longer use this module's E2E function.
- Verify remaining imports are correct. The file should only import what `runUnitTestsWithRetry` needs: `runTestAgent`, `runResolveTestAgent`, `TestResult`, `TestAgentResult` from `./testAgent`.

### Step 4: Update `adws/agents/index.ts`
- Remove the entire "Test Discovery" export block (lines 40-47):
  ```typescript
  // Test Discovery (E2E discovery and Playwright runner)
  export {
    discoverE2ETestFiles,
    isValidE2ETestResult,
    runPlaywrightE2ETests,
    type E2ETestResult,
    type PlaywrightE2EResult,
  } from './testDiscovery';
  ```
- In the "Test Retry" export block (lines 78-86), remove `runE2ETestsWithRetry`, `runBddScenariosWithRetry`, and `type BddScenarioRetryOptions`. Keep `runUnitTestsWithRetry`, `type TestRetryResult`, `type TestRetryOptions`.
- Add `type E2ETestResult` export to the "Test Agent" block (since it's now defined in testAgent.ts and still used by external code like testRetry.ts):
  ```typescript
  // Test Agent
  export {
    runTestAgent,
    runResolveTestAgent,
    runResolveScenarioAgent,
    type TestResult,
    type TestAgentResult,
    type E2ETestResult,
  } from './testAgent';
  ```

### Step 5: Refactor `adws/phases/prReviewCompletion.ts`
- Remove `runE2ETestsWithRetry` from the import on line 14. The import becomes:
  ```typescript
  import { runCommitAgent, runUnitTestsWithRetry } from '../agents';
  ```
- Delete the E2E test call block (lines 76-100 — the `e2eTestsResult` variable, the `await runE2ETestsWithRetry(...)` call, and the entire `if (!e2eTestsResult.passed)` block).
- Simplify the cost merging. Replace the combined cost calculation (lines 108-111):
  ```typescript
  const combinedCostUsd = (unitTestsResult.costUsd ?? 0) + (e2eTestsResult.costUsd ?? 0);
  const combinedModelUsage = mergeModelUsageMaps(
    unitTestsResult.modelUsage ?? emptyModelUsageMap(),
    e2eTestsResult.modelUsage ?? emptyModelUsageMap(),
  );
  ```
  with direct usage of unitTestsResult:
  ```typescript
  const combinedCostUsd = unitTestsResult.costUsd ?? 0;
  const combinedModelUsage = unitTestsResult.modelUsage ?? emptyModelUsageMap();
  ```
- Check if `mergeModelUsageMaps` is still used elsewhere in the file — if not, remove it from the import on line 7.
- Update the function's JSDoc (line 19): remove "E2E tests" from "runs unit and E2E tests with retry".

### Step 6: Remove `runE2ETests` from `adws/core/projectConfig.ts`
- Remove `runE2ETests: string;` from the `CommandsConfig` interface (line 30).
- Remove `'run e2e tests': 'runE2ETests',` from the `HEADING_TO_KEY` map (line 122).
- Remove `runE2ETests: 'bunx playwright test',` from `getDefaultCommandsConfig()` (line 146).

### Step 7: Remove `## Run E2E Tests` from `.adw/commands.md`
- Delete these two lines (lines 27-28):
  ```
  ## Run E2E Tests
  NODE_OPTIONS="--import tsx" bunx cucumber-js
  ```

### Step 8: Delete legacy slash commands
- Delete `.claude/commands/test_e2e.md`
- Delete `.claude/commands/resolve_failed_e2e_test.md`

### Step 9: Clean up remaining slash commands
- **`.claude/commands/feature.md`** — Remove the E2E test block (lines 27-30):
  ```
  - If the feature includes UI components or user interactions:
    - Add a task in the `Step by Step Tasks` section to create a separate E2E test file in `e2e-tests/test_<descriptive_name>.md` based on examples in that directory
    - Add E2E test validation to your Validation Commands section
    - In the `Plan Format: Relevant Files` section, add an instruction to read `.claude/commands/test_e2e.md` and `.claude/commands/e2e-examples/test_basic_query.md`. List your new E2E test file in the `Plan Format: New Files` section.
    - Note: you are creating a **task** to create the E2E test file, not creating it directly
  ```
- **`.claude/commands/bug.md`** — Remove the equivalent E2E test block (lines 27-30):
  ```
  - If the bug affects the UI or user interactions:
    - Add a task in the `Step by Step Tasks` section to create a separate E2E test file in `e2e-tests/test_<descriptiveName>.md` based on examples in `.claude/commands/e2e-examples/` that validates the bug is fixed with zero regressions.
    - Add E2E test validation to your Validation Commands section
    - In the `Plan Format: Relevant Files` section, add an instruction to read `.claude/commands/test_e2e.md` and `.claude/commands/e2e-examples/test_basic_query.md`. List your new E2E test file in the `Plan Format: New Files` section.
    - Note: you are creating a **task** to create the E2E test file, not creating it directly
  ```
- **`.claude/commands/resolve_failed_scenario.md`** — Update step 2 (lines 19-21) to remove `test_e2e.md` references:
  - Replace "Read `.claude/commands/test_e2e.md` to understand how E2E tests are executed" with "Read the scenario file or step definitions to understand the test context"
  - Replace "Follow the execution pattern from `.claude/commands/test_e2e.md`" with "Follow the BDD scenario execution pattern from `.adw/scenarios.md`"
- **`.claude/commands/review.md`** — Update line 50 to remove the `e2e-examples/` reference. Replace "Look for e2e test files in `./claude/commands/e2e-examples/test*.md` as navigation guides only" with a reference that uses BDD scenarios or remove the line entirely if no longer applicable.

### Step 10: Run validation commands
- Execute all validation commands to confirm zero regressions. See `Validation Commands` section below.

## Validation Commands
Execute every command to validate the chore is complete with zero regressions.

- `grep -r "runE2ETestsWithRetry" adws/ .claude/commands/` — must return nothing
- `grep -r "runPlaywrightE2ETests" adws/ .claude/commands/` — must return nothing
- `grep -r "discoverE2ETestFiles" adws/ .claude/commands/` — must return nothing
- `grep -r "runBddScenariosWithRetry" adws/ .claude/commands/` — must return nothing
- `grep -r "testDiscovery" adws/` — must return nothing (no remaining imports of deleted file)
- `grep -r "e2e-tests/" adws/ .claude/commands/` — must return nothing
- `grep -r "test_e2e" adws/ .claude/commands/` — must return nothing
- `grep -r "resolve_failed_e2e_test" adws/ .claude/commands/` — must return nothing
- `grep -r "e2e-examples" .claude/commands/` — must return nothing
- `bunx tsc --noEmit` — Type check passes
- `bunx tsc --noEmit -p adws/tsconfig.json` — Additional type check passes
- `bun run lint` — Lint passes
- `bun run test` — Existing tests still pass

## Notes
- **DO NOT delete `adws/agents/regressionScenarioProof.ts`** — Despite the issue requesting its deletion, this file is actively used in production by `scenarioTestPhase.ts`, `scenarioFixPhase.ts`, `reviewRetry.ts`, `adwSdlc.tsx`, `proofCommentFormatter.ts`, and `workflowCommentsIssue.ts`. It is the current BDD scenario proof system, not legacy E2E machinery.
- The `E2ETestResult` type name is kept for now in `testAgent.ts` even though the "E2E" prefix is a misnomer after this refactor. It serves as the input type for `runResolveScenarioAgent`. Renaming it to `ScenarioTestResult` or similar would be a separate, optional cleanup.
- The `e2e-examples/` directory referenced in some commands does not actually exist — it was a placeholder convention that was never populated.
- Follow the coding guidelines in `guidelines/coding_guidelines.md`: remove unused imports/exports, keep files under 300 lines, remove dead code cleanly.
