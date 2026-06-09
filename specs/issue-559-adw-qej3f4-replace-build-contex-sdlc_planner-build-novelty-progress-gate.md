# Feature: Replace build context-reset cap with novelty progress gate

## Metadata
issueNumber: `559`
adwId: `qej3f4-replace-build-contex`
issueJson: `{"number":559,"title":"Replace build context-reset cap with novelty progress gate","state":"OPEN","author":"paysdoc","labels":[],"parentPrd":"specs/prd/build-context-reset-progress-gate.md","summary":"Replace the hard MAX_CONTEXT_RESETS kill in the build phase with a state-novelty progress gate bounded by a hard backstop, applied to both build-phase restart triggers (tokenLimitExceeded and compactionDetected). evaluateProgressGate is a pure function returning continue | abort:no_progress | abort:backstop; the caller does git work (commit-if-dirty via /commit agent, HEAD tree hash) and updates seen/counters. Adds env-tunable MAX_PROGRESS_CHECKPOINTS (default 20). Test/review compaction-recovery paths are unchanged."}`

## Feature Description

The build phase runs a Claude Code build agent that can be terminated and restarted when it approaches its token budget (`tokenLimitExceeded`) or when Claude Code compacts its context window (`compactionDetected`). Today both triggers share a single per-phase counter, and when that counter reaches `MAX_CONTEXT_RESETS` (default 3) the phase **throws** — killing the workflow regardless of whether the build was actually making progress.

This feature replaces the hard kill with a **state-novelty progress gate**. When the per-batch restart counter reaches `MAX_CONTEXT_RESETS`, the build phase no longer throws. Instead it:

1. Commits the worktree via the existing `/commit` agent (skipping the commit when the worktree is clean),
2. Computes the `HEAD` **tree** hash,
3. Evaluates a pure gate that classifies the committed state as **novel**, **non-novel**, or **past the backstop**, and acts:
   - **Novel** tree state (never seen this build) and within the backstop → reset the per-batch counter, record the hash, increment the checkpoint count, and let the build continue across another batch of restarts.
   - **Novel** state but past the backstop → **backstop abort**.
   - **Non-novel** state (the build returned to a prior tree, or nothing was committed) → **no-progress abort**.

The value: a build that is genuinely progressing (producing new committed states) can survive far more than `MAX_CONTEXT_RESETS` restarts and complete, while a stalled build (frozen — making no changes — or oscillating — churning back to a prior state) is aborted promptly instead of burning the full reset budget on every batch. A hard backstop (`MAX_PROGRESS_CHECKPOINTS`, default 20) bounds even a pathologically "always novel" build.

This is the end-to-end spine of the feature and works on its own. Abort *messages* may be generic at this stage; a follow-up slice refines them into distinct, user-facing strings. The discriminated decision (`no_progress` vs `backstop`) is established here so the follow-up slice only needs to change wording.

## User Story

As an **ADW operator running long, token-heavy build phases**
I want **the build phase to keep restarting a build that is making real progress and to stop one that is stuck**
So that **legitimately large builds finish instead of being killed at a fixed reset cap, and genuinely stalled builds fail fast instead of wasting the full reset budget on every batch.**

## Problem Statement

The current build phase (`adws/phases/buildPhase.ts`) enforces a hard cap:

- `tokenLimitExceeded` and `compactionDetected` each increment a shared `continuationNumber`/`contextResetCount`, restart the build agent with a continuation prompt, and **throw** once `continuationNumber > MAX_CONTEXT_RESETS`.
- The two trigger-handling blocks (lines ~186–244) are near-duplicates differing only in the partial-state metadata they write and the recovery-comment type they post.

This conflates "ran out of restart budget" with "is not making progress." A build that is steadily committing new work is killed at the same fixed count as a build that is spinning in place. There is no signal of *whether the worktree state is advancing* between restarts.

## Solution Statement

Introduce a **state-novelty progress gate** keyed on the worktree `HEAD` tree hash:

- Seed a `seen` set with the build-start `HEAD` tree hash.
- Track a **per-batch** restart counter (resets at each checkpoint) and a monotonic **checkpoint** counter (the number of novel-state boundaries crossed).
- When the per-batch counter reaches `MAX_CONTEXT_RESETS`, reach a **batch boundary**: commit the worktree via the `/commit` agent **only if dirty**, compute the `HEAD` tree hash, and call the pure `evaluateProgressGate`.
  - **Novel + within backstop** → record the hash in `seen`, increment the checkpoint count, reset the per-batch counter to 0, restart with a continuation prompt.
  - **Novel + at/over backstop** → throw a backstop abort.
  - **Non-novel** (hash already in `seen`, which also covers "nothing committed → unchanged hash == a seen hash, including the seed") → throw a no-progress abort.

`evaluateProgressGate` is a **pure** function (no I/O, does not mutate inputs) returning a discriminated decision. All git work (commit-if-dirty, tree-hash read) and all state mutation (`seen`, counters) stay in the caller (`buildPhase.ts`), per the acceptance criteria. The two duplicate trigger blocks collapse into a single handler covering both `tokenLimitExceeded` and `compactionDetected` (which already share the counter). A thin VCS helper returns the `HEAD` tree hash; a second thin helper reports worktree dirtiness for the commit guard. The test and review phases' compaction-recovery path (`testRetry.ts`, `scenarioTestPhase.ts`, `scenarioFixPhase.ts`, `reviewPhase.ts`, `retryOrchestrator.ts`) is **not touched**.

Termination is guaranteed without the old loop bound: every batch boundary either aborts or advances the checkpoint counter, and a novel boundary at/over `MAX_PROGRESS_CHECKPOINTS` aborts — so the number of "continue" decisions is bounded by `MAX_PROGRESS_CHECKPOINTS`, and within each batch the per-batch counter strictly increases until the next boundary.

## Relevant Files

Use these files to implement the feature:

- `adws/phases/buildPhase.ts` — **primary change site.** Houses the build-agent restart loop and the two near-duplicate `tokenLimitExceeded`/`compactionDetected` blocks to consolidate. Wire in the seed, the per-batch/checkpoint counters, the commit-if-dirty boundary commit, the tree-hash read, and the gate. Keep the post-loop `build_committing` success-path commit. (Note: file is ~300 lines — consolidation should keep it within the ≤300-line guideline; extract only the pure gate.)
- `adws/core/config.ts` — defines `MAX_CONTEXT_RESETS` (line 99) and the other `MAX_*` env-tunable constants. Add `MAX_PROGRESS_CHECKPOINTS` here following the exact same `Math.max(1, parseInt(process.env.X || 'default', 10)) || default` pattern.
- `adws/core/index.ts` — re-exports config constants. Add `MAX_PROGRESS_CHECKPOINTS` to the `from './config'` export list.
- `adws/vcs/commitOperations.ts` — home of `commitChanges`/`pushBranch` (already uses `git status --porcelain`). Add the thin `getHeadTreeHash(cwd?)` helper (returns the worktree `HEAD` tree hash) and a `hasUncommittedChanges(cwd?)` helper (drives the commit guard).
- `adws/vcs/index.ts` — VCS barrel. Export the two new helpers from the "Commit operations" section.
- `adws/vcs/branchOperations.ts` — reference for the thin git read-helper pattern (`getCurrentBranch`, `getDefaultBranch`): `execSync(cmd, { encoding: 'utf-8', cwd }).trim()`.
- `adws/agents/gitAgent.ts` — defines `runCommitAgent(agentName, issueClass, issueContext, logsDir, statePath?, cwd?, issueBody?)`, the existing `/commit` agent wrapper used at the batch boundary and the post-loop commit.
- `adws/phases/planPhase.ts` — defines `buildContinuationPrompt(originalPlanContent, previousOutput, reason)`, reused unchanged for both restart-within-batch and post-checkpoint restarts.
- `adws/agents/testRetry.ts`, `adws/phases/scenarioTestPhase.ts`, `adws/phases/scenarioFixPhase.ts`, `adws/phases/reviewPhase.ts`, `adws/core/retryOrchestrator.ts` — the **test/review compaction-recovery path**. Read-only reference to confirm it is independent of the build loop; **must remain unchanged**.
- `known_issues.md` (repo root) — prose "Known Issues" registry (Pattern/Description/Status/Solution/Fix attempts/Linked issues/First seen). Add an entry documenting the two design residuals. (Not `adws/known_issues.md`, which is the machine-readable *log-pattern* registry; these residuals are design limitations, not log-matchable error patterns.)
- `adws/vcs/__tests__/commitOperations.test.ts` — existing vitest suite (mocks `child_process.execSync`). Pattern reference for testing the new VCS helpers.

