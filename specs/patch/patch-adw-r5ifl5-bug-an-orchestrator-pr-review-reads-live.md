# Patch: Make a running PR review read as live: record its owner and run it under the orchestrator lifecycle

## Metadata
adwId: `r5ifl5-bug-an-orchestrator`
reviewChangeRequest: `Issue #1: Regression from treating an unrecorded owner as dead. `resolveIssueWorkflowStage` sets `ownerDead` for any `active` stage that has no live top-level owner, and `evaluateIssue` now passes such issues to `evaluateCandidate`. The plan's safety argument (an orchestrator past startup holds the spawn lock) is false for `adws/adwPrReview.tsx`: it never calls `initializeWorkflow` or `runWithOrchestratorLifecycle`, takes no issue spawn lock, and records its pid only in its sub-state (`adws/phases/prReviewPhase.ts:58`). Its named phases (`install`, `pr_review_plan`, `pr_review_build`, `pr_review_commit_push`) still write `*_running` into the top-level state of the issue's own adwId, which `resolvePrReviewTarget` reuses. That state still holds the finished SDLC run's pid, now recorded at `starting` and dead, so the live PR review reads as dead. Once a PR-review phase runs longer than `GRACE_PERIOD_MS` (5 min, common for `pr_review_build`), the next 20 s poll finds the issue eligible and `evaluateCandidate` takes the free lock. `recoverActiveStage` then runs `resetWorktree` (`git reset --hard origin/<branch>` plus `git clean -fdx`) on the worktree the live PR review is editing and returns `take_over_adwId`, and the cron spawns a second `adws/adwPrReview.tsx` (the state's `orchestratorScript`) beside the first. This repeats each time the grace window lapses. Reproduced on this branch: a `pr_review_build_running` state with a dead SDLC pid and 10-minute-old phases gives `ownerDead: true`, then `{eligible: true, action: 'spawn'}`, then `resetWorktree(...)`, then `take_over_adwId`, then a spawn of `adws/adwPrReview.tsx`. On `dev` the filter returned `{eligible: false, reason: 'active'}`. This breaks the issue's requirement that a live orchestrator is never killed, reset or doubled. Resolution: Make a running PR review read as live. Run `adwPrReview.tsx` under the orchestrator lifecycle (issue spawn lock plus heartbeat, e.g. `runWithOrchestratorLifecycle(config.base, ...)`), so `evaluateCandidate` defers to it. Have `initializePRReviewWorkflow` record `pid`, `pidStartedAt` and a fresh `lastSeenAt` in the top-level state, as `initializeWorkflow` now does, so the filter excludes it as `active`. Do not record the pid without the heartbeat, or the hung-orchestrator sweep will SIGKILL the run. Add a unit test, and ideally an @adw-959 row: a live PR review in `pr_review_build_running`, past the grace period and carrying the finished SDLC run's dead pid, is not reset and gets no second orchestrator.`

## Issue Summary
**Original Spec:** `specs/issue-959-adw-r5ifl5-bug-an-orchestrator-sdlc_planner-recover-stranded-starting-orchestrator.md`

**Issue:** `adwPrReview.tsx` runs under the issue's own adwId (`resolvePrReviewTarget` → `reuse`). It never runs `initializeWorkflow` or the orchestrator lifecycle:
- It records its pid only in its sub-state.
- It takes no spawn lock.
- Its named phases still write `*_running` into the issue's top-level state.

That state still records the finished SDLC run's pid, written at `starting`, and that process is dead. So a live PR review reads as an `active` stage with a dead owner, and once a phase outlasts `GRACE_PERIOD_MS` the cron takes it over. It resets the worktree the review is editing and relaunches `adws/adwPrReview.tsx` beside it. Re-run on this branch with a dead pid and `pr_review_build_running` started 10 min ago:
- `resolveIssueWorkflowStage` → `{"stage":"pr_review_build_running",…,"ownerDead":true}`
- `evaluateIssue` → `{"eligible":true,"action":"spawn","adwId":"prr-959"}`
- `evaluateCandidate` → `{"kind":"take_over_adwId",…}`, after `resetWorktree(…, "bugfix-issue-959-prr")`

