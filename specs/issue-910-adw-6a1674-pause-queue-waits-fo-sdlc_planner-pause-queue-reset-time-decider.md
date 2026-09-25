# Feature: Pause queue waits for the reported reset time; strikes only for confirmed non-rate-limit failures

## Metadata
issueNumber: `910`
adwId: `6a1674-pause-queue-waits-fo`
issueJson: `{"number":910,"title":"Pause queue waits for the reported reset time; strikes only for confirmed non-rate-limit failures","body":"## Parent PRD\n\n`specs/prd/rate-limit-indefinite-retry.md`\n\n## What to build\n\nMake the pause queue honour the reset time the CLI already reports, and make strike counting apply only to confirmed non-rate-limit probe results. See PRD section \"Pause queue\" and the reset-time parts of \"Wait policy\".\n\nEnd to end: an orchestrator pauses on a limit with a known reset time → the queue entry stores the reset time and limit type → the scanner does not probe that entry before the reset time → the first probe after it is `clear` → the workflow resumes. A `limited` probe never counts a strike and refreshes the entry's reset time when the probe reports one. Only a confirmed non-rate-limit result (including auth failure, per #907) counts toward the existing three-strike budget. Eviction leaves the stage `paused` and the error comment names `## Retry` (implemented in #908) as the recovery.\n\nIntroduce a **pure pause-queue decider**: input is an entry, the probe classification (with optional reset facts), and the clock; output is exactly one action: `skip_before_reset`, `resume`, `refresh_reset`, `count_strike`, or `evict`. (Ownership is added to the same decider in the next slice; leave a seam for the scanning cron's repo identity but do not implement the rule here.) The scanner becomes a thin shell: read entries, run the probe once per scan only if at least one entry is past its reset time (or has none), feed each entry through the decider, execute the action.\n\nEntries written before this change have no reset time or limit type and must load unchanged; they follow the cadence-probe path.\n\n## Acceptance criteria\n\n- [ ] `PausedWorkflow` gains optional `resetsAt` (ISO 8601) and `rateLimitType`; the pause path writes them from `RateLimitError` when present\n- [ ] Decider unit tests: entry before `resetsAt` → `skip_before_reset` regardless of probe; `clear` after reset → `resume`; `limited` with a new `resetsAt` → `refresh_reset`; `limited` without one → no strike, no change; confirmed failure → `count_strike` until the budget, then `evict`\n- [ ] The scanner does not invoke the probe at all when every entry is still before its reset time\n- [ ] A `limited` probe never increments `probeFailures` (extends the #903 tests to the reset-time case)\n- [ ] The eviction error comment names `## Retry` as the recovery\n- [ ] Legacy entries without the new fields load and are handled exactly as before\n- [ ] Scanner tests from #903 remain green through the injected probe seam\n- [ ] `bun run test`, `bun run test:unit`, and `bun run lint:git-guard` pass\n\n## Blocked by\n\n- Blocked by #907\n\n## Touched Files\n\n- adws/core/pauseQueue.ts\n- adws/phases/workflowCompletion.ts\n- adws/triggers/pauseQueueDecider.ts\n- adws/triggers/__tests__/pauseQueueDecider.test.ts\n- adws/triggers/pauseQueueScanner.ts\n- adws/triggers/__tests__/pauseQueueScanner.test.ts\n\n## User stories addressed\n\n- User story 7\n- User story 8\n- User story 9\n- User story 10\n- User story 12\n- User story 42\n","state":"OPEN","author":"paysdoc","labels":["adw:feature"],"createdAt":"2026-09-25T08:25:44Z","comments":[],"actionableComment":null}`

## Feature Description

This is the "Pause queue" slice of `specs/prd/rate-limit-indefinite-retry.md`. It makes the pause queue use the reset time that the Claude CLI already reports and that #907 now threads through `RateLimitError` and the probe classifier, and it moves the scanner's decision logic into a pure module.

Today (`adws/triggers/pauseQueueScanner.ts`) the scanner probes every queued entry on a fixed cadence (`PROBE_INTERVAL_CYCLES`), whatever the entry is waiting for. In the 2026-09-22 incident, issue #840's entry carried a machine-readable reset time of 12:50 UTC in the agent's own output, yet the scanner probed blindly from 11:57, collected three results it could not classify, and evicted the entry at 12:06 — 44 minutes before the limit reset — leaving the workflow in a `paused` stage nothing would ever touch again. The reset time is captured by the parser and carried on `RateLimitError` since #907, but `handleRateLimitPause` (`adws/phases/workflowCompletion.ts`) throws it away when it builds the queue entry, and the probe's own reset facts (`ProbeClassification.resetsAt` / `rateLimitType`) are ignored by the scanner.

After this change:

- `PausedWorkflow` (`adws/core/pauseQueue.ts`) carries an optional `resetsAt` (ISO 8601) and `rateLimitType`. The pause path writes them from the `RateLimitError` when the error carries them. Entries written before this change have neither field, load unchanged, and follow the cadence-probe path exactly as before.
- A new pure decider (`adws/triggers/pauseQueueDecider.ts`) takes an entry, the probe classification, the clock and the strike budget, and returns exactly one action: `skip_before_reset`, `resume`, `refresh_reset`, `count_strike`, or `evict`.
- The scanner becomes a thin shell over the decider: read the entries, run the probe once per scan — and only when at least one entry is past its reset time or has none — feed each entry through the decider, execute the action. Before an entry's reset time it is never probed, never struck, and produces no per-entry log line.
- A `limited` probe never counts a strike; when it reports a reset time the entry's `resetsAt` (and `rateLimitType`) are refreshed so a limit that extends itself keeps being waited for. Only a `failed` (confirmed non-rate-limit, e.g. an expired login) or `unknown` (no structured signal) result consumes the existing three-strike budget (`MAX_UNKNOWN_PROBE_FAILURES`), after which the entry is evicted. Eviction leaves the top-level stage `paused` (the scanner writes no state) and the error comment tells the operator to post `## Retry`, the directive #908 (PR #914, merged on `dev`) made work for `paused` workflows.
- The decider's input is an object and the scanner takes a deps object, so the next slice can add the scanning cron's repo identity (ownership) to both without changing any call site. The ownership rule itself is not implemented here.

Value: a multi-hour limit never strands a workflow, the probe stops burning capacity and strikes during a known limit, and when automation does give up the issue names the one comment that brings the workflow back.

## User Story

As an ADW operator
I want a rate-limited workflow's queue entry to wait for the reset time the CLI reported, to be probed only after it, to have that reset time refreshed whenever a probe confirms the limit is still active, and to be evicted only after repeated results that are confirmed not to be a rate limit — with the eviction comment naming `## Retry`
So that a five-hour or seven-day limit never strands a workflow, the scanner does not burn probes, strikes, or log noise for hours, and recovery from a genuine failure is one GitHub comment away

## Problem Statement