### New Files

- `adws/phases/progressGate.ts` — the pure progress-gate module. Exports the `ProgressGateDecision` discriminated union and `evaluateProgressGate(input)`. No imports with side effects; depends only on its inputs.
- `adws/phases/__tests__/progressGate.test.ts` — vitest unit tests for `evaluateProgressGate` covering the six required cases.

### Conditional Documentation (per `.adw/conditional_docs.md`)

- `app_docs/feature-9zcqhw-detect-compaction-restart-build-agent.md` — **directly relevant**: "When modifying `buildContinuationPrompt()` or the `buildPhase.ts` continuation while loop" and "the build agent is restarting … or posting `compaction_recovery` comments." Read before editing the build loop.
- `app_docs/feature-u7lut9-compaction-recovery-test-review-phases.md` — **relevant for the "unchanged" guarantee**: documents `testRetry.ts`/`reviewPhase.ts`/`retryOrchestrator.ts` compaction handling. Read to confirm the build-phase change does not perturb the test/review path.
- `app_docs/feature-tdlgz7-fix-boardstatus-invalid-values.md` — touches `buildPhase.ts` board-status transitions (`moveToStatus(BoardStatus.InProgress)`). Read if the board-status call near the top of the phase is affected (it should not be).

## Implementation Plan

### Phase 1: Foundation

Add the new env-tunable constant and the thin VCS helpers, with unit coverage. These are dependency-free and unblock the gate and the build-phase wiring.

- `MAX_PROGRESS_CHECKPOINTS` in `config.ts` (+ re-export) following the `MAX_CONTEXT_RESETS` pattern.
- `getHeadTreeHash(cwd?)` and `hasUncommittedChanges(cwd?)` in `vcs/commitOperations.ts` (+ barrel exports).

### Phase 2: Core Implementation

Build the pure decision function and its tests.

- `adws/phases/progressGate.ts`: `ProgressGateDecision` union + pure `evaluateProgressGate`.
- `adws/phases/__tests__/progressGate.test.ts`: the six required cases.

### Phase 3: Integration

Wire the gate into the build phase and document residuals.

- Consolidate the two restart blocks in `buildPhase.ts` into one handler; seed `seen`; add per-batch + checkpoint counters; at the batch boundary commit-if-dirty → hash → `evaluateProgressGate` → act (continue/abort). Preserve the success path and the post-loop `build_committing` commit. Leave test/review phases untouched.
- Add the two-residuals entry to root `known_issues.md`.
- Run the validation commands.

## Step by Step Tasks

Execute every step in order, top to bottom.

### 1. Add `MAX_PROGRESS_CHECKPOINTS` constant

- In `adws/core/config.ts`, immediately after the `MAX_CONTEXT_RESETS` definition (line ~99), add:
  ```ts
  /** Maximum number of progress checkpoints (novel-state batch boundaries) before the backstop abort (default: 20). */
  export const MAX_PROGRESS_CHECKPOINTS = Math.max(1, parseInt(process.env.MAX_PROGRESS_CHECKPOINTS || '20', 10)) || 20;
  ```
- In `adws/core/index.ts`, add `MAX_PROGRESS_CHECKPOINTS` to the existing `export { ... } from './config';` list (next to `MAX_CONTEXT_RESETS`).

### 2. Add thin VCS helpers (tree hash + dirty check)

- In `adws/vcs/commitOperations.ts`, add two helpers mirroring the existing `execSync(..., { encoding: 'utf-8', cwd }).trim()` style:
  ```ts
  /**
   * Returns the tree object hash of the current HEAD commit (the worktree's
   * committed state). Used by the build progress gate to detect novel states.
   * @param cwd - Worktree directory to inspect.
   */
  export function getHeadTreeHash(cwd?: string): string {
    return execSync('git rev-parse "HEAD^{tree}"', { encoding: 'utf-8', cwd }).trim();
  }

  /**
   * Returns true when the worktree has staged or unstaged changes.
   * Drives the batch-boundary commit guard (clean tree → skip the /commit agent).
   * @param cwd - Worktree directory to inspect.
   */
  export function hasUncommittedChanges(cwd?: string): boolean {
    return execSync('git status --porcelain', { encoding: 'utf-8', cwd }).trim().length > 0;
  }
  ```
  (The double-quoting of `"HEAD^{tree}"` prevents shell brace handling.)
