# PR-Review: Update JSDoc for all changed files in external repo support

## PR-Review Description
PR #4 (`feat-issue-1-run-on-external-git-repo`) has three review comments from paysdoc:

1. **Application Tests in `test.md` (line 69):** "Application tests should not be removed, they are essential, but they have to be run in the target repo." — **RESOLVED** in commit `4396e42`. The test.md now includes a conditional Application Tests section (step 6) that only executes `npm test -- --run src` when a `src/` directory exists in the working directory.

2. **General comment:** "resolve merge conflicts." — **RESOLVED**. The branch is now rebased on top of `origin/main` (merge base `2d02471`). GitHub shows `mergeStateStatus: CLEAN`, `mergeable: MERGEABLE`.

3. **General comment:** "Update the javadoc for all changed files where applicable." — **OPEN**. Many files modified in this PR have new or changed function signatures (added `repoInfo?`, `cwd?`, `targetRepo?`, `baseRepoPath?` parameters) without corresponding JSDoc updates. Several new functions and types also lack JSDoc entirely.

## Summary of Original Implementation Plan
The original plan (`specs/issue-1-adw-enable-adw-to-run-on-uwva44-sdlc_planner-external-repo-workspace.md`) describes enabling ADW to operate on external git repositories by:
- Introducing a `TargetRepoManager` module to manage workspace directories for external repos (cloned to `~/.adw/repos/{owner}/{repo}/`)
- Extracting target repo info from webhook/cron payloads
- Propagating target repo context through the entire workflow lifecycle via `WorkflowConfig.targetRepo`
- Updating GitHub API modules, worktree operations, and workflow phases to support external repo context
- Keeping all ADW state (logs, agents, specs) in the ADW repository while git worktrees are created in the target repo workspace

## Relevant Files
Use these files to resolve the review:

### GitHub API Layer — Missing `@param repoInfo` documentation
- `adws/github/issueApi.ts` — 6 functions (`fetchGitHubIssue`, `commentOnIssue`, `getIssueState`, `closeIssue`, `fetchIssueCommentsRest`, `deleteIssueComment`) all added optional `repoInfo?: RepoInfo` parameter without updating JSDoc
- `adws/github/prApi.ts` — 4 functions (`fetchPRDetails`, `fetchPRReviewComments`, `commentOnPR`, `fetchPRList`) added optional `repoInfo?: RepoInfo` parameter without updating JSDoc
- `adws/github/pullRequestCreator.ts` — `createPullRequest()` added `repoInfo?: RepoInfo` parameter without updating existing JSDoc
- `adws/github/workflowCommentsBase.ts` — `isAdwRunningForIssue()` added optional `repoInfo?: RepoInfo` parameter without updating JSDoc

### Agent Functions — Missing `@param cwd` documentation
- `adws/agents/buildAgent.ts` — `runBuildAgent()` and `runPrReviewBuildAgent()` added `cwd?` parameter without updating JSDoc
- `adws/agents/planAgent.ts` — `runPlanAgent()`, `runPrReviewPlanAgent()`, `getPlanFilePath()`, `planFileExists()`, `readPlanFile()` added `cwd?`/`worktreePath?` parameters without updating JSDoc
- `adws/agents/testAgent.ts` — `runTestAgent()`, `runResolveTestAgent()`, `runResolveE2ETestAgent()`, `discoverE2ETestFiles()`, `runPlaywrightE2ETests()` added `cwd?`/`baseDir?` parameters without updating JSDoc
- `adws/agents/prAgent.ts` — `runPullRequestAgent()` added `cwd?` parameter without updating JSDoc
- `adws/agents/reviewAgent.ts` — `runReviewAgent()` added `cwd?` parameter without updating JSDoc
- `adws/agents/documentAgent.ts` — `runDocumentAgent()` added `cwd?` parameter without updating JSDoc
- `adws/agents/gitAgent.ts` — `runCommitAgent()` added `cwd?` parameter without updating JSDoc
- `adws/agents/patchAgent.ts` — `runPatchAgent()` added `cwd?` parameter without updating JSDoc

### Retry Functions — Completely missing JSDoc
- `adws/agents/reviewRetry.ts` — `runReviewWithRetry()` has no JSDoc at all
- `adws/agents/testRetry.ts` — `runUnitTestsWithRetry()` and `runE2ETestsWithRetry()` have no JSDoc at all

### Phase Functions — Missing `repoInfo` context documentation
- `adws/phases/buildPhase.ts` — `executeBuildPhase()` uses `config.repoInfo` but JSDoc doesn't document it
- `adws/phases/planPhase.ts` — `executePlanPhase()` uses `config.repoInfo` but JSDoc doesn't document it
- `adws/phases/testPhase.ts` — `executeTestPhase()` uses `config.repoInfo` but JSDoc doesn't document it
- `adws/phases/prPhase.ts` — `executePRPhase()` uses `config.repoInfo` but JSDoc doesn't document it
- `adws/phases/prReviewPhase.ts` — `initializePRReviewWorkflow()`, `executePRReviewPlanPhase()`, `executePRReviewBuildPhase()`, `executePRReviewTestPhase()`, `completePRReviewWorkflow()`, `handlePRReviewWorkflowError()` all use `repoInfo` without documenting it in JSDoc
- `adws/phases/documentPhase.ts` — `executeDocumentPhase()` uses `config.repoInfo` but JSDoc doesn't document it

