@regression @surface
Feature: adwBuild — installPhase — happy path

  No adwInit orchestrator exists. adwBuild runs the install phase under the phase name "install", as adwPatch and adwPrReview do.

  Scenario: build orchestrator's install phase runs in-process and records install_completed
    Given an issue 1018 exists in the mock issue tracker
    And the worktree for adwId "surface-18" is initialised at branch "surface-18"
    And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/surface-install-phase.json"
    When the "install" phase of the "build" orchestrator runs for adwId "surface-18"
    Then the state file for adwId "surface-18" records workflowStage "install_completed"
