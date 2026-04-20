@adw-464 @adw-6wnymj-orchestrator-resilie
Feature: shared lifecycle wrapper rolls lock+heartbeat boilerplate out to all twelve orchestrators

  Slice #6 (#462) wired `startHeartbeat`/`stopHeartbeat` into `adwSdlc` as a
  tracer-bullet integration; slice #7 (#463) added `acquireOrchestratorLock`/
  `releaseOrchestratorLock` and bolted them onto every `initializeWorkflow`-based
  entrypoint. After both slices, each orchestrator main() is the same six-line
  ritual: initializeWorkflow → acquire lock or exit → start heartbeat →
  try { phases } finally { stopHeartbeat; releaseLock }. Twelve copies of that
  ritual is twelve places for the order to drift.

  This slice consolidates the ritual into a single shared wrapper —
  `runWithOrchestratorLifecycle(config, fn)` — that owns lock-acquire,
  heartbeat-start, the orchestrator's phase body, heartbeat-stop, and
  lock-release in `finally`. Each entrypoint becomes a one-liner that hands its
  phase-execution body to the wrapper. The wrapper returns `false` if the lock
  could not be acquired so the caller can `process.exit(0)` on contention.

  `adwMerge` does not call `initializeWorkflow` (it reads top-level state
  directly), so it gets a sibling `runWithRawOrchestratorLifecycle(repoInfo,
  issueNumber, adwId, fn)` with identical semantics keyed on the raw
  `RepoInfo`+`issueNumber` tuple.

  After this slice, no orchestrator entrypoint contains a hand-rolled
  `startHeartbeat`, `acquireOrchestratorLock`, or `acquireIssueSpawnLock` call
  outside the wrapper, and `adwSdlc` no longer imports the heartbeat module
  directly — its slice-#6 tracer wiring is fully subsumed.

  Cleanup runs in a `finally` block so the heartbeat timer always stops and the
  lock is always released on the normal-exit path. Crash-exit paths (process
  killed, `process.exit` from `handleWorkflowError`) deliberately skip the
  finally — the lock file is left on disk and the next caller's
  `acquireIssueSpawnLock` reclaims it via the PID+start-time staleness check
  introduced in #463.

  Addresses user stories 13 and 14 of the orchestrator-coordination-resilience
  PRD. Blocked by #462 (heartbeat module + adwSdlc tracer) and #463 (spawn-gate
  lifetime + `orchestratorLock` helper).

  Background:
    Given the ADW codebase is checked out

  # ═══════════════════════════════════════════════════════════════════════════
  # 1. Wrapper module surface — file location and exports
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-464 @regression
  Scenario: orchestrator lifecycle wrapper module exists at the phases path
    Then the file "adws/phases/orchestratorLock.ts" exists

  @adw-464 @regression
  Scenario: orchestrator lifecycle wrapper module exports runWithOrchestratorLifecycle
    Given "adws/phases/orchestratorLock.ts" is read
    Then the file exports "runWithOrchestratorLifecycle"

  @adw-464 @regression
  Scenario: orchestrator lifecycle wrapper module exports the raw variant for adwMerge
    Given "adws/phases/orchestratorLock.ts" is read
    Then the file exports "runWithRawOrchestratorLifecycle"

  @adw-464 @regression
  Scenario: phases barrel re-exports the lifecycle wrapper helpers
    Given "adws/phases/index.ts" is read
    Then the file exports "runWithOrchestratorLifecycle"
    And the file exports "runWithRawOrchestratorLifecycle"

  # ═══════════════════════════════════════════════════════════════════════════
  # 2. Wrapper signature
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-464 @regression
  Scenario: runWithOrchestratorLifecycle accepts a WorkflowConfig and an async body
    Given "adws/phases/orchestratorLock.ts" is read
    Then "runWithOrchestratorLifecycle" accepts "config: WorkflowConfig" as its first parameter
    And "runWithOrchestratorLifecycle" accepts a second parameter typed "() => Promise<void>"
    And "runWithOrchestratorLifecycle" returns "Promise<boolean>"

  @adw-464 @regression
  Scenario: runWithRawOrchestratorLifecycle accepts repoInfo, issueNumber, adwId, and an async body
    Given "adws/phases/orchestratorLock.ts" is read
    Then "runWithRawOrchestratorLifecycle" accepts "repoInfo: RepoInfo" as its first parameter
    And "runWithRawOrchestratorLifecycle" accepts "issueNumber: number" as its second parameter
    And "runWithRawOrchestratorLifecycle" accepts "adwId: string" as its third parameter
    And "runWithRawOrchestratorLifecycle" accepts a fourth parameter typed "() => Promise<void>"
    And "runWithRawOrchestratorLifecycle" returns "Promise<boolean>"

  # ═══════════════════════════════════════════════════════════════════════════
  # 3. Wrapper internals — lock-acquire → heartbeat-start → fn → heartbeat-stop
  #                       → lock-release, with cleanup in finally
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-464 @regression
  Scenario: runWithOrchestratorLifecycle calls acquireIssueSpawnLock before starting the heartbeat
    Given "adws/phases/orchestratorLock.ts" is read
    Then in "runWithOrchestratorLifecycle" the call to "acquireIssueSpawnLock" appears before the call to "startHeartbeat"

  @adw-464 @regression
  Scenario: runWithOrchestratorLifecycle returns false without starting the heartbeat when the lock is not acquired
    Given "adws/phases/orchestratorLock.ts" is read
    Then "runWithOrchestratorLifecycle" returns false immediately when "acquireIssueSpawnLock" returns false
    And "startHeartbeat" is not called when acquireIssueSpawnLock returned false

  @adw-464 @regression
  Scenario: runWithOrchestratorLifecycle starts the heartbeat with HEARTBEAT_TICK_INTERVAL_MS
    Given "adws/phases/orchestratorLock.ts" is read
    Then "HEARTBEAT_TICK_INTERVAL_MS" is imported from "../core/config"
    And the call to "startHeartbeat" uses "config.adwId" as its adwId argument
    And the call to "startHeartbeat" uses "HEARTBEAT_TICK_INTERVAL_MS" as its intervalMs argument

  @adw-464 @regression
  Scenario: runWithOrchestratorLifecycle invokes the supplied phase body inside the try block
    Given "adws/phases/orchestratorLock.ts" is read
    Then "runWithOrchestratorLifecycle" calls "await fn()" inside a "try" block
    And the try block is preceded by the "startHeartbeat" call

  @adw-464 @regression
  Scenario: runWithOrchestratorLifecycle stops the heartbeat and releases the lock in a finally block
    Given "adws/phases/orchestratorLock.ts" is read
    Then "runWithOrchestratorLifecycle" contains a "finally" block
    And the finally block calls "stopHeartbeat" with the handle returned by "startHeartbeat"
    And the finally block calls "releaseIssueSpawnLock"
    And inside the finally block "stopHeartbeat" is called before "releaseIssueSpawnLock"

  @adw-464 @regression
  Scenario: runWithRawOrchestratorLifecycle mirrors the same lock-then-heartbeat-then-finally structure
    Given "adws/phases/orchestratorLock.ts" is read
    Then in "runWithRawOrchestratorLifecycle" the call to "acquireIssueSpawnLock" appears before the call to "startHeartbeat"
    And "runWithRawOrchestratorLifecycle" contains a "finally" block
    And the finally block calls "stopHeartbeat"
    And the finally block calls "releaseIssueSpawnLock"

  # ═══════════════════════════════════════════════════════════════════════════
  # 4. Each entrypoint adopts the wrapper — no hand-rolled boilerplate left
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-464 @regression
  Scenario Outline: each initializeWorkflow-based orchestrator wraps its phase body with runWithOrchestratorLifecycle
    Given the orchestrator file "<file>" is read
    Then "runWithOrchestratorLifecycle" is imported from "./phases/orchestratorLock"
    And the main function calls "runWithOrchestratorLifecycle(config" with an async body

    Examples:
      | file                            |
      | adws/adwSdlc.tsx                |
      | adws/adwBuild.tsx               |
      | adws/adwChore.tsx               |
      | adws/adwInit.tsx                |
      | adws/adwPatch.tsx               |
      | adws/adwPlan.tsx                |
      | adws/adwPlanBuild.tsx           |
      | adws/adwPlanBuildDocument.tsx   |
      | adws/adwPlanBuildReview.tsx     |
      | adws/adwPlanBuildTest.tsx       |
      | adws/adwPlanBuildTestReview.tsx |
      | adws/adwTest.tsx                |

  @adw-464 @regression
  Scenario: adwMerge wraps its executeMerge body with runWithRawOrchestratorLifecycle
    Given the orchestrator file "adws/adwMerge.tsx" is read
    Then "runWithRawOrchestratorLifecycle" is imported from "./phases/orchestratorLock"
    And the main function calls "runWithRawOrchestratorLifecycle(repoInfo" with an async body

  @adw-464 @regression
  Scenario Outline: no in-scope orchestrator hand-rolls a startHeartbeat call after migration
    Given the orchestrator file "<file>" is read
    Then the file does not contain "startHeartbeat("
    And the file does not contain "stopHeartbeat("

    Examples:
      | file                            |
      | adws/adwSdlc.tsx                |
      | adws/adwMerge.tsx               |
      | adws/adwChore.tsx               |
      | adws/adwBuild.tsx               |
      | adws/adwInit.tsx                |
      | adws/adwPatch.tsx               |
      | adws/adwPlan.tsx                |
      | adws/adwPlanBuild.tsx           |
      | adws/adwPlanBuildDocument.tsx   |
      | adws/adwPlanBuildReview.tsx     |
      | adws/adwPlanBuildTest.tsx       |
      | adws/adwPlanBuildTestReview.tsx |
      | adws/adwTest.tsx                |

  @adw-464 @regression
  Scenario Outline: no initializeWorkflow-based orchestrator hand-rolls acquireIssueSpawnLock or acquireOrchestratorLock
    Given the orchestrator file "<file>" is read
    Then the file does not contain "acquireIssueSpawnLock("
    And the file does not contain "acquireOrchestratorLock("
    And the file does not contain "releaseIssueSpawnLock("
    And the file does not contain "releaseOrchestratorLock("

    Examples:
      | file                            |
      | adws/adwSdlc.tsx                |
      | adws/adwChore.tsx               |
      | adws/adwBuild.tsx               |
      | adws/adwInit.tsx                |
      | adws/adwPatch.tsx               |
      | adws/adwPlan.tsx                |
      | adws/adwPlanBuild.tsx           |
      | adws/adwPlanBuildDocument.tsx   |
      | adws/adwPlanBuildReview.tsx     |
      | adws/adwPlanBuildTest.tsx       |
      | adws/adwPlanBuildTestReview.tsx |
      | adws/adwTest.tsx                |

  @adw-464 @regression
  Scenario: adwMerge does not call acquireIssueSpawnLock outside the raw wrapper
    Given the orchestrator file "adws/adwMerge.tsx" is read
    Then the file does not contain "acquireIssueSpawnLock(" outside calls passed to "runWithRawOrchestratorLifecycle"
    And the file does not contain "releaseIssueSpawnLock(" outside the wrapper

  @adw-464 @regression
  Scenario Outline: each migrated orchestrator exits 0 when the wrapper returns false
    Given the orchestrator file "<file>" is read
    Then the main function calls "process.exit(0)" when "runWithOrchestratorLifecycle" returns false

    Examples:
      | file                            |
      | adws/adwSdlc.tsx                |
      | adws/adwBuild.tsx               |
      | adws/adwPlan.tsx                |
      | adws/adwPlanBuild.tsx           |
      | adws/adwPlanBuildDocument.tsx   |
      | adws/adwPlanBuildReview.tsx     |
      | adws/adwPlanBuildTest.tsx       |
      | adws/adwPlanBuildTestReview.tsx |

  # ═══════════════════════════════════════════════════════════════════════════
  # 5. adwSdlc tracer wiring from slice #6 is fully subsumed
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-464 @regression
  Scenario: adwSdlc no longer imports startHeartbeat or stopHeartbeat directly
    Given the orchestrator file "adws/adwSdlc.tsx" is read
    Then the file does not contain "from './core/heartbeat'"
    And the file does not import "startHeartbeat"
    And the file does not import "stopHeartbeat"

  @adw-464 @regression
  Scenario: adwSdlc no longer imports HEARTBEAT_TICK_INTERVAL_MS directly — the wrapper owns it
    Given the orchestrator file "adws/adwSdlc.tsx" is read
    Then the file does not import "HEARTBEAT_TICK_INTERVAL_MS"

  @adw-464 @regression
  Scenario: adwSdlc heartbeat lifecycle is delegated to runWithOrchestratorLifecycle
    Given the orchestrator file "adws/adwSdlc.tsx" is read
    Then the main function does not contain a direct "startHeartbeat" call
    And the main function does not contain a direct "stopHeartbeat" call
    And the main function calls "runWithOrchestratorLifecycle"

  # ═══════════════════════════════════════════════════════════════════════════
  # 6. Crash-exit paths intentionally skip the finally — staleness check reclaims
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-464
  Scenario: handleWorkflowError still calls process.exit synchronously without releasing the wrapper-held lock
    Given "adws/phases/workflowCompletion.ts" is read
    Then "handleWorkflowError" does not call "releaseIssueSpawnLock"
    And "handleWorkflowError" does not call "stopHeartbeat"

  @adw-464
  Scenario: orchestratorLock module documents that abnormal-exit handlers leave the lock for staleness reclaim
    Given "adws/phases/orchestratorLock.ts" is read
    Then the file documents that "process.exit" inside fn skips the finally block
    And the file documents that the lock is reclaimed by the next caller via PID+start-time staleness

  # ═══════════════════════════════════════════════════════════════════════════
  # 7. Unit test asserts the wrapper's call order
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-464 @regression
  Scenario: orchestratorLock unit test file exists at the conventional path
    Then the file "adws/phases/__tests__/orchestratorLock.test.ts" exists

  @adw-464 @regression
  Scenario: orchestratorLock test mocks spawnGate and heartbeat so it asserts on call order, not real I/O
    Given "adws/phases/__tests__/orchestratorLock.test.ts" is read
    Then the file mocks the "../../triggers/spawnGate" module
    And the file mocks the "../../core/heartbeat" module

  @adw-464 @regression
  Scenario: orchestratorLock test asserts the happy-path call order acquire → start → fn → stop → release
    Given "adws/phases/__tests__/orchestratorLock.test.ts" is read
    Then a test asserts the call order is "acquireIssueSpawnLock", "startHeartbeat", "fn", "stopHeartbeat", "releaseIssueSpawnLock"

  @adw-464 @regression
  Scenario: orchestratorLock test asserts the wrapper still stops the heartbeat and releases the lock when fn throws
    Given "adws/phases/__tests__/orchestratorLock.test.ts" is read
    Then a test configures fn to throw an Error
    And that test asserts "stopHeartbeat" is still called
    And that test asserts "releaseIssueSpawnLock" is still called
    And that test asserts the wrapper rejects with the original error

  @adw-464 @regression
  Scenario: orchestratorLock test asserts the wrapper short-circuits when acquireIssueSpawnLock returns false
    Given "adws/phases/__tests__/orchestratorLock.test.ts" is read
    Then a test configures acquireIssueSpawnLock to return false
    And that test asserts the wrapper resolves to false
    And that test asserts startHeartbeat was not called
    And that test asserts fn was not called
    And that test asserts releaseIssueSpawnLock was not called

  @adw-464
  Scenario: orchestratorLock test covers the runWithRawOrchestratorLifecycle variant
    Given "adws/phases/__tests__/orchestratorLock.test.ts" is read
    Then a test invokes "runWithRawOrchestratorLifecycle" with a fake repoInfo, issueNumber, and adwId
    And that test asserts the same call-order acquire → start → fn → stop → release

  # ═══════════════════════════════════════════════════════════════════════════
  # 8. State-init precedes the wrapper call — contract preserved across all entrypoints
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-464 @regression
  Scenario Outline: each initializeWorkflow-based orchestrator calls initializeWorkflow before runWithOrchestratorLifecycle
    Given the orchestrator file "<file>" is read
    Then in main the call to "initializeWorkflow" appears before the call to "runWithOrchestratorLifecycle"

    Examples:
      | file                            |
      | adws/adwSdlc.tsx                |
      | adws/adwBuild.tsx               |
      | adws/adwChore.tsx               |
      | adws/adwInit.tsx                |
      | adws/adwPatch.tsx               |
      | adws/adwPlan.tsx                |
      | adws/adwPlanBuild.tsx           |
      | adws/adwPlanBuildDocument.tsx   |
      | adws/adwPlanBuildReview.tsx     |
      | adws/adwPlanBuildTest.tsx       |
      | adws/adwPlanBuildTestReview.tsx |
      | adws/adwTest.tsx                |

  # ═══════════════════════════════════════════════════════════════════════════
  # 9. Regression check — each orchestrator still runs end-to-end against a fixture issue
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-464 @regression
  Scenario Outline: each migrated orchestrator's main() executes initializeWorkflow → wrapper → exit without throwing on a fixture issue
    Given a fixture issue with number 9999 is prepared and the spawn lock for it is free
    When the orchestrator main() in "<file>" is invoked against the fixture issue with all phases stubbed
    Then the wrapper acquires the lock, starts the heartbeat, runs the stubbed phase body, stops the heartbeat, and releases the lock
    And the orchestrator process exits with code 0

    Examples:
      | file                            |
      | adws/adwSdlc.tsx                |
      | adws/adwBuild.tsx               |
      | adws/adwChore.tsx               |
      | adws/adwInit.tsx                |
      | adws/adwPatch.tsx               |
      | adws/adwPlan.tsx                |
      | adws/adwPlanBuild.tsx           |
      | adws/adwPlanBuildDocument.tsx   |
      | adws/adwPlanBuildReview.tsx     |
      | adws/adwPlanBuildTest.tsx       |
      | adws/adwPlanBuildTestReview.tsx |
      | adws/adwTest.tsx                |

  @adw-464 @regression
  Scenario: adwMerge's main() executes runWithRawOrchestratorLifecycle without throwing on a fixture awaiting_merge issue
    Given a fixture issue with number 9999 is prepared and the spawn lock for it is free
    And the top-level state file for the fixture issue is in workflowStage "awaiting_merge"
    When adwMerge main() is invoked against the fixture issue with executeMerge stubbed
    Then the raw wrapper acquires the lock, starts the heartbeat, runs the stubbed body, stops the heartbeat, and releases the lock
    And the orchestrator process exits with code 0

  # ═══════════════════════════════════════════════════════════════════════════
  # 10. Boilerplate-removal sanity — wrapper is the only place this lifecycle lives
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-464 @regression
  Scenario: the only files importing startHeartbeat are the wrapper module and its tests
    When the codebase is searched for imports of "startHeartbeat"
    Then the only files importing "startHeartbeat" are "adws/phases/orchestratorLock.ts" and files under "adws/core/__tests__/" or "adws/phases/__tests__/"

  @adw-464 @regression
  Scenario: the only files importing acquireIssueSpawnLock from spawnGate are the wrapper, classifyAndSpawnWorkflow, and tests
    When the codebase is searched for imports of "acquireIssueSpawnLock"
    Then "adws/phases/orchestratorLock.ts" imports "acquireIssueSpawnLock"
    And no orchestrator entrypoint file under "adws/" with name matching "adw*.tsx" imports "acquireIssueSpawnLock" except via the wrapper

  # ═══════════════════════════════════════════════════════════════════════════
  # 11. TypeScript compilation gate
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-464 @regression
  Scenario: TypeScript type-check passes after the shared lifecycle wrapper rollout
    When "bunx tsc --noEmit" is run
    Then the command exits with code 0
    And "bunx tsc --noEmit -p adws/tsconfig.json" also exits with code 0
