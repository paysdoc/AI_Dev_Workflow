# Feature: Runner Token-Limit Continuation

## Metadata
issueNumber: `350`
adwId: `locx5w-refactor-runner-toke`
issueJson: `{"number":350,"title":"refactor: runner token-limit continuation","state":"OPEN","author":"paysdoc"}`

## Feature Description
Move token-limit continuation logic from individual phases into the runner as a cross-cutting concern. Currently `buildPhase.ts` owns a retry loop: when a token limit or context compaction is hit, it builds a continuation prompt and re-invokes the agent (up to `MAX_CONTEXT_RESETS` times). Any phase can hit a token limit, so this logic should not be duplicated per phase.

The runner detects token-limit results from phases and handles the retry loop. Phases optionally provide an `onTokenLimit(config, previousResult)` callback that returns a continuation prompt string. Phases without `onTokenLimit` fail on token limit, preserving current safe-by-default behavior.

Parent PRD: `specs/prd/declarative-orchestration-architecture.md` (user stories 9 and 10).

## User Story
As a developer
I want any phase that hits a token limit to be automatically retried by the runner with a phase-supplied continuation prompt
So that continuation logic is not duplicated in every phase and new phases get token-limit recovery for free

## Problem Statement
Token-limit continuation logic is entangled in `buildPhase.ts` as a ~100-line retry loop. Any future phase that needs continuation recovery would duplicate this loop. The logic includes: detecting `tokenLimitExceeded`/`compactionDetected` on the agent result, incrementing reset counters, posting GitHub recovery comments, building continuation prompts via `buildContinuationPrompt()`, accumulating costs across retries, and enforcing `MAX_CONTEXT_RESETS`. This is a cross-cutting concern that belongs in the runner infrastructure.

## Solution Statement
1. Extend `PhaseResult` with optional token-limit signal fields (`tokenLimitExceeded`, `tokenLimitReason`, `previousOutput`).
2. Add a new `runPhaseWithContinuation()` function in `phaseRunner.ts` that wraps `runPhase()` with the continuation loop: detect token-limit results, call `onTokenLimit` to get the continuation prompt, set `config.continuationPrompt`, and re-invoke the phase.
3. Add optional `onTokenLimit` callback to `PhaseDefinition` for declarative orchestrators; `runOrchestrator()` delegates to `runPhaseWithContinuation()` when the callback is present.
4. Refactor `executeBuildPhase()` to remove its internal loop — run the build agent once, return early with token-limit signals when detected, and read `config.continuationPrompt` for continuation runs.
5. Export a `buildPhaseOnTokenLimit()` callback from `buildPhase.ts` and wire it into all orchestrators that use `executeBuildPhase`.

## Relevant Files
Use these files to implement the feature:

- `adws/core/phaseRunner.ts` — `PhaseResult` type, `runPhase()`, `CostTracker`. Extend with token-limit fields and `runPhaseWithContinuation()`.
- `adws/core/orchestratorRunner.ts` — `PhaseDefinition`, `runOrchestrator()`. Add `onTokenLimit` to definition and use `runPhaseWithContinuation()`.
- `adws/core/config.ts` — `MAX_CONTEXT_RESETS` constant (referenced by the continuation loop).
- `adws/core/index.ts` — Barrel exports for new functions/types.
- `adws/phases/buildPhase.ts` — `executeBuildPhase()` with the current internal retry loop to remove. Export `buildPhaseOnTokenLimit()`.
- `adws/phases/workflowInit.ts` — `WorkflowConfig` interface. Add `continuationPrompt` field.
- `adws/phases/planPhase.ts` — `buildContinuationPrompt()` (existing utility, consumed by `buildPhaseOnTokenLimit`).
- `adws/phases/phaseCommentHelpers.ts` — `postIssueStageComment()` for recovery comments.
- `adws/phases/index.ts` — Phase barrel exports (export `buildPhaseOnTokenLimit`).
- `adws/workflowPhases.ts` — Top-level re-exports (export `buildPhaseOnTokenLimit`).
- `adws/types/agentTypes.ts` — `AgentResult` with `tokenLimitExceeded`, `compactionDetected` (read-only reference).
- `adws/adwPlanBuild.tsx` — Declarative orchestrator: add `onTokenLimit` to build phase definition.
- `adws/adwSdlc.tsx` — Imperative orchestrator: switch build phase call to `runPhaseWithContinuation`.
- `adws/adwChore.tsx` — Imperative orchestrator: switch build phase call to `runPhaseWithContinuation`.
- `adws/adwPlanBuildTest.tsx` — Imperative orchestrator: switch build phase call to `runPhaseWithContinuation`.
- `adws/adwPlanBuildTestReview.tsx` — Imperative orchestrator: switch build phase call to `runPhaseWithContinuation`.
- `adws/adwPlanBuildReview.tsx` — Imperative orchestrator: switch build phase call to `runPhaseWithContinuation`.
- `adws/adwPlanBuildDocument.tsx` — Imperative orchestrator: switch build phase call to `runPhaseWithContinuation`.
- `adws/adwBuild.tsx` — Standalone build orchestrator: switch build phase call to `runPhaseWithContinuation`.
- `adws/adwPatch.tsx` — Patch orchestrator: switch build phase call to `runPhaseWithContinuation`.
- `guidelines/coding_guidelines.md` — Coding conventions to follow (immutability, type safety, functional style).

### New Files
None. All changes are to existing files.

## Implementation Plan
### Phase 1: Foundation
Extend the type system to support token-limit signaling. Add `tokenLimitExceeded`, `tokenLimitReason`, and `previousOutput` fields to `PhaseResult`. Add `continuationPrompt` to `WorkflowConfig`. These are all optional fields, so existing code is unaffected.

### Phase 2: Core Implementation
1. Add `runPhaseWithContinuation()` to `phaseRunner.ts` — a new function that wraps `runPhase()` with the continuation loop. It accepts an `onTokenLimit` callback, detects token-limit results, posts recovery comments, sets `config.continuationPrompt`, and re-invokes the phase up to `MAX_CONTEXT_RESETS` times.
2. Modify `runPhase()` minimally: do NOT call `recordCompletedPhase()` when the result has `tokenLimitExceeded: true`. This prevents premature completion recording during continuation.
3. Add `onTokenLimit` to `PhaseDefinition` in `orchestratorRunner.ts`. Update `runOrchestrator()` to use `runPhaseWithContinuation()` when `phase.onTokenLimit` is present.

### Phase 3: Integration
1. Refactor `executeBuildPhase()`: remove the internal `while` loop. Run the build agent once. If `config.continuationPrompt` is set, use it as the plan content (instead of reading the original plan from file). On `tokenLimitExceeded` or `compactionDetected`, return a `PhaseResult` with token-limit signals and `previousOutput`. The commit step only runs when the build completes successfully (no `tokenLimitExceeded`).
2. Create and export `buildPhaseOnTokenLimit()` from `buildPhase.ts` — reads the original plan from file and calls `buildContinuationPrompt()` with the phase result's `previousOutput` and `tokenLimitReason`.
3. Update all 9 orchestrators that use `executeBuildPhase` to wire in the `onTokenLimit` callback.

## Step by Step Tasks
Execute every step in order, top to bottom.

### Step 1: Extend `PhaseResult` with token-limit signal fields
- In `adws/core/phaseRunner.ts`, add to `PhaseResult`:
  - `tokenLimitExceeded?: boolean` — signals the phase hit a token limit or compaction
  - `tokenLimitReason?: 'token_limit' | 'compaction'` — distinguishes the reason for context reset
  - `previousOutput?: string` — agent output before interruption, used by `onTokenLimit` callbacks
- These are optional fields, so all existing phase functions remain compatible without changes.

