@adw-1077 @adw-9skpoc-feat-retire-the-plan @promotion-suggested-2026-10-23
Feature: The plan stays in the worktree: worktree setup has git ignore "specs/" through the repository's tracked ".gitignore", and the plan phase commits nothing and posts no "Committing Plan" comment

  Worktree setup is what ADW does to each worktree it creates for a workflow, before the first phase runs.

  Background:
    Given the ADW codebase is checked out

  @adw-1077 @adw-9skpoc-feat-retire-the-plan @plan-worktree-only
  Scenario Outline: Worktree setup in a fresh worktree of <repository> adds "specs/" to the tracked ".gitignore", so git ignores every plan under "specs/" and ".gitignore" carries the entry as an uncommitted change
    Given a fresh worktree of <repository>, whose branch tracks a ".gitignore" that does not name "specs/"
    When worktree setup runs in the worktree
    Then git ignores "specs/issue-4242-adw-a1b2c3-sdlc_planner-plan.md" in the worktree by the entry "specs/" of ".gitignore"
    And the worktree has an uncommitted change to ".gitignore"

    Examples:
      | repository                           |
      | the target repository "acme/widgets" |
      | the framework's own repository       |

  @adw-1077 @adw-9skpoc-feat-retire-the-plan @plan-worktree-only
  Scenario: Worktree setup in a fresh worktree whose branch tracks no ".gitignore" writes one that has git ignore every plan under "specs/", for the next commit to add
    Given a fresh worktree of the target repository "acme/widgets", whose branch tracks no ".gitignore"
    When worktree setup runs in the worktree
    Then git ignores "specs/issue-4242-adw-a1b2c3-sdlc_planner-plan.md" in the worktree by the entry "specs/" of ".gitignore"
    And git lists ".gitignore" among the worktree's untracked files that are not ignored

  @adw-1077 @adw-9skpoc-feat-retire-the-plan @plan-worktree-only
  Scenario: Worktree setup run a second time in the same worktree leaves ".gitignore" as the first run left it, so "specs/" is named only once
    Given a fresh worktree of the target repository "acme/widgets", whose branch tracks a ".gitignore" that does not name "specs/"
    And worktree setup has run in the worktree
    When worktree setup runs in the worktree again
    Then the worktree's ".gitignore" is as the first run of worktree setup left it

  @adw-1077 @adw-9skpoc-feat-retire-the-plan @plan-worktree-only
  Scenario: Worktree setup in a later worktree, whose branch already tracks the ".gitignore" an earlier worktree setup wrote, leaves ".gitignore" as the branch has it, and git still ignores every plan under "specs/"
    Given a fresh worktree of the target repository "acme/widgets", whose branch tracks the ".gitignore" an earlier worktree setup wrote
    When worktree setup runs in the worktree
    Then the worktree has no uncommitted change to ".gitignore"
    And git ignores "specs/issue-4242-adw-a1b2c3-sdlc_planner-plan.md" in the worktree by the entry "specs/" of ".gitignore"

  @adw-1077 @adw-9skpoc-feat-retire-the-plan @plan-worktree-only
  Scenario: In a worktree where git does not ignore "specs/", the plan phase adds no commit to the branch, and the plan and every other change stay uncommitted in the worktree
    Given a worktree for a workflow on issue 4242 in the target repository "acme/widgets"
    And the worktree's branch tracks these files:
      | path          |
      | README.md     |
      | src/widget.ts |
    And the worktree has uncommitted changes to these files:
      | path      |
      | README.md |
    And the Claude CLI is a stand-in that stages every change in the worktree and commits it whenever it is asked to commit
    And the planner writes the plan file and makes these changes in the worktree:
      | change              | path          |
      | modifies and stages | src/widget.ts |
    When the plan phase runs
    Then the plan phase completes
    And the plan phase added no commit to the worktree's branch
    And the worktree holds the plan file
    And the worktree still has uncommitted changes to these files:
      | path          |
      | README.md     |
      | src/widget.ts |

  @adw-1077 @adw-9skpoc-feat-retire-the-plan @plan-worktree-only
  Scenario: A planner that changes files under ".claude/" and ".adw/" no longer fails the plan phase, which adds no commit and leaves those changes uncommitted in the worktree
    Given a worktree for a workflow on issue 4242 in the target repository "acme/widgets"
    And the worktree's branch tracks these files:
      | path                                |
      | .claude/commands/scenario_writer.md |
      | .adw/commands.md                    |
    And the Claude CLI is a stand-in that stages every change in the worktree and commits it whenever it is asked to commit
    And the planner writes the plan file and makes these changes in the worktree:
      | change              | path                                |
      | modifies            | .claude/commands/scenario_writer.md |
      | modifies and stages | .adw/commands.md                    |
    When the plan phase runs
    Then the plan phase completes
    And the plan phase added no commit to the worktree's branch
    And the worktree still has uncommitted changes to these files:
      | path                                |
      | .claude/commands/scenario_writer.md |
      | .adw/commands.md                    |

  @adw-1077 @adw-9skpoc-feat-retire-the-plan
  Scenario: A full adwSdlc run against the fixture repository posts the plan's path and summary but no "Committing Plan" comment, adds no commit touching "specs/" to its branch, and leaves the plan in the worktree, ignored through the ".gitignore" its branch commits
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/adw-sdlc-happy.json"
    And an issue 100 exists in the mock issue tracker
    When the "sdlc" orchestrator is invoked with adwId "sdlc-smoke-100" and issue 100
    Then the orchestrator subprocess exited 0
    And the state file for adwId "sdlc-smoke-100" records workflowStage "awaiting_merge"
    And the mock GitHub API recorded a comment containing the text "**Plan file:** `specs/issue-100-adw-sdlc-smoke-100-sdlc_planner-sdlc-smoke.md`"
    And the mock GitHub API recorded a comment containing the text "# Implementation Plan: sdlc smoke"
    And the mock harness recorded zero comment posts on issue 100 containing the text "Committing Plan"
    And the branch of the workflow for adwId "sdlc-smoke-100" has no commit touching "specs/"
    And the worktree of the workflow for adwId "sdlc-smoke-100" still holds "specs/issue-100-adw-sdlc-smoke-100-sdlc_planner-sdlc-smoke.md", which git ignores
    And the ".gitignore" committed on the branch of the workflow for adwId "sdlc-smoke-100" has git ignore "specs/issue-100-adw-sdlc-smoke-100-sdlc_planner-sdlc-smoke.md"
