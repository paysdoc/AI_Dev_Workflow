# Bug: An orchestrator that dies in `starting` strands its issue; cron, the hung sweep and `## Retry` all skip it

## Metadata
issueNumber: `959`
adwId: `r5ifl5-bug-an-orchestrator`
issueJson: `{"number":959,"title":"bug: an orchestrator that dies in 'starting' strands its issue; cron, the hung sweep and ## Retry all skip it","body":"An orchestrator that dies after `initializeWorkflow` writes `workflowStage: 'starting'` and before it reaches a `*_running` stage strands its issue. Nothing recovers it: not cron, not the hung-orchestrator sweep, and not `## Retry`.\n\n## Observed\n\nIssue #935, adwId `gyxjcf-bug-repair-the-regre`:\n\n- On 2026-10-02 at 00:15:42 UTC, cron resumed the workflow after a `phase_timeout`. The orchestrator (pid 80620) logged `Allocated port 57665 for dev server` and then exited with nothing written to its log. Cron spawns orchestrators with `stdio: 'ignore'`, so no stack trace exists.\n- The top-level state still reads `workflowStage: \"starting\"`, `lastSeenAt: 2026-10-01T23:45:26Z`, and has no `pid`.\n- More than six hours later, cron had not picked the issue up again. The concurrency count was 2 of 5, so the limit was not the cause.\n\n## Why nothing recovers it (verified by reading the code)\n\n1. **The cron filter treats it as live.** `classifyStageString('starting')` returns `'active'`, so `evaluateIssue` (`adws/triggers/cronIssueFilter.ts`) returns `{ eligible: false, reason: 'active' }`. The takeover handler's branch 8 (\"`starting`, dead PID → worktreeReset → remoteReconcile → take_over_adwId\", `adws/triggers/takeoverHandler.ts`) exists for exactly this case but is never reached, because only candidates that pass the filter go to `evaluateCandidate`.\n2. **The hung-orchestrator sweep skips it.** `findHungOrchestrators` (`adws/core/hungOrchestratorDetector.ts:73-74`) only considers stages that end in `_running` and have a `pid` in the top-level state. A `starting` state fails both checks: `initializeWorkflow` writes the `pid` only to the orchestrator's own sub-state (`workflowInit.ts:310-324`), not to the top-level state.\n3. **`## Retry` ignores it.** The webhook only acts on `## Retry` for issues in a human-gated stage.\n\n## Possibly also a factor (not verified)\n\n`agents/spawn_locks/paysdoc_AI_Dev_Workflow_issue-935.json` is still present. It records pid 41399, which is the long-running cron process itself (alive), with `startedAt` 00:15:44Z. If cron reads its own pid as a live holder, `evaluateCandidate` would return `defer_live_holder` even after (1) is fixed. Check whether the take-over path's `releaseIssueSpawnLock` (`trigger_cron.ts:481`) ran for this spawn, and whether a lock held by the reading process's own pid counts as live.\n\n## Side effect found in the same run (verified)\n\nIn the same second it started (00:15:42), the run-4 orchestrator overwrote the existing worktree's `.claude/commands/*` and `.claude/skills/*` with copies from the ADW checkout it runs from. That checkout was stale at `3f1ed745`, so `bug.md`, `feature.md`, `review.md` and `document.md` in the worktree are byte-for-byte the `3f1ed745` versions. That silently reverts #944, and the reverted files would be committed on the next build commit. This looks like a confirmed source of the recurring \"worktree born with reverted command files\" problem: copying `.claude` assets into an existing worktree from a framework checkout that has not been pulled. A separate issue may fit this better.\n\n## What to build\n\n- A dead orchestrator in `starting` (or any stage classed `active`) must become recoverable. Either let the cron filter pass `active` stages to `evaluateCandidate` when the owning process is confirmed dead, or have the hung-orchestrator sweep cover `starting` and read liveness from wherever the pid actually lives. The takeover handler already implements the recovery in branch 8.\n- Liveness must be decidable for `starting`: record `pid` and `pidStartedAt` in the top-level state when it is written, or resolve them from the orchestrator sub-state or the spawn lock.\n- If the spawn-lock self-hold above is real, cron must not treat a lock recorded with its own pid as a live holder for an issue whose orchestrator is dead.\n- Stop cron-spawned orchestrators from dying silently: at minimum, write uncaught startup errors to the orchestrator's `execution.log`.\n\n## Acceptance criteria\n\n- [ ] A unit test: a top-level state of `starting` whose orchestrator pid is dead reaches `evaluateCandidate` and ends in `take_over_adwId`.\n- [ ] A unit test: a `starting` state whose orchestrator is alive is still deferred, so a slow startup is never killed or reset.\n- [ ] The hung-orchestrator sweep, or the cron filter, recovers a stale `starting` state without a cron restart.\n- [ ] An orchestrator that throws during startup leaves the error in its `execution.log`.\n","state":"OPEN","author":"paysdoc","labels":["adw:bug"],"createdAt":"2026-10-02T06:31:34Z","comments":[],"actionableComment":null}`

## Bug Description

A workflow whose orchestrator exits while the top-level state reads `workflowStage: 'starting'` is never picked up again. The cron excludes it every cycle as `active`. The hung-orchestrator sweep never matches it, and `## Retry` treats it as a live run.

The incident on issue #935 (adwId `gyxjcf-bug-repair-the-regre`) is fully reconstructed from the artifacts on disk, all read-only:

| Time (UTC) | What happened | Source |
|---|---|---|
| 00:15:36.297 | The cron took over #935 from `phase_timeout`, spawned `adwSdlc.tsx 935 gyxjcf-…` (pid 80620) and released the issue's spawn lock | cron log |
| 00:15:41.463 | The next tick listed #935 as a candidate again. The child was still classifying the issue, so the state still read `phase_timeout` | cron log `POLL:` line |
| 00:15:42.716 | The child wrote the top-level `starting` state, with no `pid`, and logged `Starting sdlc-orchestrator workflow` | `execution.log` |
| 00:15:44.185 | After about 2.5 s of eligibility API calls, the tick's `evaluateCandidate` acquired the free spawn lock under the cron's own pid 41399. The child only takes the lock after `initializeWorkflow` returns | `agents/spawn_locks/paysdoc_AI_Dev_Workflow_issue-935.json` |
| 00:15:44.595 | The child logged `Allocated port 57665 for dev server`, its last `execution.log` line | `execution.log` |
| 00:15:44.600 | The child logged `spawn lock held for paysdoc/AI_Dev_Workflow#935 by pid=41399` and `Issue #935: spawn lock already held by another orchestrator; exiting.` to stdout, then called `process.exit(0)` | cron log (inherited stdout) |
| 00:15:45.853 | `checkAndTrigger: tick failed (non-fatal): Error: Failed to fetch origin/bugfix-issue-935-repair-regression-suite-scenarios … fatal: couldn't find remote ref`. The stack runs `resetWorktree ← recoverViaResetFromRemote ← evaluateCandidate (takeoverHandler.ts:235) ← checkAndTrigger (trigger_cron.ts:445)`. The lock was never released | cron log |
| afterwards | #935 is filtered as `grace_period` and then as `active` on every tick. The state stays `starting` with no `pid`, `resumeAttempts: 1` and the previous run's `lastSeenAt` | cron log, `agents/gyxjcf-bug-repair-the-regre/state.json` |