### Step 2: Add `continuationPrompt` to `WorkflowConfig`
- In `adws/phases/workflowInit.ts`, add to `WorkflowConfig`:
  - `continuationPrompt?: string` — when set, the phase reads this as its input prompt instead of the original plan

### Step 3: Add `runPhaseWithContinuation()` to `phaseRunner.ts`
- Create a new exported function with signature:
  ```typescript
  export async function runPhaseWithContinuation<R extends PhaseResult>(
    config: WorkflowConfig,
    tracker: CostTracker,
    fn: (config: WorkflowConfig) => Promise<R>,
    onTokenLimit: (config: WorkflowConfig, result: R) => string,
    phaseName?: string,
  ): Promise<R>
  ```
- Implementation:
  1. Call `runPhase(config, tracker, fn, phaseName)` for the first invocation.
  2. If `result.tokenLimitExceeded` is true, enter continuation loop:
     - Increment a local `resets` counter.
     - If `resets > MAX_CONTEXT_RESETS`, throw an error.
     - Log the context reset with phase name and count.
     - Update `config.ctx.tokenContinuationNumber = resets`.
     - If `result.tokenUsage`, set `config.ctx.tokenUsage = result.tokenUsage`.
     - Post a recovery comment via `postIssueStageComment()` using `'token_limit_recovery'` or `'compaction_recovery'` based on `result.tokenLimitReason`.
     - Call `config.continuationPrompt = onTokenLimit(config, result)`.
     - Re-invoke `result = await runPhase(config, tracker, fn, phaseName)`.
  3. After loop exits, clear `config.continuationPrompt = undefined`.
  4. Return the final result.
- Import `MAX_CONTEXT_RESETS` from `'./config'`, `log` from `'./utils'`, and `postIssueStageComment` from `'../phases/phaseCommentHelpers'`.
- Add `tokenUsage` to `PhaseResult` as an optional field (type: `TokenUsageSnapshot` from `../types/agentTypes`).

### Step 4: Modify `runPhase()` to not record completion on token limit
- In `adws/core/phaseRunner.ts`, change the `recordCompletedPhase` call from:
  ```typescript
  if (phaseName) recordCompletedPhase(config, phaseName);
  ```
  to:
  ```typescript
  if (phaseName && !result.tokenLimitExceeded) recordCompletedPhase(config, phaseName);
  ```
- This prevents premature completion recording during continuations. On the final successful run, the phase is recorded as completed.

### Step 5: Add `onTokenLimit` to `PhaseDefinition` and update `runOrchestrator()`
- In `adws/core/orchestratorRunner.ts`, add to `PhaseDefinition`:
  ```typescript
  readonly onTokenLimit?: (config: WorkflowConfig, previousResult: PhaseResult) => string;
  ```
- Import `WorkflowConfig` from `'../phases/workflowInit'` and `PhaseResult` from `'./phaseRunner'`.
- Import `runPhaseWithContinuation` from `'./phaseRunner'`.
- Update the phase execution loop in `runOrchestrator()`:
  ```typescript
  for (const phase of def.phases) {
    const result = phase.onTokenLimit
      ? await runPhaseWithContinuation(config, tracker, phase.execute, phase.onTokenLimit, phase.name)
      : await runPhase(config, tracker, phase.execute, phase.name);
    results.set(phase.name, result);
  }
  ```

### Step 6: Update barrel exports
- In `adws/core/index.ts`, add `runPhaseWithContinuation` to the re-exports from `'./phaseRunner'`.
- This makes it available to all imperative orchestrators.

