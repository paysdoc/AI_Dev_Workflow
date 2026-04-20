# Feature: Heartbeat module + adwSdlc tracer integration

## Metadata
issueNumber: `462`
adwId: `zy5s32-orchestrator-resilie`
issueJson: `{"number":462,"title":"orchestrator-resilience: heartbeat module + tracer integration","body":"## Parent PRD\n\n`specs/prd/orchestrator-coordination-resilience.md`\n\n## What to build\n\nBuild the `heartbeat` module that writes `lastSeenAt` to the top-level state file on a 30-second interval, independently of phase progress. Wire it into one orchestrator (pick `adwSdlc`) as a tracer bullet to prove the end-to-end flow. The shared wrapper that rolls this out to all twelve entrypoints is slice #8. See \"New modules to build → heartbeat\" and \"Heartbeat parameters\" in the PRD.\n\nEnd-to-end demo: running `adwSdlc` against a test issue produces `lastSeenAt` ticks in the state file every 30s. Killing the process stops the ticks. `lastSeenAt` survives phase transitions.\n\n## Acceptance criteria\n\n- [ ] `adws/core/heartbeat.ts` exports `startHeartbeat(adwId, intervalMs) → HeartbeatHandle` and `stopHeartbeat(handle)`\n- [ ] Tick interval and stale-threshold constants live in `adws/core/config` (defaults: 30s / 180s)\n- [ ] Module has no knowledge of phases or errors — purely a liveness ticker\n- [ ] Writes atomically via `AgentStateManager.writeTopLevelState`\n- [ ] Wired into `adwSdlc`: heartbeat starts after state init, stops in `finally` block\n- [ ] Contract test: `startHeartbeat` writes `lastSeenAt` at least once within `intervalMs * 1.5`; `stopHeartbeat` prevents further writes\n\n## Blocked by\n\n- Blocked by #461\n\n## User stories addressed\n\n- User story 5\n- User story 14","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-04-20T11:05:07Z","comments":[],"actionableComment":null}`

## Feature Description