`resumeAttempts` is still 1. So the second evaluation read `starting` and took the `active` branch, not `phase_timeout`.

- **Actual:** the issue is stranded until someone edits state by hand. A spawn lock carrying the live cron's pid also blocks every later acquire for that issue. The orchestrator's `execution.log` says nothing about why it exited.
- **Expected:**
  - A `starting` (or any `active`) state whose owning orchestrator is dead is taken over automatically by the cron, under the same adwId.
  - A `starting` state whose orchestrator is alive is left alone: no SIGKILL, no worktree reset.
  - A process never stays blocked behind a lock it wrote itself and failed to release.
  - An orchestrator that dies during startup leaves the reason in its `execution.log`.

## Problem Statement

Five defects combine to strand the issue:

1. **`evaluateCandidate` leaks its spawn lock on any throw after acquiring it.** The cron is long-lived, so its own pid stays "live" for its whole lifetime. Every later acquire then fails, including the lifecycle acquire of the orchestrator the cron just spawned.
2. **Nothing records the owning orchestrator in the top-level state.** `pid`/`pidStartedAt` were added to the schema (commit `b6b4168b`), but no writer was ever added. So no reader can decide owner liveness:
   - The takeover handler treats a live `starting` orchestrator as dead.
   - The hung sweep has never matched anything.
   - The auth-gate kill and the worktree probe's `liveOwner` never fire.
3. **The cron filter excludes every `active` stage unconditionally.** The takeover handler's dead-owner branch is unreachable from the cron.
4. **The dead-owner branch resets from the remote.** That throws for a branch that was never pushed, which is the normal state of a workflow before its scenario-fix, review, document or PR phase. #935's branch is one of these.
5. **Orchestrators die silently during startup.** `initializeWorkflow` errors become unhandled rejections. The lifecycle-lock refusal path logs only to stdout. Neither reaches `execution.log`.

## Solution Statement

1. **Record the owner at `starting`.** `initializeWorkflow`'s top-level `starting` write also records `pid: process.pid`, `pidStartedAt` and a fresh `lastSeenAt`.
   - `pidStartedAt` is always written, as `getProcessStartTime(process.pid) ?? undefined`. A resumed adwId therefore never pairs the new pid with the previous run's start time. `writeTopLevelState` is a shallow merge, and an `undefined` key is dropped from the JSON.
   - `lastSeenAt` is needed because the top-level pid makes the run visible to the hung sweep. Without a fresh value, a resumed run's first `*_running` phase would carry the previous run's stale `lastSeenAt` until the heartbeat's first beat, one interval after the lock. The sweep would SIGKILL it.
2. **Add one helper for owner liveness.** `isRecordedOwnerLive(owner, isLive)` goes in `adws/core/processLiveness.ts`. It returns false when the pid or start time is missing.
3. **Let the cron filter pass dead-owner `active` stages.**
   - `resolveIssueWorkflowStage` reports `ownerDead` for an active stage whose recorded owner is not live. A state that records no owner counts as dead: it predates owner recording, and an orchestrator past startup holds the spawn lock, so `evaluateCandidate` still defers to it.
   - `evaluateIssue` returns `{ eligible: true, action: 'spawn', adwId }` for such a stage, after the existing grace-period gate. A live owner is still excluded as `active`.
   - `processedSpawns` only gates `stage === null`, so recovery needs no cron restart.
4. **Make `evaluateCandidate` safe and able to recover `starting`.**
   - Release the lock before rethrowing any error raised after the acquire.
   - `starting` with a live recorded owner → release the lock and return `defer_live_holder` (`holderPid` = that pid). Startup precedes the lifecycle lock, so this is a slow startup, not a split brain. Never kill it or reset its worktree.
   - `starting` with a dead or unrecorded owner → recover like `phase_timeout`/`abandoned`: probe the worktree, reuse it in place when healthy, reset otherwise. Only a named phase writes a `*_running` stage, and today only `stepDef` is named (`runPhase(…, 'stepDef')`). A run therefore sits in `starting` through install, plan and build, often for hours. A dead `starting` run can leave partial work in its worktree, as a `phase_timeout` or `abandoned` run does, and the reuse gate already handles that case. This also avoids the reset-from-remote that throws for never-pushed branches.
   - Every other active stage keeps its current rule: SIGKILL if live, then reset from the remote.
   - Reclaim a lock held by this very process when the issue's orchestrator is dead: the stage is `abandoned`, `phase_timeout` or classed `active`, and the recorded owner is not live.
     - The issue asks for exactly this: a lock recorded under the cron's own pid is not a live holder for an issue whose orchestrator is dead. That covers `abandoned` and `phase_timeout` as well as a dead `starting`, and the takeover handler already treats both of those stages as having a dead orchestrator.
     - Such a lock can only be a hold this process failed to release. In-process holds that span an `await` only follow `spawn_fresh`, which none of these stages produces, and an orchestrator spawned under such a hold records its own live pid at `starting`. The webhook's in-process dedup of concurrent handlers is therefore untouched.
5. **Contain failures in the cron loop.**
   - A throwing takeover evaluation is logged and skipped for its candidate only. It no longer aborts the tick for every older-first candidate after it.
   - The take-over spawn releases the lock in `finally`.
6. **Make startup deaths visible.**
   - `initializeWorkflow` becomes a thin wrapper that appends any startup error, with its stack, to `agents/{adwId}/{orchestratorName}/execution.log` and rethrows.
   - `runWithOrchestratorLifecycle` appends the lock refusal, naming the holder pid, before returning `false`.
7. **Do not extend the hung sweep to `starting`.** The cron filter is the recovery path, and acceptance criterion 2 requires that a slow startup is never killed. `## Retry` stays a no-op for active stages, because automatic recovery replaces it.

## Steps to Reproduce

**A. Evidence from the #935 incident.** Paths are relative to the checkout the cron runs from (`/Users/martin/projects/paysdoc/AI_Dev_Workflow`). These are read-only checks.

