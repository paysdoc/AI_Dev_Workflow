# Bug: adwPlan.tsx bypasses RateLimitError handling — rate limits cause hard failure instead of pause

## Metadata
issueNumber: `367`
adwId: `2sqt1r-error`
issueJson: `{"number":367,"title":"Error","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-31T06:03:26Z"}`

## Bug Description
When the plan agent encounters a rate limit (HTTP 429, overloaded_error/529, or billing limit rejection) during the `adwPlan.tsx` orchestrator, the workflow exits with code 1 (hard failure) instead of code 0 (paused for retry). This means the pause queue scanner never picks up the workflow for automatic retry, and the issue is marked as errored on the project board.

**Expected behavior:** Rate-limited plan workflows should pause gracefully (exit 0), enqueue themselves for automatic retry via the pause queue scanner, and post a "paused" comment on the GitHub issue.

**Actual behavior:** The `RateLimitError` thrown by `runClaudeAgentWithCommand()` propagates uncaught to `handleWorkflowError()`, which posts an error comment, marks the workflow as failed, and exits with code 1.

## Problem Statement
`adwPlan.tsx` is the only orchestrator that calls `executePlanPhase()` and `executeInstallPhase()` directly instead of routing them through `runPhase()`. The `runPhase()` function contains a `RateLimitError` catch handler that calls `handleRateLimitPause()` (exit 0 + pause queue). By bypassing `runPhase()`, `adwPlan.tsx` loses all rate-limit pause/resume mechanics.

## Solution Statement
Refactor `adwPlan.tsx` to use `CostTracker` + `runPhase()` for both the install and plan phases, matching the pattern established by every other orchestrator (`adwPlanBuild.tsx`, `adwChore.tsx`, `adwSdlc.tsx`, etc.). This ensures `RateLimitError` is caught by `runPhase()` and routed to `handleRateLimitPause()`.

## Steps to Reproduce
1. Run the plan-only orchestrator: `bunx tsx adws/adwPlan.tsx <issueNumber>`
2. The plan agent calls `runClaudeAgentWithCommand()` which calls `handleAgentProcess()`
3. During processing, if `state.rateLimitRejected` or `state.overloadedErrorDetected` or `state.serverErrorDetected` is set, the process is killed
4. `handleAgentProcess` returns `AgentResult` with `rateLimited: true`
5. `runClaudeAgentWithCommand()` throws `RateLimitError` (claudeAgent.ts:149)
6. `executePlanPhase()` does not catch it — propagates up
7. `adwPlan.tsx` catch block calls `handleWorkflowError()` → exit 1 (BUG)

## Root Cause Analysis
The error-handling flow in `adwPlan.tsx` (lines 46-59):

```typescript
try {
    const installResult = await executeInstallPhase(config);    // manual cost tracking...
    const planResult = await executePlanPhase(config);           // manual cost tracking...
    await completeWorkflow(config, totalCostUsd, undefined, totalModelUsage);
} catch (error) {
    handleWorkflowError(config, error);  // ← ALL errors go here, including RateLimitError
}
```

Compare with the correct pattern in `adwPlanBuild.tsx` (lines 53-68):

```typescript
const tracker = new CostTracker();
try {
    await runPhase(config, tracker, executeInstallPhase);  // ← RateLimitError → handleRateLimitPause() → exit 0
    await runPhase(config, tracker, executePlanPhase);      // ← RateLimitError → handleRateLimitPause() → exit 0
    await completeWorkflow(config, tracker.totalCostUsd, ...);
} catch (error) {
    handleWorkflowError(config, error, tracker.totalCostUsd, tracker.totalModelUsage);
}
```

`runPhase()` (phaseRunner.ts:128-143) catches `RateLimitError`, calls `handleRateLimitPause()` (which calls `process.exit(0)` — the process ends cleanly), and the pause queue scanner can later resume the workflow. Without `runPhase()`, the error falls through to `handleWorkflowError()` which exits with code 1.

Additionally, `adwPlan.tsx` manually calls `persistTokenCounts()` and `mergeModelUsageMaps()` instead of delegating to `CostTracker`, which is redundant boilerplate that `runPhase()` + `CostTracker` handles automatically.

## Relevant Files
Use these files to fix the bug:

