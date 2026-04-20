# Feature: processLiveness deep module (PID + start-time authoritative liveness)

## Metadata
issueNumber: `456`
adwId: `xlv8zk-orchestrator-resilie`
issueJson: `{"number":456,"title":"orchestrator-resilience: processLiveness module","body":"## Parent PRD\n\n`specs/prd/orchestrator-coordination-resilience.md`\n\n## What to build\n\nBuild the `processLiveness` deep module that provides authoritative PID-plus-start-time liveness. Replace all ad-hoc `isProcessAlive` callers across `spawnGate` and `agentState` with the new interface. This closes the PID-reuse-after-reboot hole — a liveness check now requires both `kill -0` success AND an exact start-time match. See \"New modules to build → processLiveness\" in the PRD.\n\n## Acceptance criteria\n\n- [ ] `adws/core/processLiveness.ts` exports `getProcessStartTime(pid)` and `isProcessLive(pid, recordedStartTime)`\n- [ ] Linux path reads `/proc/<pid>/stat` field 22\n- [ ] macOS/BSD fallback shells out to `ps -o lstart= -p <pid>`\n- [ ] Windows is explicitly unsupported (documented, not an error surface)\n- [ ] All existing `isProcessAlive` callers in `spawnGate` and `agentState` migrated to `processLiveness.isProcessLive`\n- [ ] Unit tests cover: alive with matching start-time, alive with mismatched start-time (PID reuse), dead process, non-existent PID\n- [ ] Tests use fake `/proc` reads or a mocked `ps` child-process — no real-PID assertions\n\n## Blocked by\n\nNone - can start immediately.\n\n## User stories addressed\n\n- User story 12\n- User story 22","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-04-20T11:04:10Z","comments":[],"actionableComment":null}`

## Feature Description

Introduce `adws/core/processLiveness.ts`, a deep module that answers the question "is this specific process still running?" with enough precision that PID reuse after a reboot or long uptime cannot be mistaken for liveness. Today the codebase uses a thin `isProcessAlive(pid)` helper that only calls `process.kill(pid, 0)`. That check returns `true` whenever *any* process currently owns the PID — including an unrelated process that happens to inherit the PID after the original orchestrator died and the OS recycled it. The new module pairs `kill -0` with the process start-time so liveness returns `true` only when the PID is alive AND its start-time exactly matches a value recorded when the orchestrator was launched.

The module is a pure deep module in Ousterhout's sense: a small public surface (two functions) over a complex platform-dependent implementation (a `/proc/<pid>/stat` reader on Linux and a `ps -o lstart=` fallback on macOS/BSD). All ad-hoc `isProcessAlive` callers in `spawnGate` and `agentState` are migrated to the new interface so the PID-reuse hole is closed at the source — not per call-site. Windows is explicitly not supported; ADW already does not run on Windows and the module surfaces that by returning `null`/`false` in a documented, non-throwing way.

## User Story

As an ADW developer, I want PID reuse across process restarts to be impossible to mistake for liveness, so that an orchestrator that died after a reboot doesn't look alive just because some unrelated process inherited its PID. (User story 12)

As an ADW developer, I want the deep `processLiveness` module to have its logic fully covered by unit tests using injected dependencies, so that refactors don't silently break recovery behavior. (User story 22)

## Problem Statement

`adws/core/stateHelpers.ts` exports `isProcessAlive(pid)` which calls `process.kill(pid, 0)` and returns `true` on success. This is consumed directly by:

- `adws/triggers/spawnGate.ts:71` — stale-lock detection in `acquireIssueSpawnLock`. A lock file whose recorded `pid` is "alive" blocks a new orchestrator; if the recorded PID has been recycled by the OS to an unrelated process, the lock looks live forever and the issue stalls.
- `adws/core/agentState.ts:309,313,323` and `adws/core/stateHelpers.ts:126` — `isAgentProcessRunning(adwId)` reads `state.pid` and calls `isProcessAlive(pid)`. Same recycled-PID hazard: an externally-visible orchestrator-liveness query can report "alive" for a process that died a reboot ago.