1. `cat agents/spawn_locks/paysdoc_AI_Dev_Workflow_issue-935.json`: `pid: 41399` (the cron) and `startedAt: 2026-10-02T00:15:44.185Z`.
2. `cat agents/gyxjcf-bug-repair-the-regre/state.json`: `workflowStage: "starting"`, no `pid`, `lastSeenAt: 2026-10-01T23:45:26.529Z`, `resumeAttempts: 1`.
3. `tail -3 agents/gyxjcf-bug-repair-the-regre/sdlc-orchestrator/execution.log`: the run-4 log ends at `Allocated port 57665 for dev server`.
4. `grep -n "2026-10-02T00:15:4" logs/agents/cron/paysdoc_AI_Dev_Workflow.log | grep -E "935|spawn lock|tick failed"`: the take-over, the second candidate pass, `spawn lock already held … exiting`, and `tick failed … couldn't find remote ref` from `evaluateCandidate`.

**B. Unit-level reproductions.** Run these from the repo root before and after the fix; expected outputs are in `Validation Commands`.

1. The cron filter excludes a `starting` state whose recorded owner is dead (pid 2147483646 cannot exist):
   `bunx tsx -e 'import { evaluateIssue } from "./adws/triggers/cronIssueFilter"; import { resolveIssueWorkflowStage } from "./adws/triggers/cronStageResolver"; const state = { adwId: "repro-959", issueNumber: 959, agentName: "sdlc-orchestrator", execution: { status: "running", startedAt: "2026-10-01T00:00:00Z" }, workflowStage: "starting", pid: 2147483646, pidStartedAt: "never" }; const issue = { number: 959, comments: [{ body: "**ADW ID:** `repro-959`" }], createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z", labels: [] }; console.log(JSON.stringify(evaluateIssue(issue, Date.now(), { spawns: new Set() }, 300000, (comments) => resolveIssueWorkflowStage(comments, () => state))));'`
2. `evaluateCandidate` leaks the lock when the reset throws:
   `bunx tsx -e 'import { evaluateCandidate } from "./adws/triggers/takeoverHandler"; let released = 0; const state = { adwId: "repro-959", issueNumber: 959, agentName: "sdlc-orchestrator", execution: { status: "running", startedAt: "2026-10-01T00:00:00Z" }, workflowStage: "build_running", branchName: "bugfix-issue-959-repro" }; const deps = { acquireIssueSpawnLock: () => true, releaseIssueSpawnLock: () => { released += 1; }, readSpawnLockRecord: () => null, resolveAdwId: () => "repro-959", readTopLevelState: () => state, isProcessLive: () => false, killProcess: () => {}, resetWorktree: () => { throw new Error("fatal: no remote ref"); }, deriveStageFromRemote: () => "build_running", writeTopLevelState: () => {}, commentOnIssue: () => {}, probeWorktree: () => ({ registration: "healthy", indexLock: "absent", interruptedOp: "none", headOnExpectedBranch: true, liveOwner: false }), clearOrphanedIndexLock: () => {} }; const boundary = { repoId: { owner: "paysdoc", repo: "AI_Dev_Workflow" }, gitContext: { worktreePathFor: () => "/tmp/repro-959" } }; try { evaluateCandidate({ issueNumber: 959, boundary }, deps); } catch (error) { console.log("threw:", error.message); } console.log("lock releases:", released);'`
3. `evaluateCandidate` would SIGKILL and reset a live, slow-starting orchestrator once its pid is recorded:
   `bunx tsx -e 'import { evaluateCandidate } from "./adws/triggers/takeoverHandler"; const calls = []; const state = { adwId: "repro-959", issueNumber: 959, agentName: "sdlc-orchestrator", execution: { status: "running", startedAt: "2026-10-01T00:00:00Z" }, workflowStage: "starting", branchName: "bugfix-issue-959-repro", pid: 4242, pidStartedAt: "live" }; const deps = { acquireIssueSpawnLock: () => true, releaseIssueSpawnLock: () => { calls.push("release"); }, readSpawnLockRecord: () => null, resolveAdwId: () => "repro-959", readTopLevelState: () => state, isProcessLive: () => true, killProcess: (pid) => { calls.push("kill " + pid); }, resetWorktree: () => { calls.push("reset"); }, deriveStageFromRemote: () => "starting", writeTopLevelState: () => {}, commentOnIssue: () => {}, probeWorktree: () => { calls.push("probe"); return { registration: "healthy", indexLock: "absent", interruptedOp: "none", headOnExpectedBranch: true, liveOwner: true }; }, clearOrphanedIndexLock: () => {} }; const boundary = { repoId: { owner: "paysdoc", repo: "AI_Dev_Workflow" }, gitContext: { worktreePathFor: () => "/tmp/repro-959" } }; console.log(JSON.stringify(evaluateCandidate({ issueNumber: 959, boundary }, deps)), calls.join(", "));'`

## Root Cause Analysis

1. **Leaked lock (the trigger, confirmed).**
   - `evaluateCandidate` (`adws/triggers/takeoverHandler.ts:163-239`) acquires the issue's spawn lock under `process.pid` (`:171`). It releases the lock only on the explicit `skip_terminal` and `escalate_human_gated` returns.
   - `recoverViaResetFromRemote` (`:128-139`) calls `gitCtx.resetWorktree`, which runs `git fetch origin "<branch>"` (`@paysdoc/devplatform` `dist/git/worktreeResetOps.js`) and throws when the branch is not on the remote. `deriveStageFromRemote`, `probeWorktree`, `writeTopLevelState` and `commentOnIssue` can throw as well.
   - The throw escapes through `checkAndTrigger` to `runGuardedTick` (`adws/triggers/trigger_cron.ts:247-254`), which swallows it. The lock file keeps the cron's pid.
   - `acquireIssueSpawnLock` (`adws/triggers/spawnGate.ts:74`) treats any holder that passes `isProcessLive` as live, and the cron is alive. The orchestrator's `runWithOrchestratorLifecycle` (`adws/phases/orchestratorLock.ts:41`) therefore gets `false`, and `adwSdlc.tsx:144-147` logs to stdout and calls `process.exit(0)`.
   - The same leak exists in the cron's take-over branch (`trigger_cron.ts:469-483`): a throw from `readTopLevelState`, `resolveResumeSpawn` or `spawnDetached` skips `releaseIssueSpawnLock`.
2. **Owner never recorded.**
   - `initializeWorkflow` writes `pid` only to the orchestrator sub-state (`adws/phases/workflowInit.ts:320-329`), never `pidStartedAt`. The top-level `starting` write (`:310-318`) records neither.
   - Every top-level liveness reader requires both fields and silently treats their absence as "not live":
     - takeover `active` branch (`takeoverHandler.ts:222-236`)
     - `findHungOrchestrators` (`adws/core/hungOrchestratorDetector.ts:73-76`)
     - the auth-gate SIGTERM (`trigger_cron.ts:289-305`)
     - `probeWorktree`'s `liveOwner`
   - So a live orchestrator in `starting` reads as dead. On the #935 race, the cron tried to reset the worktree under a live orchestrator.
   - Recording the pid alone would make this worse. Branch 7 would then SIGKILL every slow-starting orchestrator the cron or webhook evaluates before it takes its lifecycle lock (reproduction B3). That is why `starting` needs its own live-owner rule.
