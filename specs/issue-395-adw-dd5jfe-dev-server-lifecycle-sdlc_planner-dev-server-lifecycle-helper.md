# Feature: Dev Server Lifecycle Helper + Health Check Path Schema

## Metadata
issueNumber: `395`
adwId: `dd5jfe-dev-server-lifecycle`
issueJson: `{"number":395,"title":"dev server lifecycle helper + health check path schema","body":"## Parent PRD\n\n`specs/prd/test-review-refactor.md`\n\n## What to build\n\nAdd a new generic helper module `adws/core/devServerLifecycle.ts` exporting `withDevServer({ startCommand, port, healthPath, cwd }, work)`. The helper:\n\n- Spawns the start command in a detached process group (`spawn` with `detached: true`)\n- Substitutes `{PORT}` in the command string with the provided port\n- HTTP-probes the health path at 1-second intervals up to a 20-second timeout\n- Retries the start up to 3 times on failure\n- Falls back to running the wrapped work anyway after 3 failed start attempts\n- Kills the entire process group on cleanup via `process.kill(-pid, 'SIGTERM')`, escalating to SIGKILL after a grace period\n- Cleans up in a `finally` block even when the wrapped work throws\n\nAlso add `## Health Check Path` field to `adws/core/projectConfig.ts` schema with default `/`. Update parser tests.\n\nThis is a deep module: single function interface, internal complexity around spawn/probe/retry/kill. No consumers wired yet — pure infrastructure.\n\n## Acceptance criteria\n\n- [ ] `adws/core/devServerLifecycle.ts` exists exporting `withDevServer(config, work)`\n- [ ] `## Health Check Path` field added to `projectConfig.ts` `CommandsConfig` interface, parser, and defaults\n- [ ] Parser tests in `adws/core/__tests__/` verify the new field is read with default `/` when absent\n- [ ] Unit tests in `adws/core/__tests__/devServerLifecycle.test.ts` cover: port substitution into start command; HTTP probe loop respects 1s interval and 20s timeout; 3-retry behavior on probe failure; fallback runs the wrapped work after 3 failed starts; process group kill (not just PID); finally-block cleanup runs when wrapped work throws\n- [ ] Mocks `child_process.spawn`, global `fetch`, and `process.kill`\n- [ ] No production consumers yet (helper exists in isolation)\n\n## Blocked by\n\nNone - can start immediately\n\n## User stories addressed\n\n- User story 8\n- User story 9\n- User story 10\n- User story 11\n- User story 12\n- User story 13\n- User story 35\n- User story 38","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-04-08T12:03:13Z","comments":[],"actionableComment":null}`

## Feature Description
A generic dev server lifecycle helper that encapsulates spawning, health-probing, retrying, and cleanup of dev server processes. The helper exposes a single `withDevServer(config, work)` function that:

1. Spawns a dev server as a detached process group
2. Substitutes `{PORT}` in the start command with the provided port number
3. Probes a health endpoint at 1-second intervals with a 20-second timeout
4. Retries the full spawn+probe sequence up to 3 times on failure
5. Falls back to running the wrapped work even after 3 failed attempts (graceful degradation)
6. Kills the entire process group (not just PID) on cleanup, escalating from SIGTERM to SIGKILL
7. Guarantees cleanup in a `finally` block, even when the wrapped work throws

Additionally, a new `## Health Check Path` field is added to the `projectConfig.ts` schema with default `/`, enabling target repos to configure which endpoint the lifecycle helper probes.

This is a deep module: simple external interface, rich internal complexity. No consumers are wired yet — it exists as pure infrastructure for future test/scenario phases.

## User Story
As a workflow orchestrator
I want a reliable dev server lifecycle helper that handles spawning, health checking, retrying, and cleanup
So that future test and scenario phases can safely start and stop dev servers without leaking processes

## Problem Statement
ADW's current architecture has no centralised mechanism for managing dev server processes. When agents or phases need a running dev server (e.g. for BDD scenario execution against web apps), process lifecycle management is ad-hoc, leading to leaked processes (as seen in the `paysdoc.nl` worktree incident where a `next dev` process outlived its workflow). The absence of health checking means tests may run before the server is ready, and there is no retry/fallback logic for flaky server startups.

## Solution Statement
Introduce `adws/core/devServerLifecycle.ts` as a self-contained deep module that owns the full spawn→probe→retry→work→cleanup lifecycle. The function uses `child_process.spawn` with `detached: true` to create a process group, enabling reliable group-kill cleanup. Health probing uses HTTP fetch against a configurable path. The `{PORT}` placeholder in the start command supports dynamic port allocation (critical for parallel workflows). The 3-retry-then-fallback strategy ensures resilience without blocking work indefinitely. Extend `projectConfig.ts` to parse a new `## Health Check Path` heading from `.adw/commands.md`, defaulting to `/`.

## Relevant Files
Use these files to implement the feature:

- `adws/core/projectConfig.ts` — Contains the `CommandsConfig` interface, `HEADING_TO_KEY` mapping, `getDefaultCommandsConfig()` defaults, and `parseCommandsMd()` parser. Needs the new `healthCheckPath` field added to the interface, heading map, defaults, and parser.
- `adws/core/portAllocator.ts` — Existing port allocation utility. Reference for how ports are managed (the lifecycle helper receives ports, doesn't allocate them).
- `adws/core/__tests__/execWithRetry.test.ts` — Reference for existing test patterns: `vi.mock`, `vi.fn()`, `beforeEach` reset, `describe/it/expect` structure.
- `adws/core/__tests__/phaseRunner.test.ts` — Reference for hoisted mock patterns and complex test setup.
- `vitest.config.ts` — Test runner configuration; tests in `adws/**/__tests__/**/*.test.ts` are auto-discovered.
- `guidelines/coding_guidelines.md` — Coding guidelines that must be followed (modularity, immutability, type safety, strict mode, functional style).

### New Files
- `adws/core/devServerLifecycle.ts` — The new dev server lifecycle helper module.
- `adws/core/__tests__/devServerLifecycle.test.ts` — Unit tests for the lifecycle helper.
- `adws/core/__tests__/projectConfig.test.ts` — Unit tests for the new `healthCheckPath` field in the project config parser.

## Implementation Plan
### Phase 1: Foundation — Schema Extension
Extend `projectConfig.ts` to support the new `## Health Check Path` field. This is a small, backward-compatible change: add the field to the `CommandsConfig` interface, the heading-to-key map, and the defaults function. Write parser tests to verify the new field is correctly read and defaults to `/` when absent.

### Phase 2: Core Implementation — Dev Server Lifecycle Helper
Build the `withDevServer` function in a new `devServerLifecycle.ts` module. The function encapsulates:
- Command string preparation with `{PORT}` substitution
- Process spawning with `detached: true` and `shell: true`
- HTTP health probe loop (1s interval, 20s timeout)
- Retry logic (up to 3 start attempts)
- Graceful fallback (run work even after 3 failures)
- Process group cleanup (SIGTERM → grace period → SIGKILL)
- `finally`-block guarantee for cleanup

### Phase 3: Integration — Testing
Write comprehensive unit tests mocking `child_process.spawn`, global `fetch`, and `process.kill`. Tests cover all acceptance criteria: port substitution, probe timing, retry behavior, fallback, group kill, and finally-block cleanup. No production consumers are wired — this is pure infrastructure.

## Step by Step Tasks

### Step 1: Add `healthCheckPath` to `CommandsConfig` interface and defaults
- In `adws/core/projectConfig.ts`:
  - Add `healthCheckPath: string;` to the `CommandsConfig` interface (after `startDevServer`)
  - Add `'health check path': 'healthCheckPath'` to the `HEADING_TO_KEY` mapping
  - Add `healthCheckPath: '/'` to the `getDefaultCommandsConfig()` return object

### Step 2: Create projectConfig parser tests for `healthCheckPath`
- Create `adws/core/__tests__/projectConfig.test.ts`
- Test that `parseCommandsMd` reads `## Health Check Path` from markdown content and maps it to `healthCheckPath`
- Test that `healthCheckPath` defaults to `'/'` when the heading is absent
- Test that `healthCheckPath` defaults to `'/'` when content is empty
- Follow existing test patterns from `execWithRetry.test.ts` (vitest, describe/it/expect)

### Step 3: Run tests to verify projectConfig changes
- Run `bunx vitest run adws/core/__tests__/projectConfig.test.ts` to validate the parser tests pass

### Step 4: Create `adws/core/devServerLifecycle.ts`
- Export a `DevServerConfig` interface: `{ startCommand: string; port: number; healthPath: string; cwd: string; }`
- Export `withDevServer<T>(config: DevServerConfig, work: () => Promise<T>): Promise<T>`
- Internal implementation:
  - `substitutePort(command: string, port: number): string` — replaces `{PORT}` with port number
  - `spawnServer(command: string, cwd: string): ChildProcess` — spawns with `detached: true`, `shell: true`, `stdio: 'ignore'`
  - `probeHealth(url: string, intervalMs: number, timeoutMs: number): Promise<boolean>` — HTTP GET loop, resolves `true` on 2xx, `false` on timeout
  - `killProcessGroup(pid: number, graceMs: number): void` — sends `SIGTERM` to `-pid`, waits grace period, sends `SIGKILL` if still alive
  - Main `withDevServer` flow:
    1. Substitute port into command
    2. Loop up to 3 times: spawn → probe → break on success, kill + retry on failure
    3. If all 3 attempts fail, log warning and continue (fallback)
    4. Run `work()` in try block
    5. Kill process group in `finally` block (SIGTERM → grace → SIGKILL)
- Constants: `PROBE_INTERVAL_MS = 1000`, `PROBE_TIMEOUT_MS = 20000`, `MAX_START_ATTEMPTS = 3`, `KILL_GRACE_MS = 5000`

### Step 5: Create `adws/core/__tests__/devServerLifecycle.test.ts`
- Mock `child_process` (`spawn` returning a fake `ChildProcess` with `pid` and `on` handler)
- Mock global `fetch` for health probe simulation
- Mock `process.kill` for verifying group kill behavior
- Test cases:
  1. **Port substitution**: verifies `{PORT}` in command is replaced with the numeric port
  2. **Successful health probe**: spawn succeeds, fetch returns 200 within timeout → work runs → cleanup kills group
  3. **Health probe timeout**: fetch never returns 200 within 20s → retry triggered
  4. **3-retry behavior**: three consecutive probe failures → fallback runs work anyway
  5. **Process group kill**: verifies `process.kill(-pid, 'SIGTERM')` is called (negative PID = group kill)
  6. **SIGKILL escalation**: verifies SIGKILL is sent after grace period if process still alive
  7. **Finally-block cleanup when work throws**: work function throws → process group is still killed in finally
  8. **Finally-block cleanup on success**: work completes normally → process group is killed

### Step 6: Run all unit tests
- Run `bunx vitest run adws/core/__tests__/devServerLifecycle.test.ts` to validate lifecycle tests pass
- Run `bunx vitest run adws/core/__tests__/projectConfig.test.ts` to re-validate parser tests

### Step 7: Run full validation suite
- Run all validation commands listed below to ensure zero regressions

## Testing Strategy
### Unit Tests
Unit tests are enabled for this project (`.adw/project.md` confirms `## Unit Tests: enabled`).

**projectConfig parser tests** (`adws/core/__tests__/projectConfig.test.ts`):
- `parseCommandsMd` correctly reads `## Health Check Path` value
- `parseCommandsMd` defaults `healthCheckPath` to `'/'` when heading is absent
- `parseCommandsMd` defaults `healthCheckPath` to `'/'` for empty content

**devServerLifecycle tests** (`adws/core/__tests__/devServerLifecycle.test.ts`):
- Port substitution replaces `{PORT}` placeholder in start command
- HTTP probe loop runs at 1s intervals and respects 20s timeout
- 3-retry behavior on consecutive probe failures
- Fallback: work runs even after 3 failed start attempts
- Process group kill sends SIGTERM to negative PID (`-pid`)
- SIGKILL escalation after grace period
- Finally-block cleanup runs when wrapped work throws
- Finally-block cleanup runs on normal completion

### Edge Cases
- Start command contains multiple `{PORT}` occurrences — all should be substituted
- Spawn fails immediately (e.g. command not found) — should be caught and retried
- `work()` throws synchronously — finally block must still run cleanup
- Process has already exited when cleanup runs — `process.kill` ESRCH error should be caught silently
- Health endpoint returns non-2xx status — treated as probe failure
- `fetch` itself throws (network error) — treated as probe failure

## Acceptance Criteria
- [ ] `adws/core/devServerLifecycle.ts` exists and exports `withDevServer(config, work)`
- [ ] `DevServerConfig` interface is exported with `startCommand`, `port`, `healthPath`, `cwd` fields
- [ ] `{PORT}` placeholder substitution works in the start command
- [ ] HTTP probe runs at 1-second intervals with 20-second timeout
- [ ] Start is retried up to 3 times on probe failure
- [ ] After 3 failed starts, wrapped work runs anyway (fallback)
- [ ] Process group is killed via `process.kill(-pid, 'SIGTERM')`, not just the PID
- [ ] SIGTERM escalates to SIGKILL after a grace period
- [ ] Cleanup runs in a `finally` block even when work throws
- [ ] `## Health Check Path` field added to `CommandsConfig` interface with `healthCheckPath: string`
- [ ] `HEADING_TO_KEY` mapping includes `'health check path': 'healthCheckPath'`
- [ ] `getDefaultCommandsConfig()` returns `healthCheckPath: '/'`
- [ ] Parser tests verify the new field is read and defaults correctly
- [ ] Unit tests cover all specified scenarios (port substitution, probe loop, retry, fallback, group kill, finally cleanup)
- [ ] All mocks use `child_process.spawn`, global `fetch`, and `process.kill`
- [ ] No production consumers wired — helper exists in isolation

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bunx vitest run adws/core/__tests__/projectConfig.test.ts` — Run parser tests for the new `healthCheckPath` field
- `bunx vitest run adws/core/__tests__/devServerLifecycle.test.ts` — Run lifecycle helper unit tests
- `bunx vitest run` — Run full Vitest suite to verify zero regressions
- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Type check root project
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type check adws sub-project

## Notes
- Follow `guidelines/coding_guidelines.md` strictly: strict TypeScript, functional style, immutability, pure functions for internal logic, side effects at boundaries.
- The `withDevServer` function is a deep module per the project's design philosophy: one simple interface hiding spawn/probe/retry/kill complexity.
- The `{PORT}` placeholder pattern (not env var) was a deliberate decision from the 2026-04-08 grill-me session — it supports parallel workflows with dynamic ports.
- The existing `portAllocator.ts` handles port allocation separately; the lifecycle helper receives an already-allocated port.
- No consumers are wired in this PR — a future issue will integrate the helper into the scenario test phase.
- Process group kill (`-pid`) is critical: the dev server may spawn child processes (e.g. Next.js spawns multiple workers), and killing just the parent PID would leak children.
- The fallback behavior (run work after 3 failures) is intentional: some workflows may partially succeed even without a running dev server, and hard-failing would block the entire pipeline.