- In `adws/vcs/index.ts`, add `getHeadTreeHash` and `hasUncommittedChanges` to the `from './commitOperations'` export block.

### 3. Create the pure progress-gate module

- Create `adws/phases/progressGate.ts`:
  ```ts
  /**
   * Pure state-novelty progress gate for the build phase. No I/O; does not mutate
   * its inputs. The caller performs git work (commit, tree-hash read) and updates
   * the `seen` set and counters based on the returned decision.
   */

  /** Discriminated decision returned by {@link evaluateProgressGate}. */
  export type ProgressGateDecision =
    | { kind: 'continue' }
    | { kind: 'abort'; reason: 'no_progress' }
    | { kind: 'abort'; reason: 'backstop' };

  export interface ProgressGateInput {
    /** HEAD tree hash computed at this batch boundary. */
    headTreeHash: string;
    /** Tree hashes already seen this build (seeded with the build-start hash). Not mutated. */
    seen: ReadonlySet<string>;
    /** Number of progress checkpoints already recorded this build. */
    checkpointCount: number;
    /** Hard backstop on checkpoints (MAX_PROGRESS_CHECKPOINTS). */
    maxCheckpoints: number;
  }

  /**
   * Classifies a committed worktree state at a batch boundary.
   * - Non-novel (returned to a prior state, or nothing committed → unchanged hash
   *   still in `seen`, including the build-start seed) → abort: no_progress.
   * - Novel but the backstop is exhausted → abort: backstop.
   * - Novel and within budget → continue.
   */
  export function evaluateProgressGate(input: ProgressGateInput): ProgressGateDecision {
    const { headTreeHash, seen, checkpointCount, maxCheckpoints } = input;

    if (seen.has(headTreeHash)) {
      return { kind: 'abort', reason: 'no_progress' };
    }
    if (checkpointCount >= maxCheckpoints) {
      return { kind: 'abort', reason: 'backstop' };
    }
    return { kind: 'continue' };
  }
  ```
- Boundary semantics to honor in the tests: with `maxCheckpoints = N`, a novel boundary at `checkpointCount = N - 1` returns `continue` (the last permitted checkpoint), and a novel boundary at `checkpointCount = N` returns `abort: backstop`.

### 4. Unit-test `evaluateProgressGate`

- Create `adws/phases/__tests__/progressGate.test.ts` (vitest; pure function, no mocks). Cover exactly the six required cases:
  1. **First novel boundary → continue**: `seen = {seed}`, `headTreeHash = novelA`, `checkpointCount = 0`, `maxCheckpoints = 20` → `{ kind: 'continue' }`.
  2. **Previously-seen hash → no_progress**: `seen = {seed, h1}`, `headTreeHash = h1` → `{ kind: 'abort', reason: 'no_progress' }`.
  3. **Seed hash recurring (frozen) → no_progress**: `seen = {seed}`, `headTreeHash = seed` → `{ kind: 'abort', reason: 'no_progress' }`.
  4. **Novel at the backstop limit → continue**: `maxCheckpoints = 3`, `checkpointCount = 2`, `headTreeHash = novel` → `{ kind: 'continue' }`.
  5. **Novel one past the backstop → backstop abort**: `maxCheckpoints = 3`, `checkpointCount = 3`, `headTreeHash = novel` → `{ kind: 'abort', reason: 'backstop' }`.
  6. **Net-negative novel state → continue**: a novel hash representing a deletion/refactor tree, `checkpointCount` within range → `{ kind: 'continue' }` (asserts novelty, not size, drives the decision).
- Add a purity assertion: the passed `seen` set is unchanged after the call (size and membership identical).

### 5. Unit-test the VCS helpers

- In `adws/vcs/__tests__/commitOperations.test.ts` (or a focused new file `treeHash.test.ts` under the same dir), following the existing `vi.mock('child_process', () => ({ execSync: vi.fn() }))` pattern:
  - `getHeadTreeHash` returns the trimmed `execSync` output and invokes `git rev-parse "HEAD^{tree}"` with the provided `cwd`.
  - `hasUncommittedChanges` returns `true` for non-empty porcelain output and `false` for empty/whitespace output, invoking `git status --porcelain` with the provided `cwd`.

