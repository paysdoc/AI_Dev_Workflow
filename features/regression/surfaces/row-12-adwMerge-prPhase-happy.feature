@regression @surface
Feature: adwPatch — prPhase — happy path

  adwMerge runs no PR phase. adwPatch runs it, under the phase name "pr".

  Scenario: patch orchestrator's PR phase runs in-process, pushes the branch, opens a pull request for the issue, posts its PR stage comments and records pr_completed
    Given an issue 1012 exists in the mock issue tracker
    And the worktree for adwId "surface-12" is initialised at branch "surface-12"
    And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/surface-pr-phase.json"
    When the "pr" phase of the "patch" orchestrator runs for adwId "surface-12"
    Then the state file for adwId "surface-12" records workflowStage "pr_completed"
    And the git-mock recorded a push to branch "surface-12"
    And the mock GitHub API recorded a PR creation for issue 1012
    And the mock GitHub API recorded a comment on issue 1012
    And the mock GitHub API recorded a comment containing the text "## :memo: Creating Pull Request"
    And the mock GitHub API recorded a comment containing the text "## :link: Pull Request Created"
