# Bug: Surface rows 12, 13, 14, 17, 18, 24, 25, 26, 27 and 35 are still pending: they name orchestrators that do not run their phases, T11 checks nothing, and the harness, mock forge and mock server cannot serve the install, PR, PR-review, document and depaudit phases

## Metadata
issueNumber: `965`
adwId: `mr7y3g-bug-move-the-install`
issueJson: `{"number":965,"title":"bug: move the install, chore, PR, PR-review, patch, document and depaudit surface rows onto the phase harness","body":"Source: the `## Divergence` section of `specs/adr/0037-tiered-regression-suite-with-fixed-vocabulary.md`, item 3. Read it before planning.\n\nSplit from #935, which was too large for one run and is closed. The facts below come from #935's planning research. Check them against the code before relying on them.\n\nMoves the install, chore, PR, PR-review, patch, document and depaudit surface rows onto the in-process phase harness built in #963. Divergence item 3 stays until the last slice.\n\n## What to build\n\n**Git mock invocation log** (`test/mocks/git-remote-mock.ts`). Row 26 needs it.\n\n- When `MOCK_GIT_LOG` is set, append `{ subcommand, args, cwd }` as a JSONL line for every intercepted network subcommand (`push`, `fetch`, `clone`, `pull`, `ls-remote`).\n- `test-harness.ts` sets `MOCK_GIT_LOG` to a per-setup temp file, exposes its path on the `MockContext` (`gitLogPath`), and removes it on teardown.\n- T11 reads that log for a `push` whose args name the branch.\n- Add a vitest case.\n\n**Mock routes.** Add `PUT /repos/:owner/:repo/actions/secrets/:name` (depaudit secret propagation) and any other route these rows reach. Record requests and update state the way the existing routes do.\n\n**Rows to rewrite**, in place, keeping each file and its `@regression @surface` tags. Drive each through W-S1 and the real `runPhase`, with the phase name its orchestrator passes. The same rules as the other surface slices apply:\n\n- retitle to the orchestrator that runs the phase in production;\n- assert real artefacts only;\n- the assertion follows the code;\n- add a new Given only when needed, and register it.\n\n| Row | Drive | Assert |\n|---|---|---|\n| 12 adwMerge prPhase happy | `executePRPhase` (`'pr'`); retitle to adwPatch | PR creation request, T1 `pr_completed` |\n| 13 adwChore init+plan | `executePlanPhase` under `/chore` | plan comments |\n| 14 adwChore build | `executeBuildPhase` under `/chore` | build comments |\n| 17 adwPatch buildPhase | `executeBuildPhase` (`'build'`) | T1 `build_completed` |\n| 18 adwInit installPhase | `executeInstallPhase` (`'install'`); retitle (no `adwInit` orchestrator exists) | T1 `install_completed` |\n| 24 adwPrReview plan | `executePRReviewPlanPhase` (`'pr_review_plan'`), with a `PRReviewWorkflowConfig` whose `base` is the harness config | T1 `pr_review_plan_completed`, plus the PR comment |\n| 25 adwPrReview build | `executePRReviewBuildPhase` (`'pr_review_build'`) | T1 `pr_review_build_completed` |\n| 26 adwPrReview commit-push | `executePRReviewCommitPushPhase` (`'pr_review_commit_push'`) | T11 push on the branch, T1 |\n| 27 adwDocument documentPhase | `executeDocumentPhase` | document comment |\n| 35 adwMerge depauditSetup | `executeDepauditSetup` (no orchestrator caller) through its `deps` seam, with an `execWithRetry` recorder and the mock-backed `codeHost` | the recorded `depaudit setup` call and the secrets propagated |\n\n## Acceptance criteria\n\n- [ ] All ten rows run in-process and pass, each in under 5 seconds.\n- [ ] T11 reads the git-mock log, and the log is unit-tested.\n- [ ] Scenarios passing on `dev` still pass.\n\n## Blocked by\n\n#963\n","state":"OPEN","author":"paysdoc","labels":["adw:bug"],"createdAt":"2026-10-02T07:59:10Z","comments":[],"actionableComment":null}`

## Bug Description
ADR-0037 decides a hybrid execution model: surface scenarios import phase functions and run in seconds. Item 3 of its `## Divergence` section records that the surface tier is pending. #963 built the in-process phase harness (`features/regression/support/phaseRun.ts`, `phaseConfig.ts`, `mockForgeProviders.ts`, W-S1 and W-S2) and moved rows 02, 03, 04, 05, 31 and 32 onto it. This is the second slice. Rows 12, 13, 14, 17, 18, 24, 25, 26, 27 and 35 still reach W1 `the {string} orchestrator is invoked with adwId {string} and issue {int}` (`features/regression/step_definitions/whenSteps.ts`), which returns `pending`. Divergence item 3 stays open after this slice; it is not edited.

Pointing the ten rows at W-S1 would not make them pass. Each fact below was checked against the code:

1. **The rows name orchestrators that do not run their phases.**
   - Row 12 says adwMerge runs the PR phase. `adws/adwMerge.tsx` never calls `initializeWorkflow` or `executePRPhase`. adwPatch runs `runPhase(config, tracker, executePRPhase, 'pr')` (`adws/adwPatch.tsx:95`).
   - Row 18 names adwInit. `adws/adwInit.tsx` was deleted in 1122ba61. adwBuild (`adws/adwBuild.tsx:53`), adwPatch (`:92`) and adwPrReview (`:45`) run `executeInstallPhase` under `'install'`.
   - Row 27 names adwDocument. adwDocument calls `runDocumentAgent` directly (`adws/adwDocument.tsx:67`) and never `executeDocumentPhase`. adwPlanBuildDocument (`adws/adwPlanBuildDocument.tsx:51`), adwSdlc (`adws/adwSdlc.tsx:114`) and adwChore (`adws/adwChore.tsx:204`) run it, none with a phase name.
   - Row 35 names adwMerge. Nothing calls `executeDepauditSetup`. The deleted adwInit called it directly, outside `runPhase`, under `OrchestratorId.Init` (1122ba61). It returns `DepauditSetupResult`, not a `PhaseResult` (`adws/phases/depauditSetup.ts:51-84`).
2. **Rows 13, 14, 17, 18 and 25 assert `awaiting_merge`, a stage none of the driven phases writes.** `runPhase` writes `<phaseName>_completed` (`markPhaseCompleted`, `adws/core/phaseRunner.ts:90-98`). adwChore writes `awaiting_merge` only after its PR phase (`adws/adwChore.tsx:209`). It runs plan and build with no phase name (`:176-177`), so they write no stage at all.
3. **T11 asserts nothing about git.** `the git-mock recorded a push to branch {string}` compares `World.targetBranch` with the branch (`features/regression/step_definitions/thenSteps.ts:363-373`). G11 sets that field, so T11 passes whether anything was pushed or not. The git mock records nothing; it prints canned output and exits (`test/mocks/git-remote-mock.ts:58-62`).
4. **The mock forge refuses every `CodeHost` method** (`features/regression/support/mockForgeProviders.ts:53-70`):
   - the PR phase needs `getDefaultBranch` and `createPullRequest`;
   - the PR-review phases post through `codeHost.commentOnPullRequest`. `postPRStageComment` catches the throw and only logs it (`adws/phases/phaseCommentHelpers.ts:54-61`), so a phase run would succeed while recording no PR comment;
   - the depaudit setup calls `setSecret`. `propagateSecret` catches that throw too (`adws/phases/depauditSetup.ts:42-48`), so each secret would be skipped silently.
5. **The mock server has no secrets route.** The route table (`test/mocks/github-api-server.ts:178-193`) and `MockServerState` (`test/mocks/types.ts:26-35`) know nothing about Actions secrets.
6. **The harness knows two orchestrators.** `phaseConfig.ts:47-50` defines only `plan` and `build`, each with one phase. There is no chore, patch, PR-review or document orchestrator, and no install, PR, PR-review or document phase. The PR-review phases take a `PRReviewWorkflowConfig`, not a `WorkflowConfig` (`adws/phases/prReviewPhase.ts:15-21`).
7. **A per-issue scenario pins the passing rows.** feature-960 §6 (`features/per-issue/feature-960.feature:357-367`, tagged `@adw-960 @adw-963`) asserts that every smoke and surface scenario except #963's six rows is reported pending. Once the ten rows pass, it fails unless it is amended.

