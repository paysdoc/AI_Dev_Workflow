# Move PR Approval into Review Phase

**ADW ID:** zyjh0z-move-pr-approval-int
**Date:** 2026-04-17
**Specification:** specs/issue-434-adw-zyjh0z-move-pr-approval-int-sdlc_planner-move-approval-to-review-phase.md

## Overview

This fix resolves two compounding defects observed on PR #433: `approvePR` was silently failing in webhook-spawned processes (macOS Keychain inaccessible) due to a `delete process.env.GH_TOKEN` hack, and the merge gate was decorative — approval failure was non-fatal and the PR merged with zero reviews on record. The fix moves approval responsibility into `reviewPhase`, rewrites `autoMergePhase` to read approval state from GitHub as the source of truth, and hardens the system against auth retry noise and missing PAT configuration.

## What Was Built

- **PAT-swap pattern for `approvePR`**: Replaces `delete process.env.GH_TOKEN` with the proven save/set/restore pattern using `GITHUB_PAT`, making approval work in webhook-spawned processes.
- **`fetchPRApprovalState` function**: New function in `prApi.ts` that queries `gh pr view --json reviews` and returns `true` only when at least one `APPROVED` review exists.
- **`addIssueLabel` function**: New helper in `issueApi.ts` for applying labels (e.g., `hitl`) to issues.
- **Approval moved to `reviewPhase`**: On review pass, `reviewPhase` now calls `approvePR`. Failure is non-fatal to the review phase itself.
- **`autoMergePhase` rewritten**: No longer calls `approvePR`. Instead reads approval state from GitHub; blocks merge and applies `hitl` + posts a one-time comment when no `APPROVED` review exists.
- **Silent `hitl` early-return**: The existing `hitl` label gate now exits silently (no comment flood on cron re-entry).
- **Inline approval removed from orchestrators**: `adwChore`, `adwSdlc`, `adwPlanBuildReview`, and `adwPlanBuildTestReview` no longer contain inline `approvePR` logic.
- **Startup validation**: `workflowInit.ts` throws early when a GitHub App is configured but `GITHUB_PAT` is absent.
- **Auth error non-retryable patterns**: `NON_RETRYABLE_PATTERNS` extended with `gh auth login`, `GH_TOKEN`, `HTTP 401`, `Bad credentials`, `authentication` to cut retry noise on doomed auth calls.
- **New BDD feature + step definitions**: `features/move_approval_to_review_phase.feature` and its step definitions covering all 18 new scenarios.

## Technical Implementation

### Files Modified

- `adws/github/prApi.ts`: Fixed `approvePR` to use PAT-swap pattern; added `fetchPRApprovalState`.
- `adws/github/issueApi.ts`: Added `addIssueLabel` function.
- `adws/github/index.ts`: Re-exported `fetchPRApprovalState` and `addIssueLabel` from barrel.
- `adws/phases/reviewPhase.ts`: Added `approvePR` call after review pass; imports `approvePR`, `isGitHubAppConfigured`, `GITHUB_PAT`, `extractPrNumber`.
- `adws/phases/autoMergePhase.ts`: Removed `approvePR`/`isGitHubAppConfigured`; added `fetchPRApprovalState` + `addIssueLabel` gate; silent `hitl` early-return.
- `adws/phases/workflowInit.ts`: Added startup validation — throws when `isGitHubAppConfigured() && !GITHUB_PAT`.
- `adws/core/utils.ts`: Extended `NON_RETRYABLE_PATTERNS` with auth error strings.
- `adws/adwChore.tsx`: Removed inline approval block.
- `adws/adwSdlc.tsx`: Removed inline approval block.
- `adws/adwPlanBuildReview.tsx`: Removed inline approval block.
- `adws/adwPlanBuildTestReview.tsx`: Removed inline approval block.
- `features/auto_approve_merge_after_review.feature`: Updated scenarios for PAT-swap contract.
- `features/hitl_label_gate_automerge.feature`: Updated `hitl` gate to assert silent early-return.
- `features/orchestrator_awaiting_merge_handoff.feature`: Updated to assert orchestrators do not call `approvePR`.
- `adws/core/__tests__/execWithRetry.test.ts`: Added Vitest tests for each new auth non-retryable pattern.

