# Cron Triggers

## Overview

The cron trigger is ADW's backlog sweeper: a long-running process that polls open issues and PRs every 20 seconds, applies a series of filters and eligibility checks, and spawns orchestrator workflows for issues that are ready to proceed. It also runs periodic maintenance tasks — hung orchestrator detection, dev server cleanup, pause queue scanning, and auth queue scanning.

## Responsibilities

- `trigger_cron.ts`: the entry point. Runs `checkAndTrigger` every 20 seconds (through `runGuardedTick`, which logs and swallows any escaped rejection so no single tick can kill the process) and `checkPRsForReviewComments` every 60 seconds. On startup, registers a per-repo process guard to prevent duplicate cron instances.
- `checkAndTrigger`: per-cycle orchestration — handles the auth gate tick, scans pause and auth queues, runs hung-detector and janitor sweeps at configured intervals, re-asserts app auth for the cron's own repo, fetches open issues, scans for `## Cancel` and `## Retry` directives, calls `filterEligibleIssues`, then dispatches merge or SDLC workflows for each eligible candidate.
- `runHungDetectorSweep`: finds orchestrators whose heartbeat is stale, sends SIGKILL, and rewrites their state to `abandoned`.
- `filterEligibleIssues`: maps over all open issues calling `evaluateIssue`; returns eligible issues sorted oldest-first and an annotation list of excluded issues for logging.
- `evaluateIssue`: the core per-issue decision function. Routes `awaiting_merge` directly to the merge path, short-circuits on `discarded`/`merge_blocked`/`completed`/`paused`/`processed`, enforces the grace period, applies the label-recovery gate for fresh issues, and returns eligible with action `'spawn'` or `'merge'`.
- `resolveIssueWorkflowStage`: reads the top-level state file for an ADW ID extracted from issue comments; returns `{ stage, adwId, lastActivityMs }`.
- `extractLatestAdwId`: scans comments newest-to-oldest and returns the first embedded ADW ID.
- `getLastActivityFromState`: finds the most recent `startedAt`/`completedAt` timestamp across all phases in a state file.
- `isActiveStage` / `isRetriableStage`: classify a stage string; only `abandoned` is retriable; `discarded` and `merge_blocked` are not.
- `resolveCronRepo`: parses `--target-repo` CLI args or falls back to the local git remote.
- `buildCronTargetRepoArgs`: constructs `--target-repo owner/repo --clone-url ...` args for spawned child processes.
- `evaluateLabelRecovery` / `decideLabelRecovery`: for fresh issues (no prior ADW state), determines eligibility. A truly-unlabeled issue (no `adw:*` label at all) is eligible with no deterministic classification attached — the downstream spawn path LLM-classifies it, exactly as the webhook opened-path and comment-path do. Only a reserved, non-classification `adw:*` label (`adw:upgrade` / `adw:blocked` / `adw:unverified`) is filtered as `reserved_label`; the remaining guards (`opt_out`, `multi_label`, `in_progress_comment`, `linked_closed_pr`) still apply to every fresh issue, labeled or not.

## Contracts & Invariants

- A single cron instance is enforced per `owner/repo` via `cronProcessGuard`; duplicate processes exit immediately with code 0.
- `awaiting_merge` bypasses the grace period — the original orchestrator has already exited, so there is no race risk. Dedup for merge dispatches uses the spawn lock on disk (`shouldDispatchMerge`), not the in-memory `processedSpawns` set.
- `discarded` and `merge_blocked` are permanently ineligible in `evaluateIssue`; only an explicit `## Retry` comment resets `merge_blocked` to `awaiting_merge`.
- `paused` is handled exclusively by the pause queue scanner; `evaluateIssue` returns ineligible for paused issues so the backlog sweeper does not compete with the scanner.
- `decideLabelRecovery` applies only to truly fresh issues (`adwId === null`); issues with an existing adwId bypass it and enter the takeover machinery.
- `decideLabelRecovery` guard precedence: `opt_out` → `multi_label` → `reserved_label` → `in_progress_comment` → `linked_closed_pr` → eligible. The `reserved_label` guard only fires when `hasAdwLabel` is true and `reading.classification` is `null` — i.e. the issue carries a reserved, non-classification `adw:*` label. A truly-unlabeled issue (`hasAdwLabel === false`) falls through this guard and returns `eligible: true` with `classification: undefined`.
- `isRetriableStage` deliberately excludes `discarded` to prevent infinite re-spawn loops.
- App auth is re-asserted for the cron's own repo after each pause/auth queue scan, which may have activated auth for a different repo.

## Configuration

`POLL_INTERVAL_MS` = 20 000 ms (issue polling), `PR_POLL_INTERVAL_MS` = 60 000 ms (PR polling). `GRACE_PERIOD_MS`, `JANITOR_INTERVAL_CYCLES`, `HEARTBEAT_STALE_THRESHOLD_MS`, `HUNG_DETECTOR_INTERVAL_CYCLES`, `PER_ISSUE_SCENARIO_SWEEP_INTERVAL_CYCLES`, and `PROBE_INTERVAL_CYCLES` are read from core constants. GitHub App auth is activated at startup when configured.

## Gotchas

- The cron's module-level side effects (setInterval, process guard, app auth activation) are guarded by `process.argv[1]?.includes('trigger_cron')` so that importing the module in BDD tests does not start the loop or exit the test runner.
- `processedSpawns` is an in-memory `Set<number>` — it tracks issues whose SDLC workflow this cron process has already spawned. It does not persist across restarts, but the spawn lock on disk and the state file provide durable dedup.
- The grace period timer uses `resolution.lastActivityMs` (from the state file's most recent phase timestamp) in preference to `issue.updatedAt`. This prevents re-dispatch when a workflow is making rapid progress but GitHub's issue `updatedAt` reflects comment activity that is older.
- `buildCronTargetRepoArgs` is called lazily inside `buildTargetRepoArgs()` to capture the most recent `cronRepoInfo` and `targetRepo` values; it must include the clone URL so spawned children can clone the target repo.
- `#UPG` (`adw:upgrade`) tracking issues stay out of the standard candidate loop precisely because they read as `reserved_label`, not because they lack a label — `upgradeRedrive.ts` depends on this filtering, so the `reserved_label` guard cannot be removed outright, only narrowed to exclude truly-unlabeled issues (#754). Before #754, `decideLabelRecovery` rejected every fresh issue with `classification === null` — including ones with no `adw:*` label at all — as `no_adw_label`, which silently stranded unlabeled issues whenever the webhook (the only other classifier) was down. That guard sat *before* `in_progress_comment` and `linked_closed_pr` in the precedence chain, so a truly-unlabeled issue that also tripped one of those later guards was misreported as `no_adw_label`/`reserved_label` instead of its real reason — this is now correctly distinguished.
- `void promise` is not a rejection handler on Node ≥ 15 — an unhandled rejection terminates the process by default. Every fire-and-forget async call from the entry-script guard must go through a guard like `runGuardedTick`, not a bare `void`. This is exactly how the cron trigger crash-looped: janitor discovery constructed a `GitContext` for a repo the GitHub App was not installed on, the 404 threw out of `checkAndTrigger`, `void checkAndTrigger()` had no rejection handler, and the webhook's `ensureCronProcess` respawned the killed process every ~5 minutes (#812).