- `adws/adwPlan.tsx` — The plan-only orchestrator. **Primary file to fix.** Must be refactored to use `CostTracker` + `runPhase()` instead of calling phase functions directly.
- `adws/core/phaseRunner.ts` — Contains `runPhase()`, `CostTracker`, and the `RateLimitError` catch handler. Reference for the correct pattern (read-only).
- `adws/adwPlanBuild.tsx` — Reference orchestrator showing the correct `CostTracker` + `runPhase()` pattern (read-only).
- `adws/phases/workflowCompletion.ts` — Contains `handleRateLimitPause()`, `handleWorkflowError()`, and `deriveOrchestratorScript()`. **Secondary file to fix**: add `'plan-orchestrator'` and `'chore-orchestrator'` mappings to `deriveOrchestratorScript()`.
- `adws/types/agentTypes.ts` — Defines `RateLimitError` class (read-only).
- `adws/agents/claudeAgent.ts` — Throws `RateLimitError` when `result.rateLimited === true` (read-only).
- `app_docs/feature-chpy1a-generic-pipeline-runner-pause-resume.md` — Conditional doc: read this for context on rate limit pause/resume mechanics.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Read reference files
- Read `adws/adwPlanBuild.tsx` to understand the correct `CostTracker` + `runPhase()` pattern
- Read `adws/adwPlan.tsx` to understand the current (broken) implementation
- Read `adws/core/phaseRunner.ts` to understand `runPhase()` and `CostTracker`
- Read `app_docs/feature-chpy1a-generic-pipeline-runner-pause-resume.md` for rate limit pause/resume context

### Step 2: Add missing orchestrator mappings to `deriveOrchestratorScript()`
- In `adws/phases/workflowCompletion.ts`, add `'plan-orchestrator': 'adwPlan'` and `'chore-orchestrator': 'adwChore'` to the `nameMap` in `deriveOrchestratorScript()` (line ~236)
- Without this mapping, a paused plan workflow would resume using `adwSdlc.tsx` (the fallback) instead of `adwPlan.tsx`, which is incorrect

### Step 3: Refactor `adwPlan.tsx` to use `CostTracker` + `runPhase()`
- Add import for `CostTracker` and `runPhase` from `./core/phaseRunner`
- Remove imports of `persistTokenCounts` and `mergeModelUsageMaps` from `./core` (no longer needed)
- Create a `const tracker = new CostTracker()` before the try block
- Replace `const installResult = await executeInstallPhase(config)` with `await runPhase(config, tracker, executeInstallPhase)`
- Replace `const planResult = await executePlanPhase(config)` with `await runPhase(config, tracker, executePlanPhase)`
- Remove the manual `persistTokenCounts()` and `mergeModelUsageMaps()` calls (CostTracker handles this)
- Update `completeWorkflow()` call to use `tracker.totalCostUsd` and `tracker.totalModelUsage`
- Update `handleWorkflowError()` call to pass `tracker.totalCostUsd` and `tracker.totalModelUsage` (so cost data survives failures)

### Step 4: Write unit test for `RateLimitError` routing in `adwPlan.tsx`
- Create `adws/core/__tests__/phaseRunner.test.ts` with tests verifying:
  - `runPhase()` catches `RateLimitError` and calls `handleRateLimitPause()` (mock `process.exit` to prevent test from exiting)
  - `runPhase()` re-throws non-`RateLimitError` errors to the caller
  - `CostTracker` accumulates cost and model usage correctly across phases

### Step 5: Run validation commands
- Run all validation commands listed below to confirm zero regressions

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Type-check the main project
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type-check the adws module
- `bun run build` — Build the application to verify no build errors
- `bun run test` — Run tests to validate the bug is fixed with zero regressions

## Notes
- The fix is minimal: only `adwPlan.tsx` needs code changes. All other orchestrators already use the correct pattern.
- No new libraries are required.
- `handleRateLimitPause()` calls `process.exit(0)` which means `runPhase()` never actually re-throws for rate limit errors — the process ends cleanly. The `throw err` after `handleRateLimitPause()` in `runPhase()` is unreachable dead code for `RateLimitError`, but it correctly re-throws all other error types.
- `deriveOrchestratorScript()` was also missing `'chore-orchestrator': 'adwChore'` — both are fixed in Step 2 to prevent incorrect resume-script selection from the pause queue.
