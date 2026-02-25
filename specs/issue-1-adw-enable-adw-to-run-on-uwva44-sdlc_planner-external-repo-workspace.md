# Feature: Enable ADW to run on a different GIT repository

## Metadata
issueNumber: `1`
adwId: `enable-adw-to-run-on-uwva44`
issueJson: `{"number":1,"title":"Enable ADW to run on a different GIT repository","body":"The adws currently all run in the local repository. This requires a whole adw suite of programs to be present in the repository in which the adw operates. There are several problems with this:\n- The target repository gets polluted with ADW related information, including logs and agent information\n- Unrelated - and possibly proprietary - reporting is done in the target repository\n- Costing becomes hard, because token reporting is done for every repository. \n\nWhenever a the webhook or cron triggers, the repository name and url must get retrieved from the message. \nWork needs to be done in a workspace dedicated to the target repository: \n - either in an existing folder or \n - in a new folder \n   - in which the target repo is cloned \n   - the default branch checked out\n\nToken reporting will be tackled in a future issue.","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-02-24T14:40:14Z","comments":[],"actionableComment":null}`

## Feature Description
Currently, all ADW workflows operate within the local ADW repository. This means that when ADW processes a GitHub issue, it creates worktrees, branches, commits, and stores all state (logs, agents, specs) inside the same repository where ADW itself lives. This causes several problems:

1. **Target repository pollution**: ADW-specific files (logs, agent state, specs) get stored in the target repo
2. **Proprietary data leakage**: Reporting data from one repository ends up in another
3. **Cost tracking complexity**: Token usage is scattered across repositories instead of being centralized

This feature decouples the ADW system from the target repository by:
- Extracting target repository information from webhook payloads and cron polling
- Managing dedicated workspace directories for external target repositories
- Keeping all ADW state (logs, agents, specs) in the ADW repository
- Running Claude Code agents with their `cwd` set to the target repository workspace

## User Story
As a developer using ADW to automate workflows across multiple repositories
I want ADW to clone and operate on external target repositories in isolated workspaces
So that the target repositories are not polluted with ADW-specific files and ADW state is centralized

## Problem Statement
ADW currently assumes it operates on the same repository it is installed in. The `getRepoInfo()` function reads from the local `git remote get-url origin`, and all directory paths (`LOGS_DIR`, `SPECS_DIR`, `AGENTS_STATE_DIR`, `WORKTREES_DIR`) are relative to `process.cwd()`. When a webhook fires for an issue on an external repository, ADW has no way to distinguish the target repo from itself, and all artifacts end up in the ADW repo.

## Solution Statement
Introduce a **target repository context** that flows through the entire workflow:

