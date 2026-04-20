# Feature: Shared Orchestrator Lifecycle Wrapper for 12 Orchestrators

## Metadata
issueNumber: `464`
adwId: `6wnymj-orchestrator-resilie`
issueJson: `{"number":464,"title":"orchestrator-resilience: shared lifecycle wrapper for 12 orchestrators","body":"## Parent PRD\n\n`specs/prd/orchestrator-coordination-resilience.md`\n\n## What to build\n\nRoll the lifecycle (spawn-gate lock acquire, heartbeat start, heartbeat stop, lock release) out to all twelve orchestrators via a single shared wrapper at the phase-runner or entrypoint layer, so no orchestrator hand-rolls this boilerplate. See \"Shared entrypoint wiring\" in the PRD.\n\nOrchestrators in scope: `adwSdlc`, `adwMerge`, `adwChore`, `adwBuild`, `adwInit`, `adwPatch`, `adwPlan`, `adwPlanBuild`, `adwPlanBuildDocument`, `adwPlanBuildReview`, `adwPlanBuildTest`, `adwPlanBuildTestReview`, `adwTest`.\n\n## Acceptance criteria\n\n- [ ] A single shared wrapper (in `adws/core/phaseRunner.ts` or a new `adws/core/orchestratorLifecycle.ts`) encapsulates lock-acquire, heartbeat-start, heartbeat-stop, lock-release\n- [ ] All twelve orchestrators adopt the wrapper — no hand-rolled `startHeartbeat` / `acquireIssueSpawnLock` calls remain in entrypoints\n- [ ] `adwSdlc`'s tracer wiring from slice #6 is replaced by the wrapper usage\n- [ ] Wrapper handles cleanup on both normal exit and exception paths (`finally`)\n- [ ] Unit test asserts the wrapper's call order: state-init → lock-acquire → heartbeat-start → phases → heartbeat-stop → lock-release\n- [ ] Regression check: each orchestrator still runs end-to-end against a fixture issue\n\n## Blocked by\n\n- Blocked by #462\n- Blocked by #463\n\n## User stories addressed\n\n- User story 13\n- User story 14","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-04-20T11:05:30Z","comments":[{"author":"paysdoc","createdAt":"2026-04-20T21:23:44Z","body":"## Take action"}],"actionableComment":null}`

## Feature Description

Unify the orchestrator startup/shutdown boilerplate — spawn-gate lock acquire, heartbeat start, heartbeat stop, lock release — behind a single shared wrapper so every orchestrator entrypoint goes through the same contract. Today the thirteen orchestrator files sit in three divergent patterns:

1. **Wrapper-using (9)** — `adwSdlc`, `adwBuild`, `adwPlan`, `adwPlanBuild`, `adwPlanBuildDocument`, `adwPlanBuildReview`, `adwPlanBuildTest`, `adwPlanBuildTestReview` already call `runWithOrchestratorLifecycle(config, async () => { ... })` which wraps lock+heartbeat around the phase body.
2. **Manual acquire/release (3)** — `adwChore`, `adwInit`, `adwPatch` hand-roll `acquireOrchestratorLock` → try/catch/finally → `releaseOrchestratorLock` and **do not start a heartbeat at all**. These are silent to the hung-orchestrator detector introduced by PRD slices #6 and #7.
3. **Raw primitives (1)** — `adwMerge` calls `acquireIssueSpawnLock` / `releaseIssueSpawnLock` directly (it does not use `WorkflowConfig`) and also runs without a heartbeat.

There is also an outright bug: `adwTest` imports `runWithOrchestratorLifecycle` but the body calls `acquireOrchestratorLock` / `releaseOrchestratorLock` (unimported), which would fail to typecheck — symptomatic of the drift this feature exists to eliminate.

The shared helpers `runWithOrchestratorLifecycle` (for `WorkflowConfig`-typed callers) and `runWithRawOrchestratorLifecycle` (for `adwMerge`) already exist in `adws/phases/orchestratorLock.ts` from slice #7. This feature is a rollout of those helpers to the four remaining orchestrators plus a test that pins the lifecycle call order so no future drift can erase the work.

## User Story

As an ADW developer,
I want each entrypoint orchestrator to get lock acquisition, heartbeat start, and cleanup wiring via a shared wrapper,
So that I don't have to replicate lifecycle boilerplate in 12 places (PRD User story 14), and the coordination lock is held by the orchestrator process itself for its full lifetime (PRD User story 13).