Because the underlying primitive cannot distinguish "the same process" from "any process with this PID", every recovery/coordination path built on top of it inherits the same false-positive mode. The PRD calls out this exact gap ("PID+start-time tuple is the truth of 'is this process alive'") and specifies `processLiveness` as the single module that replaces all ad-hoc `isProcessAlive` calls across `spawnGate` and `agentState`.

## Solution Statement

Build a deep module `adws/core/processLiveness.ts` with exactly two exported functions:

- `getProcessStartTime(pid: number): string | null` — returns a platform-appropriate start-time token for `pid`, or `null` if the process does not exist or the platform is unsupported.
- `isProcessLive(pid: number, recordedStartTime: string): boolean` — returns `true` iff `kill -0 pid` succeeds AND `getProcessStartTime(pid)` returns a string exactly equal to `recordedStartTime`.

Platform implementation is a single internal dispatch inside the module:

- **Linux**: read `/proc/<pid>/stat` synchronously and extract field 22 (the process start-time in clock ticks since boot). Field 22 is robust to executable names containing spaces/parentheses because the reader anchors on the final `)` of the `comm` field before tokenizing.
- **macOS/BSD**: shell out to `ps -o lstart= -p <pid>` via `execFileSync` and return the trimmed stdout. The `-o lstart=` format is stable and contains start timestamp like `Mon Apr 20 10:15:23 2026`.
- **Windows**: return `null` from `getProcessStartTime`, which makes `isProcessLive` return `false` for any comparison. A single top-of-file JSDoc comment documents the constraint. No throw; Windows callers simply get "not live".

The dispatch key is `process.platform`. All file reads and child-process invocations are injected via an internal dependency object so unit tests can supply fakes (fake `/proc` reads, mocked `ps` child-process) without touching real PIDs. The module has no external state and no side effects beyond the read/exec calls it dispatches.

Migration of the two call-site groups:

- **`spawnGate.ts`**: extend `IssueSpawnLockRecord` with `pidStartedAt: string` (written at acquisition using `getProcessStartTime(ownPid)`). The stale-lock branch calls `processLiveness.isProcessLive(existing.pid, existing.pidStartedAt)`. Existing lock records without `pidStartedAt` are treated as stale (defensive: an old-format record signals the lock was created before the migration and should be reclaimed). Backwards-compatibility shim is explicitly not introduced — the lock is short-lived and stale records self-heal.
- **`agentState.ts` / `stateHelpers.ts`**: `isAgentProcessRunning(adwId)` reads `state.pid` and `state.pidStartedAt` from the top-level orchestrator state file and calls `processLiveness.isProcessLive(state.pid, state.pidStartedAt)`. When `state.pidStartedAt` is absent (older state files), the function returns `false` — consistent with the new invariant that liveness requires the full tuple. `AgentState.pidStartedAt?: string` is added to the type to let writers record it (the write-side migration across orchestrators is scoped to subsequent PRD issues; this issue only wires the read-side to use the new contract and exposes the field for writers). The old `isProcessAlive` export is kept as a transitional alias pointing at `process.kill(pid, 0)` only inside `cronProcessGuard.ts`, `cancelHandler.ts`, `trigger_shutdown.ts`, `devServerJanitor.ts`, and `workflowCommentsBase.ts` — those call sites are explicitly out of scope per the issue's acceptance criteria (only `spawnGate` and `agentState` callers migrate in this issue).

## Relevant Files

Use these files to implement the feature:

