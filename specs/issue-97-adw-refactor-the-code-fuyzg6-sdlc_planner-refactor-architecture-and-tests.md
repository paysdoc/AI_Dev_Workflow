# Chore: Refactor Architecture and Tests

## Metadata
issueNumber: `97`
adwId: `refactor-the-code-fuyzg6`
issueJson: `{"number":97,"title":"Refactor the code","body":"## Summary\nThe code base is getting quite heavy with duplication, useless code and code that does not adhered to the `guidelines/coding_guidelins.md`. \n\n## Architecture\nThe building blocks of the ADW layer are now distributed over `/core`, `/agents` and `adw*.tsx` files. It is getting difficult to keep track of. It also leads to degraded consistency. Each of the directories also has a number of code files that might better reside in more suitable directory (e.g. `adws/agents/tokenManager.ts`). \n\nThink hard on the architecture and file structure to ensure that the application follows logical standards and is more readable.\n\n## Testing\nTesting is a bit patchy. Several improvements can be made:\n- move tests into a __tests__ subdirectory of their implementing code\n- Revisit each test to see whether it fully tests all the functionality of the implementing code\n- Review the codebase to see whether there are missing tests and add those\n\n ","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-09T09:36:17Z","comments":[],"actionableComment":null}`

## Chore Description
The ADW codebase has accumulated significant technical debt across three areas:

1. **Architecture & File Organization**: Files are misplaced across directories (e.g., `tokenManager.ts` in `agents/` instead of `core/`). The 13 orchestrator files (`adw*.tsx`) contain ~600 lines of duplicated boilerplate (identical `parseArguments()`, `printUsageAndExit()`, and main flow patterns). Several files exceed the 300-line guideline limit.

2. **Code Quality**: Imperative `for` loops are used instead of functional patterns (`map`/`filter`/`reduce`) in several agent files. Magic strings are used for orchestrator identifiers instead of constants/enums. Some files violate the coding guidelines' modularity principle.

3. **Testing**: All 57 test files live in a flat `adws/__tests__/` directory instead of co-located `__tests__/` subdirectories. ~26% of source modules (20+ files) lack test coverage entirely, including critical infrastructure like `config.ts`, `utils.ts`, `stateHelpers.ts`, and all phase files.

## Relevant Files
Use these files to resolve the chore:

- `guidelines/coding_guidelines.md` — Coding standards the refactored code must adhere to (300 line limit, functional patterns, no `any`, etc.)
- `adws/README.md` — ADW system documentation that must be updated to reflect structural changes
- `README.md` — Project structure documentation that must be updated
- `vitest.config.ts` — Test runner configuration (test discovery patterns)
- `adws/tsconfig.json` — TypeScript configuration for path aliases

### Orchestrator files (duplication targets)
- `adws/adwPlan.tsx` — Plan-only orchestrator
- `adws/adwBuild.tsx` — Build-only orchestrator
- `adws/adwTest.tsx` — Test-only orchestrator
- `adws/adwDocument.tsx` — Document-only orchestrator
- `adws/adwPatch.tsx` — Patch orchestrator
- `adws/adwPrReview.tsx` — PR review orchestrator
- `adws/adwInit.tsx` — Init orchestrator
- `adws/adwPlanBuild.tsx` — Plan+Build orchestrator
- `adws/adwPlanBuildTest.tsx` — Plan+Build+Test orchestrator
- `adws/adwPlanBuildDocument.tsx` — Plan+Build+Document orchestrator
- `adws/adwPlanBuildReview.tsx` — Plan+Build+Review orchestrator
- `adws/adwPlanBuildTestReview.tsx` — Plan+Build+Test+Review orchestrator
- `adws/adwSdlc.tsx` — Full SDLC orchestrator
- `adws/adwClearComments.tsx` — Clear comments utility
- `adws/adwBuildHelpers.ts` — Build CLI helpers (may merge into shared utility)

### Files to relocate
- `adws/agents/tokenManager.ts` — Token counting utility, should move to `core/`

### Large files to split (>300 lines)
- `adws/phases/workflowLifecycle.ts` (506 lines) — Combines initialization, completion, error handling, and review orchestration
- `adws/github/gitOperations.ts` (393 lines) — Monolithic git operations
- `adws/phases/prReviewPhase.ts` (367 lines) — Complex review orchestration with retry logic
- `adws/agents/claudeAgent.ts` (361 lines) — Process spawning + output parsing
- `adws/agents/testAgent.ts` (347 lines) — Test execution + discovery + retry
- `adws/github/worktreeOperations.ts` (344 lines) — Worktree management
- `adws/core/issueClassifier.ts` (311 lines) — Classification + workflow mapping

