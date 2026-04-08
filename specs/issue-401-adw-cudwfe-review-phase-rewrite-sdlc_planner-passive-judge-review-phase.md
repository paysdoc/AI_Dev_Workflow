# Feature: Review Phase Rewrite (Passive Judge)

## Metadata
issueNumber: `401`
adwId: `cudwfe-review-phase-rewrite`
issueJson: `{"number":401,"title":"review phase rewrite (passive judge)","body":"## Parent PRD\n\n`specs/prd/test-review-refactor.md`\n\n## What to build\n\nRelocate `executeReviewPhase` from `phases/workflowCompletion.ts` to a new file `phases/reviewPhase.ts`, and rewrite it as a passive judge.\n\n**New `phases/reviewPhase.ts`:**\n- Reads scenario_proof.md from the agent state directory (path supplied as argument)\n- Calls a single review agent (no parallelism) to judge the proof against issue requirements\n- Returns reviewIssues + success\n- Does not run tests, does not navigate the application, does not start a dev server, does not invoke `prepare_app`\n\n**Rewrite `agents/reviewAgent.ts`:**\n- Drop parallelism (`agentIndex` parameter, `REVIEW_AGENT_COUNT` constant)\n- Drop `scenarioProofPath` strategy plumbing duplication (now passed as a single arg)\n- Drop screenshot capture entirely\n- Single agent invocation per review\n\n**Delete `agents/reviewRetry.ts`:**\n- The retry loop is now orchestrator-level for both the scenario fix loop (#399, #400) and the review patch+retest loop (this slice)\n\n**Rewrite `.claude/commands/review.md`:**\n- Strategy A (read scenario_proof.md, judge per-tag results) and Strategy B (custom proof from `.adw/review_proof.md`) only\n- Strip Strategy C (UI navigation fallback) entirely\n- No `prepare_app` invocation\n- No `applicationUrl` variable\n- Output: `success`, `reviewSummary`, `reviewIssues`, `screenshots` (just the proof file path)\n- See PRD Q44 sketch for the full new shape\n\n**Add orchestrator-level review patch+retest loop:**\n- In each orchestrator that has review (adwSdlc, adwPlanBuildReview, adwPlanBuildTestReview, adwPrReview, adwChore's regression_possible path)\n- When review returns blockers: run `runPatchAgent` per blocker → `runBuildAgent` → commit → push → re-run scenarioTestPhase (in case patch broke tests) → re-run reviewPhase\n- Bounded by `MAX_REVIEW_RETRY_ATTEMPTS`\n\n**Update workflowCompletion.ts:**\n- Remove `executeReviewPhase` (relocated to `reviewPhase.ts`)\n- File should now contain only terminal-state handlers\n\n## Acceptance criteria\n\n- [ ] `phases/reviewPhase.ts` exists with the new passive judge implementation\n- [ ] `executeReviewPhase` removed from `workflowCompletion.ts`\n- [ ] `agents/reviewAgent.ts` simplified (no parallelism, no screenshots, single agent)\n- [ ] `agents/reviewRetry.ts` deleted\n- [ ] `REVIEW_AGENT_COUNT` constant deleted from `core/`\n- [ ] `.claude/commands/review.md` rewritten per Q44 sketch (Strategy A+B only)\n- [ ] Orchestrator-level review retry loop implemented in adwSdlc, adwPlanBuildReview, adwPlanBuildTestReview, adwPrReview, and adwChore (regression_possible path)\n- [ ] Existing tests still pass\n- [ ] Manual smoke test: run an SDLC workflow against a feature issue, confirm review reads scenario_proof.md, makes no HTTP calls to the app, finishes faster than the old parallel review\n\n## Blocked by\n\n- Blocked by #399\n- Blocked by #400\n\n## User stories addressed\n\n- User story 14\n- User story 15\n- User story 16\n- User story 19\n- User story 20","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-04-08T12:05:17Z","comments":[],"actionableComment":null}`

## Feature Description
Rewrite the ADW review phase as a passive judge. Currently, `executeReviewPhase` lives in `workflowCompletion.ts` and delegates to `runReviewWithRetry` in `reviewRetry.ts`, which launches multiple parallel review agents (default 3), each invoking `prepare_app` to start a dev server, running BDD scenario proofs, navigating the UI, taking screenshots, and merging results. This architecture leaks dev server processes, is slow, and conflates test-execution responsibilities with review judging.

