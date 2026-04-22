@adw-467 @adw-i4m1uk-orchestrator-resilie
Feature: takeoverHandler integrates coordination primitives behind evaluateCandidate

  takeoverHandler is the integration point at which every coordination
  primitive in the orchestrator-resilience refactor converges. Whenever a
  new candidate (cron sweep, webhook event) arrives at an issue, cron and
  webhook must route it through a single decision tree before deciding
  whether to spawn, take over, defer to a live holder, or skip a terminal
  state. That decision tree lives in `evaluateCandidate({ issueNumber,
  repoInfo }) → CandidateDecision`, internally composing `spawnGate`,
  `processLiveness`, `agentState`, `remoteReconcile`, and `worktreeReset`.

  The decision tree implements exactly five outcomes from the PRD:

    • no state file                                      → spawn_fresh
    • completed / discarded stage                        → skip_terminal
    • abandoned stage                                    → take_over_adwId
      (worktreeReset → remoteReconcile → resume)
    • *_running stage, live PID not holding the lock    → SIGKILL →
      take_over_adwId
    • *_running stage, dead PID                          → take_over_adwId

  The `paused` stage is an explicit no-op — the pause queue scanner remains
  the sole resumer of paused workflows, matching the existing cron-filter
  behaviour that skips `paused` stages.

  All dependencies are injected so the full decision tree can be exhaustively
  unit-tested in isolation with no real filesystem, gh CLI, or git
  subprocess. An integration test exercises one end-to-end simulated
  takeover against a fixture `abandoned` state so the composition of the
  injected primitives is also proven at the module boundary.

  Addresses user stories 1, 6, 9, 15, and 22 of the orchestrator-coordination-resilience PRD.

  Background:
    Given the ADW codebase is checked out

  # ═══════════════════════════════════════════════════════════════════════════
  # 1. Module surface — location, exports, signature
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-467 @regression
  Scenario: takeoverHandler module exists at adws/triggers/takeoverHandler.ts
    Then the file "adws/triggers/takeoverHandler.ts" exists

  @adw-467 @regression
  Scenario: takeoverHandler exports evaluateCandidate
    Given "adws/triggers/takeoverHandler.ts" is read
    Then the file exports a function named "evaluateCandidate"

  @adw-467 @regression
  Scenario: takeoverHandler exports the CandidateDecision type
    Given "adws/triggers/takeoverHandler.ts" is read
    Then the file exports a type named "CandidateDecision"

  @adw-467 @regression
  Scenario: CandidateDecision union covers the four PRD outcomes
    Given "adws/triggers/takeoverHandler.ts" is read
    Then the "CandidateDecision" type includes the value "spawn_fresh"
    And the "CandidateDecision" type includes the value "take_over_adwId"
    And the "CandidateDecision" type includes the value "defer_live_holder"
    And the "CandidateDecision" type includes the value "skip_terminal"

  @adw-467 @regression
  Scenario: evaluateCandidate accepts an object with issueNumber and repoInfo
    Given "adws/triggers/takeoverHandler.ts" is read
    Then "evaluateCandidate" accepts a single parameter containing fields "issueNumber" and "repoInfo"
    And "evaluateCandidate" returns a value whose stable shape includes a "CandidateDecision"

  # ═══════════════════════════════════════════════════════════════════════════
  # 2. Dependency injection — every composed primitive is injectable
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-467 @regression
  Scenario: evaluateCandidate receives spawnGate, agentState, processLiveness, remoteReconcile, and worktreeReset as injected dependencies
    Given "adws/triggers/takeoverHandler.ts" is read
    Then the module accepts an injected dependency for "spawnGate" lock operations
    And the module accepts an injected dependency for "agentState" readers and writers
    And the module accepts an injected dependency for "processLiveness"
    And the module accepts an injected dependency for "remoteReconcile"
    And the module accepts an injected dependency for "worktreeReset"

  @adw-467 @regression
  Scenario: Default production dependencies wire the real primitives
    Given "adws/triggers/takeoverHandler.ts" is read
    Then the default dependency bundle imports "acquireIssueSpawnLock" from "./spawnGate"
    And the default dependency bundle imports "isProcessLive" from "../core/processLiveness"
    And the default dependency bundle imports "deriveStageFromRemote" from "../core/remoteReconcile"
    And the default dependency bundle imports "resetWorktreeToRemote" from "../vcs/worktreeReset"
    And the default dependency bundle reads top-level state via "AgentStateManager"

  @adw-467
  Scenario: Injected dependencies can be replaced with fakes in unit tests
    Given "adws/triggers/takeoverHandler.ts" is read
    Then every composed primitive is exposed as an injection seam
    And no composed primitive is bound at import time in a way that blocks test substitution

  # ═══════════════════════════════════════════════════════════════════════════
  # 3. Branch — no state file → spawn_fresh
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-467 @regression
  Scenario: No state file for the issue's adwId resolves to spawn_fresh
    Given no adw-id is discoverable for issue number 101 on repo "acme/widgets"
    When evaluateCandidate is invoked for issue 101 on repo "acme/widgets"
    Then the returned CandidateDecision is "spawn_fresh"
    And no worktreeReset call is recorded on the injected dependency
    And no remoteReconcile call is recorded on the injected dependency

  @adw-467 @regression
  Scenario: adw-id resolvable but no top-level state file also resolves to spawn_fresh
    Given an adw-id "fresh-467" is discoverable for issue 101 on repo "acme/widgets"
    And the top-level state file at "agents/fresh-467/state.json" is absent
    When evaluateCandidate is invoked for issue 101 on repo "acme/widgets"
    Then the returned CandidateDecision is "spawn_fresh"

  # ═══════════════════════════════════════════════════════════════════════════
  # 4. Branch — terminal stages → skip_terminal
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-467 @regression
  Scenario: workflowStage "completed" resolves to skip_terminal
    Given an adw-id "done-467" is discoverable for issue 102 on repo "acme/widgets"
    And the state file for "done-467" records workflowStage "completed"
    When evaluateCandidate is invoked for issue 102 on repo "acme/widgets"
    Then the returned CandidateDecision is "skip_terminal"
    And no worktreeReset call is recorded on the injected dependency
    And no remoteReconcile call is recorded on the injected dependency
    And no SIGKILL is issued against any PID

  @adw-467 @regression
  Scenario: workflowStage "discarded" resolves to skip_terminal
    Given an adw-id "discarded-467" is discoverable for issue 103 on repo "acme/widgets"
    And the state file for "discarded-467" records workflowStage "discarded"
    When evaluateCandidate is invoked for issue 103 on repo "acme/widgets"
    Then the returned CandidateDecision is "skip_terminal"
    And no worktreeReset call is recorded on the injected dependency
    And no remoteReconcile call is recorded on the injected dependency

  # ═══════════════════════════════════════════════════════════════════════════
  # 5. Branch — abandoned stage → take_over_adwId (worktreeReset → remoteReconcile → resume)
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-467 @regression
  Scenario: workflowStage "abandoned" resolves to take_over_adwId carrying the existing adwId
    Given an adw-id "abandoned-467" is discoverable for issue 104 on repo "acme/widgets"
    And the state file for "abandoned-467" records workflowStage "abandoned"
    And the state file records branchName "feature-issue-104-whatever"
    When evaluateCandidate is invoked for issue 104 on repo "acme/widgets"
    Then the returned CandidateDecision is "take_over_adwId"
    And the returned decision carries the adwId "abandoned-467"

  @adw-467 @regression
  Scenario: Abandoned takeover runs worktreeReset before remoteReconcile
    Given an adw-id "abandoned-467" is discoverable for issue 104 on repo "acme/widgets"
    And the state file for "abandoned-467" records workflowStage "abandoned"
    And the state file records branchName "feature-issue-104-whatever"
    When evaluateCandidate is invoked for issue 104 on repo "acme/widgets"
    Then "resetWorktreeToRemote" is recorded on the injected worktreeReset double
    And "deriveStageFromRemote" is recorded on the injected remoteReconcile double
    And the recorded order places the worktreeReset call before the remoteReconcile call

  @adw-467 @regression
  Scenario: Abandoned takeover passes the state-file branchName to worktreeReset
    Given an adw-id "abandoned-467" is discoverable for issue 104 on repo "acme/widgets"
    And the state file for "abandoned-467" records workflowStage "abandoned"
    And the state file records branchName "feature-issue-104-whatever"
    When evaluateCandidate is invoked for issue 104 on repo "acme/widgets"
    Then worktreeReset is invoked with branch "feature-issue-104-whatever"

  @adw-467 @regression
  Scenario: Abandoned takeover acquires the spawn lock before doing any recovery work
    Given an adw-id "abandoned-467" is discoverable for issue 104 on repo "acme/widgets"
    And the state file for "abandoned-467" records workflowStage "abandoned"
    When evaluateCandidate is invoked for issue 104 on repo "acme/widgets"
    Then "acquireIssueSpawnLock" is recorded on the injected spawnGate double
    And the spawnGate acquire call is recorded before the worktreeReset call
    And the spawnGate acquire call is recorded before any state write

  # ═══════════════════════════════════════════════════════════════════════════
  # 6. Branch — *_running with a dead PID → take_over_adwId (same recovery path)
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-467 @regression
  Scenario: *_running stage with a dead PID resolves to take_over_adwId
    Given an adw-id "dead-running-467" is discoverable for issue 105 on repo "acme/widgets"
    And the state file for "dead-running-467" records workflowStage "build_running"
    And the state file records pid 99999 and pidStartedAt "crashed-era"
    And the injected processLiveness reports the recorded PID as dead
    When evaluateCandidate is invoked for issue 105 on repo "acme/widgets"
    Then the returned CandidateDecision is "take_over_adwId"
    And the returned decision carries the adwId "dead-running-467"
    And no SIGKILL is issued against any PID

  @adw-467 @regression
  Scenario: *_running with a dead PID still runs worktreeReset before remoteReconcile
    Given an adw-id "dead-running-467" is discoverable for issue 105 on repo "acme/widgets"
    And the state file for "dead-running-467" records workflowStage "build_running"
    And the injected processLiveness reports the recorded PID as dead
    When evaluateCandidate is invoked for issue 105 on repo "acme/widgets"
    Then the recorded order places the worktreeReset call before the remoteReconcile call

  # ═══════════════════════════════════════════════════════════════════════════
  # 7. Branch — *_running with a live PID NOT holding the lock → SIGKILL → take_over_adwId
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-467 @regression
  Scenario: *_running stage with a live PID that is not the current lock holder triggers SIGKILL
    Given an adw-id "wedged-467" is discoverable for issue 106 on repo "acme/widgets"
    And the state file for "wedged-467" records workflowStage "test_running"
    And the state file records pid 12345 and pidStartedAt "Sat Apr 20 10:00:00 2026"
    And the injected processLiveness reports pid 12345 with the recorded start-time as live
    And the spawn lock for repo "acme/widgets" and issue 106 is not held by pid 12345
    When evaluateCandidate is invoked for issue 106 on repo "acme/widgets"
    Then SIGKILL is issued exactly once against pid 12345
    And the returned CandidateDecision is "take_over_adwId"
    And the returned decision carries the adwId "wedged-467"

  @adw-467 @regression
  Scenario: SIGKILL fires before worktreeReset on the live-PID-no-lock path
    Given an adw-id "wedged-467" is discoverable for issue 106 on repo "acme/widgets"
    And the state file for "wedged-467" records workflowStage "test_running"
    And the injected processLiveness reports the recorded PID as live
    And the spawn lock is not held by the recorded PID
    When evaluateCandidate is invoked for issue 106 on repo "acme/widgets"
    Then the recorded order places the SIGKILL call before the worktreeReset call
    And the recorded order places the worktreeReset call before the remoteReconcile call

  @adw-467
  Scenario: SIGKILL failure does not prevent the take_over_adwId decision
    Given an adw-id "wedged-467" is discoverable for issue 106 on repo "acme/widgets"
    And the state file for "wedged-467" records workflowStage "test_running"
    And the injected processLiveness reports the recorded PID as live
    And the spawn lock is not held by the recorded PID
    And the injected kill double throws "ESRCH" when invoked
    When evaluateCandidate is invoked for issue 106 on repo "acme/widgets"
    Then the returned CandidateDecision is "take_over_adwId"

  # ═══════════════════════════════════════════════════════════════════════════
  # 8. Branch — live holder currently owns the spawn lock → defer_live_holder
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-467 @regression
  Scenario: Live spawn-lock holder defers the candidate
    Given a spawn lock for repo "acme/widgets" and issue 107 is held by a live pid matching the recorded start-time
    When evaluateCandidate is invoked for issue 107 on repo "acme/widgets"
    Then the returned CandidateDecision is "defer_live_holder"
    And the existing spawn lock file is not removed
    And no worktreeReset call is recorded on the injected dependency
    And no remoteReconcile call is recorded on the injected dependency
    And no SIGKILL is issued against any PID

  @adw-467 @regression
  Scenario: Spawn lock held by a dead holder is reclaimed and the decision proceeds
    Given a spawn lock for repo "acme/widgets" and issue 108 is held by a pid that processLiveness reports as dead
    And the state file records workflowStage "abandoned" for the same adwId
    When evaluateCandidate is invoked for issue 108 on repo "acme/widgets"
    Then the stale spawn lock is reclaimed
    And the returned CandidateDecision is "take_over_adwId"

  # ═══════════════════════════════════════════════════════════════════════════
  # 9. Branch — paused stage is an explicit no-op
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-467 @regression
  Scenario: workflowStage "paused" is an explicit no-op for the takeover handler
    Given an adw-id "paused-467" is discoverable for issue 109 on repo "acme/widgets"
    And the state file for "paused-467" records workflowStage "paused"
    When evaluateCandidate is invoked for issue 109 on repo "acme/widgets"
    Then the returned CandidateDecision is not "take_over_adwId"
    And the returned CandidateDecision is not "spawn_fresh"
    And no worktreeReset call is recorded on the injected dependency
    And no remoteReconcile call is recorded on the injected dependency
    And no SIGKILL is issued against any PID

  @adw-467 @regression
  Scenario: paused workflows remain the responsibility of the pause queue scanner
    Given "adws/triggers/takeoverHandler.ts" is read
    Then the paused-stage branch comment notes that scanPauseQueue is the sole resumer
    And evaluateCandidate does not invoke any pause-queue resume helper

  # ═══════════════════════════════════════════════════════════════════════════
  # 10. Remote reconciliation consumes the derived stage
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-467 @regression
  Scenario: Derived remote stage drives the resume path on abandoned takeover
    Given an adw-id "abandoned-467" is discoverable for issue 104 on repo "acme/widgets"
    And the state file for "abandoned-467" records workflowStage "abandoned"
    And the injected remoteReconcile returns derived stage "awaiting_merge"
    When evaluateCandidate is invoked for issue 104 on repo "acme/widgets"
    Then the returned decision carries the derived stage "awaiting_merge"

  @adw-467
  Scenario: remoteReconcile runs with mandatory re-verification per its contract
    Given "adws/triggers/takeoverHandler.ts" is read
    Then evaluateCandidate invokes "deriveStageFromRemote" directly and does not bypass its re-verification path

  # ═══════════════════════════════════════════════════════════════════════════
  # 11. Cron trigger routes every candidate through evaluateCandidate
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-467 @regression
  Scenario: Cron trigger invokes evaluateCandidate before any spawn
    Given "adws/triggers/trigger_cron.ts" is read
    Then the cron trigger imports "evaluateCandidate" from "./takeoverHandler"
    And every spawn site in the cron trigger is gated behind a call to "evaluateCandidate"

  @adw-467 @regression
  Scenario: Cron trigger skips spawn for decision "defer_live_holder"
    Given "adws/triggers/trigger_cron.ts" is read
    Then the cron spawn path returns without spawning when evaluateCandidate returns "defer_live_holder"

  @adw-467 @regression
  Scenario: Cron trigger skips spawn for decision "skip_terminal"
    Given "adws/triggers/trigger_cron.ts" is read
    Then the cron spawn path returns without spawning when evaluateCandidate returns "skip_terminal"

  @adw-467 @regression
  Scenario: Cron trigger reuses the returned adwId on decision "take_over_adwId"
    Given "adws/triggers/trigger_cron.ts" is read
    Then the cron spawn path uses the adwId carried by the "take_over_adwId" decision when spawning the workflow

  @adw-467 @regression
  Scenario: Cron trigger spawns a fresh workflow on decision "spawn_fresh"
    Given "adws/triggers/trigger_cron.ts" is read
    Then the cron spawn path spawns a fresh workflow when evaluateCandidate returns "spawn_fresh"

  # ═══════════════════════════════════════════════════════════════════════════
  # 12. Webhook handler routes every candidate through evaluateCandidate
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-467 @regression
  Scenario: Webhook gatekeeper invokes evaluateCandidate before classifyAndSpawnWorkflow proceeds to spawn
    Given "adws/triggers/webhookGatekeeper.ts" is read
    Then the file imports "evaluateCandidate" from "./takeoverHandler"
    And classifyAndSpawnWorkflow calls "evaluateCandidate" before spawning

  @adw-467 @regression
  Scenario: Webhook handler defers to a live holder instead of spawning
    Given "adws/triggers/webhookGatekeeper.ts" is read
    Then classifyAndSpawnWorkflow returns without spawning when evaluateCandidate returns "defer_live_holder"

  @adw-467 @regression
  Scenario: Webhook handler skips spawn on terminal-state decision
    Given "adws/triggers/webhookGatekeeper.ts" is read
    Then classifyAndSpawnWorkflow returns without spawning when evaluateCandidate returns "skip_terminal"

  @adw-467 @regression
  Scenario: Webhook handler uses the returned adwId on take_over_adwId
    Given "adws/triggers/webhookGatekeeper.ts" is read
    Then classifyAndSpawnWorkflow reuses the adwId carried by the "take_over_adwId" decision when spawning the workflow

  # ═══════════════════════════════════════════════════════════════════════════
  # 13. Unit tests — every branch of the decision tree is covered with injected doubles
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-467 @regression
  Scenario: takeoverHandler unit-test file exists at the conventional path
    Then the file "adws/triggers/__tests__/takeoverHandler.test.ts" exists

  @adw-467 @regression
  Scenario: Unit tests construct injected doubles for every composed primitive
    Given "adws/triggers/__tests__/takeoverHandler.test.ts" is read
    Then the tests construct an injected double for "spawnGate"
    And the tests construct an injected double for "agentState" state reads and writes
    And the tests construct an injected double for "processLiveness"
    And the tests construct an injected double for "remoteReconcile"
    And the tests construct an injected double for "worktreeReset"

  @adw-467 @regression
  Scenario Outline: Unit test covers the "<branch>" decision-tree branch
    Given "adws/triggers/__tests__/takeoverHandler.test.ts" is read
    Then a test case asserts evaluateCandidate returns "<decision>" for the "<branch>" branch

    Examples:
      | branch                                   | decision           |
      | no state file                            | spawn_fresh        |
      | completed stage                          | skip_terminal      |
      | discarded stage                          | skip_terminal      |
      | abandoned stage                          | take_over_adwId    |
      | running with dead PID                    | take_over_adwId    |
      | running with live PID not holding lock   | take_over_adwId    |
      | live holder holds lock                   | defer_live_holder  |

  @adw-467 @regression
  Scenario: Unit test asserts SIGKILL is issued on the live-PID-no-lock branch
    Given "adws/triggers/__tests__/takeoverHandler.test.ts" is read
    Then a test case asserts the injected kill double is called with the recorded PID and "SIGKILL"

  @adw-467 @regression
  Scenario: Unit test asserts worktreeReset runs before remoteReconcile on the takeover paths
    Given "adws/triggers/__tests__/takeoverHandler.test.ts" is read
    Then a test case asserts the worktreeReset double is invoked before the remoteReconcile double on the abandoned branch
    And a test case asserts the worktreeReset double is invoked before the remoteReconcile double on the running-dead-PID branch

  @adw-467 @regression
  Scenario: Unit test asserts paused stage produces no side effects
    Given "adws/triggers/__tests__/takeoverHandler.test.ts" is read
    Then a test case asserts evaluateCandidate records no worktreeReset, remoteReconcile, or kill calls for the "paused" branch

  @adw-467
  Scenario: Unit tests do not invoke real filesystem, gh CLI, or git subprocesses
    Given "adws/triggers/__tests__/takeoverHandler.test.ts" is read
    Then no test invokes the real gh CLI
    And no test invokes a real git subprocess
    And no test writes to a real spawn-lock file on disk

  # ═══════════════════════════════════════════════════════════════════════════
  # 14. Integration test — end-to-end simulated takeover against a fixture abandoned state
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-467 @regression
  Scenario: Integration test exists for the abandoned-takeover end-to-end path
    Then a takeoverHandler integration test exists that exercises the composition against a fixture "abandoned" state

  @adw-467 @regression
  Scenario: Integration test drives the abandoned → worktreeReset → remoteReconcile → take_over_adwId path
    Given the fixture state file records workflowStage "abandoned" and a branchName
    When the integration test invokes evaluateCandidate
    Then the decision is "take_over_adwId"
    And worktreeReset is observed to have run against the fixture worktree
    And remoteReconcile is observed to have produced a derived stage
    And the returned decision carries the fixture's adwId

  # ═══════════════════════════════════════════════════════════════════════════
  # 15. TypeScript compilation gate
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-467 @regression
  Scenario: TypeScript type-check passes after adding takeoverHandler and its call-site wiring
    When "bunx tsc --noEmit" is run
    Then the command exits with code 0
    And "bunx tsc --noEmit -p adws/tsconfig.json" also exits with code 0
