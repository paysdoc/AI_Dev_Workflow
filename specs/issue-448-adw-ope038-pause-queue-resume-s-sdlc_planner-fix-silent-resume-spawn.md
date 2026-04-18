# Bug: Pause-queue resume silently fails on spawn errors

## Metadata
issueNumber: `448`
adwId: `ope038-pause-queue-resume-s`
issueJson: `{"number":448,"title":"Pause-queue resume silently fails on spawn errors","body":"In `adws/triggers/pauseQueueScanner.ts:63-117` (`resumeWorkflow`), the auto-resume spawn has three failure modes that cause silent, unrecoverable loss of a paused workflow:\n\n1. **`stdio: 'ignore'`** (line 115) swallows all child startup errors. The \"Resuming workflow ...\" log line is printed before the spawn and is indistinguishable from a successful vs. crashed-on-startup spawn.\n2. **No `cwd` set** — child inherits the cron host's cwd (`AI_Dev_Workflow`), not the target-repo worktree.\n3. **Destructive `removeFromPauseQueue(entry.adwId)` on line 89 runs BEFORE `spawn()`** with no rollback. If the spawn fails, the entry is permanently lost and no retry mechanism exists.\n\nRelated historical bug (fixed in 476fcb3): entries lacking `extraArgs: ['--target-repo', 'owner/repo']` produced children that defaulted to the cron host repo.\n\n## Incident (2026-04-18)\n\nu2drew + 0ejypj paused on depaudit#6 at ~12:45. At 12:49:32 the scanner logged \"Rate limit cleared — resuming workflow ...\" for both. Neither child actually started; the pause queue went empty; 0ejypj was stranded until a manual \\`## Take action\\` comment re-spawned u2drew 3.5h later (0ejypj still stranded).\n\n## Suggested fix directions\n\n- Capture child stdout/stderr (pipe to a per-resume log file) instead of \\`stdio: 'ignore'\\`.\n- Pass \\`cwd: entry.worktreePath\\` to \\`spawn()\\`.\n- Wait briefly for child to reach a known \"alive\" state before removing from queue, or remove only on confirmed spawn success.","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-04-18T16:52:42Z","comments":[],"actionableComment":null}`

## Bug Description

`resumeWorkflow()` in `adws/triggers/pauseQueueScanner.ts` fan-outs detached orchestrator processes to resume rate-limited workflows. The current implementation has three independent failure modes that collectively make a spawn failure silently permanent:

1. **Swallowed stderr/stdout** — `spawn(..., { stdio: 'ignore' })` discards everything the child writes, so a TypeScript import error, missing `bunx`, misbehaving env, or crash during `workflowInit` leaves zero forensic trail.
2. **No `cwd` pinned** — the child inherits whatever the cron process' cwd is. Today that is `AI_Dev_Workflow` (the cron host repo) which is actually what the orchestrator needs (`adws/*.tsx`, `agents/` state, `.worktrees/` lookup all resolve from there). But the inheritance is implicit — anyone who spawns `trigger_cron` from a different directory (e.g., a test harness or a future multi-root setup) breaks resume silently. The fix is to **make the cwd explicit**, not to switch to `entry.worktreePath` (which would be the target repo and would *break* the orchestrator because `adws/` does not exist there — see `ls /Users/martin/projects/paysdoc/depaudit/.worktrees/*/` vs `adws/`).
3. **Eager `removeFromPauseQueue`** — the entry is deleted from `agents/paused_queue.json` on line 89, BEFORE `spawn()` on line 115. If the spawn fails or the child exits immediately, the entry is gone. No retry path exists. The "resumed" issue comment has already been posted.

## Expected vs Actual Behavior

**Expected** — When the probe reports `clear`, every queued workflow either:
(a) starts a live child process, posts a `▶️ Resumed` comment, and is removed from the queue; or
(b) fails loudly: the entry stays in the queue for next-cycle retry, a diagnostic log with captured stderr is persisted, and no `▶️ Resumed` comment is posted.

**Actual** — The scanner prints `Resuming workflow ...`, immediately removes the entry, posts the `▶️ Resumed` comment, and fires a blind detached spawn. If the child crashes before writing any GitHub side-effects, the user sees a `▶️ Resumed` message that is a lie; the workflow is permanently stranded and no cron cycle can recover it.