Found while planning: once the PR review takes the issue's spawn lock, it shares that lock with the merge orchestrator.
- PR reviews normally run on an issue in `awaiting_merge`: a `hitl` PR waiting for approval.
- The cron dispatches `adwMerge.tsx` for such an issue on every tick, and `executeMerge` holds the lock while it reads the PR, the `hitl` label and the approval.
- A PR review that tries the lock once would sometimes be refused and exit. It would have posted `pr_review_starting` already, and the cron's `processedPRs` never re-triggers that PR.

**Solution:**
1. `initializePRReviewWorkflow` records `pid`, `pidStartedAt` (always written, `?? undefined`) and a fresh `lastSeenAt` in the top-level state, after its early exits. This is the same write `initializeWorkflow` makes. The cron filter then sees a live owner and excludes the issue as `active`.
2. `adwPrReview.tsx` runs its phases inside `runWithOrchestratorLifecycle(config.base, …)`.
   - The issue spawn lock makes `evaluateCandidate` defer to the run. So do `## Retry`, the auth queue and `adwMerge`.
   - The heartbeat keeps the recorded pid out of the hung-orchestrator sweep.
   - A refused lock exits 0, as in every other orchestrator.
3. `runWithOrchestratorLifecycle` gains an optional bounded lock wait. Its default is one attempt, which is today's behaviour. The PR review passes `MERGE_POLL_LOCK_WAIT` (15 attempts, 2 s apart), so it waits out a merge poll instead of dropping the review.
4. Add unit tests and one @adw-959 row: a live PR review at `pr_review_build_running`, past the grace period, on a state that recorded the finished SDLC run's dead pid, is not reset and gets no second orchestrator.

The cron filter, stage resolver, takeover handler, hung sweep and `adwMerge.tsx` do not change.

## Files to Modify
Use these files to implement the patch:

- `adws/phases/prReviewPhase.ts`: record the PR review as the issue's owner in `initializePRReviewWorkflow`.
- `adws/phases/orchestratorLock.ts`: optional `LockWait` parameter on `runWithOrchestratorLifecycle`, and `MERGE_POLL_LOCK_WAIT`.
- `adws/adwPrReview.tsx`: run the phases under the lifecycle.
- `adws/phases/__tests__/prReviewPhase.test.ts` (new): the owner record, and the cron filter reading the PR review as live.
- `adws/phases/__tests__/orchestratorLock.test.ts`: the bounded lock wait.
- `adws/triggers/__tests__/strandedStartingRecovery.test.ts`: the takeover handler defers to the PR review's lock.
- `features/per-issue/feature-959.feature`: the PR-review row, plus three short header edits.
- `features/per-issue/step_definitions/feature-959-pr-review.steps.ts` (new): the row's two Given steps.
- `features/per-issue/step_definitions/feature-959-boundary.ts`: a benign `ensureWorktree`.
- `features/per-issue/step_definitions/feature-959-world.ts`: hold and release the in-process PR review.
- `features/per-issue/step_definitions/feature-959.steps.ts`: `After` ends the held PR review.

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Record the PR review as the owner of the issue's top-level state (`adws/phases/prReviewPhase.ts`)
- In `initializePRReviewWorkflow`, add this write directly after `const orchestratorStatePath = AgentStateManager.initializeState(resolvedAdwId, OrchestratorId.PrReview);` (`:51`).
  - That point comes after both `process.exit(0)` early returns, so a run that exits on a closed PR, or with no comments, never claims the issue.
  ```ts
  // The issue's adwId is reused, so its state still records the finished run's owner: record this run, or the cron reads it as dead.
  AgentStateManager.writeTopLevelState(resolvedAdwId, {
    pid: process.pid,
    // Always written, even as undefined: the shallow merge would otherwise pair this pid with the finished run's start time.
    pidStartedAt: getProcessStartTime(process.pid) ?? undefined,
    // No heartbeat runs until the lifecycle lock is held; until then the finished run's value reads as hung.
    lastSeenAt: new Date().toISOString(),
  });
  ```
- Add `getProcessStartTime` to the existing `'../core'` import list, as `workflowInit.ts` does.
- Write no `workflowStage`. The stage stays as the previous run left it, normally `awaiting_merge`, until the first named phase. An `adwMerge` that already holds the lock rewrites any other stage it reads to `abandoned` (`executeMerge`).
- Leave the sub-state write (`:53-62`) unchanged.
- Land this step together with Step 2. The hung sweep SIGKILLs a live recorded pid in a `*_running` stage whose `lastSeenAt` is older than `HEARTBEAT_STALE_THRESHOLD_MS`, and only the lifecycle heartbeat keeps `lastSeenAt` fresh.

