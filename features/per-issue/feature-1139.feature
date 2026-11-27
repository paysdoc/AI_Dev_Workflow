@adw-1139 @adw-2bkxqv-declared-boundary-li
Feature: The scenario test phase checks the boundary tags of the issue's scenarios against the Real Boundaries the target declares
  A target lists its Real Boundaries in its scenario configuration, and every scenario names the one it drives with a boundary tag.

  @adw-1139 @adw-2bkxqv-declared-boundary-li @subprocess @boundary-subprocess
  Scenario: adwSdlc, in a target that declares its Real Boundaries, fails the issue's scenario that carries no boundary tag before running the scenarios, although the scenario runner would pass it, and hands it to the scenario fix agent instead of going on to review
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/adw-sdlc-missing-boundary-tag.json"
    And an issue 113901 exists in the mock issue tracker
    And the target repository's scenario configuration declares the Real Boundary "cli"
    And the target repository's workspace runs its scenarios by tag with a stand-in that passes every scenario
    And the scenario agent writes the scenario "Orders are listed" for issue 113901 with no boundary tag
    And the scenario fix agent leaves the scenario "Orders are listed" without a boundary tag
    When the "sdlc" orchestrator is invoked with adwId "boundary-smoke-113901" and issue 113901
    Then the scenario fix agent was handed the scenario "Orders are listed" as failing because it carries no boundary tag
    And the stand-in ran no scenario
    And the mock harness recorded zero comment posts on issue 113901 containing the text "## :mag: Review Running"
    And the state file for adwId "boundary-smoke-113901" records workflowStage "abandoned"

  @adw-1139 @adw-2bkxqv-declared-boundary-li @subprocess @boundary-subprocess
  Scenario: adwSdlc, in a target that declares its Real Boundaries, runs a regression scenario that carries no boundary tag without failing it, passes the issue's scenario tagged with a declared boundary, and ends awaiting merge without starting the scenario fix agent
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/adw-sdlc-declared-boundary-tag.json"
    And an issue 113902 exists in the mock issue tracker
    And the target repository's scenario configuration declares the Real Boundary "cli"
    And the target repository's workspace runs its scenarios by tag with a stand-in that passes every scenario
    And the target repository's Regression Suite holds the scenario "Orders are accepted", which carries no boundary tag
    And the scenario agent writes the scenario "Orders are listed" for issue 113902, tagged with the declared boundary "cli"
    When the "sdlc" orchestrator is invoked with adwId "boundary-smoke-113902" and issue 113902
    Then the orchestrator subprocess exited 0
    And the state file for adwId "boundary-smoke-113902" records workflowStage "awaiting_merge"
    And the stand-in ran the scenarios of both "@regression" and "@adw-113902"
    And the scenario fix agent was not started