## Problem Statement

A rate-limited workflow can be permanently lost if, after the probe succeeds, its detached orchestrator respawn fails silently. The three concrete failure modes the code does not defend against are: (a) child stderr is discarded; (b) cwd inheritance is implicit rather than pinned; (c) the pause-queue entry is deleted before spawn confirmation.

## Solution Statement

Tighten `resumeWorkflow()` so that:

1. **Capture child output** — redirect the child's stdout and stderr to a per-adwId append-log file under `agents/paused_queue_logs/{adwId}.resume.log`, using the same `fs.openSync` + `stdio: ['ignore', fd, fd]` pattern already used by `ensureCronProcess` in `adws/triggers/webhookGatekeeper.ts:114-120`.
2. **Pin cwd explicitly** — pass `cwd: process.cwd()` to `spawn()` so the orchestrator runs in the cron host's directory (where `adws/*.tsx`, `agents/`, and `.worktrees/` live). Do **not** use `entry.worktreePath` — that path is the *target repo* worktree, which does not contain `adws/` scripts and would cause every external-repo resume to die at `Error: Cannot find module 'adws/adwSdlc.tsx'`. Record this reasoning in a one-line code comment so the next reader does not "fix" it back to the worktree.
3. **Confirm spawn before removing from queue** — use an await-able readiness check: after `spawn()`, attach `'error'` and `'exit'` listeners and race them against a short (~2000 ms) "stayed alive" timer. Only on the timer winning do we (a) `removeFromPauseQueue`, (b) `child.unref()`, (c) post the `▶️ Resumed` comment. On `'error'` or early `'exit'`, we leave the entry in the queue, increment `probeFailures` via `updatePauseQueueEntry`, log the failure with a pointer to the resume log, and let the next probe cycle retry (with the existing `MAX_UNKNOWN_PROBE_FAILURES` bound acting as the give-up gate).

Side-effect order changes:
- Today: remove → post resumed → spawn (blind)
- After:  spawn → wait for alive → remove + post resumed  (or: increment failures on early exit/error, keep in queue)

This is a surgical change contained to `resumeWorkflow()`. No type changes to `PausedWorkflow`, no new modules, no behavior change to the probe loop itself.

## Steps to Reproduce

1. Manually insert a deliberately-broken entry into `agents/paused_queue.json` — e.g., `orchestratorScript: 'adws/doesNotExist.tsx'` with a valid `worktreePath` and `issueNumber`.
2. Start the cron trigger: `bunx tsx adws/triggers/trigger_cron.ts`.
3. Wait for one `PROBE_INTERVAL_CYCLES` (default 15 × 20s = 5 min), or call `scanPauseQueue(0)` directly from a test harness when the probe returns `clear`.
4. Observe: the log shows `Resuming workflow ...`; the GitHub issue receives a `▶️ Resumed` comment; `agents/paused_queue.json` is emptied; no child process actually runs; nothing in `agents/` or `logs/` captures the failure.

After the fix:
- The log shows `Resuming workflow ...` followed by a failure line `Resume spawn failed for {adwId}: child exited early (code=1). See agents/paused_queue_logs/{adwId}.resume.log`.
- The entry stays in `agents/paused_queue.json` with `probeFailures` incremented.
- No `▶️ Resumed` comment is posted on the issue.
- The log file `agents/paused_queue_logs/{adwId}.resume.log` contains the child's captured stderr (e.g., `Cannot find module ...`).

## Root Cause Analysis

`resumeWorkflow()` was authored as fire-and-forget detached dispatch on the happy path (feature-chpy1a, 2026-03-26). It implicitly assumed two things that turned out to be false during the 2026-04-18 depaudit#6 incident:

- **Assumption A**: spawned orchestrators always start successfully once the code path reaches `spawn()`. In practice, the child's `require`/`import` phase is not free, and any ambient failure (missing `--target-repo` arg pre-476fcb3, `validateGitRemote` mismatch, etc.) causes an immediate non-zero exit before any GitHub side-effect can be written.
- **Assumption B**: `stdio: 'ignore'` on a detached child is acceptable because orchestrators log to `agents/{adwId}/state.json` themselves. That is true *after* `workflowInit` runs; it is false during module load / early init, which is precisely where the 12:49 silent failure occurred.

