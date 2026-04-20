# Paused-Resume Verifies Canonical Claim

**ADW ID:** bzlaaq-orchestrator-resilie
**Date:** 2026-04-21
**Specification:** specs/issue-466-adw-bzlaaq-orchestrator-resilie-sdlc_planner-resume-verify-canonical-claim.md

## Overview

Hardens `resumeWorkflow()` in `adws/triggers/pauseQueueScanner.ts` so that the pause-queue scanner verifies two invariants before spawning a resumed orchestrator: (1) the per-issue spawn lock is free (no other orchestrator is running for the same issue), and (2) the top-level `state.json` `adwId` still matches the pause-queue entry. This closes the last window where split-brain or manual state edits could cause two orchestrators to continue the same work.

## What Was Built

- **Spawn-lock acquisition on resume** — `resumeWorkflow()` calls `acquireIssueSpawnLock(repoInfo, entry.issueNumber, process.pid)` before the child spawn. If the lock is held by a live process, it logs a warning and leaves the entry in the queue for next-cycle retry.
- **Canonical `adwId` verification** — After acquiring the lock, reads the top-level state file via `AgentStateManager.readTopLevelState(entry.adwId)` and checks that `state.adwId === entry.adwId`. Aborts on divergence or missing state file.
- **Asymmetric abort handling** — Lock-held (transient): leave queue entry, no error comment, no state rewrite. Claim-diverged (unrecoverable): remove queue entry, post `error` stage comment on the GitHub issue, release lock, no state rewrite.
- **Happy-path lock release** — Releases the verification-only lock before the child spawn so the child's `acquireOrchestratorLock` during startup succeeds without deadlocking.
- **Unit tests** — Four new `it()` blocks covering: matching-claim proceeds, `adwId` mismatch aborts, missing state file aborts, lock-held aborts.

## Technical Implementation

### Files Modified

- `adws/triggers/pauseQueueScanner.ts`: Added `acquireIssueSpawnLock`/`releaseIssueSpawnLock` and `AgentStateManager` imports; inserted canonical-claim verification block between the worktree-exists check and the log-fd/spawn block.
- `adws/triggers/__tests__/pauseQueueScanner.test.ts`: Added `vi.mock` blocks for `../spawnGate` and `../../core/agentState`; extended `beforeEach` with default passing mocks; added four new test cases in the `resumeWorkflow` describe block.

### Key Changes

- The verification block sits between the existing worktree-exists check (line ~119) and the `const resumeLogDir = ...` block, in strict pre-spawn position per the `ope038` side-effect ordering contract.
- Lock acquisition uses `process.pid` as the claiming PID; the lock is held only for the verification window (acquire → verify → release), mirroring the `webhookGatekeeper` short-lived-lock pattern from `0cv18u`.
- Claim-divergence is treated as unrecoverable: `removeFromPauseQueue(entry.adwId)` stops the scanner from re-logging every cron cycle, and `postIssueStageComment(..., 'error', ...)` surfaces the conflict to the operator.
- Lock-held divergence is treated as transient: no queue mutation, no error comment — the next cron cycle will retry once the live holder exits.
- No `writeTopLevelState` is called in any abort path, satisfying the "does not rewrite state" acceptance criterion.

## How to Use

The feature is transparent during normal operation. On the happy path (paused → resume → continue), behavior is unchanged. Two new observable behaviors on abort:

1. **Lock held by another process** — `warn` log line: `Paused workflow {adwId}: spawn lock held for {owner}/{repo}#{issue} — skipping resume this cycle`. No GitHub comment. The queue entry remains; the scanner retries next cycle.
2. **Canonical claim diverged** — `error` log line: `Paused workflow {adwId}: canonical claim diverged (expected adwId={expected}, observed={observed}) — removing from queue`. A `## :x: Error` stage comment is posted on the GitHub issue naming the divergence. The queue entry is removed; manual operator intervention is required to restore the state file or re-queue the workflow.

## Configuration

No new configuration. Uses existing primitives:

- `adws/triggers/spawnGate.ts` — `acquireIssueSpawnLock` / `releaseIssueSpawnLock`
- `adws/core/agentState.ts` — `AgentStateManager.readTopLevelState`
- `adws/core/pauseQueue.ts` — `removeFromPauseQueue`
- `adws/phases/phaseCommentHelpers.ts` — `postIssueStageComment`

## Testing

Run the targeted unit test file:

```bash
bunx vitest run adws/triggers/__tests__/pauseQueueScanner.test.ts
```

Full validation suite:

```bash
bun run lint
bunx tsc --noEmit
bunx tsc --noEmit -p adws/tsconfig.json
bun run test:unit
bun run build
```

## Notes

- **Lock-release gap is intentional.** The scanner releases the per-issue lock before spawning the child. The child reacquires it as an orchestrator-lifetime lock in `initializeWorkflow`. The brief gap is acceptable per the `yxo18t` lifetime-lock design.
- **No new modules.** All primitives already existed; this slice wires them into the pause-resume path.
- **Operator recovery for claim divergence.** If the state file was manually edited or replaced by a future takeover handler, an operator must either restore `agents/{adwId}/state.json` with the correct `adwId` or re-queue the workflow via a manual `paused_queue.json` edit.
- **Out of scope.** `takeoverHandler`, `remoteReconcile`, `worktreeReset`, and `hungOrchestratorDetector` are separate PRD slices and are not touched here.
