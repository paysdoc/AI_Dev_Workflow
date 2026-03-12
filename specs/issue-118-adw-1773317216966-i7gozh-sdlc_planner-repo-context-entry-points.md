# Chore: Refactor triggers and orchestrators to create RepoContext at entry points

## Metadata
issueNumber: `118`
adwId: `1773317216966-i7gozh`
issueJson: `{"number":118,"title":"Refactor triggers and orchestrators to create RepoContext at entry points","body":"## Summary\nUpdate all workflow entry points (orchestrators and triggers) to create a `RepoContext` at startup and pass it through to phases. This completes the migration away from the global mutable registry.\n\n## Dependencies\n- #117 — Phases must accept RepoContext before entry points can provide it\n\n## User Story\nAs a developer, I want every workflow run to establish an immutable, validated repo context at the very start so that all subsequent operations are guaranteed to target the correct repository.\n\n## Acceptance Criteria\n\n### Update orchestrators\nFor each orchestrator (`adwPlan.tsx`, `adwBuild.tsx`, `adwPlanBuild.tsx`, `adwSdlc.tsx`, etc.):\n- After parsing CLI arguments, create `RepoContext` via the factory\n- Pass `RepoContext` to `initializeWorkflow()` / phase execution\n- Remove any direct calls to `setTargetRepo()`\n\n### Update triggers\n**`trigger_cron.ts`**:\n- When spawning orchestrator processes, pass repo identifier as CLI argument (not relying on env var alone)\n- Each spawned process creates its own `RepoContext`\n\n**`trigger_webhook.ts`**:\n- Extract repo identifier from webhook payload\n- Create `RepoContext` for the target repo before dispatching to orchestrator logic\n- Remove `setTargetRepo()` calls in webhook handlers\n\n### Entry-point validation\n- Each entry point validates that the repo context is consistent:\n  - CLI-provided repo URL matches git remote in working directory\n  - Webhook payload repo matches expected configuration\n- Fail fast with clear error messages on mismatch\n\n### Tests\n- Test orchestrator entry points create valid `RepoContext`\n- Test triggers pass repo identity correctly to spawned processes\n- Test validation catches mismatches\n\n## Notes\n- After this issue, `setTargetRepo()` / `getTargetRepo()` should have zero callers in orchestrators and triggers. They may still be called internally during transition — full removal happens in the next issue.","state":"OPEN","author":"paysdoc","labels":["enhancement"],"createdAt":"2026-03-09T15:18:51Z","comments":[],"actionableComment":null}`

## Chore Description
Remove all `setTargetRepo()` and `getTargetRepo()` calls from orchestrator entry points (`adws/*.tsx`) and trigger files (`adws/triggers/trigger_cron.ts`, `adws/triggers/trigger_webhook.ts`). Instead, resolve repository identity locally and pass it explicitly to downstream functions. For standalone orchestrators that bypass `initializeWorkflow()`, create `RepoContext` at the entry point. Add entry-point validation so repo mismatches fail fast. Internal modules (phases, GitHub API helpers) retain their registry fallback during transition — full removal happens in a follow-up issue.

### Current state
- **Phase-based orchestrators** (adwPlan, adwPlanBuild, adwSdlc, etc.) already pass `targetRepo` to `initializeWorkflow()`, which creates `RepoContext` internally and calls `setTargetRepo()` as a side-effect. The orchestrators themselves have zero direct registry calls — they are already compliant.
- **Standalone orchestrators** (`adwBuild.tsx`, `adwPatch.tsx`) parse target repo args but do NOT create `RepoContext`. `adwBuild.tsx` calls `postWorkflowComment()` without passing `repoInfo`, silently relying on the global registry fallback.
- **`trigger_cron.ts`** calls `setTargetRepo(getRepoInfo())` at module level and uses `getTargetRepo()` in 4 functions.
- **`trigger_webhook.ts`** calls `setTargetRepo()` in 5 event handlers before processing.

## Relevant Files
Use these files to resolve the chore:

### Triggers (primary changes)
- `adws/triggers/trigger_cron.ts` — Contains module-level `setTargetRepo(getRepoInfo())` and 4 `getTargetRepo()` calls in `fetchOpenIssues()`, `buildTargetRepoArgs()`, `checkAndTrigger()`, and `checkPRsForReviewComments()`. All must be replaced with explicit local `repoInfo`.
- `adws/triggers/trigger_webhook.ts` — Contains 5 `setTargetRepo()` calls across PR review, issue_comment, pull_request, and issues event handlers. All must be removed since repoInfo is already extracted as local variables and passed to downstream functions.

