# Runner Token-Limit Continuation

**ADW ID:** locx5w-refactor-runner-toke
**Date:** 2026-03-30
**Specification:** specs/issue-350-adw-locx5w-refactor-runner-toke-sdlc_planner-runner-token-limit-continuation.md

## Overview

Token-limit continuation logic has been extracted from `buildPhase.ts` and moved into the runner as a cross-cutting concern. Previously, `buildPhase.ts` contained a ~100-line `while` loop handling context resets; now the runner owns the retry loop via `runPhaseWithContinuation()`, and phases opt in by providing an `onTokenLimit` callback on their phase definition.

## What Was Built

- `runPhaseWithContinuation()` — new function in `phaseRunner.ts` that wraps `runPhase()` with a token-limit retry loop (up to `MAX_CONTEXT_RESETS`)
- `PhaseResult` token-limit signal fields — `tokenLimitExceeded`, `tokenLimitReason`, `previousOutput`, `tokenUsage`
- `PhaseDefinition.onTokenLimit` — optional callback on declarative phase definitions; runner delegates to `runPhaseWithContinuation()` when present
- `buildPhaseOnTokenLimit()` — exported callback from `buildPhase.ts` that builds a continuation prompt from the plan file and previous output
- `WorkflowConfig.continuationPrompt` — optional field set by the runner; `executeBuildPhase` reads it instead of the plan file on continuation runs
- Refactored `executeBuildPhase()` — internal `while` loop removed; runs the build agent once and returns early with token-limit signals when interrupted
- All 9 orchestrators updated to use `runPhaseWithContinuation` with `buildPhaseOnTokenLimit`

## Technical Implementation

### Files Modified

- `adws/core/phaseRunner.ts`: Added `tokenLimitExceeded`, `tokenLimitReason`, `previousOutput`, `tokenUsage` to `PhaseResult`; added `runPhaseWithContinuation()`; updated `runPhase()` to skip `recordCompletedPhase()` when `tokenLimitExceeded`
- `adws/core/orchestratorRunner.ts`: Added `onTokenLimit` to `PhaseDefinition`; updated `runOrchestrator()` to use `runPhaseWithContinuation()` when callback is present
- `adws/core/index.ts`: Exported `runPhaseWithContinuation`
- `adws/phases/buildPhase.ts`: Removed internal continuation loop; reads `config.continuationPrompt` for continuation runs; returns early with token-limit signals; exported `buildPhaseOnTokenLimit()`
- `adws/phases/workflowInit.ts`: Added `continuationPrompt?: string` to `WorkflowConfig`
- `adws/phases/index.ts` / `adws/workflowPhases.ts`: Exported `buildPhaseOnTokenLimit`
- `adws/adwPlanBuild.tsx`: Added `onTokenLimit: buildPhaseOnTokenLimit` to build phase definition
- `adws/adwSdlc.tsx`, `adwChore.tsx`, `adwPlanBuildTest.tsx`, `adwPlanBuildTestReview.tsx`, `adwPlanBuildReview.tsx`, `adwPlanBuildDocument.tsx`, `adwBuild.tsx`, `adwPatch.tsx`: Switched `runPhase` → `runPhaseWithContinuation` for the build phase call

### Key Changes

- **Separation of concerns**: `executeBuildPhase` now runs the agent exactly once and signals token-limit interruption via `PhaseResult` fields; the runner decides whether to continue
- **Opt-in continuation**: phases without `onTokenLimit` receive `tokenLimitExceeded: true` as-is — safe-by-default, no implicit retry
- **`continuationPrompt` channel**: the runner sets `config.continuationPrompt` before re-invoking the phase; the phase reads it in place of the plan file, then the runner clears it after the loop
- **`recordCompletedPhase` guard**: `runPhase()` only records phase completion when `tokenLimitExceeded` is false, preventing premature resume-skip on mid-continuation state
- **Cost accumulation unchanged**: `CostTracker.accumulate()` is called per `runPhase()` invocation, so costs stack correctly across continuations without additional logic

## How to Use

### Enabling continuation for a new phase

1. In `adws/phases/buildPhase.ts` as a reference, implement an `onTokenLimit` callback:
   ```typescript
   export function myPhaseOnTokenLimit(config: WorkflowConfig, result: PhaseResult): string {
     // Build and return a continuation prompt string from result.previousOutput
   }
   ```
2. Export it from `adws/phases/index.ts` and `adws/workflowPhases.ts`.
3. **Declarative orchestrator**: add `onTokenLimit: myPhaseOnTokenLimit` to the `PhaseDefinition`.
4. **Imperative orchestrator**: replace `runPhase(config, tracker, executeMyPhase)` with `runPhaseWithContinuation(config, tracker, executeMyPhase, myPhaseOnTokenLimit)`.

### Making a phase signal token-limit interruption

In the phase function, instead of looping internally, return a `PhaseResult` with:
```typescript
return {
  costUsd,
  modelUsage,
  phaseCostRecords,
  tokenLimitExceeded: true,
  tokenLimitReason: 'token_limit', // or 'compaction'
  previousOutput: agentResult.output,
  tokenUsage: agentResult.tokenUsage,
};
```

## Configuration

- `MAX_CONTEXT_RESETS` (`adws/core/config.ts`) — maximum continuation attempts before the runner throws
- `WorkflowConfig.continuationPrompt` — set by the runner on each continuation; cleared after the loop; phases should read and use this instead of their original plan source

## Testing

```bash
bun run lint
bunx tsc --noEmit
bunx tsc --noEmit -p adws/tsconfig.json
bun run build
```

## Notes

- Recovery comments (`token_limit_recovery`, `compaction_recovery`) reference "build agent" in their text. When other phases adopt `onTokenLimit`, consider generalizing the comment format to include the phase name.
- Each continuation run produces its own `PhaseCostRecord` via `runPhase()` → `tracker.commit()`. The `contextResetCount` in cost records is 0 for individual continuation runs — the runner tracks the reset count, not the phase.
- When imperative orchestrators are eventually migrated to the declarative pattern, the explicit `runPhaseWithContinuation` calls can be removed in favour of `PhaseDefinition.onTokenLimit`.