### Step 2: Run the PR review under the orchestrator lifecycle, waiting out the merge poll (`adws/phases/orchestratorLock.ts`, `adws/adwPrReview.tsx`)
- `orchestratorLock.ts`:
  - Add `export interface LockWait { readonly attempts: number; readonly retryMs: number; readonly sleep?: (ms: number) => Promise<void> }`.
  - Add a private `const SINGLE_ATTEMPT: LockWait = { attempts: 1, retryMs: 0 };`.
  - Add the exported constant:
    ```ts
    /**
     * The cron dispatches the merge orchestrator for an awaiting_merge issue on every tick, and it holds the issue's
     * spawn lock while it reads the PR, so a PR review on that issue waits it out instead of dropping the review.
     * 30 s stays well inside HEARTBEAT_STALE_THRESHOLD_MS: no heartbeat runs until the lock is held.
     */
    export const MERGE_POLL_LOCK_WAIT: LockWait = { attempts: 15, retryMs: 2_000 };
    ```
  - Add a private `async function retryAcquire(repoId: RepoIdentifier, issueNumber: number, wait: LockWait): Promise<boolean>`:
    - For attempts 2 to `wait.attempts`, first `await (wait.sleep ?? sleepFor)(wait.retryMs)`.
    - Then `return true` if `acquireIssueSpawnLock(repoId, issueNumber, process.pid)` succeeds.
    - After the loop, `return false`.
    - `sleepFor` is a one-line `setTimeout` promise.
  - Give `runWithOrchestratorLifecycle` a third parameter, `wait: LockWait = SINGLE_ATTEMPT`, and acquire with `acquireIssueSpawnLock(repoId, config.issueNumber, process.pid) || await retryAcquire(repoId, config.issueNumber, wait)`.
    - The first attempt stays synchronous, and the default never sleeps, so every existing caller behaves exactly as before.
    - The refusal is still appended to the execution log once, after the last attempt.
  - Add one line to the function's doc comment: a refused lock is retried per `wait` (default: no retry) before the refusal is logged.
  - Leave `runWithRawOrchestratorLifecycle` unchanged.