3. **Unconditional filter exclusion.**
   - `evaluateIssue` returns `{ eligible: false, reason: 'active' }` for every `active` stage (`adws/triggers/cronIssueFilter.ts:162-164`), so `evaluateCandidate` is never reached for a dead owner.
   - The docs claim this path recovers a dead `*_running` (`app_docs/feature-9gjajh-takeover-and-coordination.md:58`). It does not.
4. **Reset-from-remote cannot recover a never-pushed branch.** The first push happens in the scenario-fix, review, document or PR phase (`adws/phases/*Phase.ts` `pushBranch`). Before that, branch 8's reset throws on every attempt, so the branch is unreachable as well as broken for a dead `starting`.
5. **Silent startup deaths.**
   - Orchestrators call `main();` with no `.catch`, so an `initializeWorkflow` throw is an unhandled rejection.
   - `spawnDetached` (`adws/triggers/webhookGatekeeper.ts:28-43`) inherits the trigger's stdio, and the merge/PR-review spawns use `stdio: 'ignore'`. The stack is therefore either interleaved into the trigger's log or lost.
   - `log()` writes only to stdout (`adws/core/logger.ts:34-44`). The orchestrator's own `execution.log` gets nothing for either the throw or the lock refusal.

## Relevant Files
Use these files to fix the bug:

- `README.md`: project overview (read first per the planning instructions).
- `.adw/coding_guidelines.md`: guard clauses, at most two levels of nesting, files under 300 lines, comments only for non-obvious reasons (never issue numbers), behaviour tested through public interfaces.
- `adws/triggers/takeoverHandler.ts`: `evaluateCandidate`, the decision-tree header, `recoverViaResetFromRemote`, `recoverViaResumeInPlaceOrReset` and the `active` branch. This is where the lock is leaked and where `starting` is handled.
- `adws/triggers/cronIssueFilter.ts`: `evaluateIssue`'s unconditional `active` exclusion (`:162-164`), the grace-period gate (`:126-129`) and `processedSpawns` (`:132-144`).
- `adws/triggers/cronStageResolver.ts`: `StageResolution` and `resolveIssueWorkflowStage`, the only place the cron reads the top-level state for the filter.
- `adws/triggers/trigger_cron.ts`: the candidate loop (`:413-505`), `evaluateCandidate` call (`:446`), take-over branch (`:469-483`), `runGuardedTick` (`:247-254`), hung sweep (`:98-115`), auth-gate SIGTERM (`:289-305`).
- `adws/core/processLiveness.ts`: `isProcessLive`/`getProcessStartTime`. The new `isRecordedOwnerLive` helper goes here.
- `adws/phases/workflowInit.ts`: the top-level `starting` write (`:310-318`), the sub-state write (`:320-330`), `setLogAdwId` (`:194`). This is where the startup failure must be caught.
- `adws/phases/orchestratorLock.ts`: `runWithOrchestratorLifecycle`. The lock refusal must reach `execution.log`.
- `adws/core/stageClassifier.ts`: the header table's `active` row (cron and takeover decisions) must match the new behaviour. No logic change.
- `adws/triggers/spawnGate.ts`: `acquireIssueSpawnLock`'s live-holder rule, `releaseIssueSpawnLock`, `readSpawnLockRecord`. Context only; no change.
- `adws/core/agentState.ts`: `writeTopLevelState` (shallow merge, so `pidStartedAt` must always be written), `initializeState`, `appendLog` (`execution.log`).
- `adws/core/heartbeat.ts`: the first beat lands one `HEARTBEAT_TICK_INTERVAL_MS` after `startHeartbeat`, which is why `lastSeenAt` is refreshed at `starting`.
- `adws/core/hungOrchestratorDetector.ts`: only matches `*_running` with a live recorded pid and a stale heartbeat. It starts matching once the pid is recorded. It deliberately does not cover `starting` (no slow startup may be killed).
- `adws/core/config.ts`: `GRACE_PERIOD_MS` (300 000), `HEARTBEAT_TICK_INTERVAL_MS` (30 000), `HEARTBEAT_STALE_THRESHOLD_MS` (180 000).
- `adws/types/agentTypes.ts`: `AgentState.pid`/`pidStartedAt`/`lastSeenAt`, already declared. No change.
- `adws/vcs/worktreeProbe.ts`, `adws/vcs/worktreeReuseGate.ts`: the reuse gate that a dead `starting` now goes through.
- `adws/core/remoteReconcile.ts`: `deriveStageFromRemote` falls back to the state's stage when the branch is not on the remote, so a never-pushed `starting` derives `starting`.
- `adws/triggers/webhookGatekeeper.ts`: the other `evaluateCandidate` caller. `spawn_fresh` holds the lock across `await classifyIssueForTrigger`, which is the in-process dedup the self-hold rule must not break. `spawnDetached` uses `stdio: 'inherit'`.
- `adws/triggers/scanAuthQueue.ts`: third `evaluateCandidate` caller. It catches throws but never released the lock; the release-on-throw fixes that.
- `adws/triggers/retryHandler.ts`: `decideRetryAction` keeps `active` a no-op. No change.
- `adws/adwSdlc.tsx` (and the other `initializeWorkflow` orchestrators): `main();` without `.catch`, and the lock-refusal `process.exit(0)` path. No change needed. The unhandled rejection is what makes an orchestrator that fails during startup exit 1.
- `adws/triggers/__tests__/takeoverHandler.test.ts`, `adws/triggers/__tests__/cronStageResolver.test.ts`, `adws/triggers/__tests__/cronIssueFilterFixtures.ts`, `adws/triggers/__tests__/trigger_cron.test.ts`, `adws/core/__tests__/processLiveness.test.ts`, `adws/phases/__tests__/workflowInit.test.ts`, `adws/phases/__tests__/orchestratorLock.test.ts`: the unit tests to extend.
- `features/per-issue/step_definitions/feature-912.steps.ts`: existing scenarios drive the real `evaluateCandidate`, with the test process as both lock holder and candidate. Must keep passing (checked: its live holder is its own live pid, so no reclaim; its death row stages a dead pid on state and lock).
- `features/per-issue/feature-959.feature`: this issue's BDD scenarios (§1–§6). The flagged rows in `features/per-issue/feature-908.feature` and `features/per-issue/feature-912.feature` also carry `@adw-959` and must not change. The step-definition phase writes their step definitions (`features/per-issue/step_definitions/feature-959*.steps.ts`). It also widens the feature-911 `After` hook to `@adw-959`, as the scenario notes ask.
- `app_docs/feature-9gjajh-takeover-and-coordination.md`, `app_docs/feature-9gjajh-cron-triggers.md`, `app_docs/feature-9gjajh-coordination-kernel.md`, `app_docs/feature-9gjajh-workflow-lifecycle-phases.md`: the conditional docs for the files above. They describe the `active` exclusion and the coordination kernel this fix changes.
- `specs/adr/0034-coordination-kernel.md`, `specs/adr/0036-stage-taxonomy-and-exhaustive-classifier.md`, `specs/adr/0047-resume-in-place.md`, `specs/adr/0029-top-level-state-file-as-source-of-truth.md`: the decisions this fix works within. ADR-0047's "a workflow in an active stage is still reset" is narrowed for `starting` only.

