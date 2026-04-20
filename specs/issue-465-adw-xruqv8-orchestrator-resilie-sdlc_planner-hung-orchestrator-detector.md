# Feature: hungOrchestratorDetector + cron wiring

## Metadata
issueNumber: `465`
adwId: `xruqv8-orchestrator-resilie`
issueJson: `{"number":465,"title":"orchestrator-resilience: hungOrchestratorDetector + cron wiring","body":"## Parent PRD\n\n`specs/prd/orchestrator-coordination-resilience.md`\n\n## What to build\n\nBuild the `hungOrchestratorDetector` pure-query module and wire it into the cron per-cycle work. The detector finds orchestrators with `*_running` stages whose PID is alive but whose `lastSeenAt` is older than the staleness threshold — these are the wedged event loop cases. The cron sweeper SIGKILLs the hung PID and rewrites the state to `abandoned` so the takeover path can pick it up on the next cycle. See \"New modules to build → hungOrchestratorDetector\" in the PRD.\n\n## Acceptance criteria\n\n- [ ] `adws/core/hungOrchestratorDetector.ts` exports `findHungOrchestrators(now, staleThresholdMs) → HungOrchestrator[]`\n- [ ] Detector is a pure query — no SIGKILL, no state writes\n- [ ] Detector filters to `*_running` stages where PID is live AND `lastSeenAt` is stale\n- [ ] Cron per-cycle work calls the detector, SIGKILLs returned PIDs, rewrites their state to `abandoned`\n- [ ] Contract test uses an injected clock and fixture state files; asserts only live-PID + stale-`lastSeenAt` entries are returned\n- [ ] Cron-integration test asserts SIGKILL and state rewrite occur for returned entries\n\n## Blocked by\n\n- Blocked by #462\n\n## User stories addressed\n\n- User story 4\n- User story 16","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-04-20T11:05:38Z","comments":[],"actionableComment":null}`

## Feature Description

Introduce `adws/core/hungOrchestratorDetector.ts` — a pure-query module that identifies wedged orchestrators by scanning top-level state files under `agents/<adwId>/state.json` and returning those whose `workflowStage` is `*_running`, whose `pid` + `pidStartedAt` tuple is live (via `processLiveness.isProcessLive`), yet whose `lastSeenAt` timestamp is older than a caller-supplied staleness threshold. The detector performs no kills, no state writes, and no logging beyond debug breadcrumbs — it is a read-only filter over the state directory.

Wire the detector into the cron per-cycle work in `adws/triggers/trigger_cron.ts`. On each tick (cycle-gated so it does not re-scan every 20 s), the cron calls `findHungOrchestrators(Date.now(), HEARTBEAT_STALE_THRESHOLD_MS)`, then for each returned entry performs the two side effects that the detector intentionally does not perform: `process.kill(pid, 'SIGKILL')` and `AgentStateManager.writeTopLevelState(adwId, { workflowStage: 'abandoned' })`. The state rewrite makes the issue retriable on the next cron cycle via the existing `isRetriableStage('abandoned') === true` path, so the takeover handler (future slice) can pick it up without operator intervention.