## Problem Statement

Thirteen orchestrator entrypoints each implement startup/shutdown differently. Three variants have accumulated:

- **Heartbeat coverage gap**: `adwChore`, `adwInit`, `adwPatch`, `adwMerge` do not start a heartbeat. The hung-orchestrator detector (slice #6) cannot detect a wedged `*_running` workflow for these four orchestrators, because `lastSeenAt` is never updated while they run.
- **Drift and bug surface**: `adwTest` imports `runWithOrchestratorLifecycle` but calls `acquireOrchestratorLock` / `releaseOrchestratorLock` (not imported) — a latent build break.
- **Boilerplate duplication**: Every orchestrator repeats the same `if (!acquired) { log; process.exit(0); }` branch, the same try/catch/finally shape, and the same "pass WorkflowConfig to lifecycle helper" dance.
- **No pinned contract**: the call order (state-init → lock-acquire → heartbeat-start → phases → heartbeat-stop → lock-release) lives in a comment on `runWithOrchestratorLifecycle` but has no test pinning it. Nothing stops a future refactor from inverting lock and heartbeat in a way that would unlock the issue before the hung detector would know the orchestrator had finished.

## Solution Statement

1. **Keep the existing helpers** (`runWithOrchestratorLifecycle`, `runWithRawOrchestratorLifecycle`) in `adws/phases/orchestratorLock.ts`. They already implement the correct lock → heartbeat → fn → heartbeat-stop → lock-release order with `finally` cleanup. Adding a new module would be churn, not progress.
2. **Migrate the four remaining orchestrators** — `adwChore`, `adwInit`, `adwPatch`, `adwMerge` — to use the wrapper helpers. For `adwChore`, `adwInit`, and `adwPatch` this means replacing the `acquireOrchestratorLock` / `releaseOrchestratorLock` + try/finally dance with the `await runWithOrchestratorLifecycle(config, async () => { ... })` shape. For `adwMerge` this means replacing the raw `acquireIssueSpawnLock` / `releaseIssueSpawnLock` pair with `runWithRawOrchestratorLifecycle`.
3. **Fix the `adwTest` import drift** as part of the migration (it is already calling the wrong names).
4. **Pin the contract with a unit test** in `adws/phases/__tests__/orchestratorLock.test.ts` that asserts the exact call order and `finally`-path semantics using injected dependencies. The test is the acceptance-criterion guardrail (PRD user story 13 requires the lock to cover the full orchestrator lifetime; the test enforces that the lock is released AFTER the heartbeat stops and the user fn completes, regardless of throw/normal-return).

This keeps the feature narrow — no new module, no API change — while closing the heartbeat coverage gap for four orchestrators and eliminating drift across the remaining entrypoints.

## Relevant Files

Use these files to implement the feature:

### Existing files to modify

- `adws/adwChore.tsx` — migrate from manual `acquireOrchestratorLock` / `releaseOrchestratorLock` pair to `runWithOrchestratorLifecycle`. Body moves inside the wrapper's async closure; lock check becomes `if (!await runWithOrchestratorLifecycle(...)) { log; process.exit(0); }`.
- `adws/adwInit.tsx` — same migration as `adwChore`.
- `adws/adwPatch.tsx` — same migration as `adwChore`.
- `adws/adwMerge.tsx` — migrate from raw `acquireIssueSpawnLock` / `releaseIssueSpawnLock` to `runWithRawOrchestratorLifecycle`. Gains heartbeat coverage for the merge lifetime.
- `adws/adwTest.tsx` — fix the import bug by completing the migration (body already uses wrapper-like shape; just import the correct name and switch to `runWithOrchestratorLifecycle`).
- `adws/phases/orchestratorLock.ts` — no code change expected; small comment update may be needed to reflect that all thirteen orchestrators now use the wrapper.

### Files touched only if verification requires it

- `adws/adwSdlc.tsx`, `adws/adwBuild.tsx`, `adws/adwPlan.tsx`, `adws/adwPlanBuild.tsx`, `adws/adwPlanBuildDocument.tsx`, `adws/adwPlanBuildReview.tsx`, `adws/adwPlanBuildTest.tsx`, `adws/adwPlanBuildTestReview.tsx` — already use `runWithOrchestratorLifecycle`. Read-only; no changes expected unless a consistency issue surfaces during the test-writing step (e.g., the `handleWorkflowError` inside the wrapper calls `process.exit` synchronously, which skips the `finally`; comment alignment may be warranted but is not in scope).

### Support files (read-only)

- `adws/phases/orchestratorLock.ts` — contains `runWithOrchestratorLifecycle` and `runWithRawOrchestratorLifecycle`. Call order encoded here (lines 46–61 and 67–84).
- `adws/core/heartbeat.ts` — `startHeartbeat(adwId, intervalMs)` returns `HeartbeatHandle`; `stopHeartbeat(handle)` is idempotent.
- `adws/triggers/spawnGate.ts` — `acquireIssueSpawnLock(repoInfo, issueNumber, pid) → boolean` and `releaseIssueSpawnLock`.
- `adws/core/config.ts` — `HEARTBEAT_TICK_INTERVAL_MS = 30_000` constant consumed by the wrapper.
- `adws/phases/workflowInit.ts` — `initializeWorkflow` returning `WorkflowConfig`; invoked before the wrapper in every orchestrator (establishes the "state-init → lock-acquire" sequencing pinned by the test).
- `adws/core/__tests__/heartbeat.test.ts` — contract test precedent for vitest + fake timers + `AgentStateManager.writeTopLevelState` assertions.
- `adws/triggers/__tests__/spawnGate.test.ts` — precedent for mocking `AGENTS_STATE_DIR` into a tmpdir and injecting `processLiveness` stubs.
- `adws/phases/index.ts` — already re-exports `runWithOrchestratorLifecycle` and `runWithRawOrchestratorLifecycle` via the phases barrel.
- `specs/prd/orchestrator-coordination-resilience.md` — parent PRD, section "Shared entrypoint wiring" (lines 81–83) and user stories 13–14 (lines 50–51).

### Conditional documentation

Per `.adw/conditional_docs.md`, the following docs apply:

- `app_docs/feature-yxo18t-spawngate-lifetime-pid-liveness.md` — covers `acquireOrchestratorLock` / `releaseOrchestratorLock` and the full-lifetime spawn lock wiring, including that `adwMerge` uses the raw spawnGate primitives.
- `app_docs/feature-zy5s32-heartbeat-module-tracer-integration.md` — covers `startHeartbeat` / `stopHeartbeat` and the PRD slice that wires heartbeat lifecycle into additional orchestrators beyond `adwSdlc` (this feature is that slice).
- `app_docs/feature-xlv8zk-process-liveness-module.md` — covers the PID-reuse-safe liveness used by `spawnGate`; relevant because the wrapper is what ensures the lock is held for the full lifetime the liveness check relies on.
- `app_docs/feature-guimqa-extend-top-level-state-schema.md` and `app_docs/feature-jcwqw7-extend-top-level-state-schema.md` — cover the `lastSeenAt` / `pid` / `pidStartedAt` fields the heartbeat writes.

### New Files

- `adws/phases/__tests__/orchestratorLock.test.ts` — new vitest unit test that asserts the exact lifecycle call order and `finally`-path semantics using injected doubles for `acquireIssueSpawnLock`, `releaseIssueSpawnLock`, `startHeartbeat`, `stopHeartbeat`. Covers the wrapper's happy path (fn resolves) and throw path (fn rejects). No production code in a new file.

## Implementation Plan

### Phase 1: Foundation

Pin the contract that the rollout depends on.

- Author the unit test for `runWithOrchestratorLifecycle` and `runWithRawOrchestratorLifecycle` first. Tests drive confidence that subsequent rollout migrations preserve semantics. The test injects doubles for `acquireIssueSpawnLock`, `releaseIssueSpawnLock`, `startHeartbeat`, `stopHeartbeat` (via `vi.mock` of the module paths, following the `spawnGate.test.ts` pattern), then records call order into an array to assert it matches `['acquire', 'startHeartbeat', 'fn', 'stopHeartbeat', 'release']`.
- Cover four scenarios for each of the two wrappers: (a) lock-not-acquired returns false and does not start heartbeat, (b) fn resolves and call order is as above, (c) fn throws and release+stop still happen before the wrapper rejects with the original error, (d) state-init completes before lock-acquire (asserted implicitly via the fact that the wrapper receives a fully-populated `WorkflowConfig`).

### Phase 2: Core Implementation

Migrate the four non-conforming orchestrators to the wrapper.

- `adwChore.tsx`: swap the bare `acquireOrchestratorLock` + try/catch/finally + `releaseOrchestratorLock` for `await runWithOrchestratorLifecycle(config, async () => { ... body ... })`; move the `log` + `process.exit(0)` into the `if (!await …)` branch the other orchestrators already use. Update the `phases/orchestratorLock` import to bring in `runWithOrchestratorLifecycle` and drop the now-unused `acquireOrchestratorLock` / `releaseOrchestratorLock` names.
- `adwInit.tsx`: identical migration shape to `adwChore`. Note that `adwInit` uses its own running `totalCostUsd` / `totalModelUsage` accumulators (not `CostTracker`), so the wrapper's body just needs to wrap the existing `try { … } catch (error) { handleWorkflowError(…) }` block.
- `adwPatch.tsx`: identical migration shape to `adwChore`. Uses `CostTracker` like the other wrapper-using orchestrators.
- `adwMerge.tsx`: replace the raw `acquireIssueSpawnLock(repoInfo, issueNumber, process.pid)` / `releaseIssueSpawnLock(repoInfo, issueNumber)` pair with `await runWithRawOrchestratorLifecycle(repoInfo, issueNumber, adwId, async () => { result = await executeMerge(…) })`. The wrapper returns `false` on contention — in that case replicate the existing behavior (log + `process.exit(0)`). Preserve the final `process.exit(result.outcome === 'abandoned' && result.reason === 'merge_failed' ? 1 : 0)` contract by tracking `result` in the enclosing scope. Gain: heartbeat coverage for merge lifetime (this is the first time `adwMerge` gets a heartbeat).
- `adwTest.tsx`: the file already calls `acquireOrchestratorLock` / `releaseOrchestratorLock` but imports `runWithOrchestratorLifecycle`. Complete the migration: restructure the body to use the wrapper, matching the shape of `adwPlan.tsx` / `adwBuild.tsx`. This is the smallest migration — effectively a cleanup of an incomplete earlier slice.

### Phase 3: Integration

Verify no regression across all thirteen orchestrators and the test battery.

- Run `bun run test:unit` to confirm the new orchestratorLock test passes and no existing test regressed (especially the spawnGate, heartbeat, processLiveness, and phaseRunner suites, which the wrapper depends on).
- Run `bunx tsc --noEmit -p adws/tsconfig.json` to catch the `adwTest` import drift and any other typing slip introduced by the migrations.
- Run `bun run lint` for style consistency.
- Grep the codebase for stranded `acquireOrchestratorLock` / `releaseOrchestratorLock` / `acquireIssueSpawnLock` / `releaseIssueSpawnLock` direct calls inside `adws/adw*.tsx` — this should return zero hits (the functions are still used inside the wrapper helpers, but no entrypoint should call them directly). This grep is the "single shared wrapper" acceptance criterion in automated form.
- Regression check (per the issue acceptance criteria): each orchestrator's `main()` is invoked against a fixture issue (number 9999) with phases stubbed via the BDD scenarios in `features/shared_orchestrator_lifecycle_wrapper.feature` section 9, asserting the wrapper acquires the lock, starts the heartbeat, runs the stubbed body, stops the heartbeat, and releases the lock. These scenarios plus the type-check + full unit-test run + migration diff review constitute the full regression gate.

## Step by Step Tasks

Execute every step in order, top to bottom.

### Step 1: Read and confirm the current state of the shared helpers

- Open `adws/phases/orchestratorLock.ts` and confirm the public surface: `acquireOrchestratorLock`, `releaseOrchestratorLock`, `runWithOrchestratorLifecycle`, `runWithRawOrchestratorLifecycle`. No code changes in this file.
- Open `adws/phases/index.ts` and confirm all four names are re-exported (they are, line 49).
- Open `adws/core/heartbeat.ts` and confirm the `HeartbeatHandle` shape and the `startHeartbeat` / `stopHeartbeat` signatures the test will mock.

### Step 2: Write the orchestratorLock unit test

- Create `adws/phases/__tests__/orchestratorLock.test.ts`.
- Use `vi.mock('../../triggers/spawnGate', () => ({ acquireIssueSpawnLock: vi.fn(), releaseIssueSpawnLock: vi.fn() }))` and `vi.mock('../../core/heartbeat', () => ({ startHeartbeat: vi.fn(), stopHeartbeat: vi.fn() }))`. Also mock `../../github/githubApi` to stub `getRepoInfo` returning a fixed `RepoInfo`.
- In each test, push a label into a shared `calls: string[]` array from each mock to record the observable order.
- Tests to include:
  - `runWithOrchestratorLifecycle`:
    1. `returns false and does not start heartbeat when acquireIssueSpawnLock returns false` — assert `calls` is exactly `['acquire']` and `startHeartbeat` was never called.
    2. `invokes start/stop heartbeat and release in order when fn resolves` — assert `calls` is exactly `['acquire', 'startHeartbeat', 'fn', 'stopHeartbeat', 'release']` and the wrapper returns `true`.
    3. `still stops heartbeat and releases lock when fn throws` — call order must still be `['acquire', 'startHeartbeat', 'fn', 'stopHeartbeat', 'release']`; the thrown error propagates out of the wrapper.
    4. `passes config.issueNumber and process.pid to acquireIssueSpawnLock, and config.adwId to startHeartbeat` — spot check to ensure argument wiring is not silently broken by refactors.
  - `runWithRawOrchestratorLifecycle` (the `adwMerge` path):
    1. `returns false and does not start heartbeat when acquireIssueSpawnLock returns false`.
    2. `invokes start/stop heartbeat and release in order when fn resolves`.
    3. `still stops heartbeat and releases lock when fn throws`.
- Use minimal fake `WorkflowConfig` (only the fields the wrapper reads: `issueNumber`, `adwId`, `targetRepo`). Follow `adws/__tests__/adwMerge.test.ts` style for "small enough fake config object."
- The test file uses vitest imports from `vitest` and lives at `adws/phases/__tests__/orchestratorLock.test.ts` — first vitest file in `adws/phases/__tests__/` alongside the existing `scenarioTestPhase.test.ts`.

### Step 3: Migrate `adwChore.tsx`

- Replace the import `import { acquireOrchestratorLock, releaseOrchestratorLock } from './phases/orchestratorLock';` with `import { runWithOrchestratorLifecycle } from './phases/orchestratorLock';`.
- Replace the bare `if (!acquireOrchestratorLock(config)) { log(...); process.exit(0); }` + subsequent try/catch/finally block with:
  ```ts
  if (!await runWithOrchestratorLifecycle(config, async () => {
    const tracker = new CostTracker();
    try {
      // existing phase body unchanged
    } catch (error) {
      handleWorkflowError(config, error, tracker.totalCostUsd, tracker.totalModelUsage);
    }
  })) {
    log(`Issue #${issueNumber}: spawn lock already held by another orchestrator; exiting.`, 'warn');
    process.exit(0);
  }
  ```
- The tracker and phase body are identical to today; only the outer scaffolding changes. Remove the `finally { releaseOrchestratorLock(config); }` since the wrapper owns release.
- Confirm the function signature of `main()` remains `async function main(): Promise<void>`.

### Step 4: Migrate `adwInit.tsx`

- Replace the import: swap `acquireOrchestratorLock, releaseOrchestratorLock` for `runWithOrchestratorLifecycle`.
- Wrap the existing try/catch body (which uses local `totalCostUsd` and `totalModelUsage` rather than `CostTracker`) inside the `await runWithOrchestratorLifecycle(config, async () => { ... })` closure. Keep the inner `try { ... } catch (error) { handleWorkflowError(...) }` exactly as today; move it inside the closure.
- Remove the `finally { releaseOrchestratorLock(config); }` since the wrapper owns release.
- Add the post-wrapper `if (!await …) { log; process.exit(0); }` branch to mirror the other orchestrators.

### Step 5: Migrate `adwPatch.tsx`

- Replace the import: swap `acquireOrchestratorLock, releaseOrchestratorLock` for `runWithOrchestratorLifecycle`.
- Move the `tracker` instantiation and the try/catch body inside `await runWithOrchestratorLifecycle(config, async () => { ... })`.
- Remove the `finally { releaseOrchestratorLock(config); }`.
- Preserve the pre-wrapper `executePatchPhase` helper function (file-local) unchanged.

### Step 6: Migrate `adwMerge.tsx`

- Replace `import { acquireIssueSpawnLock, releaseIssueSpawnLock } from './triggers/spawnGate';` with `import { runWithRawOrchestratorLifecycle } from './phases/orchestratorLock';`.
- In `main()`, replace the `if (!acquireIssueSpawnLock(repoInfo, issueNumber, process.pid))` block and the subsequent try/finally with:
  ```ts
  let result: Awaited<ReturnType<typeof executeMerge>> | undefined;
  const acquired = await runWithRawOrchestratorLifecycle(repoInfo, issueNumber, adwId, async () => {
    result = await executeMerge(issueNumber, adwId, repoInfo, buildDefaultDeps());
  });
  if (!acquired) {
    log(`Issue #${issueNumber}: spawn lock already held by another orchestrator; exiting.`, 'warn');
    process.exit(0);
  }
  if (!result) {
    // Defensive: acquired but executeMerge never assigned. Should be unreachable.
    process.exit(1);
  }
  process.exit(result.outcome === 'abandoned' && result.reason === 'merge_failed' ? 1 : 0);
  ```
- Preserve the `buildDefaultDeps()` helper and the `if (import.meta.url === `file://${process.argv[1]}`) { main(); }` guard.
- Preserve the existing test surface (`executeMerge`, `MergeDeps`, `MergeRunResult`) untouched — the wrapper migration is strictly in `main()`.

### Step 7: Fix `adwTest.tsx`

- Ensure the import line is `import { runWithOrchestratorLifecycle } from './phases/orchestratorLock';` (it is).
- Replace the `if (!acquireOrchestratorLock(config)) { log(...); process.exit(0); }` + try/catch/finally block with the wrapper form matching `adwBuild.tsx` / `adwPlan.tsx`. The body's `executeUnitTestPhase` and `completeWorkflow` calls move inside the wrapper closure unchanged.
- Remove the dangling `releaseOrchestratorLock(config)` call in `finally`.

### Step 8: Grep-verify the rollout

- Run (via the Grep tool, not Bash): `pattern: "acquireOrchestratorLock|releaseOrchestratorLock|acquireIssueSpawnLock|releaseIssueSpawnLock"`, `glob: "adws/adw*.tsx"`. Expect zero matches in the thirteen entrypoint files. The wrapper file `adws/phases/orchestratorLock.ts` continues to call `acquireIssueSpawnLock` / `releaseIssueSpawnLock` internally (by design).
- Double-check that `adws/phases/orchestratorLock.ts` and `adws/phases/index.ts` still export `acquireOrchestratorLock` and `releaseOrchestratorLock` — the rollout removes the entrypoint callers but does NOT remove the helpers, because the deferred-tool `webhookGatekeeper.ts` or other modules may still consume them. (Grep confirms `webhookGatekeeper.ts` uses `acquireIssueSpawnLock`/`releaseIssueSpawnLock` directly from `spawnGate`, not from `orchestratorLock`, so `acquireOrchestratorLock` / `releaseOrchestratorLock` are only entrypoint-surface today. Still: prefer leaving them exported to avoid breaking anything downstream; they are cheap.)

### Step 9: Run the validation commands

- Run `bun run lint` — must pass with no new warnings/errors.
- Run `bunx tsc --noEmit` and `bunx tsc --noEmit -p adws/tsconfig.json` — both must pass with no new errors. This catches the `adwTest.tsx` drift.
- Run `bun run test:unit` — all tests must pass, including the new `orchestratorLock.test.ts`.
- Run `bun run build` — must produce no errors.

### Step 10: Regression spot-check (per acceptance criterion)

- For each of the thirteen orchestrators, open the file and confirm:
  - The file imports either `runWithOrchestratorLifecycle` (twelve) or `runWithRawOrchestratorLifecycle` (`adwMerge` only) from `./phases/orchestratorLock`.
  - The file does NOT import `acquireOrchestratorLock`, `releaseOrchestratorLock`, `acquireIssueSpawnLock`, or `releaseIssueSpawnLock` directly.
  - The phase body is wrapped in the lifecycle helper; the `finally { releaseOrchestratorLock(...) }` shape is gone.
  - The file uses `log(...)` + `process.exit(0)` on the `!await …` branch.

## Testing Strategy

### Unit Tests

Per `.adw/project.md` `## Unit Tests: enabled`, unit tests are in scope for this feature.

