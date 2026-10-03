# Bug: Surface rows 06–09, 15, 20–23, 33 and 34 cannot run: they invoke a parked subprocess step, name orchestrators that never run their phases, and assert stages and exit codes the phases never produce

## Metadata
issueNumber: `964`
adwId: `n5cfq2-bug-move-the-test-re`
issueJson: `{"number":964,"title":"bug: move the test, review, alignment and diff-evaluation surface rows onto the phase harness","body":"Source: the `## Divergence` section of `specs/adr/0037-tiered-regression-suite-with-fixed-vocabulary.md`, item 3. Read it before planning.\n\nSplit from #935, which was too large for one run and is closed. The facts below come from #935's planning research. Check them against the code before relying on them.\n\nMoves the test, review, alignment and diff-evaluation surface rows onto the in-process phase harness built in #963. Divergence item 3 stays until the last slice.\n\n## What to build\n\nRewrite these rows in place, keeping each file and its `@regression @surface` tags. Drive each through W-S1, and the real `runPhase` with the phase name its orchestrator passes. The rules:\n\n- **Retitle when the orchestrator is wrong.** If the named orchestrator does not run that phase, or does not exist (`adwReview`), retitle the Feature or Scenario to the orchestrator that does run it in production (check `adws/*.tsx`), and keep the row number and file.\n- **Assert real artefacts only:** top-level state, recorded mock requests, captured phase outcome. Never a vacuous check.\n- **Follow the code.** When it does something other than what the old row claimed, the assertion follows the code; never weaken it to make it pass.\n- **Seed with registered Givens.** Add a new Given only when no registered phrase can express the precondition, and register it.\n\n| Row | Drive | Assert |\n|---|---|---|\n| 06 adwBuild unitTestPhase happy | `executeUnitTestPhase` as an orchestrator that runs it (adwBuild does not; use adwTest `'test'`) | T1 `test_completed`, or the comments it posts |\n| 07 adwReview reviewPhase happy | `executeReviewPhase` with a passing review JSON | review-passed comment |\n| 08 adwReview review rejected | `executeReviewPhase` with blockers | review-failed comment, plus the outcome |\n| 09 adwReview diffEvaluation happy | `executeDiffEvaluationPhase` with a `/diff_evaluator` verdict; retitle to adwChore | what the phase records |\n| 15 adwChore review | `executeReviewPhase` under `/chore` | comments |\n| 20 adwTest unitTestPhase | `executeUnitTestPhase` (`'test'`) | T1 `test_completed` |\n| 21 adwTest scenarioTestPhase | `executeScenarioTestPhase`, using the fixture's echo scenario commands | the outcome and comments it produces |\n| 22 adwTest scenarioProof | `runScenarioProof` via the scenario test phase | the proof outcome or comment |\n| 23 adwTest scenarioFix error | `executeScenarioFixPhase` with the stub's `error` response | \"phase run failed\" |\n| 33 adwReview planValidation | `executePlanValidationPhase` (no production caller; drive it directly and say so in the row's description) | its outcome and comments |\n| 34 adwReview alignment | `executeAlignmentPhase` | its outcome and comments |\n\nExtend `mockForgeProviders` only with the port methods these rows call. Register any new phrase in `features/regression/vocabulary.md`.\n\n## Acceptance criteria\n\n- [ ] All eleven rows run in-process and pass, each in under 5 seconds.\n- [ ] No row asserts on a file that its own manifest wrote.\n- [ ] Scenarios passing on `dev` still pass.\n\n## Blocked by\n\n#963\n\n- #982\n","state":"OPEN","author":"paysdoc","labels":["adw:bug"],"createdAt":"2026-10-02T07:59:09Z","comments":[{"author":"paysdoc","createdAt":"2026-10-03T15:08:43Z","body":"## continue"}],"actionableComment":null}`

## Bug Description
ADR-0037 decides that surface scenarios import phase functions and run in seconds. Item 3 of its `## Divergence` section records that they do not run at all. #963 built the in-process phase harness (`features/regression/support/phaseRun.ts`, `phaseConfig.ts`, `fixtureWorktree.ts`, `mockForgeProviders.ts`, steps in `surfaceSteps.ts`) and moved rows 02–05, 31 and 32 onto it. The eleven rows of this slice still reach W1 `the {string} orchestrator is invoked with adwId {string} and issue {int}` (`features/regression/step_definitions/whenSteps.ts`), whose body begins with `return 'pending';`. All eleven are reported pending, so nothing in the suite exercises the unit-test, review, diff-evaluation, scenario-test, scenario-proof, scenario-fix, plan-validation or alignment phases.

Taking the `pending` marker off would not help. Each fact below was checked against the code; the ones marked *new* were not in #935's research.

1. **The rows name orchestrators that never run their phase.**
   - `adwBuild` runs only install and build (`adws/adwBuild.tsx:53-54`). Row 06.
   - `adws/adwReview.tsx` does not exist; `OrchestratorId.Review` is unused. Rows 07, 08, 09, 33 and 34.
   - *New:* `adwTest` runs only `runPhase(config, tracker, executeUnitTestPhase, 'test')` (`adws/adwTest.tsx:43`). It never runs the scenario test phase, the scenario proof or the scenario fix phase, so rows 21, 22 and 23 name the wrong orchestrator too.
   - `executePlanValidationPhase` has no caller in `adws/*.tsx` or `adws/phases/`; the alignment phase replaced it (commit 2a146b94). Row 33.
   - Who does run them, and under what phase name: `adwSdlc` runs `executeAlignmentPhase`, `runScenarioTestFixLoop` (which runs `executeScenarioTestPhase`, and `executeScenarioFixPhase` when a blocker failed) and `executeReviewPhase`, all with no phase name (`adws/adwSdlc.tsx`, `adws/phases/scenarioTestFixLoop.ts:53,153`). `adwChore` runs `executeDiffEvaluationPhase` and, after a `regression_possible` verdict, `executeReviewPhase`, with no phase name and issue type `/chore` (`adws/adwChore.tsx:107-108,185`). `adwTest` alone names its phase: `'test'`.
2. **The rows assert what the phases never produce.**
   - `awaiting_merge` is written only at the very end of `adwSdlc` and `adwChore`, after the PR (`adws/adwChore.tsx:211`). Before #963 the manifests manufactured it.
   - T5 `the orchestrator subprocess exited {int}` reads a subprocess exit code; an in-process row has none.
   - T9 `the state file for adwId {string} records no error` would pass vacuously: none of these phases writes an error into the top-level state.
