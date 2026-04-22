@adw-466 @adw-bzlaaq-orchestrator-resilie
Feature: Paused-workflow resume verifies the canonical claim before continuing

  `pauseQueueScanner.resumeWorkflow()` was previously free to spawn a
  replacement orchestrator the moment the rate-limit probe reported clear.
  That left two failure modes open:

  1. **Manual state-edit drift.** An operator (or a buggy write) swaps the
     `adwId` recorded in the top-level state for the queued issue. The queue
     entry still points at the old `adwId`, so resuming it continues work on a
     state file that no longer belongs to the paused workflow.
  2. **Split-brain.** Another orchestrator acquired the per-issue lock while
     the original was paused (e.g. via the takeover handler after a force
     recovery). Resuming the queued entry produces two processes driving the
     same issue.

  Per the `orchestrator-coordination-resilience` PRD's Takeover decision tree
  and Further Notes, the pause queue scanner remains the sole resumer of
  paused workflows — the takeover handler keeps `paused` as a no-op. This
  slice makes the scanner verify the *canonical claim* before handing off:
  the resuming process must (a) acquire the per-issue spawn lock, and
  (b) re-read the top-level state for the queue entry's `adwId` and confirm
  the persisted `adwId` field still matches. A failure on either half aborts
  the resume, emits a clear log line naming the conflict, and leaves the
  state file untouched. The pause queue entry is preserved for a later cycle.

  The happy path (paused → resume → continue) is unchanged: matching lock +
  matching `adwId` lets the existing spawn/readiness/remove flow run exactly
  as before.

  Addresses user story 15 of the orchestrator-coordination-resilience PRD.
  Blocked by #463 (spawnGate lifetime + PID+start-time liveness).

  Background:
    Given the ADW codebase is checked out

  # ═══════════════════════════════════════════════════════════════════════════
  # 1. Resume acquires the per-issue spawn lock before continuing
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-466 @regression
  Scenario: resumeWorkflow imports acquireIssueSpawnLock from spawnGate
    Given "adws/triggers/pauseQueueScanner.ts" is read
    Then "acquireIssueSpawnLock" is imported from "./spawnGate"
    And "releaseIssueSpawnLock" is imported from "./spawnGate"

  @adw-466 @regression
  Scenario: resumeWorkflow calls acquireIssueSpawnLock before spawning the child orchestrator
    Given "adws/triggers/pauseQueueScanner.ts" is read
    Then in resumeWorkflow "acquireIssueSpawnLock(" appears before "spawn("
    And in resumeWorkflow "acquireIssueSpawnLock(" appears before "removeFromPauseQueue("

  @adw-466 @regression
  Scenario: resumeWorkflow passes the current process pid to acquireIssueSpawnLock
    Given "adws/triggers/pauseQueueScanner.ts" is read
    Then resumeWorkflow calls acquireIssueSpawnLock with the repoInfo and "entry.issueNumber" and "process.pid"

  @adw-466 @regression
  Scenario: resumeWorkflow aborts when acquireIssueSpawnLock returns false
    Given a pause queue entry for issue 42 with adwId "aaa11111"
    And a live orchestrator already holds the per-issue spawn lock for the same repo and issue 42
    When resumeWorkflow is invoked for the queued entry
    Then acquireIssueSpawnLock returns false
    And no child orchestrator is spawned
    And removeFromPauseQueue is not called for "aaa11111"
    And the top-level state file for "aaa11111" is not written

  @adw-466 @regression
  Scenario: resumeWorkflow releases the per-issue lock before the child orchestrator acquires its own
    Given "adws/triggers/pauseQueueScanner.ts" is read
    Then in resumeWorkflow "releaseIssueSpawnLock(" appears after "acquireIssueSpawnLock("
    And in resumeWorkflow "releaseIssueSpawnLock(" appears before "spawn("

  # ═══════════════════════════════════════════════════════════════════════════
  # 2. Resume re-reads top-level state and aborts on adwId divergence
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-466 @regression
  Scenario: resumeWorkflow imports readTopLevelState from agentState
    Given "adws/triggers/pauseQueueScanner.ts" is read
    Then "AgentStateManager" or "readTopLevelState" is imported from "../core/agentState"

  @adw-466 @regression
  Scenario: resumeWorkflow re-reads the top-level state after acquiring the lock
    Given "adws/triggers/pauseQueueScanner.ts" is read
    Then in resumeWorkflow the top-level state read for "entry.adwId" appears after "acquireIssueSpawnLock("
    And the top-level state read appears before "spawn("

  @adw-466 @regression
  Scenario: resumeWorkflow aborts when the top-level state's adwId diverges from the queue entry
    Given a pause queue entry for issue 42 with adwId "aaa11111"
    And the top-level state file at "agents/aaa11111/state.json" records adwId "bbb22222"
    When resumeWorkflow is invoked for the queued entry
    Then the resume aborts before spawning a child orchestrator
    And removeFromPauseQueue is not called for "aaa11111"
    And no write to "agents/aaa11111/state.json" occurs during the abort
    And the previously acquired per-issue spawn lock is released

  @adw-466 @regression
  Scenario: resumeWorkflow aborts when the top-level state file has been deleted
    Given a pause queue entry for issue 42 with adwId "aaa11111"
    And no top-level state file exists at "agents/aaa11111/state.json"
    When resumeWorkflow is invoked for the queued entry
    Then the resume aborts before spawning a child orchestrator
    And the per-issue spawn lock is released
    And removeFromPauseQueue is not called for "aaa11111"

  @adw-466
  Scenario: resumeWorkflow tolerates a top-level state that matches exactly
    Given a pause queue entry for issue 42 with adwId "aaa11111"
    And the top-level state file at "agents/aaa11111/state.json" records adwId "aaa11111"
    And no live process holds the per-issue spawn lock for issue 42
    When resumeWorkflow is invoked for the queued entry
    Then the canonical-claim verification passes
    And the existing spawn + readiness flow proceeds unchanged

  # ═══════════════════════════════════════════════════════════════════════════
  # 3. Abort emits a clear conflict log line and does not rewrite state
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-466 @regression
  Scenario: Lock-held abort logs a message naming the issue number and the queue-entry adwId
    Given a pause queue entry for issue 42 with adwId "aaa11111"
    And a live orchestrator already holds the per-issue spawn lock for the same repo and issue 42
    When resumeWorkflow is invoked for the queued entry
    Then a log line is emitted at level "error" or "warn"
    And the log line contains the string "aaa11111"
    And the log line mentions the issue number 42
    And the log line describes the conflict as a held spawn lock

  @adw-466 @regression
  Scenario: adwId-divergence abort logs a message naming both adwIds
    Given a pause queue entry for issue 42 with adwId "aaa11111"
    And the top-level state file at "agents/aaa11111/state.json" records adwId "bbb22222"
    When resumeWorkflow is invoked for the queued entry
    Then a log line is emitted at level "error" or "warn"
    And the log line contains the string "aaa11111"
    And the log line contains the string "bbb22222"
    And the log line describes the conflict as an adwId mismatch on the top-level state file

  @adw-466 @regression
  Scenario: Abort path never calls writeTopLevelState or AgentStateManager.writeTopLevelState
    Given "adws/triggers/pauseQueueScanner.ts" is read
    Then the canonical-claim abort branch in resumeWorkflow does not call "writeTopLevelState"
    And the canonical-claim abort branch does not call "removeFromPauseQueue"

  @adw-466
  Scenario: Abort preserves the pause queue entry for a later cycle
    Given a pause queue entry for issue 42 with adwId "aaa11111"
    And the top-level state file at "agents/aaa11111/state.json" records adwId "bbb22222"
    When resumeWorkflow is invoked for the queued entry
    Then the pause queue still contains an entry with adwId "aaa11111" after the call returns

  # ═══════════════════════════════════════════════════════════════════════════
  # 4. Happy-path preservation — no behaviour change
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-466 @regression
  Scenario: Matching canonical claim proceeds through the existing spawn pipeline
    Given a pause queue entry for issue 42 with adwId "aaa11111"
    And the top-level state file at "agents/aaa11111/state.json" records adwId "aaa11111"
    And no live process holds the per-issue spawn lock for issue 42
    When resumeWorkflow is invoked for the queued entry
    Then a child orchestrator is spawned with the existing spawn arguments
    And the child is given "cwd: process.cwd()" as the spawn cwd
    And after the readiness window passes removeFromPauseQueue is called with "aaa11111"

  @adw-466 @regression
  Scenario: Happy path still preserves entry.extraArgs when spawning the child
    Given a pause queue entry for issue 42 with adwId "aaa11111" and extraArgs "['--target-repo', 'acme/widgets']"
    And the canonical claim verifies successfully
    When resumeWorkflow is invoked for the queued entry
    Then the spawn arguments include the spread "...(entry.extraArgs ?? [])"

  @adw-466 @regression
  Scenario: Worktree-missing branch still takes precedence over canonical-claim verification
    Given a pause queue entry for issue 42 with adwId "aaa11111"
    And the worktree path for the entry no longer exists on disk
    When resumeWorkflow is invoked for the queued entry
    Then removeFromPauseQueue is called with "aaa11111"
    And acquireIssueSpawnLock is not invoked for the entry
    And no top-level state read is performed for "aaa11111"

  # ═══════════════════════════════════════════════════════════════════════════
  # 5. Unit test coverage — the three required cases
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-466 @regression
  Scenario: pauseQueueScanner unit test file exists at the conventional path
    Then the file "adws/triggers/__tests__/pauseQueueScanner.test.ts" exists

  @adw-466 @regression
  Scenario: Unit tests mock spawnGate so assertions do not depend on real lock files
    Given "adws/triggers/__tests__/pauseQueueScanner.test.ts" is read
    Then the file mocks the "../spawnGate" module
    And the file registers mock implementations for "acquireIssueSpawnLock" and "releaseIssueSpawnLock"

  @adw-466 @regression
  Scenario: Unit tests mock agentState so the top-level read can be scripted per-case
    Given "adws/triggers/__tests__/pauseQueueScanner.test.ts" is read
    Then the file mocks the "../../core/agentState" module
    And the file registers a mock implementation for the top-level state read

  @adw-466 @regression
  Scenario: Unit tests cover the happy path — matching lock and matching adwId proceed
    Given "adws/triggers/__tests__/pauseQueueScanner.test.ts" is read
    Then a test configures acquireIssueSpawnLock to return true
    And that test configures the top-level state read to return a state whose adwId matches the queue entry
    And that test asserts spawn is invoked
    And that test asserts removeFromPauseQueue is called with the queue entry's adwId

  @adw-466 @regression
  Scenario: Unit tests cover the adwId-divergence abort case after a manual state edit
    Given "adws/triggers/__tests__/pauseQueueScanner.test.ts" is read
    Then a test configures acquireIssueSpawnLock to return true
    And that test configures the top-level state read to return a state whose adwId differs from the queue entry
    And that test asserts spawn is NOT invoked
    And that test asserts removeFromPauseQueue is NOT called
    And that test asserts releaseIssueSpawnLock IS called
    And that test asserts a log line is emitted naming both the expected and the observed adwId

  @adw-466 @regression
  Scenario: Unit tests cover the lock-already-held abort case
    Given "adws/triggers/__tests__/pauseQueueScanner.test.ts" is read
    Then a test configures acquireIssueSpawnLock to return false
    And that test asserts spawn is NOT invoked
    And that test asserts removeFromPauseQueue is NOT called
    And that test asserts the top-level state read is NOT performed
    And that test asserts a log line is emitted naming the held-lock conflict

  @adw-466
  Scenario: Unit tests confirm the abort path never invokes writeTopLevelState
    Given "adws/triggers/__tests__/pauseQueueScanner.test.ts" is read
    Then the adwId-divergence test asserts writeTopLevelState is never called during the abort
    And the lock-held test asserts writeTopLevelState is never called during the abort

  # ═══════════════════════════════════════════════════════════════════════════
  # 6. Takeover handler continues to treat `paused` as a no-op
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-466 @regression
  Scenario: Takeover handler treats `paused` stage as a no-op — pauseQueueScanner is the sole resumer
    Given a top-level state file whose workflowStage is "paused"
    When the takeover decision path evaluates the candidate for that issue
    Then the decision is a no-op or skip
    And the takeover handler does not attempt to resume the paused workflow

  # ═══════════════════════════════════════════════════════════════════════════
  # 7. TypeScript compilation gate
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-466 @regression
  Scenario: TypeScript type-check passes after the canonical-claim verification is wired in
    When "bunx tsc --noEmit" is run
    Then the command exits with code 0
    And "bunx tsc --noEmit -p adws/tsconfig.json" also exits with code 0
