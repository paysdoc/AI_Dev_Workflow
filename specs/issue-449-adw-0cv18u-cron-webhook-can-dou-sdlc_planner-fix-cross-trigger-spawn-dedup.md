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
Apply two complementary guards at the single chokepoint `classifyAndSpawnWorkflow()` in `webhookGatekeeper.ts`. All four SDLC-spawn call sites (cron backlog, webhook `issue_comment`, webhook `issues.opened`, webhook dependency-unblock) already funnel through this function, so one change covers every path.

**Guard 1 — Unified spawn gate (new module `adws/triggers/spawnGate.ts`):**
Per-(repo, issue) atomic file lock, acquired at the top of `classifyAndSpawnWorkflow` before `classifyIssueForTrigger` runs. Mirrors the existing `cronProcessGuard.ts` (same `AGENTS_STATE_DIR`, same atomic `wx` flag, same `isProcessAlive` liveness approach):

- New module `adws/triggers/spawnGate.ts`.
- Lock file path: `agents/spawn_locks/{owner}_{repo}_issue-{N}.json`.
- Record: `{ pid: number, repoKey: string, issueNumber: number, startedAt: string }`.
- **Acquire (atomic)** via `acquireIssueSpawnLock(repoInfo, issueNumber, ownPid)`: `fs.writeFileSync(..., { flag: 'wx' })`. On EEXIST, read the existing record: if the recorded PID is alive, return `false` (lock held). If dead, remove the stale file and retry exclusive create once.
- **Release** via `releaseIssueSpawnLock(repoInfo, issueNumber)`: `fs.unlinkSync` wrapped in try/catch that ignores ENOENT (no-op if missing).

**Guard 2 — Post-classification eligibility recheck:**
After `classifyIssueForTrigger` resolves, re-check `isAdwRunningForIssue(issueNumber, repoInfo)` before spawning. This closes the narrow post-release window where another trigger could have acquired the lock and spawned an orchestrator that then posted its first ADW comment while the current call was still classifying. If a workflow has started, release the lock and return without spawning. This matches the issue's second suggested fix direction: "Webhook recheck post-classify: after the 5-min LLM classification, re-run the eligibility check against current comment state before spawning."

**Lock lifecycle:**
- Acquire at the very top of `classifyAndSpawnWorkflow` (before `classifyIssueForTrigger`).
- Release on the post-classification-recheck abort path.
- Release inside a catch block so a failed classification frees the issue for the next trigger cycle.
- Release on the success path after `spawnDetached` has fired. Race-window shortness is bounded by the post-classify recheck above plus the orchestrator's subsequent comment posting.
- Stale locks from crashed spawning processes are reclaimed by the next caller's PID-alive check during `acquireIssueSpawnLock`.

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

- `adws/triggers/webhookGatekeeper.ts` — contains `classifyAndSpawnWorkflow`, the single chokepoint for SDLC orchestrator spawns from all trigger paths (cron backlog, webhook comment, webhook issue-opened, webhook dependency-unblock). Primary integration point for acquiring/releasing the spawn lock and the post-classify recheck.
- `adws/triggers/trigger_cron.ts` — cron backlog sweeper; calls `classifyAndSpawnWorkflow` at line 153. No direct change needed beyond verifying the SDLC spawn branch in `checkAndTrigger` still routes through `classifyAndSpawnWorkflow` (not a direct `spawnDetached`).
- `adws/triggers/trigger_webhook.ts` — webhook handlers at lines 165 (`issue_comment`) and 219 (`issues.opened`) call `classifyAndSpawnWorkflow`. No direct change needed.
- `adws/triggers/cronProcessGuard.ts` — reference implementation for persistent PID-file guards using atomic `wx` creation and stale cleanup. The new module mirrors this pattern.
- `adws/core/stateHelpers.ts` — exports `isProcessAlive(pid)`; used by the new stale check.
- `adws/core/config.ts` — exports `AGENTS_STATE_DIR`; used for the lock directory location.
- `adws/github/githubApi.ts` — `RepoInfo` type used by lock-path derivation.
- `adws/github/workflowCommentsBase.ts` / `adws/github/index.ts` — re-exports `isAdwRunningForIssue` used for the post-classification recheck.
- `adws/core/issueClassifier.ts` — `classifyIssueForTrigger` (the 5-min LLM call). Understanding its runtime is required to pick the stale timeout.
- `adws/known_issues.md` — append a new entry `cross-trigger-double-spawn` with status `solved`, referencing issue #449.
- `guidelines/coding_guidelines.md` — file-size ≤ 300 lines, immutability, pure functions at boundaries, strict TypeScript, no `any`. The new module must comply.

