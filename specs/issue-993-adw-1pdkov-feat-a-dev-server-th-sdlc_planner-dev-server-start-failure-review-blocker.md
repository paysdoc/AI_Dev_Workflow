# Feature: A dev server that will not start on the issue branch is a failed review; the count resets when it starts

## Metadata
issueNumber: `993`
adwId: `1pdkov-feat-a-dev-server-th`
issueJson: `{"number":993,"title":"feat: a dev server that will not start on the issue branch is a failed review; the count resets when it starts","body":"Source: `specs/prd/review-proof-redesign.md` and the ADR named below, in `specs/adr/`. The PRD section **Implementation Decisions** describes the module; the ADR holds the decision and its reasons. Read both before planning; they are the specification. Do not change the decisions.\n\n## Decision record\n\nADR-0062. PRD module: **Dev-server failure handling**.\n\n## What to build\n\n- In the scenario phase of a `web` repository, a start failure after the lifecycle's retries becomes a review blocker carrying the server's output, routed into the review patch loop. The scenarios do not run against a server that did not start.\n- Each failed start increments the review attempt counter; at the cap the issue goes to `review_failed` as for any failed review.\n- A successful start resets the failed-review count to zero.\n- The lifecycle module loses \"run the work anyway after 3 failures\". The baseline (ADR-0060) is unaffected: a base-branch start failure parks.\n\n## Acceptance criteria\n\n- [ ] A failing start on the issue branch produces a blocker with the server output and no scenario run; the builder's patch is followed by a new start attempt.\n- [ ] The counter increments per failed start, reaches `review_failed` at the cap, and is zero after a successful start.\n- [ ] Unit tests with a fake lifecycle: blocker with output, increment, reset, cap.\n- [ ] The `### Confirmation` section of ADR-0062 names the implemented check.\n\n## Blocked by\n\n#992\n","state":"OPEN","author":"paysdoc","labels":["adw:feature"],"createdAt":"2026-10-03T23:13:16Z","comments":[],"actionableComment":null}`

