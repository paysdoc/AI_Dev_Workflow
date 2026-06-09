# Feature: Distinct operator-facing abort messages for the build progress gate

## Metadata
issueNumber: `560`
adwId: `23ipne-distinct-operator-fa`
issueJson: `{"number":560,"title":"Distinct operator-facing abort messages for the build progress gate","body":"## Parent PRD\n\n`specs/prd/build-context-reset-progress-gate.md`\n\n## What to build\n\nThe progress gate (#559) has two abort reasons that mean very different things to an operator. Surface them as **two distinct failure messages** through the existing workflow-completion error path, so the operator knows which corrective action to take:\n\n- **No-progress abort** — the build stopped advancing. Message indicates the agent/plan is stuck and the operator should inspect the plan or task (not simply retry).\n- **Backstop abort** — the build kept reaching novel states but exhausted the checkpoint ceiling. Message indicates the issue is likely too large and should be split rather than re-run unchanged.\n\nSee the PRD'\''s **Implementation Decisions → Operator-facing failure signal** section.\n\n## Acceptance criteria\n\n- [ ] A no-progress abort produces a failure message stating progress stopped and pointing the operator at the plan/task.\n- [ ] A backstop abort produces a distinct failure message stating the issue likely too large and should be split.\n- [ ] Both messages are surfaced via the existing workflow-completion error path (no new comment-posting machinery required).\n- [ ] The two reasons are not conflated into a single generic message.\n\n## Blocked by\n\n- Blocked by #559\n\n## User stories addressed\n\n- User story 11\n- User story 12","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-06-09T16:23:26Z","comments":[],"actionableComment":null}`

## Feature Description