- `specs/prd/orchestrator-coordination-resilience.md` — Parent PRD. The "New modules to build → processLiveness" section and "Testing Decisions → processLiveness" section specify the exact contract, platform dispatch, and test matrix for this module.
- `adws/core/stateHelpers.ts` — Currently defines `isProcessAlive(pid)` (lines 24–31) and `isAgentProcessRunning(adwId)` (lines 126–134). The `isAgentProcessRunning` body reads `state.pid` and calls `isProcessAlive`; it will be updated to also read `state.pidStartedAt` and delegate to `processLiveness.isProcessLive`.
- `adws/core/agentState.ts` — Exposes `isProcessAlive`/`isAgentProcessRunning` as static methods on `AgentStateManager` (lines 309, 313) and as named re-exports (line 323). Migrated to expose the new `processLiveness` API surface alongside (or replacing) the old one.
- `adws/core/index.ts` — Re-exports `isProcessAlive`, `isAgentProcessRunning` from `./agentState` (lines 80–82). Needs to export the new `processLiveness` primitives so consumers outside `adws/core/` can import them cleanly.
- `adws/triggers/spawnGate.ts` — Single `isProcessAlive(existing.pid)` call at line 71. `IssueSpawnLockRecord` (lines 8–13) currently has only `pid`; will be extended with `pidStartedAt`. `acquireIssueSpawnLock` (lines 51–79) will record the current process start-time at acquisition and use `processLiveness.isProcessLive` for the stale-lock branch.
- `adws/triggers/__tests__/spawnGate.test.ts` — Vitest suite (lines 9–132) mocks `isProcessAlive` from `../../core/stateHelpers`. Will be updated to mock `processLiveness.isProcessLive` instead and assert that `pidStartedAt` is recorded on the lock record.
- `adws/types/agentTypes.ts` — `AgentState` interface (lines 202–231) currently has `pid?: number` (line 214). Will add `pidStartedAt?: string` alongside it (this is the only schema change in scope; the broader `lastSeenAt` / `branchName` schema extension from the PRD is out of scope for this issue).
- `adws/triggers/cronProcessGuard.ts`, `adws/triggers/cancelHandler.ts`, `adws/triggers/trigger_shutdown.ts`, `adws/triggers/devServerJanitor.ts`, `adws/github/workflowCommentsBase.ts` — Out-of-scope call sites that still use `isProcessAlive`. Referenced only to confirm migration boundary; not modified in this issue.
- `guidelines/coding_guidelines.md` — TypeScript strict mode, no `any`, interfaces for data shapes, pure functions with side effects at boundaries. The new module is built to these rules.
- `adws/core/__tests__/execWithRetry.test.ts` (lines 1–60) — Prior art for mocking `child_process` in Vitest (`vi.mock('child_process', …)`).
- `adws/triggers/__tests__/spawnGate.test.ts` (lines 1–132) — Prior art for mocking `stateHelpers` and asserting lock-record fields.
- `adws/core/portAllocator.ts` — Prior art for a thin, pure utility module in `adws/core/` with side effects isolated behind a small public surface.

### New Files

- `adws/core/processLiveness.ts` — The deep module. Exports `getProcessStartTime(pid)` and `isProcessLive(pid, recordedStartTime)` plus a `ProcessLivenessDeps` interface used for injection in tests. Internal functions `readLinuxStartTime(pid, readFile)` and `readPsLstart(pid, exec)` implement the two platform branches.
- `adws/core/__tests__/processLiveness.test.ts` — Vitest unit test file covering the four acceptance-criteria matrix cells (alive-match, alive-mismatch, dead, non-existent) across both platform branches, plus Windows-unsupported behavior. Uses injected fakes for `/proc` reads and the `ps` child-process.

## Implementation Plan

### Phase 1: Foundation

Land the schema change to `AgentState` so downstream writers can record `pidStartedAt` without a follow-up migration. Add the `processLiveness` module with its full two-function public surface and the platform dispatch (Linux → `/proc`, macOS/BSD → `ps`, Windows → `null`). Keep the module self-contained: only `fs` and `child_process` as dependencies, both injected via a `ProcessLivenessDeps` shape so tests substitute fakes cleanly. No call-site changes yet — the module stands alone and passes its own tests first.

### Phase 2: Core Implementation

Write the full unit-test matrix for `processLiveness` first (RED), then land the implementation (GREEN). The tests exercise the public surface — `isProcessLive(pid, recordedStartTime)` — and drive behavior by swapping in fake `readFileSync`/`execFileSync` implementations:

- Linux alive-matching: fake `/proc/<pid>/stat` returns a stat line whose field 22 equals the recorded value → `true`.
- Linux alive-mismatch (PID reuse): fake returns a different field 22 → `false`.
- Linux dead: fake throws `ENOENT` → `false`.
- macOS alive-matching: fake `execFileSync` returns the recorded `lstart` string → `true`.
- macOS alive-mismatch: fake returns a different `lstart` string → `false`.
- macOS dead: fake throws (process not found) → `false`.
- Windows: dispatch returns `null` from `getProcessStartTime`; `isProcessLive` returns `false` regardless of inputs.
- Non-existent PID (independent of platform): `kill -0` throws → `isProcessLive` returns `false` before start-time comparison.