### Standalone orchestrators (secondary changes)
- `adws/adwBuild.tsx` — Calls `postWorkflowComment()` 6 times without passing `repoInfo`. Must pass `repoInfo` derived from parsed CLI args. Should also create `RepoContext` for provider-agnostic operations.
- `adws/adwBuildHelpers.ts` — Contains `parseArguments()` used by adwBuild. May need to expose repoInfo.
- `adws/adwPatch.tsx` — Parses target repo args and already passes `{ owner, repo }` to `fetchGitHubIssue()`. Does not call `postWorkflowComment()` so minimal changes needed, but should create `RepoContext` for consistency.

### Validation support
- `adws/providers/repoContext.ts` — `createRepoContext()` factory already validates: cwd is a git repo, git remote matches declared repoId. This validation runs automatically when entry points create RepoContext.
- `adws/providers/types.ts` — Defines `RepoContext`, `RepoIdentifier`, `Platform`.

### Internal files (context only — keep setTargetRepo during transition)
- `adws/phases/workflowInit.ts` — `initializeWorkflow()` calls `setTargetRepo()` at line 101 and creates `RepoContext` at lines 215-229. Stays as-is during transition.
- `adws/phases/prReviewPhase.ts` — `initializePRReviewWorkflow()` calls `setTargetRepo()` at line 49. Stays as-is during transition.
- `adws/core/targetRepoRegistry.ts` — Defines `setTargetRepo()`, `getTargetRepo()`, `clearTargetRepo()`, `hasTargetRepo()`. Not modified in this issue.

### Tests
- `adws/triggers/__tests__/triggerCronSweeper.test.ts` — Existing cron trigger tests. Must update for new function signatures.
- `adws/triggers/__tests__/` — Existing webhook trigger tests. Must verify no setTargetRepo usage.
- `adws/phases/__tests__/helpers/makeRepoContext.ts` — Test helper for creating mock RepoContext.

### New Files
- `adws/__tests__/adwBuildRepoContext.test.ts` — Tests that adwBuild passes repoInfo to all postWorkflowComment calls and creates valid RepoContext.
- `adws/triggers/__tests__/triggerCronRepoContext.test.ts` — Tests that trigger_cron uses local repoInfo (not global registry) and passes it correctly to spawned workflows.
- `adws/triggers/__tests__/triggerWebhookRepoContext.test.ts` — Tests that trigger_webhook does NOT call setTargetRepo and passes repoInfo directly to downstream functions.

### Guidelines
- `guidelines/coding_guidelines.md` — Must follow immutability, type safety, and modularity principles.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Update `trigger_cron.ts` — replace global registry with local repoInfo

- Replace the module-level `setTargetRepo(getRepoInfo())` call (line 32) with a module-level constant: `const repoInfo: RepoInfo = getRepoInfo();`
- Import `RepoInfo` type from `../github` (if not already imported).
- Remove `setTargetRepo` and `getTargetRepo` from the import at line 11.
- Update `fetchOpenIssues()`:
  - Add parameter `repoInfo: RepoInfo`
  - Replace `const { owner, repo } = getTargetRepo();` (line 36) with `const { owner, repo } = repoInfo;`
  - The function is exported, so update its signature accordingly.
- Update `buildTargetRepoArgs()`:
  - Add parameter `repoInfo: RepoInfo`
  - Replace `const { owner, repo } = getTargetRepo();` (line 51) with `const { owner, repo } = repoInfo;`
- Update `checkAndTrigger()`:
  - Replace `const repoInfo = getTargetRepo();` (line 97) with usage of the module-level `repoInfo` constant.
  - Pass `repoInfo` to `fetchOpenIssues(repoInfo)` and `buildTargetRepoArgs(repoInfo)`.
- Update `checkPRsForReviewComments()`:
  - Replace `hasUnaddressedComments(pr.number, getTargetRepo())` (line 139) with `hasUnaddressedComments(pr.number, repoInfo)`.
  - Pass `repoInfo` to `buildTargetRepoArgs(repoInfo)` for target repo args (line 142).
- Verify: zero references to `setTargetRepo` or `getTargetRepo` remain in the file.

### Step 2: Update `trigger_webhook.ts` — remove all setTargetRepo calls