Expected behaviour: the ten rows drive the real phase functions in-process, under the phase name the production orchestrator passes. Row 35 is the exception: its function has no orchestrator, so it is driven through its `deps` seam. The rows run against the mock forge, the fixture worktree from G11 and the per-command Claude stub. They assert only artefacts the run produces, and each finishes in under 5 seconds. T11 reads a real record of the pushes the git mock intercepted.

## Problem Statement
Build what the ten rows need, and nothing more:

- **The git mock:** a JSONL invocation log, enabled by `MOCK_GIT_LOG`. `setupMockInfrastructure` provides it per setup and exposes it as `MockContext.gitLogPath`. It is unit-tested.
- **The mock server:** `PUT /repos/:owner/:repo/actions/secrets/:secretName`. It records the request and keeps the secret's metadata in a new `secrets` state map.
- **The mock forge:** `getDefaultBranch`, `createPullRequest`, `commentOnPullRequest` and `setSecret`.
- **The harness:**
  - orchestrator entries for chore, patch, PR-review and plan-build-document, plus the install phase of build;
  - a `PRReviewWorkflowConfig` built around the harness config;
  - an in-process runner for the dependency-audit setup.
- **Steps:**
  - T11 reads the log;
  - a new Given seeds an open pull request;
  - a new When runs the dependency-audit setup;
  - three new Thens.
- **Fixtures:** six new stub manifests.
- **The ten rows:** rewritten in place.
- **feature-960 §6:** amended.
- **Vocabulary:** the registry entries.

Findings that shape the design, each checked against the code:

- **F1. Phase names decide what T1 can assert.**
  - adwPatch passes `'pr'` and `'build'`; adwBuild passes `'install'`; adwPrReview passes `'pr_review_plan'`, `'pr_review_build'` and `'pr_review_commit_push'`. Those rows assert T1 `<name>_completed`.
  - adwChore and adwPlanBuildDocument pass no name. Rows 13, 14 and 27 therefore assert the phase run's outcome and its comments.
- **F2. The install phase never fails.** `executeInstallPhase` catches every error and returns (`adws/phases/installPhase.ts:87-155`), so `install_completed` is written whatever the agent does. Row 18 proves the wiring from phase name to stage, which is all the code guarantees.
- **F3. The commit agent throws on failure, and the stub's `onCommitCommand` fails on a clean worktree.**
  - `runCommitAgent` throws when the agent fails (`adws/agents/gitAgent.ts:167-172`).
  - `stageAllAndCommit` runs `git commit` with nothing staged and exits 1 (`test/mocks/manifestInterpreter.ts:47-50`).
  - Row 26 runs no build phase, so its worktree is clean. Its manifest answers `/commit` with a `byCommand` entry that makes one allow-empty commit.
  - Row 27 commits the document its `/document` entry wrote, so it can use `onCommitCommand`.
- **F4. The document stage comments have no formatter case.** `document_running` and `document_completed` fall to the default branch of `formatWorkflowComment`, which posts `## ADW Workflow Update` and `**Stage:** <stage>` (`adws/forge/workflowCommentsIssue.ts:321-366`). Row 27 asserts that text.
- **F5. The PR-creation request carries the issue number only through the agent's answer.**
  - The GitHub adapter sends title, body, head and base, and ignores `linkedIssueNumber` (`githubCodeHost.js:109-130` in `@paysdoc/devplatform`).
  - `.claude/commands/pull_request.md` requires the title `<type>: #<issueNumber> - <title>` and both `Closes #<issueNumber>` and `Implements #<issueNumber>` in the body. The stub answers to that contract.
  - The agent's output is `result.result`, which the stub cuts to 500 characters (`test/mocks/claude-cli-stub.ts:219`, `adws/agents/agentProcessHandler.ts:216`). The answer stays short.
- **F6. The git mock sees the phases' pushes.**
  - `GitContext.exec` spawns through `execSync` with `{ ...process.env, ...credentialEnv }` (`git/gitContext.js` in `@paysdoc/devplatform`).
  - Under the `@regression` hooks, `PATH` therefore resolves `git` to the git-mock wrapper, and `MOCK_GIT_LOG` reaches it.
  - `pushBranch` runs `git fetch origin "<branch>"`, then `git push --force-with-lease --force-if-includes -u origin "<branch>"` (`git/commitOps.js:104-118`).
  - Agent subprocesses drop every `MOCK_*` name, but none of them runs a network subcommand.
- **F7. The PR-review build phase takes the plan phase's output as an argument** (`adws/adwPrReview.tsx:49`). A row that runs only the build phase must hand it a revision plan.
- **F8. `executeDepauditSetup` cannot run under W-S1.** No orchestrator runs it, so there is no orchestrator to name and no phase name to pass. Its result is not a `PhaseResult`, so `runPhase` would have to wrap it in an adapter production does not have. Row 35 gets its own When, which calls the function directly through its `deps` seam, as the deleted adwInit did.

## Solution Statement
- **Git mock log.**
  - A small `test/mocks/gitMockLog.ts` appends and reads `GitMockInvocation` records (`{ subcommand, args, cwd }`, declared in `types.ts`).
  - `git-remote-mock.ts` appends one line per intercepted network subcommand when `MOCK_GIT_LOG` is set. `args` is the full argument vector after `git`, and `cwd` is the process's cwd. A logging failure never fails git.
  - `setupMockInfrastructure` creates an empty `invocations.jsonl` in a fresh `adw-git-log-` temp directory under `os.tmpdir()`, sets `MOCK_GIT_LOG` to it and returns it as `MockContext.gitLogPath`. Teardown removes the directory and restores the variable through `savedEnv`.
  - T11 reads the log for a `push` whose args include the branch.
- **Mock server.** `PUT /repos/:owner/:repo/actions/secrets/:secretName` upserts `{ name, created_at, updated_at }` into `MockServerState.secrets`, never the value. It answers 201 when it creates the secret and 204 when it updates one, as GitHub does. `loadDefaultState` adds `secrets: {}`. No other route is needed: the rows reach `POST …/pulls` and `POST …/issues/:n/comments`, which exist, and `getDefaultBranch` needs no route.
- **Mock forge.** Every method that reaches the server goes through one helper. It calls `dispatchMockRequest` and throws `mockForgeProviders: <method> was answered <status>: <body>` on a status of 400 or more.
  - `getDefaultBranch` returns `'main'`: G11 commits the fixture on `main`, the branch `buildPhaseConfig` names as the default.
  - `createPullRequest` posts the REST body `{ title, body, head: sourceBranch, base: targetBranch }` to `/repos/<o>/<r>/pulls` and returns `{ url: https://github.com/<o>/<r>/pull/<n>, number }` from the response.
  - `commentOnPullRequest` posts `{ body }` to `/repos/<o>/<r>/issues/<pr>/comments`. That is GitHub's REST endpoint for a pull request's conversation comments, so T2, T3, T-S6 and the new T-S7 read it.
  - `setSecret` puts `{ encrypted_value: value }` to `/repos/<o>/<r>/actions/secrets/<name>`.
  - Every other method still throws `not supported`.
