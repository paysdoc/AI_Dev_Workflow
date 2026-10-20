@adw-1080 @adw-a69x2i-bug-resume-recovers
Feature: Resuming a workflow recovers the plan file named by the issue's "Implementation Plan Created" comment, whether the planner gave the plan its current name "specs/issue-<N>-adw-<adwId>-sdlc_planner-<slug>.md" or the old "specs/issue-<N>-plan.md", and the later comments neither lose it nor replace it with a file that is not a plan

  The recovery state is what ADW reads back from an issue's workflow comments to resume a run where the last one stopped.

  Background:
    Given the ADW codebase is checked out

  @adw-1080 @adw-a69x2i-bug-resume-recovers
  Scenario: A run whose "Implementation Plan Created" comment names a plan under the planner's current name "specs/issue-<N>-adw-<adwId>-sdlc_planner-<slug>.md" is recovered with that plan file
    Given ADW posted its workflow comments for these stages on issue 1080 under adwId "a69x2i-bug-resume-recovers", oldest first:
      | stage          | plan file                                                                        |
      | starting       |                                                                                  |
      | classified     |                                                                                  |
      | branch_created |                                                                                  |
      | plan_building  |                                                                                  |
      | plan_created   | specs/issue-1080-adw-a69x2i-bug-resume-recovers-sdlc_planner-resume-plan-path.md |
    When ADW reads the recovery state from the comments on issue 1080
    Then the recovery state records the plan file "specs/issue-1080-adw-a69x2i-bug-resume-recovers-sdlc_planner-resume-plan-path.md"

  @adw-1080 @adw-a69x2i-bug-resume-recovers
  Scenario: A run whose "Implementation Plan Created" comment names a plan under the old name "specs/issue-<N>-plan.md" is still recovered with that plan file
    Given ADW posted its workflow comments for these stages on issue 1080 under adwId "a69x2i-bug-resume-recovers", oldest first:
      | stage          | plan file                |
      | starting       |                          |
      | classified     |                          |
      | branch_created |                          |
      | plan_building  |                          |
      | plan_created   | specs/issue-1080-plan.md |
    When ADW reads the recovery state from the comments on issue 1080
    Then the recovery state records the plan file "specs/issue-1080-plan.md"

  @adw-1080 @adw-a69x2i-bug-resume-recovers
  Scenario: A run that stopped during the build resumes after "build_running" with the plan file, under the planner's current name, that its earlier "Implementation Plan Created" comment named, although no comment after it names one
    Given ADW posted its workflow comments for these stages on issue 1080 under adwId "a69x2i-bug-resume-recovers", oldest first:
      | stage           | plan file                                                                        |
      | starting        |                                                                                  |
      | classified      |                                                                                  |
      | branch_created  |                                                                                  |
      | plan_building   |                                                                                  |
      | plan_created    | specs/issue-1080-adw-a69x2i-bug-resume-recovers-sdlc_planner-resume-plan-path.md |
      | plan_committing |                                                                                  |
      | build_running   |                                                                                  |
    When ADW reads the recovery state from the comments on issue 1080
    Then the recovery state resumes the run after the stage "build_running"
    And the recovery state records the plan file "specs/issue-1080-adw-a69x2i-bug-resume-recovers-sdlc_planner-resume-plan-path.md"

  @adw-1080 @adw-a69x2i-bug-resume-recovers
  Scenario: A later comment that quotes a file under "specs/" that is not a plan, such as the parent PRD in the "Build Completed" comment's build summary, does not replace the recovered plan file
    Given ADW posted its workflow comments for these stages on issue 1080 under adwId "a69x2i-bug-resume-recovers", oldest first:
      | stage           | plan file                                                                        | summary                                                                                     |
      | starting        |                                                                                  |                                                                                             |
      | classified      |                                                                                  |                                                                                             |
      | branch_created  |                                                                                  |                                                                                             |
      | plan_building   |                                                                                  |                                                                                             |
      | plan_created    | specs/issue-1080-adw-a69x2i-bug-resume-recovers-sdlc_planner-resume-plan-path.md |                                                                                             |
      | plan_committing |                                                                                  |                                                                                             |
      | build_running   |                                                                                  |                                                                                             |
      | build_completed |                                                                                  | Implemented user story 26 of the PRD `specs/prd/specs-worktree-only-and-docs-relocation.md`. |
    When ADW reads the recovery state from the comments on issue 1080
    Then the recovery state resumes the run after the stage "build_completed"
    And the recovery state records the plan file "specs/issue-1080-adw-a69x2i-bug-resume-recovers-sdlc_planner-resume-plan-path.md"
