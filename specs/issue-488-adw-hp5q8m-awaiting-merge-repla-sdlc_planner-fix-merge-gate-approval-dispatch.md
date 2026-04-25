# Bug: awaiting_merge — replace hitl-label gate with PR-approval gate, and replace process-lifetime processedMerges with lock-aware dispatch

## Metadata
issueNumber: `488`
adwId: `hp5q8m-awaiting-merge-repla`
issueJson: `{"number":488,"title":"awaiting_merge: replace hitl-label gate with PR-approval gate, and replace process-lifetime processedMerges with lock-aware dispatch","state":"OPEN","author":"paysdoc","labels":["bug"],"createdAt":"2026-04-25T10:06:31Z"}`

## Bug Description

Two compounding defects on the `awaiting_merge` dispatch path cause auto-merge to silently never fire after a human approves a PR:

1. **`processedMerges` is process-lifetime, not per-cycle.** `adws/triggers/trigger_cron.ts:31` declares `processedMerges = new Set<number>()` at module scope. Once `adwMerge` dispatches for an issue and exits without merging — for any reason: `hitl_blocked`, transient failure, race with the merge orchestrator's own self-exclusion lock — the issue is permanently filtered as `processed` for the lifetime of the running cron. The doc comment on `evaluateIssue` (`adws/triggers/cronIssueFilter.ts:65-66`) describes it as *"Sets of issue numbers already queued **this cycle**"* — implementation contradicts documentation. Recovery currently requires restarting the cron or posting `## Cancel`.
2. **The merge gate is the `hitl` label, not PR approval state.** The `#483` fix (`adws/adwMerge.tsx:130-133`) added `issueHasLabel('hitl')` to restore a merge gate. The choice of *gate condition* was wrong: PR approval state is the canonical "human signed off" signal, not the presence/absence of a label. A human approving via GitHub Reviews is *not* sufficient to make the bot merge — the human must also remove the `hitl` label. Two distinct signals ("we prompted the human" vs "don't merge yet") are conflated into one label.

Together these produce the failure observed on `vestmatic#52`: human approved, removed the `hitl` label, bot still won't merge — the in-memory `processedMerges` set stayed poisoned from an earlier `hitl_blocked` dispatch.

Additionally, `fetchPRApprovalState` (`adws/github/prApi.ts:283-295`) currently uses `.some(r => r.state === 'APPROVED')` over the *full review history*, which mis-fires on approval-then-changes-requested by the same reviewer, dismissed approvals after force-push, multi-reviewer requirements with only partial approval, and unsatisfied CODEOWNERS. The server-side `reviewDecision` field handles all four correctly for branch-protected repos.

**Actual:** human approves → human removes `hitl` label → cron logs `filtered: #N(processed)` indefinitely → `adwMerge` is never re-dispatched.

**Expected:** human approves → on the next cron cycle, `adwMerge` dispatches and merges (or attempts conflict resolution); removing the `hitl` label is no longer required.

## Problem Statement

The cron's `awaiting_merge` dispatch path uses the wrong dedup primitive (a process-lifetime in-memory Set instead of the on-disk spawn lock that `adwMerge` itself relies on for self-exclusion) and the wrong merge gate (a label instead of GitHub's authoritative review-decision state). Together these cause auto-merge to silently fail after human approval, and recovery requires either a cron restart or a `## Cancel`.

## Solution Statement

1. **Tighten `fetchPRApprovalState`** to query both `reviewDecision` (server-side authoritative for branch-protected repos) and `reviews` (per-reviewer-latest aggregation fallback for repos without branch protection / CODEOWNERS).
2. **Swap the merge gate in `adwMerge`** from `issueHasLabel('hitl')` to `fetchPRApprovalState(prNumber, repoInfo)`. State is NOT written on a no-approval skip — `workflowStage` stays `awaiting_merge` so the next cron cycle retries. The `reason` becomes `awaiting_approval` (replacing `hitl_blocked`).
3. **Replace `processedMerges`** with a new `shouldDispatchMerge(repoInfo, issueNumber, deps?)` helper in a new file `adws/triggers/mergeDispatchGate.ts`. The helper consults the on-disk spawn lock (`readSpawnLockRecord` + `isProcessLive`) — the same primitive `adwMerge` uses for self-exclusion via `runWithRawOrchestratorLifecycle`. If the lock is held by a live PID → defer; otherwise → dispatch. This is exactly the right semantic question for the cron: "is an `adwMerge` orchestrator currently running for this issue?"
4. **Drop the `merges` field** from `ProcessedSets` (`cronIssueFilter.ts`) and `MutableProcessedSets` (`cancelHandler.ts`), and remove every read/write of `processedMerges` from `trigger_cron.ts`. The cron now uses *one* on-disk truth (the spawn lock) for merge dispatch dedup, instead of an in-memory Set that can desync from reality.
5. **Update tests and BDD scenarios** to cover the new gate (`approved` → merges; `not approved` → returns `awaiting_approval`, no state write) and lock semantics (no lock → dispatch; live-PID lock → defer; dead-PID lock → dispatch; malformed JSON → dispatch). Drop hitl-label and `processedMerges` cases that no longer apply.

