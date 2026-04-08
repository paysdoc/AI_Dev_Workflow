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

  @adw-168
  Scenario: Review summary describes scenario results not code diff
    Given the target repository has ".adw/scenarios.md" present
    When the review phase completes
    Then the review summary contains scenario pass/fail counts
    And the review summary does not describe git diff changes
    And the proof attached to the PR reflects scenario execution output

  @adw-168
  Scenario: Review falls back to code-diff proof when scenarios.md is absent
    Given the target repository does NOT have ".adw/scenarios.md"
    When the review phase executes
    Then the review phase uses code-diff analysis as proof
    And the review proof contains code-diff verification results
    And the review proof contains test output summaries
    And the review proof contains type-check and lint results

  @adw-168 @adw-3tkya9-machine-readable-rev
  Scenario: review_proof.md specifies machine-readable tag-driven proof for ADW project
    Given the ADW project's ".adw/review_proof.md" is present
    When the review_proof.md file is read
    Then it contains a "## Tags" section defining which tags to run during review
    And it contains a "## Supplementary Checks" section for type-check and lint
    And it does not reference "bun run test" output as primary proof
    And it does not reference "code-diff verification" as primary proof
