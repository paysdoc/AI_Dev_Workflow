@regression @surface
Feature: adwPatch — installPhase — happy path

  No adwInit orchestrator exists. adwPatch runs the install phase under the phase name "install", as adwBuild and adwPrReview do.

  Scenario: patch orchestrator's install phase runs in-process, succeeds and records install_completed
    Given an issue 1018 exists in the mock issue tracker
    And the worktree for adwId "surface-18" is initialised at branch "surface-18"
    And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/surface-install-phase.json"
    When the "install" phase of the "patch" orchestrator runs for adwId "surface-18"
    Then the "install" phase run succeeded
    And the state file for adwId "surface-18" records workflowStage "install_completed"
