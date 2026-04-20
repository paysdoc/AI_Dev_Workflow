# Feature: spawnGate lifetime extension — orchestrator holds the lock for its full lifetime

## Metadata
issueNumber: `463`
adwId: `yxo18t-orchestrator-resilie`
issueJson: `{"number":463,"title":"orchestrator-resilience: spawnGate lifetime extension + PID-start-time liveness","body":"## Parent PRD\n\n`specs/prd/orchestrator-coordination-resilience.md`\n\n## What to build\n\nExtend the spawn gate's lock from a classify-to-spawn window to the orchestrator's full lifetime, and teach it to use PID+start-time liveness via `processLiveness`. This closes the gap where a candidate arriving after spawn but before completion has no signal that work is in progress. Orchestrator acquires the lock on startup and releases it on normal exit via `finally`; crash recovery relies on the staleness check. See \"Modules to extend → spawnGate\" in the PRD.\n\n## Acceptance criteria\n\n- [ ] `spawnGate` lock record includes `pidStartedAt` alongside `pid`\n- [ ] Liveness checks against an existing lock delegate to `processLiveness.isProcessLive`\n- [ ] Lock acquisition remains `writeFileSync` with `wx` exclusive-create\n- [ ] Stale-lock recovery is force-remove after a PID+start-time liveness check failure\n- [ ] Lock is acquired by the orchestrator process itself immediately after state init\n- [ ] Lock release happens in `finally` on normal exit\n- [ ] Unit tests in `spawnGate.test.ts` cover: fresh acquire, contention with live holder (defer), contention with dead holder (reclaim), PID reuse with mismatched start-time (reclaim)\n\n## Blocked by\n\n- Blocked by #456\n- Blocked by #461\n\n## User stories addressed\n\n- User story 6\n- User story 13","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-04-20T11:05:15Z","comments":[],"actionableComment":null}`

## Feature Description

Extend the per-issue spawn gate introduced in issue #449 so that the lock is held for the orchestrator's full lifetime rather than only the classify-to-spawn window. Today the webhook/cron trigger acquires the lock, classifies the issue, spawns a detached orchestrator process, then releases the lock. Once the child orchestrator is running, any subsequent candidate for the same issue has no filesystem signal that work is in progress — only the top-level state file, which another trigger would have to read and interpret ("did someone already start this?"). That indirection is the "two-step 'spawn succeeded, now check state' dance" called out in PRD user story 13.

After this slice, the orchestrator itself is the lock holder. Immediately after `initializeWorkflow` returns (i.e. after top-level state has been written and the orchestrator process has an identity), each orchestrator calls `acquireIssueSpawnLock(repoInfo, issueNumber, process.pid)`. The lock file records the orchestrator's `pid` and its platform `pidStartedAt` (already captured at acquisition by `spawnGate` after issue #456). On normal completion, a `finally` block releases the lock. On any abnormal exit — `handleWorkflowError`, `handleWorkflowDiscarded`, `handleRateLimitPause`, or an outright crash — the lock file remains on disk and recovery is handled by the next caller's `processLiveness.isProcessLive` staleness check: a dead PID, or a live PID whose start-time disagrees with the recorded `pidStartedAt`, is force-reclaimed.

The trigger-side lock introduced by issue #449 is unchanged and continues to dedup the narrow classify-to-spawn window. The orchestrator-side lock introduced in this slice takes over coverage from the moment the orchestrator reaches its acquire call and holds until the normal-exit `finally` runs. The two locks are sequential against the same file path; the brief window between trigger-release and orchestrator-acquire is acceptable because the orchestrator's own acquire becomes the durable coordination primitive for the rest of the lifecycle.

All of the spawnGate *module* acceptance criteria (`pidStartedAt` on the lock record, `processLiveness.isProcessLive` delegation, `wx` exclusive-create, stale-lock force-remove, and the four unit-test cases) already landed as part of issue #456 "processLiveness module". This slice's new work is purely in the orchestrator entrypoints: wire `acquireIssueSpawnLock` and `releaseIssueSpawnLock` into each of the twelve orchestrator scripts listed in the PRD's "Shared entrypoint wiring" section, keeping the boilerplate minimal via a thin helper.

## User Story

As an ADW operator, I want two simultaneous cron/webhook candidates for the same issue to deterministically resolve to a single orchestrator spawn, so that I don't get two PRs or two branches competing for the same issue. (User story 6)

As an ADW developer, I want the coordination lock to be held by the orchestrator process itself for its full lifetime, so that contention detection is not a two-step "spawn succeeded, now check state" dance. (User story 13)

## Problem Statement

`spawnGate` currently covers only the trigger's classify-to-spawn window (issue #449). `classifyAndSpawnWorkflow` in `adws/triggers/webhookGatekeeper.ts` acquires the lock with the trigger's PID, classifies the issue, spawns `bunx tsx adws/adw<…>.tsx` detached, then releases — all within a few seconds. For the remaining minutes-to-hours of the orchestrator's actual work (install → plan → build → test → review → PR → …), the spawn lock no longer exists. Any new candidate arriving at the issue — a second webhook event, a later cron tick that has not yet seen the orchestrator's ADW comments, a resume path, or a takeover attempt — has to reason about "is this issue being worked on right now?" by reading the top-level state file and checking whether the recorded `pid` is alive. That check is duplicated across call sites and is exactly the "two-step dance" the PRD calls out.