1. **Webhook/cron triggers** extract `repository.full_name` and `repository.clone_url` from the GitHub event payload and pass them as CLI arguments to the spawned orchestrator scripts.
2. A new **`targetRepoManager`** module manages workspace directories under a configurable `TARGET_REPOS_DIR` (default: `~/.adw/repos/{owner}/{repo}/`). It handles cloning, pulling, and providing the workspace path.
3. **`getRepoInfo()`** is updated to accept an optional `RepoInfo` parameter, allowing callers to override the local git-derived repo info with the target repo context.
4. **`WorkflowConfig`** gains a `targetRepo` field that carries `{ owner, repo, cloneUrl, workspacePath }` through all phases.
5. **ADW state directories** (`logs/`, `agents/`, `specs/`) remain in the ADW repository (derived from the ADW process's `process.cwd()`), while **git worktrees** are created in the target repository's workspace.
6. **Claude Code agents** are spawned with `cwd` set to the target repository workspace, so they operate on the correct codebase.

## Relevant Files
Use these files to implement the feature:

### Existing Files to Modify
- `adws/core/config.ts` — Add `TARGET_REPOS_DIR` config constant and `GITHUB_REPO_URL` env var usage
- `adws/core/issueTypes.ts` — Add `TargetRepoInfo` type definition
- `adws/core/dataTypes.ts` — Re-export the new type
- `adws/github/githubApi.ts` — Update `getRepoInfo()` to accept an optional override parameter; add `getRepoInfoFromUrl()` helper
- `adws/github/issueApi.ts` — Update `fetchGitHubIssue()` and other functions to accept optional `RepoInfo` parameter
- `adws/github/prApi.ts` — Update PR API functions to accept optional `RepoInfo` parameter
- `adws/github/pullRequestCreator.ts` — Update `createPullRequest()` to accept optional `RepoInfo` parameter
- `adws/github/worktreeOperations.ts` — Update `getWorktreesDir()` and related functions to accept a base repo path
- `adws/github/worktreeCreation.ts` — Update worktree creation to use target repo workspace path
- `adws/phases/workflowLifecycle.ts` — Update `initializeWorkflow()` to accept and propagate `TargetRepoInfo`; update `WorkflowConfig` interface
- `adws/triggers/trigger_webhook.ts` — Extract `repository` from webhook payload and pass to spawned workflows
- `adws/triggers/trigger_cron.ts` — Extract repo info from fetched issues and pass to spawned workflows
- `adws/triggers/webhookHandlers.ts` — Update `handlePullRequestEvent()` to use target repo context
- `adws/workflowPhases.ts` — Re-export updated types
- `adws/github/workflowCommentsBase.ts` — Update `isAdwRunningForIssue()` to accept optional `RepoInfo`
- `.env.sample` — Add `TARGET_REPOS_DIR` documentation

### New Files
- `adws/core/targetRepoManager.ts` — Target repository workspace management (clone, pull, workspace path resolution)
- `adws/__tests__/targetRepoManager.test.ts` — Unit tests for the target repo manager

### Documentation Files to Read
- `adws/README.md` — For understanding the ADW system architecture
- `.claude/commands/conditional_docs.md` — For checking documentation requirements

## Implementation Plan
### Phase 1: Foundation
1. Define the `TargetRepoInfo` type that carries target repository context through the system
2. Create the `targetRepoManager` module that handles:
   - Resolving workspace directories for target repos
   - Cloning repos that don't exist locally
   - Checking out and pulling the default branch
   - Validating workspace state
3. Update `config.ts` with the `TARGET_REPOS_DIR` configuration
4. Update `getRepoInfo()` to support an optional override, and add `getRepoInfoFromUrl()` and `getRepoInfoFromPayload()`

### Phase 2: Core Implementation
1. Update the GitHub API layer (`issueApi.ts`, `prApi.ts`, `pullRequestCreator.ts`) to accept and use `RepoInfo` overrides so `gh` CLI commands target the correct repository
2. Update `WorkflowConfig` interface with `targetRepo` field
3. Update `initializeWorkflow()` to:
   - Accept target repo info
   - Resolve or create the target repo workspace
   - Create worktrees within the target repo workspace
   - Keep ADW state in the ADW repo
4. Update worktree operations to work with external repo paths

### Phase 3: Integration
1. Update webhook trigger to extract repository info from payloads and pass it as CLI arguments (`--target-repo owner/repo --clone-url https://...`)
2. Update cron trigger to extract repository info from the GitHub API response
3. Update all orchestrator scripts to parse the new `--target-repo` argument and pass it to `initializeWorkflow()`
4. Update spawned workflow command arguments in both triggers

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Add TargetRepoInfo type and config
- Add `TargetRepoInfo` interface to `adws/core/issueTypes.ts`:
  ```typescript
  export interface TargetRepoInfo {
    owner: string;
    repo: string;
    cloneUrl: string;
    workspacePath?: string;
  }
  ```
- Add `TARGET_REPOS_DIR` to `adws/core/config.ts`:
  ```typescript
  export const TARGET_REPOS_DIR = process.env.TARGET_REPOS_DIR || path.join(os.homedir(), '.adw', 'repos');
  ```
- Re-export from `adws/core/dataTypes.ts`
- Update `.env.sample` with `TARGET_REPOS_DIR` documentation

### Step 2: Create targetRepoManager module
- Create `adws/core/targetRepoManager.ts` with the following functions:
  - `getTargetRepoWorkspacePath(owner: string, repo: string): string` — Returns `TARGET_REPOS_DIR/{owner}/{repo}`
  - `isRepoCloned(workspacePath: string): boolean` — Checks if `.git` exists in workspace
  - `cloneTargetRepo(cloneUrl: string, workspacePath: string): void` — Clones the repo
  - `ensureTargetRepoWorkspace(targetRepo: TargetRepoInfo): string` — Orchestrates clone/pull/checkout; returns workspace path
  - `pullLatestDefaultBranch(workspacePath: string): string` — Fetches and checks out default branch, returns branch name
- All git operations in this module should use `execSync` with `cwd` set to the workspace path
- Export from `adws/core/index.ts`

### Step 3: Write unit tests for targetRepoManager
- Create `adws/__tests__/targetRepoManager.test.ts`
- Test `getTargetRepoWorkspacePath()` returns correct path structure
- Test `isRepoCloned()` checks for `.git` directory
- Test `ensureTargetRepoWorkspace()` clones when not present, pulls when present
- Test `pullLatestDefaultBranch()` fetches and checkouts default branch
- Mock `execSync` and `fs` for all tests

### Step 4: Update getRepoInfo() to support overrides
- In `adws/github/githubApi.ts`:
  - Add `getRepoInfoFromUrl(repoUrl: string): RepoInfo` that parses `owner/repo` from a GitHub URL
  - Add `getRepoInfoFromPayload(repoFullName: string): RepoInfo` that parses `owner/repo` from `repository.full_name`
  - Update `getRepoInfo()` signature: keep it as-is for backward compatibility (reads from local git remote)
- Export new functions from `adws/github/index.ts`

### Step 5: Update GitHub API layer to accept optional RepoInfo
- Update `adws/github/issueApi.ts`:
  - `fetchGitHubIssue(issueNumber, repoInfo?)` — Use provided `repoInfo` or fall back to `getRepoInfo()`
  - `commentOnIssue(issueNumber, body, repoInfo?)` — Same pattern
  - `getIssueState(issueNumber, repoInfo?)` — Same pattern
  - `closeIssue(issueNumber, comment?, repoInfo?)` — Same pattern
  - `fetchIssueCommentsRest(issueNumber, repoInfo?)` — Same pattern
  - `deleteIssueComment(commentId, repoInfo?)` — Same pattern
- Update `adws/github/prApi.ts`:
  - `fetchPRDetails(prNumber, repoInfo?)` — Same pattern
  - `fetchPRReviewComments(prNumber, repoInfo?)` — Same pattern
  - `commentOnPR(prNumber, body, repoInfo?)` — Same pattern
  - `fetchPRList(repoInfo?)` — Same pattern
- Update `adws/github/pullRequestCreator.ts`:
  - `createPullRequest(issue, planSummary, buildSummary, baseBranch?, cwd?, repoInfo?)` — Same pattern
- All functions should use `const { owner, repo } = repoInfo ?? getRepoInfo()` at the start
- Update `adws/github/index.ts` re-exports as needed

### Step 6: Update WorkflowConfig and initializeWorkflow
- In `adws/phases/workflowLifecycle.ts`:
  - Add `targetRepo?: TargetRepoInfo` to `WorkflowConfig` interface
  - Add `targetRepo?: TargetRepoInfo` to `initializeWorkflow()` options parameter
  - When `targetRepo` is provided:
    - Call `ensureTargetRepoWorkspace(targetRepo)` to get the workspace path
    - Use the workspace path as the base for worktree operations
    - Pass `targetRepo` as `RepoInfo` to all GitHub API calls
    - Create worktrees within the target repo workspace
  - When `targetRepo` is not provided:
    - Maintain existing behavior (work in local repo)
  - Pass `targetRepo` through to all phase functions via `WorkflowConfig`

### Step 7: Update worktree operations for external repos
- In `adws/github/worktreeOperations.ts`:
  - Update `getWorktreesDir()` to accept an optional `baseRepoPath` parameter
  - Update `getMainRepoPath()` to accept an optional `cwd` parameter
  - Ensure worktree operations work when the base repo is an external workspace
- In `adws/github/worktreeCreation.ts`:
  - Ensure `createWorktree()` and `ensureWorktree()` work with external repo paths

### Step 8: Update workflow phases to use target repo context
- In `adws/phases/planPhase.ts` — Update `executePlanPhase()` to pass `targetRepo` RepoInfo to API calls
- In `adws/phases/buildPhase.ts` — Update `executeBuildPhase()` to pass `targetRepo` RepoInfo to API calls
- In `adws/phases/prPhase.ts` — Update `executePRPhase()` to pass `targetRepo` RepoInfo to `createPullRequest()`
- In `adws/phases/testPhase.ts` — Update `executeTestPhase()` to pass `targetRepo` RepoInfo
- In `adws/phases/documentPhase.ts` — Update `executeDocumentPhase()` to pass `targetRepo` RepoInfo
- In `adws/phases/prReviewPhase.ts` — Update `executePRReviewPlanPhase()` to pass `targetRepo` RepoInfo
- In `adws/github/workflowCommentsBase.ts` — Update `isAdwRunningForIssue()` and `detectRecoveryState()` to accept optional `RepoInfo`

### Step 9: Update triggers to extract and pass target repo info
- In `adws/triggers/trigger_webhook.ts`:
  - Extract `repository.full_name` and `repository.clone_url` from the webhook payload
  - Pass `--target-repo {owner}/{repo} --clone-url {clone_url}` as arguments to spawned workflows
  - Update all `spawnDetached()` calls to include target repo arguments
- In `adws/triggers/trigger_cron.ts`:
  - The cron trigger already uses `getRepoInfo()` from the local git remote — this is the target repo
  - For multi-repo support, add `--target-repo` parsing for consistency
- In `adws/triggers/webhookHandlers.ts`:
  - Update `handlePullRequestEvent()` to extract and use target repo info from the payload

### Step 10: Update orchestrator scripts to parse --target-repo
- Update the `parseArguments()` function pattern in all orchestrator scripts to accept `--target-repo` and `--clone-url` options:
  - `adws/adwPlanBuild.tsx`
  - `adws/adwPlanBuildTest.tsx`
  - `adws/adwPlanBuildReview.tsx`
  - `adws/adwPlanBuildDocument.tsx`
  - `adws/adwPlanBuildTestReview.tsx`
  - `adws/adwSdlc.tsx`
  - `adws/adwPlan.tsx`
  - `adws/adwBuild.tsx`
  - `adws/adwTest.tsx`
  - `adws/adwDocument.tsx`
  - `adws/adwPatch.tsx`
  - `adws/adwPrReview.tsx`
- Create a shared `parseTargetRepoArgs()` utility in `adws/core/utils.ts` to avoid duplication
- Pass parsed `TargetRepoInfo` to `initializeWorkflow()`

### Step 11: Update workflow comments for target repo context
- In `adws/github/workflowCommentsIssue.ts` and `adws/github/workflowCommentsPR.ts`:
  - Update `postWorkflowComment()` to accept optional `RepoInfo` and pass it through to `commentOnIssue()` / `commentOnPR()`
- In `adws/github/workflowComments.ts`:
  - Update the wrapper function to propagate `RepoInfo`

### Step 12: Write integration-level tests
- Add tests in `adws/__tests__/` for the updated argument parsing in orchestrators
- Add tests for `getRepoInfoFromUrl()` and `getRepoInfoFromPayload()`
- Add tests for webhook trigger repo info extraction
- Ensure existing tests still pass (backward compatibility)

### Step 13: Run validation commands
- Run all validation commands listed below to confirm zero regressions

## Testing Strategy
### Unit Tests
- `targetRepoManager.test.ts`: Test workspace path resolution, clone detection, clone/pull operations (mocked)
- Test `getRepoInfoFromUrl()` with HTTPS and SSH URLs
- Test `getRepoInfoFromPayload()` with `owner/repo` format
- Test updated `fetchGitHubIssue()` with and without `RepoInfo` override
- Test `parseTargetRepoArgs()` utility function
- Test webhook payload repo extraction

### Edge Cases
- Target repo already cloned and up-to-date
- Target repo clone URL changes (repo transferred/renamed)
- Target repo workspace directory doesn't exist yet (first run)
- Network errors during clone/pull (should fail gracefully with clear error)
- No `--target-repo` argument provided (backward compatibility — use local repo)
- Invalid `--target-repo` format (should error clearly)
- Webhook payload missing `repository` field (should fall back to local repo)
- Multiple concurrent workflows targeting the same external repo (worktrees provide isolation)

## Acceptance Criteria
1. When a webhook fires for an issue on repo `owner/external-repo`, ADW clones it into `~/.adw/repos/owner/external-repo/` (or the configured `TARGET_REPOS_DIR`)
2. ADW creates worktrees within the external repo workspace, not in the ADW repo
3. Claude Code agents are spawned with `cwd` pointing to the target repo workspace
4. All ADW state (logs, agents, specs) remains in the ADW repository
5. GitHub API calls (issues, PRs, comments) target the correct external repository
6. Existing behavior is preserved when no `--target-repo` argument is provided (backward compatibility)
7. All existing tests pass without modification
8. New unit tests cover the `targetRepoManager` module and argument parsing

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `npm run lint` - Run linter to check for code quality issues
- `npm run build` - Build the application to verify no build errors
- `npm test` - Run tests to validate the feature works with zero regressions

## Notes
- IMPORTANT: strictly adhere to the coding guidelines in `/guidelines`. If necessary, refactor existing code to meet the coding guidelines as part of implementing the feature.
- Token reporting/costing is explicitly out of scope per the issue: "Token reporting will be tackled in a future issue."
- The `TARGET_REPOS_DIR` defaults to `~/.adw/repos/` to keep external repo clones outside the ADW repo entirely.
- All GitHub API functions maintain backward compatibility — the `repoInfo` parameter is optional and defaults to reading from the local git remote.
- The cron trigger currently reads repo info from the local git remote. For true multi-repo support via cron, a future enhancement could configure multiple repo URLs. This feature focuses on webhook-driven multi-repo support.
- Worktree creation in external repos uses the same `git worktree` mechanism but rooted in the cloned workspace instead of the ADW repo.
- Consider that the external repo may not have a `.claude/` directory or ADW-specific commands — the Claude agents will still work because they receive prompts via stdin/CLI args, not from the working directory's `.claude/commands/`.