### Workflow Lifecycle — Missing detailed parameter documentation
- `adws/phases/workflowLifecycle.ts` — `initializeWorkflow()` added `options?.targetRepo` parameter but JSDoc only has a brief description without `@param` details

### Trigger Functions — Missing JSDoc entirely
- `adws/triggers/trigger_webhook.ts` — `jsonResponse()`, `spawnDetached()`, and `HealthCheckResult` interface lack JSDoc
- `adws/triggers/trigger_cron.ts` — `RawIssue` interface, `fetchOpenIssues()`, `isQualifyingIssue()`, `checkAndTrigger()`, `checkPRsForReviewComments()` all lack JSDoc

### Git Operations — Missing JSDoc
- `adws/github/gitOperations.ts` — `mergeLatestFromDefaultBranch()` has no JSDoc

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Update JSDoc in `adws/github/issueApi.ts`
- Add `@param repoInfo` documentation to all 6 functions that received the optional `repoInfo?: RepoInfo` parameter:
  - `fetchGitHubIssue()` — add `@param repoInfo - Optional repository info override for targeting external repositories. Falls back to local git remote.`
  - `commentOnIssue()` — add `@param repoInfo - Optional repository info override for targeting external repositories.`
  - `getIssueState()` — add `@param repoInfo - Optional repository info override for targeting external repositories.`
  - `closeIssue()` — add `@param repoInfo - Optional repository info override for targeting external repositories.`
  - `fetchIssueCommentsRest()` — add `@param repoInfo - Optional repository info override for targeting external repositories.`
  - `deleteIssueComment()` — add `@param repoInfo - Optional repository info override for targeting external repositories.`

### Step 2: Update JSDoc in `adws/github/prApi.ts`
- Add `@param repoInfo` documentation to all 4 functions:
  - `fetchPRDetails()` — add `@param repoInfo - Optional repository info override for targeting external repositories.`
  - `fetchPRReviewComments()` — add `@param repoInfo - Optional repository info override for targeting external repositories.`
  - `commentOnPR()` — add `@param repoInfo - Optional repository info override for targeting external repositories.`
  - `fetchPRList()` — add `@param repoInfo - Optional repository info override for targeting external repositories.`

### Step 3: Update JSDoc in `adws/github/pullRequestCreator.ts`
- Add `@param repoInfo` to `createPullRequest()` JSDoc:
  - `@param repoInfo - Optional repository info override for targeting external repositories.`

### Step 4: Update JSDoc in `adws/github/workflowCommentsBase.ts`
- Add `@param repoInfo` to `isAdwRunningForIssue()`:
  - `@param repoInfo - Optional repository info override for targeting external repositories.`

### Step 5: Update JSDoc in `adws/github/gitOperations.ts`
- Add JSDoc to `mergeLatestFromDefaultBranch()`:
  - `/** Merges the latest changes from the default branch into the current branch. */`
  - Include `@param cwd` if the function accepts a working directory parameter

### Step 6: Update JSDoc in all agent files
- For each agent file, add `@param cwd` documentation to functions that received it:
  - `adws/agents/buildAgent.ts`: `runBuildAgent()` and `runPrReviewBuildAgent()` — add `@param cwd - Optional working directory for running the agent in a target repo workspace.`
  - `adws/agents/planAgent.ts`: `runPlanAgent()`, `runPrReviewPlanAgent()` — add `@param cwd - Optional working directory for running the agent in a target repo workspace.`
  - `adws/agents/planAgent.ts`: `getPlanFilePath()`, `planFileExists()`, `readPlanFile()` — add `@param worktreePath - Optional worktree path to locate the plan file in.`
  - `adws/agents/testAgent.ts`: `runTestAgent()`, `runResolveTestAgent()`, `runResolveE2ETestAgent()`, `runPlaywrightE2ETests()` — add `@param cwd - Optional working directory for running the agent in a target repo workspace.`
  - `adws/agents/testAgent.ts`: `discoverE2ETestFiles()` — add `@param baseDir - Optional base directory to search for E2E test files.`
  - `adws/agents/prAgent.ts`: `runPullRequestAgent()` — add `@param cwd - Optional working directory for running the agent in a target repo workspace.`
  - `adws/agents/reviewAgent.ts`: `runReviewAgent()` — add `@param cwd - Optional working directory for running the agent in a target repo workspace.`
  - `adws/agents/documentAgent.ts`: `runDocumentAgent()` — add `@param cwd - Optional working directory for running the agent in a target repo workspace.`
  - `adws/agents/gitAgent.ts`: `runCommitAgent()` — add `@param cwd - Optional working directory for running the agent in a target repo workspace.`
  - `adws/agents/patchAgent.ts`: `runPatchAgent()` — add `@param cwd - Optional working directory for running the agent in a target repo workspace.`