The follow-on coordination work (takeoverHandler, hungOrchestratorDetector, heartbeat) all want a single question to ask first: *is the per-issue lock held by a live process?* Without an orchestrator-lifetime lock, the answer depends on state-file interpretation; with it, a single `fs.readFileSync` on the lock path plus one `processLiveness.isProcessLive` call settles contention deterministically. This slice provides that primitive by extending the lock's lifetime end-to-end across the orchestrator process, with crash-survivor recovery falling out of `processLiveness`'s existing PID+start-time semantics.

The `spawnGate` module already has the PID+start-time liveness logic, the `wx` exclusive-create flag, and the stale-lock force-reclaim behavior — all delivered by issue #456 and verified by `adws/triggers/__tests__/spawnGate.test.ts`. The gap is purely at the caller layer: the twelve orchestrator entrypoints listed in the PRD's "Shared entrypoint wiring" bullet do not call `acquireIssueSpawnLock` / `releaseIssueSpawnLock` today. They must each invoke the gate immediately after `initializeWorkflow` (or its adwMerge-equivalent state-read) and release in a `finally` on the normal-exit path.

## Solution Statement

Introduce a thin helper module `adws/phases/orchestratorLock.ts` that exports:

- `acquireOrchestratorLock(config: WorkflowConfig): boolean` — resolves `RepoInfo` from `config.targetRepo ?? getRepoInfo()`, then delegates to `acquireIssueSpawnLock(repoInfo, config.issueNumber, process.pid)`. Returns `true` on successful acquire, `false` on contention (already held by a live process).
- `releaseOrchestratorLock(config: WorkflowConfig): void` — resolves `RepoInfo` the same way and delegates to `releaseIssueSpawnLock(repoInfo, config.issueNumber)`.

Keeping the helper in `adws/phases/` (same layer as `workflowInit.ts`) avoids a circular dependency with `adws/triggers/` and mirrors the architectural rule that orchestrator-scoped glue lives in `phases/`. The raw `acquireIssueSpawnLock` / `releaseIssueSpawnLock` primitives remain unchanged so the trigger-side call sites continue to work as-is.

Each of the twelve orchestrators in scope gets four lines of boilerplate in `main()`, placed *immediately after* `initializeWorkflow` returns and *before* the phase-execution `try` block:

```ts
if (!acquireOrchestratorLock(config)) {
  log(`Issue #${issueNumber}: spawn lock already held by another orchestrator; exiting.`, 'warn');
  process.exit(0);
}

