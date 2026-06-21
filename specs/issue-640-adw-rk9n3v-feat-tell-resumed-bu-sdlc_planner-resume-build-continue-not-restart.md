# Feature: Tell a resumed build agent to inventory and continue, not restart

## Metadata
issueNumber: `640`
adwId: `rk9n3v-feat-tell-resumed-bu`
issueJson: `{"number":640,"title":"feat: tell resumed build agent to continue, not restart","body":"## Parent PRD\n\n`specs/prd/stage-recovery-resume-in-place.md`\n\n## What to build\n\nExtend the build/implement prompt so a resumed run is told to inventory the existing partial work in its worktree and continue it, rather than restarting from scratch. This is what makes resume-in-place converge (each resume does strictly less work). See PRD \"Implementation Decisions\" (recognition instruction) and \"Testing Decisions\" (not unit-tested; BDD scenario if anything).\n\n## Acceptance criteria\n\n- [ ] A resumed run is signalled that it is resuming and instructed to inventory + continue\n- [ ] A resumed run's PR is indistinguishable from a non-resumed one\n- [ ] No regression to fresh (non-resume) build behavior\n\n## Blocked by\n\n- Blocked by #638\n\n## User stories addressed\n\n- User story 4\n- User story 18\n- User story 19","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-06-19T17:38:14Z","comments":[],"actionableComment":null}`

## Feature Description