### Step 7: Refactor `executeBuildPhase()` — remove internal loop
- In `adws/phases/buildPhase.ts`:
  1. **Read plan content**: if `config.continuationPrompt` is set, use it as `currentPlanContent`. Otherwise, read the plan from file as before.
  2. **Remove the `while (continuationNumber <= MAX_CONTEXT_RESETS && !buildCompleted)` loop**. Run `runBuildAgent()` once.
  3. **Token limit handling**: if `buildResult.tokenLimitExceeded`, return a `PhaseResult` with:
     - `tokenLimitExceeded: true`
     - `tokenLimitReason: 'token_limit'`
     - `previousOutput: buildResult.output`
     - `tokenUsage: buildResult.tokenUsage`
     - `costUsd` and `modelUsage` from the single agent run
     - Skip the commit step — return early
  4. **Compaction handling**: if `buildResult.compactionDetected`, return a `PhaseResult` with:
     - `tokenLimitExceeded: true`
     - `tokenLimitReason: 'compaction'`
     - `previousOutput: buildResult.output`
     - `costUsd` and `modelUsage` from the single agent run
     - Skip the commit step — return early
  5. **Success handling**: if `!buildResult.tokenLimitExceeded && !buildResult.compactionDetected && buildResult.success`, proceed with the commit step and return the normal `PhaseResult`.
  6. **Failure handling**: if `!buildResult.success`, throw as before.
  7. **Remove** the `contextResetCount` local variable and all continuation-related logging/state from inside `executeBuildPhase`. The runner now owns this.
  8. **Keep**: agent state management (init, write), progress callback, running token total updates, estimate-vs-actual logging. These remain per-invocation concerns.
  9. **Remove** the `buildContinuationPrompt` import — it moves to `buildPhaseOnTokenLimit`.
  10. **Remove** the GitHub recovery comment posting (`token_limit_recovery`, `compaction_recovery`) — the runner posts these now.

### Step 8: Create and export `buildPhaseOnTokenLimit()` callback
- In `adws/phases/buildPhase.ts`, add an exported function:
  ```typescript
  export function buildPhaseOnTokenLimit(config: WorkflowConfig, result: PhaseResult): string {
    const planPath = path.join(config.worktreePath, getPlanFilePath(config.issueNumber, config.worktreePath));
    const planContent = fs.readFileSync(planPath, 'utf-8');
    const reason = result.tokenLimitReason ?? 'token_limit';
    return buildContinuationPrompt(planContent, result.previousOutput ?? '', reason);
  }
  ```
- Import `buildContinuationPrompt` from `'./planPhase'` (keep the import but now used only by this callback, not the internal loop).
- Import `PhaseResult` from `'../core/phaseRunner'`.
- Export `buildPhaseOnTokenLimit` from `adws/phases/index.ts` and `adws/workflowPhases.ts`.

### Step 9: Update declarative orchestrator — `adwPlanBuild.tsx`
- Add `onTokenLimit` to the build phase definition:
  ```typescript
  import { executeBuildPhase, buildPhaseOnTokenLimit } from './workflowPhases';
  // ...
  { name: 'build', execute: executeBuildPhase, onTokenLimit: buildPhaseOnTokenLimit },
  ```

### Step 10: Update imperative orchestrators
- In each of the following files, change the `executeBuildPhase` call from `runPhase` to `runPhaseWithContinuation`:
  1. `adws/adwSdlc.tsx`:
     - Import `runPhaseWithContinuation` from `'./core/phaseRunner'` and `buildPhaseOnTokenLimit` from `'./workflowPhases'`.
     - Change `await runPhase(config, tracker, executeBuildPhase)` to `await runPhaseWithContinuation(config, tracker, executeBuildPhase, buildPhaseOnTokenLimit)`.
  2. `adws/adwChore.tsx`:
     - Same pattern as above.
  3. `adws/adwPlanBuildTest.tsx`:
     - Same pattern as above.
  4. `adws/adwPlanBuildTestReview.tsx`:
     - Same pattern as above.
  5. `adws/adwPlanBuildReview.tsx`:
     - Same pattern as above.
  6. `adws/adwPlanBuildDocument.tsx`:
     - Same pattern as above.
  7. `adws/adwBuild.tsx`:
     - Change `await runPhase(config, tracker, executeBuildPhase, 'build')` to `await runPhaseWithContinuation(config, tracker, executeBuildPhase, buildPhaseOnTokenLimit, 'build')`.
  8. `adws/adwPatch.tsx`:
     - Change `await runPhase(config, tracker, executeBuildPhase, 'build')` to `await runPhaseWithContinuation(config, tracker, executeBuildPhase, buildPhaseOnTokenLimit, 'build')`.