### Phase 3: Integration

Migrate the two in-scope call-site groups (`spawnGate`, `agentState`/`stateHelpers`) to the new interface:

- `spawnGate.ts`: extend `IssueSpawnLockRecord` with `pidStartedAt: string`, capture `getProcessStartTime(ownPid)` at acquisition, and replace the stale-lock `isProcessAlive(existing.pid)` branch with `processLiveness.isProcessLive(existing.pid, existing.pidStartedAt)`. A lock record missing `pidStartedAt` is treated as stale (force-reclaimed). Update `adws/triggers/__tests__/spawnGate.test.ts` to mock `processLiveness` instead of `stateHelpers.isProcessAlive` and assert the new field is recorded.
- `stateHelpers.ts`: `isAgentProcessRunning(adwId)` reads `state.pid` AND `state.pidStartedAt`; when both are present, delegates to `processLiveness.isProcessLive`; when `pidStartedAt` is missing, returns `false`. Mark `isProcessAlive` as `@deprecated — use isProcessLive from adws/core/processLiveness` in its JSDoc so out-of-scope consumers know the direction of travel without forcing a breaking migration in this issue.
- `agentState.ts`: remove the `static isProcessAlive = _isProcessAlive` assignment on `AgentStateManager`; add `static isProcessLive` and `static getProcessStartTime` pointing at the `processLiveness` functions. Remove the `isProcessAlive` named re-export at line 323 (after confirming no other in-repo imports). Add a re-export of `isProcessLive`/`getProcessStartTime`.
- `adws/core/index.ts`: export `isProcessLive`, `getProcessStartTime` from `./agentState` alongside the existing `isAgentProcessRunning` re-export. Remove `isProcessAlive` from the index re-exports.
- `adws/types/agentTypes.ts`: add `pidStartedAt?: string` to the `AgentState` interface next to `pid?: number`, with a JSDoc noting "Start-time token recorded at orchestrator launch; paired with `pid` for PID-reuse-safe liveness checks via `processLiveness.isProcessLive`".

Run the full unit-test suite and type-check to confirm the migration is clean. The out-of-scope `isProcessAlive` callers (`cronProcessGuard`, `cancelHandler`, `trigger_shutdown`, `devServerJanitor`, `workflowCommentsBase`) continue to import `isProcessAlive` directly from `./stateHelpers`; they are explicitly deferred to later PRD issues.

## Step by Step Tasks
Execute every step in order, top to bottom.

### 1. Extend AgentState schema with pidStartedAt
- Open `adws/types/agentTypes.ts`.
- Locate the `AgentState` interface (starts at line 202).
- Add a new optional field `pidStartedAt?: string` immediately after `pid?: number` at line 214.
- Add a JSDoc comment on the field: `/** Platform start-time token (Linux /proc stat field 22, or macOS ps -o lstart=) recorded at orchestrator launch. Paired with pid for PID-reuse-safe liveness via processLiveness.isProcessLive. */`
- Run `bunx tsc --noEmit -p adws/tsconfig.json` — expect zero errors (field is optional, no existing writers break).

### 2. Create the processLiveness module skeleton
- Create `adws/core/processLiveness.ts`.
- Import `readFileSync` from `fs` and `execFileSync` from `child_process`.
- Define a `ProcessLivenessDeps` interface with `readFile: (path: string) => string` and `execPs: (pid: number) => string` fields, both of which may throw.
- Define and export a `defaultDeps: ProcessLivenessDeps` constant wrapping `readFileSync` and `execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf-8' })`.
- Export `getProcessStartTime(pid: number, deps: ProcessLivenessDeps = defaultDeps): string | null`.
- Export `isProcessLive(pid: number, recordedStartTime: string, deps: ProcessLivenessDeps = defaultDeps): boolean`.
- Leave bodies as `throw new Error('not implemented')` stubs for now (GREEN step follows tests).