- **Harness.**
  - `phaseConfig.ts` gains these orchestrator entries:
    - `chore`: `/chore`; `plan` and `build`, no phase name;
    - `patch`: `build` and `pr`, under `'build'` and `'pr'`;
    - `pr-review`: `/pr_review`; its three phases under their production names;
    - `plan-build-document`: `document`, no phase name;
    - `build` gains `install`, under `'install'`.
  - The PR-review phase functions build a `PRReviewWorkflowConfig` whose `base` is the harness config, as adwPrReview's closures do. The pull request comes from the mock server's state, seeded by the new Given G-S2. A `REVISION_PLAN` constant stands in for the plan phase's output (F7).
  - The mock-state readers move from `phaseConfig.ts` into `support/seededRecords.ts`, which `phaseConfig.ts` imports. `buildPhaseConfig` is split so the depaudit runner can build the same config for an id that no W-S1 orchestrator names.
  - `phaseRun.ts` gains `runSurfaceDepauditSetup`. It calls `executeDepauditSetup(config, deps)` with three `deps`:
    - an `execWithRetry` recorder that runs nothing;
    - a `getEnv` that answers every secret;
    - the mock forge's `codeHost`.
- **Steps.**
  - T11 reads the log.
  - G-S2 seeds an open pull request and one review comment.
  - W-S3 runs the dependency-audit setup.
  - T-S7: a comment on a pull request containing a text.
  - T-S8: the recorded `depaudit setup` call.
  - T-S9: a recorded secret `PUT`.
- **Rows, fixtures, registry.**
  - The ten rows are rewritten in place, retitled to the orchestrator that runs the phase. Row 35 is titled for the setup itself, since no orchestrator runs it.
  - Six new manifests serve the rows. `surface-build-phase.json` is reused by rows 14, 17 and 25.
  - feature-960 §6 lists the ten rows as passing.
  - `vocabulary.md` registers everything.

## Steps to Reproduce
Run from the repository root; `ROOT` is that directory. Never run two Cucumber processes from this checkout at once.

1. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@surface" --format summary`. On `dev` this reports `34 scenarios (28 pending, 6 passed)`, and Cucumber exits 1. All ten rows are among the pending ones, stopped at W1.
2. T11 asserts nothing about git: `sed -n 363,373p features/regression/step_definitions/thenSteps.ts`. The git mock writes no record:
   ```sh
   d=$(mktemp -d); (cd "$d" && MOCK_GIT_LOG="$d/git.jsonl" bun "$ROOT/test/mocks/git-remote-mock.ts" push origin surface-26); test ! -e "$d/git.jsonl" && echo "no invocation recorded"
   ```
3. The rows name orchestrators that do not run their phases:
   - `ls adws/adwInit.tsx` fails;
   - `grep -n "executePRPhase\|executeDepauditSetup" adws/adwMerge.tsx` and `grep -n "executeDocumentPhase" adws/adwDocument.tsx` find nothing;
   - `grep -n "executeDepauditSetup(" adws/*.tsx` finds nothing;
   - `grep -n "runPhase" adws/adwPatch.tsx adws/adwChore.tsx adws/adwPrReview.tsx adws/adwBuild.tsx adws/adwPlanBuildDocument.tsx` shows the phase names of F1.
4. The mock forge and server cannot serve these phases:
   - `grep -n "notSupported('\(getDefaultBranch\|createPullRequest\|commentOnPullRequest\|setSecret\)')" features/regression/support/mockForgeProviders.ts` finds all four;
   - `grep -c "actions/secrets" test/mocks/github-api-server.ts` prints `0`.
5. The harness knows two orchestrators: `sed -n 47,50p features/regression/support/phaseConfig.ts`.

## Root Cause Analysis
The ten rows were written in #492 against orchestrators and stages that do not exist:

- adwInit running the install phase and the depaudit setup;
- adwMerge running the PR phase;
- adwDocument running `executeDocumentPhase`;
- every phase ending at `awaiting_merge`.

They were parked behind the pending W1, so nothing ever checked them. The ADR-0037 cutover never built the in-process path. #963 built it for the plan, build and lock rows only:

- its harness table, mock forge and mock server cover exactly what those rows call;
- T11 stayed a placeholder because the git mock never recorded an invocation. Its own comment says so: "The git-remote-mock's invocation log is not readable here yet".

## Relevant Files
Use these files to fix the bug:

- `README.md`: project overview (read first).
- `.adw/coding_guidelines.md`: guard clauses, at most two levels of nesting, no `any`, files under 300 lines, comment discipline (no issue numbers in comments).
- `app_docs/feature-9gjajh-bdd-regression-suite.md`: the conditional doc for `test/mocks/**` and `features/regression/**`. It records the invariants this change must keep: hook compatibility, `os.tmpdir()` scratch, and never two Cucumber processes in one checkout. Its line about `mockForgeProviders` implementing only `commentOnIssue` and `moveToStatus` goes stale; the document phase refreshes it.
- `specs/adr/0037-tiered-regression-suite-with-fixed-vocabulary.md`: the hybrid execution model and Divergence item 3. Context only; not edited.
- `specs/issue-963-adw-g53ol8-bug-build-the-in-pro-sdlc_planner-in-process-phase-harness-surface-rows.md`: the harness this slice extends, and its conventions.
- `test/mocks/git-remote-mock.ts`: gains the invocation log.
- `test/mocks/test-harness.ts`: sets `MOCK_GIT_LOG`, exposes `gitLogPath`, removes the log on teardown.
- `test/mocks/types.ts`: `MockContext.gitLogPath`, `MockServerState.secrets`, `GitMockInvocation`.
- `test/mocks/github-api-server.ts`: gains the secrets route and state.
- `test/mocks/manifestInterpreter.ts`, `test/mocks/manifestSchema.ts`: `byCommand` entries with `edits`, `commits` and `response`; `onCommitCommand`. Read, not changed.
- `test/mocks/claude-cli-stub.ts`: the 500-character `result` and the no-manifest fallback payload. Read, not changed.
- `test/mocks/__tests__/test-harness.test.ts`, `mockServerDispatch.test.ts`: extended. `claude-cli-stub.test.ts` shows the spawn conventions. `manifestRefusalGuard.test.ts` sweeps every committed manifest, so the new ones must pass it.
- `test/fixtures/jsonl/manifests/surface-build-phase.json`: reused by rows 14, 17 and 25; its `/implement` answer loses the issue number.
- `test/fixtures/cli-tool/**`: what G11 materialises. It has no `.adw/conditional_docs.md`, so the docs self-check sees an empty registry. Read only.
- `features/regression/support/phaseConfig.ts`: the orchestrator table, `buildPhaseConfig` and the PR-review config.
- `features/regression/support/phaseRun.ts`: gains `runSurfaceDepauditSetup`.
- `features/regression/support/mockForgeProviders.ts`: gains the four `CodeHost` methods.
- `features/regression/support/hooks.ts`: resets the new World field.
- `features/regression/support/fixtureWorktree.ts`, `claudeCliStub.ts`, `cleanup.ts`: G11, stub delivery and cleanup. Read, not changed.
- `features/regression/step_definitions/thenSteps.ts`: T11.
- `features/regression/step_definitions/surfaceSteps.ts`: G-S2, W-S3, T-S7, T-S8, T-S9.
- `features/regression/step_definitions/world.ts`: `DepauditOutcome`.
- `features/regression/step_definitions/givenSteps.ts`: G2, G3, G4 and G11. Read, not changed.
- `features/regression/surfaces/row-12-adwMerge-prPhase-happy.feature`, `row-13-adwChore-workflowInit-planPhase-happy.feature`, `row-14-adwChore-buildPhase-happy.feature`, `row-17-adwPatch-buildPhase-happy.feature`, `row-18-adwInit-installPhase-happy.feature`, `row-24-adwPrReview-prReviewPlanPhase-happy.feature`, `row-25-adwPrReview-prReviewBuildPhase-happy.feature`, `row-26-adwPrReview-commitPushPhase-happy.feature`, `row-27-adwDocument-documentPhase-happy.feature`, `row-35-adwMerge-depauditSetup-happy.feature`: the ten rows.
- `features/regression/vocabulary.md`: the registry.
- `features/per-issue/feature-960.feature`: §6 is amended. `features/per-issue/step_definitions/feature-960.steps.ts` implements it; read, not changed.
- `features/per-issue/feature-963.feature` and `features/per-issue/step_definitions/feature-963*.ts`: must stay green. They run the whole `@surface` tier twice.
- `features/support/cucumberChildRun.ts`: `CHILD_TIMEOUT_MS` (120 s) bounds each child run; `ScenarioOutcome.durationMs` measures each row.
- `adws/core/phaseRunner.ts`: `runPhase`, `markPhaseCompleted` (F1), `isPhaseAlreadyCompleted`.
- `adws/adwPatch.tsx`, `adws/adwBuild.tsx`, `adws/adwChore.tsx`, `adws/adwPrReview.tsx`, `adws/adwPlanBuildDocument.tsx`, `adws/adwDocument.tsx`, `adws/adwMerge.tsx`: the orchestrators, and which phases they run under which names.
- `adws/phases/prPhase.ts`, `planPhase.ts`, `buildPhase.ts`, `installPhase.ts`, `prReviewPhase.ts`, `documentPhase.ts`, `depauditSetup.ts`: the driven functions.
- `adws/phases/phaseCommentHelpers.ts`, `adws/forge/workflowCommentsIssue.ts`, `adws/forge/workflowCommentsPR.ts`: the stage comments and their headings.
- `adws/phases/docsSelfCheck.ts`: non-fatal; with a short document it calls no issue-tracker method.
- `adws/phases/workflowRepoIdentity.ts`: `resolveWorkflowRepoId`, `requireWorkflowGitContext`, `workflowLaunchContext`.
- `adws/agents/prAgent.ts`, `gitAgent.ts`, `planAgent.ts`, `buildAgent.ts`, `documentAgent.ts`, `installAgent.ts`: the slash command each agent opens its prompt with: `/pull_request`, `/commit`, the issue type or `/pr_review`, `/implement`, `/document`, `/install`.
- `adws/core/constants.ts`, `adws/core/orchestratorNames.ts`, `adws/types/issueTypes.ts`: `OrchestratorId` (including `Init`), `deriveOrchestratorScript`, and `IssueClassSlashCommand` (including `/adw_init`).
- `.claude/commands/pull_request.md`: the title and body contract the `/pull_request` answer follows (F5).
- `node_modules/@paysdoc/devplatform/dist/providers/github/githubCodeHost.js`, `ghRepoApi.js`, `commands/prCommands.js`, `commands/secretCommands.js`, `dist/git/gitContext.js`, `dist/git/commitOps.js`: what the real adapter sends, and how `GitContext` spawns git. Reference only.