- Remove all 5 `setTargetRepo(...)` calls:
  - Line 109: `if (repoFullName) setTargetRepo(getRepoInfoFromPayload(repoFullName));` — remove entirely. The `repoFullName` is already used to build `extractTargetRepoArgs(body)` which is passed to the spawned process.
  - Line 124: `if (webhookRepoInfo) setTargetRepo(webhookRepoInfo);` — remove entirely. `webhookRepoInfo` is already passed to `checkIssueEligibility()`, `ensureCronProcess()`, `classifyAndSpawnWorkflow()`, and `clearIssueComments()`.
  - Line 153: `if (repoFullName) setTargetRepo(getRepoInfoFromPayload(repoFullName));` — remove entirely. The downstream `handlePullRequestEvent()` builds its own repoInfo from the payload.
  - Line 170: `if (closedRepoFullName) setTargetRepo(getRepoInfoFromPayload(closedRepoFullName));` — remove entirely. `closedRepoInfo` is already extracted and passed to `handleIssueClosedDependencyUnblock()` and `removeWorktreesForIssue()`.
  - Line 189: `if (issueRepoInfo) setTargetRepo(issueRepoInfo);` — remove entirely. `issueRepoInfo` is already passed to `checkIssueEligibility()`, `ensureCronProcess()`, and `classifyAndSpawnWorkflow()`.
- Remove `setTargetRepo` from the import at line 12.
- Verify: zero references to `setTargetRepo` remain in the file. `getTargetRepoWorkspacePath` is still used directly (line 173) and is fine — it's a utility, not the registry.

### Step 3: Update `adwBuild.tsx` — pass repoInfo explicitly and create RepoContext

- After `parseTargetRepoArgs()` (line 68), create a proper `RepoInfo` object:
  ```typescript
  const targetRepo = parseTargetRepoArgs(args);
  const repoInfo: RepoInfo | undefined = targetRepo
    ? { owner: targetRepo.owner, repo: targetRepo.repo }
    : undefined;
  ```
- Import `RepoInfo` from `./github`.
- Pass `repoInfo` as the 4th argument to ALL `postWorkflowComment()` calls:
  - Line 155: `postWorkflowComment(issueNumber, 'resuming', ctx, repoInfo);`
  - Line 163: `postWorkflowComment(issueNumber, 'implementing', ctx, repoInfo);`
  - Line 196: `postWorkflowComment(issueNumber, 'build_progress', ctx, repoInfo);`
  - Line 227: `postWorkflowComment(issueNumber, 'implemented', ctx, repoInfo);`
  - Line 234: `postWorkflowComment(issueNumber, 'implementation_committing', ctx, repoInfo);`
  - Line 267: `postWorkflowComment(issueNumber, 'error', ctx, repoInfo);`
- Update `fetchGitHubIssue(issueNumber, { owner, repo })` (line 79) to use the new repoInfo: `fetchGitHubIssue(issueNumber, repoInfo)`.
- Create `RepoContext` after determining the working directory (after line 90 `getCurrentBranch`):
  ```typescript
  import { createRepoContext } from './providers/repoContext';
  import { Platform } from './providers/types';
  import type { RepoContext } from './providers/types';

  let repoContext: RepoContext | undefined;
  if (repoInfo) {
    try {
      repoContext = createRepoContext({
        repoId: { owner: repoInfo.owner, repo: repoInfo.repo, platform: Platform.GitHub },
        cwd: cwd || process.cwd(),
      });
    } catch (error) {
      log(`Failed to create RepoContext: ${error}`, 'info');
    }
  }
  ```
  This provides entry-point validation: `createRepoContext()` validates that the git remote matches the declared repoId.

### Step 4: Update `adwPatch.tsx` — create RepoContext for entry-point validation

- `adwPatch.tsx` already passes `{ owner, repo }` to `fetchGitHubIssue()` and does not call `postWorkflowComment()`, so it doesn't rely on the global registry. However, for consistency and entry-point validation:
- After parsing args (line 55-60), create RepoContext:
  ```typescript
  const targetRepo = parseTargetRepoArgs(args);
  const repoInfo: RepoInfo | undefined = targetRepo
    ? { owner: targetRepo.owner, repo: targetRepo.repo }
    : undefined;
  ```
- After determining cwd (line 70 `getCurrentBranch`), create RepoContext:
  ```typescript
  if (repoInfo) {
    try {
      createRepoContext({
        repoId: { owner: repoInfo.owner, repo: repoInfo.repo, platform: Platform.GitHub },
        cwd: cwd || process.cwd(),
      });
    } catch (error) {
      log(`RepoContext validation failed: ${error}`, 'error');
      process.exit(1);
    }
  }
  ```