The rewrite transforms review into a single-agent passive judge: it reads the `scenario_proof.md` artifact already produced by `scenarioTestPhase`, calls one review agent to judge the proof against issue requirements, and returns. It does not run tests, navigate the application, start a dev server, or invoke `prepare_app`. The patch+retest retry loop moves from `reviewRetry.ts` into each orchestrator, following the same pattern used by the scenario test/fix loop.

## User Story
As an ADW developer
I want a single passive review agent that reads the scenario proof artifact and judges the implementation
So that review is fast, deterministic, and does not leak dev server processes

## Problem Statement
The current review phase has accreted test-execution responsibilities: three parallel review agents each start their own dev server via `prepare_app`, run BDD scenarios, navigate the UI, and take screenshots. This causes leaked processes (the root cause from the parent PRD), slow review cycles, and a muddled separation of concerns between the test and review phases. The retry loop embedded in `reviewRetry.ts` is monolithic and cannot be composed with the orchestrator-level scenario fix loop.

## Solution Statement
1. Create a new `phases/reviewPhase.ts` that reads the scenario proof file, calls a single review agent, and returns `reviewIssues + success`.
2. Simplify `agents/reviewAgent.ts` by removing parallelism (`agentIndex`), screenshot capture, and `REVIEW_AGENT_COUNT`.
3. Delete `agents/reviewRetry.ts` — the retry loop moves to orchestrator-level.
4. Rewrite `.claude/commands/review.md` to Strategy A+B only (no UI navigation, no `prepare_app`).
5. Add an orchestrator-level review patch+retest loop in all five orchestrators that use review.
6. Clean up `workflowCompletion.ts` to contain only terminal-state handlers.

## Relevant Files
Use these files to implement the feature:

- `adws/phases/workflowCompletion.ts` — current home of `executeReviewPhase`; remove it, leaving only `completeWorkflow`, `handleRateLimitPause`, `handleWorkflowError`
- `adws/agents/reviewAgent.ts` — simplify: drop `agentIndex`, `applicationUrl`, `REVIEW_AGENT_COUNT` usage, screenshot plumbing
- `adws/agents/reviewRetry.ts` — delete entirely
- `adws/agents/index.ts` — remove `reviewRetry` exports, update `reviewAgent` exports
- `adws/core/config.ts` — delete `REVIEW_AGENT_COUNT` constant
- `adws/core/index.ts` — remove `REVIEW_AGENT_COUNT` from re-export
- `.claude/commands/review.md` — rewrite to Strategy A+B only (no prepare_app, no applicationUrl, no Strategy C)
- `adws/phases/index.ts` — update exports for new `reviewPhase.ts`
- `adws/workflowPhases.ts` — update re-exports
- `adws/adwSdlc.tsx` — add orchestrator-level review retry loop
- `adws/adwPlanBuildReview.tsx` — add orchestrator-level review retry loop
- `adws/adwPlanBuildTestReview.tsx` — add orchestrator-level review retry loop
- `adws/adwPrReview.tsx` — add review phase + retry loop
- `adws/adwChore.tsx` — add orchestrator-level review retry loop for `regression_possible` path
- `README.md` — remove `REVIEW_AGENT_COUNT` env var documentation
- `.env.sample` — remove `REVIEW_AGENT_COUNT` line
- `adws/agents/patchAgent.ts` — reference only (used by the orchestrator-level retry loop)
- `adws/agents/buildAgent.ts` — reference only (used by the orchestrator-level retry loop)
- `adws/agents/gitAgent.ts` — reference only (`runCommitAgent` used in retry loop)
- `adws/vcs/index.ts` — reference only (`pushBranch` used in retry loop)
- `adws/phases/scenarioTestPhase.ts` — reference only (re-run during review retry loop)
- `adws/agents/regressionScenarioProof.ts` — reference only (proof path derivation)
- `adws/core/phaseRunner.ts` — reference only (`runPhase`, `PhaseResult`, `PhaseFn` types)
- `adws/phases/scenarioFixPhase.ts` — reference only (pattern for fix phase structure)
- `guidelines/coding_guidelines.md` — coding guidelines to follow
- `specs/prd/test-review-refactor.md` — parent PRD with full design context
- `app_docs/feature-1bg58c-scenario-test-fix-phases.md` — conditional doc for scenario test/fix patterns
- `app_docs/feature-o1w8wg-wire-scenarios-remaining-orchestrators.md` — conditional doc for orchestrator scenario wiring patterns