### 3. Write the processLiveness unit tests (RED)
- Create `adws/core/__tests__/processLiveness.test.ts`.
- Mock `process.platform` to `'linux'` / `'darwin'` / `'win32'` per test via `Object.defineProperty(process, 'platform', { value: ..., configurable: true })` inside `beforeEach` / `afterEach`.
- Mock `process.kill` to throw / return based on a per-test flag controlling "does the PID exist".
- For each platform, pass a fake `ProcessLivenessDeps` via the function signature.
- Tests to write (all should fail against the stub implementation):
  - Linux: `isProcessLive` returns `true` when `kill -0` succeeds AND fake `/proc/<pid>/stat` field 22 equals the recorded value.
  - Linux: `isProcessLive` returns `false` when `kill -0` succeeds but field 22 differs from the recorded value (PID reuse).
  - Linux: `isProcessLive` returns `false` when fake `readFile` throws `ENOENT` (dead process).
  - Linux: `isProcessLive` returns `false` when `kill -0` throws (non-existent PID) — `readFile` must not be called.
  - Linux: `/proc/<pid>/stat` parser correctly extracts field 22 when the `comm` name contains spaces and parentheses (e.g. `"1234 (my (nested) comm) S 1 ..."`).
  - macOS: `isProcessLive` returns `true` when fake `execPs` returns the recorded `lstart` string.
  - macOS: `isProcessLive` returns `false` when `execPs` returns a different `lstart` string.
  - macOS: `isProcessLive` returns `false` when `execPs` throws (process not found).
  - Windows: `getProcessStartTime(pid)` returns `null`; `isProcessLive(pid, any)` returns `false`.
  - `getProcessStartTime(pid)` and `isProcessLive(pid, recordedStartTime)` with a non-existent PID both surface cleanly (return `null` / `false`, never throw).
- Run `bun run test:unit -- processLiveness` — expect failures on all tests (module is a stub).

### 4. Implement the Linux branch
- In `processLiveness.ts`, add an internal `readLinuxStartTime(pid: number, deps: ProcessLivenessDeps): string | null`:
  - Read `/proc/<pid>/stat` via `deps.readFile`. Catch any throw and return `null`.
  - Parse the content: anchor on the *last* occurrence of `)` in the string (this correctly handles `comm` names containing `)`). Split the post-`)` substring on whitespace. Field 22 of the overall stat line is index 19 of that post-`)` split (positions 1 and 2 were consumed by pid and comm; the remaining fields are 3…N).
  - Return the field as a string (do not coerce to number — start-time in clock ticks is opaque to this module).

### 5. Implement the macOS/BSD branch
- Add `readPsLstart(pid: number, deps: ProcessLivenessDeps): string | null`:
  - Call `deps.execPs(pid)` inside a try/catch. On throw, return `null`.
  - Trim the stdout. If empty, return `null`. Otherwise return the trimmed value.

### 6. Wire platform dispatch and implement the two public functions
- `getProcessStartTime(pid, deps)`:
  - Switch on `process.platform`: `'linux'` → `readLinuxStartTime`; `'darwin' | 'freebsd' | 'openbsd' | 'netbsd'` → `readPsLstart`; default → return `null` (Windows and any unknown platform).
- `isProcessLive(pid, recordedStartTime, deps)`:
  - First check `process.kill(pid, 0)` inside try/catch. If it throws → return `false` (no lookup needed).
  - Call `getProcessStartTime(pid, deps)`. If it returns `null` → return `false`.
  - Return `currentStartTime === recordedStartTime`.
- Add a single top-of-file JSDoc block documenting Windows-unsupported status and the PID-reuse hazard this module closes.
- Rerun `bun run test:unit -- processLiveness` — all tests should now pass (GREEN).

### 7. Migrate spawnGate
- Open `adws/triggers/spawnGate.ts`.
- Replace `import { isProcessAlive } from '../core/stateHelpers';` with `import { getProcessStartTime, isProcessLive } from '../core/processLiveness';`.
- Extend `IssueSpawnLockRecord` with `readonly pidStartedAt: string;`.
- In `acquireIssueSpawnLock`, compute `const pidStartedAt = getProcessStartTime(ownPid) ?? '';` before building the record. Include `pidStartedAt` in the record literal at line 55.
- Replace the line-71 branch:
  - Old: `if (isProcessAlive(existing.pid)) { ... return false; }`.
  - New: `if (existing.pidStartedAt && isProcessLive(existing.pid, existing.pidStartedAt)) { ... return false; }`.
