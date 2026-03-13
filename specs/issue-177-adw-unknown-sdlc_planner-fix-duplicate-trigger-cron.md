# Bug: Duplicate trigger_cron processes for the same repository

## Metadata
issueNumber: `177`
adwId: `adw-unknown`
issueJson: `{}`

## Bug Description
Multiple `trigger_cron` processes can run simultaneously for the same repository. This happens when the webhook server is stopped and restarted: `ensureCronProcess` in `webhookGatekeeper.ts` relies on an in-memory `Set` (`cronSpawnedForRepo`) to prevent duplicate spawning, but this set is cleared on every webhook restart. A pre-existing cron process survives the restart, and a new one is spawned on the next eligible issue event, leading to two (or more) cron processes polling and spawning workflows for the same repo concurrently — corrupting workflow state.

**Expected behaviour:** Only one `trigger_cron` process runs per repository at any time.
**Actual behaviour:** Each webhook restart can produce an additional `trigger_cron` process for the same repo.

## Problem Statement
`ensureCronProcess` only guards against spawning a duplicate within the current webhook process lifetime. It performs no OS-level check for pre-existing `trigger_cron` processes that survived a previous webhook instance. Additionally, `trigger_cron.ts` itself performs no self-deduplication at startup.

## Solution Statement
Add OS-level process detection in two places:

1. **`adws/triggers/cronProcessGuard.ts`** (new file) — a module that inspects running processes via `ps` to find existing `trigger_cron` instances for a given `owner/repo`. It also exposes a function to kill a process tree by PID.

2. **`adws/triggers/webhookGatekeeper.ts` → `ensureCronProcess`** — before spawning, call the guard to check if a live OS process already exists for the repo. If one exists, skip spawning (update the in-memory set so we don't re-check next time).

3. **`adws/triggers/trigger_cron.ts`** — at startup, call the guard to check for an existing, non-ancestral `trigger_cron` process for the same repo. If one is found that is not in the current process's parent chain, the current (newer) process self-terminates (`process.exit(0)`).

The parent-chain check prevents a process from killing itself when it is started as a detached child of another `trigger_cron` (i.e., when one CLI call spawns multiple processes linked via parent ID).

## Steps to Reproduce
1. Start `bunx tsx adws/triggers/trigger_cron.ts` manually.
2. Start `bunx tsx adws/triggers/trigger_webhook.ts`.
3. Send a GitHub issue-opened webhook event; `ensureCronProcess` spawns a second cron process.
4. Stop and restart the webhook server.
5. Send another event; a third cron process is spawned.
6. `ps aux | grep trigger_cron` shows ≥2 processes for the same repo.

## Root Cause Analysis
`cronSpawnedForRepo` in `webhookGatekeeper.ts` is an in-memory `Set` that lives only for the lifetime of the webhook process. On restart it resets to empty, so `ensureCronProcess` always spawns a new cron process regardless of what is actually running on the OS. `trigger_cron.ts` has no startup guard at all.

## Relevant Files

- **`adws/triggers/webhookGatekeeper.ts`** — contains `ensureCronProcess`; needs OS-level duplicate check before spawning.
- **`adws/triggers/trigger_cron.ts`** — entry point for the cron process; needs startup self-deduplication.

### New Files
- **`adws/triggers/cronProcessGuard.ts`** — new module encapsulating all OS process inspection and kill logic.

## Step by Step Tasks

### 1. Create `adws/triggers/cronProcessGuard.ts`
- Export `function findExistingCronPid(repoKey: string): number | null`
  - Run `execSync('ps aux', { encoding: 'utf-8' })` and split into lines.
  - Filter lines that include `trigger_cron` and the `repoKey` string (e.g. `owner/repo`).
  - Exclude the current process (`process.pid`) and the `ps` command itself (`grep`).
  - Parse the PID from the matching line (second column in `ps aux` output).
  - Return the PID if found, otherwise `null`.
- Export `function getAncestorPids(pid: number): Set<number>`
  - Walk up the process tree from `pid` using `ps -o ppid= -p <pid>` until PID is 0 or 1.
  - Return all collected ancestor PIDs as a `Set<number>`.
- Export `function killProcessTree(pid: number): void`
  - Use `execSync(\`kill -- -\${pid}\`, ...)` to kill the process group, or fall back to `kill <pid>` if the process group kill fails.
  - Wrap in try/catch and log any errors without throwing.
- Export `function isLinkedToCurrentProcess(candidatePid: number): boolean`
  - Return `true` if `candidatePid` is in `getAncestorPids(process.pid)`.

### 2. Update `adws/triggers/webhookGatekeeper.ts` → `ensureCronProcess`
- Import `findExistingCronPid` from `./cronProcessGuard`.
- Before the in-memory `cronSpawnedForRepo` check (or in addition to it), call `findExistingCronPid(repoKey)`.
- If an existing OS-level PID is found, add `repoKey` to `cronSpawnedForRepo` (so future calls skip it) and return early without spawning.
- Only spawn when no OS process is found.

### 3. Update `adws/triggers/trigger_cron.ts` startup
- Import `findExistingCronPid` and `isLinkedToCurrentProcess` from `./cronProcessGuard`.
- Immediately after `cronRepoInfo` is resolved, compute `repoKey` and call `findExistingCronPid(repoKey)`.
- If a PID is returned and `!isLinkedToCurrentProcess(pid)`:
  - Log: `"Another trigger_cron already running for {repoKey} (PID {pid}). Exiting duplicate process."` with level `'warn'`.
  - `process.exit(0)`.
- Otherwise continue startup as normal.

### 4. Run Validation Commands
- Run the full validation suite listed below.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

```sh
# Lint
bun run lint

# Type check
bunx tsc --noEmit
bunx tsc --noEmit -p adws/tsconfig.json

# Build
bun run build
```

Manual smoke test (no automated test framework per `.adw/commands.md` Unit Tests: disabled):
```sh
# Terminal 1 — start first cron
bunx tsx adws/triggers/trigger_cron.ts &
FIRST_PID=$!
sleep 2

# Terminal 2 — attempt to start a second cron for the same repo
bunx tsx adws/triggers/trigger_cron.ts
# Expected: second process logs a warning and exits immediately

# Verify only one cron process remains
ps aux | grep trigger_cron | grep -v grep
# Expected: exactly one line

# Cleanup
kill $FIRST_PID
```

## Notes
- Unit tests are disabled for this project (`.adw/commands.md`: `## Unit Tests: disabled`). Validation is manual + type/lint/build.
- `ps aux` output format is portable across macOS and Linux. The PID is in column 2 (index 1 after splitting by whitespace).
- Using `kill -- -<pid>` targets the whole process group. If the process was spawned with `detached: true` it gets its own process group, so this terminates all children too. Fall back to `kill <pid>` if process group kill fails.
- The `isLinkedToCurrentProcess` ancestor walk should be capped at a max depth (e.g. 20 iterations) to avoid infinite loops if `ps -o ppid=` returns unexpected output.
