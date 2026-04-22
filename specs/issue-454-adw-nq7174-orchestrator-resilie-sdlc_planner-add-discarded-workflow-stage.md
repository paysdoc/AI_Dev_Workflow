# Feature: Add `discarded` Workflow Stage Foundation

## Metadata
issueNumber: `454`
adwId: `nq7174-orchestrator-resilie`
issueJson: `{"number":454,"title":"orchestrator-resilience: discarded stage foundation","body":"## Parent PRD\n\n`specs/prd/orchestrator-coordination-resilience.md`\n\n## What to build\n\nIntroduce the `discarded` workflow stage as the terminal, non-retriable counterpart to `abandoned`. This slice delivers the type, the cron-sweeper skip behavior, and the shared helper that future call sites will use — but does NOT yet reclassify any existing call sites (that is slice #2).\n\nEnd-to-end demo: writing `discarded` to a top-level state file causes the cron backlog sweeper to skip that issue the same way it skips `completed`. See the \"Schema changes\" and \"Modules to extend\" sections of the PRD.\n\n## Acceptance criteria\n\n- [ ] `WorkflowStage` union in `adws/types/workflowTypes.ts` includes `discarded`\n- [ ] `cronIssueFilter` and `cronStageResolver` treat `discarded` as skip-terminal (parity with `completed`)\n- [ ] New `handleWorkflowDiscarded` helper in `adws/phases/workflowCompletion.ts` writes `discarded` and posts an appropriate terminal comment\n- [ ] Existing `handleWorkflowError` still writes `abandoned` unchanged\n- [ ] Unit tests extend `cronStageResolver.test.ts` and `cronIssueFilter.test.ts` covering the `discarded` skip path\n- [ ] No existing state files are migrated — only new writes use the new stage\n\n## Blocked by\n\nNone - can start immediately.\n\n## User stories addressed\n\n- User story 8\n- User story 17\n- User story 18","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-04-20T11:03:53Z","comments":[],"actionableComment":null}`

## Feature Description

Introduce `discarded` as a first-class terminal `WorkflowStage` whose semantics are "do not retry — the exit was a deliberate terminal decision," mirroring the skip-behaviour of `completed`. Today, `abandoned` is overloaded: it is written both by transient crashes (which are correctly retriable) and by deliberate terminal exits like "operator closed the PR" or "merge genuinely failed after retries" (which should not be retriable). The cron backlog sweeper's `isRetriableStage` predicate treats all `abandoned` issues as re-eligible, causing the loop-forever behaviour described in the parent PRD.

This feature lays the foundation for the reclassification work without yet moving any call sites. It delivers:

1. The `discarded` value in the `WorkflowStage` union.
2. The skip-behaviour so that if any call site writes `discarded` to a top-level state file today (manually, or in a later slice), the cron backlog sweeper excludes it from new spawns.
3. A shared `handleWorkflowDiscarded` helper that future call sites will use to write the stage and post a terminal comment with consistent formatting.
4. Test coverage proving that `discarded` behaves as a skip-terminal in the two filter modules the cron relies on.

The parent PRD sequences this slice first so the type, the predicates, and the helper exist before slice #2 migrates the specific write sites in `adwMerge.tsx` and `webhookHandlers.ts`. This slice is intentionally non-breaking: `handleWorkflowError` still writes `abandoned`, no state files are migrated, and no existing call site changes behaviour.

## User Story

As an ADW developer
I want a terminal `discarded` workflow stage with matching skip behaviour in the cron sweeper and a shared write helper
So that slice #2 can reclassify the deliberate-terminal exit paths without introducing the semantics from scratch, and so a state file that reads `discarded` (manually or otherwise) is no longer re-spawned forever.

## Problem Statement

The cron backlog sweeper currently classifies every `abandoned` stage as retriable via `isRetriableStage()`. This is correct for crashes (the original motivation for `abandoned`) but wrong for deliberate terminal exits such as "operator closed the PR" or "merge failed after all retries." Those paths currently loop forever: the sweeper re-spawns a fresh orchestrator on each cycle even though the operator or the system has already decided the work should stop.