- Leave the log message and the `tryExclusiveCreate` retry on stale lock unchanged.

### 8. Update the spawnGate tests
- Open `adws/triggers/__tests__/spawnGate.test.ts`.
- Replace `vi.mock('../../core/stateHelpers', () => ({ isProcessAlive: vi.fn() }));` with `vi.mock('../../core/processLiveness', () => ({ getProcessStartTime: vi.fn().mockReturnValue('fake-start-time-123'), isProcessLive: vi.fn() }));`.
- Update the imports accordingly (`import { getProcessStartTime, isProcessLive } from '../../core/processLiveness';` and `const mockIsProcessLive = vi.mocked(isProcessLive);`).
- Update the four tests that currently set `mockIsProcessAlive.mockReturnValue(...)` to set `mockIsProcessLive.mockReturnValue(...)`.
- Update the "second acquire while first holder PID is alive" test to seed both `pid` and `pidStartedAt` on the seeded lock file.
- Update the first-acquire assertion at lines 40–51: add `expect(record.pidStartedAt).toBe('fake-start-time-123');`.
- Update the stale-reclaim test at lines 62–73: seed a lock with `pidStartedAt: 'old-start-time'`, set `mockIsProcessLive.mockReturnValue(false)`, assert reclaim.
- Add a new test: "second acquire when stored pidStartedAt differs from live process start time (PID reuse) reclaims stale lock and succeeds". Seed a lock with `pid: 12345, pidStartedAt: 'old-boot-era'`, set `mockIsProcessLive.mockReturnValue(false)`, verify reclaim.
- Add a new test: "lock record missing pidStartedAt is treated as stale". Manually write a lock file with only `pid` and `startedAt` (no `pidStartedAt`), call `acquireIssueSpawnLock`, assert it reclaims.
- Run `bun run test:unit -- spawnGate` — all tests pass.

### 9. Migrate agentState and stateHelpers
- Open `adws/core/stateHelpers.ts`.
- Mark `isProcessAlive` with `/** @deprecated Use `isProcessLive` from `adws/core/processLiveness`. Kept for out-of-scope call sites pending migration in subsequent issues. */` above its definition.
- Update `isAgentProcessRunning(adwId)`:
  - After reading `state`, extract both `state.pid` and `state.pidStartedAt`.
  - If either is missing → return `false`.
  - Otherwise return `isProcessLive(state.pid as number, state.pidStartedAt as string)`.
  - Import `isProcessLive` from `./processLiveness` at the top of the file.
- Open `adws/core/agentState.ts`.
- Add `import { getProcessStartTime, isProcessLive } from './processLiveness';` at the top.
- Remove `isProcessAlive as _isProcessAlive,` from the `./stateHelpers` import block at lines 17–22.
- Remove `static isProcessAlive = _isProcessAlive;` at line 309.
- Add `static getProcessStartTime = getProcessStartTime;` and `static isProcessLive = isProcessLive;` to the class.
- Update the final re-export line (line 323): replace `export { isProcessAlive, findOrchestratorStatePath, isAgentProcessRunning } from './stateHelpers';` with `export { findOrchestratorStatePath, isAgentProcessRunning } from './stateHelpers'; export { getProcessStartTime, isProcessLive } from './processLiveness';`.

### 10. Update the core barrel export
- Open `adws/core/index.ts`.
- In the "Agent State Management" export block (lines 72–83): remove `isProcessAlive,` and add `getProcessStartTime,` and `isProcessLive,`.
- Verify `isAgentProcessRunning` is still exported (consumed by `adws/github/workflowCommentsBase.ts`).

