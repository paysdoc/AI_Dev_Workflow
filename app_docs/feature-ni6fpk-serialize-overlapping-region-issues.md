# Region-Overlap Serialization Gate

## Overview

This module detects when two open issues are likely to edit the same code region and automatically serializes them — one blocks the other via a durable `## Blocked by` dependency — rather than allowing both to spawn in parallel. It removes the cause of the stale-base rebase class of incidents (two siblings both editing `takeoverHandler.ts`/`phase_timeout` consumed ~245K tokens in the #638/#639 episode). Genuinely independent issues remain parallelizable; the decision is logged and visible on GitHub.

## Responsibilities

- **Pure decision (`regionOverlap.ts`)**: parse `## Relevant Files` / `## Touched Files` sections from issue bodies or plan specs, normalize paths, compute pairwise overlap, and deterministically decide which issue defers behind which — with no I/O.
- **Durable registration (`regionOverlapSignals.ts`)**: idempotently insert an annotated `## Blocked by #N <!-- adw:region-overlap -->` line into the deferred issue's body and post a one-time explanatory comment naming the blocking issue and the overlapping paths.
- **Cron integration (`cronIssueFilter.filterEligibleIssues`)**: after per-issue filtering, run a cross-issue region-overlap pass over all spawn-eligible candidates and return an `overlapDeferrals` list; the main `trigger_cron` loop calls `registerRegionOverlapBlocker` for each deferral.
- **Enforcement and unblocking**: delegated to the existing declared-dependency path — `findOpenDependencies` blocks the deferred issue on every subsequent cycle; `handleIssueClosedDependencyUnblock` re-spawns it the moment the blocker's PR merges.

## Contracts & Invariants

- **Pure / no I/O**: `regionOverlap.ts` imports no side-effecting modules. All GitHub writes (`updateIssueBody`, `commentOnIssue`) live exclusively in `regionOverlapSignals.ts`.
- **Deadlock-free**: the tie-break is deterministic — among overlapping candidates, the one with the lowest issue number in the cluster (or the lowest-numbered in-flight member if any sibling is in-flight) is the anchor and always proceeds. No two issues can each block the other.
- **No false positives**: a candidate with an empty path signal (no `## Relevant Files` or `## Touched Files` section) is never serialized.
- **Idempotent registration**: `registerRegionOverlapBlocker` checks for the `<!-- adw:region-overlap -->` annotation before writing; a second call for the same deferral is a no-op (no double-append, no duplicate comment).
- **Durable enforcement**: once the annotated `Blocked by #N` ref is written, `findOpenDependencies` enforces the block on every subsequent cron cycle — no new enforcement code is required.
- **Fail-safe**: a write failure in `registerRegionOverlapBlocker` is caught and logged; the in-memory deferral already excluded the issue this cycle so no parallel spawn occurs. The next cycle retries.
- **Default-on**: `resolveTouchedFilesFromBody` is the default `resolveTouchedFiles` argument to `filterEligibleIssues`, so the overlap pass always runs in the live cron and cannot be silently dropped at call sites.

## Configuration

No configuration beyond issue body content. The overlap detection is driven by:

- `## Touched Files` or `## Relevant Files` sections in the issue body (bullet lists or inline backtick paths).
- The same sections in committed plan specs (locatable via `readPlanFile`) — used in the advisory post-plan step.

To override an auto-registered serialization, remove the `#N <!-- adw:region-overlap -->` line from the deferred issue's body. The declarative dependency system then un-blocks it on the next cycle.

## Gotchas

- **LLM fallback not wired**: the spec called for an `/extract_touched_paths` LLM fallback when no deterministic signal exists, but the shipped implementation only uses the deterministic body-section parse. Issues with no `## Relevant Files` section are never serialized (safe — no false positives — but a possible missed detection).
- **Overlap check is pairwise**: each candidate is checked against all other spawn-eligible candidates in the current cycle. Issues that are `paused`, `awaiting_merge`, or already `active` contribute their `inFlight: false` signal only when they appear in the same cron cycle's eligible set — there is no cross-cycle sibling enumeration using the `inFlight` flag (that signal is always `false` in the current implementation).
- **Annotation format**: the inserted line is `#N <!-- adw:region-overlap -->`, placed immediately after the first `## Blocked by` / `## Dependencies` / `## Depends on` heading (so `parseDependencies` picks it up on subsequent cycles even when the existing section says "None — can start immediately"). If no such heading exists, a new `## Blocked by` section is appended.
- **Stale `feature-dcy9qz` entry in `conditional_docs.md`**: the `cronIssueFilter.ts` file was previously documented under `feature-dcy9qz-merge-orchestrator-cron-handoff.md`, which no longer exists on disk. The region-overlap feature now owns the `cronIssueFilter.ts` area.
