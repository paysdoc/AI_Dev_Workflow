@regression @surface
Feature: depauditSetup — happy path, run by no orchestrator

  No orchestrator has called executeDepauditSetup since adwInit.tsx was deleted, so the row calls it directly, through its deps seam.

  Scenario: the dependency-audit setup runs depaudit setup in the worktree and sets both secrets on the repository
    Given an issue 1035 exists in the mock issue tracker
    And the worktree for adwId "surface-35" is initialised at branch "surface-35"
    When the dependency-audit setup runs for adwId "surface-35" on a host whose environment sets every secret it propagates
    Then the dependency-audit setup ran the command "depaudit setup" in the worktree for adwId "surface-35"
    And the mock GitHub API recorded the Actions secret "SOCKET_API_TOKEN" set on the repository "acme/widgets"
    And the mock GitHub API recorded the Actions secret "SLACK_WEBHOOK_URL" set on the repository "acme/widgets"