### 11. Verify the out-of-scope consumers still compile
- Run `bunx tsc --noEmit -p adws/tsconfig.json`.
- Expect the out-of-scope direct importers of `isProcessAlive` from `../core/stateHelpers` (`adws/triggers/cronProcessGuard.ts`, `adws/triggers/cancelHandler.ts`, `adws/triggers/trigger_shutdown.ts`) to continue compiling — they import directly from `stateHelpers.ts`, which still exports the (deprecated) symbol.
- Expect `adws/github/workflowCommentsBase.ts` (which calls `AgentStateManager.isAgentProcessRunning(adwId)`) to continue compiling — the method is preserved.
- Expect the test file `adws/triggers/__tests__/cancelHandler.test.ts` to continue compiling — it imports from `stateHelpers`.

### 12. Run the full validation suite
- Run every command listed under `## Validation Commands` below.
- Fix any regressions surfaced by type-check, lint, or the existing unit tests.
- Confirm the two acceptance-criteria matrix cells unique to this issue are covered by the new test file: (a) alive-with-matching-start-time returns `true`, (b) alive-with-mismatched-start-time returns `false`.

## Testing Strategy

### Unit Tests

`.adw/project.md` contains `## Unit Tests: enabled`, so unit tests are required.

The new `adws/core/__tests__/processLiveness.test.ts` Vitest suite covers the four acceptance-criteria matrix cells for both Linux and macOS code paths, plus the Windows-unsupported case. Tests use injected `ProcessLivenessDeps` fakes rather than real `/proc` reads or real `ps` invocations, so they run deterministically in any CI environment. `process.platform` and `process.kill` are mocked per test to control the dispatch branch and the `kill -0` outcome.

The existing `adws/triggers/__tests__/spawnGate.test.ts` is updated to mock `processLiveness.isProcessLive` (replacing the `stateHelpers.isProcessAlive` mock). New cases cover the PID-reuse-after-reboot scenario (recorded `pidStartedAt` differs from current start-time → lock is reclaimed) and the backward-incompatible case (lock record with no `pidStartedAt` → treated as stale). This is the tight feedback loop the PRD's testing section calls for ("tests that inspect private state or match on specific implementation details are avoided") — assertions are on observable return values and the resulting lock-file record shape.

No new test file is needed for `agentState.ts` or `stateHelpers.ts`: `isAgentProcessRunning` is exercised indirectly by consumers whose own tests mock at the right seam; adding a direct test here would duplicate coverage and require the same `processLiveness` mock already used in `spawnGate.test.ts`. If a future issue introduces a direct consumer, its own test file can mock `processLiveness` at that seam.

### Edge Cases

- **PID reuse after reboot**: same numeric PID, different start-time string → `isProcessLive` returns `false`, spawn lock reclaimed.
- **Non-existent PID**: `process.kill(pid, 0)` throws `ESRCH` → `isProcessLive` returns `false` without reading `/proc` or calling `ps`.
- **Linux `/proc/<pid>/stat` with parentheses in comm**: parser anchors on the *last* `)` to correctly split the line (regression guard for commands like `"1234 (bun (agent)) S 1 ..."`).
- **macOS `ps` stderr noise**: `execPs` throws on stderr → caught → `getProcessStartTime` returns `null` → `isProcessLive` returns `false`.
- **Windows platform**: `getProcessStartTime` returns `null` without reading `/proc` or attempting to exec `ps`; `isProcessLive` returns `false` for any input.
- **Lock record missing `pidStartedAt`** (old format written before this change): treated as stale, force-reclaimed.
- **Empty `recordedStartTime` string**: `isProcessLive(pid, '')` returns `false` (no match possible against a non-empty platform start-time token).
- **State file with `pid` but no `pidStartedAt`**: `isAgentProcessRunning` returns `false` (consistent with the new invariant that liveness requires the full tuple).

## Acceptance Criteria

