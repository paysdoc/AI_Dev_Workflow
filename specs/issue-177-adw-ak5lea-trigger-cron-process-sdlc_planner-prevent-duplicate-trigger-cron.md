# Feature: Prevent Duplicate trigger_cron Processes Per Repository

## Metadata
issueNumber: `177`
adwId: `ak5lea-trigger-cron-process`
issueJson: `{"number":177,"title":"trigger_cron process may not be running more than once for repo","body":"## Summary\nMultiple instances of trigger_cron job ruin the workflow.\n\n## Details\nIt is possible to get multiple trigger_cron processes running on the same repo. This can happen when the webhook is stopped and restarted. \nBefore a new trigger_cron process is started, the ADW needs to check whether there already is a process running. \nBeaware that one cli call to trigger_cron can start up multiple processes. They be linked via parent id. However, if there is a tregger_cron process running for for the same repository as another, and they're not linked, then the more recent process tree should be terminated.\ntrigger_cron jobs may, however coexist if they service different repositories.\n","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-13T13:57:19Z","comments":[],"actionableComment":null}`

## Feature Description
When the webhook server is stopped and restarted, it loses its in-memory tracking of spawned cron processes (`cronSpawnedForRepo` Set in `webhookGatekeeper.ts`). This allows `ensureCronProcess()` to spawn a second `trigger_cron` process for the same repository, leading to duplicate polling, wasted GitHub API calls, and potential race conditions in issue processing.

This feature adds persistent PID-file-based tracking of cron processes so that:
1. Before spawning a new cron, the system checks whether one is already alive for that repo.
2. On startup, `trigger_cron` self-checks and terminates if a duplicate is detected for the same repo.
3. Cron processes for different repositories can coexist without interference.

## User Story
As an ADW operator
I want only one trigger_cron process running per repository at any time
So that I avoid duplicate polling, wasted API quota, and race conditions caused by multiple cron instances servicing the same repo

## Problem Statement
The `ensureCronProcess()` function in `webhookGatekeeper.ts` uses an in-memory `Set<string>` to track spawned cron processes. When the webhook server restarts, this set is cleared, allowing duplicate cron processes to be spawned for the same repository. Multiple cron processes polling the same repo cause redundant GitHub API calls, potential concurrent workflow spawns for the same issue, and general workflow instability.

## Solution Statement
Introduce a persistent PID-file-based cron process guard (`cronProcessGuard.ts`) that stores the PID and repo key of each running cron process on disk. Both `ensureCronProcess()` and `trigger_cron.ts` will consult this guard before proceeding:

- **`ensureCronProcess()`**: Before spawning, check the PID file. If a live cron process exists for the repo, skip spawning. After spawning, record the child PID in the PID file.
- **`trigger_cron.ts`**: On startup, self-register and verify no other cron is already alive for the same repo. If a duplicate is detected, log a warning and exit immediately (the newer process terminates itself, as specified in the issue).
- **Stale cleanup**: If a PID file exists but the process is dead, the stale file is removed and a new cron is allowed to start.

This uses the existing `isProcessAlive()` from `stateHelpers.ts` for OS-level PID liveness checks and stores PID files under `agents/cron/` following the project's existing state directory conventions.

## Relevant Files
Use these files to implement the feature:

- `adws/triggers/webhookGatekeeper.ts` — Contains `ensureCronProcess()` which spawns cron processes and uses the in-memory `cronSpawnedForRepo` Set. Must be updated to check persistent PID files before spawning and to record the child PID after spawning.
- `adws/triggers/trigger_cron.ts` — The main cron polling script. Must be updated to self-register its PID on startup and exit if a duplicate is detected for the same repo.
- `adws/core/stateHelpers.ts` — Contains `isProcessAlive(pid)` for OS-level process liveness checks. Will be reused by the new guard module.
- `adws/core/config.ts` — Contains `AGENTS_STATE_DIR` constant used for state file paths.
- `adws/triggers/trigger_webhook.ts` — Calls `ensureCronProcess()`. No changes needed, but useful for understanding the call flow.
- `adws/triggers/issueEligibility.ts` — Referenced by trigger_cron for eligibility checks. No changes needed.
- `guidelines/coding_guidelines.md` — Coding standards to follow (modularity, immutability, type safety, pure functions, <300 line files).

