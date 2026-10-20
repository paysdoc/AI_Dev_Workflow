# Feature: A resumed workflow whose plan went with its removed worktree parks as `worktree_lost` instead of re-planning

## Metadata
issueNumber: `1078`
adwId: `6ph2e9-feat-a-resumed-workf`
issueJson: `{"number":1078,"title":"feat: a resumed workflow whose plan is missing parks instead of re-planning","body":"## Parent PRD\n\n`docs/prd/specs-worktree-only-and-docs-relocation.md` (was `specs/prd/specs-worktree-only-and-docs-relocation.md` before #1076).\n\n## What to build\n\nPRD \"Plan lifecycle\", last bullet. Once plans are uncommitted (#1077), a worktree removed mid-flight and rebuilt on resume has no plan. Today the build and validation phases throw on a missing plan, and the plan phase re-runs the planner when the file is absent.\n\nWhen a resumed workflow reaches a phase that requires the plan and finds none, park it with a distinct reason naming the lost worktree. Add that reason to the exhaustive stage classifier. The planner is never re-run implicitly on resume.\n\n## Acceptance criteria\n\n- [ ] Regression scenario: worktree removed between plan and build, workflow resumed → recorded stage is the new park reason, and no second plan-created comment appears\n- [ ] The stage classifier is exhaustive over the new reason (existing exhaustiveness test extended)\n- [ ] A fresh (non-resumed) run is unchanged\n- [ ] Unit suite, typecheck, BDD regression green\n\n## Blocked by\n#1077 <!-- adw:region-overlap -->\n\nNone - can start immediately. Independent of #1077: parking on a missing plan is correct today too.\n\n## Touched Files\n\n- adws/phases/buildPhase.ts\n- adws/phases/planValidationPhase.ts\n- adws/phases/planPhase.ts (resume branch only)\n- adws/core/workflowStage* (stage classifier)\n- features/regression/ (new scenario, orchestrator-resilience prior art)\n\n## User stories addressed\n\n- User stories 19, 20","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-10-20T15:36:33Z","comments":[{"author":"paysdoc-adw","createdAt":"2026-10-20T15:42:13Z","body":"⏸️ **Deferred behind #1077 — overlapping code region**\n\nADW detected that this issue edits code overlapping with #1077, which is already in flight. To avoid building on a stale base (and the forced rebase / non-fast-forward push deadlock that follows), it has been serialized behind #1077 by registering a `## Blocked by` dependency.\n\nOverlapping paths:\n- `adws/phases/planphase.ts`\n\nThis issue will spawn automatically once #1077 merges and closes. To override, remove the `#1077 <!-- adw:region-overlap -->` line from this issue body."}],"actionableComment":null}`

## Feature Description
This is the last bullet of the PRD's "Plan lifecycle" section (`docs/prd/specs-worktree-only-and-docs-relocation.md`), covering user stories 19 and 20.

Since #1077 (merged, `f9fe9627`) the plan is never committed. The planner writes it under `specs/` in the worktree, worktree setup ignores `specs/` at runtime, and the build, review, document and merge phases read it there by path. The plan therefore exists only in the worktree of the run that wrote it. If that worktree is removed mid-flight (by an operator, a host clean-up or a moved checkout) and rebuilt from the branch on resume, the plan is gone.

This feature adds a recovery stage of its own, `worktree_lost`. When a resumed workflow whose plan was created by an earlier run reaches a phase that needs the plan and finds none, the workflow parks under that stage. The stage sits in the `human_gated` recovery class, so the cron never relaunches it on its own. The park comment says the plan was lost with the worktree and names the worktree and the plan path. It also says what `## Retry` (re-runs, and parks again while the plan is missing) and `## Cancel` (starts the issue over with a new plan) do. The planner never runs again implicitly on resume. Fresh runs behave exactly as today.

## User Story
As an operator
I want a resumed workflow whose worktree was removed to park with a reason that says the plan was lost with the worktree
So that I restart it deliberately instead of the planner silently producing a second plan against partially built code, while the build, review, document and merge phases keep reading the plan by path from the worktree during a normal run

