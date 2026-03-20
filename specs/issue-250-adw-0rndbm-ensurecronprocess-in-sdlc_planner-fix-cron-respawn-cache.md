# Bug: ensureCronProcess in-memory cache prevents respawn of dead cron process

## Metadata
issueNumber: `250`
adwId: `0rndbm-ensurecronprocess-in`
issueJson: `{"number":250,"title":"ensureCronProcess in-memory cache prevents respawn of dead cron process","body":"## Description\n\nWhen `ensureCronProcess` spawns a cron process for a repo, it adds the repo key to the in-memory `cronSpawnedForRepo` Set. On subsequent calls within the same webhook session, it returns immediately at the Set check (line 95) without verifying whether the spawned process is still alive. If the cron process dies after being spawned, no new cron will be started for the remainder of the webhook session.\n\n## Steps to Reproduce\n\n1. Webhook server receives an event (e.g. `issues.opened`) for `paysdoc/AI_Dev_Workflow`\n2. `ensureCronProcess` spawns a `trigger_cron` process and adds the repo to `cronSpawnedForRepo`\n3. The cron process dies (crash, exit, etc.)\n4. A `## Take action` comment is posted on another issue (e.g. #244)\n5. Webhook handles the comment, calls `ensureCronProcess` again\n6. `cronSpawnedForRepo.has(repoKey)` returns `true` → **silent return, no respawn**\n\n## Root Cause\n\n`webhookGatekeeper.ts` line 95:\n\n```ts\nif (cronSpawnedForRepo.has(repoKey)) return;\n```\n\nThe in-memory Set is a fire-and-forget cache. Once a repo key is added after spawning (line 102), no subsequent call ever verifies that the spawned process is still alive. The PID-file liveness check (`isCronAliveForRepo` at line 97) is only reached when the in-memory Set does **not** contain the repo key.\n\n## Expected Behavior\n\nWhen `cronSpawnedForRepo` already contains the repo key, `ensureCronProcess` should still verify via `isCronAliveForRepo` that the process is alive. If the PID file shows a dead process, it should remove the repo from the Set and proceed to spawn a new cron process.\n\n## Evidence\n\nPID file `agents/cron/paysdoc_AI_Dev_Workflow.json` recorded PID 92044 which is no longer running, yet no new cron was spawned when issue #244 was triggered via `## Take action`.\n\n## Dependencies\n\nNone\n\n## ADW Command\n\n/bug","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-20T13:24:55Z","comments":[],"actionableComment":null}`

## Bug Description
The `ensureCronProcess` function in `webhookGatekeeper.ts` uses an in-memory `Set<string>` (`cronSpawnedForRepo`) as a fast-path cache. Once a cron process is spawned for a repo and its key is added to the Set, all subsequent calls within the same webhook session return immediately at line 95 (`if (cronSpawnedForRepo.has(repoKey)) return;`) without verifying that the spawned process is still alive. If the cron process crashes or exits after being spawned, no new cron will be started for the remainder of the webhook session because the in-memory cache still considers it "spawned."

**Actual behavior:** After a cron process dies, `ensureCronProcess` silently returns on subsequent calls because `cronSpawnedForRepo.has(repoKey)` is `true`, bypassing the PID-file liveness check entirely.

**Expected behavior:** When the in-memory cache indicates a cron was spawned, the function should still verify liveness via `isCronAliveForRepo`. If the process is dead, it should remove the stale entry from the cache and proceed to spawn a replacement.

## Problem Statement
The in-memory `cronSpawnedForRepo` Set acts as a fire-and-forget cache with no invalidation mechanism. The PID-file liveness check (`isCronAliveForRepo`) is only reachable when the Set does **not** contain the repo key (i.e., after a webhook restart). Within a single session, a dead cron process is never detected and never respawned.

## Solution Statement
Modify the early-return guard at line 95 of `ensureCronProcess` to also check process liveness when the in-memory cache has the repo key. If the PID-file check reports the process is dead, delete the repo key from `cronSpawnedForRepo` and fall through to the existing spawn logic. This is a 3-line change replacing the current 1-line early return, keeping the fast-path optimization (alive processes still skip the rest of the function) while adding dead-process recovery.