try {
  ...existing phase code...
} catch (error) {
  handleWorkflowError(config, error, tracker.totalCostUsd, tracker.totalModelUsage);
} finally {
  releaseOrchestratorLock(config);
}
```

`adwMerge.tsx` is the one orchestrator that does not use `initializeWorkflow`; for it we call `acquireIssueSpawnLock(repoInfo, issueNumber, process.pid)` and `releaseIssueSpawnLock(repoInfo, issueNumber)` directly against the already-available `repoInfo` + `issueNumber`, using an analogous try/finally around `executeMerge`.

Rationale for the exit-on-contention default: if `acquireOrchestratorLock` returns false, some *other* orchestrator process is already doing the work. The current orchestrator has no work to perform (its `initializeWorkflow` did write a `'starting'` stage to its own `agents/<adwId>/state.json`, but that file uses this orchestrator's adwId, separate from the winner's). The fresh `'starting'` record is a cosmetic artifact that the future takeoverHandler will clean up; for this slice, the safe action is to exit 0 and let the winning orchestrator run. The PRD explicitly scopes the takeover decision tree to a separate slice (user story 9), so no additional work is done here beyond the exit.

Behavior on abnormal exit: when `handleWorkflowError`, `handleWorkflowDiscarded`, or `handleRateLimitPause` is called from the `catch` block, each calls `process.exit(…)` synchronously. Node skips `finally` blocks on `process.exit`, so the lock file stays on disk. This is by design — the issue text explicitly scopes "crash recovery relies on the staleness check" to the abnormal-exit path, and `processLiveness.isProcessLive` already reclaims a dead-PID or PID-reuse lock on the next caller's acquire.

No changes are required to `adws/triggers/webhookGatekeeper.ts`, `adws/triggers/trigger_cron.ts`, `adws/triggers/trigger_webhook.ts`, `adws/triggers/pauseQueueScanner.ts`, `adws/triggers/cronProcessGuard.ts`, or any module under `adws/github/` / `adws/core/` / `adws/vcs/`. All spawnGate module-level acceptance criteria were satisfied by issue #456; all `AgentState` schema fields needed to reason about lock-holders were added by issue #461. This slice is pure orchestrator-entrypoint wiring plus BDD coverage.

## Relevant Files

Use these files to implement the feature:

- `specs/prd/orchestrator-coordination-resilience.md` — Parent PRD. The "Modules to extend → spawnGate" section and "Shared entrypoint wiring" section specify exactly what must be wired in this slice. User stories 6 and 13 are the acceptance story for contention detection and orchestrator-lifetime lock ownership respectively.
- `adws/triggers/spawnGate.ts` — The already-complete spawn-lock module. `IssueSpawnLockRecord` (lines 8–14) contains `pid` + `pidStartedAt` per issue #456. `acquireIssueSpawnLock` (lines 52–82) performs `wx` exclusive-create, reads the existing lock on EEXIST, delegates to `processLiveness.isProcessLive` for the staleness branch, and force-reclaims a stale record. `releaseIssueSpawnLock` (lines 84–86) is a no-op if the file does not exist. No module-level changes in this slice.
- `adws/triggers/__tests__/spawnGate.test.ts` — Unit-test suite. Already covers all four acceptance-criteria cases (fresh acquire, contention with live holder, contention with dead holder, PID reuse with mismatched start-time) plus the supporting cases (concurrent wx atomicity, missing-pidStartedAt record, malformed JSON). No new tests required for the module; new tests in this slice cover the orchestrator-wiring layer only.
- `adws/core/processLiveness.ts` — The `isProcessLive(pid, recordedStartTime)` implementation spawnGate delegates to. Reference-only — no changes.
- `adws/phases/workflowInit.ts` — Defines `initializeWorkflow` and `WorkflowConfig`. The config shape (`issueNumber`, `adwId`, `targetRepo`, etc.) is the input the new helper resolves `RepoInfo` from. The existing `writeTopLevelState({ workflowStage: 'starting' })` at line 245 marks "state init complete" — the orchestrator's acquire call goes *after* `initializeWorkflow` returns to satisfy "immediately after state init" in the acceptance criteria.
- `adws/phases/workflowCompletion.ts` — Defines `handleWorkflowError` (lines 140–170), `handleRateLimitPause` (lines 69–134), and `handleWorkflowDiscarded` (lines 178–207). All three call `process.exit(…)` synchronously; the orchestrator's `finally` block intentionally does not run in these paths, so the lock is left for staleness recovery. No changes to these functions.
- `adws/github/githubApi.ts` — Exports `getRepoInfo(cwd?)` which the helper uses as the fallback when `config.targetRepo` is undefined. Reference-only.
- `adws/types/issueTypes.ts` — `TargetRepoInfo` interface (lines 193–198) — the `{ owner, repo }` shape the helper maps to `RepoInfo`. Reference-only.
- `adws/adwSdlc.tsx` — Full SDLC orchestrator; its `main()` at line 56 is the canonical reference pattern. Acquire call goes between line 70 (`initializeWorkflow` returns `config`) and line 72 (`new CostTracker()`); release goes in a `finally` wrapping the `try` at lines 74–147.
- `adws/adwPlan.tsx` — Plan-only orchestrator. Same pattern as adwSdlc, but with a single-phase `try` block at lines 49–55.
- `adws/adwPlanBuild.tsx` — Plan+Build+PR orchestrator. Same pattern as adwSdlc with the phase set at lines 55–68.
- `adws/adwPlanBuildTest.tsx` — Plan+Build+Test+PR orchestrator. Same pattern.
- `adws/adwPlanBuildReview.tsx` — Plan+Build+Review+PR orchestrator. Same pattern.
- `adws/adwPlanBuildTestReview.tsx` — Plan+Build+Test+Review+PR orchestrator. Same pattern.
- `adws/adwPlanBuildDocument.tsx` — Plan+Build+Document+PR orchestrator. Same pattern.
- `adws/adwBuild.tsx` — Build-only orchestrator. Same pattern; note the early `handleWorkflowError` call at line 58 (missing plan file) is *before* the acquire call and must remain before — if we cannot even verify the plan file, there is nothing to coordinate. (See Step-by-Step Tasks for the exact placement.)
- `adws/adwTest.tsx` — Test-only orchestrator. Same pattern.
- `adws/adwChore.tsx` — Chore pipeline with LLM diff gate. Same pattern.
- `adws/adwPatch.tsx` — Patch orchestrator. Same pattern.
- `adws/adwInit.tsx` — `adw_init` bootstrap orchestrator. Same pattern.
- `adws/adwMerge.tsx` — Merge orchestrator; does *not* use `initializeWorkflow`. `main()` at lines 202–229 computes `repoInfo: RepoInfo` at line 219; acquire goes immediately after that line, release in a `finally` wrapping `executeMerge` at line 221.
- `adws/__tests__/adwMerge.test.ts` — Existing integration test for `executeMerge`. The new acquire/release wiring is in `main()`, outside the executeMerge boundary tested here, so no updates to existing tests are required.
- `features/fix_cross_trigger_spawn_dedup.feature` — Existing BDD scenarios for issue #449's trigger-side lock. New scenarios in this slice live in a fresh feature file so the adw tag can be unambiguous; reference-only for step-definition reuse.
- `features/process_liveness_module.feature` — Existing BDD scenarios for issue #456 that already assert the spawnGate delegates to `processLiveness.isProcessLive`. Reference-only for reusable step definitions (`acquireIssueSpawnLock is called…`, `Then acquireIssueSpawnLock returns…`).
- `features/step_definitions/fixCrossTriggerSpawnDedupSteps.ts` — Shared step definitions for the `acquireIssueSpawnLock` BDD vocabulary (e.g. `a spawn lock file exists for repo … and issue …`, `acquireIssueSpawnLock returns true/false`). New scenarios reuse these steps where possible.
- `guidelines/coding_guidelines.md` — TypeScript strict mode, no `any`, pure functions with side effects at the boundaries, prefer explicit over implicit. The new helper module has no state, no mutation, and a single side-effect surface (the `spawnGate` file writes) isolated behind two thin exports. File stays under 50 lines.
- `app_docs/feature-xlv8zk-process-liveness-module.md` — Conditional docs for `processLiveness.isProcessLive` and spawnGate lock acquisition (triggered by the acquire/release call sites in this slice).
- `app_docs/feature-0cv18u-fix-cross-trigger-spawn-dedup.md` — Conditional docs for `adws/triggers/spawnGate.ts` and the `agents/spawn_locks/` directory (triggered by the orchestrator-side acquire/release).
- `app_docs/feature-guimqa-extend-top-level-state-schema.md` — Conditional docs for `AgentState.pid`, `AgentState.pidStartedAt`, `AgentState.lastSeenAt`, and `AgentState.branchName` in `adws/types/agentTypes.ts` (relevant because the lock-holder PID written by the orchestrator aligns with the PRD schema these fields support).
- `app_docs/feature-jcwqw7-extend-top-level-state-schema.md` — Same family; relevant because this slice's orchestrator-lifetime lock is the direct consumer the schema fields were added for.

### New Files

- `adws/phases/orchestratorLock.ts` — The thin helper module. Exports `acquireOrchestratorLock(config: WorkflowConfig): boolean` and `releaseOrchestratorLock(config: WorkflowConfig): void`. Internally resolves `RepoInfo` from `config.targetRepo ?? getRepoInfo()` and delegates to `acquireIssueSpawnLock` / `releaseIssueSpawnLock` from `../triggers/spawnGate`. Top-level JSDoc documents the "acquire after state init, release in finally" contract and the abnormal-exit / staleness-reclaim design.
- `features/spawngate_lifetime_extension.feature` — BDD feature file covering the twelve orchestrator wirings, the helper module surface, and the acquire-then-finally-release invariant. Tagged `@adw-463 @adw-yxo18t-orchestrator-resilie` per the repo's BDD conventions; `@regression` on the structural scenarios.
- `features/step_definitions/spawnGateLifetimeSteps.ts` — Step definitions for the feature file above. Reuses where possible the lock-acquire / release steps already defined in `fixCrossTriggerSpawnDedupSteps.ts`; adds new steps only for orchestrator-file inspection (e.g. `the orchestrator file "adws/<name>.tsx" contains "acquireOrchestratorLock(config)"`).

## Implementation Plan

### Phase 1: Foundation

Confirm the spawnGate module and its unit tests are in their post-#456 shape — `IssueSpawnLockRecord` has `pidStartedAt`, `acquireIssueSpawnLock` delegates to `processLiveness.isProcessLive`, `wx` exclusive-create is in place, and the four acceptance-criteria test cases pass. No module-level changes are needed; this step is a no-op verification. Create the helper module `adws/phases/orchestratorLock.ts` with `acquireOrchestratorLock` and `releaseOrchestratorLock`, both accepting a `WorkflowConfig` and returning `boolean` / `void` respectively. The helper resolves `RepoInfo` from `config.targetRepo` or falls back to `getRepoInfo()`, mirroring the pattern used by `webhookGatekeeper.classifyAndSpawnWorkflow`. Keep the module under 50 lines and export only the two functions.

### Phase 2: Core Implementation

Wire the acquire/release calls into each of the twelve orchestrator entrypoints. The exact edit pattern is:

1. Import `acquireOrchestratorLock`, `releaseOrchestratorLock` from `./phases/orchestratorLock` (or, for `adwMerge.tsx` which is at `adws/adwMerge.tsx`, import `acquireIssueSpawnLock`, `releaseIssueSpawnLock` from `./triggers/spawnGate` and pass the already-available `repoInfo` + `issueNumber` + `process.pid`).
2. Immediately after `initializeWorkflow` returns (or, for `adwMerge`, immediately after `repoInfo` is computed), insert:
   ```ts
   if (!acquireOrchestratorLock(config)) {
     log(`Issue #${issueNumber}: spawn lock already held by another orchestrator; exiting.`, 'warn');
     process.exit(0);
   }
   ```
3. Wrap the existing phase-execution `try/catch` in a `try/finally` so `releaseOrchestratorLock(config)` runs on normal completion:
   ```ts
   try {
     ...phases...
   } catch (error) {
     handleWorkflowError(config, error, tracker.totalCostUsd, tracker.totalModelUsage);
   } finally {
     releaseOrchestratorLock(config);
   }
   ```

`adwBuild.tsx` has a pre-try early-exit for "plan file not found" that runs before the acquire call today. That early-exit must continue to run *before* acquire — there is no coordination to do if the orchestrator cannot start at all. Move the acquire/release pair to *after* the early-exit check.

For `adwMerge.tsx`, which does not use `initializeWorkflow`, the acquire goes immediately after `repoInfo` is computed at line 219 and the release lives in a `finally` wrapping the `await executeMerge(…)` call at line 221. `main()` retains its existing early-exit on `!adwId` (line 213–216) because that check happens before `repoInfo` is constructed.

### Phase 3: Integration

Write the BDD feature file `features/spawngate_lifetime_extension.feature` that asserts:

- The helper module exists and exports the two functions.
- Each of the twelve orchestrator files imports `acquireOrchestratorLock` / `releaseOrchestratorLock` (for adwMerge: the raw `acquireIssueSpawnLock` / `releaseIssueSpawnLock`).
- Each orchestrator's `main()` contains a call to `acquireOrchestratorLock(config)` (or the adwMerge-equivalent) positioned between `initializeWorkflow` and the phase-execution try block.
- Each orchestrator's `main()` contains a `finally` block with `releaseOrchestratorLock(config)` (or the adwMerge-equivalent).
- The spawnGate lock record already carries `pidStartedAt` (regression coverage for issue #456's work, re-asserted because this slice depends on it).
- The spawnGate staleness path delegates to `processLiveness.isProcessLive` (regression coverage for issue #456, re-asserted).

Add step definitions in `features/step_definitions/spawnGateLifetimeSteps.ts`. Reuse existing steps from `fixCrossTriggerSpawnDedupSteps.ts` where possible (e.g. the `acquireIssueSpawnLock returns true/false` vocabulary). Add new steps only for orchestrator-file structural checks.

Run the full validation suite at the end: `bun run lint`, `bunx tsc --noEmit -p adws/tsconfig.json`, `bun run test:unit`, and `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-463"`.

