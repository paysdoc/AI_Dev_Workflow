@adw-fequcj-fix-fail-open-depend @adw-389
Feature: Fix fail-open dependency check and webhook eligibility bypass

  Two fail-open bugs allow workflows to start on issues with unresolved
  dependencies, causing duplicate orchestrators and wasted compute.

  1. `findOpenDependencies` in `issueDependencies.ts` swallows `getIssueState`
     errors and silently skips the dependency — treating it as non-blocking.
     Fix: on error, treat the dependency as OPEN (fail-closed).

  2. The `issues.opened` catch block in `trigger_webhook.ts` spawns
     `adwPlanBuildTest.tsx` as a fallback when `checkIssueEligibility` throws,
     bypassing all dependency and concurrency checks.
     Fix: log the error and return — do NOT spawn. The cron picks it up.

  Observed impact: Issue #381 had open dependencies #379 and #380. Both
  webhook and cron started workflows simultaneously because the dependency
  check failed silently under API contention from rapid issue creation.

  Background:
    Given the ADW codebase is checked out

  # ═══════════════════════════════════════════════════════════════════════════
  # 1. findOpenDependencies treats failed getIssueState as OPEN (fail-closed)
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-fequcj-fix-fail-open-depend @regression
  Scenario: findOpenDependencies adds dependency to openDeps when getIssueState throws
    Given "adws/triggers/issueDependencies.ts" is read
    Then in the findOpenDependencies function the catch block pushes the dependency number onto openDeps

  @adw-fequcj-fix-fail-open-depend @regression
  Scenario: findOpenDependencies does not silently skip failed dependency checks
    Given "adws/triggers/issueDependencies.ts" is read
    Then the findOpenDependencies catch block does not leave the dependency out of openDeps

  @adw-fequcj-fix-fail-open-depend @regression
  Scenario: findOpenDependencies logs a warning when getIssueState fails
    Given "adws/triggers/issueDependencies.ts" is read
    Then the findOpenDependencies catch block logs the error at warn level

  @adw-fequcj-fix-fail-open-depend
  Scenario: findOpenDependencies returns all dependencies as open when all getIssueState calls fail
    Given an issue body containing "blocked by #10 and #20"
    And getIssueState throws for both #10 and #20
    When findOpenDependencies is called
    Then the result contains both 10 and 20

  @adw-fequcj-fix-fail-open-depend
  Scenario: findOpenDependencies treats a mix of successful and failed checks correctly
    Given an issue body containing "blocked by #10, #20, and #30"
    And getIssueState returns CLOSED for #10
    And getIssueState throws for #20
    And getIssueState returns OPEN for #30
    When findOpenDependencies is called
    Then the result contains 20 and 30
    And the result does not contain 10

  # ═══════════════════════════════════════════════════════════════════════════
  # 2. Webhook issues.opened catch block does not spawn fallback workflow
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-fequcj-fix-fail-open-depend @regression
  Scenario: issues.opened catch block does not call spawnDetached
    Given "adws/triggers/trigger_webhook.ts" is read
    Then the issues opened handler catch block does not call "spawnDetached"

  @adw-fequcj-fix-fail-open-depend @regression
  Scenario: issues.opened catch block logs the error
    Given "adws/triggers/trigger_webhook.ts" is read
    Then the issues opened handler catch block calls "log" with level "error"

  @adw-fequcj-fix-fail-open-depend @regression
  Scenario: issues.opened catch block returns without spawning a workflow
    Given "adws/triggers/trigger_webhook.ts" is read
    Then the issues opened handler catch block contains only logging and a return statement

  @adw-fequcj-fix-fail-open-depend
  Scenario: Cron picks up issue after webhook eligibility check failure
    Given an issue that was not spawned because checkIssueEligibility threw in the webhook
    When the cron trigger polls for open issues
    Then the issue is eligible for evaluation by the cron trigger

  # ═══════════════════════════════════════════════════════════════════════════
  # 3. API contention resilience
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-fequcj-fix-fail-open-depend @regression
  Scenario: Issues with open dependencies are not started under API contention
    Given an issue with "Blocked by #379" and "Blocked by #380" in its body
    And getIssueState throws for #379 due to API rate limiting
    And getIssueState throws for #380 due to CLI contention
    When findOpenDependencies is called
    Then the result contains 379 and 380
    And the issue is deferred due to open dependencies

  # ═══════════════════════════════════════════════════════════════════════════
  # 4. known_issues.md entry
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-fequcj-fix-fail-open-depend @regression
  Scenario: known_issues.md contains entry for dependency-check-fail-open
    Given "adws/known_issues.md" is read
    Then the file contains "dependency-check-fail-open"
    And the entry describes the fail-open dependency check bug
    And the entry references issue #389

  @adw-fequcj-fix-fail-open-depend
  Scenario: known_issues.md dependency-check-fail-open entry has status solved
    Given "adws/known_issues.md" is read
    Then the "dependency-check-fail-open" entry has status "solved"

  # ═══════════════════════════════════════════════════════════════════════════
  # 5. TypeScript compilation
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-fequcj-fix-fail-open-depend @regression
  Scenario: TypeScript type-check passes after fail-open fix
    When "bunx tsc --noEmit" is run
    Then the command exits with code 0
    And "bunx tsc --noEmit -p adws/tsconfig.json" also exits with code 0