### New Files
- `adws/triggers/cronProcessGuard.ts` — New module providing persistent PID-file-based duplicate cron prevention. Functions: `getCronPidFilePath()`, `writeCronPid()`, `readCronPid()`, `isCronAliveForRepo()`, `removeCronPid()`, `registerAndGuard()`.

## Implementation Plan
### Phase 1: Foundation
Create the `cronProcessGuard.ts` module with persistent PID-file read/write and liveness checking functions. This module is the core building block that both `ensureCronProcess()` and `trigger_cron.ts` will depend on.

Key design decisions:
- PID files stored at `agents/cron/{owner}_{repo}.json` (one file per repo).
- Each PID file contains: `{ pid: number, repoKey: string, startedAt: string }`.
- Uses `isProcessAlive()` from `stateHelpers.ts` for liveness checks.
- Directory `agents/cron/` is created on demand (mkdir -p style).

### Phase 2: Core Implementation
1. Integrate the guard into `ensureCronProcess()` in `webhookGatekeeper.ts`:
   - Before spawning, call `isCronAliveForRepo(repoKey)` — if alive, skip.
   - After spawning, call `writeCronPid(repoKey, child.pid)` to persist the PID.
   - Keep the in-memory `cronSpawnedForRepo` Set as a fast-path cache (avoids disk reads on every webhook event), but make it fall through to the PID file check when the Set doesn't contain the repo (i.e., after a restart).

2. Update `trigger_cron.ts` to self-register and self-guard on startup:
   - On startup, call `registerAndGuard(repoKey, process.pid)` which:
     a. Reads the existing PID file for this repo.
     b. If a PID file exists and that process is alive → log warning and `process.exit(0)` (newer process terminates itself).
     c. If PID file exists but process is dead → remove stale file, proceed.
     d. Write own PID to the file and proceed with normal polling.

### Phase 3: Integration
- The in-memory Set in `webhookGatekeeper.ts` serves as a fast-path to avoid repeated disk I/O within a single webhook session. The PID file is the source of truth across process restarts.
- When `ensureCronProcess()` spawns a new cron and writes the PID file, the trigger_cron process startup guard acts as a second line of defense in case of race conditions between two spawn calls.
- No changes needed to `trigger_webhook.ts` since it calls `ensureCronProcess()` which handles the guard internally.

## Step by Step Tasks

### Step 1: Create `cronProcessGuard.ts` module
- Create `adws/triggers/cronProcessGuard.ts`.
- Import `isProcessAlive` from `../core/stateHelpers`.
- Import `AGENTS_STATE_DIR` from `../core/config`.
- Import `log` from `../core`.
- Define interface `CronPidRecord`:
  ```typescript
  interface CronPidRecord {
    pid: number;
    repoKey: string;
    startedAt: string;
  }
  ```
- Implement `getCronPidFilePath(repoKey: string): string` — returns `path.join(AGENTS_STATE_DIR, 'cron', repoKey.replace('/', '_') + '.json')`.
- Implement `ensureCronDir(): void` — creates `agents/cron/` directory if it doesn't exist (`fs.mkdirSync` with `recursive: true`).
- Implement `writeCronPid(repoKey: string, pid: number): void` — writes `CronPidRecord` JSON to the PID file.
- Implement `readCronPid(repoKey: string): CronPidRecord | null` — reads and parses PID file, returns null if missing or malformed.
- Implement `removeCronPid(repoKey: string): void` — deletes the PID file if it exists.
- Implement `isCronAliveForRepo(repoKey: string): boolean`:
  1. Read PID file.
  2. If no file → return false.
  3. If file exists, check `isProcessAlive(record.pid)`.
  4. If alive → return true.
  5. If dead → call `removeCronPid(repoKey)`, log stale cleanup, return false.
- Implement `registerAndGuard(repoKey: string, ownPid: number): boolean`:
  1. Read PID file.
  2. If file exists and PID alive and PID !== ownPid → return false (duplicate detected, caller should exit).
  3. If file exists but PID dead → remove stale file.
  4. Write own PID to file.
  5. Return true (safe to proceed).