3. **The rows' stub inputs are dead in-process.** G9 sets `MOCK_FIXTURE_PATH`, which `getSafeSubprocessEnv()` drops, and `adw-sdlc-happy.json` answers every agent with plan prose. The review, diff-evaluator, test, validation and alignment agents all extract JSON from their answer, so each would loop through `/correct_output` and fail.
4. **Preconditions are missing, and no registered Given expresses them.**
   - *New:* the cli-tool fixture has no step definitions, so `runScenarioProof` skips the proof with `tagResults: []` (`adws/phases/scenarioProof.ts:185-202`). The fixture's echo scenario command never runs.
   - The alignment and plan-validation phases need a plan and a `.feature` file tagged `@adw-<N>` (`findScenarioFiles`). Without the plan, alignment returns early and plan validation throws `Cannot read plan file`. Without the feature, both return early and post nothing (`alignmentPhase.ts:63-98`, `planValidationPhase.ts:52-65`).
   - A branch with no diff against `main` is ruled `safe` without asking the diff evaluator (`diffEvaluationPhase.ts:67-87`).
   - G13 `a per-issue feature file at {string} is seeded into the worktree for adwId {string} from fixture {string}` is registered, but it has no step definition and its fixture directory `test/fixtures/scenarios/promotion/` does not exist.
5. **The harness lacks what these phases need.**
   - Its orchestrator table knows only `plan` and `build` (`phaseConfig.ts:47-50`).
   - `mockForgeProviders.applyLabel` throws `not supported`. The unit-test phase's "no JUnit report" path calls `applyLabel` and then posts the `unverified` comment inside one `try` (`unitTestPhase.ts:118-127`), so the comment is swallowed with the error.
   - The review and scenario fix phases take a second argument: a scenario-proof path and a scenario proof.
   - No step drives a phase that no orchestrator runs.
   - No step reads the scenario proof a phase produced, and no step says why a phase run failed.
6. *New:* `executeUnitTestPhase` sets `process.env.ADW_UNIT_TEST_REPORT_PATH` to a path in its logs directory (`unitTestPhase.ts:56`). In-process, that outlives the phase and its temp directory. `vitest.config.ts:3` reads it, and `getSafeSubprocessEnv()` passes it to every child.

Expected behaviour: the eleven rows drive the real phase functions in-process through W-S1, using the phase name the production orchestrator passes. Row 33 is driven directly, since no orchestrator runs its phase. They run against the mock forge, G11's fixture worktree and a stub that answers per command. They assert only the outcome the run records, the top-level state, the requests the mock API recorded and the scenario proof the phase produced. Each keeps its file and `@regression @surface` tags, is retitled to the orchestrator that runs it, and finishes in under 5 seconds.

## Problem Statement
Make the eleven rows run and pass in-process, with no vacuous assertion and no manufactured evidence. This needs:

- **Harness:** orchestrator entries for `test`, `chore` and `sdlc`, each phase called as its orchestrator calls it. Also a way to drive a phase no orchestrator runs, `applyLabel` on the mock forge, the scenario proof recorded on the World, and the unit-report environment variable restored.
- **Steps:**
  - G-S2: seed the issue's scenarios and step definitions;
  - W-S3: drive a phase directly;
  - T-S7: read the scenario proof;
  - T-S8: name the cause of a phase failure.
- **Fixtures:** seven per-command manifests that answer each agent with the JSON it expects.
- **Rows:** the eleven rows rewritten in place and retitled where the orchestrator was wrong.
- **Vocabulary:** the new phrases registered.
- **Per-issue:** feature-960 §6, which asserts that every surface row except #963's six is pending, updated so it keeps passing (AC3).

## Solution Statement
- **`mockForgeProviders`** gains `applyLabel`. It is recorded through `dispatchMockRequest` as `POST /repos/acme/widgets/issues/<n>/labels` with body `{"labels":[<name>]}`, the shape T12 reads. Nothing else is added; the review phase only calls `fetchLabels` and the code host once a PR exists, and no row has one.
- **The phase table (`phaseConfig.ts`)** gains:
  - `test`: `unitTest` under the phase name `'test'`, as `adwTest.tsx:43` passes it;
  - `chore`: issue type `/chore`, with `review` and `diffEvaluation`;
  - `sdlc`: `alignment`, `scenarioTest`, `scenarioFix` and `review`;
  - a direct-phase table holding `planValidation`, driven under adwSdlc's identity.

  Only `test` has a production phase name. Each function is called as its orchestrator calls it:
  - the review phase with the empty scenario-proof path that production passes when no proof preceded it;
  - the scenario fix phase with the proof the scenario test phase leaves when the fixture's `@review-proof` blocker scenarios fail. That is the only kind of proof `runScenarioTestFixLoop` hands it.
- **`phaseRun.ts`**:
  - W-S1 and the new direct runner share one body;
  - after the run it records the scenario proof the phase left on the workflow context (`config.ctx.scenarioProof`, which the review phase reads next) as `World.scenarioProofResult`;
  - before the run it registers a restore of `ADW_UNIT_TEST_REPORT_PATH` on the cleanup list.
- **Steps (`surfaceSteps.ts`):**
  - **G-S2** commits a `@adw-<N>` feature file and its step definitions into G11's worktree, the way G-S1 commits the plan. The alignment and plan-validation phases then find the issue's scenarios, and the scenario proof finds step definitions and runs the fixture's echo command.
  - **W-S3** drives a phase no orchestrator runs.
  - **T-S7** reads the recorded proof: the tag ran, was not skipped, passed with exit code 0, and its captured output holds the expected text.
  - **T-S8** asserts the text of the error a phase run failed with, so a failure from a harness fault cannot pass for the expected one.
- **Manifests:** seven new `surface-*.json` manifests answer exactly one slash command each, through `byCommand`, with a short JSON answer (the stub truncates `result` to 500 characters, `claude-cli-stub.ts:219`). The scenario-fix manifest answers every agent with `{ "kind": "error" }`. They write only `.adw-stub-payload.json`.
- **Rows:** rewritten in place and retitled: 06 to adwTest, 07, 08, 21, 22, 23 and 34 to adwSdlc, 09 to adwChore, 33 to "driven directly". The assertions follow the code:
  - the unit-test rows record `test_completed`. With no JUnit report from the fixture, they also label the issue `adw:unverified` and post the `unverified` comment;
  - a rejected review resolves the phase run and posts the review-failed comment;
  - the scenario test phase posts no comment;
  - in the fix phase, the resolver's error is only logged; the commit agent's error fails the run.
- **Per-issue:** feature-960 §6 lists all seventeen in-process rows, and is flagged `@adw-964` so this issue's test phase runs it.

## Steps to Reproduce
Run from the repository root. Never run two Cucumber processes from one checkout at once.

1. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@surface" --format summary`. On `dev` the summary reads `34 scenarios`, with 6 passed and 28 pending. Cucumber exits 1. Each of rows 06, 07, 08, 09, 15, 20, 21, 22, 23, 33 and 34 stops pending at W1.
2. `grep -n "runPhase(" adws/adwBuild.tsx adws/adwTest.tsx`: adwBuild runs install and build; adwTest runs only `executeUnitTestPhase` under `'test'`. `ls adws/adwReview.tsx` fails. `grep -rn "executePlanValidationPhase" adws/*.tsx adws/phases/*.ts` finds only its definition and re-export.
3. `ls test/fixtures/cli-tool/features` fails: the fixture has no step definitions, so the scenario proof would skip without running the fixture's `echo "1 scenario (1 passed)"`.
4. `grep -n "applyLabel" features/regression/support/mockForgeProviders.ts` shows `notSupported('applyLabel')`. With it, the unit-test phase's `unverified` comment (`unitTestPhase.ts:118-127`) is never posted.
5. `grep -rn "seeded into the worktree" features --include=*.ts` finds no step definition for G13.

## Root Cause Analysis
The surface tier was parked in 6ffd1416 behind a subprocess When step that could not be driven. #963 built the in-process alternative ADR-0037 decided on, but only for the plan, build and lock rows. The other rows were written against an imagined orchestrator layout:

- an `adwReview` that never existed;
- an `adwBuild` and an `adwTest` that run more phases than they do;
- a plan-validation phase that lost its caller to the alignment phase.

They assert the end-of-pipeline `awaiting_merge` stage and a subprocess exit code, because no real run ever produced artefacts to assert on. Nothing ever executed them, so none of this surfaced.

The harness #963 built is generic, but it carries only what its six rows needed:

- two orchestrators;
- phase functions that take nothing but the config;
- a forge that can only comment;
- no Given for scenarios or step definitions, and no Then for a scenario proof.

## Relevant Files
Use these files to fix the bug:

- `README.md`: project overview (read first).
- `.adw/coding_guidelines.md`: guard clauses, at most two levels of nesting, no `any`, files under 300 lines, and comments only for invariants and non-obvious reasons, with no issue numbers.
- `app_docs/feature-9gjajh-bdd-regression-suite.md`: the conditional doc for `features/regression/**` and `test/mocks/**`. It records the in-process harness, the `os.tmpdir()` scratch rule and the "never two Cucumber processes in one checkout" rule.
- `app_docs/feature-9gjajh-test-and-scenario-phases.md`: the unit-test, scenario-test, scenario-fix and test-fix-loop phases.
- `app_docs/feature-9gjajh-review-and-diff-phases.md`: the review and diff-evaluation phases.
- `app_docs/feature-9gjajh-build-and-plan-phases.md`: the plan-validation and alignment phases.
- `app_docs/feature-9gjajh-proof-and-scenario-proof.md`: `runScenarioProof`.
- `app_docs/feature-9gjajh-feature-orchestrators.md`, `app_docs/feature-9gjajh-sdlc-orchestrators.md`: which orchestrator runs which phase.
- `app_docs/feature-9gjajh-bdd-per-issue.md`: `features/per-issue/**`, for the feature-960 edit.
- `specs/adr/0037-tiered-regression-suite-with-fixed-vocabulary.md`: Divergence item 3. Context only; it is not edited, since the item stays open until the last slice.
- `specs/issue-963-adw-g53ol8-bug-build-the-in-pro-sdlc_planner-in-process-phase-harness-surface-rows.md`: the harness design this slice extends.
- `features/regression/support/phaseConfig.ts`: the orchestrator/phase table and `buildPhaseConfig`. It gains the new orchestrators, the phase wrappers and the direct-phase table.
- `features/regression/support/phaseRun.ts`: `runSurfacePhase`, `withExitTrap` and `deliverStubManifest`. It gains the shared runner, the direct runner, scenario-proof recording and the env restore.
- `features/regression/support/mockForgeProviders.ts`: gains `applyLabel`.
- `features/regression/support/fixtureWorktree.ts`: `commitFileOnBranch` and `realGit`, which G-S2 reuses. Unchanged.
- `features/regression/support/claudeCliStub.ts`, `cleanup.ts`, `hooks.ts`: stub delivery and the cleanup list the `@regression` After hook runs. Unchanged.
- `features/regression/step_definitions/surfaceSteps.ts`: W-S1, W-S2, G-S1 and T-S1…T-S6. It gains G-S2, W-S3, T-S7 and T-S8.
- `features/regression/step_definitions/world.ts`: `PhaseOutcome` and `scenarioProofResult`. Unchanged.
- `features/regression/step_definitions/givenSteps.ts`, `thenSteps.ts`: G4, G11, T1, T2, T3, T12 and T14, reused unchanged.
- `features/regression/step_definitions/pythonFixtureE2ESteps.ts`: T-PY3 `the scenario proof records no blocker failures`, reused unchanged. It reads `World.scenarioProofResult`.
- `features/regression/step_definitions/whenSteps.ts`: W1 stays pending, untouched; the other parked rows still use it.
- `features/regression/surfaces/row-06-adwBuild-unitTestPhase-happy.feature`, `row-07-adwReview-reviewPhase-happy.feature`, `row-08-adwReview-reviewPhase-error-review-rejected.feature`, `row-09-adwReview-diffEvaluationPhase-happy.feature`, `row-15-adwChore-reviewPhase-happy.feature`, `row-20-adwTest-unitTestPhase-happy.feature`, `row-21-adwTest-scenarioTestPhase-happy.feature`, `row-22-adwTest-scenarioProof-happy.feature`, `row-23-adwTest-scenarioFixPhase-error.feature`, `row-33-adwReview-planValidationPhase-happy.feature`, `row-34-adwReview-alignmentPhase-happy.feature`: the eleven rows, rewritten in place.
- `features/regression/surfaces/row-02-…`, `row-04-…`: the shape of an in-process row.
- `features/regression/vocabulary.md`: the registry. It gains G-S2, W-S3, T-S7 and T-S8, and updates W-S1 and the "Surface phases and lifecycles" intro.
- `features/per-issue/feature-960.feature`: §6 lists the in-process rows and must keep passing.
- `features/per-issue/step_definitions/feature-960.steps.ts`: the table-driven §6 step. Unchanged.
- `features/per-issue/feature-963.feature`, `features/per-issue/step_definitions/feature-963*.ts`, `features/support/cucumberChildRun.ts`: the twice-in-a-row `@surface` child runs and the committed-manifest refusal sweep. They must keep passing with the eleven rows now running; `CHILD_TIMEOUT_MS` is 120 s.
- `test/fixtures/jsonl/manifests/surface-plan-phase.json`, `surface-build-phase.json`: the manifest shape the new ones follow.
- `test/mocks/manifestInterpreter.ts`, `manifestSchema.ts`, `manifestRefusalGuard.ts`, `claude-cli-stub.ts`: `byCommand` selection by the prompt's opening slash command, the `error` response, the refusal guard, and the 500-character `result` truncation.
- `test/mocks/__tests__/manifestRefusalGuard.test.ts`: sweeps every committed manifest; the new ones must pass it.
- `test/mocks/github-api-server.ts`: `dispatchMockRequest` and the existing `POST /repos/:owner/:repo/issues/:issueNumber/labels` route.
- `test/fixtures/cli-tool/.adw/*`: the fixture's `## Run Scenarios by Tag` echo command, `## Start Dev Server: N/A`, `## Run Tests: N/A`, and `review_proof.md`'s single `@review-proof` blocker tag.
- `adws/adwTest.tsx`, `adws/adwChore.tsx`, `adws/adwSdlc.tsx`, `adws/adwBuild.tsx`, `adws/phases/scenarioTestFixLoop.ts`: the production callers and phase names the rows mirror.
- `adws/phases/unitTestPhase.ts`, `reviewPhase.ts`, `diffEvaluationPhase.ts`, `scenarioTestPhase.ts`, `scenarioProof.ts`, `scenarioFixPhase.ts`, `planValidationPhase.ts`, `alignmentPhase.ts`: the driven phases.
- `adws/agents/testAgent.ts`, `testRetry.ts`, `reviewAgent.ts`, `diffEvaluatorAgent.ts`, `validationAgent.ts`, `alignmentAgent.ts`, `gitAgent.ts`, `commandAgent.ts`, `claudeAgent.ts`: each agent's slash command and the answer it parses. Also how a failed commit agent throws, and how the prompt opens with the command.
- `adws/forge/workflowCommentsIssue.ts`: the comment headings the rows assert.
- `adws/core/testVerdict.ts`, `adws/core/adwLabels.ts`: the `warn` verdict when no JUnit report exists, and `ADW_UNVERIFIED_LABEL = 'adw:unverified'`.
- `adws/core/phaseRunner.ts`: `runPhase`, which writes `<phase>_running`/`<phase>_completed` only when given a phase name.
- `vitest.config.ts`, `adws/core/environment.ts`: readers of `ADW_UNIT_TEST_REPORT_PATH`.

