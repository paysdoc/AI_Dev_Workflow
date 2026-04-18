# Fix: Cancel Directive Per-Cycle Skip

**ADW ID:** yipjb0-cancel-directive-nev
**Date:** 2026-04-18
**Specification:** specs/issue-444-adw-yipjb0-cancel-directive-nev-sdlc_planner-fix-cancel-per-cycle-skip.md

## Overview

Fixed a bug where posting `## Cancel` on an issue would permanently suppress it from cron re-pickup instead of skipping it for only one cycle. The root cause was that cancelled issue numbers were added to the module-scoped `processedSpawns` set (permanent lifetime) rather than a per-cycle set (function-scoped lifetime). After the fix, cancelled issues appear as `#N(cancelled)` in the current cycle's filtered log and become eligible candidates on the next cycle.

## What Was Built

- Per-cycle `cancelledThisCycle` set introduced in `trigger_cron.ts` to replace the misuse of `processedSpawns`
- New `cancelledThisCycle` optional parameter on `evaluateIssue` and `filterEligibleIssues` in `cronIssueFilter.ts`
- Distinct `reason: 'cancelled'` filter annotation so operators can distinguish one-cycle cancel grace from permanent in-process dedup (`processed`)
- Regression test suite covering the two-cycle behaviour and precedence rules

## Technical Implementation

### Files Modified

- `adws/triggers/cronIssueFilter.ts`: Added optional `cancelledThisCycle: ReadonlySet<number>` parameter to `evaluateIssue` and `filterEligibleIssues`; early-return with `reason: 'cancelled'` before any other checks
- `adws/triggers/trigger_cron.ts`: Declare `cancelledThisCycle = new Set<number>()` inside `checkAndTrigger()`; replace `processedSpawns.add(issue.number)` with `cancelledThisCycle.add(issue.number)` in the cancel-scan loop; thread the set into `filterEligibleIssues`
- `adws/triggers/__tests__/triggerCronAwaitingMerge.test.ts`: New `describe` blocks for `evaluateIssue — cancelledThisCycle` and `filterEligibleIssues — cancelledThisCycle annotation`, including the two-cycle regression test

### Key Changes

- **Semantic separation:** `processedSpawns` now means strictly "we spawned this workflow in this cron process"; `cancelledThisCycle` means "skip this issue for the current cycle only"
- **Lifetime alignment:** `cancelledThisCycle` is a local variable inside `checkAndTrigger()` — it dies when the function returns, so no cleanup is needed and the next invocation starts with an empty set
- **Backwards compatibility:** Both new parameters default to `new Set()`, so all existing callers (tests, future code) continue to compile and behave identically without changes
- **`cancelHandler.ts` unchanged:** The existing `processedSets.spawns.delete(issueNumber)` defensive cleanup remains; it handles the orthogonal case where the same cron process spawned the workflow earlier and the user is now cancelling mid-run
- **Log readability:** The `cancelled` reason string is distinct from `processed`, giving operators a clear signal in cron logs

## How to Use

No user-facing configuration change. The fix is transparent:

1. Post `## Cancel` as the latest comment on an open issue.
2. On the current cron cycle, the cron log shows `filtered: ... #N(cancelled)`.
3. On the next cron cycle, the issue is re-evaluated as a normal candidate.

## Configuration

No new environment variables or settings required.

## Testing

```bash
bun run test:unit                          # Vitest unit tests including new regression suite
bunx tsc --noEmit -p adws/tsconfig.json   # Type-check the modified files
```

Manual verification: start the cron (`bunx tsx adws/triggers/trigger_cron.ts`), post `## Cancel` on an open issue, observe `#N(cancelled)` in cycle N logs, and confirm the issue appears as a candidate in cycle N+1.

## Notes

- `cancelHandler.ts` does not need to be modified. Its `processedSets.spawns.delete(issueNumber)` call is correct and complementary to this fix.
- The BDD scenario "Cancelled issues are re-eligible in the next cron cycle" in `features/replace_clear_with_cancel_directive.feature` described the correct behavior before this fix; the new Vitest tests close the assertion gap that allowed the bug to land.
- The `ReadonlySet<number>` type on the new parameter signals that `evaluateIssue` / `filterEligibleIssues` must not mutate the set — only the caller (`trigger_cron.ts`) adds to it.
