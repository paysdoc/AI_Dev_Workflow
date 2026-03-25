@adw-wqzfqj-ensurecronprocess-no @adw-291
Feature: ensureCronProcess is called before webhook gates reject the event

  `ensureCronProcess()` was only called deep inside the issue-processing happy
  path in `trigger_webhook.ts`. If any earlier gate (actionability, cooldown,
  eligibility) rejected the webhook event, the dead cron process was never
  respawned. The fix moves the `ensureCronProcess` call earlier — after repo
  info is extracted but before any issue-specific gating logic — so the cron
  poller is always restarted regardless of whether the triggering event leads
  to a workflow spawn.

  Background:
    Given the ADW codebase is checked out

  @adw-wqzfqj-ensurecronprocess-no @regression
  Scenario: ensureCronProcess is called before isActionableComment in the issue_comment handler
    Given "adws/triggers/trigger_webhook.ts" is read
    Then in the issue_comment handler "ensureCronProcess" is called before "isActionableComment"

  @adw-wqzfqj-ensurecronprocess-no @regression
  Scenario: ensureCronProcess is called before shouldTriggerIssueWorkflow in the issue_comment handler
    Given "adws/triggers/trigger_webhook.ts" is read
    Then in the issue_comment handler "ensureCronProcess" is called before "shouldTriggerIssueWorkflow"

  @adw-wqzfqj-ensurecronprocess-no @regression
  Scenario: ensureCronProcess is not inside the async eligibility callback in the issue_comment handler
    Given "adws/triggers/trigger_webhook.ts" is read
    Then "ensureCronProcess" is not called inside the isAdwRunningForIssue then-callback in the issue_comment handler

  @adw-wqzfqj-ensurecronprocess-no @regression
  Scenario: ensureCronProcess is called before checkIssueEligibility in the issues.opened handler
    Given "adws/triggers/trigger_webhook.ts" is read
    Then in the issues opened handler "ensureCronProcess" is called before "checkIssueEligibility"

  @adw-wqzfqj-ensurecronprocess-no @regression
  Scenario: ensureCronProcess is not inside the eligibility block in the issues.opened handler
    Given "adws/triggers/trigger_webhook.ts" is read
    Then "ensureCronProcess" is not called inside the eligibility block in the issues opened handler

  @adw-wqzfqj-ensurecronprocess-no @regression
  Scenario: TypeScript type-check passes after the ensureCronProcess relocation
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