`autoMergePhase` keeps adding the `hitl` label as an informational marker (out of scope per the issue). The label remains useful for GitHub-side filtering ("show me all issues blocked on human approval") but is no longer load-bearing for merge dispatch.

## Steps to Reproduce

1. Trigger an SDLC workflow on an issue. Let it reach `awaiting_merge` while the PR has no approved review.
2. `autoMergePhase` adds the `hitl` label and writes `awaiting_merge` to state.
3. The cron picks up the issue, dispatches `adwMerge`, which exits with `hitl_blocked` because the `hitl` label is set.
4. The issue is now permanently in the cron's in-memory `processedMerges` set for this process's lifetime.
5. Human approves the PR via GitHub Reviews and removes the `hitl` label.
6. Observe: the cron's POLL log shows `filtered: #N(processed)` indefinitely. `adwMerge` is never re-dispatched until the cron is restarted or `## Cancel` is posted.

Alternative repro for the wrong-gate symptom alone (no `processedMerges` poisoning):
1. Trigger an SDLC workflow that reaches `awaiting_merge`.
2. Approve the PR via GitHub Reviews but do NOT remove the `hitl` label.
3. Observe: `adwMerge` re-runs every cycle, sees the `hitl` label, returns `hitl_blocked`. The PR is approved but does not merge.

## Root Cause Analysis

### Part A — `processedMerges` staleness

`adws/triggers/trigger_cron.ts:31` declares the dedup set at module scope:

```ts
const processedMerges = new Set<number>();
```

Lifetime = entire cron process. Line 158 adds an issue when merge dispatch fires. Only `cancelHandler.ts:94` ever removes an entry, and only on a manual `## Cancel`. Per-cycle dedup is also dead code regardless of lifetime: `fetchOpenIssues` produces a single, deduplicated source of candidates per cycle, `gh issue list` does not return duplicates, and there is only one iteration over candidates per cycle. The set therefore serves no useful purpose at any granularity finer than "permanent in-process suppression on first dispatch".

The on-disk spawn lock (`adws/triggers/spawnGate.ts`) already answers the only question the cron actually needs answered: "is an `adwMerge` orchestrator currently running for this issue?" The lock is acquired by `runWithRawOrchestratorLifecycle` (`adws/phases/orchestratorLock.ts:67-84`) at the start of `adwMerge.main()` and released on normal exit; on crash, the next caller's `acquireIssueSpawnLock` reclaims via `isProcessLive` (PID + start-time). The `processedMerges` Set was attempting to answer that question with a wrong, in-memory shadow.

### Part B — `hitl` label as merge gate

The fix in `#483` (`adws/adwMerge.tsx:130-133`) added `issueHasLabel('hitl')` to restore a merge gate that the `bpn4sv` refactor had stripped. The fix was correct in restoring *some* gate; the choice of *gate condition* was wrong:

- PR approval state is GitHub's authoritative "human signed off" signal.
- The `hitl` label was previously applied by `autoMergePhase` *as a side effect of detecting "no approved review"* — it is a derived marker, not a primary signal.
- Issue `#467`'s incident (which `#483` was solving) would have been prevented identically by checking PR approval state.
- Using the label introduces a two-step approve-and-remove-label workflow that humans forget half the time (vestmatic#52).

Additionally, `fetchPRApprovalState` (`adws/github/prApi.ts:283-295`) is too lenient. It returns true if **any** review in the full history has state `APPROVED`, which mis-fires on:

- Approval-then-changes-requested by the same reviewer (latest review supersedes the earlier APPROVED)
- Dismissed approvals after force-push (`DISMISSED` reviews must be ignored)
- Multi-reviewer required for branch-protected repos (one APPROVED is not sufficient)
- CODEOWNERS unsatisfied

GitHub already computes the correct answer server-side: `reviewDecision`. For branch-protected repos with required reviewers/CODEOWNERS, `reviewDecision === 'APPROVED'` is the right gate. For repos without branch protection, `reviewDecision` is `null`; in that case we fall back to per-reviewer-latest aggregation over `reviews`.

## Relevant Files

Use these files to fix the bug:

- `adws/github/prApi.ts` — `fetchPRApprovalState` lives here (lines 283-295). Tighten the gh-CLI query to fetch `reviewDecision,reviews` (with `author.login` and `submittedAt`). Add an exported helper `isApprovedFromReviewsList(reviews)` for the per-reviewer-latest fallback.
- `adws/adwMerge.tsx` — primary fix site. `MergeDeps` (lines 44-58) drops `issueHasLabel`, gains `fetchPRApprovalState`. `buildDefaultDeps()` (lines 196-212) same swap. `executeMerge` lines 128-133 swap from label check to approval check; `reason` becomes `awaiting_approval`. State must NOT be written on the no-approval skip.
- `adws/triggers/trigger_cron.ts` — lines 31 (`processedMerges` declaration), 132 (`handleCancelDirective` call), 140 (`filterEligibleIssues` call), 158 (`processedMerges.add`). Wire in the new `shouldDispatchMerge` check before the merge spawn at line 157; on false log `Issue #N: merge orchestrator already in flight, deferring` and `continue`. Remove `processedMerges` entirely.
- `adws/triggers/cronIssueFilter.ts` — `ProcessedSets` interface (lines 46-49), `evaluateIssue` doc (lines 64-66), `evaluateIssue` body (lines 96-99 — drop the `processed.merges.has(...)` branch and the `awaiting_merge_no_adwid` adjacent block stays). `merges` field removed.
- `adws/triggers/cancelHandler.ts` — `MutableProcessedSets` (lines 21-24) drops `merges`; cleanup line 94 removed.
- `adws/triggers/spawnGate.ts` — reference only. Already exports `readSpawnLockRecord(repoInfo, issueNumber): { pid, pidStartedAt } | null` (lines 88-92) — exactly what `shouldDispatchMerge` needs.
- `adws/core/processLiveness.ts` — reference only. `isProcessLive(pid, recordedStartTime, deps?)` (line 88) is the canonical liveness primitive. The new helper composes both.
- `adws/phases/orchestratorLock.ts` — reference only. Confirms `runWithRawOrchestratorLifecycle` (line 67) is what `adwMerge` uses to acquire the same spawn lock — this is the symmetry that makes lock-aware dispatch correct.
- `adws/__tests__/adwMerge.test.ts` — existing test suite (315 lines). Drop the four `executeMerge — hitl label gate` cases (lines 262-314); replace with approval-state cases. The `makeDeps` helper (lines 38-55) needs `issueHasLabel` removed and `fetchPRApprovalState: vi.fn().mockReturnValue(true)` added.
- `adws/triggers/__tests__/triggerCronAwaitingMerge.test.ts` — drop the two test cases asserting `processed.merges` filtering (lines 92-104, 250-260). Update the `noProcessed` factory (lines 30-34) and the regression-test fixture (line 81) to match the new `ProcessedSets` shape.
- `adws/triggers/__tests__/cancelHandler.test.ts` — drop `merges` from `MutableProcessedSets` fixtures (lines 148-159).
- `features/hitl_label_gate_automerge.feature` — existing BDD feature. Rename or replace; drop the `@adw-483 @regression` adwMerge.tsx scenarios that assert the label gate (lines 80-123) and add approval-state scenarios on `adwMerge`. Add lock-semantics scenarios for `shouldDispatchMerge`. Keep the `autoMergePhase` and webhook scenarios in place — those still describe correct behavior (autoMergePhase still adds the label).
- `features/step_definitions/hitlLabelGateAutomergeSteps.ts` — extends/adapts: the hitl-block extraction helpers (`extractHitlBlockBody`, lines 10-32) become unused for adwMerge; new step definitions for "approval-block extraction" and lock-semantics assertions are needed. Existing `the file imports {string}` and `the function {string} accepts parameters` steps are reusable for the new feature.
- `adws/phases/autoMergePhase.ts` — reference only. Lines 67-72 show the existing label gate (left in place per "Out of scope" — `autoMergePhase` keeps adding the `hitl` label as an informational marker).
- `app_docs/feature-zyjh0z-move-pr-approval-int.md` — context for `fetchPRApprovalState`'s creation in `#434`.
- `app_docs/feature-nrr167-hitl-label-gate-adwmerge.md` — context for the `#483` regression we're now reverting/replacing.
- `app_docs/feature-dcy9qz-merge-orchestrator-cron-handoff.md` — context for the cron `awaiting_merge` dispatch design.
- `app_docs/feature-yipjb0-fix-cancel-per-cycle-skip.md` — reference for the spawn vs cancelled-this-cycle dedup pattern; clarifies why `merges` is removable while `spawns` and `cancelledThisCycle` stay.

### New Files

- `adws/triggers/mergeDispatchGate.ts` — new module exporting `shouldDispatchMerge(repoInfo, issueNumber, deps?: MergeDispatchDeps): boolean`. Reads the spawn lock via `readSpawnLockRecord`; defers on a live-PID lock, dispatches otherwise. Injectable deps `{ readLock, isLive }` for unit testability.
- `adws/triggers/__tests__/mergeDispatchGate.test.ts` — new Vitest file. Four cases: no lock → dispatch; dead-PID lock → dispatch; live-PID lock → defer; malformed lock JSON / missing `pidStartedAt` → dispatch (treated as stale, same as `acquireIssueSpawnLock`'s reclaim semantics).

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Tighten `fetchPRApprovalState` in `adws/github/prApi.ts`

- Add a new exported helper `isApprovedFromReviewsList(reviews)`:
  - Input shape: `{ author: { login: string } | null; state: string; submittedAt: string }[]` (matches what `gh pr view --json reviews` returns).
  - Group reviews by `author.login`. For each author, find the latest review by `submittedAt` (use `Date.parse`, ties broken by array order).
  - Filter to reviews whose state is `APPROVED` or `CHANGES_REQUESTED` — ignore `COMMENTED`, `PENDING`, `DISMISSED` for the "latest review per author" determination if they are the latest, but explicitly: a `DISMISSED` latest blocks counting that author as approved.
  - Implementation rule:
    - If any author's *latest* review state is `CHANGES_REQUESTED` → return false.
    - Otherwise, return true iff at least one author's *latest* review state is `APPROVED`.
    - Empty reviews list → return false.
- Rewrite `fetchPRApprovalState`:
  - Update the gh CLI call: `gh pr view ${prNumber} --repo ${owner}/${repo} --json reviewDecision,reviews`.
  - Parse the result as `{ reviewDecision: string | null; reviews: { author: { login: string } | null; state: string; submittedAt: string }[] }`.
  - Return:
    - `true` if `reviewDecision === 'APPROVED'` (server-side authoritative, branch-protected repos).
    - Otherwise, if `reviewDecision === null` (no branch protection), return `isApprovedFromReviewsList(reviews)`.
    - Otherwise (`reviewDecision === 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED'`), return `false`.
  - On any parse error, log a warning and return `false` (preserve existing fail-safe behavior).
- Export `isApprovedFromReviewsList` from `prApi.ts` for direct unit-testing.

### 2. Add new file `adws/triggers/mergeDispatchGate.ts`

- Define `MergeDispatchDeps` interface:
  ```ts
  export interface MergeDispatchDeps {
    readonly readLock: typeof readSpawnLockRecord;
    readonly isLive: typeof isProcessLive;
  }
  ```
- Provide `buildDefaultDeps()` returning the production implementations (`readSpawnLockRecord` from `./spawnGate`, `isProcessLive` from `../core/processLiveness`).
- Export `shouldDispatchMerge(repoInfo: RepoInfo, issueNumber: number, deps: MergeDispatchDeps = buildDefaultDeps()): boolean`:
  - `const record = deps.readLock(repoInfo, issueNumber)`.
  - If `record === null` → return `true` (no orchestrator running, dispatch).
  - If `record.pidStartedAt === ''` (missing/empty start-time, stale-format record) → return `true` (treat as stale, consistent with `acquireIssueSpawnLock`'s reclaim path).
  - If `deps.isLive(record.pid, record.pidStartedAt)` is `true` → return `false` (defer).
  - Otherwise (PID dead) → return `true` (dispatch — the existing lock will be reclaimed by `acquireIssueSpawnLock` inside `adwMerge`).
- No state writes, no logging side effects beyond what `readSpawnLockRecord` and `isProcessLive` already do internally.

### 3. Swap the gate in `adws/adwMerge.tsx`

- Imports: drop `issueHasLabel` from the `./github` import block; add `fetchPRApprovalState`.
- `MergeDeps` interface (lines 44-58):
  - Drop `readonly issueHasLabel: typeof issueHasLabel;`.
  - Add `readonly fetchPRApprovalState: typeof fetchPRApprovalState;`.
- `executeMerge` lines 128-133: replace the entire HITL gate block with:
  ```ts
  if (!deps.fetchPRApprovalState(prNumber, repoInfo)) {
    log(`adwMerge: PR #${prNumber} not approved, skipping merge`, 'info');
    return { outcome: 'abandoned', reason: 'awaiting_approval' };
  }
  ```
  - State must NOT be written. `workflowStage` stays `awaiting_merge` so the cron retries on the next cycle.
  - Position remains identical: after the `MERGED`/`CLOSED` terminal branches, before the `ensureWorktree` block. Terminal PR states still win.
- `buildDefaultDeps()` (lines 196-212): drop `issueHasLabel`, add `fetchPRApprovalState`.
- `main()` exit-code logic at line 244: confirm `awaiting_approval` does not reach `process.exit(1)` (it should not — the only `1`-exit path is `outcome === 'abandoned' && reason === 'merge_failed'`). No change required, but verify after the edit.

### 4. Wire the new dispatch gate into `adws/triggers/trigger_cron.ts`

- Remove `import { spawn } from 'child_process'` only if no other call sites remain (the `awaiting_merge` branch line 160 and the PR review branch line 230 still use `spawn`, so keep the import).
- Add `import { shouldDispatchMerge } from './mergeDispatchGate';`.
- Delete line 31: `const processedMerges = new Set<number>();`.
- Update line 132 — `handleCancelDirective(...)` — drop the `merges: processedMerges` field from the inline object literal:
  ```ts
  handleCancelDirective(issue.number, issue.comments, cronRepoInfo, cancelCwd, { spawns: processedSpawns });
  ```
- Update line 140 — `filterEligibleIssues(...)` — drop the `merges: processedMerges` field similarly:
  ```ts
  { spawns: processedSpawns },
  ```
- Replace the merge dispatch block at lines 156-167 (the `if (action === 'merge' && adwId)` branch). Insert a `shouldDispatchMerge` guard before the spawn:
  ```ts
  if (action === 'merge' && adwId) {
    if (!shouldDispatchMerge(repoInfo, issue.number)) {
      log(`Issue #${issue.number}: merge orchestrator already in flight, deferring`);
      continue;
    }
    log(`Spawning merge orchestrator for issue #${issue.number} adwId=${adwId}`, 'success');
    const child = spawn(
      'bunx',
      ['tsx', 'adws/adwMerge.tsx', String(issue.number), adwId, ...targetRepoArgs],
      { detached: true, stdio: 'ignore' },
    );
    child.unref();
    continue;
  }
  ```
  - Note: `processedMerges.add(issue.number)` is gone. The on-disk spawn lock acquired by `adwMerge.main()` via `runWithRawOrchestratorLifecycle` is the dedup. There is a brief window between cron `spawn` and the child's `acquireIssueSpawnLock`, but the cron poll interval (20 s) is much longer than orchestrator startup time, and even if a duplicate were spawned, the second one's `acquireIssueSpawnLock` would return `false` and the second orchestrator would exit cleanly via the existing `runWithRawOrchestratorLifecycle` contract.

### 5. Collapse `ProcessedSets` in `adws/triggers/cronIssueFilter.ts`

- Update the `ProcessedSets` interface (lines 46-49) — drop the `merges` field, leaving only `readonly spawns: ReadonlySet<number>`.
- Update the doc comment on `ProcessedSets` (lines 41-45) and `evaluateIssue` (lines 51-72): remove the spawns/merges split language. Simplify to: "tracks issues whose SDLC workflow this process has already spawned. The merge-dispatch path uses an on-disk spawn lock for dedup (see `mergeDispatchGate.ts`), so `awaiting_merge` issues are never deduplicated through this set."
- In `evaluateIssue` body (lines 92-99): remove the `if (processed.merges.has(issue.number))` branch. The remaining `awaiting_merge` block becomes simply:
  ```ts
  if (resolution.stage === 'awaiting_merge') {
    if (!resolution.adwId) {
      return { eligible: false, reason: 'awaiting_merge_no_adwid' };
    }
    return { eligible: true, action: 'merge', adwId: resolution.adwId };
  }
  ```
- The `processed.spawns.has(issue.number)` branch on line 108 is unchanged.

### 6. Drop the `merges` field from `adws/triggers/cancelHandler.ts`

- Update `MutableProcessedSets` (lines 21-24): remove `merges: Set<number>;`. Result is `{ spawns: Set<number>; }`.
- Remove line 94: `processedSets.merges.delete(issueNumber);`.
- Update the doc-comment listing the cleanup steps (lines 30-35) to reflect the single `spawns` field.

### 7. Update unit tests

#### 7a. `adws/__tests__/adwMerge.test.ts`

- Imports: drop `issueHasLabel` from the `../github` import; add `fetchPRApprovalState`.
- `makeDeps` helper (lines 38-55): replace `issueHasLabel: vi.fn<typeof issueHasLabel>().mockReturnValue(false)` with `fetchPRApprovalState: vi.fn<typeof fetchPRApprovalState>().mockReturnValue(true)`.
- Delete the entire `describe('executeMerge — hitl label gate', ...)` block (lines 260-314).
- Add a new `describe('executeMerge — approval gate', ...)` block with these cases:
  - **Approved → merges**: default `makeDeps()` (approved=true). Assert `result.outcome === 'completed'`, `mergeWithConflictResolution` called, `writeTopLevelState({workflowStage: 'completed'})` called.
  - **Not approved → awaiting_approval, no state write**: `makeDeps({ fetchPRApprovalState: vi.fn().mockReturnValue(false) })`. Assert `result.outcome === 'abandoned'`, `result.reason === 'awaiting_approval'`, `writeTopLevelState` not called, `mergeWithConflictResolution` not called, `ensureWorktree` not called, `commentOnIssue` not called, `commentOnPR` not called.
  - **Terminal MERGED beats not-approved**: `findPRByBranch` returns `MERGED`, `fetchPRApprovalState` returns `false`. Assert `result.outcome === 'completed'`, `result.reason === 'already_merged'`. (Verifies terminal-state-wins ordering is preserved.)
  - **Terminal CLOSED beats not-approved**: `findPRByBranch` returns `CLOSED`, `fetchPRApprovalState` returns `false`. Assert `result.outcome === 'abandoned'`, `result.reason === 'pr_closed'`.

#### 7b. `adws/triggers/__tests__/triggerCronAwaitingMerge.test.ts`

- Update `noProcessed()` factory (lines 30-34): remove the `merges` Set, return `{ spawns: new Set<number>() }`.
- Delete the test case "returns ineligible when stage is awaiting_merge but issue is in processed.merges" (lines 92-104).
- Delete the list-level test "excludes awaiting_merge issue when it is in processed.merges" (lines 250-260).
- Update the regression-#398/#399 test case (lines 79-90) to match the new `ProcessedSets` shape: `const processed = { spawns: new Set<number>([398]) };`.
- Update the list-level regression for #398/#399 (lines 235-247) similarly.
- Update any other `processed.merges` or `merges:` references in the file fixtures.

#### 7c. `adws/triggers/__tests__/cancelHandler.test.ts`

- Update the "removes issue from processedSets when provided" case (lines 146-160): `processedSets: MutableProcessedSets = { spawns: new Set([42, 99]) }`. Drop the `merges` assertions.
- Verify no other tests reference `merges` on `MutableProcessedSets`.

#### 7d. New file `adws/triggers/__tests__/mergeDispatchGate.test.ts`

- Use Vitest. Import `shouldDispatchMerge` and a `MergeDispatchDeps` type.
- Four cases:
  - **No lock → dispatch**: `readLock` returns `null`. Expect `true`.
  - **Dead-PID lock → dispatch**: `readLock` returns `{ pid: 12345, pidStartedAt: 'old-start' }`; `isLive` returns `false`. Expect `true`.
  - **Live-PID lock → defer**: `readLock` returns `{ pid: 12345, pidStartedAt: 'live-start' }`; `isLive` returns `true`. Expect `false`.
  - **Malformed lock (missing pidStartedAt) → dispatch**: `readLock` returns `{ pid: 12345, pidStartedAt: '' }`. Expect `true` without ever calling `isLive` (assert via spy that `isLive` not called).
- Inject deps explicitly via the `deps` parameter; do not spy on the production `readSpawnLockRecord` / `isProcessLive`.

#### 7e. New unit tests for `fetchPRApprovalState` and `isApprovedFromReviewsList` in a new file `adws/github/__tests__/prApi.test.ts`

- Mock `execWithRetry` from `../../core` to return canned JSON for each scenario.
- `fetchPRApprovalState` cases:
  - `reviewDecision === 'APPROVED'` (with empty `reviews`) → returns `true`.
  - `reviewDecision === 'CHANGES_REQUESTED'` (regardless of `reviews`) → returns `false`.
  - `reviewDecision === 'REVIEW_REQUIRED'` (regardless of `reviews`) → returns `false`.
  - `reviewDecision === null` and one reviewer with single APPROVED review → returns `true`.
  - `reviewDecision === null` and two reviewers, both APPROVED (latest each) → returns `true`.
  - `reviewDecision === null` and two reviewers, one APPROVED + one CHANGES_REQUESTED → returns `false`.
  - `reviewDecision === null` and same reviewer APPROVED then CHANGES_REQUESTED (latest is CHANGES_REQUESTED) → returns `false`.
  - `reviewDecision === null` and same reviewer CHANGES_REQUESTED then APPROVED (latest is APPROVED) → returns `true`.
  - `reviewDecision === null` and empty reviews list → returns `false`.
  - `gh` CLI throws → returns `false` and logs a warning (existing fail-safe contract).
- `isApprovedFromReviewsList` cases (cover the same scenarios at a tighter unit boundary):
  - Empty list → `false`.
  - Single APPROVED → `true`.
  - Single CHANGES_REQUESTED → `false`.
  - Two reviewers, both APPROVED → `true`.
  - Two reviewers, one APPROVED + one CHANGES_REQUESTED → `false`.
  - Same reviewer APPROVED then CHANGES_REQUESTED → `false`.
  - Same reviewer CHANGES_REQUESTED then APPROVED → `true`.
  - Same reviewer APPROVED then DISMISSED → `false` (DISMISSED latest is not approval).
  - Reviewer with `author === null` → silently ignored (defensive).

### 8. Update BDD scenarios in `features/`

- Rename `features/hitl_label_gate_automerge.feature` to `features/awaiting_merge_approval_gate.feature` (or keep the filename and rewrite — pick whichever produces a smaller diff in `features/step_definitions/`).
- **Drop** the `@adw-483 @regression` adwMerge.tsx HITL scenarios (the lines starting at "## ── adwMerge.tsx hitl gate (issue #483) ─────"). Keep the `autoMergePhase` scenarios (autoMergePhase still applies the `hitl` label as an informational marker).
- **Add** `@adw-488 @regression` scenarios for `adwMerge.tsx`:
  - `adwMerge.tsx imports fetchPRApprovalState`
  - `adwMerge.tsx calls fetchPRApprovalState before mergeWithConflictResolution`
  - `adwMerge.tsx skips mergeWithConflictResolution when the PR is not approved`
  - `adwMerge.tsx not-approved early-return does not write workflowStage` (any value — assert no writeTopLevelState call appears in the block)
  - `adwMerge.tsx not-approved early-return returns an outcome with reason "awaiting_approval"`
- **Add** `@adw-488 @regression` scenarios for `shouldDispatchMerge`:
  - `mergeDispatchGate.ts exports shouldDispatchMerge`
  - `shouldDispatchMerge consults the spawn lock` (string match for `readSpawnLockRecord`)
  - `shouldDispatchMerge defers when the lock is held by a live PID` (string match for the `false` return path under `isLive` / `isProcessLive`)
  - `trigger_cron.ts calls shouldDispatchMerge before spawning adwMerge`
  - `trigger_cron.ts no longer references processedMerges`
- **Add** step definitions for the new scenarios in a new file `features/step_definitions/awaitingMergeApprovalGateSteps.ts` (or extend `hitlLabelGateAutomergeSteps.ts` if rename-only). Reuse `extractHitlBlockBody` style helpers — generalize the `extractHitlBlockBody` pattern to extract any `if (...)`-block by predicate (the existing helper already does this); add a small wrapper `extractApprovalBlockBody(content)` that searches for `fetchPRApprovalState(`.

### 9. Run validation commands

- See **Validation Commands** below. Run lint, type-check, unit tests, and the relevant BDD tag suites. Confirm:
  - Type-check passes for the entire ADW codebase.
  - Unit tests pass — including the four new `mergeDispatchGate` cases, the rewritten `adwMerge` approval cases, the new `prApi.test.ts`, and the trimmed `processed.merges` cases.
  - BDD scenarios under `@adw-329-hitl-label-gate` (kept ones) and `@adw-488` (new ones) pass.
  - The `@regression` suite passes.

### 10. Manual smoke verification

After all code changes are in:

1. From a clean state, write a unit test that exercises `executeMerge` with `fetchPRApprovalState` returning `true` and a mocked `mergeWithConflictResolution` — confirm the merge fires.
2. Run `bun run test:unit` and confirm no new failures.
3. (Optional, not required for plan completion) Manually approve a PR on a test repo and verify the next cron cycle dispatches `adwMerge` and merges. This requires a live cron and is out of scope for the unit-test-only validation gate.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

- `bun run lint` — Run linter to check for code quality issues.
- `bunx tsc --noEmit` — Root TypeScript type-check.
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW TypeScript type-check (catches the dropped `issueHasLabel` import in `adwMerge.tsx` and stale `merges` field references).
- `bun run test:unit` — Run all Vitest unit tests. Expect:
  - `adws/__tests__/adwMerge.test.ts` — new approval-gate cases pass; old hitl-gate cases removed.
  - `adws/triggers/__tests__/triggerCronAwaitingMerge.test.ts` — `processed.merges` cases removed; remaining cases pass.
  - `adws/triggers/__tests__/cancelHandler.test.ts` — `merges` removed from fixtures; remaining cases pass.
  - `adws/triggers/__tests__/mergeDispatchGate.test.ts` — new file, four cases pass.
  - `adws/github/__tests__/prApi.test.ts` — new file, all `fetchPRApprovalState` and `isApprovedFromReviewsList` cases pass.
- `bun run build` — Build the application; verify no build errors.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-488"` — New BDD scenarios for this fix pass.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-329-hitl-label-gate"` — Remaining `autoMergePhase` HITL scenarios still pass (the `@adw-483` adwMerge ones are deleted).
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — Full regression suite passes with zero new failures.

### Reproducer-only validation (non-automated)

Before the fix, this scenario fails:

1. Start a fresh cron process pointed at a test repo.
2. Add the `hitl` label to an open issue, run an SDLC workflow that lands at `awaiting_merge`.
3. Cron dispatches `adwMerge` once, exits `hitl_blocked`, the issue lands in `processedMerges`.
4. Approve the PR via GitHub Reviews; remove the `hitl` label.
5. Observe cron logs: `filtered: #N(processed)` indefinitely. PR never merges.

After the fix, the same scenario succeeds:

1. Cron dispatches `adwMerge`; with no approval, `executeMerge` returns `awaiting_approval` and exits without writing state.
2. On the next cycle, `shouldDispatchMerge` returns `true` (no orchestrator running), the cron re-dispatches.
3. Once the human approves, `fetchPRApprovalState` returns `true`, the merge fires, state moves to `completed`.

## Notes

- A `guidelines/` directory exists in this repo. The plan implicitly follows: dependency injection via `MergeDeps`/`MergeDispatchDeps`, log statements use the existing `log()` helper, no new external libraries.
- `processedSpawns` is intentionally NOT changed in this fix. It has the same latent bug class but a smaller blast radius — `isActiveStage` covers it once the orchestrator writes its first state file. The issue lists this as out of scope.
- `autoMergePhase.ts` keeps the `hitl` label-write behavior. The label remains useful for GitHub-side filtering ("show me all issues blocked on human approval"), it's just no longer load-bearing for merge dispatch. Out of scope per the issue.
- `adwInit` does not enforce branch protection on target repos. The new `fetchPRApprovalState` fallback (`reviewDecision === null` → per-reviewer-latest aggregation) handles unprotected repos correctly without requiring repo-side configuration.
- **Operational rollout (informational, not part of this plan):** The running cron must be restarted to pick up the new code (its in-memory `processedMerges` is what's blocking `vestmatic#52`'s recovery). After restart, all current `awaiting_merge` issues re-evaluate; approved ones merge, unapproved ones bootstrap-and-exit (~3s every 20s) until the human approves.
- For `vestmatic#52` specifically: PR has APPROVED reviews and conflicts. After restart, `adwMerge` dispatches → sees approval → enters `mergeWithConflictResolution` → invokes `/resolve_conflict` agent. Conflict resolution outcome depends on the agent and is not in scope of this fix.
- The `reason: 'awaiting_approval'` literal replaces `'hitl_blocked'`. Cron telemetry/log readers that look for `hitl_blocked` in log lines will need updating; there are no current call sites that branch on this string outside of `main()`'s exit-code check, which only branches on `merge_failed`.