Before those call sites can be reclassified (slice #2), the foundation has to exist: a distinct stage value that means "terminal, don't retry," cron-sweeper predicates that honour it, and a shared helper that future call sites will use to emit the stage plus a matching GitHub comment. Without this foundation, slice #2 would have to invent the type, the skip behaviour, and the helper simultaneously — which would make that slice too large and would couple the type introduction to a specific reclassification decision.

## Solution Statement

Add `discarded` to the `WorkflowStage` union, extend the two cron filter modules to treat it as skip-terminal alongside `completed`, and add a new `handleWorkflowDiscarded` helper to `workflowCompletion.ts` that writes `discarded` to the top-level state file and posts a terminal GitHub comment. The existing `handleWorkflowError` keeps its current semantics (writes `abandoned`) so that no existing call site changes behaviour. No state files are migrated; only new writes to `discarded` use the new stage. The foundation is exercised by unit tests covering `evaluateIssue`, `isActiveStage`, and `isRetriableStage` against the new stage.

A `formatDiscardedComment` formatter is added to `workflowCommentsIssue.ts` so that `postIssueStageComment(..., 'discarded', ...)` produces a meaningful `## :no_entry: ADW Workflow Discarded` header instead of falling through to the default "Stage: discarded" branch. The `STAGE_HEADER_MAP` in `workflowCommentParsing.ts` is extended so the stage-header round-trips if `parseWorkflowStageFromComment` is called on the new comment body.

## Relevant Files

Use these files to implement the feature:

- `specs/prd/orchestrator-coordination-resilience.md` — Parent PRD; "Schema changes", "Modules to extend", and user stories 8 / 17 / 18 define the scope for this slice.
- `adws/types/workflowTypes.ts` — Contains the `WorkflowStage` union. This is where `discarded` is added as a new terminal stage value alongside `abandoned` and `awaiting_merge`.
- `adws/triggers/cronStageResolver.ts` — Defines `isActiveStage()` and `isRetriableStage()`. Neither currently recognises `discarded`; `isRetriableStage` must continue to return `false` for `discarded`, and neither predicate treats `discarded` as active.
- `adws/triggers/cronIssueFilter.ts` — `evaluateIssue()` currently returns `{ eligible: false, reason: 'completed' }` for `completed`; it must do the same for `discarded` via a parallel branch returning `reason: 'discarded'`.
- `adws/triggers/__tests__/cronStageResolver.test.ts` — Existing tests for `isActiveStage` and `isRetriableStage`. Adds assertions that `discarded` is neither active nor retriable.
- `adws/triggers/__tests__/triggerCronAwaitingMerge.test.ts` — The existing unit-test file that imports from `../cronIssueFilter` and exercises `evaluateIssue` / `filterEligibleIssues`. This is the correct target for new `discarded`-skip coverage (the issue's acceptance criterion mentioning `cronIssueFilter.test.ts` is satisfied by extending the one test file in the repo that actually covers `cronIssueFilter.ts`). No new test file is created — the descriptive file name indicates awaiting-merge origin but the module under test is `cronIssueFilter`.
- `adws/phases/workflowCompletion.ts` — Contains `completeWorkflow`, `handleRateLimitPause`, and `handleWorkflowError`. The new `handleWorkflowDiscarded` helper is added here following the `handleWorkflowError` shape (write state + post comment + log + `process.exit(0)`), with two key differences: writes `discarded` (not `abandoned`), and exits 0 (not 1) because a discard is a deliberate terminal decision, not a failure.
- `adws/phases/phaseCommentHelpers.ts` — Hosts `postIssueStageComment`, which accepts `WorkflowStage`. Since `WorkflowStage` gains `discarded`, no code change is required here, but this file is how `handleWorkflowDiscarded` posts its comment.
- `adws/github/workflowCommentsIssue.ts` — Contains `formatWorkflowComment` switch and `WorkflowContext`. Adds a new `formatDiscardedComment` case and switch arm so that `formatWorkflowComment('discarded', ctx)` produces a meaningful header rather than the default fallback.
- `adws/core/workflowCommentParsing.ts` — Contains `STAGE_HEADER_MAP` and `STAGE_ORDER`. Adds an entry mapping `:no_entry: ADW Workflow Discarded` → `discarded` so `parseWorkflowStageFromComment` can round-trip the new comment. `STAGE_ORDER` is NOT extended (the order list is for resume-point calculation and terminal stages are excluded from resume).
- `adws/types/agentTypes.ts` — `AgentState.workflowStage` is typed as `string`, so no change is required, but this file documents the fact that the top-level state file field accepts any string (the `WorkflowStage` union is the conceptual enum; runtime enforcement lives at the writer call sites).
- `adws/triggers/trigger_cron.ts` — Reads `evaluateIssue`'s result via `cronIssueFilter`. No code change is required — the new `discarded` skip path is already covered by the `evaluateIssue` branch added in `cronIssueFilter.ts`.
- `README.md` — Project overview. Read for context; not modified.
- `adws/README.md` — ADW module-level overview. Read for context; not modified.
- `.adw/project.md`, `.adw/commands.md`, `.adw/conditional_docs.md` — Project configuration consumed by planning tooling. Read for relevant-files derivation and validation commands.
- `app_docs/feature-gq51dc-migrate-cron-stage-from-state-file.md` — Conditional doc applies: "When adding new `workflowStage` values and need to understand how `isActiveStage()` / `isRetriableStage()` classify them." Essential context for ensuring the new stage is correctly classified by both predicates (neither active nor retriable).
- `app_docs/feature-dcy9qz-merge-orchestrator-cron-handoff.md` — Conditional doc applies: "When working with `adws/triggers/cronIssueFilter.ts` or `cronStageResolver.ts`" and "When adding a new handoff stage that bypasses the cron grace period." Provides the precedent for how a new terminal-like stage (`awaiting_merge`) was threaded through `evaluateIssue`.
- `app_docs/feature-z16ycm-add-top-level-workfl-top-level-workflow-state.md` — Conditional doc applies: "When reading or writing `workflowStage` transitions (`starting`, `completed`, `paused`, `abandoned`)". Documents the `workflowStage` schema, the `writeTopLevelState` deep-merge contract, and the list of existing stage values.

### New Files

No new source or test files are created. All changes are surgical edits to the files listed above. The issue's acceptance criterion naming `cronIssueFilter.test.ts` is satisfied by extending `adws/triggers/__tests__/triggerCronAwaitingMerge.test.ts` (the repo's existing test file for `cronIssueFilter.ts`); creating a second test file for the same module would fragment coverage.

## Implementation Plan

### Phase 1: Foundation — Type and Predicates

Add `discarded` to the `WorkflowStage` union; update the two cron-filter predicates in `cronStageResolver.ts` and `cronIssueFilter.ts` so a state file written with `workflowStage: 'discarded'` is treated as skip-terminal (parity with `completed`). At the end of this phase, `evaluateIssue` should return `{ eligible: false, reason: 'discarded' }` for a discarded state; `isActiveStage('discarded')` should return `false`; `isRetriableStage('discarded')` should return `false`.

### Phase 2: Core Implementation — Helper and Comment

Add `handleWorkflowDiscarded` to `adws/phases/workflowCompletion.ts`. Add a matching `formatDiscardedComment` formatter and switch arm to `adws/github/workflowCommentsIssue.ts`, and an entry in `STAGE_HEADER_MAP` in `adws/core/workflowCommentParsing.ts`. `handleWorkflowError` is not modified — it continues to write `abandoned` with its current message. No existing call site is changed.

### Phase 3: Integration — Tests

Extend `adws/triggers/__tests__/cronStageResolver.test.ts` and `adws/triggers/__tests__/triggerCronAwaitingMerge.test.ts` with cases that cover the new skip-terminal behaviour end-to-end at the module level. Verify via `bunx tsc --noEmit` that no call site accidentally depends on the previous narrow `WorkflowStage` union (the new value is additive, so existing `switch (stage)` statements without a `default` should type-check as exhaustive only if they explicitly ignore `discarded`; the `formatWorkflowComment` switch already has a `default` arm, but we add the explicit case for UX, not type safety).

## Step by Step Tasks

Execute every step in order, top to bottom.

### Step 1 — Extend the `WorkflowStage` union with `discarded`

- Open `adws/types/workflowTypes.ts`.
- In the `WorkflowStage` union, in the `// Terminal / handoff stages` section at the bottom of the union, add `| 'discarded'` on a new line between `'abandoned'` and `'awaiting_merge'`. Preserve the existing comment grouping.
- Do NOT modify `PRReviewWorkflowStage` — PR review is out of scope per the parent PRD.

### Step 2 — Teach `cronStageResolver.ts` that `discarded` is not active and not retriable

- Open `adws/triggers/cronStageResolver.ts`.
- `isActiveStage` currently returns `false` for any string that is not `'starting'` and does not end with `_running` or `_completed`, so it already returns `false` for `discarded` without code change. Leave the function untouched.
- `isRetriableStage` currently returns `true` only for `'abandoned'`. Leave untouched — `discarded` already returns `false` via the default path.
- Update the JSDoc on `isRetriableStage` to clarify the distinction: retry applies to `abandoned` (transient), not `discarded` (terminal). One-line comment addition; no behaviour change. The "why" is non-obvious because future readers may be tempted to add `discarded` to the retriable set.

### Step 3 — Teach `cronIssueFilter.ts` to skip `discarded` the same way it skips `completed`

- Open `adws/triggers/cronIssueFilter.ts`, in `evaluateIssue`.
- Locate the existing branch: `if (stage === 'completed') { return { eligible: false, reason: 'completed' }; }` (around line 117).
- Immediately after that branch, add a parallel branch: `if (stage === 'discarded') { return { eligible: false, reason: 'discarded' }; }`.
- The ordering is significant: `discarded` must be checked after the `awaiting_merge` special-case (already at the top of the function) and after the `completed` branch, but before the generic `isActiveStage` / `isRetriableStage` fallbacks. Placing it right after `completed` keeps the two skip-terminal branches visually adjacent, which matches the semantic parity.
- Do not modify the annotation-building logic in `filterEligibleIssues` — it already reads `result.reason` verbatim into the filtered annotation, so `#42(discarded)` is produced automatically.

### Step 4 — Add `STAGE_HEADER_MAP` entry for the discarded comment header

- Open `adws/core/workflowCommentParsing.ts`.
- In the `STAGE_HEADER_MAP` object (around lines 35–59), add a new entry: `':no_entry: ADW Workflow Discarded': 'discarded',`. Place it right after the `':x: ADW Workflow Error': 'error',` entry so the ordering matches the conceptual grouping of terminal-failure stages.
- `STAGE_ORDER` is NOT extended. That list drives resume-point calculation in `detectRecoveryState`, and terminal stages (`completed`, `paused`, `resumed`) exclude terminal-failure stages from resume anyway.

### Step 5 — Add `formatDiscardedComment` and switch arm in `workflowCommentsIssue.ts`

- Open `adws/github/workflowCommentsIssue.ts`.
- Add a new local function `formatDiscardedComment(ctx: WorkflowContext): string` after `formatErrorComment` (around line 163). Body:
  ```ts
  return `## :no_entry: ADW Workflow Discarded\n\nThis workflow ended with a terminal decision and will not be retried.\n\n**Reason:** ${ctx.errorMessage || 'Not specified'}\n**ADW ID:** \`${ctx.adwId}\`${formatRunningTokenFooter(ctx.runningTokenTotal)}${ADW_SIGNATURE}`;
  ```
  Rationale for the copy: a discarded workflow is an explicit terminal decision (operator closed PR, merge genuinely failed after all retries, etc.), not a crash. The message is kept neutral — the caller supplies the specific reason via `ctx.errorMessage`, which the existing `WorkflowContext` already carries. Slice #2 will populate `ctx.errorMessage` at each call site; this slice just wires up the formatter.
- In the `formatWorkflowComment` switch (around line 319), add `case 'discarded': return formatDiscardedComment(ctx);` after the `case 'error':` arm, preserving the terminal-stage grouping.

### Step 6 — Add `handleWorkflowDiscarded` to `workflowCompletion.ts`

- Open `adws/phases/workflowCompletion.ts`.
- Add a new exported function `handleWorkflowDiscarded` immediately after `handleWorkflowError`. Signature mirrors `handleWorkflowError` but with an additional `reason: string` parameter so the caller can pass a human-readable terminal reason (which the formatter renders as the "**Reason:**" line):
  ```ts
  export function handleWorkflowDiscarded(
    config: WorkflowConfig,
    reason: string,
    costUsd?: number,
    modelUsage?: ModelUsageMap,
  ): never {
    const { orchestratorStatePath, orchestratorName, issueNumber, ctx, repoContext } = config;

    if (costUsd !== undefined && modelUsage) {
      persistTokenCounts(orchestratorStatePath, costUsd, modelUsage);
    }

    ctx.errorMessage = reason;
    if (repoContext) {
      postIssueStageComment(repoContext, issueNumber, 'discarded', ctx);
      repoContext.issueTracker.moveToStatus(issueNumber, BoardStatus.Blocked).catch(() => {});
    }

    AgentStateManager.writeState(orchestratorStatePath, {
      execution: AgentStateManager.completeExecution(
        AgentStateManager.createExecutionState('running'),
        true,
      ),
    });
    AgentStateManager.writeTopLevelState(config.adwId, { workflowStage: 'discarded' });
    AgentStateManager.appendLog(orchestratorStatePath, `${orchestratorName} workflow discarded: ${reason}`);

    log(`${orchestratorName} workflow discarded: ${reason}`, 'warn');
    process.exit(0);
  }
  ```
  Key differences from `handleWorkflowError`:
  - Writes `discarded` instead of `abandoned`.
  - Exits `0` instead of `1` because a discard is a deliberate terminal decision, not a failure (this matches how `handleRateLimitPause` exits `0` for the paused path).
  - Uses `completeExecution(..., true)` (success) because the orchestrator itself did not fail — the decision upstream terminated it cleanly. Slice #2's adwMerge reclassification is the motivating example: `pr_closed` is not an orchestrator failure, it's a deliberate human/system choice.
  - Accepts `reason` as a required parameter (rather than inferring it from `error`) because the caller at each future discard site knows the semantic reason (`pr_closed`, `merge_failed_after_retries`, etc.) and should pass it explicitly.
- Leave `handleWorkflowError` untouched. The acceptance criterion is explicit on this.

### Step 7 — Extend `cronStageResolver.test.ts` with `discarded` cases

- Open `adws/triggers/__tests__/cronStageResolver.test.ts`.
- In the `describe('isActiveStage', ...)` block, immediately after the existing `it('rejects "abandoned"', ...)` test, add:
  ```ts
  it('rejects "discarded"', () => {
    expect(isActiveStage('discarded')).toBe(false);
  });
  ```
- In the `describe('isRetriableStage', ...)` block, add a new test that asserts `discarded` is NOT retriable. This is the regression guard — if a future PR accidentally wires `discarded` into `isRetriableStage`, this test fails:
  ```ts
  it('rejects "discarded" (terminal, non-retriable — parity with completed)', () => {
    expect(isRetriableStage('discarded')).toBe(false);
  });
  ```

### Step 8 — Extend `triggerCronAwaitingMerge.test.ts` with `discarded` skip-path coverage

- Open `adws/triggers/__tests__/triggerCronAwaitingMerge.test.ts`.
- At the bottom of the file, add a new `describe` block titled `'evaluateIssue — discarded skip-terminal'` covering three cases (using the existing `makeIssue`, `makeResolution`, and `noProcessed` helpers):
  1. `discarded` stage returns `{ eligible: false, reason: 'discarded' }` and `action` is undefined.
  2. `discarded` is checked BEFORE the grace-period branch (i.e., a discarded state within the grace period still returns `reason: 'discarded'`, not `'grace_period'`). This matches how `completed` behaves and guards against a future refactor that accidentally puts the grace-period check before the terminal-stage checks.
  3. `filterEligibleIssues` annotates a discarded issue as `#N(discarded)` in `filteredAnnotations` (list-level parity with the `#N(completed)` annotation).
- Example skeleton:
  ```ts
  describe('evaluateIssue — discarded skip-terminal', () => {
    it('returns ineligible with reason=discarded when stage is discarded', () => {
      const issue = makeIssue({ number: 60 });
      const resolve = (): StageResolution =>
        makeResolution({ stage: 'discarded', adwId: 'abc' });

      const result = evaluateIssue(issue, Date.now(), noProcessed(), GRACE, resolve);

      expect(result.eligible).toBe(false);
      expect(result.reason).toBe('discarded');
      expect(result.action).toBeUndefined();
    });

    it('discarded check takes precedence over grace period', () => {
      const recentMs = Date.now() - 1_000;
      const issue = makeIssue({
        number: 61,
        updatedAt: new Date(recentMs).toISOString(),
      });
      const resolve = (): StageResolution =>
        makeResolution({ stage: 'discarded', adwId: 'xyz', lastActivityMs: recentMs });

      const result = evaluateIssue(issue, Date.now(), noProcessed(), GRACE, resolve);

      expect(result.eligible).toBe(false);
      expect(result.reason).toBe('discarded');
    });

    it('filterEligibleIssues annotates discarded issues with reason=discarded', () => {
      const issue = makeIssue({ number: 62 });
      const resolve = (): StageResolution => makeResolution({ stage: 'discarded', adwId: 'abc' });

      const { eligible, filteredAnnotations } =
        filterEligibleIssues([issue], Date.now(), noProcessed(), GRACE, resolve);

      expect(eligible).toHaveLength(0);
      expect(filteredAnnotations).toContain('#62(discarded)');
    });
  });
  ```

### Step 9 — Run validation commands

- Run `bun run lint`, `bunx tsc --noEmit -p adws/tsconfig.json`, `bun run test:unit`, and the BDD regression pack (`NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"`) per the Validation Commands section. Address any failures before declaring the slice complete. Follow the `Validation Commands` below exactly.

## Testing Strategy

### Unit Tests

- **`isActiveStage('discarded') === false`** — new test in `cronStageResolver.test.ts`, covers the `isActiveStage` predicate's behaviour against the new stage. Guards against a future PR that might accidentally wire `discarded` into `ACTIVE_STAGES`-like logic.
- **`isRetriableStage('discarded') === false`** — new test in `cronStageResolver.test.ts`. This is the cron's explicit skip-terminal contract for discarded; the test is the single source of truth for that invariant.
- **`evaluateIssue` returns `{ eligible: false, reason: 'discarded' }` for a discarded state** — new test in `triggerCronAwaitingMerge.test.ts`. Exercises the new branch added in Step 3.
- **`evaluateIssue` honours the discarded branch even within the grace period** — new test in `triggerCronAwaitingMerge.test.ts`. Guards against a refactor that reorders the function such that the grace-period check shadows the terminal-stage branches.
- **`filterEligibleIssues` emits `#N(discarded)` annotation** — new test in `triggerCronAwaitingMerge.test.ts`. Exercises the list-level contract where filtered issues are annotated by their reason string.

No new tests are added for `handleWorkflowDiscarded` in this slice because the helper is not yet wired to any orchestrator — its first real call site lands in slice #2, at which point the adwMerge reclassification tests will exercise it. Adding a standalone unit test in this slice would require a harness that mocks `process.exit`, which is not present elsewhere in `workflowCompletion` tests (the function has no existing unit-test file), so the cost of adding one just for this slice outweighs the benefit. The type system already proves that `handleWorkflowDiscarded` writes `discarded` (the string literal argument to `writeTopLevelState`), posts via `postIssueStageComment(..., 'discarded', ...)`, and invokes the same state-write shape as `handleWorkflowError`. Slice #2 will end-to-end exercise the helper.

### Edge Cases

- A state file with `workflowStage: 'discarded'` but no `adw-id` in the comments — `resolveIssueWorkflowStage` returns `{ stage: null, adwId: null, ... }` (the adw-id source is comments, not the state file), so `evaluateIssue` falls to the fresh-spawn branch. This is existing behaviour; the `discarded` extension does not change it. No additional test needed — covered by the existing `returns null stage and null adwId when no comment has an ADW ID` case.
- A state file with `workflowStage: 'discarded'` whose adw-id comment exists but the state file is missing — `resolveIssueWorkflowStage` returns `{ stage: null, adwId: 'x', ... }` via the `readState === null` branch. `evaluateIssue` then takes the `stage === null` / fresh-spawn branch. This is existing behaviour for any missing state file; the `discarded` extension does not change it.
- A state file with `workflowStage: 'discarded'` AND the issue is in `processed.spawns` — `evaluateIssue` returns `{ eligible: false, reason: 'processed' }` because the processed-spawn check runs before the stage branches. This is correct and matches the `completed` behaviour; no additional test needed.
- `awaiting_merge` vs `discarded` — `awaiting_merge` short-circuits at the top of `evaluateIssue` before the `discarded` check. There is no interaction: an issue cannot simultaneously be `awaiting_merge` and `discarded` (state-file writes overwrite, not merge, the `workflowStage` field).
- `formatWorkflowComment('discarded', ctx)` called with `ctx.errorMessage` undefined — the formatter falls back to `'Not specified'`. Covered by the formatter's own string-literal default.
- Migration: existing state files written before this change cannot contain `discarded` (the value did not exist). No migration is needed and none is performed, matching the issue's explicit acceptance criterion.

## Acceptance Criteria

- [ ] `WorkflowStage` union in `adws/types/workflowTypes.ts` includes `discarded`.
- [ ] `adws/triggers/cronStageResolver.ts` — `isActiveStage('discarded') === false` and `isRetriableStage('discarded') === false` (behaviour, not necessarily new code, since both already return `false` for unknown stages).
- [ ] `adws/triggers/cronIssueFilter.ts` — `evaluateIssue` returns `{ eligible: false, reason: 'discarded' }` when the resolved stage is `discarded`, regardless of grace-period state.
- [ ] `adws/phases/workflowCompletion.ts` — new `handleWorkflowDiscarded(config, reason, costUsd?, modelUsage?)` helper writes `discarded` via `AgentStateManager.writeTopLevelState`, posts the discarded comment via `postIssueStageComment`, moves the board to Blocked, and exits 0.
- [ ] `handleWorkflowError` continues to write `abandoned` and exit 1 — unchanged by this slice.
- [ ] `adws/github/workflowCommentsIssue.ts` — `formatWorkflowComment('discarded', ctx)` produces a `## :no_entry: ADW Workflow Discarded` header (not the default fallback).
- [ ] `adws/core/workflowCommentParsing.ts` — `STAGE_HEADER_MAP` maps the new header back to the `discarded` stage so `parseWorkflowStageFromComment` round-trips.
- [ ] Unit tests in `cronStageResolver.test.ts` assert `discarded` is not active and not retriable.
- [ ] Unit tests in `triggerCronAwaitingMerge.test.ts` (the existing test file for `cronIssueFilter.ts`) assert the `discarded` skip path at both `evaluateIssue` and `filterEligibleIssues` levels, including the grace-period ordering invariant.
- [ ] No existing state files are migrated. No existing call site is reclassified. `adwMerge.tsx` and `webhookHandlers.ts` still write `abandoned` — reclassification is slice #2.
- [ ] `bunx tsc --noEmit -p adws/tsconfig.json` succeeds. `bun run lint` succeeds. `bun run test:unit` succeeds with all new tests green. The `@regression` BDD suite succeeds with zero regressions.

## Validation Commands

Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — Run linter to check for code quality issues.
- `bunx tsc --noEmit` — Top-level TypeScript type check.
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW-specific type check (catches `WorkflowStage` union additions that break a non-exhaustive switch elsewhere).
- `bun run test:unit` — Full vitest unit suite. Confirms the new `cronStageResolver.test.ts` and `triggerCronAwaitingMerge.test.ts` cases pass and no existing test regresses.
- `bun vitest run adws/triggers/__tests__/cronStageResolver.test.ts` — Targeted run of the extended stage-resolver tests.
- `bun vitest run adws/triggers/__tests__/triggerCronAwaitingMerge.test.ts` — Targeted run of the extended cron-issue-filter tests.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — Full BDD regression pack. Confirms no end-to-end behaviour regresses (orchestrator spawn, awaiting-merge handoff, cancel flow, pause/resume).
- `bun run build` — Compile check covering any build-time validation beyond the type-only pass.

## Notes

- **Scope discipline**: This slice deliberately stops short of reclassifying any existing call site. `adwMerge.tsx`'s seven current `abandoned` writes, `webhookHandlers.ts`'s PR-closed `abandoned` write, and the ten `writeTopLevelState` call sites called out in the PRD remain on `abandoned` until slice #2. The issue explicitly makes that boundary one of its acceptance criteria ("No existing state files are migrated — only new writes use the new stage").
- **Test file naming**: The issue's acceptance criterion names `cronIssueFilter.test.ts`, but the repo's existing test file for that module is `triggerCronAwaitingMerge.test.ts` (the import confirms `from '../cronIssueFilter'`). Extending the existing file is the right call — creating a new file would fragment coverage. If a reviewer prefers a rename in a follow-up PR, that's a separate (trivial) cleanup.
- **`STAGE_ORDER` exclusion**: The order list in `workflowCommentParsing.ts` drives `detectRecoveryState`'s resume-point calculation. Terminal-failure stages (`error`, `paused` in recovery contexts) are excluded from resume, so `discarded` should follow the same pattern — not listed in `STAGE_ORDER`. `detectRecoveryState` already filters on `stage === 'error' || stage === 'paused' || stage === 'resumed'`; an analogous filter for `discarded` is optional in this slice since no call site currently writes `discarded` comments, but adding one future-proofs the resume path. Leaving it out for now keeps the blast radius small; slice #2 can add the resume-filter when it starts writing `discarded` comments.
- **Board state for discarded workflows**: `handleWorkflowDiscarded` moves the issue to `BoardStatus.Blocked` (same as `handleWorkflowError`). A future iteration may want a dedicated "Discarded" board column — that is out of scope for this slice and for the parent PRD.
- **Exit code**: `handleWorkflowDiscarded` exits 0. This matches the `handleRateLimitPause` precedent for "orchestrator ended cleanly, not a failure." Slice #2's adwMerge reclassification will be the first caller; `adwMerge`'s current `abandoned` paths exit 0 anyway (they `return { outcome: 'abandoned', reason: '...' }` and then the top-level handler decides the exit code), so this is compatible.
- **No library installs required**. Per `.adw/commands.md`, the project uses `bun add <package>` if needed, but this slice is type-level + wiring-only and adds no dependencies.
- **`guidelines/` directory**: No `guidelines/` directory exists at the target repo root or in the current working directory, so no additional coding-guideline adherence is required beyond the existing CLAUDE.md instructions.