This is the final behavioral slice of the **stage-recovery / resume-in-place** PRD chain (#636 classifier → #637 `phase_timeout` recovery → #639 bounded resume cap → #638 worktree-reuse gate → **#640 this slice**).

Slice #638 made takeover **resume in place**: when a confirmed-dead `abandoned` or `phase_timeout` workflow is reclaimed and its worktree is still git-healthy (per `decideWorktreeReuse`), the worktree is **preserved** — its uncommitted partial work survives — instead of being hard-reset to `origin/<branch>`. The re-spawned orchestrator then re-runs from the recovered stage. When the watchdog killed a long build mid-flight, the build phase had not recorded `build_completed`, so `shouldExecuteStage('build_completed', recoveryState)` returns `true` and **the build phase re-executes from the top**.

The gap this slice closes: on that re-execution, `executeBuildPhase` hands the build agent the **plain plan content** (`currentPlanContent = planContent`). The fresh build agent receives no signal that it is resuming, and the implement prompt tells it to "read the plan and implement it." So it can restart implementation from scratch — re-doing, or worse clobbering/reverting, exactly the partial work #638 just preserved. That defeats the point of resume-in-place: instead of each resume doing *strictly less* work (converging toward done), resumes thrash and burn tokens.

The fix is a **recognition instruction**: when the build phase is re-executing as part of a resumed run, the first build-agent invocation is given the same "the git state of this worktree is the authoritative record of what is done — inventory committed + uncommitted work, then continue from the first not-yet-done step; do NOT redo or revert work that is already present" framing that the in-build continuation path already uses for token-limit/compaction restarts. The instruction is injected **only on resume**, so fresh builds are byte-for-byte unchanged, and because it only changes *process* (inventory-then-continue) and never asks the agent to annotate its output, the resulting PR is indistinguishable from a non-resumed one.

The mechanism already exists and is proven: `buildContinuationPrompt()` (in `adws/phases/planPhase.ts`) produces precisely this git-authoritative "continue, don't restart" prompt for its `checkpointCommitsPresent` branch. This slice reuses that single source of truth — adding a new `'resumed_in_place'` reason and a thin wrapper — rather than authoring a second copy of the instruction. No new prompt-engineering surface, no edit to the static `.claude/commands/implement.md`.

## User Story

As an ADW operator
I want a build that resumes in a reused worktree (after a watchdog timeout or liveness reclaim) to be told it is resuming and to inventory the partial work already present and continue from there
So that each resume does strictly less work and converges to a finished implementation — instead of restarting from scratch, wasting agent time and tokens, and risking reverting work that survived the takeover — while a fresh (non-resume) build behaves exactly as before and the resumed run's PR looks identical to a normal one.

## Problem Statement

`executeBuildPhase` (`adws/phases/buildPhase.ts`) seeds its build loop with:

```ts
let currentPlanContent = planContent;          // the raw plan, no resume framing
...
const buildResult = await runBuildAgent(issue, logsDir, currentPlanContent, ...);
```

Only the **in-build** restart paths (token-limit / compaction) re-wrap the prompt via `buildContinuationPrompt(...)`. There is **no** equivalent signal for the **cross-orchestrator** resume case:

- A `phase_timeout`/`abandoned` workflow is reclaimed; #638's gate decides REUSE; the worktree (with partial, possibly uncommitted build work) is preserved.
- A new orchestrator process re-runs `executeBuildPhase`. Because `build_completed` was never recorded, `shouldExecuteStage('build_completed', recoveryState)` is `true`, so the build agent runs again — with the **plain plan**.
- The `/implement` (or `/implement-tdd`) prompt says "Read the plan and implement it." The agent has no idea partial work exists. It can redo completed steps or revert in-progress edits.

Consequences:
1. **Resume-in-place does not converge.** The PRD's whole premise — "each resume does strictly less work" — fails, because the build agent treats every resume as a cold start.
2. **Preserved work can be destroyed by the agent.** #638 went to lengths to keep the working tree; the build agent can then overwrite or revert it.
3. **Wasted tokens / time.** Re-implementing already-finished steps is pure loss, on top of the agent budget #639's cap is trying to bound.

The signal needed is already available in the build phase: `config.recoveryState.canResume` is `true` exactly when this execution is a resume of a prior run (it is the same flag `shouldExecuteStage` keys off). The build phase does not need to know the gate's REUSE/RESET decision — the "inventory then continue" instruction degrades gracefully to "start from step 1" when little or no partial work is present (e.g. a RESET-then-resume, or a resume that had not reached build), so `canResume` is a sound, simple trigger.

## Solution Statement

Reuse the existing git-authoritative continuation prompt as the single source of truth, and inject it on resume:

1. **Extend `buildContinuationPrompt()` (`adws/phases/planPhase.ts`)** with a third `reason` value, `'resumed_in_place'`, and a matching reason sentence (e.g. *"interrupted before it finished — the previous orchestrator timed out or was abandoned"*). The git-authoritative body (committed-state + uncommitted-state inspection, "do NOT redo or revert", demoted previous-output tail) is exactly what resume-in-place wants, so it is emitted unchanged.

2. **Add a thin pure wrapper `buildResumeInPlacePrompt(originalPlanContent, baseBranch?)`** (same module) that calls `buildContinuationPrompt(originalPlanContent, '', 'resumed_in_place', baseBranch, /*checkpointCommitsPresent*/ true)`. The previous-agent output is empty — on a cross-orchestrator resume there is no in-process summary; the prompt already declares the git state authoritative and the tail a "secondary hint only", so an empty tail is correct.

3. **Add a pure predicate `shouldResumeBuildInPlace(recoveryState)`** (same module) returning `recoveryState.canResume === true`. Named and extracted purely to document intent and make the decision unit-testable, matching the codebase's pure-decision pattern (`decideWorktreeReuse`, `nextResumeAction`, `evaluateProgressGate`).

4. **Wire into `executeBuildPhase` (`adws/phases/buildPhase.ts`).** Inside the `shouldExecuteStage('build_completed', recoveryState)` block, where `currentPlanContent` is seeded, choose the resume-framed prompt when resuming:

   ```ts
   let currentPlanContent = shouldResumeBuildInPlace(recoveryState)
     ? buildResumeInPlacePrompt(planContent, defaultBranch)
     : planContent;
   ```

   This affects **only the first** build-agent invocation. The token-limit/compaction loop already recomputes `currentPlanContent = buildContinuationPrompt(planContent, ...)` from the raw `planContent` on each in-build restart, so there is no interaction or double-wrapping. Because the framing rides in the plan content passed to `runBuildAgent`, it flows to **both** `/implement` and `/implement-tdd` (TDD mode) with no change to `buildAgent.ts`.

5. **Do NOT edit `.claude/commands/implement.md`.** The static command file cannot know at authoring time whether a given invocation is a resume; baking an unconditional "inventory and continue" instruction there would change *fresh* build behavior (violating acceptance criterion 3) and the agent cannot reliably self-detect resume from the worktree alone. The correct seam is the runtime-composed prompt, exactly as `buildContinuationPrompt` already does for in-build restarts. `implement.md` stays untouched (also avoiding the recurring out-of-scope command-file churn class).

6. **Re-export the new functions** from `adws/phases/index.ts` and `adws/workflowPhases.ts` alongside the existing `buildContinuationPrompt` export, for consistency and test import.

**Why the PR stays indistinguishable (criterion 2):** the recognition instruction changes only *how the agent decides what to do next* (inventory → continue). It never instructs the agent to label commits, comments, or the PR as "resumed". Commit messages and the PR body are generated downstream by the commit/PR agents from the diff and the issue — not from the build prompt — so a resumed run's PR is identical in shape to a fresh one.

## Relevant Files

Use these files to implement the feature:

- `adws/phases/planPhase.ts` — Home of `buildContinuationPrompt()` (the proven git-authoritative "continue, don't restart" prompt) and `MAX_CONTINUATION_OUTPUT_LENGTH`. Add the `'resumed_in_place'` reason, the `buildResumeInPlacePrompt()` wrapper, and the `shouldResumeBuildInPlace()` predicate here, keeping all build-prompt selection logic in one module.
- `adws/phases/buildPhase.ts` — `executeBuildPhase()` seeds `currentPlanContent = planContent` and runs the build loop. This is the single wiring point: seed the resume-framed prompt when `shouldResumeBuildInPlace(recoveryState)`. `config.recoveryState` and `config.defaultBranch` are already destructured.
- `adws/phases/__tests__/planPhase.test.ts` — Existing unit tests for `buildContinuationPrompt` (both checkpoint and non-checkpoint branches). Extend with the `'resumed_in_place'` reason, the wrapper, and the predicate (pure-function assertions only).
- `adws/phases/index.ts` — Re-exports `executePlanPhase, buildContinuationPrompt, MAX_CONTINUATION_OUTPUT_LENGTH` from `planPhase`. Add the two new exports.
- `adws/workflowPhases.ts` — Aggregator that also imports `buildContinuationPrompt`; add the new exports for consistency.
- `adws/types/workflowTypes.ts` — `RecoveryState` interface (the predicate's input) and `WorkflowStage`/`STAGE_ORDER` semantics. Read-only context; no change expected.
- `adws/agents/buildAgent.ts` — `runBuildAgent()` receives the composed plan content and routes to `/implement` or `/implement-tdd`. Read-only context confirming the resume framing flows through both modes; **no change**.
- `.claude/commands/implement.md` — The static build/implement command prompt. Read-only context; **explicitly not modified** (see Solution step 5).

### Conditional Documentation (read for context — matched via `.adw/conditional_docs.md`)
- `app_docs/feature-6uquvb-build-continuation-committed-state.md` — **Primary.** Documents `buildContinuationPrompt()`, its `checkpointCommitsPresent`/`baseBranch` parameters, the git-authoritative framing, its call sites in `buildPhase.ts`, and the `planPhase.test.ts` coverage. Directly governs this change.
- `app_docs/feature-qej3f4-novelty-progress-gate.md` — The build-phase restart loop (`tokenLimitExceeded`/`compactionDetected`, checkpoint counters) that the resume-prompt seed sits adjacent to.
- `app_docs/feature-9gjajh-worktree-and-vcs.md` — The worktree-reuse gate / resume-in-place decision logic (#638) that preserves the worktree this slice's instruction operates on.
- `app_docs/feature-d0hv98-exhaustive-stage-classifier.md` — How `phase_timeout`/`abandoned` recovery is cap-gated (#639) then probe-gated (#638: `recoverViaResumeInPlaceOrReset`), i.e. *when* a resumed build re-execution actually happens.

### New Files
- None. The change extends existing modules. (An optional per-issue BDD scenario, `features/per-issue/feature-640.feature`, may be authored by the scenario phase per "Testing Strategy" below; it is not created by this plan.)

## Implementation Plan

### Phase 1: Foundation (pure prompt + predicate)
Extend the existing pure prompt builder and add the resume-specific wrapper and predicate in `adws/phases/planPhase.ts`. No I/O, no behavior change to existing callers (the new reason and functions are additive). This keeps the "continue, don't restart" instruction as a single source of truth.

### Phase 2: Core Implementation (wire into the build phase)
In `adws/phases/buildPhase.ts`, seed the first build-agent prompt with `buildResumeInPlacePrompt(planContent, defaultBranch)` when `shouldResumeBuildInPlace(recoveryState)` is true, otherwise the raw `planContent`. Re-export the new functions from the phase barrels.

### Phase 3: Integration (verify both modes and no fresh-run regression)
Confirm the framing flows through `runBuildAgent` to both `/implement` and `/implement-tdd` unchanged, that fresh runs (`canResume === false`) receive the identical plain plan as today, and that the in-build token-limit/compaction loop is unaffected. Validate with the full unit suite, type checks, lint, and build.

## Step by Step Tasks
Execute every step in order, top to bottom.

### Step 1 — Extend `buildContinuationPrompt` with a `'resumed_in_place'` reason
- In `adws/phases/planPhase.ts`, widen the `reason` parameter union from `'token_limit' | 'compaction'` to `'token_limit' | 'compaction' | 'resumed_in_place'`.
- Add the corresponding `reasonMessage` branch, e.g. `'interrupted before it finished — the previous orchestrator timed out or was abandoned'`. Keep the existing two messages byte-for-byte.
- No other change to the function body: the `checkpointCommitsPresent` branch already emits the git-authoritative inventory/continue instructions we want.

### Step 2 — Add the `buildResumeInPlacePrompt` wrapper
- In `adws/phases/planPhase.ts`, add an exported pure function:
  - `buildResumeInPlacePrompt(originalPlanContent: string, baseBranch?: string): string`
  - Returns `buildContinuationPrompt(originalPlanContent, '', 'resumed_in_place', baseBranch, true)`.
  - JSDoc: explains it is the first-invocation prompt for a build resumed in a reused worktree (#640), reusing the git-authoritative continuation framing so the agent inventories existing work and continues rather than restarting; empty previous-output is intentional (no in-process summary on cross-orchestrator resume).

### Step 3 — Add the `shouldResumeBuildInPlace` predicate
- In `adws/phases/planPhase.ts`, add an exported pure function:
  - `shouldResumeBuildInPlace(recoveryState: RecoveryState): boolean` returning `recoveryState.canResume === true`.
  - Import the `RecoveryState` type from `../types/workflowTypes` (or `../core` re-export) consistent with existing imports.
  - JSDoc: documents that `canResume` is the sound trigger because the inventory-then-continue instruction degrades gracefully to "start from step 1" when no partial build work is present.

### Step 4 — Re-export from the phase barrels
- In `adws/phases/index.ts`, add `buildResumeInPlacePrompt` and `shouldResumeBuildInPlace` to the existing `export { ... } from './planPhase'` line.
- In `adws/workflowPhases.ts`, add the same two names to its `planPhase` import/export block (mirroring `buildContinuationPrompt`).

### Step 5 — Wire the resume prompt into `executeBuildPhase`
- In `adws/phases/buildPhase.ts`, import `buildResumeInPlacePrompt` and `shouldResumeBuildInPlace` from `./planPhase` (next to the existing `buildContinuationPrompt` import).
- Inside the `if (shouldExecuteStage('build_completed', recoveryState))` block, change the seed line to:
  ```ts
  let currentPlanContent = shouldResumeBuildInPlace(recoveryState)
    ? buildResumeInPlacePrompt(planContent, defaultBranch)
    : planContent;
  ```
- Add a brief comment noting this is the resume-in-place recognition instruction (#640) and that the token-limit/compaction loop below re-wraps from raw `planContent`, so there is no double-wrapping.
- Leave the rest of the build loop (continuation re-wrapping, progress gate, commit) untouched.

### Step 6 — Unit tests for the pure surface
- Extend `adws/phases/__tests__/planPhase.test.ts` (see "Testing Strategy → Unit Tests"). Cover the new reason message, the wrapper's content (plan preserved, git-authoritative framing, inventory instructions, empty tail handled), and the predicate's boolean truth table.

### Step 7 — Run all validation commands
- Execute every command in "Validation Commands" and confirm zero errors and zero regressions (existing `planPhase.test.ts` assertions for `token_limit`/`compaction` must remain green).

## Testing Strategy

### Unit Tests
`.adw/project.md` contains `## Unit Tests: enabled`, and the function being extended (`buildContinuationPrompt`) is already unit-tested in `adws/phases/__tests__/planPhase.test.ts`. Mirror that existing coverage for the new pure surface (string-builder + boolean predicate assertions only — no mocks, no I/O):

- **`buildContinuationPrompt` with `reason: 'resumed_in_place'`** (called with `checkpointCommitsPresent: true`):
  - Plan content is preserved in the output.
  - The git-authoritative framing is present (contains `authoritative`).
  - Committed-state inspection guidance is present (contains `git log`; contains `origin/<baseBranch>` when a base branch is supplied; no `origin/undefined` when omitted).
  - Uncommitted-state inspection guidance is present (contains `git status` and `git diff --staged`).
  - "Do NOT redo or revert" guidance is present.
  - The reason sentence reflects an interrupted/abandoned orchestrator (not the token-limit or compaction wording).
  - Existing `token_limit` and `compaction` assertions remain unchanged and green.
- **`buildResumeInPlacePrompt(plan, baseBranch?)`**:
  - Output equals / contains the `buildContinuationPrompt(plan, '', 'resumed_in_place', baseBranch, true)` output (plan preserved, authoritative framing, git inspection guidance).
  - With no `baseBranch`, falls back to base-less git guidance without emitting `origin/undefined`.
  - Empty previous-output does not produce a malformed `<previous-agent-output ...>` block.
- **`shouldResumeBuildInPlace(recoveryState)`**:
  - Returns `true` when `canResume: true`.
  - Returns `false` when `canResume: false`.

> Scope note (per PRD "Testing Decisions" and `.adw/coding_guidelines.md`): the **behavioral** acceptance criteria — that the LLM actually inventories-and-continues rather than restarting, and that the PR is indistinguishable — are **not** unit-tested (they are LLM-runtime behavior, not pure logic). They are covered by the existing blocking end-verification (scenario tests + passive review) that already runs after every resume, and optionally by a per-issue BDD scenario. Unit tests here are confined to the pure prompt-construction/selection surface, consistent with the existing `planPhase.test.ts`.

### Edge Cases
- **Fresh run (`canResume === false`)** — predicate returns `false`; `currentPlanContent === planContent` exactly as today. No regression (criterion 3).
- **Resume where build already completed** — `shouldExecuteStage('build_completed')` is `false`, so the build agent is not invoked and the resume prompt is never constructed.
- **Resume that had not reached build** (e.g. last completed stage before plan commit) — predicate is `true`; the inventory-then-continue instruction degrades gracefully (agent inspects, finds little/no code, starts at step 1).
- **In-build token-limit/compaction restart during a resumed build** — the loop recomputes `currentPlanContent` from raw `planContent` via `buildContinuationPrompt`, so the resume framing is cleanly superseded by the continuation framing; no double-wrapping.
- **No base branch available** — `buildResumeInPlacePrompt(plan)` (undefined `baseBranch`) emits base-less git guidance with no `origin/undefined`.
- **TDD mode (`/implement-tdd`)** — scenario files present; the resume framing rides in `planContent` and reaches the TDD prompt unchanged.

## Acceptance Criteria
- A resumed build re-execution (`recoveryState.canResume === true`) gives the build agent a prompt that states it is resuming and instructs it to inventory committed + uncommitted work in the worktree and continue from the first not-yet-done step, without redoing or reverting existing work.
- The recognition instruction reaches both `/implement` and `/implement-tdd` (rides in the composed plan content).
- A resumed run's commits and PR are produced by the unchanged commit/PR agents and contain no resume-specific annotations — indistinguishable from a non-resumed run.
- Fresh (non-resume) builds receive the identical plain plan content as before — no behavior change.
- `.claude/commands/implement.md` is unchanged.
- New pure functions are unit-tested; all existing `planPhase.test.ts` assertions remain green.
- `bun run lint`, `bunx tsc --noEmit`, `bunx tsc --noEmit -p adws/tsconfig.json`, `bun run test:unit`, and `bun run build` all pass with zero errors.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions. Commands are from `.adw/commands.md`.

- `bun run lint` — Lint for code quality issues.
- `bunx tsc --noEmit` — Type-check the repository.
- `bunx tsc --noEmit -p adws/tsconfig.json` — Additional ADW type check (per `.adw/commands.md`).
- `bunx vitest run adws/phases/__tests__/planPhase.test.ts` — Targeted run of the extended prompt/predicate unit tests.
- `bun run test:unit` — Full unit suite; confirm zero regressions (especially the existing `buildContinuationPrompt` `token_limit`/`compaction` cases and any build-phase coverage).
- `bun run build` — Build to verify no build errors.

## Notes
- **Coding guidelines** (`.adw/coding_guidelines.md`): the change adheres to *Purity* (pure prompt builder + pure predicate, side effects stay in `executeBuildPhase`), *Modularity / single source of truth* (reuse `buildContinuationPrompt` instead of a second copy of the instruction), *Clarity over cleverness* (named predicate documents intent), *Type safety* (extend the `reason` union explicitly; consume the typed `RecoveryState`), and *Guard-clause/low-nesting* style (a single ternary at the seed site). `planPhase.ts` stays well under the 300-line ceiling.
- **Why not edit `implement.md`:** the resume signal is only known at runtime; injecting via the composed prompt (as `buildContinuationPrompt` already does) is the only way to satisfy "no regression to fresh build behavior". Editing the static command file would also re-open the recurring out-of-scope command-file revert hazard. `implement.md` is deliberately left untouched.
- **Single source of truth:** the git-authoritative inventory/continue instructions live only in `buildContinuationPrompt`. If that wording is later tuned, both the in-build continuation path and the resume-in-place path benefit automatically.
- **No new libraries.** Library install command (if ever needed) per `.adw/commands.md`: `bun add <package>`.
- **Dependency:** Blocked by #638 (worktree-reuse gate / resume-in-place), which is what preserves the partial worktree this instruction operates on. #638 is reported DONE/ready-for-PR per project status; this slice should land on top of it.
- **Scope boundary:** this slice changes only the *first* build-agent prompt on a resumed run. It does not touch the takeover/recovery routing (#636–#639), the worktree-reuse gate (#638), `buildAgent.ts`, or the PR-review build path (`runPrReviewBuildAgent`).
