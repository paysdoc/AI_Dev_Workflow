@adw-wqzfqj-ensurecronprocess-no @adw-291 @adw-501 @adw-0lhdw4-webhook-call-ensurec
Feature: ensureCronProcess is called before webhook gates reject the event

  Originally (issue #291), `ensureCronProcess()` was buried deep inside the
  issue-processing happy path in `trigger_webhook.ts`, so any earlier gate
  (actionability, cooldown, eligibility) that rejected the event left the
  cron process unspawned. Issue #291 moved the call earlier — into each
  per-event handler — so the cron poller was always restarted regardless of
  whether the event led to a workflow spawn.

  Issue #501 supersedes that placement: `ensureCronProcess` now lives at the
  request handler top-level (after `ensureAppAuthForRepo`, before any
  per-event branching). The two original per-handler call sites have been
  removed to avoid double-calls, and every accepted webhook event — not just
  `issue_comment` and `issues.opened` — now triggers exactly one cron-spawn
  check. The negative-constraint scenarios below remain valid because
  `ensureCronProcess` must still not appear inside the deferred eligibility
  blocks (where it would be skipped on early-return paths). See
  `webhook_ensure_cron_on_every_event.feature` for the top-level placement
  scenarios that replace the per-handler ordering checks.

  Background:
    Given the ADW codebase is checked out

  @adw-wqzfqj-ensurecronprocess-no @adw-501 @regression
  Scenario: ensureCronProcess is not inside the async eligibility callback in the issue_comment handler
    Given "adws/triggers/trigger_webhook.ts" is read
    Then "ensureCronProcess" is not called inside the isAdwRunningForIssue then-callback in the issue_comment handler

  @adw-wqzfqj-ensurecronprocess-no @adw-fequcj-fix-fail-open-depend @adw-501 @regression
  Scenario: ensureCronProcess is not inside the eligibility block in the issues.opened handler
    Given "adws/triggers/trigger_webhook.ts" is read
    Then "ensureCronProcess" is not called inside the eligibility block in the issues opened handler

  @adw-wqzfqj-ensurecronprocess-no @adw-501 @regression
  Scenario: TypeScript type-check passes after the ensureCronProcess relocation
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
