# Cron Issue Filter: Region-Overlap Serialization & processedSpawns Scoping

## Overview

This module evaluates and filters GitHub issues for the cron backlog sweeper. It owns two complementary concerns: (1) scoping the `processedSpawns` dedup set so it guards only the fresh-spawn boot window without blocking abandoned-issue recovery, and (2) detecting when two open issues are likely to edit the same code region and automatically serializing them — one blocks the other via a durable `## Blocked by` dependency — rather than allowing both to spawn in parallel.

## Responsibilities

- **`evaluateIssue`**: per-issue eligibility decision — resolves workflow stage, applies grace period, routes through dedicated branches for `awaiting_merge`, `discarded`, `merge_blocked`, `human_gated`, `retriable`, `phase_timeout`, and fresh (`stage === null`) paths.
- **`processed.spawns` scoping**: the `processedSpawns` dedup set gates ONLY the `stage === null` (fresh) branch. It prevents the cron from re-spawning a workflow during the boot window before the child posts its adw-id comment or writes its state file. It must NOT gate `retriable` or `phase_timeout` — an `abandoned` issue the cron already spawned must remain eligible for takeover on a subsequent poll (issue #653).
- **`filterEligibleIssues`**: bulk filter + sort — collects per-issue results, sorts oldest-first, then runs the region-overlap pass over all spawn-eligible candidates.
- **Pure region-overlap decision (`regionOverlap.ts`)**: parse `## Relevant Files` / `## Touched Files` sections from issue bodies, normalize paths, compute pairwise overlap, and deterministically decide which issue defers behind which — with no I/O.
- **Durable overlap registration (`regionOverlapSignals.ts`)**: idempotently insert an annotated `## Blocked by #N <!-- adw:region-overlap -->` line into the deferred issue's body and post a one-time explanatory comment.
- **Enforcement and unblocking**: delegated to the existing declared-dependency path — `findOpenDependencies` blocks the deferred issue on every subsequent cycle; `handleIssueClosedDependencyUnblock` re-spawns it the moment the blocker's PR merges.

## Contracts & Invariants

- **`processedSpawns` scoped to fresh path only**: the `processed.spawns.has(issue.number)` check lives inside the `if (stage === null)` branch. Recovery stages (`retriable`, `phase_timeout`) are never short-circuited by this set — they must reach their own branches regardless of whether the cron spawned the issue previously.
- **On-disk spawn gate is the concurrency authority**: `acquireIssueSpawnLock` (via `runWithOrchestratorLifecycle`) is the authoritative guard for preventing two orchestrators from running concurrently. `processedSpawns` is only a boot-window convenience dedup.
- **Abandoned issues are recoverable without cron restart**: an issue that the live cron spawned, that then reaches `abandoned`, is re-evaluated on the next poll, classified `retriable`, and routed to `evaluateCandidate` (takeover). No cron restart required.
- **Pure / no I/O in `regionOverlap.ts`**: `regionOverlap.ts` imports no side-effecting modules. All GitHub writes live exclusively in `regionOverlapSignals.ts`.
- **Deadlock-free overlap tie-break**: the lowest issue number in a cluster (or lowest in-flight member) is always the anchor. No two issues can each block the other.
- **No false positives**: a candidate with no path signal (no `## Relevant Files` or `## Touched Files` section) is never serialized.
- **Idempotent registration**: `registerRegionOverlapBlocker` checks for the `<!-- adw:region-overlap -->` annotation before writing; a second call for the same deferral is a no-op.
- **Default-on**: `resolveTouchedFilesFromBody` is the default `resolveTouchedFiles` arg to `filterEligibleIssues`, so the overlap pass always runs in the live cron.

## Configuration

No configuration beyond issue body content. The overlap detection is driven by:

- `## Touched Files` or `## Relevant Files` sections in the issue body (bullet lists or inline backtick paths).
- The same sections in committed plan specs (locatable via `readPlanFile`) — used in the advisory post-plan step.

To override an auto-registered serialization, remove the `#N <!-- adw:region-overlap -->` line from the deferred issue's body.

## Gotchas

- **`processedSpawns` placement is load-bearing**: moving the `processed.spawns.has(...)` check outside the `stage === null` block (before the stage branches) would silently re-introduce issue #653 — abandoned issues this cron spawned would strand for the cron's entire lifetime.
- **LLM fallback not wired**: the spec called for an `/extract_touched_paths` LLM fallback when no deterministic signal exists, but the shipped implementation only uses the deterministic body-section parse. Issues with no `## Relevant Files` section are never serialized (safe — no false positives — but a possible missed detection).
- **Overlap check is pairwise**: each candidate is checked against all other spawn-eligible candidates in the current cycle. Issues that are `paused`, `awaiting_merge`, or already `active` contribute their `inFlight: false` signal only when they appear in the same cycle's eligible set.
- **Annotation format**: the inserted line is `#N <!-- adw:region-overlap -->`, placed immediately after the first `## Blocked by` / `## Dependencies` / `## Depends on` heading. If no such heading exists, a new `## Blocked by` section is appended. Placement matters for `parseDependencies` (first-heading-wins).