- `adwPrReview.tsx`:
  - Move the phase body verbatim into `async function runPrReviewPhases(config: PRReviewWorkflowConfig, boundary: LaunchBoundary): Promise<void>`, placed above `main()`.
    - The body runs from `const tracker = new CostTracker();` to the end of the `catch`.
    - This follows the guidelines' rule that long inline callbacks become named functions, and matches `adwChore.tsx`'s `executeChore`.
  - In `main()`, after the existing top-level write:
    ```ts
    if (!await runWithOrchestratorLifecycle(config.base, () => runPrReviewPhases(config, boundary), MERGE_POLL_LOCK_WAIT)) {
      log(`Issue #${config.base.issueNumber}: spawn lock already held by another orchestrator; exiting.`, 'warn');
      process.exit(0);
    }
    ```
  - Imports:
    - `log` and `type LaunchBoundary` from `'./core'`
    - `type PRReviewWorkflowConfig` from `'./workflowPhases'`
    - `runWithOrchestratorLifecycle` and `MERGE_POLL_LOCK_WAIT` from `'./phases/orchestratorLock'`
  - Keep the bare `main();`.
  - Exits are unchanged:
    - `handlePRReviewWorkflowError` and `handleAuthRequiredPause` still call `process.exit`. The lock is left for the stale-pid reclaim, as in every other orchestrator.
    - A normal finish stops the heartbeat and releases the lock after `completePRReviewWorkflow` has written `awaiting_merge` or `review_failed`.

### Step 3: Unit tests
- **New `adws/phases/__tests__/prReviewPhase.test.ts`.** It drives the real `initializePRReviewWorkflow` through its public interface.
  - Mocks:
    - `../../core/processLiveness`: `getProcessStartTime: vi.fn()` over `importOriginal`. This pins the start token so the assertion is exact on every platform, as `workflowInit.test.ts` does.
    - `../../core/workspaceBinding`: `bindWorkspaceContext: vi.fn().mockReturnValue(undefined)` over `importOriginal`. With no RepoContext, no PR comments are posted.
  - Fixture:
    - A `LaunchBoundary` cast with `repoId` `acme/widget`.
    - `providers.codeHost`:
      - `fetchPullRequest` → `{ number: 96, title, body: '', state: 'OPEN', sourceBranch: BRANCH, targetBranch: 'main', url: '', linkedIssueNumber: 9600 }`
      - `fetchReviewComments` → `[]`
      - `getAuthenticatedUser` → `'adw-bot'`
    - `gitContext` `{ owner, repo, ensureWorktree: () => '/tmp/adw-pr-review-owner-unit' }`.
    - `seedFinishedSdlcRun()` writes the top-level state the SDLC run leaves:
      - `workflowStage: 'awaiting_merge'` and `orchestratorScript: 'adws/adwSdlc.tsx'`
      - `branchName: BRANCH`
      - its dead owner: `pid: 2147483646`, `pidStartedAt: 'finished-sdlc-run'`, `lastSeenAt: '2026-01-01T00:00:00.000Z'`
      - one completed `stepDef` phase. That recorded phase is what lets init run without unaddressed comments instead of calling `process.exit(0)`.
    - `afterEach`: `rmSync` `join(AGENTS_STATE_DIR, ADW_ID)` and `join(LOGS_DIR, ADW_ID)` (both from `../../core/config`), then `resetLogAdwId()`.
  - Tests:
    1. The finished SDLC run's owner is replaced by this run, and the stage is left alone. After init, with `getProcessStartTime` → `'pr-review-start'`:
       - `pid === process.pid`
       - `pidStartedAt === 'pr-review-start'`
       - `lastSeenAt` no earlier than the test's start
       - `workflowStage` is still `'awaiting_merge'`
    2. This pid is never paired with the finished run's start time. With `getProcessStartTime` → `null`: `pid === process.pid` and `pidStartedAt` is `undefined`.
    3. Ten minutes into `pr_review_build_running`, the PR review reads as live, so the cron leaves it to run.
       - After init, write what `runPhase` writes: `{ workflowStage: 'pr_review_build_running', phases: { pr_review_build: { status: 'running', startedAt: <now − 10 min> } } }`.
       - `resolveIssueWorkflowStage(comments, (id) => AgentStateManager.readTopLevelState(id), (pid, startedAt) => pid === process.pid && startedAt === 'pr-review-start')` has `ownerDead: false`.
       - `evaluateIssue(makeIssue({ number: 9600, comments, createdAt: OLD_DATE, updatedAt: OLD_DATE }), Date.now(), { spawns: new Set() }, GRACE_PERIOD_MS, () => resolution)` returns `{ eligible: false, reason: 'active' }`. `GRACE_PERIOD_MS` is the real one from `../../core/config`; `makeIssue` and `OLD_DATE` come from `../../triggers/__tests__/cronIssueFilterFixtures`.
  - All three fail without Step 1. The state keeps pid `2147483646`, and test 3 gets `{ eligible: true, action: 'spawn', adwId }`.
- **`adws/phases/__tests__/orchestratorLock.test.ts`**, new `describe('runWithOrchestratorLifecycle with a lock wait')`. Use `const sleep = vi.fn(async (_ms: number) => {})`; the existing `beforeEach` clears it.
  - Refused twice, then free (`mockAcquire.mockReturnValueOnce(false).mockReturnValueOnce(false).mockReturnValue(true)`), with `{ attempts: 5, retryMs: 2_000, sleep }`:
    - returns `true`
    - `fn` runs once
    - `mockAcquire` is called 3 times
    - `sleep` is called twice, with `2_000`
    - `mockAppendLog` is not called
  - Refused on every attempt, with `{ attempts: 3, retryMs: 2_000, sleep }`:
    - returns `false`
    - `mockAcquire` is called 3 times
    - `sleep` is called twice
    - `mockAppendLog` is called once
    - `mockStart` is not called
    - `fn` never runs
  - `MERGE_POLL_LOCK_WAIT.attempts * MERGE_POLL_LOCK_WAIT.retryMs` is less than `HEARTBEAT_STALE_THRESHOLD_MS` (from `../../core/config`), because no heartbeat runs until the lock is held.
  - The existing tests stay unchanged. The refusal test's `calls === ['acquire']` already pins the default single attempt.
- **`adws/triggers/__tests__/strandedStartingRecovery.test.ts`**, new `describe('a live PR review on the issue\'s own adwId is never disturbed')`. Reuse `makeState`, `makeDeps`, `resolverFor`, `makeFilterIssue`, `BOUNDARY` and the fixture `NOW`.
  - State: `makeState({ workflowStage: 'pr_review_build_running', orchestratorScript: 'adws/adwPrReview.tsx', phases: { pr_review_build: { status: 'running', startedAt: <NOW − 10 min> } }, pid: 4242, pidStartedAt: 'finished-sdlc-run' })`. This is the worst case: the state still records the finished SDLC run's dead pid.
  - The filter passes it on: `evaluateIssue(…, resolverFor(state, false))` → `{ eligible: true, action: 'spawn', adwId: ADW_ID }`.
  - `evaluateCandidate` with `acquireIssueSpawnLock` → `false` and `readSpawnLockRecord` → `{ pid: process.pid + 1, pidStartedAt: 'pr-review-start' }` returns `{ kind: 'defer_live_holder', holderPid: process.pid + 1 }`. The holder is the live PR review, and `+ 1` keeps the self-hold reclaim out of play.
  - `killProcess`, `resetWorktree`, `probeWorktree` and `releaseIssueSpawnLock` are not called. The decision is neither `take_over_adwId` nor `spawn_fresh`, so the cron launches nothing.

### Step 4: The @adw-959 row (`features/per-issue/feature-959.feature` and its step definitions)
- Add the scenario under `§2 A LIVE ORCHESTRATOR IS LEFT ALONE`, after the heartbeating outline:
  ```gherkin
  @adw-959 @adw-r5ifl5-bug-an-orchestrator
  Scenario: A PR review ten minutes into "pr_review_build_running", on a workflow whose state still records the finished SDLC run's dead pid, is left alone — not reset and not doubled
    Given a launch boundary for the repository "adw-fixture/void-959" whose providers record every call
    And issue 9600 has an ADW workflow under adwId "prr959-9600" that runs "adws/adwSdlc.tsx", whose last run stopped at "awaiting_merge" half an hour ago
    And the SDLC run of workflow "prr959-9600" has exited, leaving its pid in the state
    And a PR review of workflow "prr959-9600" has started up on the issue's pull request and has stood at workflowStage "pr_review_build_running" for ten minutes
    When the cron polls from that boundary, with its hung-orchestrator sweep due
    Then the cron launched no orchestrator for issue 9600
    And the worktree of workflow "prr959-9600" was not reset
    And the state file for adwId "prr959-9600" records workflowStage "pr_review_build_running"
  ```
- Header edits, one each:
  - Append to the `§2` summary: "A PR review on the issue's own adwId, ten minutes into `pr_review_build_running`, whose state still recorded the finished SDLC run's dead pid, is not reset and gets no second orchestrator."
  - Add a bullet to "Each row is written to fail…", after the heartbeating bullet: "the PR-review row fails for a PR review that does not record itself as owner. It reuses the issue's adwId, whose state still records the finished SDLC run's dead pid, so the cron reads the live review as dead, resets the worktree it is editing and relaunches `adws/adwPrReview.tsx` beside it. It also fails for a fix that records the pid only where none is recorded;"
  - Add "the finished SDLC run that exited, and the PR review that started up on the issue's pull request" to the "novel phrasing is introduced for them" list.
- New `features/per-issue/step_definitions/feature-959-pr-review.steps.ts`.
  - Doc comment, which must state:
    - `adwPrReview.tsx` needs a live code host, so the PR review here is this process.
    - The step runs the real `initializePRReviewWorkflow` against the recording boundary and holds the lifecycle the script wraps its phases in until `After`.
    - `lastSeenAt` must stay fresh, because the recorded owner is this process and the poll's hung sweep SIGKILLs a live owner whose heartbeat is stale.
  - `the SDLC run of workflow {string} has exited, leaving its pid in the state`:
    - `requireWorkflow(adwId)`
    - `const owner = await startOrchestratorProcess(); s.processes.push(owner); await killOrchestratorProcess(owner);`
    - `AgentStateManager.writeTopLevelState(adwId, { pid: owner.pid, pidStartedAt: owner.startToken })`
  - `a PR review of workflow {string} has started up on the issue's pull request and has stood at workflowStage {string} for ten minutes`:
    - `const boundary = useBenignGitContext()`.
    - With `prNumber = workflow.issueNumber`, set `requireFixture().prByBranch.set(workflow.branchName, { number: prNumber, state: 'OPEN', sourceBranch: workflow.branchName, targetBranch: 'main', labels: [] })` and `prLinkedIssue.set(prNumber, workflow.issueNumber)`.
    - `const config = await initializePRReviewWorkflow(prNumber, adwId, boundary)`.
      - The seeded `plan` phase keeps the empty comment list from exiting.
      - The fixture's PR state defaults to `OPEN`.
    - Mirror `adwPrReview.tsx`'s top-level write: `AgentStateManager.writeTopLevelState(adwId, { orchestratorScript: 'adws/adwPrReview.tsx' })`.
    - Start `runWithOrchestratorLifecycle(config.base, fn)` with the default single attempt and do not await it. The lock is free here, so a refusal should fail at once.
      - `fn` resolves a "started" promise.
      - `fn` then returns a promise whose resolver is stored in `s.releasePrReview`.
      - Store the lifecycle promise in `s.prReview`.
    - `await Promise.race([started, lifecycle])` and `assert.ok` the result, so a refused lock (`false`) fails the step.
    - `recordStage(workflow, stage, new Date())` writes the stage, a phase started ten and a half minutes ago and a fresh `lastSeenAt`.
