@adw-168
Feature: Review phase uses BDD scenario execution as proof

  The review phase replaces code-diff analysis with @regression BDD scenario execution.
  Regression scenario failures are blockers; non-regression failures from the current issue
  are reported as tech-debt. When .adw/scenarios.md is absent, the review falls back
  to the original code-diff proof behaviour.

  Background:
    Given the ADW workflow is configured for a target repository
    And the target repository has ".adw/scenarios.md" present
    And the scenarios command is configured as "cucumber-js --tags \"@regression\""

  @adw-168 @regression
  Scenario: Review runs all @regression scenarios when scenarios.md exists
    Given the target repository has ".adw/scenarios.md" defining the scenarios directory
    And there are scenarios tagged "@regression" in the features directory
    When the review phase executes
    Then the review phase runs the regression scenario command from ".adw/scenarios.md"
    And the review proof contains the scenario execution output
    And the review proof does not contain a code-diff analysis

  @adw-168 @regression
  Scenario: @regression scenario failures are reported as blocker issues
    Given the target repository has "@regression" tagged scenarios
    And at least one "@regression" scenario fails
    When the review phase executes
    Then the failed "@regression" scenarios are reported as blocker issues
    And the review is marked as not passed
    And the patch agent is invoked to fix the blockers

  @adw-168 @regression
  Scenario: All @regression scenarios passing means the review passes
    Given the target repository has "@regression" tagged scenarios
    And all "@regression" scenarios pass
    When the review phase executes
    Then the review is marked as passed
    And no blocker issues are reported for regression scenarios

  @adw-168
  Scenario: Non-regression failures from the current issue are reported as tech-debt
    Given the target repository has scenarios tagged "@adw-168" that are not tagged "@regression"
    And at least one "@adw-168" non-regression scenario fails
    And all "@regression" scenarios pass
    When the review phase executes
    Then the review is marked as passed
    And the non-regression "@adw-168" failures are reported as tech-debt
    And no blocker issues are raised for the non-regression failures

  @adw-168
  Scenario: Review summary describes scenario results not code diff
    Given the target repository has ".adw/scenarios.md" present
    When the review phase completes
    Then the review summary contains scenario pass/fail counts
    And the review summary does not describe git diff changes
    And the proof attached to the PR reflects scenario execution output

  @adw-168 @regression
  Scenario: Review falls back to code-diff proof when scenarios.md is absent
    Given the target repository does NOT have ".adw/scenarios.md"
    When the review phase executes
    Then the review phase uses code-diff analysis as proof
    And the review proof contains code-diff verification results
    And the review proof contains test output summaries
    And the review proof contains type-check and lint results

  @adw-168
  Scenario: review_proof.md specifies scenario-based proof for ADW project
    Given the ADW project's ".adw/review_proof.md" is present
    When the review_proof.md file is read
    Then it specifies "@regression scenario execution" as the proof type
    And it does not reference "bun run test" output as primary proof
    And it does not reference "code-diff verification" as primary proof
