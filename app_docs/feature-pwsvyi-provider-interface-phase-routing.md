# Provider Interface Phase Routing

**ADW ID:** pwsvyi-refactor-provider-in
**Date:** 2026-03-30
**Specification:** specs/issue-353-adw-pwsvyi-refactor-provider-in-sdlc_planner-provider-interface-phase-routing.md

## Overview

This chore completes the provider abstraction layer for phase files by adding three missing operations to the `CodeHost` and `IssueTracker` interfaces (`approvePR`, `fetchPRDetails`, `issueHasLabel`) and routing `autoMergePhase.ts` and `prReviewPhase.ts` through `repoContext` instead of direct GitHub imports. The change eliminates the last direct `../github` operation imports from these two phase files, ensuring all GitHub-specific logic is encapsulated behind the provider layer.

## What Was Built

- `CodeHost.approvePR(prNumber)` — approve a pull request via provider (used in auto-merge flow)
- `CodeHost.fetchPRDetails(prNumber)` — fetch full PR details with state (used in PR review init)
- `IssueTracker.issueHasLabel(issueNumber, labelName)` — check if an issue has a label (used in HITL gate)
- `PullRequestDetails` interface extending `PullRequest` with a `state` field
- `ApproveResult` interface (`{ success: boolean; error?: string }`)
- `mapPRDetailsToPullRequestDetails` mapper in `mappers.ts`
- Renamed `MergeRequest` → `PullRequest`, `WorkItem` → `Issue`, `WorkItemComment` → `IssueComment`, `CreateMROptions` → `CreatePROptions` throughout the provider layer
- `autoMergePhase.ts` now routes all operations through `repoContext` with no direct `../github` operation imports
- `prReviewPhase.ts` constructs `repoContext` earlier and routes `fetchPRDetails` through the provider, recreating the context after worktree setup

## Technical Implementation

### Files Modified

- `adws/providers/types.ts`: Added `ApproveResult`, `PullRequestDetails`, `PullRequestResult` interfaces; added `approvePR`, `fetchPRDetails` to `CodeHost`; added `issueHasLabel` to `IssueTracker`; renamed `MergeRequest` → `PullRequest`, `WorkItem` → `Issue`, `WorkItemComment` → `IssueComment`, `CreateMROptions` → `CreatePROptions`
- `adws/providers/github/mappers.ts`: Added `mapPRDetailsToPullRequestDetails`; renamed all mapper functions to match new type names (`mapPRDetailsToMergeRequest` → `mapPRDetailsToPullRequest`, etc.)
- `adws/providers/github/githubCodeHost.ts`: Implemented `approvePR` and `fetchPRDetails`; renamed `ghFetchPRDetails` to avoid method name shadowing; updated `createPullRequest` to use `gh pr create` directly with temp file body
- `adws/providers/github/githubIssueTracker.ts`: Implemented `issueHasLabel` delegating to `ghIssueHasLabel` from `issueApi`
- `adws/phases/autoMergePhase.ts`: Removed `commentOnPR`, `approvePR`, `commentOnIssue`, `issueHasLabel`, `RepoInfo` imports from `../github`; all operations now go through `repoContext.codeHost.*` / `repoContext.issueTracker.*`
- `adws/phases/prReviewPhase.ts`: Moved `repoContext` construction before `fetchPRDetails`; replaced direct `fetchPRDetails` call with provider call; added worktree cwd update after worktree setup

### Key Changes

- **`autoMergePhase.ts` is now fully provider-routed**: the only remaining `../github` import is `isGitHubAppConfigured`, which is intentionally GitHub-specific
- **`PullRequestDetails` extends `PullRequest`**: adds `state` field needed by `prReviewPhase.ts` to check if the PR is closed/merged before proceeding
- **Import rename in `githubCodeHost.ts`**: `fetchPRDetails` from `prApi` is imported as `ghFetchPRDetails` to avoid shadowing the new `fetchPRDetails` method on `GitHubCodeHost`
- **`prReviewPhase.ts` falls back gracefully**: if `createRepoContext` throws, the phase falls back to the direct `fetchPRDetails` call for resilience
- **`reviewComments` set to `[]`** when mapping `PullRequestDetails` → `PRDetails` in `prReviewPhase.ts` — safe because review comments are fetched separately via `getUnaddressedComments`

## How to Use

These changes are internal to the provider layer — no public API changes for callers. Phase files (`autoMergePhase.ts`, `prReviewPhase.ts`) automatically use the provider when a `repoContext` is present:

1. **Auto-merge flow**: `executeAutoMergePhase` checks the `hitl` label via `repoContext.issueTracker.issueHasLabel`, approves via `repoContext.codeHost.approvePR`, and posts failure comments via `repoContext.codeHost.commentOnPullRequest`
2. **PR review flow**: `initializePRReviewWorkflow` creates `repoContext` early, fetches PR details via `repoContext.codeHost.fetchPRDetails`, then recreates the context with the worktree path after worktree setup

## Configuration

No new configuration required. Uses the same `repoContext` setup as the rest of the provider layer.

## Testing

```bash
bun run lint
bunx tsc --noEmit
bunx tsc --noEmit -p adws/tsconfig.json
bun run build
```

## Notes

- `getUnaddressedComments` remains a direct `../github` import in `prReviewPhase.ts` — it uses GitHub-specific `isResolved` fields on review threads and abstracting it is a separate chore
- `isGitHubAppConfigured` remains a direct import in `autoMergePhase.ts` — it is a GitHub-specific configuration gate, not a provider operation
- The `approvePR` function in `prApi.ts` handles `GH_TOKEN` unset/restore internally; the provider method simply delegates without duplicating that logic
- `PullRequestDetails` intentionally omits `reviewComments` — consumers that need review comments call `fetchReviewComments()` or `getUnaddressedComments()` separately
