# Feature: Migrate Workflow Phases to Consume RepoContext

## Metadata
issueNumber: `117`
adwId: `1773131362073-k74uox`
issueJson: `{"number":117,"title":"Refactor workflow phases to consume RepoContext","body":"## Summary\nUpdate all workflow phases to receive and use `RepoContext` instead of directly calling GitHub-specific functions. This is the core migration that threads the provider abstraction through the entire workflow.\n\n## Dependencies\n- #116 — RepoContext factory must exist with working providers\n\n## User Story\nAs a developer, I want workflow phases to be platform-agnostic so that switching to a different issue tracker or code host requires no changes to phase logic.\n\n## Acceptance Criteria\n\n### Update `WorkflowConfig`\n- Add `repoContext: RepoContext` field to `WorkflowConfig` (in `adws/phases/workflowInit.ts` or equivalent)\n- During transition, keep existing `repoInfo` field as deprecated — both are populated\n- `initializeWorkflow()` creates a `RepoContext` via the factory and stores it in config\n\n### Migrate each phase\nFor each phase file, replace direct GitHub API calls with `RepoContext` provider methods.\n\n### Comment formatting stays shared\n- `formatWorkflowComment()` and `formatPRReviewWorkflowComment()` remain as shared utility functions — they produce markdown strings\n- Only the delivery mechanism (posting) goes through providers\n\n### Recovery state detection\n- `detectRecoveryState()` currently parses issue comments — it should use `repoContext.issueTracker.fetchComments()` to retrieve them, then parse with the existing shared utilities\n\n### Tests\n- Update existing phase tests to mock `RepoContext` providers instead of individual GitHub functions\n- Verify each phase calls the correct provider methods\n\n## Notes\n- This is the largest single change. Consider splitting into sub-PRs per phase if the diff gets too large.\n- Git operations (branch, commit, push, worktree) continue to use `repoContext.cwd` directly.\n- Workflow comment formatting is platform-agnostic markdown.","state":"OPEN","author":"paysdoc","labels":["enhancement"],"createdAt":"2026-03-09T15:18:35Z","comments":[],"actionableComment":null}`

## Feature Description
Refactor all workflow phases (`planPhase`, `buildPhase`, `testPhase`, `prPhase`, `prReviewPhase`, `documentPhase`, `workflowInit`, `workflowCompletion`, and `prReviewCompletion`) to receive and use the `RepoContext` provider abstraction instead of directly calling GitHub-specific functions. This is the core migration that threads platform-agnostic provider interfaces through the entire workflow, enabling future support for GitLab, Bitbucket, Jira, Linear, and other platforms without changing phase logic.

Currently, every phase imports functions like `postWorkflowComment`, `moveIssueToStatus`, `fetchGitHubIssue`, `getDefaultBranch`, `fetchPRDetails`, `getUnaddressedComments`, and `postPRWorkflowComment` from the `../github` barrel. These are tightly coupled to GitHub's API. The `RepoContext` (created by `createRepoContext()` from `adws/providers/repoContext.ts`) already provides `issueTracker: IssueTracker` and `codeHost: CodeHost` interfaces that wrap these same operations behind platform-agnostic methods.

The migration pattern is: keep the **formatting** functions (`formatWorkflowComment`, `formatPRReviewWorkflowComment`) as shared utilities (they produce markdown strings), but route the **posting/delivery** through `repoContext.issueTracker.commentOnIssue()` and `repoContext.codeHost.commentOnMergeRequest()`. Similarly, `moveIssueToStatus()` becomes `repoContext.issueTracker.moveToStatus()`, `fetchGitHubIssue()` becomes `repoContext.issueTracker.fetchIssue()`, and so on.

## User Story
As a developer,
I want workflow phases to be platform-agnostic,
So that switching to a different issue tracker or code host requires no changes to phase logic.

