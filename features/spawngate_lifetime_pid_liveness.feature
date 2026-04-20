@adw-463 @adw-yxo18t-orchestrator-resilie
Feature: spawnGate lifetime extension and PID+start-time liveness

  The spawn gate introduced in #449 originally covered only the narrow
  classification-to-spawn window inside `classifyAndSpawnWorkflow`. That left
  a gap where a candidate arriving after spawn but before completion had no
  signal that orchestrator work was in progress beyond a potentially stale
  top-level state file. #463 extends the spawn gate's lock lifetime to cover
  the orchestrator's full lifetime, and teaches the stale-lock liveness check
  to use PID+start-time tuples via `processLiveness.isProcessLive` so PID
  reuse after reboot or long uptime cannot make a dead orchestrator look live
  (or a live orchestrator look dead).

  Lock acquisition still uses `fs.writeFileSync` with the `wx` flag for
  exclusive creation — the TOCTOU safety of #449 is preserved. Stale-lock
  recovery is force-removal after an `isProcessLive` check returns false:
  either because `kill -0` failed, or because the recorded `pidStartedAt`
  differs from the current start-time of a recycled PID.

  The orchestrator process itself acquires the lock immediately after state
  initialization and releases it on normal exit via a `finally` block. Crash
  recovery falls back to the staleness check — a process that dies without
  releasing its lock leaves a record whose PID+start-time is no longer live,
  and the next candidate reclaims it.

  Addresses user stories 6 and 13 of the orchestrator-coordination-resilience
  PRD. Blocked by #456 (processLiveness module) and #461 (top-level state
  schema extension).

  Background:
    Given the ADW codebase is checked out

  # ═══════════════════════════════════════════════════════════════════════════
  # 1. Lock record carries pidStartedAt alongside pid
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-463 @regression
  Scenario: spawnGate lock record schema declares pidStartedAt alongside pid
    Given "adws/triggers/spawnGate.ts" is read
    Then the spawn lock record interface declares a "pid" field of type "number"
    And the spawn lock record interface declares a "pidStartedAt" field of type "string"

  @adw-463 @regression
  Scenario: acquireIssueSpawnLock persists both pid and pidStartedAt on fresh acquire
    Given a fresh spawn-lock directory is prepared for repo "acme/widgets" and issue 42
    When acquireIssueSpawnLock is called for repo "acme/widgets" and issue 42 with an owning pid
    Then the persisted lock record has a numeric "pid" field matching the owning pid
    And the persisted lock record has a non-empty "pidStartedAt" field

  @adw-463
  Scenario: pidStartedAt is sourced from processLiveness.getProcessStartTime
    Given "adws/triggers/spawnGate.ts" is read
    Then acquireIssueSpawnLock populates pidStartedAt from "getProcessStartTime"
    And "getProcessStartTime" is imported from "../core/processLiveness"

  # ═══════════════════════════════════════════════════════════════════════════
  # 2. Liveness check delegates to processLiveness.isProcessLive
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-463 @regression
  Scenario: stale-lock branch invokes isProcessLive with pid and pidStartedAt
    Given "adws/triggers/spawnGate.ts" is read
    Then the stale-lock branch invokes "isProcessLive" with the existing lock's "pid" and "pidStartedAt"
    And the file does not fall back to a pid-only "process.kill" liveness check

  @adw-463 @regression
  Scenario: acquireIssueSpawnLock returns false when the existing holder is live and start-times match
    Given a spawn lock record for repo "acme/widgets" and issue 42 whose pidStartedAt matches a live PID
    When acquireIssueSpawnLock is called for the same repo and issue
    Then acquireIssueSpawnLock returns false
    And the existing lock record on disk is preserved

  @adw-463 @regression
  Scenario: acquireIssueSpawnLock reclaims a stale lock when kill -0 fails
    Given a spawn lock record for repo "acme/widgets" and issue 42 whose recorded PID is not alive
    When acquireIssueSpawnLock is called for the same repo and issue
    Then the stale spawn lock file is force-removed
    And acquireIssueSpawnLock returns true
    And a new lock record is written with the reclaiming caller's pid and pidStartedAt

  @adw-463 @regression
  Scenario: acquireIssueSpawnLock reclaims a stale lock on PID reuse with a mismatched start-time
    Given a spawn lock record for repo "acme/widgets" and issue 42 whose recorded PID is live but whose pidStartedAt differs
    When acquireIssueSpawnLock is called for the same repo and issue
    Then the stale spawn lock file is force-removed
    And acquireIssueSpawnLock returns true

  # ═══════════════════════════════════════════════════════════════════════════
  # 3. wx exclusive-create acquisition is preserved
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-463 @regression
  Scenario: acquireIssueSpawnLock still uses fs.writeFileSync with the wx flag
    Given "adws/triggers/spawnGate.ts" is read
    Then the file contains "writeFileSync"
    And the file contains "'wx'"
    And the file contains "EEXIST"

  # ═══════════════════════════════════════════════════════════════════════════
  # 4. Orchestrator acquires the lock immediately after state init
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-463 @regression
  Scenario: orchestratorLock helper module exists and exports the acquire/release pair
    Given "adws/phases/orchestratorLock.ts" is read
    Then the file exports "acquireOrchestratorLock"
    And the file exports "releaseOrchestratorLock"

  @adw-463 @regression
  Scenario: acquireOrchestratorLock delegates to acquireIssueSpawnLock with the current process pid
    Given "adws/phases/orchestratorLock.ts" is read
    Then "acquireIssueSpawnLock" is imported from "../triggers/spawnGate"
    And acquireOrchestratorLock calls acquireIssueSpawnLock with "process.pid" as the owning PID argument

  @adw-463 @regression
  Scenario: each initializeWorkflow-based orchestrator imports the helper and acquires after state init
    Given the orchestrator file "adws/adwSdlc.tsx" is read
    Then "acquireOrchestratorLock" is imported from "./phases/orchestratorLock"
    And "acquireOrchestratorLock(config)" is called after "initializeWorkflow(" in main
    And "acquireOrchestratorLock(config)" is called before the phase-execution try block

  @adw-463 @regression
  Scenario: adwMerge uses the raw acquireIssueSpawnLock because it has no initializeWorkflow call
    Given the orchestrator file "adws/adwMerge.tsx" is read
    Then "acquireIssueSpawnLock" is imported from "./triggers/spawnGate"
    And "acquireIssueSpawnLock(repoInfo" is called after the repoInfo constant is declared in main

  @adw-463
  Scenario: orchestrator exits 0 on contention rather than throwing
    Given the orchestrator file "adws/adwSdlc.tsx" is read
    Then the main function calls "process.exit(0)" when acquireOrchestratorLock returns false
    And the main function does not throw when acquireOrchestratorLock returns false

  # ═══════════════════════════════════════════════════════════════════════════
  # 5. Lock release happens in finally on normal exit; crash recovery via staleness
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-463 @regression
  Scenario: each initializeWorkflow-based orchestrator releases the lock in a finally block
    Given the orchestrator file "adws/adwSdlc.tsx" is read
    Then the main function contains a "finally" block
    And the "finally" block calls "releaseOrchestratorLock(config)"

  @adw-463 @regression
  Scenario: adwMerge releases the lock in a finally block wrapping executeMerge
    Given the orchestrator file "adws/adwMerge.tsx" is read
    Then the main function contains a "finally" block
    And the "finally" block calls "releaseIssueSpawnLock(repoInfo, issueNumber)"

  @adw-463 @regression
  Scenario: handleWorkflowError does not release the lock — crash recovery relies on the staleness check
    Given "adws/phases/workflowCompletion.ts" is read
    Then "handleWorkflowError" does not call "releaseIssueSpawnLock"
    And "handleWorkflowError" does not call "releaseOrchestratorLock"

  @adw-463 @regression
  Scenario: handleWorkflowDiscarded does not release the lock — crash recovery relies on the staleness check
    Given "adws/phases/workflowCompletion.ts" is read
    Then "handleWorkflowDiscarded" does not call "releaseIssueSpawnLock"
    And "handleWorkflowDiscarded" does not call "releaseOrchestratorLock"

  @adw-463 @regression
  Scenario: handleRateLimitPause does not release the lock — crash recovery relies on the staleness check
    Given "adws/phases/workflowCompletion.ts" is read
    Then "handleRateLimitPause" does not call "releaseIssueSpawnLock"
    And "handleRateLimitPause" does not call "releaseOrchestratorLock"

  @adw-463
  Scenario: releaseIssueSpawnLock is a no-op when the lock file does not exist
    Given no spawn lock file exists for repo "acme/widgets" and issue 99
    When releaseIssueSpawnLock is called for repo "acme/widgets" and issue 99
    Then releaseIssueSpawnLock does not throw

  # ═══════════════════════════════════════════════════════════════════════════
  # 6. Behavioral: crash without release leaves a lock reclaimable
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-463 @regression
  Scenario: a crashed orchestrator that dies before release leaves the lock reclaimable
    Given a spawn lock record for repo "acme/widgets" and issue 42 whose pid is 99999 and whose pidStartedAt is "crashed-era"
    And isProcessLive returns false for pid 99999 with pidStartedAt "crashed-era"
    When acquireIssueSpawnLock is called for the same repo and issue
    Then the stale lock is reclaimed
    And the new lock record reflects the reclaiming caller's pid and pidStartedAt

  # ═══════════════════════════════════════════════════════════════════════════
  # 7. Unit test coverage — the four required cases
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-463 @regression
  Scenario: spawnGate unit-test file exists at the conventional path
    Then the file "adws/triggers/__tests__/spawnGate.test.ts" exists

  @adw-463 @regression
  Scenario: spawnGate tests mock processLiveness so assertions do not depend on real PIDs
    Given "adws/triggers/__tests__/spawnGate.test.ts" is read
    Then the file mocks the "../../core/processLiveness" module
    And the file registers mock implementations for "getProcessStartTime" and "isProcessLive"

  @adw-463 @regression
  Scenario: spawnGate tests cover the fresh-acquire case
    Given "adws/triggers/__tests__/spawnGate.test.ts" is read
    Then a test asserts acquireIssueSpawnLock returns true against an empty spawn-lock directory
    And that test asserts the written record contains "pid" and "pidStartedAt"

  @adw-463 @regression
  Scenario: spawnGate tests cover the contention-with-live-holder (defer) case
    Given "adws/triggers/__tests__/spawnGate.test.ts" is read
    Then a test configures isProcessLive to return true
    And that test asserts acquireIssueSpawnLock returns false

  @adw-463 @regression
  Scenario: spawnGate tests cover the contention-with-dead-holder (reclaim) case
    Given "adws/triggers/__tests__/spawnGate.test.ts" is read
    Then a test configures isProcessLive to return false for an existing lock record
    And that test asserts acquireIssueSpawnLock returns true and the reclaimed record carries the new pid

  @adw-463 @regression
  Scenario: spawnGate tests cover the PID-reuse-with-mismatched-start-time (reclaim) case
    Given "adws/triggers/__tests__/spawnGate.test.ts" is read
    Then a test writes a lock record whose pidStartedAt differs from the reported live start-time
    And that test configures isProcessLive to return false for the mismatched tuple
    And that test asserts the stale lock is reclaimed

  # ═══════════════════════════════════════════════════════════════════════════
  # 8. TypeScript compilation gate
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-463 @regression
  Scenario: TypeScript type-check passes after the spawnGate lifetime extension
    When "bunx tsc --noEmit" is run
    Then the command exits with code 0
    And "bunx tsc --noEmit -p adws/tsconfig.json" also exits with code 0