- [ ] `adws/core/processLiveness.ts` exists and exports `getProcessStartTime(pid)` and `isProcessLive(pid, recordedStartTime)`.
- [ ] Linux branch reads `/proc/<pid>/stat` and extracts field 22, with correct handling of `comm` names containing `)`.
- [ ] macOS/BSD branch shells out to `ps -o lstart= -p <pid>` and returns the trimmed stdout.
- [ ] Windows is explicitly unsupported: `getProcessStartTime` returns `null`, `isProcessLive` returns `false`, no throw on any input. Documented in the module's top-of-file JSDoc.
- [ ] All existing `isProcessAlive` callers in `adws/triggers/spawnGate.ts` and `adws/core/agentState.ts` (including the `stateHelpers.isAgentProcessRunning` helper that `agentState` re-exports) are migrated to use `processLiveness.isProcessLive`.
- [ ] `IssueSpawnLockRecord` records `pidStartedAt`; `acquireIssueSpawnLock` captures it at lock creation; stale-lock detection compares both `pid` and `pidStartedAt`.
- [ ] `AgentState.pidStartedAt?: string` is added to the type.
- [ ] `adws/core/__tests__/processLiveness.test.ts` covers: alive with matching start-time, alive with mismatched start-time (PID reuse), dead process, non-existent PID — for both Linux and macOS branches, plus Windows.
- [ ] All tests use fake `/proc` reads or a mocked `ps` child-process via the `ProcessLivenessDeps` injection seam; no real-PID assertions.
- [ ] `adws/triggers/__tests__/spawnGate.test.ts` is updated to mock `processLiveness.isProcessLive` and passes.
- [ ] `bunx tsc --noEmit -p adws/tsconfig.json` reports zero errors.
- [ ] `bun run lint`, `bun run test:unit`, and `bun run build` all succeed.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun install` — Ensure dependencies are fresh.
- `bun run lint` — Lint the repo; expect zero errors.
- `bunx tsc --noEmit` — Root type check; expect zero errors.
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW type check; expect zero errors.
- `bun run test:unit -- processLiveness` — Run the new `processLiveness` suite; expect all cases to pass.
- `bun run test:unit -- spawnGate` — Run the updated `spawnGate` suite; expect all cases to pass including the two new PID-reuse / missing-`pidStartedAt` cases.
- `bun run test:unit` — Full unit-test suite; expect zero regressions.
- `bun run build` — Expect zero build errors.

## Notes

- **Guidelines**: The module follows `guidelines/coding_guidelines.md` — strict TypeScript (no `any`), explicit interfaces for `ProcessLivenessDeps`, pure functions with side effects at the boundary (the `readFile` and `execPs` dependencies are the only side-effect surfaces), and JSDoc on the public API.
- **Library install command**: None — the module only uses built-in Node APIs (`fs`, `child_process`). No `bun add` needed.
- **Scope boundary**: Only `isProcessAlive` callers in `spawnGate` and `agentState` (and its `stateHelpers` helper) migrate in this issue. The other five call sites (`cronProcessGuard`, `cancelHandler`, `trigger_shutdown`, `devServerJanitor`, `workflowCommentsBase`) continue to import `isProcessAlive` directly from `stateHelpers.ts` and are deferred to subsequent PRD issues. The `@deprecated` tag on `isProcessAlive` marks the direction of travel without breaking those consumers.
- **Schema extension scope**: Only `AgentState.pidStartedAt` is added in this issue. The broader schema extensions (`lastSeenAt`, `branchName`) and the full write-side migration across orchestrators (so every state write records `pidStartedAt`) are separate PRD issues. Consequently, `isAgentProcessRunning` returns `false` for state files that don't yet carry `pidStartedAt` — this is the safe default that preserves the new invariant (liveness requires the full tuple) and self-heals as writers are migrated.
- **Platform tokens are opaque**: The module does not interpret the start-time value. Linux gives clock-ticks-since-boot; macOS gives a human-readable `lstart` string. The module only compares recorded vs. current as strings. This keeps the implementation deep and the interface narrow — exactly the shape the PRD specifies.
- **No `any` in dependency injection**: `ProcessLivenessDeps` is a plain interface with typed functions; tests construct concrete fakes. This aligns with the strict-mode guideline.
- **Why no integration test**: The PRD's "integration tests" section covers changes to `adwMerge.test.ts`, `cronStageResolver.test.ts`, and `cronIssueFilter.test.ts` — none of which exercise `processLiveness` directly. The unit tests on `processLiveness` and the updated `spawnGate` tests provide full observable-behavior coverage for this issue's scope.
- **File size**: Both new files (module and test) fit well under the 300-line guideline.
