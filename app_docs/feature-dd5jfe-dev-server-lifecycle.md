# Dev Server Lifecycle Helper

**ADW ID:** dd5jfe-dev-server-lifecycle
**Date:** 2026-04-08
**Specification:** specs/issue-395-adw-dd5jfe-dev-server-lifecycle-sdlc_planner-dev-server-lifecycle-helper.md

## Overview

Introduces `adws/core/devServerLifecycle.ts`, a deep-module helper that owns the full spawn → probe → retry → work → cleanup lifecycle for development server processes. The module exposes a single `withDevServer(config, work)` function that prevents process leaks and ensures reliable server startup for future BDD test phases. Also extends `projectConfig.ts` with a `healthCheckPath` field so target repos can configure which endpoint to probe.

## What Was Built

- `withDevServer<T>(config, work)` — single entry point that starts a dev server, runs wrapped work, and guarantees cleanup
- `DevServerConfig` interface — `{ startCommand, port, healthPath, cwd }`
- `{PORT}` placeholder substitution in the start command (supports parallel workflows with dynamic ports)
- HTTP health probe loop: 1-second intervals, 20-second timeout
- 3-retry-then-fallback strategy: after 3 failed probe attempts, work runs anyway (graceful degradation)
- Process group kill via `process.kill(-pid, 'SIGTERM')` with SIGKILL escalation after 5s grace
- `finally`-block cleanup guarantee even when `work()` throws
- `healthCheckPath` field added to `CommandsConfig` interface, defaults to `'/'`
- `devServerJanitor.ts` stub placeholder for future stale-process cleanup
- `JANITOR_INTERVAL_CYCLES` config constant wired into the cron loop

## Technical Implementation

### Files Modified

- `adws/core/devServerLifecycle.ts`: New module — full lifecycle implementation with `withDevServer`, `spawnServer`, `probeHealth`, `killProcessGroup`, `substitutePort`
- `adws/core/__tests__/devServerLifecycle.test.ts`: 449-line unit test suite covering all acceptance criteria
- `adws/core/__tests__/projectConfig.test.ts`: Parser tests verifying `healthCheckPath` is read and defaults to `'/'`
- `adws/core/projectConfig.ts`: Added `healthCheckPath: string` to `CommandsConfig`, `HEADING_TO_KEY`, and `getDefaultCommandsConfig()`
- `adws/core/config.ts`: Added `JANITOR_INTERVAL_CYCLES` env-configurable constant (default: 15 cycles ≈ 5 min)
- `adws/core/index.ts`: Exported `JANITOR_INTERVAL_CYCLES`
- `adws/triggers/devServerJanitor.ts`: Stub `runJanitorPass()` — no-op placeholder for future implementation
- `adws/triggers/trigger_cron.ts`: Wired `runJanitorPass()` into the cron loop, called every `JANITOR_INTERVAL_CYCLES` cycles
- `features/dev_server_lifecycle_helper.feature`: BDD feature file for the lifecycle helper
- `features/step_definitions/devServerLifecycleSteps.ts`: Step definitions for BDD scenarios

### Key Changes

- **Deep module design**: `withDevServer` hides spawn/probe/retry/kill complexity behind one function — callers provide config and a work callback, nothing else
- **Process group kill**: `process.kill(-pid, 'SIGTERM')` targets the entire process group, not just the parent PID — critical for servers like Next.js that spawn multiple worker children
- **`{PORT}` substitution** (not env var): supports concurrent workflows each receiving a dynamically allocated port without collision
- **Fallback on 3 failures**: the helper logs a warning and runs work anyway rather than hard-failing — prevents a flaky server startup from blocking the entire pipeline
- **Janitor hook in cron**: `devServerJanitor.ts` is a stub wired at the cron level; full implementation is deferred to a future issue

## How to Use

The helper is pure infrastructure — no production consumers are wired yet. When a future issue integrates it into the scenario test phase:

1. Ensure the target repo's `.adw/commands.md` includes an optional `## Health Check Path` heading (defaults to `/` if absent).
2. Import `withDevServer` and `DevServerConfig` from `adws/core/devServerLifecycle.ts`.
3. Obtain an allocated port (use the existing `portAllocator.ts`).
4. Call `withDevServer`:

```typescript
import { withDevServer } from '../core/devServerLifecycle';
import { allocatePort } from '../core/portAllocator';

const port = await allocatePort();
const result = await withDevServer(
  {
    startCommand: projectConfig.startDevServer, // e.g. 'bun run dev --port {PORT}'
    port,
    healthPath: projectConfig.healthCheckPath,  // e.g. '/api/health'
    cwd: worktreePath,
  },
  async () => {
    // run BDD scenarios or other work here
    return runScenarios();
  }
);
```

The server is automatically torn down after `work` completes or throws.

## Configuration

| Field | Source | Default |
|---|---|---|
| `startCommand` | `.adw/commands.md` `## Start Dev Server` | `bun run dev` |
| `healthCheckPath` | `.adw/commands.md` `## Health Check Path` | `/` |
| `JANITOR_INTERVAL_CYCLES` | `JANITOR_INTERVAL_CYCLES` env var | `15` (≈5 min at 20s poll) |
| `PROBE_INTERVAL_MS` | constant in module | `1000` ms |
| `PROBE_TIMEOUT_MS` | constant in module | `20000` ms |
| `MAX_START_ATTEMPTS` | constant in module | `3` |
| `KILL_GRACE_MS` | constant in module | `5000` ms |

## Testing

```bash
# Parser tests for healthCheckPath
bunx vitest run adws/core/__tests__/projectConfig.test.ts

# Lifecycle helper unit tests (spawn/probe/retry/kill mocks)
bunx vitest run adws/core/__tests__/devServerLifecycle.test.ts

# Full vitest suite — zero regressions
bunx vitest run
```

The unit tests mock `child_process.spawn`, global `fetch`, and `process.kill`. Covered scenarios: port substitution, healthy probe path, probe timeout triggering retry, 3 consecutive failures triggering fallback, group kill via negative PID, SIGKILL escalation, and finally-block cleanup on both success and throw.

## Notes

- No production consumers are wired in this PR — the helper exists as pure infrastructure for the upcoming scenario test phase integration.
- The `{PORT}` placeholder pattern (not env var injection) was a deliberate decision from the 2026-04-08 grill-me session to support parallel workflows.
- Process group kill (`-pid`) is essential because dev servers like Next.js spawn multiple child workers; killing only the parent PID leaves orphaned processes.
- `devServerJanitor.ts` is a no-op stub; full stale-process detection will be added in a future issue.
- The fallback behavior (run work after 3 failures) is intentional — some workflows may partially succeed without a running dev server, and a hard failure would block the entire pipeline.