The primary new test file is `adws/phases/__tests__/orchestratorLock.test.ts`, covering the two wrapper helpers (`runWithOrchestratorLifecycle` and `runWithRawOrchestratorLifecycle`) with the following cases:

- **Happy path — wrapper returns true, fn resolves**: records calls in order `['acquire', 'startHeartbeat', 'fn', 'stopHeartbeat', 'release']`. Also checks the argument wiring: `acquireIssueSpawnLock` receives the resolved `RepoInfo`, the issue number, and `process.pid`; `startHeartbeat` receives `adwId` and `HEARTBEAT_TICK_INTERVAL_MS`; `stopHeartbeat` receives the handle `startHeartbeat` returned.
- **Contended path — acquire returns false**: wrapper returns `false`, `startHeartbeat` is not called, fn is not called, `stopHeartbeat`/`releaseIssueSpawnLock` are not called.
- **Throw path — fn rejects**: wrapper's `finally` block still runs, so order is `['acquire', 'startHeartbeat', 'fn', 'stopHeartbeat', 'release']` and the thrown error propagates out of the wrapper as an unhandled rejection (or is caught by the caller — the current implementation rethrows).
- **`runWithRawOrchestratorLifecycle` parity**: same three scenarios, with `repoInfo/issueNumber/adwId` passed positionally instead of extracted from `WorkflowConfig`.