### 6. Consolidate the build-phase restart handling and wire the gate

In `adws/phases/buildPhase.ts`:

- **Imports**: add `MAX_PROGRESS_CHECKPOINTS` to the `from '../core'` import (alongside `MAX_CONTEXT_RESETS`); import `getHeadTreeHash, hasUncommittedChanges` from `'../vcs'`; import `evaluateProgressGate` (and the type) from `'./progressGate'`.
- **Seed + counters** (inside the `if (shouldExecuteStage('build_completed', recoveryState))` block, just before the loop):
  - `const seenTreeHashes = new Set<string>([getHeadTreeHash(worktreePath)]);` — seed with the build-start tree hash.
  - `let perBatchResets = 0;` (per-batch restart counter; resets at each checkpoint).
  - `let checkpointCount = 0;` (number of novel-state boundaries crossed).
  - Keep the existing `contextResetCount` (declared at line ~59) as the **monotonic total** used for the cost record and the recovery-comment continuation number.
- **Loop condition**: change `while (continuationNumber <= MAX_CONTEXT_RESETS && !buildCompleted)` to `while (!buildCompleted)`. Remove the now-unused `continuationNumber`. (Termination is guaranteed by the gate; see Notes.)
- **Consolidate the two trigger blocks** (current lines ~186–244) into one handler. Determine the trigger once:
  ```ts
  const restartTrigger: 'token_limit' | 'compaction' | null =
    buildResult.tokenLimitExceeded ? 'token_limit'
    : buildResult.compactionDetected ? 'compaction'
    : null;
  ```
  When `restartTrigger` is set:
  1. `perBatchResets++; contextResetCount++;` and `log(...)` the reset (mention trigger + `perBatchResets`/`MAX_CONTEXT_RESETS` and `checkpointCount`).
  2. Write the partial agent state — branch the metadata only: `{ tokenUsage: buildResult.tokenUsage }` for `token_limit`, `{ compactionDetected: true }` for `compaction` (preserve the existing `completeExecution(..., true)` shape). `AgentStateManager.appendLog(...)` as today.
  3. Post the recovery comment — `token_limit_recovery` vs `compaction_recovery` based on trigger; set `ctx.tokenContinuationNumber = contextResetCount` and, for `token_limit`, `ctx.tokenUsage = buildResult.tokenUsage`.
  4. **If `perBatchResets < MAX_CONTEXT_RESETS`** → restart within the batch: `currentPlanContent = buildContinuationPrompt(planContent, buildResult.output, restartTrigger); continue;`.
  5. **Else (batch boundary, `perBatchResets >= MAX_CONTEXT_RESETS`)**:
     - Commit-if-dirty: `if (hasUncommittedChanges(worktreePath)) { await runCommitAgent('build-agent', issueType, JSON.stringify(issue), logsDir, undefined, worktreePath, issue.body); }`.
     - `const headTreeHash = getHeadTreeHash(worktreePath);`
     - `const decision = evaluateProgressGate({ headTreeHash, seen: seenTreeHashes, checkpointCount, maxCheckpoints: MAX_PROGRESS_CHECKPOINTS });`
     - On `decision.kind === 'abort'`: `throw new Error(...)` — message names the reason (`no_progress` or `backstop`) and the relevant bound (`MAX_CONTEXT_RESETS` / `MAX_PROGRESS_CHECKPOINTS`), plus a partial-output excerpt (mirror the existing throw messages). (Generic wording is acceptable per the issue; the follow-up slice refines it. Keep the two reasons textually distinguishable.)
     - On `decision.kind === 'continue'`: `seenTreeHashes.add(headTreeHash); checkpointCount++; perBatchResets = 0; currentPlanContent = buildContinuationPrompt(planContent, buildResult.output, restartTrigger); continue;`.
