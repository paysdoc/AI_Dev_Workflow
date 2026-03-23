@adw-168
Feature: Review phase uses BDD scenario execution as proof

  The review phase uses tag-driven BDD scenario execution as proof, reading
  which tags to run and their severity from the machine-readable
  .adw/review_proof.md config. When .adw/scenarios.md is absent, the review
  falls back to the original code-diff proof behaviour.

  Background:
    Given the ADW workflow is configured for a target repository
    And the target repository has ".adw/scenarios.md" present
    And the review proof config defines tags and severity classifications

  @adw-168 @adw-s18k21-machine-readable-rev @regression
  Scenario: Review runs configured tag scenarios when scenarios.md exists
    Given the target repository has ".adw/scenarios.md" defining the scenarios directory
    And ".adw/review_proof.md" defines tags to run during review
    When the review phase executes
    Then the review phase runs scenarios for each tag defined in the review proof config
    And the review proof contains the scenario execution output
    And the review proof does not contain a code-diff analysis

  @adw-168 @adw-s18k21-machine-readable-rev @regression
  Scenario: Tag failures with blocker severity are reported as blocker issues
    Given the review proof config defines a tag with severity "blocker"
    And at least one scenario for that tag fails
    When the review phase executes
    Then the failed scenarios are reported as blocker issues
    And the review is marked as not passed
    And the patch agent is invoked to fix the blockers

  @adw-168 @adw-s18k21-machine-readable-rev @regression
  Scenario: All configured tag scenarios passing means the review passes
    Given the review proof config defines tags to run during review
    And all scenarios for every configured tag pass
    When the review phase executes
    Then the review is marked as passed
    And no blocker issues are reported

  @adw-168 @adw-s18k21-machine-readable-rev
  Scenario: @adw-{issueNumber} failures are classified as blocker per config
    Given the review proof config defines "@adw-{issueNumber}" with severity "blocker"
    And at least one "@adw-168" scenario fails
    When the review phase executes
    Then the "@adw-168" failures are reported as blocker issues
    And the review is marked as not passed

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

  @adw-168 @adw-s18k21-machine-readable-rev
  Scenario: review_proof.md specifies machine-readable tag-driven proof for ADW project
    Given the ADW project's ".adw/review_proof.md" is present
    When the review_proof.md file is read
    Then it contains a "## Tags" section defining which tags to run during review
    And it contains a "## Supplementary Checks" section for type-check and lint
    And it does not reference "bun run test" output as primary proof
    And it does not reference "code-diff verification" as primary proof
