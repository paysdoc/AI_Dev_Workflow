# Chore: Remove global targetRepoRegistry singleton

## Metadata
issueNumber: `119`
adwId: `1773319134593-2bpny5`
issueJson: `{"number":119,"title":"Remove global targetRepoRegistry singleton","body":"## Summary\nRemove the mutable global singleton in `targetRepoRegistry.ts` now that all consumers use `RepoContext`. This eliminates the root cause of repo-targeting bugs.\n\n## Dependencies\n- #118 — All entry points must create and pass RepoContext before the registry can be removed\n\n## User Story\nAs a developer, I want there to be no global mutable state for repo targeting so that it is structurally impossible to operate on the wrong repository.\n\n## Acceptance Criteria\n\n### Remove `targetRepoRegistry.ts`\n- Delete `adws/core/targetRepoRegistry.ts`\n- Remove all exports from `adws/core/index.ts`\n- Remove all imports of `setTargetRepo`, `getTargetRepo`, `clearTargetRepo`, `hasTargetRepo`, `resolveTargetRepoCwd` across the codebase\n\n### Update `targetRepoManager.ts`\n- `ensureTargetRepoWorkspace()` should take explicit repo identifier instead of reading from registry\n- Update callers to pass identifier from `RepoContext`\n\n### Remove deprecated `repoInfo` from WorkflowConfig\n- Remove the deprecated `repoInfo?: RepoInfo` field added during transition (#117)\n- All consumers now use `repoContext` exclusively\n\n### Clean up optional `repoInfo?` parameters\n- Remove the `repoInfo?` optional parameter from all functions in `issueApi.ts`, `prApi.ts`, `projectBoardApi.ts`, etc.\n- These functions are now only called internally by the provider implementations, which always pass explicit repo info\n\n### Verify no fallback paths remain\n- Grep the entire codebase for `getTargetRepo`, `setTargetRepo`, `registryRepoInfo`\n- Ensure zero references remain\n\n### Tests\n- Remove `targetRepoRegistry.test.ts` and `triggerCronRegistry.test.ts` (or update to test the new explicit patterns)\n- Run full test suite to verify nothing breaks\n\n## Notes\n- This is the point of no return — after this, all repo targeting is explicit and validated. Any function that needs repo info must receive it through `RepoContext` or direct parameters.","state":"OPEN","author":"paysdoc","labels":["enhancement"],"createdAt":"2026-03-09T15:19:08Z","comments":[],"actionableComment":null}`

