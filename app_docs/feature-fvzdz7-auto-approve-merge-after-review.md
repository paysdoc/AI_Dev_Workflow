# Auto-approve and Merge After Review Phase

**ADW ID:** fvzdz7-auto-approve-and-mer
**Date:** 2026-03-21
**Specification:** specs/issue-258-adw-fvzdz7-auto-approve-and-mer-sdlc_planner-auto-approve-merge-after-review.md

## Overview

Adds an `executeAutoMergePhase` that runs as the final phase in all three review-capable orchestrators (`adwPlanBuildReview`, `adwPlanBuildTestReview`, `adwSdlc`). After the internal review passes, the phase approves the PR (using the personal identity when a GitHub App is configured) and merges it automatically — eliminating manual approval for routine pipeline runs. Merge failures are non-fatal: a comment is posted on the PR and the workflow completes successfully.

## What Was Built

- `approvePR()` function in `prApi.ts` — approves a PR using the personal `gh auth login` identity by temporarily unsetting `GH_TOKEN`
- `mergeWithConflictResolution()` exported from `autoMergeHandler.ts` — extracted shared retry loop used by both the webhook handler and the new phase
- `adws/phases/autoMergePhase.ts` — new phase implementing `executeAutoMergePhase`
- Wired into `adwPlanBuildReview.tsx`, `adwPlanBuildTestReview.tsx`, and `adwSdlc.tsx` as the last phase before `completeWorkflow()`
- BDD feature file `features/auto_approve_merge_after_review.feature` covering the new behaviour

## Technical Implementation

### Files Modified

- `adws/github/prApi.ts`: Added `approvePR(prNumber, repoInfo)` — temporarily deletes `GH_TOKEN`, calls `gh pr review --approve`, restores token in `finally`
- `adws/github/githubApi.ts`: Re-exports `approvePR`
- `adws/github/index.ts`: Re-exports `approvePR` and `isGitHubAppConfigured`
- `adws/triggers/autoMergeHandler.ts`: Extracted inline retry loop into exported `mergeWithConflictResolution()`; refactored `handleApprovedReview` to call it
- `adws/phases/autoMergePhase.ts`: New file — `executeAutoMergePhase` orchestrates approval + merge
- `adws/phases/index.ts`: Exports `executeAutoMergePhase`
- `adws/workflowPhases.ts`: Re-exports `executeAutoMergePhase`
- `adws/adwPlanBuildReview.tsx`: Wires in auto-merge phase after PR phase
- `adws/adwPlanBuildTestReview.tsx`: Wires in auto-merge phase after PR phase
- `adws/adwSdlc.tsx`: Wires in auto-merge phase after KPI phase

### Key Changes

- **Identity swap for GitHub App repos**: `approvePR` saves `GH_TOKEN`, deletes it so `gh` uses the personal token, then restores it in `finally` — prevents self-approval by the bot
- **Shared merge retry loop**: `mergeWithConflictResolution` encapsulates conflict detection → `/resolve_conflict` agent → push → `gh pr merge`, up to `MAX_AUTO_MERGE_ATTEMPTS` retries; stops early on non-conflict errors
- **Non-fatal failure model**: If merge exhausts all retries, a failure comment is posted on the PR but `executeAutoMergePhase` returns normally — workflow always completes
- **No-op on missing context**: Phase returns empty cost records immediately when `ctx.prUrl` or repo context is absent (e.g., PR phase was skipped)
- **Webhook race condition is harmless**: If the webhook auto-merge handler fires concurrently, the second `gh pr merge` call fails because the PR is already merged — no guard needed

## How to Use

The phase runs automatically as the last step in supported orchestrators. No manual action is required after the review phase passes.

For repos **with a GitHub App configured** (`GH_TOKEN` env var set to app token):
1. The review phase completes with no blockers
2. `executeAutoMergePhase` approves the PR using the personal `gh auth login` identity
3. The PR is merged with `gh pr merge --merge`

For repos **without a GitHub App** (PR authored by personal account):
1. Approval is skipped (cannot self-approve)
2. The PR is merged directly with `gh pr merge --merge`

If merge fails after all retries, a comment like `## Auto-merge failed for PR #N` is posted on the PR with the last error message.

## Configuration

No new configuration required. Behavior is controlled by:

- `GH_TOKEN` env var — if set, the phase assumes a GitHub App authored the PR and uses the personal identity for approval
- `MAX_AUTO_MERGE_ATTEMPTS` (from `adws/core`) — number of conflict-resolution retries before giving up

## Testing

Run the BDD feature file:

```bash
bunx cucumber-js features/auto_approve_merge_after_review.feature
```

Run type checks and lint:

```bash
bun run lint
bun run build
bunx tsc --noEmit
bunx tsc --noEmit -p adws/tsconfig.json
```

## Notes

- `mergeWithConflictResolution` is now shared between the webhook handler (`handleApprovedReview`) and the phase — keep both call sites in sync if the signature changes
- The auto-merge phase produces no LLM token cost itself (`emptyModelUsageMap()`); conflict resolution tokens from the `/resolve_conflict` agent are not attributed to this phase
- `incomingBranch` passed to `/resolve_conflict` is the **base** branch (e.g. `main`), because base-branch changes are being merged into the PR branch