Combined with the "remove from queue first" ordering, a single early-exit of the child is enough to permanently lose the workflow: the probe keeps returning `clear`, there is nothing to probe, the issue looks resumed to anyone watching the GitHub thread, and no retry path exists.

476fcb3 (the Apr 18 fix for `--target-repo` propagation) addressed one specific early-exit trigger but did not harden the resume path itself, so any other early-exit trigger still produces identical silent loss.

## Relevant Files

Use these files to fix the bug:

- `adws/triggers/pauseQueueScanner.ts` — contains `resumeWorkflow()` (lines 63-117) and `scanPauseQueue()` (the caller, lines 119-171). **All code changes live here.** The `resumeWorkflow()` signature stays `async (entry: PausedWorkflow): Promise<void>`; the caller already awaits it.
- `adws/triggers/webhookGatekeeper.ts` — **reference only.** Lines 112-120 (`ensureCronProcess`) show the canonical `fs.openSync` + `stdio: ['ignore', fd, fd]` + `fs.closeSync` pattern we will copy.
- `adws/core/pauseQueue.ts` — defines `PausedWorkflow`, `removeFromPauseQueue`, `updatePauseQueueEntry`. No changes, but we will call `updatePauseQueueEntry` on spawn failure instead of only on `limited`/`unknown` probe outcomes.
- `adws/core/environment.ts` — exports `AGENTS_STATE_DIR` (line 119). We will join a `paused_queue_logs` subdir under it for the per-resume log files.
- `adws/core/config.ts` — defines `MAX_UNKNOWN_PROBE_FAILURES` (the existing bound we will reuse for spawn-failure retries — no new config needed).
- `adws/phases/workflowCompletion.ts` — **reference only.** Shows how `appendToPauseQueue` is called, confirming the `extraArgs`/`worktreePath` fields we consume are trustworthy.
- `app_docs/feature-chpy1a-generic-pipeline-runner-pause-resume.md` — **reference only.** Confirms the design intent of the pause/resume mechanism and the cron-probe loop's cadence.
- `app_docs/feature-2sqt1r-fix-rate-limit-plan-phase.md` — **reference only.** Historical context for related pause/resume fixes; confirms `deriveOrchestratorScript()` is stable for our usage.
- `guidelines/coding_guidelines.md` — coding guidelines; the fix must respect single-responsibility (keep the readiness check as a small local helper), immutability of `PausedWorkflow` (we mutate through `updatePauseQueueEntry` only), and strict types (no `any`).

### New Files

- `adws/triggers/__tests__/pauseQueueScanner.test.ts` — vitest unit test covering the three fix behaviors in isolation: (1) stdout/stderr are captured to a log file, (2) `cwd` is pinned to `process.cwd()`, (3) `removeFromPauseQueue` is deferred until the readiness window elapses without early child exit. Uses the `vitest` mocking style established in `adws/triggers/__tests__/triggerCronAwaitingMerge.test.ts` and `adws/core/__tests__/phaseRunner.test.ts`.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 1. Add a tiny readiness-race helper inside `pauseQueueScanner.ts`

- In `adws/triggers/pauseQueueScanner.ts`, add a small private helper `awaitChildReadiness(child, timeoutMs)` (not exported) that returns `Promise<void>` resolving when the child has stayed alive past `timeoutMs` and rejecting if the child emits `'error'` or `'exit'` first.
- Implementation sketch: a single `new Promise<void>((resolve, reject) => { ... })` wiring `child.once('error', reject)`, `child.once('exit', (code, signal) => reject(new Error(\`child exited early code=\${code} signal=\${signal}\`)))`, and `setTimeout(resolve, timeoutMs)`. Use `.once` so listeners self-detach; clear the timeout on reject to avoid a dangling handle.
- Keep the helper under 25 lines. Do not extract into a separate file — it is only used here.

### 2. Open a per-resume append-log file before spawning