### New Files
- `adws/phases/reviewPhase.ts` — new passive judge review phase implementation

## Implementation Plan
### Phase 1: Foundation — Simplify review agent and delete parallelism machinery
Remove the parallel review infrastructure: delete `REVIEW_AGENT_COUNT` from `core/config.ts` and its re-export in `core/index.ts`, simplify `agents/reviewAgent.ts` to a single-agent invocation without `agentIndex` or `applicationUrl`, and delete `agents/reviewRetry.ts` entirely. Update `agents/index.ts` to remove `reviewRetry` exports and update `reviewAgent` exports.

### Phase 2: Core Implementation — New review phase and slash command rewrite
Create `phases/reviewPhase.ts` as the passive judge: receives the scenario proof path as a parameter (supplied by the orchestrator from the `scenarioTestPhase` result), calls the simplified `runReviewAgent`, and returns `{ costUsd, modelUsage, reviewPassed, reviewIssues, phaseCostRecords }`. Rewrite `.claude/commands/review.md` to Strategy A+B only (no `prepare_app`, no `applicationUrl`, no Strategy C UI navigation). Remove `executeReviewPhase` from `workflowCompletion.ts`. Update `phases/index.ts` and `workflowPhases.ts` exports.

### Phase 3: Integration — Orchestrator-level review retry loop
Add the review patch+retest loop to all five orchestrators. The pattern follows the existing scenario test/fix loop: when review returns blockers, run `runPatchAgent` per blocker → `runBuildAgent` → `runCommitAgent` + `pushBranch` → re-run `scenarioTestPhase` → loop back to re-run `reviewPhase`. Bounded by `MAX_REVIEW_RETRY_ATTEMPTS`. Extract the patch+build+commit+push cycle into a helper function in `reviewPhase.ts` to avoid duplicating the logic across five orchestrators. Clean up `README.md` and `.env.sample` to remove `REVIEW_AGENT_COUNT` references.

## Step by Step Tasks

### Step 1: Read conditional docs and reference files
- Read `app_docs/feature-1bg58c-scenario-test-fix-phases.md` for scenario test/fix phase patterns
- Read `app_docs/feature-o1w8wg-wire-scenarios-remaining-orchestrators.md` for orchestrator wiring patterns
- Read `guidelines/coding_guidelines.md` for coding guidelines adherence

### Step 2: Delete `REVIEW_AGENT_COUNT` from core
- In `adws/core/config.ts`: delete the `REVIEW_AGENT_COUNT` constant (line 74)
- In `adws/core/index.ts`: remove `REVIEW_AGENT_COUNT` from the re-export line
- Verify no other core files reference `REVIEW_AGENT_COUNT`

### Step 3: Simplify `agents/reviewAgent.ts`
- Remove the `agentIndex` parameter from `runReviewAgent`
- Remove the `applicationUrl` parameter from `runReviewAgent`
- Remove the `applicationUrl` parameter from `formatReviewArgs`
- Simplify `formatReviewArgs` to only take `adwId`, `specFile`, `agentName`, and `scenarioProofPath`
- Remove the parallel agent naming (`Review #${agentIndex}`) — always use `'Review'`
- Remove the `screenshotPath` field from `ReviewIssue` interface (review no longer captures screenshots; screenshots field in output is the proof file path)
- Update `reviewResultSchema` to match the simplified output structure
- Keep the `ReviewResult` and `ReviewAgentResult` interfaces, updated for the simplified shape

### Step 4: Delete `agents/reviewRetry.ts`
- Delete the file `adws/agents/reviewRetry.ts`
- In `adws/agents/index.ts`: remove the `reviewRetry` export block (lines 101–107 exporting `runReviewWithRetry`, `ReviewRetryResult`, `ReviewRetryOptions`, `MergedReviewResult`)

