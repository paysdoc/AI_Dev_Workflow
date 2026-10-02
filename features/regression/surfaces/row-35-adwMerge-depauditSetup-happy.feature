@regression @surface
Feature: (no orchestrator) — depauditSetup — happy path

  No orchestrator has called executeDepauditSetup since adwInit.tsx was deleted, so the row calls it directly, through its deps seam.

  Scenario: depaudit setup issues "depaudit setup" in the worktree and sets the ADW host's SOCKET_API_TOKEN and SLACK_WEBHOOK_URL as Actions secrets of the target repository
    Given an issue 1035 exists in the mock issue tracker
    And the worktree for adwId "surface-35" is initialised at branch "surface-35"
    And the ADW host's environment holds a value for "SOCKET_API_TOKEN"
    And the ADW host's environment holds a value for "SLACK_WEBHOOK_URL"
    When the depaudit setup runs for adwId "surface-35"
    Then the depaudit setup issued the command "depaudit setup" in the worktree for adwId "surface-35"
    And the mock GitHub API recorded the Actions secret "SOCKET_API_TOKEN" being set on the repository "acme/widgets"
    And the mock GitHub API recorded the Actions secret "SLACK_WEBHOOK_URL" being set on the repository "acme/widgets"