### Core/agent/github/phase files (for test coverage review)
- `adws/core/config.ts` — No tests
- `adws/core/utils.ts` — Partially tested (log only)
- `adws/core/stateHelpers.ts` — No tests
- `adws/core/jsonParser.ts` — No tests
- `adws/core/retryOrchestrator.ts` — No tests
- `adws/agents/buildAgent.ts` — No tests
- `adws/agents/documentAgent.ts` — No tests
- `adws/agents/jsonlParser.ts` — No tests
- `adws/agents/testRetry.ts` — No tests
- `adws/github/issueApi.ts` — No tests
- `adws/github/prApi.ts` — No tests
- `adws/github/pullRequestCreator.ts` — No tests
- `adws/github/worktreeCleanup.ts` — No tests
- `adws/github/worktreeCreation.ts` — No tests
- `adws/github/workflowCommentsBase.ts` — Partially tested
- `adws/github/workflowCommentsIssue.ts` — Partially tested
- `adws/github/workflowCommentsPR.ts` — No tests
- `adws/github/workflowComments.ts` — Partially tested
- `adws/phases/buildPhase.ts` — No tests
- `adws/phases/planPhase.ts` — No tests
- `adws/phases/testPhase.ts` — No tests
- `adws/phases/prPhase.ts` — No tests
- `adws/phases/prReviewPhase.ts` — No tests
- `adws/phases/documentPhase.ts` — No tests
- `adws/phases/workflowLifecycle.ts` — Partially tested (only ensureGitignoreEntry)

### Index/export files (update after relocations)
- `adws/index.ts` — Main barrel export
- `adws/core/index.ts` — Core barrel export
- `adws/agents/index.ts` — Agent barrel export
- `adws/github/index.ts` — GitHub barrel export
- `adws/phases/index.ts` — Phases barrel export

### New Files

- `adws/core/tokenManager.ts` — Relocated from `adws/agents/tokenManager.ts`
- `adws/core/orchestratorCli.ts` — Shared CLI parsing utilities extracted from orchestrator duplication
- `adws/phases/workflowInit.ts` — Initialization logic extracted from `workflowLifecycle.ts`
- `adws/phases/workflowCompletion.ts` — Completion/error handling extracted from `workflowLifecycle.ts`
- `adws/github/gitBranchOperations.ts` — Branch operations extracted from `gitOperations.ts`
- `adws/github/gitCommitOperations.ts` — Commit/push operations extracted from `gitOperations.ts`
- Co-located `__tests__/` directories: `adws/core/__tests__/`, `adws/agents/__tests__/`, `adws/github/__tests__/`, `adws/triggers/__tests__/`, `adws/phases/__tests__/`, `adws/types/__tests__/`

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Move tests into co-located `__tests__/` subdirectories

Create `__tests__/` directories in each module folder and move test files from the flat `adws/__tests__/` to the appropriate co-located directory. Keep `adws/__tests__/` for tests of root-level orchestrator files.

**Create directories:**
- `adws/core/__tests__/`
- `adws/agents/__tests__/`
- `adws/github/__tests__/`
- `adws/triggers/__tests__/`
- `adws/phases/__tests__/`
- `adws/types/__tests__/`

**Move to `adws/core/__tests__/`** (tests for core/ modules):
- `agentState.test.ts` → tests `core/agentState.ts`
- `costCsvWriter.test.ts` → tests `core/costCsvWriter.ts`
- `costPricing.test.ts` → tests `core/costPricing.ts`
- `costReport.test.ts` → tests `core/costReport.ts`
- `generateAdwId.test.ts` → tests `core/utils.ts`
- `issueClassifier.test.ts` → tests `core/issueClassifier.ts`
- `log.test.ts` → tests `core/utils.ts`
- `orchestratorLib.test.ts` → tests `core/orchestratorLib.ts`
- `persistTokenCounts.test.ts` → tests `core/costReport.ts`
- `portAllocator.test.ts` → tests `core/portAllocator.ts`
- `processAlive.test.ts` → tests `core/agentState.ts`
- `projectConfig.test.ts` → tests `core/projectConfig.ts`
- `resolveClaudeCodePath.test.ts` → tests `core/config.ts`
- `revertIssueCostFile.test.ts` → tests `core/costCsvWriter.ts`
- `slashCommandModelMap.test.ts` → tests `core/config.ts`
- `targetRepoManager.test.ts` → tests `core/targetRepoManager.ts`
- `targetRepoRegistry.test.ts` → tests `core/targetRepoRegistry.ts`
- `triggerCronRegistry.test.ts` → tests `core/targetRepoRegistry.ts`