### Step 11: Validate
- Run `bun run lint` to verify no lint errors.
- Run `bunx tsc --noEmit` to verify root type-check passes.
- Run `bunx tsc --noEmit -p adws/tsconfig.json` to verify adws module type-check passes.
- Run `bun run build` to verify build passes.

## Testing Strategy
### Edge Cases
- Phase hits token limit on first invocation — runner should call `onTokenLimit` and retry
- Phase hits token limit on every invocation up to `MAX_CONTEXT_RESETS` — runner should throw after exceeding the limit
- Phase hits compaction (not token limit) — should be handled identically via `tokenLimitReason: 'compaction'`
- Phase without `onTokenLimit` hits token limit — should fail with a thrown error (no behavior change from current default)
- Phase succeeds on first invocation (no token limit) — no continuation loop, normal flow
- Cost accumulation across continuations — `CostTracker.accumulate()` is called per invocation by `runPhase`, so costs stack correctly
- Skip-on-resume: phase already completed — first `runPhase()` returns empty result, no continuation loop
- `continuationPrompt` is cleared after phase completes — next phase starts fresh

## Acceptance Criteria
- Runner supports `onTokenLimit` callback on phase definitions via `PhaseDefinition.onTokenLimit`
- Runner handles retry loop on token-limit results via `runPhaseWithContinuation()` (up to `MAX_CONTEXT_RESETS`)
- Runner accumulates costs across continuations — `CostTracker` in `runPhase()` handles this per invocation
- `buildPhase` provides `onTokenLimit` via exported `buildPhaseOnTokenLimit()` using existing `buildContinuationPrompt()`
- `buildPhase` internal continuation loop removed — runner owns the loop
- Phases without `onTokenLimit` fail on token limit — `runPhase()` returns the result with `tokenLimitExceeded: true`, and the orchestrator or runner receives it as-is (no implicit retry)
- `onTokenLimit` callback type is explicit: `(config: WorkflowConfig, previousResult: PhaseResult) => string`
- All 9 orchestrators using `executeBuildPhase` are updated to use `runPhaseWithContinuation` with `buildPhaseOnTokenLimit`

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Root type-check
- `bunx tsc --noEmit -p adws/tsconfig.json` — adws module type-check
- `bun run build` — Build the application to verify no build errors

## Notes
- **Unit tests**: The issue AC mentions runner unit tests, but `.adw/project.md` has `## Unit Tests: disabled`. Unit test tasks are omitted per project configuration. If unit tests are desired, enable them in `.adw/project.md` first and add a follow-up task.
- **Phase cost records**: Each continuation run produces its own `PhaseCostRecord` set via `runPhase()` → `tracker.commit()`. The `contextResetCount` in cost records will be 0 for individual continuation runs since the runner, not the phase, tracks the reset count. This is acceptable — the D1 cost records capture per-invocation granularity.
- **Recovery comments**: The `token_limit_recovery` and `compaction_recovery` comment formatters reference "build agent" in their text. When other phases adopt `onTokenLimit` in the future, consider generalizing the comment format to include the phase name.
- **Imperative orchestrator migration**: All imperative orchestrators are updated to use `runPhaseWithContinuation`. When these orchestrators are eventually migrated to the declarative pattern, they'll use `PhaseDefinition.onTokenLimit` instead, and the `runPhaseWithContinuation` calls can be removed.
- Follow `guidelines/coding_guidelines.md`: use `readonly` on new interface fields, prefer immutable patterns, avoid `any`.
