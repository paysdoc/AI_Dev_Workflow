# Feature: Baseline on the base branch before any work; pre-existing regression failures park instead of going to the fix agent

## Metadata
issueNumber: `990`
adwId: `y9z5ie-feat-baseline-on-the`
issueJson: `{"number":990,"title":"feat: baseline on the base branch before any work; pre-existing regression failures park instead of going to the fix agent","body":"Source: `specs/prd/review-proof-redesign.md` and the ADR named below, in `specs/adr/`. The PRD section **Implementation Decisions** describes the module; the ADR holds the decision and its reasons. Read both before planning; they are the specification. Do not change the decisions.\n\n## Decision record\n\nADR-0060. PRD module: **Baseline gate**.\n\n## What to build\n\n- Before the plan phase, in every orchestrator that runs gates: check out the base branch in a separate worktree, run the check runner there, and start the dev server there where `.adw/commands.md` declares one (existing lifecycle module; a failed start parks, it does not count as a failed review). A red baseline parks the issue as `human_gated` with the `baseline_red` or `base_server_down` park comment.\n- Directives: `## Retry` re-runs the baseline and parks again if red. `## Continue` records a waiver; the run proceeds and the fix loop fixes everything, pre-existing failures included.\n- The baseline records that it passed, so the fix loops can treat every later failure as introduced by the change.\n- A single-scenario re-run on the base branch, exposed to the scenario fix loop: when a `@regression` scenario fails on the change, run just that scenario in the base worktree. If it fails there too it is pre-existing: it is not sent to the fix agent, and the issue parks as `human_gated` with the `pre_existing_regression` comment (the scenario, that it also fails on the base branch, both directives).\n- No full regression run on the base branch.\n\n## Acceptance criteria\n\n- [ ] An issue on a red base parks before any plan is written, with the comment described; `## Retry` and `## Continue` behave as described.\n- [ ] A regression scenario that fails on both branches never reaches the fix agent and parks the issue; one that fails only on the change goes to the fix agent as today.\n- [ ] The base worktree is removed when the run ends, including on failure.\n- [ ] Unit tests with a fake check runner, fake scenario runner and fake worktree: red parks, green records, waiver honoured, single re-run classifies pre-existing.\n- [ ] The `### Confirmation` section of ADR-0060 names the implemented check.\n\n## Blocked by\n\n#989\n","state":"OPEN","author":"paysdoc","labels":["adw:feature"],"createdAt":"2026-10-03T23:13:12Z","comments":[],"actionableComment":null}`

## Feature Description
Issues #988 and #989 made type check, additional type checks, lint and build deterministic gates in the unit-test phase (`adws/core/checkRunner.ts`), behind an uncapped static-check fix loop that parks the workflow as `human_gated` when a round makes no progress (`adws/phases/workflowPark.ts`). They also added a park comment builder (`adws/forge/parkComment.ts`) that already knows the reasons `baseline_red`, `pre_existing_regression` and `base_server_down`, with their directive meanings, but nothing parks with them yet.

Nothing tells a failure the branch inherited from the base branch apart from one the change caused. A red `dev` is charged to the issue: the static-check fix loop tries to repair code the issue never touched. The scenario fix loop (`runScenarioTestFixLoop`) also sends every failing `@regression` scenario to the fix agent, including one that already fails on `dev`.

This issue implements the PRD's **Baseline gate** module, as decided in ADR-0060:

1. **A baseline phase runs first in every orchestrator that runs gates**, before the install and plan phases (in `adwTest`, before its unit-test phase). The orchestrators are `adwSdlc`, `adwChore`, `adwPlanBuild`, `adwPlanBuildDocument`, `adwPlanBuildReview`, `adwPlanBuildTest`, `adwPlanBuildTestReview`, `adwTest` and `adwPrReview`. The phase does four things:
   - checks the base branch out in a separate, detached worktree: `origin/<base>` at `.worktrees/base-issue-<N>-<adwId>`;
   - installs its dependencies (`## Install Dependencies`), without which no Node repository's checks could pass in a fresh checkout;
   - runs the check runner there (`runStaticChecks`, with the base branch's own `.adw/commands.md`);
   - where that file declares a `## Start Dev Server`, starts the server with the existing lifecycle (retries, health probe, process-group kill) and stops it again.

   A red baseline parks the issue as `human_gated` with the `baseline_red` comment (the failing checks, or the failing install) or the `base_server_down` comment (the server's output). A green baseline records `baseline: { status: 'passed', baseBranch, baseCommit, recordedAt }` in the top-level state. From then on every failure the fix loops meet was introduced by the change.
2. **Directives.**
   - `## Retry` keeps its handler (`human_gated` → `phase_timeout`). The resumed run re-runs the baseline phase, which the park left `running`, and parks again if the base is still red.
   - `## Continue` on a `baseline_red`, `base_server_down` or `pre_existing_regression` park records a waiver (`baseline: { status: 'waived', waivedPark, recordedAt }`) and re-arms the workflow the same way, in both triggers. The resumed run skips the base checks, and the fix loops fix everything, pre-existing failures included.
   - To tell which park a `## Continue` answers, `parkWorkflow` now also records `parkReason` in the top-level state, and every run start clears it.
3. **A single-scenario re-run on the base branch, in the scenario fix loop.** When `@regression` fails on the change, each failing scenario named in the JUnit report is run alone in the base checkout. The re-run tags the scenario `@adw-base-rerun` in that disposable checkout and runs `## Run Scenarios by Tag` for that tag, under the base's dev server when the change's run had one.
   - A scenario that fails there too is pre-existing. It never reaches the fix agent: the issue parks with the `pre_existing_regression` comment (the scenario, the base branch, both directives).
   - A scenario that passes on the base branch, or cannot be found there, was introduced and goes to the fix agent as today.
   - With a waiver, nothing is re-run and everything goes to the fix agent.
   - There is no full regression run on the base branch.
4. **Cleanup.** The base worktree is shared by the baseline and the re-runs of one process, and removed when that process exits: at a normal end, a park, an error or a pause, since every one of them ends in `process.exit`. Its `-issue-<N>-` name puts it in reach of `## Cancel`, the issue-close cleanup and the dev-server janitor when a process is killed. A stale one is replaced on the next run.
5. **The dev-server lifecycle gains a start that reports failure** (`withHealthyDevServer`): the same retries and probe as `withDevServer`, but it never runs the work against a server that did not start, and it returns the last attempt's output. `withDevServer` and the scenario phase are unchanged; changing them is ADR-0062's issue.
6. ADR-0060's `### Confirmation` names the implemented check.

Value: work is never built on a red base. A broken `dev` is reported on the first issue that meets it, with a comment that says what failed and what each directive does. The fix agent only ever works on what the issue changed.

## User Story
As an ADW operator
I want ADW to check the base branch before it does any work on an issue, and to re-run a failing regression scenario on the base branch before it hands it to the fix agent
So that a failure the branch inherited is never charged to the issue, a broken `dev` parks the issue with instructions instead of being "fixed" by every run, and I decide with `## Retry` or `## Continue` what happens next

## Problem Statement
- No orchestrator runs anything on the base branch before the plan phase. ADR-0060's Confirmation checked this at `origin/dev`. With a red `dev`, every issue's static-check fix loop tries to repair code the issue never touched, or stalls and parks with a misleading `fix_loop_stalled` comment.
- `adws/phases/scenarioTestFixLoop.ts` sends every failing scenario to the fix agent, including `@regression` scenarios that already fail on the base branch.
- The orchestrators have no second checkout of the base branch to run anything in (ADR-0060, Consequences).
- `withDevServer` (`adws/core/devServerLifecycle.ts`) runs the work anyway when the server never becomes healthy and tells its caller nothing, and it discards the server's output (`stdio: 'ignore'`). Nothing can tell that the base branch's server is down, or say why.
- `## Continue` means nothing on a park. The cron never acts on it, and on a `human_gated` issue the webhook only starts a fresh spawn through `classifyAndSpawnWorkflow`. Nothing records which park a workflow is in.
- The park reasons `baseline_red`, `pre_existing_regression` and `base_server_down` exist in `adws/forge/parkComment.ts`, but nothing parks with them.
- ADR-0060's `### Confirmation` says "Not yet implemented".

## Solution Statement
- **Baseline core (`adws/core/baselineGate.ts`, pure orchestration over injected ports; no agent, git, forge or state imports).**
  - `BaselineStatus` (`Passed`, `Waived`) and `BaselineRecord`, a union:
    - `{ status: Passed, baseBranch, baseCommit, recordedAt }`;
    - `{ status: Waived, waivedPark, recordedAt }`.
  - `isBaselineWaived(record)`.
  - `declaredDevServerCommand(commandsMd)` reads the raw `## Start Dev Server` section through `parseMarkdownSections`. It returns the command only when the section is present and configured (`isCheckConfigured`), because a missing section must not fall back to `getDefaultCommandsConfig()`'s `bun run dev`.
  - `runBaselineChecks({ commands, cwd, runProcess, startDevServer?, report? })` runs these steps in order:
    1. Install the dependencies (`installDeps`), unless it is `N/A`, or no check is configured and no server is declared. A non-zero exit → `checks_red` with one failure named `install dependencies`.
    2. `runStaticChecks(commands, cwd, runProcess)`. Any failed check → `checks_red` with every failed check.
    3. When a `startDevServer` port is given, start the server. Not healthy → `server_down` with its output.
    4. Otherwise `green`.
- **Regression triage core (`adws/core/regressionTriage.ts`, pure).**
  - Types:
    - `FailingScenario { name, feature? }`;
    - `BaseScenarioOutcome` (`Passed`, `Failed`, `NotRun`);
    - `ScenarioRerun`;
    - `RegressionTriage` (`waived` | `introduced` | `pre_existing` with the scenario).
  - `triageRegressionFailures({ failing, waived, rerunOnBase })`:
    - waived → `waived`, without re-running anything;
    - otherwise re-runs the failing scenarios one at a time, in order, and returns `pre_existing` at the first `Failed`;
    - `Passed` and `NotRun` both mean introduced.
  - Pure helpers for the re-run port:
    - `scenarioMatchesCase(scenarioName, caseName)` matches an exact name, plus cucumber-js's long naming (`<rule> - <name>`, `<name> - <examples> - #n.m…`);
    - `withRerunTag(content, headerLine, tag)` inserts the tag line directly above the scenario's keyword line, at its indentation;
    - `describeFailingScenario`.
- **Dev-server lifecycle (`adws/core/devServerLifecycle.ts`).**
  - `spawnServer(command, cwd, outputFd?)` sends output to `outputFd` when given; the default is still `stdio: 'ignore'`.
  - New `withHealthyDevServer(config & { outputPath }, work, deps?)`:
    - uses the same `MAX_START_ATTEMPTS`/`probeHealth`/`killProcessGroup` loop as `withDevServer`;
    - each attempt writes to `outputPath`, truncated, so the file holds the last attempt's output;
    - returns `{ started: true, result }` after running `work`, or `{ started: false, output }` without running it;
    - kills the process group in `finally`.
  - `extractPort` and `isDevServerConfigured` move out of `scenarioTestPhase.ts` as exported `devServerPort(applicationUrl)` and `isDevServerConfigured(command)`, with unchanged behaviour.
  - `withDevServer` is not changed.
- **Base worktree (`adws/phases/baseWorktree.ts`, typed `GitContext` methods only).**
  - `baseWorktreeName(issueNumber, adwId)` = `base-issue-<N>-<adwId>`.
  - `buildBaseWorktreePort(config, deps?)` returns `{ ensure(): BaseCheckout, remove(): void }`.
  - `ensure()`, on first use:
    - `removeWorktree(name)` clears a stale checkout from a killed run;
    - `fetchRemote(base, worktreePath)`;
    - `addDetachedWorktree(worktreePathFor(name), 'origin/<base>', worktreePath)`;
    - `copyEnvToWorktree`;
    - `headShort` records the commit;
    - registers one synchronous exit cleanup.
  - `remove()` calls `removeWorktree(name)`, which kills processes in the directory, removes or prunes it, and is idempotent.
  - `sharedBaseWorktree(config)` memoizes one port per adwId per process, so the baseline and the re-runs share one checkout.
- **Baseline phase (`adws/phases/baselinePhase.ts`).** `executeBaselinePhase(config, deps?)`:
  1. If the top-level `baseline` is waived, it logs that and returns, with no checkout.
  2. Otherwise it ensures the base checkout and loads the base's `.adw/` (`loadProjectConfig`, raw `commands.md`).
  3. It runs `runBaselineChecks` with the real process runner and, for a declared server, `withHealthyDevServer` on the run's port (`devServerPort(config.applicationUrl)`) with the base's health path, writing to `<logsDir>/base-dev-server.log`.
  4. It logs every result to the console and `execution.log`, with the full output of every failure.
  5. Then:
     - green → it records the passed baseline;
     - `checks_red` → `parkWorkflow(config, { reason: BaselineRed, baseBranch, failedChecks })`;
     - `server_down` → `parkWorkflow(config, { reason: BaseServerDown, baseBranch, output })`.
- **Base scenario re-run (`adws/phases/baseScenarioRerun.ts`).** `buildBaseScenarioRerun(config, deps?)` returns a `ScenarioRerun`. It installs the base checkout's dependencies once and memoizes one outcome per scenario per process. For one scenario it:
  1. finds the scenario in the base checkout's `*.feature` files under its `.adw/scenarios.md` scenario directory. It parses them with `adws/promotion/scenarioParser.ts` and, when the case has a classname, checks the `Feature:` title. Not found → `NotRun`.
  2. writes the file with `@adw-base-rerun` inserted above the scenario, and restores it in `finally`.
  3. runs `runScenariosByTag(<base runScenariosByTag>, 'adw-base-rerun', checkoutPath, { ADW_JUNIT_REPORT_PATH, ADW_PROOF_DIR })`, with both paths under `agents/<adwId>/baseline/`. When the change's run had a server (`isDevServerConfigured(commands.startDevServer)`, the scenario phase's own rule), it waits for the run's port to be free and runs inside `withHealthyDevServer`. A server that does not start → `NotRun`.
  4. reads the JUnit report:
     - `failed > 0` → `Failed`;
     - clean with `total > 0` → `Passed`;
     - absent or empty → `NotRun`.
- **Pre-existing regression gate (`adws/phases/preExistingRegressionGate.ts`).**
  - `failingRegressionScenarios(proof)` takes the failed cases of the `@regression` tag result. It returns `null` when that tag failed without per-case results.
  - `createPreExistingRegressionGate(config, deps?)` returns a function of the proof that reads the waiver from the top-level state, builds the real re-run lazily (only when a regression scenario failed) and calls `triageRegressionFailures`. It logs every outcome:
    - `pre_existing` → `parkWorkflow(config, { reason: PreExistingRegression, baseBranch: config.defaultBranch, scenario: describeFailingScenario(s) })`;
    - otherwise it returns.
- **Scenario fix loop (`adws/phases/scenarioTestFixLoop.ts`).** `runScenarioTestFixLoop` creates the gate once per call; `opts.preExistingRegressionGate` overrides it in tests. After a test run with blocker failures, the loop calls the gate before it computes the verdict or starts the fix phase. A pre-existing failure therefore never reaches `executeScenarioFixPhase`, even on the last attempt.
- **Park reason and `## Continue`.**
  - `parkWorkflow` writes `{ workflowStage: 'human_gated', parkReason: evidence.reason }`.
  - `initializeWorkflow`'s `starting` write and `initializePRReviewWorkflow`'s pid write clear `parkReason`, since a run that starts is no longer parked.
  - New `adws/triggers/continueHandler.ts`, mirroring `retryHandler.ts`:
    - pure `decideContinueAction(state)` → `waive_baseline` only for `human_gated` with a `parkReason` in `WAIVABLE_PARK_REASONS` (`baseline_red`, `base_server_down`, `pre_existing_regression`), else `not_a_baseline_park`;
    - `handleContinueDirective(issueNumber, comments, deps)` writes `{ workflowStage: 'phase_timeout', resumeAttempts: 0, baseline: { status: Waived, waivedPark, recordedAt } }` and returns true.
  - Wiring:
    - the webhook's `## Continue` branch calls it first and returns `continue_waived` when it acts, else keeps today's spawn path;
    - the cron's directive scan calls it when the latest comment is `## Continue`.
- **Orchestrators.**
  - Each of the nine runs `executeBaselinePhase` as its first phase inside the lifecycle: named `'baseline'`, so a resumed run skips a completed baseline and re-runs a parked one.
  - `adwPrReview` names it `'pr_review_baseline'`, because the issue's adwId already records the SDLC run's `baseline` as completed.
  - The injectable phase sets of `adwChore`, `adwPlanBuildReview` and `adwPlanBuildTestReview` gain `executeBaselinePhase`.
- **Records.** ADR-0060's `### Confirmation` names the implemented check. The README describes the baseline gate and lists the new files.

## Relevant Files
Use these files to implement the feature:

- `specs/prd/review-proof-redesign.md` — The specification: *Implementation Decisions* → **Baseline gate**, *Testing Decisions* → the baseline gate test list, *Further Notes* (the re-run shares the baseline's base-branch worktree). Read-only.
- `specs/adr/0060-baseline-gate-on-the-base-branch.md` — The decision: baseline first, the directive meanings, the single-scenario re-run, no baseline regression run, every park carries instructions, the base start parks (not a failed review). Its `### Confirmation` must be rewritten (acceptance criterion).
- `specs/adr/0062-dev-server-start-failure-is-a-failed-review.md` — The base-branch start is governed by ADR-0060 and parks; `withDevServer`'s "run anyway" is ADR-0062's to remove, not this issue's. Read-only.
- `specs/adr/0059-fix-loops-no-progress-stop-and-suppression-guard.md`, `specs/adr/0058-static-checks-in-the-test-phase-reviewer-runs-nothing.md`, `specs/adr/0032-explicit-cancel-and-retry-directives.md`, `specs/adr/0031-active-test-phase-passive-review-judge.md` — Context: the static-check gate and loop, the `## Retry`/`## Continue`/`## Cancel` directives, the dev-server lifecycle. Read-only.
- `specs/issue-989-adw-i5ekhk-feat-static-check-fi-sdlc_planner-static-check-fix-loop-guard.md` — The previous slice's plan: conventions for ports, parks, tests and the BDD harness this issue reuses.
- `README.md` — The "What it does" bullets (static-check gates, `## Retry`/`## Continue`) and the directory tree. It already has uncommitted directory-tree edits in this worktree; keep them.
- `.adw/coding_guidelines.md` — Must be followed:
  - guard clauses, nesting at most 2, extracted named functions;
  - string enums for named sets, `readonly`, no `any`, no `!`;
  - pure core with side effects at the edges;
  - comments only for invariants, ordering and non-obvious reasons (no issue numbers, banners or name-echoing JSDoc);
  - files under 300 lines.
- `.adw/commands.md` — The validation commands; ADW's own baseline runs these checks on the base branch. Read-only.
- `.github/adw.yml` — `unitTests` is commented out, so unit tests are enabled. Read-only.
- `adws/core/checkRunner.ts` — `runStaticChecks`, `CheckVerdict`, `CheckStatus`, `ProcessRunner`, `ProcessOutcome`, `runShellCommand`, `isCheckConfigured`. Reused unchanged by the baseline.
- `adws/core/projectConfig.ts` — `CommandsConfig` (`installDeps`, `startDevServer`, `healthCheckPath`, `runScenariosByTag`), `ScenariosConfig` (`scenarioDirectory`, `regressionScenarioDirectory`), `loadProjectConfig`, `parseMarkdownSections`, `getDefaultCommandsConfig` (defaults `startDevServer` to `bun run dev`, hence `declaredDevServerCommand`). Read-only.
- `adws/core/devServerLifecycle.ts` — `withDevServer`, `spawnServer`, `probeHealth`, `substitutePort`, `MAX_START_ATTEMPTS`, `PROBE_INTERVAL_MS`, `PROBE_TIMEOUT_MS`, `KILL_GRACE_MS`. Add `withHealthyDevServer`, `devServerPort` and `isDevServerConfigured`, and the optional output fd on `spawnServer`.
- `adws/core/processKill.ts`, `adws/core/portAllocator.ts` — `killProcessGroup` (SIGKILL after `KILL_GRACE_MS`, by timer) and `isPortAvailable`, used to wait until the change's server has let go of the port. Read-only.
- `adws/core/__tests__/devServerLifecycle.test.ts` — The existing lifecycle tests (mocked `child_process.spawn`, mocked `fetch`); already 421 lines, so the new function's tests go in a new file.
- `adws/phases/scenarioTestPhase.ts` — The private `extractPort`/`isDevServerConfigured` move to the lifecycle module. Its behaviour stays the same; `withDevServer` stays.
- `adws/phases/scenarioProof.ts` — `ScenarioProofResult`, `TagProofResult` (`resolvedTag`, `passed`, `skipped`, `cases`). The failing `@regression` cases come from here. Read-only.
- `adws/core/testReportParser.ts` — `readJUnitReport`, `TestCaseResult` (`name`, `classname`, `status`). Read-only.
- `node_modules/@cucumber/junit-xml-formatter/dist/src/makeReport.js` — How cucumber-js names a JUnit case: `classname` is the feature name, `name` uses the long naming strategy without the feature (`<rule> - <scenario>`, examples suffixed). Read-only reference for `scenarioMatchesCase`.
- `adws/agents/bddScenarioRunner.ts` — `runScenariosByTag(tagCommand, tag, cwd, env)`, the runner the re-run uses with the base's command. Read-only.
- `adws/promotion/scenarioParser.ts` — `parse(content)` returns each scenario's `name`, `tags` and `headerLine` (`@cucumber/gherkin`). Reused to find a scenario on the base branch. Read-only.
- `adws/phases/scenarioTestFixLoop.ts` — Integration point: call the pre-existing regression gate after a failing run, before the verdict and the fix phase. Its cap and the rest of its behaviour stay.
- `adws/phases/__tests__/scenarioTestFixLoop.test.ts` — The loop's tests (module mocks of the test and fix phases, `runPhase` pass-through). Extend them, or add a sibling file.
- `adws/phases/scenarioFixPhase.ts` — The fix agent the gate keeps pre-existing failures from. Not modified.
- `adws/phases/staticCheckGate.ts` — `recordLine`, `describeFailedCheck` and `logCheckVerdict` are private. Export `logCheckVerdict` with an optional label so the baseline logs its checks in the same format; the gate's own log lines stay unchanged. The gate's loop needs no change: with a passed baseline every red check was introduced, and with a waiver the loop fixes everything, as it already does.
- `adws/phases/workflowPark.ts` — `parkWorkflow(config, evidence): never`. Also write `parkReason`.
- `adws/phases/__tests__/workflowPark.test.ts` — Extend: `parkReason` is recorded.
- `adws/forge/parkComment.ts` — `ParkReason`, `ParkEvidence` (`BaselineRed { baseBranch, failedChecks }`, `PreExistingRegression { baseBranch, scenario }`, `BaseServerDown { baseBranch, output }`), `parkDirectives`, `buildParkComment`. Used as is; do not change its texts (the `@adw-989` scenarios assert them).
- `adws/phases/workflowInit.ts` — `initializeWorkflow`'s `starting` top-level write. Add `parkReason: undefined`. `WorkflowConfig.defaultBranch`, `worktreePath`, `logsDir`, `applicationUrl` and `gitContext` feed the baseline. Already over 300 lines (pre-existing); add one property only.
- `adws/phases/prReviewPhase.ts` — `initializePRReviewWorkflow`: `defaultBranch: pr.targetBranch` (the PR's base). Add `parkReason: undefined` to its pid write. Already over 300 lines (pre-existing); add one property only.
- `adws/phases/workflowRepoIdentity.ts` — `requireWorkflowGitContext(config)`.
- `adws/types/agentTypes.ts` — `AgentState`. Add `parkReason?: string` and `baseline?: BaselineRecord`, type-imported from `../core/baselineGate`, like `OrchestratorIdType` from `../core/constants`.
- `adws/core/agentState.ts` — `writeTopLevelState` shallow-merges; a property written as `undefined` is dropped by the JSON write. That is how `parkReason` is cleared. Read-only.
- `adws/core/phaseRunner.ts` — `runPhase(config, tracker, fn, phaseName?)`, `PhaseResult`, `isPhaseAlreadyCompleted` (a phase left `running` by a park is re-run on resume). Read-only.
- `adws/triggers/retryHandler.ts` — `decideRetryAction('human_gated')` → `rearm_phase_timeout`: the `## Retry` path, unchanged. The model for `continueHandler.ts`, including its deps and test style.
- `adws/triggers/__tests__/retryHandler.test.ts` — Test pattern for the new handler.
- `adws/triggers/trigger_webhook.ts` — The `issue_comment` branch: `## Cancel`, `## Retry`, then `## Continue` → `classifyAndSpawnWorkflow`. Insert the waiver check after the `isActionableComment` guard. Already over 300 lines; add only the branch.
- `adws/triggers/__tests__/trigger_webhook.test.ts` — Extend: a `## Continue` the handler waives does not reach `classifyAndSpawnWorkflow`.
- `adws/triggers/trigger_cron.ts` — The directive scan over each issue's latest comment (`isCancelComment`/`isRetryComment`). Add the `## Continue` branch. Already over 300 lines; add only the branch.
- `adws/triggers/takeoverHandler.ts`, `adws/triggers/cronIssueFilter.ts`, `adws/core/stageClassifier.ts` — `human_gated` is excluded until re-armed; `phase_timeout` is resumed in place with the same adwId. Read-only.
- `adws/core/workflowCommentParsing.ts` — `isActionableComment` (`## Continue`), `extractLatestAdwId`. Read-only.
- `adws/core/upgradeClaim.ts` — Prior art for a detached worktree of `origin/<default>`: `fetchRemote`, then `addDetachedWorktree`, with cleanup in `finally`. Read-only.
- `node_modules/@paysdoc/devplatform/dist/git/gitContext.d.ts`, `worktreeRemoveOps.js`, `worktreeQueryOps.js` — The typed methods:
  - `fetchRemote`;
  - `addDetachedWorktree` (`git worktree add --detach`);
  - `worktreePathFor` (`<basePath>/.worktrees/<name>`);
  - `removeWorktree(name)` (kill processes in the dir, remove `--force`, fall back to prune and `rmSync`; synchronous, so it can run in an exit handler);
  - `copyEnvToWorktree`;
  - `headShort`.

  `removeWorktreesForIssue` matches any `.worktrees/*-issue-<N>-*` directory. `findWorktreeForIssue` only matches `<issue prefix>-issue-<N>-` with a branch, so the base worktree is never taken for the issue's own. Read-only.
- `adws/triggers/cancelHandler.ts`, `adws/triggers/webhookHandlers.ts` (`handleIssueClosedEvent`), `adws/triggers/devServerJanitor.ts` (`extractIssueNumberFromDirName`) — They reach the base worktree by its `-issue-<N>-` name. Read-only.
- `adws/checkGitGhGuard.ts` — Flags any `git …`/`gh …` string-literal first argument. Use typed `GitContext` methods only.
- `adws/checkBranchNames.ts` — Never write `main`/`master`/`dev`/`develop` as a branch in `adws/` code; use `config.defaultBranch`.
- Orchestrators that run gates:
  - with injectable phase sets: `adws/adwChore.tsx` (`ChorePhases`, 273 lines), `adws/adwPlanBuildReview.tsx` (`PlanBuildReviewPhases`), `adws/adwPlanBuildTestReview.tsx` (`PlanBuildTestReviewPhases`);
  - the others: `adws/adwSdlc.tsx`, `adws/adwPlanBuild.tsx`, `adws/adwPlanBuildDocument.tsx`, `adws/adwPlanBuildTest.tsx`, `adws/adwTest.tsx`, `adws/adwPrReview.tsx`.
- `adws/__tests__/adwChore.test.ts`, `adws/__tests__/adwPlanBuildReview.test.ts`, `adws/__tests__/adwPlanBuildTestReview.test.ts` — Their `makePhases` fakes must gain `executeBaselinePhase`. They can prove the baseline runs before the install and plan phases, and that a parking baseline stops the run before any plan.
- `adws/phases/index.ts`, `adws/workflowPhases.ts`, `adws/index.ts`, `adws/core/index.ts` — Barrels. Export the new phase and core symbols.
- `features/regression/support/fixtureTargetRepo.ts`, `features/regression/support/fixtureWorktree.ts`, `test/mocks/git-remote-mock.ts`, `test/fixtures/cli-tool/.adw/commands.md` — The smoke runs (`adw_sdlc_happy_path`, `adw_chore_diff_verdicts`, `pause_resume_rate_limit`) run real orchestrators, so they now run the real baseline:
  - `fetch` is a no-op under the git mock;
  - `refs/remotes/origin/main` exists locally;
  - the fixture's `package.json` has no dependencies;
  - its checks are `echo`;
  - its dev server is `N/A`.

  It must stay green. Read-only.
- `features/per-issue/step_definitions/feature-988-*.ts`, `feature-989-*.ts`, `feature-929-workflow.ts`, `feature-796.steps.ts` — The BDD harness to reuse:
  - #988's phase runner that traps `process.exit`;
  - #929's `createWorkflow`/`commitFile`;
  - #796's recording providers and `commentsOn`;
  - #989's park assertions.
- `UBIQUITOUS_LANGUAGE.md` — The Retry Directive entry; the document phase may add **Baseline**, **Base Worktree**, **Waiver** and **Pre-existing Failure**.

Conditional documentation, whose conditions this task matches:
- `app_docs/feature-9gjajh-test-and-scenario-phases.md` — scenario fix loop, static-check gate, `parkWorkflow`, park comment builder (decisions include 0060).
- `app_docs/feature-9gjajh-dev-server-and-ports.md` — `devServerLifecycle.ts`, `portAllocator.ts`.
- `app_docs/feature-9gjajh-worktree-and-vcs.md` — `removeWorktree`, `removeWorktreesForIssue`, `killProcessesInDirectory`.
- `app_docs/feature-9gjajh-takeover-and-coordination.md` — the `## Retry` handler, stage classifier, `human_gated` recovery.
- `app_docs/feature-9gjajh-issue-routing-and-eligibility.md` — `retryHandler.ts`, `cancelHandler.ts`, `devServerJanitor.ts`.
- `app_docs/feature-9gjajh-webhook-triggers.md` and `app_docs/feature-9gjajh-cron-triggers.md` — the directive wiring in both triggers.
- `app_docs/feature-9gjajh-sdlc-orchestrators.md` and `app_docs/feature-9gjajh-feature-orchestrators.md` — the orchestrators and their injectable phase sets.
- `app_docs/feature-9gjajh-workflow-lifecycle-phases.md` — `workflowInit.ts`, `orchestratorLock.ts`.
- `app_docs/feature-9gjajh-types.md` and `app_docs/feature-9gjajh-state-and-config.md` — `AgentState`, `agentState.ts`, `projectConfig.ts`.
- `app_docs/feature-9gjajh-github-api.md` — `adws/forge/parkComment.ts`.
- `app_docs/feature-9gjajh-bdd-regression-suite.md` — the smoke runs the baseline now runs in.

### New Files
- `adws/core/baselineGate.ts` — `BaselineStatus`, `BaselineRecord`, `isBaselineWaived`, `declaredDevServerCommand`, `INSTALL_DEPENDENCIES_CHECK`, `BaseCommandFailure`, `DevServerStartResult`, `BaselineEvent`, `BaselineVerdict`, `BaselineInput`, `runBaselineChecks`.
- `adws/core/regressionTriage.ts` — `FailingScenario`, `BaseScenarioOutcome`, `ScenarioRerun`, `TriagedScenario`, `RegressionTriage`, `triageRegressionFailures`, `scenarioMatchesCase`, `withRerunTag`, `describeFailingScenario`.
- `adws/phases/baseWorktree.ts` — `BaseCheckout`, `BaseWorktreePort`, `BaseWorktreeDeps`, `baseWorktreeName`, `buildBaseWorktreePort`, `sharedBaseWorktree`.
- `adws/phases/baselinePhase.ts` — `BaselinePhaseDeps`, `DevServerStartSpec`, `executeBaselinePhase`.
- `adws/phases/baseScenarioRerun.ts` — `BASE_RERUN_TAG`, `BaseScenarioRerunDeps`, `buildBaseScenarioRerun`.
- `adws/phases/preExistingRegressionGate.ts` — `failingRegressionScenarios`, `PreExistingRegressionGate`, `createPreExistingRegressionGate`.
- `adws/triggers/continueHandler.ts` — `WAIVABLE_PARK_REASONS`, `ContinueAction`, `decideContinueAction`, `ContinueHandlerDeps`, `buildContinueHandlerDeps`, `handleContinueDirective`.
- `adws/core/__tests__/baselineGate.test.ts`
- `adws/core/__tests__/regressionTriage.test.ts`
- `adws/core/__tests__/devServerLifecycle.healthy.test.ts`
- `adws/phases/__tests__/baseWorktree.test.ts`
- `adws/phases/__tests__/baselinePhase.test.ts` (plus `baselinePhase.helpers.ts`, and a second file if one exceeds 300 lines)
- `adws/phases/__tests__/baseScenarioRerun.test.ts`
- `adws/phases/__tests__/preExistingRegressionGate.test.ts`
- `adws/phases/__tests__/scenarioTestFixLoop.regression.test.ts`
- `adws/triggers/__tests__/continueHandler.test.ts`
- `features/per-issue/step_definitions/feature-990*.ts` — Step definitions for `features/per-issue/feature-990.feature`, which the scenario phase writes.

## Implementation Plan
### Phase 1: Foundation
Pure building blocks and the state shape, each test-first:
- the baseline core (record, waiver predicate, declared-server reader, `runBaselineChecks`);
- the regression triage core (triage, name matching, tag insertion);
- `AgentState.parkReason`/`baseline`, the park recording its reason, and run starts clearing it;
- the dev-server lifecycle's `withHealthyDevServer` with output capture, and the moved `devServerPort`/`isDevServerConfigured`.

### Phase 2: Core Implementation
- The base worktree port: detached checkout of `origin/<base>`, named `base-issue-<N>-<adwId>`, shared per adwId, removed on exit, a stale one replaced.
- The baseline phase: checkout, base config, `runBaselineChecks`, logging, record or park.
- The base scenario re-run port: locate, tag, run alone, restore, read JUnit, memoize.
- The pre-existing regression gate.
- The `## Continue` handler.

### Phase 3: Integration
- Call the gate from `runScenarioTestFixLoop` before the verdict and the fix phase.
- Wire `handleContinueDirective` into the webhook and the cron.
- Run `executeBaselinePhase` first in the nine orchestrators; extend the injectable phase sets and their tests.
- Barrels, the `@adw-990` step definitions, ADR-0060's `### Confirmation`, the README.
- Run every validation command, including `@adw-990`, `@adw-989`, `@adw-988` and `@regression`.

## Step by Step Tasks
Execute every step in order, top to bottom.

### 1. Write the baseline core (test first)
- Create `adws/core/__tests__/baselineGate.test.ts`. Use a scripted fake `ProcessRunner` (an outcome per command, every call recorded with its cwd) and a fake `startDevServer` that records its calls. Cases:
  - **green records nothing to park**: install, four checks all exit 0, no server → `{ kind: 'green' }`. The install ran first, then the checks in `STATIC_CHECKS` order, all in the given cwd.
  - **red check**: lint exits 2 with output `L` → `checks_red` whose failures are `[{ check: 'lint', command, exitCode: 2, output: 'L' }]`. Two red checks → both, in check order. The dev server is not started when a check is red.
  - **failed install**: `installDeps` exits 1 → `checks_red` with one failure, `check: INSTALL_DEPENDENCIES_CHECK`, its command, exit code and output. No static check ran.
  - **install skipped**:
    - `installDeps: 'N/A'` → no install; checks run;
    - every check `N/A` and no server port → no install and `green`.
  - **declared server**:
    - checks green, `startDevServer` returns `{ healthy: false, output: 'EADDRINUSE' }` → `{ kind: 'server_down', output: 'EADDRINUSE' }`;
    - healthy → `green`;
    - no `startDevServer` given → never started.
  - **a runner that throws** counts as a failed command with exit code `null` and the error text as output, as `checkRunner`'s `execute` does.
  - **report**: the optional `report` receives `dependencies_installed`, `checks_ran` and `dev_server_checked` events, in order, for the steps that ran.
  - **`declaredDevServerCommand`**:
    - `## Start Dev Server` with `bun run dev --port {PORT}` → that command;
    - `N/A`, an empty section, or no section at all → `null`. A missing section must not yield `getDefaultCommandsConfig().startDevServer`.
  - **`isBaselineWaived`**: waived → true; passed or `undefined` → false.
- Create `adws/core/baselineGate.ts`:
  - `export enum BaselineStatus { Passed = 'passed', Waived = 'waived' }`
  - `export type BaselineRecord`, readonly fields:
    - `{ status: BaselineStatus.Passed; baseBranch: string; baseCommit: string; recordedAt: string }`;
    - `{ status: BaselineStatus.Waived; waivedPark: string; recordedAt: string }`.
  - `export function isBaselineWaived(record: BaselineRecord | undefined): boolean`
  - `export const INSTALL_DEPENDENCIES_CHECK = 'install dependencies'`
  - `export interface BaseCommandFailure { readonly check: string; readonly command: string; readonly exitCode: number | null; readonly output: string }` (structurally a `ParkedCheck`; core must not import forge).
  - `export interface DevServerStartResult { readonly healthy: boolean; readonly output: string }`
  - `export type BaselineCommands = Pick<CommandsConfig, 'installDeps'> & StaticCheckCommands`
  - `export type BaselineEvent` and `export type BaselineVerdict` (`green` | `checks_red` with `failed` | `server_down` with `output`).
  - `export interface BaselineInput { readonly commands: BaselineCommands; readonly cwd: string; readonly runProcess: ProcessRunner; readonly startDevServer?: () => Promise<DevServerStartResult>; readonly report?: (event: BaselineEvent) => void }`
  - `export async function runBaselineChecks(input: BaselineInput): Promise<BaselineVerdict>`. Extract `installDependencies`, `failedChecksOf` and `checkDevServer` to keep nesting at most 2.
  - `export function declaredDevServerCommand(commandsMd: string): string | null`, over `parseMarkdownSections` and `isCheckConfigured`. One comment says why the raw section is read: the parsed config defaults a missing section to `bun run dev`, and the baseline starts only a server the repository declares.
  - Imports: `./checkRunner` and `./projectConfig` only.
- Export the types and values from `adws/core/index.ts` next to the `checkRunner` exports.
- Run `bunx vitest run adws/core/__tests__/baselineGate.test.ts` until green.

### 2. Write the regression triage core (test first)
- Create `adws/core/__tests__/regressionTriage.test.ts` with a scripted fake `rerunOnBase`, which records each call and answers per scenario name. Cases:
  - **waived**: `waived: true` → `{ kind: 'waived' }`, and `rerunOnBase` is never called.
  - **pre-existing**: failing `[A, B]`, A → `Failed` → `{ kind: 'pre_existing', scenario: A }`. B is never re-run: the first pre-existing scenario parks the issue.
  - **introduced**: A → `Passed`, B → `NotRun` → `{ kind: 'introduced' }` with both triaged outcomes.
  - **order and one at a time**: re-runs happen in the order given, each awaited before the next starts (the fake records start and end).
  - **errors propagate** from `rerunOnBase`.
  - **`scenarioMatchesCase`**:
    - `('Cancel resets', 'Cancel resets')` → true;
    - `('Cancel resets', 'Directives - Cancel resets')` (rule) → true;
    - `('Login', 'Login - Examples - #1.2: Login as admin')` (outline example) → true;
    - `('Cancel', 'Cancel resets')` → false;
    - `('resets', 'Cancel resets')` → false.
  - **`withRerunTag`**:
    - inserts `    @adw-base-rerun` directly above line `headerLine`, with that line's indentation;
    - a scenario that already has tag lines keeps them, and the new line sits between them and the keyword line;
    - nothing else in the content changes;
    - CRLF content keeps CRLF.
  - **`describeFailingScenario`**: `{ name: 'S', feature: 'F' }` → `F: S`; without a feature → `S`.
- Create `adws/core/regressionTriage.ts`:
  - `FailingScenario`, `BaseScenarioOutcome` (`Passed = 'passed'`, `Failed = 'failed'`, `NotRun = 'not_run'`), `ScenarioRerun`, `TriagedScenario`, `RegressionTriage`, `RegressionTriageInput { failing; waived; rerunOnBase }`.
  - `triageRegressionFailures`. Comment the invariant: only a scenario that fails on the base branch is pre-existing; one the base branch does not have, or cannot run, was introduced by the change and goes to the fix agent as before.
  - The three pure helpers. No imports beyond types.
- Export from `adws/core/index.ts`.
- Run `bunx vitest run adws/core/__tests__/regressionTriage.test.ts` until green.

### 3. Record the park reason and the baseline in the top-level state (test first)
- `adws/types/agentTypes.ts`:
  - add `parkReason?: string` (a `ParkReason` value; the park the workflow waits in, absent once a run starts);
  - add `baseline?: BaselineRecord` (`import type { BaselineRecord } from '../core/baselineGate'`).
- `adws/phases/__tests__/workflowPark.test.ts`: the top-level state after a park holds `workflowStage: 'human_gated'` and `parkReason` equal to the evidence's reason, for `fix_loop_stalled` and `baseline_red`.
- `adws/phases/workflowPark.ts`: write `{ workflowStage: 'human_gated', parkReason: evidence.reason }` in the existing single write; the comment above it stays true.
- `adws/phases/workflowInit.ts`: add `parkReason: undefined` to the `starting` write. Give it a comment next to the existing `pidStartedAt` one: written as `undefined` so the shallow merge drops a previous run's park, because a starting run is no longer parked.
- `adws/phases/prReviewPhase.ts`: add `parkReason: undefined` to `initializePRReviewWorkflow`'s pid write, for the same reason.
- `adws/phases/__tests__/workflowInit.test.ts`: if that test already asserts the `starting` write, assert that the write carries a `parkReason` key whose value is `undefined`. Otherwise cover it in task 15's scenarios.
- Run `bunx vitest run adws/phases/__tests__/workflowPark.test.ts adws/phases/__tests__/workflowInit.test.ts`.

### 4. Add a dev-server start that reports failure (test first)
- Create `adws/core/__tests__/devServerLifecycle.healthy.test.ts`. Inject `{ spawn, probe, kill }` fakes, with no real processes and no real timers. Use a temp `outputPath`. Cases:
  - **healthy on attempt 1** → `work` runs once, the result is `{ started: true, result }`, and `kill` is called for the pid after `work`.
  - **healthy on attempt 3** → the first two attempts are killed before the next spawn, then `work` runs.
  - **never healthy** after `MAX_START_ATTEMPTS`:
    - `work` never runs;
    - the result is `{ started: false, output }`, where `output` is the last attempt's output as written to `outputPath` (the fake spawn writes `attempt-<n>` through the fd it is given);
    - every attempt is killed.
  - **`work` throws** → the server is still killed and the error propagates.
  - **`{PORT}`** is substituted, and the probe URL is `http://localhost:<port><healthPath>`.
  - **`devServerPort`**: `http://localhost:4123` → 4123; no port or an unparseable URL → 3000.
  - **`isDevServerConfigured`**: `N/A`, empty and whitespace → false; a command → true.
- `adws/core/devServerLifecycle.ts`:
  - `spawnServer(command, cwd, outputFd?: number)`: `stdio: outputFd === undefined ? 'ignore' : ['ignore', outputFd, outputFd]`. Default unchanged; the existing tests must pass untouched.
  - `export interface HealthyDevServerConfig extends DevServerConfig { readonly outputPath: string }`
  - `export type HealthyDevServerOutcome<T> = { readonly started: true; readonly result: T } | { readonly started: false; readonly output: string }`
  - `export interface DevServerLifecycleDeps { readonly spawn: (command: string, cwd: string, outputFd: number) => ChildProcess; readonly probe: typeof probeHealth; readonly kill: typeof killProcessGroup }`
  - `export async function withHealthyDevServer<T>(config, work, deps: Partial<DevServerLifecycleDeps> = {}): Promise<HealthyDevServerOutcome<T>>`. Each attempt:
    - opens `outputPath` with `'w'`, so only the last attempt's output remains;
    - spawns, closes the parent's fd, and probes;
    - an unhealthy attempt is killed before the next.

    Extract `startOneAttempt`. Comment why it never runs `work` against a server that did not start: a verdict from such a run would be a server verdict, and the caller must act on the failure instead.
  - Move `extractPort` → `export function devServerPort(applicationUrl: string): number` and `isDevServerConfigured` → `export function isDevServerConfigured(command: string): boolean` from `adws/phases/scenarioTestPhase.ts`. Import them there; the scenario phase's behaviour is unchanged.
  - Update the header comment, which still says "No production consumers are wired yet".
  - `withDevServer` is not touched.
- Run `bunx vitest run adws/core/__tests__/devServerLifecycle.test.ts adws/core/__tests__/devServerLifecycle.healthy.test.ts adws/phases/__tests__/scenarioTestPhase.test.ts`.

### 5. Write the base worktree port (test first)
- Create `adws/phases/__tests__/baseWorktree.test.ts`:
  - inject a fake `git` that records calls (`worktreePathFor(name)` returns `/repo/.worktrees/<name>`, `headShort` returns `abc1234`);
  - inject a fake `onExit` that captures the cleanup.

  Config: `issueNumber: 990`, `adwId: 'base-test'`, `defaultBranch: 'trunk'`, `worktreePath: '/repo/.worktrees/feature-issue-990-x'`. Cases:
  - **ensure creates a detached checkout of the remote base branch**, in order:
    1. `removeWorktree('base-issue-990-base-test')` (a stale one goes first);
    2. `fetchRemote('trunk', worktreePath)`;
    3. `addDetachedWorktree('/repo/.worktrees/base-issue-990-base-test', 'origin/trunk', worktreePath)`;
    4. `copyEnvToWorktree(path)`;
    5. `headShort(path)`.

    It returns `{ path, baseBranch: 'trunk', commit: 'abc1234' }`.
  - **ensure is idempotent**: a second call returns the same checkout with no further git call, and the exit cleanup was registered once.
  - **the exit cleanup removes it**: invoking the captured cleanup calls `removeWorktree(name)`. After `remove()`, the cleanup does nothing more. `remove()` twice removes once. `remove()` before `ensure()` does nothing.
  - **a failed creation throws** (e.g. `addDetachedWorktree` throws) and registers no cleanup.
  - **the name**:
    - `baseWorktreeName(990, 'x')` is `base-issue-990-x`;
    - it matches the `-issue-990-` pattern of `removeWorktreesForIssue` and of `extractIssueNumberFromDirName` (`## Cancel`, issue close and the janitor reach it);
    - it does not match `^(feature|bugfix|chore|…)-issue-990-`, so `findWorktreeForIssue` never takes it for the issue's worktree.
  - **`sharedBaseWorktree`** returns the same port for the same adwId and a different one for another adwId.
- Create `adws/phases/baseWorktree.ts`:
  - `export interface BaseCheckout { readonly path: string; readonly baseBranch: string; readonly commit: string }`
  - `export interface BaseWorktreePort { ensure(): BaseCheckout; remove(): void }`
  - `export interface BaseWorktreeDeps { readonly git: Pick<GitContext, 'fetchRemote' | 'addDetachedWorktree' | 'removeWorktree' | 'worktreePathFor' | 'copyEnvToWorktree' | 'headShort'>; readonly onExit: (cleanup: () => void) => void }`
  - The default `git` is `requireWorkflowGitContext(config)`, resolved inside the function. The default `onExit` is `cleanup => process.once('exit', cleanup)`.
  - `export function buildBaseWorktreePort(config: Pick<WorkflowConfig, 'issueNumber' | 'adwId' | 'defaultBranch' | 'worktreePath' | 'gitContext'>, deps: Partial<BaseWorktreeDeps> = {}): BaseWorktreePort`
  - `export function sharedBaseWorktree(config): BaseWorktreePort` — a module-level `Map` keyed by adwId. `remove()` also forgets the entry.
  - Comment the invariants:
    - every way an orchestrator ends goes through `process.exit` or a drained event loop, so the `'exit'` cleanup removes the checkout on a normal end, a park, an error and a pause;
    - `removeWorktree` is synchronous, so it can run in that handler;
    - a killed process leaves the checkout behind, and its `-issue-<N>-` name is what lets `## Cancel`, the issue-close cleanup, the janitor and the next run's `ensure()` remove it.
  - Typed `GitContext` methods only; never a `git …` string.
- Run `bunx vitest run adws/phases/__tests__/baseWorktree.test.ts`.

### 6. Export the check-verdict logger
- `adws/phases/staticCheckGate.ts`: export `logCheckVerdict(statePath, verdict, label = 'Static check')`. The label replaces the literal `Static check` prefix of its three lines, so the gate's own lines stay byte-identical (the `@adw-988`/`@adw-989` scenarios read them).
- Run `bunx vitest run adws/phases/__tests__/unitTestPhase.test.ts adws/phases/__tests__/unitTestPhase.park.test.ts adws/phases/__tests__/unitTestPhase.guard.test.ts`.

### 7. Write the baseline phase (test first)
- Create `adws/phases/__tests__/baselinePhase.test.ts`, with helpers in `baselinePhase.helpers.ts`.
  - **Fake worktree**: a port whose `ensure()` returns a temp dir in which the test wrote `.adw/commands.md`, and whose `ensure`/`remove` calls are recorded.
  - **Fake check runner**: a scripted `runProcess` keyed by command.
  - **Fake dev-server starter**: records its spec and returns a scripted result.
  - **Fake repo context**: `repoContext.issueTracker.commentOnIssue` as a `vi.fn`.
  - **Exit spy**: a `process.exit` spy that throws a sentinel.
  - **Isolation**: a unique adwId per test, with `agents/<adwId>` removed afterwards, as in `workflowPark.test.ts`.

  Cases:
  - **green records**:
    - all checks pass, no server declared → the phase returns `{ costUsd: 0 }` without exiting;
    - the top-level `baseline` is `{ status: 'passed', baseBranch: config.defaultBranch, baseCommit: <checkout commit>, recordedAt: <ISO> }`;
    - no comment is posted;
    - `execution.log` names the base branch and commit;
    - the checks ran in the checkout's path, not in the issue worktree.
  - **red parks**: lint exits 1 with output `lint broke on base` →
    - `process.exit(0)`;
    - top-level `workflowStage: 'human_gated'`, `parkReason: 'baseline_red'`, no `baseline` record;
    - exactly one comment, equal to `buildParkComment(adwId, { reason: BaselineRed, baseBranch, failedChecks: [lint] })`;
    - the comment names `lint`, quotes the output, names the base branch, and states both directive meanings;
    - `execution.log` holds the full lint output.
  - **failed install parks** as `baseline_red`, naming `install dependencies` and the install command. No check ran.
  - **declared server down parks**: `## Start Dev Server` `npm run dev -- --port {PORT}`, starter returns `{ healthy: false, output: 'Error: listen EADDRINUSE' }` →
    - `parkReason: 'base_server_down'`;
    - the comment quotes the output and names the base branch;
    - the starter was given the command, the checkout as cwd, `devServerPort(config.applicationUrl)`, the base's health path (or `/`), and `<logsDir>/base-dev-server.log`.
  - **declared server up** → green. **No `## Start Dev Server` section** → the starter is never called, although the parsed config defaults to `bun run dev`.
  - **waiver honoured**: top-level `baseline: { status: 'waived', … }` →
    - the phase returns without calling `ensure`, the runner or the starter;
    - `execution.log` says the baseline was waived by `## Continue` and that this run fixes pre-existing failures too;
    - the waiver record is left as it is.
  - **`## Retry` re-runs the baseline**:
    - park on a red lint;
    - `decideRetryAction(readTopLevelState(adwId).workflowStage)` is `rearm_phase_timeout`;
    - re-enter `executeBaselinePhase` with the same fakes and the lint still red → it runs the checks again and parks again;
    - with the lint green → it records `passed`.
  - **the checkout is the shared one**: `ensure()` is called once per phase run, and the phase never calls `remove()`. The checkout is shared with the re-runs and removed on exit.
- Create `adws/phases/baselinePhase.ts`:
  - `export interface DevServerStartSpec { readonly command: string; readonly cwd: string; readonly port: number; readonly healthPath: string; readonly outputPath: string }`
  - `export interface BaselinePhaseDeps { readonly baseWorktree: BaseWorktreePort; readonly runProcess: ProcessRunner; readonly startDevServer: (spec: DevServerStartSpec) => Promise<DevServerStartResult>; readonly now: () => Date }`. The defaults:
    - `sharedBaseWorktree(config)`;
    - `runShellCommand`;
    - `spec => withHealthyDevServer(spec, async () => undefined)`, mapped to `{ healthy, output }`;
    - `() => new Date()`.
  - `export async function executeBaselinePhase(config: WorkflowConfig, deps: Partial<BaselinePhaseDeps> = {}): Promise<PhaseResult>`:
    1. `log('Phase: Baseline')` and `appendLog`.
    2. A waived baseline (`isBaselineWaived(readTopLevelState(adwId)?.baseline)`) → log the waiver and return the zero result.
    3. `checkout = baseWorktree.ensure()`. Log that the base branch `<base>` at `<commit>` is checked out in `<path>`.
    4. `projectConfig = loadProjectConfig(checkout.path)`. Read `<checkout>/.adw/commands.md` raw (missing → `''`), and get `declaredDevServerCommand(raw)`.
    5. `runBaselineChecks({ commands: projectConfig.commands, cwd: checkout.path, runProcess, startDevServer: declared ? () => startDevServer({ … }) : undefined, report })`. The report logs the install (command, exit code, full output on failure), each check through `logCheckVerdict(statePath, verdict, 'Base branch check')`, and the server result.
    6. Then:
       - `green` → `writeTopLevelState(adwId, { baseline: { status: Passed, baseBranch: checkout.baseBranch, baseCommit: checkout.commit, recordedAt } })`, log `Baseline green on <base> at <commit>`, return the zero result;
       - `checks_red` → `parkWorkflow(config, { reason: ParkReason.BaselineRed, baseBranch, failedChecks })`;
       - `server_down` → `parkWorkflow(config, { reason: ParkReason.BaseServerDown, baseBranch, output })`.
  - The zero result is `{ costUsd: 0, modelUsage: emptyModelUsageMap(), phaseCostRecords: [] }`; the baseline starts no agent.
  - Import `checkRunner`, `baselineGate` and `devServerLifecycle` from their module files, not the `'../core'` barrel (several tests mock it wholesale). Keep the file under 300 lines and nesting at most 2.
- Run `bunx vitest run adws/phases/__tests__/baselinePhase.test.ts`.

### 8. Write the base scenario re-run (test first)
- Create `adws/phases/__tests__/baseScenarioRerun.test.ts`:
  - The base checkout is a temp dir holding:
    - `.adw/scenarios.md` (`## Scenario Directory` `features/`);
    - `.adw/commands.md` (`## Run Scenarios by Tag` `run-bdd --tags "@{tag}"`, `## Install Dependencies`, `## Start Dev Server` `N/A`);
    - `features/regression/a.feature`, with `Feature: Alpha`, an `@regression` tag and scenarios `Cancel resets` and `Retry rearms`;
    - `features/per-issue/feature-9.feature`, a scenario named `Retry rearms` under `Feature: Beta`.
  - Fakes:
    - a fake worktree returning that dir;
    - a scripted `runProcess` (install);
    - a fake `runScenariosByTag` that records `(command, tag, cwd, env)` and the feature files' content at call time, and writes a scripted JUnit XML to `env.ADW_JUNIT_REPORT_PATH`;
    - a fake `withHealthyDevServer`;
    - a fake `isPortAvailable`.

  Cases:
  - **runs just that scenario**: re-running `{ name: 'Cancel resets', feature: 'Alpha' }`:
    - calls the runner once with tag `adw-base-rerun`, the base command and the checkout as cwd;
    - at call time, only that scenario carries `@adw-base-rerun`, directly above its keyword line;
    - afterwards every feature file equals its original content, also when the runner throws;
    - `ADW_JUNIT_REPORT_PATH` and `ADW_PROOF_DIR` lie under `agents/<adwId>/baseline/`.
  - **classifies**:
    - a report with one failure → `Failed`;
    - one passing case → `Passed`;
    - zero test cases, or no report → `NotRun`;
    - the scenario's name nowhere in the checkout → `NotRun` without starting the runner.
  - **disambiguates by feature**: `{ name: 'Retry rearms', feature: 'Alpha' }` tags only the scenario in `a.feature`, not the one in `Feature: Beta`.
  - **long naming**: the case name `Directives - Cancel resets` (a rule) finds `Cancel resets`.
  - **installs once**: two re-runs of different scenarios run the install command once. A failed install → `NotRun` for every re-run, with a warning logged.
  - **memoizes**: re-running the same scenario twice starts the runner once.
  - **dev server**: when the base's `## Start Dev Server` is a command (the scenario phase's rule, `isDevServerConfigured`):
    - the re-run waits until `isPortAvailable(devServerPort(applicationUrl))` is true;
    - it runs inside `withHealthyDevServer` with that port and the checkout as cwd;
    - a server that does not start → `NotRun`, and the scenario is not run;
    - a port still busy after the wait → `NotRun`.
- Create `adws/phases/baseScenarioRerun.ts`:
  - `export const BASE_RERUN_TAG = 'adw-base-rerun'`
  - `export interface BaseScenarioRerunDeps { readonly baseWorktree: BaseWorktreePort; readonly runProcess: ProcessRunner; readonly runScenariosByTag: typeof runScenariosByTag; readonly withHealthyDevServer: typeof withHealthyDevServer; readonly isPortAvailable: (port: number) => Promise<boolean> }`
  - `export function buildBaseScenarioRerun(config: WorkflowConfig, deps: Partial<BaseScenarioRerunDeps> = {}): ScenarioRerun`:
    - a closure holds the memoized install and a `Map<string, Promise<BaseScenarioOutcome>>` keyed by feature and name;
    - extract `locateScenario`, `runTagged`, `outcomeFromReport` and `waitForFreePort` (up to `KILL_GRACE_MS * 2`, polling every `PROBE_INTERVAL_MS`).
  - Comment the invariants:
    - the checkout is disposable, so tagging a scenario in it changes nothing the run commits;
    - the file is restored so the next re-run in the same checkout sees no stale tag;
    - the run waits for the port because the change's server is stopped by a timer and must not answer the base run's probe.
- Run `bunx vitest run adws/phases/__tests__/baseScenarioRerun.test.ts`.

### 9. Write the pre-existing regression gate (test first)
- Create `adws/phases/__tests__/preExistingRegressionGate.test.ts`. Inject a fake `rerunOnBase` and a fake `readBaseline`, a fake repo context, a `process.exit` spy, and a unique adwId. Cases:
  - **`failingRegressionScenarios`**:
    - `@regression` failed with cases `[failed A, passed B, failed C]` → `[A, C]` with their classnames as `feature`;
    - `@regression` passed, skipped or absent → `[]`;
    - failed without `cases` → `null`.
  - **pre-existing parks**:
    - A fails on the base branch →
      - `process.exit(0)`, `parkReason: 'pre_existing_regression'`;
      - one comment equal to `buildParkComment(adwId, { reason: PreExistingRegression, baseBranch: config.defaultBranch, scenario: 'Alpha: A' })`;
      - the comment names the scenario and the base branch, and states both directive meanings.
    - `execution.log` records each re-run's outcome.
  - **introduced returns**: A passes on the base branch → the gate resolves, posts nothing and does not exit.
  - **waiver honoured**: a waived baseline → `rerunOnBase` is never called, the gate resolves, and the log says the failing regression scenarios go to the fix agent because the baseline was waived.
  - **nothing to triage**:
    - only a per-issue tag failed → `rerunOnBase` never called;
    - `@regression` failed without cases → never called, with a warning that the scenarios cannot be identified, so they go to the fix agent.
  - **a passed baseline does not skip the re-run**: `baseline.status === 'passed'` still re-runs. The baseline runs no regression scenario, so it cannot vouch for one.
- Create `adws/phases/preExistingRegressionGate.ts`:
  - `export function failingRegressionScenarios(proof: ScenarioProofResult): readonly FailingScenario[] | null`
  - `export type PreExistingRegressionGate = (proof: ScenarioProofResult) => Promise<void>`
  - `export function createPreExistingRegressionGate(config: WorkflowConfig, deps: Partial<{ rerunOnBase: ScenarioRerun; readBaseline: () => BaselineRecord | undefined }> = {}): PreExistingRegressionGate`:
    - the real `rerunOnBase` is built on first need, so a run whose regression scenarios pass never touches git;
    - `pre_existing` → `parkWorkflow(config, { reason: ParkReason.PreExistingRegression, baseBranch: config.defaultBranch, scenario: describeFailingScenario(s) })`.
- Run `bunx vitest run adws/phases/__tests__/preExistingRegressionGate.test.ts`.

### 10. Call the gate from the scenario fix loop (test first)
- Create `adws/phases/__tests__/scenarioTestFixLoop.regression.test.ts`, with the same module mocks as `scenarioTestFixLoop.test.ts`. Inject `opts.preExistingRegressionGate` as a fake. Cases:
  - **pre-existing never reaches the fix agent**:
    - the first run fails on `@regression`;
    - the fake gate parks (throws the exit sentinel);
    - `executeScenarioFixPhase` is never called.
    - Also on the last attempt: with `maxAttempts: 1`, the gate is called before the hard-fail verdict, so the issue parks instead of throwing `ScenarioHermeticityError`.
  - **introduced goes to the fix agent as today**: the gate resolves → `executeScenarioFixPhase` is called with the proof, and the loop goes on exactly as before.
  - **the gate sees every failing run**: failing, fixed, failing again → the gate is called once per failing run, with that run's proof, and never for a passing run.
- `adws/phases/scenarioTestFixLoop.ts`:
  - `opts?: { maxAttempts?: number; preExistingRegressionGate?: PreExistingRegressionGate }`;
  - `const parkOnPreExistingRegression = opts?.preExistingRegressionGate ?? createPreExistingRegressionGate(config)`, created once per call so the gate's re-run memo spans the attempts;
  - in the failing branch, before `regressionTagResult`/`computeResolveVerdict`, `await parkOnPreExistingRegression(scenarioProof)`, with a one-line comment that it returns only when no failing regression scenario also fails on the base branch;
  - nothing else changes, and the cap stays.
- Run `bunx vitest run adws/phases/__tests__/scenarioTestFixLoop.test.ts adws/phases/__tests__/scenarioTestFixLoop.regression.test.ts`. The existing tests must pass unchanged: their failing proofs fail only the per-issue tag.

### 11. Write the `## Continue` handler and wire it into both triggers (test first)
- Create `adws/triggers/__tests__/continueHandler.test.ts`, in the style of `retryHandler.test.ts`, with a fixed `now`. Cases:
  - **`decideContinueAction`**:
    - `human_gated` with `parkReason` `baseline_red`, `base_server_down` or `pre_existing_regression` → `waive_baseline` with that park;
    - `human_gated` with `fix_loop_stalled`, `missing_application_type` or no `parkReason` → `not_a_baseline_park`;
    - any other stage, even with a waivable `parkReason` → `not_a_baseline_park`;
    - `null` → `not_a_baseline_park`.
  - **`handleContinueDirective` waives**: for each waivable reason it writes exactly `{ workflowStage: 'phase_timeout', resumeAttempts: 0, baseline: { status: 'waived', waivedPark: <reason>, recordedAt: <now ISO> } }` for the latest adwId in the comments, and returns true. The written stage is one the takeover resumes (`phase_timeout`), as `## Retry`'s is.
  - **declines quietly**: no adwId in the comments, no state, or a non-waivable park → no write, returns false. Nothing is logged for a stage that is not `human_gated`: the cron sees the same latest comment every 20 s.
- Create `adws/triggers/continueHandler.ts`:
  - `export const WAIVABLE_PARK_REASONS: ReadonlySet<string>` from `ParkReason`;
  - `ContinueAction`, `decideContinueAction` (pure, total);
  - `ContinueHandlerDeps { readTopLevelState; writeTopLevelState; now }`, `buildContinueHandlerDeps()`, `handleContinueDirective(issueNumber, comments, deps): boolean`.
  - A header comment gives the table: `## Continue` waives the baseline only for the three base-branch parks, where it re-arms the workflow like `## Retry` and records the waiver. For any other park or stage it does nothing, and the caller keeps its existing behaviour.
- `adws/triggers/__tests__/trigger_webhook.test.ts`:
  - mock `../continueHandler`, keeping `buildContinueHandlerDeps`, with `handleContinueDirective` scripted;
  - when it returns true, `classifyAndSpawnWorkflowMock` is not called;
  - when it returns false, the two existing cases still reach `classifyAndSpawnWorkflow` with the same arguments.
- `adws/triggers/trigger_webhook.ts`: after `if (!isActionableComment(commentBody)) { … }`, fetch the comments (`commentBoundary.providers.issueTracker.fetchComments`). If `handleContinueDirective(issueNumber, allComments, buildContinueHandlerDeps())` is true, answer `{ status: 'continue_waived', issue }` and return. Otherwise fall through to the existing cooldown and spawn path unchanged.
- `adws/triggers/trigger_cron.ts`: in the directive scan, add `else if (latestComment && isActionableComment(latestComment.body)) { handleContinueDirective(issue.number, issue.comments, buildContinueHandlerDeps()); }`. Do not add the issue to `cancelledThisCycle`: the re-armed stage is picked up by `filterEligibleIssues` like `## Retry`'s. Import `isActionableComment` with the other directive predicates.
- Run `bunx vitest run adws/triggers/__tests__/continueHandler.test.ts adws/triggers/__tests__/trigger_webhook.test.ts adws/triggers/__tests__/retryHandler.test.ts`.

### 12. Run the baseline first in every orchestrator that runs gates
- Barrels:
  - `adws/phases/index.ts`: `export { executeBaselinePhase } from './baselinePhase';`;
  - `adws/workflowPhases.ts` and `adws/index.ts`: re-export `executeBaselinePhase` next to `executeUnitTestPhase`.
- Injectable orchestrators (test first):
  - `adws/__tests__/adwChore.test.ts`, `adwPlanBuildReview.test.ts`, `adwPlanBuildTestReview.test.ts`: add `executeBaselinePhase: vi.fn(async () => ZERO_COST)` to `makePhases`. New cases:
    - the baseline ran first, before `executeInstallPhase` and `executePlanPhase` (call order through `mock.invocationCallOrder`);
    - a baseline that parks (throws a sentinel standing in for `process.exit`) → neither the install nor the plan phase was called.
  - In `adws/adwChore.tsx`, `adws/adwPlanBuildReview.tsx` and `adws/adwPlanBuildTestReview.tsx`:
    - add `readonly executeBaselinePhase: typeof executeBaselinePhase` to the phase interface and to its default constant;
    - call `await runPhase(config, tracker, phases.executeBaselinePhase, 'baseline')` as the first line of the phase sequence.
- The other orchestrators, as the first phase inside `runWithOrchestratorLifecycle`'s callback:
  - `adws/adwSdlc.tsx`, `adws/adwPlanBuild.tsx`, `adws/adwPlanBuildDocument.tsx`, `adws/adwPlanBuildTest.tsx`: `await runPhase(config, tracker, executeBaselinePhase, 'baseline');` before `executeInstallPhase`.
  - `adws/adwTest.tsx`: the same, before `executeUnitTestPhase`.
  - `adws/adwPrReview.tsx`: `await runPhase(config.base, tracker, executeBaselinePhase, 'pr_review_baseline');` before the install phase, with a one-line comment on the name: the issue's adwId already records the SDLC run's `baseline` as completed.
- Do not add the baseline to `adwPlan`, `adwBuild`, `adwPatch`, `adwDocument`, `adwMerge` or `adwUpgrade`: none of them runs a gate.
- Run `bunx vitest run adws/__tests__/adwChore.test.ts adws/__tests__/adwPlanBuildReview.test.ts adws/__tests__/adwPlanBuildTestReview.test.ts`, then `bunx tsc --noEmit -p adws/tsconfig.json`.

### 13. Finish the barrel exports
- `adws/core/index.ts`:
  - types: `BaselineRecord`, `BaselineInput`, `BaselineVerdict`, `BaselineEvent`, `BaseCommandFailure`, `DevServerStartResult`, `FailingScenario`, `ScenarioRerun`, `TriagedScenario`, `RegressionTriage`;
  - values: `BaselineStatus`, `isBaselineWaived`, `declaredDevServerCommand`, `runBaselineChecks`, `INSTALL_DEPENDENCIES_CHECK`, `BaseScenarioOutcome`, `triageRegressionFailures`, `scenarioMatchesCase`, `withRerunTag`, `describeFailingScenario`.
  - Type exports go in `export type { … }` lines and values in `export { … }` lines, next to the `checkRunner` exports.
- Phase modules keep importing from module paths directly.

### 14. Verify the regression harness still runs the real orchestrators green
- The smoke runs (`features/regression/smoke/adw_sdlc_happy_path.feature`, `adw_chore_diff_verdicts.feature`, `pause_resume_rate_limit.feature`) now run the real baseline in the fixture workspace:
  - `fetch` is a no-op behind the git mock;
  - `origin/main` exists locally (`fixtureTargetRepo.ts`);
  - the fixture's `package.json` has no dependencies, its checks are `echo`, and its dev server is `N/A`.
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@smoke"`, then `--tags "@subprocess"`. If a smoke fails because of the baseline, fix the cause in the baseline code, not in the fixture or the scenario. Then check that no `.worktrees/base-issue-*` directory is left behind in the fixture workspace after a run.

### 15. Write the step definitions for `@adw-990`
- The `@adw-990` scenarios are in `features/per-issue/feature-990.feature`, written by the scenario phase. Write their step definitions in `features/per-issue/step_definitions/feature-990*.ts`, with helpers split into `feature-990-*.ts` modules to stay under 300 lines. Do not edit the feature file.
- Reuse, never redefine (Cucumber fails on an ambiguous step):
  - the Background `the ADW codebase is checked out`;
  - #988's phase helpers, including the runner that traps `process.exit`;
  - #929's `createWorkflow`/`commitFile`;
  - #796's recording providers and `commentsOn`;
  - #989's park-comment helpers (`feature-989-comments.ts`).

  Export what is needed instead of copying it.
- A realistic base branch:
  - a throwaway repository whose base branch is pushed to a local bare `origin`, so `fetchRemote` and `addDetachedWorktree('origin/<base>')` work with real git;
  - the base branch's `.adw/commands.md` uses real commands (`sh -c 'echo …; exit 1'`) for a red check or a server that never starts, and `N/A` install where dependencies do not matter.
- Drive the real modules:
  - `executeBaselinePhase` for red/green/waived;
  - `handleRetryDirective`/`handleContinueDirective` with real state, for the directives;
  - `runScenarioTestFixLoop` or `createPreExistingRegressionGate` with a scripted scenario runner on the base checkout, for pre-existing versus introduced (assert on whether the fix phase or agent was started).
- "Before any plan is written": assert the park and that no plan file or plan agent run exists. Use an orchestrator run, or the baseline phase as the first phase of an injectable orchestrator (`executeChore` / `executePlanBuildTestReview` with fake later phases).
- Hooks tagged `@adw-990`:
  - reset the shared state;
  - call `sharedBaseWorktree(config).remove()` for every workflow the scenario created (the trapped `process.exit` never fires the exit cleanup in-process);
  - remove temp dirs and `agents/<adwId>`/`logs/<adwId>`;
  - be idempotent.
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-990"` until green.

### 16. Rewrite ADR-0060's `### Confirmation`
- In `specs/adr/0060-baseline-gate-on-the-base-branch.md`, replace "Not yet implemented; …" with "Implemented. Checked on <date> at `<short hash>`:", followed by bullets:
  - **The baseline phase.** `adws/phases/baselinePhase.ts` (`executeBaselinePhase`) runs as the first phase of every orchestrator that runs gates, before the plan phase (in `adwTest`, before the unit-test phase): `grep -l "executeBaselinePhase" adws/adw*.tsx` lists `adwChore`, `adwPlanBuild`, `adwPlanBuildDocument`, `adwPlanBuildReview`, `adwPlanBuildTest`, `adwPlanBuildTestReview`, `adwPrReview`, `adwSdlc` and `adwTest`. It does three things:
    - checks the base branch out as a detached worktree (`adws/phases/baseWorktree.ts`, `.worktrees/base-issue-<N>-<adwId>`);
    - installs its dependencies and runs the check runner there (`runBaselineChecks`, `adws/core/baselineGate.ts`);
    - starts the dev server the base branch's `.adw/commands.md` declares (`withHealthyDevServer`, `adws/core/devServerLifecycle.ts`).
  - **Red, green and the directives.**
    - Red parks as `human_gated` with the `baseline_red` or `base_server_down` comment of `adws/forge/parkComment.ts`; green records `baseline.status: 'passed'` in the top-level state.
    - `## Retry` re-arms the park (`decideRetryAction`), and the resumed run re-runs the baseline.
    - `## Continue` on a `baseline_red`, `base_server_down` or `pre_existing_regression` park records a waiver and re-arms it (`adws/triggers/continueHandler.ts`, called by both triggers; `parkReason` in the top-level state names the park).
  - **The single-scenario re-run.**
    - `runScenarioTestFixLoop` re-runs each failing `@regression` scenario alone in the base checkout (`adws/phases/baseScenarioRerun.ts`, `adws/core/regressionTriage.ts`).
    - One that fails there too never reaches the fix agent: the issue parks with the `pre_existing_regression` comment (`adws/phases/preExistingRegressionGate.ts`).
    - With a waiver every failure goes to the fix agent.
    - No full regression run happens on the base branch.
  - **Cleanup.** The base worktree is removed when the orchestrator process exits, on every path that ends in `process.exit`. A killed process's checkout is reached by `## Cancel`, issue close, the janitor and the next run, through its `-issue-<N>-` name.
  - **Unit tests:**
    - `adws/core/__tests__/baselineGate.test.ts`, `regressionTriage.test.ts`, `devServerLifecycle.healthy.test.ts`;
    - `adws/phases/__tests__/baseWorktree.test.ts`, `baselinePhase.test.ts`, `baseScenarioRerun.test.ts`, `preExistingRegressionGate.test.ts`, `scenarioTestFixLoop.regression.test.ts`;
    - `adws/triggers/__tests__/continueHandler.test.ts`.

    They use a fake check runner, a fake scenario runner and a fake worktree: red parks, green records, the waiver is honoured, the single re-run classifies pre-existing.
  - **Scenarios:** `features/per-issue/feature-990.feature`.
- Keep `### Confirmation` as an h3 in place. Do not edit the decision, the drivers, the consequences or the front matter.

### 17. Update the README
- "What it does":
  - Add a **Baseline gate on the base branch** bullet after the static-check bullet:
    - before any work, every orchestrator that runs gates checks the base branch out in a separate worktree, installs it, runs the static checks there and starts its declared dev server;
    - a red base parks the issue as `human_gated` (`baseline_red`/`base_server_down`), and a green one is recorded;
    - a failing `@regression` scenario is re-run alone on the base branch, and one that fails there too parks the issue (`pre_existing_regression`) instead of going to the fix agent;
    - no full regression run happens on the base branch;
    - the base worktree is removed when the run ends.
  - In the "Retry and Cancel directives" bullet, add that `## Continue` on a base-branch park records a waiver and re-arms the workflow, so that run fixes pre-existing failures too.
- Directory tree, in alphabetical position:
  - `adws/core/`: `baselineGate.ts`, `regressionTriage.ts`, with their tests;
  - `adws/phases/`: `baseScenarioRerun.ts`, `baseWorktree.ts`, `baselinePhase.ts`, `preExistingRegressionGate.ts`, with their tests;
  - `adws/triggers/`: `continueHandler.ts`, with its test.
- Keep the uncommitted tree edits already in the file.

### 18. Run the validation commands
- Run every command in `Validation Commands` and fix any failure before finishing.

## Testing Strategy
### Unit Tests
- **`adws/core/__tests__/baselineGate.test.ts`** (fake check runner through a scripted `ProcessRunner`, fake dev-server starter):
  - install first, then checks in order, in the base cwd;
  - a red check, or several, → `checks_red`, and the server is not started;
  - a failed install → `checks_red` named `install dependencies`, no check run;
  - install skipped for `N/A`, or when nothing would run;
  - a declared server down → `server_down` with its output; up → green; undeclared → never started;
  - a throwing runner; report events;
  - `declaredDevServerCommand` (present, `N/A`, empty, missing, never the default);
  - `isBaselineWaived`.
- **`adws/core/__tests__/regressionTriage.test.ts`** (fake scenario runner):
  - a waiver re-runs nothing;
  - the first base failure is pre-existing and stops the triage;
  - passed and not-run are introduced;
  - one at a time, in order; errors propagate;
  - `scenarioMatchesCase` (exact, rule, outline examples, no partial words);
  - `withRerunTag` (indentation, existing tags, untouched content, CRLF);
  - `describeFailingScenario`.
- **`adws/core/__tests__/devServerLifecycle.healthy.test.ts`** (fake spawn, probe and kill):
  - healthy on attempt 1 or 3;
  - never healthy → no work, the last attempt's output, every attempt killed;
  - kill on throw; `{PORT}` and probe URL;
  - `devServerPort`, `isDevServerConfigured`.
  - The existing `devServerLifecycle.test.ts` passes untouched.
- **`adws/phases/__tests__/baseWorktree.test.ts`** (fake worktree git):
  - stale removal, fetch, detached add of `origin/<base>`, `.env`, commit, in order;
  - idempotent; exit cleanup registered once and removing it; `remove` idempotent;
  - no cleanup after a failed creation;
  - the `-issue-<N>-` name reachable by cancel, close and the janitor, never by `findWorktreeForIssue`;
  - `sharedBaseWorktree` per adwId.
- **`adws/phases/__tests__/baselinePhase.test.ts`** (fake worktree, fake check runner, fake dev-server starter):
  - **green records** the passed baseline, with no comment;
  - **red parks** with `baseline_red`: `human_gated`, `parkReason`, the exact park comment, full output in `execution.log`, `process.exit(0)`;
  - a failed install parks;
  - **server down parks** with `base_server_down` and the starter's spec;
  - no section → no server;
  - **waiver honoured** (no checkout, no checks);
  - **`## Retry`** re-runs and parks again, or records green.
- **`adws/phases/__tests__/baseScenarioRerun.test.ts`** (fake worktree, fake scenario runner):
  - just that scenario is tagged, and the file is restored even on throw;
  - Failed/Passed/NotRun from the JUnit report; not found → NotRun;
  - feature disambiguation; long naming;
  - install once; memoization;
  - the dev server wrap, port wait, and start failure → NotRun;
  - report and proof paths under `agents/<adwId>/baseline/`.
- **`adws/phases/__tests__/preExistingRegressionGate.test.ts`** (fake scenario runner):
  - **the single re-run classifies pre-existing** and parks with the `pre_existing_regression` comment;
  - introduced returns;
  - **waiver honoured**;
  - per-issue-only failures and case-less failures are not re-run;
  - a passed baseline still re-runs.
- **`adws/phases/__tests__/scenarioTestFixLoop.regression.test.ts`**:
  - a pre-existing failure never reaches `executeScenarioFixPhase`, also on the last attempt;
  - an introduced one does, as today;
  - the gate is called once per failing run.
  - The existing `scenarioTestFixLoop.test.ts` passes unchanged.
- **`adws/triggers/__tests__/continueHandler.test.ts`**:
  - the decision table;
  - the exact waiver and re-arm write for each waivable park;
  - quiet declines.
- **`adws/triggers/__tests__/trigger_webhook.test.ts`**: a waived `## Continue` does not spawn; otherwise it does, as before.
- **`adws/phases/__tests__/workflowPark.test.ts`**: `parkReason` recorded. **`workflowInit.test.ts`** (if it covers the `starting` write): `parkReason` cleared.
- **`adws/__tests__/adwChore.test.ts`, `adwPlanBuildReview.test.ts`, `adwPlanBuildTestReview.test.ts`**: the baseline runs first, and a parking baseline stops the run before install and plan.
- Unchanged and still passing:
  - `retryHandler.test.ts`;
  - the static-check gate and loop tests (`unitTestPhase*.test.ts`, `staticCheckFixLoop*.test.ts`), whose log lines are byte-identical;
  - `scenarioTestPhase.test.ts`.

### Edge Cases
- **Red check and broken server on the base branch**: the checks run first, so the park is `baseline_red`. After a `## Retry` that finds the checks green, the server is tried and may park `base_server_down`.
- **A base checkout without dependencies**: the install runs before the checks. A failing install parks as `baseline_red` naming `install dependencies`. A repository whose install is `N/A`, or with nothing to check, installs nothing.
- **No `## Start Dev Server` section**: the parsed config defaults to `bun run dev`, but the baseline starts only a declared server. The scenario phase's own rule is unchanged, and the base re-run follows that rule so both runs see the same conditions.
- **Base dev-server flake** (slow start, port in use): the lifecycle's three attempts with a 20 s probe each, then `base_server_down` with the last attempt's output. `## Retry` re-runs the baseline. The review counter is not touched (ADR-0062 does not apply).
- **Resume after a park or a pause**:
  - a park inside the baseline leaves the `baseline` phase `running`, so the resumed run re-runs it;
  - a completed baseline is skipped on resume;
  - `adwPrReview` uses its own phase name, because the issue's adwId already holds the SDLC run's `baseline`.
- **`## Continue` after `## Retry`** (stage already `phase_timeout`): not a park any more, so no waiver. The webhook keeps its existing path.
- **A stale `parkReason`**: cleared at every run start, so a later resume-cap escalation to `human_gated` is never read as a base-branch park.
- **`## Continue` on a `fix_loop_stalled` or `missing_application_type` park**: no waiver, and the triggers keep their behaviour; the park comment already says so.
- **Several failing regression scenarios**:
  - re-run one at a time, and the first that also fails on the base branch parks;
  - a scenario already classified in this process is not re-run on later attempts, since the base checkout does not change during a run;
  - after `## Retry`, a new process re-runs on a fresh checkout of the latest base.
- **A failing regression scenario the base branch does not have** (added or renamed by the change, or a Scenario Outline whose case name cannot be matched): not found → introduced → fix agent, as today.
- **`@regression` failed without a JUnit report** (runner crashed before reporting): the scenarios cannot be identified, so they go to the fix agent as today, with a warning in `execution.log`.
- **Same scenario name in two features**: the JUnit classname (cucumber-js: the feature name) picks the file. Another runner's prefixed classname still matches by its `.<Feature>` suffix.
- **A base re-run that cannot run** (install fails, the server does not start, the port stays busy): `NotRun` → introduced. ADW never claims a failure is pre-existing without seeing it fail on the base branch.
- **The change's dev server still shutting down**: the re-run waits for the port before starting the base server, so the base probe never reaches the change's server.
- **Every way a run ends**: a normal end, `parkWorkflow`, `handleWorkflowError`, `handleRateLimitPause`, an uncaught exception, and `process.exit` inside a phase all fire `'exit'`, which removes the checkout. SIGTERM/SIGKILL (`## Cancel`, a crash) leave it for `removeWorktreesForIssue`, the janitor (which protects it while the orchestrator lives, like the issue's own worktree), and the next run's `ensure()`.
- **The base worktree is never the issue worktree**: it is detached, so it has no branch to push or delete. It is named `base-issue-…`, which `findWorktreeForIssue`'s `<prefix>-issue-<N>-` never matches.
- **Self-host**: ADW's own baseline runs `bun install`, both type checks, lint and build on `origin/<default>` under `.worktrees/`. Each issue worktree's `eslint .`/`tsc` runs in its own directory and never sees the sibling checkout.
- **Smoke runs**: green fixture checks and no server mean the baseline records `passed` and posts nothing. Assertions on comments, labels and the final stage are unchanged.

## Acceptance Criteria
- The nine orchestrators that run gates run `executeBaselinePhase` as their first phase: `adwSdlc`, `adwChore`, `adwPlanBuild`, `adwPlanBuildDocument`, `adwPlanBuildReview`, `adwPlanBuildTest`, `adwPlanBuildTestReview`, `adwTest`, `adwPrReview`. An issue on a red base parks as `human_gated` before the install or plan phase runs, so no plan is written. The park comment is `baseline_red` (failing checks with output, the base branch, both directive meanings) or `base_server_down` (the server's output, the base branch, both directive meanings).
- A green baseline records `baseline: { status: 'passed', baseBranch, baseCommit, recordedAt }` in the top-level state.
- `## Retry` on a baseline park re-arms it, and the resumed run re-runs the baseline and parks again while the base is red.
- `## Continue` on a `baseline_red`, `base_server_down` or `pre_existing_regression` park records a waiver and re-arms the workflow, through both the webhook and the cron. The resumed run skips the base checks, and every later failure goes to the fix loops.
- When a `@regression` scenario fails on the change, only that scenario is re-run on the base branch, never the whole suite.
  - If it fails there too, it never reaches the scenario fix agent, and the issue parks with the `pre_existing_regression` comment (the scenario, the base branch, both directives).
  - If it passes there, or the base branch does not have it, it goes to the fix agent as today.
- The base worktree is removed when the orchestrator process ends: a normal end, a park, an error, a pause. `## Cancel`, issue close and the next run remove one a killed process left behind.
- The unit tests under *Testing Strategy* exist and pass. They use a fake check runner, a fake scenario runner and a fake worktree, and cover: red parks, green records, the waiver is honoured, the single re-run classifies pre-existing.
- ADR-0060's `### Confirmation` names the implemented phase, gate, re-run, handler and tests.
- These all pass:
  - lint, both type checks, the unit suite and the build;
  - the git/gh guard, the branch-name guard, the model-literal guard and the docs-index gate;
  - the `@adw-990`, `@adw-989`, `@adw-988` and `@regression` scenarios.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bunx vitest run adws/core/__tests__/baselineGate.test.ts adws/core/__tests__/regressionTriage.test.ts adws/core/__tests__/devServerLifecycle.test.ts adws/core/__tests__/devServerLifecycle.healthy.test.ts` — baseline core, triage core and lifecycle tests pass
- `bunx vitest run adws/phases/__tests__/baseWorktree.test.ts adws/phases/__tests__/baselinePhase.test.ts adws/phases/__tests__/baseScenarioRerun.test.ts adws/phases/__tests__/preExistingRegressionGate.test.ts adws/phases/__tests__/scenarioTestFixLoop.test.ts adws/phases/__tests__/scenarioTestFixLoop.regression.test.ts` — base worktree, baseline phase, re-run, gate and loop tests pass
- `bunx vitest run adws/phases/__tests__/workflowPark.test.ts adws/phases/__tests__/workflowInit.test.ts adws/phases/__tests__/scenarioTestPhase.test.ts adws/phases/__tests__/unitTestPhase.test.ts adws/phases/__tests__/unitTestPhase.park.test.ts adws/phases/__tests__/unitTestPhase.guard.test.ts` — park, init, scenario phase and static-check gate behaviour unchanged where intended
- `bunx vitest run adws/triggers/__tests__/continueHandler.test.ts adws/triggers/__tests__/retryHandler.test.ts adws/triggers/__tests__/trigger_webhook.test.ts` — `## Continue` and `## Retry` handling
- `bunx vitest run adws/__tests__/adwChore.test.ts adws/__tests__/adwPlanBuildReview.test.ts adws/__tests__/adwPlanBuildTestReview.test.ts` — the baseline runs first and a parking baseline stops the run before any plan
- `grep -l "executeBaselinePhase" adws/adwSdlc.tsx adws/adwChore.tsx adws/adwPlanBuild.tsx adws/adwPlanBuildDocument.tsx adws/adwPlanBuildReview.tsx adws/adwPlanBuildTest.tsx adws/adwPlanBuildTestReview.tsx adws/adwTest.tsx adws/adwPrReview.tsx | wc -l` — prints 9
- `bun run lint` — Run Linter
- `bunx tsc --noEmit` — Type Check
- `bunx tsc --noEmit -p adws/tsconfig.json` — Additional Type Checks
- `bun run test:unit` — full unit suite, zero regressions
- `bun run build` — Run Build
- `bun run lint:git-guard` — the base worktree and re-run use typed `GitContext` methods only
- `bun run lint:branch-names` — no branch name written into `adws/` code
- `bun run lint:model-literals` — no model literal introduced
- `bun run lint:docs-index` — the conditional-docs index stays healthy
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-990"` — this issue's scenarios pass
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-989"` — the park comment, fix loop and `## Retry` scenarios still pass
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-988"` — the static-check gate scenarios still pass (the gate's log lines are unchanged)
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — regression suite passes, including the smoke runs that now run the real baseline

## Notes
- **Coding guidelines.** Follow `.adw/coding_guidelines.md` strictly:
  - guard clauses and nesting at most 2 (hence `installDependencies`, `checkDevServer`, `locateScenario`, `runTagged`, `outcomeFromReport`, `startOneAttempt`);
  - string enums for named sets (`BaselineStatus`, `BaseScenarioOutcome`); `readonly` everywhere; no `any`, no `!`;
  - pure core (`baselineGate.ts`, `regressionTriage.ts`), with side effects only in the phase, port and trigger modules;
  - comments only for invariants, ordering and non-obvious reasons (no issue numbers in code);
  - every new file under 300 lines.

  `workflowInit.ts`, `prReviewPhase.ts`, `trigger_webhook.ts` and `trigger_cron.ts` are already over 300 lines; add only what this issue needs.
- **No new library.** `@cucumber/gherkin` is already a dependency, reused through `adws/promotion/scenarioParser.ts`. If one were needed, `.adw/commands.md` says `bun add <package>`.
- **Why the triggers handle `## Continue`.** The waiver has to reach the same adwId the park belongs to, and the existing paths cannot do that:
  - the cron never acts on `## Continue`, and excludes `human_gated` issues;
  - the webhook's `## Continue` path is `classifyAndSpawnWorkflow`, which spawns a fresh run and, for a labelled issue, generates a new adwId.

  Mirroring `## Retry` writes the waiver and re-arms the parked adwId to `phase_timeout`; the takeover then resumes it in place. Neither handler posts a comment, as `## Retry` posts none for `human_gated`. This adds no directive; ADR-0060 gives the existing ones meanings for the new parks.
- **One waiver covers the run.** A `## Continue` on a `pre_existing_regression` park waives the baseline as a whole, per ADR-0060 ("the same rule as for a red baseline, with the same directive meanings"). Later pre-existing failures in that run also go to the fix agent. The park builder's wording is not changed (the `@adw-989` scenarios assert it).
- **Why install on the base branch.** A fresh checkout has no `node_modules`, so every Node repository's type check would be red. The install is a precondition of "run the check runner there", not a new check. Its failure is reported in the `baseline_red` park under the name `install dependencies`, because a base branch that does not install is red.
- **Why a detached worktree under `.worktrees/`, named `base-issue-<N>-<adwId>`.**
  - Detached: no local branch to leak (the `upgradeClaim` precedent).
  - `worktreePathFor`/`removeWorktree`: the same base path as every other worktree, through typed methods.
  - The name: `## Cancel`, issue close and the dev-server janitor find it through their `-issue-<N>-` pattern, with no change to those modules.

  A system temp directory would escape all three.
- **Why tag the scenario in the base checkout.** `## Run Scenarios by Tag` is the one runner contract every supported BDD framework honours (cucumber-js, behave, godog, …); a `--name` filter would be cucumber-specific. The checkout is disposable and never committed, and the file is restored after each re-run. The JUnit case name and classname identify the scenario; a case that cannot be matched is treated as introduced, which is today's behaviour.
- **The fix loops and the record.** A passed baseline means every later red check was introduced by the change, and a waiver means the loop fixes pre-existing failures too. The static-check fix loop already fixes every red check, so it needs no change; the record is what makes that correct. The regression gate reads the waiver. A passed baseline does not let it skip the re-run, because the baseline runs no regression scenario.
- **Out of scope:**
  - removing `withDevServer`'s "run anyway" and turning an issue-branch start failure into a review blocker (ADR-0062);
  - `ADW_APPLICATION_URL` and the `web` runner (ADR-0061);
  - `adwPlanBuildReview` adopting `runScenarioTestFixLoop` (PRD);
  - the reviewer's suppression blocker;
  - any change to the caps of the unit-test or scenario fix loops.
- **Docs.** The `/document` phase updates the module docs that own the touched files:
  - `app_docs/feature-9gjajh-test-and-scenario-phases.md` (the new phase, port and gate modules, and the scenario fix loop);
  - `…-dev-server-and-ports.md`;
  - `…-issue-routing-and-eligibility.md` or `…-takeover-and-coordination.md` (`continueHandler.ts`);
  - `…-webhook-triggers.md`, `…-cron-triggers.md`;
  - `…-sdlc-orchestrators.md`, `…-feature-orchestrators.md`;
  - `…-types.md`, `…-state-and-config.md`.

  A new `Owns:` glob must not overlap an existing one, and a doc that adds ADR-0060 to its `## Decisions` must change the matching `Decisions:` block in `.adw/conditional_docs.md` in the same commit; otherwise `bun run lint:docs-index` fails. `UBIQUITOUS_LANGUAGE.md` may gain **Baseline**, **Base Worktree**, **Waiver** and **Pre-existing Failure**, and its Retry Directive entry may mention `## Continue`'s meaning on a base-branch park. `specs/adr/README.md` still says records 0058–0063 are not yet implemented. Refresh that sentence when the PRD's work completes; each record's own `### Confirmation` is authoritative meanwhile.
- **Uncommitted README edits.** At planning time `README.md` has uncommitted directory-tree edits in this worktree, listing #989's split test files. They are correct; keep them and add this issue's entries on top.
