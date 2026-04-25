@adw-444
Feature: ## Cancel skips current cycle only, re-spawns on next cron cycle

  Bug #444: the cancel path was adding cancelled issue numbers to
  `processedSpawns`, which is a module-scoped permanent dedup set. Once an
  issue was cancelled it was filtered as `processed` on every subsequent
  cycle and never re-spawned until the cron process restarted — directly
  contradicting the acceptance criterion from issue #425.

  The fix replaces the permanent set with a per-cycle `cancelledThisCycle`
  Set that is declared inside `checkAndTrigger()` and therefore discarded
  at the end of each cycle. The filter treats `cancelledThisCycle` like a
  skip set for the current cycle only, so the issue is re-evaluated
  cleanly on the next cycle.

  Background:
    Given the ADW codebase is checked out

  # ===================================================================
  # 1. Per-cycle skip set replaces the permanent-set misuse
  # ===================================================================

  @adw-444 @regression
  Scenario: checkAndTrigger declares a per-cycle cancelledThisCycle Set at function scope
    Given "adws/triggers/trigger_cron.ts" is read
    Then the checkAndTrigger function declares a local "cancelledThisCycle" Set of numbers
    And the cancelledThisCycle Set is declared inside checkAndTrigger, not at module scope

  @adw-444 @regression
  Scenario: Cancel path adds the issue to cancelledThisCycle instead of processedSpawns
    Given "adws/triggers/trigger_cron.ts" is read
    Then inside the cancel loop, cancelled issue numbers are added to cancelledThisCycle
    And inside the cancel loop, cancelled issue numbers are not added to processedSpawns

  @adw-444 @regression
  Scenario: filterEligibleIssues honours cancelledThisCycle for the current cycle
    Given "adws/triggers/trigger_cron.ts" is read
    Then the cancelledThisCycle Set is consulted to skip cancelled issues in the current cycle
    And processedSpawns continues to dedup already-spawned issues separately

  # ===================================================================
  # 2. Cross-cycle behaviour: cancel is forgotten on the next cycle
  # ===================================================================

  @adw-444 @regression
  Scenario: cancelledThisCycle is freshly allocated each cron cycle
    Given "adws/triggers/trigger_cron.ts" is read
    Then cancelledThisCycle is a local const inside checkAndTrigger, so each invocation starts with an empty set
    And no module-level state retains cancelled issue numbers across cycles

  @adw-444 @regression
  Scenario: processedSpawns is not used as a per-cycle skip mechanism for cancelled issues
    Given "adws/triggers/trigger_cron.ts" is read
    Then the cancel loop does not invoke processedSpawns.add for cancelled issues
    And processedSpawns remains the permanent per-process dedup for spawned workflows only

  # ===================================================================
  # 3. Regression: two-cycle behaviour after ## Cancel
  # ===================================================================

  @adw-444 @regression
  Scenario: After ## Cancel, the issue is re-eligible on the next cron cycle
    Given an issue whose latest comment was "## Cancel" on cycle 1
    When cycle 1 completes and the cancel comment has been cleared by handleCancelDirective
    Then the issue is not in any per-cycle skip set on cycle 2
    And cycle 2 evaluates the issue through filterEligibleIssues as a fresh candidate
    And the cron spawns the workflow for the issue on cycle 2

  @adw-444 @regression
  Scenario: Cycle 1 skips the cancelled issue without polluting processedSpawns
    Given an issue with "## Cancel" as the latest comment on cycle 1
    When cycle 1 runs checkAndTrigger
    Then handleCancelDirective is invoked for the issue
    And the issue is listed as filtered with reason "cancelled" or similar in the cycle-1 log
    And processedSpawns does not contain the issue number after cycle 1

  # ===================================================================
  # 4. handleCancelDirective still cleans the permanent dedup sets
  # ===================================================================
  # NOTE (issue #488): processedMerges has been removed entirely; the
  # merges field has been dropped from MutableProcessedSets, and the
  # awaiting_merge dedup is now governed by the spawn lock via
  # shouldDispatchMerge. handleCancelDirective only cleans processedSpawns.

  @adw-444 @adw-488
  Scenario: handleCancelDirective still deletes the issue from processedSpawns
    Given "adws/triggers/cancelHandler.ts" is read
    Then handleCancelDirective deletes the issueNumber from processedSets.spawns
    And handleCancelDirective does not reference processedSets.merges

  @adw-444
  Scenario: The cancel path in cron does not re-add the issue to processedSpawns after handleCancelDirective
    Given "adws/triggers/trigger_cron.ts" is read
    Then after calling handleCancelDirective the cancel loop does not call processedSpawns.add for the same issue
    And the only add-to-set on the cancel path is cancelledThisCycle.add

  # ===================================================================
  # 5. TypeScript compilation
  # ===================================================================

  @adw-444 @regression
  Scenario: TypeScript type-check passes after introducing cancelledThisCycle
    When "bunx tsc --noEmit" is run
    Then the command exits with code 0
    And "bunx tsc --noEmit -p adws/tsconfig.json" also exits with code 0