**Move to `adws/agents/__tests__/`** (tests for agents/ modules):
- `claudeAgent.test.ts` → tests `agents/claudeAgent.ts`
- `claudeAgentSpawnRetry.test.ts` → tests `agents/claudeAgent.ts`
- `cwdPropagation.test.ts` → tests agent cwd passing
- `gitAgent.test.ts` → tests `agents/gitAgent.ts`
- `multiAgentReview.test.ts` → tests `agents/reviewRetry.ts`
- `patchAgent.test.ts` → tests `agents/patchAgent.ts`
- `planAgent.test.ts` → tests `agents/planAgent.ts`
- `prAgent.test.ts` → tests `agents/prAgent.ts`
- `reviewAgent.test.ts` → tests `agents/reviewAgent.ts`
- `reviewRetry.test.ts` → tests `agents/reviewRetry.ts`
- `testAgent.test.ts` → tests `agents/testAgent.ts`
- `tokenManagerFiltered.test.ts` → tests `agents/tokenManager.ts` (will follow the file to core/ later)

**Move to `adws/github/__tests__/`** (tests for github/ modules):
- `branchNameGeneration.test.ts` → tests `github/gitOperations.ts`
- `commitCostFiles.test.ts` → tests `github/gitOperations.ts`
- `gitOperations.test.ts` → tests `github/gitOperations.ts`
- `githubApi.test.ts` → tests `github/githubApi.ts`
- `prCommentDetector.test.ts` → tests `github/prCommentDetector.ts`
- `projectBoardApi.test.ts` → tests `github/projectBoardApi.ts`
- `worktreeOperations.test.ts` → tests `github/worktreeOperations.ts`
- `adwPrReview.test.ts` → tests `github/workflowComments.ts`
- `commentFiltering.test.ts` → tests `github/workflowCommentsBase.ts`
- `targetRepoIntegration.test.ts` → tests `github/githubApi.ts`
- `triggerCommentHandling.test.ts` → tests `github/workflowCommentsBase.ts`
- `workflowCommentsIssueReview.test.ts` → tests `github/workflowCommentsIssue.ts`
- `ensureGitignoreEntry.test.ts` → tests `github/gitOperations.ts` (ensureGitignoreEntry is in workflowLifecycle but is a git operation)

**Move to `adws/triggers/__tests__/`** (tests for triggers/ modules):
- `triggerPrReviewDedup.test.ts` → tests `triggers/trigger_webhook.ts`
- `triggerSpawnArgs.test.ts` → tests trigger spawn logic
- `triggerWebhookIssueClosed.test.ts` → tests `triggers/trigger_webhook.ts`
- `triggerWebhookPort.test.ts` → tests `triggers/trigger_webhook.ts`
- `webhookClearComment.test.ts` → tests trigger + clearComments interaction
- `webhookHandlers.test.ts` → tests `triggers/webhookHandlers.ts`
- `webhookSignature.test.ts` → tests `triggers/webhookSignature.ts`

**Move to `adws/types/__tests__/`**:
- `costTypes.test.ts` → tests `types/costTypes.ts`

**Keep in `adws/__tests__/`** (tests for root-level files):
- `adwInitPrPhase.test.ts` → tests `adwInit.tsx`
- `clearComments.test.ts` → tests `adwClearComments.tsx`
- `healthCheckChecks.test.ts` → tests `healthCheckChecks.ts`
- `prReviewCostTracking.test.ts` → tests `workflowPhases.ts`
- `tokenLimitRecovery.test.ts` → tests `workflowPhases.ts`
- `workflowPhases.test.ts` → tests `workflowPhases.ts`

**After moving all files:**
- Update all relative import paths in the moved test files (e.g., `../core/agentState` becomes `../agentState` for tests now in `core/__tests__/`)
- Verify `vitest.config.ts` glob pattern `adws/**/*.{test,spec}.?(c|m)[jt]s?(x)` still discovers all moved tests — it should, since `**` matches nested directories
- Run `bun run test` to verify all tests pass after relocation

### Step 2: Relocate `tokenManager.ts` from agents/ to core/