### New Files
- `test/mocks/gitMockLog.ts`: `appendGitMockInvocation(logPath, invocation)` and `readGitMockLog(logPath)`.
- `test/mocks/__tests__/gitRemoteMock.test.ts`: unit tests for the git-mock log.
- `features/regression/support/seededRecords.ts`: reads what G4 and G-S2 seeded from the mock server's state, mapped to the port types.
- `test/fixtures/jsonl/manifests/surface-pr-phase.json`: row 12.
- `test/fixtures/jsonl/manifests/surface-chore-plan-phase.json`: row 13.
- `test/fixtures/jsonl/manifests/surface-install-phase.json`: row 18.
- `test/fixtures/jsonl/manifests/surface-pr-review-plan-phase.json`: row 24.
- `test/fixtures/jsonl/manifests/surface-pr-review-commit-push.json`: row 26.
- `test/fixtures/jsonl/manifests/surface-document-phase.json`: row 27.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Record the baseline
- Before any change, run these and keep both summaries; validation compares against them:
  - `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression" > /tmp/adw-965-regression.before 2>&1`
  - `bun run test:unit > /tmp/adw-965-unit.before 2>&1`
- Never run two Cucumber processes from the same checkout at once. The pause-queue rows share `agents/paused_queue.json` and `agents/spawn_locks/`.

### 2. The git-mock invocation log
- `test/mocks/types.ts`:
  - add `export interface GitMockInvocation { readonly subcommand: string; readonly args: readonly string[]; readonly cwd: string }`;
  - add `gitLogPath: string` to `MockContext`.
- New `test/mocks/gitMockLog.ts`:
  - `appendGitMockInvocation(logPath, invocation)` appends `JSON.stringify(invocation)` and a newline;
  - `readGitMockLog(logPath): GitMockInvocation[]` returns `[]` when the file is missing, skips blank lines, and keeps only lines a type guard accepts: `subcommand` and `cwd` strings, `args` an array of strings.
  - No `any`.
- `test/mocks/git-remote-mock.ts`:
  - when the subcommand is in `REMOTE_COMMANDS` and `MOCK_GIT_LOG` is set, call `appendGitMockInvocation(MOCK_GIT_LOG, { subcommand, args, cwd: process.cwd() })` before printing the canned output. `args` is `process.argv.slice(2)`, so it includes the subcommand and its flags.
  - Wrap the append in `try/catch` and ignore failures, as the stub's `recordInvocation` does. Git must never fail because of the log.
  - Document `MOCK_GIT_LOG` in the header's environment list. Local subcommands stay delegated and unlogged.

### 3. The harness provides the log per setup
- `test/mocks/test-harness.ts`:
  - add `MOCK_GIT_LOG` to `SavedEnv`, and capture it with the others;
  - after the git-mock directory is created:
    - `gitLogDir = mkdtempSync(join(tmpdir(), 'adw-git-log-'))`;
    - `gitLogPath = join(gitLogDir, 'invocations.jsonl')`;
    - `writeFileSync(gitLogPath, '')`;
    - `process.env['MOCK_GIT_LOG'] = gitLogPath`.
    Keep both in module variables beside `gitMockTempDir`;
  - `buildContext` returns `gitLogPath`. The idempotent second-setup path returns the same path;
  - `teardownMockInfrastructure` removes `gitLogDir` with `rmSync(…, { recursive: true, force: true })`, guarded as `cleanupGitMockDir` is, and nulls both variables. The `savedEnv` loop restores `MOCK_GIT_LOG`.
  - Setup stays crash-safe: a failure before the log exists leaves nothing to remove.
- Update the header comment to name the log in one line.

### 4. Unit-test the log (AC2)
Follow `claude-cli-stub.test.ts`: temp directories under `os.tmpdir()` removed in `afterEach`, the script spawned with `bun`. Each file stays under 300 lines.

- New `test/mocks/__tests__/gitRemoteMock.test.ts`. It spawns `bun test/mocks/git-remote-mock.ts …` with `spawnSync`, `cwd` a temp directory, and `MOCK_GIT_LOG` pointing into it:
  - `push --force-with-lease --force-if-includes -u origin surface-26` exits 0 and prints `Everything up-to-date`. `readGitMockLog` returns exactly `{ subcommand: 'push', args: ['push', '--force-with-lease', '--force-if-includes', '-u', 'origin', 'surface-26'], cwd: realpathSync(dir) }`. On macOS `/var` links to `/private/var`, so compare against the real path;
  - each of `fetch`, `clone`, `pull` and `ls-remote` (`it.each`) is recorded under its own subcommand and exits 0;
  - two invocations append two lines, in order;
  - a local subcommand, `init -q` with `REAL_GIT_PATH` set to the real git (`execSync('which git')`), is delegated (a `.git` directory appears) and is not recorded;
  - without `MOCK_GIT_LOG`, a push still exits 0 with the canned output and writes no file;
  - `readGitMockLog` returns `[]` for a missing file and skips blank lines.
- `test/mocks/__tests__/test-harness.test.ts`, under a new `describe('setupMockInfrastructure — git-mock invocation log')`:
  - the context's `gitLogPath` equals `process.env.MOCK_GIT_LOG`, lies under `tmpdir()` and outside `process.cwd()`, and is an existing empty file;
  - a `git push origin surface-26` run with `execFileSync('git', …)` through the `PATH` the setup installed, from a temp cwd, is recorded in `gitLogPath`. This is the path T11 relies on;
  - after `teardownMockInfrastructure()` the file is gone, and `MOCK_GIT_LOG` has its value from before setup.

