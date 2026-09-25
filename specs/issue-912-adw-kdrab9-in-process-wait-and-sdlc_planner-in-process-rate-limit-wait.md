# Feature: In-process wait and indefinite retry for five-hour session limits

## Metadata
issueNumber: `912`
adwId: `kdrab9-in-process-wait-and`
issueJson: `{"number":912,"title":"In-process wait and indefinite retry for five-hour session limits","body":"## Parent PRD\n\n`specs/prd/rate-limit-indefinite-retry.md`\n\n## What to build\n\nLet an orchestrator ride out a five-hour session limit in-process instead of exiting to the queue. See PRD section \"Wait policy\".\n\nEnd to end: an agent run is rejected with `rateLimitType: five_hour` and a known `resetsAt` → the phase runner posts an issue comment stating the wait-until time and the attempt number → sleeps until `resetsAt` through an injected clock → re-runs the phase → repeats without bound. The workflow stage stays the phase's `*_running` stage (no new stage: a dead PID in a running stage is already recovered by takeover branch 8; the heartbeat keeps ticking so the hung detector stays quiet; the spawn lock is held; the wait sits between agent spawns so no per-agent timeout runs).\n\nIntroduce a **pure wait policy**: input is the rate-limit facts from `RateLimitError` (#907) and the clock; output is `{ kind: 'wait_in_process', until }` or `{ kind: 'enqueue', resetsAt? }`. Rules: `five_hour` with a reset time → wait in-process; everything else (`seven_day`, unknown type, no reset time, overloaded, server error) → enqueue via the existing pause path, which stores the reset time when known (#910).\n\nA second rate limit hit after a wait is decided afresh by the same policy; with no reset time it exits and enqueues regardless of history.\n\n## Acceptance criteria\n\n- [ ] Wait policy unit tests cover: five_hour + resetsAt → wait; five_hour without resetsAt → enqueue; seven_day + resetsAt → enqueue with resetsAt; unknown type → enqueue; no facts → enqueue\n- [ ] Phase runner, driven through an injected clock in a test, waits and re-runs the phase across at least three consecutive five-hour rejections and then completes when the phase succeeds\n- [ ] Each wait posts a comment containing the wait-until time (UTC) and the attempt number; the comment is recorded at the injected comment seam\n- [ ] Top-level state stage is unchanged across the wait; `lastSeenAt` advances (heartbeat alive)\n- [ ] A rejection without a reset time after a prior in-process wait takes the enqueue path\n- [ ] The existing pause/resume smoke scenario in the regression suite stays green\n- [ ] `bun run test`, `bun run test:unit`, and `bun run lint:git-guard` pass\n\n## Blocked by\n#910 <!-- adw:region-overlap -->\n\n- Blocked by #910\n\n## Touched Files\n\n- adws/core/rateLimitWaitPolicy.ts\n- adws/core/__tests__/rateLimitWaitPolicy.test.ts\n- adws/core/phaseRunner.ts\n- adws/core/__tests__/phaseRunner.test.ts\n- adws/phases/workflowCompletion.ts\n\n## User stories addressed\n\n- User story 1\n- User story 2\n- User story 3\n- User story 4\n- User story 5\n- User story 6\n- User story 22\n- User story 23\n- User story 24\n- User story 25\n- User story 32\n- User story 34\n- User story 35\n","state":"OPEN","author":"paysdoc","labels":["adw:feature"],"createdAt":"2026-09-25T08:26:16Z","comments":[{"author":"paysdoc-adw","createdAt":"2026-09-25T08:31:24Z","body":"⏸️ **Deferred behind #910 — overlapping code region**\n\nADW detected that this issue edits code overlapping with #910, which is already in flight. To avoid building on a stale base (and the forced rebase / non-fast-forward push deadlock that follows), it has been serialized behind #910 by registering a `## Blocked by` dependency.\n\nOverlapping paths:\n- `adws/phases/workflowcompletion.ts`\n\nThis issue will spawn automatically once #910 merges and closes. To override, remove the `#910 <!-- adw:region-overlap -->` line from this issue body."}],"actionableComment":null}`

## Feature Description

This is the "Wait policy" slice of `specs/prd/rate-limit-indefinite-retry.md` (user stories 1 to 6, 22 to 25, 32, 34 and 35). It lets an orchestrator that is rejected by a five-hour session limit stay alive and ride the limit out in-process, instead of exiting to the pause queue and depending on the cron scanner to bring it back.

Today `runPhase()` in `adws/core/phaseRunner.ts` treats every `RateLimitError` the same way: it marks the phase `failed`, lazy-imports `handleRateLimitPause` from `adws/phases/workflowCompletion.ts`, which appends a pause-queue entry, writes `workflowStage: 'paused'`, posts the paused comment and calls `process.exit(0)`. Since #907 the error carries the limit type and the reset time the CLI reported (`rateLimitType`, `resetsAt` in Unix epoch seconds), and since #910 the queue entry stores them and the scanner waits for the reset time before probing. What is still missing is the cheapest recovery of all: for a five-hour window with a known reset time, nothing needs to be released and nothing needs to be re-spawned. The process, its worktree, its spawn lock and its heartbeat are all already in place, and the phase can simply be re-run once the clock passes the reset time.

After this change:

- A new pure module, `adws/core/rateLimitWaitPolicy.ts`, decides from the rate-limit facts and the clock whether to wait in-process (`{ kind: 'wait_in_process', until }`) or to exit and enqueue (`{ kind: 'enqueue', resetsAt? }`). A `five_hour` limit with a reset time waits in-process. Everything else (a `seven_day` limit, an unknown or absent limit type, an overload, a server error, any limit with no reset time) takes the existing pause path, which stores the reset time when it is known.
- `runPhase()` wraps the phase function in a loop. On a wait decision it posts an issue comment stating the wait-until time (UTC) and the attempt number, sleeps until the reset time through an injected clock, re-runs the phase, and repeats without bound. `runPhasesParallel()` does the same for a parallel group. The workflow stage is left exactly as it is (the phase's `*_running` stage), no phase is marked `failed` for a waited attempt, and the orchestrator never exits on this path.
- Every subsequent rate limit is decided afresh by the same policy. A second rejection with no reset time, or with a `seven_day` type, takes the enqueue path regardless of how many in-process waits preceded it.
- The paused comment written by the enqueue path now names the limit type and the reset time when the error carried them, so an operator can tell what a queued workflow is waiting for and until when (user story 4 for the queue path).

Nothing new is needed for liveness or coordination: the spawn lock is held for the orchestrator's lifetime by `runWithOrchestratorLifecycle` (`adws/phases/orchestratorLock.ts`), the heartbeat started there keeps writing `lastSeenAt` because the sleep is timer-based and never blocks the event loop, so the hung-orchestrator detector stays quiet; a dead PID in a `*_running` stage is already recovered by takeover branch 8 (`adws/triggers/takeoverHandler.ts`); `## Retry` is a no-op for every active stage (`decideRetryAction` in `adws/triggers/retryHandler.ts`), so a sleeping orchestrator cannot be duplicated; and the wait sits between agent spawns, after `runClaudeAgentWithCommand` has thrown, so no per-agent watchdog is running.

Value: a five-hour session limit (the #840 incident of 2026-09-22) recovers by itself at the exact reset time with no process churn, no probe traffic and no queue bookkeeping, the issue says what the workflow is waiting for and how many times it has waited, and the queue remains the release valve for everything that is not a short, well-known wait.

## User Story

As an ADW operator
I want a workflow that hits a five-hour session limit to stay alive, tell the issue until when and for the how-manyth time it is waiting, sleep until the reported reset time, and re-run the rejected phase, indefinitely, while a seven-day limit or a limit with no known reset time still releases the process to the pause queue
So that I never have to notice or intervene on a five-hour limit, recovery happens at the exact reset time rather than on a probe cadence, I can tell a waiting orchestrator from a hung one by reading the issue, and a host is never held for days by a workflow that could have been queued

## Problem Statement

1. **A five-hour limit always exits to the queue.** `runPhase()` (`adws/core/phaseRunner.ts` lines 141 to 145) and `runPhasesParallel()` (lines 183 to 186) route every `RateLimitError` to `handleRateLimitPause`, which exits the process. For a limit that resets in under five hours this releases the worktree, the lock and the process for nothing, then relies on the cron scanner, a probe, a detached re-spawn and a full `initializeWorkflow` to come back. Every one of those steps has stranded workflows before (#840, #871 to #877).
2. **The reset time is known and not used in-process.** `RateLimitError.resetsAt` and `rateLimitType` reach `runPhase` since #907. The runner reads neither; it has no decision to make and no clock to make it with.
3. **There is no pure decision to test.** The PRD (user story 32) requires that every branch of the wait policy (five-hour with reset, seven-day with reset, no reset, unknown type) have a unit test. Today the decision does not exist as a function.
4. **The issue cannot tell a waiting orchestrator from a hung one.** Nothing is posted while a process waits, and the paused comment ("Rate limit or API outage detected") does not say what kind of limit or until when.
5. **A wait cannot be driven in a test.** `runPhase` has no injected clock or comment seam; the only way to observe its rate-limit behaviour is to mock the module that calls `process.exit`.

## Solution Statement

- **Policy (pure):** `adws/core/rateLimitWaitPolicy.ts` exports `decideRateLimitWait(facts, now, bounds?)`, the `RateLimitWaitDecision` union, the `WaitClock` interface, `sleepUntil(clock, until, maxSliceMs?)` and the constants that bound the wait. No I/O, no clock read, no environment, no logging. Decision table (top to bottom):

  | `rateLimitType` | `resetsAt` | reset time vs `now` | decision |
  |---|---|---|---|
  | `five_hour` | finite number | later than `now + maxWaitMs` | `enqueue` carrying `resetsAt` |
  | `five_hour` | finite number | otherwise (future, imminent or past) | `wait_in_process` with `until = max(resetTime, now + minWaitMs)` |
  | `five_hour` | absent or non-finite | any | `enqueue` (bare) |
  | anything else, or absent | finite number | any | `enqueue` carrying `resetsAt` |
  | anything else, or absent | absent or non-finite | any | `enqueue` (bare) |

  `minWaitMs` (`MIN_RATE_LIMIT_WAIT_MS`, 60 s) is the floor applied when the reported reset time is already past or imminent, so a stale reset time cannot spin a hot re-run loop that posts a comment every few seconds. `maxWaitMs` (`MAX_IN_PROCESS_WAIT_MS`, 6 h) is the ceiling above which a "five-hour" limit is not believed in-process: a reset time days ahead (a unit slip, a bogus value) must not hold a worktree, a concurrency slot and the spawn lock for days when the queue already handles long waits without a process. Both are parameters with defaults so tests pin them; neither reads the environment.

- **Runner (thin shell):** `runPhase(config, tracker, fn, phaseName?, deps?: PhaseRunnerDeps)` where `PhaseRunnerDeps = { clock?: WaitClock; postComment?: PostIssueComment }`. The defaults are `systemClock` (`Date` + `setTimeout`) and a best-effort poster over `config.repoContext.issueTracker.commentOnIssue` (no-op without a `repoContext`, never throws). The runner wraps the attempt in a loop: on `wait_in_process` it posts `formatRateLimitWaitComment(...)`, appends an orchestrator log line, sleeps with `sleepUntil`, and re-runs the phase with the attempt counter incremented; on `enqueue` the existing behaviour is byte-for-byte unchanged (phase marked `failed`, `handleRateLimitPause` called with the error as the facts). `runPhasesSequential` passes `deps` through. `runPhasesParallel` runs the same loop around the group, and before sleeping it lets the in-flight siblings settle so no agent is running during the wait.
- **Comment (pure):** `formatRateLimitWaitComment({ adwId, phaseName, rateLimitType?, until, attempt })` in `adws/forge/workflowCommentsIssue.ts`, next to `formatHumanGatedComment`. Its heading is not in `STAGE_HEADER_MAP` (`adws/core/workflowCommentParsing.ts` lines 27 to 52), so `detectRecoveryState` skips it and it can never be mistaken for a lifecycle stage on a later resume. It carries the ADW ID footer and `ADW_SIGNATURE`, so it counts as an ADW comment everywhere else.
- **Paused comment reason:** a pure `describeRateLimitPauseReason(facts)` in `adws/phases/workflowCompletion.ts` renders the limit type and the reset time (UTC) when known, keeping today's text when nothing is known.
- **No new stage, no state schema change, no queue change, no new process-exit path.** The heartbeat is not touched: the runner relies on the one `runWithOrchestratorLifecycle` already runs, and the test proves it keeps ticking through a wait.

## Relevant Files
Use these files to implement the feature:

- `adws/core/phaseRunner.ts` — the runner. `runPhase` (lines 65 to 148) writes `${phaseName}_running` at 96 to 101, runs `fn` at 104, and in its `catch` (118 to 147) handles `AgentTimeoutError`, writes the phase `failed` (136 to 140) and calls `handleRateLimitPause` with the error as the sixth argument (141 to 145). `runPhasesSequential` (150 to 161) and `runPhasesParallel` (163 to 189, its own `RateLimitError` branch at 183 to 186). Gains `PhaseRunnerDeps`, `systemClock`, the wait loop and the wait helper. Currently 189 lines; must stay under 300 after the change (extract the attempt, the failure path and the wait into named functions).
- `adws/core/__tests__/phaseRunner.test.ts` — the existing suite. Mocks `../config`, `../../cost`, `../../cost/d1Client`, `../agentState` (a hoisted `writeTopLevelStateMock`) and `../../phases/workflowCompletion` (`handleRateLimitPause` only) at lines 8 to 37; `makeConfig` at 39 to 47. The test at 128 to 140 throws `five_hour` + `INCIDENT_RESETS_AT` and expects `handleRateLimitPause`; under this feature that input waits, so the test must switch to `seven_day` (step 6). The real `adws/forge/workflowCommentsIssue.ts` loads cleanly under these mocks (verified), so the new cases assert on the real comment body.
- `adws/phases/workflowCompletion.ts` — `handleRateLimitPause` (lines 98 to 147) sets `ctx.pauseReason` at 134 to 137; gains `describeRateLimitPauseReason`. `buildPausedWorkflowEntry` (62 to 96) is unchanged. The lazy import from the runner stays as it is.
- `adws/phases/__tests__/workflowCompletion.test.ts` — mock-free tests of `buildPausedWorkflowEntry`; gains the `describeRateLimitPauseReason` cases.
- `adws/forge/workflowCommentsIssue.ts` — all issue comment formatters. `formatHumanGatedComment` (lines 375 to 388) is the precedent for a context-free exported formatter posted directly by a caller (`takeoverHandler.ts` line 213). Gains `formatRateLimitWaitComment`. Currently 388 lines; add the one function only.
- `adws/forge/__tests__/workflowCommentsIssue.test.ts` — formatter tests; gains the wait-comment cases.
- `adws/core/index.ts` — line 190 to 191 re-export the runner API; add `PhaseRunnerDeps`, `PostIssueComment`, `systemClock`, and a new pair of lines for the policy module after them.
- `adws/types/agentTypes.ts` — read-only: `RateLimitFacts` (`rateLimitType?: string; resetsAt?: number`, epoch **seconds**) and `RateLimitError` (readonly `phaseName`, `rateLimitType?`, `resetsAt?`; satisfies `RateLimitFacts` structurally).
- `adws/core/workflowCommentParsing.ts` — read-only: `STAGE_HEADER_MAP` (27 to 52), `ADW_SIGNATURE` (57), `parseWorkflowStageFromComment` (128 to 133), `detectRecoveryState` (166 onward, skips comments whose heading maps to no stage). The wait comment's heading must not be added to the map.
- `adws/core/heartbeat.ts` and `adws/phases/orchestratorLock.ts` — read-only: `startHeartbeat(adwId, intervalMs)` is a `setInterval` writing `lastSeenAt`; `runWithOrchestratorLifecycle` (36 to 50) holds the spawn lock and runs the heartbeat around the whole phase sequence, which is what makes an in-process wait safe. `HEARTBEAT_TICK_INTERVAL_MS` (30 s) and `HEARTBEAT_STALE_THRESHOLD_MS` (180 s) in `adws/core/config.ts` lines 62 to 65.
- `adws/core/hungOrchestratorDetector.ts` — read-only: flags `*_running` + live PID + `lastSeenAt` older than the threshold. The wait keeps the stage and the heartbeat, so it is never flagged.
- `adws/triggers/takeoverHandler.ts` — read-only: header lines 1 to 23 document branch 8 (`*_running`, dead PID → worktree reset → reconcile → take over), the recovery for a host that dies mid-wait.
- `adws/triggers/retryHandler.ts` — read-only: `decideRetryAction` (36 to 45) returns `noop` for every active stage, so `## Retry` cannot duplicate a sleeping orchestrator.
- `adws/core/agentTimeouts.ts`, `adws/agents/claudeAgent.ts` (line 200) — read-only: the watchdog lives inside the agent run; `RateLimitError` is thrown after it is cleared, so the wait never overlaps a watchdog.
- `adws/triggers/pauseQueueDecider.ts`, `adws/core/resumePolicy.ts` — read-only precedents for a pure decider: decision table in the header, `readonly` discriminated union, bounds as parameters with defaults, no I/O.
- `adws/triggers/pauseQueueScanner.ts` (`PauseQueueScanDeps`, lines 252 to 262) — read-only precedent for an optional trailing deps object with a clock.
- `adws/core/__tests__/heartbeat.test.ts` — read-only precedent: `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync`.
- `adws/core/__tests__/fixtures/rateLimitIncident.ts` — read-only: `INCIDENT_RESETS_AT = 1790081400` (`2026-09-22T12:50:00.000Z`), `INCIDENT_RATE_LIMIT_TYPE = 'five_hour'`; reuse in every new test.
- `features/per-issue/step_definitions/feature-910.steps.ts` — read-only: `drivePausePath` (lines 99 to 137) drives the real `runPhase` with a `process.exit` sentinel; the same pattern serves this issue's enqueue-branch scenarios. It calls `runPhase` with four arguments, which must keep compiling.
- `features/regression/smoke/pause_resume_rate_limit.feature` — the smoke scenario that must stay green. Its orchestrator step is currently `pending` in `features/regression/step_definitions/whenSteps.ts` (line 58); this feature changes nothing it drives, and its Given/Then steps are not touched.
- `specs/prd/rate-limit-indefinite-retry.md` — sections "Wait policy" and "Testing Decisions", user stories 1 to 6, 22 to 25, 32, 34 and 35 are the contract.
- `README.md` — tree lines to update: 543 (core tests), 612 (`phaseRunner.ts`), 664 (`workflowCommentsIssue.ts`), 774 (`workflowCompletion.ts`), plus new lines for the policy module and its test; one sentence in "Rate limit and token limit detection" (lines 119 to 123). The worktree already carries an uncommitted README tree edit from the previous slices; keep it and extend it.
- `adws/known_issues.md` — `rate-limit-crash` solution paragraph (line 42): add the in-process wait.

Conditional documentation matched for this task (read before implementing; update where the text becomes false):

- `app_docs/feature-9gjajh-claude-stream-parser.md` — owns `phaseRunner.ts` and its test (`.adw/conditional_docs.md` lines 480 to 489). Its "Phase runner" bullet and the `runPhase` contract line describe the pre-wait runner; rewrite them and register the two new files under its `Owns:` list.
- `app_docs/feature-9gjajh-workflow-lifecycle-phases.md` — owns `workflowCompletion.ts` and its test; the `handleRateLimitPause` bullet gains the reason text.
- `app_docs/feature-9gjajh-github-api.md` — owns `adws/forge/**` (glob; no index change needed); add the new formatter to its comment-formatting responsibilities.
- `app_docs/feature-9gjajh-coordination-kernel.md` — owns the heartbeat and the hung detector; add one contract line: an in-process rate-limit wait is a timer-based sleep, so the heartbeat keeps ticking and the detector never sees it.
- `app_docs/feature-9gjajh-takeover-and-coordination.md` — owns the takeover handler, the pause queue scanner and the retry handler; add that a five-hour limit no longer reaches the queue, that `## Retry` during a wait is the existing active-stage no-op, and that a host dying mid-wait is branch 8.
- `app_docs/feature-9gjajh-pause-and-auth-queues.md` — owns `pauseQueue.ts`; one sentence: the queue now receives only the limits the wait policy does not keep in-process.

### New Files

- `adws/core/rateLimitWaitPolicy.ts` — the pure policy: `RateLimitType` enum (`FiveHour = 'five_hour'`, `SevenDay = 'seven_day'`), `MIN_RATE_LIMIT_WAIT_MS`, `MAX_IN_PROCESS_WAIT_MS`, `MAX_SLEEP_SLICE_MS`, `RateLimitWaitBounds`, `RateLimitWaitDecision`, `WaitClock`, `decideRateLimitWait`, `sleepUntil`. Imports only `type { RateLimitFacts }` from `../types/agentTypes`.
- `adws/core/__tests__/rateLimitWaitPolicy.test.ts` — mock-free unit tests over the decision table, the bounds and `sleepUntil` with a virtual clock.

## Implementation Plan

### Phase 1: Foundation
Write the pure policy module and its exhaustive tests first: the decision table over limit type, presence of a reset time and clock position, the floor and ceiling as parameters, `sleepUntil` over an injected clock. Add the pure comment formatter and the pure paused-reason helper with their tests. None of this touches the runner, so the type check and the unit suite stay green throughout.

### Phase 2: Core Implementation
Turn `runPhase` into a loop over attempts with an injected clock and comment seam: a wait decision posts the comment, sleeps, re-runs; an enqueue decision follows today's path unchanged. Apply the same loop to `runPhasesParallel` (letting siblings settle before the sleep) and thread `deps` through `runPhasesSequential`. Keep every existing call site compiling with the new optional parameter.

### Phase 3: Integration
Extend the runner suite (the three-rejection journey with a fake-timer clock and the real heartbeat, the enqueue-after-wait case, the seven-day and no-facts cases, the seam defaults, the parallel group), fix the one existing test whose input now waits, verify the #910/#908/#902 step definitions still compile against the widened signature, update the owning living docs, the docs index, the README and `known_issues.md`, and run the full validation list.

## Step by Step Tasks
Execute every step in order, top to bottom.

### 1. Confirm the base
- The branch is level with `origin/dev` (`git rev-list --left-right --count HEAD...origin/dev` prints `0 0`); #907, #908 and #910 are all merged. No merge is needed.
- `README.md` already has an uncommitted tree edit in this worktree (test-file entries from the earlier slices). Keep it; step 8 extends it.
- Run `bun run test` and `bun run test:unit` once before changing anything so a pre-existing failure is not attributed to this feature.

### 2. Write the pure policy in `adws/core/rateLimitWaitPolicy.ts`
- Header comment: the decision table from the Solution Statement, and the two reasons that are not obvious from the code (why a past reset time gets a floor, why a far-future "five-hour" reset is not believed in-process). No issue numbers.
- Exports:
  - `export enum RateLimitType { FiveHour = 'five_hour', SevenDay = 'seven_day' }` (the CLI's undocumented values; the policy only compares against `FiveHour`, `SevenDay` exists so tests and docs name it without a literal).
  - `export const MIN_RATE_LIMIT_WAIT_MS = 60_000;` `export const MAX_IN_PROCESS_WAIT_MS = 6 * 60 * 60 * 1000;` `export const MAX_SLEEP_SLICE_MS = 60_000;`
  - `export interface RateLimitWaitBounds { readonly minWaitMs: number; readonly maxWaitMs: number }` and `export const DEFAULT_RATE_LIMIT_WAIT_BOUNDS: RateLimitWaitBounds`.
  - `export type RateLimitWaitDecision = | { readonly kind: 'wait_in_process'; readonly until: Date } | { readonly kind: 'enqueue'; readonly resetsAt?: number };` (`resetsAt` stays in epoch seconds, exactly as the facts carry it; the queue converts it, as it does today).
  - `export interface WaitClock { now(): Date; sleep(ms: number): Promise<void> }` with one invariant comment: `sleep` must be timer-based and must never block the event loop, because the orchestrator's heartbeat interval has to keep firing through it.
  - `export function hasResetTime(facts: RateLimitFacts): facts is RateLimitFacts & { resetsAt: number }` (finite-number guard, the same predicate `buildPausedWorkflowEntry` uses).
  - `export function decideRateLimitWait(facts: RateLimitFacts, now: Date, bounds: RateLimitWaitBounds = DEFAULT_RATE_LIMIT_WAIT_BOUNDS): RateLimitWaitDecision` implementing the table: guard clauses, no nesting deeper than two. The reset instant is `new Date(facts.resetsAt * 1000)`; `until` is the later of that instant and `now + minWaitMs`; a reset instant later than `now + maxWaitMs` enqueues carrying `resetsAt`. Absent facts are absent keys on the `enqueue` decision (spread idiom, never `resetsAt: undefined`).
  - `export async function sleepUntil(clock: WaitClock, until: Date, maxSliceMs: number = MAX_SLEEP_SLICE_MS): Promise<void>` — loop: while `until - clock.now()` is positive, `await clock.sleep(min(remaining, max(1, maxSliceMs)))`. Re-reading the clock between slices is what notices a suspended host or a clock jump; say so in one comment.
- The module imports only `type { RateLimitFacts }`. No `../core`, no `process.env`, no `new Date()` without an argument, no `setTimeout`, no logging.

### 3. Unit-test the policy in `adws/core/__tests__/rateLimitWaitPolicy.test.ts`
- Mock-free. Reuse `INCIDENT_RESETS_AT` / `INCIDENT_RATE_LIMIT_TYPE`; pin `NOW = new Date('2026-09-22T11:57:00Z')` (the incident's pause time, 53 minutes before the reset).
- `decideRateLimitWait`:
  - `five_hour` + `INCIDENT_RESETS_AT` at `NOW` → `{ kind: 'wait_in_process', until: 2026-09-22T12:50:00.000Z }`.
  - `five_hour` + a reset time one second in the past → `wait_in_process` with `until = NOW + MIN_RATE_LIMIT_WAIT_MS`; the same for a reset time exactly at `NOW` and for one 10 s ahead (the floor wins whenever the reset is closer than the floor).
  - `five_hour` + a reset time `MAX_IN_PROCESS_WAIT_MS + 1 ms` ahead → `{ kind: 'enqueue', resetsAt }`; exactly `MAX_IN_PROCESS_WAIT_MS` ahead still waits (the bound is inclusive on the wait side; pin whichever the implementation chooses and state it in the test name).
  - `five_hour` without `resetsAt` → `{ kind: 'enqueue' }` with no `resetsAt` key (`not.toHaveProperty('resetsAt')`).
  - `five_hour` with `resetsAt: NaN` / `Infinity` → bare `enqueue`.
  - `seven_day` + `resetsAt` → `{ kind: 'enqueue', resetsAt: INCIDENT_RESETS_AT }` (a distant reset time is fine here: the queue owns it).
  - unknown type (`'weekly'`) + `resetsAt` → `enqueue` carrying `resetsAt`; unknown type without → bare `enqueue`.
  - no facts (`{}`) → bare `enqueue`.
  - a `new RateLimitError('build', { rateLimitType: 'five_hour', resetsAt: INCIDENT_RESETS_AT })` passed directly as the facts → `wait_in_process` (structural typing pinned).
  - custom bounds are honoured (`{ minWaitMs: 5_000, maxWaitMs: 60_000 }`).
  - purity: identical inputs give equal decisions, and the input objects are unchanged.
- `sleepUntil` with a virtual clock (`let t = NOW.getTime(); const clock = { now: () => new Date(t), sleep: async (ms) => { t += ms; calls.push(ms) } }`):
  - 3 h 20 min ahead with a 60 s slice → 200 sleeps of 60 000 ms and the clock ends exactly at `until`.
  - a remaining time smaller than the slice → one sleep of exactly the remainder.
  - `until` already past → zero sleeps.
  - a clock that jumps past `until` during the first sleep (the fake adds an hour) → exactly one sleep.
  - `maxSliceMs: 0` does not loop forever (clamped to 1 ms; test with a 3 ms wait → 3 sleeps).

### 4. Add the pure comment formatter and the paused-reason helper
- In `adws/forge/workflowCommentsIssue.ts`, after `formatHumanGatedComment`:
  ```ts
  export interface RateLimitWaitCommentInput {
    readonly adwId: string;
    readonly phaseName: string;
    readonly rateLimitType?: string;
    readonly until: Date;
    readonly attempt: number;
  }
  export function formatRateLimitWaitComment(input: RateLimitWaitCommentInput): string
  ```
  Body, joined with `\n` and terminated by `ADW_SIGNATURE` exactly like `formatHumanGatedComment`:
  - `## :hourglass_flowing_sand: ADW Waiting for Rate Limit Reset`
  - blank line
  - ``The `<phaseName>` phase was rejected by a `<rateLimitType>` rate limit. The orchestrator stays alive, holds its worktree and lock, and will re-run the phase once the limit resets.`` (when `rateLimitType` is absent: "by a rate limit").
  - blank line
  - ``**Waiting until:** `<until.toISOString()>` (UTC)``
  - `**Attempt:** <attempt>`
  - blank line
  - ``**ADW ID:** `<adwId>` ``
  - Do not add the heading to `STAGE_HEADER_MAP`; do not add a `WorkflowStage` literal; do not route through `formatWorkflowComment`.
- In `adws/forge/__tests__/workflowCommentsIssue.test.ts` add a `describe('formatRateLimitWaitComment')`: contains the heading; contains `until.toISOString()` and `(UTC)`; contains `**Attempt:** 3` for attempt 3; names the phase and the limit type; falls back to "a rate limit" without a type; keeps the ADW ID footer and `<!-- adw-bot -->`; `parseWorkflowStageFromComment(body)` (import from `../../core/workflowCommentParsing`) returns `null`, and `isAdwComment(body)` returns `true`.
- In `adws/phases/workflowCompletion.ts` add, next to `buildPausedWorkflowEntry`:
  ```ts
  export function describeRateLimitPauseReason(facts: RateLimitFacts): string
  ```
  - no type, no reset time → `'Rate limit or API outage detected'` (today's text, byte-identical);
  - type only → ``'`seven_day` rate limit detected (no reset time reported)'``;
  - type and reset time → ``'`seven_day` rate limit detected — resets at 2026-09-29T12:50:00.000Z (UTC)'`` using `resetsAtIsoFromEpochSeconds` (already imported);
  - reset time only → `'Rate limit detected — resets at <iso> (UTC)'`.
  In `handleRateLimitPause` replace the ternary at lines 135 to 137 with `ctx.pauseReason = pauseReason === 'rate_limited' ? describeRateLimitPauseReason(facts) : 'Unknown API error';`. Nothing else in the function changes.
- In `adws/phases/__tests__/workflowCompletion.test.ts` add a `describe('describeRateLimitPauseReason')` with the four cases above, reusing the incident fixture for the reset time (`2026-09-22T12:50:00.000Z`).

### 5. Add the wait loop to `adws/core/phaseRunner.ts`
- Imports: `decideRateLimitWait`, `sleepUntil`, `type WaitClock` from `./rateLimitWaitPolicy`. Keep the lazy import of `handleRateLimitPause` / `handlePhaseTimeout` exactly as it is. Import the formatter lazily inside the wait helper (`const { formatRateLimitWaitComment } = await import('../forge/workflowCommentsIssue');`) with the same one-line reason the existing lazy imports carry: the forge module imports `../core`, which re-exports this file.
- New exports:
  ```ts
  export type PostIssueComment = (issueNumber: number, body: string) => void;
  export interface PhaseRunnerDeps {
    readonly clock?: WaitClock;
    readonly postComment?: PostIssueComment;
  }
  export const systemClock: WaitClock = {
    now: () => new Date(),
    sleep: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
  };
  ```
- Private helpers (each small, flat, named for its intent):
  - `resolvePhaseRunnerDeps(config, deps)` → `{ clock, postComment }` with the defaults. The default poster: no `config.repoContext` → no-op; otherwise `config.repoContext.issueTracker.commentOnIssue(issueNumber, body)` inside `try/catch`, logging the failure at `error` level the way `postIssueStageComment` does. The port is synchronous (`commentOnIssue(...): void`), so no promise handling is needed.
  - `isPhaseAlreadyCompleted(config, phaseName)` — the skip logic now at lines 77 to 93, unchanged in behaviour.
  - `markPhaseRunning`, `markPhaseCompleted`, `markPhaseFailed` — the three top-level state writes as they are today.
  - `completePhaseAttempt(config, tracker, fn, phaseName, startedAt)` — `fn(config)`, accumulate, persist, commit, completed write, `recordCompletedPhase`; returns the result.
  - `failPhase(config, tracker, err, phaseName, startedAt)` — today's `catch` body verbatim (timeout handling, failed write, `handleRateLimitPause(config, err.phaseName, 'rate_limited', tracker.totalCostUsd, tracker.totalModelUsage, err)` for a `RateLimitError`), ending by rethrowing `err`.
  - `waitForRateLimitReset(config, phaseName, err, until, attempt, deps)` — builds the comment (`phaseName`, `err.rateLimitType`, `until`, `attempt`), `deps.postComment(config.issueNumber, body)`, `AgentStateManager.appendLog(config.orchestratorStatePath, ...)`, `log(..., 'warn')` naming the phase, the limit type, the UTC wait-until time and the attempt; `await sleepUntil(deps.clock, until)`; `log(..., 'info')` that the reset time has been reached and the phase re-runs.
  - `decideOnPhaseError(err, now)` → the policy's decision for a `RateLimitError`, `null` for anything else.
- `runPhase(config, tracker, fn, phaseName?, deps: PhaseRunnerDeps = {})`:
  ```ts
  if (isPhaseAlreadyCompleted(config, phaseName)) return skippedResult<R>();
  const startedAt = new Date().toISOString();
  markPhaseRunning(config, phaseName, startedAt);
  const runnerDeps = resolvePhaseRunnerDeps(config, deps);
  for (let attempt = 1; ; attempt++) {
    try {
      return await completePhaseAttempt(config, tracker, fn, phaseName, startedAt);
    } catch (err) {
      const decision = decideOnPhaseError(err, runnerDeps.clock.now());
      if (decision?.kind !== 'wait_in_process') await failPhase(config, tracker, err, phaseName, startedAt);
      await waitForRateLimitReset(config, phaseName ?? (err as RateLimitError).phaseName, err as RateLimitError, decision.until, attempt, runnerDeps);
    }
  }
  ```
  (`failPhase` always throws, so the wait line is only reached on a wait decision; write it so `tsc` sees that, for example by having `failPhase` return `never`.) The `${phaseName}_running` write happens once, before the loop; a waited attempt writes nothing to the top-level state and never marks the phase `failed`.
- `runPhasesSequential(config, tracker, fns, deps: PhaseRunnerDeps = {})` passes `deps` to every `runPhase` call.
- `runPhasesParallel(config, tracker, fns, deps: PhaseRunnerDeps = {})`: the same loop around the group. Keep `const promises = fns.map(fn => fn(config))` and `await Promise.all(promises)`; on a wait decision, `await Promise.allSettled(promises)` before sleeping so an in-flight sibling agent has finished before the group is re-run (one comment says why), then `waitForRateLimitReset(config, err.phaseName, err, decision.until, attempt, runnerDeps)` and re-run the whole group. On `enqueue`, today's lines 183 to 186 apply unchanged (`handleRateLimitPause` with the error as the facts, then rethrow). Re-running the whole group after a wait matches what a queue resume does today, since these phases run without a `phaseName` and are never skipped on resume.
- Neither this file nor the policy module may call `process.exit`; exits stay in `workflowCompletion.ts`.
- `adws/core/index.ts`: extend lines 190 to 191 with `PhaseRunnerDeps`, `PostIssueComment` (types) and `systemClock`; add `export type { RateLimitWaitDecision, RateLimitWaitBounds, WaitClock } from './rateLimitWaitPolicy';` and `export { RateLimitType, MIN_RATE_LIMIT_WAIT_MS, MAX_IN_PROCESS_WAIT_MS, MAX_SLEEP_SLICE_MS, DEFAULT_RATE_LIMIT_WAIT_BOUNDS, decideRateLimitWait, hasResetTime, sleepUntil } from './rateLimitWaitPolicy';`.
- Every existing caller (`adws/adw*.tsx`, `adws/phases/scenarioTestFixLoop.ts`, `features/per-issue/step_definitions/feature-910.steps.ts`) keeps compiling: the new parameter is optional and trailing.

### 6. Extend `adws/core/__tests__/phaseRunner.test.ts`
- Keep the existing mocks. Add `vi.useFakeTimers()` in the `beforeEach` of a new `describe('runPhase() — in-process rate-limit wait')` and `vi.useRealTimers()` in its `afterEach`. Import `startHeartbeat`/`stopHeartbeat` from `../heartbeat` (it writes through the mocked `AgentStateManager.writeTopLevelState`, so its ticks show up on `writeTopLevelStateMock`).
- Test clock and seam:
  ```ts
  const fakeClock: WaitClock = {
    now: () => new Date(),                                        // fake timers control Date
    sleep: (ms) => vi.advanceTimersByTimeAsync(ms).then(() => undefined),
  };
  const posted: Array<{ issueNumber: number; body: string }> = [];
  const postComment = (issueNumber: number, body: string) => { posted.push({ issueNumber, body }); };
  ```
  (Verified: driving `advanceTimersByTimeAsync` from inside the awaited chain works, and a `setInterval` heartbeat ticks during it.)
- Pin the clock at `2026-09-22T11:57:00Z` with `vi.setSystemTime`; use reset times `INCIDENT_RESETS_AT`, `+ 3600`, `+ 7200` for three consecutive rejections.
- Cases:
  - **Three waits then success:** `phaseFn` rejects with a `five_hour` `RateLimitError` three times (increasing reset times) then resolves `{ costUsd: 0.05, modelUsage: {}, phaseCostRecords: [] }`; run `runPhase(config, tracker, phaseFn, 'build', { clock: fakeClock, postComment })` with a real `startHeartbeat(config.adwId, 30_000)` running. Assert: `phaseFn` called 4 times; the result is returned and `tracker.totalCostUsd` is 0.05 (accumulated once); `mockHandleRateLimitPause` never called; `posted.length === 3`, each body contains the matching `until.toISOString()`, `(UTC)` and `**Attempt:** 1|2|3` in order, all on `config.issueNumber`; `Date.now()` after the run is at or past the third reset time.
  - **Stage unchanged, heartbeat alive:** in the same journey, every `writeTopLevelStateMock` call between the `build_running` write and the `build_completed` write carries no `workflowStage`, and the `phases.build.status` values written are only `running` then `completed` (never `failed`); at least one call during the waits carries `lastSeenAt`, and the `lastSeenAt` values are strictly increasing.
  - **Enqueue after a prior wait:** first rejection `five_hour` + reset time (waits), second rejection `five_hour` with no reset time → `mockHandleRateLimitPause` called once with the second error as the sixth argument, `phases.build.status: 'failed'` written, the error rethrown, exactly one comment posted.
  - **Seven-day with a reset time enqueues immediately:** no comment, no sleep (assert `Date.now()` unchanged), `handleRateLimitPause` called with the error.
  - **No facts enqueues immediately** (the existing "sixth argument" test already covers this; keep it).
  - **Far-future five-hour reset enqueues:** reset time 7 h ahead → `handleRateLimitPause`, no comment.
  - **Default seam:** no `deps.postComment`; `makeConfig({ repoContext: { issueTracker: { commentOnIssue: recorder } } })` → the recorder receives the body; a `commentOnIssue` that throws is swallowed and the wait still completes; no `repoContext` at all → no throw.
  - **Parallel group:** `runPhasesParallel(config, tracker, [rejectingFn, siblingFn], { clock: fakeClock, postComment })` where `rejectingFn` rejects `five_hour` twice then resolves and `siblingFn` resolves (record call order); both called 3 times; merged cost accumulated once; two comments; the first sleep starts only after the sibling settled (record a timestamp or a sequence counter inside `siblingFn` and inside `fakeClock.sleep`).
  - **Sequential passes deps:** `runPhasesSequential` with a second fn that rejects once then resolves waits and re-runs.
- Change the existing test at lines 128 to 140 ("passes a RateLimitError carrying reset facts through to handleRateLimitPause unchanged") to throw `seven_day` + `INCIDENT_RESETS_AT` and expect the sixth argument `toMatchObject({ rateLimitType: 'seven_day', resetsAt: INCIDENT_RESETS_AT })`. Its intent (facts pass through unchanged) is preserved; `five_hour` with a reset time now waits by design.

### 7. Verify the step definitions and the smoke scenario still hold
- `bun run test` (type-check) covers `features/per-issue/step_definitions/feature-910.steps.ts`'s four-argument `runPhase` call.
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-910"`: its pause-path rows drive the real `runPhase` with a `seven_day` limit plus a reset time (`features/per-issue/feature-910.feature` lines 212 and 402), a `five_hour` limit with no reset time (line 221) and no facts at all (line 229). Every one of those still enqueues under the new policy, so no `@adw-910` row changes and that feature file is not amended. (A `five_hour` limit with a reset time is the only input this feature reverses, and no existing scenario drives the pause path with it.)
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression and @smoke"`: `pause_resume_rate_limit.feature` must report exactly what it reported in step 1.

### 8. Update the living docs, the docs index, the README and known issues
- `app_docs/feature-9gjajh-claude-stream-parser.md`: rewrite the "Phase runner" responsibility bullet (loop over attempts, `PhaseRunnerDeps`, wait vs enqueue, comment, no exit on the wait path) and add contract lines: a waited attempt never marks the phase `failed` and never changes `workflowStage`; the decision is `decideRateLimitWait` over the error's facts and the injected clock; `runPhasesParallel` lets siblings settle before sleeping and re-runs the group. Add the policy module and its test to its `Owns:` list in `.adw/conditional_docs.md` (lines 481 to 489) and to its Conditions.
- `app_docs/feature-9gjajh-workflow-lifecycle-phases.md`: the `handleRateLimitPause` bullet gains `describeRateLimitPauseReason`.
- `app_docs/feature-9gjajh-github-api.md`: name `formatRateLimitWaitComment` among the comment formatters and state that its heading is deliberately absent from `STAGE_HEADER_MAP`.
- `app_docs/feature-9gjajh-coordination-kernel.md`: one contract line about the heartbeat through an in-process wait.
- `app_docs/feature-9gjajh-takeover-and-coordination.md`: the three sentences listed under Relevant Files.
- `app_docs/feature-9gjajh-pause-and-auth-queues.md`: one sentence.
- `README.md`: tree lines for `rateLimitWaitPolicy.ts` (after line 612's neighbours, alphabetical) and `rateLimitWaitPolicy.test.ts` (near 543/557), refresh the `phaseRunner.ts` (612), `workflowCommentsIssue.ts` (664) and `workflowCompletion.ts` (774) descriptions, and add one sentence to "Rate limit and token limit detection" (lines 119 to 123): a five-hour limit with a known reset time is now ridden out in-process by the phase runner; everything else still goes through the queue.
- `adws/known_issues.md` line 42 (`rate-limit-crash`, solution): append that since this change a `five_hour` limit with a reset time is waited out in-process by `runPhase` (comment per wait, `sleepUntil` through an injected clock, stage unchanged, heartbeat alive) and only other limits reach the queue.
- Run `bun run lint:docs-index` to confirm the index is clean after the `Owns:` edits.

### 9. Run the validation commands
- Execute every command under Validation Commands; all must pass with zero regressions.

## Testing Strategy

### Unit Tests
Vitest (`bun run test:unit`, include `adws/**/__tests__/**/*.test.ts`). Following the PRD's testing decision, the pure modules get exhaustive tests and the shell gets behavioural tests at its injected seams. Every test observes an external behaviour: the decision the policy returns, the number and timing of sleeps a clock records, the comments a seam records, the state writes the (mocked) state manager receives, the object the pause path builds. No test asserts which internal function was called and none reads source text.

- `adws/core/__tests__/rateLimitWaitPolicy.test.ts` — new, mock-free: the full decision table (limit type × reset time presence × clock position), the floor and the ceiling, non-finite reset times, `RateLimitError` as a structural input, custom bounds, purity; `sleepUntil` slicing, zero-wait, clock jump, clamped slice.
- `adws/core/__tests__/phaseRunner.test.ts` — extended: three consecutive five-hour rejections then success through a fake-timer clock with the real heartbeat running; comment per wait with the UTC time and attempt number at the injected seam; stage unchanged and `lastSeenAt` advancing; enqueue after a prior wait; seven-day, no-facts and far-future cases go straight to `handleRateLimitPause`; default seam over `repoContext.issueTracker`; parallel group waits and re-runs after siblings settle; sequential threads deps; the one amended existing test.
- `adws/forge/__tests__/workflowCommentsIssue.test.ts` — extended: the wait comment's content, footer, signature, and that it maps to no lifecycle stage.
- `adws/phases/__tests__/workflowCompletion.test.ts` — extended: `describeRateLimitPauseReason` over the four fact shapes, with today's text unchanged when nothing is known.

Notes for the per-issue BDD scenarios (`features/per-issue/feature-912.feature`, written by the scenario phase; step definitions by the step-definition phase):
- Drive the real `runPhase` in-process, never a real orchestrator subprocess and never the real Claude CLI. Inject a `WaitClock` whose `sleep` advances a pinned instant by the requested milliseconds and also yields for a few real milliseconds (`setTimeout(…, 5)`), so a real `startHeartbeat(adwId, 10)` started by the step writes `lastSeenAt` into the real top-level state file under `AGENTS_STATE_DIR` during the wait. Inject `postComment` as a recording seam; assert the recorded bodies contain the UTC wait-until time and the attempt number.
- For the enqueue branch reuse the `process.exit` sentinel pattern of `feature-910.steps.ts`'s `drivePausePath` (lines 99 to 137); the queue entry and the `paused` stage are then real artefacts, and the paused comment's reason can be asserted through a recording `repoContext.issueTracker`.
- Observe the top-level state through `AgentStateManager.readTopLevelState` (a state artefact, not a source file): `workflowStage` equals `${phase}_running` after every wait and `${phase}_completed` at the end; `lastSeenAt` is later after the wait than before it.
- The regression smoke scenario is not modified; it is run as a guard.

### Edge Cases
- A `five_hour` reset time already in the past, exactly `now`, or closer than the floor: waits `MIN_RATE_LIMIT_WAIT_MS` from `now`, then re-runs. A CLI that keeps reporting the same stale reset time therefore re-runs once a minute at most, and each re-run posts one comment.
- A `five_hour` reset time further ahead than `MAX_IN_PROCESS_WAIT_MS`: enqueued with the reset time; the scanner waits for it without holding a process.
- `resetsAt` `NaN`, `Infinity` or absent with `five_hour`: enqueue, bare entry, cadence probe path (today's behaviour).
- `seven_day` with a reset time at any distance: enqueue carrying the reset time.
- A second rejection after a wait with a different decision (no reset time, `seven_day`, far future): the enqueue path runs exactly as if no wait had happened; the attempt counter is not persisted anywhere.
- A `RateLimitError` from a phase run without a `phaseName` (most `runPhase` calls in the orchestrators): no top-level stage write happens in the runner at all; the comment names `err.phaseName` (the agent name); the stage the phase itself wrote (for example `build_running`) is left alone.
- A wait comment that cannot be posted (no `repoContext`, or `commentOnIssue` throws): logged, the wait proceeds, the phase still re-runs.
- The host is suspended or its clock jumps during a wait: `sleepUntil` re-reads the clock after every slice (at most `MAX_SLEEP_SLICE_MS`), so the loop ends as soon as the clock is past `until` and never sleeps for the whole original span again.
- The process dies during a wait (reboot, `kill`): the stage is still `*_running` with a dead PID; takeover branch 8 resets the worktree, reconciles the remote stage and takes over on the next cron tick.
- `## Retry` posted during a wait: `decideRetryAction` returns `noop` for an active stage; nothing is spawned. `## Cancel` behaves exactly as today (scorched-earth cleanup of the live process).
- A parallel group where the sibling is still running when the first rejection arrives: the runner awaits `Promise.allSettled` before sleeping, so no agent process is alive during the wait; the sibling's result is discarded and it re-runs with the group (the same as after a queue resume today). A sibling that rejects with a non-rate-limit error is surfaced by the `Promise.all` rejection exactly as today.
- The rejected attempt's own cost: not accumulated (the phase function threw before returning a `PhaseResult`), the same as the pause path today.
- `runPhase` with a phase already `completed` in the top-level phases map: skipped before any of this runs, unchanged.
- An orchestrator not wrapped in `runWithOrchestratorLifecycle` (none in the tree today): the wait still works; only the heartbeat guarantee depends on the wrapper.

## Acceptance Criteria
- `adws/core/rateLimitWaitPolicy.ts` exists, imports only `type { RateLimitFacts }`, and its unit tests cover: `five_hour` + `resetsAt` → `wait_in_process` with `until` equal to the reset instant; `five_hour` without `resetsAt` → `enqueue` with no `resetsAt` key; `seven_day` + `resetsAt` → `enqueue` carrying `resetsAt`; unknown type → `enqueue`; no facts → `enqueue`; past/imminent reset → the floor; far-future five-hour reset → `enqueue`; `sleepUntil` over a virtual clock.
- `runPhase`, driven through an injected clock in a unit test, waits and re-runs the phase across three consecutive five-hour rejections and returns the phase result when the fourth attempt succeeds, accumulating cost once and never calling `handleRateLimitPause`.
- Each wait posts exactly one comment through the injected `postComment` seam, and each body contains the wait-until time as an ISO 8601 UTC timestamp and `**Attempt:** N` for the Nth wait.
- Across the waits no `workflowStage` is written and the phase is never marked `failed`; the real heartbeat's `lastSeenAt` writes are observed during the waits with strictly increasing values.
- A rejection with no reset time (or `seven_day`) after a prior in-process wait takes the enqueue path: the phase is marked `failed` and `handleRateLimitPause` receives that error as the sixth argument.
- `runPhasesParallel` waits and re-runs the whole group, letting in-flight siblings settle before sleeping; `runPhasesSequential` threads `deps`.
- The default comment poster uses `config.repoContext.issueTracker.commentOnIssue`, is a no-op without a `repoContext`, and never throws.
- `formatRateLimitWaitComment`'s heading maps to no stage in `parseWorkflowStageFromComment`, and the body carries the ADW ID footer and `ADW_SIGNATURE`.
- The paused comment's reason names the limit type and the reset time (UTC) when the error carried them, and is byte-identical to today's text when it carried nothing.
- Every existing `runPhase`/`runPhasesParallel`/`runPhasesSequential` call site compiles unchanged; `features/per-issue/step_definitions/feature-910.steps.ts` compiles and the `@adw-910`, `@adw-908` and `@adw-902` scenarios pass.
- `features/regression/smoke/pause_resume_rate_limit.feature` reports the same result as before the change.
- `bun run test`, `bunx tsc --noEmit -p adws/tsconfig.json`, `bun run test:unit`, `bun run lint`, `bun run lint:git-guard` and `bun run lint:docs-index` pass; the owning app docs, `.adw/conditional_docs.md`, the README tree lines and `adws/known_issues.md` are updated.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run test` — TypeScript type-check of the whole repo, including `features/**` step definitions (the four-argument `runPhase` call in `feature-910.steps.ts`).
- `bunx tsc --noEmit -p adws/tsconfig.json` — additional type check for the `adws/` project.
- `bun run test:unit` — the full vitest suite.
- `bunx vitest run adws/core/__tests__/rateLimitWaitPolicy.test.ts adws/core/__tests__/phaseRunner.test.ts adws/phases/__tests__/workflowCompletion.test.ts adws/forge/__tests__/workflowCommentsIssue.test.ts` — the four suites this feature owns, in isolation.
- `bun run lint` — ESLint (no unused imports after extracting the runner helpers; no `any`).
- `bun run lint:git-guard` — git/gh guard (the policy and the runner add no shell-outs, no cwd-derived identity and no unsanctioned construction).
- `bun run lint:docs-index` — living-docs index gate after the `.adw/conditional_docs.md` edits.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression and @smoke"` — the pause/resume smoke scenario and its siblings stay as they were.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — the whole regression suite.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-910 or @adw-908 or @adw-902"` — the scenarios that drive `runPhase`'s enqueue path and the pause queue over the real queue file.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-912"` — this issue's scenarios, once the step-definition phase has defined their phrases.
- `grep -c "from '../core'\|process.env\|new Date()\|setTimeout\|process.exit" adws/core/rateLimitWaitPolicy.ts` — must print `0` (the policy stays pure).
- `grep -c "process.exit" adws/core/phaseRunner.ts` — must print `0` (the runner never exits; exits stay in `workflowCompletion.ts`).
- `grep -c "hourglass_flowing_sand" adws/core/workflowCommentParsing.ts` — must print `0` (the wait heading is not a lifecycle stage).

## Notes
- If `.adw/coding_guidelines.md` exists in the target repository (or `guidelines/coding_guidelines.md` as a fallback), strictly adhere to those coding guidelines. If necessary, refactor existing code to meet the coding guidelines as part of implementing the feature. Concretely here: the `runPhase` loop must stay flat (guard clauses; the attempt, the failure path and the wait extracted into named functions); `readonly` discriminated unions; bounds as parameters with defaults rather than magic numbers; an enum for the limit-type constants; absent facts are absent keys; comments only for invariants and non-obvious choices (why the floor, why the ceiling, why the lazy import, why siblings settle before the sleep, why the clock is re-read between slices); no issue numbers in code comments; files under 300 lines.
- **Decision — the wait loop lives in `phaseRunner.ts`, the comment body in `forge/workflowCommentsIssue.ts`, the reason text in `workflowCompletion.ts`.** The runner is the shell that owns the I/O (sleep, comment, state, log); the forge module owns every issue comment format; the lifecycle module owns the pause path's context. The formatter is lazy-imported by the runner for the same reason `handleRateLimitPause` is (the forge module imports `../core`, which re-exports the runner). A throwaway probe under the runner test's mocks confirmed the real forge module loads, so the runner tests assert on the real body.
- **Decision — a floor and a ceiling on the in-process wait.** The issue's rule is "five-hour with a reset time → wait in-process". The floor (`MIN_RATE_LIMIT_WAIT_MS`) changes only `until`, never the wait/enqueue split, and exists so a stale reset time cannot turn the loop into a comment-spamming hot loop. The ceiling (`MAX_IN_PROCESS_WAIT_MS`, 6 h, comfortably above any real five-hour window) is the one deliberate refinement: a "five-hour" limit whose reset time is days away is either a unit slip or a bogus value, and holding a worktree, a concurrency slot and the spawn lock for days is exactly what the PRD's user story 6 tells the queue path to prevent. The queue already handles arbitrary reset times without a process. Both are parameters so a unit test pins them; neither reads the environment.
- **Decision — `runPhasesParallel` waits too.** The PRD places the wait "in the phase runner, wrapping the phase function", and the SDLC's plan/scenario stage runs through the parallel runner. Re-running the whole group after a wait is no worse than today's queue resume, which also re-runs both (they run without a `phaseName`, so nothing is skipped). Awaiting `Promise.allSettled` before sleeping is what guarantees "the wait sits between agent spawns" for the group.
- **Decision — the attempt counter is per orchestrator incarnation.** It is not persisted; a takeover after a crash restarts at 1. This matches the repo's accepted per-incarnation residual for the progress gate (`known_issues.md`, `build-progress-gate-design-residuals`).
- **Decision — no new `WorkflowStage`, no heartbeat change.** The wait comment is posted directly (like `formatHumanGatedComment`) and its heading is kept out of `STAGE_HEADER_MAP`, so no stage literal, no `stageClassifier` case and no recovery-parsing change is needed. The runner does not write `lastSeenAt` itself; the heartbeat `runWithOrchestratorLifecycle` already runs is the mechanism, and the runner test proves it survives a wait because the sleep is timer-based.
- **Existing test that must change:** `phaseRunner.test.ts` lines 128 to 140 throw `five_hour` + a reset time and expect the pause path; that input now waits. Switching it to `seven_day` keeps its intent (facts reach `handleRateLimitPause` unchanged).
- **Out of scope, deliberately** (each owned by another PRD slice or explicitly excluded): per-cron ownership of queue entries, removing the queue entry before spawning on resume, the CLI stub's rate-limited response (user story 41), the envelope conformance gate, any `## Retry`/`## Cancel` change, and un-pending the smoke scenario's orchestrator step. The stub is not changed here, so the per-issue scenarios drive `runPhase` in-process with an injected clock rather than through a stubbed orchestrator subprocess.
- `RateLimitFacts.resetsAt` and the `enqueue` decision's `resetsAt` are Unix epoch **seconds**; `wait_in_process.until` is a `Date`; the queue entry's `resetsAt` is ISO 8601 via `resetsAtIsoFromEpochSeconds`. The policy's `new Date(seconds * 1000)` is a representation for the clock comparison, not a second queue conversion.
- No new library is needed; nothing to install (`bun add` not required).