- Move `adws/agents/tokenManager.ts` → `adws/core/tokenManager.ts`
- Update `adws/agents/index.ts` — remove tokenManager exports
- Update `adws/core/index.ts` — add tokenManager exports
- Find all import references to `agents/tokenManager` and update to `core/tokenManager`:
  - `adws/agents/claudeAgent.ts`
  - `adws/agents/jsonlParser.ts`
  - Any other files importing from `agents/tokenManager`
- Move `adws/agents/__tests__/tokenManagerFiltered.test.ts` → `adws/core/__tests__/tokenManagerFiltered.test.ts` and update its import paths
- Run `bun run test` to verify

### Step 3: Extract shared orchestrator CLI utilities

All 13 orchestrator files contain nearly identical `printUsageAndExit()` and `parseArguments()` functions (~50-80 lines each, duplicated 13 times = ~600+ lines of duplication).

- Create `adws/core/orchestratorCli.ts` with:
  - `printUsageAndExit(scriptName: string, usagePattern: string): never` — generic usage printer
  - `parseOrchestratorArguments(args: string[], options: { requireAdwId?: boolean, scriptName: string, usagePattern: string }): OrchestratorArgs` — shared argument parser that handles `--issue-type`, `--cwd`, `--skip-resolution` flags, issue number validation, and optional adwId parsing
  - `OrchestratorArgs` interface (issueNumber, adwId, providedIssueType, targetCwd, skipResolution, etc.)
  - `parseTargetRepoArgs(args: string[]): TargetRepoArgs` — if not already shared, extract the target repo argument parsing
- Export from `adws/core/index.ts`
- Update all 13 orchestrator files to use the shared `parseOrchestratorArguments()` instead of their local implementations, removing the duplicated functions
- Keep each orchestrator's unique `main()` function that composes the workflow phases
- Run `bun run test` to verify

### Step 4: Split `workflowLifecycle.ts` (506 lines → ~3 files)

This file combines workflow initialization, completion, and error handling. Split it by responsibility:

- Create `adws/phases/workflowInit.ts`:
  - Move `initializeWorkflow()` and its helper functions (worktree setup, state initialization, issue fetching)
  - Move `ensureGitignoreEntry()` and `ensureGitignoreEntries()` helper functions
- Create `adws/phases/workflowCompletion.ts`:
  - Move `completeWorkflow()`, `handleWorkflowError()`, and related cleanup functions
  - Move any exit/cleanup handlers
- Keep `adws/phases/workflowLifecycle.ts` as a slim re-export barrel that exports from both new files for backward compatibility (or update all consumers directly)
- Update `adws/phases/index.ts` to export from the new files
- Update all import references across the codebase
- Move `adws/phases/__tests__/ensureGitignoreEntry.test.ts` if its import path changed
- Run `bun run test` to verify

### Step 5: Split `gitOperations.ts` (393 lines → 2 files)

- Create `adws/github/gitBranchOperations.ts`:
  - Move branch-related functions: `generateBranchName()`, `createAndCheckoutBranch()`, `branchExists()`, `deleteBranch()`, `getDefaultBranch()`, `getCurrentBranch()`, protected branch logic
- Create `adws/github/gitCommitOperations.ts`:
  - Move commit/push functions: `commitChanges()`, `commitAndPushCostFiles()`, `pushBranch()`, `ensureGitignoreEntry()` (if it lives here)
- Keep `adws/github/gitOperations.ts` as a re-export barrel for backward compatibility, or update all consumers
- Update `adws/github/index.ts`
- Update import paths in all test files that import from `gitOperations`
- Run `bun run test` to verify

### Step 6: Split remaining large files

**`claudeAgent.ts` (361 lines)**:
- Extract JSONL output parsing and result processing into the existing `adws/agents/jsonlParser.ts` if not already there, or create `adws/agents/agentOutputParser.ts`
- Keep process spawning and configuration in `claudeAgent.ts`

**`testAgent.ts` (347 lines)**:
- Extract test discovery logic (finding test files, detecting E2E setup) into `adws/agents/testDiscovery.ts`
- Keep test execution and retry coordination in `testAgent.ts`

**`worktreeOperations.ts` (344 lines)**:
- Already has `worktreeCreation.ts` and `worktreeCleanup.ts` siblings — verify that `worktreeOperations.ts` isn't duplicating logic that exists in those files. If it is, consolidate. If `worktreeOperations.ts` serves as an orchestrator over creation/cleanup, keep it but extract any standalone query functions.