### New Files
- `adws/triggers/spawnGate.ts` — new module exporting `acquireIssueSpawnLock` and `releaseIssueSpawnLock`. Mirrors the shape of `cronProcessGuard.ts`.
- `adws/triggers/__tests__/spawnGate.test.ts` — unit tests (vitest) covering atomic acquire, stale-lock detection via PID-alive check, explicit release, malformed JSON recovery, and per-(repo, issue) key isolation. Uses a temp `agents/` dir set via environment override.
- `features/fix_cross_trigger_spawn_dedup.feature` — BDD regression scenarios verifying `classifyAndSpawnWorkflow` uses the spawn gate, the lock file uses `wx`, and the post-classification recheck aborts spawn when another workflow has started. (This file already exists tagged `@adw-0cv18u-cron-webhook-can-dou @adw-449` and is the contract the implementation must satisfy.)

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Create `adws/triggers/spawnGate.ts`
- Create the file and keep it under 300 lines (target: ~120).
- Import `fs` and `path`.
- Import `AGENTS_STATE_DIR` from `../core/config`.
- Import `log` from `../core`.
- Import `isProcessAlive` from `../core/stateHelpers`.
- Import `RepoInfo` type from `../github/githubApi`.
- Define the record interface:
  ```ts
  interface IssueSpawnLockRecord {
    readonly pid: number;
    readonly repoKey: string;
    readonly issueNumber: number;
    readonly startedAt: string;
  }
  ```
- Implement `getSpawnLockFilePath(repoInfo: RepoInfo, issueNumber: number): string` → `path.join(AGENTS_STATE_DIR, 'spawn_locks', \`${owner}_${repo}_issue-${N}.json\`)`. Derive `repoKey` as `${owner}/${repo}` then apply `.replace('/', '_')` to the path fragment, consistent with `cronProcessGuard`.
- Implement `ensureSpawnLockDir(): void` via `fs.mkdirSync(path.join(AGENTS_STATE_DIR, 'spawn_locks'), { recursive: true })`.
- Implement `readSpawnLock(filePath: string): IssueSpawnLockRecord | null` — parse JSON; return null on missing file or malformed JSON.
- Implement `removeSpawnLock(filePath: string): void` — `fs.unlinkSync` wrapped in try/catch that ignores ENOENT.
- Implement `tryExclusiveCreate(filePath: string, record: IssueSpawnLockRecord): boolean` — `fs.writeFileSync(filePath, JSON.stringify(record, null, 2), { flag: 'wx' })`; catch EEXIST → return false; rethrow other errors. Matches `cronProcessGuard::tryExclusiveCreate`.
- Implement `acquireIssueSpawnLock(repoInfo: RepoInfo, issueNumber: number, ownPid: number): boolean`:
  1. `ensureSpawnLockDir()`.
  2. Build record with `pid: ownPid`, `repoKey: ${owner}/${repo}`, `issueNumber`, `startedAt: new Date().toISOString()`.
  3. If `tryExclusiveCreate` succeeds → return true.
  4. Read existing record. If null/malformed → treat as stale, `removeSpawnLock`, retry `tryExclusiveCreate` once, return the retry result.
  5. If `isProcessAlive(existing.pid)` → return false (log `spawn lock held for ${repoKey}#${issueNumber} by pid=${existing.pid}`).
  6. Stale PID: log removal, `removeSpawnLock`, retry `tryExclusiveCreate` once, return the retry result.
- Implement `releaseIssueSpawnLock(repoInfo: RepoInfo, issueNumber: number): void` that calls `removeSpawnLock(getSpawnLockFilePath(repoInfo, issueNumber))`.
- Export: `acquireIssueSpawnLock`, `releaseIssueSpawnLock`. Keep `getSpawnLockFilePath` exported so tests and guards can locate the file.

