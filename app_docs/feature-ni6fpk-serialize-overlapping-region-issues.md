# Cron Issue Filter: Region-Overlap Serialization, processedSpawns Scoping & Resume-Spawn Routing

## Overview

This module cluster evaluates and filters GitHub issues for the cron backlog sweeper. It owns three complementary concerns: (1) scoping the `processedSpawns` dedup set so it guards only the fresh-spawn boot window without blocking abandoned-issue recovery; (2) detecting when two open issues are likely to edit the same code region and automatically serializing them — one blocks the other via a durable `## Blocked by` dependency; and (3) routing resumed adwIds to the correct orchestrator via `resolveResumeSpawn` — a pure function that maps each adwId's persisted top-level state to its owning orchestrator script + normalized `(issueNumber, adwId)` args, ending the hardcoded-SDLC assumption in the takeover path.

## Responsibilities

- **`evaluateIssue`**: per-issue eligibility decision — resolves workflow stage, applies grace period, routes through dedicated branches for `awaiting_merge`, `discarded`, `merge_blocked`, `human_gated`, `retriable`, `phase_timeout`, `review_failed` (human-gated; excluded from auto-spawn), and fresh (`stage === null`) paths.
- **`processed.spawns` scoping**: the `processedSpawns` dedup set gates ONLY the `stage === null` (fresh) branch. It must NOT gate `retriable` or `phase_timeout` — an `abandoned` issue the cron already spawned must remain eligible for takeover on a subsequent poll (issue #653).
- **`filterEligibleIssues`**: bulk filter + sort — collects per-issue results, sorts oldest-first, then runs the region-overlap pass over all spawn-eligible candidates.
- **Pure region-overlap decision (`regionOverlap.ts`)**: parse `## Relevant Files` / `## Touched Files` sections from issue bodies, normalize paths, compute pairwise overlap, and deterministically decide which issue defers behind which — with no I/O.
- **Durable overlap registration (`regionOverlapSignals.ts`)**: idempotently insert an annotated `## Blocked by #N <!-- adw:region-overlap -->` line into the deferred issue's body and post a one-time explanatory comment.
- **Enforcement and unblocking**: delegated to the existing declared-dependency path — `findOpenDependencies` blocks the deferred issue on every subsequent cycle; `handleIssueClosedDependencyUnblock` re-spawns it the moment the blocker's PR merges.
- **`resolveResumeSpawn(state: AgentState): ResumeSpawnDescriptor`** (`adws/core/resolveResumeSpawn.ts`): pure function returning `{ script, args }` where `script = state.orchestratorScript ?? 'adws/adwSdlc.tsx'` and `args = [String(state.issueNumber), state.adwId]`. Consumed by `trigger_cron.ts` takeover branch and by `scanAuthQueue.ts`.
- **`handleRetryDirective` `review_failed` path** (`retryHandler.ts`): transitions `review_failed → phase_timeout` (re-arms `resumeAttempts: 0`) so a `## Retry` comment re-runs the correct orchestrator via the takeover routing path.

## Contracts & Invariants

- **`processedSpawns` scoped to fresh path only**: the `processed.spawns.has(issue.number)` check lives inside the `if (stage === null)` branch. Recovery stages (`retriable`, `phase_timeout`) are never short-circuited by this set — they must reach their own branches regardless of whether the cron spawned the issue previously.
- **On-disk spawn gate is the concurrency authority**: `acquireIssueSpawnLock` (via `runWithOrchestratorLifecycle`) is the authoritative guard for preventing two orchestrators from running concurrently. `processedSpawns` is only a boot-window convenience dedup.
- **Abandoned issues are recoverable without cron restart**: an issue that the live cron spawned, that then reaches `abandoned`, is re-evaluated on the next poll, classified `retriable`, and routed to `evaluateCandidate` (takeover). No cron restart required.
- **`resolveResumeSpawn` is pure and total**: no I/O, no side effects; always returns a valid descriptor. SDLC default fires when `orchestratorScript` is absent — back-compat for every adwId created before PR-review began persisting `orchestratorScript`.
- **Takeover routing correctness**: the `take_over_adwId` branch in `trigger_cron.ts` reads `readTopLevelState(takeoverAdwId)` and routes via `resolveResumeSpawn`. If state is unexpectedly absent, a defensive SDLC fallback preserves the prior behavior rather than crashing.
- **SDLC adwIds are unchanged**: `workflowInit.ts:330` persists `orchestratorScript: 'adws/adwSdlc.tsx'` at SDLC init, so SDLC takeovers continue resolving to `adws/adwSdlc.tsx`. Legacy adwIds with no `orchestratorScript` field also default to SDLC.
- **`review_failed` is human-gated**: cron returns `eligible: false, reason: 'review_failed'` — never auto-spawned. `## Retry` transitions it to `phase_timeout`, which the takeover logic picks up on the next cycle and routes via `resolveResumeSpawn` back to the correct orchestrator (PR-review or SDLC).
- **Pure / no I/O in `regionOverlap.ts`**: `regionOverlap.ts` imports no side-effecting modules. All GitHub writes live exclusively in `regionOverlapSignals.ts`.
- **Deadlock-free overlap tie-break**: the lowest issue number in a cluster (or lowest in-flight member) is always the anchor. No two issues can each block the other.
- **No false positives**: a candidate with no path signal (no `## Relevant Files` or `## Touched Files` section) is never serialized.
- **Idempotent registration**: `registerRegionOverlapBlocker` checks for the `<!-- adw:region-overlap -->` annotation before writing; a second call for the same deferral is a no-op.

## Configuration

- `resolveResumeSpawn` has no configuration — it reads `state.orchestratorScript` (persisted by the orchestrator at init and at completion) and `DEFAULT_RESUME_SCRIPT = 'adws/adwSdlc.tsx'` as the fallback.
- Region-overlap detection is driven by `## Touched Files` or `## Relevant Files` sections in issue bodies (bullet lists or inline backtick paths).

## Gotchas

- **`processedSpawns` placement is load-bearing**: moving the `processed.spawns.has(...)` check outside the `stage === null` block would silently re-introduce issue #653 — abandoned issues this cron spawned would strand for the cron's entire lifetime.
- **`review_failed` exclusion is intentional**: the `review_failed` branch returns `eligible: false` before the grace-period check — it must never be auto-spawned regardless of timestamp. Only `## Retry` (via `retryHandler`) can re-arm it to `phase_timeout`.
- **`resolveResumeSpawn` args are always `[issueNumber, adwId]`**: both takeover and scanAuthQueue must pass `...args` before `...targetRepoArgs` to avoid positional collision. The args are normalized: numeric `issueNumber` is stringified, `adwId` is passed through verbatim.
- **LLM fallback not wired**: the spec called for an `/extract_touched_paths` LLM fallback when no deterministic signal exists, but the shipped implementation only uses the deterministic body-section parse. Issues with no `## Relevant Files` section are never serialized (safe — no false positives — but a possible missed detection).
- **Overlap check is pairwise**: each candidate is checked against all other spawn-eligible candidates in the current cycle. Issues that are `paused`, `awaiting_merge`, or already `active` contribute their `inFlight: false` signal only when they appear in the same cycle's eligible set.
- **Annotation format**: the inserted line is `#N <!-- adw:region-overlap -->`, placed immediately after the first `## Blocked by` / `## Dependencies` / `## Depends on` heading. If no such heading exists, a new `## Blocked by` section is appended. Placement matters for `parseDependencies` (first-heading-wins).
