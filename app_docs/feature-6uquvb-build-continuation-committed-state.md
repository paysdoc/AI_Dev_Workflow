# Build Continuation Prompt: Committed-State Direction

**ADW ID:** 6uquvb-point-build-continua
**Date:** 2026-06-09
**Specification:** specs/issue-561-adw-6uquvb-point-build-continua-sdlc_planner-build-continuation-committed-state.md

## Overview

When a long build agent is restarted due to a token limit or context compaction, the fresh agent now inspects **committed git state** — checkpoint commits and working-tree changes — as the authoritative record of completed work, rather than relying solely on a truncated tail of the previous agent's stdout. This prevents the restarted agent from redoing or reverting earlier work, which would trigger false `no_progress` aborts from the novelty progress gate (#559).

## What Was Built

- A new `checkpointCommitsPresent` parameter on `buildContinuationPrompt()` that gates the new committed-state prompt path.
- A new optional `baseBranch?: string` parameter that names the concrete base ref (`origin/<base>`) for `git log`/`git diff` commands.
- A rewritten `## Continuation Context` block (emitted only when checkpoints exist) that directs the agent to inspect committed and uncommitted git state before writing code, and demotes the previous-output tail to a secondary hint.
- A fallback prompt shape (no-checkpoint case) that preserves the previous behaviour exactly, satisfying AC #3 (first build pass unchanged).
- Unit tests in `adws/phases/__tests__/planPhase.test.ts` covering all eight specified cases.
- Both `buildContinuationPrompt()` call sites in `buildPhase.ts` wired to pass `defaultBranch` and `checkpointCount > 0`.

## Technical Implementation

### Files Modified

- `adws/phases/planPhase.ts`: Added `baseBranch?: string` and `checkpointCommitsPresent: boolean = false` parameters to `buildContinuationPrompt()`; added conditional branch that emits the committed-state prompt when checkpoints are present, preserving the original prompt for the no-checkpoint path.
- `adws/phases/buildPhase.ts`: Destructured `defaultBranch` from `config`; passed `defaultBranch` and `checkpointCount > 0` at both call sites (within-batch restart ~line 219, post-checkpoint restart ~line 240).
- `adws/phases/__tests__/planPhase.test.ts`: New file — 8 unit test cases for the pure `buildContinuationPrompt()` function.

### Key Changes

- **Conditional prompt shape** — `buildContinuationPrompt()` remains pure; it branches on `checkpointCommitsPresent` rather than performing any I/O.
- **Committed-state instructions** — with a base branch, the prompt names `git log --oneline --stat origin/<base>..HEAD` and `git diff origin/<base>...HEAD`; without one it falls back to `git log --oneline --stat -30` and avoids emitting `origin/undefined`.
- **Uncommitted-state instructions** — always present in the new path: `git status`, `git diff`, and `git diff --staged` cover within-batch restarts where the previous agent's work is on disk but not yet committed.
- **Tail demoted** — the `<previous-agent-output>` block is retained but labelled `note="secondary hint only — may be stale or truncated; the git state above is authoritative"`.
- **`checkpointCount > 0` gate** — `buildPhase.ts` passes the boolean derived from `checkpointCount` so the first within-batch restart (zero checkpoints) still receives the original prompt.

## How to Use

This change is transparent to operators. The build loop calls `buildContinuationPrompt()` automatically on every restart; no configuration is required. The behaviour changes only when `checkpointCount > 0` at the restart site.

If you are implementing a new orchestrator that calls `buildContinuationPrompt()` directly:

1. Destructure `defaultBranch` from `WorkflowConfig`.
2. Track the number of checkpoint commits (or pass a boolean flag derived from your checkpoint logic).
3. Call `buildContinuationPrompt(planContent, output, reason, defaultBranch, checkpointsPresent)`.

## Configuration

No new configuration options. `defaultBranch` is already resolved by `initializeWorkflow()` via `getDefaultBranch()` and stored on `WorkflowConfig`.

## Testing

Run the unit test suite:

```
bunx vitest run adws/phases/__tests__/planPhase.test.ts
```

Or run all unit tests:

```
bun run test:unit
```

The eight covered cases: plan preserved; committed-state direction against `origin/<base>`; uncommitted-state direction present; authoritative-state framing present; tail retained-but-demoted; truncation preserved (`MAX_CONTINUATION_OUTPUT_LENGTH`); `token_limit` vs `compaction` reason messages; no-base fallback does not emit `origin/undefined`.

## Notes

- `buildContinuationPrompt()` remains a **pure function** (string-in / string-out, no I/O).
- The two-dot `..` operator is used for `git log` (commits on HEAD not on base); the three-dot `...` operator is used for `git diff` (net changes since divergence) — matching the canonical ADW idiom from `branchOperations.ts`.
- The no-checkpoint path is byte-for-byte identical to the pre-#561 prompt, so first-pass build agents are unaffected.
- Related feature: `app_docs/feature-qej3f4-novelty-progress-gate.md` (the #559 progress gate that creates the checkpoint commits this feature points the agent at); `app_docs/feature-9zcqhw-detect-compaction-restart-build-agent.md` (compaction detection that triggers the continuation path).