## Feature Description
ADR-0062 decided that a dev server that will not start on the issue branch is a failed review. Today `withDevServer` (`adws/core/devServerLifecycle.ts`) tries the start three times and then runs the scenarios anyway. In a `web` repository every scenario then errors on a refused connection (ADR-0062's spike of 2026-10-02), and the scenario fix agent is sent after scenarios that never had a server. This issue builds the PRD module **Dev-server failure handling**:

1. **The lifecycle loses "run the work anyway".** `withDevServer` is deleted. `withHealthyDevServer`, which the baseline already uses, becomes the only way to run work under a server. It never runs the work against a server that did not start, and it hands back the last attempt's output.
2. **The scenario phase starts only the server the repository declares**, the same one the baseline starts: the `## Start Dev Server` of the worktree's raw `.adw/commands.md`. It starts it through `withHealthyDevServer`. If the start fails, no scenario runs, and the phase reports the failure with the server's output.
3. **A failed start becomes a review blocker carrying that output**, routed into the review patch loop. The patch agent and the build agent fix it, the fix is committed and pushed, and the next scenario run is a new start attempt.
4. **The counter.** Each failed start uses one review attempt. At the cap the issue goes to `review_failed` (ADR-0048), exactly as a review whose blockers outlast the budget does. When the server starts again after a failed start, the failed-review count resets to zero.
5. **One owner for the counter.** One review-retry loop (`runReviewRetryLoop`, new `adws/phases/reviewRetryLoop.ts`) replaces the five copies of the loop in `adwSdlc`, `adwPlanBuildReview`, `adwPlanBuildTestReview`, `adwChore` and `adwPrReview`. ADR-0062 names the risk: "the review attempt counter gains a second writer, which the orchestrators must keep consistent". The counting rules are a pure module (new `adws/core/devServerFailure.ts`).
6. **The baseline is unaffected.** On the base branch (ADR-0060) a start failure still parks as `base_server_down` and never touches the review counter.

Value: the fix goes, with the evidence, to the builder who broke the start. A scenario verdict can no longer be a server verdict in disguise.

## User Story
As an ADW operator running ADW on a web application
I want a dev server that will not start on the issue branch to reach the builder as a review blocker with the server's output, to count as a failed review, and to stop counting once the server starts again
So that whoever broke the start fixes it, scenarios never report connection errors as scenario failures, and a server problem does not use up the review attempts the real review needs

## Problem Statement
- **Run anyway.** After `MAX_START_ATTEMPTS` failed probes, `withDevServer` logs `running work anyway` and calls `work()` (`adws/core/devServerLifecycle.ts:110-149`). `executeScenarioTestPhase` wraps the scenario run in it (`adws/phases/scenarioTestPhase.ts:87-100`).
- **Wrong fixer.** The resulting blocker failures go through `runScenarioTestFixLoop` to `executeScenarioFixPhase`. ADR-0062 rejected exactly that option.
- **No start outcome.** The scenario phase's result says nothing about the server. No caller can tell a server failure from a scenario failure, or a server that started from one that was never declared.
- **An undeclared server is started.** `parseCommandsMd` fills an absent or empty `## Start Dev Server` with `bun run dev` (`adws/core/projectConfig.ts:129`). The scenario phase starts whatever `isDevServerConfigured(projectConfig.commands.startDevServer)` accepts. The baseline, by contrast, starts only a server the repository declares (`declaredDevServerCommand`, `adws/core/baselineGate.ts:74`). Once a failed start is a failed review, an undeclared default that does not exist would fail every review of a repository that never asked for a server. ADR-0062's premise is that the baseline showed the server starts on the base branch, and that holds only for a declared server.
- **Five copies of the review loop.** Each orchestrator keeps its own `attempt`/`reviewRetries` variables: `adwSdlc.tsx:73-91`, `adwPlanBuildReview.tsx:82-99`, `adwPlanBuildTestReview.tsx:92-110`, `adwChore.tsx:99-125`, `adwPrReview.tsx:61-77`. A second writer of the counter would have to be added five times, and the copies would drift.
- **Paths with no review loop.**
  - A chore the diff judge rules `safe` skips review and is pre-approved for auto-merge.
  - `adwPlanBuildTest` has no review at all.
  - Either would open a pull request on scenarios that never ran.
- **The reset cannot fire on every start.** Read literally, "a successful start resets the count" would reset the count on every re-test of a `web` repository, because its server starts every time. Its review could then never reach the cap, which contradicts "at the cap the issue goes to `review_failed` as for any failed review". The owner said, "once that problem is solved the number of failed reviews resets", and the issue title says "the count resets when it starts". Both tie the reset to the server that did not start.

## Solution Statement
- **Lifecycle (`adws/core/devServerLifecycle.ts`).**
  - Delete `withDevServer` and its doc comment. Rewrite the module header: `withHealthyDevServer` never runs the work against a server that did not start, hands back the last attempt's output, and leaves the meaning of a failed start to its caller.
  - Nothing else changes: the process group, the probe, `MAX_START_ATTEMPTS`, the stop that waits for the group, `spawnServer`, `probeHealth`, `substitutePort`, `devServerPort` and `isDevServerConfigured`. The janitor is untouched.
- **Declared server (`adws/phases/declaredDevServer.ts`, new).** `readDeclaredDevServer(checkoutPath)` reads `<checkoutPath>/.adw/commands.md` raw and returns `declaredDevServerCommand(content)`, or `null` when the file is missing.
  - `executeBaselinePhase` uses it in place of its private `rawCommandsMd`.
  - With that, the issue branch and the base branch share one definition of "the server the repository declares".
- **Start outcome and counter (`adws/core/devServerFailure.ts`, new, pure, no imports).**
  - `enum DevServerStartStatus { NotStarted = 'not_started', Started = 'started', Failed = 'failed' }`.
  - `type DevServerStart`, with three variants:
    - `{ status: NotStarted }`: no server is declared, or there were no scenarios to serve;
    - `{ status: Started }`;
    - `{ status: Failed; command; healthUrl; output }`: not healthy after the lifecycle's retries, and no scenario ran.
  - `FailedDevServerStart` (the `Failed` variant) and `NO_DEV_SERVER_START`.
  - `interface ReviewAttempts { failed; total; lastStartFailed }`:
    - `failed` is the count held against the cap;
    - `total` counts every failed review of the run and is never reset (it becomes `totalReviewRetries` in the orchestrator metadata);
    - `lastStartFailed` says whether the latest start attempt failed.
  - `NO_REVIEW_ATTEMPTS`, with every field zero or false.
  - The rules:
    - `countFailedStart(a)`: `failed + 1`, `total + 1`, `lastStartFailed: true`. A failed start is a failed review.
    - `countStartedServer(a)`: if `lastStartFailed`, then `failed: 0` and `lastStartFailed: false`; otherwise unchanged. The server problem is solved.
    - `countFailedReview(a)`: `failed + 1`, `total + 1`, `lastStartFailed: false`.
    - `isReviewBudgetSpent(a, max)`: `a.failed >= max`.
  - `SERVER_OUTPUT_TAIL_CHARS` (6000) and `serverOutputTail(output)`:
    - it keeps the end of the output, where a start's error is, behind a marker that says how many earlier characters were left out;
    - empty or whitespace-only output becomes `(no output)`.
- **Scenario phase (`adws/phases/scenarioTestPhase.ts`).**
  - `executeScenarioTestPhase(config, deps: Partial<ScenarioTestPhaseDeps> = {})`. The deps are `readDeclaredDevServer` and `withHealthyDevServer`, both defaulted, so `runPhase` and the orchestrators call it as today. Export the result type as `ScenarioTestPhaseResult`.
  - The result gains `devServer: DevServerStart`.
  - A skipped phase (no scenarios, or an `N/A` runner) reports `NotStarted`.
  - No declared server: the scenarios run without one, and the phase reports `NotStarted`. This holds even when the parsed config holds the `bun run dev` default.
  - A declared server runs `withHealthyDevServer`. Its config:
    - `startCommand`: the declared command;
    - `port`: `devServerPort(applicationUrl)`;
    - `healthPath`: `healthCheckPath || '/'`;
    - `cwd`: the worktree;
    - `outputPath`: `<logsDir>/dev-server.log`.

    Its work is the scenario run.
    - When the server started: the proof as today, and `Started`.
    - When it did not start, no scenario has run. The phase does five things:
      1. it sets `config.ctx.scenarioProof = undefined`, so no stale proof reaches a comment or the PR;
      2. it logs, and appends to the state log, that the dev server did not start on the issue branch after `MAX_START_ATTEMPTS` attempts and that no scenario ran, with the output's tail;
      3. it records the phase cost as `Failed`;
      4. it returns `scenarioProof: undefined`;
      5. it returns `devServer: { status: Failed, command: substitutePort(declared, port), healthUrl: http://localhost:<port><healthPath>, output }`.
  - Import `DevServerStartStatus` from `../core/devServerFailure` and `declaredDevServerCommand` (through `readDeclaredDevServer`) directly, not through the `../core` barrel. The phase's tests replace that barrel wholesale.
- **Scenario fix loop (`adws/phases/scenarioTestFixLoop.ts`).**
  - `ScenarioTestFixLoopResult` gains `devServer: DevServerStart`.
  - Right after each `executeScenarioTestPhase`, a `Failed` start returns at once with `{ scenarioProof: undefined, scenarioProofPath: '', scenarioRetries, devServer }`. Before that return it appends a line saying the failed start goes to the review loop.
  - It runs no fidelity check, no pre-existing-regression gate and no scenario fix agent, and it counts no scenario retry. The failed start is the review loop's, because it is a failed review and not a scenario failure.
  - Every other return carries the last `devServer`.
- **Review retry loop (`adws/phases/reviewRetryLoop.ts`, new).**
  - `ReviewRetryPhases`, a `Pick` of `executeReviewPhase`, `executeReviewPatchCycle` and `executeScenarioTestPhase`, with `REVIEW_RETRY_PHASES` as the real ones.
  - `ScenarioOutcome { scenarioProofPath; devServer }`. A `ScenarioTestFixLoopResult` satisfies it as is. `scenarioOutcomeOf(phaseResult)` builds it from a scenario phase result: `scenarioProof?.resultsFilePath ?? ''`, and `devServer`.
  - `serverStartBlocker(start)` (pure) returns a `ReviewIssue`:
    - `reviewIssueNumber: 1`, `issueSeverity: 'blocker'`, `remediationStrategy: 'patch'`;
    - `issueDescription` says the dev server did not start on the issue branch, so no scenario ran. It names `start.command`, `start.healthUrl` and `MAX_START_ATTEMPTS`, followed by `serverOutputTail(start.output)` in a fence longer than any backtick run inside it;
    - `issueResolution` asks for the change that stops the server from starting to be found and fixed, using that output, and forbids changing how `.adw/commands.md` declares or starts the server.

    The patch agent receives both fields (`runPatchAgent` passes `Issue #n: <description>\nResolution: <resolution>`), so the builder gets the output.
  - `recordFailedStartReview(config, start)` records the failed start as a failed review attempt:
    - it sets `ctx.reviewIssues = [blocker]`, `ctx.errorMessage` and `ctx.screenshotUrls = []`;
    - it logs and appends to the state log;
    - when there is a `repoContext`, it posts the `review_failed` stage comment, as `executeReviewPhase` does for every failed attempt. With `ctx.scenarioProof` cleared, that comment lists the blocker, and with it the output;
    - it returns `[blocker]`.
  - `runReviewRetryLoop(config, tracker, start, phases = REVIEW_RETRY_PHASES, maxAttempts = MAX_REVIEW_RETRY_ATTEMPTS)` returns `{ reviewPassed, reviewRetries }`:
    ```
    if maxAttempts <= 0: return { reviewPassed: false, reviewRetries: 0 }    // today's loop ran no review either
    attempts = NO_REVIEW_ATTEMPTS; outcome = start
    loop:
      Failed start  → attempts = countFailedStart(attempts); blockers = recordFailedStartReview(config, outcome.devServer)
                      (the review agent is not run: there is no evidence, and the failed start is the verdict)
      otherwise     → if Started: attempts = countStartedServer(attempts)   (log "failed-review count reset to 0" when it was reset)
                      ctx.reviewAttempt = attempts.failed + 1; ctx.maxReviewAttempts = maxAttempts
                      review = runPhase(review agent over outcome.scenarioProofPath)
                      passed → return { reviewPassed: true, reviewRetries: attempts.total }
                      attempts = countFailedReview(attempts); blockers = review's blocker issues
      isReviewBudgetSpent(attempts, maxAttempts) → log; return { reviewPassed: false, reviewRetries: attempts.total }
      runPhase(executeReviewPatchCycle(cfg, blockers))      // the builder's patch: patch + build agents, commit, push
      outcome = scenarioOutcomeOf(runPhase(executeScenarioTestPhase))    // a new start attempt
    ```
    - When no server is ever declared, this is today's loop exactly: at most `maxAttempts` reviews and `maxAttempts - 1` patches, with `reviewRetries` equal to the failed reviews.
    - Extract the per-attempt judgement into a named function, to keep nesting at two levels.
    - `ctx.reviewAttempt` and `ctx.maxReviewAttempts` already exist on `WorkflowContext` and are already rendered by the `review_running` comment ("**Attempt:** n/m"). Nothing sets them today. Setting them makes the count, and its reset, visible on the issue.
- **Orchestrators.**
  - `adwSdlc`, `adwPlanBuildTestReview` and `adwPrReview` (with `config.base`) pass the `runScenarioTestFixLoop` result to `runReviewRetryLoop`.
  - `adwPlanBuildReview` passes `scenarioOutcomeOf(scenarioResult)`.
  - The injectable ones pass their `phases` table, which is a superset of `ReviewRetryPhases`.
  - Each keeps its own post-review handling: `decidePostReviewOutcome`, `executeSdlcReviewFailedHandoff`, metadata, and the PR-review completion. `totalReviewRetries` becomes the loop's `reviewRetries`.
- **`adwChore`.**
  - A failed start escalates the chore into the review loop even when the diff judge says `safe`: a failed start is a failed review, and a chore whose scenarios never ran must not be auto-merged.
  - `postEscalationComment` takes the reason, through a `ChoreEscalation` enum:
    - the `regression_possible` comment stays byte-identical, because `features/regression/smoke/adw_chore_diff_verdicts.feature` asserts its text;
    - the new comment, `## Chore Escalation: Dev Server Did Not Start`, says the dev server did not start on the issue branch, that this is a failed review, and that the chore takes the review path (review → document → PR).
  - `runEscalatedReviewLoop` is replaced by `runReviewRetryLoop`.
  - The metadata's `diffVerdict` becomes the judge's real verdict, `diffResult.verdict`, in place of one derived from `reviewPassed !== undefined`, in `stopAfterFailedReview` and in the final write. A chore the judge ruled `safe` but whose server did not start then reports `safe` with a review verdict next to it.
- **`adwPlanBuildTest` (review-less fallback orchestrator).**
  - It has no review and no review patch loop. A failed start reported by `runScenarioTestFixLoop` therefore ends the run there:
    - `recordFailedStartReview` and then `executeSdlcReviewFailedHandoff` write `review_failed`, and the comment carries the server's output and the `## Retry` instruction;
    - the metadata records `reviewPassed: false` and `totalReviewRetries: 1`, and the cost is persisted;
    - no pull request is opened, and no proof is published.
  - To test it, follow the existing pattern:
    - make it injectable (`PlanBuildTestPhases`, `executePlanBuildTest(config, phases)`);
    - guard `main()` with `import.meta.url === \`file://${process.argv[1]}\``.
  - A pull request on scenarios that never ran is never opened. The orchestrator is the fallback for unmapped issue types (`getWorkflowScript`).
- **Barrels.**
  - `adws/phases/index.ts` and `adws/workflowPhases.ts` export `runReviewRetryLoop`, `scenarioOutcomeOf`, `recordFailedStartReview`, `serverStartBlocker` and the types.
  - `adws/core/index.ts` exports the `devServerFailure` module.
- **Test doubles of the scenario phase.** Every fake of `executeScenarioTestPhase` or `runScenarioTestFixLoop` now returns `devServer`. That covers the three orchestrator tests, the two fix-loop tests and `features/per-issue/step_definitions/feature-927-phases.ts`.
- **Records.**
  - Replace the `### Confirmation` section of ADR-0062.
  - Update the README and `adws/README.md`.
  - Correct the comment in `baseScenarioRerun.ts` that says the change's server "is stopped by a timer". It is now stopped and waited for, up to `KILL_GRACE_MS + PROBE_INTERVAL_MS`.

## Relevant Files
Use these files to implement the feature:

- `specs/prd/review-proof-redesign.md`: the specification. Read it, do not change it. The parts that matter:
  - *Implementation Decisions*: **Dev-server failure handling**;
  - *Testing Decisions*: "a failed start becomes a blocker with the output; the counter increments; a successful start resets it; cap reaches `review_failed`. Fake lifecycle.";
  - user stories 44–47.
- `specs/adr/0062-dev-server-start-failure-is-a-failed-review.md`: the decision. Its `### Confirmation` must name the implemented check (acceptance criterion).
- `specs/adr/0060-baseline-gate-on-the-base-branch.md`: the baseline starts only a declared server and parks on a failed start. Unchanged; read-only.
- `specs/adr/0048-one-adwid-per-issue-and-review-failed-gate.md`: `review_failed` as the end of an exhausted review. Read-only.
- `specs/adr/0031-active-test-phase-passive-review-judge.md`: the lifecycle (process group, probe, kill) that stands, and the "run anyway" rule that is superseded. Read-only; `specs/adr/README.md` already records the supersession.
- `README.md` and `adws/README.md`: the feature bullets, the `adws/` trees, and the scenario-phase paragraph (`adws/README.md:891`).
- `.adw/coding_guidelines.md`: must be followed:
  - guard clauses, nesting ≤ 2, enums for named sets, `readonly`, no `any`;
  - pure core, side effects at the boundaries;
  - files under 300 lines;
  - comments only for invariants, ordering and non-obvious reasons (no issue numbers, no banners).
- `.adw/commands.md`: the validation commands. Read-only.
- `.github/adw.yml`: `unitTests` is commented out, so unit tests are enabled. Read-only.
- `adws/core/devServerLifecycle.ts`: `withDevServer` to delete; `withHealthyDevServer`, `HealthyDevServerConfig`, `HealthyDevServerOutcome`, `MAX_START_ATTEMPTS`, `substitutePort`, `devServerPort` to reuse.
- `adws/core/__tests__/devServerLifecycle.test.ts`: drop the `describe('withDevServer', …)` block and its import. `devServerLifecycle.healthy.test.ts` already covers `withHealthyDevServer` and is not modified.
- `adws/core/baselineGate.ts`: `declaredDevServerCommand` (raw `## Start Dev Server`, `N/A`-aware). Read-only.
- `adws/core/projectConfig.ts`: `parseCommandsMd` and its `bun run dev` default (why the raw file is read). Read-only.
- `adws/core/config.ts`, `adws/core/index.ts`: `MAX_REVIEW_RETRY_ATTEMPTS`; the barrel gains the new pure module.
- `adws/core/phaseRunner.ts`: `runPhase` and `CostTracker`, used by the loop exactly as the orchestrators use them today. Read-only.
- `adws/phases/scenarioTestPhase.ts`: the phase to change.
- `adws/phases/__tests__/scenarioTestPhase.test.ts`, `scenarioTestPhase.runner.test.ts` and `scenarioTestPhase.helpers.ts`: they mock `withDevServer` and must move to an injected fake lifecycle.
- `adws/phases/scenarioTestFixLoop.ts`, `adws/phases/__tests__/scenarioTestFixLoop.test.ts`, `scenarioTestFixLoop.regression.test.ts`: the early return and the new result field, plus the fakes to update.
- `adws/phases/scenarioProof.ts`: `ScenarioProofResult` (`resultsFilePath`). Read-only.
- `adws/phases/baselinePhase.ts`: switches to `readDeclaredDevServer`. Its tests (`baselinePhase.test.ts`, `baselinePhase.directives.test.ts`, `baselinePhase.helpers.ts`) write a real `.adw/commands.md` into a temp checkout and must stay green unchanged.
- `adws/phases/baseScenarioRerun.ts`: the base re-run keeps `withHealthyDevServer`. Correct its comment about the change's server.
- `adws/phases/reviewPhase.ts`: `executeReviewPhase` (posts `review_running`, then `review_failed`/`review_passed` per attempt; uploads screenshots from `ctx.scenarioProof`) and `executeReviewPatchCycle` (patch blockers → `applyPatchBlocker` → patch agent + build agent; commit; push). Not modified.
- `adws/phases/reviewPatchHelpers.ts`, `adws/agents/patchAgent.ts`: how a blocker reaches the builder. Read-only.
- `adws/agents/reviewAgent.ts`: `ReviewIssue`. Read-only.
- `adws/phases/decidePostReviewOutcome.ts`, `adws/phases/sdlcReviewHandoff.ts`: `review_failed` stop. Read-only.
- `adws/phases/phaseCommentHelpers.ts`: `postIssueStageComment`. Read-only.
- `adws/forge/workflowCommentsIssue.ts`: `WorkflowContext.reviewAttempt`/`maxReviewAttempts`, and the `review_running`/`review_failed` formatters (the fallback lists blockers when `ctx.scenarioProof` is absent). Read-only.
- `adws/phases/index.ts`, `adws/workflowPhases.ts`: barrels.
- `adws/adwSdlc.tsx`, `adws/adwPlanBuildReview.tsx`, `adws/adwPlanBuildTestReview.tsx`, `adws/adwPrReview.tsx`: replace the inline review loop.
- `adws/adwChore.tsx`: escalation on a failed start; the shared loop; `diffVerdict`.
- `adws/adwPlanBuildTest.tsx`: becomes injectable and stops at `review_failed` on a failed start.
- `adws/__tests__/adwPlanBuildTestReview.test.ts`, `adwPlanBuildReview.test.ts`, `adwChore.test.ts`: the fakes gain `devServer`, and the `AgentStateManager` mock gains `appendLog`; add the failed-start cases.
- `adws/phases/prReviewCompletion.ts`: `completePRReviewWorkflow(config, usage, outcome)` already writes `review_failed` for a failed outcome. Read-only.
- `features/per-issue/step_definitions/feature-927-phases.ts`: `buildFakePhases` fakes `runScenarioTestFixLoop` and `executeScenarioTestPhase`; they must return `devServer`.
- `features/per-issue/step_definitions/feature-992-phase.steps.ts`: runs the real `executeScenarioTestPhase` and writes `.adw/commands.md` into the worktree before loading the config (`prepareWorkflow`), so reading the declared server from the worktree keeps its scenarios green. Read-only.
- `features/regression/smoke/adw_chore_diff_verdicts.feature`: asserts the text "Chore Escalation: Regression Possible", which must not change. Read-only.
- `app_docs/feature-9gjajh-dev-server-and-ports.md` (conditional doc: dev-server lifecycle). It still describes `withDevServer`; the document phase updates it.
- `app_docs/feature-9gjajh-test-and-scenario-phases.md` (conditional doc: scenario test phase, fix loop, baseline).
- `app_docs/feature-9gjajh-review-and-diff-phases.md` (conditional doc: review phase and patch helpers).
- `app_docs/feature-9gjajh-sdlc-orchestrators.md` (conditional doc: the failed-review gate in `adwSdlc`, `adwPlanBuildReview`, `adwPlanBuildTestReview`, `adwPlanBuildTest`).
- `app_docs/feature-9gjajh-feature-orchestrators.md` (conditional doc: `adwChore`'s escalation and failed-review stop, `adwPrReview`).
- `app_docs/feature-9gjajh-takeover-and-coordination.md` (conditional doc: `review_failed`, `sdlcReviewHandoff.ts`).
- `app_docs/feature-9gjajh-pr-and-merge-phases.md` (conditional doc: `decidePostReviewOutcome`, PR-review completion).
- `app_docs/feature-9gjajh-specs-and-prd.md` (conditional doc: `specs/**`, for the ADR edit).

### New Files
- `adws/core/devServerFailure.ts`: pure. `DevServerStartStatus`, `DevServerStart`, `FailedDevServerStart`, `NO_DEV_SERVER_START`, `ReviewAttempts`, `NO_REVIEW_ATTEMPTS`, `countFailedStart`, `countStartedServer`, `countFailedReview`, `isReviewBudgetSpent`, `SERVER_OUTPUT_TAIL_CHARS`, `serverOutputTail`.
- `adws/core/__tests__/devServerFailure.test.ts`
- `adws/phases/declaredDevServer.ts`: `readDeclaredDevServer(checkoutPath)`.
- `adws/phases/__tests__/declaredDevServer.test.ts`
- `adws/phases/reviewRetryLoop.ts`: `ReviewRetryPhases`, `REVIEW_RETRY_PHASES`, `ScenarioOutcome`, `scenarioOutcomeOf`, `ReviewRetryResult`, `serverStartBlocker`, `recordFailedStartReview`, `runReviewRetryLoop`.
- `adws/phases/__tests__/reviewRetryLoop.test.ts`: a fake lifecycle under the real scenario phase. Blocker with output, a new start after the patch, increment, reset, cap.
- `adws/phases/__tests__/reviewRetryLoop.counter.test.ts`: the loop over scripted scenario outcomes. The reset rule, a healthy server that never resets, no server, the attempt shown on the comment, `maxAttempts` 0.
- `adws/phases/__tests__/scenarioTestPhase.server.test.ts`: the scenario phase over a fake lifecycle.
- `adws/__tests__/adwPlanBuildTest.test.ts`: the review-less orchestrator stops at `review_failed` on a failed start.

## Implementation Plan
### Phase 1: Foundation
Build the pure module (`devServerFailure.ts`): the start outcome and the counting rules, tested on their own. Extract `readDeclaredDevServer` and switch the baseline to it. Remove `withDevServer` from the lifecycle.

### Phase 2: Core Implementation
Make the scenario phase start only the declared server, through `withHealthyDevServer`, and report the start outcome. Make the scenario fix loop hand a failed start straight back. Build `runReviewRetryLoop`: a failed start becomes a blocker with the output, it goes through `executeReviewPatchCycle`, a new start attempt follows, and the counter has a cap and a reset.

### Phase 3: Integration
Replace the five inline review loops with `runReviewRetryLoop`. Escalate a chore whose server did not start. Stop `adwPlanBuildTest` at `review_failed`. Update every test double of the scenario phase, the barrels, ADR-0062's `### Confirmation`, the README and `adws/README.md`. Run the full validation.

## Step by Step Tasks
Execute every step in order, top to bottom.

### 1. Read the specification
- Read `specs/prd/review-proof-redesign.md`: the **Dev-server failure handling** decision, the testing decision for it, and user stories 44–47.
- Read ADR-0062 in full, and ADR-0060's note that the baseline's start parks and leaves the review counter alone.
- Read ADR-0048's `review_failed` gate. Do not change any decision.

### 2. Add the pure start-outcome and counter module
- Create `adws/core/devServerFailure.ts` with no imports. It holds the enum, the union, the `ReviewAttempts` record, the constants and the five functions, exactly as the Solution Statement describes them.
- `countStartedServer` resets only when `lastStartFailed` is true: a server that keeps starting never erases real review failures, so the cap stays reachable.
- `countFailedReview` clears `lastStartFailed`.
- `serverOutputTail` behaves as follows:
  - output of at most `SERVER_OUTPUT_TAIL_CHARS` characters comes back with its trailing whitespace trimmed;
  - longer output becomes a marker line naming how many earlier characters were left out, followed by the last `SERVER_OUTPUT_TAIL_CHARS` characters;
  - empty or whitespace-only output becomes `(no output)`.
- Export the module from `adws/core/index.ts`.
- Create `adws/core/__tests__/devServerFailure.test.ts`:
  - **increment**: `countFailedStart` adds one to `failed` and `total` and sets `lastStartFailed`; three in a row make `isReviewBudgetSpent(…, 3)` true, and two do not;
  - **reset**: after failed starts, and also after failed reviews followed by a failed start, `countStartedServer` brings `failed` to 0 and keeps `total`;
  - **no reset without a failed start**: after failed reviews, `countStartedServer` changes nothing;
  - `countFailedReview` adds one to both counts and clears `lastStartFailed`;
  - `serverOutputTail` for a short output, a long output (it keeps the end, with the marker) and an empty one.

### 3. Share "the server the repository declares" with the baseline
- Create `adws/phases/declaredDevServer.ts` with `readDeclaredDevServer(checkoutPath: string): string | null`. It reads `.adw/commands.md` under the checkout and returns `declaredDevServerCommand(content)`; a file that cannot be read gives `null`. Import `declaredDevServerCommand` from `../core/baselineGate`.
- In `adws/phases/baselinePhase.ts`, replace the private `rawCommandsMd` and the `declaredDevServerCommand(rawCommandsMd(…))` call with `readDeclaredDevServer(checkout.path)`. Drop the imports that are no longer used.
- Create `adws/phases/__tests__/declaredDevServer.test.ts` over a temp directory:
  - a declared command is returned as written, `{PORT}` included;
  - `N/A`, an empty section, a missing section and a missing file all give `null`.
- The baseline tests must pass unchanged.

### 4. Remove "run the work anyway" from the lifecycle
- In `adws/core/devServerLifecycle.ts`, delete `withDevServer` and its doc comment, and rewrite the module header. Keep every other export.
- In `adws/core/__tests__/devServerLifecycle.test.ts`, delete the `describe('withDevServer', …)` block and the `withDevServer` import. Keep the `substitutePort`, `spawnServer`, `probeHealth`, `killProcessGroup` and constants blocks.
- `grep -rn "withDevServer" adws features` must then show only the scenario-phase code and tests that the next step rewrites. Historical, dated records (ADR-0061's `### Confirmation`, old `specs/issue-*.md` plans) stay as they are.

### 5. The scenario phase starts only the declared server and reports the start
- In `adws/phases/scenarioTestPhase.ts`:
  - add `ScenarioTestPhaseDeps` (`readDeclaredDevServer`, `withHealthyDevServer`), the `deps` parameter, the exported `ScenarioTestPhaseResult` with `devServer: DevServerStart`, and a `DEV_SERVER_LOG_FILE = 'dev-server.log'` under `config.logsDir`;
  - the skipped phase returns `NO_DEV_SERVER_START`;
  - no declared server: run the proof directly and report `NotStarted`;
  - a declared server: `withHealthyDevServer` around `runProof`.
    - `started` gives today's proof handling and `Started`.
    - Otherwise call a named helper. It clears `config.ctx.scenarioProof`, logs and appends the failure with `serverOutputTail(output)`, records the phase cost as `Failed`, and returns `scenarioProof: undefined` with the `Failed` start (`command` with the port substituted, `healthUrl`, the full `output`).
  - Keep the file under 300 lines. Import `DevServerStartStatus`/`NO_DEV_SERVER_START` from `../core/devServerFailure`, and the lifecycle functions from `../core/devServerLifecycle`. The tests mock the `../core` barrel wholesale.
- Rewrite `adws/phases/__tests__/scenarioTestPhase.test.ts` and `scenarioTestPhase.runner.test.ts` without `vi.mock` of `withDevServer`:
  - the "with dev server" cases inject `readDeclaredDevServer: () => '<command>'` and a fake `withHealthyDevServer` that records its config and runs the work;
  - the "without dev server" cases inject `readDeclaredDevServer: () => null`;
  - the port, health path and command assertions read the fake's recorded config.
- Keep `scenarioTestPhase.helpers.ts`'s `makeConfig` working. Add a `fakeLifecycle` helper there, modelled on `fakeHealthyServer` in `baseScenarioRerun.helpers.ts`: `'starts'` or `{ output }`.
- Create `adws/phases/__tests__/scenarioTestPhase.server.test.ts` (fake lifecycle):
  - a declared server that does not start:
    - `runScenarioProof` is not called;
    - `devServer` is `Failed`, with the fake's output, `bun run dev --port 4567` (substituted) and `http://localhost:4567/health`;
    - `scenarioProof` is `undefined`;
    - a stale `config.ctx.scenarioProof` is cleared;
    - the phase cost status is `failed`;
  - a declared server that starts: the scenarios run inside the lifecycle's work, and `devServer` is `Started`. The lifecycle receives the declared command, the port parsed from `applicationUrl`, the health path, the worktree as `cwd`, and `outputPath` under `logsDir`;
  - no declared server, while `projectConfig.commands.startDevServer` holds the parser default `bun run dev`: the lifecycle is not called, the scenarios run, and `devServer` is `NotStarted`;
  - no scenarios configured: neither the reader nor the lifecycle is called, and `devServer` is `NotStarted`.

### 6. The scenario fix loop hands a failed start to the review loop
- In `adws/phases/scenarioTestFixLoop.ts`:
  - add `devServer: DevServerStart` to `ScenarioTestFixLoopResult`, and track the last one, starting at `NO_DEV_SERVER_START`;
  - directly after each scenario phase, a `Failed` start appends a line and returns `{ scenarioProof: undefined, scenarioProofPath: '', scenarioRetries, devServer }`. This check goes before the pass check, which treats `scenarioProof === undefined` as "no scenarios";
  - add `devServer` to every other return.
  - Extend the header comment's list with one line: a failed start goes to the review loop, not to the fix agent.
- In `adws/phases/__tests__/scenarioTestFixLoop.test.ts`:
  - `makePassingProof`/`makeFailingProof` gain `devServer: { status: 'not_started' }`;
  - add a case: a failed start on the first run returns the failed start with `scenarioRetries: 0`. `executeScenarioFixPhase`, the fidelity agent and the pre-existing-regression gate are not called;
  - add a case: a failed start after one fix round returns with `scenarioRetries: 1`.
- In `scenarioTestFixLoop.regression.test.ts`, the scenario phase fakes gain `devServer`.

### 7. Build the review retry loop
- Create `adws/phases/reviewRetryLoop.ts` as the Solution Statement describes:
  - `serverStartBlocker` and `recordFailedStartReview`;
  - `scenarioOutcomeOf`, `REVIEW_RETRY_PHASES` and `runReviewRetryLoop`;
  - a named per-attempt helper, so that nesting stays within two levels.
- Imports: `MAX_REVIEW_RETRY_ATTEMPTS`, `log` and `AgentStateManager` from `../core`; `runPhase`/`CostTracker` from `../core/phaseRunner`; the counter from `../core/devServerFailure`; `MAX_START_ATTEMPTS` from `../core/devServerLifecycle`; `postIssueStageComment` from `./phaseCommentHelpers`; the phases from `./reviewPhase` and `./scenarioTestPhase`.
- State-log lines name the count:
  - "Review attempt failed (n/m): the dev server did not start on the issue branch";
  - "Dev server started after a failed start: the failed-review count is reset to 0";
  - "Review budget spent: n failed review attempt(s) of m, failed starts included".
- Create `adws/phases/__tests__/reviewRetryLoop.test.ts`: **the acceptance criterion's fake-lifecycle tests**.
  - Setup:
    - drive the real `executeScenarioTestPhase` through `phases.executeScenarioTestPhase = cfg => executeScenarioTestPhase(cfg, { readDeclaredDevServer: () => 'bun run dev --port {PORT}', withHealthyDevServer: scriptedLifecycle })`;
    - the scripted lifecycle answers each start with a scripted `fail(output)` or `start`;
    - mock `runScenarioProof` with a passing proof and `runPhase` as `fn(config)`;
    - the review agent phase and the patch cycle are `vi.fn` fakes, `maxAttempts` is 3, and the start passed in is the failed start of a first run.
  - **Blocker with output**: on a failed start the review agent is not run. `executeReviewPatchCycle` receives exactly one blocker: `issueSeverity: 'blocker'`, `remediationStrategy: 'patch'`, and a description holding the output, the command and the health URL. No scenario proof was produced for that start.
  - **New start after the patch**: the lifecycle's next start comes after the patch cycle (invocation order).
  - **Increment and cap**: every start fails, so there are 3 failed attempts, 2 patches, no review agent run, `reviewPassed: false` and `reviewRetries: 3`.
  - **Reset**: starts fail, fail, then succeed, and the review then fails every time. After the reset the review gets the whole budget: 3 review agent runs, `reviewRetries` 5, `reviewPassed: false`. Without the reset the loop would have stopped after one review.
  - **Reset lets a later pass through**: fail, fail, start → review fails; start → review fails; start → review passes. The result is `reviewPassed: true`.
  - `ctx.reviewIssues` holds the server blocker after a failed start. With a `repoContext` whose `commentOnIssue` is a `vi.fn`, a `review_failed` comment containing the output is posted.
- Create `adws/phases/__tests__/reviewRetryLoop.counter.test.ts`, the loop over scripted `ScenarioOutcome`s:
  - **a healthy server never resets**: reviews fail on `Started` outcomes, and the loop stops after 3 reviews;
  - **no server declared**: on `NotStarted` it behaves exactly like the old loop (3 reviews, 2 patches, `reviewRetries` 3, and a pass after a patch returns at once);
  - `ctx.reviewAttempt`/`ctx.maxReviewAttempts` are 1/3 on the first review, and 1/3 again on the first review after a reset;
  - `maxAttempts` 0: no review, no patch, `reviewPassed: false`.

### 8. Export the loop
- Add the loop's exports to `adws/phases/index.ts` and `adws/workflowPhases.ts`, next to `runScenarioTestFixLoop`.

### 9. Use the loop in the review orchestrators
- `adws/adwSdlc.tsx`: `const scenarios = await runScenarioTestFixLoop(config, tracker); const { reviewPassed, reviewRetries } = await runReviewRetryLoop(config, tracker, scenarios);`. `scenarioRetries` comes from `scenarios`. Delete the inline loop and the imports it alone used (`MAX_REVIEW_RETRY_ATTEMPTS`, `executeReviewPhase`, `executeReviewPatchCycle`, `executeScenarioTestPhase`, `ReviewIssue`).
- `adws/adwPlanBuildTestReview.tsx`: the same, with `phases.runScenarioTestFixLoop` and `phases` passed to the loop.
- `adws/adwPlanBuildReview.tsx`: `runReviewRetryLoop(config, tracker, scenarioOutcomeOf(scenarioResult), phases)`.
- `adws/adwPrReview.tsx`: `const { reviewPassed } = await runReviewRetryLoop(config.base, tracker, await runScenarioTestFixLoop(config.base, tracker));`. Everything after the loop is unchanged.
- Keep `PlanBuildReviewPhases`/`PlanBuildTestReviewPhases` as they are. They keep naming `executeReviewPhase`, `executeReviewPatchCycle` and `executeScenarioTestPhase`, and the loop receives them through `phases`.
- In `adws/__tests__/adwPlanBuildTestReview.test.ts` and `adwPlanBuildReview.test.ts`:
  - add `appendLog: vi.fn()` to the `AgentStateManager` mock;
  - the scenario fakes return `devServer: { status: 'not_started' }`;
  - the existing cases must pass unchanged (3 reviews, 2 patches, `totalReviewRetries: 3`, `review_failed`, no PR);
  - add a describe "the dev server does not start on the issue branch". The scenario phase (or fix loop) reports a failed start every time. The review agent is never run, the patch cycle receives the server blocker twice, the stage written is `review_failed`, no PR is opened and no proof is published, and a comment carries the output and `## Retry`;
  - add one case where the server starts again after two failed starts and the review then passes. The run ends at `awaiting_merge` with the PR opened.

### 10. `adwChore`: a failed start escalates the chore into the review loop
- In `adws/adwChore.tsx`:
  - `const scenarios = await phases.runScenarioTestFixLoop(config, tracker)`;
  - after the diff evaluation, `const startFailed = scenarios.devServer.status === DevServerStartStatus.Failed`;
  - escalate when `diffResult.verdict !== 'safe' || startFailed`;
  - `postEscalationComment(config, startFailed ? ChoreEscalation.DevServerDidNotStart : ChoreEscalation.RegressionPossible)`. The regression-possible text is unchanged;
  - `runReviewRetryLoop(config, tracker, scenarios, phases)` replaces `runEscalatedReviewLoop`;
  - `stopAfterFailedReview` and the final metadata write take `diffResult.verdict` as `diffVerdict`;
  - the file stays under 300 lines.
- In `adws/__tests__/adwChore.test.ts`:
  - add `appendLog` to the mock, and `devServer` to the fakes;
  - the existing cases must pass unchanged;
  - add the cases below.

  | Diff verdict | Starts | Expected |
  | --- | --- | --- |
  | `safe` | always fail | The chore escalates: the server comment is posted, not the regression one. The review agent is never run, the patch cycle runs twice with the server blocker, and the run stops at `review_failed`: no document phase, no PR, no pre-approval. The metadata holds `diffVerdict: 'safe'`, `reviewPassed: false` and `totalReviewRetries: 3`. |
  | `safe` | start again after one failure | The review passes, the chore is documented, its PR is opened and pre-approved, and the run ends at `awaiting_merge`. |

### 11. `adwPlanBuildTest`: a failed start ends the review-less run at `review_failed`
- In `adws/adwPlanBuildTest.tsx`:
  - extract `PlanBuildTestPhases` (baseline, install, plan, build, step definitions, unit tests, `runScenarioTestFixLoop`, PR, proof publish) and `executePlanBuildTest(config, phases)`;
  - guard `main()` with `if (import.meta.url === \`file://${process.argv[1]}\`)`, as `adwPlanBuildReview.tsx` does;
  - after the fix loop, a `Failed` start does four things:
    1. calls `recordFailedStartReview(config, scenarios.devServer)`;
    2. calls `executeSdlcReviewFailedHandoff({ adwId, issueNumber, repoContext, ctx })`;
    3. writes the metadata: `unitTestsPassed`, `totalTestRetries`, `scenarioRetries`, `reviewPassed: false`, `totalReviewRetries: 1`;
    4. persists the token counts and returns, before the PR, the proof publish and `completeWorkflow`.
  - Add a one-line comment saying why: the orchestrator has no review patch loop, so the failed review has no attempt left to patch with.
- Create `adws/__tests__/adwPlanBuildTest.test.ts`, mocked like `adwPlanBuildTestReview.test.ts` (with `completeWorkflow` mocked in `../workflowPhases`):
  - a failed start writes `review_failed`, opens no PR, publishes no proof and does not call `completeWorkflow`, and the comment names the output and `## Retry`;
  - a run whose server starts or is not declared opens the PR, publishes the proof and completes, as today.

### 12. Keep the per-issue fake phases honest
- In `features/per-issue/step_definitions/feature-927-phases.ts`, `buildFakePhases`' `runScenarioTestFixLoop` and `executeScenarioTestPhase` fakes also return `devServer: { status: DevServerStartStatus.NotStarted }`. Import the enum from `adws/core/devServerFailure.ts`, with the `.ts` extension, as the file's other imports do.
- No `.feature` file is edited.

### 13. Correct the base re-run comment
- In `adws/phases/baseScenarioRerun.ts`, the comment above `runLocated`'s server branch says the change's own server "is stopped by a timer". The scenario phase now stops it and waits for it, but the wait gives up after `KILL_GRACE_MS + PROBE_INTERVAL_MS`. Reword it so that it still explains why the base run waits for the port. The code does not change.

### 14. Record the implemented check in ADR-0062
- Replace the `### Confirmation` paragraph of `specs/adr/0062-dev-server-start-failure-is-a-failed-review.md` with "Implemented. Checked on <date> in the working tree on top of `<commit>`:" and bullets in ADR-0060's style. The bullets name:
  - the lifecycle: `withDevServer` is gone; `withHealthyDevServer` never runs work against a server that did not start;
  - the scenario phase: `executeScenarioTestPhase` starts the server `readDeclaredDevServer` reads, the way the baseline does, and on a failed start runs no scenario and returns `DevServerStart` `failed` with the output;
  - the fix loop, which hands the failed start back;
  - the loop: `runReviewRetryLoop`, with `serverStartBlocker` carrying the output into `executeReviewPatchCycle`, a new start after every patch, and `countFailedStart`/`countStartedServer`/`countFailedReview`/`isReviewBudgetSpent` in `adws/core/devServerFailure.ts`. The reset fires on a start that follows a failed start;
  - the orchestrators:
    - `adwSdlc`, `adwPlanBuildReview`, `adwPlanBuildTestReview` and `adwPrReview` use the loop;
    - `adwChore` escalates a failed start into it;
    - `adwPlanBuildTest` stops at `review_failed`;
  - the baseline, which still parks as `base_server_down` with the counter untouched;
  - the unit tests (the files of tasks 2–11);
  - the scenarios under `@adw-993`.
- Leave the frontmatter, the decision and `specs/adr/README.md` as they are; the supersession of ADR-0031 is already recorded.

### 15. Update the READMEs
- `README.md`:
  - in the **Multi-agent passive review with blocking gate** bullet, or a new bullet beside it, state the rule. A dev server that does not start on the issue branch is a failed review: no scenario runs, the builder gets a blocker with the server's output through the review patch loop, each failed start uses one review attempt up to `review_failed`, and a start after a failed start resets the count. The baseline still parks;
  - add `devServerFailure.ts`, `declaredDevServer.ts` and `reviewRetryLoop.ts` to the trees;
  - say in the `devServerLifecycle.ts` tree line that the work never runs against a server that did not start.
  - The worktree already holds an uncommitted `junit-report.xml` tree line that is not part of this issue. Leave it as it is.
- `adws/README.md`:
  - the scenario-phase paragraph at line 891 adds that a server that does not start is a failed review and no scenario runs;
  - the `phases` list gains `reviewRetryLoop.ts` and `declaredDevServer.ts`.

### 16. Run the validation commands
- Run every command under `Validation Commands`, in order, and fix every failure before finishing.

## Testing Strategy
### Unit Tests
The PRD's testing decision for this module: "a failed start becomes a blocker with the output; the counter increments; a successful start resets it; cap reaches `review_failed`. Fake lifecycle." Every test feeds a module its inputs and asserts the decision or result it returns. None asserts private calls.

- `adws/core/__tests__/devServerFailure.test.ts` (pure):
  - increment per failed start;
  - the cap through `isReviewBudgetSpent`;
  - a reset only after a failed start, keeping `total`;
  - no reset for a server that has kept starting;
  - `countFailedReview`;
  - the output tail: short, long and empty.
- `adws/phases/__tests__/declaredDevServer.test.ts`: a declared command; `N/A`, empty, a missing section and a missing file give `null`.
- `adws/phases/__tests__/scenarioTestPhase.server.test.ts` (fake lifecycle):
  - a failed start runs no scenario, reports the output, the substituted command and the health URL, clears `ctx.scenarioProof` and records a failed cost status;
  - a start runs the scenarios inside the lifecycle with the right config;
  - an undeclared server, despite the parser's `bun run dev` default, runs without the lifecycle;
  - a skipped phase never touches the server.
- `adws/phases/__tests__/scenarioTestPhase.test.ts` and `scenarioTestPhase.runner.test.ts`: today's assertions, over an injected fake lifecycle in place of a module mock of `withDevServer`.
- `adws/phases/__tests__/scenarioTestFixLoop.test.ts` (and `.regression.test.ts`): a failed start returns at once, with no fix agent, no fidelity check, no regression gate and no scenario retry counted, both on the first run and after a fix round.
- `adws/phases/__tests__/reviewRetryLoop.test.ts` (real scenario phase over a fake lifecycle):
  - **blocker with output**;
  - the patch is followed by a new start attempt;
  - **increment** and **cap** (`reviewPassed: false`, which every caller turns into `review_failed`);
  - the **reset** gives the review its full budget back;
  - a pass after the reset;
  - the `review_failed` comment carries the output.
- `adws/phases/__tests__/reviewRetryLoop.counter.test.ts`:
  - a server that starts every time never resets, so the cap is reached;
  - no server: the old loop exactly;
  - the attempt number on the context;
  - `maxAttempts` 0.
- `adws/__tests__/adwPlanBuildTestReview.test.ts`, `adwPlanBuildReview.test.ts`: a failed start reaches `review_failed` with no PR; a recovered server reaches `awaiting_merge`; every existing case is unchanged.
- `adws/__tests__/adwChore.test.ts`: a failed start escalates a `safe` chore, with its own comment, and stops at `review_failed` with `diffVerdict: 'safe'`; recovery documents, opens and pre-approves; every existing case is unchanged.
- `adws/__tests__/adwPlanBuildTest.test.ts`: a failed start stops at `review_failed` without a PR; a healthy run is unchanged.
- `adws/core/__tests__/devServerLifecycle.test.ts`: without the `withDevServer` block; `devServerLifecycle.healthy.test.ts` unchanged.
- The baseline tests (`baselinePhase*.test.ts`, `baseScenarioRerun*.test.ts`) unchanged and green, since the baseline's behaviour does not change.

### Edge Cases
- **No `## Start Dev Server`, `N/A`, or an empty section.** No server is started, the scenarios run, and no review attempt is used. This holds although `parseCommandsMd` fills the parsed config with `bun run dev`.
- **The server fails on the first scenario run.** This happens inside the scenario fix loop, so the review loop opens with a failed start. The review agent never runs on that attempt, and no scenario ran either.
- **The server fails after a scenario fix round,** because the fix agent broke it. The fix loop returns the failed start with `scenarioRetries` 1, and the review loop takes over.
- **The server fails after a review patch.** It counts as a failed review, the server blocker is patched, and the server is started again.
- **The server keeps failing until the cap.** `review_failed`, with the server blocker as the remaining blocker, the output in the comment, and `## Retry`.
- **The server starts again after one or more failed starts.** The count goes to 0, and `totalReviewRetries` keeps counting. The next `review_running` comment shows "Attempt: 1/3".
- **A healthy server in a `web` repository.** Starts never reset the count, so a review whose blockers persist reaches `review_failed` after `MAX_REVIEW_RETRY_ATTEMPTS` reviews, as today.
- **A flaky start** (slow machine, port in use) costs one attempt. A later start resets the count (ADR-0062 accepts this).
- **The alternation limit.** A builder who breaks the server, then fixes it, then fails the review, again and again, resets the count each cycle and is not stopped by the cap. This is accepted, like the static-check fix loop's alternating outputs; the operator can `## Cancel`.
- **Empty server output** becomes `(no output)`. Huge output keeps its last `SERVER_OUTPUT_TAIL_CHARS` characters behind a marker. Backticks in the output cannot close the code fence.
- **`MAX_REVIEW_RETRY_ATTEMPTS=1`.** A failed start spends the budget at once and goes to `review_failed` without a patch, consistent with a one-attempt review today. With `0`, no review and `review_failed`, as today.
- **A chore the diff judge rules `safe` whose server did not start** escalates into the review loop and is never auto-merged on scenarios that did not run.
- **`adwPlanBuildTest`** stops at `review_failed` at once, without a PR.
- **`adwPrReview`.** Its failed outcome goes through `completePRReviewWorkflow` to `review_failed`.
- **A stale proof or stale screenshots** from an earlier attempt are cleared on a failed start, so neither the comment nor the PR shows evidence from a run that did not happen.
- **A patch that deletes the `## Start Dev Server` declaration.** No server is started on the next run, so a `web` repository's scenarios fail on connection errors and reach the reviewer, who sees the diff. The blocker's resolution forbids the edit. No code guards review patches here (out of scope).
- **The baseline.** A base-branch start failure still parks as `base_server_down`, with the review counter untouched. The base re-run still reports `not run` when the base server does not start.
- **Resume after `## Retry`.** A new process starts with the count at 0.

## Acceptance Criteria
- On the issue branch, a dev server that does not start after the lifecycle's retries:
  - runs no scenario;
  - produces a review blocker (`issueSeverity: 'blocker'`, `remediationStrategy: 'patch'`) whose description carries the server's output (its tail), the start command and the health URL;
  - sends that blocker through `executeReviewPatchCycle`.
- The builder's patch (the patch agent, build agent, commit and push) is followed by a new start attempt.
- Each failed start increments the review attempt counter. At `MAX_REVIEW_RETRY_ATTEMPTS` the issue goes to `review_failed` exactly as an exhausted review does: no document phase, no PR, and the `review_failed` comment with `## Retry`. This holds in `adwSdlc`, `adwPlanBuildReview`, `adwPlanBuildTestReview`, `adwChore` (escalated even when the diff judge says `safe`) and `adwPrReview`. `adwPlanBuildTest`, which has no review loop, stops at `review_failed` without a PR.
- After a successful start that follows a failed start, the counter is zero (`ReviewAttempts.failed === 0`, and the next review shows "Attempt: 1/m"). A server that keeps starting never resets the counter.
- `adws/core/devServerLifecycle.ts` no longer has `withDevServer` or any path that runs work against a server that did not start.
- The scenario phase starts only the server the repository declares, the one the baseline starts.
- The baseline is unchanged: a base-branch start failure parks as `base_server_down`, and its tests pass unchanged.
- Unit tests with a fake lifecycle cover: blocker with output, increment, reset, cap (`reviewRetryLoop.test.ts`), plus the pure counter, the scenario phase over the fake lifecycle, the fix loop's hand-back and the orchestrators' `review_failed` stop.
- The `### Confirmation` section of ADR-0062 names the implemented check: the modules, functions, orchestrators, unit tests and scenarios.
- Every validation command passes.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint`: lint, including the new modules and tests.
- `bunx tsc --noEmit`: root type check. It covers `features/**/*.ts`, so it includes the updated `feature-927-phases.ts`.
- `bunx tsc --noEmit -p adws/tsconfig.json`: the additional type check of `adws/`.
- `bun run build`: build.
- `bun run test:unit`: the whole Vitest suite.
- `bunx vitest run adws/core/__tests__/devServerFailure.test.ts adws/core/__tests__/devServerLifecycle.test.ts adws/core/__tests__/devServerLifecycle.healthy.test.ts adws/phases/__tests__/declaredDevServer.test.ts adws/phases/__tests__/scenarioTestPhase.test.ts adws/phases/__tests__/scenarioTestPhase.runner.test.ts adws/phases/__tests__/scenarioTestPhase.server.test.ts adws/phases/__tests__/scenarioTestFixLoop.test.ts adws/phases/__tests__/scenarioTestFixLoop.regression.test.ts adws/phases/__tests__/reviewRetryLoop.test.ts adws/phases/__tests__/reviewRetryLoop.counter.test.ts adws/phases/__tests__/baselinePhase.test.ts adws/phases/__tests__/baselinePhase.directives.test.ts adws/phases/__tests__/baseScenarioRerun.test.ts adws/phases/__tests__/baseScenarioRerun.server.test.ts adws/__tests__/adwPlanBuildTestReview.test.ts adws/__tests__/adwPlanBuildReview.test.ts adws/__tests__/adwChore.test.ts adws/__tests__/adwPlanBuildTest.test.ts`: this feature's tests and the baseline's, in isolation.
- `grep -rn "withDevServer" adws`: must print nothing.
- `bun run lint:git-guard`: no raw `git`/`gh` in the new code.
- `bun run lint:branch-names`: no branch name written into `adws/`.
- `bun run lint:docs-index`: the docs-index gate stays green.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-993"`: this issue's scenarios.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-990 or @adw-992 or @adw-927"`, which re-runs three earlier issues' scenarios:
  - `@adw-990`: the baseline still parks on a base-branch start failure;
  - `@adw-992`: the real scenario phase still starts a declared dev server and stops it by the end of the phase. Its fresh-repository scenario installs from the npm registry and downloads Chromium, so it needs network access;
  - `@adw-927`: the orchestrators driven over the updated fake phases.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"`: the regression suite, including the chore smoke's "Chore Escalation: Regression Possible" text and the surface rows that run the real scenario and review phases.

## Notes
- Follow `.adw/coding_guidelines.md` strictly:
  - files under 300 lines (`adwChore.tsx` and `scenarioTestPhase.ts` included);
  - guard clauses and nesting ≤ 2, so the per-attempt judgement of the loop is a named function;
  - `readonly` types and enums for the start status and the chore escalation reason;
  - the pure counter in `adws/core/`, side effects in `adws/phases/`;
  - comments only for invariants and non-obvious reasons, with no issue numbers.
- **When the reset fires** is the one point of interpretation. The decision says the count "resets to zero" when the server starts, so the plan resets it to zero, not to the number of real review failures. The trigger is a start that follows a failed start: "once that problem is solved" (the owner), and "the count resets when it starts" (the issue title). A reset on every start would make the cap unreachable for every `web` repository, whose server starts on every re-test, and the decision's "at the cap the issue goes to `review_failed` as for any failed review" would fail. The decision itself is not changed.
- **Why a failed start skips the review agent.** No scenario ran, so the reviewer would judge without evidence. The failed start is the review's verdict ("treat a failing start as a failed review").
- **The undeclared default.** Starting only a declared server changes one thing. A repository without a `## Start Dev Server` section no longer has `bun run dev` attempted (three 20-second probes) before its scenarios. `adw_init` writes the section for every repository (`N/A` for `cli`), and every upgrade regenerates it, so no initialised repository is affected. The rule now matches the baseline's, and ADR-0062's premise, a server the baseline showed starting on the base branch, holds.
- **The server output goes into issue comments**, both the per-attempt and the final `review_failed` comment, as the baseline's `base_server_down` park comment already does. It is cut to its tail, which also keeps the comment within GitHub's size limit and the patch agent's argument within the command-line limit.
- **`adwPlanBuildTest` stops instead of patching.** It has no review patch loop and no reviewer. Giving it one would add a review stage to an orchestrator that has none, which is out of scope. It never opens a pull request on scenarios that did not run, and `## Retry` after a pushed fix re-runs it.
- **Out of scope**, each its own PRD module or issue:
  - reaching review only when the scenarios are green (user story 55);
  - `adwPlanBuildReview` adopting `runScenarioTestFixLoop`;
  - the proof assembler;
  - the review prompt's changes;
  - a guard on review patches;
  - switching `baseScenarioRerun`'s `isDevServerConfigured(project.commands.startDevServer)` to the declared reader.
- **No new library** is needed.
- `features/per-issue/feature-993.feature` is written by the scenario agent. The validation runs it by `@adw-993`. Aligning this plan with it is the alignment phase's job.
- **The document phase** updates `app_docs/feature-9gjajh-dev-server-and-ports.md` and `app_docs/feature-9gjajh-test-and-scenario-phases.md`, which still describe `withDevServer` and its "always calls `work()`" rule, along with the orchestrator and review module docs.