Implementation notes for the test:
- Follow `adws/triggers/__tests__/spawnGate.test.ts` for `vi.mock` plumbing.
- Use `vi.fn()` for `acquireIssueSpawnLock`, `releaseIssueSpawnLock`, `startHeartbeat`, `stopHeartbeat`, with default return values adjusted per test (`acquireIssueSpawnLock.mockReturnValue(true/false)`).
- Build a tiny fake `WorkflowConfig` matching the fields `resolveRepoInfo`, `acquireIssueSpawnLock`, and `startHeartbeat` read: `{ issueNumber: 42, adwId: 'test-adw-id', targetRepo: { owner: 'acme', repo: 'widgets' } }`.
- Use a shared `calls: string[]` array for ordering assertions.

### Edge Cases

- **Wrapper's `fn` calls `process.exit`** (via `handleWorkflowError`, `handleWorkflowDiscarded`, `handleRateLimitPause`): the `finally` block does NOT run — documented behavior (see the comment block at top of `orchestratorLock.ts`). The lock file remains on disk and the next caller reclaims it via `processLiveness.isProcessLive`. No test change needed; this is the documented contract.
- **Wrapper's `fn` throws synchronously before any await**: still caught by `try/finally`; release + stop still run. Covered by the throw-path test.
- **`adwMerge` contention**: `runWithRawOrchestratorLifecycle` returns `false`; `result` stays `undefined`; explicit guard exits with code 0 (contention is not a failure).
- **`adwMerge` normal exit code**: `result.outcome === 'abandoned' && result.reason === 'merge_failed'` returns exit code 1; all other outcomes return 0. Preserved unchanged.
- **`adwInit` uses raw `totalCostUsd` / `totalModelUsage` not CostTracker**: the wrapper is agnostic to what the fn does; migration just wraps the existing try/catch.
- **`adwChore` uses `AgentStateManager.writeTopLevelState(config.adwId, { workflowStage: 'awaiting_merge' })` inside the try**: same pattern as `adwSdlc`. Moves inside the wrapper closure unchanged.
- **Late-import cycle**: the wrapper imports from `../triggers/spawnGate` and `../core/heartbeat` statically. `spawnGate` in turn imports from `../github/githubApi` (for `RepoInfo` type) and `../core/processLiveness`. No new import cycles introduced.
- **`adwTest` bug manifests as a type error today**: the migration fixes it; once the file is renumbered, `bunx tsc` stops erroring. Catch this via Step 9's type-check gate.

