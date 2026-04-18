# Fix: Cross-Trigger Spawn Deduplication

**ADW ID:** 0cv18u-cron-webhook-can-dou
**Date:** 2026-04-18
**Specification:** specs/issue-449-adw-0cv18u-cron-webhook-can-dou-sdlc_planner-fix-cross-trigger-spawn-dedup.md

## Overview

Adds a cross-process spawn gate to `classifyAndSpawnWorkflow` that prevents the cron backlog sweeper and the webhook dependency-unblock handler from independently spawning two SDLC orchestrators for the same issue. The fix uses a per-(repo, issue) atomic file lock (exclusive `wx` create) acquired before the ~5-minute `classifyIssueForTrigger` LLM call and a post-classification recheck of `isAdwRunningForIssue` to close the brief post-release window.

## What Was Built

- **`adws/triggers/spawnGate.ts`** — new module exporting `acquireIssueSpawnLock`, `releaseIssueSpawnLock`, and `getSpawnLockFilePath`. Mirrors `cronProcessGuard.ts`'s atomic PID-file pattern, applied one layer deeper at the orchestrator-spawn level.
- **Lock integration in `classifyAndSpawnWorkflow`** — acquires the spawn lock before classification, releases on success/abort/error, and runs a post-classification eligibility recheck.
- **`adws/triggers/__tests__/spawnGate.test.ts`** — unit tests covering acquire, stale-PID reclaim, per-issue and per-repo isolation, explicit release, and malformed-JSON recovery.
- **`features/fix_cross_trigger_spawn_dedup.feature`** — BDD regression scenarios validating the gate is wired, the `wx` flag is used, and post-classify abort path releases the lock.
- **`adws/known_issues.md`** — new `cross-trigger-double-spawn` entry with status `solved`, referencing issue #449.
- **`adws/triggers/trigger_cron.ts`** — minor: cancel-directive tracking moved from `processedSpawns` Set to a per-cycle `cancelledThisCycle` Set; SDLC spawn branch now forwards `adwId` to `classifyAndSpawnWorkflow`.

## Technical Implementation

### Files Modified

- `adws/triggers/spawnGate.ts` *(new)*: Per-(repo, issue) atomic file lock using `fs.writeFileSync` with `{ flag: 'wx' }`. Lock path: `agents/spawn_locks/{owner}_{repo}_issue-{N}.json`. Stale locks reclaimed via `isProcessAlive(existing.pid)`.
- `adws/triggers/webhookGatekeeper.ts`: `classifyAndSpawnWorkflow` acquires spawn lock at top, runs post-classify `isAdwRunningForIssue` recheck, releases lock on all paths (success, abort, thrown error).
- `adws/triggers/trigger_cron.ts`: Cancel-directive tracking uses a local `cancelledThisCycle` Set instead of `processedSpawns`; passes `adwId` resume hint to `classifyAndSpawnWorkflow`.
- `adws/triggers/__tests__/spawnGate.test.ts` *(new)*: Vitest unit tests with a temp `AGENTS_STATE_DIR` and mocked `isProcessAlive`.
- `features/fix_cross_trigger_spawn_dedup.feature` *(new)*: BDD regression scenarios tagged `@adw-0cv18u-cron-webhook-can-dou @adw-449`.
- `features/step_definitions/fixCrossTriggerSpawnDedupSteps.ts` *(new)*: Step definitions for the BDD feature.
- `adws/known_issues.md`: New `cross-trigger-double-spawn` entry.

### Key Changes

- **Atomic exclusive-create lock**: `fs.writeFileSync(path, data, { flag: 'wx' })` returns immediately with EEXIST if a lock is already held by another process — no polling or retries needed for the hot path.
- **Stale lock reclaim**: On EEXIST, `readSpawnLock` reads the recorded PID. If `isProcessAlive(pid)` returns false, the stale file is removed and the create is retried once, so a crashed spawning process never permanently blocks future triggers.
- **Post-classification recheck**: After the long `classifyIssueForTrigger` call resolves, `isAdwRunningForIssue` is rechecked. If a concurrent trigger has already started an orchestrator and posted its first ADW comment, the current call releases the lock and returns without spawning.
- **Single chokepoint**: All four trigger paths (cron backlog, webhook `issue_comment`, webhook `issues.opened`, webhook dependency-unblock) already route through `classifyAndSpawnWorkflow`, so this one integration point covers every spawn path.
- **Lock lifecycle**: Acquired before classification, released after `spawnDetached` fires, on post-classify abort, and in the `catch` block so classification failures free the issue for the next trigger cycle.

## How to Use

The guard is fully automatic — no configuration is required. When a dependent issue becomes eligible:

1. The first trigger (cron or webhook) to call `classifyAndSpawnWorkflow` acquires `agents/spawn_locks/{owner}_{repo}_issue-{N}.json`.
2. Any subsequent trigger call for the same issue logs `Issue #N: spawn lock held by another process, skipping` and returns immediately.
3. After classification, the holder rechecks `isAdwRunningForIssue`. If another workflow already started, it logs `Issue #N: another ADW workflow started during classification, aborting spawn` and releases the lock.
4. On successful spawn, the lock is released so the next legitimate trigger cycle can acquire it if the orchestrator later stops.

To inspect a live lock: `cat agents/spawn_locks/{owner}_{repo}_issue-{N}.json` — the file contains `pid`, `repoKey`, `issueNumber`, and `startedAt`.

## Configuration

No new configuration required. The lock directory `agents/spawn_locks/` is created automatically under `AGENTS_STATE_DIR` (default: `agents/`).

## Testing

```bash
# Unit tests (includes spawnGate.test.ts)
bun run test:unit

# BDD regression scenarios for this fix
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-449"

# Full regression suite
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"
```

**Manual repro check:**
- Before fix: two `Spawning:` log lines for the same issue within minutes; two `agents/{adwId}/sdlc-orchestrator/state.json` directories.
- After fix: one `Spawning:` line; second call logs `spawn lock held by another process, skipping`; one `agents/{adwId}` directory.

## Notes

- The stranded `0ejypj` orchestrator from the 2026-04-18 incident (depaudit#6) is out of scope; tracked separately under `pauseQueueScanner` follow-up work.
- The existing in-memory guards (`processedSpawns` Set in cron, `recentIssueTriggers` Map in webhook) are retained as fast-path, within-process caches. The spawn gate is the second line of defence across processes.
- `concurrencyGuard.ts` and `isAdwRunningForIssue()` are unchanged — per-repo concurrency cap is orthogonal to per-issue spawn dedup.
- Lock file pattern mirrors `cronProcessGuard.ts` (same `AGENTS_STATE_DIR`, same `wx` flag, same `isProcessAlive` stale check) — no new patterns introduced.