## Step by Step Tasks
Execute every step in order, top to bottom.

### 1. Verify the post-#456 spawnGate shape
- Read `adws/triggers/spawnGate.ts` and confirm:
  - `IssueSpawnLockRecord` (lines 8–14) includes both `pid: number` and `pidStartedAt: string`.
  - `acquireIssueSpawnLock` uses `getProcessStartTime(ownPid)` at acquisition (line 56) and `isProcessLive(existing.pid, existing.pidStartedAt)` in the staleness branch (line 74).
  - `tryExclusiveCreate` uses `{ flag: 'wx' }` (line 44) and handles `EEXIST` as "lost the race" (line 47).
  - `removeSpawnLock` ignores `ENOENT` (line 38).
- Read `adws/triggers/__tests__/spawnGate.test.ts` and confirm the four acceptance-criteria test cases are present:
  - "first acquire succeeds and writes a record with pid, pidStartedAt, repoKey, issueNumber, startedAt" (fresh acquire)
  - "second acquire while first holder PID is alive returns false" (contention with live holder — defer)
  - "second acquire when first holder PID is dead reclaims stale lock and succeeds" (contention with dead holder — reclaim)
  - "PID reuse: stored pidStartedAt differs from live process start-time reclaims stale lock" (PID-reuse reclaim)