### Step 2: Wire the gate and post-classify recheck into `classifyAndSpawnWorkflow`
- In `adws/triggers/webhookGatekeeper.ts`:
  - Import `acquireIssueSpawnLock`, `releaseIssueSpawnLock` from `./spawnGate`.
  - Import `isAdwRunningForIssue` from `../github` (or the correct barrel).
  - At the very top of `classifyAndSpawnWorkflow`, after `resolvedRepoInfo` is computed and before calling `classifyIssueForTrigger`:
    ```ts
    const acquired = acquireIssueSpawnLock(resolvedRepoInfo, issueNumber, process.pid);
    if (!acquired) {
      log(`Issue #${issueNumber}: spawn lock held by another process, skipping`);
      return;
    }
    ```
  - Wrap the remainder of the function body in a `try { ... } catch (err) { releaseIssueSpawnLock(resolvedRepoInfo, issueNumber); throw err; }`.
  - Immediately AFTER `classifyIssueForTrigger` resolves (inside the try block, before computing the workflow script / adwId), perform the post-classification recheck:
    ```ts
    if (await isAdwRunningForIssue(issueNumber, resolvedRepoInfo)) {
      log(`Issue #${issueNumber}: another ADW workflow started during classification, aborting spawn`);
      releaseIssueSpawnLock(resolvedRepoInfo, issueNumber);
      return;
    }
    ```
  - On the success path (after `spawnDetached` returns), release the lock: `releaseIssueSpawnLock(resolvedRepoInfo, issueNumber);`.
- No other spawn sites should be added. All four existing trigger paths already converge on `classifyAndSpawnWorkflow`.

### Step 3: Unit tests for `spawnGate`
- Create `adws/triggers/__tests__/spawnGate.test.ts`.
- Use a temporary directory for `AGENTS_STATE_DIR` per test (vitest `beforeEach` creating `fs.mkdtempSync` and setting `process.env.AGENTS_STATE_DIR` before importing the module, OR wrap the guard so tests can pass a path). Match the pattern used in `adws/core/__tests__/topLevelState.test.ts`.
- Cases to cover:
  1. First acquire succeeds and writes a record with `pid`, `repoKey`, `issueNumber`, `startedAt`.
  2. Second acquire while first holder's PID is alive returns `false`.
  3. Second acquire when first holder's PID is dead → stale, second acquire succeeds.
  4. Two different issues in the same repo can both acquire concurrently (no collision).
  5. Same issue number in two different repos can both acquire concurrently (no collision).
  6. `releaseIssueSpawnLock` removes the lock file.
  7. `releaseIssueSpawnLock` is a no-op when the lock file does not exist (no throw).
  8. Malformed JSON in the lock file is treated as stale and overwritten on next acquire.
  9. Concurrent `acquireIssueSpawnLock` calls from two processes: only one receives `true` (simulated via the `wx` flag semantics; a parallel test with two `Promise.all` spawns on the same key verifies exactly one success).
- Mock `isProcessAlive` via `vi.mock('../../core/stateHelpers', ...)` so tests remain deterministic without real PIDs.

### Step 4: Validate BDD regression scenarios
- The feature file `features/fix_cross_trigger_spawn_dedup.feature` already exists tagged `@adw-0cv18u-cron-webhook-can-dou @adw-449`. Do not rewrite it. Ensure every scenario passes after your implementation:
  - Module existence and the `'wx'` / `EEXIST` string presence.
  - `acquireIssueSpawnLock` / `releaseIssueSpawnLock` exports.
  - Lock path contains both repo owner and issue number; is rooted at `AGENTS_STATE_DIR`.
  - `classifyAndSpawnWorkflow` calls `acquireIssueSpawnLock` before `classifyIssueForTrigger`, logs a `spawn lock` message on failure, and returns early without calling `spawnDetached`.
  - `classifyAndSpawnWorkflow` calls `isAdwRunningForIssue` after `classifyIssueForTrigger` and calls `releaseIssueSpawnLock` on the post-classification abort path.
  - Cron SDLC branch routes through `classifyAndSpawnWorkflow`; webhook `issue_comment`, `issues.opened`, and dependency-unblock paths also route through it.
  - Stale lock from a dead spawning PID is reclaimable on the next acquire attempt.
  - `adws/known_issues.md` contains a `cross-trigger-double-spawn` entry with status `solved` that references issue #449.
  - `bunx tsc --noEmit` and `bunx tsc --noEmit -p adws/tsconfig.json` both exit 0.
- If any scenario requires a step definition that does not yet exist, add it under `features/step_definitions/` in the same style as the nearest file-reading step defs (`features/step_definitions/cron_guard_toctou_fix.steps.ts` is a close reference for the substring-and-ordering assertions).

### Step 5: Manual reproduction check
- Simulate the race locally using two shell invocations:
  1. In one terminal, call `classifyAndSpawnWorkflow(N, repoInfo, [], undefined)` twice in quick succession (via a tiny driver script in `/tmp`) with the second call starting before the first awaits.
  2. Verify only one `spawnDetached` fires (grep the logs for `Spawning:` lines).
  3. Verify `agents/spawn_locks/{owner}_{repo}_issue-N.json` exists during the first call and is removed after success.
- Kill the spawning process mid-classification (`kill <pid>`). The lock file will remain but reference a dead PID. Invoke `classifyAndSpawnWorkflow(N, ...)` again — should acquire the lock because `isProcessAlive(record.pid)` returns false. Verify a new spawn occurs.

### Step 6: Update coding-guideline-sensitive artifacts and known issues
- Ensure `spawnGate.ts` stays under 300 lines (target: ~120). Functions are pure where possible, with side effects (fs reads/writes, log) isolated.
- No `any` types; use `Readonly` for the record; use `JSON.parse(...) as unknown` narrowed via type-guard helper if needed.
- Append a new entry to `adws/known_issues.md` with:
  - name: `cross-trigger-double-spawn`
  - status: `solved`
  - references issue `#449`
  - shape/style mirror existing entries such as `dependency-check-fail-open`.

