# Feature: Migrate adwPrReview to phaseRunner

## Metadata
issueNumber: `398`
adwId: `s59wpc-adwprreview-migrated`
issueJson: `{"number":398,"title":"adwPrReview migrated to phaseRunner (resolves 4 disparities)","body":"## Parent PRD\n\n`specs/prd/test-review-refactor.md`\n\n## What to build\n\nRefactor `adws/adwPrReview.tsx` to use `runPhase`/`CostTracker` from `core/phaseRunner.ts` (currently it hand-rolls cost bookkeeping). PR-specific phases that need access to `PRReviewWorkflowConfig` are called via the closure-wrapper pattern:\n\n```ts\nawait runPhase(config.base, tracker, _ => executePRReviewPlanPhase(config));\n```\n\nShared phases (e.g., the install agent invocation that's currently inline) can be called directly:\n\n```ts\nawait runPhase(config.base, tracker, executeInstallPhase);\n```\n\nRemove the bespoke inline `postCostRecordsToD1` call from `prReviewCompletion.ts:138`. Remove the hand-rolled `totalCostUsd`/`totalModelUsage` accumulation in `adwPrReview.tsx`. Remove the manual `RateLimitError` catch block (`phaseRunner` handles it).\n\nSide effects of using `phaseRunner`:\n- PR review now writes top-level workflow state on each phase transition (US 27)\n- PR review now supports rate-limit pause/resume (US 26)\n- PR review now posts D1 cost records via the shared path (US 24)\n- PR review board moves can move to a distributed pattern in the next slices (US 28)\n\nAll four prior-session disparities are resolved as a side effect of this single refactor.\n\n## Acceptance criteria\n\n- [ ] `adwPrReview.tsx` uses `runPhase` and `CostTracker` instead of hand-rolled bookkeeping\n- [ ] Closure-wrapper pattern used for PR-specific phases\n- [ ] `postCostRecordsToD1` inline call removed from `prReviewCompletion.ts`\n- [ ] Hand-rolled cost accumulation removed from `adwPrReview.tsx`\n- [ ] Manual `RateLimitError` catch block removed (handled by `phaseRunner`)\n- [ ] Top-level state file written for each PR review phase transition\n- [ ] Rate-limit pause/resume works in PR review (verified via mocked rate limit test)\n- [ ] D1 cost records appear in the workflow's cost ledger via `phaseRunner.commit`\n- [ ] Existing PR review tests still pass\n- [ ] Manual smoke test: run a PR review workflow end-to-end, confirm new state file entries and cost records\n\n## Blocked by\n\n- Blocked by #396\n\n## User stories addressed\n\n- User story 24\n- User story 25\n- User story 26\n- User story 27\n- User story 28","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-04-08T12:04:05Z","comments":[],"actionableComment":null}`

## Feature Description
Refactor `adwPrReview.tsx` to use the shared `runPhase`/`CostTracker` pattern from `core/phaseRunner.ts` instead of hand-rolling cost bookkeeping, rate-limit handling, and token persistence. This is the final orchestrator still using the old manual pattern. The migration resolves four disparities between PR review and other orchestrators: (1) no top-level state file transitions, (2) no rate-limit pause/resume, (3) bespoke D1 cost posting, and (4) manual cost accumulation.

## User Story
As a workflow operator
I want the PR review orchestrator to use the same `runPhase`/`CostTracker` infrastructure as every other orchestrator
So that PR review automatically gains top-level state tracking, rate-limit pause/resume, and shared D1 cost posting without duplicating boilerplate.

## Problem Statement
`adwPrReview.tsx` manually accumulates `totalCostUsd` and `totalModelUsage`, manually calls `persistTokenCounts`, manually catches `RateLimitError`, and has a bespoke `postCostRecordsToD1` call in `prReviewCompletion.ts`. Every other orchestrator has been migrated to `CostTracker` + `runPhase()`, which handles all of this automatically. This creates four behavioural disparities: PR review doesn't write top-level state on phase transitions, doesn't pause/resume on rate limits, posts D1 records via a different code path, and has redundant cost boilerplate.