1. **The reset time is thrown away at the queue boundary.** `RateLimitError.resetsAt` / `rateLimitType` (epoch seconds and `five_hour`/`seven_day`, since #907) reach `runPhase`, which calls `handleRateLimitPause(config, err.phaseName, 'rate_limited', cost, usage)` without them. `PausedWorkflow` has no field for them.
2. **The scanner probes blindly.** `scanPauseQueue` runs the probe on every cadence-eligible cycle for every entry, so during a known multi-hour limit it spends probes and, worse, any `unknown` result (a transient CLI crash, a timeout) burns one of only three strikes. That is exactly how #840 was evicted 44 minutes before its reset.
3. **A `limited` probe's reset facts are discarded.** `ProbeClassification` carries `resetsAt`/`rateLimitType` since #907; `applyProbeOutcome` reads only `.verdict` and updates `lastProbeAt`. A limit that extends itself cannot extend the wait.
4. **Decision logic is tangled with I/O.** The verdict → action mapping lives in `applyProbeOutcome`/`recordUnknownProbeFailure`, interleaved with queue writes, log lines and comment posts. There is no way to unit-test "entry before reset, probe says X" without mocking `child_process`, `fs`, the queue and the boundary — and no seam for the ownership rule the next slice needs.
5. **The eviction comment points nowhere useful.** It says "Manual restart required." Since #908, `## Retry` on a `paused` workflow respawns it; the comment must say so.

## Solution Statement

- **Schema:** add `resetsAt?: string` (ISO 8601) and `rateLimitType?: string` to `PausedWorkflow`, plus one pure helper `resetsAtIsoFromEpochSeconds(seconds)` in `adws/core/pauseQueue.ts` — the single conversion from the CLI's epoch seconds to the queue's ISO representation. `readPauseQueue` is untouched: legacy entries load as-is.
- **Pause path:** `handleRateLimitPause` gains a trailing optional `facts: RateLimitFacts = {}` parameter; `runPhase`/`runPhasesParallel` pass the caught `RateLimitError` itself (it is structurally a `RateLimitFacts`). Entry construction is extracted into a pure, exported `buildPausedWorkflowEntry(...)` so the "writes them when present, omits them when absent" rule has a mock-free unit test.
- **Decider:** `adws/triggers/pauseQueueDecider.ts` exports `isBeforeReset(entry, now)`, `decidePauseQueueAction(input)` and the `PauseQueueAction` discriminated union. It imports only types and the ISO helper; no `../core`, no clock, no logging. Decision table (top to bottom):

  | `entry.resetsAt` vs `now`      | `probe.verdict`     | action                                                   |
  |--------------------------------|---------------------|----------------------------------------------------------|
  | parses and is later than `now` | any                 | `skip_before_reset`                                      |
  | absent, unparseable, or past   | `clear`             | `resume`                                                 |
  | absent, unparseable, or past   | `limited`           | `refresh_reset` carrying the probe's facts, if any       |
  | absent, unparseable, or past   | `failed`/`unknown`  | `count_strike` while `failures + 1 < budget`             |
  | absent, unparseable, or past   | `failed`/`unknown`  | `evict` once `failures + 1 >= budget`                    |

  `refresh_reset` is the one action for a confirmed limit. Its optional `resetsAt`/`rateLimitType` are whatever the probe reported (converted to ISO); with no facts the shell writes only `lastProbeAt`. That is the acceptance criterion's "`limited` without one → no strike, no change" — no strike, and no change to the reset time or the limit type.
- **Scanner:** `scanPauseQueue(cycleCount, probe = probeRateLimit, deps: PauseQueueScanDeps = {})` where `PauseQueueScanDeps` is `{ now?: () => Date }`. Keep the cadence gate. Read entries; compute `due = entries.filter(e => !isBeforeReset(e, now))`; if `due` is empty, log one summary line and return **without calling `probe`**; else probe once, then for every entry `executePauseQueueAction(entry, decidePauseQueueAction({ entry, probe: classification, now, maxProbeFailures: MAX_UNKNOWN_PROBE_FAILURES }), now)`. `resumeWorkflow`, `resolveEntryRepoInfo`, `resolveEntryBoundary`, `postEntryStageComment` and `awaitChildReadiness` stay as they are; `applyProbeOutcome` and `recordUnknownProbeFailure` are replaced by the executor.
- **Eviction comment:** keeps the phrase the #902 scenario asserts ("failed to resume after N probe attempts"), states the last verdict, says the workflow stays paused, and names `` `## Retry` `` as the recovery. No top-level state write.
- **Seam for ownership:** object-shaped inputs at both boundaries (`PauseQueueDecisionInput`, `PauseQueueScanDeps`). The next slice adds `scanningRepo` to both and a `skip_not_owner` action. Nothing ownership-related is added now (no unused fields, no dead branches).

## Relevant Files
Use these files to implement the feature:

- `adws/core/pauseQueue.ts` — owns `PausedWorkflow` and the atomic read/append/remove/update primitives over `agents/paused_queue.json`. Gains the two optional fields and `resetsAtIsoFromEpochSeconds`. `readPauseQueue` stays byte-for-byte the same (legacy entries load unchanged).
- `adws/core/index.ts` — line ≈198 re-exports the pause-queue API; add the new helper to that list.
- `adws/phases/workflowCompletion.ts` — `handleRateLimitPause` builds and appends the queue entry (lines ≈94–109). Gains the `facts` parameter and the extracted, exported `buildPausedWorkflowEntry`.
- `adws/core/phaseRunner.ts` — the two `handleRateLimitPause` call sites (`runPhase` line ≈144, `runPhasesParallel` line ≈185) must pass the caught `RateLimitError` as the facts.
- `adws/core/__tests__/phaseRunner.test.ts` — line ≈116 asserts `handleRateLimitPause` was called with exactly five arguments; it must expect the sixth (the error), and gain a case where the error carries facts.
- `adws/types/agentTypes.ts` — read-only: `RateLimitFacts` (`rateLimitType?: string; resetsAt?: number` — epoch **seconds**) and `RateLimitError` (which exposes both as readonly fields, so it satisfies `RateLimitFacts` structurally).
- `adws/triggers/rateLimitProbe.ts` — read-only: `ProbeOutcome` (`clear | limited | failed | unknown`) and `ProbeClassification extends RateLimitFacts`; the decider's probe input type. `probeRateLimit(exec?)` stays the scanner's default probe.
- `adws/triggers/pauseQueueScanner.ts` — becomes the thin shell described above. Currently 241 lines; after removing `applyProbeOutcome`/`recordUnknownProbeFailure` and adding the due-filter and executor it must stay under the 300-line guideline.
- `adws/triggers/__tests__/pauseQueueScanner.test.ts` — the #903 suite that must remain green (its `makeEntry()` has no `resetsAt`, so every existing case is a legacy-path case). Its `vi.mock('../../core/pauseQueue', ...)` replaces the whole module and must be widened with `importOriginal` so the decider's import of `resetsAtIsoFromEpochSeconds` is real; its `AgentStateManager` mock gains `writeTopLevelState: vi.fn()` for the "stage stays paused" assertion. New cases listed in step 7.
- `adws/core/config.ts` / `adws/core/index.ts` — read-only: `PROBE_INTERVAL_CYCLES` (default 15) and `MAX_UNKNOWN_PROBE_FAILURES` (default 3), both env-overridable; the scanner passes the latter into the decider so the decider never reads the environment.
- `adws/core/resumePolicy.ts`, `adws/core/promotionSweepDecider.ts`, `adws/triggers/retryHandler.ts` (`decideRetryAction`, on `origin/dev`) — read-only precedents for a pure decider: a decision table in the header comment, a discriminated `readonly` union, an exhaustive `switch` with a `never` guard, no I/O.
- `adws/core/hungOrchestratorDetector.ts` (`findHungOrchestrators(now, ...)`) and `adws/triggers/promotionSweep.ts` (`PromotionSweepDeps.now?: () => Date`) — read-only precedents for the injected clock: a `Date` into the pure function, a `() => Date` thunk on the shell's deps object.
- `adws/core/__tests__/fixtures/rateLimitIncident.ts` — read-only: `INCIDENT_RESETS_AT = 1790081400` (= `2026-09-22T12:50:00.000Z`) and `INCIDENT_RATE_LIMIT_TYPE = 'five_hour'`; reuse these constants in the decider, scanner and pause-path tests instead of new literals.
- `adws/forge/workflowCommentsIssue.ts` — read-only: `formatErrorComment` renders `ctx.errorMessage` verbatim under "**Error:**", so the `## Retry` advice goes into the message the scanner passes; no new stage or formatter.
- `adws/triggers/trigger_cron.ts` — read-only: `checkAndTrigger` calls `scanPauseQueue(cycleCount)` (line ≈314) with one argument; it keeps compiling because `probe` and `deps` default. It already holds `cronRepoInfo`/`targetRepo` — that is what the ownership slice will pass through `PauseQueueScanDeps`.
- `features/per-issue/step_definitions/feature-902-queue.steps.ts` — drives the real `scanPauseQueue(PROBE_INTERVAL_CYCLES * i, () => probeRateLimit(probeStub.exec))` over the real queue file with legacy-shaped seeded entries (no `resetsAt`). Must keep compiling and passing (the `@adw-902` scenarios are the live legacy-path proof). Its `Before`/`After` hooks are tagged `'@adw-902 or @adw-907'`.
- `features/per-issue/feature-902.feature` — line ≈337 asserts the eviction comment contains "failed to resume after 3 probe attempts"; the new message keeps that phrase.
- `features/per-issue/step_definitions/feature-908.steps.ts` (on `origin/dev`) — calls `scanPauseQueue(PROBE_INTERVAL_CYCLES, () => ({ verdict: 'clear' }))`; the two-argument form must stay valid.
- `specs/prd/rate-limit-indefinite-retry.md` — sections "Pause queue", the reset-time parts of "Wait policy", "Testing Decisions" (unit tests for pure modules; shells at the implementer's judgement) and user stories 7, 8, 9, 10, 12, 42 are the contract.
- `README.md` — tree lines to update: ≈608 (`pauseQueue.ts`), ≈796 (triggers tests), ≈835 (`pauseQueueScanner.ts`), plus new lines for the decider and its test.
- `adws/known_issues.md` — `rate-limit-crash` solution paragraph: add that the queue entry now carries the reset time and the scanner waits for it.

Conditional documentation matched for this task (read before implementing; update where the text becomes false):

- `app_docs/feature-9gjajh-takeover-and-coordination.md` — owns `pauseQueueScanner.ts` and `rateLimitProbe.ts`. Its `scanPauseQueue` bullet (line ≈17), Configuration paragraph and the "`failed` and `unknown` are the two probe outcomes that consume `probeFailures`" gotcha (line ≈62) describe the pre-decider scanner. **#908 also edited this file on `origin/dev`** (the `## Retry` bullets) — merge `dev` first (step 1) so both edits land without conflict.
- `app_docs/feature-9gjajh-pause-and-auth-queues.md` — owns `pauseQueue.ts`; document the two new fields, the ISO-vs-epoch-seconds rule, the helper, and legacy loading.
- `app_docs/feature-9gjajh-workflow-lifecycle-phases.md` — owns `workflowCompletion.ts`; line ≈14 (`handleRateLimitPause`) gains the facts and `buildPausedWorkflowEntry`.
- `app_docs/feature-9gjajh-claude-stream-parser.md` — owns `phaseRunner.ts` and its test; only the call-site change, one sentence.
- `.adw/conditional_docs.md` — register the new files under their owning docs' `Owns:` lists (step 9) so `bun run lint:docs-index` stays clean.

### New Files

- `adws/triggers/pauseQueueDecider.ts` — the pure decider: `PauseQueueAction`, `PauseQueueDecisionInput`, `StrikeVerdict`, `isBeforeReset`, `decidePauseQueueAction`. Imports only `type { PausedWorkflow }` and `resetsAtIsoFromEpochSeconds` from `../core/pauseQueue` and `type { ProbeClassification, ProbeOutcome }` from `./rateLimitProbe`.
- `adws/triggers/__tests__/pauseQueueDecider.test.ts` — mock-free unit tests over the decision table (step 5).
- `adws/phases/__tests__/workflowCompletion.test.ts` — mock-free unit test of `buildPausedWorkflowEntry` (step 3). If importing `../workflowCompletion` drags in module-load side effects, mirror the `importOriginal` mocking style of `adws/phases/__tests__/prReviewCompletion.test.ts`; do not spy on `process.exit` — the function under test is pure.

## Implementation Plan

### Phase 1: Foundation
Bring the branch level with `origin/dev` (#908's `## Retry` for `paused` and its doc edits). Extend the queue schema with the two optional fields and the epoch-seconds → ISO helper. Thread the `RateLimitError` facts into `handleRateLimitPause` through an extracted pure `buildPausedWorkflowEntry`, adapt the two `phaseRunner` call sites and their test, and pin the "present → written, absent → omitted" rule with a unit test. Type-check before touching behaviour.

### Phase 2: Core Implementation
Write the decider and its exhaustive unit tests: the reset-time gate (`isBeforeReset`), resume, refresh with and without facts, strike counting and eviction at the budget, legacy entries, purity. Then rewrite the scanner as a thin shell: due-filter, probe at most once per scan and never when nothing is due, decider per entry, one executor with a `never`-guarded switch, injected clock, eviction message naming `## Retry`.

### Phase 3: Integration
Extend the #903 scanner suite (widened `pauseQueue` mock, `writeTopLevelState` stub, new reset-time/legacy/no-probe/eviction cases) and verify the #902/#907/#908 step definitions still compile and pass against the unchanged two-argument scanner call. Update the owning living docs, the docs index, the README tree lines and `known_issues.md`. Run the full validation list.

## Step by Step Tasks
Execute every step in order, top to bottom.

### 1. Bring #908 into the branch
- Run `git merge origin/dev --no-edit` from the worktree root. `origin/dev` is six commits ahead (PR #914, "feat: #908 - Retry resumes a workflow stranded in the paused stage"); this branch has no code commits yet, so the merge is conflict-free. Confirm `adws/triggers/retryHandler.ts` now exports `decideRetryAction` with a `resume_paused` action and that `app_docs/feature-9gjajh-takeover-and-coordination.md` mentions it.
- Why first: the eviction comment written in step 6 tells the operator to post `## Retry`, which only respawns a `paused` workflow with #908 in place; and step 9 edits doc bullets #908 also touched.
- If the build environment refuses the merge, continue anyway — nothing in this plan calls the retry handler, the directive is live on `dev`, and the doc edits will be reconciled at PR time.

### 2. Extend the queue schema in `adws/core/pauseQueue.ts`
- Add to `PausedWorkflow`, after `probeFailures`:
  - `resetsAt?: string` — comment: ISO 8601; the CLI's epoch-seconds reset time converted once at the boundary; absent when the pause carried no reset time or the entry predates the field.
  - `rateLimitType?: string` — comment: as reported by the CLI (`five_hour`, `seven_day`, …); absent for the same reasons.
- Add `export function resetsAtIsoFromEpochSeconds(seconds: number): string { return new Date(seconds * 1000).toISOString(); }`. One comment: the CLI emits Unix epoch seconds and the queue stores ISO so the file is human-readable and `Date.parse`-able; this is the only place the conversion happens.
- Do not touch `readPauseQueue`, `writePauseQueue`, `appendToPauseQueue`, `removeFromPauseQueue` or `updatePauseQueueEntry`. Legacy entries parse unchanged; the new fields are simply absent.
- Add `resetsAtIsoFromEpochSeconds` to the `./pauseQueue` re-export line in `adws/core/index.ts` (line ≈198).

### 3. Write the reset facts on the pause path (`workflowCompletion.ts`, `phaseRunner.ts`, tests)
- In `adws/phases/workflowCompletion.ts` extract the entry construction out of `handleRateLimitPause` into an exported pure function:
  ```ts
  export function buildPausedWorkflowEntry(
    config: Pick<WorkflowConfig, 'adwId' | 'issueNumber' | 'orchestratorName' | 'worktreePath' | 'branchName' | 'targetRepo'>,
    pausedAtPhase: string,
    pauseReason: PausedWorkflow['pauseReason'],
    facts: RateLimitFacts,
    now: Date,
  ): PausedWorkflow
  ```
  It returns today's object (adwId, issueNumber, `deriveOrchestratorScript(orchestratorName)`, pausedAtPhase, pauseReason, `pausedAt: now.toISOString()`, worktreePath, branchName, `extraArgs` only when `targetRepo` is set) plus `resetsAt: resetsAtIsoFromEpochSeconds(facts.resetsAt)` only when `facts.resetsAt` is a finite number, and `rateLimitType: facts.rateLimitType` only when it is a string. Absent facts are absent keys (the same spread idiom as `extraArgs`), never `undefined` values — the pause-and-auth-queues doc promises the file stays readable and the scenario writer asserts on absence.
- Change the signature to `handleRateLimitPause(config, pausedAtPhase, pauseReason, costUsd?, modelUsage?, facts: RateLimitFacts = {}): never` and call `appendToPauseQueue(buildPausedWorkflowEntry(config, pausedAtPhase, pauseReason, facts, new Date()))`. Import `type { RateLimitFacts }` from `../types/agentTypes` and `resetsAtIsoFromEpochSeconds` from `../core/pauseQueue`. Everything else in the function (state write, log, comment, board move, `process.exit(0)`) stays as it is; the paused comment text is not changed in this slice.
- In `adws/core/phaseRunner.ts` pass the error as the facts at both call sites: `handleRateLimitPause(config, err.phaseName, 'rate_limited', tracker.totalCostUsd, tracker.totalModelUsage, err)`. `RateLimitError` has readonly `rateLimitType?`/`resetsAt?` fields, so it satisfies `RateLimitFacts` structurally — no object literal, no copying.
- In `adws/core/__tests__/phaseRunner.test.ts`: change the exact-args assertion (line ≈116) to `(config, 'plan', 'rate_limited', 0, {}, rateLimitErr)`; add one case where `new RateLimitError('plan', { rateLimitType: INCIDENT_RATE_LIMIT_TYPE, resetsAt: INCIDENT_RESETS_AT })` is thrown and the sixth argument `toMatchObject({ rateLimitType: 'five_hour', resetsAt: 1790081400 })`. If the file also asserts `runPhasesParallel`'s call, update it the same way.
- Create `adws/phases/__tests__/workflowCompletion.test.ts` for `buildPausedWorkflowEntry` (no `process.exit`, no queue I/O): (a) facts `{ rateLimitType: 'five_hour', resetsAt: INCIDENT_RESETS_AT }` → entry has `resetsAt: '2026-09-22T12:50:00.000Z'` and `rateLimitType: 'five_hour'`; (b) facts `{}` → `expect(entry).not.toHaveProperty('resetsAt')` and `not.toHaveProperty('rateLimitType')`, and the entry deep-equals the pre-change shape (`JSON.parse(JSON.stringify(entry))` has exactly the legacy keys); (c) `{ rateLimitType: 'seven_day' }` alone → type written, no `resetsAt`; (d) `targetRepo` set → `extraArgs: ['--target-repo', 'owner/repo']`, unset → no `extraArgs` key (pins the untouched behaviour); (e) `pausedAt` equals `now.toISOString()`.
- Run `bun run test` (tsc) — everything must compile before the decider work starts.

### 4. Write the pure decider `adws/triggers/pauseQueueDecider.ts`
- Header comment: the decision table from the Solution Statement, and the two invariants the code cannot say — a `limited` verdict can never reach `count_strike`/`evict`, and the reset gate is evaluated before the verdict so a probe result taken while an entry is still waiting can neither strike nor resume it.
- Types:
  ```ts
  export type StrikeVerdict = Extract<ProbeOutcome, 'failed' | 'unknown'>;
  export type PauseQueueAction =
    | { readonly kind: 'skip_before_reset'; readonly resetsAt: string }
    | { readonly kind: 'resume' }
    | { readonly kind: 'refresh_reset'; readonly resetsAt?: string; readonly rateLimitType?: string }
    | { readonly kind: 'count_strike'; readonly probeFailures: number; readonly verdict: StrikeVerdict }
    | { readonly kind: 'evict'; readonly probeFailures: number; readonly verdict: StrikeVerdict };
  export interface PauseQueueDecisionInput {
    readonly entry: PausedWorkflow;
    readonly probe: ProbeClassification;
    readonly now: Date;
    readonly maxProbeFailures: number;
  }
  ```
  `PauseQueueDecisionInput` is deliberately an object: the ownership slice adds the scanning cron's repo identity to it (and a `skip_not_owner` action) without touching call sites. Do **not** add that field now.
- `export function parseResetsAt(resetsAt: string | undefined): number | null` — `Date.parse`, returning `null` for `undefined`, empty, or `NaN`. Unparseable is treated as absent: a corrupt field must degrade to the cadence path, never freeze an entry.
- `export function isBeforeReset(entry: Pick<PausedWorkflow, 'resetsAt'>, now: Date): boolean` — `parseResetsAt(entry.resetsAt)` is non-null and strictly greater than `now.getTime()`. Exactly at the reset time the entry is due (`>` not `>=`).
- `export function decidePauseQueueAction(input: PauseQueueDecisionInput): PauseQueueAction`:
  - guard: `if (isBeforeReset(entry, now)) return { kind: 'skip_before_reset', resetsAt: entry.resetsAt }` (the type guard narrows `resetsAt` to a string; do not use `!`).
  - `switch (probe.verdict)`: `clear` → `{ kind: 'resume' }`; `limited` → `refreshAction(probe)`; `failed`/`unknown` → `strikeAction(entry, probe.verdict, maxProbeFailures)`; `default` assigns to `never` so a fifth verdict fails `tsc` (the `classifyStage` pattern).
  - `refreshAction(probe)`: `{ kind: 'refresh_reset' }` plus `resetsAt: resetsAtIsoFromEpochSeconds(probe.resetsAt)` when `probe.resetsAt` is a finite number and `rateLimitType` when it is a string — absent facts are absent keys. No comparison with the entry's current value: an identical reset time is an idempotent refresh, and `Date` math on the entry is not the decider's business here.
  - `strikeAction(entry, verdict, max)`: `const probeFailures = (entry.probeFailures ?? 0) + 1;` return `count_strike` when `probeFailures < max`, else `evict` — the same arithmetic as today's `recordUnknownProbeFailure`, so budgets and legacy `probeFailures: undefined` behave identically.
- Nothing in this module reads a clock, the environment, `../core`, or logs. Keep it well under 100 lines.

### 5. Pin the decider with `adws/triggers/__tests__/pauseQueueDecider.test.ts`
- Helpers: `makeEntry(overrides)` (legacy shape: no `resetsAt`, no `rateLimitType`, `probeFailures: 0`), `NOW = new Date('2026-09-22T12:06:00Z')` (the incident's eviction minute), `BEFORE = '2026-09-22T12:50:00.000Z'` (= `resetsAtIsoFromEpochSeconds(INCIDENT_RESETS_AT)`), `PAST = '2026-09-22T11:00:00.000Z'`, `BUDGET = 3`, `probe(verdict, facts?)`.
- `parseResetsAt` / `isBeforeReset`: future ISO → before; past ISO → not before; equal to `now` → not before; absent → not before; `'not-a-date'` → not before (and `parseResetsAt` → `null`).
- Reset gate: `it.each(['clear', 'limited', 'failed', 'unknown'])` — entry `resetsAt: BEFORE`, `now: NOW`, any verdict → `{ kind: 'skip_before_reset', resetsAt: BEFORE }`; also with `probeFailures: 2` and verdict `unknown` (a strike that would have evicted #840 is not counted), and with `clear` (a clear probe taken early does not resume).
- Resume: `clear` after a past reset → `{ kind: 'resume' }`; `clear` on a legacy entry → `{ kind: 'resume' }`; `clear` on an unparseable `resetsAt` → `{ kind: 'resume' }`.
- Refresh: `limited` with `{ rateLimitType: INCIDENT_RATE_LIMIT_TYPE, resetsAt: INCIDENT_RESETS_AT }` after a past reset → `{ kind: 'refresh_reset', resetsAt: BEFORE, rateLimitType: 'five_hour' }` (`toEqual`, so no stray keys); `limited` with `{ rateLimitType: 'seven_day' }` only → `{ kind: 'refresh_reset', rateLimitType: 'seven_day' }`; `limited` with no facts → `{ kind: 'refresh_reset' }` exactly; `limited` with no facts and `probeFailures: 2` → still `refresh_reset` (one short of the budget, never evicted); `limited` on a legacy entry with facts → refresh (a legacy entry gains a reset time from the first probe that reports one).
- Strikes: `it.each(['failed', 'unknown'])` — `probeFailures: 0` → `{ kind: 'count_strike', probeFailures: 1, verdict }`; `1` → `count_strike` 2; `2` → `{ kind: 'evict', probeFailures: 3, verdict }`; `undefined` (legacy, no `probeFailures` key) → `count_strike` 1; `maxProbeFailures: 1` → first strike is `evict`; a past `resetsAt` with `unknown` → strike (the gate only protects entries still waiting).
- Purity: calling twice with the same input returns deep-equal actions; the input entry is unchanged afterwards (`toEqual` against a structured clone taken before the call).

### 6. Make `adws/triggers/pauseQueueScanner.ts` a thin shell
- Add `export interface PauseQueueScanDeps { now?: () => Date; }` with one comment: a deps object (not a positional clock) so the ownership slice can add the scanning cron's repo identity without changing any caller.
- Signature: `export async function scanPauseQueue(cycleCount: number, probe: () => ProbeClassification = probeRateLimit, deps: PauseQueueScanDeps = {}): Promise<void>`. `trigger_cron.ts` (one argument), `feature-902-queue.steps.ts` and `feature-908.steps.ts` (two arguments) keep compiling.
- Body, flat (guard clauses, no nesting beyond two levels):
  1. cadence gate unchanged (`cycleCount % PROBE_INTERVAL_CYCLES !== 0` → return);
  2. `const entries = readPauseQueue(); if (entries.length === 0) return;`
  3. `const now = (deps.now ?? (() => new Date()))();`
  4. `const due = entries.filter(entry => !isBeforeReset(entry, now));`
  5. if `due.length === 0`: log **one** line — `Pause queue scan: ${entries.length} paused workflow(s), all waiting for a reset time (earliest ${earliestResetsAt}) — probe skipped` — and return. The probe is not called and no entry is touched (story 7: no probes, no log noise, for hours).
  6. otherwise log `Pause queue scan: ${entries.length} paused workflow(s), ${due.length} due for a probe`, call `const classification = probe();` exactly once, then `for (const entry of entries) { await executePauseQueueAction(entry, decidePauseQueueAction({ entry, probe: classification, now, maxProbeFailures: MAX_UNKNOWN_PROBE_FAILURES }), now); }`.
- `async function executePauseQueueAction(entry, action, now)` — a `switch (action.kind)` with a `never` default:
  - `skip_before_reset`: no I/O, no log (the summary line already covers it);
  - `resume`: `log('Rate limit cleared — resuming workflow …', 'success'); await resumeWorkflow(entry);`
  - `refresh_reset`: `updatePauseQueueEntry(entry.adwId, { lastProbeAt: now.toISOString(), ...(action.resetsAt ? { resetsAt: action.resetsAt } : {}), ...(action.rateLimitType ? { rateLimitType: action.rateLimitType } : {}) })`; log `Rate limit still active for workflow ${adwId} — waits until ${resetsAt}` when a reset time was reported, else the existing "will retry later" line. Never writes `probeFailures`.
  - `count_strike`: `updatePauseQueueEntry(entry.adwId, { probeFailures: action.probeFailures, lastProbeAt: now.toISOString() })`; warn log `Probe failure (${verdict}) for workflow ${adwId} (${probeFailures}/${MAX_UNKNOWN_PROBE_FAILURES})` (today's wording, verdict included).
  - `evict`: `removeFromPauseQueue(entry.adwId)`; error log; `postEntryStageComment(entry, 'error', { issueNumber, adwId, errorMessage })` with
    `Workflow paused at '${entry.pausedAtPhase}' failed to resume after ${action.probeFailures} probe attempts (last result: ${describeStrikeVerdict(action.verdict)}). It stays paused — post \`## Retry\` on this issue to respawn it.`
    where `describeStrikeVerdict` maps `failed` → `a confirmed failure that was not a rate limit` and `unknown` → `a probe result that could not be classified`. The phrase "failed to resume after N probe attempts" is asserted by the #902 scenario and the #903 tests; keep it verbatim. The scanner writes **no** top-level state: the stage stays `paused`, which is what makes `## Retry` applicable.
- Delete `applyProbeOutcome` and `recordUnknownProbeFailure`. Keep `resumeWorkflow` (including its early-exit `probeFailures` increment — a spawn failure, not a probe verdict, and out of this slice's scope), `resolveEntryRepoInfo`, `resolveEntryBoundary`, `postEntryStageComment`, `worktreeExists`, `awaitChildReadiness`, `READINESS_WINDOW_MS`.
- Rewrite the module header: the scanner is I/O only — read, probe at most once per scan and never while every entry waits for its reset time, decide through `pauseQueueDecider`, execute. Drop the sentence about `failed` sharing the strike path "for now" and the reference to a future decider issue.
- Imports: `isBeforeReset`, `decidePauseQueueAction`, `type PauseQueueAction`, `type StrikeVerdict` from `./pauseQueueDecider`; `ProbeOutcome` is no longer needed here. Confirm the file stays under 300 lines and `bun run lint` reports no unused imports.

### 7. Extend `adws/triggers/__tests__/pauseQueueScanner.test.ts` (the #903 suite stays green)
- Widen the queue mock so the decider's helper is real:
  ```ts
  vi.mock('../../core/pauseQueue', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../core/pauseQueue')>()),
    readPauseQueue: vi.fn(),
    removeFromPauseQueue: vi.fn(),
    updatePauseQueueEntry: vi.fn(),
  }));
  ```
  and add `writeTopLevelState: vi.fn()` to the `AgentStateManager` mock. Leave every existing test as it is — each uses `makeEntry()` without `resetsAt`, so each is a legacy-path proof of "handled exactly as before".
- Add a `NOW`/`clock` helper (`const NOW = new Date('2026-09-22T12:06:00Z'); const clock = { now: () => NOW };`) and `FUTURE`/`PAST` ISO constants derived from `INCIDENT_RESETS_AT`.
- New `scanPauseQueue` cases:
  - **does not invoke the probe when every entry is still before its reset time**: two entries with `resetsAt: FUTURE`; `probe = vi.fn()`; `await scanPauseQueue(1, probe, clock)`; probe not called; `updatePauseQueueEntry`, `removeFromPauseQueue`, `postIssueStageComment` and `childProcess.spawn` not called.
  - **probes once when at least one entry is due and leaves the waiting entry untouched**: entries A (`FUTURE`), B (`PAST`), C (legacy); probe `limited` (no facts); probe called once; `updatePauseQueueEntry` called exactly twice, for B and C, each with `{ lastProbeAt: NOW.toISOString() }` and no `probeFailures`/`resetsAt` keys; never for A.
  - **a limited probe that reports a reset time refreshes the entry and never increments probeFailures** (the reset-time extension of the #903 case): entry `probeFailures: 2, resetsAt: PAST`; probe `{ verdict: 'limited', rateLimitType: INCIDENT_RATE_LIMIT_TYPE, resetsAt: INCIDENT_RESETS_AT }`; `updatePauseQueueEntry(adwId, { lastProbeAt: NOW.toISOString(), resetsAt: '2026-09-22T12:50:00.000Z', rateLimitType: 'five_hour' })` (`toHaveBeenCalledWith` with the exact object); no removal; no comment.
  - **a limited probe on a legacy entry gains the reported reset time**: legacy entry; same probe; update carries `resetsAt`/`rateLimitType`.
  - **a clear probe after the reset time resumes the workflow**: entry `resetsAt: PAST`; probe `clear`; `spawn` once; `removeFromPauseQueue(adwId)`.
  - **eviction names `## Retry`, keeps the manual-restart phrase, and writes no state**: entry `probeFailures: 2`; probe `failed`; `postIssueStageComment(fakeBoundary.providers, issueNumber, 'error', objectContaining({ errorMessage: expect.stringMatching(/failed to resume after 3 probe attempts[\s\S]*## Retry/) }))`; `AgentStateManager.writeTopLevelState` not called; `removeFromPauseQueue` called with the adwId. Repeat for `unknown` (message mentions "could not be classified").
  - **a legacy JSON entry is handled exactly as before**: build the entry with `JSON.parse('{"adwId":"legacy-1","issueNumber":7,"orchestratorScript":"adws/adwSdlc.tsx","pausedAtPhase":"plan","pauseReason":"rate_limited","pausedAt":"2026-04-18T12:45:00Z","worktreePath":"/tmp/w","branchName":"b"}') as PausedWorkflow` (no `probeFailures`, no new fields); probe `unknown`; `updatePauseQueueEntry(adwId, objectContaining({ probeFailures: 1 }))`; probe called once.
  - **uses the injected clock for lastProbeAt**: legacy entry, probe `limited`, `clock`; the update's `lastProbeAt` is exactly `NOW.toISOString()`.
  - **default clock**: `scanPauseQueue(1, probe)` with no third argument still works (the existing #903 "limited" case already proves it; no new test needed beyond keeping it).
- Keep the "probes exactly once per scan regardless of queue size" case; it now also proves the probe is not called per entry after the due-filter.

### 8. Keep the BDD harness on the new contract
- `features/per-issue/step_definitions/feature-902-queue.steps.ts` and `feature-908.steps.ts` (after step 1): no logic change; confirm `bun run test` (tsc covers `features/**`) passes with the two-argument `scanPauseQueue` calls. Their seeded entries have no `resetsAt`, so the `@adw-902` scenarios (including "A genuinely unknown probe failure still counts, and the third one drops the workflow with the manual-restart comment", which asserts "failed to resume after 3 probe attempts") remain the live legacy-path proof; run them.
- The scenario writer will add `features/per-issue/feature-910.feature`; its novel phrases ("an entry whose reset time is N minutes in the future", "the scanner ran no probe", "the entry's reset time is now …") get step definitions in the step-definition phase after the build. Two harness notes for that phase: the clock is pinned through `scanPauseQueue`'s third argument (`{ now: () => fixedDate }`), and if the #910 scenarios reuse #902 phrases, widen the existing `Before`/`After` hook tags in `feature-902-queue.steps.ts` / `feature-902.steps.ts` to `'@adw-902 or @adw-907 or @adw-910'` rather than registering second hooks (a second hook would initialise the mock infrastructure twice — the #907 lesson).

### 9. Correct the documentation the change makes false
- `app_docs/feature-9gjajh-takeover-and-coordination.md`: rewrite the `scanPauseQueue` bullet — cadence gate; read; due-filter via `isBeforeReset`; probe at most once per scan and not at all when every entry is before its reset time; `decidePauseQueueAction` per entry; the five actions and what the executor does for each; `PauseQueueScanDeps.now`. Add the decider's decision table (from the Solution Statement) and note the object-shaped inputs as the seam the ownership slice fills. Rewrite the gotcha at line ≈62: `failed` and `unknown` still consume `probeFailures`, but only for entries past their reset time; `limited` never does and refreshes `resetsAt`; eviction posts a comment naming `## Retry` and writes no state (stage stays `paused`). Mention in Configuration that `MAX_UNKNOWN_PROBE_FAILURES` is passed into the decider, never read by it.
- `app_docs/feature-9gjajh-pause-and-auth-queues.md`: `PausedWorkflow` gains `resetsAt` (ISO 8601) and `rateLimitType`; `resetsAtIsoFromEpochSeconds` is the one epoch-seconds → ISO conversion; entries without the fields load unchanged and follow the cadence path; add a gotcha that the entry stores ISO while `RateLimitFacts`/`ProbeClassification` carry epoch **seconds**.
- `app_docs/feature-9gjajh-workflow-lifecycle-phases.md` line ≈14: `handleRateLimitPause(config, phase, reason, cost?, usage?, facts = {})` builds the entry through the pure `buildPausedWorkflowEntry`, writing `resetsAt`/`rateLimitType` only when the `RateLimitError` carried them.
- `app_docs/feature-9gjajh-claude-stream-parser.md`: one sentence — `runPhase`/`runPhasesParallel` pass the caught `RateLimitError` to `handleRateLimitPause` as the reset facts.
- `.adw/conditional_docs.md`: under the takeover doc's `Owns:` add `adws/triggers/pauseQueueDecider.ts`, `adws/triggers/__tests__/pauseQueueDecider.test.ts` and `adws/triggers/__tests__/pauseQueueScanner.test.ts` (currently unlisted); under the lifecycle doc's `Owns:` add `adws/phases/__tests__/workflowCompletion.test.ts`; add "reset-time gate / pause-queue decider" wording to the takeover doc's Conditions.
- `README.md`: line ≈608 — `pauseQueue.ts` "entries carry the reported reset time (ISO 8601) and limit type when known"; line ≈835 — `pauseQueueScanner.ts` "thin shell: probes at most once per scan, never before an entry's reset time; actions decided by pauseQueueDecider"; add `pauseQueueDecider.ts  # Pure pause-queue decider: reset-time gate, resume, refresh_reset, count_strike, evict` before it and `pauseQueueDecider.test.ts` in the triggers test tree (≈796); add `workflowCompletion.test.ts` next to `prReviewCompletion.test.ts` (≈721).
- `adws/known_issues.md`, `rate-limit-crash` solution: append that the queue entry now carries `resetsAt`/`rateLimitType`, the scanner does not probe before the reset time, a `limited` probe refreshes it, and eviction points at `## Retry`.

### 10. Run the validation commands
- Run every command in `Validation Commands` below and fix whatever fails. All must exit 0 with zero regressions.

## Testing Strategy

### Unit Tests
Vitest (`bun run test:unit`, include `adws/**/__tests__/**/*.test.ts`). Following the PRD's testing decision, the pure modules get exhaustive tests and the shells get behavioural tests at their injected seams; every test observes an external behaviour (the action a decider returns, the object the pause path builds, the queue update a scanner writes, the comment it posts), never which internal function was called and never source text.

- `adws/triggers/__tests__/pauseQueueDecider.test.ts` — new, mock-free: `parseResetsAt`/`isBeforeReset` boundaries; the reset gate over all four verdicts; resume; refresh with full, partial and no facts; strikes and eviction for `failed` and `unknown` including a legacy `probeFailures: undefined` and a budget of 1; purity.
- `adws/phases/__tests__/workflowCompletion.test.ts` — new, mock-free: `buildPausedWorkflowEntry` writes the facts when present, omits the keys when absent, keeps `extraArgs` behaviour, stamps `pausedAt` from the injected `now`.
- `adws/core/__tests__/phaseRunner.test.ts` — the `RateLimitError` is passed as the sixth argument; with and without facts.
- `adws/triggers/__tests__/pauseQueueScanner.test.ts` — all #903 cases unchanged (legacy path); new: probe not invoked when nothing is due; probe once with a mixed queue and the waiting entry untouched; `limited` with facts refreshes and never strikes; `limited` on a legacy entry gains the reset time; `clear` after reset resumes; eviction names `## Retry`, keeps the asserted phrase, writes no state; legacy JSON entry handled as before; injected clock stamps `lastProbeAt`.

### Edge Cases
- `resetsAt` on the entry that is unparseable (`'not-a-date'`, `''`): treated as absent — cadence path, never a frozen entry.
- `resetsAt` exactly equal to `now`: due (not before), so it is probed.
- A `limited` probe whose reported reset time is in the past (clock skew, stale CLI value) or is `0`: `refresh_reset` writes it as-is; the entry is due again on the next cadence-eligible scan. Harmless.
- A `limited` probe reporting a reset time far in the future: the entry is left alone until then. There is deliberately no maximum wait in this slice (the PRD sets none); `## Retry` is the operator's escape hatch.
- An entry before its reset time while the probe (run for another entry) returns `failed` or `unknown`: no strike for the waiting entry; `clear` for another entry does not resume the waiting one.
- The only due entries are legacy (no `resetsAt`): the probe runs on cadence exactly as before this change.
- A queue where every entry waits: no probe, no writes, one log line per scan, `lastProbeAt` untouched.
- A `RateLimitError` with `rateLimitType` but no `resetsAt` (a rejected event without a reset time): entry gets the type only and follows the cadence path.
- `MAX_UNKNOWN_PROBE_FAILURES=1` on the host: the first `failed`/`unknown` after the reset evicts; `limited` still never does.
- Legacy entry with `probeFailures` absent: first strike writes `1`.
- `resumeWorkflow`'s own early-child-exit `probeFailures` increment is unchanged (a spawn failure, not a probe verdict).
- `postEntryStageComment` throwing (no resolvable token) on eviction: swallowed and logged as today; the entry is still removed.

## Acceptance Criteria
- `PausedWorkflow` has optional `resetsAt` (ISO 8601 string) and `rateLimitType`; `handleRateLimitPause` writes them from the `RateLimitError`'s facts when present and omits the keys when absent; `runPhase` and `runPhasesParallel` pass the error as the facts.
- `adws/triggers/pauseQueueDecider.ts` exists, is pure (no I/O, clock, env or logging imports), and its unit tests cover: before `resetsAt` → `skip_before_reset` for every verdict; `clear` after reset → `resume`; `limited` with a reported reset time → `refresh_reset` carrying it as ISO; `limited` without one → `refresh_reset` with no facts (no strike, no change to the reset time); `failed`/`unknown` → `count_strike` until the budget, then `evict`.
- `scanPauseQueue` never calls the probe when every entry is before its reset time, and calls it at most once per scan otherwise (unit-tested through the injected probe and clock).
- A `limited` probe never increments `probeFailures`, including when the entry has a reset time and when the probe reports a new one (the #903 case extended).
- The eviction comment contains "failed to resume after N probe attempts" and names `## Retry`; eviction removes the entry and writes no top-level state (stage stays `paused`).
- Entries without the new fields load unchanged and behave exactly as before: every pre-existing scanner test passes unmodified, and the `@adw-902` scenarios pass.
- `trigger_cron.ts`'s one-argument call and the #902/#908 step definitions' two-argument calls compile unchanged.
- The decider input and scanner deps are object-shaped; no ownership field, rule, or action is present.
- `bun run test`, `bun run test:unit`, `bun run lint`, `bun run lint:git-guard` and `bun run lint:docs-index` pass; the owning app docs, `.adw/conditional_docs.md`, README tree lines and `known_issues.md` are updated.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run test` — TypeScript type-check of the whole repo, including `features/**` step definitions (the two-argument `scanPauseQueue` calls and the six-argument `handleRateLimitPause`).
- `bunx tsc --noEmit -p adws/tsconfig.json` — additional type check for the `adws/` project.
- `bun run test:unit` — full vitest suite (decider, scanner, phase runner, workflow completion, and every existing suite).
- `bunx vitest run adws/triggers/__tests__/pauseQueueDecider.test.ts adws/triggers/__tests__/pauseQueueScanner.test.ts adws/core/__tests__/phaseRunner.test.ts adws/phases/__tests__/workflowCompletion.test.ts` — the four suites this feature owns, in isolation.
- `bun run lint` — ESLint (no unused imports after removing `applyProbeOutcome`/`recordUnknownProbeFailure`; no `any`).
- `bun run lint:git-guard` — git/gh guard (the decider and scanner add no shell-outs and no cwd-derived identity).
- `bun run lint:docs-index` — living-docs index gate after the `.adw/conditional_docs.md` edits.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-902"` — the legacy-path scanner scenarios over the real queue file, including the eviction-comment assertion.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-907"` — the probe/parser scenarios that share the scanner harness.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-908"` — after step 1, the `## Retry`-on-paused scenarios that also drive `scanPauseQueue`.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-910"` — this issue's scenarios once the scenario-writer and step-definition phases have produced them.
- `grep -c "applyProbeOutcome\|recordUnknownProbeFailure\|Manual restart required" adws/triggers/pauseQueueScanner.ts` — must print `0`.
- `grep -c "from '../core'\|process.env\|new Date()" adws/triggers/pauseQueueDecider.ts` — must print `0` (the decider stays pure).

## Notes
- If `.adw/coding_guidelines.md` exists in the target repository (or `guidelines/coding_guidelines.md` as a fallback), strictly adhere to those coding guidelines. If necessary, refactor existing code to meet the coding guidelines as part of implementing the feature. Concretely here: guard clauses and a flat loop body in `scanPauseQueue` (extract `executePauseQueueAction`); `readonly` discriminated unions with a `never`-guarded `switch` in both the decider and the executor; no magic numbers (the budget is a parameter); absent facts are absent keys; comments only for invariants and non-obvious choices (why a deps object, why unparseable reset times degrade to the cadence path, why the gate precedes the verdict); no issue numbers in code comments; files under 300 lines.
- **Decision — `unknown` still counts a strike.** The issue's title says "confirmed non-rate-limit failures", but the PRD's user story 10 names "a broken CLI binary" (which classifies `unknown`) as something that must count toward a finite budget so a dead workflow does not wait forever, and the acceptance criterion "Scanner tests from #903 remain green" keeps the tests in which `unknown` strikes and evicts. "Confirmed" contrasts with `limited`, which never strikes. What changes is *when* a strike can happen: never before an entry's reset time, so a transient `unknown` during a known limit — the #840 failure mode — can no longer evict anything.
- **Decision — `refresh_reset` is the single action for a confirmed limit.** The issue fixes the action set at five and lists "`limited` without a reset time → no strike, no change" as a case. Modelling that case as `refresh_reset` with no facts keeps the contract at five actions; the shell writes only `lastProbeAt`, so the reset time, limit type and strike count are unchanged. No sixth "hold" action is introduced.
- **Decision — the reset gate does not compare the probe's reset time with the entry's.** An identical reported reset time is an idempotent refresh; a later one extends the wait; an earlier one is harmless (the entry is due again on the next scan). Comparing would add branches with no observable difference.
- **Out of scope, deliberately** (each owned by another PRD slice): the in-process wait and attempt counting in the phase runner (stories 1–6, 23–25), stating the reset time in the paused comment (story 4), per-cron ownership of entries and the `skip_not_owner` action (stories 18–20), removing the queue entry before spawning on resume (story 21), the CLI stub's rate-limited response (story 41), the envelope conformance gate, and any `## Retry`/`## Cancel` change. The seam left for ownership is the object shape of `PauseQueueDecisionInput` and `PauseQueueScanDeps` — nothing more.
- `RateLimitFacts.resetsAt` and `ProbeClassification.resetsAt` are Unix epoch **seconds**; `PausedWorkflow.resetsAt` is ISO 8601. `resetsAtIsoFromEpochSeconds` is the only conversion; the decider calls it for the probe's facts, `buildPausedWorkflowEntry` for the error's.
- The scanner test file mocks `fs` with a small surface; `pauseQueue.ts` only touches `fs` inside its functions, so `importOriginal` on it is safe at module load.
- After step 1 the branch contains #908's `retryHandler.ts`, which reads and removes pause-queue entries through `readPauseQueue`/`removeFromPauseQueue`; the schema additions do not affect it.
- No new library is needed; nothing to install (`bun add` not required).
