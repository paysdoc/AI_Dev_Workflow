# Bug: Cancel directive never re-enables issue for cron (per-cycle skip set missing)

## Metadata
issueNumber: `444`
adwId: `yipjb0-cancel-directive-nev`
issueJson: `{"number":444,"title":"Cancel directive never re-enables issue for cron (contradicts acceptance criterion)","body":"## Summary\n\n`## Cancel` on an issue does not allow the cron to re-pick-up the issue on the next cycle, as the issue #425 acceptance criterion states it should. Once cancelled, the issue is filtered as `processed` on every subsequent cron cycle until the cron process itself is restarted.\n\n## Steps to Reproduce\n\n1. Run `bunx tsx adws/triggers/trigger_cron.ts` against a repo.\n2. Post `## Cancel` as the latest comment on an open issue.\n3. Wait for the next cron cycle(s).\n\n**Observed:** Cron logs show the issue as `#N(processed)` in the `filtered:` list on every cycle. The issue is never re-spawned.\n\n**Expected** (per issue #425 plan spec, lines 117 and 160):\n> \"Add cancelled issues to `processedSpawns` so `filterEligibleIssues` skips them this cycle (re-spawn happens next cycle)\"\n> \"Cancelled issues re-spawn on the next cron cycle (not same-cycle)\"","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-04-18T08:50:08Z"}`

## Bug Description
Posting `## Cancel` on an open GitHub issue correctly runs the scorched-earth cleanup sequence (kill orchestrator processes, remove worktrees, delete `agents/{adwId}/` state dirs, clear comments). However, the issue never re-spawns on the next cron cycle as the issue #425 acceptance criterion requires. Instead, every subsequent cron log shows `#N(processed)` in the `filtered:` list until the cron process is restarted.

**Expected behavior:** Cancelled issues are skipped in the current cycle (to avoid the same-cycle race) and become re-eligible on the next cycle.

**Actual behavior:** Cancelled issues are permanently filtered out as `processed` for the lifetime of the cron process.

## Problem Statement
`adws/triggers/trigger_cron.ts:97` adds cancelled issues to `processedSpawns`, which is the module-scoped long-lived "already spawned by this cron process" dedup set. The two semantic uses — permanent cross-cycle dedup vs. one-cycle skip — are conflated. `cancelHandler.ts:93` deletes the issue from `processedSpawns` inside the cancel sequence, but that deletion is immediately undone by the subsequent `.add()` on the next line of `trigger_cron.ts`. On all future cycles the `## Cancel` comment has been cleared, so the cancel path no longer re-fires, and `filterEligibleIssues` (`cronIssueFilter.ts:94`) returns `{ eligible: false, reason: 'processed' }` forever.

## Solution Statement
Introduce a per-cycle `cancelledThisCycle` set declared inside `checkAndTrigger()`. Add cancelled issue numbers to this set instead of `processedSpawns`, and pass it to `filterEligibleIssues` as an additional skip signal. The set dies at function exit, so the issue is naturally re-evaluated on the next cycle. `processedSpawns` remains strictly the "we spawned this workflow in this process" dedup — its original semantic. This is the minimal "Option A" fix called out in the issue.

Changes required:
1. `adws/triggers/cronIssueFilter.ts` — accept a new `cancelledThisCycle: ReadonlySet<number>` argument in `evaluateIssue` and `filterEligibleIssues`; when the issue is in that set, return `{ eligible: false, reason: 'cancelled' }` (checked before the awaiting_merge/processed/grace branches so the annotation is distinct from `processed`).
2. `adws/triggers/trigger_cron.ts` — declare `const cancelledThisCycle = new Set<number>()` at the top of `checkAndTrigger()`; inside the cancel loop, push to `cancelledThisCycle` instead of `processedSpawns`; pass it through to `filterEligibleIssues`.
3. Remove the now-redundant `processedSpawns.add(issue.number)` (line 97) and the inline comment at lines 87-89 that describes the wrong mechanism.
4. Update `handleCancelDirective`'s `processedSets.spawns.delete(issueNumber)` call — it continues to be correct (it defensively clears prior-cycle spawn dedup if the issue was spawned earlier in this process). No change needed there.
5. Keep the full backward-compatible signature shape: `cancelledThisCycle` is an optional parameter so existing tests that call `filterEligibleIssues` / `evaluateIssue` with five arguments continue to pass without edits.

