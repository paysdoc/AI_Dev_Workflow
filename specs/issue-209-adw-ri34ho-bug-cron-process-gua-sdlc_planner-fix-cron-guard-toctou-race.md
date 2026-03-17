# Bug: Cron process guard has TOCTOU race allowing duplicate processes

## Metadata
issueNumber: `209`
adwId: `ri34ho-bug-cron-process-gua`
issueJson: `{"number":209,"title":"Bug: cron process guard has TOCTOU race allowing duplicate processes","body":"## Description\n\n`registerAndGuard()` in `adws/triggers/cronProcessGuard.ts` has a time-of-check-time-of-use (TOCTOU) race condition. The read (`readCronPid`) and write (`writeCronPid`) are separate non-atomic operations, so two cron processes starting simultaneously can both read \"no record\", both write their PID (last writer silently wins), and both proceed — resulting in duplicate cron processes for the same repo.\n\nObserved via `ps -ef | grep triggers/trigger_cron` showing 2 running processes for the same repository.\n\n## Root Cause\n\n```ts\n// Current code — non-atomic check-then-write\nconst record = readCronPid(repoKey);       // Process A reads: null\n                                            // Process B reads: null (before A writes)\nif (record) { ... }\nwriteCronPid(repoKey, ownPid);             // Both write, both return true\nreturn true;\n```\n\n## Fix\n\nUse `fs.writeFileSync` with the `wx` (exclusive create) flag for the initial file creation attempt. This atomically fails if the file already exists, closing the race window. For stale PID cleanup, remove and retry with `wx` so only one process wins the exclusive create.\n\n## Acceptance Criteria\n\n- [ ] `registerAndGuard()` uses atomic exclusive file creation (`wx` flag) to prevent TOCTOU race\n- [ ] When two cron processes start simultaneously for the same repo, exactly one proceeds and the other exits\n- [ ] Stale PID files (dead processes) are still cleaned up correctly\n- [ ] Type-checks pass (`bunx tsc --noEmit --project adws/tsconfig.json`)","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-17T09:23:14Z","comments":[],"actionableComment":null}`

## Bug Description
`registerAndGuard()` in `adws/triggers/cronProcessGuard.ts` has a TOCTOU (time-of-check-time-of-use) race condition. The function reads the PID file (`readCronPid`) and writes it (`writeCronPid`) as two separate non-atomic operations. When two cron processes start simultaneously for the same repo, both can read "no record", both write their PID (last writer silently wins), and both proceed — resulting in duplicate cron processes.

**Expected:** When two cron processes start simultaneously for the same repo, exactly one proceeds and the other exits.
**Actual:** Both processes pass the guard and run concurrently. Observed via `ps -ef | grep triggers/trigger_cron` showing 2 running processes for the same repository.

## Problem Statement
The `registerAndGuard()` function performs a non-atomic check-then-write sequence. Between Process A reading "no file exists" and Process A writing its PID file, Process B can also read "no file exists" and both proceed to write — the last writer silently wins but both functions return `true`.

## Solution Statement
Replace the separate read-then-write with `fs.writeFileSync` using the `wx` (exclusive create) flag. The OS guarantees that `O_CREAT | O_EXCL` atomically fails if the file already exists, so only one process can win the create. For stale PID cleanup (dead process), remove the stale file and retry the exclusive create — again, only one retrying process can win.

## Steps to Reproduce
1. Start two `trigger_cron.ts` processes simultaneously for the same repo (e.g., `bunx tsx adws/triggers/trigger_cron.ts & bunx tsx adws/triggers/trigger_cron.ts &`)
2. Both processes call `registerAndGuard(repoKey, process.pid)`
3. Both read `null` from `readCronPid` (no file exists yet)
4. Both write their PID via `writeCronPid` — last writer wins
5. Both return `true` — two cron processes running for the same repo

## Root Cause Analysis
The race window is between `readCronPid()` returning `null` and `writeCronPid()` creating the file:

```ts
// Process A                              // Process B
const record = readCronPid(repoKey); // null
                                         const record = readCronPid(repoKey); // null (A hasn't written yet)
if (record) { ... } // skipped
                                         if (record) { ... } // skipped
writeCronPid(repoKey, ownPid); // writes A's PID
                                         writeCronPid(repoKey, ownPid); // overwrites with B's PID
return true; // A proceeds
                                         return true; // B also proceeds — DUPLICATE
```