### New Files
- `test/fixtures/jsonl/manifests/surface-unit-test-phase.json`: rows 06 and 20.
- `test/fixtures/jsonl/manifests/surface-review-passed.json`: rows 07 and 15.
- `test/fixtures/jsonl/manifests/surface-review-blockers.json`: row 08.
- `test/fixtures/jsonl/manifests/surface-diff-evaluation.json`: row 09.
- `test/fixtures/jsonl/manifests/surface-scenario-fix-error.json`: row 23.
- `test/fixtures/jsonl/manifests/surface-plan-validation-phase.json`: row 33.
- `test/fixtures/jsonl/manifests/surface-alignment-phase.json`: row 34.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Record the baseline
- Before any change, run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression" > /tmp/adw-964-regression.before 2>&1` and `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@surface" --format summary > /tmp/adw-964-surface.before 2>&1`. Keep both. The surface summary reads `34 scenarios`, with 6 passed and 28 pending.
- Never run two Cucumber processes from one checkout at once; the pause-queue rows share `agents/paused_queue.json` and `agents/spawn_locks/`.

### 2. `mockForgeProviders`: record label applications
- In `features/regression/support/mockForgeProviders.ts`, extract one helper that `commentOnIssue` and `applyLabel` share. It calls `dispatchMockRequest(method, path, JSON.stringify(body))` and throws `mockForgeProviders: <operation> was answered <status>: <body>` on a status of 400 or more, as `commentOnIssue` does today.
- `applyLabel(issueNumber, labelName)` dispatches `POST /repos/<owner>/<repo>/issues/<n>/labels` with `{ labels: [labelName] }`. That is the body T12 and T13 parse and the route `postIssueLabels` answers.
- Every other method stays `notSupported(...)`.
- Update the header comment in one sentence: comments and label applications are dispatched in-process, so they are recorded before the call returns.

### 3. The phase table in `phaseConfig.ts`
- Import, statically, `executeUnitTestPhase`, `executeReviewPhase`, `executeDiffEvaluationPhase`, `executeScenarioTestPhase`, `executeScenarioFixPhase`, `executeAlignmentPhase` and `executePlanValidationPhase` from their own modules under `adws/phases/`, and `import type { ScenarioProofResult }` from `adws/phases/scenarioProof.ts`. Static imports keep compile time out of each row's run time.
- Add two `PhaseFn` wrappers that call a phase as its orchestrator calls it:
  - `reviewWithoutProof = (config) => executeReviewPhase(config, '')`. Comment: orchestrators pass the proof path of the scenario run before the review, and an empty one when no proof preceded it, as here.
  - `fixFailedReviewProof = (config) => executeScenarioFixPhase(config, failedReviewProof(config.adwId))`. Here `failedReviewProof(adwId)` returns the `ScenarioProofResult` the scenario test phase leaves when the fixture's `@review-proof` blocker scenarios fail:
    - `tagResults: [{ tag: '@review-proof', resolvedTag: '@review-proof', severity: 'blocker', optional: false, passed: false, output: '1 scenario (1 failed)', exitCode: 1, skipped: false }]`;
    - `hasBlockerFailures: true`;
    - `resultsFilePath` and `artifactsDir` under `join(AGENTS_STATE_DIR, adwId, 'scenario-test')`, where that phase writes them. Nothing reads or creates them.

    Comment: `runScenarioTestFixLoop` hands the fix phase only a proof with a failed blocker tag.
- Extend `ORCHESTRATORS`:
  - `test`: `{ id: OrchestratorId.Test, issueType: '/feature', phases: { unitTest: { fn: executeUnitTestPhase, phaseName: 'test' } } }`;
  - `chore`: `{ id: OrchestratorId.Chore, issueType: '/chore', phases: { review: { fn: reviewWithoutProof }, diffEvaluation: { fn: executeDiffEvaluationPhase } } }`;
  - `sdlc`: `{ id: OrchestratorId.Sdlc, issueType: '/feature', phases: { alignment: { fn: executeAlignmentPhase }, scenarioTest: { fn: executeScenarioTestPhase }, scenarioFix: { fn: fixFailedReviewProof }, review: { fn: reviewWithoutProof } } }`.

  Only `test` has a `phaseName`: adwSdlc and adwChore pass none for these phases, so they write no stage.
- Add the direct-phase table:
  - `DIRECT_PHASES: Readonly<Record<string, PhaseDefinition>> = { planValidation: { fn: executePlanValidationPhase } }`;
  - `export const DIRECT_PHASE_ORCHESTRATOR = 'sdlc'`;
  - `export function directPhaseDefinition(phase)`. It asserts as `phaseDefinition` does, naming the known direct phases.

  Comment: no orchestrator in `adws/*.tsx` runs these. A row drives one with no phase name, under adwSdlc's identity, the pipeline plan validation was written for.
- The file stays under 300 lines (about 235). If it would not, move the table, the wrappers and the lookups into `features/regression/support/surfacePhases.ts` and import them from `phaseConfig.ts` and `phaseRun.ts`.

### 4. `phaseRun.ts`: one runner for both entry points, the proof and the env restore
- Extract a private `runDefinedPhase(world, adwId, orchestrator, phase, definition)` from today's `runSurfacePhase` body. It runs:
  1. `buildPhaseConfig(world, adwId, orchestrator)`;
  2. `deliverStubManifest`;
  3. the env restore below;
  4. `withExitTrap(() => runPhase(config, new NonPostingCostTracker(), fn, phaseName))`.

  It then sets `world.scenarioProofResult = config.ctx.scenarioProof` and returns the `PhaseOutcome`. Comment: the review phase reads the proof a scenario test phase leaves on the workflow context, and the scenario-proof Then steps read it from the World.
- `runSurfacePhase(world, adwId, orchestrator, phase)` looks up `phaseDefinition(orchestrator, phase)` first, as today, so an unknown name fails before anything is written. It then calls the shared runner.
- Add `runDirectSurfacePhase(world, adwId, phase)`: `directPhaseDefinition(phase)` first, then the shared runner with `DIRECT_PHASE_ORCHESTRATOR`.
- Add `restoreUnitReportPathOnCleanup(world)`. It saves `process.env['ADW_UNIT_TEST_REPORT_PATH']` and pushes a cleanup entry that restores the saved value, or deletes the variable when it was unset. Comment: the unit-test phase points the JUnit report at its logs directory through `process.env`. In-process that outlives the phase and its temp directory, and `vitest.config.ts` reads it.
- `runSurfaceLifecycle`, `withExitTrap`, `NonPostingCostTracker` and `deliverStubManifest` are unchanged.

### 5. Steps in `surfaceSteps.ts`: G-S2, W-S3, T-S7 and T-S8
- Extract `requireWorktree(world, adwId)` from G-S1's inline check (`No worktree is registered for adwId "<id>": G11 must initialise it first`). Use it in G-S1 and G-S2.
- **G-S2** `the worktree for adwId {string} has the scenarios for issue {int} committed on its branch`. Two `commitFileOnBranch` calls in G11's worktree:
  - `features/feature-<N>.feature`: the fixture's scenario directory is `features/`. Contents: `@adw-<N>`, then `Feature: Surface scenarios for issue <N>`, then one `Scenario: The surface fixture answers` with the steps `Given the surface fixture is running` and `Then the surface fixture answers`. Message: `scenarios: add the scenarios for issue <N>`.
  - `features/step_definitions/feature-<N>.steps.ts`: the default step-definition directory, `.ts` for the fixture's empty BDD framework. Contents: `import { Given, Then } from '@cucumber/cucumber';` and one no-op definition for each of those two steps. Message: `step definitions: add the step definitions for issue <N>`. Nothing compiles or runs this file; the proof only checks that step definitions exist.
- **W-S3** `the {string} phase, which no orchestrator runs, is driven directly for adwId {string}`: `this.phaseOutcome = await runDirectSurfacePhase(this, adwId, phase)`.
- **T-S7** `the scenario proof ran the {string} scenarios, which passed with the output {string}`. With `this.scenarioProofResult`, assert:
  - the proof exists;
  - it holds a tag result whose `resolvedTag` equals the tag. When it does not, list the tags it holds, or say the proof ran no tag (it skips without step definitions);
  - that result has `skipped === false`, `passed === true` and `exitCode === 0`;
  - its `output` contains the text, which is captured stdout, a permitted log-stream assertion.
- **T-S8** `the {string} phase run's error names {string}`:
  - `requirePhaseOutcome(this, phase)`;
  - the outcome did not resolve, has an `error` and no `exitCode`;
  - the error's message (`error instanceof Error ? error.message : String(error)`) contains the text. The failure message uses `describeEnd`.
- No step reads a source file or returns `'pending'`. The file stays under 300 lines (about 170).

### 6. The seven manifests
Follow `surface-plan-phase.json`: `jsonlPath: ".adw-stub-payload.json"`, and a top-level edit writing `.adw-stub-payload.json` with `Surface <name> stub: the prompt opened with no command this manifest answers.`. Each `byCommand` entry is `{ "jsonlPath": ".adw-stub-payload.json", "edits": [{ "path": ".adw-stub-payload.json", "contents": "[{\"type\":\"text\",\"text\":\"<answer>\"}]\n" }] }`, with `<answer>` JSON-escaped once more inside the text. No manifest writes anything else: nothing under `.adw/`, `agents/` or outside the worktree. Every answer stays well under the stub's 500-character `result` limit.

| File | Entry | Answer |
|---|---|---|
| `surface-unit-test-phase.json` | `/test` | `[{"test_name":"app_tests","passed":true,"execution_command":"N/A","test_purpose":"Runs the fixture's unit tests","testcase_count":1}]` |
| `surface-review-passed.json` | `/review` | `{"success":true,"reviewSummary":"The surface review found no blockers.","reviewIssues":[],"screenshots":[]}` |
| `surface-review-blockers.json` | `/review` | `{"success":false,"reviewSummary":"The surface review found one blocker.","reviewIssues":[{"reviewIssueNumber":1,"issueDescription":"The surface handler swallows its error","issueResolution":"Return the error to the caller","issueSeverity":"blocker"}],"screenshots":[]}` |
| `surface-diff-evaluation.json` | `/diff_evaluator` | `{"verdict":"safe","reason":"The surface diff adds only a plan file."}` |
| `surface-plan-validation-phase.json` | `/validate_plan_scenarios` | `{"aligned":true,"mismatches":[],"summary":"The plan covers every scenario of the issue."}` |
| `surface-alignment-phase.json` | `/align_plan_scenarios` | `{"aligned":true,"warnings":[],"changes":[],"summary":"The plan and the scenarios already agree."}` |
| `surface-scenario-fix-error.json` | no `byCommand` | the top-level manifest adds `"response": { "kind": "error" }`, so every agent, `/resolve_failed_scenario` and `/commit` alike, gets the error result |

### 7. Rewrite the eleven rows in place
Keep each file name, the `@regression @surface` tags and no `@adw-` tag. Drop G8 and G9 (`the mock GitHub API records all PR-list calls`, `the claude-cli-stub is loaded with fixture …`), W1, T5 and T9. No Feature description line may begin with a Gherkin keyword (`Given`, `When`, `Then`, `And`, `But`, `Scenario`, `Background`, `Rule`, `Example`). Write each file as follows.

`row-06-adwBuild-unitTestPhase-happy.feature`:
```gherkin
@regression @surface
Feature: adwTest — unitTestPhase — happy path

  adwBuild runs no unit-test phase: adws/adwBuild.tsx runs install and build. adwTest runs it,
  under the phase name "test". Nothing in the cli-tool fixture writes a JUnit report, so the phase
  marks the run unverified, as it does in production, and completes.

  Scenario: test orchestrator's unit-test phase records test_completed and, with no JUnit report from the fixture, labels the issue adw:unverified and says why
    Given an issue 1006 exists in the mock issue tracker
    And the worktree for adwId "surface-06" is initialised at branch "surface-06"
    And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/surface-unit-test-phase.json"
    When the "unitTest" phase of the "test" orchestrator runs for adwId "surface-06"
    Then the state file for adwId "surface-06" records workflowStage "test_completed"
    And the mock GitHub API recorded an application of the "adw:unverified" label on issue 1006
    And the mock GitHub API recorded a comment on issue 1006
    And the mock GitHub API recorded a comment containing the text "## :warning: ADW Unverified — No JUnit Report Emitted"
```

`row-07-adwReview-reviewPhase-happy.feature`:
```gherkin
@regression @surface
Feature: adwSdlc — reviewPhase — happy path

  There is no adwReview orchestrator. adwSdlc runs the review phase, with no phase name.

  Scenario: sdlc orchestrator's review phase runs in-process over a passing review and posts the review-passed comment carrying the review's summary
    Given an issue 1007 exists in the mock issue tracker
    And the worktree for adwId "surface-07" is initialised at branch "surface-07"
    And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/surface-review-passed.json"
    When the "review" phase of the "sdlc" orchestrator runs for adwId "surface-07"
    Then the "review" phase run succeeded
    And the mock GitHub API recorded a comment on issue 1007
    And the mock GitHub API recorded a comment containing the text "## :mag: Review Running"
    And the mock GitHub API recorded a comment containing the text "## :white_check_mark: Review Passed"
    And the mock GitHub API recorded a comment containing the text "The surface review found no blockers."
```

`row-08-adwReview-reviewPhase-error-review-rejected.feature`:
```gherkin
@regression @surface
Feature: adwSdlc — reviewPhase — error: review rejected

  There is no adwReview orchestrator. adwSdlc runs the review phase. A review that finds a blocker
  does not fail the phase run: the phase resolves, reports the review failed, and leaves the patch
  and the retry to the orchestrator.

  Scenario: sdlc orchestrator's review phase resolves over a review with a blocker, posts the review-failed comment naming the blocker, and posts no review-passed comment
    Given an issue 1008 exists in the mock issue tracker
    And the worktree for adwId "surface-08" is initialised at branch "surface-08"
    And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/surface-review-blockers.json"
    When the "review" phase of the "sdlc" orchestrator runs for adwId "surface-08"
    Then the "review" phase run succeeded
    And the mock GitHub API recorded a comment on issue 1008
    And the mock GitHub API recorded a comment containing the text "## :x: Review Failed"
    And the mock GitHub API recorded a comment containing the text "The surface handler swallows its error"
    And the mock harness recorded zero comment posts on issue 1008 containing the text "## :white_check_mark: Review Passed"
```

`row-09-adwReview-diffEvaluationPhase-happy.feature`:
```gherkin
@regression @surface
Feature: adwChore — diffEvaluationPhase — happy path

  There is no adwReview orchestrator. adwChore runs the diff evaluation phase, before it decides
  whether to escalate to review. A branch with no diff is ruled safe without asking the diff
  evaluator, so the row commits a plan on the branch first.

  Scenario: chore orchestrator's diff evaluation phase hands the branch's diff to the diff evaluator and posts its verdict and reason
    Given an issue 1009 exists in the mock issue tracker
    And the worktree for adwId "surface-09" is initialised at branch "surface-09"
    And the worktree for adwId "surface-09" has the plan for issue 1009 committed on its branch
    And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/surface-diff-evaluation.json"
    When the "diffEvaluation" phase of the "chore" orchestrator runs for adwId "surface-09"
    Then the "diffEvaluation" phase run succeeded
    And the mock GitHub API recorded a comment on issue 1009
    And the mock GitHub API recorded a comment containing the text "## Diff Evaluation"
    And the mock GitHub API recorded a comment containing the text "**Reason:** The surface diff adds only a plan file."
    And the mock GitHub API recorded a comment containing the text "Auto-approving and merging."
```

`row-15-adwChore-reviewPhase-happy.feature`:
```gherkin
@regression @surface
Feature: adwChore — reviewPhase — happy path

  Scenario: chore orchestrator's review phase runs in-process for a chore over a passing review and posts the review-passed comment
    Given an issue 1015 exists in the mock issue tracker
    And the worktree for adwId "surface-15" is initialised at branch "surface-15"
    And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/surface-review-passed.json"
    When the "review" phase of the "chore" orchestrator runs for adwId "surface-15"
    Then the "review" phase run succeeded
    And the mock GitHub API recorded a comment on issue 1015
    And the mock GitHub API recorded a comment containing the text "## :mag: Review Running"
    And the mock GitHub API recorded a comment containing the text "## :white_check_mark: Review Passed"
```

`row-20-adwTest-unitTestPhase-happy.feature`:
```gherkin
@regression @surface
Feature: adwTest — unitTestPhase — happy path

  Scenario: test orchestrator's unit-test phase runs in-process under the phase name test, succeeds and records test_completed
    Given an issue 1020 exists in the mock issue tracker
    And the worktree for adwId "surface-20" is initialised at branch "surface-20"
    And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/surface-unit-test-phase.json"
    When the "unitTest" phase of the "test" orchestrator runs for adwId "surface-20"
    Then the "unitTest" phase run succeeded
    And the state file for adwId "surface-20" records workflowStage "test_completed"
```

`row-21-adwTest-scenarioTestPhase-happy.feature`:
```gherkin
@regression @surface
Feature: adwSdlc — scenarioTestPhase — happy path

  adwTest runs only the unit-test phase. adwSdlc runs the scenario test phase, in its scenario
  test-and-fix loop. With the issue's scenarios and step definitions in the worktree, the phase
  runs the cli-tool fixture's scenario command, which echoes a passing summary. It posts no comment.

  Scenario: sdlc orchestrator's scenario test phase runs the fixture's scenario command for the review-proof tag, succeeds and posts no comment
    Given an issue 1021 exists in the mock issue tracker
    And the worktree for adwId "surface-21" is initialised at branch "surface-21"
    And the worktree for adwId "surface-21" has the scenarios for issue 1021 committed on its branch
    When the "scenarioTest" phase of the "sdlc" orchestrator runs for adwId "surface-21"
    Then the "scenarioTest" phase run succeeded
    And the scenario proof ran the "@review-proof" scenarios, which passed with the output "1 scenario (1 passed)"
    And the mock harness recorded zero comment posts on issue 1021
```

`row-22-adwTest-scenarioProof-happy.feature`:
```gherkin
@regression @surface
Feature: adwSdlc — scenarioProof — happy path

  adwTest runs only the unit-test phase. adwSdlc runs the scenario proof, through its scenario test
  phase. The proof runs the cli-tool fixture's scenario command once for each tag of the fixture's
  review proof config, and finds the step definitions it needs in the worktree.

  Scenario: sdlc orchestrator's scenario test phase proves the review-proof scenarios passed, with the fixture's echoed summary as their output, and records no blocker failures
    Given an issue 1022 exists in the mock issue tracker
    And the worktree for adwId "surface-22" is initialised at branch "surface-22"
    And the worktree for adwId "surface-22" has the scenarios for issue 1022 committed on its branch
    When the "scenarioTest" phase of the "sdlc" orchestrator runs for adwId "surface-22"
    Then the scenario proof ran the "@review-proof" scenarios, which passed with the output "1 scenario (1 passed)"
    And the scenario proof records no blocker failures
```

`row-23-adwTest-scenarioFixPhase-error.feature`:
```gherkin
@regression @surface
Feature: adwSdlc — scenarioFixPhase — error path

  adwTest runs only the unit-test phase. adwSdlc runs the scenario fix phase, in its scenario
  test-and-fix loop, which hands it the proof of a run whose blocker scenarios failed. The stub
  answers every agent with an error. The resolver's failure is logged and the phase goes on; the
  commit agent's failure fails the phase run.

  Scenario: sdlc orchestrator's scenario fix phase fails at the commit when the stub answers every agent it starts with an error
    Given an issue 1023 exists in the mock issue tracker
    And the worktree for adwId "surface-23" is initialised at branch "surface-23"
    And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/surface-scenario-fix-error.json"
    When the "scenarioFix" phase of the "sdlc" orchestrator runs for adwId "surface-23"
    Then the "scenarioFix" phase run failed
    And the "scenarioFix" phase run's error names "Commit agent 'scenario-fix-agent'"
```

`row-33-adwReview-planValidationPhase-happy.feature`:
```gherkin
@regression @surface
Feature: planValidationPhase — happy path, driven directly

  No orchestrator in adws/*.tsx runs executePlanValidationPhase. There is no adwReview, and adwSdlc
  and the review orchestrators run the alignment phase in its place. This row drives the phase
  directly, over a committed plan and the issue's committed scenarios.

  Scenario: the plan validation phase, driven directly, finds the committed plan and scenarios aligned and posts its validating and validated comments
    Given an issue 1033 exists in the mock issue tracker
    And the worktree for adwId "surface-33" is initialised at branch "surface-33"
    And the worktree for adwId "surface-33" has the plan for issue 1033 committed on its branch
    And the worktree for adwId "surface-33" has the scenarios for issue 1033 committed on its branch
    And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/surface-plan-validation-phase.json"
    When the "planValidation" phase, which no orchestrator runs, is driven directly for adwId "surface-33"
    Then the "planValidation" phase run succeeded
    And the mock GitHub API recorded a comment on issue 1033
    And the mock GitHub API recorded a comment containing the text "## :mag: Validating Plan-Scenario Alignment"
    And the mock GitHub API recorded a comment containing the text "Implementation plan and BDD scenarios are aligned."
```

`row-34-adwReview-alignmentPhase-happy.feature`:
```gherkin
@regression @surface
Feature: adwSdlc — alignmentPhase — happy path

  There is no adwReview orchestrator. adwSdlc runs the alignment phase, between the plan and the
  build, with no phase name.

  Scenario: sdlc orchestrator's alignment phase aligns the committed plan with the issue's committed scenarios and posts its aligning and aligned comments
    Given an issue 1034 exists in the mock issue tracker
    And the worktree for adwId "surface-34" is initialised at branch "surface-34"
    And the worktree for adwId "surface-34" has the plan for issue 1034 committed on its branch
    And the worktree for adwId "surface-34" has the scenarios for issue 1034 committed on its branch
    And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/surface-alignment-phase.json"
    When the "alignment" phase of the "sdlc" orchestrator runs for adwId "surface-34"
    Then the "alignment" phase run succeeded
    And the mock GitHub API recorded a comment on issue 1034
    And the mock GitHub API recorded a comment containing the text "## :arrows_counterclockwise: Aligning Plan and Scenarios"
    And the mock GitHub API recorded a comment containing the text "Implementation plan and BDD scenarios have been aligned."
```

The two "Plan and Scenarios Aligned" comments share their heading, so rows 33 and 34 assert the sentence that tells them apart.

### 8. Register the phrases in `features/regression/vocabulary.md`
In `## Given/When/Then — Surface phases and lifecycles`, keeping five columns:

- **Intro.** The mock forge "records every comment it posts and every label it applies as an HTTP call would". `adwTest` names its unit-test phase `test`; adwSdlc and adwChore name none of the phases these rows drive, so those rows assert no stage. Assertions may also target the scenario proof a phase produced.
- **W-S1 semantics.** Append:
  - the phase function is called as its orchestrator calls it: the review phase with the empty scenario-proof path passed when no proof preceded it, and the scenario fix phase with the proof of a failed run of the fixture's `@review-proof` blocker tag;
  - the scenario proof the phase left on the workflow context is recorded on the World;
  - the pairs it drives: `plan`/`plan`, `build`/`build`, `test`/`unitTest` (`test`), `chore`/`review`, `chore`/`diffEvaluation`, `sdlc`/`alignment`, `sdlc`/`scenarioTest`, `sdlc`/`scenarioFix` and `sdlc`/`review`.
- **New rows:**
  - **G-S2** `the worktree for adwId {string} has the scenarios for issue {int} committed on its branch`: writes and commits `features/feature-<N>.feature`, tagged `@adw-<N>`, and its step definitions `features/step_definitions/feature-<N>.steps.ts` in the worktree G11 registered. The alignment and plan-validation phases then find the issue's scenarios, and the scenario proof finds step definitions and runs the fixture's scenario command. Pattern phase-import; target worktree artefact.
  - **W-S3** `the {string} phase, which no orchestrator runs, is driven directly for adwId {string}`: as W-S1, for a phase no orchestrator in `adws/*.tsx` runs (`planValidation`). It runs `runPhase` with no phase name under adwSdlc's identity. Target: phase run outcome.
  - **T-S7** `the scenario proof ran the {string} scenarios, which passed with the output {string}`: asserts the recorded scenario proof holds a result for the tag that was not skipped, passed with exit code 0, and whose captured output contains the text. Target: phase run outcome (scenario proof) + log stream.
  - **T-S8** `the {string} phase run's error names {string}`: asserts the recorded outcome is for that phase, the run threw, and the error's message contains the text. Target: phase run outcome.
- **The reused-phrases paragraph** also names T12 (`the mock GitHub API recorded an application of the {string} label on issue {int}`), T14 (`the mock harness recorded zero comment posts on issue {int}`) and T-PY3 (`the scenario proof records no blocker failures`, which reads the same recorded proof).

### 9. Keep feature-960 §6 passing
- In `features/per-issue/feature-960.feature`, edit the §6 scenario:
  - retitle it to `The regression suite's smoke and surface scenarios are all still reported pending, except the surface rows that run in-process, which pass`;
  - add `@adw-964` to its tags, so this issue's test phase runs it;
  - list all seventeen in-process rows in its table, in row order: row-02, 03, 04, 05, 06, 07, 08, 09, 15, 20, 21, 22, 23, 31, 32, 33, 34, with the exact file names under `features/regression/surfaces/`.
- `feature-960.steps.ts` needs no change. Its step asserts that each listed row passes exactly once and every other smoke and surface scenario stays pending.

### 10. Run the validation commands
- Run every command in `Validation Commands`. Fix and re-run until all pass.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

Run each command from the repository root. Never run two Cucumber processes from this checkout at once.

- `bun run lint`: no errors.
- `bunx tsc --noEmit`: the root type check passes; it covers `features/**` and `test/**`.
- `bunx tsc --noEmit -p adws/tsconfig.json`: the additional type check passes.
- `bun run build`: passes.
- `bun run test:unit`: the Vitest suite passes. That includes `test/mocks/__tests__/manifestRefusalGuard.test.ts`'s sweep, which now covers the seven new manifests.
- `bun run lint:git-guard`: no violation.
- Before the fix (step 1): `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@surface" --format summary` reports `34 scenarios` with 6 passed and 28 pending.
- The eleven rows, twice in a row in the same checkout. Each run reports `11 scenarios (11 passed)` and exits 0:
  ```sh
  for i in 1 2; do NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@surface" --name "^((test|sdlc|chore) orchestrator's (unit-test|review|diff evaluation|scenario test|scenario fix|alignment) phase|the plan validation phase, driven directly)" --format summary || exit 1; done
  ```
- The whole surface tier:
  ```sh
  NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@surface" --format summary > /tmp/adw-964-surface.after 2>&1
  grep -E "^34 scenarios" /tmp/adw-964-surface.after | grep "17 passed" | grep "17 pending"
  ```
  The summary reads 17 passed (#963's six and these eleven) and 17 pending, with nothing failed, undefined or ambiguous.
- `test -z "$(ls -d agents/surface-0[6-9] agents/surface-15 agents/surface-2[0-3] agents/surface-3[34] 2>/dev/null)"`: the rows left no top-level state or scenario proof in the checkout.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-960"`: exits 0. The amended §6 sees all seventeen in-process rows pass and every other smoke and surface scenario stay pending.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-963"`: exits 0. Its two `@surface` child runs now run the eleven rows too, and still leave no spawn lock and no git repository behind; the committed-manifest sweep refuses none of the new manifests.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-964"`: exits 0. These are this issue's own scenarios, including the per-row "under 5 seconds" check (AC1).
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@pause-queue-reset-time or @pause-queue-ownership"`: exits 0 (AC3).
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression" > /tmp/adw-964-regression.after 2>&1; tail -n 3 /tmp/adw-964-regression.after; ! tail -n 3 /tmp/adw-964-regression.after | grep -qE "failed|undefined|ambiguous"`: no scenario failed. Compared with `/tmp/adw-964-regression.before`, the only change is eleven scenarios moving from pending to passed. Cucumber still exits 1 on the remaining pending smoke and surface scenarios, as Divergence item 3 records.
- `git status --porcelain`: shows only the files this plan names, and nothing under `agents/` or `logs/`.

## Notes
- Strictly follow `.adw/coding_guidelines.md`:
  - guard clauses, and at most two levels of nesting;
  - no `any`, no `as unknown as`, and `import type` for types;
  - every file under 300 lines;
  - comments only for invariants and non-obvious reasons: why the review gets an empty proof path, why the fix phase gets a failed proof, why the unit-report variable is restored, why the direct phase borrows adwSdlc's identity. No issue numbers in comments.
- No new library is needed.
- **W-S3, not W-S1, for row 33.** The issue asks to drive each row through W-S1, and to drive `executePlanValidationPhase` directly because nothing calls it. W-S1 names an orchestrator, and any name would claim a production caller that does not exist, against the retitle rule. W-S3 shares W-S1's runner, config, stub delivery, exit trap and `runPhase` call; only the orchestrator claim is gone.
- **Why adwSdlc for rows 07, 08, 21, 22, 23 and 34.** adwSdlc runs every one of those phases in production, so one table entry serves them all. adwPlanBuildTest, adwPlanBuildReview and adwPlanBuildTestReview each run only some of them. Row 15 stays adwChore and row 09 becomes adwChore, as the issue says. adwChore runs both phases with issue type `/chore`.
- **Rows 06 and 20 both drive adwTest's `'test'` phase**, as the issue's table says. Row 06 asserts the comments and label; row 20 asserts the outcome and the stage. Both take the `warn` path, since nothing writes a JUnit report: the stub stands in for the test agent, and the fixture's `## Run Tests` is `N/A`. A stub that writes a report to `$ADW_UNIT_TEST_REPORT_PATH`, which `getSafeSubprocessEnv()` passes through, would let a row assert the `pass` path. That is a stub feature beyond this slice.
- **Row 23 follows the code.** An agent error from `/resolve_failed_scenario` is logged and does not fail the phase (`scenarioFixPhase.ts:89-93`). The commit agent's error throws (`gitAgent.ts:167-172`). An error only for the resolver would leave the run succeeding and pushing. The row therefore asserts the failure and names its cause.
- **The failing proof row 23 feeds the fix phase is built by the harness.** The fixture's scenario command only echoes a passing summary, so a real run cannot produce a failed blocker tag.
- **Rows 21 and 22 depend on G-S2's step definitions.** Without them `runScenarioProof` skips, and "no blocker failures" would hold vacuously. T-S7 fails in that case and says the proof ran no tag.
- **G13** is registered but has no step definition, and its fixture directory does not exist, so it cannot express "the issue's scenarios exist". G-S2 is the new, registered Given.
- **Old assertions dropped, and why.** `awaiting_merge` is written only at the end of adwSdlc and adwChore. T5 needs a subprocess. T9 holds vacuously for these phases. G8 and G9 configure nothing in-process.
- **Timing.** Each row starts at most two stub processes. Scenario fix starts two, the scenario rows start none and run one `echo`, and the rest start one. The git-mock wrapper adds about 0.1 s per git call under the hooks. Each row should take a second or two, and a full `@surface` child run, the 120 s budget of feature-960 and feature-963, about 20–40 s.
- ADR-0037 Divergence item 3 stays open; the smoke tier and the other surface rows are later slices. The document phase refreshes `app_docs/feature-9gjajh-bdd-regression-suite.md`: its line that `mockForgeProviders` implements only `commentOnIssue` and `moveToStatus`, and the list of in-process rows.
