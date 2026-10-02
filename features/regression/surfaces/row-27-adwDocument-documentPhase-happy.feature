@regression @surface
Feature: adwSdlc — documentPhase — happy path

  adwDocument runs the document agent itself, never the document phase. adwSdlc runs the document phase once review passes, under no phase name, so the phase records no stage of its own.

  Scenario: sdlc orchestrator's document phase runs in-process, succeeds, pushes the branch and posts its document stage comments
    Given an issue 1027 exists in the mock issue tracker
    And the worktree for adwId "surface-27" is initialised at branch "surface-27"
    And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/surface-document-phase.json"
    When the "document" phase of the "sdlc" orchestrator runs for adwId "surface-27"
    Then the "document" phase run succeeded
    And the git-mock recorded a push to branch "surface-27"
    And the mock GitHub API recorded a comment on issue 1027
    And the mock GitHub API recorded a comment containing the text "**Stage:** document_running"
    And the mock GitHub API recorded a comment containing the text "**Stage:** document_completed"