## Problem Statement
- A plan is a per-run working file now (#1077), so a rebuilt worktree carries none.
- On a resumed run (`recoveryState.canResume`, with the last completed stage at or past `plan_created` per the issue's comments), today's phases do this:
  - The plan phase (`adws/phases/planPhase.ts`) skips the planner and logs `Skipping Plan Agent (plan already exists or completed)`, which is untrue when the file is absent. Its gate `shouldExecuteStage('plan_created', …) && !planFileExists(…)` is the one place that can run the planner on a resume. Nothing states that a plan created by an earlier run must never be planned again.
  - The alignment phase skips quietly ("No plan file found").
  - The build phase (`adws/phases/buildPhase.ts`) throws `Cannot read plan file at …`. The plan-validation phase (`adws/phases/planValidationPhase.ts`) throws the same error.
  - The orchestrator's `handleWorkflowError` records `abandoned`. That stage is `retriable`, so the cron takes it over, resumes it, and the run throws again. The loop posts error comments and never asks a person.
- No workflow stage means "the plan was lost with the worktree". `parkWorkflow` (`adws/phases/workflowPark.ts`) is the only park, and it always records `human_gated`, so the recorded stage cannot be the new reason. The exhaustive classifier (`adws/core/stageClassifier.ts`) and its `Record<WorkflowStage, StageClass>` test know no such stage.

## Solution Statement
1. **A new stage.** Add `worktree_lost` to the `WorkflowStage` union (`adws/types/workflowTypes.ts`). Classify it `human_gated` in `classifyStage`, next to `merge_blocked`, `human_gated` and `review_failed`, the three human-gated stages that ADR-0036 lists. Extend the exhaustiveness test.
2. **A new park reason that records its own stage.** In `adws/forge/parkComment.ts`:
   - Add `ParkReason.WorktreeLost = 'worktree_lost'`. Its evidence is the phase that found no plan, the worktree path and the plan path.
   - Add a title, a description and `## Retry`/`## Continue` directives for it.
   - Add `parkStage(reason)`, backed by an exhaustive `Record<ParkReason, ParkStage>`. Every existing reason maps to `human_gated` and `WorktreeLost` maps to `worktree_lost`.
   - `parkWorkflow` records `parkStage(evidence.reason)` as `workflowStage`, with `parkReason` beside it as today. The comment says "parked as `<stage>`".
   - Existing parks are unchanged.
3. **A lost-plan gate.** Add `adws/phases/lostPlanGate.ts`. Its pure predicate `planCreatedByEarlierRun(recoveryState)` is `canResume && !shouldExecuteStage('plan_created', recoveryState)`. The recovery state is computed once, at init, from the issue's comments, so it reflects earlier runs only. Its side effect `parkIfPlanLost(config, phase)` is called only by a phase that has already found no plan:
   - If an earlier run created the plan, it logs the loss and parks `worktree_lost`, which does not return.
   - Otherwise it returns, and the caller plans (plan phase) or throws (build, plan validation) exactly as today. A fresh run and a resume before `plan_created` are therefore unchanged.
4. **Call sites.**
   - Plan phase: at the top, before its first `await`, `if (!planFileExists(...)) parkIfPlanLost(config, 'plan')`. This only acts in the resume branch. Because nothing is awaited before it, a park here ends the process before the scenario phase starts when the two run in parallel (`runPhasesParallel` calls the plan phase first).
   - Plan-validation phase: in its existing `!planContent` branch, before the throw.
   - Build phase: in the `catch` of its existing plan read, before the throw.
5. **Recovery consumers.**
   - The cron filter (`adws/triggers/cronIssueFilter.ts`) excludes `worktree_lost` with an inline check that bypasses the grace period, as it does for the other human-gated stages.
   - `## Retry` (`adws/triggers/retryHandler.ts`) re-arms `worktree_lost` to `phase_timeout`, as it does for `human_gated` and `review_failed`. The resumed run parks again while the plan is still missing and continues if the plan was put back. This keeps the invariant `workflowPark.test.ts` asserts: every park is re-armable by `## Retry`.
   - `## Continue` waives nothing; `continueHandler` acts only on `human_gated` baseline parks, so it needs no change.
   - The takeover keeps its `human_gated`-class default (`spawn_fresh`). A relaunch resumes, finds the plan still missing, and parks again. It never re-plans.
6. **Scenarios.** They are already written; this feature adds their step definitions and manifests.
   - The regression scenario is `features/regression/resume/feature-1078.feature` (`@regression @subprocess @plan-lost-on-resume`). It runs the real SDLC orchestrator through the subprocess harness:
     - the first run creates the plan, and a rate limit pauses it during its build;
     - the worktree is then removed, leaving its branch;
     - the orchestrator is invoked again under the same adwId.
     The scenario asserts the recorded stage `worktree_lost` and exactly one plan-created comment, and that neither the planner nor the build runs again.
   - The per-issue scenarios in `features/per-issue/feature-1078.feature` cover:
     - the park in each of the three phases;
     - the paths that do not change: the plan still present, a resume before `plan_created`, and a fresh run;
     - the cron's exclusion;
     - the type check.
   - The four existing regression rows tagged `@adw-1078` show that fresh runs are unchanged: the SDLC smoke run and the plan, build and plan-validation surface rows.
   - Implement the six new phrases, and register in the vocabulary the two that the regression scenario uses.

## Relevant Files
Use these files to implement the feature:

- `README.md`: project overview. The "Retry and Cancel directives" bullet (line ~19) and the "Worktree-only plans" bullet (line ~27) must mention `worktree_lost`. The `adws/phases/` tree listing (lines ~860–1000) gets the new module and tests.
- `.adw/coding_guidelines.md`: guidelines to follow strictly. Files stay under 300 lines, guard clauses are preferred, comments cover only invariants and ordering, issue numbers never appear in comments, and enums are used for named constants.
- `adws/README.md`: required reading when operating in `adws/`.
- `adws/types/workflowTypes.ts`: the `WorkflowStage` union, which gains `worktree_lost`. `RecoveryState` (`canResume`, `lastCompletedStage`, `planPath`) drives the gate.
- `adws/core/stageClassifier.ts`: the exhaustive `classifyStage` switch with its `never` default. `worktree_lost` joins the `human_gated` class.
- `adws/core/__tests__/stageClassifier.test.ts`: the existing exhaustiveness test (`EXPECTED: Record<WorkflowStage, StageClass>`) to extend.
- `adws/core/orchestratorLib.ts`: `shouldExecuteStage`, which the gate's predicate reuses. It must stay unchanged.
- `adws/core/workflowCommentParsing.ts`: `STAGE_ORDER`, `STAGE_HEADER_MAP`, `detectRecoveryState` and `extractPlanPathFromComment`. This is how a resume knows `plan_created` was completed and which plan path the earlier run wrote. It must stay unchanged; the park heading must stay out of `STAGE_HEADER_MAP`.
- `adws/forge/parkComment.ts`: `ParkReason`, `ParkEvidence`, `TITLES`, `parkDirectives`, `describeFailure`, `describeParking` and `buildParkComment`. These gain the new reason and `parkStage`.
- `adws/phases/workflowPark.ts`: `parkWorkflow`. It records `parkStage(reason)` instead of the literal `human_gated`.
- `adws/phases/planPhase.ts`: `executePlanPhase`. Add the gate at the top. The planner condition at line ~62 stays as it is.
- `adws/phases/planValidationPhase.ts`: `executePlanValidationPhase`. Add the gate in the missing-plan branch (line ~53).
- `adws/phases/buildPhase.ts`: `executeBuildPhase`. Add the gate in the plan-read `catch` (line ~49). The file is at 290 lines, so add only the import and the call.
- `adws/agents/planAgent.ts`: `getPlanFilePath`, `planFileExists` and `readPlanFile`. These are the presence checks the phases already use; they need no change.
- `adws/phases/applicationTypeGate.ts`: prior art for a gate that parks through `parkWorkflow` (`recordLine`, then `park`).
- `adws/phases/workflowInit.ts`: builds `recoveryState` and `ctx.planPath` on resume, posts the `resuming` comment, and clears `parkReason` at `starting`. Reference only; no change.
- `adws/core/phaseRunner.ts`: `runPhase` and `runPhasesParallel` (`fns.map(fn => fn(config))` calls the plan phase first). This is the ordering the plan-phase gate relies on. Reference only.
- `adws/adwSdlc.tsx`, `adws/adwPlanBuild.tsx`, `adws/adwChore.tsx`, `adws/adwPlanBuildReview.tsx`, `adws/adwPlanBuildTestReview.tsx`, `adws/adwBuild.tsx`: the orchestrators that run the plan, build or plan-validation phases. Reference only.
- `adws/phases/alignmentPhase.ts`: already skips when there is no plan and never throws. Reference only; no change.
- `adws/triggers/cronIssueFilter.ts`: `evaluateIssue` gains the inline `worktree_lost` exclusion after the `review_failed` check.
- `adws/triggers/retryHandler.ts`: `decideRetryAction` and the `RetryAction` `from` union gain `worktree_lost`. Update the header comment that lists the recovery paths.
- `adws/triggers/continueHandler.ts`: `decideContinueAction` acts only on `human_gated` baseline parks. Reference only; add a unit-test assertion.
- `adws/triggers/takeoverHandler.ts`: the `human_gated` class falls through to `spawn_fresh`. Reference only.
- `adws/triggers/cancelHandler.ts`: `## Cancel` cleans up fully and re-queues the issue, which is the deliberate restart the park comment points to. Reference only.
- `adws/phases/__tests__/workflowPark.test.ts`: park tests, including the invariant "leaves the workflow in a stage that `## Retry` re-arms". To extend.
- `adws/forge/__tests__/parkComment.helpers.ts`: `SAMPLE: Record<ParkReason, ParkEvidence>`, which must gain a `WorktreeLost` sample.
- `adws/forge/__tests__/parkComment.structure.test.ts`: per-reason structure tests. "says that the workflow is parked as human_gated" becomes stage-aware, the base-branch-note list grows, and the distinct-directives count grows.
- `adws/forge/__tests__/parkComment.content.test.ts`: content tests to extend for the new reason.
- `adws/phases/__tests__/buildPhase.test.ts`: build-phase test setup to extend. It mocks `getPlanFilePath` as `plan.md` and runs on a fresh recovery state.
- `adws/phases/__tests__/planPhaseCommit.test.ts`: prior art for driving `executePlanPhase` against a real temporary repository with a mocked `runPlanAgent`.
- `adws/triggers/__tests__/retryHandler.test.ts`, `adws/triggers/__tests__/cronIssueFilter.eligibility.test.ts`, `adws/triggers/__tests__/cronIssueFilterFixtures.ts`, `adws/triggers/__tests__/continueHandler.test.ts`: trigger tests to extend.
- `features/regression/vocabulary.md`: the phrase registry and rot-detection rubric. Register the regression scenario's two new phrases, W-PL1 and T-PL1, in a new `@plan-lost-on-resume` section with the `PL` prefix, which is unused. That scenario also reuses G18, G3, G4, W1, T1, T3, T5 and T-S6. Phrases only the per-issue scenarios use get no row.
- `features/regression/resume/feature-1078.feature`: the issue's regression scenario, which the alignment phase moved here from the per-issue file. It is `@regression @subprocess @plan-lost-on-resume`, tagged `@adw-1078`.
- `features/per-issue/feature-1078.feature`: the nine per-issue scenarios the scenario phase wrote (step 12).
- `features/regression/smoke/adw_sdlc_happy_path.feature`, and the surface rows `features/regression/surfaces/row-02-adwPlan-planPhase-happy.feature`, `row-04-adwBuild-buildPhase-happy.feature` and `row-33-adwReview-planValidationPhase-happy.feature`: fresh-run rows the scenario phase tagged `@adw-1078`. They must pass unchanged.
- `features/regression/support/subprocessHarness.ts`, `subprocessRun.ts`, `forgeShadow.ts`, `hooks.ts`: the subprocess harness the regression scenario runs on.
  - W1's second claim of an adwId keeps what the first run left.
  - Each run's forge state is written from the mock server's state, so the second run reads the first run's comments.
  - The `@regression and (@subprocess or @webhook)` hook sets the harness up.
- `features/regression/support/phaseConfig.ts`, `features/regression/support/phaseRun.ts`, `features/regression/support/mockForgeProviders.ts`, `features/regression/support/fixtureWorktree.ts`: the in-process surface harness the per-issue `@surface` scenarios run on. It provides:
  - `buildConfigFor`, which always builds a fresh recovery state (`detectRecoveryState([])`);
  - the `ORCHESTRATORS` table (`plan`/`plan`, and `build`/`build` with the phase name `build`) and the direct `plan validation` phase;
  - `runSurfacePhase`, `runDirectSurfacePhase`, `withExitTrap`, `NonPostingCostTracker` and `deliverStubManifest`;
  - the comment-recording mock forge;
  - `realGit`, which runs real git where the `@regression` git mock would no-op `clone` and `fetch`.
- `features/regression/step_definitions/subprocessSteps.ts`, `thenSteps.ts`, `surfaceSteps.ts`: W1, T1, T3, T5, W-S1, W-S4, T-S1, T-S6 and T-S10, which the new phrases sit beside. `surfaceSteps.ts`'s `commentBodyContains` is the comment-body match T-PL1 needs.
- `features/regression/support/seededRecords.ts`: reads back what the Givens seeded into the mock server's state. `seededIssue()` returns no comments.
- `features/per-issue/step_definitions/feature-1077.steps.ts`: prior art for two things. Its per-issue `Before`/`After` hooks give a scenario without `@regression` what the `@regression` hooks give. Its `branchOfWorkflow` and `worktreeOfBranch` read a workflow's branch from its top-level state and find that branch's worktree in the harness workspace.
- `features/regression/takeover/feature-959.feature`, `features/regression/retry-directive/feature-908.feature`: orchestrator-resilience prior art.
  - Phrases G-RD2–G-RD5, W-RD1 and T-RD11 can drive the optional `## Retry` re-arm scenario.
  - The per-issue cron scenario reuses feature-959's launch-boundary, seeded-workflow, poll and launch phrases. It gets feature-959's hooks through its `@dead-orchestrator-takeover` tag.
- `features/regression/smoke/pause_resume_rate_limit.feature`, `test/fixtures/jsonl/manifests/rate-limit-pause-resume.json`: prior art for an SDLC subprocess run that a `seven_day` rate limit pauses. The run records `paused` and exits 0.
- `test/fixtures/jsonl/manifests/adw-sdlc-happy.json`: the base of the new `adw-sdlc-paused-at-build.json`.
- `test/fixtures/jsonl/manifests/surface-plan-phase.json`, `surface-build-phase.json`, `surface-plan-validation-phase.json`: the stub manifests the per-issue surface scenarios name. `surface-plan-phase.json` writes issue 1002's plan, so the resume-before-plan scenario gets a manifest of its own.
- `adws/triggers/pauseQueueResume.ts`: `resumeWorkflow` never resumes a paused workflow whose worktree is gone. It posts an error and leaves the workflow paused for `## Retry`, which respawns the orchestrator under the same adwId. The regression scenario stands for that respawn by invoking the orchestrator again. Reference only.
- `adws/triggers/perIssueScenarioSweep.ts`: removes `features/per-issue/feature-<N>.feature` and its `features/per-issue/step_definitions/feature-<N>*` files 14 days after the PR merges. The regression scenario's steps must therefore live under `features/regression/step_definitions/` and import nothing from `features/per-issue/`.
- `cucumber.js`: picks up `features/regression/**/*.feature`, `features/per-issue/**/*.feature` and both step-definition directories, so the new `features/regression/resume/` directory needs no configuration.
- `.adw/conditional_docs.md`: index entries to extend for the new module, tests and regression scenario. Keep `bun run lint:docs-index` green.
- `app_docs/feature-9gjajh-build-and-plan-phases.md`: conditional doc for build, plan and plan-validation phase work and resume. It owns `planPhase.ts`, `buildPhase.ts` and `planValidationPhase.ts`.
- `app_docs/feature-9gjajh-takeover-and-coordination.md`: conditional doc for the exhaustive stage classifier, `## Retry` and resume-cap work. It owns `stageClassifier.ts` and its test.
- `app_docs/feature-9gjajh-test-and-scenario-phases.md`: conditional doc for the park comment builder (`buildParkComment`, `parkDirectives`, `ParkReason`) and `parkWorkflow`. It owns `workflowPark.ts`.
- `app_docs/feature-9gjajh-issue-routing-and-eligibility.md`: conditional doc for the retry and cancel handlers.
- `app_docs/feature-9gjajh-workflow-lifecycle-phases.md`: conditional doc for workflow initialization (recovery mode).
- `app_docs/feature-9gjajh-bdd-regression-suite.md`: conditional doc for `features/regression/**`, the vocabulary registry and the surface harness.
- `docs/prd/specs-worktree-only-and-docs-relocation.md`: the parent PRD ("Plan lifecycle" last bullet, Testing Decisions "Resume" bullet, user stories 19 and 20).
- `docs/adr/0036-stage-taxonomy-and-exhaustive-classifier.md`: the six-class taxonomy. Each consumer maps a class to its own decision, and the human-gated stages are distinct literals.
- `docs/adr/0032-explicit-cancel-and-retry-directives.md`: the meaning of `## Retry` and `## Cancel`.

### New Files
- `adws/phases/lostPlanGate.ts`: `planCreatedByEarlierRun` (pure) and `parkIfPlanLost` (parks `worktree_lost`, or returns).
- `adws/phases/__tests__/lostPlanGate.test.ts`: the predicate's truth table, and the park or return of `parkIfPlanLost`.
- `adws/phases/__tests__/planPhaseResume.test.ts`: `executePlanPhase` on resume. It parks on a lost plan without running the planner, and runs as before on a fresh run or a resume before `plan_created`.
- `adws/phases/__tests__/planValidationPhase.test.ts`: `executePlanValidationPhase` with a missing plan. It parks on resume and throws as before on a fresh run.
- `features/regression/step_definitions/feature-1078.steps.ts`: W-PL1 and T-PL1, the two new phrases of the regression scenario.
- `features/per-issue/step_definitions/feature-1078.steps.ts`: the hooks of the per-issue `@surface` scenarios and the four phrases only the per-issue scenarios use.
- `test/fixtures/jsonl/manifests/adw-sdlc-paused-at-build.json`: `adw-sdlc-happy.json` with the build agent answered rate-limited for the `seven_day` window.
- `test/fixtures/jsonl/manifests/surface-plan-phase-resumed.json`: `surface-plan-phase.json` with the planner writing the plan of issue 107804 for adwId `surface-1078-04`.
- `features/regression/resume/feature-1078.feature` is not new work: the alignment phase has already written it. Do not duplicate its scenario.

## Implementation Plan
### Phase 1: Foundation
Add the stage and the park reason, which have no behaviour of their own:
- `worktree_lost` in the `WorkflowStage` union, classified `human_gated`, with the exhaustiveness test extended.
- `ParkReason.WorktreeLost` with its evidence, title, description and directives.
- `parkStage(reason)`, an exhaustive reason-to-stage map that `parkWorkflow` and the park comment both read.
- `parkWorkflow` recording `parkStage(reason)`.

Existing parks still record `human_gated`, so behaviour does not change until a phase calls the gate.

### Phase 2: Core Implementation
Add `adws/phases/lostPlanGate.ts`. Its pure `planCreatedByEarlierRun(recoveryState)` reuses `shouldExecuteStage`. Its `parkIfPlanLost(config, phase)` resolves the plan path, preferring the earlier run's path from `recoveryState.planPath` over `getPlanFilePath`, logs a line to the console and the execution log, and calls `parkWorkflow` with `WorktreeLost` evidence. Then call it from the three phases that require the plan, each only on its existing "no plan" path:
- the plan phase, at the top and before the first `await`, guarded by `!planFileExists`;
- the plan-validation phase, in the `!planContent` branch;
- the build phase, in the plan-read `catch`.

The fresh-run paths (planner runs; `Cannot read plan file` is thrown) are untouched.

### Phase 3: Integration
- Exclude `worktree_lost` in the cron filter with an inline, grace-period-bypassing check.
- Let `## Retry` re-arm it to `phase_timeout`.
- Confirm `## Continue` and the takeover need no change.
- Make the scenarios pass:
  - the regression scenario `features/regression/resume/feature-1078.feature`: the worktree is removed between the plan and the build, the workflow is resumed, the recorded stage is `worktree_lost`, and there is exactly one plan-created comment;
  - the nine per-issue scenarios;
  - the four fresh-run rows tagged `@adw-1078`.
  This takes the six new phrases' step definitions, two stub manifests, the per-issue hooks and two vocabulary rows. The `## Retry` scenario is optional.
- Update the README and the conditional-docs index.

## Step by Step Tasks
Execute every step in order, top to bottom.

### 1. Add the `worktree_lost` stage and classify it
- In `adws/types/workflowTypes.ts`, add `| 'worktree_lost'` after `'human_gated'`. Give it a short comment in the style of its neighbours: a resumed workflow whose plan went with its removed worktree is parked here, it is never auto-resumed so the planner never re-runs on its own, and `## Retry` re-arms it to `phase_timeout`. Cite no issue numbers.
- In `adws/core/stageClassifier.ts`, add `case 'worktree_lost':` to the `human_gated` group (`merge_blocked`, `human_gated`, `review_failed`). Leave the class table in the doc comment as it is: its `human_gated` row (cron: exclude by inline check; takeover: `spawn_fresh`) already describes the new stage.
- In `adws/core/__tests__/stageClassifier.test.ts`, add `worktree_lost: 'human_gated'` to `EXPECTED`. This extends the existing exhaustiveness test, which no longer compiles without the entry. Add `it("routes 'worktree_lost' (human_gated literal) to 'human_gated'")` to the `classifyStageString — literal delegates to classifyStage` block.

### 2. Add the `WorktreeLost` park reason and the reason-to-stage map
In `adws/forge/parkComment.ts`:
- Add `WorktreeLost = 'worktree_lost'` to `ParkReason`.
- Add `export type PlanReadingPhase = 'plan' | 'plan validation' | 'build';`.
- Add the evidence variant `{ readonly reason: ParkReason.WorktreeLost; readonly phase: PlanReadingPhase; readonly worktreePath: string; readonly planPath: string }`.
- Add `import type { WorkflowStage } from '../types/workflowTypes';` (type-only, so no cycle). Add `export type ParkStage = Extract<WorkflowStage, 'human_gated' | 'worktree_lost'>;`.
- Add a `STAGES: Readonly<Record<ParkReason, ParkStage>>` that maps every existing reason to `'human_gated'` and `WorktreeLost` to `'worktree_lost'`. Export `parkStage(reason: ParkReason): ParkStage`. A one-line comment may say why only this park has a stage of its own: the state, and so the cron, shows that the plan is gone without reading the park reason.
- Add `TITLES[ParkReason.WorktreeLost]`: `'The Plan Was Lost with the Worktree'`.
- Add a `parkDirectives` case for `WorktreeLost`, distinct from every other reason's:
  - `retry`: `'re-runs the workflow under the same ADW ID and parks the issue again if the plan is still not in the worktree, because ADW never re-runs the planner on its own'`
  - `continue`: ``'waives nothing, because no phase after the plan can run without it: to start the issue over with a new plan, use `## Cancel`, which clears the workflow and re-queues the issue'``
  - Neither text may form a line that `RETRY_COMMENT_PATTERN`, `ACTIONABLE_COMMENT_PATTERN` or `CANCEL_COMMENT_PATTERN` matches. Inline backticked mentions inside the bullet line are fine.
- Add a `describeFailure` case built by a small `describeLostPlan(evidence)`. It names the phase, the plan path and the worktree path in `inlineCode`, for example: "The `<phase>` phase of this resumed run found no plan at `<planPath>` in the worktree `<worktreePath>`. An earlier run of this workflow wrote the plan there, but a plan is never committed: it lived only in that run's worktree, which was removed, and the worktree rebuilt for this run has none. ADW does not run the planner again on its own, because a second plan would be written against a branch that may already hold part of the build."
- `baseBranchNote` returns `null` for the new reason through its existing `default`; no change.
- Make `describeParking` stage-aware: `` `The workflow is parked as \`${parkStage(evidence.reason)}\`.` `` Keep the existing `checkBased` suffix logic.
- Keep the file under 300 lines (it is 231 today).

### 3. Record the reason's stage in `parkWorkflow`
- In `adws/phases/workflowPark.ts`, compute `const stage = parkStage(evidence.reason);`. Use it in the log and execution-log message (`` `Workflow parked as ${stage}: ${evidence.reason}` ``) and in `writeTopLevelState(config.adwId, { workflowStage: stage, parkReason: evidence.reason })`.
- Keep the ordering: state written before the comment is posted, then `process.exit(0)`.
- Every existing caller is unchanged and still records `human_gated`.

### 4. Create the lost-plan gate `adws/phases/lostPlanGate.ts`
- `export type LostPlanGateConfig = Pick<WorkflowConfig, 'adwId' | 'issueNumber' | 'orchestratorStatePath' | 'repoContext' | 'worktreePath' | 'recoveryState'>;`
- `export function planCreatedByEarlierRun(recoveryState: RecoveryState): boolean` returns `recoveryState.canResume && !shouldExecuteStage('plan_created', recoveryState)`. Its single comment carries the invariant: the recovery state is read once, at init, from the issue's comments, so it reflects earlier runs only and never this run's planner.
- `export function parkIfPlanLost(config: LostPlanGateConfig, phase: PlanReadingPhase): void`:
  - Guard clause first: `if (!planCreatedByEarlierRun(config.recoveryState)) return;`.
  - `planPath = config.recoveryState.planPath ?? getPlanFilePath(config.issueNumber, config.worktreePath)`. When nothing is found, `getPlanFilePath` falls back to the legacy name, so the earlier run's path from its plan-created comment is preferred.
  - Log and `AgentStateManager.appendLog` one line naming the phase, the plan path and the worktree, as `applicationTypeGate.ts`'s `recordLine` does.
  - Call `parkWorkflow(config, { reason: ParkReason.WorktreeLost, phase, worktreePath: config.worktreePath, planPath })`, which never returns.
- A doc comment states the contract: it is called only by a phase that has already found no plan. A run that has not planned yet, a fresh run among them, returns, and the caller plans or fails as it always has.
- Import from `'../core'` (`log`, `AgentStateManager`, `shouldExecuteStage`, `type RecoveryState`), `'../agents'` (`getPlanFilePath`), `'../forge/parkComment'` and `'./workflowPark'`. Export it from `adws/phases/index.ts` only if other modules need it; the phases import it directly.

### 5. Plan phase: park in the resume branch, before the first `await`
- In `adws/phases/planPhase.ts`, import `parkIfPlanLost` from `./lostPlanGate`.
- Immediately after the destructuring and `phaseStartTime`, and before `await repoContext.issueTracker.moveToStatus(...)`, add `if (!planFileExists(issueNumber, worktreePath)) parkIfPlanLost(config, 'plan');`. Add a one-line ordering comment: before the first `await`, so in a parallel group with the scenario phase the park ends the process before that phase has started.
- Leave the planner condition (`shouldExecuteStage('plan_created', recoveryState) && !planFileExists(...)`) and everything below it unchanged. On a fresh run, or a resume before `plan_created`, the gate returns and the planner runs exactly as before. When the plan is present, the gate is not called.

### 6. Plan-validation phase: park instead of throwing on a resumed run
- In `adws/phases/planValidationPhase.ts`, import `parkIfPlanLost` and call `parkIfPlanLost(config, 'plan validation');` as the first statement of the existing `if (!planContent)` branch, before the `getPlanFilePath` and `throw`.
- The `shouldExecuteStage('plan_validating', …)` skip stays first, so a validation already completed in an earlier run still skips without needing the plan.

### 7. Build phase: park instead of throwing on a resumed run
- In `adws/phases/buildPhase.ts`, import `parkIfPlanLost` and call `parkIfPlanLost(config, 'build');` as the first statement of the plan-read `catch`, before `throw new Error(`Cannot read plan file at ${planPath}: ${error}`)`.
- Add nothing else: the file is at 290 lines and must stay under 300.

### 8. Cron filter: exclude `worktree_lost` without a grace period
- In `adws/triggers/cronIssueFilter.ts` `evaluateIssue`, after the `review_failed` check and before the grace-period check, add `if (resolution.stage === 'worktree_lost') return { eligible: false, reason: 'worktree_lost' };`. Give it a two-line comment in the style of its neighbours: the plan went with a removed worktree; the stage is never auto-spawned, so the planner never runs again on its own; `## Retry` re-arms it to `phase_timeout`.

### 9. `## Retry` re-arms `worktree_lost` to `phase_timeout`
- In `adws/triggers/retryHandler.ts`, widen `RetryAction`'s `rearm_phase_timeout` `from` to `'human_gated' | 'review_failed' | 'worktree_lost'`. In `decideRetryAction`, add `if (stage === 'worktree_lost') return { kind: 'rearm_phase_timeout', from: 'worktree_lost' };` after the `review_failed` line.
- Update the header comment's list of recovery paths: `worktree_lost → phase_timeout` re-arms `resumeAttempts` to 0, and the resumed run parks again while the plan is missing.
- `handleRetryDirective` already writes `{ workflowStage: 'phase_timeout', resumeAttempts: 0 }` and logs `from`; nothing else changes.

### 10. Unit tests: park reason, park stage and `parkWorkflow`
- `adws/forge/__tests__/parkComment.helpers.ts`: add `SAMPLE[ParkReason.WorktreeLost]` with phase `'build'`, an absolute worktree path such as `'/srv/adw/.worktrees/feature-issue-42-widget'`, and a plan path such as `'specs/issue-42-adw-k3x9ab-feat-park-comment-sdlc_planner-widget.md'`.
- `adws/forge/__tests__/parkComment.structure.test.ts`:
  - Change "says that the workflow is parked as human_gated" to say the workflow is parked as the stage the reason records: ``expect(comment).toContain(`\`${parkStage(reason)}\``)``.
  - Add a test that `parkStage` is `human_gated` for every reason except `WorktreeLost`, which is `worktree_lost`.
  - Add `ParkReason.WorktreeLost` to "carries no base-branch note".
  - Change the distinct-directives expectation to `REASONS.length` (6).
  - Add a `parkDirectives` test for `worktree_lost`: Retry re-runs under the same ADW ID and parks again while the plan is missing; Continue `waives nothing` and names `` `## Cancel` ``.
- `adws/forge/__tests__/parkComment.content.test.ts`: add a `describe('buildParkComment — a plan lost with the worktree')`. It names the phase, the plan path and the worktree path as code spans, and says the plan is never committed and ADW does not run the planner again. Assert `extractPlanPathFromComment` of the comment is irrelevant to recovery: `parseWorkflowStageFromComment(comment)` is `null`.
- `adws/phases/__tests__/workflowPark.test.ts`:
  - Add a `WorktreeLost` evidence constant.
  - Add tests that a `worktree_lost` park records `{ workflowStage: 'worktree_lost', parkReason: 'worktree_lost' }`, has written that stage by the time the comment is posted, names `worktree_lost` in the execution log, posts exactly `buildParkComment(adwId, evidence)`, and exits 0.
  - Add it to "parks for every reason the builder knows".
  - Add `decideRetryAction('worktree_lost')` → `{ kind: 'rearm_phase_timeout', from: 'worktree_lost' }` next to the existing re-arm invariant.
  - The existing `human_gated` expectations stay as they are.

### 11. Unit tests: gate, phases and triggers
- `adws/phases/__tests__/lostPlanGate.test.ts` (new):
  - `planCreatedByEarlierRun` truth table:
    - false for a fresh state (`detectRecoveryState([])`, `canResume: false`);
    - false for a resume whose last completed stage is `branch_created` or `plan_building`;
    - true for `plan_created`, `planFile_created`, `plan_validating`, `build_running` and `build_committing`.
  - `parkIfPlanLost`, with `process.exit` spied to throw as `workflowPark.test.ts` does:
    - On a fresh state, or a resume before `plan_created`, it returns without exiting, writes no state and posts no comment.
    - On a resume past `plan_created` it exits 0, records `worktree_lost`/`worktree_lost`, and posts a park comment naming the worktree and `recoveryState.planPath`.
    - With no `planPath` in the recovery state it names `getPlanFilePath`'s path.
  - Clean `agents/<adwId>/` after each test.
- `adws/phases/__tests__/planPhaseResume.test.ts` (new), following `planPhaseCommit.test.ts`: a real temporary repository, `vi.mock('../../agents')` with a hoisted `runPlanAgent` mock, and a recording `repoContext` (`issueTracker.commentOnIssue`, `issueTracker.moveToStatus`).
  - Resumed past `plan_created`, with no plan in the worktree: rejects/exits with 0. `runPlanAgent` is never called. The top-level state is `worktree_lost`. The only recorded comment is the park comment (heading `## :raised_hand: ADW Parked — The Plan Was Lost with the Worktree`), with no `Implementation Plan Created` comment. `moveToStatus` is not called.
  - Fresh run with no plan: the planner runs once and the `plan_created` comment is posted (unchanged behaviour).
  - Resume at `branch_created` with no plan: the planner runs, and there is no park.
  - Resumed past `plan_created` with the plan present: no park, the planner is not called, and the phase completes.
- `adws/phases/__tests__/planValidationPhase.test.ts` (new): an empty temporary worktree and a minimal config (`gitContext` sufficient for `workflowLaunchContext`).
  - Resumed past `plan_created` but not past `plan_validating`, with no plan: parks `worktree_lost` (exit 0).
  - Fresh, with no plan: rejects with `Cannot read plan file` and does not exit.
  - Resumed past `plan_validating`: skips and resolves without needing the plan.
- `adws/phases/__tests__/buildPhase.test.ts`: add `describe('executeBuildPhase — a plan lost with the worktree')`. A worktree without `plan.md` and a recovery state resumed past `plan_created` parks `worktree_lost` (exit 0) and `runBuildAgent` is not called. The same worktree on the fresh `makeConfig()` recovery state rejects with `Cannot read plan file` and never calls `process.exit`. The existing tests run on a fresh state and are unaffected.
- `adws/triggers/__tests__/cronIssueFilter.eligibility.test.ts`: `worktree_lost` is ineligible with reason `worktree_lost`, and takes precedence over the grace-period check. Mirror the `human_gated skip-terminal` block.
- `adws/triggers/__tests__/retryHandler.test.ts`: `decideRetryAction('worktree_lost')` returns the re-arm. `handleRetryDirective` on a `worktree_lost` state writes `{ workflowStage: 'phase_timeout', resumeAttempts: 0 }` and returns true.
- `adws/triggers/__tests__/continueHandler.test.ts`: `decideContinueAction({ workflowStage: 'worktree_lost', parkReason: 'worktree_lost' })` is `{ kind: 'not_a_baseline_park' }`.

### 12. Scenarios, step definitions and vocabulary
The scenarios are already written; do not add or duplicate any. The scenario phase wrote ten per-issue scenarios. The alignment phase then moved one of them, the issue's regression scenario, into the regression suite, because the issue asks for a regression scenario under `features/regression/` and the per-issue sweep deletes per-issue files after the merge. Write the step definitions for all of them.

- **The scenarios, already in place:**
  - `features/regression/resume/feature-1078.feature` (`@regression @subprocess @plan-lost-on-resume`, the scenario tagged `@adw-1078`). This scenario meets the issue's acceptance criterion:
    - An SDLC run creates the plan, and a rate limit pauses it during its build.
    - Its worktree is removed, leaving its branch.
    - The orchestrator is invoked again under the same adwId, which is what `## Retry` does for a paused workflow.
    - The resumed run must exit 0 and record `worktree_lost`.
    - It must leave exactly one `Implementation Plan Created`, one `Building Implementation Plan` and one `Running Build` comment, no `ADW Workflow Error` comment, and a comment that names `worktree_lost`.
    - Today the resumed build throws, the run records `abandoned` and posts an error, so the scenario is RED.
    - In `adwSdlc` the plan phase runs on every resume (`runPhasesParallel` passes no phase name), so its gate parks the run before the scenario, alignment and build phases start.
  - `features/per-issue/feature-1078.feature`, nine scenarios:
    - **Parks `worktree_lost`** with no plan in the worktree, without posting the phase's opening comment and without starting its agent:
      - the plan phase, resumed after `plan_created`;
      - the build phase, resumed after `build_running`;
      - the plan-validation phase, driven directly and resumed after `plan_created`.
      The build and plan-validation phases read the plan before they post `build_running` or `plan_validating`, so a park in the plan-read branch posts neither.
    - **Unchanged:**
      - the plan phase resumed after `plan_created` with the plan committed: it skips the planner and does not park;
      - the plan phase resumed after `plan_building`: it runs the planner, posts `Implementation Plan Created` and does not park;
      - the build phase resumed after `build_running` with the plan committed: it builds, records `build_completed` and does not park;
      - the fresh build phase with no plan: it fails with `Cannot read plan file` and does not park.
    - **The cron** (`@dead-orchestrator-takeover`): it never relaunches a workflow at `worktree_lost` and leaves its worktree alone, while the same poll takes over a neighbour at `abandoned`. All of its phrases are feature-959's.
    - **The type check** (T22).
  - The fresh-run rows tagged `@adw-1078`: the SDLC smoke run, and surface rows 02, 04 and 33. They must pass unchanged.
- **Regression phrases**, in `features/regression/step_definitions/feature-1078.steps.ts`:
  - **W-PL1** `the worktree of the workflow for adwId {string} is removed, leaving its branch`:
    - reads `branchName` from the adwId's top-level state;
    - finds the worktree on that branch in the harness workspace with `git worktree list --porcelain`, as `worktreeOfBranch` in `feature-1077.steps.ts` does, and fails when there is none;
    - removes it with `realGit(<workspace>, 'worktree', 'remove', '--force', <path>)`;
    - asserts that the directory is gone and that `git rev-parse --verify refs/heads/<branch>` still succeeds in the workspace.
    - The resumed orchestrator rebuilds the worktree from the branch itself (`ensureWorktree` in `initializeWorkflow`), so nothing uncommitted survives, the plan included.
  - **T-PL1** `the mock GitHub API recorded exactly {int} comment(s) on issue {int} containing the text {string}`:
    - counts the recorded POSTs to `/issues/N/comments` whose JSON `body` contains the text, matching as `commentBodyContains` in `surfaceSteps.ts` does;
    - asserts the count;
    - on failure, lists the first line of each matching body.
  - **Constraints:**
    - These steps import nothing from `features/per-issue/`, which the per-issue sweep deletes after the merge.
    - The scenario needs no hook of its own: the `@regression and (@subprocess or @webhook)` hooks give it the mock server and the subprocess harness.
    - Both orchestrator runs share one harness. W1's second claim keeps the first run's state, and the gh shadow serves the first run's comments to the second, so `detectRecoveryState` resumes after `build_running`.
- **Stub manifests:**
  - `test/fixtures/jsonl/manifests/adw-sdlc-paused-at-build.json`: `adw-sdlc-happy.json`, with both build-agent commands (`/implement-tdd`, and `/implement` too) answered `{ "kind": "rate-limited", "rateLimitType": "seven_day", "resetsAt": 4102444800 }`, as `rate-limit-pause-resume.json` answers.
    - The phase runner hands a seven-day limit to the pause queue rather than waiting it out in-process, so the first run records `paused` and exits 0.
    - Every other command answers as in the happy run.
    - The second run parks before it reaches the build.
  - `test/fixtures/jsonl/manifests/surface-plan-phase-resumed.json`: `surface-plan-phase.json`, except that its `/feature` writes `specs/issue-107804-adw-surface-1078-04-sdlc_planner-surface-plan-phase.md` instead of issue 1002's plan.
- **Per-issue phrases and hooks**, in `features/per-issue/step_definitions/feature-1078.steps.ts`. They get no vocabulary row.
  - **Hooks.** The `@surface` scenarios carry no `@regression`, so the regression hooks give them no mock infrastructure and run no cleanup.
    - Add `Before`/`After` hooks keyed on `@adw-1078 and @surface and not @regression`.
    - They do what the `@regression` hooks of `features/regression/support/hooks.ts` do: `setupMockInfrastructure`, then `runCleanup`, `teardownMockInfrastructure` and the World resets. `feature-1077.steps.ts` is the prior art.
    - The cron scenario runs under feature-959's `@dead-orchestrator-takeover` hooks, and the type-check scenario needs no hook.
  - `issue {int} holds the workflow comments an earlier run of workflow {string} posted, up to the stage {string}`:
    - seeds the stage comments an earlier run under that adwId posted, from `starting` through `STAGE_ORDER` up to and including the named stage;
    - formats each with the production formatter (`formatWorkflowComment`), giving it the adwId, the worktree's branch and, from `plan_created` on, the plan path `specs/issue-<N>-adw-<adwId>-sdlc_planner-surface-plan.md`;
    - stamps them an hour ago, in stage order;
    - seeds them through the mock server's state (`mockContext.setState({ comments })`), never through recorded requests, so the zero-post Thens (T-S6) count only the resumed run's posts.
  - `the {string} phase of the {string} orchestrator runs for adwId {string}, resuming the earlier run` and `the {string} phase, which no orchestrator runs, is driven directly for adwId {string}, resuming the earlier run`:
    - run as W-S1 and W-S4 do, but with `config.recoveryState` set to `detectRecoveryState` over the comments the mock server holds for the issue;
    - get that recovery state through an optional parameter of `runSurfacePhase`/`runDirectSurfacePhase` (`features/regression/support/phaseRun.ts`), so W-S1 and W-S4 stay unchanged;
    - assert `canResume: true` first, so a seeding mistake fails here and not in a Then.
  - `the {string} phase run stopped the workflow without an error`: asserts that the recorded outcome is for that phase, did not resolve, threw no error and ended the process with exit code 0. That exit is the park's `process.exit(0)`, which `withExitTrap` records.
- **Vocabulary.** In `features/regression/vocabulary.md`, add the section `## Given/When/Then — A Plan Lost With Its Worktree on Resume (@plan-lost-on-resume)` with the rows W-PL1 and T-PL1. Mirror the prose of the `@plan-worktree-only` section:
  - the pattern (subprocess) and the harness;
  - the artefacts asserted: the state file, the recorded comment requests, the exit code, and the workspace's worktrees and branches;
  - a sentence on rot-rubric compliance;
  - the reused phrases: G18, G3, G4, W1, T1, T3, T5 and T-S6.
- **Optional:** add an `@adw-1078` scenario to `features/regression/retry-directive/feature-908.feature`, so it inherits that file's hooks. In it, `## Retry` on a workflow at `worktree_lost` re-arms it to `phase_timeout` with a resume attempt count of 0. Compose it only from the existing phrases G-RD2–G-RD5, W-RD1, T1 and T-RD11.
- No step reads a source file.

### 13. Documentation and the conditional-docs index
- `README.md`:
  - "Retry and Cancel directives" bullet: `## Retry` resets "a `human_gated`/`review_failed`/`worktree_lost` workflow to `phase_timeout`".
  - "Worktree-only plans" bullet: append that a resumed workflow finding its plan gone with a removed worktree is parked as `worktree_lost` (`adws/phases/lostPlanGate.ts`) by the plan, plan-validation or build phase, whichever reaches the plan first, instead of planning again. The park comment names the worktree and the plan; `## Retry` re-runs and parks again while the plan is missing; `## Cancel` starts the issue over with a new plan; a fresh run is unchanged.
  - `adws/phases/` tree: add `lostPlanGate.ts  # Parks a resumed workflow whose plan went with its removed worktree (worktree_lost); planCreatedByEarlierRun, parkIfPlanLost`. Add the new test files under `__tests__`. Amend the `workflowPark.ts` line so it says the reason's stage is recorded.
- `.adw/conditional_docs.md`:
  - `app_docs/feature-9gjajh-build-and-plan-phases.md` entry: add `adws/phases/lostPlanGate.ts`, `adws/phases/__tests__/lostPlanGate.test.ts`, `adws/phases/__tests__/planPhaseResume.test.ts` and `adws/phases/__tests__/planValidationPhase.test.ts` to `Owns`. Add a condition: "When a resumed workflow parks as `worktree_lost` because its plan went with a removed worktree (`parkIfPlanLost`, `planCreatedByEarlierRun`), or the planner must not run again on resume."
  - `app_docs/feature-9gjajh-test-and-scenario-phases.md` entry: mention `worktree_lost` and `parkStage` in the park-comment-builder condition.
  - `app_docs/feature-9gjajh-bdd-regression-suite.md` entry: add a condition for the new regression scenario. Name `features/regression/resume/feature-1078.feature`, `@plan-lost-on-resume`, `features/regression/step_definitions/feature-1078.steps.ts`, the phrases W-PL1 and T-PL1, and `adw-sdlc-paused-at-build.json`. Do not list per-issue files under `Owns`: the per-issue sweep deletes them.
  - Every `Owns:` glob must point at a file that exists.
- Leave the app_docs prose and any ADR to the document phase. See the Notes.

### 14. Run the validation commands
- Run every command in `Validation Commands` and fix every failure until all pass with zero regressions.

## Testing Strategy
### Unit Tests
- **Stage classifier.** `EXPECTED` gains `worktree_lost: 'human_gated'`. This is the compile-time and runtime exhaustiveness backstop, and `classifyStageString('worktree_lost')` returns `'human_gated'`.
- **Park comment** (`parkComment.structure/content.test.ts`, helpers):
  - every reason's comment states its `parkStage`;
  - `parkStage` maps only `WorktreeLost` to `worktree_lost`;
  - the new reason has no base-branch note, distinct directives (now 6), and a Continue that waives nothing and names `## Cancel`;
  - its description names the phase, the plan path and the worktree path;
  - no line of the comment is a directive, and the comment is never parsed as a lifecycle stage.
- **`parkWorkflow`.**
  - `worktree_lost` evidence records `workflowStage: 'worktree_lost'` and `parkReason: 'worktree_lost'`, before the comment is posted.
  - The execution log names it, and the process exits 0.
  - `decideRetryAction` re-arms it.
  - Existing reasons still record `human_gated`.
- **Lost-plan gate.**
  - The truth table of `planCreatedByEarlierRun`: fresh, before the plan, at the plan, and past the plan.
  - `parkIfPlanLost` returns for fresh and pre-plan states, and parks with the right evidence for post-plan resumes, preferring `recoveryState.planPath`.
- **Plan phase on resume.** It parks without running the planner and posts no plan-created comment. It does not move the board. It runs the planner unchanged on a fresh run and on a resume before `plan_created`, and it leaves a present plan alone.
- **Plan-validation and build phases.** Both park on a resumed run with no plan, and throw `Cannot read plan file` unchanged on a fresh run. Plan validation still skips when validation completed earlier.
- **Triggers.**
  - The cron excludes `worktree_lost` with reason `worktree_lost`, bypassing the grace period.
  - `## Retry` re-arms it to `phase_timeout` with `resumeAttempts: 0`.
  - `## Continue` treats it as `not_a_baseline_park`.

### BDD Scenarios
- **Regression** (`features/regression/resume/feature-1078.feature`): a real SDLC run is paused during its build, its worktree is removed and it is resumed. It records `worktree_lost`, exits 0, and posts exactly one plan-created comment and no second planner or build comment.
- **Per-issue** (`features/per-issue/feature-1078.feature`), in-process:
  - the plan, build and plan-validation phases park on a resume with no plan;
  - they go on as before with the plan present, or on a resume before `plan_created`;
  - a fresh build with no plan still fails.
  The cron scenario never relaunches `worktree_lost`, and the type check passes.
- **Fresh runs unchanged:** the SDLC smoke run and surface rows 02, 04 and 33, all tagged `@adw-1078`.

### Edge Cases
- A fresh run (`canResume: false`) whose build or plan-validation phase finds no plan still throws `Cannot read plan file` and never parks. A fresh plan phase still runs the planner.
- On a resume whose last completed stage is before `plan_created` (`classified`, `branch_created`, `plan_building`), the plan was never recorded as created. The planner runs, and the single plan-created comment it posts is the first.
- On a resume where the plan is still present (the worktree was not removed), nothing changes.
- A resume where the planner ran in this very run but the build cannot read the plan is a planner failure, not a lost worktree. The recovery state was computed at init, so it throws as before.
- A resume far past the plan (build committed, review running) whose worktree was removed parks at the plan phase as `worktree_lost`. Previously it would have thrown in the build phase and looped through `abandoned` takeovers.
- An empty plan file (size 0) on a resumed run counts as missing, because `planFileExists` requires content, and parks. On a fresh run the build phase reads it as today.
- `recoveryState.planPath` is null (no path in the comments): the park names `getPlanFilePath`'s fallback.
- In parallel orchestrators (`adwSdlc`, `adwPlanBuildReview`, `adwPlanBuildTestReview`), the plan phase parks before its first `await`, so the scenario phase never starts.
- A park comment that cannot be posted, or no `repoContext`: the state is still `worktree_lost` and the process exits 0 (existing `parkWorkflow` behaviour).
- `## Retry` on `worktree_lost` re-arms to `phase_timeout`. The takeover resumes, and the run parks again while the plan is missing; it never re-plans. `## Retry` on `human_gated` and `review_failed` is unchanged.
- The cron never relaunches `worktree_lost`, even within the grace period. A webhook-driven `spawn_fresh` relaunch resumes and re-parks without re-planning.
- A paused workflow whose worktree was removed is not resumed by the pause-queue scanner: `resumeWorkflow` posts an error and leaves it paused. `## Retry` respawns it under the same adwId, and the respawned run parks as `worktree_lost` instead of throwing. The regression scenario covers this respawn.
- The park comment contains the plan path in backticks, but `detectRecoveryState` ignores it because its heading is not a lifecycle stage.

## Acceptance Criteria
- The `@regression` scenario `features/regression/resume/feature-1078.feature` passes. Its SDLC run creates the plan and is paused during its build, the worktree is removed, and the workflow is resumed. The top-level state then records `workflowStage` `worktree_lost`, and the issue has exactly one `Implementation Plan Created` comment, so there is no second plan.
- `worktree_lost` is a `WorkflowStage` literal, classified `human_gated` by `classifyStage`. The existing exhaustiveness test (`Record<WorkflowStage, StageClass>` in `adws/core/__tests__/stageClassifier.test.ts`) is extended with it and passes.
- A resumed workflow whose plan was created by an earlier run and is missing parks as `worktree_lost` from the plan, plan-validation or build phase. The park comment is headed `ADW Parked — The Plan Was Lost with the Worktree` and names the worktree path and the plan path. The planner is not called.
- A fresh, non-resumed run is unchanged: the planner runs, and the build and plan-validation phases throw `Cannot read plan file` on a missing plan, without parking. Unit tests cover this, as do the fresh-run regression rows tagged `@adw-1078` and the per-issue fresh-build scenario.
- The cron excludes `worktree_lost`. `## Retry` re-arms it to `phase_timeout`. All existing parks still record `human_gated`.
- The unit suite, the type checks (`bunx tsc --noEmit`, `bunx tsc --noEmit -p adws/tsconfig.json`), lint, build, the docs-index gate, the `@adw-1078` scenarios and the `@regression` suite are all green.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint`: lints the code.
- `bunx tsc --noEmit`: type check; covers the `never` guard in `classifyStage` and the `Record<WorkflowStage, …>`/`Record<ParkReason, …>` maps.
- `bunx tsc --noEmit -p adws/tsconfig.json`: the additional type check of `adws/`.
- `bun run build`: builds with no errors.
- `bunx vitest run adws/core/__tests__/stageClassifier.test.ts adws/forge/__tests__/parkComment.structure.test.ts adws/forge/__tests__/parkComment.content.test.ts adws/phases/__tests__/workflowPark.test.ts adws/phases/__tests__/lostPlanGate.test.ts adws/phases/__tests__/planPhaseResume.test.ts adws/phases/__tests__/planValidationPhase.test.ts adws/phases/__tests__/buildPhase.test.ts adws/triggers/__tests__/retryHandler.test.ts adws/triggers/__tests__/cronIssueFilter.eligibility.test.ts adws/triggers/__tests__/continueHandler.test.ts`: the focused unit tests for this feature.
- `bun run test:unit`: the full unit suite, with zero regressions.
- `bun run lint:docs-index`: the conditional-docs index stays clean after the `Owns`/condition edits.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-1078"`: all 14 of the issue's scenarios. They are the regression scenario, the nine per-issue scenarios, and the four fresh-run regression rows. A dry run before this feature lists six undefined phrases; none may remain.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@plan-lost-on-resume"`: the new regression feature by its tag.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"`: the whole BDD regression suite, with zero regressions (including `@plan-worktree-only`, `@retry-directive`, `@dead-orchestrator-takeover` and the surface rows). The suite holds 350 scenarios, one more than before because of the new resume scenario.

## Notes
- Strictly follow `.adw/coding_guidelines.md`:
  - files under 300 lines (`buildPhase.ts` is at 290, so add only the import and the call);
  - guard clauses (`if (!planCreatedByEarlierRun(...)) return;`);
  - enums for named constants (`ParkReason.WorktreeLost`);
  - comments only for invariants and ordering: the plan-phase "before the first `await`" ordering, and "the recovery state reflects earlier runs only";
  - no issue numbers in code comments;
  - no `any`, and no `!` assertions.
- No new library is needed.
- Why a stage of its own, and not `human_gated` plus a `parkReason`: the acceptance criteria require the recorded stage to be the new park reason and the exhaustive classifier to cover it. ADR-0036 already models human-gated outcomes as distinct literals in one class (`merge_blocked`, `human_gated`, `review_failed`). `parkStage` keeps one park path, so all other parks still record `human_gated`, and `## Continue`'s baseline waiver, which reads `workflowStage === 'human_gated'`, is unaffected.
- The issue says "the plan phase re-runs the planner when the file is absent". In today's code the planner runs on a resume only when `plan_created` was not yet completed, which is correct, since no plan was recorded. The plan-phase change therefore makes the resume branch park instead of silently passing a missing plan on to the alignment and build phases. It also makes "never re-plan once an earlier run created the plan" an explicit, tested rule rather than an accident of `shouldExecuteStage`.
- Deliberately unchanged:
  - The alignment phase already skips on a missing plan and never throws. In every orchestrator that runs it, the plan phase parks first.
  - `adwBuild.tsx`'s pre-flight check (`Plan file not found … Run adwPlan.tsx first`) runs before the lifecycle lock and before the build phase. It never plans, so it is left as is and the build-phase gate is unreachable there. Folding it into the gate is a possible follow-up.
  - `adwMerge.tsx` and `autoMergePhase.ts` already tolerate a missing plan.
- The deliberate restart that user story 19 asks for is `## Cancel`, which kills the orchestrator, removes the worktrees, deletes the state, clears the comments and re-queues the issue, followed by a fresh run with a new plan. `## Retry` resumes under the same ADW ID and parks again unless an operator has put the plan back into the rebuilt worktree. A dedicated "re-plan this workflow" directive is out of scope.
- `parkDirectives`' doc comment says each directive's meaning comes from the park's decision record. The PRD's follow-up ADR, the lifetime split of `specs/` versus `docs/`, is the natural place to record what `## Retry`, `## Continue` and `## Cancel` mean for `worktree_lost`. Leave that and the app_docs prose to the document phase and the `write-an-adr` skill.
- The scenario writer routes its output to `features/per-issue/` and never promotes a scenario to the regression suite on its own. The issue explicitly asks for a regression scenario under `features/regression/`, and per-issue files are deleted 14 days after the merge. So the alignment phase moved the worktree-removed resume scenario, unchanged, to `features/regression/resume/feature-1078.feature` and tagged it `@regression @subprocess @plan-lost-on-resume`.
  - That scenario replaces the in-process chore scenario and the fresh-run regression scenario this plan first drafted. The per-issue scenarios and the four tagged fresh-run rows already cover both, so writing them would duplicate coverage.
  - Its steps and vocabulary rows (W-PL1, T-PL1) must live in the regression suite.