## Steps to Reproduce
1. Start the webhook server (`bunx tsx adws/triggers/trigger_webhook.ts`)
2. Webhook receives an event for a repository (e.g. `issues.opened` for `paysdoc/AI_Dev_Workflow`)
3. `ensureCronProcess` spawns a `trigger_cron` process and adds the repo key to `cronSpawnedForRepo`
4. The cron process dies (crash, manual kill, OOM, etc.)
5. Another webhook event arrives for the same repo (e.g. `issue_comment.created`)
6. `ensureCronProcess` is called again — `cronSpawnedForRepo.has(repoKey)` returns `true` → immediate return, no respawn
7. The repository has no active cron poller for the remainder of the session

## Root Cause Analysis
The root cause is the unconditional early return at `webhookGatekeeper.ts` line 95:

```ts
if (cronSpawnedForRepo.has(repoKey)) return;
```

This line was added as a fast-path optimization to avoid repeated disk reads (PID file checks) within a single webhook session. The assumption was that if a cron was spawned during this session, it would stay alive. This assumption is incorrect — cron processes can die at any time (crashes, resource limits, signals).

The PID-file liveness check at line 97 (`isCronAliveForRepo`) correctly handles dead processes by removing stale PID files and returning `false`, allowing a respawn. But this check is unreachable when the in-memory Set already contains the repo key.

The fix is to make the in-memory cache check conditional on liveness: keep the fast path when the process is alive, but invalidate the cache entry and fall through to respawn when it's dead.

## Relevant Files
Use these files to fix the bug:

- `adws/triggers/webhookGatekeeper.ts` — Contains the `ensureCronProcess` function with the buggy early-return guard at line 95. This is the only file that needs modification.
- `adws/triggers/cronProcessGuard.ts` — Contains `isCronAliveForRepo()` which is already used in `ensureCronProcess` and handles PID-file liveness checks with stale file cleanup. No changes needed, but important for understanding the liveness check mechanism.
- `guidelines/coding_guidelines.md` — Coding guidelines to adhere to during implementation.
- `app_docs/feature-ak5lea-trigger-cron-process-prevent-duplicate-cron.md` — Documentation for the original cron process guard feature, providing context on the two-layer guard design (in-memory Set + PID file).

## Step by Step Tasks

### Step 1: Modify the in-memory cache guard in `ensureCronProcess`

- Open `adws/triggers/webhookGatekeeper.ts`
- Locate the early-return guard at line 95:
  ```ts
  if (cronSpawnedForRepo.has(repoKey)) return;
  ```
- Replace it with a liveness-aware guard:
  ```ts
  if (cronSpawnedForRepo.has(repoKey)) {
    if (isCronAliveForRepo(repoKey)) return;
    cronSpawnedForRepo.delete(repoKey);
  }
  ```
- This preserves the fast-path optimization (alive processes still return immediately via the PID-file check) while adding dead-process recovery (stale entries are removed from the Set, allowing the function to fall through to the spawn logic below).
- No other changes to this file are needed — the existing spawn logic at lines 102–111 handles the rest correctly.

### Step 2: Run validation commands

- Run all validation commands to ensure the fix introduces no regressions:
  - `bun run lint`
  - `bunx tsc --noEmit`
  - `bunx tsc --noEmit -p adws/tsconfig.json`
  - `bun run build`
  - `bunx cucumber-js --tags "@regression"` (if regression scenarios exist)

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Type check the root project
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type check the adws sub-project
- `bun run build` — Build the application to verify no build errors
- `bunx cucumber-js --tags "@regression"` — Run regression BDD scenarios

## Notes
- This is a minimal, surgical fix — only 3 lines replace 1 line in a single file.
- The `isCronAliveForRepo` function already handles stale PID file cleanup internally (removes dead PID files from disk), so the only additional work is the `cronSpawnedForRepo.delete(repoKey)` call to invalidate the in-memory cache.
- The fix adds one extra `isCronAliveForRepo` disk read per `ensureCronProcess` call when the cache has the repo key. This is acceptable because: (a) the PID file is tiny JSON, (b) the OS will likely cache it, and (c) webhook events are infrequent relative to disk I/O speed.
- The existing `registerAndGuard()` startup guard in `trigger_cron.ts` remains as a second line of defense against race conditions and requires no changes.
- Strictly adheres to `guidelines/coding_guidelines.md`: clarity over cleverness, single responsibility, no unnecessary changes.