## Acceptance Criteria

- [ ] A single shared wrapper at `adws/phases/orchestratorLock.ts` — `runWithOrchestratorLifecycle` (for `WorkflowConfig` callers) and `runWithRawOrchestratorLifecycle` (for `adwMerge`) — encapsulates lock-acquire, heartbeat-start, heartbeat-stop, lock-release. (This file exists and satisfies the criterion; no new helper is created.)
- [ ] All thirteen orchestrators in scope use the wrapper. Grep of `adws/adw*.tsx` for `acquireOrchestratorLock`, `releaseOrchestratorLock`, `acquireIssueSpawnLock`, `releaseIssueSpawnLock` returns zero matches in entrypoint `main()` bodies.
- [ ] `adwSdlc`'s wiring is via `runWithOrchestratorLifecycle` (already true as of slice #6; this feature just verifies).
- [ ] Wrapper handles cleanup on both normal exit and exception paths via `finally` — pinned by the new unit test.
- [ ] `adws/phases/__tests__/orchestratorLock.test.ts` asserts the wrapper's call order: `['acquire', 'startHeartbeat', 'fn', 'stopHeartbeat', 'release']`, for both wrapper variants, in both happy and throw paths.
- [ ] `adwChore`, `adwInit`, `adwPatch`, `adwMerge` gain heartbeat coverage — verified indirectly by the test that `startHeartbeat` is called inside both wrapper variants (and by the migration diff itself).
- [ ] `adwTest.tsx` import drift is fixed (type check passes).
- [ ] All validation commands pass.