### New Files

- `adws/phases/startupFailureLog.ts`: `recordStartupFailure(adwId, orchestratorName, error)`. It appends the error (with stack) to the orchestrator's `execution.log` and never throws.
- `adws/triggers/__tests__/strandedStartingRecovery.test.ts`: issue-level unit tests that chain the real `resolveIssueWorkflowStage` → `evaluateIssue` → `evaluateCandidate` through their public interfaces with injected deps (acceptance criteria 1–3).

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Keep the unrelated working-tree changes out of the fix

- Before this plan was written, the worktree already had uncommitted changes in:
  - `.claude/commands/{adw_init,clean_local_repo,document,feature,generate_step_definitions,resolve_conflict,resolve_failed_test,review,scenario_writer}.md`
  - `.claude/skills/{depaudit-triage,implement-tdd}/SKILL.md`
  - `README.md`
- The `.claude` ones are stale framework copies (the side effect the issue describes). Committing them would revert newer prompt text on `dev`.
- Confirm with `git diff --stat HEAD -- .claude README.md` that these are the only differences there. Then restore them with `git checkout HEAD -- .claude/commands .claude/skills README.md`. This fix changes none of these files.

### 2. Add `isRecordedOwnerLive` (`adws/core/processLiveness.ts`)

- Export `isRecordedOwnerLive(owner: { readonly pid?: number; readonly pidStartedAt?: string }, isLive: (pid: number, pidStartedAt: string) => boolean = isProcessLive): boolean`.
  - Guard clause: `typeof owner.pid !== 'number' || !owner.pidStartedAt` → `false`. This also covers a JSON `null`.
  - Otherwise return `isLive(owner.pid, owner.pidStartedAt)`.
  - One comment line: an owner that was never recorded cannot be confirmed live.
- Tests in `adws/core/__tests__/processLiveness.test.ts`:
  - false with no pid
  - false with an empty or missing `pidStartedAt`
  - delegates to the injected `isLive` (true and false) with the exact pair

### 3. Record the owner at `starting` (`adws/phases/workflowInit.ts:310-318`)

- Add to the top-level `starting` write:
  - `pid: process.pid`
  - `pidStartedAt: getProcessStartTime(process.pid) ?? undefined`. Always present as a key, so an earlier run's start time is cleared rather than paired with the new pid. Do not use a conditional spread.
  - `lastSeenAt: new Date().toISOString()`
- Import `getProcessStartTime` through the existing `'../core'` import list.
- Two short comments: why `pidStartedAt` is always written, and why `lastSeenAt` is refreshed (the heartbeat's first beat comes one interval after the lifecycle lock; until then the previous run's value reads as hung).
- Leave the sub-state write (`:320-329`) unchanged.
- Tests in `adws/phases/__tests__/workflowInit.test.ts`. Mock `getProcessStartTime` (module `adws/core/processLiveness`) to a fixed token. This file mocks `child_process`, which breaks the macOS `ps` read, so the assertion must not depend on the platform.
  - After `initializeWorkflow`, `AgentStateManager.readTopLevelState(adwId)` has `workflowStage: 'starting'`, `pid === process.pid`, `pidStartedAt === '<token>'`, and `lastSeenAt` no earlier than the test's start time.
  - Pre-seed the top-level state with a previous run's `pid: 1`, `pidStartedAt: 'previous-run'`, `lastSeenAt: '2026-01-01T00:00:00.000Z'`, and make `getProcessStartTime` return `null`. After init, `pid === process.pid`, `pidStartedAt` is `undefined`, and `lastSeenAt` is fresh.

### 4. Make startup deaths visible in `execution.log`