Build a tiny, deep `heartbeat` module that writes a single top-level-state field (`lastSeenAt`, ISO 8601) on a fixed interval, completely decoupled from phase progress. Wire it into one orchestrator — `adwSdlc` — as a tracer bullet so the end-to-end path works before the shared entrypoint wrapper (PRD slice #8) rolls it out to the remaining eleven orchestrators.

The value is operator-facing: combined with `pid` and `pidStartedAt` (already on the schema from slice #461), `lastSeenAt` lets the hung-orchestrator detector (future slice) distinguish between "orchestrator is alive and making progress", "orchestrator is alive but event-loop-wedged", and "orchestrator died between phase writes". Today the state file only updates at phase boundaries, so a long phase (or a wedged one) is indistinguishable from a dead process by file-mtime alone.

The module is intentionally small and opinionated:

- Public API: `startHeartbeat(adwId, intervalMs) → HeartbeatHandle` and `stopHeartbeat(handle)`.
- Single `setInterval` per handle; each tick calls `AgentStateManager.writeTopLevelState(adwId, { lastSeenAt: new Date().toISOString() })`.
- No phase awareness, no error handling beyond swallowing transient write failures so the tick keeps firing.
- Tick interval (30s) and stale threshold (180s) are exported as named constants from `adws/core/config`.

`adwSdlc` acquires a `HeartbeatHandle` right after `initializeWorkflow()` returns (the state file is guaranteed to exist past that point) and releases it in a new `finally` block so the timer is always cleared — normal exit, throw, or early return. The `handleWorkflowError` path inside the existing `catch` still runs; the new `finally` is additive.

## User Story

As an ADW operator (user story 5)
I want to see at a glance from the top-level state file whether an orchestrator is currently live, who owns it (pid, start-time), and when it last made progress (`lastSeenAt`)
So that I can debug without spelunking into phase subdirectories.

As an ADW developer (user story 14)
I want each entrypoint orchestrator to eventually get lock acquisition, heartbeat start, and cleanup wiring via a shared wrapper
So that I don't have to replicate lifecycle boilerplate in 12 places — and the tracer-bullet wiring on `adwSdlc` is the validation that the piece works before the wrapper rolls it out.

## Problem Statement

With the schema extension landed in #461, `lastSeenAt` is a declared field but nobody writes to it. Until something actually ticks, the top-level state file only mutates on phase boundaries. That produces two operator problems:

1. **Wedged event loop is invisible.** An orchestrator whose Node event loop has stalled mid-phase still owns its PID (so `kill -0` succeeds and `processLiveness.isProcessLive` returns true), but it is not making progress. Without an independent timer writing `lastSeenAt`, there is no signal that distinguishes "in a long phase" from "wedged". The cron sweeper has nothing to trigger on.
2. **Long gaps look like crashes.** A phase that legitimately takes 10 minutes (build, test, review) leaves the state file untouched for that duration. An operator spot-checking the file cannot tell whether the orchestrator is healthy or dead without correlating against process tables.

The PRD's hung-orchestrator detector (future slice) reads `(pid, pidStartedAt, lastSeenAt)` and classifies any state where PID is live but `lastSeenAt` is older than `STALE_THRESHOLD_MS` as hung. That detector is useless until something writes the ticks. This slice writes the ticks — from a single orchestrator (`adwSdlc`) — so all downstream recovery mechanics can be built and validated against a real producer.

Doing this as a tracer bullet rather than landing the shared wrapper (slice #8) up front is deliberate: we want the heartbeat module's contract and the orchestrator wire-up pattern proven on one entrypoint before replicating the wire-up to twelve. If either the module API or the wire-up point is wrong, correcting it in one orchestrator is cheap; correcting it in twelve is a maintenance hazard.

## Solution Statement

Create `adws/core/heartbeat.ts` with the two-function API mandated by the acceptance criteria. Internally the handle carries the `NodeJS.Timeout` returned by `setInterval` plus a copy of the `adwId` for defensive use (logging, idempotent stop). The tick calls `AgentStateManager.writeTopLevelState(adwId, { lastSeenAt: new Date().toISOString() })` — a one-field partial patch, which the atomic writer from #461 preserves against concurrent phase-boundary writes.

Export two constants from `adws/core/config.ts` (alongside the other timing constants):

- `HEARTBEAT_TICK_INTERVAL_MS = 30_000` — tick cadence.
- `HEARTBEAT_STALE_THRESHOLD_MS = 180_000` — six missed ticks; consumed later by the hung-orchestrator detector.

Both are plain `const` exports (not env-driven); the PRD says ops should be able to tune them "without code surgery", which the code-local constant satisfies for the current operator (the single-host invariant means tuning is a single-file edit, not an infra change). If a future slice needs env-override knobs, that's a trivial addition layered on top.

Wire into `adwSdlc.tsx`:

- Import `startHeartbeat`, `stopHeartbeat`, and `type HeartbeatHandle` from `./core/heartbeat`; import `HEARTBEAT_TICK_INTERVAL_MS` from `./core/config`.
- Declare `let heartbeat: HeartbeatHandle | null = null;` above the `try` block.
- Call `heartbeat = startHeartbeat(config.adwId, HEARTBEAT_TICK_INTERVAL_MS);` as the first line inside the existing `try` block — this is guaranteed-after-state-init because `initializeWorkflow()` writes `workflowStage: 'starting'` to the state file synchronously before returning at `workflowInit.ts:245-250`.
- Add a `finally { if (heartbeat !== null) stopHeartbeat(heartbeat); }` block after the existing `catch`. The finally runs on normal exit, on handled error (after the catch body), and on unhandled throw. The `heartbeat !== null` type-guard narrows the variable so the non-nullable `stopHeartbeat(handle: HeartbeatHandle)` signature is satisfied.

Write a contract test at `adws/core/__tests__/heartbeat.test.ts`:

- Use `vi.useFakeTimers()` / `vi.advanceTimersByTimeAsync(ms)` (pattern already in use in `devServerLifecycle.test.ts`). Restore via `vi.useRealTimers()` in `afterEach`.
- Use real `AgentStateManager.writeTopLevelState` calls — the contract test seeds a fresh per-test top-level state file for a unique adwId, lets the heartbeat tick write to it, and reads the file back to assert the `lastSeenAt` value. The `afterEach` hook removes the per-test adwId state directory (scenario `@adw-462` requires this cleanup).
- Case A: seed a fresh state file for `hb-tick-a`, call `startHeartbeat('hb-tick-a', 100)`, advance `150ms`, read the state file back, assert `lastSeenAt` is a non-empty string matching `/^\d{4}-\d{2}-\d{2}T/`.
- Case B: seed a fresh state file for `hb-stop-a`, call `startHeartbeat('hb-stop-a', 100)`, advance `150ms`, record the persisted `lastSeenAt`, call `stopHeartbeat(handle)`, advance `500ms`, read the state file back, assert the persisted `lastSeenAt` equals the recorded value (no further writes after stop).
- Case C: idempotent stop — calling `stopHeartbeat(handle)` twice does not throw.

Every piece above is test-only or schema-stable; no production consumer outside `adwSdlc` sees a behavior change in this slice.

## Relevant Files

Use these files to implement the feature:

- `specs/prd/orchestrator-coordination-resilience.md` — Parent PRD. "New modules to build → heartbeat" (line 66) defines the module's surface and pure-ticker contract; "Heartbeat parameters" (lines 110-112) defines the 30s/180s constants. Read sections 63-78 and 110-112 before editing.
- `adws/core/heartbeat.ts` — **New file.** The module. Two functions, one constant-backed `setInterval`, one opaque handle interface. Under 80 lines total.
- `adws/core/config.ts` — Home of the retry/timing constants (lines 52-113). Adds `HEARTBEAT_TICK_INTERVAL_MS = 30_000` and `HEARTBEAT_STALE_THRESHOLD_MS = 180_000` alongside `GRACE_PERIOD_MS`/`PROBE_INTERVAL_CYCLES`. Plain const exports, no env read required for this slice.
- `adws/core/index.ts` — Barrel file. Re-exports the new heartbeat symbols alongside other `./core` exports so consumers that prefer the barrel can use it. Note: scenario `@adw-462` requires `adwSdlc.tsx` to import `startHeartbeat`/`stopHeartbeat` directly from `./core/heartbeat` and `HEARTBEAT_TICK_INTERVAL_MS` from `./core/config`, so the tracer-bullet wiring uses submodule paths, not the barrel.
- `adws/core/agentState.ts` — Existing atomic writer (`writeTopLevelState`, lines 281-312). The heartbeat calls it with a `{ lastSeenAt }` partial patch; the deep-merge semantics already preserve other fields. No change to this file.
- `adws/types/agentTypes.ts` — Home of `AgentState.lastSeenAt?: string` (line 224). Defined in #461. Read-only — no change in this slice.
- `adws/adwSdlc.tsx` — Tracer bullet target. Add the `heartbeat` declaration, `startHeartbeat` call, and `finally` cleanup block. The file is 153 lines today; this slice adds ~6 lines.
- `adws/phases/workflowInit.ts` — Read-only. Confirms at lines 244-250 that `initializeWorkflow` writes `workflowStage: 'starting'` to the top-level state file synchronously before returning, so `startHeartbeat` can safely write `{ lastSeenAt }` immediately after `initializeWorkflow` resolves (the file and parent directory exist).
- `adws/core/devServerLifecycle.ts` — Reference for the handle+cleanup+finally pattern (lines 127-166 for `withDevServer`). The heartbeat module and its `adwSdlc` wire-up mirror the same "start resource, run work, stop in finally" shape.
- `adws/core/__tests__/heartbeat.test.ts` — **New file.** Vitest contract test with fake timers and per-test state-directory cleanup. Single `describe('heartbeat module contract', …)` block with the cases listed in the Solution Statement (tick write, stop prevents further writes, idempotent stop, tick survives a write error).
- `adws/core/__tests__/devServerLifecycle.test.ts` — Reference for the fake-timer style (lines 122-148 show `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync(ms)` + `vi.useRealTimers()` in `afterEach`). Mirror this pattern in `heartbeat.test.ts`.
- `adws/core/__tests__/topLevelState.test.ts` — Reference for the vitest import style, per-describe adwId pattern, real-filesystem state-directory setup, and read-back assertions on the persisted JSON (lines 118-166). The heartbeat contract test mirrors this real-filesystem approach: each test seeds a fresh state directory for its adwId, lets the heartbeat write through `AgentStateManager.writeTopLevelState`, reads the file back, and cleans up in `afterEach`.
- `guidelines/coding_guidelines.md` — TypeScript strict mode, interfaces for data shapes, pure functions with side effects at boundaries, files under 300 lines. The heartbeat module respects all four rules as-written.
- `app_docs/feature-jcwqw7-extend-top-level-state-schema.md` — Context on the schema field this slice writes into; confirms `lastSeenAt` is ISO 8601 and that partial-patch writes preserve all other fields.
- `app_docs/feature-guimqa-extend-top-level-state-schema.md` — Parallel planning doc for the same schema slice; cross-reference for the `writeTopLevelState` atomicity guarantee the heartbeat depends on.

### New Files

- `adws/core/heartbeat.ts` — The module. Exports `HeartbeatHandle` (interface), `startHeartbeat`, `stopHeartbeat`.
- `adws/core/__tests__/heartbeat.test.ts` — Contract test with fake timers.

## Implementation Plan

### Phase 1: Foundation

Add the two timing constants to `adws/core/config.ts` so downstream code (heartbeat module, future hung-orchestrator detector) consumes them from one place:

- `HEARTBEAT_TICK_INTERVAL_MS = 30_000` — tick cadence.
- `HEARTBEAT_STALE_THRESHOLD_MS = 180_000` — six missed ticks.

Placed near `GRACE_PERIOD_MS` (line 77), grouped with the other timing constants. JSDoc comment above each explaining the unit and role.

### Phase 2: Core Implementation

Create `adws/core/heartbeat.ts`:

- Imports: `AgentStateManager` from `./agentState`, `log` from `./logger` (for a single info line on start and an info line on stop, mirroring the one-liner style used in `workflowInit.ts`).
- Exported interface `HeartbeatHandle { readonly adwId: string; readonly timer: NodeJS.Timeout; }`.
- Exported `startHeartbeat(adwId: string, intervalMs: number): HeartbeatHandle` — creates the `setInterval`, returns the handle. Each tick wraps the `writeTopLevelState` call in a `try/catch` that logs and swallows; a thrown write failure must not kill the timer.
- Exported `stopHeartbeat(handle: HeartbeatHandle): void` — calls `clearInterval(handle.timer)`. Safe to call more than once on the same handle (`clearInterval` on a cleared timer is a no-op), so the function is idempotent without needing a null check. The caller (`adwSdlc.tsx`) null-guards on its side before calling, satisfying the non-nullable signature.

Re-export from `adws/core/index.ts`:

- Add `export { startHeartbeat, stopHeartbeat, type HeartbeatHandle } from './heartbeat';`
- Add `HEARTBEAT_TICK_INTERVAL_MS`, `HEARTBEAT_STALE_THRESHOLD_MS` to the constants re-export from `./config` if that barrel re-exports them (inspect the current barrel and follow its pattern; do not add a second barrel if `./config` is already re-exported wholesale).

### Phase 3: Integration (tracer bullet on adwSdlc)

Edit `adws/adwSdlc.tsx`:

- Add a new import pulling `startHeartbeat`, `stopHeartbeat`, and `type HeartbeatHandle` from `./core/heartbeat`; extend the `./core/config` import to also pull in `HEARTBEAT_TICK_INTERVAL_MS` (or add a new import line if `./core/config` is not yet imported directly).
- Inside `main()`, after the `const tracker = new CostTracker();` line (line 72) and before the `try {` (line 74), declare `let heartbeat: HeartbeatHandle | null = null;`.
- As the first statement inside the `try` block (line 75, pushing the existing `executeInstallPhase` down by one line), assign `heartbeat = startHeartbeat(config.adwId, HEARTBEAT_TICK_INTERVAL_MS);`.
- After the existing `catch (error) { handleWorkflowError(...) }` block, add `finally { if (heartbeat !== null) stopHeartbeat(heartbeat); }`.

The heartbeat handle is declared outside the `try` so the `finally` can reach it. The `if (heartbeat !== null)` check narrows the type from `HeartbeatHandle | null` to `HeartbeatHandle`, satisfying the non-nullable `stopHeartbeat` signature and guarding the case where an exception is thrown before `startHeartbeat` returns.

### Phase 4: Contract test

Create `adws/core/__tests__/heartbeat.test.ts`:

- `vitest` imports: `describe, it, expect, vi, beforeEach, afterEach`.
- Import `AgentStateManager` from `../agentState`.
- Import `startHeartbeat, stopHeartbeat` from `../heartbeat`.
- Import `fs` for per-test adwId state-directory cleanup.
- `beforeEach`: `vi.useFakeTimers()` and seed a fresh top-level state file for each test's adwId (use `AgentStateManager.writeTopLevelState` or the module's own seed helper; whichever primes the file/directory the heartbeat writes into).
- `afterEach`: `vi.useRealTimers()`, `vi.restoreAllMocks()`, and `fs.rmSync` the per-test adwId state directory with `{ recursive: true, force: true }` — required by scenario `@adw-462` "contract tests clean up any top-level state files they create".
- Test A: starts the heartbeat against a seeded adwId `hb-tick-a`, advances `intervalMs * 1.5` using `vi.advanceTimersByTimeAsync`, reads the persisted state file, asserts `lastSeenAt` is a non-empty string matching `/^\d{4}-\d{2}-\d{2}T/`.
- Test B: starts the heartbeat against a seeded adwId `hb-stop-a`, advances `intervalMs * 1.5` to produce one tick, records the persisted `lastSeenAt`, calls `stopHeartbeat(handle)`, advances `intervalMs * 5`, asserts the persisted `lastSeenAt` equals the recorded value (no further writes after stop).
- Test C: calls `stopHeartbeat` twice on the same handle; expects no throw.
- Test D (tick survives a write error): `vi.spyOn(AgentStateManager, 'writeTopLevelState').mockImplementationOnce(() => { throw new Error('disk full'); })`, starts the heartbeat, advances `intervalMs * 2.5`, asserts the spy was called at least twice (the second call proves the timer survived the error on tick 1). This test deliberately replaces the writer with a spy to inject the error; no state-file read-back is needed.

### Phase 5: Validation

Run the full validation suite (see `## Validation Commands` below) to confirm lint, type-check, build, and unit tests all pass with the new module and the new `adwSdlc` wiring.

## Step by Step Tasks
Execute every step in order, top to bottom.

### 1. Add heartbeat timing constants to `adws/core/config.ts`
- Open `adws/core/config.ts`.
- Locate the "Concurrency / timing constants" section (lines 64-77).
- Immediately after `GRACE_PERIOD_MS` (line 77), add a new section with a commented header `// Heartbeat constants` and two constants:
  - `/** Heartbeat tick interval in milliseconds (default: 30s per PRD). */`
  - `export const HEARTBEAT_TICK_INTERVAL_MS = 30_000;`
  - `/** Stale-threshold for the hung-orchestrator detector — six missed ticks (default: 180s per PRD). */`
  - `export const HEARTBEAT_STALE_THRESHOLD_MS = 180_000;`
- Run `bunx tsc --noEmit -p adws/tsconfig.json` — expect zero errors.

### 2. Create the `heartbeat` module at `adws/core/heartbeat.ts`
- Create `adws/core/heartbeat.ts`.
- File-level JSDoc summarising the module: "Heartbeat ticker. Writes `lastSeenAt` to the top-level state file every `intervalMs`, decoupled from phase progress. Exists to give the cron sweeper a signal to distinguish alive-but-wedged from alive-and-progressing orchestrators."
- Imports: `AgentStateManager` from `./agentState`; `log` from `./logger`.
- Declare and export interface `HeartbeatHandle { readonly adwId: string; readonly timer: NodeJS.Timeout; }`.
- Export `startHeartbeat(adwId: string, intervalMs: number): HeartbeatHandle`:
  - `log(`Heartbeat starting for adwId=${adwId} (intervalMs=${intervalMs})`, 'info');`
  - `const timer = setInterval(() => {`
  - `  try {`
  - `    AgentStateManager.writeTopLevelState(adwId, { lastSeenAt: new Date().toISOString() });`
  - `  } catch (err) {`
  - `    log(`Heartbeat write failed for adwId=${adwId}: ${err}`, 'warn');`
  - `  }`
  - `}, intervalMs);`
  - `return { adwId, timer };`
- Export `stopHeartbeat(handle: HeartbeatHandle): void`:
  - `clearInterval(handle.timer);`
  - `log(`Heartbeat stopped for adwId=${handle.adwId}`, 'info');`
- Run `bunx tsc --noEmit -p adws/tsconfig.json` — expect zero errors.

### 3. Wire the module through the `core` barrel export
- Open `adws/core/index.ts`.
- Follow whatever re-export style is already in use. If the file re-exports symbols explicitly, add `export { startHeartbeat, stopHeartbeat, type HeartbeatHandle } from './heartbeat';` alongside the existing `export { … } from './agentState';` line.
- If the barrel also enumerates config constants, add `HEARTBEAT_TICK_INTERVAL_MS` and `HEARTBEAT_STALE_THRESHOLD_MS` to that list; otherwise they ride along if the entire `./config` module is re-exported wholesale.
- Run `bunx tsc --noEmit -p adws/tsconfig.json` — expect zero errors.

### 4. Wire the heartbeat into `adws/adwSdlc.tsx`
- Open `adws/adwSdlc.tsx`.
- Add an import `import { startHeartbeat, stopHeartbeat, type HeartbeatHandle } from './core/heartbeat';` alongside the existing `./core` imports.
- Add `HEARTBEAT_TICK_INTERVAL_MS` to the existing `./core/config` import (or add a new `import { HEARTBEAT_TICK_INTERVAL_MS } from './core/config';` line if config is not already imported directly).
- Immediately after `const tracker = new CostTracker();` (line 72) and before `try {` (line 74), add:
  - `let heartbeat: HeartbeatHandle | null = null;`
- As the first line inside the existing `try` block (line 75), insert:
  - `heartbeat = startHeartbeat(config.adwId, HEARTBEAT_TICK_INTERVAL_MS);`
- After the closing `}` of the existing `catch (error) { ... }` block (line 150), add:
  - `finally {`
  - `  if (heartbeat !== null) stopHeartbeat(heartbeat);`
  - `}`
- Run `bunx tsc --noEmit -p adws/tsconfig.json` — expect zero errors.

### 5. Create the contract test at `adws/core/__tests__/heartbeat.test.ts`
- Create `adws/core/__tests__/heartbeat.test.ts`.
- Imports: `describe, it, expect, vi, beforeEach, afterEach` from `vitest`. `AgentStateManager` from `../agentState`. `startHeartbeat, stopHeartbeat` from `../heartbeat`. `fs` (node:fs) for per-test state-directory cleanup.
- Top-level `describe('heartbeat module contract', () => { ... })`.
- Inside:
  - Track each test's adwId in a local array so the `afterEach` can `fs.rmSync` the matching state directories (scenario `@adw-462` mandates this cleanup).
  - Helper (module-local): `const seed = (adwId: string) => AgentStateManager.writeTopLevelState(adwId, {});` — writes an empty partial patch to initialise the file/directory. Substitute whichever primitive the existing test helpers in `topLevelState.test.ts` use if one already exists.
  - Helper: `const readLastSeenAt = (adwId: string) => <read the persisted state file for adwId and return the lastSeenAt property>` — mirror the read pattern already used in `topLevelState.test.ts`.
  - `beforeEach`: `vi.useFakeTimers();`
  - `afterEach`: `vi.useRealTimers(); vi.restoreAllMocks();` and `fs.rmSync` each tracked adwId's state directory with `{ recursive: true, force: true }`.
- Test A — "writes lastSeenAt within intervalMs * 1.5":
  - `seed('hb-tick-a');`
  - `const handle = startHeartbeat('hb-tick-a', 100);`
  - `await vi.advanceTimersByTimeAsync(150);`
  - `const lastSeenAt = readLastSeenAt('hb-tick-a');`
  - `expect(lastSeenAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);`
  - `stopHeartbeat(handle);`
- Test B — "stopHeartbeat prevents subsequent writes":
  - `seed('hb-stop-a');`
  - `const handle = startHeartbeat('hb-stop-a', 100);`
  - `await vi.advanceTimersByTimeAsync(150);`
  - `const captured = readLastSeenAt('hb-stop-a');`
  - `stopHeartbeat(handle);`
  - `await vi.advanceTimersByTimeAsync(500);`
  - `expect(readLastSeenAt('hb-stop-a')).toBe(captured);`
- Test C — "stopHeartbeat is idempotent (safe to call twice)":
  - `seed('hb-stop-b');`
  - `const handle = startHeartbeat('hb-stop-b', 100);`
  - `stopHeartbeat(handle);`
  - `expect(() => stopHeartbeat(handle)).not.toThrow();`
- Test D — "tick survives a write error":
  - `seed('hb-err-a');`
  - `const spy = vi.spyOn(AgentStateManager, 'writeTopLevelState');`
  - `spy.mockImplementationOnce(() => { throw new Error('disk full'); });`
  - `const handle = startHeartbeat('hb-err-a', 100);`
  - `await vi.advanceTimersByTimeAsync(250);`
  - `expect(spy.mock.calls.length).toBeGreaterThanOrEqual(2);`
  - `stopHeartbeat(handle);`
- Run `bun run test:unit -- heartbeat` — expect all four cases to pass.

### 6. End-to-end sanity: simulate a short adwSdlc tick cadence
- This is a manual/smoke check; no automated test is added in this slice because the end-to-end demo requires a real issue and a real worktree. The BDD scenarios that land alongside this slice (feature file tagged `@adw-462`) cover the orchestrator-level behavior via stubbed dependencies.
- If time permits, pipe `watch -n 5 'jq .lastSeenAt agents/<adwId>/state.json'` while running a short test issue and confirm the timestamp increments every ~30s.

### 7. Run the validation suite
- Execute every command under `## Validation Commands` below.
- Expect exit code 0 for each.

## Testing Strategy

### Unit Tests
`.adw/project.md` declares `## Unit Tests: enabled`, so this slice includes unit test tasks.

- Contract test at `adws/core/__tests__/heartbeat.test.ts` covers the full public API of the module: `startHeartbeat` writes `lastSeenAt` at least once within `intervalMs * 1.5`; `stopHeartbeat` prevents further writes; `stopHeartbeat` is idempotent (safe to call twice on the same handle); a single write failure does not kill the timer.
- Tests use `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync(ms)` so no real-world wall-clock time is consumed.
- `AgentStateManager.writeTopLevelState` is exercised for real against a per-test top-level state directory; each test's adwId state directory is removed in `afterEach` (scenario `@adw-462` mandates this cleanup). The write-error test uses `vi.spyOn` to inject a throwing first call.
- Existing `adws/core/__tests__/topLevelState.test.ts` continues to validate the atomic-write contract the heartbeat depends on — no change needed there.

### Edge Cases

- **Start called twice for the same adwId**: two independent handles, two independent tickers. The second `startHeartbeat` is not a no-op; callers who accidentally call `startHeartbeat` twice will produce double writes. This is acceptable for this slice (the orchestrator wiring calls `startHeartbeat` exactly once), and the shared wrapper in PRD slice #8 will be the place where idempotency is enforced if that ever matters.
- **Stop called before the first tick fires**: correct behavior — `clearInterval` succeeds, no writes occurred, no error thrown.
- **Stop called after the process started shutting down**: the `finally` block guarantees `stopHeartbeat` runs on normal exit, catch, and finally paths. If the process is killed with SIGKILL, the OS reclaims the timer automatically — no cleanup needed.
- **Write throws on a tick**: caught and logged; the next tick fires on schedule. Validated by Test D.
- **adwId with unusual characters**: the module does not touch filesystem paths directly — it calls `AgentStateManager.writeTopLevelState` which already handles path construction. No special-case handling needed here.
- **Interval smaller than 1ms**: Node will clamp — out of scope. The constant is 30_000.
- **`finally` runs before the `await` in main resolves**: `main()` is async; the finally runs when the async flow unwinds, i.e. after the awaited phases either resolve or throw. This is the standard JS try/catch/finally semantics — no timing subtlety.

## Acceptance Criteria

- [ ] `adws/core/heartbeat.ts` exports `startHeartbeat(adwId, intervalMs) → HeartbeatHandle` and `stopHeartbeat(handle)`.
- [ ] Tick interval and stale-threshold constants live in `adws/core/config.ts` with default values of 30_000 and 180_000 milliseconds respectively.
- [ ] The heartbeat module is purely a liveness ticker: it does not read or write any field other than `lastSeenAt` on the top-level state, and has zero imports from `phases/`, `workflowPhases`, or orchestrator-flow code.
- [ ] Each tick writes via `AgentStateManager.writeTopLevelState(adwId, { lastSeenAt: new Date().toISOString() })`, which is atomic via the writer upgraded in #461.
- [ ] `adwSdlc.tsx` calls `startHeartbeat` as the first statement inside the `try` block (after `initializeWorkflow` has returned) and calls `stopHeartbeat` in a new `finally` block that runs after the existing `catch`.
- [ ] Contract test `heartbeat.test.ts` asserts: `startHeartbeat` produces at least one `writeTopLevelState` call within `intervalMs * 1.5`; `stopHeartbeat` prevents further writes; `stopHeartbeat` is idempotent; a single write error does not kill the timer.
- [ ] `bunx tsc --noEmit -p adws/tsconfig.json` exits zero.
- [ ] `bun run test:unit` exits zero (new tests pass, existing tests unchanged).
- [ ] `bun run lint` exits zero.
- [ ] `bun run build` exits zero.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — lint the entire codebase, including the new `heartbeat.ts` and the edited `adwSdlc.tsx`.
- `bunx tsc --noEmit` — full-project type check.
- `bunx tsc --noEmit -p adws/tsconfig.json` — strict type check scoped to `adws/`.
- `bun run build` — build the project to verify no build errors.
- `bun run test:unit -- heartbeat` — run the new contract test on its own to confirm it passes.
- `bun run test:unit -- topLevelState` — re-run the existing atomic-write tests to confirm the heartbeat wiring has not regressed the schema slice.
- `bun run test:unit` — full unit suite to confirm no regressions anywhere else in the codebase.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-462"` — run any BDD scenarios tagged for this slice (the feature file is written in a later `scenario_writer` step, but running this command verifies no pre-existing scenario broke).
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — regression safety net.

## Notes

- `guidelines/coding_guidelines.md` must be followed: TypeScript strict mode, interfaces for data shapes, side effects at boundaries, files under 300 lines. The heartbeat module is ~50 lines and trivially satisfies all four; no existing code needs to be refactored.
- **Tracer-bullet scope**: only `adwSdlc` is wired. The other eleven orchestrators (`adwMerge`, `adwChore`, `adwBuild`, `adwInit`, `adwPatch`, `adwPlan`, `adwPlanBuild`, `adwPlanBuildDocument`, `adwPlanBuildReview`, `adwPlanBuildTest`, `adwPlanBuildTestReview`, `adwTest`) get wired in PRD slice #8 via a shared wrapper. Do not touch them in this slice.
- **`HEARTBEAT_STALE_THRESHOLD_MS` has no consumer in this slice.** It is added now so the future hung-orchestrator detector (PRD slice #9 or later) can consume it from `config.ts` without a dependency churn. This is explicitly not premature — the PRD mandates it as a co-located constant.
- **Idempotency of `stopHeartbeat`**: chosen deliberately so the `finally` block in `adwSdlc.tsx` doesn't need to null the handle after calling stop. Idempotent cleanup is the standard shape for lifecycle helpers (matches `withDevServer`'s implicit cleanup guarantees).
- **No environment-variable override for `HEARTBEAT_TICK_INTERVAL_MS` in this slice.** The PRD says operators should be able to tune "without code surgery"; at one-host-per-repo, a single-line const edit is arguably not code surgery. If the shared wrapper in slice #8 wants an env override, that's a one-line addition to `config.ts` then — no blocker here.
- **Library install**: no new dependencies. Everything (`setInterval`, `clearInterval`, `new Date().toISOString()`, `vitest` fake timers) is already available. Per `.adw/commands.md`, if a new library were needed the install command would be `bun add <package>`.
- **Future slice #8 (shared wrapper) will likely refactor the tracer-bullet wiring** out of `adwSdlc.tsx` into a shared `runOrchestrator(entrypoint, fn)` helper. That refactor replaces these three new lines; the `heartbeat` module itself remains untouched.
- **BDD scenarios** for this slice land in a follow-up `scenario_writer` step and will be tagged `@adw-462`. This plan does not enumerate them — that's the scenario agent's job — but the acceptance matrix above is the spec the scenarios will codify.
