# Distinct Abort Messages for the Build Progress Gate

**ADW ID:** 23ipne-distinct-operator-fa
**Date:** 2026-06-09
**Specification:** specs/issue-560-adw-23ipne-distinct-operator-fa-sdlc_planner-distinct-abort-messages.md

## Overview

The build phase progress gate (introduced in #559) can abort a build for two fundamentally different reasons — a stuck/oscillating build (`no_progress`) or a build that exceeded the checkpoint ceiling while still making real progress (`backstop`). These two reasons demand opposite corrective actions, but previously both were collapsed into a single generic "Build agent made no progress at batch boundary" error message. This feature replaces that shared message with two distinct, operator-facing messages that accurately describe what happened and tell the operator what to do.

## What Was Built

- A derived `ProgressGateAbortReason` type (extracted from the `ProgressGateDecision` union) so the formatter and the gate definition can never drift apart.
- A `ProgressGateAbortBounds` interface holding the two configurable numeric limits (`maxContextResets`, `maxCheckpoints`) that the messages can name.
- A pure `describeProgressGateAbort(reason, bounds)` formatter in `adws/phases/progressGate.ts` with an exhaustive `switch` — adding a future reason that lacks a message causes a compile error.
- Updated `buildPhase.ts` abort branch to call the formatter instead of building the generic message inline.
- Nine new unit tests covering wording correctness, mutual exclusivity, bound interpolation, and determinism.

## Technical Implementation

### Files Modified

- `adws/phases/progressGate.ts`: Added `ProgressGateAbortReason` type alias, `ProgressGateAbortBounds` interface, and `describeProgressGateAbort()` pure formatter after the existing `evaluateProgressGate` function.
- `adws/phases/buildPhase.ts`: Extended the `from './progressGate'` import to include `describeProgressGateAbort`; replaced the 4-line inline message builder in the abort branch with a single `throw new Error(describeProgressGateAbort(decision.reason, bounds))` call (net line reduction, stays ≤300 lines).
- `adws/phases/__tests__/progressGate.test.ts`: Added a `describe('describeProgressGateAbort', …)` block with nine test cases (no new test files needed).

### Key Changes

- **`no_progress` message** — "Build aborted — no progress. The build stopped advancing: after N restarts the worktree returned to a state already seen this build, so the agent is stuck. Inspect the plan and the task before re-running — a plain retry will likely stall the same way."
- **`backstop` message** — "Build aborted — checkpoint backstop reached. The build kept reaching new states but exhausted the N-checkpoint ceiling, so the issue is likely too large for a single build. Split it into smaller issues rather than re-running it unchanged."
- The formatter is **pure** (no I/O, no side effects) and bound-parameterised so it needs no config import and is trivially unit-testable.
- The partial-output tail (`buildResult.output.substring(0, 500)`) is intentionally **dropped** — the build agent's partial output is already persisted to its state file, and the error comment already directs operators to the logs.
- **No new comment-posting machinery.** The thrown `Error` travels the unchanged path: `runPhase` re-throws it → the orchestrator's `catch` calls `handleWorkflowError` → `ctx.errorMessage = String(error)` → the `## :x: ADW Workflow Error` comment renders it in the `**Error:**` field.

## How to Use

There is no user-facing configuration change. When a build is aborted by the progress gate, the operator will see one of two distinct messages in the `## :x: ADW Workflow Error` issue comment:

1. **No-progress abort** — the `**Error:**` field reads `Error: Build aborted — no progress. The build stopped advancing…`. Action: inspect the plan and task; do not re-run unchanged.
2. **Backstop abort** — the `**Error:**` field reads `Error: Build aborted — checkpoint backstop reached. The build kept reaching new states…`. Action: split the issue into smaller pieces; do not re-run unchanged.

## Configuration

No new configuration is required. The bounds (`maxContextResets` from `MAX_CONTEXT_RESETS`, `maxCheckpoints` from `MAX_PROGRESS_CHECKPOINTS`) are already defined in `adws/core/config.ts` and passed to the formatter at the throw site in `buildPhase.ts`.

## Testing

Run the unit tests:

```sh
bunx vitest run adws/phases/__tests__/progressGate.test.ts
```

Or the full suite:

```sh
bun run test:unit
```

The new `describeProgressGateAbort` test block verifies: `no_progress` wording (stopped advancing, stuck, plan/task referenced, no "too large" / "split"), `backstop` wording (too large, split, no "no progress" / "stuck"), mutual distinctness, bound interpolation, and determinism. The existing `evaluateProgressGate` tests are unchanged and must continue to pass.

## Notes

- **Exhaustiveness guard.** The `default: { const exhaustive: never = reason; return exhaustive; }` block ensures that a future abort reason added to `ProgressGateDecision` causes a TypeScript compile error in `describeProgressGateAbort` until a new message branch is added.
- **`String(error)` prefix.** `handleWorkflowError` uses `String(error)`, which prepends `"Error: "` to the message. The operator-facing comment therefore reads `Error: Build aborted — …`, consistent with how the previous generic message surfaced.
- **Dependency.** This feature depends on the discriminated `ProgressGateDecision` (`reason: 'no_progress' | 'backstop'`) and gate wiring shipped in #559. See `app_docs/feature-qej3f4-novelty-progress-gate.md` for that foundation.
- **No new files or libraries.** The formatter lives in the existing `progressGate.ts`; tests extend the existing `progressGate.test.ts`.