## Validation Commands

Execute every command to validate the feature works correctly with zero regressions. (Sourced from `.adw/commands.md`.)

- `bun run lint` — run linter to check for code quality issues. Must pass with zero new warnings/errors.
- `bunx tsc --noEmit` — root TypeScript type-check. Must pass.
- `bunx tsc --noEmit -p adws/tsconfig.json` — `adws/` scoped type-check. Must pass. This is the check that catches the existing `adwTest.tsx` import bug.
- `bun run test:unit` — run the vitest unit test suite. All existing tests must pass; the new `orchestratorLock.test.ts` must pass.
- `bun run build` — build to verify no build errors.
- Use the Grep tool to confirm zero entrypoint-level direct calls to the lock primitives:
  - `pattern: "acquireOrchestratorLock|releaseOrchestratorLock|acquireIssueSpawnLock|releaseIssueSpawnLock"`, `glob: "adws/adw*.tsx"` — expect zero matches.
- Use the Grep tool to confirm every orchestrator imports the wrapper:
  - `pattern: "runWithOrchestratorLifecycle|runWithRawOrchestratorLifecycle"`, `glob: "adws/adw*.tsx"` — expect a match in each of the thirteen orchestrator files listed in the issue.

## Notes

- No new library is required. All dependencies (`vitest`, `vi.mock`, `vi.fn`) are already present — verified by the existing `adws/core/__tests__/heartbeat.test.ts` and `adws/triggers/__tests__/spawnGate.test.ts`.
- Per the `## Library Install Command` in `.adw/commands.md`, any future additions would use `bun add <package>` — not expected for this feature.
- The `runWithOrchestratorLifecycle` helper was introduced by slice #7 (`feature-yxo18t-spawngate-lifetime-pid-liveness.md`) and `runWithRawOrchestratorLifecycle` was added alongside for the `adwMerge` path. This issue (slice #8 per PRD) completes the rollout.
- PRD user stories 13 and 14 are the direct motivators: story 13 ("the coordination lock is held by the orchestrator process itself for its full lifetime") is satisfied because the wrapper owns acquire/release around the entire fn body; story 14 ("gain lock acquisition, heartbeat start, and cleanup wiring via a shared wrapper, so that I don't have to replicate lifecycle boilerplate in 12 places") is the primary deliverable.
- The `adwMerge` migration gains heartbeat coverage for the first time. This is a behavior change — the merge orchestrator's stage (`awaiting_merge → completed` or similar) will now get `lastSeenAt` ticks while the merge runs. The hung-orchestrator detector treats all `*_running`-shaped stages as candidates for staleness checks, and `awaiting_merge` is not a `*_running` stage, so no spurious hung detection is expected. If this proves a concern, the followup is to gate the heartbeat's stale-detection list, not to withhold heartbeats from `adwMerge`.
- `adwPrReview`, `adwClearComments`, and `adwDocument` are explicitly out of scope per the PRD (section "Out of Scope", lines 134–138). They remain as-is. The thirteen files in scope are exactly those listed in the issue body.
- Decorators are not used (consistent with the project's "keep it simple" convention).
- Per `.adw/project.md`, the `Application Type` is `cli` — no UI/dev-server verification is possible or required for this feature.
- If a `guidelines/` directory existed in the repo, this plan would adhere to it; `ls` of the root directory confirms no `guidelines/` exists at `/Users/martin/projects/paysdoc/AI_Dev_Workflow/.worktrees/feature-issue-464-shared-orchestrator-lifecycle-wrapper/` top level as of planning time.
- The "regression check: each orchestrator still runs end-to-end against a fixture issue" acceptance criterion is covered by the BDD scenario outline in `features/shared_orchestrator_lifecycle_wrapper.feature` section 9, which invokes each orchestrator's `main()` against fixture issue 9999 with phases stubbed and asserts the full wrapper lifecycle (acquire → start heartbeat → run body → stop heartbeat → release). Spinning up live GitHub issues is not required; the BDD scenarios plus the type-check + full unit-test run + migration diff review are the defense.