### Step 5: Rewrite `.claude/commands/review.md`
- Remove the `applicationUrl` variable ($3) and `reviewImageDir` variable
- Remove Step 1 (Setup — `prepare_app` invocation)
- Keep Step 2 (Gather Context) — git diff, read spec file
- Rewrite Step 3 (Produce Proof):
  - **Strategy A: Scenario Proof** — read `scenarioProofPath`, check per-tag results, run supplementary checks (`bunx tsc --noEmit`, `bun run lint`), set `screenshots` to `[scenarioProofPath]`
  - **Strategy B: Custom Proof** — follow `.adw/review_proof.md` instructions
  - Remove Strategy C entirely (no UI navigation, no screenshot capture)
- Keep Step 4 (Coding Guidelines Check)
- Update the Report/Output Structure:
  - `screenshots` is now the proof file path(s), not UI screenshot paths
  - Remove `screenshotPath` from reviewIssues items (no longer applicable)
- Variables: `adwId` ($0), `specFile` ($1), `agentName` ($2 or 'reviewAgent'), `scenarioProofPath` ($3 if provided)

### Step 6: Create `phases/reviewPhase.ts`
- Create new file `adws/phases/reviewPhase.ts`
- Import `runReviewAgent` from `../agents/reviewAgent`
- Import `getPlanFilePath` from `../agents/planAgent`
- Import cost tracking utilities from `../cost`
- Import `log`, `AgentStateManager` from `../core`
- Import `WorkflowConfig` from `./workflowInit`
- `scenarioProofPath` is received as a parameter from the calling orchestrator (derived from the `scenarioTestPhase` result); if empty, the review agent falls through to Strategy B or code-diff-only review
- Implement `executeReviewPhase(config: WorkflowConfig, scenarioProofPath: string)` returning:
  ```typescript
  {
    costUsd: number;
    modelUsage: ModelUsageMap;
    reviewPassed: boolean;
    reviewIssues: ReviewIssue[];
    totalRetries: number; // always 0 — retries are orchestrator-level now
    phaseCostRecords: PhaseCostRecord[];
  }
  ```
- Call `runReviewAgent(adwId, specFile, logsDir, statePath, cwd, issueBody, scenarioProofPath)` — single invocation, no parallelism; `scenarioProofPath` is the parameter received from the orchestrator
- Post issue stage comments for `review_running`, `review_passed`, `review_failed`
- On failure: log the error, set `ctx.errorMessage`, but do NOT `process.exit(1)` — the orchestrator handles retry or exit
- Track cost via `createPhaseCostRecords`

### Step 7: Create `executeReviewPatchCycle` helper
- Add to `adws/phases/reviewPhase.ts` an exported function:
  ```typescript
  export async function executeReviewPatchCycle(
    config: WorkflowConfig,
    blockerIssues: ReviewIssue[],
  ): Promise<{ costUsd: number; modelUsage: ModelUsageMap; phaseCostRecords: PhaseCostRecord[] }>
  ```
- For each blocker issue: call `runPatchAgent` → call `runBuildAgent` (using issue from config)
- After all blockers are patched: `runCommitAgent` + `pushBranch`
- Track cost for each agent call and return aggregated result
- This follows the same pattern as `scenarioFixPhase.ts` (run resolvers → commit → push)

### Step 8: Remove `executeReviewPhase` from `workflowCompletion.ts`
- Remove the `executeReviewPhase` function (lines 71–230)
- Remove imports only used by `executeReviewPhase`: `MAX_REVIEW_RETRY_ATTEMPTS`, `getPlanFilePath`, `runReviewWithRetry`, `uploadToR2`, `BoardStatus` (if unused by remaining functions)
- Verify remaining functions (`completeWorkflow`, `handleRateLimitPause`, `handleWorkflowError`) still compile

### Step 9: Update exports in `phases/index.ts` and `workflowPhases.ts`
- In `adws/phases/index.ts`:
  - Remove `executeReviewPhase` from the `workflowCompletion` export line
  - Add new export line: `export { executeReviewPhase, executeReviewPatchCycle } from './reviewPhase'`
  - Export `ReviewIssue` type from `reviewPhase` (or re-export from agents)
