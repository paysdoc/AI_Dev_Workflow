@adw-930 @adw-e3523g-bug-the-plan-commit @promotion-suggested-2026-10-04
Feature: The plan commit carries only the plan file, a guard fails the plan phase when the planner touches .claude/ or .adw/, and worktree setup leaves the framework's own tracked prompt files as the branch has them

  ADR-0056. Twice a plan commit undid a prompt change made minutes earlier: ca72a4a7 undid
  d45d708e, and c3606f9e undid bebda8dd. Both times the worktree's branch already carried the
  change, and the plan commit wrote back blob 923cbe33 of .claude/commands/scenario_writer.md, the
  version from before it. The triggers launch workflows with --target-repo, ADW's own repository
  included, and on that path initializeWorkflow copies the running framework checkout's
  .claude/commands and .claude/skills over the worktree without resetting it afterwards. The
  running checkout was behind the branch, so its older prompts became uncommitted changes, and the
  `git add -A` in the /commit command put them in the plan commit. That checkout lags the branch
  whenever `dev` carries prompt changes that `main` does not: ADR-0019 has the triggers run from a
  checkout of `main`, while worktrees branch from `dev`.

  The stand-in Claude CLI in these scenarios stages every change whenever it is asked to commit, as
  /commit does today, so only code can keep the plan commit to the plan file. No scenario puts a
  per-issue scenario file in the worktree: ADR-0056 leaves open whether that file belongs in the
  plan commit. In adwSdlc the scenario agent runs alongside the plan phase and may rewrite
  .adw/commands.md when it bootstraps Cucumber; no scenario here covers that overlap. No scenario
  pins what worktree setup does to a framework asset that an external target repository tracks:
  the fix may leave such a file alone or go on refreshing it.

  Background:
    Given the ADW codebase is checked out

  @adw-930 @adw-e3523g-bug-the-plan-commit @adw-963
  Scenario: The plan commit carries the plan file and leaves every other change in the worktree uncommitted
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
      | change              | path               |
      | creates             | docs/plan-notes.md |
      | modifies and stages | src/widget.ts      |
    When the plan phase runs
    Then the plan phase completes
    And the commits added during the plan phase carry the plan file and no other path
    And the worktree still has uncommitted changes to these files:
      | path               |
      | README.md          |
      | docs/plan-notes.md |
      | src/widget.ts      |

  @adw-930 @adw-e3523g-bug-the-plan-commit
  Scenario: Changes that worktree setup left under .claude/ before the plan phase neither fail the phase nor ride in the plan commit
    Given a worktree for a workflow on issue 4242 in the target repository "acme/widgets"
    And the worktree's branch tracks these files:
      | path                        |
      | .claude/commands/install.md |
    And worktree setup has left these changes in the worktree:
      | change   | path                        |
      | modifies | .claude/commands/install.md |
      | creates  | .claude/skills/tdd/SKILL.md |
    And the Claude CLI is a stand-in that stages every change in the worktree and commits it whenever it is asked to commit
    And the planner writes only the plan file
    When the plan phase runs
    Then the plan phase completes
    And the commits added during the plan phase carry the plan file and no other path
    And the worktree still has uncommitted changes to these files:
      | path                        |
      | .claude/commands/install.md |
      | .claude/skills/tdd/SKILL.md |

  @adw-930 @adw-e3523g-bug-the-plan-commit @adw-963
  Scenario Outline: A planner that <change> <path> fails the plan phase, and no commit added during the phase carries the path
    Given a worktree for a workflow on issue 4242 in the target repository "acme/widgets"
    And the worktree's branch tracks these files:
      | path                                |
      | .claude/commands/scenario_writer.md |
      | .claude/skills/tdd/SKILL.md         |
      | .adw/commands.md                    |
    And the Claude CLI is a stand-in that stages every change in the worktree and commits it whenever it is asked to commit
    And the planner writes the plan file and makes these changes in the worktree:
      | change   | path   |
      | <change> | <path> |
    When the plan phase runs
    Then the plan phase fails with an error that names "<path>"
    And no commit added during the plan phase carries "<path>"

    Examples:
      | change              | path                                |
      | modifies            | .claude/commands/scenario_writer.md |
      | creates             | .claude/commands/plan_checklist.md  |
      | deletes             | .claude/skills/tdd/SKILL.md         |
      | modifies and stages | .adw/commands.md                    |
      | creates             | .adw/plan_notes.md                  |

  @adw-930 @adw-e3523g-bug-the-plan-commit
  Scenario: A planner that commits its own change under .claude/ still fails the plan phase
    Given a worktree for a workflow on issue 4242 in the target repository "acme/widgets"
    And the worktree's branch tracks these files:
      | path                                |
      | .claude/commands/scenario_writer.md |
    And the Claude CLI is a stand-in that stages every change in the worktree and commits it whenever it is asked to commit
    And the planner writes the plan file, modifies ".claude/commands/scenario_writer.md" and commits everything itself
    When the plan phase runs
    Then the plan phase fails with an error that names ".claude/commands/scenario_writer.md"

  @adw-930 @adw-e3523g-bug-the-plan-commit @adw-963
  Scenario Outline: In the <phase>, the commit agent still commits every change in the worktree, including those under .claude/ and .adw/
    Given a worktree for a workflow on issue 4242 in the target repository "acme/widgets"
    And the worktree's branch tracks these files:
      | path                                |
      | README.md                           |
      | .claude/commands/scenario_writer.md |
      | .adw/conditional_docs.md            |
    And the worktree has uncommitted changes to these files:
      | path                                |
      | README.md                           |
      | .claude/commands/scenario_writer.md |
      | .adw/conditional_docs.md            |
    And the Claude CLI is a stand-in that stages every change in the worktree and commits it whenever it is asked to commit
    When the "<agent>" commits its work through the commit agent, as its phase does
    Then the commit recorded on the worktree branch carries these files:
      | path                                |
      | README.md                           |
      | .claude/commands/scenario_writer.md |
      | .adw/conditional_docs.md            |

    Examples:
      | phase                 | agent                  |
      | plan validation phase | validation-agent       |
      | alignment phase       | alignment-agent        |
      | build phase           | build-agent            |
      | review phase          | review-patch-agent     |
      | scenario fix phase    | scenario-fix-agent     |
      | document phase        | document-agent         |
      | PR phase              | pre-pr-commit          |
      | PR review workflow    | pr-review-orchestrator |

  @adw-930 @adw-e3523g-bug-the-plan-commit
  Scenario Outline: Worktree setup leaves the framework's own tracked <asset> file as the branch has it when the checkout running the workflow holds an older copy
    Given a worktree of the framework's own repository whose branch carries a newer "<path>" than the framework checkout running the workflow
    When worktree setup copies the framework's Claude assets into the worktree
    Then the worktree's "<path>" is the copy its branch carries
    And the worktree has no uncommitted change to "<path>"

    Examples:
      | asset   | path                                |
      | command | .claude/commands/scenario_writer.md |
      | skill   | .claude/skills/tdd/SKILL.md         |

  @adw-930 @adw-e3523g-bug-the-plan-commit
  Scenario: Worktree setup still copies the framework's Claude assets into a target repository that tracks none of them
    Given a worktree of a target repository that tracks nothing under ".claude/"
    When worktree setup copies the framework's Claude assets into the worktree
    Then git lists ".claude/commands/feature.md" among the worktree's ignored files
    And git lists ".claude/commands/install.md" among the worktree's untracked files that are not ignored

  @adw-930 @adw-e3523g-bug-the-plan-commit
  Scenario: The ADW TypeScript type-check passes with the plan-commit guard in place
    Then the ADW TypeScript type-check passes

  @adw-930 @adw-e3523g-bug-the-plan-commit
  Scenario: The git/gh guard stays green over the plan phase's git calls
    When the git/gh guard is run across the repository
    Then the git/gh guard reports no violations