## Steps to Reproduce
1. Ensure a local checkout of ADW with an active target repo and webhook-enabled GitHub App.
2. Start the cron trigger: `bunx tsx adws/triggers/trigger_cron.ts`.
3. On any open issue that has at least one successful ADW workflow run (has an `adw-id` comment), post a new comment whose body is exactly `## Cancel`.
4. Observe the next cron cycle's `POLL:` log line.

**Observed:** the cancel cleanup runs once, but from the next cycle onward the log shows `filtered: #N(processed)` — the issue is never re-spawned.
**Expected:** after one cycle of `filtered: #N(cancelled)`, the issue becomes an eligible candidate and a fresh workflow spawns.

## Root Cause Analysis
Commit `0099731` (issue #425) introduced the cancel directive. The plan (issue #425 spec lines 117, 160) required a per-cycle skip mechanism so the same cron cycle that handles `## Cancel` cannot immediately re-spawn the issue — there is a real race here, because `handleCancelDirective` deletes `agents/{adwId}/`, which causes `resolveIssueWorkflowStage` to return `stage === null` (fresh-issue classification) for the remainder of the cycle, and `filterEligibleIssues` would otherwise treat the issue as a fresh candidate and spawn it immediately.

The planner correctly identified that a skip mechanism was needed, but used the module-scoped `processedSpawns` Set to implement it. `processedSpawns` is permanent memory (cleared only when the cron process dies), while the intended semantic was "skip for this iteration only." The inline comment at `trigger_cron.ts:87-89` describes the intended per-cycle behavior, but the implementation contradicts it.

On the next cycle:
- The `## Cancel` comment has been cleared by `handleCancelDirective` (step 5), so the cancel-scan loop does not re-fire and does not clean up `processedSpawns`.
- `evaluateIssue` hits the `processed.spawns.has(issue.number)` branch (`cronIssueFilter.ts:94`) and returns `{ eligible: false, reason: 'processed' }`.
- This persists until the cron process restarts (workaround confirmed in the issue).

The fix is to represent "skip this cycle only" with a set whose lifetime matches that semantic — a local variable in `checkAndTrigger()`.

## Relevant Files
Use these files to fix the bug:

- `adws/triggers/trigger_cron.ts` — Contains the erroneous `processedSpawns.add(issue.number)` at line 97 and the misleading inline comment at lines 87-89. Primary fix site: introduce `cancelledThisCycle` set and thread it through.
- `adws/triggers/cronIssueFilter.ts` — Exports `evaluateIssue` and `filterEligibleIssues`. Update both to accept and honour the new per-cycle cancelled set. Must preserve the existing `processed.spawns`/`processed.merges` semantics so in-process dedup still works for all non-cancel paths.
- `adws/triggers/cancelHandler.ts` — Keeps its `processedSets.spawns.delete(issueNumber)` defensive cleanup (covers the case where this same process spawned the issue earlier and now the user is cancelling it mid-run). No behavior change needed.
- `adws/triggers/__tests__/triggerCronAwaitingMerge.test.ts` — Tests `evaluateIssue` and `filterEligibleIssues`. Extend with regression scenarios covering the new `cancelledThisCycle` argument and its two-cycle behavior: skipped in cycle 1, eligible in cycle 2.
- `adws/triggers/__tests__/cancelHandler.test.ts` — Existing unit tests for `handleCancelDirective`. No behavior change expected; verify these still pass.
- `guidelines/coding_guidelines.md` — Coding guidelines to follow (clarity over cleverness, immutability, explicit types, declarative style where possible).
- `app_docs/feature-9jpn7u-replace-clear-with-cancel.md` — Documents the original cancel feature and the per-cycle skip intent that this bug fix restores.
- `features/replace_clear_with_cancel_directive.feature` — BDD scenarios for issue #425; current scenarios cover single-cycle behavior. The regression scenario at line 158 ("Cancelled issues are re-eligible in the next cron cycle") describes the correct behavior but was never asserted in a multi-cycle test — this gap is exactly what allowed the bug to land.

### New Files
None. The fix is contained in existing files.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Extend `evaluateIssue` in `cronIssueFilter.ts` with a per-cycle cancelled set

- Open `adws/triggers/cronIssueFilter.ts`.
- Add a new optional parameter `cancelledThisCycle: ReadonlySet<number> = new Set()` to `evaluateIssue`, placed after `processed` and before `gracePeriodMs`. Document it in the JSDoc: "Issue numbers that were cancelled earlier in the current cycle and must be skipped once; this set is not persisted across cycles."
- At the top of the function body (before the `resolveStage` call), add:
  ```ts
  if (cancelledThisCycle.has(issue.number)) {
    return { eligible: false, reason: 'cancelled' };
  }
  ```
  Using a distinct reason ("cancelled") so operators can tell at a glance whether an issue was skipped for the one-cycle cancel grace versus the permanent in-process dedup.
- Do NOT remove or weaken the existing `processed.spawns.has(issue.number)` check — that check continues to guard legitimate cross-cycle dedup for issues spawned earlier in the same cron process.

### Step 2: Propagate the parameter through `filterEligibleIssues`

- In the same file (`adws/triggers/cronIssueFilter.ts`), add `cancelledThisCycle: ReadonlySet<number> = new Set()` as an optional parameter on `filterEligibleIssues`, placed after `processed` and before `gracePeriodMs`.
- Forward it into each call to `evaluateIssue` inside the `for` loop.
- Default to an empty set so all existing callers (tests, any future caller that doesn't care about cancel) continue to compile and behave identically.

### Step 3: Wire `cancelledThisCycle` into `trigger_cron.ts`

- Open `adws/triggers/trigger_cron.ts`.
- Inside `checkAndTrigger()`, declare a fresh per-cycle set immediately after `const now = Date.now();` and before `fetchOpenIssues()`:
  ```ts
  const cancelledThisCycle = new Set<number>();
  ```
- In the cancel-scan loop (lines 93-99), replace `processedSpawns.add(issue.number);` (line 97) with `cancelledThisCycle.add(issue.number);`.
- Update the inline comment block at lines 87-89 to accurately describe the new mechanism:
  ```
  // Scan all fetched issues for ## Cancel before filterEligibleIssues.
  // Cancelled issues are recorded in a per-cycle set so they are skipped
  // in this cycle and naturally re-evaluated on the next cycle.
  ```
- Pass `cancelledThisCycle` through to the `filterEligibleIssues` call (line 101):
  ```ts
  const { eligible: candidates, filteredAnnotations } = filterEligibleIssues(
    issues,
    now,
    { spawns: processedSpawns, merges: processedMerges },
    GRACE_PERIOD_MS,
    resolveIssueWorkflowStage,
    cancelledThisCycle,
  );
  ```
  (The parameter order matches Step 2; if Step 2 chose a different position, keep them consistent.)

### Step 4: Confirm `cancelHandler.ts` still does the right thing

- Read `adws/triggers/cancelHandler.ts:91-96`.
- Confirm `processedSets.spawns.delete(issueNumber)` is still called. This handles the case where the same cron process already spawned the workflow earlier in its lifetime and the user is cancelling it mid-run — without this `.delete()`, the next cycle would still see the issue in `processed.spawns` and filter it. No code change needed; leave as-is.
- No behavior change to `cancelHandler.test.ts` is expected; do not edit it.

### Step 5: Add regression unit tests in `triggerCronAwaitingMerge.test.ts`

- Open `adws/triggers/__tests__/triggerCronAwaitingMerge.test.ts`.
- Add a new `describe('evaluateIssue — cancelledThisCycle', () => { ... })` block with scenarios:
  1. `returns ineligible with reason='cancelled' when issue is in cancelledThisCycle` — an otherwise-eligible issue (fresh, past grace) is skipped.
  2. `cancelled check takes precedence over awaiting_merge` — even if the stage resolver would have returned `awaiting_merge`, the cancel skip wins (matches the cron's intent: cancelled issues should not be processed as merges in the same cycle).
  3. `cancelled check takes precedence over processed.spawns` — an issue in both `processed.spawns` and `cancelledThisCycle` is still reported with reason `cancelled` (ordering detail — makes operator logs readable).
  4. **Two-cycle regression** (closes the test gap called out in the issue): two back-to-back calls to `filterEligibleIssues` with the same `processed` sets; in cycle 1 `cancelledThisCycle` contains the issue and it is filtered with reason `cancelled`; in cycle 2 `cancelledThisCycle` is empty and the issue is returned as an eligible candidate.
- Add a `describe('filterEligibleIssues — cancelledThisCycle annotation', () => { ... })` block with:
  - `filtered annotation reads '#N(cancelled)' when the issue is in cancelledThisCycle` — asserts the reason string surfaces through to the log.
- All new tests must be deterministic (no real timers, use `Date.now()` snapshots and `updatedAt` far in the past).

### Step 6: Validate no regressions in existing tests

- Existing tests in `triggerCronAwaitingMerge.test.ts` and `cancelHandler.test.ts` call `filterEligibleIssues` / `evaluateIssue` with five positional arguments; since the new parameter is optional and defaults to an empty set, these must continue to pass without edits.
- If any existing test explicitly asserts `reason: 'processed'` on an issue that was cancelled, update the expectation — but based on current test contents, no such test exists.

### Step 7: Manual reproduction check

- Run `bunx tsc --noEmit -p adws/tsconfig.json` to confirm the type changes type-check.
- Start the cron in verbose mode (host repo is fine): `bunx tsx adws/triggers/trigger_cron.ts` and on an open issue post `## Cancel`.
- Confirm cycle N log shows `filtered: ... #<N>(cancelled)`.
- Confirm cycle N+1 either shows the issue in the `candidate(s)` list or (if dependencies/grace apply) with a reason that is NOT `processed`.
- Shut down cron after verification.

### Step 8: Run validation commands

- Execute the full validation suite below to confirm no regressions.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

- `bun run lint` — Lint the codebase.
- `bunx tsc --noEmit` — Root TypeScript type check.
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW-specific type check (extra coverage for the modified files).
- `bun run build` — Build the application to verify no build errors.
- `bun run test:unit` — Run Vitest unit tests, including the extended `triggerCronAwaitingMerge.test.ts` regression coverage and existing `cancelHandler.test.ts`.
- **Before-fix reproduction** (prove the bug): `git stash` the proposed changes (or checkout the prior commit), start the cron, post `## Cancel`, and observe the `#N(processed)` annotation persisting across cycles.
- **After-fix reproduction** (prove the fix): restore the changes, restart the cron, post `## Cancel`, and observe `#N(cancelled)` in one cycle and eligibility recovery in the next.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — Run the full `@regression` BDD suite to confirm no cross-cutting regressions.

## Notes
- Follow `guidelines/coding_guidelines.md`: explicit types (the new parameter is typed `ReadonlySet<number>`, not `Set<number>`, to signal that the filter should not mutate it), no magic strings (the new reason is the literal `'cancelled'`, matching the existing reason-string convention used in `cronIssueFilter.ts`), minimal surface change (optional parameter with a safe default).
- The fix intentionally keeps the `processedSets.spawns.delete(issueNumber)` call inside `handleCancelDirective` untouched. That deletion handles the orthogonal case of cancelling an in-flight spawn the same cron process issued earlier — without it, the issue would still be filtered as `processed` even on the next cycle. The `cancelledThisCycle` set handles the per-cycle race; the `.delete()` handles the cross-cycle hangover. Both are needed.
- No library install is required.
- No changes to the `## Cancel` directive semantics, comment patterns, or the cancel cleanup sequence — the fix is scoped strictly to the cron's per-cycle skip mechanism.
- The BDD feature file `features/replace_clear_with_cancel_directive.feature` has a scenario at line 158 ("Cancelled issues are re-eligible in the next cron cycle") that describes the correct behavior but is not currently backed by a multi-cycle test. The new Vitest regression in Step 5 closes this gap; no edit to the `.feature` file is required.