### 5. Mock server: the Actions-secrets route
- `test/mocks/types.ts`: add `secrets: Record<string, unknown>` to `MockServerState`. It maps a secret's name to its metadata, never its value.
- `test/mocks/github-api-server.ts`:
  - `loadDefaultState()` adds `secrets: {}`;
  - add `putActionsSecret: RouteHandler`. For `params['secretName']` it keeps `created_at` from an existing entry or now, sets `updated_at` to now, and replaces `serverState` immutably as the other handlers do. It answers `jsonResponse({}, 201)` when the secret is new and `{ status: 204, body: '' }` when it existed;
  - register `{ method: 'PUT', pattern: '/repos/:owner/:repo/actions/secrets/:secretName', handler: putActionsSecret }`. `dispatchMockRequest` records the request already.
- `test/mocks/__tests__/mockServerDispatch.test.ts` adds:
  - a first `PUT /repos/acme/widgets/actions/secrets/SOCKET_API_TOKEN` answers 201 and is recorded with its method, URL and body. `getMockServerState().secrets.SOCKET_API_TOKEN` holds `name` and the timestamps, and no `encrypted_value`;
  - a second `PUT` for the same name answers 204 and keeps `created_at`;
  - `resetMockServer()` leaves `secrets` empty.

### 6. The mock forge
In `features/regression/support/mockForgeProviders.ts`:

- Extract one helper that both trackers use: `dispatchOrThrow(method: string, httpMethod: string, path: string, payload: Record<string, unknown>): MockResponse`. It calls `dispatchMockRequest(httpMethod, path, JSON.stringify(payload))` and throws `mockForgeProviders: <method> was answered <status>: <body>` when the status is 400 or more. `commentOnIssue` uses it unchanged in behaviour.
- Replace the `unsupportedCodeHost` constant with `codeHostFor(repoId): CodeHost`, written out against the port interface (no Proxy):
  - `getDefaultBranch: () => 'main'`;
  - `createPullRequest({ title, body, sourceBranch, targetBranch })`:
    - posts `{ title, body, head: sourceBranch, base: targetBranch }` to `/repos/<owner>/<repo>/pulls`;
    - narrows the response body to a record with a numeric `number`, without `as` casts on `unknown`, and throws otherwise;
    - returns `{ url: \`https://github.com/<owner>/<repo>/pull/<number>\`, number }`;
  - `commentOnPullRequest(prNumber, body)` posts `{ body }` to `/repos/<owner>/<repo>/issues/<prNumber>/comments`;
  - `setSecret(name, value)` puts `{ encrypted_value: value }` to `/repos/<owner>/<repo>/actions/secrets/<name>`. One comment says why the value is unsealed: GitHub takes it sealed with the repository's public key, and the mock seals nothing;
  - every other method keeps `notSupported('<method>')`.
- Update the header comment: name the methods that are implemented and why `getDefaultBranch` answers `main` (G11 commits the fixture on `main`).

### 7. Seeded records and the harness configuration
- New `features/regression/support/seededRecords.ts`:
  - **Moved verbatim from `phaseConfig.ts`:** `isRecord`, `labelName`, `toPortIssue` and `seededIssue`, which `phaseConfig.ts` then imports. The move keeps `phaseConfig.ts` under 300 lines and lets the PR-review readers share `isRecord` without an import cycle.
  - **Added:**
    - `seededPullRequest(): PullRequest`. It requires exactly one entry in `getMockServerState().prs` and otherwise fails naming the numbers found and that G-S2 must seed it, since G-S2 replaces the map.
      - It maps gh's JSON shape to the port `PullRequest`: `number`, `title`, `body`, `state`, `url`; `sourceBranch` from `headRefName`; `targetBranch` from `baseRefName`.
      - `linkedIssueNumber` comes from the body's `Implements #(\d+)` marker, as the GitHub adapter's `parsePRDetails` does.
    - `seededReviewComments(prNumber): ReviewComment[]`. It maps `getMockServerState().comments[<prNumber>]`, each `{ id, body, user.login, created_at }`, to `{ id: String(id), body, author, createdAt }`.
- `features/regression/support/phaseConfig.ts`:
  - **Split `buildPhaseConfig`.**
    - `export function buildConfigFor(world, adwId, launch: Pick<OrchestratorDefinition, 'id' | 'issueType'>): WorkflowConfig` holds today's body unchanged.
    - `buildPhaseConfig(world, adwId, orchestratorName)` becomes `buildConfigFor(world, adwId, orchestratorDefinition(orchestratorName))`.
  - **Extend `ORCHESTRATORS`.** Import every phase statically, never with `await import`:
    - `build`: add `install: { fn: executeInstallPhase, phaseName: 'install' }` (adwBuild.tsx:53);
    - `chore`: `{ id: OrchestratorId.Chore, issueType: '/chore', phases: { plan: { fn: executePlanPhase }, build: { fn: executeBuildPhase } } }`. adwChore passes no phase name (adwChore.tsx:176-177);
    - `patch`: `{ id: OrchestratorId.Patch, issueType: '/feature', phases: { build: { fn: executeBuildPhase, phaseName: 'build' }, pr: { fn: executePRPhase, phaseName: 'pr' } } }` (adwPatch.tsx:94-95);
    - `'plan-build-document'`: `{ id: OrchestratorId.PlanBuildDocument, issueType: '/feature', phases: { document: { fn: executeDocumentPhase } } }`. adwPlanBuildDocument passes no phase name (adwPlanBuildDocument.tsx:51);
    - `'pr-review'`: `{ id: OrchestratorId.PrReview, issueType: '/pr_review', phases: { … } }`, with phase names as at adwPrReview.tsx:47-75:
      - `pr_review_plan`: `{ fn: (config) => executePRReviewPlanPhase(prReviewWorkflowConfig(config)), phaseName: 'pr_review_plan' }`;
      - `pr_review_build`: `{ fn: (config) => executePRReviewBuildPhase(prReviewWorkflowConfig(config), REVISION_PLAN), phaseName: 'pr_review_build' }`;
      - `pr_review_commit_push`: `{ fn: (config) => executePRReviewCommitPushPhase(prReviewWorkflowConfig(config)), phaseName: 'pr_review_commit_push' }`.
  - **Add `export const REVISION_PLAN`.** A one-line revision plan, with one comment: adwPrReview hands the build phase the plan phase's output, and the build row runs without the plan phase.
  - **Add `prReviewWorkflowConfig(base: WorkflowConfig): PRReviewWorkflowConfig`.**
    - `prDetails = seededPullRequest()`.
    - Assert `prDetails.sourceBranch === base.branchName`. The message names both branches: production checks out the PR's branch, and a mismatch would push a branch the worktree is not on.
    - `unaddressedComments = seededReviewComments(prDetails.number)`.
    - `ctx = { issueNumber: base.issueNumber, adwId: base.adwId, prNumber: prDetails.number, reviewComments: unaddressedComments.length, branchName: prDetails.sourceBranch }`.
    - Return `{ base, prNumber: prDetails.number, prDetails, unaddressedComments, ctx }`. `base` is the harness config itself, as the issue specifies.
  - Use `import type` for `WorkflowConfig` and `PRReviewWorkflowConfig`.

### 8. The dependency-audit runner, the World and the hooks
- `features/regression/step_definitions/world.ts`:
  - add `export interface RecordedExec { readonly command: string; readonly cwd: string }`;
  - add `export interface DepauditOutcome { adwId: string; execCalls: readonly RecordedExec[]; result?: DepauditSetupResult; error?: unknown }`, with a type-only import of `DepauditSetupResult`;
  - add the field `depauditOutcome?: DepauditOutcome`.
