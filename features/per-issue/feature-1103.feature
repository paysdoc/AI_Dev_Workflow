@adw-1103 @adw-wxs8hp-build-phase-never-en
Feature: A build agent's BUILD_COMPLETE result ends the build phase as completed, even when its context then hits the token limit, and edits made after it no longer count as progress, so a finished plan no longer keeps the build agent restarting until the checkpoint backstop, while a build that is really incomplete still aborts for no progress or at the backstop as before

  A context is one run of the build agent; BUILD_COMPLETE is the result a context reports when it finds every plan step done and the plan's validation commands passing.

  Background:
    Given the ADW codebase is checked out
    And the build phase checkpoints the build after every 3 contexts that end at the token limit or at a compaction, and allows at most 20 checkpoints

  @adw-1103 @adw-wxs8hp-build-phase-never-en @surface
  Scenario: When a context reports BUILD_COMPLETE and then hits the token limit anyway, and every context after it hits the token limit while editing files that no plan step names, the build phase completes after at most one more context instead of restarting the build agent until the checkpoint backstop
    Given an issue 110301 exists in the mock issue tracker
    And the worktree for adwId "surface-1103-01" is initialised at branch "surface-1103-01"
    And the worktree for adwId "surface-1103-01" has a plan of 3 steps for issue 110301 committed on its branch
    And the stand-in commit agent commits every change in the worktree whenever it is asked to commit
    And the stand-in build agent's contexts go as follows:
      | context         | uncommitted edits to          | reports        | ends               |
      | 1               | plan step 1                   |                | at the token limit |
      | 2               | plan step 2                   |                | at the token limit |
      | 3               | plan step 3                   |                | at the token limit |
      | 4               | no file                       | BUILD_COMPLETE | at the token limit |
      | every later one | files that no plan step names |                | at the token limit |
    When the "build" phase of the "build" orchestrator runs for adwId "surface-1103-01"
    Then the "build" phase run succeeded
    And the state file for adwId "surface-1103-01" records workflowStage "build_completed"
    And the mock GitHub API recorded a comment containing the text "## :white_check_mark: Build Completed"
    And the stand-in build agent ran at most one context after context 4

  @adw-1103 @adw-wxs8hp-build-phase-never-en @surface
  Scenario Outline: The build phase completes after at most one more context wherever the context that reports BUILD_COMPLETE and then hits the token limit falls among the checkpoints, here context <completion>, <where>
    Given an issue <issue> exists in the mock issue tracker
    And the worktree for adwId "<adwId>" is initialised at branch "<adwId>"
    And the worktree for adwId "<adwId>" has a plan of <steps> steps for issue <issue> committed on its branch
    And the stand-in commit agent commits every change in the worktree whenever it is asked to commit
    And the stand-in build agent's contexts go as follows:
      | context         | uncommitted edits to          | reports        | ends               |
      | 1 to <steps>    | the next plan step            |                | at the token limit |
      | <completion>    | no file                       | BUILD_COMPLETE | at the token limit |
      | every later one | files that no plan step names |                | at the token limit |
    When the "build" phase of the "build" orchestrator runs for adwId "<adwId>"
    Then the "build" phase run succeeded
    And the state file for adwId "<adwId>" records workflowStage "build_completed"
    And the stand-in build agent ran at most one context after context <completion>

    Examples:
      | issue  | adwId           | steps | completion | where                                          |
      | 110302 | surface-1103-02 | 1     | 2          | before the build's first checkpoint            |
      | 110303 | surface-1103-03 | 4     | 5          | the second context after a checkpoint          |
      | 110304 | surface-1103-04 | 5     | 6          | the context whose end is the build's checkpoint |

  @adw-1103 @adw-wxs8hp-build-phase-never-en @surface
  Scenario: A context that reports BUILD_COMPLETE and is then stopped by a compaction ends the build the same way: the build phase completes after at most one more context, although every context after it is stopped by a compaction while editing files that no plan step names
    Given an issue 110305 exists in the mock issue tracker
    And the worktree for adwId "surface-1103-05" is initialised at branch "surface-1103-05"
    And the worktree for adwId "surface-1103-05" has a plan of 3 steps for issue 110305 committed on its branch
    And the stand-in commit agent commits every change in the worktree whenever it is asked to commit
    And the stand-in build agent's contexts go as follows:
      | context         | uncommitted edits to          | reports        | ends               |
      | 1               | plan step 1                   |                | at the token limit |
      | 2               | plan step 2                   |                | at the token limit |
      | 3               | plan step 3                   |                | at the token limit |
      | 4               | no file                       | BUILD_COMPLETE | at a compaction    |
      | every later one | files that no plan step names |                | at a compaction    |
    When the "build" phase of the "build" orchestrator runs for adwId "surface-1103-05"
    Then the "build" phase run succeeded
    And the state file for adwId "surface-1103-05" records workflowStage "build_completed"
    And the stand-in build agent ran at most one context after context 4

  @adw-1103 @adw-wxs8hp-build-phase-never-en @surface
  Scenario: A context that finds every plan step committed and the plan's validation commands passing reports BUILD_COMPLETE and finishes without editing anything, and the build phase completes without starting another context
    Given an issue 110306 exists in the mock issue tracker
    And the worktree for adwId "surface-1103-06" is initialised at branch "surface-1103-06"
    And the worktree for adwId "surface-1103-06" has a plan of 3 steps for issue 110306 committed on its branch
    And the stand-in commit agent commits every change in the worktree whenever it is asked to commit
    And the stand-in build agent's contexts go as follows:
      | context | uncommitted edits to | reports        | ends               |
      | 1       | plan step 1          |                | at the token limit |
      | 2       | plan step 2          |                | at the token limit |
      | 3       | plan step 3          |                | at the token limit |
      | 4       | no file              | BUILD_COMPLETE | by finishing       |
    When the "build" phase of the "build" orchestrator runs for adwId "surface-1103-06"
    Then the "build" phase run succeeded
    And the state file for adwId "surface-1103-06" records workflowStage "build_completed"
    And the mock GitHub API recorded a comment containing the text "## :white_check_mark: Build Completed"
    And the stand-in build agent ran 4 contexts

  @adw-1103 @adw-wxs8hp-build-phase-never-en @surface
  Scenario: The prompt of every context after the first, before the build's first checkpoint and after it, asks the build agent to check the plan's steps against the git state before it edits anything and to end with BUILD_COMPLETE once they are all done, and tells it that work no plan step asks for is out of scope
    Given an issue 110307 exists in the mock issue tracker
    And the worktree for adwId "surface-1103-07" is initialised at branch "surface-1103-07"
    And the worktree for adwId "surface-1103-07" has a plan of 3 steps for issue 110307 committed on its branch
    And the stand-in commit agent commits every change in the worktree whenever it is asked to commit
    And the stand-in build agent's contexts go as follows:
      | context | uncommitted edits to | reports        | ends               |
      | 1       | plan step 1          |                | at the token limit |
      | 2       | plan step 2          |                | at the token limit |
      | 3       | plan step 3          |                | at the token limit |
      | 4       | no file              | BUILD_COMPLETE | by finishing       |
    When the "build" phase of the "build" orchestrator runs for adwId "surface-1103-07"
    Then the prompt of each of the stand-in build agent's contexts 2 to 4 asks it, before it edits anything, to check every plan step against the git state, and, once every plan step is done and the plan's validation commands pass, to end with the BUILD_COMPLETE result and edit nothing more
    And the prompt of each of the stand-in build agent's contexts 2 to 4 tells it that once every plan step is committed, refactors, extra hardening, stress tests and mutation tests that no plan step asks for are out of scope, and that uncommitted edits outside the plan's steps are not work to continue
    And the prompt of the stand-in build agent's context 4, the first after a checkpoint, still points it at the commits its branch carries ahead of the base branch as the record of the work already done
    And the prompts of the stand-in build agent's contexts 2 and 3, before any checkpoint, still carry the output of the context before each

  @adw-1103 @adw-wxs8hp-build-phase-never-en @surface
  Scenario: A build that is really incomplete, none of whose contexts reports BUILD_COMPLETE, still aborts for no progress when its worktree at a checkpoint is at a tree state the build has already reached
    Given an issue 110308 exists in the mock issue tracker
    And the worktree for adwId "surface-1103-08" is initialised at branch "surface-1103-08"
    And the worktree for adwId "surface-1103-08" has a plan of 3 steps for issue 110308 committed on its branch
    And the stand-in commit agent commits every change in the worktree whenever it is asked to commit
    And the stand-in build agent's contexts go as follows:
      | context         | uncommitted edits to | reports | ends               |
      | 1               | plan step 1          |         | at the token limit |
      | every later one | no file              |         | at the token limit |
    When the "build" phase of the "build" orchestrator runs for adwId "surface-1103-08"
    Then the "build" phase run failed with an error that names "Build aborted — no progress"
    And the stand-in build agent ran 6 contexts
    And the mock harness recorded zero comment posts on issue 110308 containing the text "## :white_check_mark: Build Completed"

  @adw-1103 @adw-wxs8hp-build-phase-never-en @surface
  Scenario: A build that is really incomplete, none of whose contexts reports BUILD_COMPLETE, and that reaches a new tree state at every checkpoint still restarts the build agent until the checkpoint backstop and aborts there
    Given an issue 110309 exists in the mock issue tracker
    And the worktree for adwId "surface-1103-09" is initialised at branch "surface-1103-09"
    And the worktree for adwId "surface-1103-09" has a plan of 70 steps for issue 110309 committed on its branch
    And the stand-in commit agent commits every change in the worktree whenever it is asked to commit
    And the stand-in build agent's contexts go as follows:
      | context   | uncommitted edits to | reports | ends               |
      | every one | the next plan step   |         | at the token limit |
    When the "build" phase of the "build" orchestrator runs for adwId "surface-1103-09"
    Then the "build" phase run failed with an error that names "Build aborted — checkpoint backstop reached"
    And the stand-in build agent ran 63 contexts
    And the mock harness recorded zero comment posts on issue 110309 containing the text "## :white_check_mark: Build Completed"

  @adw-1103 @adw-wxs8hp-build-phase-never-en
  Scenario: The ADW TypeScript type-check passes once the build phase ends a build on a reported BUILD_COMPLETE and the progress gate no longer counts edits made after it as progress
    Then the ADW TypeScript type-check passes
