@adw-cwiuik-1773818764164
Feature: Auto-merge PR on approved review with conflict resolution and retry

  When a pull_request_review webhook event is received with review.state === 'approved',
  the webhook handler must route to an auto-merge flow instead of adwPrReview.tsx.
  The auto-merge flow resolves any conflicts via /resolve_conflict, attempts the merge,
  and retries on race-condition conflicts up to a maximum number of attempts.
  If all retries are exhausted, a PR comment is posted explaining the failure.
  Non-approved reviews (changes_requested, commented) continue to route to adwPrReview.tsx.

  Background:
    Given the ADW codebase is checked out

  # ── Webhook routing ───────────────────────────────────────────────────────────

  @adw-cwiuik-1773818764164 @adw-lvakyr-remove-webhook-auto
  Scenario: trigger_webhook.ts inspects review.state for pull_request_review events
    Given "adws/triggers/trigger_webhook.ts" is read
    Then the pull_request_review handler branches on review.state

  @adw-cwiuik-1773818764164 @adw-lvakyr-remove-webhook-auto
  Scenario: Approved review does not spawn adwPrReview.tsx
    Given "adws/triggers/trigger_webhook.ts" is read
    Then the approved-review branch does not spawn adwPrReview.tsx directly

  @adw-cwiuik-1773818764164 @regression
  Scenario: Non-approved review still spawns adwPrReview.tsx
    Given "adws/triggers/trigger_webhook.ts" is read
    Then the non-approved review branch spawns adwPrReview.tsx

  @adw-cwiuik-1773818764164 @adw-lvakyr-remove-webhook-auto
  Scenario: Approved review triggers the auto-merge orchestrator
    Given "adws/triggers/trigger_webhook.ts" is read
    Then the approved-review branch triggers the auto-merge flow

  # ── Auto-merge flow ───────────────────────────────────────────────────────────

  @adw-cwiuik-1773818764164 @regression
  Scenario: Auto-merge flow exists as a dedicated orchestrator or module
    Then the auto-merge flow is implemented in a dedicated file

  @adw-cwiuik-1773818764164 @regression
  Scenario: Auto-merge flow checks for merge conflicts before attempting merge
    Then the auto-merge orchestrator checks for merge conflicts with the target branch

  @adw-cwiuik-1773818764164 @regression
  Scenario: Auto-merge flow calls resolve_conflict when conflicts exist
    Then the auto-merge orchestrator invokes the resolve_conflict command when conflicts are detected

  @adw-cwiuik-1773818764164 @regression
  Scenario: Auto-merge flow retries after a race-condition re-conflict
    Then the auto-merge orchestrator retries conflict resolution and merge when the merge fails due to new conflicts

  @adw-cwiuik-1773818764164 @regression
  Scenario: Auto-merge flow caps retries to prevent infinite loops
    Then the auto-merge orchestrator enforces a maximum retry count

  @adw-cwiuik-1773818764164 @regression
  Scenario: Auto-merge flow posts a PR comment when all retries are exhausted
    Then the auto-merge orchestrator posts a failure comment on the PR when retries are exhausted

  # ── Deduplication ─────────────────────────────────────────────────────────────

  @adw-cwiuik-1773818764164 @adw-lvakyr-remove-webhook-auto
  Scenario: shouldTriggerPrReview deduplication still guards approved reviews
    Given "adws/triggers/trigger_webhook.ts" is read
    Then shouldTriggerPrReview is called before the approved-review branch executes

  # ── TypeScript type-check ─────────────────────────────────────────────────────

  @adw-cwiuik-1773818764164 @regression
  Scenario: ADW TypeScript type-check passes after the auto-merge implementation
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