## Problem Statement
All workflow phases directly import and call GitHub-specific functions (`postWorkflowComment`, `moveIssueToStatus`, `fetchGitHubIssue`, `getDefaultBranch`, `fetchPRDetails`, `getUnaddressedComments`, `postPRWorkflowComment`) from the `adws/github` module. This tightly couples the workflow orchestration logic to GitHub, making it impossible to support other platforms (GitLab, Bitbucket, Jira, Linear) without rewriting every phase. The `RepoContext` abstraction layer (issue #116) already exists with `IssueTracker` and `CodeHost` interfaces, but no phase consumes it yet.

## Solution Statement
Add a `repoContext: RepoContext` field to `WorkflowConfig` and `PRReviewWorkflowConfig`. Create the `RepoContext` at workflow entry points (`initializeWorkflow()` and `initializePRReviewWorkflow()`) via the factory. Migrate each phase to use `repoContext.issueTracker.*` and `repoContext.codeHost.*` methods instead of direct GitHub imports. During the transition, keep the existing `repoInfo` field populated alongside `repoContext` for backward compatibility. Update all phase tests to mock `RepoContext` providers.

## Relevant Files
Use these files to implement the feature:

- `adws/README.md` — Conditional doc: understand ADW architecture and workflow phases
- `app_docs/feature-add-issue-comments-f-6vrgn2-review-issue-comments.md` — Conditional doc: understand workflow comment formatting/posting patterns
- `guidelines/coding_guidelines.md` — Must adhere to coding guidelines (immutability, modularity, type safety, testing)
- `adws/providers/types.ts` — Defines `RepoContext`, `IssueTracker`, `CodeHost`, `WorkItem`, `WorkItemComment`, `MergeRequest`, `ReviewComment`, `CreateMROptions` interfaces. Core reference for the target API.
- `adws/providers/repoContext.ts` — `createRepoContext()` factory, `RepoContextOptions`, `loadProviderConfig()`, validation functions. Used to construct `RepoContext` at entry points.
- `adws/providers/github/githubIssueTracker.ts` — GitHub implementation of `IssueTracker`. Reference for understanding method signatures and return types.
- `adws/providers/github/githubCodeHost.ts` — GitHub implementation of `CodeHost`. Reference for understanding method signatures and return types.
- `adws/providers/github/mappers.ts` — Mappers between GitHub types and provider types (`mapGitHubIssueToWorkItem`, etc.). May need new mappers or inverse mappers.
- `adws/phases/workflowInit.ts` — `WorkflowConfig` interface and `initializeWorkflow()`. Entry point for issue workflows; needs `repoContext` field and factory call. Currently calls `fetchGitHubIssue`, `getDefaultBranch`, `postWorkflowComment`, `detectRecoveryState`.
- `adws/phases/planPhase.ts` — `executePlanPhase()`. Calls `moveIssueToStatus`, `postWorkflowComment`.
- `adws/phases/buildPhase.ts` — `executeBuildPhase()`. Calls `postWorkflowComment`.
- `adws/phases/testPhase.ts` — `executeTestPhase()`. Calls `postWorkflowComment`.
- `adws/phases/prPhase.ts` — `executePRPhase()`. Calls `postWorkflowComment`.
- `adws/phases/documentPhase.ts` — `executeDocumentPhase()`. Calls `postWorkflowComment`.
- `adws/phases/workflowCompletion.ts` — `completeWorkflow()`, `executeReviewPhase()`, `handleWorkflowError()`. Calls `postWorkflowComment`, `moveIssueToStatus`.
- `adws/phases/prReviewPhase.ts` — `PRReviewWorkflowConfig` interface, `initializePRReviewWorkflow()`, `executePRReviewPlanPhase()`, `executePRReviewBuildPhase()`. Calls `fetchPRDetails`, `getUnaddressedComments`, `postPRWorkflowComment`.
- `adws/phases/prReviewCompletion.ts` — `executePRReviewTestPhase()`, `completePRReviewWorkflow()`, `handlePRReviewWorkflowError()`. Calls `postPRWorkflowComment`, `moveIssueToStatus`, `pushBranch`.
- `adws/phases/workflowLifecycle.ts` — Re-export barrel for backward compatibility. May need to re-export `RepoContext` type.
- `adws/github/workflowCommentsIssue.ts` — `formatWorkflowComment()`, `postWorkflowComment()`, `WorkflowContext`. Formatting stays; posting logic is what migrates.
- `adws/github/workflowCommentsPR.ts` — `formatPRReviewWorkflowComment()`, `postPRWorkflowComment()`, `PRReviewWorkflowContext`. Formatting stays; posting logic is what migrates.
- `adws/github/workflowCommentsBase.ts` — `detectRecoveryState()` and comment parsing utilities. Recovery detection needs to accept `WorkItemComment[]`.
- `adws/github/workflowComments.ts` — Re-export barrel for workflow comments.
- `adws/github/prCommentDetector.ts` — `getUnaddressedComments()`, `getLastAdwCommitTimestamp()`. PR review init needs to use `repoContext.codeHost.fetchReviewComments()` instead.
- `adws/phases/__tests__/planPhase.test.ts` — Existing plan phase tests. Currently mocks `../../github` with `postWorkflowComment`, `moveIssueToStatus`.
- `adws/phases/__tests__/buildPhase.test.ts` — Existing build phase tests. Currently mocks `../../github` with `postWorkflowComment`.
- `adws/phases/__tests__/testPhase.test.ts` — Existing test phase tests. Currently mocks `../../github` with `postWorkflowComment`.
- `adws/phases/__tests__/documentPhase.test.ts` — Existing document phase tests. Currently mocks `../../github` with `postWorkflowComment`.
- `adws/providers/github/__tests__/githubIssueTracker.test.ts` — Existing provider tests. Reference for mocking patterns.
- `adws/providers/github/__tests__/githubCodeHost.test.ts` — Existing provider tests. Reference for mocking patterns.

### New Files
- `adws/phases/__tests__/workflowCompletion.test.ts` — New tests for `completeWorkflow`, `executeReviewPhase`, `handleWorkflowError` with RepoContext mocking.
- `adws/phases/__tests__/prPhase.test.ts` — New tests for `executePRPhase` with RepoContext mocking.
- `adws/phases/__tests__/prReviewPhase.test.ts` — New tests for PR review initialization and phases with RepoContext mocking.
- `adws/phases/__tests__/prReviewCompletion.test.ts` — New tests for PR review completion phases with RepoContext mocking.

## Implementation Plan

### Phase 1: Foundation
1. Add `repoContext?: RepoContext` field to the `WorkflowConfig` interface in `adws/phases/workflowInit.ts`. Make it optional during transition so existing code continues to work.
2. Add `repoContext?: RepoContext` field to the `PRReviewWorkflowConfig` interface in `adws/phases/prReviewPhase.ts`.
3. Create a shared test helper function for building mock `RepoContext` objects with vi.fn() stubs for all `IssueTracker` and `CodeHost` methods. This avoids duplication across all test files.
4. Update `initializeWorkflow()` to create a `RepoContext` via `createRepoContext()` and store it in the returned config alongside the existing `repoInfo`.
5. Update `initializePRReviewWorkflow()` similarly.

### Phase 2: Core Implementation
Migrate each phase file one by one, following this pattern for each:
1. Import `formatWorkflowComment` (or `formatPRReviewWorkflowComment`) for formatting.
2. Replace `postWorkflowComment(issueNumber, stage, ctx, repoInfo)` with:
   ```typescript
   try {
     const comment = formatWorkflowComment(stage, ctx);
     config.repoContext!.issueTracker.commentOnIssue(issueNumber, comment);
   } catch (error) {
     log(`Failed to post workflow comment for stage '${stage}': ${error}`, 'error');
   }
   ```
   Or extract a shared helper to avoid repeating the try/catch pattern.
3. Replace `moveIssueToStatus(issueNumber, status, repoInfo)` with `config.repoContext!.issueTracker.moveToStatus(issueNumber, status)`.
4. For PR review phases, replace `postPRWorkflowComment(prNumber, stage, ctx, repoInfo)` with `formatPRReviewWorkflowComment(stage, ctx)` + `config.repoContext!.codeHost.commentOnMergeRequest(prNumber, comment)`.
5. For `workflowInit.ts`: replace `fetchGitHubIssue()` with `repoContext.issueTracker.fetchIssue()` and `getDefaultBranch()` with `repoContext.codeHost.getDefaultBranch()`.
6. For `prReviewPhase.ts`: replace `fetchPRDetails()` with `repoContext.codeHost.fetchMergeRequest()` and `getUnaddressedComments()` with a combination of `repoContext.codeHost.fetchReviewComments()` and local filtering logic.
7. Remove direct `../github` imports (e.g., `postWorkflowComment`, `moveIssueToStatus`, `fetchGitHubIssue`, `fetchPRDetails`, `getUnaddressedComments`, `postPRWorkflowComment`) from phase files as they are migrated.

### Phase 3: Integration
1. Update all existing phase tests (`planPhase.test.ts`, `buildPhase.test.ts`, `testPhase.test.ts`, `documentPhase.test.ts`) to provide a mock `RepoContext` on the config and verify provider methods are called correctly.
2. Create new test files for phases that currently lack tests (`workflowCompletion.test.ts`, `prPhase.test.ts`, `prReviewPhase.test.ts`, `prReviewCompletion.test.ts`).
3. Verify the `workflowLifecycle.ts` barrel re-exports `RepoContext` type if needed by consumers.
4. Run full test suite and type-check to ensure zero regressions.

## Step by Step Tasks

### Step 1: Create shared test helper for mock RepoContext
- Create a `makeRepoContext()` helper function that returns a mock `RepoContext` with all `IssueTracker` and `CodeHost` methods stubbed via `vi.fn()`.
- Place it in a shared test utility file: `adws/phases/__tests__/helpers/makeRepoContext.ts`.
- This helper will be imported by every phase test file.
- The mock `issueTracker` should have: `fetchIssue`, `commentOnIssue`, `deleteComment`, `closeIssue`, `getIssueState`, `fetchComments`, `moveToStatus` — all as `vi.fn()`.
- The mock `codeHost` should have: `getDefaultBranch`, `createMergeRequest`, `fetchMergeRequest`, `commentOnMergeRequest`, `fetchReviewComments`, `listOpenMergeRequests`, `getRepoIdentifier` — all as `vi.fn()`.
- Include `cwd: '/mock/worktree'` and a default `repoId: { owner: 'test-owner', repo: 'test-repo', platform: Platform.GitHub }`.

### Step 2: Add `repoContext` field to `WorkflowConfig`
- In `adws/phases/workflowInit.ts`, import `RepoContext` from `../providers/types`.
- Add `repoContext?: RepoContext` to the `WorkflowConfig` interface (optional during transition).
- Add a JSDoc `@deprecated` tag to the existing `repoInfo?: RepoInfo` field.

### Step 3: Add `repoContext` field to `PRReviewWorkflowConfig`
- In `adws/phases/prReviewPhase.ts`, import `RepoContext` from `../providers/types`.
- Add `repoContext?: RepoContext` to the `PRReviewWorkflowConfig` interface (optional during transition).
- Add a JSDoc `@deprecated` tag to the existing `repoInfo?: RepoInfo` field.

### Step 4: Create a shared phase comment posting helper
- To avoid repeating the try/catch + format + post pattern in every phase, create a thin helper in `adws/phases/phaseCommentHelpers.ts`:
  - `postIssueStageComment(repoContext: RepoContext, issueNumber: number, stage: WorkflowStage, ctx: WorkflowContext): void` — formats via `formatWorkflowComment` then posts via `repoContext.issueTracker.commentOnIssue()`, wrapped in try/catch with logging.
  - `postPRStageComment(repoContext: RepoContext, prNumber: number, stage: PRReviewWorkflowStage, ctx: PRReviewWorkflowContext): void` — formats via `formatPRReviewWorkflowComment` then posts via `repoContext.codeHost.commentOnMergeRequest()`, wrapped in try/catch with logging.
- Write unit tests for these helpers in `adws/phases/__tests__/phaseCommentHelpers.test.ts`.

### Step 5: Wire `RepoContext` creation in `initializeWorkflow()`
- In `adws/phases/workflowInit.ts`, import `createRepoContext` from `../providers/repoContext` and `Platform` from `../providers/types`.
- After resolving `repoInfo` and `targetRepoWorkspacePath`, create the `RepoContext`:
  ```typescript
  const repoContext = createRepoContext({
    repoId: {
      owner: repoInfo?.owner ?? /* fallback to parsing GITHUB_REPO_URL */,
      repo: repoInfo?.repo ?? /* fallback */,
      platform: Platform.GitHub,
    },
    cwd: targetRepoWorkspacePath || process.cwd(),
  });
  ```
- Store `repoContext` in the returned `WorkflowConfig`.
- Keep the existing `repoInfo` field populated for backward compatibility.
- Note: The factory does git remote validation, so handle the case where `initializeWorkflow` is called before the worktree is created. Create `RepoContext` after the worktree is set up, using `worktreePath` as cwd.

### Step 6: Wire `RepoContext` creation in `initializePRReviewWorkflow()`
- Similar to step 5 but for `adws/phases/prReviewPhase.ts`.
- Create `RepoContext` after worktree setup.
- Store in `PRReviewWorkflowConfig`.

### Step 7: Migrate `workflowInit.ts` phase calls
- Replace `fetchGitHubIssue(issueNumber, repoInfo)` with `repoContext.issueTracker.fetchIssue(issueNumber)`.
  - **Important**: `fetchIssue` returns `WorkItem`, not `GitHubIssue`. Since `WorkflowConfig.issue` is typed as `GitHubIssue`, and many downstream consumers expect `GitHubIssue`, during transition keep fetching via the old function but also store the `WorkItem` if needed. Alternatively, create a mapper from `WorkItem` back to `GitHubIssue` shape for transition compatibility.
  - Simplest approach: Keep the `fetchGitHubIssue` call for now (the `repoContext` factory already validates the repo). Migrate `fetchGitHubIssue` to use `repoContext` in a follow-up issue when the `WorkItem` type is adopted throughout.
- Replace `getDefaultBranch(defaultBranchCwd)` with `repoContext.codeHost.getDefaultBranch()`.
- Replace `postWorkflowComment(issueNumber, 'resuming'|'starting', ctx, repoInfo)` calls with the `postIssueStageComment` helper.
- For `detectRecoveryState(issue.comments)`: This currently accepts `GitHubComment[]`. During transition, keep using the existing function (it operates on the `issue` object which is still fetched). Migration of `detectRecoveryState` to use `repoContext.issueTracker.fetchComments()` can be a stretch goal or follow-up.

### Step 8: Migrate `planPhase.ts`
- Import `postIssueStageComment` from `./phaseCommentHelpers` and `formatWorkflowComment` from `../github`.
- Replace `moveIssueToStatus(issueNumber, 'In Progress', repoInfo)` with `config.repoContext!.issueTracker.moveToStatus(issueNumber, 'In Progress')`.
- Replace all `postWorkflowComment(issueNumber, stage, ctx, repoInfo)` calls with `postIssueStageComment(config.repoContext!, issueNumber, stage, ctx)`.
- Remove `postWorkflowComment` and `moveIssueToStatus` imports from `../github`.
- Update `adws/phases/__tests__/planPhase.test.ts`:
  - Import `makeRepoContext` helper.
  - Add `repoContext: makeRepoContext()` to `makeConfig()`.
  - Replace assertions on `postWorkflowComment` and `moveIssueToStatus` mocks with assertions on `repoContext.issueTracker.commentOnIssue` and `repoContext.issueTracker.moveToStatus`.
  - Remove the `vi.mock('../../github')` for `postWorkflowComment` and `moveIssueToStatus`.

### Step 9: Migrate `buildPhase.ts`
- Replace all `postWorkflowComment(issueNumber, stage, ctx, repoInfo)` calls with `postIssueStageComment(config.repoContext!, issueNumber, stage, ctx)`.
- Remove `postWorkflowComment` import from `../github`.
- Update `adws/phases/__tests__/buildPhase.test.ts` similarly to step 8.

### Step 10: Migrate `testPhase.ts`
- Replace all `postWorkflowComment(issueNumber, stage, ctx, repoInfo)` calls with `postIssueStageComment(config.repoContext!, issueNumber, stage, ctx)`.
- Remove `postWorkflowComment` import from `../github`.
- Update `adws/phases/__tests__/testPhase.test.ts` similarly.

### Step 11: Migrate `prPhase.ts`
- Replace `postWorkflowComment(issueNumber, stage, ctx, repoInfo)` calls with `postIssueStageComment(config.repoContext!, issueNumber, stage, ctx)`.
- Remove `postWorkflowComment` import from `../github`.
- Create `adws/phases/__tests__/prPhase.test.ts` with tests verifying `repoContext.issueTracker.commentOnIssue` is called for each stage.

### Step 12: Migrate `documentPhase.ts`
- Replace all `postWorkflowComment(issueNumber, stage, ctx, repoInfo)` calls with `postIssueStageComment(config.repoContext!, issueNumber, stage, ctx)`.
- Remove `postWorkflowComment` import from `../github`.
- Update `adws/phases/__tests__/documentPhase.test.ts` similarly.

### Step 13: Migrate `workflowCompletion.ts`
- Replace `postWorkflowComment(issueNumber, stage, ctx, repoInfo)` calls with `postIssueStageComment(config.repoContext!, issueNumber, stage, ctx)`.
- Replace `moveIssueToStatus(issueNumber, 'Review', repoInfo)` with `config.repoContext!.issueTracker.moveToStatus(issueNumber, 'Review')`.
- Remove `postWorkflowComment` and `moveIssueToStatus` imports from `../github`.
- Create `adws/phases/__tests__/workflowCompletion.test.ts` with tests for `completeWorkflow`, `executeReviewPhase`, and `handleWorkflowError`.

### Step 14: Migrate `prReviewPhase.ts`
- Replace `fetchPRDetails(prNumber, repoInfo)` with `config.repoContext!.codeHost.fetchMergeRequest(prNumber)` and map `MergeRequest` fields to the expected `PRDetails` shape (or adapt callers).
  - **Important**: `PRDetails` has fields like `headBranch`, `state`, `issueNumber`, `body`, `url`, `title` while `MergeRequest` has `sourceBranch`, no `state`, `linkedIssueNumber`, `body`, `url`, `title`. Need a mapper or keep `fetchPRDetails` during transition.
  - Simplest approach during transition: Keep `fetchPRDetails` for PR detail fetching (it has richer data than `MergeRequest`). Migrate only the comment posting via `repoContext`.
- Replace `getUnaddressedComments(prNumber, repoInfo)` — this is complex since it combines `fetchPRDetails`, `fetchPRReviewComments`, and `getLastAdwCommitTimestamp`. During transition, keep using `getUnaddressedComments` but ensure `repoInfo` flows from `config.repoInfo`.
- Replace all `postPRWorkflowComment(prNumber, stage, ctx, repoInfo)` calls with `postPRStageComment(config.repoContext!, prNumber, stage, ctx)`.
- Remove `postPRWorkflowComment` import from `../github`.
- Create `adws/phases/__tests__/prReviewPhase.test.ts` with tests for `initializePRReviewWorkflow`, `executePRReviewPlanPhase`, and `executePRReviewBuildPhase`.

### Step 15: Migrate `prReviewCompletion.ts`
- Replace all `postPRWorkflowComment(prNumber, stage, ctx, repoInfo)` calls with `postPRStageComment(config.repoContext!, prNumber, stage, ctx)`.
- Replace `moveIssueToStatus(config.issueNumber, 'Review', config.repoInfo)` with `config.repoContext!.issueTracker.moveToStatus(config.issueNumber, 'Review')`.
- Keep `pushBranch` and `inferIssueTypeFromBranch` as-is (git operations don't go through providers).
- Remove `postPRWorkflowComment` and `moveIssueToStatus` imports from `../github`.
- Create `adws/phases/__tests__/prReviewCompletion.test.ts`.

### Step 16: Update `workflowLifecycle.ts` barrel re-exports
- If `RepoContext` type needs to be available via the `workflowLifecycle` barrel, add it to the re-exports.
- Ensure the `phaseCommentHelpers` module is accessible from phase files.

### Step 17: Run validation commands
- Run `bunx tsc --noEmit -p adws/tsconfig.json` to verify type safety.
- Run `bun run lint` to verify code quality.
- Run `bun run test` to verify all tests pass with zero regressions.
- Run `bun run build` to verify no build errors.

## Testing Strategy

### Unit Tests
- **Phase comment helpers** (`phaseCommentHelpers.test.ts`): Test that `postIssueStageComment` calls `formatWorkflowComment` correctly and routes through `repoContext.issueTracker.commentOnIssue()`. Test that errors are caught and logged. Test `postPRStageComment` similarly for PR comments via `repoContext.codeHost.commentOnMergeRequest()`.
- **Plan phase** (`planPhase.test.ts`): Verify `repoContext.issueTracker.moveToStatus()` is called with `'In Progress'`. Verify `repoContext.issueTracker.commentOnIssue()` is called for each stage (`classified`, `branch_created`, `plan_building`, `plan_created`, `plan_committing`). Verify correct formatted comment bodies.
- **Build phase** (`buildPhase.test.ts`): Verify `repoContext.issueTracker.commentOnIssue()` is called for `implementing`, `implemented`, `build_progress`, `token_limit_recovery`, `implementation_committing` stages.
- **Test phase** (`testPhase.test.ts`): Verify `repoContext.issueTracker.commentOnIssue()` is called for `error` stage on test failure.
- **PR phase** (`prPhase.test.ts`): Verify `repoContext.issueTracker.commentOnIssue()` is called for `pr_creating` and `pr_created` stages.
- **Document phase** (`documentPhase.test.ts`): Verify `repoContext.issueTracker.commentOnIssue()` is called for `document_running`, `document_completed`, `document_failed` stages.
- **Workflow completion** (`workflowCompletion.test.ts`): Verify `repoContext.issueTracker.commentOnIssue()` is called for `completed` and `error` stages. Verify `repoContext.issueTracker.moveToStatus()` is called with `'Review'`.
- **PR review phases** (`prReviewPhase.test.ts`, `prReviewCompletion.test.ts`): Verify `repoContext.codeHost.commentOnMergeRequest()` is called for all PR review stages. Verify `repoContext.issueTracker.moveToStatus()` is called on completion.

### Edge Cases
- **Missing `repoContext`**: Since `repoContext` is optional during transition, phases should handle the case where it's undefined (fall back to direct GitHub calls or throw a clear error). Test this case.
- **Provider method throws**: Verify that errors from `repoContext.issueTracker.commentOnIssue()` are caught and logged (not propagated to crash the workflow).
- **Recovery mode**: Verify that `initializeWorkflow` in recovery mode still posts the resuming comment via `repoContext`.
- **Token limit continuation in build phase**: Verify that multiple `build_progress` and `token_limit_recovery` comments route through `repoContext`.
- **PR review with no unaddressed comments**: Verify early exit still works when `repoContext` is available.
- **External target repo**: Verify that when `targetRepo` is provided, the `RepoContext` is created with the correct owner/repo from the target (not the ADW repo).

## Acceptance Criteria
- `WorkflowConfig` has a `repoContext?: RepoContext` field, populated by `initializeWorkflow()`.
- `PRReviewWorkflowConfig` has a `repoContext?: RepoContext` field, populated by `initializePRReviewWorkflow()`.
- All phase files (`planPhase`, `buildPhase`, `testPhase`, `prPhase`, `documentPhase`, `workflowCompletion`) use `repoContext.issueTracker.commentOnIssue()` instead of `postWorkflowComment()` for posting issue comments.
- All phase files that call `moveIssueToStatus()` use `repoContext.issueTracker.moveToStatus()` instead.
- PR review phase files (`prReviewPhase`, `prReviewCompletion`) use `repoContext.codeHost.commentOnMergeRequest()` instead of `postPRWorkflowComment()` for posting PR comments.
- Comment formatting functions (`formatWorkflowComment`, `formatPRReviewWorkflowComment`) remain as shared utilities and are not duplicated.
- All existing phase tests pass after being updated to mock `RepoContext` providers.
- New test files exist for phases that previously had no tests (`prPhase`, `workflowCompletion`, `prReviewPhase`, `prReviewCompletion`).
- `bunx tsc --noEmit -p adws/tsconfig.json` passes with no type errors.
- `bun run test` passes with zero regressions.
- `bun run lint` passes.
- `bun run build` passes.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bunx tsc --noEmit` — Type-check the main project.
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type-check the ADW scripts specifically.
- `bun run lint` — Run linter to check for code quality issues.
- `bun run test` — Run all tests to validate the migration with zero regressions.
- `bun run build` — Build the application to verify no build errors.

## Notes
- **Guidelines compliance**: Strictly follow `guidelines/coding_guidelines.md` — immutability (RepoContext is frozen), modularity (single-responsibility phase comment helpers), type safety (typed RepoContext on config), testing (unit tests for all migrated phases).
- **Transition strategy**: During this migration, `repoContext` is optional on configs and the old `repoInfo` field is kept. A follow-up issue should make `repoContext` required and remove `repoInfo`.
- **`fetchGitHubIssue` and `fetchPRDetails` return types**: These return `GitHubIssue` and `PRDetails` respectively, which have richer data than the provider-agnostic `WorkItem` and `MergeRequest`. Full migration of these calls requires adopting `WorkItem`/`MergeRequest` throughout the workflow (including `WorkflowConfig.issue` type). This is deferred to avoid a massive type change in this PR. The immediate migration focuses on **comment posting** and **status updates** which are the most numerous and straightforward.
- **`detectRecoveryState`**: Currently takes `GitHubComment[]`. Full migration to `WorkItemComment[]` is a stretch goal for this PR. The function primarily reads `body` strings, so a follow-up can parameterize it to accept `{ body: string }[]`.
- **`getUnaddressedComments`**: This function combines PR details fetching, review comment fetching, git commit timestamp detection, and filtering. Full migration to provider methods is complex. For this PR, migrate only the comment posting from `prReviewPhase` and keep `getUnaddressedComments` using the `repoInfo` path.
- **Git operations**: `pushBranch`, `ensureWorktree`, `checkoutDefaultBranch`, etc. remain as-is — they're already VCS-agnostic (they use git CLI directly).
- **No new libraries needed**.
