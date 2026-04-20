@adw-465 @adw-xruqv8-orchestrator-resilie
Feature: hungOrchestratorDetector pure query plus cron sweeper SIGKILL-and-abandon wiring

  An orchestrator whose Node event loop wedges does not crash — `kill -0`
  keeps returning success, so every PID-only liveness signal the cron
  sweeper has ever consulted still reports the process as alive. Phase
  writes stop, but phase-write silence alone cannot distinguish a stuck
  phase from a long phase. The heartbeat tick (introduced by #462) breaks
  that tie by writing `lastSeenAt` on a fixed 30-second interval
  independently of phase progress: if the loop is turning, `lastSeenAt`
  advances; if the loop is wedged, it stalls.

  `hungOrchestratorDetector` is the pure-query module that reads that
  signal. Its single export, `findHungOrchestrators(now, staleThresholdMs)`,
  iterates the top-level state files, keeps the ones whose workflowStage
  ends in `_running` AND whose recorded PID (paired with pidStartedAt)
  is still live AND whose `lastSeenAt` is older than `staleThresholdMs`
  relative to `now`, and returns the set. The detector performs no
  SIGKILL, issues no state write, and logs no side effect — all recovery
  actions are the caller's responsibility. This separation is what lets
  the contract test run with an injected clock and a fixture set of
  state files without any process or filesystem mutation.

  The cron per-cycle work wires the detector into `checkAndTrigger`: for
  each returned entry it sends `SIGKILL` to the wedged PID and rewrites
  the top-level state to `workflowStage: 'abandoned'`. The `abandoned`
  classification is correct here because a wedged event loop is a
  transient failure — the takeover handler (a later slice of the
  orchestrator-coordination-resilience PRD) picks the issue up on the
  next cycle via the existing retriable-stage path.

  Addresses user stories 4 and 16 of the orchestrator-coordination-resilience PRD.

  Background:
    Given the ADW codebase is checked out

  # ═══════════════════════════════════════════════════════════════════════════
  # 1. Module surface — file location and exports
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-465 @regression
  Scenario: hungOrchestratorDetector module exists at the core path
    Then the file "adws/core/hungOrchestratorDetector.ts" exists

  @adw-465 @regression
  Scenario: hungOrchestratorDetector exports findHungOrchestrators
    Given "adws/core/hungOrchestratorDetector.ts" is read
    Then the file exports "findHungOrchestrators"

  @adw-465 @regression
  Scenario: hungOrchestratorDetector exports the HungOrchestrator result type
    Given "adws/core/hungOrchestratorDetector.ts" is read
    Then the file exports "HungOrchestrator"

  @adw-465
  Scenario: findHungOrchestrators accepts now and staleThresholdMs
    Given "adws/core/hungOrchestratorDetector.ts" is read
    Then "findHungOrchestrators" accepts "now: number" and "staleThresholdMs: number" as its required parameters
    And "findHungOrchestrators" returns "HungOrchestrator[]"

  @adw-465
  Scenario: HungOrchestrator result carries the fields the cron sweeper needs
    Given "adws/core/hungOrchestratorDetector.ts" is read
    Then the "HungOrchestrator" type declares an "adwId" field of type "string"
    And the "HungOrchestrator" type declares a "pid" field of type "number"
    And the "HungOrchestrator" type declares a "workflowStage" field
    And the "HungOrchestrator" type declares a "lastSeenAt" field of type "string"

  # ═══════════════════════════════════════════════════════════════════════════
  # 2. Purity — the detector is a query only
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-465 @regression
  Scenario: findHungOrchestrators never sends a kill signal
    Given "adws/core/hungOrchestratorDetector.ts" is read
    Then the file does not contain "process.kill"
    And the file does not contain "'SIGKILL'"
    And the file does not contain "'SIGTERM'"

  @adw-465 @regression
  Scenario: findHungOrchestrators never writes to the top-level state
    Given "adws/core/hungOrchestratorDetector.ts" is read
    Then the file does not contain "writeTopLevelState"
    And the file does not contain "fs.writeFileSync"
    And the file does not contain "fs.renameSync"

  @adw-465
  Scenario: findHungOrchestrators does not import the phases layer
    Given "adws/core/hungOrchestratorDetector.ts" is read
    Then the file does not import from "../phases"
    And the file does not import from "../workflowPhases"

  # ═══════════════════════════════════════════════════════════════════════════
  # 3. Detection filter — *_running AND live PID AND stale lastSeenAt
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-465 @regression
  Scenario: findHungOrchestrators returns a *_running entry whose PID is live and whose lastSeenAt is stale
    Given a top-level state file for adwId "hung-01" with workflowStage "build_running", pid 1001, pidStartedAt "s-1001", and lastSeenAt 5 minutes before "now"
    And isProcessLive returns true for pid 1001 with recordedStartTime "s-1001"
    When findHungOrchestrators is called with "now" and staleThresholdMs 180000
    Then the returned set contains an entry with adwId "hung-01"
    And the returned entry's pid is 1001
    And the returned entry's workflowStage is "build_running"

  @adw-465 @regression
  Scenario: findHungOrchestrators excludes a *_running entry whose PID is dead
    Given a top-level state file for adwId "dead-pid-01" with workflowStage "build_running", pid 2002, pidStartedAt "s-2002", and lastSeenAt 5 minutes before "now"
    And isProcessLive returns false for pid 2002 with recordedStartTime "s-2002"
    When findHungOrchestrators is called with "now" and staleThresholdMs 180000
    Then the returned set does not contain adwId "dead-pid-01"

  @adw-465 @regression
  Scenario: findHungOrchestrators excludes a *_running entry whose lastSeenAt is fresh
    Given a top-level state file for adwId "fresh-01" with workflowStage "review_running", pid 3003, pidStartedAt "s-3003", and lastSeenAt 10 seconds before "now"
    And isProcessLive returns true for pid 3003 with recordedStartTime "s-3003"
    When findHungOrchestrators is called with "now" and staleThresholdMs 180000
    Then the returned set does not contain adwId "fresh-01"

  @adw-465 @regression
  Scenario: findHungOrchestrators excludes an entry whose workflowStage is not *_running
    Given a top-level state file for adwId "terminal-01" with workflowStage "completed", pid 4004, pidStartedAt "s-4004", and lastSeenAt 10 minutes before "now"
    And isProcessLive returns true for pid 4004 with recordedStartTime "s-4004"
    When findHungOrchestrators is called with "now" and staleThresholdMs 180000
    Then the returned set does not contain adwId "terminal-01"

  @adw-465
  Scenario Outline: *_running stages are considered by findHungOrchestrators
    Given a top-level state file for adwId "<adwId>" with workflowStage "<stage>", pid 9001, pidStartedAt "s-9001", and lastSeenAt 5 minutes before "now"
    And isProcessLive returns true for pid 9001 with recordedStartTime "s-9001"
    When findHungOrchestrators is called with "now" and staleThresholdMs 180000
    Then the returned set contains an entry with adwId "<adwId>"

    Examples:
      | adwId           | stage            |
      | hung-build      | build_running    |
      | hung-test       | test_running     |
      | hung-review     | review_running   |
      | hung-install    | install_running  |
      | hung-document   | document_running |

  @adw-465
  Scenario Outline: non-*_running stages are skipped by findHungOrchestrators
    Given a top-level state file for adwId "<adwId>" with workflowStage "<stage>", pid 9002, pidStartedAt "s-9002", and lastSeenAt 10 minutes before "now"
    And isProcessLive returns true for pid 9002 with recordedStartTime "s-9002"
    When findHungOrchestrators is called with "now" and staleThresholdMs 180000
    Then the returned set does not contain adwId "<adwId>"

    Examples:
      | adwId            | stage       |
      | skip-completed   | completed   |
      | skip-paused      | paused      |
      | skip-abandoned   | abandoned   |
      | skip-discarded   | discarded   |
      | skip-starting    | starting    |

  @adw-465 @regression
  Scenario: findHungOrchestrators uses the injected clock, not the system clock
    Given a top-level state file for adwId "clock-01" with workflowStage "build_running", pid 5005, pidStartedAt "s-5005", and lastSeenAt "2026-04-20T10:00:00.000Z"
    And isProcessLive returns true for pid 5005 with recordedStartTime "s-5005"
    When findHungOrchestrators is called with "now" equal to epoch milliseconds for "2026-04-20T10:02:00.000Z" and staleThresholdMs 180000
    Then the returned set does not contain adwId "clock-01"
    When findHungOrchestrators is called with "now" equal to epoch milliseconds for "2026-04-20T10:05:00.000Z" and staleThresholdMs 180000
    Then the returned set contains an entry with adwId "clock-01"

  @adw-465
  Scenario: findHungOrchestrators pairs pid with pidStartedAt when asking processLiveness
    Given "adws/core/hungOrchestratorDetector.ts" is read
    Then the file imports "isProcessLive" from "./processLiveness"
    And the liveness call passes both the state file's "pid" and its "pidStartedAt" to "isProcessLive"

  # ═══════════════════════════════════════════════════════════════════════════
  # 4. Missing-field tolerance — detector never faults on partial state files
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-465 @regression
  Scenario: findHungOrchestrators skips a *_running entry with no pid recorded
    Given a top-level state file for adwId "no-pid-01" with workflowStage "build_running", no pid, no pidStartedAt, and lastSeenAt 10 minutes before "now"
    When findHungOrchestrators is called with "now" and staleThresholdMs 180000
    Then the returned set does not contain adwId "no-pid-01"
    And the call does not throw

  @adw-465 @regression
  Scenario: findHungOrchestrators skips a *_running entry with no lastSeenAt recorded
    Given a top-level state file for adwId "no-hb-01" with workflowStage "build_running", pid 6006, pidStartedAt "s-6006", and no lastSeenAt
    And isProcessLive returns true for pid 6006 with recordedStartTime "s-6006"
    When findHungOrchestrators is called with "now" and staleThresholdMs 180000
    Then the returned set does not contain adwId "no-hb-01"
    And the call does not throw

  @adw-465
  Scenario: findHungOrchestrators tolerates a malformed state.json and continues iterating siblings
    Given a top-level state file for adwId "good-01" with workflowStage "build_running", pid 7007, pidStartedAt "s-7007", and lastSeenAt 5 minutes before "now"
    And a top-level state file for adwId "bad-01" whose state.json content is not valid JSON
    And isProcessLive returns true for pid 7007 with recordedStartTime "s-7007"
    When findHungOrchestrators is called with "now" and staleThresholdMs 180000
    Then the returned set contains an entry with adwId "good-01"
    And the call does not throw

  # ═══════════════════════════════════════════════════════════════════════════
  # 5. Cron wiring — per-cycle invocation of the detector
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-465 @regression
  Scenario: trigger_cron imports findHungOrchestrators from the detector module
    Given "adws/triggers/trigger_cron.ts" is read
    Then the file imports "findHungOrchestrators" from "../core/hungOrchestratorDetector"

  @adw-465 @regression
  Scenario: trigger_cron imports HEARTBEAT_STALE_THRESHOLD_MS from core config
    Given "adws/triggers/trigger_cron.ts" is read
    Then the file imports "HEARTBEAT_STALE_THRESHOLD_MS" from "../core/config" or from "../core"

  @adw-465 @regression
  Scenario: checkAndTrigger invokes findHungOrchestrators during each cycle
    Given "adws/triggers/trigger_cron.ts" is read
    Then "findHungOrchestrators" is called inside "checkAndTrigger"
    And the call passes "HEARTBEAT_STALE_THRESHOLD_MS" as its staleThresholdMs argument

  @adw-465
  Scenario: Existing per-cycle probes still run after hung-orchestrator wiring
    Given "adws/triggers/trigger_cron.ts" is read
    Then the file still imports and calls "scanPauseQueue"
    And the file still imports and calls "runJanitorPass"
    And no existing per-cycle probe invocation is removed or disabled

  # ═══════════════════════════════════════════════════════════════════════════
  # 6. Cron sweeper actions — SIGKILL the live PID, rewrite state to abandoned
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-465 @regression
  Scenario: Cron per-cycle work sends SIGKILL to each returned hung PID
    Given findHungOrchestrators returns a single entry with adwId "sweep-01" and pid 1234
    When checkAndTrigger processes the cycle
    Then process.kill is called with pid 1234 and signal "SIGKILL"

  @adw-465 @regression
  Scenario: Cron per-cycle work rewrites the returned entry's workflowStage to abandoned
    Given findHungOrchestrators returns a single entry with adwId "sweep-02" and pid 2345
    When checkAndTrigger processes the cycle
    Then AgentStateManager.writeTopLevelState is called with adwId "sweep-02" and a patch whose workflowStage is "abandoned"

  @adw-465 @regression
  Scenario: The cron sweeper does not rewrite workflowStage to discarded for a hung orchestrator
    Given findHungOrchestrators returns a single entry with adwId "sweep-03" and pid 3456
    When checkAndTrigger processes the cycle
    Then AgentStateManager.writeTopLevelState is not called with adwId "sweep-03" and workflowStage "discarded"

  @adw-465 @regression
  Scenario: Cron per-cycle work acts on every returned hung entry
    Given findHungOrchestrators returns entries with adwIds "sweep-a" (pid 4001) and "sweep-b" (pid 4002)
    When checkAndTrigger processes the cycle
    Then process.kill is called with pid 4001 and signal "SIGKILL"
    And process.kill is called with pid 4002 and signal "SIGKILL"
    And AgentStateManager.writeTopLevelState is called with adwId "sweep-a" and workflowStage "abandoned"
    And AgentStateManager.writeTopLevelState is called with adwId "sweep-b" and workflowStage "abandoned"

  @adw-465
  Scenario: Cron per-cycle work is a no-op when no hung orchestrators are returned
    Given findHungOrchestrators returns an empty array
    When checkAndTrigger processes the cycle
    Then process.kill is not invoked by the hung-orchestrator sweep
    And AgentStateManager.writeTopLevelState is not invoked by the hung-orchestrator sweep

  @adw-465
  Scenario: Rewritten-to-abandoned issues are re-eligible via the existing retriable-stage path
    Given an issue with adw-id "sweep-04" extracted from comments
    And the cron sweeper has just rewritten "agents/sweep-04/state.json" to workflowStage "abandoned"
    When the cron trigger evaluates eligibility on the following cycle
    Then the issue is considered eligible for re-processing

  @adw-465
  Scenario: A SIGKILL failure on one hung entry does not block rewriting its state or processing siblings
    Given findHungOrchestrators returns entries with adwIds "sweep-c" (pid 5001) and "sweep-d" (pid 5002)
    And process.kill throws when called for pid 5001
    When checkAndTrigger processes the cycle
    Then AgentStateManager.writeTopLevelState is called with adwId "sweep-c" and workflowStage "abandoned"
    And process.kill is called with pid 5002 and signal "SIGKILL"
    And AgentStateManager.writeTopLevelState is called with adwId "sweep-d" and workflowStage "abandoned"

  # ═══════════════════════════════════════════════════════════════════════════
  # 7. Contract test — injected clock plus fixture state files
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-465 @regression
  Scenario: Contract-test file exists at adws/core/__tests__/hungOrchestratorDetector.test.ts
    Then the file "adws/core/__tests__/hungOrchestratorDetector.test.ts" exists

  @adw-465 @regression
  Scenario: Contract test injects a clock value rather than reading the system clock
    Given "adws/core/__tests__/hungOrchestratorDetector.test.ts" is read
    Then the test file passes an explicit "now" value to findHungOrchestrators
    And the test file does not rely on Date.now for its staleness assertions

  @adw-465 @regression
  Scenario: Contract test seeds fixture state files instead of exercising real orchestrators
    Given "adws/core/__tests__/hungOrchestratorDetector.test.ts" is read
    Then the test file writes fixture state files under a per-test agents state directory
    And the test file removes its per-test state directory in an "afterEach" or equivalent hook

  @adw-465 @regression
  Scenario: Contract test covers the live-PID plus stale-lastSeenAt positive case
    Given "adws/core/__tests__/hungOrchestratorDetector.test.ts" is read
    Then a test asserts findHungOrchestrators returns an entry when the PID is live and lastSeenAt is older than staleThresholdMs

  @adw-465 @regression
  Scenario: Contract test covers the dead-PID exclusion case
    Given "adws/core/__tests__/hungOrchestratorDetector.test.ts" is read
    Then a test asserts findHungOrchestrators excludes entries whose PID is not live

  @adw-465 @regression
  Scenario: Contract test covers the fresh-lastSeenAt exclusion case
    Given "adws/core/__tests__/hungOrchestratorDetector.test.ts" is read
    Then a test asserts findHungOrchestrators excludes entries whose lastSeenAt is within the staleness threshold

  @adw-465 @regression
  Scenario: Contract test covers the non-*_running-stage exclusion case
    Given "adws/core/__tests__/hungOrchestratorDetector.test.ts" is read
    Then a test asserts findHungOrchestrators excludes entries whose workflowStage does not end in "_running"

  @adw-465
  Scenario: Contract test substitutes a fake isProcessLive instead of probing real pids
    Given "adws/core/__tests__/hungOrchestratorDetector.test.ts" is read
    Then the test file substitutes a fake processLiveness seam rather than invoking real-PID probes
    And no test asserts against the current process's real pid

  # ═══════════════════════════════════════════════════════════════════════════
  # 8. Cron-integration test — SIGKILL and state rewrite happen for returned entries
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-465 @regression
  Scenario: Cron-integration test asserts SIGKILL is sent for each hung entry returned by the detector
    Given "adws/triggers/__tests__/trigger_cron.test.ts" is read
    Then an integration test stubs findHungOrchestrators to return a hung entry
    And the test asserts process.kill is called with that entry's pid and signal "SIGKILL"

  @adw-465 @regression
  Scenario: Cron-integration test asserts workflowStage is rewritten to abandoned for each hung entry
    Given "adws/triggers/__tests__/trigger_cron.test.ts" is read
    Then an integration test stubs findHungOrchestrators to return a hung entry
    And the test asserts AgentStateManager.writeTopLevelState is called with workflowStage "abandoned" for that entry's adwId

  @adw-465
  Scenario: Cron-integration test injects a fake clock so staleness is deterministic
    Given "adws/triggers/__tests__/trigger_cron.test.ts" is read
    Then the hung-orchestrator integration test injects its own "now" rather than relying on the system clock

  @adw-465
  Scenario: Cron-integration test cleans up its per-test agents state directory
    Given "adws/triggers/__tests__/trigger_cron.test.ts" is read
    Then the hung-orchestrator integration test removes any fixture state files it creates in an "afterEach" or equivalent hook

  # ═══════════════════════════════════════════════════════════════════════════
  # 9. TypeScript compilation gate
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-465 @regression
  Scenario: TypeScript type-check passes after the hungOrchestratorDetector module is introduced
    When "bunx tsc --noEmit" is run
    Then the command exits with code 0
    And "bunx tsc --noEmit -p adws/tsconfig.json" also exits with code 0