### New Files

- `features/move_approval_to_review_phase.feature`: 18 BDD scenarios covering the full approval responsibility split.
- `features/step_definitions/moveApprovalToReviewPhaseSteps.ts`: Step definitions for the new feature.

### Key Changes

- **Responsibility split**: `reviewPhase` produces approval; `autoMergePhase` reads and gates on it. Approval is no longer scattered across four orchestrators.
- **Reliable auth**: `approvePR` uses `GITHUB_PAT` via the PAT-swap pattern (`save → set → finally restore`) already proven in `projectBoardApi.ts`, eliminating Keychain dependency.
- **Hard merge gate**: `autoMergePhase` calls `fetchPRApprovalState` — if no `APPROVED` review exists in GitHub, the phase applies the `hitl` label, posts a one-time "Awaiting human approval" comment, and exits without merging.
- **No comment floods**: The pre-existing `hitl` early-return no longer posts a comment; the comment is only posted in the new no-approval branch, and only once (subsequent cron re-entries find `hitl` already set and exit silently).
- **Fail-fast config**: `initializeWorkflow` validates `GITHUB_PAT` presence before any phase runs when a GitHub App is active, preventing silent degradation.

## How to Use

1. Ensure `GITHUB_PAT` is set in your `.env` file when using a GitHub App configuration. The workflow will throw at startup with a clear message if it is missing.
2. When a review orchestrator (`adwSdlc`, `adwChore`, `adwPlanBuildReview`, `adwPlanBuildTestReview`) runs a review phase and the review passes, `approvePR` is called automatically using `GITHUB_PAT`.
3. When `autoMergePhase` runs (from `adwMerge`), it fetches GitHub review state. If an `APPROVED` review is recorded, the PR merges. If not, the `hitl` label is applied and a comment is posted — a human must approve in GitHub before the next cron cycle picks it up.
4. To unblock a PR held at the HITL gate: approve the PR in the GitHub UI. The cron will detect the `APPROVED` review on the next cycle and proceed to merge.

## Configuration

- **`GITHUB_PAT`** (required when GitHub App is configured): Personal Access Token used by `approvePR` to approve PRs under the personal identity. Set in `.env`.
- **`hitl` label**: Applying this label manually to an issue (before or during a workflow run) causes `autoMergePhase` to exit silently without merging, regardless of review state.

## Testing

```bash
# Run the new BDD scenarios for this issue
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-434"

# Run updated existing BDD regression scenarios
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-fvzdz7-auto-approve-and-mer and @regression"
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-329-hitl-label-gate and @regression"
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-bpn4sv-orchestrators-exit-a and @regression"

# Run full regression suite
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"

# Run unit tests (includes execWithRetry auth pattern tests)
bun run test:unit

# Type-check
bunx tsc --noEmit -p adws/tsconfig.json
```

## Notes

- The PAT-swap pattern (`save → set GH_TOKEN = GITHUB_PAT → finally restore`) is the canonical approach for all `gh` calls that need personal identity. Follow `projectBoardApi.ts:238-243` as the reference.
- `fetchPRApprovalState` returns `false` on any parse error, making the gate fail-safe (blocks merge on ambiguity rather than proceeding).
- The `hitl` label acts as a manual override for any PR — it will suppress auto-merge regardless of review state until the label is removed.
- The existing docs `feature-fvzdz7-auto-approve-merge-after-review.md`, `feature-fygx90-hitl-label-gate-automerge.md`, and `feature-bpn4sv-orchestrators-awaiting-merge-handoff.md` describe the prior design; this feature supersedes the approval responsibility described in those docs.