## Solution Statement
Replace the hand-rolled bookkeeping in `adwPrReview.tsx` with `CostTracker` + `runPhase()`. PR-specific phases use the closure-wrapper pattern (`_ => executePRReviewPlanPhase(config)`) to pass the full `PRReviewWorkflowConfig` while `runPhase` receives `config.base` (the `WorkflowConfig`). Shared phases like `executeInstallPhase` are passed directly. The inline `postCostRecordsToD1` in `prReviewCompletion.ts` is removed because `runPhase` commits cost records via `tracker.commit()` after each phase. The manual `RateLimitError` catch is removed because `runPhase` intercepts it and delegates to `handleRateLimitPause`.

## Relevant Files
Use these files to implement the feature:

- `adws/adwPrReview.tsx` — The orchestrator being refactored. Remove hand-rolled cost accumulation, `RateLimitError` catch, and inline install agent call. Replace with `CostTracker` + `runPhase()`.
- `adws/core/phaseRunner.ts` — Reference for `runPhase`, `CostTracker`, `PhaseResult` interfaces. No changes needed.
- `adws/phases/prReviewPhase.ts` — Contains `PRReviewWorkflowConfig`, `executePRReviewPlanPhase`, `executePRReviewBuildPhase`. Update return types to include `phaseCostRecords`.
- `adws/phases/prReviewCompletion.ts` — Contains `executePRReviewTestPhase`, `completePRReviewWorkflow`, `handlePRReviewWorkflowError`, `buildPRReviewCostSection`. Update test phase return type to include `phaseCostRecords`. Remove `postCostRecordsToD1` inline call from `buildPRReviewCostSection`.
- `adws/phases/installPhase.ts` — Reference for the shared `executeInstallPhase` function that already returns `PhaseResult`.
- `adws/phases/workflowInit.ts` — Reference for `WorkflowConfig` interface.
- `adws/phases/workflowCompletion.ts` — Contains `handleRateLimitPause`. No changes needed (`pr-review-orchestrator` mapping already exists).
- `adws/workflowPhases.ts` — Re-exports all phase functions. No changes needed.
- `adws/core/orchestratorLib.ts` — Contains `deriveOrchestratorScript`. Already has `pr-review-orchestrator` → `adwPrReview` mapping. No changes needed.
- `adws/adwSdlc.tsx` — Reference for the target pattern (closure wrappers, `CostTracker`, `runPhase`). No changes needed.
- `adws/core/__tests__/phaseRunner.test.ts` — Existing phaseRunner tests. No changes needed.
- `guidelines/coding_guidelines.md` — Coding guidelines to follow.
- `app_docs/feature-8zhro4-prreviewworkflowconfig-composition.md` — Conditional doc: `PRReviewWorkflowConfig` composition pattern (prerequisite context).
- `app_docs/feature-2sqt1r-fix-rate-limit-plan-phase.md` — Conditional doc: `CostTracker` + `runPhase()` migration pattern.

## Implementation Plan
### Phase 1: Foundation — Update PR review phase return types
Add `phaseCostRecords` to the return types of `executePRReviewPlanPhase`, `executePRReviewBuildPhase`, and `executePRReviewTestPhase` so they satisfy the `PhaseResult` contract required by `runPhase`. Each phase creates records using `createPhaseCostRecords` (same pattern as `executeBuildPhase`, `executePlanPhase`).

### Phase 2: Core Implementation — Rewrite adwPrReview.tsx orchestrator
Replace the hand-rolled cost accumulation, inline install agent call, and manual `RateLimitError` catch with `CostTracker` + `runPhase()`. Use the closure-wrapper pattern for PR-specific phases and direct function references for shared phases.

### Phase 3: Integration — Remove bespoke D1 posting from prReviewCompletion.ts
Remove the `void postCostRecordsToD1(...)` call from `buildPRReviewCostSection`. D1 cost records are now posted per-phase via `tracker.commit()` inside `runPhase`. The cost section formatting for GitHub comments is retained.

## Step by Step Tasks
Execute every step in order, top to bottom.

