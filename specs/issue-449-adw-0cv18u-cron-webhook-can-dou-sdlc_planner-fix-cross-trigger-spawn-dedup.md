# Bug: Cron + webhook double-spawn orchestrators on dependency-closure transitions

## Metadata
issueNumber: `449`
adwId: `0cv18u-cron-webhook-can-dou`
issueJson: `{"number":449,"title":"Cron + webhook can double-spawn orchestrators on dependency-closure transitions","body":"There is no cross-trigger dedup between adws/triggers/trigger_cron.ts (20s poll) and adws/triggers/trigger_webhook.ts / webhookGatekeeper.ts. The webhook's /classify_issue LLM call is ~5 minutes wide, creating a race gap the cron can fit 15 polls into.","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-04-18T16:52:57Z","comments":[],"actionableComment":null}`

## Bug Description
When a parent issue closes, both the cron backlog sweeper and the webhook's dependency-unblock handler can spawn independent SDLC orchestrators for the same dependent issue. The race window is wide (~5 minutes) because `/classify_issue` is a long-running LLM call, and none of the existing dedup mechanisms cross process boundaries.

**Observed (2026-04-18, paysdoc/depaudit #6):**
- 12:18:01 — cron merges #5.
- 12:18:14 — webhook receives `issues.closed`, calls `handleIssueClosedDependencyUnblock` → `classifyAndSpawnWorkflow(#6)` → enters `classifyIssueForTrigger` (~5 min LLM call).
- 12:21:59 — cron polls (every 20 s). Issue #6 has no ADW workflow comment yet, so `filterEligibleIssues` and `checkIssueEligibility` both pass. Cron calls `classifyAndSpawnWorkflow(#6)` and spawns `u2drew-polyglot-ecosystem-s`.
- 12:23:18 — webhook's classification finishes, spawns `0ejypj-polyglot-ecosystem-s` blind to the cron's already-running spawn.
- Both orchestrators ran install → scenario planning → plan → alignment with LLM-generated plan slugs that diverged (`manifest-discovery` vs `manifest-discoverer`), hit rate limit around 12:45, and left two pause-queue entries. Doubled cost, conflicting branches, stranded `0ejypj` state.

**Expected:** exactly one SDLC orchestrator per `(repo, issue)` at any time.
**Actual:** two independent orchestrators are spawned whenever the cron polls during the webhook's classification window.

## Problem Statement
No cross-trigger dedup exists between `adws/triggers/trigger_cron.ts` and `adws/triggers/trigger_webhook.ts` / `adws/triggers/webhookGatekeeper.ts`. All current guards are scoped too narrowly to prevent this race:

| Guard | Scope | Why it fails |
|---|---|---|
| `processedSpawns` Set in `trigger_cron.ts` | in-memory, cron process only | invisible to webhook |
| `recentIssueTriggers` Map in `trigger_webhook.ts` | in-memory, webhook process only, 60 s cooldown | invisible to cron; cooldown shorter than classify window |
| `isAdwRunningForIssue()` (`workflowCommentsBase.ts`) | reads ADW workflow comments from GitHub | comments are posted AFTER orchestrator startup — false negative during the classify-to-first-comment window |
| `concurrencyGuard` (`isConcurrencyLimitReached`) | per-repo count, not per-issue | admits a second spawn as long as total in-progress count < limit |
| `cronProcessGuard` (`registerAndGuard`) | dedups the cron trigger process itself | does not gate SDLC orchestrator spawns |

The narrow race window makes this a cross-process concurrency bug, so the fix must use a persistent medium (file system) and be atomic (TOCTOU-safe).

## Solution Statement
Add a **persistent per-(repo, issue) spawn lock** file-based guard, acquired at the single chokepoint `classifyAndSpawnWorkflow()` in `webhookGatekeeper.ts`. All four SDLC-spawn call sites (cron backlog, webhook `issue_comment`, webhook `issues.opened`, webhook dependency-unblock) already funnel through this function, so one lock acquisition inside it covers every path.

Pattern mirrors the existing `cronProcessGuard.ts` (same `AGENTS_STATE_DIR`, same atomic `wx` flag, same `isProcessAlive` liveness approach):

- New module `adws/triggers/spawnLockGuard.ts`.
- Lock file path: `agents/spawn_locks/{owner}_{repo}_issue-{N}.json`.
- Record: `{ pid: number, repoKey: string, issueNumber: number, adwId: string | null, startedAt: string }`.
- **Acquire (atomic)**: `fs.writeFileSync(..., { flag: 'wx' })`. On EEXIST, run a stale check and retry once.
- **Stale check** — the lock is held if either:
  1. `isProcessAlive(record.pid)` AND `now - startedAt < MAX_LOCK_AGE_MS` (spawner still classifying), OR
  2. `record.adwId != null` AND `isAgentProcessRunning(record.adwId)` (orchestrator still running).

  Otherwise stale → remove and retry.
- **Update adwId**: after `classifyIssueForTrigger` resolves and the final `adwId` is known (either `existingAdwId`, `classification.adwId`, or `generateAdwId(...)`), rewrite the record with `adwId` populated. This shifts the lock's "held" signal from "spawner alive" to "orchestrator alive", surviving webhook/cron restarts.
- **Release on error**: explicit `removeSpawnLock` in the catch block of `classifyAndSpawnWorkflow`, so a failed classification frees the issue for the next trigger cycle.
- **Release on success**: NOT explicitly released. The lock naturally becomes stale when `isAgentProcessRunning(adwId)` returns false (orchestrator exited, whether success, failure, or pause). The next eligible spawn attempt performs the stale sweep inline.
- `MAX_LOCK_AGE_MS = 10 * 60 * 1000` (10 min — generously longer than observed 5-min classify window; a backstop only).

No changes to `concurrencyGuard.ts` or `isAdwRunningForIssue()`. No changes to the existing in-memory per-process guards (they remain as fast-path caches).

## Steps to Reproduce
1. Create two issues in a target repo: `#A` with a description requiring minutes of work, and `#B` whose body contains `Blocked by #A`.
2. Start the webhook: `bunx tsx adws/triggers/trigger_webhook.ts`. The webhook spawns a cron via `ensureCronProcess`.
3. Simulate the race:
   - Close `#A` (or merge a PR that closes `#A`) within the cron's 20 s poll interval.
   - Observe the webhook receive `issues.closed` and log `Issue #B unblocked by closure of #A, spawning workflow`.
   - Watch the cron poll log: within the next 15 polls (5 min), it logs `POLL: N open, M candidate(s) [#B, ...]` and `Triggering ADW workflow for backlog issue #B`.
4. Look at `agents/` — two distinct `{adwId}/sdlc-orchestrator/state.json` directories will exist for the same issue number with different plan filenames.

## Root Cause Analysis
`classifyAndSpawnWorkflow()` performs three operations sequentially: (a) `classifyIssueForTrigger` (up to ~5 min LLM call), (b) `generateAdwId`, (c) `spawnDetached(...)`. No shared state is written between (a) and (c) — the only visible signal that a spawn is in-flight is the detached child eventually posting its first workflow comment on the issue, which happens well after step (c).

`trigger_cron.ts::checkAndTrigger` polls every 20 s and relies on:
- `processedSpawns` — but this `Set` lives in the cron process only; the webhook's spawn was made from a different process.
- `filterEligibleIssues` / `resolveIssueWorkflowStage` — these parse ADW workflow comments; during the ~5-min webhook classify window no comments exist yet, so the stage resolves to `null` ("fresh issue, eligible").
- `checkIssueEligibility` — checks dependencies (now satisfied because `#A` is closed) and per-repo concurrency count (still under the limit because no ADW comment counts yet).

So the cron correctly concludes `#B` is eligible and spawns — exactly what it should do if no other process were working on it. The bug is strictly the absence of cross-process communication about "spawn in flight for this issue".

The webhook's parallel `ensureCronProcess` dedup (via PID file + `isCronAliveForRepo`) solved the analogous problem for cron processes; we are applying the same file-based atomic pattern one layer deeper, at the orchestrator-spawn level.

## Relevant Files
Use these files to fix the bug:

- `adws/triggers/webhookGatekeeper.ts` — contains `classifyAndSpawnWorkflow`, the single chokepoint for SDLC orchestrator spawns from all trigger paths (cron backlog, webhook comment, webhook issue-opened, webhook dependency-unblock). Primary integration point for acquiring/updating the spawn lock.
- `adws/triggers/trigger_cron.ts` — cron backlog sweeper; calls `classifyAndSpawnWorkflow` at line 153. No direct change needed beyond verifying the lock acquisition covers this path.
- `adws/triggers/trigger_webhook.ts` — webhook handlers at lines 165 (`issue_comment`) and 219 (`issues.opened`) call `classifyAndSpawnWorkflow`. No direct change needed.
- `adws/triggers/cronProcessGuard.ts` — reference implementation for persistent PID-file guards using atomic `wx` creation and stale cleanup. The new module mirrors this pattern.
- `adws/core/stateHelpers.ts` — exports `isProcessAlive(pid)` and `isAgentProcessRunning(adwId)`; both used by the new stale check.
- `adws/core/config.ts` — exports `AGENTS_STATE_DIR`; used for the lock directory location.
- `adws/core/adwId.ts` / `adws/core/index.ts` — `generateAdwId` is called inside `classifyAndSpawnWorkflow`; after it runs we know the final adwId and update the lock record.
- `adws/github/githubApi.ts` — `RepoInfo` type used by lock-path derivation.
- `adws/core/issueClassifier.ts` — `classifyIssueForTrigger` (the 5-min LLM call). Understanding its runtime is required to pick the stale timeout.
- `guidelines/coding_guidelines.md` — file-size ≤ 300 lines, immutability, pure functions at boundaries, strict TypeScript, no `any`. The new module must comply.

### New Files
- `adws/triggers/spawnLockGuard.ts` — new module exporting `tryAcquireSpawnLock`, `updateSpawnLockAdwId`, `releaseSpawnLock`, `getSpawnLockFilePath`. Mirrors the shape of `cronProcessGuard.ts`.
- `adws/triggers/__tests__/spawnLockGuard.test.ts` — unit tests (vitest) covering atomic acquire, stale-lock detection (both via timeout and via orchestrator death), explicit release, and adwId update. Uses a temp `agents/` dir set via environment override.
- `features/cross_trigger_spawn_dedup.feature` — BDD regression scenarios verifying `classifyAndSpawnWorkflow` uses the spawn lock, the lock file uses `wx`, and the stale check consults both `isProcessAlive` and `isAgentProcessRunning`.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Create `adws/triggers/spawnLockGuard.ts`
- Create the file and keep it under 300 lines.
- Import `fs` and `path`.
- Import `AGENTS_STATE_DIR` from `../core/config`.
- Import `log` from `../core`.
- Import `isProcessAlive`, `isAgentProcessRunning` from `../core/stateHelpers`.
- Import `RepoInfo` type from `../github/githubApi`.
- Define the record interface:
  ```ts
  interface SpawnLockRecord {
    readonly pid: number;
    readonly repoKey: string;
    readonly issueNumber: number;
    readonly adwId: string | null;
    readonly startedAt: string;
  }
  ```
- Define `const MAX_LOCK_AGE_MS = 10 * 60 * 1000;` at module scope.
- Implement `getSpawnLockFilePath(repoInfo: RepoInfo, issueNumber: number): string` → `path.join(AGENTS_STATE_DIR, 'spawn_locks', '${owner}_${repo}_issue-${N}.json')`. Use `.replace('/', '_')` semantics consistent with `cronProcessGuard`.
- Implement `ensureSpawnLockDir(): void` via `fs.mkdirSync(..., { recursive: true })`.
- Implement `readSpawnLock(filePath: string): SpawnLockRecord | null` — parse JSON; return null on missing file or malformed JSON.
- Implement `removeSpawnLock(filePath: string): void` — `fs.unlinkSync` wrapped in try/catch that ignores ENOENT.
- Implement `isLockHeld(record: SpawnLockRecord, now: number): boolean`:
  - If `record.adwId !== null` and `isAgentProcessRunning(record.adwId)` → `true`.
  - Else if `record.adwId === null` and `isProcessAlive(record.pid)` and `now - new Date(record.startedAt).getTime() < MAX_LOCK_AGE_MS` → `true`.
  - Else `false`.
- Implement `tryExclusiveCreate(filePath: string, record: SpawnLockRecord): boolean` — `fs.writeFileSync(filePath, JSON.stringify(record, null, 2), { flag: 'wx' })`; catch EEXIST → return false; rethrow other errors. Matches `cronProcessGuard::tryExclusiveCreate`.
- Implement `tryAcquireSpawnLock(repoInfo: RepoInfo, issueNumber: number, ownPid: number): boolean`:
  1. `ensureSpawnLockDir()`.
  2. Build initial record with `adwId: null`.
  3. If `tryExclusiveCreate` succeeds → return true.
  4. Read existing record. If null/malformed → treat as stale, remove, retry `tryExclusiveCreate` once; return the retry result.
  5. If `isLockHeld(existing, Date.now())` → return false (log `spawn lock held for ${repoKey}#${issueNumber} by pid=${record.pid} adwId=${record.adwId ?? 'none'}`).
  6. Stale: log removal, `removeSpawnLock`, retry `tryExclusiveCreate` once; return the retry result.
- Implement `updateSpawnLockAdwId(repoInfo: RepoInfo, issueNumber: number, adwId: string): void`:
  1. Read the existing record. If null, log a warning and return (do not create — the caller never held the lock).
  2. Write `{...existing, adwId}` back to the file with default flag (overwrite).
- Implement `releaseSpawnLock(repoInfo: RepoInfo, issueNumber: number): void` that calls `removeSpawnLock(getSpawnLockFilePath(...))`.
- Export only: `tryAcquireSpawnLock`, `updateSpawnLockAdwId`, `releaseSpawnLock`, `getSpawnLockFilePath`.

### Step 2: Wire the lock into `classifyAndSpawnWorkflow`
- In `adws/triggers/webhookGatekeeper.ts`:
  - Import `tryAcquireSpawnLock`, `updateSpawnLockAdwId`, `releaseSpawnLock` from `./spawnLockGuard`.
  - At the top of `classifyAndSpawnWorkflow`, after `resolvedRepoInfo` is computed:
    ```ts
    const acquired = tryAcquireSpawnLock(resolvedRepoInfo, issueNumber, process.pid);
    if (!acquired) {
      log(`Issue #${issueNumber}: spawn lock held by another process, skipping`);
      return;
    }
    ```
  - Wrap the remainder of the function body in `try { ... } catch (err) { releaseSpawnLock(resolvedRepoInfo, issueNumber); throw err; }`.
  - Immediately after `const adwId = existingAdwId || classification.adwId || generateAdwId(classification.issueTitle);`, call `updateSpawnLockAdwId(resolvedRepoInfo, issueNumber, adwId);`.
- Do NOT release the lock on the success path — the orchestrator is now running and the lock's `adwId` field + `isAgentProcessRunning` will let future callers recognize the held state.

### Step 3: Unit tests for `spawnLockGuard`
- Create `adws/triggers/__tests__/spawnLockGuard.test.ts`.
- Use a temporary directory for `AGENTS_STATE_DIR` per test (vitest `beforeEach` creating `fs.mkdtempSync` and setting `process.env.AGENTS_STATE_DIR` + re-importing the module, OR wrap the guard so tests can pass a path). Match the pattern used in `adws/core/__tests__/topLevelState.test.ts`.
- Cases to cover:
  1. First acquire succeeds and writes a fresh record with `adwId: null`.
  2. Second acquire while first holder's PID is alive returns `false`.
  3. Second acquire when first holder's PID is dead AND `adwId` is null → stale, second acquire succeeds.
  4. Second acquire when `adwId` is set and `isAgentProcessRunning(adwId)` returns true → returns `false`.
  5. Second acquire when `adwId` is set and `isAgentProcessRunning(adwId)` returns false → stale, second acquire succeeds.
  6. `startedAt` older than `MAX_LOCK_AGE_MS` AND PID dead → stale.
  7. `startedAt` older than `MAX_LOCK_AGE_MS` AND PID alive but no adwId → still considered held (PID alive branch of `isLockHeld` requires the age condition; confirm behaviour matches the spec). Treat as stale per `isLockHeld` definition (age exceeded → held branch fails → stale).
  8. `updateSpawnLockAdwId` writes `adwId` and preserves `pid`, `repoKey`, `issueNumber`, `startedAt`.
  9. `releaseSpawnLock` removes the file and is safe when the file does not exist.
  10. Malformed JSON in the lock file is treated as stale and overwritten.
- Mock `isProcessAlive` and `isAgentProcessRunning` via `vi.mock('../../core/stateHelpers', ...)` so tests remain deterministic without real PIDs.

### Step 4: BDD regression scenarios
- Create `features/cross_trigger_spawn_dedup.feature` tagged `@adw-0cv18u-cron-webhook-can-dou` and `@regression`. Follow the file-read assertion pattern used in `features/cron_guard_toctou_fix.feature`. Scenarios:
  1. `spawnLockGuard.ts` exists and uses the `'wx'` flag.
  2. `spawnLockGuard.ts` contains both `isProcessAlive` and `isAgentProcessRunning` references.
  3. `webhookGatekeeper.ts` imports from `./spawnLockGuard`.
  4. `classifyAndSpawnWorkflow` calls `tryAcquireSpawnLock` before `classifyIssueForTrigger` (assert the substring order in the file).
  5. `classifyAndSpawnWorkflow` calls `updateSpawnLockAdwId` after the final `adwId` is computed (substring order: `generateAdwId` … `updateSpawnLockAdwId`).
  6. `classifyAndSpawnWorkflow` calls `releaseSpawnLock` inside a catch block.
  7. `MAX_LOCK_AGE_MS` constant is defined and set to 10 minutes (`600_000` or `10 * 60 * 1000`).
  8. TypeScript type-check passes: `Then the ADW TypeScript type-check passes` (reusing the existing step definition).
- If a new step is needed, add it to `features/step_definitions/` in the same style as nearby files.

### Step 5: Manual reproduction check
- Simulate the race locally using two shell invocations:
  1. In one terminal, call `classifyAndSpawnWorkflow(N, repoInfo, [], undefined)` twice in quick succession (via a tiny driver script in `/tmp`) with the second call starting before the first awaits.
  2. Verify only one `spawnDetached` fires (grep the logs for `Spawning:` lines).
  3. Verify `agents/spawn_locks/{owner}_{repo}_issue-N.json` exists and contains the adwId of the winner.
- Kill the spawned orchestrator process (`kill <pid>`). Wait a few seconds. Invoke `classifyAndSpawnWorkflow(N, ...)` again — should acquire the lock because `isAgentProcessRunning(adwId)` returns false. Verify a new spawn occurs.

### Step 6: Update coding-guideline-sensitive artifacts
- Ensure `spawnLockGuard.ts` stays under 300 lines (target: ~120). Functions are pure where possible, with side effects (fs reads/writes, log) isolated.
- No `any` types; use `Readonly` for the record; use `JSON.parse(...) as unknown` narrowed via type-guard helper if needed.
- Update `adws/known_issues.md` if an entry like `cross-trigger-duplicate-spawn` is warranted (mirror the shape of existing entries such as `dependency-check-fail-open`).

### Step 7: Run validation commands
- Execute every command in the `Validation Commands` section and confirm all pass.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

- `bun install` — ensures dependencies are installed.
- `bun run lint` — lint the full codebase.
- `bunx tsc --noEmit` — top-level type-check.
- `bunx tsc --noEmit -p adws/tsconfig.json` — adws-scoped type-check.
- `bun run build` — verify build.
- `bun run test:unit` — run unit tests (includes new `spawnLockGuard.test.ts`; must pass with coverage over the 10 cases listed in Step 3).
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-0cv18u-cron-webhook-can-dou"` — run the new BDD feature in isolation.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — run the full regression suite to confirm no other feature was broken.