- **Order of checks** (preserve today's precedence): restart-trigger handling first, then `if (!buildResult.success) { ...write failed state...; throw }`, then the success branch (`ctx.buildOutput = buildResult.output; buildCompleted = true;`).
- **Do not change** the post-loop `build_committing` success-path commit (the existing `runCommitAgent` under `shouldExecuteStage('build_committing', ...)`), nor the `phaseCostRecords` block (it already reads `contextResetCount`).
- **Guideline check**: ensure `buildPhase.ts` stays ≤300 lines after consolidation. The de-duplication should net-reduce the trigger blocks; if the file still exceeds the cap, extract the partial-state write + recovery-comment step into a small named helper (a side-effecting `recordContextReset(...)`) rather than inflating the loop — keep the pure gate in `progressGate.ts`.

### 7. Document the two residuals in `known_issues.md`

- Add an entry to the repo-root `known_issues.md` (prose format) documenting:
  1. **Backstop is per-orchestrator-incarnation** — `seenTreeHashes` and `checkpointCount` live in process memory, so an orchestrator takeover resets them; the backstop restarts from zero on takeover.
  2. **Monotonic accumulator runs to the backstop** — a build that always reaches a novel state (e.g., monotonically adding/removing trivial content) is not caught by the novelty check and runs all the way to `MAX_PROGRESS_CHECKPOINTS` before the backstop abort, consuming budget.
- Use the file's existing fields (Pattern / Description / Status / Solution / Fix attempts / Linked issues / First seen). Status: `open` (accepted residual). Linked issues: `#559`. First seen: `2026-06-09`.

### 8. Run the validation commands

- Execute every command in **Validation Commands** below and ensure each exits cleanly with zero regressions.

## Testing Strategy

### Unit Tests

`.adw/project.md` declares `## Unit Tests: enabled`, so unit tests are in scope.

- **`evaluateProgressGate` (`adws/phases/__tests__/progressGate.test.ts`)** — the six required cases (first novel → continue; previously-seen → no_progress; seed recurring/frozen → no_progress; novel at backstop limit → continue; novel one past backstop → backstop abort; net-negative novel → continue), plus a purity assertion that `seen` is not mutated. Pure function, no mocks.
- **VCS helpers (`adws/vcs/__tests__/commitOperations.test.ts`)** — mock `child_process.execSync`: `getHeadTreeHash` trims output and calls `git rev-parse "HEAD^{tree}"` with the given `cwd`; `hasUncommittedChanges` maps non-empty/empty porcelain output to `true`/`false` and calls `git status --porcelain` with the given `cwd`.

These are the validation surface for this slice. `buildPhase.ts` orchestration (the loop/gate wiring) is exercised end-to-end by the ADW pipeline's per-issue BDD scenarios generated separately for issue #559; the unit tests above lock down the pure decision and the git primitives it depends on.

### Edge Cases

- **Legitimate no-op / normal success build** — build agent returns `success` on the first run (no restart trigger); the loop exits and the gate is never engaged; the post-loop `build_committing` commit runs as today.
- **Frozen build** — no file changes across `MAX_CONTEXT_RESETS` restarts → boundary commit guard skips (clean tree) → `HEAD` tree hash unchanged → equals the seed (in `seen`) → `no_progress` abort.
- **Oscillating build** — commits a change that returns the tree to a previously-seen state → hash already in `seen` → `no_progress` abort.
- **Net-negative batch** — deletions/refactor that yield a tree never seen before → novel hash → `continue` (size shrinks, novelty holds).
- **Progressing build** — a novel committed state at each boundary → survives well beyond `MAX_CONTEXT_RESETS` restarts (up to `MAX_PROGRESS_CHECKPOINTS` checkpoints).
- **Always-novel build** — keeps producing novel states → stopped at the backstop once `checkpointCount` reaches `MAX_PROGRESS_CHECKPOINTS`.
- **Both triggers** — `tokenLimitExceeded` and `compactionDetected` flow through the same consolidated handler and the same gate.
- **Commit agent failure at a boundary** — `runCommitAgent` throws (existing behavior for commit failures); the build phase fails. Not silently swallowed.
- **Assumption** — by build time the worktree `HEAD` always has at least one commit (the plan commit), so `getHeadTreeHash` is well-defined.

## Acceptance Criteria

- [ ] `evaluateProgressGate` is a pure function (no I/O, does not mutate inputs — `seen` typed `ReadonlySet`) returning a discriminated decision: `continue` | `abort: no_progress` | `abort: backstop`; the caller performs git work and updates `seen`/counters.
- [ ] New env-tunable constant `MAX_PROGRESS_CHECKPOINTS` (default 20) follows the existing `MAX_CONTEXT_RESETS` pattern in `config.ts` and is re-exported from `core/index.ts`.
- [ ] A thin VCS helper (`getHeadTreeHash`) returns the worktree `HEAD` tree hash; a `hasUncommittedChanges` helper backs the commit guard; both exported from `vcs/index.ts`.
- [ ] At each batch boundary the worktree is committed via the existing `/commit` agent (`runCommitAgent`); a guard skips the commit when the worktree is clean (clean tree → unchanged hash → no-progress).
- [ ] The two near-duplicate restart-handling blocks in the build phase are consolidated into one handler (commit → hash → gate → act) covering both `tokenLimitExceeded` and `compactionDetected`.
- [ ] A progressing build (novel state each boundary) survives more than `MAX_CONTEXT_RESETS` restarts; a frozen build (clean tree) and an oscillating build (returns to a prior tree) abort with no-progress; a build that always reaches novel states is stopped at the backstop.
- [ ] A net-negative batch (deletions/refactor) that produces a novel state counts as progress (`continue`).
- [ ] The test and review phases' compaction-recovery path is unchanged (no edits to `testRetry.ts`, `scenarioTestPhase.ts`, `scenarioFixPhase.ts`, `reviewPhase.ts`, `retryOrchestrator.ts`).
- [ ] A legitimate no-op build completes via the success path and never engages the gate.
- [ ] `evaluateProgressGate` is unit-tested: first novel boundary → continue; previously-seen hash → no-progress; seed hash recurring (frozen) → no-progress; novel at the backstop limit → continue; novel one past the backstop → backstop abort; net-negative novel state → continue.
- [ ] `known_issues.md` documents the two residuals: the backstop is per-orchestrator-incarnation (resets on takeover), and a monotonic accumulator runs to the backstop.
- [ ] All validation commands pass with zero regressions.

## Validation Commands

Execute every command to validate the feature works correctly with zero regressions. Run from the repo root (`adws/` worktree).

- `bun run lint` — ESLint (`eslint .`); zero errors.
- `bunx tsc --noEmit` — root type check; zero errors.
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW type check (Additional Type Checks); zero errors.
- `bun run build` — `tsc` build; succeeds.
- `bun run test:unit` — `vitest run`; all suites pass, including the new `adws/phases/__tests__/progressGate.test.ts` and the new VCS-helper tests in `adws/vcs/__tests__/`.

Targeted runs while iterating (optional):
- `bunx vitest run adws/phases/__tests__/progressGate.test.ts`
- `bunx vitest run adws/vcs/__tests__/commitOperations.test.ts`

## Notes

- **Coding guidelines** (`.adw/coding_guidelines.md`): keep `evaluateProgressGate` pure (no I/O, no mutation — `seen` is `ReadonlySet`); favor guard clauses (the gate is three early returns); keep `buildPhase.ts` ≤300 lines (the consolidation should net-reduce duplication; extract a small `recordContextReset` helper only if the cap is exceeded). Strict TypeScript throughout; the decision is a discriminated union, no `any`.
- **Missing PRD**: the issue references `specs/prd/build-context-reset-progress-gate.md`, which is **not present** in the repository (the `specs/prd/` directory does not contain it). This plan is derived from the issue body, which carries the full Solution and Implementation Decisions. If the PRD is later added, reconcile the "novelty over size-growth", "net-negative as progress", commit-if-dirty, and seed-set rationale with it.
- **Termination without the old loop bound**: changing the loop to `while (!buildCompleted)` is safe because every batch boundary either aborts (no_progress / backstop) or advances `checkpointCount`; a novel boundary at `checkpointCount >= MAX_PROGRESS_CHECKPOINTS` aborts, capping the number of `continue` decisions, and within each batch `perBatchResets` strictly increases until the next boundary. There is no path that loops without either completing, restarting with an incremented counter, or throwing.
- **Boundary count semantics**: the gate fires when `perBatchResets >= MAX_CONTEXT_RESETS` (i.e. `MAX_CONTEXT_RESETS` restarts per batch), rather than the old "throw after `MAX_CONTEXT_RESETS` is exceeded." This is the natural reading of "when the per-batch restart counter reaches `MAX_CONTEXT_RESETS`."
- **No new libraries.** All work uses existing modules (`child_process` via the VCS layer, vitest already configured). Library install command, if ever needed: `bun add <package>` (per `.adw/commands.md`).
- **Follow-up slice (out of scope here)**: distinct, user-facing abort messages for `no_progress` vs `backstop`. The discriminated decision established here is the seam that follow-up edits.