**`issueClassifier.ts` (311 lines)**:
- Extract the workflow-script-to-issue-type mapping (which orchestrator to run for which issue class) into `adws/core/workflowMapping.ts`
- Keep classification logic (keyword analysis, label detection) in `issueClassifier.ts`

**`prReviewPhase.ts` (367 lines)**:
- Review whether retry logic can be delegated more to `retryOrchestrator.ts` or `reviewRetry.ts` to reduce the phase file size. Extract shared review orchestration helpers if needed.

- After all splits, run `bunx tsc --noEmit -p adws/tsconfig.json` to verify no type errors
- Run `bun run test` to verify

### Step 7: Replace imperative loops with functional patterns

Per `guidelines/coding_guidelines.md` ("Declarative over imperative — Use map, filter, reduce, and flatMap over for/while loops"):

- `adws/agents/reviewRetry.ts` — 7 `for` loop occurrences → convert to `map`/`filter`/`reduce`
- `adws/agents/testRetry.ts` — 5 `for` loop occurrences → convert to functional patterns
- `adws/agents/jsonlParser.ts` — 4 `for` loop occurrences → convert where appropriate (some line-by-line parsing may warrant keeping as `for...of` for readability)
- `adws/agents/planAgent.ts` — 3 `for` loop occurrences → convert
- `adws/agents/tokenManager.ts` (now in core/) — 2 `for` loop occurrences → convert
- `adws/agents/testAgent.ts` — 1 `for` loop → convert

For each file:
- Read the file and identify each loop
- Replace with appropriate functional alternative (`map`, `filter`, `reduce`, `flatMap`, `forEach`)
- Only keep imperative loops where functional alternatives would harm readability (e.g., complex stateful parsing with early `break`)
- Run `bun run test` after each file to verify behavior is preserved

### Step 8: Replace magic strings with constants/enums

- Create orchestrator identifier constants in `adws/core/orchestratorCli.ts` or a dedicated `adws/core/constants.ts`:
  ```typescript
  enum OrchestratorId {
    Plan = 'plan-orchestrator',
    Build = 'build-orchestrator',
    Test = 'test-orchestrator',
    Review = 'review-orchestrator',
    Document = 'document-orchestrator',
    PR = 'pr-orchestrator',
    Patch = 'patch-orchestrator',
    Init = 'init-orchestrator',
    ClearComments = 'clear-comments-orchestrator',
    HealthCheck = 'health-check-orchestrator',
  }
  ```
- Replace string literals across all orchestrator files with the enum values
- Review agent files for other repeated magic strings and extract to constants
- Run `bun run test` to verify

### Step 9: Remove unused code and dead exports

- Search for unused exports across the codebase using TypeScript compiler and manual review
- Remove any dead code, unused helper functions, or unreachable branches
- Clean up barrel exports (`index.ts` files) to only export what is actually consumed
- Remove unused imports in all modified files
- Run `bun run lint` to catch any remaining issues
- Run `bun run test` to verify

### Step 10: Add missing tests — Core modules

Write unit tests for untested core modules:

- `adws/core/__tests__/config.test.ts` — Test `resolveClaudeCodePath()`, env var loading, model mapping, `SLASH_COMMAND_EFFORT_MAP`, and config defaults. Mock `process.env` and `fs` operations.
- `adws/core/__tests__/stateHelpers.test.ts` — Test all exported state helper functions. Mock agentState dependencies.
- `adws/core/__tests__/jsonParser.test.ts` — Test JSON extraction from various input formats (plain, embedded, markdown code blocks). Test malformed input handling.
- `adws/core/__tests__/retryOrchestrator.test.ts` — Test retry logic, max attempts, backoff behavior, success/failure paths. Mock phase execution functions.
- `adws/core/__tests__/utils.test.ts` — Expand existing tests beyond `log` and `generateAdwId`: test `slugify`, directory utilities, and any other exported functions.
- `adws/core/__tests__/orchestratorCli.test.ts` — Test the new shared CLI parsing: valid args, missing args, flag parsing, edge cases.

### Step 11: Add missing tests — Agent modules

- `adws/agents/__tests__/buildAgent.test.ts` — Test build agent execution, argument construction, result parsing. Mock `claudeAgent`.
- `adws/agents/__tests__/documentAgent.test.ts` — Test document agent execution and argument handling. Mock `claudeAgent`.
- `adws/agents/__tests__/jsonlParser.test.ts` — Test JSONL line parsing, multi-line handling, malformed input, token extraction.
- `adws/agents/__tests__/testRetry.test.ts` — Test retry loop logic, max attempts, test failure detection, success paths. Mock test execution.

