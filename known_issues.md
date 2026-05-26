# Known Issues

This file documents production incidents and recurring failure patterns in the ADW codebase, together with their resolution status. Each entry includes the failure signature, root cause, solution, and linked issues for traceability.

---

## merge-dead-end-no-recovery

**Pattern:** No log pattern — diagnosed by `awaiting_merge` issues going `abandoned` or `discarded` with no subsequent cron re-dispatch.

**Description:** Two distinct failure modes in `adws/adwMerge.tsx` that permanently removed issues from automation once they reached the `awaiting_merge` stage:

1. **`no_pr_found` terminal abandon** — `defaultFindPRByBranch` queried `gh pr list --state all ... --limit 5` and blindly returned `prs[0]`. On a branch carrying both a closed PR and an open PR (observed as PR #523 closed + PR #526 open in issue #508), the closed PR sorted to `prs[0]`, causing `executeMerge` to take the `pr_closed → discarded` path instead of merging. On a transient `gh` failure (null return), `executeMerge` wrote terminal `abandoned` on the first miss with no retry budget, permanently dead-ending the issue within the process lifetime.

2. **`merge_failed` terminal discard** — When `mergeWithConflictResolution` exhausted `MAX_AUTO_MERGE_ATTEMPTS`, `executeMerge` wrote `discarded` (the #460 routing). Because `discarded` is non-retriable (`cronStageResolver.isRetriableStage` returns true only for `abandoned`), ADW was permanently out of the loop. The only recourse was a manual merge, which lost ADW's post-merge bookkeeping (state write to `completed`, completion comment, dependency unblocking).

**Status:** `solved`

**Solution:**

1. **PR resolution fix** — `defaultFindPRByBranch` now adds `updatedAt` to the JSON fields and delegates to a new exported `selectPreferredPR(entries)` helper: prefer the most-recently-updated **OPEN** PR; fall back to the most-recently-updated PR overall when none are open (preserving the `already_merged`/`pr_closed` idempotent paths).

2. **Bounded `no_pr_found` retry** — `executeMerge` increments `mergeRetryCount` in top-level state on each miss. While `< MAX_PR_RESOLUTION_ATTEMPTS` (3), it re-writes `awaiting_merge` (no comment, no cron re-spawn needed — the hoist picks it up). On the 3rd miss, it escalates to `merge_blocked` with an explanatory issue comment.

3. **`merge_blocked` stage** — New first-class `WorkflowStage`. Non-retriable (`isRetriableStage` stays `abandoned`-only). Ineligible for spawn in `cronIssueFilter.evaluateIssue`. Posts an explanatory issue comment naming the cause and the `## Retry` remedy. **This consciously revises #460**: `merge_failed` now routes to `merge_blocked` (human-recoverable) instead of `discarded`. The anti-loop intent of #460 is preserved: `merge_blocked` recovers only via an explicit human `## Retry`, never automatically.

4. **`## Retry` re-entry** — New `handleRetryDirective` (mirrors `cancelHandler.ts`): resets `merge_blocked → awaiting_merge`, clears `mergeRetryCount: 0`. The existing `awaiting_merge` cron hoist re-dispatches `adwMerge` on the next tick. `pr_closed` still routes to `discarded` (deliberate operator intent, unchanged).

**Fix attempts:** 1

**Linked issues:** #527, #460, #508, #449

**First seen:** 2026-05-26

**Representative sample:**

```
# Issue stuck in awaiting_merge, adwMerge ran and wrote:
#   workflowStage: "abandoned"  ← no_pr_found first miss (pre-fix)
# or:
#   workflowStage: "discarded"  ← merge_failed after MAX_AUTO_MERGE_ATTEMPTS (pre-fix)
# No subsequent cron activity because neither stage is retriable.

# Post-fix behaviour:
#   no_pr_found miss 1 → awaiting_merge, mergeRetryCount: 1 (silent retry)
#   no_pr_found miss 2 → awaiting_merge, mergeRetryCount: 2 (silent retry)
#   no_pr_found miss 3 → merge_blocked, issue comment: "## ADW Merge Blocked ... ## Retry"
#   merge_failed       → merge_blocked, issue comment: "## ADW Merge Blocked ... ## Retry"
#
# Recovery: operator posts "## Retry" on the issue.
#   handleRetryDirective → awaiting_merge, mergeRetryCount: 0
#   next cron tick → adwMerge re-dispatched via awaiting_merge hoist
```
