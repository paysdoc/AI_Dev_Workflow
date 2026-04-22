@adw-462 @adw-zy5s32-orchestrator-resilie
Feature: heartbeat module writes lastSeenAt on a fixed interval, wired as a tracer into adwSdlc

  The `heartbeat` deep module owns a single `setInterval` that writes `lastSeenAt`
  to the top-level workflow state file every `intervalMs`. It exists so the cron
  sweeper can tell "the orchestrator process is alive AND its event loop is
  turning" from "the pid is still up but the loop is wedged" — phase progress
  alone cannot distinguish those cases because a hung phase simply stops writing.

  The module is intentionally shallow in logic and deep in importance: it knows
  nothing about phases, errors, retry, or workflow stages. Its only public
  operations are `startHeartbeat(adwId, intervalMs) → HeartbeatHandle` and
  `stopHeartbeat(handle)`. All writes go through
  `AgentStateManager.writeTopLevelState`, which already performs atomic
  write-then-rename and partial-patch merge — the heartbeat never touches the
  filesystem directly and never clobbers sibling state fields.

  Tick interval (30s default) and stale threshold (180s default — six missed
  ticks) live as constants in `adws/core/config` so operators can tune them via
  environment without code surgery. The stale threshold is consumed by the
  hung-orchestrator detector in a later slice and is exported from this slice
  purely so a single config module owns both values.

  This slice also wires the module into `adwSdlc` as a tracer-bullet integration:
  the heartbeat starts immediately after workflow state is initialised and is
  stopped from a `finally` block so it always releases its timer regardless of
  whether the orchestrator completes, errors, or pauses. The twelve-entrypoint
  shared wrapper that generalises this wiring is an explicitly later slice of
  the orchestrator-coordination-resilience PRD.

  Addresses user stories 5 and 14 of the orchestrator-coordination-resilience PRD.

  Background:
    Given the ADW codebase is checked out

  # ═══════════════════════════════════════════════════════════════════════════
  # 1. Module surface — file location and exports
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-462 @regression
  Scenario: heartbeat module exists at the core path
    Then the file "adws/core/heartbeat.ts" exists

  @adw-462 @regression
  Scenario: heartbeat module exports startHeartbeat and stopHeartbeat
    Given "adws/core/heartbeat.ts" is read
    Then the file exports "startHeartbeat"
    And the file exports "stopHeartbeat"

  @adw-462 @regression
  Scenario: heartbeat module exports the HeartbeatHandle type
    Given "adws/core/heartbeat.ts" is read
    Then the file exports "HeartbeatHandle"

  @adw-462
  Scenario: startHeartbeat accepts adwId and intervalMs and returns a HeartbeatHandle
    Given "adws/core/heartbeat.ts" is read
    Then "startHeartbeat" accepts "adwId: string" and "intervalMs: number" as its required parameters
    And "startHeartbeat" returns "HeartbeatHandle"

  @adw-462
  Scenario: stopHeartbeat accepts a HeartbeatHandle and returns void
    Given "adws/core/heartbeat.ts" is read
    Then "stopHeartbeat" accepts "handle: HeartbeatHandle" as its required parameter
    And "stopHeartbeat" returns "void"

  # ═══════════════════════════════════════════════════════════════════════════
  # 2. Config constants — tick interval and stale threshold
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-462 @regression
  Scenario: HEARTBEAT_TICK_INTERVAL_MS is defined in adws/core/config with a 30-second default
    Given "adws/core/config.ts" is read
    Then the file exports "HEARTBEAT_TICK_INTERVAL_MS"
    And the exported "HEARTBEAT_TICK_INTERVAL_MS" default value is 30000

  @adw-462 @regression
  Scenario: HEARTBEAT_STALE_THRESHOLD_MS is defined in adws/core/config with a 180-second default
    Given "adws/core/config.ts" is read
    Then the file exports "HEARTBEAT_STALE_THRESHOLD_MS"
    And the exported "HEARTBEAT_STALE_THRESHOLD_MS" default value is 180000

  @adw-462
  Scenario: the stale-threshold default equals six missed ticks at the default tick interval
    Given "adws/core/config.ts" is read
    Then the exported "HEARTBEAT_STALE_THRESHOLD_MS" default value equals six times the exported "HEARTBEAT_TICK_INTERVAL_MS" default value

  # ═══════════════════════════════════════════════════════════════════════════
  # 3. Shallow-logic module — no phase or error knowledge
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-462 @regression
  Scenario: heartbeat module does not import from the phases layer
    Given "adws/core/heartbeat.ts" is read
    Then the file does not import from "../phases"
    And the file does not import from "../workflowPhases"

  @adw-462
  Scenario: heartbeat module does not reference workflow-stage or phase-name symbols
    Given "adws/core/heartbeat.ts" is read
    Then the file does not contain "workflowStage"
    And the file does not contain "PhaseExecutionState"

  @adw-462
  Scenario: heartbeat module does not import or reference RateLimitError or handleWorkflowError
    Given "adws/core/heartbeat.ts" is read
    Then the file does not contain "RateLimitError"
    And the file does not contain "handleWorkflowError"

  @adw-462 @regression
  Scenario: heartbeat module writes via AgentStateManager.writeTopLevelState, not direct fs
    Given "adws/core/heartbeat.ts" is read
    Then the file imports "AgentStateManager" from "./agentState"
    And the file contains "AgentStateManager.writeTopLevelState"
    And the file does not contain "fs.writeFileSync"
    And the file does not contain "fs.renameSync"

  # ═══════════════════════════════════════════════════════════════════════════
  # 4. Contract test — startHeartbeat writes lastSeenAt within intervalMs * 1.5
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-462 @regression
  Scenario: startHeartbeat writes lastSeenAt at least once within intervalMs * 1.5
    Given a fresh top-level state file exists for adwId "hb-tick-01" with no lastSeenAt
    When startHeartbeat is called with adwId "hb-tick-01" and intervalMs 100
    And 150 milliseconds elapse
    Then the top-level state file for "hb-tick-01" has a non-empty "lastSeenAt" value
    And stopHeartbeat is called with the returned handle

  @adw-462
  Scenario: the lastSeenAt value written by startHeartbeat is a valid ISO 8601 timestamp
    Given a fresh top-level state file exists for adwId "hb-tick-02" with no lastSeenAt
    When startHeartbeat is called with adwId "hb-tick-02" and intervalMs 100
    And 150 milliseconds elapse
    Then the top-level state file for "hb-tick-02" has a "lastSeenAt" value that parses as a valid ISO 8601 timestamp
    And stopHeartbeat is called with the returned handle

  @adw-462
  Scenario: startHeartbeat writes multiple ticks over multiple intervals
    Given a fresh top-level state file exists for adwId "hb-tick-03" with no lastSeenAt
    When startHeartbeat is called with adwId "hb-tick-03" and intervalMs 100
    And 350 milliseconds elapse
    Then the top-level state file for "hb-tick-03" has had its "lastSeenAt" updated at least 2 times
    And stopHeartbeat is called with the returned handle

  # ═══════════════════════════════════════════════════════════════════════════
  # 5. Contract test — stopHeartbeat prevents further writes
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-462 @regression
  Scenario: stopHeartbeat prevents any further lastSeenAt writes
    Given a fresh top-level state file exists for adwId "hb-stop-01" with no lastSeenAt
    When startHeartbeat is called with adwId "hb-stop-01" and intervalMs 100
    And 150 milliseconds elapse
    And stopHeartbeat is called with the returned handle
    And the captured "lastSeenAt" value is recorded
    And 300 milliseconds elapse
    Then the top-level state file for "hb-stop-01" has the same "lastSeenAt" value as the one recorded

  @adw-462
  Scenario: stopHeartbeat called twice with the same handle does not throw
    Given a fresh top-level state file exists for adwId "hb-stop-02" with no lastSeenAt
    When startHeartbeat is called with adwId "hb-stop-02" and intervalMs 100
    And stopHeartbeat is called with the returned handle
    And stopHeartbeat is called with the same handle a second time
    Then no exception is thrown

  # ═══════════════════════════════════════════════════════════════════════════
  # 6. Atomicity & non-destructiveness — lastSeenAt tick preserves siblings
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-462 @regression
  Scenario: a heartbeat tick does not clobber unrelated top-level state fields
    Given a top-level state file for adwId "hb-merge-01" with issueNumber 42, workflowStage "build_running", branchName "feature-issue-42-slug", pid 4242, and pidStartedAt "3647284"
    When startHeartbeat is called with adwId "hb-merge-01" and intervalMs 100
    And 150 milliseconds elapse
    Then the persisted "issueNumber" is still 42
    And the persisted "workflowStage" is still "build_running"
    And the persisted "branchName" is still "feature-issue-42-slug"
    And the persisted "pid" is still 4242
    And the persisted "pidStartedAt" is still "3647284"
    And the persisted "lastSeenAt" is non-empty
    And stopHeartbeat is called with the returned handle

  @adw-462
  Scenario: a heartbeat tick does not clobber the phases map
    Given a top-level state file for adwId "hb-merge-02" with a phases map containing "install" completed and "plan" completed
    When startHeartbeat is called with adwId "hb-merge-02" and intervalMs 100
    And 150 milliseconds elapse
    Then the persisted phases map still contains "install" with status "completed"
    And the persisted phases map still contains "plan" with status "completed"
    And stopHeartbeat is called with the returned handle

  # ═══════════════════════════════════════════════════════════════════════════
  # 7. adwSdlc tracer wiring — superseded by #464's shared lifecycle wrapper
  # The slice-#6 tracer landed startHeartbeat/stopHeartbeat directly in adwSdlc;
  # slice #7 (#463) added orchestratorLock; slice #8 (#464) consolidated all of
  # the above into runWithOrchestratorLifecycle and removed the direct calls
  # from adwSdlc. The current contract for adwSdlc's heartbeat lifecycle now
  # lives in shared_orchestrator_lifecycle_wrapper.feature.
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-462 @adw-464 @regression
  Scenario: adwSdlc heartbeat lifecycle is delegated to the shared wrapper, not hand-rolled
    Given "adws/adwSdlc.tsx" is read
    Then the file does not import "startHeartbeat"
    And the file does not import "stopHeartbeat"
    And the file imports "runWithOrchestratorLifecycle" from "./phases/orchestratorLock"
    And the main function calls "runWithOrchestratorLifecycle"

  # ═══════════════════════════════════════════════════════════════════════════
  # 8. Phase-transition durability — lastSeenAt survives a sibling writeTopLevelState
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-462 @regression
  Scenario: a heartbeat tick is preserved across a phase-boundary writeTopLevelState call
    Given a fresh top-level state file exists for adwId "hb-phase-01" with no lastSeenAt
    When startHeartbeat is called with adwId "hb-phase-01" and intervalMs 100
    And 150 milliseconds elapse
    And the captured "lastSeenAt" value is recorded
    And writeTopLevelState is called for adwId "hb-phase-01" with patch "{ workflowStage: 'build_running' }"
    Then the persisted "lastSeenAt" equals the recorded value
    And the persisted "workflowStage" is "build_running"
    And stopHeartbeat is called with the returned handle

  # ═══════════════════════════════════════════════════════════════════════════
  # 9. Contract-test file required by the acceptance criteria
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-462 @regression
  Scenario: contract-test file exists at adws/core/__tests__/heartbeat.test.ts
    Then the file "adws/core/__tests__/heartbeat.test.ts" exists

  @adw-462 @regression
  Scenario: a contract test asserts startHeartbeat writes lastSeenAt within intervalMs * 1.5
    Given "adws/core/__tests__/heartbeat.test.ts" is read
    Then a test asserts startHeartbeat writes "lastSeenAt" at least once within "intervalMs * 1.5"

  @adw-462 @regression
  Scenario: a contract test asserts stopHeartbeat prevents further lastSeenAt writes
    Given "adws/core/__tests__/heartbeat.test.ts" is read
    Then a test asserts stopHeartbeat stops further "lastSeenAt" writes after it is called

  @adw-462
  Scenario: contract tests clean up any top-level state files they create
    Given "adws/core/__tests__/heartbeat.test.ts" is read
    Then the test file removes its per-test adwId state directory in an "afterEach" or equivalent hook

  # ═══════════════════════════════════════════════════════════════════════════
  # 10. TypeScript compilation gate
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-462 @regression
  Scenario: TypeScript type-check passes after the heartbeat module is introduced
    When "bunx tsc --noEmit" is run
    Then the command exits with code 0
    And "bunx tsc --noEmit -p adws/tsconfig.json" also exits with code 0