- In `adws/workflowPhases.ts`:
  - Add `executeReviewPatchCycle` to the export list
  - Verify `executeReviewPhase` is still exported (now from `reviewPhase.ts` via `phases/index.ts`)

### Step 10: Add orchestrator-level review retry loop to `adwSdlc.tsx`
- Import `MAX_REVIEW_RETRY_ATTEMPTS` from `./core`
- Import `executeReviewPatchCycle` from `./workflowPhases`
- Replace the current single `executeReviewPhase` call with a bounded loop:
  ```typescript
  let reviewRetries = 0;
  let proofPath = scenarioTestResult.scenarioProofPath;
  for (let attempt = 0; attempt < MAX_REVIEW_RETRY_ATTEMPTS; attempt++) {
    const reviewFn = (cfg: WorkflowConfig) =>
      executeReviewPhase(cfg, proofPath);
    const reviewResult = await runPhase(config, tracker, reviewFn);
    if (reviewResult.reviewPassed) break;
    reviewRetries++;
    if (attempt < MAX_REVIEW_RETRY_ATTEMPTS - 1) {
      const patchWrapper = (cfg: WorkflowConfig) =>
        executeReviewPatchCycle(cfg, reviewResult.reviewIssues);
      await runPhase(config, tracker, patchWrapper);
      const retestResult = await runPhase(config, tracker, executeScenarioTestPhase);
      proofPath = retestResult.scenarioProofPath;
    }
  }
  ```
- Remove the `executeReviewWithoutScenarios` wrapper — the new review phase receives the proof path from the orchestrator and does not run scenarios
- Update metadata: use `reviewRetries` for `totalReviewRetries`

### Step 11: Add orchestrator-level review retry loop to `adwPlanBuildReview.tsx`
- Import `MAX_REVIEW_RETRY_ATTEMPTS`, `executeReviewPatchCycle`, `executeScenarioTestPhase`, `WorkflowConfig`
- Replace the single `executeReviewPhase` call with the same bounded loop pattern as Step 10, passing `scenarioProofPath` from the scenarioTestPhase result
- Note: this orchestrator doesn't have a preceding scenario test → fix loop, but the review retry loop still re-runs scenarioTestPhase to verify patches don't break scenarios

### Step 12: Add orchestrator-level review retry loop to `adwPlanBuildTestReview.tsx`
- Replace the single `executeReviewWithoutScenarios` call with the bounded loop pattern, passing `scenarioProofPath` from the scenarioTestPhase result
- Remove the `executeReviewWithoutScenarios` wrapper
- Import `MAX_REVIEW_RETRY_ATTEMPTS`, `executeReviewPatchCycle`

### Step 13: Add review phase + retry loop to `adwPrReview.tsx`
- Import `executeReviewPhase`, `executeReviewPatchCycle`, `MAX_REVIEW_RETRY_ATTEMPTS`
- Add the review retry loop after the scenario test → fix loop and before `completePRReviewWorkflow`, passing `scenarioProofPath` from the scenarioTestPhase result
- The review phase receives the scenario proof path produced by the preceding scenarioTestPhase

### Step 14: Add orchestrator-level review retry loop to `adwChore.tsx` (regression_possible path)
- The review retry loop goes inside the `if (diffResult.verdict !== 'safe')` block
- Replace the single `executeReviewPhase` call with the bounded loop pattern, passing `scenarioProofPath` from the scenarioTestPhase result
- Import `MAX_REVIEW_RETRY_ATTEMPTS`, `executeReviewPatchCycle`, `executeScenarioTestPhase`

### Step 15: Clean up `README.md` and `.env.sample`
- In `README.md`: remove the `REVIEW_AGENT_COUNT` line from the environment variables list
- In `.env.sample`: remove the `# REVIEW_AGENT_COUNT=3` line

### Step 16: Run validation commands
- Run `bun run lint` to verify no lint errors
- Run `bun run build` to verify no build errors
- Run `bunx tsc --noEmit` to verify type checking passes
- Run `bunx tsc --noEmit -p adws/tsconfig.json` to verify adws-specific type checking
- Run `bun run test` to verify existing tests still pass

