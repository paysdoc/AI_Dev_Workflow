# Patch: Release per-issue spawn lock on cron take_over_adwId branch

## Metadata
adwId: `i4m1uk-orchestrator-resilie`
reviewChangeRequest: `Issue #1: adws/triggers/trigger_cron.ts:168-174 (the take_over_adwId branch of the cron spawn loop) spawns the orchestrator via spawnDetached but never calls releaseIssueSpawnLock. The cron process holds the per-issue spawn lock (acquired by evaluateCandidate using process.pid = cron PID) and continues running the cron loop. When the spawned child reaches acquireOrchestratorLock(config) (adws/adwSdlc.tsx:75 / adws/phases/orchestratorLock.ts:26), acquireIssueSpawnLock reads the existing lock record {pid: cronPid, pidStartedAt}, isProcessLive(cronPid, cronStart) returns true, so acquireIssueSpawnLock returns false and the child logs "spawn lock already held by another orchestrator; exiting" and calls process.exit(0). Subsequent cron cycles then return defer_live_holder (holderPid = cronPid) forever because the lock file keeps pointing at the still-alive cron PID. The abandoned workflow can never be taken over via cron. The webhook-side take_over branch in webhookGatekeeper.ts:69-78 does call releaseIssueSpawnLock after spawnDetached, matching the spec's "brief handoff window" pattern; the cron-side is inconsistent with this and with the spec's explicit classifyAndSpawnWorkflow release semantics. Resolution: Add releaseIssueSpawnLock(repoInfo, issue.number); after the spawnDetached(...) call in the take_over_adwId block of trigger_cron.ts, mirroring what classifyAndSpawnWorkflow does on its own take_over_adwId path.`

## Issue Summary
**Original Spec:** `specs/issue-467-adw-i4m1uk-orchestrator-resilie-sdlc_planner-takeover-handler-integration.md`
**Issue:** The cron take_over_adwId branch in `adws/triggers/trigger_cron.ts:168-174` calls `spawnDetached` but never releases the per-issue spawn lock that `evaluateCandidate` acquired with the cron process's PID. The lock file keeps pointing at the still-alive cron PID, so the spawned child (which calls `acquireOrchestratorLock` → `acquireIssueSpawnLock`) immediately exits with "spawn lock already held by another orchestrator", and every subsequent cron cycle returns `defer_live_holder` forever. The abandoned workflow can never be taken over via cron.
**Solution:** Add a single `releaseIssueSpawnLock(repoInfo, issue.number);` call after the `spawnDetached(...)` invocation in the cron `take_over_adwId` branch, mirroring the existing pattern in `webhookGatekeeper.ts::classifyAndSpawnWorkflow` (lines 69–78). This matches the PRD's "brief handoff window" lock-handoff semantics.

## Files to Modify
Use these files to implement the patch:

- `adws/triggers/trigger_cron.ts` — import `releaseIssueSpawnLock` from `./spawnGate` and call it after `spawnDetached` in the `take_over_adwId` branch.

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Import `releaseIssueSpawnLock` in trigger_cron.ts
- In the imports block at the top of `adws/triggers/trigger_cron.ts` (after the existing `import { evaluateCandidate } from './takeoverHandler';` line ~19), add a new line:
  ```ts
  import { releaseIssueSpawnLock } from './spawnGate';
  ```
- Do not modify any other imports. `spawnGate.ts` already exports `releaseIssueSpawnLock` (used by `webhookGatekeeper.ts`).

### Step 2: Release the spawn lock after spawnDetached on the take_over branch
- In the `if (takeoverDecision.kind === 'take_over_adwId')` block (currently lines 168–174 of `trigger_cron.ts`), insert a single line directly after the `spawnDetached(...)` call and before the `continue;` statement:
  ```ts
  releaseIssueSpawnLock(repoInfo, issue.number);
  ```
- This mirrors the release pattern already in `webhookGatekeeper.ts:69-78` (the take_over branch of `classifyAndSpawnWorkflow`). The brief handoff window between this release and the child orchestrator's `acquireOrchestratorLock` is acceptable per the spec's "Implementation Plan → Phase 3" section: both acquisitions target the same file path via `wx` atomicity and `processLiveness.isProcessLive` correctly identifies whichever process currently holds the lock.
- Do NOT add a release on the `defer_live_holder` or `skip_terminal` branches — `evaluateCandidate` already releases internally on those paths. Do NOT add a release after the `classifyAndSpawnWorkflow(...)` call on the `spawn_fresh` path — `classifyAndSpawnWorkflow` already releases on both success and error paths internally.

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `bun run lint` — run linter to check for code quality issues.
- `bunx tsc --noEmit` — type-check the full project.
- `bunx tsc --noEmit -p adws/tsconfig.json` — additional type-check scoped to the `adws/` tree.
- `bunx vitest run adws/triggers/__tests__/takeoverHandler.test.ts adws/triggers/__tests__/takeoverHandler.integration.test.ts adws/triggers/__tests__/spawnGate.test.ts adws/triggers/__tests__/webhookHandlers.test.ts adws/triggers/__tests__/triggerCronAwaitingMerge.test.ts` — focused run covering every test file that exercises code paths around the change.
- `bun run test:unit` — full unit-test suite. Expect zero regressions.
- `bun run build` — build the application to verify no build errors.

## Patch Scope
**Lines of code to change:** ~2 lines (one new import, one new function call)
**Risk level:** low
**Testing required:** Type-check + existing unit suites must remain green. The change introduces no new behavior in failing or success paths beyond releasing a file lock that was already held; it brings the cron take_over branch into alignment with the webhook take_over branch's already-tested release semantics.
