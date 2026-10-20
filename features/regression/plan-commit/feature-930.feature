@regression @plan-worktree-only
Feature: The plan phase leaves the plan in the worktree, and no commit on the branch touches "specs/"

  The plan is a per-run working file. The planner writes it under specs/ in the worktree, the later
  phases read it there by path, and it goes when the worktree goes. The plan phase commits nothing.
  The stand-in Claude CLI stages and commits every change whenever it is asked to commit, as /commit
  does, and this worktree does not ignore specs/, so a plan phase that asked for any commit would put
  the plan on the branch.

  Background:
    Given the ADW codebase is checked out

  @adw-1077
  Scenario: After the plan phase the branch has no commit touching "specs/" and the worktree holds the plan
    Given a worktree for a workflow on issue 4242 in the target repository "acme/widgets"
    And the Claude CLI is a stand-in that stages every change in the worktree and commits it whenever it is asked to commit
    And the planner writes only the plan file
    When the plan phase runs
    Then the plan phase completes
    And the worktree's branch has no commit touching "specs/"
    And the worktree holds the plan file