## Testing Strategy
### Unit Tests
The new `reviewPhase.ts` is a shallow orchestration module that composes existing agents. Per the parent PRD's testing decisions, shallow orchestration modules are covered by integration tests against the orchestrators rather than isolated unit tests. The existing Vitest tests under `adws/__tests__/` and `adws/phases/__tests__/` verify the components it composes (`phaseRunner`, `scenarioTestPhase`, etc.). No new unit test file is needed for this slice.

### Edge Cases
- **Scenario proof file does not exist**: the orchestrator passes an empty `scenarioProofPath` to `executeReviewPhase`, which forwards it to the review agent; the agent falls through to Strategy B or a code-diff-only review
- **Review finds no blockers on first attempt**: the retry loop exits immediately with `reviewPassed: true`
- **Review exhausts all retry attempts**: the last iteration's `reviewPassed: false` propagates to the orchestrator, which writes failure state and exits
- **Scenario test fails during review retry loop**: the loop continues (scenario test failure doesn't abort the review retry), but the next review iteration will see the failed proof and may flag additional blockers <!-- ADW-WARNING: Unresolved conflict — BDD scenario 'Review retry loop handles scenario test failure after patch' says the scenario fix loop should run before re-running review, but the issue does not specify this behaviour. Decide during implementation whether to run the scenario fix loop within the review retry loop when scenario tests fail. -->
- **adwPlanBuildReview has no prior scenario test phase**: the review retry loop still calls `executeScenarioTestPhase` after patching; if no scenarios are configured, the phase returns immediately with a passing result
- **Custom review proof (Strategy B)**: when `.adw/review_proof.md` exists, the review agent follows those instructions instead of reading `scenario_proof.md`
- **adwChore safe verdict**: the review retry loop is never entered; the orchestrator goes straight to PR

## Acceptance Criteria
- `phases/reviewPhase.ts` exists with the passive judge implementation (reads proof, calls single agent, returns)
- `executeReviewPhase` is no longer in `workflowCompletion.ts`
- `agents/reviewAgent.ts` has no `agentIndex` parameter, no `applicationUrl` parameter, no `REVIEW_AGENT_COUNT` reference
- `agents/reviewRetry.ts` does not exist
- `REVIEW_AGENT_COUNT` does not appear anywhere in `core/`
- `.claude/commands/review.md` has only Strategy A and Strategy B (no Strategy C, no `prepare_app`, no `applicationUrl`)
- All five orchestrators (`adwSdlc`, `adwPlanBuildReview`, `adwPlanBuildTestReview`, `adwPrReview`, `adwChore`) have the orchestrator-level review retry loop bounded by `MAX_REVIEW_RETRY_ATTEMPTS`
- `bun run lint`, `bun run build`, `bunx tsc --noEmit`, and `bun run test` all pass with zero errors
- `REVIEW_AGENT_COUNT` is removed from `README.md` and `.env.sample`

## Validation Commands
- `bun run lint` — Run linter to check for code quality issues
- `bun run build` — Build the application to verify no build errors
- `bunx tsc --noEmit` — Type check the project
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type check the adws module specifically
- `bun run test` — Run tests to validate zero regressions

## Notes
- The `screenshotPath` field in `ReviewIssue` is removed because review no longer captures UI screenshots. The `screenshots` field in `ReviewResult` now contains the proof file path(s) rather than image paths. The R2 upload logic in the old `executeReviewPhase` for uploading review screenshots is removed entirely — review produces no screenshots to upload.
- The `applicationUrl` field on `WorkflowConfig` is no longer consumed by review. It remains on the config for phases that may need it (e.g., `scenarioTestPhase` uses it to derive the dev server port).
- The `executeReviewPatchCycle` helper in `reviewPhase.ts` follows the same compositional pattern as `scenarioFixPhase.ts`: run agent per failure → commit → push. This avoids duplicating ~30 lines of patch+build+commit logic across five orchestrators.
- The `totalRetries` field in the review phase result is kept at 0 for compatibility with `PhaseResult` consumers. The actual retry count is tracked by the orchestrator's loop variable.
- Strictly adhere to `guidelines/coding_guidelines.md`: modularity (single responsibility per file), immutability (new objects over mutation), type safety (no `any`), functional programming (composition over deep nesting).
