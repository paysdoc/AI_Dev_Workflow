@adw-1101 @adw-a6cot9-feat-adwmerge-re-run @promotion-suggested-2026-10-27
Feature: Before adwMerge merges a pull request whose branch does not hold the tip of the base branch, it merges the base branch in, pushes, and re-runs "@regression" and the issue's scenarios on the result; it merges only once both pass, and otherwise parks the workflow as "human_gated" for "post_merge_bdd_red" with a comment saying why, from where "## Retry" resumes the same workflow

  The suites are "@regression" and "@adw-<issue>", re-run by the scenario proof runner in the workflow's worktree.

  Background:
    Given the ADW codebase is checked out

  @adw-1101 @adw-a6cot9-feat-adwmerge-re-run
  Scenario Outline: A branch behind "dev" gets "dev" merged in <how>, is pushed, has both suites re-run on the merged code, and is merged once both pass
    Given the workflow "<adwId>" for issue <issue> is at "awaiting_merge" with pull request <issue> open from the branch "feature-issue-<issue>" into "dev"
    And "dev" on origin holds these commits that the branch "feature-issue-<issue>" does not:
      | commit            | conflicts with the branch in |
      | Add the changelog | no file                      |
      | <commit>          | <conflicting file>           |
    And the "/resolve_conflict" agent, if it is run, resolves the conflict in "src/shared.ts" with a merge commit
    And the repository runs its scenarios by tag with a stand-in that records each run
    And the branch "feature-issue-<issue>" holds these scenarios, which pass on the branch alone and end as follows on the branch merged with "dev":
      | tag          | scenario                          | result |
      | @regression  | Orders are accepted               | passes |
      | @adw-<issue> | Orders over the limit are refused | passes |
    And GitHub merges pull request <issue> when asked
    When adwMerge runs for the workflow "<adwId>"
    Then the state file for adwId "<adwId>" records workflowStage "completed"
    And the branch "feature-issue-<issue>" on origin holds the tip of "dev"
    And the scenario runner ran "@regression" and "@adw-<issue>" once each, on the commit that the branch "feature-issue-<issue>" holds on origin
    And the mock GitHub API recorded a merge of PR <issue>

    Examples:
      | adwId              | issue  | how                                                      | commit                            | conflicting file |
      | rerun1101-clean    | 110101 | cleanly                                                  | Raise the order limit             | no file          |
      | rerun1101-resolved | 110102 | through "/resolve_conflict", which resolves the conflict | Change the shared constant on dev | src/shared.ts    |

  @adw-1101 @adw-a6cot9-feat-adwmerge-re-run
  Scenario: A branch that already holds the tip of "dev" is merged as before, without either suite being re-run, since its scenario proof already covers the code that is merged
    Given the workflow "rerun1101-current" for issue 110103 is at "awaiting_merge" with pull request 110103 open from the branch "feature-issue-110103" into "dev"
    And the branch "feature-issue-110103" on origin already holds the tip of "dev"
    And the repository runs its scenarios by tag with a stand-in that records each run
    And the branch "feature-issue-110103" holds these scenarios, which pass on the branch alone and end as follows on the branch merged with "dev":
      | tag         | scenario                          | result |
      | @regression | Orders are accepted               | passes |
      | @adw-110103 | Orders over the limit are refused | passes |
    And GitHub merges pull request 110103 when asked
    When adwMerge runs for the workflow "rerun1101-current"
    Then the state file for adwId "rerun1101-current" records workflowStage "completed"
    And the mock GitHub API recorded a merge of PR 110103
    And the scenario runner was not run

  @adw-1101 @adw-a6cot9-feat-adwmerge-re-run
  Scenario: A branch behind "dev" in a repository that has no scenarios configured is merged as before and is not parked, since there is no suite to re-run
    Given the workflow "rerun1101-no-suites" for issue 110104 is at "awaiting_merge" with pull request 110104 open from the branch "feature-issue-110104" into "dev"
    And "dev" on origin holds these commits that the branch "feature-issue-110104" does not:
      | commit            | conflicts with the branch in |
      | Add the changelog | no file                      |
    And the repository has no scenarios configured
    And GitHub merges pull request 110104 when asked
    When adwMerge runs for the workflow "rerun1101-no-suites"
    Then the state file for adwId "rerun1101-no-suites" records workflowStage "completed"
    And the mock GitHub API recorded a merge of PR 110104
    And the mock harness recorded zero comment posts on issue 110104 containing the text "ADW Parked"

  @adw-1101 @adw-a6cot9-feat-adwmerge-re-run
  Scenario: When a commit that conflicts with the branch lands on "dev" after the suites were re-run and before GitHub merges, "/resolve_conflict" resolves it, and both suites are re-run on the resolved merge before GitHub is asked again
    Given the workflow "rerun1101-raced" for issue 110105 is at "awaiting_merge" with pull request 110105 open from the branch "feature-issue-110105" into "dev"
    And "dev" on origin holds these commits that the branch "feature-issue-110105" does not:
      | commit            | conflicts with the branch in |
      | Add the changelog | no file                      |
    And the "/resolve_conflict" agent, if it is run, resolves the conflict in "src/shared.ts" with a merge commit
    And the repository runs its scenarios by tag with a stand-in that records each run
    And the branch "feature-issue-110105" holds these scenarios, which pass on the branch alone and end as follows on the branch merged with "dev":
      | tag         | scenario                          | result |
      | @regression | Orders are accepted               | passes |
      | @adw-110105 | Orders over the limit are refused | passes |
    And the commit "Change the shared constant on dev", which conflicts with the branch in "src/shared.ts", lands on "dev" on origin as adwMerge first asks GitHub to merge pull request 110105
    And GitHub refuses the first call to merge pull request 110105 with "GraphQL: Pull Request has merge conflicts (mergePullRequest)" and merges it when asked again
    When adwMerge runs for the workflow "rerun1101-raced"
    Then the state file for adwId "rerun1101-raced" records workflowStage "completed"
    And the branch "feature-issue-110105" on origin holds the tip of "dev"
    And the scenario runner ran "@regression" and "@adw-110105" twice each, the second time on the commit that the branch "feature-issue-110105" holds on origin
    And the mock GitHub API recorded a merge of PR 110105

  @adw-1101 @adw-a6cot9-feat-adwmerge-re-run
  Scenario Outline: When "<failing tag>" fails on the branch merged with "dev", adwMerge parks the workflow as "human_gated" for "post_merge_bdd_red" without merging it or starting a fix agent, and posts one "ADW Parked" comment that says what was merged in, what failed and how to go on
    Given the workflow "<adwId>" for issue <issue> is at "awaiting_merge" with pull request <issue> open from the branch "feature-issue-<issue>" into "dev"
    And "dev" on origin holds these commits that the branch "feature-issue-<issue>" does not:
      | commit                | conflicts with the branch in |
      | Add the changelog     | no file                      |
      | Raise the order limit | no file                      |
    And the repository runs its scenarios by tag with a stand-in that records each run
    And the branch "feature-issue-<issue>" holds these scenarios, which pass on the branch alone and end as follows on the branch merged with "dev":
      | tag          | scenario                          | result              |
      | @regression  | Orders are accepted               | <regression result> |
      | @adw-<issue> | Orders over the limit are refused | <issue result>      |
    And GitHub merges pull request <issue> when asked
    When adwMerge runs for the workflow "<adwId>"
    Then the state file for adwId "<adwId>" records workflowStage "human_gated"
    And the state file for adwId "<adwId>" records the park reason "post_merge_bdd_red"
    And the mock harness recorded zero PR-merge calls
    And adwMerge started no agent to fix the failing scenario
    And the branch "feature-issue-<issue>" on origin holds the tip of "dev"
    And the mock GitHub API recorded exactly 1 comment on issue <issue> containing the text "ADW Parked"
    And the "ADW Parked" comment on issue <issue> lists, in "git log --oneline" form, exactly these commits merged in from "dev":
      | commit                |
      | Add the changelog     |
      | Raise the order limit |
    And the "ADW Parked" comment on issue <issue> names no conflicted file
    And the "ADW Parked" comment on issue <issue> names the failing scenario "<failing scenario>" with its error "<error>"
    And the "ADW Parked" comment on issue <issue> says that the branch passed on its own and fails combined with "dev"
    And the "ADW Parked" comment on issue <issue> tells the reader to fix the branch by hand and push, or to comment "## Retry"
    And the "ADW Parked" comment on issue <issue> says that either way ADW re-runs the scenarios, attempts fixes, re-reviews and merges

    Examples:
      | adwId                    | issue  | failing tag | regression result                      | issue result                              | failing scenario                  | error                        |
      | rerun1101-red-issue      | 110106 | @adw-110106 | passes                                 | fails with "expected status 422, got 201" | Orders over the limit are refused | expected status 422, got 201 |
      | rerun1101-red-regression | 110107 | @regression | fails with "expected 1 order, found 0" | passes                                    | Orders are accepted               | expected 1 order, found 0    |

  @adw-1101 @adw-a6cot9-feat-adwmerge-re-run
  Scenario: When the suites fail after "/resolve_conflict" resolved the branch's conflict with "dev", the workflow is parked the same way and the "ADW Parked" comment also names the file that conflicted
    Given the workflow "rerun1101-red-resolved" for issue 110108 is at "awaiting_merge" with pull request 110108 open from the branch "feature-issue-110108" into "dev"
    And "dev" on origin holds these commits that the branch "feature-issue-110108" does not:
      | commit                            | conflicts with the branch in |
      | Change the shared constant on dev | src/shared.ts                |
    And the "/resolve_conflict" agent, if it is run, resolves the conflict in "src/shared.ts" with a merge commit
    And the repository runs its scenarios by tag with a stand-in that records each run
    And the branch "feature-issue-110108" holds these scenarios, which pass on the branch alone and end as follows on the branch merged with "dev":
      | tag         | scenario                          | result                                    |
      | @regression | Orders are accepted               | passes                                    |
      | @adw-110108 | Orders over the limit are refused | fails with "expected status 422, got 201" |
    And GitHub merges pull request 110108 when asked
    When adwMerge runs for the workflow "rerun1101-red-resolved"
    Then the state file for adwId "rerun1101-red-resolved" records workflowStage "human_gated"
    And the state file for adwId "rerun1101-red-resolved" records the park reason "post_merge_bdd_red"
    And the mock harness recorded zero PR-merge calls
    And adwMerge started no agent to fix the failing scenario
    And the branch "feature-issue-110108" on origin holds the tip of "dev"
    And the scenario runner ran "@regression" and "@adw-110108" once each, on the commit that the branch "feature-issue-110108" holds on origin
    And the "ADW Parked" comment on issue 110108 names "src/shared.ts" as the only file that conflicted
    And the "ADW Parked" comment on issue 110108 lists, in "git log --oneline" form, exactly these commits merged in from "dev":
      | commit                            |
      | Change the shared constant on dev |
    And the "ADW Parked" comment on issue 110108 names the failing scenario "Orders over the limit are refused" with its error "expected status 422, got 201"

  @adw-1101 @adw-a6cot9-feat-adwmerge-re-run @dead-orchestrator-takeover
  Scenario: The cron leaves a workflow parked as "human_gated" for "post_merge_bdd_red" alone until a human comments "## Retry", and the next poll re-arms it and relaunches "adws/adwSdlc.tsx" under the same adwId
    Given a launch boundary for the repository "adw-fixture/void-959" whose providers record every call
    And issue 110109 has an ADW workflow under adwId "postmerge1101-110109" that runs "adws/adwSdlc.tsx", whose last run stopped at "human_gated" half an hour ago
    And the top-level state of workflow "postmerge1101-110109" records the park reason "post_merge_bdd_red"
    When the cron polls from that boundary, with its hung-orchestrator sweep due
    Then the cron launched no orchestrator for issue 110109
    And the worktree of workflow "postmerge1101-110109" was not reset
    When a human comments "## Retry" on issue 110109 in the recording tracker
    And the same cron polls again from that boundary, with its hung-orchestrator sweep due
    Then the state file for adwId "postmerge1101-110109" records workflowStage "phase_timeout"
    And the cron has launched 1 orchestrator for issue 110109
    And every orchestrator the cron launched for issue 110109 runs "adws/adwSdlc.tsx" under adwId "postmerge1101-110109"

  @adw-1101 @adw-a6cot9-feat-adwmerge-re-run @subprocess
  Scenario: "## Retry" on a workflow that adwMerge parked for "post_merge_bdd_red" resumes it under the same adwId, and the resumed SDLC run fixes the scenario that fails on the branch merged with "main", reviews again and ends at "awaiting_merge", without planning, building or opening a pull request a second time
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/adw-sdlc-post-merge-retry.json"
    And an issue 110110 exists in the mock issue tracker
    And the target repository's workspace runs its scenarios by tag with a stand-in that records each run
    And the stand-in fails the scenario "Orders over the limit are refused" with the error "expected status 422, got 201" on any checkout that holds both the workflow's build and the commit "Raise the order limit" from "main", until the scenario fix agent's fix is in it
    When the "sdlc" orchestrator is invoked with adwId "post-merge-smoke-110110" and issue 110110
    Then the state file for adwId "post-merge-smoke-110110" records workflowStage "awaiting_merge"
    When the commit "Raise the order limit" lands on "main" in the target repository's workspace
    And the "merge" orchestrator is invoked with adwId "post-merge-smoke-110110" and issue 110110
    Then the state file for adwId "post-merge-smoke-110110" records workflowStage "human_gated"
    And the state file for adwId "post-merge-smoke-110110" records the park reason "post_merge_bdd_red"
    And the mock GitHub API recorded exactly 1 comment on issue 110110 containing the text "ADW Parked"
    When a human comments "## Retry" on issue 110110 in the mock issue tracker
    And the cron probe runs once
    Then the state file for adwId "post-merge-smoke-110110" records workflowStage "phase_timeout"
    When the "sdlc" orchestrator is invoked with adwId "post-merge-smoke-110110" and issue 110110
    Then the orchestrator subprocess exited 0
    And the state file for adwId "post-merge-smoke-110110" records workflowStage "awaiting_merge"
    And the mock GitHub API recorded a comment containing the text "## :arrows_counterclockwise: ADW Workflow Resuming"
    And the mock GitHub API recorded exactly 1 comment on issue 110110 containing the text "## :pencil: Building Implementation Plan"
    And the mock GitHub API recorded exactly 1 comment on issue 110110 containing the text "## :hammer_and_wrench: Running Build"
    And the mock GitHub API recorded exactly 1 PR creation for issue 110110
    And the mock GitHub API recorded exactly 2 comments on issue 110110 containing the text "## :white_check_mark: Review Passed"
    And the scenario fix agent was started once
    And the stand-in last ran the scenarios on a checkout that holds the workflow's build, the commit "Raise the order limit" from "main" and the scenario fix agent's fix
    And the mock harness recorded zero PR-merge calls

  @adw-1101 @adw-a6cot9-feat-adwmerge-re-run
  Scenario: After "## Retry" brings a workflow parked for "post_merge_bdd_red" back to "awaiting_merge", adwMerge re-runs both suites again when "dev" has moved on once more, and merges once both pass
    Given the workflow "rerun1101-again" for issue 110111 is at "awaiting_merge" with pull request 110111 open from the branch "feature-issue-110111" into "dev"
    And "dev" on origin holds these commits that the branch "feature-issue-110111" does not:
      | commit                | conflicts with the branch in |
      | Raise the order limit | no file                      |
    And the repository runs its scenarios by tag with a stand-in that records each run
    And the branch "feature-issue-110111" holds these scenarios, which pass on the branch alone and end as follows on the branch merged with "dev":
      | tag         | scenario                          | result                                    |
      | @regression | Orders are accepted               | passes                                    |
      | @adw-110111 | Orders over the limit are refused | fails with "expected status 422, got 201" |
    And GitHub merges pull request 110111 when asked
    When adwMerge runs for the workflow "rerun1101-again"
    Then the state file for adwId "rerun1101-again" records the park reason "post_merge_bdd_red"
    When "## Retry" resumes the workflow "rerun1101-again", whose resumed run pushes a fix for the scenario "Orders over the limit are refused" to the branch "feature-issue-110111" and ends at "awaiting_merge"
    And "dev" on origin holds these commits that the branch "feature-issue-110111" does not:
      | commit                  | conflicts with the branch in |
      | Rename the order states | no file                      |
    And adwMerge runs for the workflow "rerun1101-again"
    Then the state file for adwId "rerun1101-again" records workflowStage "completed"
    And the branch "feature-issue-110111" on origin holds the tip of "dev"
    And the scenario runner ran "@regression" and "@adw-110111" twice each, the second time on the commit that the branch "feature-issue-110111" holds on origin
    And the mock GitHub API recorded a merge of PR 110111

  @adw-1101 @adw-a6cot9-feat-adwmerge-re-run
  Scenario: The ADW TypeScript type-check passes once "post_merge_bdd_red" is a park reason that adwMerge writes and the park comment describes
    Then the ADW TypeScript type-check passes
