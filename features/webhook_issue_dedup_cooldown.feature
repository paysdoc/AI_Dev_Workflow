@adw-8af0pz-add-issue-level-dedu
Feature: Issue-level webhook deduplication prevents concurrent workflow spawning

  A single "## Take action" comment must not spawn multiple concurrent workflows when
  GitHub delivers the webhook event more than once within 60 seconds. The
  `issue_comment` handler in `trigger_webhook.ts` must be gated by a
  `recentIssueTriggers` Map and a `shouldTriggerIssueWorkflow` function, mirroring
  the existing `recentPrReviewTriggers` / `shouldTriggerPrReview` pattern.

  Additionally, `extractAdwIdFromComment` in `workflowCommentParsing.ts` must use a
  regex that matches the actual ADW ID format produced by `generateAdwId`:
  `{random}-{slug}` — no `adw-` prefix. The old regex requiring an `adw-` prefix
  never matched, causing `recoveryState.adwId` to always be null.

  Background:
    Given the ADW codebase is checked out

  @adw-8af0pz-add-issue-level-dedu @regression
  Scenario: trigger_webhook.ts declares recentIssueTriggers Map and shouldTriggerIssueWorkflow
    Given "adws/triggers/trigger_webhook.ts" is read
    Then the file contains "recentIssueTriggers"
    And the file contains "shouldTriggerIssueWorkflow"

  @adw-8af0pz-add-issue-level-dedu @regression
  Scenario: shouldTriggerIssueWorkflow is called in the issue_comment handler before classifyAndSpawnWorkflow
    Given "adws/triggers/trigger_webhook.ts" is read
    Then "shouldTriggerIssueWorkflow" is called in the issue_comment handler before "classifyAndSpawnWorkflow"

  @adw-8af0pz-add-issue-level-dedu @regression
  Scenario: Issue-level cooldown mirrors the 60-second PR review cooldown
    Given "adws/triggers/trigger_webhook.ts" is read
    Then the shouldTriggerIssueWorkflow function uses a 60-second cooldown

  @adw-8af0pz-add-issue-level-dedu @regression
  Scenario: extractAdwIdFromComment regex does not require adw- prefix
    Given "adws/core/workflowCommentParsing.ts" is read
    Then the extractAdwIdFromComment regex does not require an "adw-" prefix

  @adw-8af0pz-add-issue-level-dedu @regression
  Scenario: extractAdwIdFromComment correctly extracts a {random}-{slug} format ADW ID
    Given a comment body containing the backtick-wrapped ADW ID "8kp95r-remove-run-bdd-scena"
    When extractAdwIdFromComment is called on the comment body
    Then the returned ADW ID is "8kp95r-remove-run-bdd-scena"

  @adw-8af0pz-add-issue-level-dedu @regression
  Scenario: extractAdwIdFromComment returns null when no backtick-wrapped ADW ID is present
    Given a comment body with no backtick-wrapped ADW ID
    When extractAdwIdFromComment is called on the comment body
    Then extractAdwIdFromComment returns null

  @adw-8af0pz-add-issue-level-dedu
  Scenario: recentIssueTriggers and recentPrReviewTriggers are separate module-level Maps
    Given "adws/triggers/trigger_webhook.ts" is read
    Then the file contains "recentPrReviewTriggers"
    And the file contains "recentIssueTriggers"

  @adw-8af0pz-add-issue-level-dedu
  Scenario: shouldTriggerIssueWorkflow is not exported from trigger_webhook.ts
    Given "adws/triggers/trigger_webhook.ts" is read
    Then "shouldTriggerIssueWorkflow" is not exported from the file

  @adw-8af0pz-add-issue-level-dedu
  Scenario: Duplicate issue_comment delivery within cooldown window returns ignored response
    Given "adws/triggers/trigger_webhook.ts" is read
    Then the issue_comment handler returns an ignored response when shouldTriggerIssueWorkflow returns false
