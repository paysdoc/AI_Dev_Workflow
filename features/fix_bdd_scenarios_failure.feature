@adw-8fns89-error-in-issue-288
Feature: Fix BDD scenarios failure that blocks PR creation

  During workflow run r4f0gi for issue #278, the BDD scenarios phase failed
  within ~2.5 seconds of starting, producing "BDD scenarios failed. No PR was
  created." The root cause must be identified and fixed so that BDD scenarios
  either pass or produce actionable diagnostic output when they fail.

  Background:
    Given the ADW codebase is at the current working directory

  # ── 1. Test phase must NOT run BDD scenarios ───────────────────────────────

  @adw-8fns89-error-in-issue-288 @adw-399 @regression
  Scenario: unitTestPhase.ts does not import or call any BDD scenario runner
    Given "adws/phases/unitTestPhase.ts" is read
    Then the file does not contain "runBddScenariosWithRetry"
    And the file does not contain "runScenariosByTag"
    And the file does not contain "bddScenarioRunner"
    And the file does not contain "Phase: BDD Scenarios"
    And the file does not contain "Phase 2: BDD Scenarios"

  @adw-8fns89-error-in-issue-288 @adw-399 @regression
  Scenario: unitTestPhase.ts logs success message after skipping disabled unit tests
    Given "adws/phases/unitTestPhase.ts" is read
    Then the file contains "Unit tests disabled"
    And the file does not contain "BDD scenarios failed"

  # ── 2. BDD scenarios run only during review phase ──────────────────────────

  @adw-8fns89-error-in-issue-288 @regression
  Scenario: Review phase runs scenario proof before review agents
    Given "adws/phases/reviewPhase.ts" is read
    Then the file contains "scenarioProofPath"
    And the file contains "runReviewAgent"
    And the scenario proof invocation occurs before the review agent launch

  @adw-8fns89-error-in-issue-288 @regression
  Scenario: Scenario proof uses runByTagCommand from project config
    Given "adws/phases/scenarioProof.ts" is read
    Then the file contains "runByTagCommand"

  # ── 3. BDD scenario runner error handling ──────────────────────────────────

  @adw-8fns89-error-in-issue-288 @regression
  Scenario: runScenariosByTag captures both stdout and stderr
    Given "adws/agents/bddScenarioRunner.ts" is read
    Then the file contains "proc.stdout.on"
    And the file contains "proc.stderr.on"
    And the resolved result includes stdout, stderr, and exitCode fields

  @adw-8fns89-error-in-issue-288
  Scenario: runScenariosByTag returns allPassed false when exit code is non-zero
    Given "adws/agents/bddScenarioRunner.ts" is read
    Then the file contains "allPassed: exitCode === 0"

  @adw-8fns89-error-in-issue-288 @regression
  Scenario: runScenariosByTag skips gracefully when tagCommand is N/A or empty
    Given "adws/agents/bddScenarioRunner.ts" is read
    Then the file checks for empty or N/A tagCommand before spawning a subprocess
    And it returns allPassed true when the command is skipped

  # ── 5. Scenario proof blocker detection ────────────────────────────────────

  @adw-8fns89-error-in-issue-288 @regression
  Scenario: Scenario proof detects blocker failures from non-passing tags
    Given "adws/phases/scenarioProof.ts" is read
    Then hasBlockerFailures is true when any non-skipped tag with severity blocker did not pass

  @adw-8fns89-error-in-issue-288
  Scenario: Scenario proof skips optional tags with zero matching scenarios
    Given "adws/phases/scenarioProof.ts" is read
    Then when a tag is optional and produces zero scenarios output it is marked as skipped
    And skipped tags do not count as blocker failures

  # ── 7. Error reporting includes actionable detail ──────────────────────────

  @adw-8fns89-error-in-issue-288 @regression
  Scenario: Scenario proof writes detailed markdown with output per tag
    Given "adws/phases/scenarioProof.ts" is read
    Then the proof markdown includes the resolved tag name
    And the proof markdown includes the exit code
    And the proof markdown includes the scenario output

  @adw-8fns89-error-in-issue-288
  Scenario: Review failure error message includes blocker count
    Given "adws/phases/workflowCompletion.ts" is read
    Then the review failure message includes the number of remaining blockers
    And the workflow exits with code 1 when review fails