The build phase progress gate (shipped in #559, `adws/phases/progressGate.ts`) aborts a stalled build at a batch boundary with one of two discriminated reasons:

- **`no_progress`** — the committed worktree returned to a previously-seen tree state (frozen build that wrote nothing, or oscillating build that churned back to a prior tree). The build is genuinely stuck.
- **`backstop`** — the build kept reaching *novel* committed states but crossed the `MAX_PROGRESS_CHECKPOINTS` ceiling. The build was making progress, but the issue is too large to finish within the checkpoint budget.

These two reasons demand **opposite operator responses**. A `no_progress` abort means "the plan or task is wrong — inspect it; re-running unchanged will stall the same way." A `backstop` abort means "the work is real but too big — split the issue into smaller pieces rather than re-running it unchanged."

Today the build phase collapses both into a single thrown error whose text always reads *"Build agent made no progress at batch boundary…"* (`adws/phases/buildPhase.ts:234`). For a `backstop` abort this is **factually wrong** — the build *did* make progress — and it gives the operator no signal to split the issue. This feature replaces that single generic throw with **two distinct, operator-facing messages**, one per reason, surfaced through the **existing** workflow-completion error path (`handleWorkflowError` → `ctx.errorMessage` → the `## :x: ADW Workflow Error` issue comment) with no new comment-posting machinery.

This is the follow-up slice explicitly anticipated by #559 (see its plan **Notes → "Follow-up slice (out of scope here): distinct, user-facing abort messages for `no_progress` vs `backstop`. The discriminated decision established here is the seam that follow-up edits."**). The discriminated `decision.reason` already exists; this slice only adds the wording and wires it in.

## User Story

As an **ADW operator whose build phase was aborted by the progress gate**
I want **the failure comment to tell me which kind of stall occurred and which corrective action to take**
So that **I inspect the plan/task when the build is stuck (`no_progress`) and split the issue when it is merely too large (`backstop`), instead of blindly re-running a workflow that will fail the same way.**

## Problem Statement

`adws/phases/buildPhase.ts` (lines 230–235) handles a gate abort like this:

```ts
if (decision.kind === 'abort') {
  const bound = decision.reason === 'no_progress'
    ? `per-batch reset cap (${MAX_CONTEXT_RESETS})`
    : `progress checkpoint backstop (${MAX_PROGRESS_CHECKPOINTS})`;
  throw new Error(`Build agent made no progress at batch boundary (${decision.reason}) — ${bound} reached. Last partial output: ${buildResult.output.substring(0, 500)}`);
}
```

Two problems:

1. **Conflation.** The leading sentence — *"Build agent made no progress at batch boundary"* — is hardcoded for both reasons. The only per-reason variation is the parenthetical `(${decision.reason})` token and the `bound` phrase. A `backstop` abort therefore tells the operator the build "made no progress," which is the opposite of what happened (the backstop only fires on *novel* states), and never suggests splitting the issue.
2. **No corrective guidance.** Neither branch tells the operator what to *do*. `no_progress` should point at the plan/task; `backstop` should recommend splitting the issue. The raw reason token (`no_progress` / `backstop`) is jargon, not operator guidance.

The message text is the operator-facing signal: `handleWorkflowError` (`adws/phases/workflowCompletion.ts:152`) sets `ctx.errorMessage = String(error)`, and the `## :x: ADW Workflow Error` comment template (`adws/github/workflowCommentsIssue.ts:166`) renders `ctx.errorMessage` verbatim in its `**Error:**` field. So fixing the thrown message fixes the operator-facing comment — through the path that already exists.

## Solution Statement

Introduce a **pure message formatter** that maps a gate abort reason to a distinct, operator-facing failure message, and wire the build phase to throw it.

- Add `describeProgressGateAbort(reason, bounds)` to `adws/phases/progressGate.ts` — the module that already owns `ProgressGateDecision` and its `reason` union. It is a pure function (same inputs → same string, no I/O, no mutation) returning the full operator-facing message for the given reason:
  - **`no_progress`** → states the build **stopped advancing / is stuck** and directs the operator to **inspect the plan and task** (a plain retry will stall the same way).
  - **`backstop`** → states the build **kept reaching new states but exhausted the checkpoint ceiling**, so the issue is **likely too large** and should be **split** rather than re-run unchanged.
- Derive the formatter's reason type from the existing decision union (`ProgressGateAbortReason = Extract<ProgressGateDecision, { kind: 'abort' }>['reason']`) so the two stay in sync, and use an exhaustive `switch` (with a `never` default) so adding a future reason is a compile error here.
- In `adws/phases/buildPhase.ts`, replace the generic `throw new Error(...)` at the abort branch with `throw new Error(describeProgressGateAbort(decision.reason, { maxContextResets: MAX_CONTEXT_RESETS, maxCheckpoints: MAX_PROGRESS_CHECKPOINTS }))`.

**No new comment-posting machinery.** The thrown message flows through the unchanged path: `runPhase` re-throws non-rate-limit/timeout errors (`adws/core/phaseRunner.ts:196`) → the orchestrator's `catch` calls `handleWorkflowError` (e.g. `adws/adwBuild.tsx:75`) → `ctx.errorMessage = String(error)` → the existing `## :x: ADW Workflow Error` comment renders it. `workflowCompletion.ts`, `phaseRunner.ts`, the orchestrators, and the comment templates are **untouched**.

The decision to keep the formatter as a pure function in `progressGate.ts` (rather than a new typed error class) is deliberate: the abort `reason` is already in hand at the throw site, the two messages are static per reason, and a pure mapping is trivially unit-testable in the existing `progressGate.test.ts` — the minimal change that satisfies "no new machinery." The 500-char partial-output tail is dropped from the thrown message: the build agent's partial output is already persisted to its state file earlier in the same iteration (`buildPhase.ts:200–209`), and the error comment already says "Please check the logs for more details," so the operator-facing message stays crisp and unambiguous (which directly serves the "not conflated" criterion).

## Relevant Files

Use these files to implement the feature:

- `adws/phases/progressGate.ts` — **primary change site.** Pure gate module (42 lines) that already exports `ProgressGateDecision` (with `reason: 'no_progress' | 'backstop'`), `ProgressGateInput`, and `evaluateProgressGate`. Add the `ProgressGateAbortReason` type (derived from the decision union), a small `ProgressGateAbortBounds` interface, and the pure `describeProgressGateAbort(reason, bounds)` formatter. Keeps all abort semantics in one cohesive module; stays far under the 300-line guideline.
- `adws/phases/buildPhase.ts` — **wire-in site.** The gate-abort branch (lines 230–235) currently builds a single generic message inline. Replace it with a throw that calls `describeProgressGateAbort(decision.reason, …)`. Add `describeProgressGateAbort` to the existing `from './progressGate'` import (which already imports `evaluateProgressGate`). `MAX_CONTEXT_RESETS` and `MAX_PROGRESS_CHECKPOINTS` are already imported from `../core`. Net line change is a small reduction; the file stays ≤300 lines (coding-guideline cap).
- `adws/phases/workflowCompletion.ts` — **read-only reference; must remain unchanged.** `handleWorkflowError` (line 140) is the workflow-completion error path: it sets `ctx.errorMessage = String(error)` and posts the `'error'` stage comment. Confirms no new comment machinery is required.
- `adws/github/workflowCommentsIssue.ts` — **read-only reference.** `formatErrorComment` (line 166) renders `ctx.errorMessage` in the `**Error:**` field of the `## :x: ADW Workflow Error` comment (dispatched via `case 'error'` at line 350). This is where the two distinct messages become operator-visible; no edit needed.
- `adws/core/phaseRunner.ts` — **read-only reference.** `runPhase` (line 117) catches `RateLimitError`/`AgentTimeoutError` specially and re-throws everything else (line 196). Confirms a plain `Error` from the build phase reaches the orchestrator's `handleWorkflowError` call unchanged.
- `adws/adwBuild.tsx` — **read-only reference.** Shows the orchestrator `try/catch` (lines 71–76) that funnels phase errors into `handleWorkflowError`. The same pattern is used by every composite orchestrator that runs the build phase (`adwPlanBuild`, `adwPlanBuildTest`, `adwSdlc`, etc.), so fixing the thrown message fixes all of them at once.
- `adws/core/config.ts` — **read-only reference.** Defines `MAX_CONTEXT_RESETS` (line ~99) and `MAX_PROGRESS_CHECKPOINTS` (line 101), the two bounds passed into the formatter. No change.
- `.adw/coding_guidelines.md` — coding guidelines to follow (purity, guard clauses / exhaustive narrowing, type safety, ≤300-line files, declarative style).

### New Files

_None._ The pure formatter is added to the existing `adws/phases/progressGate.ts`; tests are added to the existing `adws/phases/__tests__/progressGate.test.ts`. (The per-issue BDD `.feature` file is produced by the SDLC scenario phase, not authored as part of the build — see Testing Strategy.)

### Conditional Documentation (per `.adw/conditional_docs.md`)

- `app_docs/feature-qej3f4-novelty-progress-gate.md` — **directly relevant (the #559 dependency).** Conditions match exactly: "When modifying `evaluateProgressGate`, `ProgressGateDecision`, or `ProgressGateInput` in `adws/phases/progressGate.ts`", "When working with the build phase restart loop in `adws/phases/buildPhase.ts`", and "When troubleshooting a build that aborted with `no_progress` or `backstop` at a batch boundary." Read first — it documents the discriminated decision this slice formats and explicitly names this follow-up.
- `app_docs/feature-9zcqhw-detect-compaction-restart-build-agent.md` — **relevant.** Conditions include "When modifying `buildContinuationPrompt()` or the `buildPhase.ts` continuation while loop." Read before editing the build loop's abort branch to avoid perturbing the restart/recovery flow.

## Implementation Plan

### Phase 1: Foundation

Add the pure operator-message formatter to the gate module and lock it down with unit tests. This is dependency-free and is the entire substantive logic of the feature.

- `ProgressGateAbortReason` type (derived from `ProgressGateDecision`) + `ProgressGateAbortBounds` interface + pure `describeProgressGateAbort(reason, bounds)` in `adws/phases/progressGate.ts`.
- Unit tests for the formatter in `adws/phases/__tests__/progressGate.test.ts`.

### Phase 2: Core Implementation

Wire the formatter into the build phase's abort branch, replacing the single generic throw with two distinct messages.

- Edit the gate-abort branch in `adws/phases/buildPhase.ts` to throw `describeProgressGateAbort(decision.reason, …)`.

### Phase 3: Integration

Confirm the two messages flow through the unchanged workflow-completion error path to the operator-facing comment, and validate end-to-end.

- Verify (by reading, no edits) that `handleWorkflowError` → `ctx.errorMessage` → `formatErrorComment` carries the new messages verbatim, and that `runPhase`/orchestrators are unaffected.
- Run the validation commands.

## Step by Step Tasks

Execute every step in order, top to bottom.

### 1. Add the `ProgressGateAbortReason` type and `describeProgressGateAbort` formatter

In `adws/phases/progressGate.ts`, after the existing `evaluateProgressGate` function, add:

- A reason alias derived from the decision union so it never drifts:
  ```ts
  /** The abort reasons the progress gate can return (derived from {@link ProgressGateDecision}). */
  export type ProgressGateAbortReason = Extract<ProgressGateDecision, { kind: 'abort' }>['reason'];
  ```
- The bounds the message can name (passed in to keep the formatter pure — no config import):
  ```ts
  export interface ProgressGateAbortBounds {
    /** Per-batch restart cap (MAX_CONTEXT_RESETS). */
    maxContextResets: number;
    /** Checkpoint backstop ceiling (MAX_PROGRESS_CHECKPOINTS). */
    maxCheckpoints: number;
  }
  ```
- The pure formatter, using an exhaustive `switch` so a future reason fails to compile here:
  ```ts
  /**
   * Maps a progress-gate abort reason to a distinct, operator-facing failure message
   * describing the corrective action. Pure: same inputs → same string; no I/O, no mutation.
   * The two reasons demand opposite responses and must not be conflated.
   */
  export function describeProgressGateAbort(
    reason: ProgressGateAbortReason,
    bounds: ProgressGateAbortBounds,
  ): string {
    switch (reason) {
      case 'no_progress':
        return (
          `Build aborted — no progress. The build stopped advancing: after ${bounds.maxContextResets} ` +
          `restarts the worktree returned to a state already seen this build, so the agent is stuck. ` +
          `Inspect the plan and the task before re-running — a plain retry will likely stall the same way.`
        );
      case 'backstop':
        return (
          `Build aborted — checkpoint backstop reached. The build kept reaching new states but ` +
          `exhausted the ${bounds.maxCheckpoints}-checkpoint ceiling, so the issue is likely too large ` +
          `for a single build. Split it into smaller issues rather than re-running it unchanged.`
        );
      default: {
        // Exhaustiveness guard: a new reason added to ProgressGateDecision must be handled above.
        const exhaustive: never = reason;
        return exhaustive;
      }
    }
  }
  ```
- Wording requirements (assert these in tests):
  - The `no_progress` message contains the "stopped advancing / stuck" idea **and** directs the operator to the **plan/task**; it must **not** suggest the issue is "too large" or to "split."
  - The `backstop` message contains the "too large" + "split" guidance; it must **not** say the build "made no progress" / "stuck."
  - The two strings are not equal.

### 2. Unit-test `describeProgressGateAbort`

In `adws/phases/__tests__/progressGate.test.ts`, add a `describe('describeProgressGateAbort', …)` block (pure function, no mocks). Cover:

1. **`no_progress` guidance** — message mentions progress stopped / stuck and references the plan/task (e.g. `/stopped advancing/i` and `/plan/i` and `/task/i`); does **not** contain `/too large/i` or `/split/i`.
2. **`backstop` guidance** — message mentions the issue is too large and to split it (e.g. `/too large/i` and `/split/i`); does **not** contain `/no progress/i` or `/stuck/i`.
3. **Distinctness** — `describeProgressGateAbort('no_progress', bounds) !== describeProgressGateAbort('backstop', bounds)` (the two reasons are not conflated into one message).
4. **Bound interpolation** — the `no_progress` message includes `String(bounds.maxContextResets)`; the `backstop` message includes `String(bounds.maxCheckpoints)`.
5. **Purity / determinism** — calling the formatter twice with identical inputs returns an identical string.

Use a small fixed `bounds` (e.g. `{ maxContextResets: 3, maxCheckpoints: 20 }`).

### 3. Wire the formatter into the build phase abort branch

In `adws/phases/buildPhase.ts`:

- Extend the existing progress-gate import to include the formatter:
  ```ts
  import { evaluateProgressGate, describeProgressGateAbort } from './progressGate';
  ```
- Replace the current abort branch (lines ~230–235) with a compact throw that delegates the message to the pure formatter:
  ```ts
  if (decision.kind === 'abort') {
    const bounds = { maxContextResets: MAX_CONTEXT_RESETS, maxCheckpoints: MAX_PROGRESS_CHECKPOINTS };
    throw new Error(describeProgressGateAbort(decision.reason, bounds));
  }
  ```
- Do **not** change anything else in the loop: the restart-trigger handling, the partial agent-state write (lines ~200–209, which already persists `buildResult.output`), the `continue` path on `decision.kind === 'continue'`, the `!buildResult.success` throw, the success branch, and the post-loop `build_committing` commit all stay as-is.
- Confirm `buildPhase.ts` remains ≤300 lines after the edit (the change is a net reduction).

### 4. Verify the unchanged workflow-completion error path (read-only)

No edits — confirm by reading that the two messages reach the operator verbatim:

- `adws/core/phaseRunner.ts` — `runPhase` re-throws the build phase's `Error` (it is neither `RateLimitError` nor `AgentTimeoutError`).
- The orchestrators' `catch` (e.g. `adws/adwBuild.tsx:71–76`) calls `handleWorkflowError(config, error, …)` for non-`AuthRequiredError` errors.
- `adws/phases/workflowCompletion.ts` — `handleWorkflowError` sets `ctx.errorMessage = String(error)` and posts the `'error'` stage comment.
- `adws/github/workflowCommentsIssue.ts` — `formatErrorComment` renders `ctx.errorMessage` in the `## :x: ADW Workflow Error` comment's `**Error:**` field.

### 5. Run the validation commands

Execute every command in **Validation Commands** below and ensure each exits cleanly with zero regressions.

## Testing Strategy

### Unit Tests

`.adw/project.md` declares `## Unit Tests: enabled`, so unit tests are in scope.

- **`describeProgressGateAbort` (`adws/phases/__tests__/progressGate.test.ts`)** — the cases listed in Step 2: `no_progress` guidance (progress stopped + plan/task, not "split"), `backstop` guidance (too large + split, not "no progress"), distinctness of the two strings, bound interpolation, and determinism. Pure function, no mocks. This is the executable validation surface for the feature, mirroring how #559 unit-tested the pure `evaluateProgressGate` while leaving the `buildPhase.ts` wiring to BDD.

The existing `evaluateProgressGate` tests in the same file remain unchanged and must continue to pass.

### Edge Cases

- **`backstop` no longer says "no progress."** The backstop abort message must not claim the build made no progress (it crossed the gate only on *novel* states) — it recommends splitting. This is the core conflation bug being fixed.
- **Both `no_progress` flavours map to one message.** A frozen build (clean tree → seed hash recurs) and an oscillating build (returns to a prior tree) both abort as `no_progress`; both produce the same "inspect the plan/task" message, because the corrective action is the same. Correct, not a regression.
- **Successful build never engages the gate.** A build that completes normally exits via the success branch; no abort message is produced (unchanged behaviour).
- **Other build failures keep their own messages.** `Build Agent failed: …`, `Cannot read plan file …`, and the commit-agent failure path are untouched — only the gate-abort message changes.
- **`String(error)` prefix.** `handleWorkflowError` uses `String(error)`, which yields `"Error: <message>"`; the `**Error:**` field therefore reads `Error: Build aborted — …`. This matches how the previous generic message surfaced (no behavioural change to the rendering, only the wording).
- **Exhaustiveness.** If a third abort reason is ever added to `ProgressGateDecision`, the `never` default makes `describeProgressGateAbort` fail to type-check until the new reason is given a message — preventing silent re-conflation.

## Acceptance Criteria

- [ ] A **no-progress** abort produces a failure message stating the build **stopped advancing / is stuck** and pointing the operator at the **plan/task** (and advising against a plain retry).
- [ ] A **backstop** abort produces a **distinct** failure message stating the issue is **likely too large** and should be **split** (not re-run unchanged).
- [ ] Both messages are surfaced via the **existing** workflow-completion error path (`handleWorkflowError` → `ctx.errorMessage` → the `## :x: ADW Workflow Error` comment) — **no new comment-posting machinery**, and `workflowCompletion.ts` / `phaseRunner.ts` / orchestrators / comment templates are unchanged.
- [ ] The two reasons are **not conflated**: `describeProgressGateAbort('no_progress', …) !== describeProgressGateAbort('backstop', …)`, and the build phase no longer emits the shared "Build agent made no progress at batch boundary" string for the `backstop` case.
- [ ] `describeProgressGateAbort` is a **pure** function (no I/O, no mutation) with an exhaustive `switch` over a reason type derived from `ProgressGateDecision`.
- [ ] `describeProgressGateAbort` is unit-tested for both reasons' guidance, distinctness, bound interpolation, and determinism; the existing `evaluateProgressGate` tests still pass.
- [ ] `adws/phases/buildPhase.ts` stays ≤300 lines; the test/review compaction-recovery paths remain untouched.
- [ ] All validation commands pass with zero regressions.

## Validation Commands

Execute every command to validate the feature works correctly with zero regressions. Run from the repo root (the `adws/` worktree).

- `bun run lint` — ESLint (`eslint .`); zero errors.
- `bunx tsc --noEmit` — root type check; zero errors (verifies the exhaustive `never` guard and the derived reason type).
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW type check (Additional Type Checks); zero errors.
- `bun run build` — `tsc` build; succeeds.
- `bun run test:unit` — `vitest run`; all suites pass, including the new `describeProgressGateAbort` cases in `adws/phases/__tests__/progressGate.test.ts` and the unchanged `evaluateProgressGate` cases.

Targeted run while iterating (optional):
- `bunx vitest run adws/phases/__tests__/progressGate.test.ts`

## Notes

- **Coding guidelines** (`.adw/coding_guidelines.md`): `describeProgressGateAbort` is pure (no I/O, no mutation) and uses an exhaustive `switch` with a `never` guard (type safety; clarity over cleverness). Bounds are passed as parameters rather than imported, keeping the function dependency-free and trivially testable. `buildPhase.ts` stays ≤300 lines (the edit is a net reduction). No `any`; the reason type is derived from the existing discriminated union so the formatter and the gate cannot drift apart.
- **No new machinery / no new files.** The feature reuses the existing error path end-to-end. The formatter lives in the module that already owns the decision type; tests extend the existing test file.
- **Why a pure formatter, not a typed error class.** The abort `reason` is already available at the throw site and the messages are static per reason, so a pure mapping is sufficient and is the smallest change that satisfies "no new comment-posting machinery." A typed error subclass would add a type without buying anything here.
- **Partial-output tail intentionally dropped from the thrown message.** It bloated the `**Error:**` comment field and worked against the "not conflated / crisp guidance" goal; the build agent's partial output is already persisted to its state file at `buildPhase.ts:200–209`, and the error comment already directs operators to the logs.
- **Missing PRD.** The issue references `specs/prd/build-context-reset-progress-gate.md` (its "Implementation Decisions → Operator-facing failure signal" section), which is **not present** in the repository — the same gap noted in the #559 plan. This plan is derived from the issue body and the #559 design (`app_docs/feature-qej3f4-novelty-progress-gate.md`). If the PRD is later added, reconcile the message wording with its "Operator-facing failure signal" section.
- **BDD scenarios.** Per `.adw/scenarios.md`, per-issue scenarios live under `features/per-issue/` and are agent-input only (never executed by the runner). End-to-end gate-abort behaviour is exercised by the per-issue scenarios the SDLC scenario phase generates for issue #560; the unit tests above are the executable validation surface for this slice (consistent with #559).
- **No new libraries.** All work uses existing modules and the already-configured vitest. Library install command, if ever needed: `bun add <package>` (per `.adw/commands.md`).
- **Blocked by #559.** This slice depends on the discriminated `ProgressGateDecision` (`no_progress` | `backstop`) and the gate wiring in `buildPhase.ts`, both shipped in #559 (merged). No further dependency work is required.
