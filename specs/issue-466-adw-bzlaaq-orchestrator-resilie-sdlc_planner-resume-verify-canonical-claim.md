# Feature: Paused-Resume Verifies Canonical Claim

## Metadata
issueNumber: `466`
adwId: `bzlaaq-orchestrator-resilie`
issueJson: `{"number":466,"title":"orchestrator-resilience: paused resume verifies canonical claim","body":"## Parent PRD\n\n`specs/prd/orchestrator-coordination-resilience.md`\n\n## What to build\n\nOn resume of a paused orchestrator, verify the resuming process still holds the canonical claim (per-issue lock + matching `adwId` in the top-level state) before proceeding. This prevents the manual-state-edit and split-brain cases from producing two orchestrators continuing the same work. The pause queue scanner remains the sole resumer of paused workflows — the takeover handler treats `paused` as a no-op. See the \"Takeover decision tree\" and \"Further Notes\" sections of the PRD.\n\n## Acceptance criteria\n\n- [ ] `pauseQueueScanner` resume path acquires the per-issue spawn lock before continuing\n- [ ] Resume path re-reads top-level state and aborts if `adwId` diverges from the expected value\n- [ ] Abort emits a clear log line naming the conflict and does not rewrite state\n- [ ] Unit test covers: resume with matching claim proceeds, resume after manual `adwId` edit aborts, resume when lock is already held by another process aborts\n- [ ] No behavior change for the happy path (paused → resume → continue)\n\n## Blocked by\n\n- Blocked by #463\n\n## User stories addressed\n\n- User story 15","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-04-20T11:05:45Z","comments":[],"actionableComment":null}`

## Feature Description

Harden `resumeWorkflow()` in `adws/triggers/pauseQueueScanner.ts` so that it only proceeds to spawn when it can simultaneously prove (a) the per-issue spawn lock is free (no other orchestrator is running for the same issue) AND (b) the top-level state file's `adwId` still matches the pause-queue entry's `adwId` (no split-brain, no manual edit).

This is PRD slice #15 of the orchestrator coordination and resilience initiative. It closes the last window where two orchestrators can end up continuing the same work: the pause-resume path was previously a blind spawn with no coordination check against the canonical claim.