Repro verification (manual, from Step 5):
- Before fix: two `Spawning:` log lines for the same issue number within minutes, two `agents/{adwId}/sdlc-orchestrator/state.json` directories.
- After fix: single `Spawning:` log line; the second call logs `spawn lock held by another process, skipping`; only one `agents/{adwId}` directory created.

## Notes
- Strictly adhere to `guidelines/coding_guidelines.md`: file under 300 lines, immutable data shapes (`Readonly<SpawnLockRecord>`), pure stale-check logic, side effects at module boundaries, no `any`.
- Reuse, do not reinvent: copy the atomic-create and stale-cleanup structure from `adws/triggers/cronProcessGuard.ts` rather than inventing a new pattern. Keep both guards independent modules — they have different stale signals (cron process vs orchestrator process + classifier).
- Do NOT modify `concurrencyGuard.ts`. The per-repo concurrency cap is orthogonal to per-issue spawn dedup; widening `concurrencyGuard` to per-(repo,issue) would still depend on GitHub API state that lags the spawn.
- Do NOT modify `isAdwRunningForIssue()`. Its GitHub-comments dependency is inherent; the spawn lock fills the gap during the pre-first-comment window.
- The in-memory `processedSpawns` Set (cron) and `recentIssueTriggers` Map (webhook) stay as fast-path caches and first-defence-within-process. The spawn lock is the second line of defence across processes.
- The stranded 0ejypj orchestrator from the 2026-04-18 incident is out of scope for this fix (see `pauseQueueScanner` follow-up work).
- Library install command (from `.adw/commands.md`): `bun add <package>`. No new dependencies are required.
- Test runner (from `.adw/commands.md`): `bun run test:unit` for unit tests, `NODE_OPTIONS="--import tsx" bunx cucumber-js` for BDD.