### Step 7: Add JSDoc to retry functions
- `adws/agents/reviewRetry.ts`: Add full JSDoc to `runReviewWithRetry()`:
  ```typescript
  /**
   * Runs the review agent with automatic retry logic on failure.
   * @param <params> - Document each parameter based on the function signature.
   * @returns The review result or throws after max retries.
   */
  ```
- `adws/agents/testRetry.ts`: Add full JSDoc to `runUnitTestsWithRetry()` and `runE2ETestsWithRetry()`:
  ```typescript
  /**
   * Runs unit tests with automatic retry and resolution attempts on failure.
   * @param <params> - Document each parameter based on the function signature.
   * @returns The test result.
   */
  ```

### Step 8: Update JSDoc in phase files
- For each phase file, update the JSDoc on the main exported function to document that `config.repoInfo` is used for external repository targeting:
  - `adws/phases/buildPhase.ts`: `executeBuildPhase()` — add note about `config.repoInfo` being used for external repo API calls
  - `adws/phases/planPhase.ts`: `executePlanPhase()` — same
  - `adws/phases/testPhase.ts`: `executeTestPhase()` — same
  - `adws/phases/prPhase.ts`: `executePRPhase()` — same
  - `adws/phases/documentPhase.ts`: `executeDocumentPhase()` — same
  - `adws/phases/prReviewPhase.ts`: Update JSDoc on all 6 exported functions (`initializePRReviewWorkflow`, `executePRReviewPlanPhase`, `executePRReviewBuildPhase`, `executePRReviewTestPhase`, `completePRReviewWorkflow`, `handlePRReviewWorkflowError`) to document `repoInfo` usage

### Step 9: Update JSDoc in `adws/phases/workflowLifecycle.ts`
- Update `initializeWorkflow()` JSDoc to include detailed `@param` tags:
  - `@param options.targetRepo - Optional target repository info for operating on an external git repository.`
  - `@param options.cwd - Optional working directory override.`
  - `@param options.issueType - Optional issue classification type.`

### Step 10: Add JSDoc to trigger functions
- `adws/triggers/trigger_webhook.ts`:
  - Add JSDoc to `jsonResponse()`: `/** Sends a JSON response with the specified status code and body. */`
  - Add JSDoc to `spawnDetached()`: `/** Spawns a detached child process for running ADW orchestrator workflows. */`
  - Add JSDoc to `HealthCheckResult` interface: `/** Result of a webhook server health check. */`
- `adws/triggers/trigger_cron.ts`:
  - Add JSDoc to `RawIssue` interface: `/** Raw issue data returned from the GitHub CLI. */`
  - Add JSDoc to `fetchOpenIssues()`: `/** Fetches all open issues from the configured GitHub repository. */`
  - Add JSDoc to `isQualifyingIssue()`: `/** Determines whether an issue qualifies for automatic ADW processing. */`
  - Add JSDoc to `checkAndTrigger()`: `/** Checks for qualifying issues and triggers ADW workflows for each. */`
  - Add JSDoc to `checkPRsForReviewComments()`: `/** Checks open PRs for actionable review comments and triggers PR review workflows. */`

### Step 11: Run validation commands
- Execute all validation commands listed below to confirm zero regressions after the JSDoc updates

## Validation Commands
Execute every command to validate the review is complete with zero regressions.

- `npm run lint` - Run linter to check for code quality issues
- `npm run build` - Build the application to verify no build errors
- `npm test` - Run tests to validate the review is complete with zero regressions

## Notes
- **Review comments 1 and 2 are already resolved.** The `src` symlink has been removed (commit `4396e42`), `vitest.config.ts` reverted to `adws/**` only patterns, `test.md` updated with conditional Application Tests section, and the branch is rebased onto `origin/main` with `mergeStateStatus: CLEAN`.
- The JSDoc updates are purely documentation changes and should not affect runtime behavior. No functional code changes are needed.
- When adding `@param repoInfo` documentation, use consistent wording across all files: "Optional repository info override for targeting external repositories. Falls back to local git remote when not provided."
- When adding `@param cwd` documentation, use consistent wording: "Optional working directory for running the agent in a target repo workspace."
- For retry functions (`reviewRetry.ts`, `testRetry.ts`), read the full function signatures before writing JSDoc to ensure all parameters are documented.
- The phase functions take a `WorkflowConfig` object which already has JSDoc on its interface definition in `workflowLifecycle.ts`. The phase function JSDoc updates should reference that `config.repoInfo` is used for external repo targeting rather than duplicating full parameter descriptions.
