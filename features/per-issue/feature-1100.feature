@adw-1100 @adw-4tx10n-bug-adwmerge-treats
Feature: When GitHub refuses to merge a pull request whose branch the local merge check finds clean, adwMerge treats the refusal as stale and asks again after 3, 6, 12 and 24 seconds without running "/resolve_conflict"; a branch the check finds in conflict still goes through "/resolve_conflict"; the "ADW Merge Blocked" comment says what was tried; and adwMerge saves its output in "logs/<adwId>/merge.log"

  The local merge check is "git merge-tree --write-tree origin/<base> HEAD", run in the workflow's worktree after a fresh fetch of the base branch.

  Background:
    Given the ADW codebase is checked out

  @adw-1100 @adw-4tx10n-bug-adwmerge-treats
  Scenario Outline: The local merge check finds the branch clean, so GitHub's refusal "<error>" is treated as stale: ADW asks again after 3 and then 6 seconds, never runs "/resolve_conflict", and the third merge call merges the pull request
    Given the workflow "<adwId>" for issue <issue> is awaiting the merge of pull request <issue> from the branch "feature-issue-<issue>" into "dev"
    And the branch "feature-issue-<issue>" merges cleanly into "dev" on origin
    And GitHub answers the calls to merge pull request <issue> in this order:
      | merge call | GitHub answers |
      | 1          | <error>        |
      | 2          | <error>        |
      | 3          | merged         |
    When the merge orchestrator runs the workflow "<adwId>"
    Then the state file for adwId "<adwId>" records workflowStage "completed"
    And GitHub was asked 3 times to merge pull request <issue>
    And ADW waited before the later merge calls of pull request <issue> as follows:
      | merge call | wait before it |
      | 2          | 3 seconds      |
      | 3          | 6 seconds      |
    And the "/resolve_conflict" agent was never run

    Examples:
      | adwId                 | issue  | error                                                                                          |
      | merge1100-modified    | 110001 | GraphQL: Base branch was modified. Review and try the merge again. (mergePullRequest)          |
      | merge1100-conflicts   | 110002 | GraphQL: Pull Request has merge conflicts (mergePullRequest)                                   |
      | merge1100-uncreatable | 110003 | Pull request acme/widgets#110003 is not mergeable: the merge commit cannot be cleanly created. |

  @adw-1100 @adw-4tx10n-bug-adwmerge-treats
  Scenario Outline: After "/resolve_conflict" resolves real conflicts and ADW pushes the merge commit, GitHub's stale refusal "<error>" of the first merge call is retried after 3 seconds without running "/resolve_conflict" again, and the second merge call merges the pull request
    Given the workflow "<adwId>" for issue <issue> is awaiting the merge of pull request <issue> from the branch "feature-issue-<issue>" into "dev"
    And the branch "feature-issue-<issue>" conflicts with "dev" on origin
    And the "/resolve_conflict" agent resolves the conflicts with a merge commit
    And GitHub answers the calls to merge pull request <issue> in this order:
      | merge call | GitHub answers |
      | 1          | <error>        |
      | 2          | merged         |
    When the merge orchestrator runs the workflow "<adwId>"
    Then the state file for adwId "<adwId>" records workflowStage "completed"
    And the "/resolve_conflict" agent ran once
    And the branch "feature-issue-<issue>" on origin holds the merge commit the "/resolve_conflict" agent made
    And GitHub was asked 2 times to merge pull request <issue>
    And ADW waited before the later merge calls of pull request <issue> as follows:
      | merge call | wait before it |
      | 2          | 3 seconds      |

    Examples:
      | adwId                      | issue  | error                                                                                 |
      | merge1100-pushed-modified  | 110004 | GraphQL: Base branch was modified. Review and try the merge again. (mergePullRequest) |
      | merge1100-pushed-conflicts | 110005 | GraphQL: Pull Request has merge conflicts (mergePullRequest)                          |

  @adw-1100 @adw-4tx10n-bug-adwmerge-treats
  Scenario: When a conflicting commit lands on "dev" between ADW's push and its first merge call, the local merge check, run after a fresh fetch, finds the conflicts, and ADW resolves them with "/resolve_conflict" before it asks GitHub again
    Given the workflow "merge1100-moved" for issue 110006 is awaiting the merge of pull request 110006 from the branch "feature-issue-110006" into "dev"
    And the branch "feature-issue-110006" merges cleanly into "dev" on origin
    And a commit that conflicts with the branch "feature-issue-110006" lands on "dev" on origin between ADW's push and its first call to merge pull request 110006
    And the "/resolve_conflict" agent resolves the conflicts with a merge commit
    And GitHub answers the calls to merge pull request 110006 in this order:
      | merge call | GitHub answers                                               |
      | 1          | GraphQL: Pull Request has merge conflicts (mergePullRequest) |
      | 2          | merged                                                       |
    When the merge orchestrator runs the workflow "merge1100-moved"
    Then the state file for adwId "merge1100-moved" records workflowStage "completed"
    And the "/resolve_conflict" agent ran once
    And the branch "feature-issue-110006" on origin holds the merge commit the "/resolve_conflict" agent made, which merges in the commit that landed on "dev"
    And GitHub was asked 2 times to merge pull request 110006

  @adw-1100 @adw-4tx10n-bug-adwmerge-treats
  Scenario Outline: When the local merge check finds the branch clean but GitHub refuses all 5 merge calls, ADW sets the workflow to "merge_blocked" after waiting 3, 6, 12 and 24 seconds, and the "ADW Merge Blocked" comment says that there were 5 merge attempts, that conflict resolution <resolution>, that the local merge check was clean, and quotes the last error
    Given the workflow "<adwId>" for issue <issue> is awaiting the merge of pull request <issue> from the branch "feature-issue-<issue>" into "dev"
    And the branch "feature-issue-<issue>" <relation> "dev" on origin
    And the "/resolve_conflict" agent resolves the conflicts with a merge commit
    And GitHub refuses every call to merge pull request <issue> with "GraphQL: Base branch was modified. Review and try the merge again. (mergePullRequest)"
    When the merge orchestrator runs the workflow "<adwId>"
    Then the state file for adwId "<adwId>" records workflowStage "merge_blocked"
    And GitHub was asked 5 times to merge pull request <issue>
    And ADW waited before the later merge calls of pull request <issue> as follows:
      | merge call | wait before it |
      | 2          | 3 seconds      |
      | 3          | 6 seconds      |
      | 4          | 12 seconds     |
      | 5          | 24 seconds     |
    And the "/resolve_conflict" agent <agent runs>
    And issue <issue> received exactly one "## ADW Merge Blocked" comment
    And the "ADW Merge Blocked" comment on issue <issue> says that there were 5 merge attempts
    And the "ADW Merge Blocked" comment on issue <issue> says that conflict resolution <resolution>
    And the "ADW Merge Blocked" comment on issue <issue> says that the local merge check was clean against "dev"
    And the "ADW Merge Blocked" comment on issue <issue> quotes the last error "GraphQL: Base branch was modified. Review and try the merge again. (mergePullRequest)"
    And the "ADW Merge Blocked" comment on issue <issue> does not contain "multiple conflict-resolution attempts"

    Examples:
      | adwId                   | issue  | relation            | agent runs    | resolution  |
      | merge1100-blocked-clean | 110007 | merges cleanly into | was never run | did not run |
      | merge1100-blocked-after | 110008 | conflicts with      | ran once      | ran         |

  @adw-1100 @adw-4tx10n-bug-adwmerge-treats
  Scenario: When "/resolve_conflict" fails to resolve real conflicts on every attempt, ADW sets the workflow to "merge_blocked", and the "ADW Merge Blocked" comment says that there were 0 merge attempts, that conflict resolution ran, and that the local merge check found conflicts
    Given the workflow "merge1100-unresolved" for issue 110009 is awaiting the merge of pull request 110009 from the branch "feature-issue-110009" into "dev"
    And the branch "feature-issue-110009" conflicts with "dev" on origin
    And the "/resolve_conflict" agent fails to resolve the conflicts
    When the merge orchestrator runs the workflow "merge1100-unresolved"
    Then the state file for adwId "merge1100-unresolved" records workflowStage "merge_blocked"
    And GitHub was never asked to merge pull request 110009
    And issue 110009 received exactly one "## ADW Merge Blocked" comment
    And the "ADW Merge Blocked" comment on issue 110009 says that there were 0 merge attempts
    And the "ADW Merge Blocked" comment on issue 110009 says that conflict resolution ran
    And the "ADW Merge Blocked" comment on issue 110009 says that the local merge check found conflicts with "dev"

  @adw-1100 @adw-4tx10n-bug-adwmerge-treats @subprocess
  Scenario: The merge orchestrator saves its output in "logs/<adwId>/merge.log": after it merges a still-open pull request, the log holds every line it printed about the pull request, a timestamped "Auto-merge attempt" line among them
    Given an issue 110010 exists in the mock issue tracker
    And a workflow for adwId "surface-1100-10" is awaiting merge of PR 110010 from branch "surface-1100-10"
    When the "merge" orchestrator is invoked with adwId "surface-1100-10" and issue 110010
    Then the orchestrator subprocess exited 0
    And the mock GitHub API recorded a merge of PR 110010
    And the merge log "logs/surface-1100-10/merge.log" holds every line the orchestrator subprocess printed about PR #110010
    And the merge log "logs/surface-1100-10/merge.log" holds a timestamped "Auto-merge attempt" line for PR #110010
