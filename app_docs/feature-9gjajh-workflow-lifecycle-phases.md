# Workflow Lifecycle Phases

## Overview

This module covers the cross-cutting phases that govern the start, end, and structural integrity of every ADW orchestrator run: initialization, completion (including pause and error handling), the ADW framework upgrade gate, the per-issue spawn lock, the build progress backstop, and branch-name resolution.

## Responsibilities

- `initializeWorkflow`: pre-flight checks Claude CLI presence, activates GitHub App auth, fetches and classifies the issue, creates or reuses a worktree, creates `RepoContext`, runs the upgrade gate for target-repo workflows, initializes orchestrator and top-level state files, reads any previously completed phases for pause/resume, allocates a dev-server port, and returns a fully populated `WorkflowConfig`.
- `completeWorkflow`: writes final state (`completed`), posts a completion comment, and logs the banner.
- `handleRateLimitPause`: records completed phases, enqueues the workflow in the pause queue, posts a paused comment, and calls `process.exit(0)`.
- `handleWorkflowError`: posts an error comment, writes `abandoned` state, moves the issue to Blocked, and calls `process.exit(1)`.
- `handlePhaseTimeout`: posts a timeout comment, writes `phase_timeout` state, and calls `process.exit(0)`.
- `handleWorkflowDiscarded`: writes `discarded` state, posts a discard comment, moves to Blocked, notifies HITL board, and calls `process.exit(0)`.
- `runUpgradeGate`: compares the framework hash against the stored `.adw-version`; on mismatch, atomically claims the upgrade (or attaches to an existing one), parks the current issue with a dependency on the upgrade tracking issue, and returns `{ action: 'parked' }`. On match returns `{ action: 'proceed' }`.
- `acquireOrchestratorLock` / `releaseOrchestratorLock` / `runWithOrchestratorLifecycle`: wrap a workflow fn with a per-issue spawn lock and a heartbeat so hung-orchestrator detection and takeover work correctly.
- `evaluateProgressGate`: pure function that decides whether a build batch should continue, abort due to no progress (worktree returned to a previously seen state), or abort due to backstop (checkpoint ceiling exhausted).
- `resolveWorkflowBranchName`: resolves a branch name in priority order — persisted state, recovery comment, LLM generation — and persists the result immediately so the LLM is called at most once per ADW ID.
- `handleAuthRequiredPause`: writes an auth gate file, marks state as `paused_auth`, and exits 0.

## Contracts & Invariants

- `initializeWorkflow` aborts with `process.exit(0)` when the upgrade gate parks the issue; no workflow comments are posted for parked issues.
- `handleWorkflowError` is a `never` — it always calls `process.exit(1)`.
- `handleRateLimitPause`, `handlePhaseTimeout`, `handleWorkflowDiscarded`, and `handleAuthRequiredPause` are also `never` — they always call `process.exit(0)`.
- The spawn lock is held for the full orchestrator lifetime; abnormal-exit paths (error/discard/pause) call `process.exit` synchronously, so the lock file is left on disk and reclaimed on the next cycle by staleness detection.
- `evaluateProgressGate` is pure — it never mutates its inputs and has no I/O. The caller updates `seen` and `checkpointCount` based on the returned decision.
- `resolveWorkflowBranchName` aborts with an error if the LLM-generated name disagrees with a concurrently written persisted value (race-condition guard for issue #524).
- `shouldTriggerUpgrade` treats a missing `.adw-version` file (null) identically to a hash mismatch — both paths enter the upgrade flow.
- The `completedPhases` field on `WorkflowConfig` is populated from the top-level phases map (new format) with a fallback to legacy metadata; this is what the orchestrators use to skip already-finished phases on resume.

## Configuration

- `GITHUB_PAT` must be set when a GitHub App is configured — `initializeWorkflow` throws at startup if it is missing.
- `HEARTBEAT_TICK_INTERVAL_MS` controls the heartbeat cadence during `runWithOrchestratorLifecycle`.
- The upgrade gate is only run for `targetRepo` workflows; self-hosted framework runs skip it.
- The progress gate's `maxContextResets` and `maxCheckpoints` are caller-supplied constants from `core`.

## Gotchas

- Board setup in `initializeWorkflow` is fire-and-forget (`Promise.resolve().then(...)`) — board errors are logged as warnings and do not block the workflow.
- `findWorktreeForIssue` is skipped when a persisted branch name exists to prevent adopting a sibling worktree's branch (issue #524).
- The upgrade gate's `spawnUpgradeOrchestrator` dep resolves relative script paths against REPO_ROOT, so the upgrade spawn works even from a target-repo worktree.
- `markStatePausedAuthForLiveOrchestrator` is called by the cron's auth-gate tick path (SIGTERM sweep) to update state without firing workflow comments.
- `describeProgressGateAbort` returns distinct messages for `no_progress` and `backstop` because the corrective actions are opposite — no-progress requires issue redesign while backstop requires splitting the issue.