The `writeCronPid` function uses the default `w` flag which creates-or-overwrites, so the last writer silently wins without error.

## Relevant Files
Use these files to fix the bug:

- `adws/triggers/cronProcessGuard.ts` — The file containing the TOCTOU race. `registerAndGuard()` is the function that needs the atomic `wx` fix. `readCronPid`, `writeCronPid`, `removeCronPid`, `ensureCronDir`, and `getCronPidFilePath` are internal helpers.
- `adws/core/stateHelpers.ts` — Provides `isProcessAlive(pid)` used to check if a recorded PID is still a live process.
- `adws/triggers/trigger_cron.ts` — Caller of `registerAndGuard()` at startup (lines 161-165). No changes needed here.
- `adws/triggers/webhookGatekeeper.ts` — Caller of `writeCronPid()` and `isCronAliveForRepo()` (lines 97-112). No changes needed here.
- `app_docs/feature-ak5lea-trigger-cron-process-prevent-duplicate-cron.md` — Context doc for the original cron guard feature.
- `guidelines/coding_guidelines.md` — Coding guidelines to follow.

## Step by Step Tasks

### 1. Refactor `registerAndGuard()` to use atomic exclusive file creation

In `adws/triggers/cronProcessGuard.ts`, rewrite `registerAndGuard()` to use `fs.writeFileSync` with the `wx` flag:

- Add a private helper function `tryExclusiveCreate(repoKey: string, pid: number): boolean` that:
  - Calls `ensureCronDir()` to ensure `agents/cron/` exists
  - Builds the JSON content: `{ pid, repoKey, startedAt: new Date().toISOString() }`
  - Calls `fs.writeFileSync(getCronPidFilePath(repoKey), content, { flag: 'wx' })` inside a try-catch
  - Returns `true` on success (file created exclusively)
  - Catches the error: if `err.code === 'EEXIST'`, returns `false` (another process already created the file)
  - Re-throws any other unexpected error

- Rewrite `registerAndGuard(repoKey, ownPid)` with this logic:
  1. Attempt `tryExclusiveCreate(repoKey, ownPid)` — if `true`, return `true` (we won the exclusive create, no race possible)
  2. If `false` (file already exists), read the existing PID file via `readCronPid(repoKey)`
  3. If the record exists and the PID is alive and different from `ownPid` → return `false` (another live cron is running)
  4. If the record exists and the PID matches `ownPid` → return `true` (re-registration of self)
  5. If the record is null/malformed or the PID is dead → the file is stale:
     - Log the stale PID removal
     - Call `removeCronPid(repoKey)` to delete the stale file
     - Attempt `tryExclusiveCreate(repoKey, ownPid)` again
     - If the retry succeeds → return `true`
     - If the retry fails (EEXIST) → another process won the race during cleanup, return `false`

- Keep the public signatures of `writeCronPid`, `isCronAliveForRepo`, and all other exported functions unchanged — `webhookGatekeeper.ts` depends on them for the webhook-spawned cron use case where overwriting is intentional.

### 2. Run validation commands

- Run `bun run lint` to check for linting issues
- Run `bunx tsc --noEmit` to verify root TypeScript compilation
- Run `bunx tsc --noEmit -p adws/tsconfig.json` to verify adws TypeScript compilation
- Run `bun run build` to verify the build succeeds

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Root TypeScript type-check
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW-specific TypeScript type-check
- `bun run build` — Build the application to verify no build errors

## Notes
- The `writeCronPid()` export must remain unchanged because `webhookGatekeeper.ts` calls it to record the child PID after spawning a cron process — that path intentionally overwrites (the webhook knows it just spawned the only child).
- `isCronAliveForRepo()` is a read-only check and does not need atomic protection — it is only used as a fast-path guard in `ensureCronProcess()`.
- The `wx` flag maps to `O_CREAT | O_EXCL` at the OS level, which is an atomic operation guaranteed by POSIX — the kernel ensures exactly one process wins the create even on the same filesystem.
- Strictly follow `guidelines/coding_guidelines.md`: immutability, type safety, meaningful error handling, and clarity over cleverness.