### Step 1: Add `phaseCostRecords` to `executePRReviewPlanPhase` return type
- In `adws/phases/prReviewPhase.ts`, import `createPhaseCostRecords`, `PhaseCostStatus`, and `PhaseCostRecord` from `../cost`
- Add a `phaseStartTime = Date.now()` at the top of `executePRReviewPlanPhase`
- At the end of the function, create `phaseCostRecords` using `createPhaseCostRecords({ workflowId: adwId, issueNumber, phase: 'pr_review_plan', status: PhaseCostStatus.Success, retryCount: 0, contextResetCount: 0, durationMs: Date.now() - phaseStartTime, modelUsage })`
- Update the return type to `Promise<{ planOutput: string; costUsd: number; modelUsage: ModelUsageMap; phaseCostRecords: PhaseCostRecord[] }>`
- Return `phaseCostRecords` alongside existing fields

### Step 2: Add `phaseCostRecords` to `executePRReviewBuildPhase` return type
- In `adws/phases/prReviewPhase.ts`, add `phaseStartTime = Date.now()` at the top of `executePRReviewBuildPhase`
- Create `phaseCostRecords` at the end using `createPhaseCostRecords({ workflowId: adwId, issueNumber, phase: 'pr_review_build', status: PhaseCostStatus.Success, retryCount: 0, contextResetCount: 0, durationMs: Date.now() - phaseStartTime, modelUsage })`
- Update the return type to `Promise<{ costUsd: number; modelUsage: ModelUsageMap; phaseCostRecords: PhaseCostRecord[] }>`
- Return `phaseCostRecords`

### Step 3: Add `phaseCostRecords` to `executePRReviewTestPhase` return type
- In `adws/phases/prReviewCompletion.ts`, import `createPhaseCostRecords`, `PhaseCostStatus`, `PhaseCostRecord` from `../cost`
- Add `phaseStartTime = Date.now()` at the top of `executePRReviewTestPhase`
- Create `phaseCostRecords` at the end using `createPhaseCostRecords({ workflowId: adwId, issueNumber, phase: 'pr_review_test', status: PhaseCostStatus.Success, retryCount: 0, contextResetCount: 0, durationMs: Date.now() - phaseStartTime, modelUsage: combinedModelUsage })`
- Update the return type to `Promise<{ costUsd: number; modelUsage: ModelUsageMap; phaseCostRecords: PhaseCostRecord[] }>`
- Return `phaseCostRecords`

### Step 4: Remove bespoke `postCostRecordsToD1` from `buildPRReviewCostSection`
- In `adws/phases/prReviewCompletion.ts`, remove the `void postCostRecordsToD1({ project: repoName, repoUrl: process.env.GITHUB_REPO_URL, records: phaseCostRecords })` call from `buildPRReviewCostSection` (approx. line 139–143)
- Remove the `postCostRecordsToD1` import from the file's import block (verify it's no longer used elsewhere in the file)
- Keep the rest of `buildPRReviewCostSection` intact — it still creates `phaseCostRecords` for formatting `ctx.costSection` and `ctx.phaseCostRecords`

### Step 5: Rewrite `adwPrReview.tsx` to use `CostTracker` + `runPhase()`
- Import `CostTracker` and `runPhase` from `./core/phaseRunner`
- Import `executeInstallPhase` from `./workflowPhases` (replacing `runInstallAgent` and `extractInstallContext`)
- Remove imports: `RateLimitError`, `mergeModelUsageMaps`, `persistTokenCounts`, `computeDisplayTokens`, `ModelUsageMap`, `runInstallAgent`, `extractInstallContext`
- Remove `RUNNING_TOKENS` import (no longer needed — `CostTracker.persist()` handles it)
- Create `const tracker = new CostTracker()` after `initializePRReviewWorkflow`
- Replace the inline install block (lines 58–78) with: `await runPhase(config.base, tracker, executeInstallPhase, 'install')`
- Replace the plan phase call with: `const planResult = await runPhase(config.base, tracker, _ => executePRReviewPlanPhase(config), 'pr_review_plan')`
- Replace the build phase call with: `await runPhase(config.base, tracker, _ => executePRReviewBuildPhase(config, planResult.planOutput), 'pr_review_build')`
- Replace the test phase call with: `await runPhase(config.base, tracker, _ => executePRReviewTestPhase(config), 'pr_review_test')`
- Call `completePRReviewWorkflow(config, tracker.totalModelUsage)` after all phases
- Remove the entire `RateLimitError` catch block (lines 101–105) — `runPhase` handles rate limits
- Remove all hand-rolled `totalCostUsd` / `totalModelUsage` / `persistTokenCounts` lines
- In the generic `catch`, call `handlePRReviewWorkflowError(config, error, tracker.totalCostUsd, tracker.totalModelUsage)`