On abort (either the lock is held by a live PID, or the state's `adwId` has drifted), the resume path logs a clear diagnostic line and does **not** rewrite the top-level state. The pause queue entry is removed on claim-divergence (unrecoverable without operator intervention) and left in place on lock-held (transient — next cycle may succeed once the live holder exits).

## User Story

As an ADW developer
I want a paused orchestrator's resume path to verify it still owns the canonical claim before proceeding
So that the manual-edit-state or split-brain case does not produce two orchestrators continuing the same work

## Problem Statement

`resumeWorkflow()` currently reads a pause-queue entry and spawns the orchestrator without checking two invariants that the rest of the orchestrator coordination layer now enforces:

1. **Per-issue spawn lock.** Slice #463 extended `spawnGate` to hold the per-issue lock for the orchestrator's full lifetime. The pause-queue scanner ignores this lock, so it can spawn a resume child while another orchestrator is still running for the same issue (either a takeover orchestrator started from the cron sweeper, or a split-brain case where the webhook classifier spawned a fresh one).
2. **Canonical `adwId` in top-level state.** The pause-queue entry records the `adwId` that paused. If an operator manually edits `agents/{adwId}/state.json` (or a future takeover handler rewrites the canonical claim to a different `adwId`), the scanner should detect that the claim has drifted and abort rather than resurrect a stale `adwId`.

Without these checks, the 2026-04-18 class of incidents can still produce two orchestrators running against the same issue — one from the resume path, another from the cron takeover or webhook spawn — silently diverging the work and racing on branch, PR, and state writes.

## Solution Statement

Add a canonical-claim verification step at the top of `resumeWorkflow()`, between the existing worktree-exists check and the child-process spawn. The check uses the two already-built primitives: `acquireIssueSpawnLock`/`releaseIssueSpawnLock` from `adws/triggers/spawnGate.ts` and `AgentStateManager.readTopLevelState` from `adws/core/agentState.ts`. No new modules.

The sequence is:

1. **Worktree-exists** (unchanged).
2. **Acquire per-issue spawn lock** (new). If acquisition fails, the lock is held by a live process with a different PID — log "spawn lock held" naming the `adwId`, repo, and issue; do not rewrite state; leave the pause-queue entry in place for next-cycle retry; return.
3. **Read top-level state and verify `adwId`** (new). If the state file is missing OR `state.adwId !== entry.adwId`, log "canonical claim diverged" naming the expected `adwId`, the observed `adwId` (or `null`), and the issue; release the lock; remove the entry from the pause queue; post an `error` stage comment on the GitHub issue describing the divergence (so the operator is notified); return. Do not rewrite state.
4. **Release the lock** (new). The orchestrator-lifetime lock will be reacquired by the spawned child during its own startup (per `adws/phases/orchestratorLock.ts` contract). The brief gap between release and child acquisition is explicitly acceptable per the `yxo18t` orchestrator-lifetime-lock design.
5. **Spawn the child** (unchanged — existing readiness-window logic handles the child-exits-early case via `probeFailures` increment).

The lock-and-release pattern mirrors the existing `webhookGatekeeper.classifyAndSpawnWorkflow` pattern: trigger-side holds the lock only long enough to verify the invariant, then releases before spawn so the spawned orchestrator can acquire its own long-lived lock.

Happy-path behavior (state's `adwId` matches, lock is free) is unchanged: acquire → verify → release → spawn → await readiness → commit side-effects.

## Relevant Files

Use these files to implement the feature:

- `adws/triggers/pauseQueueScanner.ts` — contains `resumeWorkflow()`; this is the single file where the canonical-claim check is added. The existing structure (worktree check, log-fd open, spawn, readiness window, side-effect commit) is preserved; the new check slots in between the worktree check and the spawn.
- `adws/triggers/spawnGate.ts` — exports `acquireIssueSpawnLock(repoInfo, issueNumber, pid)` and `releaseIssueSpawnLock(repoInfo, issueNumber)`. The scanner's resume path will call these directly (not via `orchestratorLock.ts`, which requires a `WorkflowConfig` that the scanner does not have).
- `adws/core/agentState.ts` — exports `AgentStateManager.readTopLevelState(adwId)` which returns `AgentState | null`. `AgentState.adwId` (see `adws/types/agentTypes.ts:204`) is the field to compare against.
- `adws/types/agentTypes.ts` — `AgentState` type; relevant field is `adwId: string` at the top level.
- `adws/core/pauseQueue.ts` — `PausedWorkflow` type and queue helpers (`removeFromPauseQueue`). Already imported by the scanner; no changes needed.
- `adws/github/githubApi.ts` — `getRepoInfo()` and `RepoInfo` type. Already imported by the scanner.
- `adws/phases/phaseCommentHelpers.ts` — `postIssueStageComment(repoContext, issueNumber, stage, data)` for the error comment on claim divergence. Already imported by the scanner.
- `adws/triggers/__tests__/pauseQueueScanner.test.ts` — existing vitest file using module-level `vi.mock` of `child_process`, `fs`, and ADW modules. The new test cases follow the same pattern: add module mocks for `spawnGate` and `agentState`, extend the `makeEntry` helper, add three new `it()` blocks.
- `adws/triggers/__tests__/spawnGate.test.ts` — reference for how `spawnGate` is tested; no changes required here, but the patterns (mocking `processLiveness`) transfer to the scanner test.

### New Files

None. All changes are contained in existing files.

### Conditional documentation

Per `.adw/conditional_docs.md`, the following existing app docs establish constraints this slice must respect. They are reference reading, not modification targets:

- `app_docs/feature-ope038-pause-queue-resume-spawn-hardening.md` — establishes the `spawn → await-readiness → remove+post` side-effect ordering. The new canonical-claim check must run **before** spawn, not after readiness.
- `app_docs/feature-yxo18t-spawngate-lifetime-pid-liveness.md` — establishes that the spawn lock is held by the orchestrator process for its full lifetime. The scanner must acquire and release its verification-only lock, leaving the gap for the child to acquire.
- `app_docs/feature-xlv8zk-process-liveness-module.md` — establishes PID+start-time liveness semantics used by `acquireIssueSpawnLock`. The scanner does not call `processLiveness` directly; it goes through `acquireIssueSpawnLock`.
- `app_docs/feature-0cv18u-fix-cross-trigger-spawn-dedup.md` — establishes the trigger-side short-lived-lock pattern that the resume path now mirrors.
- `app_docs/feature-chpy1a-generic-pipeline-runner-pause-resume.md` — establishes the `paused` → enqueue → probe → resume lifecycle. The new check is the last missing coordination primitive on the resume side.

## Implementation Plan

### Phase 1: Foundation

No foundational work required — all primitives exist (`spawnGate` per #449 and #463, `AgentStateManager.readTopLevelState` from the existing state module, `postIssueStageComment` for error notification). The PRD's `processLiveness`, `heartbeat`, and `takeoverHandler` modules from earlier slices are already wired into `spawnGate`, so the scanner gets PID-reuse-safe liveness for free via `acquireIssueSpawnLock`.

### Phase 2: Core Implementation

Add the canonical-claim verification block to `resumeWorkflow()` in `adws/triggers/pauseQueueScanner.ts`:

1. Call `getRepoInfo()` (already called at the top of the function) to get `repoInfo` in scope.
2. After the worktree-exists check and before the log-fd open / spawn block, insert:
   - A call to `acquireIssueSpawnLock(repoInfo, entry.issueNumber, process.pid)`. On `false`, log a clear warning line naming `adwId`, `repoKey`, and `issueNumber`; do not touch the pause queue; do not call `writeTopLevelState`; return.
   - A call to `AgentStateManager.readTopLevelState(entry.adwId)`. If the result is `null` OR its `adwId` field does not equal `entry.adwId`, release the lock, log a clear error line (observed value vs expected), remove the entry from the pause queue via `removeFromPauseQueue`, post a stage `'error'` comment via `postIssueStageComment` with a message naming the divergence, and return. Do not call `writeTopLevelState`.
   - A call to `releaseIssueSpawnLock(repoInfo, entry.issueNumber)` on the happy path, so the spawned child can acquire its own lifetime lock during startup.
3. Proceed with the existing log-fd open / spawn / await-readiness / commit-side-effects flow unchanged.

Design constraints enforced:

- **No state rewrites on abort.** Neither the lock-held path nor the claim-diverged path calls `writeTopLevelState`. This matches the acceptance criterion "Abort emits a clear log line naming the conflict and does not rewrite state."
- **Pause-queue handling on abort is asymmetric by design.** Lock-held is transient (leave entry; retry next cycle). Claim-diverged is unrecoverable without operator action (remove entry so the scanner stops re-logging the same divergence every cycle; post error comment so the operator is notified).
- **Lock is held only for the verification window, not across the spawn.** This mirrors `webhookGatekeeper.ts`'s `acquire → classify → release → spawn` pattern and avoids double-acquire contention with the spawned child's orchestrator-lifetime lock.
- **No dependency injection refactor.** The existing scanner uses module-level imports and the existing test file mocks them via `vi.mock`. New tests add mocks for `spawnGate` and `agentState` following the same convention — no scanner API change.

### Phase 3: Integration

The resume-path canonical-claim check integrates with three existing primitives without modifying them:

- **`spawnGate`**: the scanner acquires the same per-issue lock the orchestrator-lifetime lock uses, but only briefly. Because the lock is released before the child spawn, the child's own `acquireOrchestratorLock` during `initializeWorkflow` still succeeds in the common case.
- **`AgentStateManager`**: the scanner reads the top-level state via the existing public helper. No write path is taken in any of the new branches.
- **Pause queue**: the scanner continues to drive queue-entry lifecycle (remove on unrecoverable abort, leave on transient). No queue-schema change.

No other orchestrators, triggers, or phases need changes. The BDD/cucumber layer for slice #463 (`features/spawngate_lifetime_pid_liveness.feature`) is unaffected because it does not cover the resume path; any BDD coverage for this slice is deferred to a follow-up if the integration BDD suite is extended.

## Step by Step Tasks

Execute every step in order, top to bottom.

### Step 1: Confirm the scanner can import `acquireIssueSpawnLock` / `releaseIssueSpawnLock`

- Read `adws/triggers/pauseQueueScanner.ts` lines 1–25 to confirm existing imports.
- Verify that `spawnGate.ts` is importable as `./spawnGate` from the same `adws/triggers/` directory.
- No code change yet; this is a read-only confirmation step before editing.

### Step 2: Add `acquireIssueSpawnLock` / `releaseIssueSpawnLock` and `AgentStateManager` imports

- In `adws/triggers/pauseQueueScanner.ts`, add `import { acquireIssueSpawnLock, releaseIssueSpawnLock } from './spawnGate';`
- Add `import { AgentStateManager } from '../core/agentState';` (prefer the class's static method over a bare export to match existing usage across the codebase).
- Keep other imports unchanged.

### Step 3: Factor the existing `getRepoInfo()` + `activateGitHubAppAuth` call so `repoInfo` is in scope for the verification block

- `resumeWorkflow` already calls `getRepoInfo()` at the top. Leave that call in place; just make sure `repoInfo` is available for the new block (it already is — line 98).

### Step 4: Insert the acquire-lock step after the worktree-exists check

- After the worktree-exists branch returns (around line 120 of `pauseQueueScanner.ts`) and **before** the `const resumeLogDir = ...` block, add:

```ts
// Canonical-claim verification: per-issue spawn lock + matching adwId in top-level state.
// Prevents resume-path spawn when another orchestrator holds the claim (split-brain)
// or when the state file's adwId has been manually edited / rewritten.
if (!acquireIssueSpawnLock(repoInfo, entry.issueNumber, process.pid)) {
  log(
    `Paused workflow ${entry.adwId}: spawn lock held for ${repoInfo.owner}/${repoInfo.repo}#${entry.issueNumber} — skipping resume this cycle`,
    'warn',
  );
  return;
}
```

- Rationale: returning leaves the pause-queue entry in place for next-cycle retry (transient contention); no state write.

### Step 5: Insert the read-top-level-state check immediately after the lock acquisition

- After the lock-acquire block, add:

```ts
const topLevelState = AgentStateManager.readTopLevelState(entry.adwId);
if (!topLevelState || topLevelState.adwId !== entry.adwId) {
  const observed = topLevelState?.adwId ?? null;
  log(
    `Paused workflow ${entry.adwId}: canonical claim diverged (expected adwId=${entry.adwId}, observed=${observed}) — removing from queue`,
    'error',
  );
  releaseIssueSpawnLock(repoInfo, entry.issueNumber);
  removeFromPauseQueue(entry.adwId);
  try {
    const repoContext = createRepoContext({
      repoId: { owner: repoInfo.owner, repo: repoInfo.repo, platform: Platform.GitHub },
      cwd: process.cwd(),
    });
    postIssueStageComment(repoContext, entry.issueNumber, 'error', {
      issueNumber: entry.issueNumber,
      adwId: entry.adwId,
      errorMessage: `Workflow paused at '${entry.pausedAtPhase}' could not resume: canonical claim diverged (expected adwId=${entry.adwId}, observed=${observed ?? 'missing state file'}). Manual inspection required.`,
    });
  } catch {
    // Non-fatal — mirror the worktree-gone branch's error-comment best-effort pattern
  }
  return;
}
```

- Rationale: claim-divergence is unrecoverable without operator action; removing the queue entry stops the scanner from re-logging every cycle. The error comment surfaces the situation to the operator. No `writeTopLevelState` call.

### Step 6: Insert the release-lock step on the happy path

- After the verification block (i.e., after the `if (!topLevelState || ...)` return), add:

```ts
// Release the verification-only lock so the spawned child's acquireOrchestratorLock
// can take over the lifetime lock. The brief gap is acceptable per slice #463.
releaseIssueSpawnLock(repoInfo, entry.issueNumber);
```

- The existing spawn, log-fd open, readiness-window, and side-effect commit logic below follows unchanged.

### Step 7: Write a unit test covering "resume with matching claim proceeds"

- In `adws/triggers/__tests__/pauseQueueScanner.test.ts`, add module-level `vi.mock('../spawnGate', ...)` exporting `acquireIssueSpawnLock: vi.fn(() => true)` and `releaseIssueSpawnLock: vi.fn()`.
- Add module-level `vi.mock('../../core/agentState', ...)` exporting `AgentStateManager: { readTopLevelState: vi.fn() }`.
- In a new `describe('resumeWorkflow canonical-claim verification', () => { ... })` block or extending the existing describe, add:

```ts
it('resume with matching claim proceeds to spawn and commits side-effects', async () => {
  vi.mocked(AgentStateManager.readTopLevelState).mockReturnValue({
    adwId: 'test-adw-123',
    // ... minimum AgentState shape sufficient for the scanner's check
  } as unknown as AgentState);
  vi.mocked(acquireIssueSpawnLock).mockReturnValue(true);
  const child = makeFakeChild();
  vi.mocked(childProcess.spawn).mockReturnValue(child as unknown as ReturnType<typeof childProcess.spawn>);

  const entry = makeEntry({ adwId: 'test-adw-123' });
  const promise = resumeWorkflow(entry);
  await vi.runAllTimersAsync();
  await promise;

  expect(acquireIssueSpawnLock).toHaveBeenCalledWith(
    expect.objectContaining({ owner: 'test-owner', repo: 'test-repo' }),
    entry.issueNumber,
    process.pid,
  );
  expect(releaseIssueSpawnLock).toHaveBeenCalled();
  expect(childProcess.spawn).toHaveBeenCalledOnce();
  expect(removeFromPauseQueue).toHaveBeenCalledWith(entry.adwId);
  expect(postIssueStageComment).toHaveBeenCalledWith(
    expect.anything(),
    entry.issueNumber,
    'resumed',
    expect.objectContaining({ adwId: entry.adwId }),
  );
});
```

### Step 8: Write a unit test covering "resume after manual `adwId` edit aborts"

- Add:

```ts
it('aborts when top-level state adwId diverges from the entry adwId', async () => {
  vi.mocked(acquireIssueSpawnLock).mockReturnValue(true);
  vi.mocked(AgentStateManager.readTopLevelState).mockReturnValue({
    adwId: 'someone-else-adw',
  } as unknown as AgentState);

  const entry = makeEntry({ adwId: 'test-adw-123' });
  await resumeWorkflow(entry);

  expect(childProcess.spawn).not.toHaveBeenCalled();
  expect(releaseIssueSpawnLock).toHaveBeenCalled();
  expect(removeFromPauseQueue).toHaveBeenCalledWith(entry.adwId);
  expect(postIssueStageComment).toHaveBeenCalledWith(
    expect.anything(),
    entry.issueNumber,
    'error',
    expect.objectContaining({
      errorMessage: expect.stringContaining('canonical claim diverged'),
    }),
  );
  // Must NOT have touched writeTopLevelState
  // (AgentStateManager.writeTopLevelState is not mocked; ensure we did not call it —
  //  use a spy if the test layer needs to assert this explicitly.)
});
```

- Also add a companion test for the state-missing sub-case: `vi.mocked(AgentStateManager.readTopLevelState).mockReturnValue(null)` → same assertions, with `observed=null` wording in the error comment.

### Step 9: Write a unit test covering "resume when lock is already held by another process aborts"

- Add:

```ts
it('aborts when spawn lock is already held by another live process', async () => {
  vi.mocked(acquireIssueSpawnLock).mockReturnValue(false);

  const entry = makeEntry();
  await resumeWorkflow(entry);

  expect(childProcess.spawn).not.toHaveBeenCalled();
  expect(AgentStateManager.readTopLevelState).not.toHaveBeenCalled();
  expect(releaseIssueSpawnLock).not.toHaveBeenCalled(); // we never held it
  expect(removeFromPauseQueue).not.toHaveBeenCalled(); // transient — leave for retry
  expect(postIssueStageComment).not.toHaveBeenCalled();
});
```

### Step 10: Confirm "no behavior change for happy path" with an explicit regression test

- The existing happy-path test (`adws/triggers/__tests__/pauseQueueScanner.test.ts:172`) asserts `removeFromPauseQueue` is called with the `adwId` and `postIssueStageComment('resumed', ...)` is posted. With the new canonical-claim block in place, that test must continue to pass. Ensure the existing test sets up `acquireIssueSpawnLock` → `true` and `readTopLevelState` → matching-adwId mocks in its `beforeEach` or setup so the check passes through.
- If the existing test breaks because the default mock values are missing, extend `beforeEach` in `describe('resumeWorkflow', ...)` to set `vi.mocked(acquireIssueSpawnLock).mockReturnValue(true)` and `vi.mocked(AgentStateManager.readTopLevelState).mockReturnValue({ adwId: ANY })` as a default that lets existing tests pass through.

### Step 11: Run the validation commands

- Run the commands listed in the `Validation Commands` section below and confirm zero failures and zero regressions across lint, typecheck (root + `adws/tsconfig.json`), unit tests, and build.

## Testing Strategy

### Unit Tests

`.adw/project.md` contains `## Unit Tests: enabled`, so unit tests are required.

All unit tests live in `adws/triggers/__tests__/pauseQueueScanner.test.ts`. Follow the existing file's patterns:

- **Module-level mocks only.** Do not introduce dependency-injection on `resumeWorkflow`. Mock `../spawnGate` (both `acquireIssueSpawnLock` and `releaseIssueSpawnLock`) and `../../core/agentState` (at minimum `AgentStateManager.readTopLevelState`) via `vi.mock`.
- **Use `makeEntry()` helper** (line 66 of existing test) for pause-queue entry construction; extend as needed with `adwId` overrides.
- **Use `makeFakeChild()` helper** (line 83) for the spawned-child stub; no changes needed.
- **Assert on observable side-effects**: whether `childProcess.spawn` was called, whether `removeFromPauseQueue` was called, whether `postIssueStageComment` was called (and with which `stage`), whether `releaseIssueSpawnLock` was called. Do not assert on log output.
- **Default mock setup in `beforeEach`** so pre-existing tests continue to pass: `acquireIssueSpawnLock → true`, `readTopLevelState → { adwId: entry.adwId }` matching the default `makeEntry` adwId (`'test-adw-123'`).

Tests to add:

1. `'resume with matching claim proceeds to spawn and commits side-effects'` — acquire=true, readTopLevelState returns matching adwId. Assert spawn was called, readiness fired, side-effects committed, `releaseIssueSpawnLock` called exactly once.
2. `'aborts when top-level state adwId diverges from the entry adwId'` — acquire=true, readTopLevelState returns `{ adwId: 'different' }`. Assert no spawn, `releaseIssueSpawnLock` called, `removeFromPauseQueue` called, error comment posted with `'canonical claim diverged'` in `errorMessage`.
3. `'aborts when top-level state file is missing'` — acquire=true, readTopLevelState returns `null`. Same assertions as #2 but error comment wording indicates `missing state file`.
4. `'aborts when spawn lock is already held by another live process'` — acquire=false. Assert no spawn, no `readTopLevelState` call, no `releaseIssueSpawnLock` call (never held), entry NOT removed from queue, no error comment.
5. (Regression sanity) The existing `'happy path'`, `'early child exit'`, `'spawn stdio includes log fd'`, `'spawn cwd is process.cwd()'` tests continue to pass with the default mocks in place.

### Edge Cases

- **State file missing entirely.** Treated the same as `adwId` divergence: abort, remove from queue, post error comment. Rationale: either case is unrecoverable for the scanner alone and warrants operator attention.
- **Lock acquired but between acquire and read the state file changes.** Out of scope — the acquire-lock step provides per-issue mutual exclusion, and the scanner's lock covers the read-and-decide window.
- **Process.pid is 0 or not a real pid.** Not possible in the cron runtime; `process.pid` is always a positive integer in Node.
- **Concurrent scanner instances.** The `wx` exclusive-create behavior of `spawnGate` already guarantees at most one acquires the lock; the other returns `false` and hits the lock-held abort path (leave entry in queue for next cycle).
- **Child crashes during its own `acquireOrchestratorLock`.** The existing readiness-window logic detects early child exit, increments `probeFailures`, and leaves the entry in place. No change needed.
- **Operator manually removes the state file.** `readTopLevelState` returns `null` → claim-divergence abort → entry removed, error comment posted.

## Acceptance Criteria

- [ ] `pauseQueueScanner.ts` `resumeWorkflow()` calls `acquireIssueSpawnLock(repoInfo, entry.issueNumber, process.pid)` before the child-process spawn, and returns without spawning when it returns `false`.
- [ ] After acquiring the lock, `resumeWorkflow()` calls `AgentStateManager.readTopLevelState(entry.adwId)` and returns without spawning when the result is `null` or `state.adwId !== entry.adwId`.
- [ ] Both abort paths emit a clear `log(..., 'warn' | 'error')` line naming the `adwId`, repo, issue, and the nature of the divergence (lock-held or claim-diverged). Neither path calls `AgentStateManager.writeTopLevelState`.
- [ ] The claim-diverged abort removes the entry from the pause queue via `removeFromPauseQueue` and posts a stage `'error'` comment on the GitHub issue; the lock-held abort does neither.
- [ ] On the happy path, `releaseIssueSpawnLock(repoInfo, entry.issueNumber)` is called exactly once after the verification passes and before the child-process spawn.
- [ ] Unit tests in `adws/triggers/__tests__/pauseQueueScanner.test.ts` cover: (a) matching-claim happy path, (b) `adwId` mismatch abort, (c) missing state file abort, (d) lock-held abort.
- [ ] Pre-existing unit tests in `pauseQueueScanner.test.ts` continue to pass without modification of their assertions (default mocks in `beforeEach` may need extension to satisfy the new check).
- [ ] `bun run lint`, `bunx tsc --noEmit`, `bunx tsc --noEmit -p adws/tsconfig.json`, `bun run test:unit`, and `bun run build` all pass with zero errors.

## Validation Commands

Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — run ESLint across the repo; must exit 0.
- `bunx tsc --noEmit` — root typecheck; must exit 0.
- `bunx tsc --noEmit -p adws/tsconfig.json` — `adws/` typecheck; must exit 0 (the additional-type-checks line in `.adw/commands.md`).
- `bunx vitest run adws/triggers/__tests__/pauseQueueScanner.test.ts` — targeted unit test run for the scanner; all cases (existing + new) pass.
- `bunx vitest run adws/triggers/__tests__/spawnGate.test.ts` — regression check that the spawnGate unit tests still pass unchanged.
- `bun run test:unit` — full unit-test suite; zero regressions.
- `bun run build` — build check; must exit 0.

## Notes

- **No library installs needed.** All primitives (`spawnGate`, `AgentStateManager`, `postIssueStageComment`, `removeFromPauseQueue`, `getRepoInfo`) are already in the codebase.
- **No new orchestrator changes.** This slice is scoped to the cron-side resume path. No `adws/adw*.tsx` entrypoint, no phase, and no other trigger needs changes.
- **No BDD/cucumber scenarios required for this slice.** The issue's acceptance criteria specify unit-test coverage only; integration coverage is scoped to later slices of the PRD.
- **Log wording is part of the contract.** The acceptance criterion "Abort emits a clear log line naming the conflict" means the log line must include both the `adwId` and the nature of the conflict (lock held vs. claim diverged). Reviewers will check this explicitly.
- **Coding guidelines.** If `guidelines/` exists in this repo, adhere strictly. A quick scan before implementation will confirm: avoid decorators, keep the helper inline (not over-abstracted), prefer editing existing files over creating new ones (no new module is needed for this slice).
- **Out of scope for this slice.** The PRD's `takeoverHandler`, `remoteReconcile`, `worktreeReset`, and `hungOrchestratorDetector` modules are separate slices (user stories #9, #11, #10, #16 respectively). This slice (#15) only wires the canonical-claim verification into the existing pause-queue resume path.
- **Future follow-up.** If the resume path ever grows a third check (e.g., remote-reconcile of `workflowStage`), the two-step `acquire → verify` block in this slice should factor into a helper (`verifyCanonicalClaim(entry, repoInfo): { ok: boolean; reason: 'lock_held' | 'claim_diverged'; observedAdwId: string | null }`) for testability. For this slice, keep it inline to match the existing style.