- `features/regression/support/phaseRun.ts`:
  - `const DEPAUDIT_SETUP_LAUNCH = { id: OrchestratorId.Init, issueType: '/adw_init' } as const`, with one comment: no orchestrator runs the setup, and `init-orchestrator` is the id the deleted adwInit ran it under;
  - `export async function runSurfaceDepauditSetup(world, adwId): Promise<DepauditOutcome>`:
    - build the config with `buildConfigFor(world, adwId, DEPAUDIT_SETUP_LAUNCH)`. It deletes `agents/<adwId>/` and registers its cleanup exactly as W-S1 does;
    - collect `execCalls`;
    - call `executeDepauditSetup(config, deps)`:
      - `execWithRetry: (command, options) => { execCalls.push({ command, cwd: String(options?.cwd ?? '') }); return ''; }`. It runs nothing: the real `depaudit` binary would touch the network;
      - `getEnv: (name) => \`surface-${name.toLowerCase()}\``. Every secret the setup propagates is set;
      - `codeHost: config.repoContext?.codeHost`, the mock forge's;
    - return `{ adwId, execCalls, result }`, or `{ adwId, execCalls, error }` if it throws.
  - No stub delivery, `runPhase` or exit trap: the function runs no agent, has no phase name and never exits (F8).
- `features/regression/support/hooks.ts`: in the `@regression` After hook, reset `this.depauditOutcome = undefined` beside the other fields.

### 9. Steps: T11, G-S2, W-S3, T-S7, T-S8 and T-S9
- **T11**, in place in `features/regression/step_definitions/thenSteps.ts`:
  - assert `this.mockContext` exists (the Before hook sets it);
  - read `readGitMockLog(this.mockContext.gitLogPath)`;
  - assert some invocation has `subcommand === 'push'` and `args.includes(branch)`. On failure, the message lists every recorded invocation as `subcommand args…`, or says none was recorded;
  - delete the placeholder comment. `World.targetBranch` stays; G11 and T4 use it.
- In `features/regression/step_definitions/surfaceSteps.ts`. None of these phrases contains `/` or parentheses, which a Cucumber expression would read as alternation and optional text:
  - **G-S2** `a pull request {int} for issue {int} is open on the branch {string} with a review comment to address`. It asserts `this.mockContext`, then calls `await this.mockContext.setState({ prs, comments })`, which replaces both maps:
    - `prs`: `{ [pr]: { number: pr, title: \`Issue ${issue}\`, body: \`Implements #${issue}\`, state: 'OPEN', headRefName: branch, baseRefName: 'main', url: \`https://github.com/acme/widgets/pull/${pr}\` } }`;
    - `comments`: `{ [pr]: [{ id: 1, body: 'Please rename the helper to say what it builds.', user: { login: 'reviewer' }, created_at: new Date(0).toISOString() }] }`.
  - **W-S3** `the dependency-audit setup runs for adwId {string} on a host whose environment sets every secret it propagates`: `this.depauditOutcome = await runSurfaceDepauditSetup(this, adwId)`.
  - **T-S7** `the mock GitHub API recorded a comment on pull request {int} containing the text {string}`. It asserts a recorded `POST` whose URL includes `/issues/<pr>/comments` and whose JSON `body` contains the text; reuse `commentBodyContains`. On failure, the message gives the number of comment posts recorded for that number.
  - **T-S8** `the dependency-audit setup ran the command {string} in the worktree for adwId {string}`:
    - the outcome exists and is for that adwId;
    - `error` is undefined and `result` is set;
    - some `execCalls` entry has that command and the cwd `this.worktreePaths.get(adwId)`.
    On failure, the message lists the recorded calls.
  - **T-S9** `the mock GitHub API recorded the Actions secret {string} set on the repository {string}`. It asserts a recorded `PUT` whose URL is `/repos/<owner>/<repo>/actions/secrets/<name>`. On failure, the message lists the recorded `PUT` URLs.
  - No step returns `'pending'`, and no step reads a source file.

### 10. Stub manifests
Every new manifest follows the existing surface manifests:

- a top-level fallback payload written to `.adw-stub-payload.json`, which G11's `.gitignore` covers;
- `jsonlPath: ".adw-stub-payload.json"`;
- one `byCommand` entry per agent command the row reaches;
- nothing under `.adw/`, `.claude/` or `agents/`, and nothing outside the worktree.

`findRefusedPaths` must return `[]` for each; `manifestRefusalGuard.test.ts` and feature-963 sweep the directory. Each payload is a JSON array with one `text` block.

- **`surface-pr-phase.json`** (row 12): `byCommand["/pull_request"]` answers this exact text, a short JSON object (F5):
  ```
  {"title":"feat: #1012 - Issue 1012","body":"Closes #1012\nImplements #1012\n\nADW tracking ID: surface-12"}
  ```
  Write the file with two levels of `JSON.stringify`: `JSON.stringify([{ type: 'text', text: JSON.stringify({ title, body }) }])` gives the edit's `contents`. Encoded, it is:
  ```
  "[{\"type\":\"text\",\"text\":\"{\\\"title\\\":\\\"feat: #1012 - Issue 1012\\\",\\\"body\\\":\\\"Closes #1012\\\\nImplements #1012\\\\n\\\\nADW tracking ID: surface-12\\\"}\"}]\n"
  ```
- **`surface-chore-plan-phase.json`** (row 13): `byCommand["/chore"]`. The plan agent's command is the issue type (`adws/agents/planAgent.ts:206`). Its edits:
  - the payload: `The chore plan for issue 1013 was written.`;
  - `specs/issue-1013-adw-surface-13-sdlc_planner-surface-chore-plan.md`, a few lines of markdown that `getPlanFilePath` finds.
- **`surface-install-phase.json`** (row 18): `byCommand["/install"]` answers `The project context was read.`
- **`surface-pr-review-plan-phase.json`** (row 24): `byCommand["/pr_review"]` answers `1. Rename the helper as the review comment on pull request 2024 asks.`
- **`surface-pr-review-commit-push.json`** (row 26): `byCommand["/commit"]` answers `pr-review-orchestrator: feat: address the review comment` and has `commits: [{ "subject": "pr-review-orchestrator: feat: address the review comment" }]`. That is an allow-empty commit; the worktree is clean, so `onCommitCommand` would fail the commit agent (F3).
- **`surface-document-phase.json`** (row 27): top-level `"onCommitCommand": "stage-all-and-commit"`, so the commit agent commits the document. `byCommand["/document"]` writes:
  - `app_docs/feature-surface-27-surface-document.md`, three short lines, well under the docs-bloat threshold;
  - the payload `Documentation written.\napp_docs/feature-surface-27-surface-document.md\n`. Its last line is the path `extractDocPathFromOutput` reads.
- **`surface-build-phase.json`** (rows 04, 14, 17 and 25): change only the `/implement` payload text, from `The plan for issue 1004 was implemented.` to `The plan was implemented.`, since four rows now share it.
- Run `! grep -l '"\.adw/state\.json"' test/fixtures/jsonl/manifests/*.json`. Nothing may list.

### 11. Rewrite the ten rows
Keep each file name and its `@regression @surface` tags, with no `@adw-` tag. Replace each file's Feature and Scenario with exactly this. Every phrase is registered.

- `row-12-adwMerge-prPhase-happy.feature` (retitled to adwPatch, F1):
  ```gherkin
  @regression @surface
  Feature: adwPatch — prPhase — happy path

    Scenario: patch orchestrator's PR phase runs in-process, opens the pull request for the issue and records pr_completed
      Given an issue 1012 exists in the mock issue tracker
      And the worktree for adwId "surface-12" is initialised at branch "surface-12"
      And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/surface-pr-phase.json"
      When the "pr" phase of the "patch" orchestrator runs for adwId "surface-12"
      Then the mock GitHub API recorded a PR creation for issue 1012
      And the state file for adwId "surface-12" records workflowStage "pr_completed"
  ```