- Import `createRepoContext` from `./providers/repoContext` and `Platform` from `./providers/types`.
- Update `fetchGitHubIssue(issueNumber, { owner, repo })` (line 64) to `fetchGitHubIssue(issueNumber, repoInfo)`.

### Step 5: Write tests for trigger_cron.ts repo identity changes

- Create `adws/triggers/__tests__/triggerCronRepoContext.test.ts`:
  - Mock `../core` and `../github` modules.
  - Test that `fetchOpenIssues(repoInfo)` uses the passed repoInfo (not getTargetRepo).
  - Test that `buildTargetRepoArgs(repoInfo)` constructs args from the passed repoInfo.
  - Test that `checkAndTrigger()` passes repoInfo to `fetchOpenIssues()`, `checkIssueEligibility()`, and `classifyAndSpawnWorkflow()`.
  - Test that `checkPRsForReviewComments()` passes repoInfo to `hasUnaddressedComments()`.
  - Verify the file does not import `setTargetRepo` or `getTargetRepo`.

### Step 6: Write tests for trigger_webhook.ts setTargetRepo removal

- Create `adws/triggers/__tests__/triggerWebhookRepoContext.test.ts`:
  - Import `trigger_webhook.ts` source and verify `setTargetRepo` is not in the imports (static analysis test).
  - Test that `extractTargetRepoArgs()` correctly extracts `--target-repo` and `--clone-url` from webhook payload.
  - Test that webhook event handlers pass repoInfo directly to downstream functions without calling `setTargetRepo`.
  - Follow existing test patterns from `triggerWebhookGatekeeper.test.ts` and `triggerWebhookPort.test.ts`.

### Step 7: Write tests for adwBuild.tsx RepoContext creation

- Create `adws/__tests__/adwBuildRepoContext.test.ts`:
  - Mock `./providers/repoContext`, `./github`, `./agents`, `./core`.
  - Test that when `--target-repo` args are provided, `createRepoContext()` is called with the correct repoId and cwd.
  - Test that `postWorkflowComment()` is called with repoInfo as 4th argument.
  - Test that when `createRepoContext()` throws (e.g., git remote mismatch), the error is logged but workflow continues (graceful degradation).
  - Test that `fetchGitHubIssue()` receives the parsed repoInfo.

### Step 8: Update existing trigger tests for new function signatures

- Update `adws/triggers/__tests__/triggerCronSweeper.test.ts`:
  - Update calls to `fetchOpenIssues()` to pass `repoInfo` parameter.
  - Update calls to `buildTargetRepoArgs()` if they exist in tests.
  - Ensure mocks no longer set up `getTargetRepo` for trigger_cron (it should no longer be called).
- Review other trigger test files for any references to the removed `setTargetRepo`/`getTargetRepo` usage pattern and update accordingly.

### Step 9: Run Validation Commands

- Run all validation commands listed below.
- Fix any lint errors, type errors, or test failures.
- Ensure zero regressions.

## Validation Commands
Execute every command to validate the chore is complete with zero regressions.

- `bun run lint` - Run linter to check for code quality issues
- `bunx tsc --noEmit` - Type check root project
- `bunx tsc --noEmit -p adws/tsconfig.json` - Type check adws scripts
- `bun run test` - Run full test suite to validate zero regressions

## Notes
- IMPORTANT: Follow `guidelines/coding_guidelines.md` — especially immutability (RepoContext is frozen), type safety (typed repoInfo parameters), and modularity (single responsibility per function).
- **Internal modules keep registry fallback**: `initializeWorkflow()`, `initializePRReviewWorkflow()`, and GitHub API helpers (`issueApi.ts`, `prApi.ts`, etc.) retain their `setTargetRepo()`/`getTargetRepo()` calls. Full removal of the registry is tracked in the next issue.
- **`adwTest.tsx` and `adwDocument.tsx` need no changes**: They are standalone runners that don't make GitHub API calls requiring repo context.
- **`adwClearComments.tsx` needs no changes**: It already accepts `--repo owner/repo` as a CLI arg and passes `repoInfo` explicitly to all functions.
- **`healthCheck.tsx` needs no changes**: It uses `getTargetRepo()` via `healthCheckChecks.ts` which is an internal utility module.
- **`adwPrReview.tsx` needs no changes**: It already passes `repoInfo` to `initializePRReviewWorkflow()` which creates RepoContext internally.
- **Phase-based orchestrators need no changes**: They already pass `targetRepo` to `initializeWorkflow()` which handles RepoContext creation.
- When creating `RepoContext` in standalone orchestrators, handle failures gracefully (try/catch with fallback) to maintain backward compatibility during transition.
