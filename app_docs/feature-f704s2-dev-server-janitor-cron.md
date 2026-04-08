# Dev Server Janitor Cron

**ADW ID:** f704s2-cron-janitor-for-orp
**Date:** 2026-04-08
**Specification:** specs/issue-394-adw-f704s2-cron-janitor-for-orp-sdlc_planner-dev-server-janitor.md

## Overview

Adds a cron-based janitor probe that automatically detects and cleans up orphaned dev server processes left behind by SIGKILL'd or crashed ADW orchestrators. The janitor runs every 5 minutes inside the existing cron loop, walks all target repository worktrees, and applies a conservative kill decision rule before escalating from SIGTERM to SIGKILL. It is the catastrophic safety net that prevents leaked processes from accumulating across workflow runs.

## What Was Built

- `adws/triggers/devServerJanitor.ts` — Deep module exporting `runJanitorPass()` as the single entry point
- `adws/triggers/__tests__/devServerJanitor.test.ts` — Unit tests covering all cells of the kill decision matrix
- `JANITOR_INTERVAL_CYCLES` config constant wired into `trigger_cron.ts`
- `healthCheckPath` field added to `CommandsConfig` in `projectConfig.ts`

## Technical Implementation

### Files Modified

- `adws/triggers/devServerJanitor.ts`: New file — full janitor module with discovery, decision logic, and kill execution
- `adws/triggers/__tests__/devServerJanitor.test.ts`: New file — Vitest unit tests (403 lines)
- `adws/triggers/trigger_cron.ts`: Wires `runJanitorPass()` on `JANITOR_INTERVAL_CYCLES` cadence after `scanPauseQueue`
- `adws/core/config.ts`: Adds `JANITOR_INTERVAL_CYCLES` constant (default: 15 cycles ≈ 5 min at 20s poll)
- `adws/core/index.ts`: Re-exports `JANITOR_INTERVAL_CYCLES`
- `adws/core/projectConfig.ts`: Adds `healthCheckPath` field to `CommandsConfig` (default: `/`)
- `features/dev_server_janitor_cron.feature`: BDD scenarios for the janitor
- `features/step_definitions/devServerJanitorSteps.ts`: Step definitions for BDD scenarios

### Key Changes

- **Kill decision rule** — Pure function `shouldCleanWorktree(isNonTerminal, orchestratorAlive, ageMs, gracePeriodMs)` returns `false` (skip) when `(isNonTerminal && orchestratorAlive) || (ageMs <= gracePeriodMs)`, true otherwise. The 30-minute grace period prevents killing processes for recently-started workflows whose state files haven't been written yet.
- **Worktree discovery** — `discoverTargetRepoWorktrees()` walks `TARGET_REPOS_DIR/{owner}/{repo}/` directories, skipping paths without `.git/`, then calls `listWorktrees(cwd)` per repo.
- **AdwId extraction** — `extractAdwIdFromDirName()` parses the `-adw-` marker from branch-name directory names (`{type}-issue-{N}-adw-{adwId}-{slug}`). Returns `null` for non-ADW directories; those are treated as terminal-stage + dead-PID and subject only to the age check.
- **Process probe first** — `lsof +D` is run before any state lookups. Worktrees with no open file handles are skipped immediately, keeping the fast path cheap.
- **Fully injectable deps** — All OS-touching operations (fs readdir/stat, lsof, state reader, process kill) are injected via a `JanitorDeps` interface, enabling exhaustive unit testing without touching the filesystem.

## How to Use

The janitor runs automatically inside the existing cron loop — no manual intervention is required. It fires every `JANITOR_INTERVAL_CYCLES` poll cycles (default 15, ≈ 5 minutes).

To tune the interval:

```bash
JANITOR_INTERVAL_CYCLES=30 bunx tsx adws/triggers/trigger_cron.ts
```

To invoke one janitor pass manually in a script or REPL:

```typescript
import { runJanitorPass } from './adws/triggers/devServerJanitor';
await runJanitorPass();
```

## Configuration

| Variable | Default | Description |
|---|---|---|
| `JANITOR_INTERVAL_CYCLES` | `15` | Poll cycles between janitor passes (~5 min at 20s poll) |

The grace period (30 minutes) is hardcoded as `JANITOR_GRACE_PERIOD_MS` and exported for tests. It is not currently configurable via env var.

## Testing

```bash
bun run test --reporter=verbose adws/triggers/__tests__/devServerJanitor.test.ts
```

Tests cover:

- All 7 cells of the `(terminal/non-terminal) × (PID alive/dead) × (young/old)` kill decision matrix
- `extractAdwIdFromDirName` — valid patterns, missing `-adw-` marker, edge cases
- `runJanitorPass` kill execution — mock `killProcessesInDirectory`, assert called only for eligible worktrees
- Worktree discovery — mock fs/listWorktrees across multiple owners and repos
- No-state-file edge case — adwId not parseable → age-only decision

## Notes

- `killProcessesInDirectory` from `adws/vcs/worktreeCleanup.ts` implements the full lsof → SIGTERM → wait → SIGKILL escalation. The janitor reuses this rather than reimplementing kill logic.
- On macOS `birthtimeMs` is used for worktree age; on Linux the fallback is `ctimeMs`.
- Worktrees with no parseable adwId (e.g., manually created branches) are treated as terminal-stage + dead-PID and cleaned up based solely on the 30-minute grace period.
- Errors during individual worktree processing are caught and logged as warnings; a single bad worktree does not abort the pass.
