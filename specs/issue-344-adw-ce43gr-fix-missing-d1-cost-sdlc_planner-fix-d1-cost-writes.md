# Bug: Missing D1 cost writes in standalone orchestrators + no worker observability

## Metadata
issueNumber: `344`
adwId: `ce43gr-fix-missing-d1-cost`
issueJson: `{"number":344,"title":"fix: missing D1 cost writes in standalone orchestrators + enable worker observability","body":"## Problem\n\n### 1. Missing D1 cost writes\n\nFour orchestrators manually accumulate costs via `persistTokenCounts()` (local state file only) but never call `postCostRecordsToD1()`. Cost data from these runs is absent from the D1 database.\n\n| Orchestrator | Uses CostTracker? | D1 Writes? |\n|---|---|---|\n| `adwInit.tsx` | No | **No** |\n| `adwPlan.tsx` | No | **No** |\n| `adwDocument.tsx` | No | **No** |\n| `adwPrReview.tsx` | No | **No** |\n\nAll other orchestrators (`adwBuild`, `adwPlanBuild`, `adwSdlc`, `adwChore`, etc.) correctly use `CostTracker`/`runPhase` from `adws/core/phaseRunner.ts`, which calls `tracker.commit()` → `postCostRecordsToD1()` after every phase.\n\n### 2. No worker observability\n\nNeither Cloudflare Worker has logging enabled, making it impossible to debug whether D1 write requests are received and what errors occur.\n\n## Fix\n\n### D1 cost writes\n\nMigrate all four orchestrators from manual cost accumulation to the `CostTracker`/`runPhase` pattern:\n\n- `adwInit.tsx` — replace manual `totalCostUsd`/`totalModelUsage` tracking with `CostTracker` + `runPhase`\n- `adwPlan.tsx` — same\n- `adwDocument.tsx` — same\n- `adwPrReview.tsx` — same\n\nReference implementation: any of the working orchestrators (e.g. `adwBuild.tsx`, `adwPlanBuild.tsx`).\n\n### Worker observability\n\nAdd `[observability]` section to both worker `wrangler.toml` files:\n\n- `workers/cost-api/wrangler.toml`\n- `workers/screenshot-router/wrangler.toml`\n\n```toml\n[observability]\nenabled = true\n```\n\n### Discovered during\n\n```/adw_init``` on `paysdoc/paysdoc.nl` — no cost DB record was written. Investigation confirmed `adwInit.tsx` never calls `postCostRecordsToD1`, and the worker had no logging to verify whether requests were even received.","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-30T07:10:51Z","comments":[{"author":"paysdoc","createdAt":"2026-03-30T07:52:08Z","body":"## Take action"}],"actionableComment":null}`

## Bug Description
Four orchestrators (`adwInit.tsx`, `adwPlan.tsx`, `adwDocument.tsx`, `adwPrReview.tsx`) manually accumulate costs using `persistTokenCounts()` which only writes to a local state file. They never call `postCostRecordsToD1()`, so cost data from these workflow runs is completely absent from the D1 database.

Additionally, both Cloudflare Workers (`cost-api` and `screenshot-router`) have no observability configuration, making it impossible to debug whether D1 write requests are received or what errors occur.

**Expected**: All orchestrators post phase cost records to D1 after each phase, consistent with `adwBuild.tsx`, `adwSdlc.tsx`, etc.
**Actual**: Cost data from init, plan, document, and PR review workflows never reaches D1.

## Problem Statement
1. `adwPlan.tsx` and `adwInit.tsx` use manual `persistTokenCounts()` calls instead of the `CostTracker`/`runPhase` pattern that automatically calls `postCostRecordsToD1()`.
2. `adwDocument.tsx` has no `WorkflowConfig` and uses `AgentStateManager` directly — it has no cost-to-D1 path at all.
3. `adwPrReview.tsx` uses `PRReviewWorkflowConfig` (not `WorkflowConfig`), so `runPhase()` can't be used directly. Its install/plan/build phases never post to D1 (only the test phase in `prReviewCompletion.ts` already does).
4. Both Cloudflare Workers lack `[observability]` configuration.