- No code edits in this step — it is a verification pass only.

### 2. Create the `orchestratorLock` helper module
- Create `adws/phases/orchestratorLock.ts` with the following exports and no other symbols:
  - Top-of-file JSDoc block explaining the contract: "Acquire immediately after state init; release in a `finally` on normal exit. Abnormal-exit handlers (`handleWorkflowError`, `handleWorkflowDiscarded`, `handleRateLimitPause`) intentionally skip the release — staleness reclaim via `processLiveness.isProcessLive` recovers the lock."
  - `import { acquireIssueSpawnLock, releaseIssueSpawnLock } from '../triggers/spawnGate';`
  - `import { getRepoInfo, type RepoInfo } from '../github';`
  - `import type { WorkflowConfig } from './workflowInit';`
  - A private helper `resolveRepoInfo(config: WorkflowConfig): RepoInfo` returning `{ owner, repo }` from `config.targetRepo` when present, else `getRepoInfo()`.
  - `export function acquireOrchestratorLock(config: WorkflowConfig): boolean` delegating to `acquireIssueSpawnLock(resolveRepoInfo(config), config.issueNumber, process.pid)`.
  - `export function releaseOrchestratorLock(config: WorkflowConfig): void` delegating to `releaseIssueSpawnLock(resolveRepoInfo(config), config.issueNumber)`.
- Run `bunx tsc --noEmit -p adws/tsconfig.json` — expect zero errors. The file must be under 50 lines including the JSDoc.

### 3. Add the helper to the phases barrel (if one exists)
- Read `adws/phases/index.ts`.
- If it already uses named re-exports (pattern matching `export { … } from './workflowInit'`), add `export { acquireOrchestratorLock, releaseOrchestratorLock } from './orchestratorLock';` to the same list so orchestrators can import from `./phases` rather than a deep path.
- If the barrel does not re-export operational helpers and orchestrators import deep paths directly (e.g. `./phases/orchestratorLock`), skip this step and use the deep-path form.

