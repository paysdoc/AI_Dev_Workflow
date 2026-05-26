# Merge Blocked Recovery Path

**ADW ID:** 22y8n3-adwmerge-dead-ends-i
**Date:** 2026-05-26
**Specification:** specs/issue-527-adw-22y8n3-adwmerge-dead-ends-i-sdlc_planner-merge-blocked-recovery-path.md

## Overview

This fix eliminates two permanent dead-ends in `adwMerge`'s exit map: a transient `no_pr_found` miss no longer immediately writes `abandoned`, and a conflict-exhausted `merge_failed` no longer writes terminal `discarded` (reversing #460's routing). Instead, both escalate to a new human-recoverable `merge_blocked` stage, which an operator can reset to `awaiting_merge` by posting `## Retry` on the issue — restoring ADW's post-merge bookkeeping (state write, completion comment, dependency unblocking) without a full cancel/re-spawn.

## What Was Built

- **`merge_blocked` workflow stage** — new non-retriable, non-spawnable escalation target for merge dead-ends; recoverable only via explicit `## Retry` human directive
- **`mergeRetryCount` state field** — PR-resolution retry counter added to `AgentState`; incremented on each `no_pr_found` miss; cleared on success and on `## Retry`
- **Bounded `no_pr_found` retry in `executeMerge`** — up to `MAX_PR_RESOLUTION_ATTEMPTS = 3` silent retries (stay `awaiting_merge`) before escalating to `merge_blocked` with an explanatory issue comment
- **`merge_failed` → `merge_blocked` (reversal of #460)** — conflict-exhausted merges now escalate to the human-recoverable stage instead of terminal `discarded`; anti-loop guarantee preserved via explicit-`## Retry`-only recovery
- **`selectPreferredPR` helper in `prApi.ts`** — prefers the most-recently-updated OPEN PR for a branch (fixes #508 multi-PR resolution); falls back to most-recently-updated overall so `already_merged`/`pr_closed` paths remain functional
- **`## Retry` comment directive** — `isRetryComment`/`RETRY_COMMENT_PATTERN` in `workflowCommentParsing.ts`; `handleRetryDirective` in `retryHandler.ts`; wired into both `trigger_cron.ts` and `trigger_webhook.ts`
- **`merge_blocked` cron ineligibility** — explicit guard in `cronIssueFilter.evaluateIssue` (mirrors the `discarded` guard)
- **Full test coverage** — unit tests for `selectPreferredPR`, bounded retry, escalation, counter-reset, `isRetryComment`, `handleRetryDirective`, and `merge_blocked` cron exclusion; per-issue BDD scenarios (`@adw-527`) including the `merge_blocked → ## Retry → merged` round-trip

## Technical Implementation

### Files Modified

- `adws/adwMerge.tsx` — primary fix site: added `MAX_PR_RESOLUTION_ATTEMPTS`, `buildMergeBlockedComment` helper, bounded `no_pr_found` retry branch, `merge_failed → merge_blocked` routing (with #460-reversal comment), counter clear on success
- `adws/github/prApi.ts` — added `RawPRListEntry` (extends `RawPR` with `updatedAt`), exported `selectPreferredPR`, rewrote `defaultFindPRByBranch` to use `--limit 20` + `updatedAt` field + delegate to `selectPreferredPR`
- `adws/types/workflowTypes.ts` — added `'merge_blocked'` to `WorkflowStage` union
- `adws/types/agentTypes.ts` — added `mergeRetryCount?: number` to `AgentState`
- `adws/triggers/cronIssueFilter.ts` — added `merge_blocked` ineligibility guard in `evaluateIssue`
- `adws/triggers/cronStageResolver.ts` — extended `isRetriableStage` JSDoc to name `merge_blocked` as intentionally non-retriable
- `adws/core/workflowCommentParsing.ts` — added `RETRY_COMMENT_PATTERN` and `isRetryComment`
- `adws/core/index.ts` — re-exported `RETRY_COMMENT_PATTERN`, `isRetryComment`
- `adws/github/workflowComments.ts` — re-exported `RETRY_COMMENT_PATTERN`, `isRetryComment`
- `adws/github/index.ts` — re-exported `RETRY_COMMENT_PATTERN`, `isRetryComment`
- `adws/triggers/trigger_cron.ts` — wired `## Retry` into the pre-filter comment-scan loop (no `cancelledThisCycle` add — reset must be observed same cycle)
- `adws/triggers/trigger_webhook.ts` — wired `## Retry` into the `issue_comment` handler

### New Files

- `adws/triggers/retryHandler.ts` — `handleRetryDirective(issueNumber, comments, deps?)`: state-only reset of `merge_blocked → awaiting_merge` + clears `mergeRetryCount`; injectable `RetryHandlerDeps` for testing; mirrors `cancelHandler.ts` but no process kill / worktree removal
- `adws/__tests__/adwMerge.test.ts` — updated `no_pr_found` and `merge_failed` expectations; added bounded-retry, escalation, and counter-reset tests
- `adws/github/__tests__/prApi.test.ts` — added `selectPreferredPR` describe block
- `adws/triggers/__tests__/cronIssueFilter.test.ts` — added `merge_blocked` skip-terminal describe block
- `adws/triggers/__tests__/retryHandler.test.ts` — new unit tests for `handleRetryDirective`
- `adws/core/__tests__/workflowCommentParsing.test.ts` — new focused tests for `isRetryComment`
- `features/per-issue/step_definitions/feature-527.steps.ts` — step definitions for `@adw-527` BDD scenarios
- `features/per-issue/feature-527.feature` — per-issue BDD scenarios §1–§7

### Key Changes

- **`selectPreferredPR` fixes the #508 multi-PR regression:** with `--state all`, a branch carrying a closed + open PR previously resolved to `prs[0]` (wrong). Now the open PR always wins; only when no open PRs exist does it fall back to most-recently-updated overall, preserving `already_merged`/`pr_closed` idempotency paths.
- **Bounded retry is silent (no comment on intermediate misses):** mirrors the `hitl_blocked_unapproved` defer pattern — `awaiting_merge` is rewritten without a comment on attempts 1 and 2 to avoid flooding the issue.
- **`## Retry` must NOT be added to `cancelledThisCycle`:** the reset to `awaiting_merge` must be visible to `filterEligibleIssues` in the same cron cycle so the `awaiting_merge` hoist re-dispatches `adwMerge` immediately.
- **Anti-loop guarantee preserved:** `merge_blocked` is never auto-retried (`isRetriableStage` stays `abandoned`-only). `handleRetryDirective` is idempotent — only resets from `merge_blocked`, so a second `## Retry` after recovery is a no-op.
- **`MergeRunResult.outcome` vs `workflowStage` distinction maintained:** the bounded-retry "stay" path returns `outcome: 'abandoned'` while writing `workflowStage: 'awaiting_merge'` — consistent with the existing `hitl_blocked_unapproved` precedent. `main()`'s exit-code mapping (keying on `reason === 'merge_failed'`) is unchanged.

## How to Use

**Operator recovery for a `merge_blocked` issue:**

1. The issue will have a `## ADW Merge Blocked` comment explaining the cause (either exhausted PR resolution attempts or conflict-resolution failure).
2. Resolve the underlying problem:
   - For `no_pr_found`: ensure the branch has exactly one open PR and the stored branch name is current.
   - For `merge_failed`: resolve merge conflicts on the PR branch and push the resolution.
3. Post a comment on the **GitHub issue** (not the PR) containing exactly:
   ```
   ## Retry
   ```
4. ADW resets the workflow stage to `awaiting_merge` and clears the retry counter. The next cron tick (≤20s) re-dispatches `adwMerge`, which picks up the open PR and re-attempts the merge including all post-merge bookkeeping.

## Configuration

No new configuration required. The retry limit is a compile-time constant:
- `MAX_PR_RESOLUTION_ATTEMPTS = 3` in `adws/adwMerge.tsx` — number of `no_pr_found` misses before escalating to `merge_blocked`.

## Testing

```bash
# Unit tests (includes all new/updated tests for this fix)
bun run test:unit

# Per-issue BDD scenarios (§1–§7, including the merge_blocked → ## Retry → merged round-trip)
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-527"

# Regression suite — must pass with zero regressions
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"
```

## Notes

- **Conscious reversal of #460:** `merge_failed` previously wrote terminal `discarded` (a #460 design choice to stop infinite respawn loops). This fix routes it to `merge_blocked` instead, preserving #460's anti-loop guarantee via the explicit-`## Retry`-only recovery constraint. `pr_closed` remains `discarded` (deliberate operator intent — unchanged). See `feature-29w5wf-reclassify-abandoned-discarded-call-sites.md` for the `MergeRunResult.outcome` vs `workflowStage` distinction context.
- **Out of scope:** `processedSpawns`-above-retriable ordering (#449) and the wrong stored `branchName` re-fire (#524). The HITL gate (`adwMerge.tsx` lines 131-139) is unchanged.
- **`pr_closed` and transient-error `abandoned` exits are untouched** — the 6 transient error exits and the `pr_closed → discarded` path retain their existing behavior.