- `row-13-adwChore-workflowInit-planPhase-happy.feature`. The harness builds the config, so `workflowInit` is no longer in the title:
  ```gherkin
  @regression @surface
  Feature: adwChore — planPhase — happy path

    Scenario: chore orchestrator's plan phase runs in-process under /chore, succeeds and posts its plan stage comments
      Given an issue 1013 exists in the mock issue tracker
      And the worktree for adwId "surface-13" is initialised at branch "surface-13"
      And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/surface-chore-plan-phase.json"
      When the "plan" phase of the "chore" orchestrator runs for adwId "surface-13"
      Then the "plan" phase run succeeded
      And the mock GitHub API recorded a comment on issue 1013
      And the mock GitHub API recorded a comment containing the text "Issue classified as: **chore**"
      And the mock GitHub API recorded a comment containing the text "## :pencil: Building Implementation Plan"
      And the mock GitHub API recorded a comment containing the text "## :white_check_mark: Implementation Plan Created"
      And the mock GitHub API recorded a comment containing the text "## :floppy_disk: Committing Plan"
  ```
- `row-14-adwChore-buildPhase-happy.feature`:
  ```gherkin
  @regression @surface
  Feature: adwChore — buildPhase — happy path

    Scenario: chore orchestrator's build phase runs in-process over a committed plan, succeeds and posts its build stage comments
      Given an issue 1014 exists in the mock issue tracker
      And the worktree for adwId "surface-14" is initialised at branch "surface-14"
      And the worktree for adwId "surface-14" has the plan for issue 1014 committed on its branch
      And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/surface-build-phase.json"
      When the "build" phase of the "chore" orchestrator runs for adwId "surface-14"
      Then the "build" phase run succeeded
      And the mock GitHub API recorded a comment on issue 1014
      And the mock GitHub API recorded a comment containing the text "## :hammer_and_wrench: Running Build"
      And the mock GitHub API recorded a comment containing the text "## :white_check_mark: Build Completed"
  ```
- `row-17-adwPatch-buildPhase-happy.feature`:
  ```gherkin
  @regression @surface
  Feature: adwPatch — buildPhase — happy path

    Scenario: patch orchestrator's build phase runs in-process over a committed plan and records build_completed
      Given an issue 1017 exists in the mock issue tracker
      And the worktree for adwId "surface-17" is initialised at branch "surface-17"
      And the worktree for adwId "surface-17" has the plan for issue 1017 committed on its branch
      And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/surface-build-phase.json"
      When the "build" phase of the "patch" orchestrator runs for adwId "surface-17"
      Then the state file for adwId "surface-17" records workflowStage "build_completed"
  ```
- `row-18-adwInit-installPhase-happy.feature` (retitled to adwBuild; no adwInit exists):
  ```gherkin
  @regression @surface
  Feature: adwBuild — installPhase — happy path

    Scenario: build orchestrator's install phase runs in-process and records install_completed
      Given an issue 1018 exists in the mock issue tracker
      And the worktree for adwId "surface-18" is initialised at branch "surface-18"
      And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/surface-install-phase.json"
      When the "install" phase of the "build" orchestrator runs for adwId "surface-18"
      Then the state file for adwId "surface-18" records workflowStage "install_completed"
  ```
- `row-24-adwPrReview-prReviewPlanPhase-happy.feature`:
  ```gherkin
  @regression @surface
  Feature: adwPrReview — prReviewPlanPhase — happy path

    Scenario: pr-review orchestrator's plan phase runs in-process, records pr_review_plan_completed and posts the revision plan on the pull request
      Given an issue 1024 exists in the mock issue tracker
      And the worktree for adwId "surface-24" is initialised at branch "surface-24"
      And a pull request 2024 for issue 1024 is open on the branch "surface-24" with a review comment to address
      And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/surface-pr-review-plan-phase.json"
      When the "pr_review_plan" phase of the "pr-review" orchestrator runs for adwId "surface-24"
      Then the state file for adwId "surface-24" records workflowStage "pr_review_plan_completed"
      And the mock GitHub API recorded a comment on pull request 2024 containing the text "## :white_check_mark: Revision Plan Created"
  ```
- `row-25-adwPrReview-prReviewBuildPhase-happy.feature`:
  ```gherkin
  @regression @surface
  Feature: adwPrReview — prReviewBuildPhase — happy path

    Scenario: pr-review orchestrator's build phase runs in-process over the revision plan and records pr_review_build_completed
      Given an issue 1025 exists in the mock issue tracker
      And the worktree for adwId "surface-25" is initialised at branch "surface-25"
      And a pull request 2025 for issue 1025 is open on the branch "surface-25" with a review comment to address
      And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/surface-build-phase.json"
      When the "pr_review_build" phase of the "pr-review" orchestrator runs for adwId "surface-25"
      Then the state file for adwId "surface-25" records workflowStage "pr_review_build_completed"
  ```
- `row-26-adwPrReview-commitPushPhase-happy.feature`. G2 is dropped: G11 sets up the worktree and branch, and each setup starts an empty log:
  ```gherkin
  @regression @surface
  Feature: adwPrReview — commitPushPhase — happy path

    Scenario: pr-review orchestrator's commit-push phase runs in-process, pushes the pull request's branch and records pr_review_commit_push_completed
      Given an issue 1026 exists in the mock issue tracker
      And the worktree for adwId "surface-26" is initialised at branch "surface-26"
      And a pull request 2026 for issue 1026 is open on the branch "surface-26" with a review comment to address
      And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/surface-pr-review-commit-push.json"
      When the "pr_review_commit_push" phase of the "pr-review" orchestrator runs for adwId "surface-26"
      Then the git-mock recorded a push to branch "surface-26"
      And the state file for adwId "surface-26" records workflowStage "pr_review_commit_push_completed"
  ```
- `row-27-adwDocument-documentPhase-happy.feature` (retitled to adwPlanBuildDocument, F1; the comment text follows F4):
  ```gherkin
  @regression @surface
  Feature: adwPlanBuildDocument — documentPhase — happy path

    Scenario: plan-build-document orchestrator's document phase runs in-process, succeeds and posts its document stage comments
      Given an issue 1027 exists in the mock issue tracker
      And the worktree for adwId "surface-27" is initialised at branch "surface-27"
      And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/surface-document-phase.json"
      When the "document" phase of the "plan-build-document" orchestrator runs for adwId "surface-27"
      Then the "document" phase run succeeded
      And the mock GitHub API recorded a comment on issue 1027
      And the mock GitHub API recorded a comment containing the text "**Stage:** document_running"
      And the mock GitHub API recorded a comment containing the text "**Stage:** document_completed"
  ```
- `row-35-adwMerge-depauditSetup-happy.feature` (titled for the setup; no orchestrator runs it, F8):
  ```gherkin
  @regression @surface
  Feature: depauditSetup — happy path, run by no orchestrator

    Scenario: the dependency-audit setup runs depaudit setup in the worktree and sets both secrets on the repository
      Given an issue 1035 exists in the mock issue tracker
      And the worktree for adwId "surface-35" is initialised at branch "surface-35"
      When the dependency-audit setup runs for adwId "surface-35" on a host whose environment sets every secret it propagates
      Then the dependency-audit setup ran the command "depaudit setup" in the worktree for adwId "surface-35"
      And the mock GitHub API recorded the Actions secret "SOCKET_API_TOKEN" set on the repository "acme/widgets"
      And the mock GitHub API recorded the Actions secret "SLACK_WEBHOOK_URL" set on the repository "acme/widgets"
  ```
  G4 stays: `buildConfigFor` requires exactly one seeded issue.

### 12. Amend feature-960 §6
- In `features/per-issue/feature-960.feature`, in the scenario at lines 357-367:
  - add `@adw-965` to its tag line;
  - retitle it to `The regression suite's smoke and surface scenarios are all still reported pending, except the surface rows that run in-process, which pass`;
  - add these ten rows to its table, in row order:
    - `row-12-adwMerge-prPhase-happy.feature`
    - `row-13-adwChore-workflowInit-planPhase-happy.feature`
    - `row-14-adwChore-buildPhase-happy.feature`
    - `row-17-adwPatch-buildPhase-happy.feature`
    - `row-18-adwInit-installPhase-happy.feature`
    - `row-24-adwPrReview-prReviewPlanPhase-happy.feature`
    - `row-25-adwPrReview-prReviewBuildPhase-happy.feature`
    - `row-26-adwPrReview-commitPushPhase-happy.feature`
    - `row-27-adwDocument-documentPhase-happy.feature`
    - `row-35-adwMerge-depauditSetup-happy.feature`
  - Change nothing else. The step definition reads the table, so it needs no change.

