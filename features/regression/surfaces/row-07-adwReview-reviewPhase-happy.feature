@regression @surface
Feature: adwReview — reviewPhase — happy path

  # Row 7: review phase runs; orchestrator posts comment to mock API.
  Scenario: review orchestrator completes review phase and posts a comment
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/adw-sdlc-happy.json"
    And an issue 1007 exists in the mock issue tracker
    And the mock GitHub API records all PR-list calls
    And the claude-cli-stub is loaded with fixture "review-agent.json"
    And the worktree for adwId "surface-07" is initialised at branch "surface-07"
    When the "review" orchestrator is invoked with adwId "surface-07" and issue 1007
    Then the mock GitHub API recorded a comment on issue 1007
    And the orchestrator subprocess exited 0