### Step 7: Run validation commands
- Execute every command in the `Validation Commands` section and confirm all pass.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

- `bun install` — ensures dependencies are installed.
- `bun run lint` — lint the full codebase.
- `bunx tsc --noEmit` — top-level type-check.
- `bunx tsc --noEmit -p adws/tsconfig.json` — adws-scoped type-check.
- `bun run build` — verify build.
- `bun run test:unit` — run unit tests (includes new `spawnGate.test.ts`; must pass with coverage over the cases listed in Step 3).
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-449"` — run the new BDD feature in isolation.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — run the full regression suite to confirm no other feature was broken.

Repro verification (manual, from Step 5):
- Before fix: two `Spawning:` log lines for the same issue number within minutes, two `agents/{adwId}/sdlc-orchestrator/state.json` directories.
- After fix: single `Spawning:` log line; the second call logs `spawn lock held by another process, skipping`; only one `agents/{adwId}` directory created.

## Notes
- Strictly adhere to `guidelines/coding_guidelines.md`: file under 300 lines, immutable data shapes (`Readonly<IssueSpawnLockRecord>`), pure stale-check logic, side effects at module boundaries, no `any`.
- Reuse, do not reinvent: copy the atomic-create and stale-cleanup structure from `adws/triggers/cronProcessGuard.ts` rather than inventing a new pattern. Keep both guards independent modules — they have different key shapes (`repoKey` vs `(repoKey, issueNumber)`) and different lifecycles.
- Do NOT modify `concurrencyGuard.ts`. The per-repo concurrency cap is orthogonal to per-issue spawn dedup; widening `concurrencyGuard` to per-(repo,issue) would still depend on GitHub API state that lags the spawn.
- Do NOT modify `isAdwRunningForIssue()`. Its GitHub-comments dependency is inherent; the spawn gate fills the gap during the pre-first-comment window, and the post-classification recheck closes the brief post-release race.
- The in-memory `processedSpawns` Set (cron) and `recentIssueTriggers` Map (webhook) stay as fast-path caches and first-defence-within-process. The spawn gate is the second line of defence across processes.
- The stranded 0ejypj orchestrator from the 2026-04-18 incident is out of scope for this fix (see `pauseQueueScanner` follow-up work).
- Library install command (from `.adw/commands.md`): `bun add <package>`. No new dependencies are required.
- Test runner (from `.adw/commands.md`): `bun run test:unit` for unit tests, `NODE_OPTIONS="--import tsx" bunx cucumber-js` for BDD.