### 4. Wire acquire/release into `adws/adwSdlc.tsx`
- Add `import { acquireOrchestratorLock, releaseOrchestratorLock } from './phases/orchestratorLock';` to the existing imports.
- Also add `log` to the existing `./core` named imports (it is likely already imported — verify, do not duplicate).
- After the `const config = await initializeWorkflow(…)` call and before `const tracker = new CostTracker()`, insert:
  ```ts
  if (!acquireOrchestratorLock(config)) {
    log(`Issue #${issueNumber}: spawn lock already held by another orchestrator; exiting.`, 'warn');
    process.exit(0);
  }
  ```
- Convert the existing `try { … } catch (error) { handleWorkflowError(…) }` (lines 74–150) into `try { … } catch (error) { handleWorkflowError(…) } finally { releaseOrchestratorLock(config); }`.

### 5. Wire acquire/release into `adws/adwPlan.tsx`
- Repeat Step 4's pattern with the `adwPlan.tsx` file structure (single phase, `completeWorkflow` at end). The `try` block at lines 49–55 gains the `finally` branch.

### 6. Wire acquire/release into `adws/adwPlanBuild.tsx`
- Apply the same pattern to `main()` at lines 37–69. Acquire immediately after `initializeWorkflow`, `finally` around the try at lines 55–68.

### 7. Wire acquire/release into `adws/adwPlanBuildTest.tsx`, `adws/adwPlanBuildReview.tsx`, `adws/adwPlanBuildTestReview.tsx`, `adws/adwPlanBuildDocument.tsx`
- Each file has an identical main-function structure (`parse args → buildRepoIdentifier → initializeWorkflow → CostTracker → try { phases } catch { handleWorkflowError }`). Apply the same edit pattern to each in turn.

### 8. Wire acquire/release into `adws/adwBuild.tsx`
- Apply the Step 4 pattern, but note the pre-`try` early-exit at `adws/adwBuild.tsx:57-59` that calls `handleWorkflowError` when the plan file is missing.
- Place the `acquireOrchestratorLock` check *after* the plan-file existence check but *before* the `new CostTracker()` line. Rationale: if the plan file is missing, the orchestrator cannot run and there is no coordination to perform. The trigger's short-lived lock already covered the classify-to-spawn window; our orchestrator-lifetime lock is only meaningful once we commit to running phases.

### 9. Wire acquire/release into `adws/adwTest.tsx`, `adws/adwChore.tsx`, `adws/adwPatch.tsx`
- Each follows the standard Step 4 pattern. Apply to each in turn.

### 10. Wire acquire/release into `adws/adwInit.tsx`
- Apply the Step 4 pattern. Note: `adwInit` runs the `/adw_init` phase set for bootstrap. The acquire/release is the same shape, but the "issue number" semantic is the number passed on the command line — same as every other orchestrator.

### 11. Wire acquire/release into `adws/adwMerge.tsx`
- Add `import { acquireIssueSpawnLock, releaseIssueSpawnLock } from './triggers/spawnGate';` and `import { log } from './core';` (already imported — confirm).
- In `main()` at line 202, immediately after `const repoInfo: RepoInfo = { owner: repoId.owner, repo: repoId.repo };` at line 219, insert:
  ```ts
  if (!acquireIssueSpawnLock(repoInfo, issueNumber, process.pid)) {
    log(`Issue #${issueNumber}: spawn lock already held by another orchestrator; exiting.`, 'warn');
    process.exit(0);
  }
  ```
- Convert the existing `const result = await executeMerge(issueNumber, adwId, repoInfo, buildDefaultDeps());` pattern so the merge call runs inside a `try { … } finally { releaseIssueSpawnLock(repoInfo, issueNumber); }`. The `process.exit(result.outcome === 'abandoned' && result.reason === 'merge_failed' ? 1 : 0);` must remain reachable only on the normal-return path (i.e. after the try block, outside finally), or equivalently at the end of the try block before finally runs.

### 12. Write the BDD feature file
- Create `features/spawngate_lifetime_extension.feature` with:
  - Header tag block: `@adw-463 @adw-yxo18t-orchestrator-resilie`
  - Feature description explaining the orchestrator-lifetime lock and its relationship to the trigger-side lock.
  - `Background: Given the ADW codebase is checked out`
  - Section 1 — Helper module surface (2 scenarios, `@regression`):
    - The file `adws/phases/orchestratorLock.ts` exists.
    - The file exports `acquireOrchestratorLock` and `releaseOrchestratorLock`.
  - Section 2 — Each of the 12 orchestrators imports the helper or the raw spawnGate functions (12 scenarios, `@regression`). For each orchestrator file, assert the correct import path:
    - `adws/adwSdlc.tsx` … `adws/adwInit.tsx` import from `./phases/orchestratorLock`.
    - `adws/adwMerge.tsx` imports from `./triggers/spawnGate`.
  - Section 3 — Each orchestrator's main acquires after `initializeWorkflow` (12 scenarios, `@regression`). Use file-content assertions: for each of the 11 orchestrators that use `initializeWorkflow`, the file contains `acquireOrchestratorLock(config)` positioned *after* the `initializeWorkflow(` call and *before* the phase-execution `try`. For `adwMerge`, `acquireIssueSpawnLock(repoInfo` appears after `const repoInfo` and before `await executeMerge`.
  - Section 4 — Each orchestrator's main releases in finally (12 scenarios, `@regression`). File-content assertions: each file contains a `finally { … releaseOrchestratorLock(config);` pattern (for adwMerge: `finally { … releaseIssueSpawnLock(repoInfo, issueNumber);`).
  - Section 5 — Regression cover of the spawnGate module's PID+start-time semantics (4 scenarios, re-stating issue #456's guarantees this slice depends on):
    - Lock record includes `pidStartedAt` alongside `pid`.
    - Staleness branch calls `isProcessLive` with both recorded pid and recorded start-time.
    - `acquireIssueSpawnLock` uses the `wx` exclusive-create flag.
    - PID reuse with mismatched start-time reclaims the lock (reuses existing step from `process_liveness_module.feature` / `fixCrossTriggerSpawnDedupSteps.ts`).
  - Section 6 — Abnormal-exit behaviour (2 scenarios): the orchestrator files contain `process.exit` inside the `handleWorkflowError` path (reference-only, as a smoke check that the catch path still exits without calling release); the lock staleness reclaim is what recovers after an abnormal exit.

### 13. Add step definitions for the new BDD scenarios
- Create `features/step_definitions/spawnGateLifetimeSteps.ts`.
- Define steps that inspect file content for the wiring assertions:
  - `Given the orchestrator file {string} is read` — loads file content into shared scenario context.
  - `Then the file contains {string}` — plain substring check (only add if not already in a shared step-definitions file; otherwise import/reuse).
  - `Then {string} appears after {string} in the file` — ordering assertion.
  - `Then the file imports {string} from {string}` — already defined in shared steps; reuse via import.
- Reuse the existing steps from `fixCrossTriggerSpawnDedupSteps.ts` for the lock-acquire/release vocabulary; only add new steps for orchestrator-file inspection that are not already defined.

### 14. Run unit tests for the spawnGate module
- Run `bun run test:unit -- adws/triggers/__tests__/spawnGate.test.ts` (or `bun run test:unit` for the full suite).
- Confirm all existing spawnGate tests still pass — this slice does not change the module, but the verification catches any accidental regression introduced by import-path changes in sibling files.

### 15. Run type checks
- Run `bunx tsc --noEmit` at the root and `bunx tsc --noEmit -p adws/tsconfig.json` for the adws project.
- Both must pass with zero errors.

### 16. Run the BDD regression suite
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-463"` to execute the new scenarios.
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` to confirm no upstream regression in issue #449, #456, or #461 scenarios.

### 17. Final validation
- Run the full set of validation commands below; fix any failures before reporting complete.

## Testing Strategy
### Unit Tests

All four acceptance-criteria unit-test cases already exist in `adws/triggers/__tests__/spawnGate.test.ts` (written as part of issue #456):

- "first acquire succeeds and writes a record with pid, pidStartedAt, repoKey, issueNumber, startedAt" — fresh acquire.
- "second acquire while first holder PID is alive returns false" — contention with live holder (defer).
- "second acquire when first holder PID is dead reclaims stale lock and succeeds" — contention with dead holder (reclaim).
- "PID reuse: stored pidStartedAt differs from live process start-time reclaims stale lock" — PID-reuse reclaim.

No new unit tests for `spawnGate` are required. The new helper module `adws/phases/orchestratorLock.ts` is a thin two-line delegation per export and can be covered entirely through BDD scenarios that assert: (a) the module exports the expected symbols, (b) the callers invoke them correctly, (c) `releaseOrchestratorLock` is inside a `finally`. An isolated unit test for the two-line helper would merely restate the delegation and is not added — the wiring and the integration behaviour are what matter, and both are covered by the BDD feature file.

### Edge Cases

- **Orchestrator B spawned while orchestrator A still holds the lock.** Orchestrator B calls `acquireOrchestratorLock`, sees A's live PID + matching start-time via `processLiveness.isProcessLive`, returns false, logs, exits 0. A's state file and comments are unaffected.
- **Orchestrator A crashes (SIGKILL, OOM, panic) without running `finally`.** Lock file stays on disk with A's dead PID. Next caller (trigger, cron, or pauseQueueScanner's spawned orchestrator) sees the lock, checks liveness via `processLiveness.isProcessLive`, gets `false` (PID not alive), force-removes the stale lock, and acquires.
- **A reboot recycles the dead orchestrator's PID to an unrelated process.** `isProcessLive(recordedPid, recordedStartTime)` returns `false` because the new process's start-time differs. Force-reclaim proceeds normally. This is the exact PID-reuse scenario #456 delivered `processLiveness` to close.
- **`handleWorkflowError` called from the catch block.** `handleWorkflowError` invokes `process.exit(1)` synchronously; Node does not run the `finally` block. Lock file stays, recovered by staleness on next caller.
- **`handleRateLimitPause` called from within a phase.** Same as above — `process.exit(0)` is synchronous; `finally` does not run. `pauseQueueScanner` later spawns a fresh orchestrator for the same adwId; the fresh orchestrator sees the stale lock (old PID dead), reclaims, and proceeds.
- **`handleWorkflowDiscarded` called from within a phase.** Same as above.
- **Concurrent acquire from two orchestrators of the same issue.** The `wx` exclusive-create on `writeFileSync` guarantees exactly one caller gets `EEXIST === false`; the other gets `EEXIST === true` and loses. Both paths have deterministic branches (existing spawnGate tests cover this).
- **`config.targetRepo` undefined (running on the default repo).** `resolveRepoInfo` falls back to `getRepoInfo()` which reads git remote from the current working directory. Matches the fallback used by `webhookGatekeeper.classifyAndSpawnWorkflow`.
- **`config.issueNumber` value not a real GitHub issue.** The lock filename is deterministic (`<owner>_<repo>_issue-<n>.json`) regardless; coordination works purely on identity, not on remote-state validity. The orchestrator's phases will fail later if the issue truly does not exist, via `handleWorkflowError`.
- **adwMerge acquires with `repoInfo` built from `buildRepoIdentifier(targetRepo)`.** The `repoId` to `repoInfo` mapping already exists at `adws/adwMerge.tsx:218-219`; the acquire uses the same `repoInfo` so the lock path matches what a subsequent trigger for the same issue would compute.

## Acceptance Criteria

- [ ] `spawnGate` lock record includes `pidStartedAt` alongside `pid` (verified pre-existing from issue #456; regression-covered in `features/spawngate_lifetime_extension.feature`).
- [ ] Liveness checks against an existing lock delegate to `processLiveness.isProcessLive` (verified pre-existing from issue #456; regression-covered).
- [ ] Lock acquisition remains `writeFileSync` with `wx` exclusive-create (verified pre-existing from issue #449/#456; regression-covered).
- [ ] Stale-lock recovery is force-remove after a PID+start-time liveness check failure (verified pre-existing from issue #456; regression-covered).
- [ ] Lock is acquired by the orchestrator process itself immediately after state init — in each of `adws/adwSdlc.tsx`, `adws/adwPlan.tsx`, `adws/adwPlanBuild.tsx`, `adws/adwPlanBuildTest.tsx`, `adws/adwPlanBuildReview.tsx`, `adws/adwPlanBuildTestReview.tsx`, `adws/adwPlanBuildDocument.tsx`, `adws/adwBuild.tsx`, `adws/adwTest.tsx`, `adws/adwChore.tsx`, `adws/adwPatch.tsx`, `adws/adwInit.tsx`, `adws/adwMerge.tsx`.
- [ ] Lock release happens in `finally` on normal exit — in each of the thirteen orchestrator files above.
- [ ] Unit tests in `spawnGate.test.ts` cover: fresh acquire, contention with live holder (defer), contention with dead holder (reclaim), PID reuse with mismatched start-time (reclaim) — already present and passing.
- [ ] BDD scenarios tagged `@adw-463` pass end-to-end when executed via `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-463"`.
- [ ] `@regression` scenarios for issue #449 (spawn dedup), #456 (processLiveness), and #461 (state schema) continue to pass after this slice's changes.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — ESLint across the repo; must pass with zero errors.
- `bunx tsc --noEmit` — Root TypeScript type-check; must pass with zero errors.
- `bunx tsc --noEmit -p adws/tsconfig.json` — `adws/` TypeScript type-check; must pass with zero errors.
- `bun run test:unit` — Vitest unit-test suite (covers `spawnGate.test.ts` among others); must pass with zero failures.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-463"` — New scenarios for this slice; must pass with zero failures.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — Full regression suite; must pass with zero failures (confirms no upstream break in #449/#456/#461 scenarios).

## Notes

- **Coding guidelines adherence.** Strict TypeScript mode, no `any`, interfaces for data shapes, pure helper function with side effects isolated behind two exports. The helper module stays under 50 lines and has no state, matching the "small, focused, composable" guideline.
- **Scope discipline.** This slice is exactly the PRD's "spawnGate" extension and the lock-wiring half of "Shared entrypoint wiring". Heartbeat, takeoverHandler, remoteReconcile, worktreeReset, and hungOrchestratorDetector are explicit non-goals. The shared-wrapper refactor (PRD user story 14) is also deferred — this slice uses inline wiring per orchestrator. A future refactor can consolidate the acquire/release + heartbeat start/stop + completion handlers into a single `runOrchestrator` helper once heartbeat lands.
- **No webhookGatekeeper changes.** The trigger-side lock from issue #449 is unchanged and remains the short-term classify-to-spawn dedup. The orchestrator-side lock added here is a second, longer-lived layer over the same file path. The brief window between trigger-release and orchestrator-acquire is acceptable; if a second trigger sneaks into that window, its spawned orchestrator will race the first and exactly one will win the acquire.
- **Cosmetic artifact on contention loss.** If `acquireOrchestratorLock` returns false, the orchestrator's own `agents/<adwId>/state.json` already carries `workflowStage: 'starting'` (written by `initializeWorkflow`) and its `'starting'` comment has been posted to the issue. Cleaning this up is explicitly a later-slice concern (takeoverHandler / hungOrchestratorDetector per PRD user stories 9 and 16). For this slice, the orchestrator logs a clear message and exits 0; operators can distinguish via the ADW log message pattern.
- **Library install command.** No new libraries are introduced. The helper module depends only on already-imported primitives (`spawnGate`, `github.getRepoInfo`, `workflowInit`'s `WorkflowConfig` type).
- **PR scope suggestion.** Because the wiring touches thirteen orchestrator files with an identical pattern, a single bundled PR is preferable to splitting per-orchestrator — the change is mechanical and reviewers can scan the diff as one unit.
