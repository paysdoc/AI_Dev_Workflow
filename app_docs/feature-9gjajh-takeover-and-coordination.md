# Takeover and Coordination

## Overview

This module governs how multiple concurrent ADW events safely coordinate around a single issue. It provides the per-issue spawn lock, the takeover decision tree, the pause queue scanner, the merge dispatch gate, and the per-repository concurrency guard. Together these components prevent double-spawning, detect and recover from hung or crashed orchestrators, and resume paused workflows after rate-limit recovery.

## Responsibilities

- `evaluateCandidate` (`takeoverHandler`): the single decision tree for any candidate arriving at an issue. Attempts to acquire the spawn lock; if held by a live process, returns `defer_live_holder`. Otherwise reads state: no adwId or no state file → `spawn_fresh`; completed/discarded/paused/paused_auth → `skip_terminal`; abandoned or `phase_timeout` (confirmed dead) → probe worktree via `decideWorktreeReuse` → reuse in place if healthy, else reset + remote reconcile → `take_over_adwId`; running/starting/resuming with live PID → SIGKILL + reset + reconcile → `take_over_adwId`; running with dead PID → reset + reconcile → `take_over_adwId`; unknown stage → `spawn_fresh`. The `abandoned` and `phase_timeout` branches share a single `recoverViaResumeInPlaceOrReset` seam.
- `resolveAdwId` (inside `buildDefaultTakeoverDeps`): resolves the canonical adwId from issue comments via one of two routes. When an `EvaluateCandidateInput.boundary` (`LaunchBoundary`) is supplied, it reads `boundary.providers.issueTracker.fetchComments(issueNumber)`, maps each to `{ body }`, and hands the list to `extractLatestAdwId` — which takes the LATEST matching comment, so chronological comment order is load-bearing on this route. Without a boundary, it falls back to the legacy `fetchIssueCommentBodies(issueNumber, repoInfo)` from `adws/github/issueListApi.ts`. Either way the result feeds the same `extractLatestAdwId` predicate.
- `acquireIssueSpawnLock` (`spawnGate`): atomically creates a JSON lock file under `agents/spawn_locks/` using `O_EXCL` (exclusive create); reclaims stale locks from dead PIDs.
- `releaseIssueSpawnLock`: removes the lock file; tolerates `ENOENT`.
- `readSpawnLockRecord`: returns the stored `{ pid, pidStartedAt }` without modifying the lock.
- `isConcurrencyLimitReached` (`concurrencyGuard`): counts in-progress issues (ADW comment present + no linked merged/closed PR) and returns true when the count reaches `MAX_CONCURRENT_PER_REPO`.
- `shouldDispatchMerge` (`mergeDispatchGate`): reads the spawn lock for an issue and returns true when no lock record exists, the record's PID is dead, or the record's `pidStartedAt` is empty (stale format). Returns false only when a live PID holds the lock.
- `scanPauseQueue` (`pauseQueueScanner`): runs every `PROBE_INTERVAL_CYCLES` cycles; sends a cheap `claude --print "ping"` probe; on `clear` calls `resumeWorkflow` for each queued entry; on `limited` updates the `lastProbeAt` timestamp; on `unknown` increments `probeFailures` and removes the entry after `MAX_UNKNOWN_PROBE_FAILURES`.
- `resumeWorkflow`: resolves the entry's repo via `resolveEntryRepoInfo`, verifies the worktree exists, acquires the spawn lock for verification, checks the canonical adwId claim in the top-level state, releases the lock, spawns the orchestrator detached with a per-resume log file, waits 2 seconds for readiness, commits side-effects (remove from queue, post resumed comment) only on success.
- `resolveEntryRepoInfo`: extracts the target repo from a paused entry's `extraArgs` if present; falls back to the local git remote to prevent GH_TOKEN bleed (issue #565).
- `resolveEntryBoundary` / `postEntryStageComment` (`pauseQueueScanner`): every stage comment the scanner posts (worktree-gone, claim-diverged, probe-failure, resumed) now routes through one private helper. `resolveEntryBoundary(entry)` calls `buildLaunchBoundary(parseTargetRepoArgs(entry.extraArgs ?? []))` — the same `--target-repo` resolution `resolveEntryRepoInfo` already used for the spawn/lock flow — and `postEntryStageComment(entry, stage, ctx)` posts via `postIssueStageComment(boundary.providers, entry.issueNumber, stage, ctx)` inside a try/catch, logging a warning on failure rather than throwing.

