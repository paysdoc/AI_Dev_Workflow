# Known Issues

This file documents production incidents and recurring failure patterns in the ADW codebase, together with their resolution status. Each entry includes the failure signature, root cause, solution, and linked issues for traceability.

---

## build-progress-gate-design-residuals

**Pattern:** No log pattern — design limitations of the state-novelty progress gate introduced in issue #559.

**Description:** Two accepted residuals in the progress-gate design:

1. **Backstop is per-orchestrator-incarnation** — `seenTreeHashes` and `checkpointCount` live in process memory inside `buildPhase.ts`. An orchestrator takeover (e.g., after a process crash, a rate-limit pause/resume, or a manual retry) starts a fresh incarnation with an empty `seenTreeHashes` and `checkpointCount = 0`. The backstop therefore restarts from zero on each takeover; a build that is making genuine progress but requires many takeovers could accumulate `MAX_PROGRESS_CHECKPOINTS` checkpoints per incarnation rather than across the full build lifetime.

2. **Monotonic accumulator runs to the backstop** — A build that always produces a novel committed state at each batch boundary (e.g., monotonically appending or removing trivial content) is not detected by the novelty check (each hash is genuinely new). Such a build is only stopped once `checkpointCount` reaches `MAX_PROGRESS_CHECKPOINTS`, consuming the full restart budget before the backstop abort fires. There is no intra-checkpoint progress signal to catch this pattern earlier.

**Status:** `open` (accepted residuals — no fix planned at this time)

**Solution:** No mitigation implemented. The residuals are bounded: incarnation resets are bounded by the number of takeover events, and the monotonic-accumulator case is bounded by `MAX_PROGRESS_CHECKPOINTS`. A future slice could persist `seenTreeHashes` and `checkpointCount` to the agent state file to survive takeovers, and could add a secondary size-delta heuristic to detect monotonic-accumulator patterns.

**Fix attempts:** 0

**Linked issues:** #559

**First seen:** 2026-06-09

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