- Import `path` at the top of `pauseQueueScanner.ts` (currently only `fs` is imported).
- Import `AGENTS_STATE_DIR` from `'../core'` (already re-exported from `adws/core/config.ts`).
- Inside `resumeWorkflow`, after the worktree-exists check but before the spawn block, compute `const resumeLogDir = path.join(AGENTS_STATE_DIR, 'paused_queue_logs')`; `fs.mkdirSync(resumeLogDir, { recursive: true })`; `const resumeLogPath = path.join(resumeLogDir, \`\${entry.adwId}.resume.log\`)`; `const logFd = fs.openSync(resumeLogPath, 'a')`.
- Wrap the spawn + readiness wait in a `try { ... } finally { try { fs.closeSync(logFd); } catch {} }` so the parent fd is released regardless of outcome (the detached child retains its own dup'd fd).

### 3. Make cwd explicit and redirect child stdio to the log file

- Replace the current `spawn('bunx', spawnArgs, { detached: true, stdio: 'ignore' })` with `spawn('bunx', spawnArgs, { detached: true, stdio: ['ignore', logFd, logFd], cwd: process.cwd() })`.
- Add a one-line code comment directly above the `cwd: process.cwd()` line explaining **why cwd is pinned to the cron host and NOT to `entry.worktreePath`** — target-repo worktrees do not contain `adws/` scripts. This prevents a future reader from "fixing" it to `entry.worktreePath` and re-breaking external-repo resume. Keep the comment one line.
- Do not remove the `log('Resuming workflow ...')` line above the spawn — it is still useful for the happy path. Do change its tense / wording slightly if needed so the success case reads naturally after the readiness wait (e.g. `Resumed workflow {adwId} (pid {child.pid})` on success vs `Resuming workflow {adwId} ...` as the pre-spawn log).

### 4. Restructure the side-effect order: spawn → await alive → remove + post comment

- Move the `removeFromPauseQueue(entry.adwId)` call that currently sits on line 89 **after** the readiness wait resolves successfully. Keep the pre-spawn worktree-gone branch's `removeFromPauseQueue` unchanged (that branch intentionally drops entries with missing worktrees).
- Move the `postIssueStageComment(..., 'resumed', ...)` block (currently lines 91-104) to also run only after the readiness wait resolves successfully. The paused comment and the error branches remain unchanged. Preserve the try/catch around the comment post so a transient GitHub outage does not undo a successful spawn.
- On readiness rejection (`'error'` or early `'exit'`), do not remove from the queue and do not post a resumed comment. Instead:
  - Log one line: `Resume spawn failed for {adwId}: {err}. See {resumeLogPath}` at level `error`.
  - Call `updatePauseQueueEntry(entry.adwId, { probeFailures: (entry.probeFailures ?? 0) + 1, lastProbeAt: new Date().toISOString() })`. This is the same field the existing `unknown` probe branch increments, so the existing `MAX_UNKNOWN_PROBE_FAILURES` escalation path (lines 146-162) will eventually catch workflows that are persistently unspawnable and emit the standard "Manual restart required" error comment.
  - Return from `resumeWorkflow` without throwing — the outer `scanPauseQueue` loop should continue processing other entries.

### 5. Tighten the 'resume log file' noise budget

- The log file at `agents/paused_queue_logs/{adwId}.resume.log` is appended to on every resume attempt. For the happy path (child stays alive past the readiness window, then runs for hours), the file will keep growing for the life of the orchestrator. That is fine — no rotation needed because the file's lifetime is bounded by the workflow's lifetime and new attempts for the same adwId go through the same append. No action needed here; just record the decision in the doc under `## Notes` at the bottom of this plan.

### 6. Write a vitest unit test for the three fix behaviors

- Create `adws/triggers/__tests__/pauseQueueScanner.test.ts` following the pattern in `adws/triggers/__tests__/triggerCronAwaitingMerge.test.ts` and `adws/core/__tests__/phaseRunner.test.ts`.
- Mock `child_process.spawn` so tests don't actually launch Node — return a minimal `EventEmitter` with `pid`, `unref`, `once`, and manual `emit` control. Mock `fs.openSync`/`fs.closeSync`/`fs.mkdirSync` so the test does not touch disk. Mock `../core/pauseQueue` (`readPauseQueue`, `removeFromPauseQueue`, `updatePauseQueueEntry`) as `vi.fn()` so we can assert call order. Mock `../core` to expose `AGENTS_STATE_DIR = '/tmp/agents-test'`, `PROBE_INTERVAL_CYCLES = 1`, `MAX_UNKNOWN_PROBE_FAILURES = 3`, `log: vi.fn()`, `resolveClaudeCodePath: () => 'claude'`. Mock `../github` (`getRepoInfo`, `activateGitHubAppAuth`) and `../phases/phaseCommentHelpers` (`postIssueStageComment`) as `vi.fn()`.
- Export `resumeWorkflow` from `pauseQueueScanner.ts` (currently unexported) so the test can call it directly. Marking it `export` does not change runtime behavior; it only widens the module's surface for testing.
- Test cases (three minimum):
  1. **`spawn stdio includes a log file fd`** — call `resumeWorkflow(entry)`, assert the `spawn` mock was called with a `stdio` option whose index 1 and 2 are numbers (not the string `'ignore'`), and that `fs.openSync` was called with a path ending `/paused_queue_logs/{adwId}.resume.log` and flag `'a'`.
  2. **`spawn cwd is pinned to process.cwd()`** — assert the `spawn` mock was called with `cwd: process.cwd()`. In the same test, assert it is NOT called with `cwd: entry.worktreePath`.
  3. **`removeFromPauseQueue is deferred until child stays alive`** — after calling `resumeWorkflow(entry)` and letting the mocked child emit `'exit'` with code 1 *before* the readiness timeout, assert `removeFromPauseQueue` was **not** called, `postIssueStageComment` was **not** called with `'resumed'`, and `updatePauseQueueEntry` was called with a `probeFailures` of 1. Use `vi.useFakeTimers()` + `vi.advanceTimersByTime()` to control the readiness window.
  4. (Bonus) **`happy path removes from queue and posts resumed comment after readiness window`** — emit no early exit, advance timers past the readiness window, assert `removeFromPauseQueue` called once with `entry.adwId`, `postIssueStageComment` called with stage `'resumed'`, and `child.unref()` called.
- Keep the test file under 200 lines. Follow the `makeEntry(overrides)` helper pattern from the existing trigger tests.

### 7. Run the validation commands

Run `Validation Commands` below end to end. Confirm no lint, type, unit, or build regressions. Zero new cucumber scenarios are required because the fix is internal to a detached-spawn code path that cucumber cannot observe without heavy infrastructure; the new vitest is the proof of correctness.

## Validation Commands

Execute every command to validate the bug is fixed with zero regressions.

From the repo root (`/Users/martin/projects/paysdoc/AI_Dev_Workflow/.worktrees/bugfix-issue-448-fix-pause-queue-resume-spawn`):

1. **Lint**
   `bun run lint`
   Expect: zero errors; the only new file is `adws/triggers/__tests__/pauseQueueScanner.test.ts` and the only modified file is `adws/triggers/pauseQueueScanner.ts`.

2. **Type-check both tsconfigs** (`.adw/commands.md` lists both)
   `bunx tsc --noEmit`
   `bunx tsc --noEmit -p adws/tsconfig.json`
   Expect: zero type errors.

3. **Unit tests (includes new scanner test)**
   `bun run test:unit`
   Expect: all existing tests pass; the four new `pauseQueueScanner.test.ts` cases pass.

4. **Targeted scanner test (fast feedback during iteration)**
   `bunx vitest run adws/triggers/__tests__/pauseQueueScanner.test.ts`
   Expect: 4/4 green.

5. **Build**
   `bun run build`
   Expect: build succeeds.

6. **Reproduce the bug BEFORE applying the fix** (optional, for confidence)
   - Revert working tree to `main` (or stash the fix).
   - Manually craft `agents/paused_queue.json` with one entry whose `orchestratorScript` points to a non-existent file (`adws/doesNotExist.tsx`), `worktreePath` pointing to a real directory, `issueNumber` pointing to a disposable test issue, `extraArgs: []`.
   - Kick the scanner: `bunx tsx -e "import('./adws/triggers/pauseQueueScanner.js').then(m => m.scanPauseQueue(0))"` (requires the probe to return `clear` — if the environment is rate-limited the reproduction skips; in that case set `PROBE_INTERVAL_CYCLES=1` and a valid `ANTHROPIC_API_KEY`).
   - Observe: `agents/paused_queue.json` becomes `[]`, a `▶️ Resumed` comment appears on the issue, no child process runs, no log file exists under `agents/paused_queue_logs/`.
   - Restore the fix (`git stash pop` or re-apply).

7. **Reproduce the expected behavior AFTER applying the fix**
   - Recreate the same broken entry in `agents/paused_queue.json`.
   - Kick the scanner the same way.
   - Observe: `agents/paused_queue.json` still contains the entry with `probeFailures: 1`; no `▶️ Resumed` comment; `agents/paused_queue_logs/{adwId}.resume.log` exists and contains the child's stderr (e.g. a Node `Cannot find module` trace).
   - Run the scanner twice more (reaching `MAX_UNKNOWN_PROBE_FAILURES`): the entry is removed on the third failure and a standard "Manual restart required" error comment is posted — matching the existing `unknown` probe escalation path.

## Notes

- **Guidelines compliance** (`guidelines/coding_guidelines.md`): the change keeps `pauseQueueScanner.ts` under the 300-line ceiling (current 171 lines; estimated post-change ≈ 210 lines including the helper). `PausedWorkflow` is not mutated in place — we only go through `updatePauseQueueEntry`, preserving the immutability principle. No `any` is introduced; `spawn`'s return type is already `ChildProcess`. The readiness helper is pure plus a single `setTimeout` side-effect contained in the closure.
- **Why cwd is `process.cwd()` and not `entry.worktreePath`**: the bug report's third suggestion (`cwd: entry.worktreePath`) is intentionally **not** adopted. Target-repo worktrees are for external repos (e.g. `depaudit`) and do not contain the ADW orchestrator scripts (`adws/*.tsx`). The orchestrator itself handles worktree resolution internally via `findWorktreeForIssue` once it knows the `--target-repo` value. Running from `process.cwd()` mirrors what the cron's own `classifyAndSpawnWorkflow` and `spawnDetached` do (`adws/triggers/webhookGatekeeper.ts:25-32, 49`) — this is the correct and already-proven cwd for ADW orchestrator spawns. We document this in a one-line code comment to defend the decision in the diff.
- **Why reuse `probeFailures` instead of adding a new counter**: spawn failures and unknown-probe failures are similar signals — both mean "something is wrong we can't classify" — and the existing `MAX_UNKNOWN_PROBE_FAILURES` escalation already emits a user-facing error comment. Overloading the counter keeps the queue schema unchanged and avoids introducing a second abandonment threshold to reason about.
- **Why 2000 ms for the readiness window**: short enough to not slow down the scanner noticeably (one cycle scans all paused entries sequentially), long enough to catch early-import crashes (`tsx`'s TypeScript transform + module graph load for an orchestrator is typically under 1 second on a modern machine; 2 s is the next-power-of-two margin). The value is a local `const READINESS_WINDOW_MS = 2000` inside `pauseQueueScanner.ts` — not an env var, because the tradeoff does not vary per deployment.
- **Resume log file retention**: no rotation. Files live under `agents/paused_queue_logs/` and are bounded in count by the pause-queue volume, which is small (typically < 10 entries at steady state). A future cleanup pass can be wired into `adws/triggers/devServerJanitor.ts` if the directory grows — but that is out of scope for this bug.
- **Library installs**: none required. `child_process.spawn`, `fs`, and `path` are all Node builtins and already used in the affected module. The project's library install command would be `bun add <package>` per `.adw/commands.md` if one were needed.
- **Related issue still open**: issue #449 (cross-trigger spawn dedup between cron and webhook) is the second half of the 2026-04-18 depaudit#6 incident and is tracked on branch `bugfix-issue-449-fix-cross-trigger-spawn-dedup`. This plan addresses ONLY the resume-path silent-failure half (#448); the duplicate-spawn race is explicitly out of scope here.