### Step 12: Add missing tests — GitHub modules

- `adws/github/__tests__/issueApi.test.ts` — Test issue fetching, comment posting, issue closing. Mock `gh` CLI calls.
- `adws/github/__tests__/prApi.test.ts` — Test PR detail fetching, review comment retrieval. Mock `gh` CLI calls.
- `adws/github/__tests__/pullRequestCreator.test.ts` — Test PR creation logic, title/body formatting. Mock git and GitHub operations.
- `adws/github/__tests__/worktreeCreation.test.ts` — Test worktree creation, branch checkout, directory setup. Mock `child_process`.
- `adws/github/__tests__/worktreeCleanup.test.ts` — Test worktree removal, branch cleanup. Mock `child_process` and `fs`.
- `adws/github/__tests__/workflowCommentsPR.test.ts` — Test PR-specific comment formatting functions.

### Step 13: Add missing tests — Phase modules

- `adws/phases/__tests__/planPhase.test.ts` — Test plan phase execution, plan agent invocation, state updates. Mock agents and state.
- `adws/phases/__tests__/buildPhase.test.ts` — Test build phase execution, build agent invocation, commit handling. Mock agents and git operations.
- `adws/phases/__tests__/testPhase.test.ts` — Test test phase execution, retry logic invocation, pass/fail handling. Mock test agent.
- `adws/phases/__tests__/prPhase.test.ts` — Test PR creation phase, PR agent invocation. Mock PR operations.
- `adws/phases/__tests__/prReviewPhase.test.ts` — Test review phase execution, multi-agent review orchestration. Mock review agents.
- `adws/phases/__tests__/documentPhase.test.ts` — Test document phase execution. Mock document agent.
- `adws/phases/__tests__/workflowInit.test.ts` — Test workflow initialization (the new split file). Mock git, GitHub, state operations.
- `adws/phases/__tests__/workflowCompletion.test.ts` — Test workflow completion and error handling (the new split file). Mock state and cleanup operations.

### Step 14: Update documentation

- Update `README.md` — Refresh the "Project Structure" section to reflect:
  - New file locations (tokenManager in core/, split files)
  - Co-located `__tests__/` directories in each module folder
  - New shared utilities (`orchestratorCli.ts`, split lifecycle files, split git operations)
- Update `adws/README.md` — Refresh the "Technical Details" section:
  - Update "Core Components" to list new files and removed duplicates
  - Update file locations for moved/split modules
  - Add note about shared orchestrator CLI utilities

### Step 15: Final validation

Run all validation commands to confirm zero regressions:

- `bun run lint`
- `bunx tsc --noEmit`
- `bunx tsc --noEmit -p adws/tsconfig.json`
- `bun run test`
- `bun run build`

## Validation Commands
Execute every command to validate the chore is complete with zero regressions.

- `bun run lint` — Run ESLint to check for code quality issues and unused imports
- `bunx tsc --noEmit` — Run root TypeScript type checking
- `bunx tsc --noEmit -p adws/tsconfig.json` — Run ADW-specific TypeScript type checking
- `bun run test` — Run all tests to validate the refactoring with zero regressions
- `bun run build` — Build the application to verify no build errors

## Notes
- IMPORTANT: Strictly adhere to `guidelines/coding_guidelines.md` throughout all changes. Key rules: files under 300 lines, functional patterns over imperative loops, no `any` types, meaningful error messages, immutability.
- When splitting files, prefer creating re-export barrels in the original file location for backward compatibility, then update consumers incrementally. This prevents breaking changes during the refactoring.
- When moving test files, update relative import paths carefully. The `@` path alias (mapped to `./adws`) can simplify imports in moved test files.
- The vitest glob pattern `adws/**/*.{test,spec}.?(c|m)[jt]s?(x)` already supports nested `__tests__/` directories — no config change needed.
- Run tests after each step to catch regressions early rather than accumulating issues.
- For new test files, follow the existing test patterns: use `vi.mock()` for module mocking, `vi.spyOn()` for partial mocking, factory helpers for test fixtures, and proper `beforeEach`/`afterEach` cleanup.
- The orchestrator deduplication (Step 3) is the highest-impact change — it eliminates ~600 lines of duplicated boilerplate across 13 files.
- When creating new test files, ensure they test all exported functions from their target module, including error paths and edge cases.
