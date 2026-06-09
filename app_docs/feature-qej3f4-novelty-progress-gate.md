# Novelty Progress Gate for Build Phase

**ADW ID:** qej3f4-replace-build-contex
**Date:** 2026-06-09
**Specification:** specs/issue-559-adw-qej3f4-replace-build-contex-sdlc_planner-build-novelty-progress-gate.md

## Overview

Replaces the hard `MAX_CONTEXT_RESETS` kill in the build phase with a state-novelty progress gate. Instead of unconditionally aborting after a fixed number of context resets, the gate inspects the committed worktree state at each batch boundary and aborts only when the build is genuinely stalled (frozen or oscillating), while allowing a progressing build to survive far more restarts. A hard backstop (`MAX_PROGRESS_CHECKPOINTS`, default 20) bounds even pathological cases.

## What Was Built

- Pure `evaluateProgressGate` function in `adws/phases/progressGate.ts` returning a discriminated `continue | abort:no_progress | abort:backstop` decision
- Thin VCS helpers: `getHeadTreeHash(cwd?)` and `hasUncommittedChanges(cwd?)` in `adws/vcs/commitOperations.ts`
- New env-tunable constant `MAX_PROGRESS_CHECKPOINTS` (default 20) in `adws/core/config.ts`, re-exported from `adws/core/index.ts`
- Consolidated the two near-duplicate `tokenLimitExceeded` / `compactionDetected` restart blocks in `buildPhase.ts` into a single handler wired to the progress gate
- Unit tests for `evaluateProgressGate` (six required cases + purity assertion) and the two new VCS helpers
- Two known-issue entries in `known_issues.md` documenting accepted design residuals

## Technical Implementation

### Files Modified

- `adws/core/config.ts`: Added `MAX_PROGRESS_CHECKPOINTS` constant following the `MAX_CONTEXT_RESETS` pattern
- `adws/core/index.ts`: Added `MAX_PROGRESS_CHECKPOINTS` to the `from './config'` export list
- `adws/vcs/commitOperations.ts`: Added `getHeadTreeHash(cwd?)` and `hasUncommittedChanges(cwd?)` helpers
- `adws/vcs/index.ts`: Exported the two new VCS helpers from the commit operations barrel
- `adws/phases/buildPhase.ts`: Consolidated restart blocks, seeded the `seen` set, added `perBatchResets` / `checkpointCount` counters, wired the gate at each batch boundary
- `known_issues.md`: Added two residual entries (backstop is per-orchestrator-incarnation; monotonic accumulator runs to backstop)

### New Files

- `adws/phases/progressGate.ts`: Pure gate module — `ProgressGateDecision` discriminated union + `evaluateProgressGate`
- `adws/phases/__tests__/progressGate.test.ts`: Vitest unit tests for the gate (six cases + purity)
- `adws/vcs/__tests__/commitOperations.test.ts` (extended): VCS helper tests for `getHeadTreeHash` and `hasUncommittedChanges`
- `features/per-issue/feature-559.feature` + step definitions: BDD acceptance scenarios for end-to-end gate behaviour

### Key Changes

- **Loop condition change**: `while (continuationNumber <= MAX_CONTEXT_RESETS && !buildCompleted)` → `while (!buildCompleted)`. Termination is now guaranteed by the gate rather than the old loop bound.
- **Batch boundary logic**: when `perBatchResets >= MAX_CONTEXT_RESETS`, commit if dirty → compute HEAD tree hash → `evaluateProgressGate` → continue (novel + within backstop) or throw (no-progress / backstop).
- **Seed set**: `seenTreeHashes` is initialized with the build-start HEAD tree hash so a frozen build (no file changes) immediately matches the seed and aborts as `no_progress`.
- **Trigger consolidation**: a single `restartTrigger: 'token_limit' | 'compaction' | null` discriminator replaces the two duplicate `if (buildResult.tokenLimitExceeded)` / `if (buildResult.compactionDetected)` blocks.
- **Pure gate contract**: `evaluateProgressGate` has no I/O and does not mutate its `ReadonlySet<string>` input; all git work and state mutation remain in the caller.

## How to Use

The gate is transparent to operators — no workflow changes are required. Tune via env vars if needed:

1. **Default behaviour**: a build gets `MAX_CONTEXT_RESETS` (default 3) restarts per batch. At each batch boundary the worktree is committed and the tree hash is checked. A novel hash extends the build; a repeated hash aborts it.
2. **Increase batch size**: `MAX_CONTEXT_RESETS=5` to allow more restarts before each checkpoint.
3. **Increase backstop**: `MAX_PROGRESS_CHECKPOINTS=30` to allow more checkpoints for very large builds.
4. **Frozen build**: a build that never writes files will abort at the first batch boundary with `no_progress`.
5. **Oscillating build**: a build that reverts to a prior committed state aborts with `no_progress` when the hash reappears in `seenTreeHashes`.
6. **Always-novel build**: a build that keeps producing novel commits will be stopped at `MAX_PROGRESS_CHECKPOINTS` with `backstop`.

## Configuration

| Env var | Default | Description |
|---|---|---|
| `MAX_CONTEXT_RESETS` | `3` | Restarts per batch (existing; unchanged semantics) |
| `MAX_PROGRESS_CHECKPOINTS` | `20` | Maximum novel-state batch boundaries before backstop abort |

## Testing

```bash
# Unit tests (gate function + VCS helpers)
bunx vitest run adws/phases/__tests__/progressGate.test.ts
bunx vitest run adws/vcs/__tests__/commitOperations.test.ts

# Full unit suite
bun run test:unit

# Type-check
bunx tsc --noEmit -p adws/tsconfig.json
```

## Notes

- **Test/review compaction path unchanged**: `testRetry.ts`, `scenarioTestPhase.ts`, `scenarioFixPhase.ts`, `reviewPhase.ts`, and `retryOrchestrator.ts` are not touched; this gate applies only to the build phase loop.
- **Abort messages**: the two abort reasons (`no_progress`, `backstop`) are textually distinguishable in the thrown error but share a generic prefix. A follow-up slice can refine the wording using the discriminated `decision.reason` already in place.
- **Backstop is per-incarnation**: `seenTreeHashes` and `checkpointCount` live in process memory; an orchestrator takeover resets them to zero (accepted residual, documented in `known_issues.md`).
- **Monotonic accumulator**: a build that always reaches a novel state runs all the way to `MAX_PROGRESS_CHECKPOINTS` before the backstop abort — there is no "rate of progress" check (accepted residual, documented in `known_issues.md`).