### 13. Vocabulary registry
In `features/regression/vocabulary.md`:

- **T11's semantics:** "Reads the git-mock's invocation log, `MockContext.gitLogPath`. `setupMockInfrastructure` creates it empty per setup and points `MOCK_GIT_LOG` at it. `test/mocks/git-remote-mock.ts` appends one JSONL `{ subcommand, args, cwd }` per network subcommand it intercepts (`push`, `fetch`, `clone`, `pull`, `ls-remote`). The step asserts a `push` whose args include the branch. Fails listing the recorded invocations." The assertion target becomes `git-mock invocation log`.
- **In `## Given/When/Then — Surface phases and lifecycles`:**
  - Extend the intro:
    - the mock forge also answers `getDefaultBranch` with `main`;
    - it records `createPullRequest`, `commentOnPullRequest` (on GitHub's issue-comments endpoint for the pull request) and `setSecret` as the HTTP calls would;
    - the dependency-audit setup, which no orchestrator runs, is driven through its `deps` seam (W-S3);
    - the artefacts also include the git-mock's invocation log and the calls W-S3 recorded.
  - Add rows G-S2, W-S3, T-S7, T-S8 and T-S9, with the semantics of task 9. The table keeps its five columns.
  - Add T8 and T11 to the list of reused phrases.

### 14. Validation
- Run every command in `Validation Commands`. Fix and re-run until all pass.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

Run each command from the repository root. Never run two Cucumber processes from this checkout at once.

- `bun run lint`: zero errors or warnings.
- `bunx tsc --noEmit`: the root type check passes. It covers `features/**` and `test/**`.
- `bunx tsc --noEmit -p adws/tsconfig.json`: the additional type check passes.
- `bun run build`: passes.
- `bun run test:unit`: the Vitest suite passes (AC2). That includes the new `gitRemoteMock.test.ts`, the extended `test-harness.test.ts` and `mockServerDispatch.test.ts`, and `manifestRefusalGuard.test.ts` sweeping the new manifests.
- `bun run jsonl:check`: the envelope templates still conform.
- `bun run lint:git-guard`: no violation. `features/` and `test/` are exempt directories.
- `! grep -l '"\.adw/state\.json"' test/fixtures/jsonl/manifests/*.json`: no manifest writes the state file T1 reads.
- Reproduce, then confirm the fix: `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@surface" --format summary`. Before the fix this reports `34 scenarios (28 pending, 6 passed)`; after it, `34 scenarios (18 pending, 16 passed)`. Cucumber still exits 1 on the pending rows, as Divergence item 3 records.
- The ten rows, twice in a row in the same checkout. Each run reports `10 scenarios (10 passed)` and exits 0:
  ```sh
  for i in 1 2; do NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@surface" --name "^((patch|chore|pr-review|plan-build-document) orchestrator's|build orchestrator's install phase|the dependency-audit setup)" --format summary || exit 1; done
  ```
- Each row passes in under 5 seconds (AC1), measured by the child-run helper the per-issue features use:
  ```sh
  d=$(mktemp -d) && bun -e "import { runCucumber, verdictHolds } from './features/support/cucumberChildRun.ts'; const want = ['row-12-','row-13-','row-14-','row-17-','row-18-','row-24-','row-25-','row-26-','row-27-','row-35-']; const rows = runCucumber({ directory: '$d', tags: '@surface' }).filter((s) => want.some((w) => s.uri.includes('surfaces/' + w))); rows.forEach((s) => console.log(s.uri, verdictHolds(s, 'passes') ? 'passed' : 'NOT PASSED', Math.round(s.durationMs) + ' ms')); process.exit(rows.length === 10 && rows.every((s) => verdictHolds(s, 'passes') && s.durationMs < 5000) ? 0 : 1);"
  ```
  If `bun -e` cannot resolve the import, save the same code to a `.ts` file under `$TMPDIR` and run it with `bunx tsx`.
- `test -z "$(ls -d agents/surface-1[2378] agents/surface-2[4-7] agents/surface-35 2>/dev/null)"`: the rows left no state in the checkout.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-965"` exits 0. It runs the scenarios written for this issue and the amended feature-960 §6: these ten rows and #963's six pass, and every other smoke and surface scenario stays pending.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-963"` exits 0. It runs feature-963, including the whole `@surface` tier twice, which now holds sixteen in-process rows, and the `@adw-963` rows of features 909, 930, 959 and 960.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@pause-queue-reset-time or @pause-queue-ownership"`: the timing-sensitive pause-queue features pass and exit 0.
- Whole suite against the baseline:
  ```sh
  NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression" > /tmp/adw-965-regression.after 2>&1; tail -n 3 /tmp/adw-965-regression.after; ! tail -n 3 /tmp/adw-965-regression.after | grep -q failed
  ```
  No scenario fails. Compared with `/tmp/adw-965-regression.before`, the only change is that the ten rows are now passed; every other scenario keeps its status.
- `git status --porcelain`: shows only the files this plan names, and nothing under `agents/` or `logs/`.

## Notes
- Strictly follow `.adw/coding_guidelines.md`:
  - guard clauses, and at most two levels of nesting;
  - no `any`; narrow `unknown` instead of casting it;
  - files under 300 lines. That is why the mock-state readers move to `seededRecords.ts` and the new steps go into `surfaceSteps.ts`. `thenSteps.ts` is already 414 lines; it only has T11's body replaced;
  - comments only for invariants and non-obvious reasons, such as why `getDefaultBranch` answers `main`, why the secret is sent unsealed, and why no orchestrator id fits the depaudit run. No issue numbers in comments.
- No new library is needed.
- **Row 35 deviates on purpose from "drive each through W-S1 and the real `runPhase`".** The issue's own row says the function has no orchestrator caller and is driven through its `deps` seam. W-S1 needs an orchestrator that runs the phase, and none exists; naming `merge` or `init` would assert a production path that does not exist. `runPhase` needs a `PhaseResult`, which `executeDepauditSetup` does not return, and in production nothing wraps it in `runPhase` (F8). W-S3 calls it as the deleted adwInit did.
- **Row 27 is retitled even though the issue's table does not say so.** The general rule "retitle to the orchestrator that runs the phase in production" applies, and adwDocument never calls `executeDocumentPhase`. adwPlanBuildDocument is chosen because it runs the document phase on every run.
- **Row 18's T1 holds whatever the install agent does** (F2). The row checks that the install phase runs under `'install'` and records its stage, which is what the code guarantees.
- Rows 24–26 use G-S2, the only new Given. The PR-review phases need a pull request whose number the Then steps name. No registered Given seeds an open one; G10 seeds a merged PR.
- `postPRStageComment` and `propagateSecret` swallow a forge failure (Bug Description item 4). An unimplemented mock method would therefore not fail rows 24 and 35 at the phase; it would surface only at T-S7 and T-S9. Those steps are the guard.
- Under the `@regression` hooks every git call from the phases goes through the git-mock wrapper, which costs one `bun` start per call. Each row stays well inside 5 seconds, as #963's rows do.
- **Child-run time.** feature-960 §6 runs `@smoke or @surface` and feature-963 runs `@surface` twice, each bounded by `CHILD_TIMEOUT_MS` (120 s) in `features/support/cucumberChildRun.ts`. Measure the runs once sixteen rows execute for real. If one comes near the bound, report the measured duration rather than silently raising it.
- ADR-0037 Divergence item 3 stays open; this is the second surface slice. The document phase refreshes `app_docs/feature-9gjajh-bdd-regression-suite.md` and `.adw/conditional_docs.md`, which still describe a mock forge with only `commentOnIssue` and `moveToStatus` and the surface rows as 02–05, 31 and 32.
- `features/regression/surfaces/logs/` and `logs/` hold hook output that `.gitignore` covers (`**/logs/`). They are unrelated to this change.