- `feature-959-boundary.ts`:
  - Add `['ensureWorktree', (branch: string) => real.worktreePathFor(branch)]` to `benignAnswers`.
  - Extend its doc comment: a PR review's worktree is located, never created.
- `feature-959-world.ts`:
  - Add `prReview: Promise<boolean> | null` and `releasePrReview: (() => void) | null` (the PR review a row runs in this process, and the release that ends its lifecycle).
  - Set both to `null` initially and in `resetState()`.
- `feature-959.steps.ts` `After`:
  - Right after the stand-in processes are killed, and before `releaseHeldSpawnLocks()`, call `s.releasePrReview?.(); if (s.prReview) await s.prReview;`. This stops the heartbeat and releases the lock before the scenario's state files are removed.
  - Then call `resetLogAdwId()` (`adws/core/logger.ts`); `initializePRReviewWorkflow` set the log adwId.
- Expected:
  - Without Step 1 the row fails: the poll records a reset of `bugfix-issue-9600-fixture-959` and a launch of `adws/adwPrReview.tsx 9600 prr959-9600`.
  - With Step 1 the filter excludes the issue as `active`, so nothing is launched or reset.

## Validation
Execute every command to validate the patch is complete with zero regressions.

1. `bunx vitest run adws/phases/__tests__/prReviewPhase.test.ts adws/phases/__tests__/orchestratorLock.test.ts adws/triggers/__tests__/strandedStartingRecovery.test.ts adws/phases/__tests__/workflowInit.test.ts adws/phases/__tests__/prReviewCompletion.test.ts adws/triggers/__tests__/takeoverHandler.test.ts adws/triggers/__tests__/cronStageResolver.test.ts adws/core/__tests__/hungOrchestratorDetector.test.ts adws/core/__tests__/prReviewInvocation.test.ts adws/core/__tests__/resolvePrReviewTarget.test.ts`
   - The touched modules and their neighbours all pass.
   - The three `prReviewPhase.test.ts` owner tests fail if Step 1's write is removed.
