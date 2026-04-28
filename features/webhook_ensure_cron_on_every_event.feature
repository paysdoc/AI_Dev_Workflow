@adw-501 @adw-0lhdw4-webhook-call-ensurec @adw-n96c4j-webhook-call-ensurec
Feature: Webhook server ensures a cron process on every accepted event

  The auto-merge sweep runs only when a cron polls the repo
  (`trigger_cron.ts`). The webhook explicitly does **not** dispatch `adwMerge`
  on approved reviews — instead it relies on the cron to sweep `awaiting_merge`
  issues. Previously, `ensureCronProcess` was only called from the
  `issue_comment` and `issues.opened` branches, so any other inbound event
  (e.g. a `pull_request_review` with `state=approved`) would leave a repo
  with no running cron, stranding PRs in `awaiting_merge` indefinitely
  (incident: issue #492 / PR #498).

  The fix moves the `ensureCronProcess` call to the top of the request
  handler — after `ensureAppAuthForRepo` and *before* any per-event branching
  — gated only on resolving a `RepoInfo` from `body.repository.full_name`.
  `ensureCronProcess` is already idempotent, so calling it on every accepted
  event is safe. Rejected requests (signature failures, invalid JSON,
  `/health` probes, unknown paths) must NOT spawn a cron.

  Background:
    Given the ADW codebase is checked out

  # ── Top-level placement ─────────────────────────────────────────────────────

  @adw-501 @adw-0lhdw4-webhook-call-ensurec @regression
  Scenario: ensureCronProcess is called at the request handler top-level, not inside per-event branches
    Given "adws/triggers/trigger_webhook.ts" is read
    Then "ensureCronProcess" is called at the request handler top-level in trigger_webhook.ts

  @adw-501 @adw-0lhdw4-webhook-call-ensurec @regression
  Scenario: ensureCronProcess is called after ensureAppAuthForRepo at the request top-level
    Given "adws/triggers/trigger_webhook.ts" is read
    Then "ensureCronProcess" is called after "ensureAppAuthForRepo" at the request handler top-level

  @adw-501 @adw-0lhdw4-webhook-call-ensurec @regression
  Scenario: ensureCronProcess is called before any per-event branching
    Given "adws/triggers/trigger_webhook.ts" is read
    Then "ensureCronProcess" is called before the first per-event branch in the request handler

  @adw-501 @adw-0lhdw4-webhook-call-ensurec @regression
  Scenario: ensureCronProcess is invoked exactly once per accepted webhook request
    Given "adws/triggers/trigger_webhook.ts" is read
    Then "ensureCronProcess" is called exactly once in the trigger_webhook.ts request handler

  # ── Old per-handler call sites are removed ──────────────────────────────────

  @adw-501 @adw-0lhdw4-webhook-call-ensurec @regression
  Scenario: ensureCronProcess is no longer called inside the issue_comment handler
    Given "adws/triggers/trigger_webhook.ts" is read
    Then "ensureCronProcess" is not called inside the issue_comment handler

  @adw-501 @adw-0lhdw4-webhook-call-ensurec @regression
  Scenario: ensureCronProcess is no longer called inside the issues.opened handler
    Given "adws/triggers/trigger_webhook.ts" is read
    Then "ensureCronProcess" is not called inside the issues.opened handler

  # ── Gated on resolving repoInfo ─────────────────────────────────────────────

  @adw-501 @adw-0lhdw4-webhook-call-ensurec @regression
  Scenario: ensureCronProcess is only invoked when body.repository.full_name resolves to a RepoInfo
    Given "adws/triggers/trigger_webhook.ts" is read
    Then the top-level "ensureCronProcess" call is gated on a resolved repoInfo from "body.repository.full_name"

  # ── Rejected requests must not spawn a cron ─────────────────────────────────

  @adw-501 @adw-0lhdw4-webhook-call-ensurec @regression
  Scenario: Signature-rejected requests do not reach the ensureCronProcess call site
    Given "adws/triggers/trigger_webhook.ts" is read
    Then "ensureCronProcess" is called after the webhook signature validation check returns valid

  @adw-501 @adw-0lhdw4-webhook-call-ensurec @regression
  Scenario: Unparseable JSON requests do not reach the ensureCronProcess call site
    Given "adws/triggers/trigger_webhook.ts" is read
    Then "ensureCronProcess" is called after the JSON.parse step in the request handler

  @adw-501 @adw-0lhdw4-webhook-call-ensurec @regression
  Scenario: GET /health requests do not call ensureCronProcess
    Given "adws/triggers/trigger_webhook.ts" is read
    Then "ensureCronProcess" is not called inside the /health request handler block

  @adw-501 @adw-0lhdw4-webhook-call-ensurec
  Scenario: Non-/webhook paths (404 branch) do not call ensureCronProcess
    Given "adws/triggers/trigger_webhook.ts" is read
    Then "ensureCronProcess" is called after the "/webhook" path check passes

  @adw-501 @adw-0lhdw4-webhook-call-ensurec
  Scenario: Non-POST methods on /webhook (405 branch) do not call ensureCronProcess
    Given "adws/triggers/trigger_webhook.ts" is read
    Then "ensureCronProcess" is called after the POST method check passes

  # ── Approved-review path now reaches ensureCronProcess (incident fix) ───────

  @adw-501 @adw-0lhdw4-webhook-call-ensurec @regression
  Scenario: pull_request_review.submitted with state=approved triggers ensureCronProcess via top-level placement
    Given "adws/triggers/trigger_webhook.ts" is read
    Then the pull_request_review handler is reached after the top-level "ensureCronProcess" call
    And the approved-review branch returns "ignored" without calling "ensureCronProcess" itself

  @adw-501 @adw-0lhdw4-webhook-call-ensurec
  Scenario: pull_request_review_comment events reach ensureCronProcess via top-level placement
    Given "adws/triggers/trigger_webhook.ts" is read
    Then the pull_request_review_comment handler is reached after the top-level "ensureCronProcess" call

  @adw-501 @adw-0lhdw4-webhook-call-ensurec
  Scenario: pull_request.closed events reach ensureCronProcess via top-level placement
    Given "adws/triggers/trigger_webhook.ts" is read
    Then the pull_request handler is reached after the top-level "ensureCronProcess" call

  @adw-501 @adw-0lhdw4-webhook-call-ensurec
  Scenario: issues.closed events reach ensureCronProcess via top-level placement
    Given "adws/triggers/trigger_webhook.ts" is read
    Then the issues handler is reached after the top-level "ensureCronProcess" call

  # ── Type-check ──────────────────────────────────────────────────────────────

  @adw-501 @adw-0lhdw4-webhook-call-ensurec @regression
  Scenario: TypeScript type-check passes after the ensureCronProcess top-level relocation
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
