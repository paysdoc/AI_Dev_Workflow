# Migrate Workflow Phases to RepoContext

**ADW ID:** 1773312009789-vruh95
**Date:** 2026-03-12
**Specification:** specs/issue-117-adw-1773131362073-k74uox-sdlc_planner-migrate-phases-to-repo-context.md

## Overview

This feature threads the `RepoContext` provider abstraction through all workflow phases, replacing direct GitHub API calls (`postWorkflowComment`, `moveIssueToStatus`, `postPRWorkflowComment`, `getDefaultBranch`) with platform-agnostic provider methods. The migration decouples phase orchestration logic from GitHub specifics, enabling future support for GitLab, Bitbucket, Jira, Linear, and other platforms without changing phase logic.

## What Was Built

- `phaseCommentHelpers.ts` — shared helper module with `postIssueStageComment` and `postPRStageComment` that format and post comments via `RepoContext` providers
- `repoContext` field added to `WorkflowConfig` and `PRReviewWorkflowConfig` interfaces (optional during transition)
- `RepoContext` creation wired into `initializeWorkflow()` and `initializePRReviewWorkflow()` via `createRepoContext()`
- All phase files migrated to use `repoContext.issueTracker.commentOnIssue()` / `repoContext.codeHost.commentOnMergeRequest()` instead of `postWorkflowComment` / `postPRWorkflowComment`
- `moveIssueToStatus()` calls replaced with `repoContext.issueTracker.moveToStatus()`
- `getDefaultBranch()` replaced with `repoContext.codeHost.getDefaultBranch()` in `workflowInit.ts`
- Shared test helper `makeRepoContext()` for building mock `RepoContext` objects with `vi.fn()` stubs
- New test files: `prPhase.test.ts`, `prReviewPhase.test.ts`, `workflowCompletion.test.ts`, `phaseCommentHelpers.test.ts`

## Technical Implementation

### Files Modified

- `adws/phases/phaseCommentHelpers.ts`: New module — `postIssueStageComment` and `postPRStageComment` helpers wrapping format + post in try/catch
- `adws/phases/workflowInit.ts`: Added `repoContext?: RepoContext` to `WorkflowConfig`; `initializeWorkflow()` creates `RepoContext` via factory; replaces `postWorkflowComment` with `postIssueStageComment`; replaces `getDefaultBranch()` with `repoContext.codeHost.getDefaultBranch()`
- `adws/phases/planPhase.ts`: Replaced `postWorkflowComment` + `moveIssueToStatus` with `postIssueStageComment` + `repoContext.issueTracker.moveToStatus()`
- `adws/phases/buildPhase.ts`: Replaced `postWorkflowComment` with `postIssueStageComment`
- `adws/phases/testPhase.ts`: Replaced `postWorkflowComment` with `postIssueStageComment`
- `adws/phases/prPhase.ts`: Replaced `postWorkflowComment` with `postIssueStageComment`
- `adws/phases/documentPhase.ts`: Replaced `postWorkflowComment` with `postIssueStageComment`
- `adws/phases/workflowCompletion.ts`: Replaced `postWorkflowComment` + `moveIssueToStatus` with provider calls
- `adws/phases/prReviewPhase.ts`: Added `repoContext?: RepoContext` to `PRReviewWorkflowConfig`; `initializePRReviewWorkflow()` creates `RepoContext`; replaces `postPRWorkflowComment` with `postPRStageComment`
- `adws/phases/prReviewCompletion.ts`: Replaced `postPRWorkflowComment` + `moveIssueToStatus` with `postPRStageComment` + provider calls
- `adws/phases/workflowLifecycle.ts`: Added `RepoContext` re-export for downstream consumers
- `adws/phases/__tests__/helpers/makeRepoContext.ts`: New shared test helper with fully-stubbed `RepoContext`
- `adws/github/prCommentDetector.ts`: Minor refactor for alignment with provider-based flow
- `adws/providers/repoContext.ts`: Streamlined after `loadProviderConfig` was moved to `core`
- `adws/core/projectConfig.ts`: Removed `loadProviderConfig` (moved responsibilities)

### Key Changes

- **Transition strategy**: `repoContext` is optional on both config interfaces. Phase calls are guarded with `if (repoContext)` to preserve backward compatibility during the migration window.
- **Shared comment helpers**: `postIssueStageComment` and `postPRStageComment` in `phaseCommentHelpers.ts` centralize the format→post→catch pattern, preventing duplication across all phase files.
- **Factory call placement**: `createRepoContext()` is called after the worktree is set up so the git remote validation has a valid `cwd`. Falls back gracefully (logs warning) if creation fails.
- **Formatting stays GitHub-agnostic**: `formatWorkflowComment` and `formatPRReviewWorkflowComment` remain as shared markdown formatters; only the delivery mechanism moves to providers.
- **Deferred migrations**: `fetchGitHubIssue`, `fetchPRDetails`, and `detectRecoveryState` are intentionally not migrated in this PR — they return richer GitHub-specific types (`GitHubIssue`, `PRDetails`) that require broader type changes. A follow-up issue should adopt `WorkItem`/`MergeRequest` throughout.

## How to Use

The migration is transparent to workflow entry-point callers. `WorkflowConfig` and `PRReviewWorkflowConfig` now carry a `repoContext` field that is automatically populated by the initializer functions:

1. `initializeWorkflow()` creates and attaches `RepoContext` to the returned `WorkflowConfig`.
2. `initializePRReviewWorkflow()` creates and attaches `RepoContext` to `PRReviewWorkflowConfig`.
3. Each phase reads `config.repoContext` and routes comment posting and status updates through the provider interfaces.

To post a comment from a new phase:
```typescript
import { postIssueStageComment } from './phaseCommentHelpers';

if (config.repoContext) {
  postIssueStageComment(config.repoContext, issueNumber, 'my_stage', ctx);
}
```

To post a PR comment from a new PR review phase:
```typescript
import { postPRStageComment } from './phaseCommentHelpers';

if (config.repoContext) {
  postPRStageComment(config.repoContext, prNumber, 'pr_review_stage', ctx);
}
```

## Configuration

No new configuration required. `RepoContext` is created from the existing `repoInfo` (owner/repo) already resolved during workflow initialization, using `Platform.GitHub`. Future platforms can be selected via `.adw/providers.md` (see the RepoContext factory documentation).

## Testing

Use the shared `makeRepoContext()` helper in phase tests:

```typescript
import { makeRepoContext } from './helpers/makeRepoContext';

const config = {
  ...otherFields,
  repoContext: makeRepoContext(),
};

// After calling the phase function, assert on provider stubs:
expect(config.repoContext.issueTracker.commentOnIssue).toHaveBeenCalledWith(
  issueNumber,
  expect.stringContaining('expected content'),
);
expect(config.repoContext.issueTracker.moveToStatus).toHaveBeenCalledWith(issueNumber, 'In Progress');
```

Run tests with: `bun run test`

## Notes

- **`repoInfo` is deprecated** on both config interfaces. It is kept populated during the transition for backward compatibility with any consumers not yet updated.
- **Follow-up work**: Make `repoContext` required and remove `repoInfo`; migrate `fetchGitHubIssue` → `repoContext.issueTracker.fetchIssue()`; migrate `fetchPRDetails` → `repoContext.codeHost.fetchMergeRequest()`; migrate `detectRecoveryState` to accept `WorkItemComment[]`.
- **Git operations** (`pushBranch`, `ensureWorktree`, `checkoutDefaultBranch`) remain unchanged — they use git CLI directly and are already VCS-agnostic.