### Step 6: Run validation commands
- Run `bunx tsc --noEmit` — root type check
- Run `bunx tsc --noEmit -p adws/tsconfig.json` — ADW-specific type check
- Run `bun run lint` — lint check
- Run `bun run build` — build check
- Run `bun run test` — run all tests (existing phaseRunner tests must pass)

## Testing Strategy
### Unit Tests
The existing `adws/core/__tests__/phaseRunner.test.ts` already covers `CostTracker` accumulation, `runPhase()` rate-limit handling, phase skip-on-resume, and top-level state writes. These tests validate the infrastructure used by the migrated orchestrator. No new unit tests are required because:
- The closure-wrapper pattern is just a lambda — there's no new logic to test in isolation
- The phase return type changes (`phaseCostRecords`) are structural and verified by type checks
- The removal of `postCostRecordsToD1` from `buildPRReviewCostSection` is a deletion, not new logic

### Edge Cases
- PR review workflow with no associated issue number (`issueNumber` is 0 sentinel) — `createPhaseCostRecords` still works with `issueNumber: 0`
- Rate limit hit during any PR review phase — `runPhase` catches `RateLimitError`, calls `handleRateLimitPause`, exits 0
- Phase already completed on resume — `runPhase` checks top-level state and skips the phase
- Install phase failure (non-fatal) — `executeInstallPhase` catches errors internally and returns `{ costUsd: 0, modelUsage: {}, phaseCostRecords: [] }`
- `buildPRReviewCostSection` called with empty modelUsage — still formats correctly (no D1 posting to fail)

## Acceptance Criteria
- `adwPrReview.tsx` imports and uses `CostTracker` and `runPhase` from `core/phaseRunner`
- No `totalCostUsd` or `totalModelUsage` manual accumulation variables in `adwPrReview.tsx`
- No `RateLimitError` catch block in `adwPrReview.tsx`
- No `postCostRecordsToD1` import or call in `prReviewCompletion.ts`
- `executePRReviewPlanPhase`, `executePRReviewBuildPhase`, and `executePRReviewTestPhase` return `phaseCostRecords`
- Closure-wrapper pattern (`_ => executePRReviewPlanPhase(config)`) used for PR-specific phases
- `executeInstallPhase` called directly (not via inline `runInstallAgent`)
- Phase names passed to `runPhase` for top-level state tracking (`install`, `pr_review_plan`, `pr_review_build`, `pr_review_test`)
- `bunx tsc --noEmit` passes
- `bunx tsc --noEmit -p adws/tsconfig.json` passes
- `bun run lint` passes
- `bun run build` passes
- `bun run test` passes (all existing tests, including phaseRunner tests)

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bunx tsc --noEmit` — Root TypeScript type check
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW-specific TypeScript type check
- `bun run lint` — Lint check
- `bun run build` — Build check
- `bun run test` — Run all unit tests (phaseRunner tests must pass)

## Notes
- The `pr-review-orchestrator` → `adwPrReview` mapping already exists in `deriveOrchestratorScript` (`adws/core/orchestratorLib.ts:74`), so rate-limit pause/resume will correctly resume using `adwPrReview.tsx`.
- `buildPRReviewCostSection` still creates `phaseCostRecords` locally for formatting the GitHub comment cost section (`ctx.costSection`). This is separate from the per-phase D1 posting now handled by `runPhase`.
- The `completePRReviewWorkflow` function is not wrapped in `runPhase` — it's a completion step (commit, push, post comment), not a cost-producing phase.
- `config.ctx` and `config.base.ctx` point to the same `PRReviewWorkflowContext` object. The closure-wrapper pattern ensures phase functions receive the full `PRReviewWorkflowConfig` with the correct `ctx` type.
- Follow `guidelines/coding_guidelines.md` strictly.
