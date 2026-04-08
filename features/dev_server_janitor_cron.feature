@adw-394
Feature: Cron janitor for orphaned dev server processes

  devServerJanitor.ts is a cron probe that scans target repository worktrees
  for orphaned dev server processes left behind by SIGKILL'd orchestrators.
  It walks each target repo's .worktrees/ directory, runs lsof +D per
  worktree to find process holders, and applies the kill decision rule:
  leave alone if (workflow stage is non-terminal AND the orchestrator PID
  is still alive) OR (the worktree is younger than 30 minutes). Otherwise
  SIGTERM the process, wait, SIGKILL survivors. Wired into trigger_cron.ts
  on a 5-minute timer alongside pauseQueueScanner.

  Background:
    Given the ADW codebase is checked out

  # ═══════════════════════════════════════════════════════════════════════════
  # 1. Module existence and interface
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-394 @regression
  Scenario: devServerJanitor.ts exists in the triggers directory
    Then the file "adws/triggers/devServerJanitor.ts" exists

  @adw-394 @regression
  Scenario: devServerJanitor.ts exports runJanitorPass function
    Given "adws/triggers/devServerJanitor.ts" is read
    Then the file exports a function named "runJanitorPass"

  # ═══════════════════════════════════════════════════════════════════════════
  # 2. Wired into trigger_cron.ts on a 5-minute timer
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-394 @regression
  Scenario: trigger_cron.ts imports runJanitorPass from devServerJanitor
    Given "adws/triggers/trigger_cron.ts" is read
    Then it imports "runJanitorPass" from "./devServerJanitor" or "devServerJanitor"

  @adw-394 @regression
  Scenario: trigger_cron.ts invokes runJanitorPass on a 5-minute interval
    Given "adws/triggers/trigger_cron.ts" is read
    Then runJanitorPass is called on a timer with a 5-minute interval

  @adw-394
  Scenario: Existing pauseQueueScanner probe still functions after janitor wiring
    Given "adws/triggers/trigger_cron.ts" is read
    Then the file still imports and calls scanPauseQueue
    And no existing probe invocation is removed or disabled

  # ═══════════════════════════════════════════════════════════════════════════
  # 3. Worktree discovery
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-394 @regression
  Scenario: runJanitorPass walks the .worktrees/ directory of the target repo
    Given "adws/triggers/devServerJanitor.ts" is read
    Then the function scans a ".worktrees/" directory to discover worktree paths

  @adw-394
  Scenario: runJanitorPass handles missing .worktrees/ directory gracefully
    Given the target repo has no ".worktrees/" directory
    When runJanitorPass is invoked
    Then it completes without error and reports zero worktrees scanned

  # ═══════════════════════════════════════════════════════════════════════════
  # 4. Process discovery via lsof
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-394 @regression
  Scenario: runJanitorPass uses lsof to find processes holding files in each worktree
    Given "adws/triggers/devServerJanitor.ts" is read
    Then the function uses "lsof" to discover processes in each worktree directory

  @adw-394
  Scenario: runJanitorPass skips worktrees with no lsof-reported processes
    Given a worktree with no processes holding files
    When runJanitorPass evaluates the worktree
    Then the worktree is skipped without applying the kill decision rule

  # ═══════════════════════════════════════════════════════════════════════════
  # 5. State file lookup and stage classification
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-394 @regression
  Scenario: runJanitorPass reads the workflow stage from the state file
    Given "adws/triggers/devServerJanitor.ts" is read
    Then the function reads the workflow stage from the agent state file for each worktree

  @adw-394
  Scenario: runJanitorPass treats completed as a terminal stage
    Given a worktree with workflowStage "completed" in the state file
    When the kill decision rule evaluates the worktree
    Then the stage is classified as terminal

  @adw-394
  Scenario: runJanitorPass treats error as a terminal stage
    Given a worktree with workflowStage "error" in the state file
    When the kill decision rule evaluates the worktree
    Then the stage is classified as terminal

  @adw-394
  Scenario: runJanitorPass treats build_running as a non-terminal stage
    Given a worktree with workflowStage "build_running" in the state file
    When the kill decision rule evaluates the worktree
    Then the stage is classified as non-terminal

  # ═══════════════════════════════════════════════════════════════════════════
  # 6. Kill decision matrix — (terminal-stage × PID-alive) cells
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-394 @regression
  Scenario: Non-terminal stage with live orchestrator PID — process is left alone
    Given a worktree older than 30 minutes
    And the workflow stage is non-terminal
    And the orchestrator PID is still alive
    When the kill decision rule is evaluated
    Then the dev server process is left alone

  @adw-394 @regression
  Scenario: Non-terminal stage with dead orchestrator PID and old worktree — process is killed
    Given a worktree older than 30 minutes
    And the workflow stage is non-terminal
    And the orchestrator PID is dead
    When the kill decision rule is evaluated
    Then the dev server process is killed

  @adw-394 @regression
  Scenario: Terminal stage with live orchestrator PID and old worktree — process is killed
    Given a worktree older than 30 minutes
    And the workflow stage is terminal
    And the orchestrator PID is still alive
    When the kill decision rule is evaluated
    Then the dev server process is killed

  @adw-394 @regression
  Scenario: Terminal stage with dead orchestrator PID and old worktree — process is killed
    Given a worktree older than 30 minutes
    And the workflow stage is terminal
    And the orchestrator PID is dead
    When the kill decision rule is evaluated
    Then the dev server process is killed

  # ═══════════════════════════════════════════════════════════════════════════
  # 7. Age-based grace period (worktree younger than 30 minutes)
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-394 @regression
  Scenario: Worktree younger than 30 minutes is always left alone regardless of stage or PID
    Given a worktree younger than 30 minutes
    And the workflow stage is terminal
    And the orchestrator PID is dead
    When the kill decision rule is evaluated
    Then the dev server process is left alone

  @adw-394
  Scenario: Non-terminal stage with dead PID and young worktree is left alone
    Given a worktree younger than 30 minutes
    And the workflow stage is non-terminal
    And the orchestrator PID is dead
    When the kill decision rule is evaluated
    Then the dev server process is left alone

  # ═══════════════════════════════════════════════════════════════════════════
  # 8. Signal escalation — SIGTERM then SIGKILL
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-394 @regression
  Scenario: Kill sequence sends SIGTERM first
    Given a dev server process that should be killed
    When the janitor initiates the kill sequence
    Then SIGTERM is sent to the process first

  @adw-394 @regression
  Scenario: Kill sequence sends SIGKILL to survivors after SIGTERM grace period
    Given a dev server process that should be killed
    And the process survives SIGTERM
    When the SIGTERM grace period elapses
    Then SIGKILL is sent to the surviving process

  @adw-394
  Scenario: Kill sequence does not send SIGKILL if process exits after SIGTERM
    Given a dev server process that should be killed
    And the process exits after receiving SIGTERM
    When the SIGTERM grace period elapses
    Then SIGKILL is not sent

  # ═══════════════════════════════════════════════════════════════════════════
  # 9. Unit test coverage
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-394 @regression
  Scenario: Unit test file exists for devServerJanitor
    Then the file "adws/triggers/__tests__/devServerJanitor.test.ts" exists

  @adw-394 @regression
  Scenario: Unit tests cover all four cells of the decision matrix
    Given "adws/triggers/__tests__/devServerJanitor.test.ts" is read
    Then the test file contains test cases for:
      | stage        | pid_alive | expected   |
      | non-terminal | alive     | leave alone |
      | non-terminal | dead      | kill        |
      | terminal     | alive     | kill        |
      | terminal     | dead      | kill        |

  @adw-394 @regression
  Scenario: Unit tests verify SIGTERM/SIGKILL escalation
    Given "adws/triggers/__tests__/devServerJanitor.test.ts" is read
    Then the test file contains test cases for SIGTERM followed by SIGKILL escalation

  @adw-394
  Scenario: Unit tests mock fs operations and process.kill
    Given "adws/triggers/__tests__/devServerJanitor.test.ts" is read
    Then the test file mocks filesystem operations
    And the test file mocks process.kill or equivalent signal sending

  # ═══════════════════════════════════════════════════════════════════════════
  # 10. TypeScript compilation
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-394 @regression
  Scenario: TypeScript type-check passes after janitor probe implementation
    When "bunx tsc --noEmit" is run
    Then the command exits with code 0
    And "bunx tsc --noEmit -p adws/tsconfig.json" also exits with code 0