2. `bun run lint && bunx tsc --noEmit && bunx tsc --noEmit -p adws/tsconfig.json && bun run build`
3. `bun run test:unit`: the whole unit suite passes.
4. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-959"`, then `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-912"`, then `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"`. The new PR-review row passes along with every existing row.
5. `git status --short`: only the files listed in `Files to Modify`, plus this plan, have changed. Nothing under `.claude/` and not `README.md`.

## Patch Scope
**Lines of code to change:** About 55 production lines:
- `prReviewPhase.ts` +8
- `orchestratorLock.ts` +30
- `adwPrReview.tsx` +15 net, with about 45 lines moved unchanged into `runPrReviewPhases`

About 170 unit-test lines and about 95 BDD lines (feature, one new step file, small edits to boundary, world and hooks).

**Risk level:** medium. A PR review now holds the issue's spawn lock for its whole run, so `adwMerge`, `## Retry`, the auth queue and cron takeovers defer to it, which is the point of the change. The shared lifecycle helper gains an optional parameter; its default keeps the current single synchronous attempt.

**Testing required:**
- Unit tests:
  - the PR review's owner record, and the cron filter reading it as live
  - the bounded lock wait
  - the takeover handler deferring to the PR review's lock while the state still records the dead SDLC pid
- The new @adw-959 PR-review row, red without Step 1 and green with it.
- The existing @adw-959, @adw-912 and @regression scenarios.
- The full unit suite, type-check, lint and build.