- New `adws/phases/startupFailureLog.ts`. Export `recordStartupFailure(adwId: string, orchestratorName: AgentIdentifier, error: unknown): void`:
  - `const statePath = AgentStateManager.initializeState(adwId, orchestratorName)`, which creates the directory if the failure came before init did.
  - Then `AgentStateManager.appendLog(statePath, \`${orchestratorName} startup failed: ${detail}\`)`, where `detail` is `error.stack ?? error.message` for an `Error`, else `String(error)`.
  - Wrap both in `try { … } catch { /* comment: the caller rethrows the original error */ }`. A failed write must never replace the startup error.
  - Comment the reason: a detached orchestrator has no stderr of its own (discarded or interleaved into its trigger's log), so its `execution.log` is the only place a startup failure stays with its run.
- In `adws/phases/workflowInit.ts`, rename the current `initializeWorkflow` body to a module-private `async function initializeWorkflowSteps(…)` with the same parameters. Add the exported wrapper with the same signature:
  ```ts
  export async function initializeWorkflow(issueNumber, adwId, orchestratorName, options?): Promise<WorkflowConfig> {
    try {
      return await initializeWorkflowSteps(issueNumber, adwId, orchestratorName, options);
    } catch (error) {
      const knownAdwId = adwId ?? getLogAdwId();
      if (knownAdwId) recordStartupFailure(knownAdwId, orchestratorName, error);
      throw error;
    }
  }
  ```
  - `getLogAdwId` comes from `'../core'`.
  - Every trigger passes the adwId on the command line. `getLogAdwId()` covers a manual run that failed after `setLogAdwId(resolvedAdwId)`.
  - The upgrade-gate `process.exit(0)` park is not an error and stays as is.
  - The rethrow also keeps the exit status. `main()` has no `.catch`, so the rejection stays unhandled and the orchestrator still exits 1, after the error is in `execution.log`. Do not add a `.catch` that swallows the error or exits 0. The BDD rows launch each orchestrator the way the cron does, with its output discarded, and expect exit code 1.
  - Keep the wrapper small: the file is already over the 300-line guideline, which is why the helper lives in its own module.
- In `adws/phases/orchestratorLock.ts` `runWithOrchestratorLifecycle`, when `acquireIssueSpawnLock` returns `false`:
  - Read the holder with `readSpawnLockRecord`.
  - `AgentStateManager.appendLog(config.orchestratorStatePath, \`Spawn lock for issue #${config.issueNumber} is held by pid ${holder?.pid ?? 'unknown'}; exiting without running a phase\`)`.
  - Then `return false`.
  - Update the function's doc line to say the refusal is also written to the execution log.
  - Leave `runWithRawOrchestratorLifecycle` (no orchestrator state path) unchanged.
- Tests:
  - `workflowInit.test.ts`: with `mockFetchIssue.mockRejectedValueOnce(new Error('issue fetch exploded'))` and an explicit adwId, `initializeWorkflow` rejects with that error. `agents/<adwId>/<orchestratorName>/execution.log` contains `startup failed` and `issue fetch exploded`. Clean up the adwId directory, as the file's existing tests do.
  - `orchestratorLock.test.ts`:
    - Add `readSpawnLockRecord: vi.fn()` to the `spawnGate` mock factory.
    - Give `fakeConfig` an `orchestratorStatePath`.
    - Spy on `AgentStateManager.appendLog`.
    - Assert that on refusal it is called once with that path and a message naming issue 42 and the holder pid. The existing refusal test's assertions stay true.

### 5. Report owner liveness for active stages (`adws/triggers/cronStageResolver.ts`)

- Add optional `ownerDead?: boolean` to `StageResolution`.
  - It is only set on the state branch.
  - Leave the two early returns (`{ stage: null, adwId, lastActivityMs: null }`) untouched, so the existing `toEqual` tests keep passing.
- Give `resolveIssueWorkflowStage` a third parameter `isLive: (pid: number, pidStartedAt: string) => boolean = isProcessLive`.
- In the state branch, set `ownerDead = stage !== null && classifyStageString(stage) === 'active' && !isRecordedOwnerLive(state, isLive)`.
  - Keep the short-circuit, so non-active stages never shell out to `ps`.
  - Add one comment: an active stage that records no owner predates owner recording at `starting` and counts as dead, because an orchestrator past startup holds the issue's spawn lock and `evaluateCandidate` still defers to it.
- Tests in `adws/triggers/__tests__/cronStageResolver.test.ts`:
  - `starting` with a recorded pid and `isLive → false` → `ownerDead: true`.
  - Same with `isLive → true` → `ownerDead: false`.
  - `build_running` with no pid → `ownerDead: true`, and `isLive` is not called.
  - `phase_timeout` / `abandoned` → `ownerDead: false`, and `isLive` is not called.
  - The existing resolver tests are unchanged.

### 6. Let the cron filter pass a dead-owner active stage (`adws/triggers/cronIssueFilter.ts`)

- Replace the `active` exclusion at `:162-164` with:
  ```ts
  if (classifyStageString(stage) === 'active') {
    if (!resolution.ownerDead) return { eligible: false, reason: 'active' };
    // A dead owner can never advance its stage; evaluateCandidate recovers it.
    return { eligible: true, action: 'spawn', adwId: resolution.adwId ?? undefined };
  }
  ```
  - It stays after the grace-period gate and after the `stage === null` / `processedSpawns` branch. A recovery the cron itself spawned is never blocked by `processedSpawns`.
- Extend the `ProcessedSets` doc comment's list of recovery stages that `spawns` must not gate to include "an active stage whose owner is dead".
- In `adws/core/stageClassifier.ts`, update only the header table's `active` row:
  - Cron: exclude while the owner is live; eligible → spawn once it is dead.
  - Takeover: `starting` → defer if live, else reuse-or-reset; other active stages → SIGKILL-if-live → reset → reconcile → take.
  - No logic change.
- Filter unit tests go in Step 9's new file, so `cronIssueFilter.test.ts` does not grow.

### 7. Make `evaluateCandidate` lock-safe and recover `starting` (`adws/triggers/takeoverHandler.ts`)

- **Release on throw.**
  - Move everything after the successful acquire (from `resolveAdwId` to the final `spawn_fresh`) into a module-private `decideHoldingLock(d, input, releaseLock): CandidateDecision`.
  - `evaluateCandidate` then does `try { return decideHoldingLock(…); } catch (error) { releaseLock(); throw error; }`.
  - One comment: a throw that kept the lock would leave this process's pid on it, and a long-lived caller reads as a live holder for its whole lifetime.
  - The existing paths keep their lock semantics: `take_over_adwId` and `spawn_fresh` keep the lock for the caller; `skip_terminal` and `escalate_human_gated` release it.
- **`starting` handling.**
  - Replace the inline `active` block (`:222-236`) with a call to a new `recoverActiveStage(d, input, adwId, state, releaseLock)`.
  - Compute `const ownerLive = isRecordedOwnerLive(state, d.isProcessLive)`.
  - `state.workflowStage === 'starting'` and `ownerLive` → `releaseLock()` and return `{ kind: 'defer_live_holder', holderPid: state.pid ?? 0 }`.
  - `starting` and not `ownerLive` → `return recoverViaResumeInPlaceOrReset(d, input, adwId, state)`.
  - Any other active stage → today's behaviour: `killProcess(state.pid)` when `ownerLive` (keep the ESRCH swallow), then `recoverViaResetFromRemote`.
  - Two comments:
    - A live `starting` owner that does not hold the lock has not yet taken its lifecycle lock, which comes right after `initializeWorkflow`. So it is a slow startup, not a split brain.
    - A dead `starting` run may have run unnamed phases, because only a named phase writes `*_running`. So its worktree goes through the same reuse gate as `phase_timeout` and `abandoned`.
- **Reclaim a lock this process left behind.**
  - Change the acquire to `d.acquireIssueSpawnLock(repoInfo, issueNumber, process.pid) || reclaimOwnLeakedLock(d, input)`.
  - `reclaimOwnLeakedLock` uses guard clauses only:
    - `d.readSpawnLockRecord(...)?.pid !== process.pid` → `false`.
    - Resolve the adwId and state. No state → `false`. A stage other than `abandoned`, `phase_timeout` or one classed `active` → `false`. The listed stages are the ones the handler takes over; every other stage ends in `skip_terminal` or `spawn_fresh`.
    - `isRecordedOwnerLive(state, d.isProcessLive)` → `false`.
    - Otherwise `log(…, 'warn')` that the issue's spawn lock was left behind by this process and is being reclaimed (naming the stage), then `d.releaseIssueSpawnLock(...)` and `return d.acquireIssueSpawnLock(repoInfo, issueNumber, process.pid)`.
  - Import `log` from `'../core/logger'`, as `retryHandler.ts` does.
  - Comment the safety argument in two lines: in-process holds that span an `await` only follow `spawn_fresh`, which none of these stages produces, and an orchestrator spawned under such a hold records its own live pid at `starting`.
- **Header decision tree** (`:1-23`). Renumber to:
  1. Lock held by a live holder → `defer_live_holder`, unless the holder is this process and the issue's orchestrator is dead, in which case reclaim. Dead means the stage is `abandoned`, `phase_timeout` or classed `active`, and no live owner is recorded.
  2. No adwId / no state → `spawn_fresh`.
  3. completed / discarded → `skip_terminal`.
  4. paused → `skip_terminal` (`terminalStage: 'paused'`).
  5. abandoned → reuse-or-reset.
  6. phase_timeout → resume cap, then reuse-or-reset.
  7. `starting`, live recorded owner → `defer_live_holder` (lock released).
  8. `starting`, dead or unrecorded owner → probe → reuse-in-place if healthy, else reset → reconcile → `take_over_adwId`.
  9. `*_running` / `resuming`, live PID not holding the lock → SIGKILL → reset → reconcile → `take_over_adwId`.
  10. `*_running` / `resuming`, dead PID → reset → reconcile → `take_over_adwId`.
  11. Any other stage → `spawn_fresh`.

  End with one line: any throw after the acquire releases the lock before propagating.
- Keep the file under 300 lines (it is 239 today).
- Tests added to `adws/triggers/__tests__/takeoverHandler.test.ts`, reusing `makeDeps`/`makeState`/`healthyProbe`. All existing tests must pass unchanged; `handles starting stage with dead PID as take_over_adwId` now goes through the healthy probe.
  - **`starting` with a live recorded owner:** `{ kind: 'defer_live_holder', holderPid: <pid> }`. `releaseIssueSpawnLock` called once. `killProcess`, `resetWorktree`, `probeWorktree`, `deriveStageFromRemote` and `writeTopLevelState` not called.
  - **`starting` with a dead recorded owner:**
    - Healthy probe → `take_over_adwId`, `probeWorktree` called with the worktree path, branch, pid and start time; `resetWorktree` and `killProcess` not called.
    - Unhealthy probe → `resetWorktree` before `deriveStageFromRemote`.
    - Lock not released.
  - **`starting` with no pid recorded:** same as dead (probe path, `take_over_adwId`).
  - **`build_running` with a dead pid:** still resets without probing (the existing `active running path always resets` test covers it).
  - **Release on throw:** `resetWorktree` throwing for `build_running`/dead (the #935 error text), and `deriveStageFromRemote` throwing for `abandoned`, both make `evaluateCandidate` rethrow, and `releaseIssueSpawnLock` is called exactly once.
  - **Self-held reclaim.** `acquireIssueSpawnLock` mocked `.mockReturnValueOnce(false).mockReturnValueOnce(true)`; `readSpawnLockRecord` → `{ pid: process.pid, pidStartedAt: 'cron-start' }`.
    - State `starting` with no pid → released once, re-acquired, `take_over_adwId`.
    - State `abandoned`, and state `phase_timeout` within the resume cap, each with no pid → released once, re-acquired, `take_over_adwId`.
    - State `starting` with a live owner (`isProcessLive → true`) → `defer_live_holder` (`holderPid` = `process.pid`) and no release.
    - A stage the handler answers with `spawn_fresh`, for example `build_completed` → `defer_live_holder` and no release. This is the only decision an in-process hold spans an `await` for.
    - Holder pid ≠ `process.pid` → `defer_live_holder`, `resolveAdwId` not called (the existing defer tests also keep passing).

### 8. Contain per-candidate failures and release the take-over lock in the cron loop (`adws/triggers/trigger_cron.ts`)

- Add `export function evaluateCandidateForTick(issueNumber: number, boundary: LaunchBoundary, evaluate: typeof evaluateCandidate = evaluateCandidate): CandidateDecision | null`:
  - `try { return evaluate({ issueNumber, boundary }); }`
  - `catch (error) { log(\`Issue #${issueNumber}: takeover evaluation failed, retrying next cycle: ${error}\`, 'error'); return null; }`
  - Doc it in the file's injectable-tick style: one candidate whose evaluation throws, for example a reset against a branch that was never pushed, must not abort the tick for every candidate after it. `evaluateCandidate` has already released its lock.
  - Import `type CandidateDecision` from `./takeoverHandler`.
- In the loop (`:446`): `const takeoverDecision = evaluateCandidateForTick(issue.number, boundary); if (takeoverDecision === null) continue;`. Keep the "sole gate" comment above it.
- In the take-over branch (`:469-483`), wrap the `readTopLevelState` / `resolveResumeSpawn` / `spawnDetached` block in `try { … } finally { releaseIssueSpawnLock(repoInfo, issue.number); }`, then `continue`.
- Tests in `adws/triggers/__tests__/trigger_cron.test.ts`, under `describe('evaluateCandidateForTick')`. `log` is already mocked through `../../core`.
  - Returns the injected evaluator's decision unchanged.
  - Returns `null` and logs an `'error'` naming the issue when the evaluator throws.
  - A throw for one issue does not stop the next call from returning its decision.

### 9. Issue-level regression tests (`adws/triggers/__tests__/strandedStartingRecovery.test.ts`)

Chain the real public functions with injected deps only, with no module mocks of the code under test. Use `makeIssue`/`GRACE_PERIOD_MS`/`NOW`/`OLD_DATE` from `cronIssueFilterFixtures.ts`, plus a `TakeoverDeps` stub and fake boundary in the style of `takeoverHandler.test.ts`.

- **Acceptance criterion 1** (dead `starting` reaches `evaluateCandidate` and ends in `take_over_adwId`):
  - Given a top-level state `{ workflowStage: 'starting', pid: 4242, pidStartedAt: 'crashed-run', branchName }`:
    - `resolveIssueWorkflowStage(comments, () => state, () => false)` fed to `evaluateIssue(issue, NOW, { spawns: new Set() }, GRACE_PERIOD_MS, () => resolution)` returns `{ eligible: true, action: 'spawn', adwId }`.
    - `evaluateCandidate({ issueNumber, boundary }, deps)` with `readTopLevelState → state`, `isProcessLive → false` and a healthy probe returns `{ kind: 'take_over_adwId', adwId, derivedStage }`, with no `killProcess` and the lock kept for the caller.
  - Repeat with the #935 shape: `starting`, no pid, `lastSeenAt: '2026-10-01T23:45:26.529Z'`, `resumeAttempts: 1`, branch present. It also ends in `take_over_adwId`, without `resetWorktree` on a healthy probe.
- **Acceptance criterion 2** (live `starting` is deferred, never killed or reset):
  - With `isLive → true`, `evaluateIssue` returns `{ eligible: false, reason: 'active' }`.
  - `evaluateCandidate`, simulating the #935 race where the filter saw `phase_timeout` but the state now reads `starting`, returns `defer_live_holder` with the recorded pid. `killProcess`, `resetWorktree`, `probeWorktree` and `deriveStageFromRemote` are never called, and the lock is released.
- **Acceptance criterion 3** (cron filter recovers a stale `starting` without a restart):
  - A dead-owner `starting` issue already in `processed.spawns` (this cron spawned it) is still eligible.
  - The same issue with `lastActivityMs` inside the grace period is `grace_period`; with `now` moved past the period it becomes eligible. No state outside the call is needed.
  - `filterEligibleIssues` annotates a live-owner `starting` issue as `#N(active)` and lists the dead-owner one as a candidate.
- **Self-hold** (the leaked #935 lock): with the lock held by `process.pid` and the `starting`/no-pid state, `evaluateCandidate` reclaims and ends in `take_over_adwId`. An `abandoned` state and a `phase_timeout` state, each with no pid, do the same; the filter already passes both stages.
- **Acceptance criterion 4** is covered by the `workflowInit.test.ts` startup-failure test (Step 4).

### 10. Run the validation commands

- Run every command in `Validation Commands`, including the before/after reproductions. Every command must pass.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

- Reproductions from `Steps to Reproduce` B (run before the fix to see the bug, after it to confirm the fix):
  - B1:
    - Before: `{"eligible":false,"reason":"active"}`.
    - After: `{"eligible":true,"action":"spawn","adwId":"repro-959"}`.
  - B2:
    - Before: `threw: fatal: no remote ref` then `lock releases: 0`.
    - After: `threw: fatal: no remote ref` then `lock releases: 1`.
  - B3:
    - Before: `{"kind":"take_over_adwId","adwId":"repro-959","derivedStage":"starting"} kill 4242, reset`.
    - After: `{"kind":"defer_live_holder","holderPid":4242} release`.
- `bunx vitest run adws/core/__tests__/processLiveness.test.ts adws/core/__tests__/hungOrchestratorDetector.test.ts adws/core/__tests__/stageClassifier.test.ts adws/triggers/__tests__/cronStageResolver.test.ts adws/triggers/__tests__/cronIssueFilter.test.ts adws/triggers/__tests__/cronIssueFilter.eligibility.test.ts adws/triggers/__tests__/cronIssueFilter.optOut.test.ts adws/triggers/__tests__/triggerCronAwaitingMerge.test.ts adws/triggers/__tests__/takeoverHandler.test.ts adws/triggers/__tests__/takeoverHandler.integration.test.ts adws/triggers/__tests__/strandedStartingRecovery.test.ts adws/triggers/__tests__/trigger_cron.test.ts adws/triggers/__tests__/retryHandler.test.ts adws/triggers/__tests__/spawnGate.test.ts adws/phases/__tests__/workflowInit.test.ts adws/phases/__tests__/orchestratorLock.test.ts`: the touched modules and their neighbours.
- `bun run lint`
- `bunx tsc --noEmit`
- `bunx tsc --noEmit -p adws/tsconfig.json`
- `bun run build`
- `bun run test:unit`: the whole unit suite passes.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-959"`: this issue's scenarios, once their step definitions exist.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-912"`: the in-process-wait scenarios that drive the real `evaluateCandidate` and hung detector with the test process as lock holder.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"`
- `git status --short`: only the files named in this plan changed. Nothing under `.claude/` and not `README.md` (see Step 1).

## Notes

- **Guidelines.** Follow `.adw/coding_guidelines.md` strictly:
  - guard clauses and at most two levels of nesting (the new takeover helpers are flat)
  - comments only for invariants and non-obvious reasons, never issue numbers
  - no new `any`
  - files under 300 lines where they already are; `workflowInit.ts` (441) and `trigger_cron.ts` (571) are already over and must only gain the small wrapper and helper described
- **No new library is needed.**
- **Dormant kernel paths now fire, as ADR-0034 designed.** Recording the pid at `starting` brings three liveness readers to life:
  - `findHungOrchestrators` can now match a live `*_running` orchestrator whose heartbeat is stale (SIGKILL → `abandoned`).
  - The auth-gate tick (`trigger_cron.ts:289-305`) SIGTERMs live orchestrators and marks them `paused_auth`.
  - `probeWorktree`'s `liveOwner` sees real owners.

  The fresh `lastSeenAt` at `starting` is what stops the sweep from killing a resumed run before its first heartbeat. The sweep still ignores `starting`, by design.
- **Deviation from the issue text.** The issue says branch 8 already recovers a dead `starting` by resetting from the remote. The cron log shows that reset throws for a branch that was never pushed, which is #935's case and the normal case before the first push. So a dead `starting` goes through the reuse gate instead. This narrows ADR-0047's rule "a workflow in an active stage is still reset" to stages other than `starting`. The document phase should record this in `app_docs/feature-9gjajh-takeover-and-coordination.md`; whether ADR-0047 gets an amendment is the owner's call.
- **Recovering #935 after deploy.**
  - Deploying restarts the cron. The leaked lock's pid 41399 then belongs to a dead process, and `acquireIssueSpawnLock` reclaims it. Had the same cron survived, the self-hold reclaim would have.
  - The `starting` state records no pid, so it counts as dead. Once the issue has been quiet for `GRACE_PERIOD_MS`, and when the concurrency limit allows, the cron takes it over through the reuse gate.
  - `deriveStageFromRemote` falls back to `starting` because the branch is not on the remote.
- **Transitional noise.** Active states written before this change carry no pid. While their orchestrator still runs and holds the lock, the cron reaches `evaluateCandidate` for them each tick and logs `live holder … deferring`. This stops once those runs leave the active stage.
- **Left for follow-up issues** (out of scope; the lifecycle lock keeps each one safe):
  1. A dead `*_running` owner whose branch was never pushed still cannot be reset from the remote. It is now logged per tick and no longer leaks the lock or stalls other candidates. Routing a confirmed-dead active owner through the reuse gate would close it, but needs an ADR-0047 decision.
  2. An orchestrator that dies between phases (`*_completed`, classed `resumable`) is filtered as `adw_stage:*`: the same stranding class.
  3. The double take-over window. The cron releases the lock at spawn, the child re-takes it only after `initializeWorkflow`, and a tick in between can take over again. The losing child now leaves the refusal in `execution.log`, but it may overwrite `starting` and its pid in the top-level state before exiting.
  4. `scanAuthQueue` leaves the lock held on a `spawn_fresh` decision or a throwing spawn.
  5. `isAgentProcessRunning` reads `pidStartedAt` from the orchestrator sub-state, where nothing writes it, so it always returns false (`devServerJanitor`, `isAdwRunningForIssue`).
  6. The stale `.claude` asset copy from an unpulled framework checkout (the issue's side-effect section; a separate issue, as the issue suggests).
- **For the document phase.** Update:
  - `app_docs/feature-9gjajh-takeover-and-coordination.md`: the `active` row; the line-58 claim, which this fix makes true.
  - `app_docs/feature-9gjajh-cron-triggers.md`: the conditional `active` exclusion.
  - `app_docs/feature-9gjajh-coordination-kernel.md`: owner recorded at `starting`; the hung sweep now live.
  - `app_docs/feature-9gjajh-workflow-lifecycle-phases.md`: startup failure and lock refusal in `execution.log`.
  - Add `adws/phases/startupFailureLog.ts` to that entry's `Owns` list in `.adw/conditional_docs.md`.