## Solution Statement
- **adwPlan.tsx**: Direct migration to `CostTracker` + `runPhase` (both phase functions already return `PhaseResult`-compatible shapes).
- **adwInit.tsx**: Wrap inline agent call in a local phase function returning `PhaseResult`, then use `CostTracker` + `runPhase` for both init and PR phases.
- **adwDocument.tsx**: Add direct `createPhaseCostRecords` + `postCostRecordsToD1` calls after the agent completes (no `WorkflowConfig` available, so CostTracker can't be used).
- **adwPrReview.tsx**: Add `createPhaseCostRecords` + `postCostRecordsToD1` calls after each phase in the orchestrator (install, plan, build). The test phase already handles D1 writes internally.
- **Workers**: Add `[observability]\nenabled = true` to both `wrangler.toml` files.

## Steps to Reproduce
1. Run `bunx tsx adws/adwInit.tsx <issueNumber>` on any target repo
2. Check the D1 database for cost records with the workflow's `adwId`
3. Observe: no records exist (cost was only written to local state file)
4. Same applies to `adwPlan.tsx`, `adwDocument.tsx`, and `adwPrReview.tsx`

## Root Cause Analysis
When these four orchestrators were written (or last refactored), they predated the `CostTracker`/`runPhase` abstraction introduced in `adws/core/phaseRunner.ts`. They use the older manual pattern:
```typescript
totalCostUsd += result.costUsd;
totalModelUsage = mergeModelUsageMaps(totalModelUsage, result.modelUsage);
persistTokenCounts(config.orchestratorStatePath, totalCostUsd, totalModelUsage);
```
This only persists to the local state file. The newer pattern via `runPhase()` additionally calls `tracker.commit()` → `postCostRecordsToD1()`, which posts cost records to the Cost API Worker for D1 storage.

The worker observability gap is a separate oversight — neither worker was configured with Cloudflare's logging when deployed.

## Relevant Files
Use these files to fix the bug:

- `adws/adwPlan.tsx` — orchestrator to migrate to CostTracker/runPhase (simplest case)
- `adws/adwInit.tsx` — orchestrator to migrate; inline agent call needs wrapping in a phase function
- `adws/adwDocument.tsx` — orchestrator to add direct D1 cost writes (no WorkflowConfig, different pattern)
- `adws/adwPrReview.tsx` — orchestrator to add per-phase D1 cost writes (uses PRReviewWorkflowConfig, not WorkflowConfig)
- `adws/core/phaseRunner.ts` — reference: `CostTracker` class, `runPhase()` function, `PhaseResult` interface
- `adws/adwBuild.tsx` — reference implementation of correct CostTracker/runPhase pattern
- `adws/cost/types.ts` — `createPhaseCostRecords()`, `PhaseCostStatus`, `PhaseCostRecord`
- `adws/cost/d1Client.ts` — `postCostRecordsToD1()` function
- `adws/cost/index.ts` — barrel exports for cost module
- `adws/phases/installPhase.ts` — `executeInstallPhase()` returns `PhaseResult`-compatible shape
- `adws/phases/planPhase.ts` — `executePlanPhase()` returns `PhaseResult`-compatible shape
- `adws/phases/prPhase.ts` — `executePRPhase()` returns `PhaseResult`-compatible shape
- `adws/phases/prReviewPhase.ts` — `PRReviewWorkflowConfig` interface; plan/build phases return `{ costUsd, modelUsage }` (no phaseCostRecords)
- `adws/phases/prReviewCompletion.ts` — test phase already posts to D1; reference for manual `createPhaseCostRecords` + `postCostRecordsToD1` pattern
- `adws/workflowPhases.ts` — barrel re-exports
- `workers/cost-api/wrangler.toml` — add observability
- `workers/screenshot-router/wrangler.toml` — add observability
- `app_docs/feature-92py6q-d1-client-dual-write.md` — conditional doc: D1 client dual-write pipeline context
- `app_docs/feature-g2u55r-d1-client-dual-write.md` — conditional doc: postCostRecordsToD1 function context
- `app_docs/feature-ak03s5-remove-csv-cost-pipeline.md` — conditional doc: D1-only migration context (CSV removed)

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Read reference implementation and conditional docs

- Read `adws/adwBuild.tsx` to understand the correct CostTracker/runPhase pattern
- Read `adws/core/phaseRunner.ts` to understand `CostTracker`, `runPhase`, and `PhaseResult`
- Read `adws/cost/types.ts` (focus on `createPhaseCostRecords` and `PhaseCostStatus`)
- Read `adws/cost/d1Client.ts` to understand `postCostRecordsToD1`
- Read `adws/phases/prReviewCompletion.ts` lines 120-165 for the manual `createPhaseCostRecords` + `postCostRecordsToD1` pattern used for PR reviews
- Read conditional docs: `app_docs/feature-92py6q-d1-client-dual-write.md`, `app_docs/feature-g2u55r-d1-client-dual-write.md`, `app_docs/feature-ak03s5-remove-csv-cost-pipeline.md`

### Step 2: Migrate `adwPlan.tsx` to CostTracker/runPhase

This is the simplest migration. Both `executeInstallPhase` and `executePlanPhase` already return `{ costUsd, modelUsage, phaseCostRecords }` (fully `PhaseResult`-compatible).

- Replace import of `persistTokenCounts, mergeModelUsageMaps` from `'./core'` with import of `CostTracker, runPhase` from `'./core/phaseRunner'`
- Note: `persistTokenCounts` and `mergeModelUsageMaps` are currently imported from `'./core'` — verify the exact import path and only remove them if no longer used
- Create `const tracker = new CostTracker()` before the try block
- Replace the manual install phase + cost tracking:
  ```typescript
  // BEFORE:
  const installResult = await executeInstallPhase(config);
  let totalCostUsd = installResult.costUsd;
  let totalModelUsage = installResult.modelUsage;
  persistTokenCounts(config.orchestratorStatePath, totalCostUsd, totalModelUsage);

  // AFTER:
  await runPhase(config, tracker, executeInstallPhase, 'install');
  ```
- Replace the manual plan phase + cost tracking:
  ```typescript
  // BEFORE:
  const planResult = await executePlanPhase(config);
  totalCostUsd += planResult.costUsd;
  totalModelUsage = mergeModelUsageMaps(totalModelUsage, planResult.modelUsage);
  persistTokenCounts(config.orchestratorStatePath, totalCostUsd, totalModelUsage);

  // AFTER:
  await runPhase(config, tracker, executePlanPhase, 'plan');
  ```
- Update `completeWorkflow` call to use `tracker.totalCostUsd` and `tracker.totalModelUsage`
- Update `handleWorkflowError` call to pass `tracker.totalCostUsd` and `tracker.totalModelUsage`
- Remove all `let totalCostUsd` / `let totalModelUsage` variables

### Step 3: Migrate `adwInit.tsx` to CostTracker/runPhase

The inline agent call must be wrapped in a local phase function that returns `PhaseResult`.

- Add imports: `CostTracker, runPhase` from `'./core/phaseRunner'` and `createPhaseCostRecords, PhaseCostStatus` from `'./cost'`
- Remove `persistTokenCounts, emptyModelUsageMap, mergeModelUsageMaps` imports (keep `ModelUsageMap` type import only if still needed by the local phase function signature — check after refactoring)
- Extract the inline init work (lines 57-93) into a local async function that takes `config: WorkflowConfig` and returns `PhaseResult`:
  ```typescript
  async function executeInitPhase(config: WorkflowConfig): Promise<PhaseResult> {
    log('Phase: ADW Init', 'info');
    const issueJson = JSON.stringify({
      number: config.issue.number,
      title: config.issue.title,
      body: config.issue.body,
    });

    const result = await runClaudeAgentWithCommand(
      '/adw_init',
      [String(config.issueNumber), config.adwId, issueJson],
      'adw-init',
      `${config.logsDir}/adw-init.jsonl`,
      'sonnet',
      undefined, undefined, undefined,
      config.worktreePath,
    );

    if (!result.success) throw new Error('ADW init command failed');

    log('ADW init completed, copying target skills and commands...', 'info');
    copyTargetSkillsAndCommands(config.worktreePath);

    log('Committing files...', 'info');
    commitChanges('chore: initialize .adw/ config with target skills and commands', config.worktreePath);

    const costUsd = result.totalCostUsd ?? 0;
    const modelUsage = result.modelUsage ?? {};
    const phaseCostRecords = createPhaseCostRecords({
      workflowId: config.adwId,
      issueNumber: config.issueNumber,
      phase: 'init',
      status: PhaseCostStatus.Success,
      retryCount: 0,
      contextResetCount: 0,
      durationMs: 0,
      modelUsage,
    });

    return { costUsd, modelUsage, phaseCostRecords };
  }
  ```
- Import `PhaseResult` type from `'./core/phaseRunner'` if needed for the return type annotation
- Create `const tracker = new CostTracker()` before the try block
- Replace inline code + PR phase with:
  ```typescript
  await runPhase(config, tracker, executeInitPhase, 'init');
  log('Phase: PR Creation', 'info');
  await runPhase(config, tracker, executePRPhase, 'pr');
  await completeWorkflow(config, tracker.totalCostUsd, undefined, tracker.totalModelUsage);
  ```
- Remove the manual `let totalModelUsage` / `let totalCostUsd` variables and all manual accumulation
- Update `handleWorkflowError` to pass `tracker.totalCostUsd` and `tracker.totalModelUsage`
- Update `handleRateLimitPause` to pass `tracker.totalCostUsd` and `tracker.totalModelUsage`
- Remove `persistTokenCounts` call (now handled by `runPhase`)

### Step 4: Add D1 cost writes to `adwDocument.tsx`

This orchestrator uses `AgentStateManager` directly (no `WorkflowConfig`), so `CostTracker`/`runPhase` cannot be used. Add direct `createPhaseCostRecords` + `postCostRecordsToD1` calls instead.

- Add imports: `createPhaseCostRecords, PhaseCostStatus` from `'./cost'` and `postCostRecordsToD1` from `'./cost/d1Client'`
- After the agent completes successfully (after line 84: `const totalCostUsd = result.totalCostUsd || 0;`), add D1 cost posting:
  ```typescript
  // Post cost records to D1
  if (result.modelUsage && Object.keys(result.modelUsage).length > 0) {
    const phaseCostRecords = createPhaseCostRecords({
      workflowId: adwId,
      issueNumber: 0,
      phase: 'document',
      status: result.success ? PhaseCostStatus.Success : PhaseCostStatus.Failed,
      retryCount: 0,
      contextResetCount: 0,
      durationMs: 0,
      modelUsage: result.modelUsage,
    });
    const repoName = process.env.GITHUB_REPO_URL?.split('/').pop()?.replace('.git', '') ?? 'unknown';
    void postCostRecordsToD1({
      project: repoName,
      repoUrl: process.env.GITHUB_REPO_URL,
      records: phaseCostRecords,
    });
  }
  ```
- Place this code BEFORE the `AgentStateManager.writeState` call (line 86) so it runs regardless of success/failure
- Move it outside the `if (result.success)` block — it should fire for both success and failure paths
- The `void` prefix ensures the promise doesn't block the orchestrator (fire-and-forget, matching the pattern in `prReviewCompletion.ts`)

### Step 5: Add D1 cost writes to `adwPrReview.tsx`

This orchestrator uses `PRReviewWorkflowConfig` (not `WorkflowConfig`), so `runPhase()` can't be used. Add per-phase `createPhaseCostRecords` + `postCostRecordsToD1` calls. The test phase in `prReviewCompletion.ts` already posts to D1 for the combined review, so we need to add writes for install, plan, and build phases.

- Add imports: `createPhaseCostRecords, PhaseCostStatus` from `'./cost'` and `postCostRecordsToD1` from `'./cost/d1Client'`
- Add a local helper function to reduce repetition:
  ```typescript
  function commitPhaseToD1(config: PRReviewWorkflowConfig, phaseName: string, modelUsage: ModelUsageMap): void {
    if (!modelUsage || Object.keys(modelUsage).length === 0) return;
    const repoName = config.repoContext?.repoId.repo ?? 'unknown';
    const records = createPhaseCostRecords({
      workflowId: config.adwId,
      issueNumber: config.issueNumber ?? 0,
      phase: phaseName,
      status: PhaseCostStatus.Success,
      retryCount: 0,
      contextResetCount: 0,
      durationMs: 0,
      modelUsage,
    });
    void postCostRecordsToD1({
      project: repoName,
      repoUrl: process.env.GITHUB_REPO_URL,
      records,
    });
  }
  ```
- Import `PRReviewWorkflowConfig` type from `'./workflowPhases'` (or `'./phases'`) for the helper function parameter type
- After the install phase succeeds (after line 73: `persistTokenCounts(...)` inside the install try block), add:
  ```typescript
  commitPhaseToD1(config, 'pr_review_install', installResult.modelUsage ?? {});
  ```
- After the plan phase (after line 83: `persistTokenCounts(...)`), add:
  ```typescript
  commitPhaseToD1(config, 'pr_review_plan', planResult.modelUsage);
  ```
- After the build phase (after line 90: `persistTokenCounts(...)`), add:
  ```typescript
  commitPhaseToD1(config, 'pr_review_build', buildResult.modelUsage);
  ```
- Do NOT add a D1 write after the test phase — `executePRReviewTestPhase` in `prReviewCompletion.ts` already handles this internally

### Step 6: Enable worker observability

- Add `[observability]` section to `workers/cost-api/wrangler.toml`:
  ```toml
  [observability]
  enabled = true
  ```
  Place it after the `compatibility_date` line and before the `[[routes]]` section.

- Add `[observability]` section to `workers/screenshot-router/wrangler.toml`:
  ```toml
  [observability]
  enabled = true
  ```
  Place it after the `compatibility_date` line and before the `[[routes]]` section.

### Step 7: Run validation commands

- Run all validation commands listed below to confirm zero regressions.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Type-check the main project
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type-check the adws module specifically
- `bun run build` — Build the application to verify no build errors

## Notes
- `adwDocument.tsx` and `adwPrReview.tsx` cannot use `CostTracker`/`runPhase` directly because they don't have a `WorkflowConfig` object. The plan uses direct `createPhaseCostRecords` + `postCostRecordsToD1` calls instead, matching the pattern already used in `prReviewCompletion.ts`.
- `postCostRecordsToD1` silently skips when `COST_API_URL` is not set and never throws — it is safe to call fire-and-forget with `void`.
- The `durationMs: 0` in cost records for document and PR review is acceptable — duration tracking can be added later if needed.
- No new libraries required.
