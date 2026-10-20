@adw-1078 @adw-6ph2e9-feat-a-resumed-workf
Feature: A resumed workflow whose worktree no longer holds its plan parks as "worktree_lost" instead of running the planner again, while a resumed workflow that still has its plan, and a fresh run, go on as before

  A workflow is resumed when its issue already holds the workflow comments of an earlier run of it, and it picks up after the last stage they record.

  Background:
    Given the ADW codebase is checked out

  @adw-1078 @adw-6ph2e9-feat-a-resumed-workf @surface
  Scenario: The plan phase of a workflow resumed after its earlier run created the plan parks the workflow as "worktree_lost" when the worktree holds no plan, without running the planner again or posting a second "Implementation Plan Created" comment
    Given an issue 107802 exists in the mock issue tracker
    And issue 107802 holds the workflow comments an earlier run of workflow "surface-1078-02" posted, up to the stage "plan_created"
    And the worktree for adwId "surface-1078-02" is initialised at branch "surface-1078-02"
    And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/surface-plan-phase.json"
    When the "plan" phase of the "plan" orchestrator runs for adwId "surface-1078-02", resuming the earlier run
    Then the "plan" phase run stopped the workflow without an error
    And the state file for adwId "surface-1078-02" records workflowStage "worktree_lost"
    And the mock harness recorded zero comment posts on issue 107802 containing the text "## :pencil: Building Implementation Plan"
    And the mock harness recorded zero comment posts on issue 107802 containing the text "## :white_check_mark: Implementation Plan Created"
    And the mock GitHub API recorded a comment containing the text "worktree_lost"

  @adw-1078 @adw-6ph2e9-feat-a-resumed-workf @surface
  Scenario: The plan phase of a workflow resumed after its earlier run created the plan, with the plan still in the worktree, skips the planner as before and does not park the workflow
    Given an issue 107803 exists in the mock issue tracker
    And issue 107803 holds the workflow comments an earlier run of workflow "surface-1078-03" posted, up to the stage "plan_created"
    And the worktree for adwId "surface-1078-03" is initialised at branch "surface-1078-03"
    And the worktree for adwId "surface-1078-03" has the plan for issue 107803 committed on its branch
    And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/surface-plan-phase.json"
    When the "plan" phase of the "plan" orchestrator runs for adwId "surface-1078-03", resuming the earlier run
    Then the "plan" phase run succeeded
    And the mock harness recorded zero comment posts on issue 107803 containing the text "## :pencil: Building Implementation Plan"
    And the mock harness recorded zero comment posts on issue 107803 containing the text "## :white_check_mark: Implementation Plan Created"
    And the mock harness recorded zero comment posts on issue 107803 containing the text "worktree_lost"

  @adw-1078 @adw-6ph2e9-feat-a-resumed-workf @surface
  Scenario: The plan phase of a workflow resumed after its earlier run stopped while planning, before it created any plan, runs the planner as before and does not park the workflow, since no plan was lost
    Given an issue 107804 exists in the mock issue tracker
    And issue 107804 holds the workflow comments an earlier run of workflow "surface-1078-04" posted, up to the stage "plan_building"
    And the worktree for adwId "surface-1078-04" is initialised at branch "surface-1078-04"
    And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/surface-plan-phase-resumed.json"
    When the "plan" phase of the "plan" orchestrator runs for adwId "surface-1078-04", resuming the earlier run
    Then the "plan" phase run succeeded
    And the mock GitHub API recorded a comment containing the text "## :white_check_mark: Implementation Plan Created"
    And the mock harness recorded zero comment posts on issue 107804 containing the text "worktree_lost"

  @adw-1078 @adw-6ph2e9-feat-a-resumed-workf @surface
  Scenario: The build phase of a workflow resumed after its earlier run started the build parks the workflow as "worktree_lost" instead of failing when the worktree holds no plan, and does not start the build agent
    Given an issue 107805 exists in the mock issue tracker
    And issue 107805 holds the workflow comments an earlier run of workflow "surface-1078-05" posted, up to the stage "build_running"
    And the worktree for adwId "surface-1078-05" is initialised at branch "surface-1078-05"
    And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/surface-build-phase.json"
    When the "build" phase of the "build" orchestrator runs for adwId "surface-1078-05", resuming the earlier run
    Then the "build" phase run stopped the workflow without an error
    And the state file for adwId "surface-1078-05" records workflowStage "worktree_lost"
    And the mock harness recorded zero comment posts on issue 107805 containing the text "## :hammer_and_wrench: Running Build"
    And the mock GitHub API recorded a comment containing the text "worktree_lost"

  @adw-1078 @adw-6ph2e9-feat-a-resumed-workf @surface
  Scenario: The build phase of a workflow resumed after its earlier run started the build, with the plan still in the worktree, builds as before and does not park the workflow
    Given an issue 107806 exists in the mock issue tracker
    And issue 107806 holds the workflow comments an earlier run of workflow "surface-1078-06" posted, up to the stage "build_running"
    And the worktree for adwId "surface-1078-06" is initialised at branch "surface-1078-06"
    And the worktree for adwId "surface-1078-06" has the plan for issue 107806 committed on its branch
    And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/surface-build-phase.json"
    When the "build" phase of the "build" orchestrator runs for adwId "surface-1078-06", resuming the earlier run
    Then the "build" phase run succeeded
    And the state file for adwId "surface-1078-06" records workflowStage "build_completed"
    And the mock GitHub API recorded a comment containing the text "## :white_check_mark: Build Completed"
    And the mock harness recorded zero comment posts on issue 107806 containing the text "worktree_lost"

  @adw-1078 @adw-6ph2e9-feat-a-resumed-workf @surface
  Scenario: The plan validation phase of a workflow resumed after its earlier run created the plan parks the workflow as "worktree_lost" instead of failing when the worktree holds no plan, and does not start the validation agent
    Given an issue 107807 exists in the mock issue tracker
    And issue 107807 holds the workflow comments an earlier run of workflow "surface-1078-07" posted, up to the stage "plan_created"
    And the worktree for adwId "surface-1078-07" is initialised at branch "surface-1078-07"
    And the worktree for adwId "surface-1078-07" has a scenario for issue 107807 committed on its branch
    And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/surface-plan-validation-phase.json"
    When the "plan validation" phase, which no orchestrator runs, is driven directly for adwId "surface-1078-07", resuming the earlier run
    Then the "plan validation" phase run stopped the workflow without an error
    And the state file for adwId "surface-1078-07" records workflowStage "worktree_lost"
    And the mock harness recorded zero comment posts on issue 107807 containing the text "## :mag: Validating Plan-Scenario Alignment"
    And the mock GitHub API recorded a comment containing the text "worktree_lost"

  @adw-1078 @adw-6ph2e9-feat-a-resumed-workf @surface
  Scenario: The build phase of a fresh workflow, whose issue holds no earlier run's workflow comments, still fails with an error naming the plan file when the worktree holds no plan, and does not park the workflow
    Given an issue 107808 exists in the mock issue tracker
    And the worktree for adwId "surface-1078-08" is initialised at branch "surface-1078-08"
    And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/surface-build-phase.json"
    When the "build" phase of the "build" orchestrator runs for adwId "surface-1078-08"
    Then the "build" phase run failed with an error that names "Cannot read plan file"
    And the mock harness recorded zero comment posts on issue 107808 containing the text "worktree_lost"

  @adw-1078 @adw-6ph2e9-feat-a-resumed-workf @dead-orchestrator-takeover
  Scenario: The cron never relaunches a workflow parked as "worktree_lost" and leaves its worktree alone, while the same poll still takes over a neighbouring workflow stopped at "abandoned"
    Given a launch boundary for the repository "adw-fixture/void-959" whose providers record every call
    And issue 107809 has an ADW workflow under adwId "lost1078-107809" that runs "adws/adwSdlc.tsx", whose last run stopped at "worktree_lost" half an hour ago
    And issue 107810 has an ADW workflow under adwId "aband1078-107810" that runs "adws/adwSdlc.tsx", whose last run stopped at "abandoned" half an hour ago
    When the cron polls from that boundary, with its hung-orchestrator sweep due
    Then the cron launched no orchestrator for issue 107809
    And the worktree of workflow "lost1078-107809" was not reset
    And the state file for adwId "lost1078-107809" records workflowStage "worktree_lost"
    And the cron has launched 1 orchestrator for issue 107810
    And every orchestrator the cron launched for issue 107810 runs "adws/adwSdlc.tsx" under adwId "aband1078-107810"

  @adw-1078 @adw-6ph2e9-feat-a-resumed-workf
  Scenario: The ADW TypeScript type-check passes once "worktree_lost" is a workflow stage that the exhaustive stage classifier classifies
    Then the ADW TypeScript type-check passes
