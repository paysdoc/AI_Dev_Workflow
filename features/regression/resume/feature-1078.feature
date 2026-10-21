@regression @subprocess @plan-lost-on-resume
Feature: A workflow whose worktree is removed between its plan and its build, and that is then resumed, records the stage "worktree_lost" and posts no second plan-created comment

  The plan is never committed: it lives only in the worktree of the run that wrote it. The real SDLC
  orchestrator runs as a child process through the hermetic subprocess harness. Its first run creates
  the plan, and a rate limit pauses it during its build. The worktree is then removed, leaving the
  branch, and the orchestrator is invoked again under the same adwId, as `## Retry` respawns a paused
  workflow. The resumed run rebuilds the worktree from the branch, finds no plan, and parks as
  "worktree_lost" instead of running the planner a second time.

  Background:
    Given the ADW codebase is checked out

  @adw-1078
  Scenario: An SDLC workflow paused by a rate limit during its build, whose worktree is then removed, is parked as "worktree_lost" when it is resumed: it exits 0, runs neither the planner nor the build again, posts no second "Implementation Plan Created" comment, and its park comment names "worktree_lost"
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/adw-sdlc-paused-at-build.json"
    And an issue 107801 exists in the mock issue tracker
    When the "sdlc" orchestrator is invoked with adwId "worktree-lost-smoke-107801" and issue 107801
    Then the state file for adwId "worktree-lost-smoke-107801" records workflowStage "paused"
    And the mock GitHub API recorded exactly 1 comment on issue 107801 containing the text "## :white_check_mark: Implementation Plan Created"
    When the worktree of the workflow for adwId "worktree-lost-smoke-107801" is removed, leaving its branch
    And the "sdlc" orchestrator is invoked with adwId "worktree-lost-smoke-107801" and issue 107801
    Then the orchestrator subprocess exited 0
    And the state file for adwId "worktree-lost-smoke-107801" records workflowStage "worktree_lost"
    And the mock GitHub API recorded exactly 1 comment on issue 107801 containing the text "## :white_check_mark: Implementation Plan Created"
    And the mock GitHub API recorded exactly 1 comment on issue 107801 containing the text "## :pencil: Building Implementation Plan"
    And the mock GitHub API recorded exactly 1 comment on issue 107801 containing the text "## :hammer_and_wrench: Running Build"
    And the mock harness recorded zero comment posts on issue 107801 containing the text "ADW Workflow Error"
    And the mock GitHub API recorded a comment containing the text "worktree_lost"