This feature is the "recovery-from-wedge" leg of the orchestrator-coordination-resilience PRD. It depends on the heartbeat module (shipped in #462) writing `lastSeenAt` every 30 s from `adwSdlc`, and it depends on the process-liveness module (shipped in #456) providing PID-reuse-safe liveness checks.

## User Story

As an ADW operator,
I want a hung orchestrator (process alive, event loop wedged) to be automatically detected and forcibly abandoned,
So that a single stuck call does not block an issue indefinitely and I do not have to manually triage wedged workflows.

## Problem Statement

Today, when an ADW orchestrator's event loop wedges — e.g., a Claude CLI subprocess that never returns, a blocking I/O stall, a third-party library deadlock — its Node process remains alive (`kill -0` succeeds) but it makes no progress. The cron backlog sweeper sees an active `*_running` stage with a live PID and treats the workflow as healthy, so the issue stays claimed indefinitely. There is no automatic recovery; an operator must notice the stall, post `## Cancel`, or manually edit the state file.

The heartbeat side-tick (shipped in #462) now writes `lastSeenAt` on a 30 s cadence independent of phase progress, so a wedged event loop produces a freshly-detectable signal: PID live, `lastSeenAt` stale. What is missing is the detector that consumes this signal and the cron wiring that acts on it.

## Solution Statement

Build a single-purpose, pure-query module `adws/core/hungOrchestratorDetector.ts` that encapsulates the "scan for wedged orchestrators" predicate, exposing `findHungOrchestrators(now, staleThresholdMs, deps?) → HungOrchestrator[]`. Keep all side effects out of the module so it is trivially testable with injected fakes: the caller performs SIGKILL and state rewrite.

Wire the detector into `trigger_cron.ts`'s existing `checkAndTrigger()` pass, gated on a cycle counter (`HUNG_DETECTOR_INTERVAL_CYCLES`, default 5 ≈ 100 s at the 20 s poll interval) so the scan runs frequently enough to catch stalls but does not duplicate work. For each `HungOrchestrator` returned, log at `warn`, SIGKILL the PID wrapped in try/catch (the process may have died between detection and kill), and call `AgentStateManager.writeTopLevelState(adwId, { workflowStage: 'abandoned' })` so the existing cron retriable path (`isRetriableStage('abandoned') === true`) will respawn it next cycle.

Defensive design: if a state file is missing `pid`, `pidStartedAt`, or `lastSeenAt`, the detector skips it. This matters because the broader write-side migration of `pidStartedAt` to the top-level state file is deferred to a later slice (per `app_docs/feature-xlv8zk-process-liveness-module.md` → "Write-side migration deferred"); until then, only orchestrators that have been migrated will be verifiable. A skipped entry is a safe no-op — the operator can still use `## Cancel` as the manual override.

## Relevant Files

Use these files to implement the feature:

- `adws/core/heartbeat.ts` — the heartbeat ticker that writes `lastSeenAt` every `HEARTBEAT_TICK_INTERVAL_MS`. The detector's input signal. Already shipped in #462. Only `adwSdlc` currently runs a heartbeat (tracer-bullet); other orchestrators are wired via PRD slice #8.
- `adws/core/processLiveness.ts` — `isProcessLive(pid, pidStartedAt, deps?)` and `getProcessStartTime(pid, deps?)`. The detector's PID-liveness primitive. Shipped in #456.
- `adws/core/agentState.ts` — `AgentStateManager.readTopLevelState(adwId)` reads `agents/<adwId>/state.json`; `AgentStateManager.writeTopLevelState(adwId, partial)` shallow-merges fields atomically. The detector calls `readTopLevelState` (via injected dep); the cron caller calls `writeTopLevelState`.
- `adws/types/agentTypes.ts` — `AgentState` fields `pid`, `pidStartedAt`, `lastSeenAt`, `workflowStage`, `adwId`, `issueNumber`. The detector reads these from each state file.
- `adws/types/workflowTypes.ts` — `WorkflowStage` union. The detector filters on `stage.endsWith('_running')` against the real `*_running` stages: `build_running`, `test_running`, `review_running`, `document_running`, `install_running`. (Plan-phase stages `plan_building`, `plan_validating`, `plan_aligning` do not end in `_running` and are therefore not targets of this detector.)
- `adws/triggers/cronStageResolver.ts` — exports `isActiveStage(stage)` (already matches `*_running`) and `isRetriableStage(stage)` (already includes `'abandoned'`). Used by the cron issue filter; after the cron rewrites a hung orchestrator's stage to `abandoned`, the next cycle's `filterEligibleIssues` will pick it up as retriable.
- `adws/triggers/trigger_cron.ts` — the cron entrypoint. The `checkAndTrigger()` function holds the per-cycle work; the new detector sweep wires in alongside `scanPauseQueue` and `runJanitorPass`.
- `adws/triggers/devServerJanitor.ts` — reference model for a cycle-gated, dependency-injected, pure-logic-plus-discovery sweep step. The `JanitorDeps` interface and `runJanitorPass` structure directly parallels what we need for the hung-detector sweep wiring.
- `adws/core/config.ts` — already exports `HEARTBEAT_TICK_INTERVAL_MS = 30_000` and `HEARTBEAT_STALE_THRESHOLD_MS = 180_000`. New `HUNG_DETECTOR_INTERVAL_CYCLES` const is added here alongside `JANITOR_INTERVAL_CYCLES`.
- `adws/core/environment.ts` — exports `AGENTS_STATE_DIR` (= `path.join(process.cwd(), 'agents')`). The detector uses this to enumerate adwId subdirectories.
- `adws/core/index.ts` — barrel exports. The detector's public symbols get re-exported alongside `HeartbeatHandle`.
- `adws/core/__tests__/heartbeat.test.ts` — pattern reference for contract tests with fake timers and filesystem-backed `AgentStateManager` state.
- `adws/core/__tests__/processLiveness.test.ts` — pattern reference for dependency-injection-based unit tests (no real PIDs touched).
- `adws/triggers/__tests__/devServerJanitor.test.ts` — pattern reference for pure-decision-matrix tests, discovery-with-injected-fs tests, and main-pass integration tests that assert side effects via spies on injected dependencies.
- `adws/core/stateHelpers.ts` — `isAgentProcessRunning(adwId)` uses the same read-state-then-isProcessLive pattern we need; reference for "no state file" and "state file missing pidStartedAt" safe-false behavior.
- `specs/prd/orchestrator-coordination-resilience.md` — parent PRD. Defines the detector's contract (lines 70) and the testing expectation (lines 128) as "contract test with an injected clock and a fixture set of state files".
- `app_docs/feature-zy5s32-heartbeat-module-tracer-integration.md` — conditional doc: when working with the heartbeat and the staleness threshold it signals.
- `app_docs/feature-xlv8zk-process-liveness-module.md` — conditional doc: when using `isProcessLive`. Documents the deferred write-side migration for `pidStartedAt` (relevant to the detector's defensive skip for state files missing that field).
- `app_docs/feature-jcwqw7-extend-top-level-state-schema.md` / `app_docs/feature-guimqa-extend-top-level-state-schema.md` — conditional docs: the state-schema fields the detector reads.
- `app_docs/feature-f704s2-dev-server-janitor-cron.md` — conditional doc: the existing cron sweep step (janitor) whose wiring pattern the new hung-detector sweep follows.
- `app_docs/feature-gq51dc-migrate-cron-stage-from-state-file.md` — conditional doc: how `cronStageResolver.isActiveStage`/`isRetriableStage` classify stages; the abandoned-rewrite relies on `isRetriableStage('abandoned') === true`.
- `app_docs/feature-ak5lea-trigger-cron-process-prevent-duplicate-cron.md` — conditional doc: `trigger_cron.ts` lifecycle (single-cron-per-repo guarantee) that the new sweep runs inside.

### New Files

- `adws/core/hungOrchestratorDetector.ts` — the detector module.
- `adws/core/__tests__/hungOrchestratorDetector.test.ts` — Vitest contract test suite.
- `adws/triggers/__tests__/trigger_cron.test.ts` — cron-integration test for the hung-orchestrator wiring side effects (SIGKILL + state rewrite) against returned detector entries. (Co-located with other `adws/triggers/__tests__/` files; scopes its tests to the hung-sweep block and module-level side effects of `trigger_cron.ts` are guarded/mocked before import.)

## Implementation Plan

### Phase 1: Foundation

Introduce the `HUNG_DETECTOR_INTERVAL_CYCLES` constant in `adws/core/config.ts` alongside `JANITOR_INTERVAL_CYCLES`. This is a one-line addition that lets ops tune the sweep cadence without code surgery. Default: 5 cycles (≈ 100 s at the 20 s cron poll). Runs more frequently than the janitor because the sweep is cheap (read state files + one `kill -0` per candidate) and the 3-minute staleness threshold wants prompt recovery once tripped.

Extract the hung-orchestrator detector's dependency-injection seam in a shape that mirrors `JanitorDeps`: a `HungDetectorDeps` interface over the OS-touching operations (directory listing, state reading, PID-liveness). Default implementations wrap `fs.readdirSync(AGENTS_STATE_DIR)`, `AgentStateManager.readTopLevelState`, and `processLiveness.isProcessLive`.

### Phase 2: Core Implementation

Build `adws/core/hungOrchestratorDetector.ts` with these exported symbols:

- `interface HungOrchestrator` — the shape of a single detector hit: `{ adwId: string; pid: number; pidStartedAt: string; lastSeenAt: string; workflowStage: string; issueNumber: number | null }`. `issueNumber` comes from the state file (may be null if the orchestrator is not keyed to an issue).
- `interface HungDetectorDeps` — `{ listAdwIds: () => string[]; readTopLevelState: (adwId: string) => AgentState | null; isProcessLive: (pid: number, pidStartedAt: string) => boolean }`.
- `const defaultHungDetectorDeps: HungDetectorDeps` — wraps the real implementations.
- `function findHungOrchestrators(now: number, staleThresholdMs: number, deps?: HungDetectorDeps) → HungOrchestrator[]` — the pure query.

Algorithm:

1. `const adwIds = deps.listAdwIds();` — enumerate `agents/<adwId>` subdirectories. On read error, return `[]`.
2. For each `adwId`:
   a. `const state = deps.readTopLevelState(adwId);` — skip on `null`.
   b. Skip if `state.workflowStage` is absent or does not end in `_running` (matches `isActiveStage` but narrower — we only care about actively-running stages, not intermediate `*_completed`).
   c. Skip if any of `state.pid`, `state.pidStartedAt`, `state.lastSeenAt` is undefined. These entries cannot be verified; the detector conservatively excludes them.
   d. Parse `state.lastSeenAt` via `Date.parse`; if the result is `NaN`, skip. (Corrupted state files should not hang the sweep.)
   e. Compute `ageMs = now - Date.parse(state.lastSeenAt)`; skip if `ageMs <= staleThresholdMs`.
   f. Check `deps.isProcessLive(state.pid, state.pidStartedAt)`; skip if false. A dead process is not "hung" — it is already terminated and should be reclaimed by the `abandoned` cron path directly (not this sweep).
   g. Push `{ adwId, pid, pidStartedAt, lastSeenAt, workflowStage, issueNumber }` onto the results.
3. Return results.

Add the module to the `adws/core/index.ts` barrel: `export { findHungOrchestrators } from './hungOrchestratorDetector'; export type { HungOrchestrator, HungDetectorDeps } from './hungOrchestratorDetector';`.

### Phase 3: Integration

Wire the sweep into `adws/triggers/trigger_cron.ts`'s `checkAndTrigger()`:

- Import `findHungOrchestrators`, `HEARTBEAT_STALE_THRESHOLD_MS`, `HUNG_DETECTOR_INTERVAL_CYCLES`, and `AgentStateManager`.
- Inside `checkAndTrigger()`, after `scanPauseQueue` and either before or after the janitor block (placement is a matter of preference — both are maintenance passes; run the hung detector first so a freshly-abandoned issue is visible to `filterEligibleIssues` downstream in the same cycle):

  ```ts
  if (cycleCount % HUNG_DETECTOR_INTERVAL_CYCLES === 0) {
    const hung = findHungOrchestrators(Date.now(), HEARTBEAT_STALE_THRESHOLD_MS);
    for (const entry of hung) {
      log(`Hung orchestrator detected: adwId=${entry.adwId} pid=${entry.pid} stage=${entry.workflowStage} lastSeenAt=${entry.lastSeenAt}`, 'warn');
      try {
        process.kill(entry.pid, 'SIGKILL');
      } catch (err) {
        log(`SIGKILL failed for pid=${entry.pid}: ${err}`, 'warn');
      }
      try {
        AgentStateManager.writeTopLevelState(entry.adwId, { workflowStage: 'abandoned' });
      } catch (err) {
        log(`State rewrite failed for adwId=${entry.adwId}: ${err}`, 'warn');
      }
    }
  }
  ```

The rewrite to `abandoned` means the existing `cronIssueFilter`/`cronStageResolver` path picks the issue up on the next cycle as retriable (`isRetriableStage('abandoned') === true`). No changes to those modules are needed.

Keep the detector-then-rewrite step in the *same* cycle as the issue-filter evaluation so that operators see both the `warn` and the subsequent respawn in a single poll log line — improves debuggability.

## Step by Step Tasks

Execute every step in order, top to bottom.

### Step 1 — Add `HUNG_DETECTOR_INTERVAL_CYCLES` to `adws/core/config.ts`

- Open `adws/core/config.ts`.
- After the existing `JANITOR_INTERVAL_CYCLES` declaration (around line 120), add:

  ```ts
  /** Number of cron poll cycles between hung-orchestrator detector passes (default: 5 ≈ 100s at 20s poll). */
  export const HUNG_DETECTOR_INTERVAL_CYCLES = parseInt(process.env.HUNG_DETECTOR_INTERVAL_CYCLES || '5', 10);
  ```

- Add `HUNG_DETECTOR_INTERVAL_CYCLES` to the existing re-export list in `adws/core/index.ts` (around line 10, alongside `JANITOR_INTERVAL_CYCLES`).

### Step 2 — Create `adws/core/hungOrchestratorDetector.ts`

- Create the new file with the exports described in Phase 2.
- Keep side effects out: the module only reads. SIGKILL and state writes live in the caller.
- Dependency shape:

  ```ts
  export interface HungDetectorDeps {
    listAdwIds: () => string[];
    readTopLevelState: (adwId: string) => AgentState | null;
    isProcessLive: (pid: number, pidStartedAt: string) => boolean;
  }

  export const defaultHungDetectorDeps: HungDetectorDeps = {
    listAdwIds: defaultListAdwIds,
    readTopLevelState: AgentStateManager.readTopLevelState,
    isProcessLive,
  };
  ```

- Default `listAdwIds` implementation:

  ```ts
  function defaultListAdwIds(): string[] {
    try {
      return fs.readdirSync(AGENTS_STATE_DIR, { withFileTypes: true })
        .filter(e => e.isDirectory())
        .map(e => e.name);
    } catch {
      return [];
    }
  }
  ```

- Export `findHungOrchestrators` implementing the algorithm in Phase 2. Wrap each state-file read and liveness check in defensive guards: undefined fields, `NaN` timestamps, and dep exceptions are all "skip this entry" — never throw.

### Step 3 — Add detector exports to `adws/core/index.ts`

- Add:

  ```ts
  export { findHungOrchestrators, defaultHungDetectorDeps } from './hungOrchestratorDetector';
  export type { HungOrchestrator, HungDetectorDeps } from './hungOrchestratorDetector';
  ```

- Place these alongside the existing heartbeat re-exports so related coordination-resilience symbols stay grouped.

### Step 4 — Wire the sweep into `adws/triggers/trigger_cron.ts`

- Add imports:
  - `findHungOrchestrators` from `../core` (barrel)
  - `HEARTBEAT_STALE_THRESHOLD_MS`, `HUNG_DETECTOR_INTERVAL_CYCLES` from `../core`
  - `AgentStateManager` from `../core/agentState` (follow existing import style; `AgentStateManager` is not currently imported into trigger_cron but is directly imported in janitor and others)
- Inside `checkAndTrigger()`, after the `scanPauseQueue(cycleCount)` call (around line 77), before `runJanitorPass()`, insert the detector sweep block from Phase 3.
- Keep the guard: `if (cycleCount % HUNG_DETECTOR_INTERVAL_CYCLES === 0) { ... }`.
- Ensure each side effect (SIGKILL, state rewrite) is individually try/catch-wrapped — one failure must not skip the other, and a failure on one adwId must not skip the next.

### Step 5 — Create `adws/core/__tests__/hungOrchestratorDetector.test.ts`

Per the issue acceptance criteria — "Contract test uses an injected clock and fixture state files" — the contract test seeds real state files on disk under a per-test agents directory and swaps only `isProcessLive` for a fake. The clock is injected as the `now` parameter.

- Use Vitest.
- Create a unique per-test agents state directory under `os.tmpdir()` in `beforeEach`; tear it down in `afterEach` so successive tests are isolated.
- Seed fixture state files by writing real `agents/<adwId>/state.json` files under the per-test directory:

  ```ts
  function writeFixtureState(rootDir: string, adwId: string, state: Partial<AgentState>): void {
    const dir = path.join(rootDir, adwId);
    fs.mkdirSync(dir, { recursive: true });
    const full: AgentState = {
      adwId,
      issueNumber: 1,
      agentName: 'sdlc',
      execution: { status: 'running' },
      workflowStage: 'build_running',
      pid: 100,
      pidStartedAt: 'token-100',
      lastSeenAt: '2026-04-20T10:00:00.000Z',
      ...state,
    } as AgentState;
    fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(full, null, 2));
  }
  ```

- Construct `HungDetectorDeps` that reads real files from the per-test directory but uses a fake `isProcessLive`:

  ```ts
  function mkDeps(rootDir: string, live: Set<string>): HungDetectorDeps {
    return {
      listAdwIds: () => fs.readdirSync(rootDir, { withFileTypes: true })
        .filter(e => e.isDirectory())
        .map(e => e.name),
      readTopLevelState: (id) => {
        try {
          const content = fs.readFileSync(path.join(rootDir, id, 'state.json'), 'utf-8');
          return JSON.parse(content) as AgentState;
        } catch {
          return null;
        }
      },
      isProcessLive: (pid, pidStartedAt) => live.has(`${pid}:${pidStartedAt}`),
    };
  }
  ```

- Test cases (each asserts on the shape of the returned array only):

  **Positive cases (should be returned):**
  - `build_running` + live PID + `lastSeenAt` older than threshold → returned.
  - Each real `*_running` variant (`test_running`, `review_running`, `document_running`, `install_running`) + live PID + stale → returned.
  - `lastSeenAt` exactly `staleThresholdMs + 1 ms` old → returned (boundary).
  - Multiple hung entries across multiple adwIds → all returned.

  **Negative cases (should be skipped):**
  - `lastSeenAt` fresh (age ≤ threshold) → skipped.
  - `lastSeenAt` exactly at threshold → skipped (boundary, not strictly stale).
  - Live PID + stale `lastSeenAt` but `workflowStage` is `completed` → skipped.
  - `workflowStage` ends in `_completed` (intermediate, not `_running`) → skipped.
  - `workflowStage` is `abandoned`, `discarded`, `paused`, or `starting` → skipped.
  - `workflowStage` absent → skipped.
  - Stale `lastSeenAt` + dead PID → skipped (not hung, already terminated — caller picks up via `abandoned` path separately).
  - `pid` undefined → skipped.
  - `pidStartedAt` undefined (common today — write-side migration deferred) → skipped.
  - `lastSeenAt` undefined → skipped.
  - `lastSeenAt` is an unparseable string → skipped.
  - A sibling state file whose JSON content is not valid JSON → that entry skipped, other entries still returned.
  - Empty per-test directory → returns `[]`.

  **Purity assertions:**
  - After `findHungOrchestrators` returns, no state file written under the per-test directory was modified (re-read and compare content bytes).
  - `process.kill` was never called (assert on `vi.spyOn(process, 'kill')`).

- Use an injected `now: number` and `staleThresholdMs: number` rather than real wall-clock time. `vi.useFakeTimers()` is unnecessary because the detector takes `now` as an argument.
- No test asserts against the current process's real pid — the fake `isProcessLive` is always consulted via the injected `HungDetectorDeps`.

### Step 6 — Create `adws/triggers/__tests__/trigger_cron.test.ts`

This is the cron-integration test demanded by the acceptance criteria. Scope it narrowly to the hung-orchestrator sweep block inside `checkAndTrigger()`. The sweep logic stays inline in `trigger_cron.ts` (per Step 4) — no separate `hungDetectorSweep.ts` module is introduced, so that the scenarios' explicit assertion "`trigger_cron.ts` imports `findHungOrchestrators` from `../core/hungOrchestratorDetector`" holds true.

#### Step 6a — Make the sweep block testable from `trigger_cron.test.ts`

`trigger_cron.ts` currently has module-level side effects (`resolveCronRepo`, `activateGitHubAppAuth`, `registerAndGuard`, a `setInterval`) that fire on import, which would destabilise a straight `import` in Vitest. Two complementary techniques keep `trigger_cron.test.ts` stable without relocating the sweep:

1. Before importing `../trigger_cron`, the test uses `vi.mock(...)` to stub out `../cronRepoResolver`, `../../github` (for `activateGitHubAppAuth`, `getRepoInfo`, `fetchPRList`, `hasUnaddressedComments`, `isCancelComment`, `refreshTokenIfNeeded`), `../cronProcessGuard` (`registerAndGuard`), `../core/hungOrchestratorDetector` (to inject a fake `findHungOrchestrators`), and `../../core/agentState` (to inject a `writeTopLevelState` spy). `process.kill` is replaced with `vi.spyOn(process, 'kill').mockImplementation(() => true)` so nothing is actually killed.
2. If a bare `import` still fires too many side effects to stabilise, `trigger_cron.ts` may expose a small named helper that the test can call instead of driving `checkAndTrigger()` end-to-end — but the helper lives in `trigger_cron.ts` itself (not a new file), so the scenarios' import/call assertions on `trigger_cron.ts` still hold.

#### Step 6b — Write the integration test

In `adws/triggers/__tests__/trigger_cron.test.ts`:

- Stub `findHungOrchestrators` (via `vi.mock('../../core/hungOrchestratorDetector', ...)`) to return a deterministic `HungOrchestrator[]` fixture per test.
- Spy on `process.kill` and on `AgentStateManager.writeTopLevelState`.
- Inject a fake clock so staleness windows are deterministic (the test passes its own `now` through the fake `findHungOrchestrators`; no wall-clock is consulted).
- If the test seeds any fixture state files under a per-test agents directory (e.g., to exercise the retriable-stage re-eligibility scenario), remove that directory in `afterEach`.
- Assertions:
  - Given a single hung entry with `pid=1234` → `process.kill` called with `(1234, 'SIGKILL')`.
  - Given a single hung entry with `adwId="sweep-02"` → `AgentStateManager.writeTopLevelState` called with `('sweep-02', { workflowStage: 'abandoned' })`.
  - `writeTopLevelState` is never called with `workflowStage: 'discarded'` for a hung entry.
  - Given 2 hung entries (`sweep-a` pid 4001, `sweep-b` pid 4002) → `process.kill` called for both pids with `'SIGKILL'`, and `writeTopLevelState` called for both adwIds with `{ workflowStage: 'abandoned' }`.
  - `findHungOrchestrators` returns `[]` → neither `process.kill` nor `writeTopLevelState` invoked by the sweep block.
  - `process.kill` throws for `sweep-c` pid 5001 → `writeTopLevelState` for `sweep-c` is still called, and the sibling `sweep-d` entry is still processed (both `process.kill` and `writeTopLevelState` invoked for it).

### Step 7 — Verify the cron still boots cleanly

- Run `bunx tsc --noEmit -p adws/tsconfig.json` to verify type correctness of the new module, barrel exports, and cron wiring.
- Run `bun run lint` to catch style/import issues.

### Step 8 — Run all validation commands

Execute the `Validation Commands` section below. All commands must pass with zero regressions.

## Testing Strategy

### Unit Tests

Unit tests are enabled for this project (per `.adw/project.md` `## Unit Tests: enabled`).

**`adws/core/__tests__/hungOrchestratorDetector.test.ts`** — Contract tests for `findHungOrchestrators`:
- Seed fixture state files on disk under a per-test agents directory (under `os.tmpdir()`); tear the directory down in `afterEach`.
- Inject `HungDetectorDeps` whose `listAdwIds` and `readTopLevelState` read from the per-test directory, and whose `isProcessLive` is a fake (no real PID is probed).
- Use an explicit `now: number` parameter (not `Date.now()`) so time is fully controlled.
- Cover all positive and negative cases enumerated in Step 5 above.
- Assert purity: no writes to any fixture state file, no `process.kill` calls.

**`adws/triggers/__tests__/trigger_cron.test.ts`** — Cron-integration tests for the hung-orchestrator sweep block:
- Before importing `../trigger_cron`, stub module-level dependencies with `vi.mock(...)` so the import is safe; stub `findHungOrchestrators` to return deterministic fixtures.
- Spy on `process.kill` and `AgentStateManager.writeTopLevelState`.
- Inject a fake clock so staleness is deterministic.
- Clean up any per-test fixture state directory in `afterEach`.
- Assert SIGKILL is sent for each returned entry with the correct pid and signal.
- Assert `writeTopLevelState` is called for each returned entry with `{ workflowStage: 'abandoned' }` (and never with `'discarded'`).
- Assert per-entry error isolation (one `process.kill` failure does not skip the state rewrite for that entry or processing of siblings).
- Assert empty-result case is a no-op for both `process.kill` and `writeTopLevelState`.

### Edge Cases

- **PID reuse after reboot.** Handled by `isProcessLive`'s start-time tuple check. An unrelated process that inherited the PID will fail start-time equality, so the detector returns `false` and skips the entry. Test coverage: `processLiveness.test.ts` already covers this; the hung detector test includes a "live-set mismatch" case where `deps.isProcessLive` returns `false` to simulate this.
- **State file torn mid-write.** `AgentStateManager.writeTopLevelState` uses an atomic `.tmp` + rename; `readTopLevelState` returns `null` on JSON parse error. The detector skips `null` results. No test needed at the detector layer.
- **Orchestrator dies between detection and SIGKILL.** `process.kill` throws `ESRCH`; wrapped in try/catch; the subsequent state rewrite still runs so the issue still becomes retriable.
- **State rewrite races with orchestrator's own final write.** Possible but harmless. The orchestrator's write (e.g., `completed`) happens first if it succeeds; the detector's `abandoned` write happens only if the orchestrator was wedged at the last `lastSeenAt`. In the degenerate case where a write from both lands, the atomic merge means the last write wins. Operators can re-trigger via `## Cancel` if an `abandoned` lands on a genuinely-completed workflow — but this requires both a wedge *and* a recovery within the 100 s sweep window, which is improbable.
- **`pidStartedAt` absent from state file.** The broader write-side migration of `pidStartedAt` into `workflowInit.ts` is deferred (per `app_docs/feature-xlv8zk-process-liveness-module.md`). Until that ships, only orchestrators whose state was written with `pidStartedAt` will be detectable. The detector skips entries missing `pidStartedAt` — safe default, documented in the test suite with a dedicated case. Post-migration, coverage broadens automatically.
- **`lastSeenAt` absent from state file.** Occurs for non-`adwSdlc` orchestrators today (heartbeat is tracer-bullet scoped to `adwSdlc` per PRD slice #8). The detector skips these entries. Post-slice-#8, coverage broadens automatically.
- **Corrupt `lastSeenAt` string.** `Date.parse` returns `NaN`; detector checks for `isNaN` and skips.
- **`listAdwIds` exception (missing `agents/` directory, permission error).** Default implementation returns `[]`; detector returns `[]`.
- **Empty `agents/` directory.** Loop iterates zero times; detector returns `[]`.
- **Clock skew on the host.** `now` comes from `Date.now()` in the default caller but is fully injectable in tests. The detector has no opinion on monotonicity — it compares `now` against `Date.parse(lastSeenAt)`. If the clock rolled backward, `ageMs` could go negative and the entry would be skipped (correctly — a negative age is not stale).

## Acceptance Criteria

- [ ] `adws/core/hungOrchestratorDetector.ts` exists and exports `findHungOrchestrators(now, staleThresholdMs, deps?) → HungOrchestrator[]`, `HungOrchestrator` type, `HungDetectorDeps` type, and `defaultHungDetectorDeps`.
- [ ] The detector performs no state writes and no kills. Purity asserted in the unit test by checking that no fixture state file is mutated and by spying on `process.kill` — it must never be invoked by the detector.
- [ ] The detector filters to stages ending in `_running` whose PID is live per `isProcessLive(pid, pidStartedAt)` and whose `lastSeenAt` is strictly older than `staleThresholdMs`.
- [ ] The detector defensively skips entries missing `pid`, `pidStartedAt`, `lastSeenAt`, or whose `lastSeenAt` is unparseable — no throws.
- [ ] `adws/core/config.ts` exports `HUNG_DETECTOR_INTERVAL_CYCLES` (default 5). The constant is re-exported through `adws/core/index.ts`.
- [ ] `adws/triggers/trigger_cron.ts` directly imports `findHungOrchestrators` from `../core/hungOrchestratorDetector` (or the barrel `../core`) and `HEARTBEAT_STALE_THRESHOLD_MS` from `../core/config` (or `../core`); `checkAndTrigger()` calls `findHungOrchestrators(..., HEARTBEAT_STALE_THRESHOLD_MS)` inline, gated by `HUNG_DETECTOR_INTERVAL_CYCLES`, before `runJanitorPass()`.
- [ ] For each entry returned by the detector, the cron sweep block inside `checkAndTrigger()` sends `SIGKILL` via `process.kill` (wrapped in try/catch) and rewrites top-level state to `{ workflowStage: 'abandoned' }` via `AgentStateManager.writeTopLevelState` (wrapped in try/catch). Per-entry failures do not abort processing of siblings.
- [ ] `adws/core/__tests__/hungOrchestratorDetector.test.ts` uses an injected clock (via `now` parameter) and fixture state files on disk under a per-test agents directory; fake `isProcessLive` is injected via `HungDetectorDeps`; all positive and negative cases listed in Step 5 pass.
- [ ] `adws/triggers/__tests__/trigger_cron.test.ts` stubs `findHungOrchestrators` to return fixture hung entries and asserts `process.kill` is called with the right pid and `'SIGKILL'`, and that `AgentStateManager.writeTopLevelState` is called with `{ workflowStage: 'abandoned' }` for each entry's adwId; per-entry failures isolate; the integration test injects its own `now` rather than relying on the system clock.
- [ ] `bun run lint`, `bunx tsc --noEmit`, `bunx tsc --noEmit -p adws/tsconfig.json`, and `bun run test:unit` all pass.
- [ ] No changes to `cronIssueFilter.ts` or `cronStageResolver.ts` (the `abandoned` rewrite already triggers retry under the existing `isRetriableStage('abandoned') === true` path).

## Validation Commands

Execute every command to validate the feature works correctly with zero regressions.

- `bun install` — ensure dependencies resolve (no new deps expected, but confirm lockfile integrity).
- `bun run lint` — lint new and modified files.
- `bunx tsc --noEmit` — root TypeScript check.
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW-specific TypeScript check (stricter, catches ADW-only type issues).
- `bun run test:unit -- hungOrchestratorDetector` — run the new contract test suite in isolation, verify all cases pass.
- `bun run test:unit -- trigger_cron` — run the cron-integration test in isolation.
- `bun run test:unit` — run the full unit suite for zero regressions across existing modules (especially `heartbeat`, `processLiveness`, `cronStageResolver`, `cronIssueFilter`, `devServerJanitor`).
- `bun run build` — verify the project still builds with the new module.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — run BDD regression scenarios to confirm no cron-trigger regression (the hung-detector wiring runs inside the cron loop that other regression scenarios exercise).

## Notes

- **Guidelines directory**: `guidelines/` does not exist in this repo root. No repo-specific coding guidelines apply beyond the ADW conventions encoded in `.adw/project.md` (Bun + TypeScript, `bunx tsc --noEmit -p adws/tsconfig.json` as the strict type gate, `bun run test:unit` as the test runner, no decorators, simple module surfaces).
- **No new library installs required.** The detector uses only `fs`, `path`, and existing ADW modules.
- **Dependency on the heartbeat side-tick.** Until PRD slice #8 wires heartbeat into the remaining eleven orchestrators, the detector will only find hung `adwSdlc` instances. This is expected and aligns with the tracer-bullet rollout plan. No code change is needed in this slice to support the future rollout.
- **Dependency on the `pidStartedAt` write-side migration.** Until that ships, orchestrators whose top-level state was written before the migration will not have `pidStartedAt` and the detector will skip them. This is the safe-default behavior — an orchestrator whose start-time token cannot be verified cannot be safely SIGKILLed (PID reuse risk). Operators retain `## Cancel` as the escape hatch per PRD User Story 21.
- **Relationship to `devServerJanitor`.** The janitor targets *orphaned* dev-server subprocesses left behind by crashed orchestrators; the hung-detector targets the *orchestrator itself* while it is still alive but wedged. They solve different halves of the liveness problem and should stay separate modules.
- **Relationship to `takeoverHandler` (future PRD slice #11).** The detector's rewrite to `abandoned` is exactly the signal the takeover handler will consume on the next cron cycle. No direct wiring between the two modules is needed in this slice — the state file is the coordination point, consistent with the PRD's "state file is the cache; remote is the truth" design.
- **`HUNG_DETECTOR_INTERVAL_CYCLES` default rationale.** 5 cycles × 20 s = 100 s. At the 180 s staleness threshold, a wedged orchestrator trips the detector on at most the second sweep after wedge (80–100 s worst-case detection latency after the heartbeat stops ticking). Tuning down to 3 cycles (60 s) improves responsiveness at the cost of extra state-file reads; tuning up to 10 cycles (200 s) halves the reads but pushes worst-case detection latency toward 200 s. Default optimises for detection latency under the 3-minute staleness floor.
- **Observability.** Detector hits log at `warn` level with adwId, pid, workflowStage, and lastSeenAt — enough to correlate with operator-facing GitHub comments (adwId ↔ issue comment prefix) and with local debugging (pid ↔ `ps` or `lsof`). No new observability infrastructure is introduced in this slice.
- **Future: slash command `/adw_hung_report`.** Not in scope. A read-only CLI that surfaces the detector's current view (without side effects) could help operators debug; tracked separately.