## Chore Description
Remove the mutable global singleton `targetRepoRegistry.ts` now that all consumers use `RepoContext`. The registry maintains a module-level `registryRepoInfo: RepoInfo | null` variable with functions `setTargetRepo`, `getTargetRepo`, `clearTargetRepo`, `hasTargetRepo`, and `resolveTargetRepoCwd`. All entry points already create and pass `RepoContext` (completed in #118), so the registry is now dead code acting as a fallback. This chore eliminates it entirely, making all repo targeting explicit and validated — structurally preventing repo-targeting bugs.

## Relevant Files
Use these files to resolve the chore:

### Core Registry (to delete)
- `adws/core/targetRepoRegistry.ts` — The singleton module to delete (68 lines). Contains `setTargetRepo`, `getTargetRepo`, `clearTargetRepo`, `hasTargetRepo`, `resolveTargetRepoCwd`.
- `adws/core/index.ts` — Barrel export file; line 127 exports all registry functions. Must remove that export line.

### Phase Initialization (remove setTargetRepo calls)
- `adws/phases/workflowInit.ts` — Imports `setTargetRepo` (line 24); calls it at line 101 for backward compat. Also has deprecated `repoInfo?: RepoInfo` field in `WorkflowConfig` interface (line 66). Already creates `repoContext` at line 222.
- `adws/phases/prReviewPhase.ts` — Imports `setTargetRepo` (line 12); calls it at line 49. Has deprecated `repoInfo?: RepoInfo` in `PRReviewWorkflowConfig` (line 31). Already creates `repoContext` at line 110.

### Phase Completion (remove getTargetRepo fallbacks)
- `adws/phases/workflowCompletion.ts` — Line 39 uses `config.repoInfo?.repo ?? getTargetRepo().repo` as fallback.
- `adws/phases/prReviewCompletion.ts` — Lines 11, 115 import/use `getTargetRepo` as fallback.

### GitHub API Functions (remove `repoInfo?` optional parameter + `getTargetRepo()` fallback)
- `adws/github/issueApi.ts` — 7 functions with `repoInfo?: RepoInfo` parameter using `repoInfo ?? getTargetRepo()` fallback.
- `adws/github/prApi.ts` — 4 functions with `repoInfo?: RepoInfo` parameter.
- `adws/github/projectBoardApi.ts` — `moveIssueToStatus` with `repoInfo?` parameter (line 225).
- `adws/github/pullRequestCreator.ts` — Imports `resolveTargetRepoCwd`, `getTargetRepo` (line 10). `createPullRequest` has `cwd?` and `repoInfo?` params (line 64).
- `adws/github/prCommentDetector.ts` — Imports `resolveTargetRepoCwd` (line 10). Functions `getUnaddressedComments` and `hasUnaddressedComments` have `repoInfo?` param.
- `adws/github/workflowCommentsIssue.ts` — `postWorkflowComment` has `repoInfo?` param (line 213).
- `adws/github/workflowCommentsPR.ts` — `postPRWorkflowComment` has `repoInfo?` param (line 86).
- `adws/github/workflowCommentsBase.ts` — `isAdwRunningForIssue` has `repoInfo?` param (line 131).

### Git Operations (remove `resolveTargetRepoCwd` usage)
- `adws/github/gitBranchOperations.ts` — Imports `resolveTargetRepoCwd` (line 7).
- `adws/github/gitCommitOperations.ts` — Imports `resolveTargetRepoCwd` (line 7).
- `adws/github/worktreeCreation.ts` — Imports `resolveTargetRepoCwd` (line 17).
- `adws/github/worktreeOperations.ts` — Imports `resolveTargetRepoCwd` (line 13).
- `adws/github/worktreeQuery.ts` — Imports `resolveTargetRepoCwd` (line 10).

### Other Modules
- `adws/healthCheckChecks.ts` — Imports `getTargetRepo` (line 12); uses it at line 253.
- `adws/adwClearComments.tsx` — `clearIssueComments` has `repoInfo?` param (line 63); `parseArguments` returns `repoInfo?` (line 37).
- `adws/core/issueClassifier.ts` — `classifyIssueForTrigger` has `repoInfo?` param (line 197).
- `adws/triggers/issueDependencies.ts` — `findOpenDependencies` has `repoInfo?` param (line 55).

### Test Files (to delete or update)
- `adws/core/__tests__/targetRepoRegistry.test.ts` — Tests for the registry. **Delete entirely.**
- `adws/core/__tests__/triggerCronRegistry.test.ts` — Tests registry usage in cron context. **Delete entirely.**
- `adws/__tests__/healthCheckChecks.test.ts` — Mocks `targetRepoRegistry` (line 11). Update mock.
- `adws/__tests__/prReviewCostTracking.test.ts` — Mocks `targetRepoRegistry` (line 47). Remove mock.
- `adws/__tests__/workflowPhases.test.ts` — Mocks `createRepoContext` (lines 179-184). May need updates.
- `adws/github/__tests__/pullRequestCreator.test.ts` — Mocks `targetRepoRegistry` (line 22). Remove mock.
- `adws/github/__tests__/prCommentDetector.test.ts` — Mocks `targetRepoRegistry` (lines 19, 26). Remove mock.
- `adws/github/__tests__/worktreeOperations.test.ts` — Mocks `targetRepoRegistry` (lines 28, 59). Remove mock.
- `adws/github/__tests__/gitOperations.test.ts` — Mocks `targetRepoRegistry` (lines 11, 17). Remove mock.
- `adws/github/__tests__/workflowCommentsPR.test.ts` — Mocks `targetRepoRegistry` (line 11). Remove mock.
- `adws/github/__tests__/issueApi.test.ts` — Mocks `targetRepoRegistry` (line 11). Remove mock.
- `adws/github/__tests__/prApi.test.ts` — Mocks `targetRepoRegistry` (line 11). Remove mock.
- `adws/github/__tests__/projectBoardApi.test.ts` — Mocks `targetRepoRegistry` (line 11). Remove mock.
- `adws/triggers/__tests__/triggerRepoContext.test.ts` — Already validates triggers don't use registry. May need update after deletion.
- `adws/triggers/__tests__/webhookClearComment.test.ts` — Uses `repoInfo?` in test helper (line 51). Update.

### Guidelines
- `guidelines/coding_guidelines.md` — Coding guidelines to follow. Key principles: immutability, purity, type safety, code hygiene (remove unused code).

### Conditional Docs
- `adws/README.md` — Operating in `adws/` directory, read for context.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Read all files to understand current state
- Read every file listed in Relevant Files above to understand the exact current code before making changes.
- Read `adws/README.md` for workflow context.
- Pay attention to how each function currently receives `repoInfo` and how callers currently pass it.

### Step 2: Delete the targetRepoRegistry module and its tests
- Delete `adws/core/targetRepoRegistry.ts`.
- Delete `adws/core/__tests__/targetRepoRegistry.test.ts`.
- Delete `adws/core/__tests__/triggerCronRegistry.test.ts`.

### Step 3: Remove registry exports from barrel file
- In `adws/core/index.ts`, remove the line: `export { setTargetRepo, getTargetRepo, clearTargetRepo, hasTargetRepo, resolveTargetRepoCwd } from './targetRepoRegistry';`

### Step 4: Update phase initialization — remove setTargetRepo calls and deprecated repoInfo field
- In `adws/phases/workflowInit.ts`:
  - Remove import of `setTargetRepo` from `../core`.
  - Remove the backward-compat block: `if (repoInfo && !options?.repoId) { setTargetRepo(repoInfo); }`
  - Remove the deprecated `repoInfo?: RepoInfo` field from the `WorkflowConfig` interface.
  - Remove any assignment of `repoInfo` to the config object.
  - Ensure `repoContext` remains the sole mechanism.
- In `adws/phases/prReviewPhase.ts`:
  - Remove import of `setTargetRepo` from `../core`.
  - Remove the backward-compat block: `if (repoInfo && !repoId) { setTargetRepo(repoInfo); }`
  - Remove the deprecated `repoInfo?: RepoInfo` field from `PRReviewWorkflowConfig` interface.
  - Remove any assignment of `repoInfo` to the config object.

### Step 5: Update phase completion — replace getTargetRepo fallbacks with repoContext
- In `adws/phases/workflowCompletion.ts`:
  - Remove import of `getTargetRepo`.
  - Replace `config.repoInfo?.repo ?? getTargetRepo().repo` with `config.repoContext!.repoId.repo` (or equivalent from repoContext).
- In `adws/phases/prReviewCompletion.ts`:
  - Remove import of `getTargetRepo`.
  - Replace `config.repoInfo?.repo ?? getTargetRepo().repo` with `config.repoContext!.repoId.repo` (or equivalent from repoContext).

### Step 6: Update GitHub API functions — make repoInfo required parameter
- For each function in `adws/github/issueApi.ts`, `adws/github/prApi.ts`, `adws/github/projectBoardApi.ts`:
  - Change `repoInfo?: RepoInfo` to `repoInfo: RepoInfo` (make required).
  - Remove the `repoInfo ?? getTargetRepo()` fallback — just use `repoInfo` directly.
  - Remove import of `getTargetRepo` from `../../core`.
- Update all callers of these functions to always pass `repoInfo` explicitly. Since these are called from provider implementations that always have `repoInfo`, this should be straightforward.

### Step 7: Update pullRequestCreator — remove resolveTargetRepoCwd and getTargetRepo
- In `adws/github/pullRequestCreator.ts`:
  - Remove imports of `resolveTargetRepoCwd` and `getTargetRepo`.
  - Make `cwd` and `repoInfo` required parameters in `createPullRequest`.
  - Remove internal fallback logic that used registry functions.
  - Update all callers to pass explicit `cwd` and `repoInfo`.

### Step 8: Update prCommentDetector — remove resolveTargetRepoCwd
- In `adws/github/prCommentDetector.ts`:
  - Remove import of `resolveTargetRepoCwd`.
  - Make `repoInfo` a required parameter in `getUnaddressedComments` and `hasUnaddressedComments`.
  - Replace `resolveTargetRepoCwd()` usage with explicit `cwd` parameter if needed.
  - Update all callers.

### Step 9: Update workflow comment modules
- In `adws/github/workflowCommentsIssue.ts`:
  - Make `repoInfo` required in `postWorkflowComment`.
  - Remove `getTargetRepo` fallback.
- In `adws/github/workflowCommentsPR.ts`:
  - Make `repoInfo` required in `postPRWorkflowComment`.
  - Remove `getTargetRepo` fallback.
- In `adws/github/workflowCommentsBase.ts`:
  - Make `repoInfo` required in `isAdwRunningForIssue`.
  - Remove `getTargetRepo` fallback.
- Update all callers of these functions.

### Step 10: Update git operation modules — remove resolveTargetRepoCwd
- In `adws/github/gitBranchOperations.ts`, `adws/github/gitCommitOperations.ts`, `adws/github/worktreeCreation.ts`, `adws/github/worktreeOperations.ts`, `adws/github/worktreeQuery.ts`:
  - Remove import of `resolveTargetRepoCwd`.
  - Where `resolveTargetRepoCwd(cwd)` is used, replace with the explicit `cwd` parameter (make `cwd` required if currently optional).
  - Update all callers to pass `cwd` explicitly from `RepoContext.cwd`.

### Step 11: Update healthCheckChecks
- In `adws/healthCheckChecks.ts`:
  - Remove import of `getTargetRepo`.
  - The function using `getTargetRepo()` must receive `repoInfo` or `RepoContext` as an explicit parameter.
  - Update callers to pass it.

### Step 12: Update adwClearComments
- In `adws/adwClearComments.tsx`:
  - Make `repoInfo` required in `clearIssueComments` (or pass via explicit argument).
  - Update `parseArguments` if it returns `repoInfo?` — ensure callers always provide it.

### Step 13: Update issueClassifier and issueDependencies
- In `adws/core/issueClassifier.ts`:
  - Make `repoInfo` required in `classifyIssueForTrigger`.
  - Remove any `getTargetRepo()` fallback.
- In `adws/triggers/issueDependencies.ts`:
  - Make `repoInfo` required in `findOpenDependencies`.
  - Remove any `getTargetRepo()` fallback.
- Update all callers.

### Step 14: Update all test files — remove registry mocks
- In each test file that mocks `targetRepoRegistry`:
  - `adws/__tests__/healthCheckChecks.test.ts` — Remove `vi.mock('../core/targetRepoRegistry', ...)`. Update tests to pass `repoInfo` explicitly.
  - `adws/__tests__/prReviewCostTracking.test.ts` — Remove `vi.mock('../core/targetRepoRegistry', ...)`.
  - `adws/__tests__/workflowPhases.test.ts` — Update if needed for removed `repoInfo` field.
  - `adws/github/__tests__/pullRequestCreator.test.ts` — Remove registry mock. Pass explicit params in tests.
  - `adws/github/__tests__/prCommentDetector.test.ts` — Remove registry mock.
  - `adws/github/__tests__/worktreeOperations.test.ts` — Remove registry mock.
  - `adws/github/__tests__/gitOperations.test.ts` — Remove registry mock.
  - `adws/github/__tests__/workflowCommentsPR.test.ts` — Remove registry mock.
  - `adws/github/__tests__/issueApi.test.ts` — Remove registry mock. Update test calls to pass required `repoInfo`.
  - `adws/github/__tests__/prApi.test.ts` — Remove registry mock. Update test calls to pass required `repoInfo`.
  - `adws/github/__tests__/projectBoardApi.test.ts` — Remove registry mock. Update test calls.
  - `adws/triggers/__tests__/triggerRepoContext.test.ts` — Update or remove assertions about `setTargetRepo` imports since the module no longer exists.
  - `adws/triggers/__tests__/webhookClearComment.test.ts` — Update `repoInfo?` usage in test helpers.

### Step 15: Final verification grep
- Grep the entire codebase for `getTargetRepo`, `setTargetRepo`, `clearTargetRepo`, `hasTargetRepo`, `resolveTargetRepoCwd`, `registryRepoInfo`, `targetRepoRegistry`.
- Ensure zero references remain (except possibly in git history, comments explaining the migration, or this spec file).

### Step 16: Run validation commands
- Run all validation commands listed below.
- Fix any type errors, lint errors, or test failures.
- Re-run until all commands pass cleanly.

## Validation Commands
Execute every command to validate the chore is complete with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Type check the main project
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type check the adws scripts
- `bun run test` — Run full test suite to validate zero regressions
- `bun run build` — Build the application to verify no build errors

## Notes
- IMPORTANT: Follow `guidelines/coding_guidelines.md` strictly — particularly immutability (no global mutable state), type safety, code hygiene (remove unused code), and purity (isolate side effects).
- This is a deletion-heavy chore. The main risk is missing a caller that still relies on the registry fallback. The Step 15 grep is critical to catch any stragglers.
- When making `repoInfo` required, check each caller to ensure it actually has `repoInfo` available. All callers should already have it thanks to #118 (RepoContext at entry points).
- For functions where `resolveTargetRepoCwd(cwd)` was used, the replacement is simply using the `cwd` parameter directly (since callers already pass it from `RepoContext.cwd`). If a function used `resolveTargetRepoCwd()` with no argument, its caller must now provide `cwd`.
- The `RepoContext` type provides `repoId: RepoIdentifier` (with `owner` and `repo`) and `cwd: string`, which together replace all information previously sourced from the registry.
- After this chore, the codebase should have zero global mutable state for repo targeting. Every function that needs repo info receives it explicitly through parameters.
