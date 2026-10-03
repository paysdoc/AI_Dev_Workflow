@adw-964 @adw-n5cfq2-bug-move-the-test-re
Feature: The test, review, alignment and diff-evaluation surface rows run in-process on the phase harness, each phase as an orchestrator that runs it in production, and assert what the phase produces

  Issue #964 moves eleven rows of `features/regression/surfaces/` onto the in-process phase
  harness that #963 built (`features/regression/support/phaseRun.ts`): rows 06, 07, 08, 09, 15,
  20, 21, 22, 23, 33 and 34. Each row keeps its file, its number and its `@regression @surface`
  tags. Item 3 of the `## Divergence` section of ADR-0037 stays open until the last slice.

  ── WHAT THE CODE DOES ──────────────────────────────────────────────────────────────────────
  Checked on 2026-10-03 against `adws/*.tsx` and the phases, and by running each phase through
  `runPhase` in-process against the cli-tool fixture worktree that G11 makes, the mock forge and
  the Claude CLI stub. Each phase run took well under a second, the worktree set-up aside. Where
  these facts differ from the issue's table, the scenarios follow the code.
    1. adwTest runs one phase: the unit test phase, under the phase name `test`. The scenario
       test, scenario proof and scenario fix phases run inside `runScenarioTestFixLoop`, which
       adwSdlc, adwChore, adwPlanBuildTest, adwPlanBuildTestReview and adwPrReview call. So
       rows 21, 22 and 23, which name adwTest, are retitled as well.
    2. There is no adwReview. The review phase is run by adwSdlc, adwChore, adwPlanBuildReview,
       adwPlanBuildTestReview and adwPrReview; the alignment phase by adwSdlc,
       adwPlanBuildReview and adwPlanBuildTestReview, not adwChore; the diff evaluation phase by
       adwChore alone. No orchestrator runs the plan validation phase: `adws/workflowPhases.ts`
       exports it and nothing calls it.
    3. adwTest's unit test phase is the only one of these phases whose caller gives `runPhase` a
       phase name. Every other caller gives none, so those runs record no stage, and the
       top-level state keeps the stage W-S1 seeds, `starting`.
    4. The fixture has no `.github/adw.yml`, so unit tests are enabled. Their JUnit report path
       lies in the logs directory, outside the worktree, where the stub may not write, so the
       verdict is always "unverified": the phase applies the label `adw:unverified` and posts
       "## :warning: ADW Unverified — No JUnit Report Emitted". Today `mockForgeProviders`
       refuses `applyLabel`, the phase swallows that error, and neither the label nor the
       comment is recorded. The phase still returns, and adwTest's run records `test_completed`.
    5. A rejected review is an outcome, not an error: the review phase run resolves, having
       posted "## :mag: Review Running" and "## :x: Review Failed". A review is rejected only
       when it reports `success: false` and lists a blocker. One that reports `success: true`
       passes, whatever it lists.
    6. The stub cuts a result's text at 500 characters. The review JSON of
       `test/fixtures/jsonl/manifests/review-mixed-blockers.json` reaches the review agent cut
       short, and the agent gives up with an OutputValidationError.
    7. The diff evaluation phase diffs `main...HEAD`. On a branch with no change it records
       `safe`, "No changes detected in diff — nothing to regress.", without asking
       `/diff_evaluator`. Only a branch that carries a change reaches the agent, and the phase
       posts the agent's verdict and reason in its "## Diff Evaluation" comment. When the agent
       fails, the phase posts its fail-safe, `regression_possible`, with a reason of its own, so
       only the agent's reason shows that the agent's answer was used.
    8. The scenario test phase posts no comment. The fixture holds no step definitions, so the
       scenario proof runs no tag and records no blocker failure. Given a step definition under
       `features/step_definitions/`, the proof runs the fixture's one tag, `@review-proof`, a
       required blocker in its `.adw/review_proof.md`, with the fixture's
       `## Run Scenarios by Tag` command. That command sits inside a sh code fence, which ADW
       keeps: the shell runs the fence's backticks as a command substitution, then tries to run
       "1 scenario (1 passed)" as a command, and exits 127. The proof records `@review-proof`
       as a failed blocker, and the phase still succeeds. So the fixture's echo scenario
       commands never echo. The python-flat fixture carries the same fences.
    9. The scenario fix phase logs a resolve agent's failure and goes on; it fails only when its
       commit agent fails. When a manifest's top-level response is the error response, every
       agent call fails, and the run fails with "Commit agent 'scenario-fix-agent' (…) failed".
   10. The alignment and plan validation phases need a plan file and a `.feature` file in the
       worktree that holds the issue's `@adw-<issue>` tag. The fixture has neither. Without the
       scenario file both phases skip and post nothing. Without a plan, plan validation throws
       "Cannot read plan file at specs/issue-<issue>-plan.md" and alignment skips. With both,
       alignment posts "## :arrows_counterclockwise: Aligning Plan and Scenarios" and then
       "Implementation plan and BDD scenarios have been aligned." under the heading
       "## :white_check_mark: Plan and Scenarios Aligned". Plan validation posts
       "## :mag: Validating Plan-Scenario Alignment" and then "Implementation plan and BDD
       scenarios are aligned." under the same heading.
   11. G13 is registered, but it has no step definition and its fixture directory,
       `test/fixtures/scenarios/promotion/`, does not exist. No registered Given puts a scenario
       for the issue into a worktree, so G-S3 is added. None gives the worktree a step
       definition, so G-S4 is added.

  The scenarios drive each phase as one orchestrator that runs it in production, and the rows
  can follow them:
    • rows 06 and 20: the unit test phase of adwTest, under the phase name `test`;
    • rows 07 and 08: the review phase of adwSdlc. Row 15 stays adwChore's, under the issue
      type /chore;
    • row 09: the diff evaluation phase of adwChore;
    • rows 21 and 22: the scenario test phase of adwSdlc, which runs the scenario proof;
    • row 23: the scenario fix phase of adwSdlc;
    • row 33: the plan validation phase, driven directly because no orchestrator runs it, which
      the row's description says;
    • row 34: the alignment phase of adwSdlc.

  The labels below are the section numbers of the scenario groups further down (§1–§5):

    §1  THE ELEVEN ROWS PASS IN-PROCESS (AC1, AC3). Cucumber runs the surface scenarios twice in
        a row. Each of the eleven rows passes on both runs in under 5 seconds, and so does each
        of the six rows #963 moved. Today the eleven are pending at W1.

    §2  A PHASE RUNS ONLY AS AN ORCHESTRATOR THAT RUNS IT. W-S1 refuses a phase under an
        orchestrator that does not run it in production, or that does not exist, so no row can
        claim a wiring that production lacks. W-S4 drives directly only a phase that no
        orchestrator runs.

    §3  EACH PHASE PRODUCES WHAT THE CODE PRODUCES. One throwaway regression scenario per path,
        built from the phrases a row uses and run under the @regression hooks, pins each fact
        above.

    §4  NO MANIFEST WRITES WHAT A THEN STEP READS (AC2). The refusal guard refuses none of the
        manifests committed under `test/fixtures/jsonl/manifests/`, the new surface manifests
        among them.

    §5  BACKSTOP. Type-check.

  Each scenario is written to fail for a specific wrong implementation:
    • §1 fails while any of the eleven rows is pending or failing or takes 5 seconds or more,
      and when the change breaks one of the six rows #963 moved;
    • each §2 refusal fails for a W-S1 that runs that phase under that orchestrator; the W-S4
      refusal fails for a W-S4 that runs any phase it is given;
    • the unit test row fails for a run under no phase name or under another one, and for a
      mock forge that still refuses `applyLabel`;
    • the rows that read the stage `starting` fail for a run under a phase name;
    • the rejected-review row fails for a harness that turns a rejection into a failed run, and
      for a review JSON the stub cut short;
    • the diff row over a change fails when the agent is not asked or its answer is not used;
      the one over no change fails when it is asked;
    • the scenario test rows fail for a W-S1 that does not keep the scenario proof, and the
      second fails when the proof finds no step definition;
    • the scenario fix row fails for a run that fails for another reason, such as a missing
      scenario proof;
    • the alignment and plan validation rows over a plan and a scenario fail when the scenario
      file is missing, since both phases then skip without a word. The plan-only alignment row
      pins that skip, and the no-plan validation row pins the failure a missing plan causes.

  ── WHY SOME CRITERIA GET NO SCENARIO OF THEIR OWN ──────────────────────────────────────────
  A row's Feature and Scenario titles are text. A scenario could check that they name the right
  orchestrator only by reading the row files, which the rot-prevention rule forbids; §2 is the
  behavioural counterpart. AC2, that no row asserts on a file its own manifest wrote, is also a
  property of the rows' text. Its behavioural counterparts are §4 and the Then steps the rows
  use: each reads the top-level state, which the refusal guard stops a manifest from writing,
  the requests the mock GitHub API recorded, or the outcome and scenario proof that W-S1 and
  W-S4 keep in memory. The rest of AC3, that every scenario passing on `dev` still passes, needs
  a whole-suite comparison before and after the change, which belongs to the plan's validation
  commands. The vocabulary entries are documentation; no scenario reads the registry.

  Notes for the step definitions:
    • The per-issue phrases come from feature-963. Its step definitions keep their state on the
      World (`feature-963-state.ts`), and its hooks are keyed on its own tag. Key this feature's
      hooks on `@adw-n5cfq2-bug-move-the-test-re`, never on `@adw-964`, and run the World's
      cleanup list after each scenario, as `feature-963-state.ts` does for its tag, so the
      temporary directories of the child runs are removed.
    • The throwaway scenarios run in a child Cucumber process under the @regression hooks, so
      their phrases resolve to the regression step library, exactly as the rows' phrases do.
      Their adwIds have the form `surface-96NN`, which W-S1 accepts and whose `agents/<adwId>/`
      it clears. Each row file keeps one scenario, which §1 expects.
    • W-S1 gains these orchestrator and phase pairs: unit test of `test`, under the phase name
      `test`; review of `sdlc` and of `chore`; diff evaluation of `chore`; scenario test,
      scenario fix and alignment of `sdlc`. All but the first run under no phase name. The
      `chore` config carries the issue type /chore. The review run gives `executeReviewPhase`
      an empty scenario proof path. The scenario fix run needs a ScenarioProofResult: the
      harness hands it the proof the scenario test phase leaves over the fixture, with
      `@review-proof` failed with exit code 127, the only kind of proof
      `runScenarioTestFixLoop` hands it. Any proof would do for the error row. W-S1 refuses
      every other pair before it builds a config.
    • W-S1 keeps the scenario proof the phase leaves on the workflow context
      (`config.ctx.scenarioProof`, set by the scenario test phase to the proof it returns) as
      `World.scenarioProofResult`, which T-PY3, T-S11 and T-S12 read.
    • W-S4 runs, through `runPhase` and under no phase name, only a phase that no orchestrator
      runs: today the plan validation phase. It refuses any other phase.
    • `mockForgeProviders` gains `applyLabel` and nothing else. Through `dispatchMockRequest`,
      as `commentOnIssue` does, it records `POST /repos/acme/widgets/issues/<n>/labels` with
      the body `{"labels":[<label>]}`, which T12 reads.
    • G-S3 commits `features/feature-<issue>.feature`, tagged `@adw-<issue>`, in the fixture's
      `## Scenario Directory`, `features/`; `findScenarioFiles` searches the whole worktree.
      G-S4 commits a `.ts` file under `features/step_definitions/`, the step definition
      directory that the fixture's `.adw/scenarios.md` leaves at its default.
    • The new manifests sit under `test/fixtures/jsonl/manifests/`. Each answers its command
      through a `byCommand` entry, as `surface-plan-phase.json` does, with a result text under
      500 characters:
        – `surface-unit-test-phase.json`: /test, a JSON array holding one passing test result;
        – `surface-review-phase.json`: /review, `success: true` and no review issue;
        – `surface-review-phase-rejected.json`: /review, `success: false` and one blocker;
        – `surface-diff-evaluation-phase.json`: /diff_evaluator, the verdict `safe` and the
          reason "The surface diff adds only a plan file.";
        – `surface-scenario-fix-phase-error.json`: the error response at the top level, so
          every agent call fails;
        – `surface-alignment-phase.json`: /align_plan_scenarios, `aligned: true`, no warning
          and no change;
        – `surface-plan-validation-phase.json`: /validate_plan_scenarios, `aligned: true` and
          no mismatch.
    • T-S10 holds when T-S2 holds and the error's message contains the text.

  Vocabulary note. These registered phrases are reused: G3, G4, G11, G18, G-S1, W-S1, T1, T3,
  T12, T14, T22, T-S1, T-S6 and T-PY3 (`the scenario proof records no blocker failures`). The
  registry has no phrase for the following, so these regression phrases are new. They appear
  inside the throwaway scenarios and are to be registered under "Surface phases and lifecycles":
    • G-S3 `the worktree for adwId {string} has a scenario for issue {int} committed on its branch`
    • G-S4 `the worktree for adwId {string} has step definitions committed on its branch`
    • W-S4 `the {string} phase, which no orchestrator runs, is driven directly for adwId {string}`
    • T-S10 `the {string} phase run failed with an error that names {string}`
    • T-S11 `the scenario proof ran no tag`
    • T-S12 `the scenario proof records a blocker failure for the tag {string}`
  The per-issue phrases outside the throwaway scenarios are feature-963's: the throwaway
  regression scenario and its verdicts, the two surface runs, the per-row table, the
  temporary-directory check and the manifest sweep.

  Background:
    Given the ADW codebase is checked out

  # ── §1 THE ELEVEN ROWS PASS IN-PROCESS ──────────────────────────────────────────────────────

  @adw-964 @adw-n5cfq2-bug-move-the-test-re
  Scenario: The eleven test, review, alignment and diff-evaluation surface rows pass on two Cucumber runs in a row, each in under 5 seconds, and the six rows #963 moved still do
    When the regression suite's surface scenarios are run through Cucumber twice in a row
    Then each of these surface rows passes on both runs, in under 5 seconds each time:
      | row                                                        |
      | row-06-adwBuild-unitTestPhase-happy.feature                |
      | row-07-adwReview-reviewPhase-happy.feature                 |
      | row-08-adwReview-reviewPhase-error-review-rejected.feature |
      | row-09-adwReview-diffEvaluationPhase-happy.feature         |
      | row-15-adwChore-reviewPhase-happy.feature                  |
      | row-20-adwTest-unitTestPhase-happy.feature                 |
      | row-21-adwTest-scenarioTestPhase-happy.feature             |
      | row-22-adwTest-scenarioProof-happy.feature                 |
      | row-23-adwTest-scenarioFixPhase-error.feature              |
      | row-33-adwReview-planValidationPhase-happy.feature         |
      | row-34-adwReview-alignmentPhase-happy.feature              |
    And each of these surface rows passes on both runs, in under 5 seconds each time:
      | row                                                    |
      | row-02-adwPlan-planPhase-happy.feature                 |
      | row-03-adwPlan-planPhase-error-stub-failure.feature    |
      | row-04-adwBuild-buildPhase-happy.feature               |
      | row-05-adwBuild-buildPhase-edge-missing-lock.feature   |
      | row-31-adwPlan-orchestratorLock-acquired-happy.feature |
      | row-32-adwBuild-orchestratorLock-re-entry-edge.feature |
    And neither run left a git repository in its temporary directory

  # ── §2 A PHASE RUNS ONLY AS AN ORCHESTRATOR THAT RUNS IT ────────────────────────────────────

  @adw-964 @adw-n5cfq2-bug-move-the-test-re
  Scenario Outline: Under the @regression hooks, W-S1 refuses to run the <phase> phase as the "<orchestrator>" orchestrator, because <reason>
    Given a throwaway regression scenario with the steps:
      """
      Given an issue 9650 exists in the mock issue tracker
      And the worktree for adwId "surface-9650" is initialised at branch "surface-9650"
      When the "<phase>" phase of the "<orchestrator>" orchestrator runs for adwId "surface-9650"
      """
    When the throwaway regression scenario is run through Cucumber
    Then the throwaway regression scenario fails at the step 'the "<phase>" phase of the "<orchestrator>" orchestrator runs for adwId "surface-9650"'

    Examples:
      | phase           | orchestrator | reason                                                      |
      | unit test       | build        | adwBuild runs only its install and build phases             |
      | scenario test   | test         | adwTest runs only its unit test phase                       |
      | scenario fix    | test         | adwTest runs only its unit test phase                       |
      | review          | review       | there is no adwReview orchestrator                          |
      | alignment       | chore        | adwChore runs no alignment phase                            |
      | diff evaluation | sdlc         | adwChore is the only orchestrator that evaluates a diff     |
      | plan validation | sdlc         | no orchestrator runs the plan validation phase              |

  @adw-964 @adw-n5cfq2-bug-move-the-test-re
  Scenario: Under the @regression hooks, W-S4 refuses to run the review phase directly, since five orchestrators, adwSdlc among them, run it
    Given a throwaway regression scenario with the steps:
      """
      Given an issue 9651 exists in the mock issue tracker
      And the worktree for adwId "surface-9651" is initialised at branch "surface-9651"
      When the "review" phase, which no orchestrator runs, is driven directly for adwId "surface-9651"
      """
    When the throwaway regression scenario is run through Cucumber
    Then the throwaway regression scenario fails at the step 'the "review" phase, which no orchestrator runs, is driven directly for adwId "surface-9651"'

  # ── §3 EACH PHASE PRODUCES WHAT THE CODE PRODUCES ───────────────────────────────────────────

  @adw-964 @adw-n5cfq2-bug-move-the-test-re
  Scenario: Under the @regression hooks, adwTest's unit test phase runs under the phase name "test", records test_completed, and marks the issue unverified, because the stub emits no JUnit report
    Given a throwaway regression scenario with the steps:
      """
      Given an issue 9652 exists in the mock issue tracker
      And the worktree for adwId "surface-9652" is initialised at branch "surface-9652"
      And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/surface-unit-test-phase.json"
      When the "unit test" phase of the "test" orchestrator runs for adwId "surface-9652"
      Then the "unit test" phase run succeeded
      And the state file for adwId "surface-9652" records workflowStage "test_completed"
      And the mock GitHub API recorded an application of the "adw:unverified" label on issue 9652
      And the mock GitHub API recorded a comment containing the text "## :warning: ADW Unverified — No JUnit Report Emitted"
      """
    When the throwaway regression scenario is run through Cucumber
    Then the throwaway regression scenario passes

  @adw-964 @adw-n5cfq2-bug-move-the-test-re
  Scenario Outline: Under the @regression hooks, the review phase, as the "<orchestrator>" orchestrator runs it, posts the review-running and review-passed comments for a review with no blocker, posts no review-failed comment, and records no stage
    Given a throwaway regression scenario with the steps:
      """
      Given an issue <issue> exists in the mock issue tracker
      And the worktree for adwId "surface-<issue>" is initialised at branch "surface-<issue>"
      And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/surface-review-phase.json"
      When the "review" phase of the "<orchestrator>" orchestrator runs for adwId "surface-<issue>"
      Then the "review" phase run succeeded
      And the mock GitHub API recorded a comment containing the text "## :mag: Review Running"
      And the mock GitHub API recorded a comment containing the text "## :white_check_mark: Review Passed"
      And the mock harness recorded zero comment posts on issue <issue> containing the text "## :x: Review Failed"
      And the state file for adwId "surface-<issue>" records workflowStage "starting"
      """
    When the throwaway regression scenario is run through Cucumber
    Then the throwaway regression scenario passes

    Examples:
      | orchestrator | issue |
      | sdlc         | 9653  |
      | chore        | 9654  |

  @adw-964 @adw-n5cfq2-bug-move-the-test-re
  Scenario: Under the @regression hooks, adwSdlc's review phase posts the review-failed comment and no review-passed comment for a review that reports success false and a blocker, and its run still succeeds, since a rejected review is an outcome and not an error
    Given a throwaway regression scenario with the steps:
      """
      Given an issue 9655 exists in the mock issue tracker
      And the worktree for adwId "surface-9655" is initialised at branch "surface-9655"
      And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/surface-review-phase-rejected.json"
      When the "review" phase of the "sdlc" orchestrator runs for adwId "surface-9655"
      Then the "review" phase run succeeded
      And the mock GitHub API recorded a comment containing the text "## :mag: Review Running"
      And the mock GitHub API recorded a comment containing the text "## :x: Review Failed"
      And the mock harness recorded zero comment posts on issue 9655 containing the text "## :white_check_mark: Review Passed"
      """
    When the throwaway regression scenario is run through Cucumber
    Then the throwaway regression scenario passes

  @adw-964 @adw-n5cfq2-bug-move-the-test-re
  Scenario: Under the @regression hooks, adwChore's diff evaluation phase, over a branch that carries a change, posts the verdict and the reason the /diff_evaluator agent gave in its Diff Evaluation comment, and records no stage
    Given a throwaway regression scenario with the steps:
      """
      Given an issue 9656 exists in the mock issue tracker
      And the worktree for adwId "surface-9656" is initialised at branch "surface-9656"
      And the worktree for adwId "surface-9656" has the plan for issue 9656 committed on its branch
      And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/surface-diff-evaluation-phase.json"
      When the "diff evaluation" phase of the "chore" orchestrator runs for adwId "surface-9656"
      Then the "diff evaluation" phase run succeeded
      And the mock GitHub API recorded a comment containing the text "## Diff Evaluation"
      And the mock GitHub API recorded a comment containing the text "`safe`"
      And the mock GitHub API recorded a comment containing the text "**Reason:** The surface diff adds only a plan file."
      And the state file for adwId "surface-9656" records workflowStage "starting"
      """
    When the throwaway regression scenario is run through Cucumber
    Then the throwaway regression scenario passes

  @adw-964 @adw-n5cfq2-bug-move-the-test-re
  Scenario: Under the @regression hooks, adwChore's diff evaluation phase, over a branch with no change, records the verdict safe without asking the /diff_evaluator agent
    Given a throwaway regression scenario with the steps:
      """
      Given an issue 9657 exists in the mock issue tracker
      And the worktree for adwId "surface-9657" is initialised at branch "surface-9657"
      And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/surface-diff-evaluation-phase.json"
      When the "diff evaluation" phase of the "chore" orchestrator runs for adwId "surface-9657"
      Then the "diff evaluation" phase run succeeded
      And the mock GitHub API recorded a comment containing the text "`safe`"
      And the mock GitHub API recorded a comment containing the text "No changes detected in diff — nothing to regress."
      And the mock harness recorded zero comment posts on issue 9657 containing the text "The surface diff adds only a plan file."
      """
    When the throwaway regression scenario is run through Cucumber
    Then the throwaway regression scenario passes

  @adw-964 @adw-n5cfq2-bug-move-the-test-re
  Scenario: Under the @regression hooks, adwSdlc's scenario test phase over the cli-tool fixture as committed finds no step definitions, so its scenario proof runs no tag and records no blocker failure, and the phase succeeds without posting a comment
    Given a throwaway regression scenario with the steps:
      """
      Given an issue 9658 exists in the mock issue tracker
      And the worktree for adwId "surface-9658" is initialised at branch "surface-9658"
      When the "scenario test" phase of the "sdlc" orchestrator runs for adwId "surface-9658"
      Then the "scenario test" phase run succeeded
      And the scenario proof ran no tag
      And the scenario proof records no blocker failures
      And the mock harness recorded zero comment posts on issue 9658
      """
    When the throwaway regression scenario is run through Cucumber
    Then the throwaway regression scenario passes

  @adw-964 @adw-n5cfq2-bug-move-the-test-re
  Scenario: Under the @regression hooks, adwSdlc's scenario test phase over a worktree with step definitions runs the fixture's fenced @review-proof scenario command and records its failure as a blocker, and the phase still succeeds without posting a comment
    Given a throwaway regression scenario with the steps:
      """
      Given an issue 9659 exists in the mock issue tracker
      And the worktree for adwId "surface-9659" is initialised at branch "surface-9659"
      And the worktree for adwId "surface-9659" has step definitions committed on its branch
      When the "scenario test" phase of the "sdlc" orchestrator runs for adwId "surface-9659"
      Then the "scenario test" phase run succeeded
      And the scenario proof records a blocker failure for the tag "@review-proof"
      And the mock harness recorded zero comment posts on issue 9659
      """
    When the throwaway regression scenario is run through Cucumber
    Then the throwaway regression scenario passes

  @adw-964 @adw-n5cfq2-bug-move-the-test-re
  Scenario: Under the @regression hooks, adwSdlc's scenario fix phase fails when the stub answers every agent with the error response, because its commit agent fails, and posts no comment
    Given a throwaway regression scenario with the steps:
      """
      Given an issue 9660 exists in the mock issue tracker
      And the worktree for adwId "surface-9660" is initialised at branch "surface-9660"
      And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/surface-scenario-fix-phase-error.json"
      When the "scenario fix" phase of the "sdlc" orchestrator runs for adwId "surface-9660"
      Then the "scenario fix" phase run failed with an error that names "Commit agent 'scenario-fix-agent'"
      And the mock harness recorded zero comment posts on issue 9660
      """
    When the throwaway regression scenario is run through Cucumber
    Then the throwaway regression scenario passes

  @adw-964 @adw-n5cfq2-bug-move-the-test-re
  Scenario: Under the @regression hooks, adwSdlc's alignment phase, over a committed plan and a scenario for the issue, posts its aligning and aligned comments, and records no stage
    Given a throwaway regression scenario with the steps:
      """
      Given an issue 9661 exists in the mock issue tracker
      And the worktree for adwId "surface-9661" is initialised at branch "surface-9661"
      And the worktree for adwId "surface-9661" has the plan for issue 9661 committed on its branch
      And the worktree for adwId "surface-9661" has a scenario for issue 9661 committed on its branch
      And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/surface-alignment-phase.json"
      When the "alignment" phase of the "sdlc" orchestrator runs for adwId "surface-9661"
      Then the "alignment" phase run succeeded
      And the mock GitHub API recorded a comment containing the text "## :arrows_counterclockwise: Aligning Plan and Scenarios"
      And the mock GitHub API recorded a comment containing the text "Implementation plan and BDD scenarios have been aligned."
      And the state file for adwId "surface-9661" records workflowStage "starting"
      """
    When the throwaway regression scenario is run through Cucumber
    Then the throwaway regression scenario passes

  @adw-964 @adw-n5cfq2-bug-move-the-test-re
  Scenario: Under the @regression hooks, adwSdlc's alignment phase, over a committed plan but no scenario for the issue, skips: its run succeeds and it posts no comment
    Given a throwaway regression scenario with the steps:
      """
      Given an issue 9662 exists in the mock issue tracker
      And the worktree for adwId "surface-9662" is initialised at branch "surface-9662"
      And the worktree for adwId "surface-9662" has the plan for issue 9662 committed on its branch
      And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/surface-alignment-phase.json"
      When the "alignment" phase of the "sdlc" orchestrator runs for adwId "surface-9662"
      Then the "alignment" phase run succeeded
      And the mock harness recorded zero comment posts on issue 9662
      """
    When the throwaway regression scenario is run through Cucumber
    Then the throwaway regression scenario passes

  @adw-964 @adw-n5cfq2-bug-move-the-test-re
  Scenario: Under the @regression hooks, the plan validation phase, which no orchestrator runs and so is driven directly, posts its validating and aligned comments over a committed plan and a scenario for the issue
    Given a throwaway regression scenario with the steps:
      """
      Given an issue 9663 exists in the mock issue tracker
      And the worktree for adwId "surface-9663" is initialised at branch "surface-9663"
      And the worktree for adwId "surface-9663" has the plan for issue 9663 committed on its branch
      And the worktree for adwId "surface-9663" has a scenario for issue 9663 committed on its branch
      And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/surface-plan-validation-phase.json"
      When the "plan validation" phase, which no orchestrator runs, is driven directly for adwId "surface-9663"
      Then the "plan validation" phase run succeeded
      And the mock GitHub API recorded a comment containing the text "## :mag: Validating Plan-Scenario Alignment"
      And the mock GitHub API recorded a comment containing the text "Implementation plan and BDD scenarios are aligned."
      And the state file for adwId "surface-9663" records workflowStage "starting"
      """
    When the throwaway regression scenario is run through Cucumber
    Then the throwaway regression scenario passes

  @adw-964 @adw-n5cfq2-bug-move-the-test-re
  Scenario: Under the @regression hooks, the plan validation phase, driven directly over a worktree with no plan, fails naming the plan file it could not read, and posts no comment
    Given a throwaway regression scenario with the steps:
      """
      Given an issue 9664 exists in the mock issue tracker
      And the worktree for adwId "surface-9664" is initialised at branch "surface-9664"
      When the "plan validation" phase, which no orchestrator runs, is driven directly for adwId "surface-9664"
      Then the "plan validation" phase run failed with an error that names "Cannot read plan file"
      And the mock harness recorded zero comment posts on issue 9664
      """
    When the throwaway regression scenario is run through Cucumber
    Then the throwaway regression scenario passes

  # ── §4 NO MANIFEST WRITES WHAT A THEN STEP READS ────────────────────────────────────────────

  @adw-964 @adw-n5cfq2-bug-move-the-test-re
  Scenario: The refusal guard refuses none of the manifests committed under test/fixtures/jsonl/manifests, the new surface manifests among them, so none writes the top-level state, anything under agents/ or anything beyond the worktree
    When the stub's manifest interpreter applies every manifest committed under "test/fixtures/jsonl/manifests", each in a throwaway git worktree
    Then the refusal guard refused none of them

  # ── §5 BACKSTOP ─────────────────────────────────────────────────────────────────────────────

  @adw-964 @adw-n5cfq2-bug-move-the-test-re
  Scenario: TypeScript type-check passes with the eleven rows on the phase harness, the new W-S1 pairs, W-S4 and the recording applyLabel in place
    Then the ADW TypeScript type-check passes