## Contracts & Invariants

- The spawn lock file uses `O_EXCL` (exclusive create) — exactly one writer wins the race; the loser re-reads the file to get the holder's PID and returns `defer_live_holder`.
- Stale locks (PID is dead according to `isProcessLive`) are reclaimed synchronously before the exclusive-create retry.
- `evaluateCandidate` always either releases the lock (on non-takeover exits) or leaves it held (for `spawn_fresh` and `take_over_adwId`). The caller's spawn releases the lock via `releaseIssueSpawnLock`.
- `paused` and `paused_auth` return `skip_terminal` — the pause queue scanner and auth queue scanner are the sole resumers; the takeover handler must never compete with them.
- `resumeWorkflow` acquires the spawn lock for verification only and releases it before spawning, so the child's `acquireOrchestratorLock` call takes the lifetime lock. The brief gap is accepted per design.
- Canonical-claim verification in `resumeWorkflow` aborts the resume when `topLevelState.adwId !== entry.adwId` — diverged state triggers a removal from the queue and an error comment on the issue.
- `shouldDispatchMerge` only returns false when a live PID holds the lock; a dead PID is treated as "dispatch" and `acquireIssueSpawnLock` handles the stale-lock reclaim when `adwMerge` starts.
- `EvaluateCandidateInput` carries two optional launch-boundary fields, both absent only in legacy callers: `gitContext?: GitContext` (worktree paths resolve via its base path, never ambient cwd) and `boundary?: LaunchBoundary` (routes `resolveAdwId` and `deriveStageFromRemote` through the boundary's providers instead of building fresh `gh`-backed calls). The cron passes its own `cronBoundary` for both; `scanAuthQueue` and `webhookGatekeeper` — legacy callers with no boundary — are unchanged and keep using `fetchIssueCommentBodies` / the module-private `remoteReconcile` repo-info wiring.
- `deriveStageFromRemote` in `buildDefaultTakeoverDeps` is built as `deriveStageFromRemote(issueNumber, adwId, repoInfo, boundary ? buildDefaultReconcileDeps(boundary) : undefined)` — passing `deps` only when a boundary exists; omitting it falls back to `remoteReconcile.ts`'s own legacy `repoInfo`-based wiring.

## Configuration

`AGENTS_STATE_DIR` is the base directory for spawn lock files (`agents/spawn_locks/`). `PROBE_INTERVAL_CYCLES` and `MAX_UNKNOWN_PROBE_FAILURES` are core constants controlling the pause probe cadence and retry limit. `MAX_CONCURRENT_PER_REPO` caps in-progress workflows per repository. `READINESS_WINDOW_MS` = 2000 ms is the window for confirming a resumed child did not immediately crash.

## Gotchas

- `evaluateCandidate` caches a single `_defaultDeps` instance for performance; tests must inject their own deps to avoid cross-test contamination.
- `worktreeReset` in the takeover handler is best-effort — the takeover proceeds even if the worktree path does not exist on disk. The remote reconcile (`deriveStageFromRemote`) provides the authoritative next stage.
- `probeRateLimit` uses `--dangerously-skip-permissions` on the `claude` CLI; this is intentional for the lightweight rate-limit probe and does not reflect broader permission policy.
- The `READINESS_WINDOW_MS` guard in `resumeWorkflow` only catches immediate child crash/exit — it does not guarantee the orchestrator completes successfully. The queue entry is only removed after the window elapses without an exit event.
- `isConcurrencyLimitReached` fetches all open issues with comments on every invocation — it does not cache results. Callers should be aware of the API cost at high poll frequencies.
- **Fixed bug — target-repo entries used to lose their error comments**: before `postEntryStageComment` existed, all four pause-queue comment call sites used `createRepoContext({ cwd: process.cwd() })`, which validated the cron host's OWN git remote against the paused entry's repo. Any `--target-repo` entry failed that validation and threw, and the surrounding try/catch silently swallowed the throw — so worktree-gone, claim-diverged, and probe-failure comments were never posted for non-self-hosting repos. `postEntryStageComment` builds its boundary from the entry's own `--target-repo` args (via `resolveEntryBoundary`, mirroring `resolveEntryRepoInfo`), so target-repo entries now correctly receive these comments.
