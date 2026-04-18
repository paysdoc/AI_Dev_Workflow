@adw-0cv18u-cron-webhook-can-dou @adw-449
Feature: Cross-trigger spawn dedup gate prevents cron and webhook from double-spawning orchestrators

  When an issue becomes eligible via a dependency-closure transition, the
  webhook's `handleIssueClosedDependencyUnblock` path calls `classifyAndSpawnWorkflow`
  only after a ~5-minute `/classify_issue` LLM call. During that window the cron
  (20s poll) sees the dependent as eligible — no ADW comment exists yet — and
  spawns its own orchestrator. Both orchestrators then run install → scenario
  planning → plan → alignment independently, double the cost, and collide on
  conflicting branches.

  Observed incident (2026-04-18, depaudit#6):
  - 12:18:01 cron merges #5
  - 12:18:14 webhook starts `/classify_issue` on #6 (unblocked by #5)
  - 12:21:59 cron polls, sees #6 eligible, spawns `u2drew-polyglot-ecosystem-s`
  - 12:23:18 webhook classification completes, spawns `0ejypj-polyglot-ecosystem-s`
  - Both hit rate limit around 12:45; two pause-queue entries, conflicting branches.

  Fix: a per-(repo,issue) spawn gate, consulted atomically inside
  `classifyAndSpawnWorkflow` before any classification or spawn occurs.
  Both trigger paths converge on the same gate, so only one orchestrator can
  ever be spawned for a given (repo, issue) pair. The gate uses `fs.writeFileSync`
  with the `wx` exclusive-create flag (mirroring `cronProcessGuard`) to eliminate
  the TOCTOU race. The webhook additionally re-checks issue eligibility after
  the classification LLM call returns, so a workflow the cron has already
  spawned during the 5-minute window is detected and no duplicate is started.

  Background:
    Given the ADW codebase is checked out

  # ═══════════════════════════════════════════════════════════════════════════
  # 1. Unified spawn gate module exists
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-0cv18u-cron-webhook-can-dou @adw-449 @regression
  Scenario: spawn gate module exists under adws/triggers
    Then the file "adws/triggers/spawnGate.ts" exists

  @adw-0cv18u-cron-webhook-can-dou @adw-449 @regression
  Scenario: spawn gate exports acquireIssueSpawnLock and releaseIssueSpawnLock
    Given "adws/triggers/spawnGate.ts" is read
    Then the file exports "acquireIssueSpawnLock"
    And the file exports "releaseIssueSpawnLock"

  # ═══════════════════════════════════════════════════════════════════════════
  # 2. Atomic file creation prevents TOCTOU race
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-0cv18u-cron-webhook-can-dou @adw-449 @regression
  Scenario: acquireIssueSpawnLock uses the wx exclusive-create flag
    Given "adws/triggers/spawnGate.ts" is read
    Then the file contains "'wx'"

  @adw-0cv18u-cron-webhook-can-dou @adw-449 @regression
  Scenario: acquireIssueSpawnLock handles EEXIST as a lost-race signal
    Given "adws/triggers/spawnGate.ts" is read
    Then the file contains "EEXIST"

  @adw-0cv18u-cron-webhook-can-dou @adw-449 @regression
  Scenario: acquireIssueSpawnLock returns false when the lock file already exists
    Given a lock file already exists for repo "acme/widgets" and issue 42
    When acquireIssueSpawnLock is called with the same repo and issue
    Then acquireIssueSpawnLock returns false

  @adw-0cv18u-cron-webhook-can-dou @adw-449 @regression
  Scenario: acquireIssueSpawnLock returns true when no lock file exists
    Given no lock file exists for repo "acme/widgets" and issue 99
    When acquireIssueSpawnLock is called with the same repo and issue
    Then acquireIssueSpawnLock returns true
    And a lock file is created on disk

  # ═══════════════════════════════════════════════════════════════════════════
  # 3. Per-(repo, issue) key prevents collisions across repos
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-0cv18u-cron-webhook-can-dou @adw-449 @regression
  Scenario: spawn lock key encodes both repo full-name and issue number
    Given "adws/triggers/spawnGate.ts" is read
    Then the lock file path contains both the repo owner and the issue number

  @adw-0cv18u-cron-webhook-can-dou @adw-449
  Scenario: Two different issues in the same repo can acquire the lock concurrently
    Given acquireIssueSpawnLock succeeded for repo "acme/widgets" and issue 10
    When acquireIssueSpawnLock is called for repo "acme/widgets" and issue 11
    Then acquireIssueSpawnLock returns true

  @adw-0cv18u-cron-webhook-can-dou @adw-449
  Scenario: Same issue number in different repos can acquire the lock concurrently
    Given acquireIssueSpawnLock succeeded for repo "acme/widgets" and issue 42
    When acquireIssueSpawnLock is called for repo "acme/gadgets" and issue 42
    Then acquireIssueSpawnLock returns true

  # ═══════════════════════════════════════════════════════════════════════════
  # 4. classifyAndSpawnWorkflow consults the gate before classification
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-0cv18u-cron-webhook-can-dou @adw-449 @regression
  Scenario: classifyAndSpawnWorkflow calls acquireIssueSpawnLock before classifyIssueForTrigger
    Given "adws/triggers/webhookGatekeeper.ts" is read
    Then "acquireIssueSpawnLock" is called in classifyAndSpawnWorkflow before "classifyIssueForTrigger"

  @adw-0cv18u-cron-webhook-can-dou @adw-449 @regression
  Scenario: classifyAndSpawnWorkflow returns without spawning when the lock is already held
    Given "adws/triggers/webhookGatekeeper.ts" is read
    Then classifyAndSpawnWorkflow returns early when acquireIssueSpawnLock returns false

  @adw-0cv18u-cron-webhook-can-dou @adw-449 @regression
  Scenario: classifyAndSpawnWorkflow does not call spawnDetached when the lock is already held
    Given acquireIssueSpawnLock returns false for repo "acme/widgets" and issue 42
    When classifyAndSpawnWorkflow is called for repo "acme/widgets" and issue 42
    Then spawnDetached is not called

  @adw-0cv18u-cron-webhook-can-dou @adw-449 @regression
  Scenario: classifyAndSpawnWorkflow logs the lost-race deferral at info level
    Given "adws/triggers/webhookGatekeeper.ts" is read
    Then classifyAndSpawnWorkflow logs a message mentioning "spawn lock" when the lock acquire fails

  # ═══════════════════════════════════════════════════════════════════════════
  # 5. Both trigger paths converge on the gate
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-0cv18u-cron-webhook-can-dou @adw-449 @regression
  Scenario: Cron spawn path goes through classifyAndSpawnWorkflow (not a direct spawn)
    Given "adws/triggers/trigger_cron.ts" is read
    Then the SDLC spawn branch in checkAndTrigger calls "classifyAndSpawnWorkflow"
    And the SDLC spawn branch does not bypass classifyAndSpawnWorkflow with a direct spawnDetached

  @adw-0cv18u-cron-webhook-can-dou @adw-449 @regression
  Scenario: Webhook issue_comment path goes through classifyAndSpawnWorkflow
    Given "adws/triggers/trigger_webhook.ts" is read
    Then the issue_comment handler calls "classifyAndSpawnWorkflow" for actionable comments

  @adw-0cv18u-cron-webhook-can-dou @adw-449 @regression
  Scenario: Webhook issues.opened path goes through classifyAndSpawnWorkflow
    Given "adws/triggers/trigger_webhook.ts" is read
    Then the issues opened handler calls "classifyAndSpawnWorkflow" for eligible issues

  @adw-0cv18u-cron-webhook-can-dou @adw-449 @regression
  Scenario: Webhook dependency-unblock path goes through classifyAndSpawnWorkflow
    Given "adws/triggers/webhookGatekeeper.ts" is read
    Then handleIssueClosedDependencyUnblock calls "classifyAndSpawnWorkflow" for each unblocked dependent

  # ═══════════════════════════════════════════════════════════════════════════
  # 6. Webhook re-checks eligibility after the long classification call
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-0cv18u-cron-webhook-can-dou @adw-449 @regression
  Scenario: classifyAndSpawnWorkflow re-checks isAdwRunningForIssue after classification completes
    Given "adws/triggers/webhookGatekeeper.ts" is read
    Then classifyAndSpawnWorkflow calls "isAdwRunningForIssue" after "classifyIssueForTrigger" returns

  @adw-0cv18u-cron-webhook-can-dou @adw-449 @regression
  Scenario: classifyAndSpawnWorkflow aborts spawn when a workflow has started during classification
    Given classifyIssueForTrigger resolved after 5 minutes
    And during that window the cron spawned an orchestrator for the same issue
    When classifyAndSpawnWorkflow re-checks isAdwRunningForIssue
    Then classifyAndSpawnWorkflow releases the lock and returns without spawning

  @adw-0cv18u-cron-webhook-can-dou @adw-449
  Scenario: classifyAndSpawnWorkflow releases the lock when the post-classification recheck aborts
    Given "adws/triggers/webhookGatekeeper.ts" is read
    Then classifyAndSpawnWorkflow calls "releaseIssueSpawnLock" on the post-classification abort path

  # ═══════════════════════════════════════════════════════════════════════════
  # 7. Dependency-closure race is the motivating case
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-0cv18u-cron-webhook-can-dou @adw-449 @regression
  Scenario: Only one orchestrator is spawned when cron and webhook race on a dependency-closure transition
    Given issue 6 is blocked by issue 5 which was just merged by the cron
    And the webhook receives the `issues.closed` event for issue 5 and starts handleIssueClosedDependencyUnblock
    And the cron's next poll sees issue 6 as eligible during the webhook's classification window
    When both triggers reach classifyAndSpawnWorkflow for issue 6
    Then exactly one orchestrator process is spawned for issue 6
    And the losing trigger logs a spawn-lock deferral

  # ═══════════════════════════════════════════════════════════════════════════
  # 8. Lock lifecycle and cleanup
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-0cv18u-cron-webhook-can-dou @adw-449 @regression
  Scenario: Lock files live under the agents state directory
    Given "adws/triggers/spawnGate.ts" is read
    Then the lock directory is resolved from "AGENTS_STATE_DIR"

  @adw-0cv18u-cron-webhook-can-dou @adw-449 @regression
  Scenario: releaseIssueSpawnLock removes the lock file
    Given acquireIssueSpawnLock returned true for repo "acme/widgets" and issue 42
    When releaseIssueSpawnLock is called for the same repo and issue
    Then the lock file for repo "acme/widgets" and issue 42 no longer exists

  @adw-0cv18u-cron-webhook-can-dou @adw-449
  Scenario: releaseIssueSpawnLock is a no-op when the lock file does not exist
    Given no lock file exists for repo "acme/widgets" and issue 99
    When releaseIssueSpawnLock is called for repo "acme/widgets" and issue 99
    Then releaseIssueSpawnLock does not throw

  @adw-0cv18u-cron-webhook-can-dou @adw-449
  Scenario: Stale lock from a dead spawning process is reclaimable on a later attempt
    Given a lock file exists for repo "acme/widgets" and issue 42 whose PID is not alive
    When acquireIssueSpawnLock is called for the same repo and issue
    Then the stale lock is removed and acquireIssueSpawnLock returns true

  # ═══════════════════════════════════════════════════════════════════════════
  # 9. known_issues.md entry
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-0cv18u-cron-webhook-can-dou @adw-449 @regression
  Scenario: known_issues.md contains entry for cross-trigger-double-spawn
    Given "adws/known_issues.md" is read
    Then the file contains "cross-trigger-double-spawn"
    And the entry references issue #449

  @adw-0cv18u-cron-webhook-can-dou @adw-449
  Scenario: known_issues.md cross-trigger-double-spawn entry has status solved
    Given "adws/known_issues.md" is read
    Then the "cross-trigger-double-spawn" entry has status "solved"

  # ═══════════════════════════════════════════════════════════════════════════
  # 10. TypeScript compilation
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-0cv18u-cron-webhook-can-dou @adw-449 @regression
  Scenario: TypeScript type-check passes after the cross-trigger spawn dedup fix
    When "bunx tsc --noEmit" is run
    Then the command exits with code 0
    And "bunx tsc --noEmit -p adws/tsconfig.json" also exits with code 0