### Step 2: Update `ensureCronProcess()` in `webhookGatekeeper.ts`
- Import `isCronAliveForRepo` and `writeCronPid` from `./cronProcessGuard`.
- Modify `ensureCronProcess()`:
  - After the in-memory Set check (`cronSpawnedForRepo.has(repoKey)`), add a PID-file liveness check:
    ```typescript
    if (isCronAliveForRepo(repoKey)) {
      cronSpawnedForRepo.add(repoKey); // sync in-memory cache
      return;
    }
    ```
  - After spawning the child process, record the PID:
    ```typescript
    if (child.pid) {
      writeCronPid(repoKey, child.pid);
    }
    ```
  - Keep the existing `cronSpawnedForRepo.add(repoKey)` call as-is (fast-path cache).

### Step 3: Update `trigger_cron.ts` to self-register and guard on startup
- Import `registerAndGuard` from `./cronProcessGuard`.
- At the top of the module (after `cronRepoInfo` is resolved), add the startup guard:
  ```typescript
  const cronRepoKey = `${cronRepoInfo.owner}/${cronRepoInfo.repo}`;
  const canProceed = registerAndGuard(cronRepoKey, process.pid);
  if (!canProceed) {
    log(`Another cron process is already running for ${cronRepoKey}, exiting duplicate`, 'warn');
    process.exit(0);
  }
  ```
- This must run before the polling intervals are started (before the `setInterval` calls at the bottom of the file).

### Step 4: Validate implementation
- Run `bun run lint` to check for linting issues.
- Run `bunx tsc --noEmit` to verify type correctness.
- Run `bunx tsc --noEmit -p adws/tsconfig.json` for project-specific type checks.
- Run `bun run build` to verify build succeeds.
- Run `bun run test` to verify no regressions.

## Testing Strategy
### Unit Tests
Per the project's coding guidelines, ADW does not use unit tests. BDD scenarios and manual validation are the primary validation mechanisms. The validation commands below serve as the quality gate.

### Edge Cases
- **Stale PID file**: Process died without cleanup → `isCronAliveForRepo()` detects dead PID, removes stale file, allows new spawn.
- **PID reuse by OS**: Extremely unlikely in short timeframes. The PID file also stores `repoKey` and `startedAt` for additional context, but PID reuse is not blocked (acceptable risk given the polling interval).
- **Race condition between two `ensureCronProcess()` calls**: The trigger_cron startup guard (`registerAndGuard`) acts as a second defense — even if two spawn calls race, the second trigger_cron will detect the first and exit.
- **Concurrent repos**: Each repo has its own PID file (`owner_repo.json`), so cron processes for different repos don't interfere.
- **Webhook restart during cron spawn**: The in-memory Set is lost, but the PID file persists. Next `ensureCronProcess()` call reads the PID file and skips if alive.
- **Permissions**: PID file directory uses `recursive: true` mkdir, same as existing `agents/` directory pattern.
- **Process exits cleanly vs crash**: Both are handled — `isProcessAlive()` returns false for dead processes regardless of how they died.

## Acceptance Criteria
- Only one `trigger_cron` process runs per repository at any time, even across webhook restarts.
- When a duplicate `trigger_cron` is spawned for the same repo, the newer process detects the existing one and exits immediately with a warning log.
- Stale PID files (from crashed or stopped processes) are automatically cleaned up on the next spawn attempt.
- `trigger_cron` processes for different repositories can coexist without interference.
- No regressions in existing trigger, webhook, or workflow functionality.
- All linting, type checking, and build validation passes.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — Run linter to check for code quality issues.
- `bunx tsc --noEmit` — Run TypeScript type checking.
- `bunx tsc --noEmit -p adws/tsconfig.json` — Run project-specific TypeScript type checking.
- `bun run build` — Build the application to verify no build errors.
- `bun run test` — Run tests to validate no regressions.

## Notes
- The `guidelines/coding_guidelines.md` file mandates: modularity (<300 line files), immutability (new values over mutation), type safety (strict mode, no `any`), and pure functions where possible. The new `cronProcessGuard.ts` module follows all of these.
- The PID file approach is intentionally simple — no lock files or IPC channels — matching the project's existing patterns (e.g., `stateHelpers.ts` PID checks, `agents/` state directory).
- Future consideration: if ADW is ever deployed in a distributed/multi-machine setup, PID-based guards will not work across machines. A network-based lock (e.g., Redis or file lock on shared storage) would be needed. This is out of scope for the current single-machine deployment.
