@regression @smoke @webhook
Feature: Cancel Directive — Trigger-Side Full Reset (Scorched-Earth Flow)

  `## Cancel` is not an orchestrator stage. The trigger that receives the comment resets the
  issue's workflow itself (ADR-0032). The real `dispatchWebhookEvent` receives a signed
  `issue_comment` event in-process and hands the directive to the cancel handler. For each adwId
  found in the issue's ADW workflow comments, the handler stops the orchestrator process that the
  adwId's state names and deletes that state. It removes the issue's worktrees with their branches
  and deletes every comment on the issue. It posts nothing, so nothing of the cancelled run remains
  on the issue. The seeded state names no process, so nothing is signalled.

  Scenario: a signed ## Cancel comment deletes the workflow's state, removes the issue's worktree and its branch, and deletes every comment on the issue, posting none
    Given an issue 500 exists in the mock issue tracker
    And a prior run for adwId "cancel-smoke-500" recorded workflowStage "build_running" for the repository "acme/widgets"
    And the target repository's workspace holds a worktree for issue 500 on the branch "feature-issue-500-cancel-smoke"
    And issue 500 holds an ADW workflow comment for adwId "cancel-smoke-500"
    And the webhook secret is set to "adw-regression-webhook-secret"
    When the webhook receives the comment "## Cancel" on issue 500 from the repository "acme/widgets", signed with the secret "adw-regression-webhook-secret"
    Then the checkout holds no state for adwId "cancel-smoke-500"
    And the target repository's workspace holds no worktree for issue 500
    And the target repository's workspace holds no branch "feature-issue-500-cancel-smoke"
    And the mock GitHub API recorded the deletion of every comment on issue 500
    And the mock harness recorded zero comment posts on issue 500
