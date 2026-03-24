@adw-3tkya9-machine-readable-rev
Feature: Machine-readable review_proof.md + tag-driven scenario execution

  Replace the prose-based .adw/review_proof.md with a machine-readable format
  that defines which BDD tags to run during review, their failure severity
  classification, and supplementary checks. regressionScenarioProof.ts reads
  this config instead of hardcoded tags. The three-tier tag strategy introduces
  the review-proof tag (blocker, every review), adw-{issueNumber} (blocker, graceful
  skip), and moves the regression tag out of review into periodic GitHub Actions.

  Background:
    Given the ADW codebase is at the current working directory

  # ── 1. Machine-readable review_proof.md format ─────────────────────────────

  @adw-3tkya9-machine-readable-rev
  Scenario: review_proof.md contains a machine-readable tags section
    Given the file ".adw/review_proof.md" is read
    When the "## Tags" section is found
    Then it contains a structured list of BDD tags to run during review
    And each tag entry specifies the tag name and a severity classification
    And each tag entry specifies whether the tag is optional

  @adw-3tkya9-machine-readable-rev
  Scenario: review_proof.md defines @review-proof tag with blocker severity
    Given the file ".adw/review_proof.md" is read
    When the "## Tags" section is parsed
    Then it contains an entry for "@review-proof" with severity "blocker"

  @adw-3tkya9-machine-readable-rev
  Scenario: review_proof.md defines @adw-{issueNumber} tag with blocker severity
    Given the file ".adw/review_proof.md" is read
    When the "## Tags" section is parsed
    Then it contains an entry for "@adw-{issueNumber}" with severity "blocker"
    And the "@adw-{issueNumber}" entry is marked as optional

  @adw-3tkya9-machine-readable-rev
  Scenario: review_proof.md does not include @regression as a review tag
    Given the file ".adw/review_proof.md" is read
    When the "## Tags" section is parsed
    Then it does not contain an entry for "@regression"

  @adw-3tkya9-machine-readable-rev
  Scenario: review_proof.md contains a supplementary checks section
    Given the file ".adw/review_proof.md" is read
    When the "## Supplementary Checks" section is found
    Then it contains a type-check command entry
    And it contains a lint command entry

  @adw-3tkya9-machine-readable-rev
  Scenario: Supplementary check entries include a command and severity
    Given the file ".adw/review_proof.md" is read
    When the "## Supplementary Checks" section is parsed
    Then each check entry specifies a command to execute
    And each check entry specifies a failure severity classification

  # ── 2. regressionScenarioProof.ts reads config ─────────────────────────────

  @adw-3tkya9-machine-readable-rev
  Scenario: regressionScenarioProof.ts accepts tag config from review_proof.md
    Given the file "adws/agents/regressionScenarioProof.ts" is read
    When searching for the runScenarioProof function signature
    Then it accepts a parameter for tag-severity entries from the review proof config
    And it does not hardcode which tags to run

  @adw-3tkya9-machine-readable-rev
  Scenario: regressionScenarioProof.ts iterates over config tags instead of hardcoded values
    Given the file "adws/agents/regressionScenarioProof.ts" is read
    When searching for the scenario execution loop
    Then it iterates over the tags defined in the review proof config
    And it does not hardcode "@regression" as a tag to execute during review

  @adw-3tkya9-machine-readable-rev
  Scenario: regressionScenarioProof.ts classifies failures using per-tag severity from config
    Given the file "adws/agents/regressionScenarioProof.ts" is read
    When searching for severity classification logic
    Then severity is determined by the per-tag severity from the config
    And the severity is not hardcoded per tag name

  @adw-3tkya9-machine-readable-rev
  Scenario: ScenarioProofResult reflects config-driven tag results
    Given the file "adws/agents/regressionScenarioProof.ts" is read
    When the "ScenarioProofResult" interface is found
    Then it can represent results for an arbitrary set of tags
    And it is not limited to only @regression and @adw-{issueNumber} fields

  # ── 4. /review command: tag-driven, no hardcoded assumptions ────────────────

  @adw-3tkya9-machine-readable-rev
  Scenario: /review command reads tags from review_proof.md config
    Given the file ".claude/commands/review.md" is read
    When the proof requirements section is analyzed
    Then it instructs reading tag definitions from ".adw/review_proof.md"
    And it does not assume specific tag names for scenario execution

  @adw-3tkya9-machine-readable-rev
  Scenario: /review command does not hardcode @regression as a review tag
    Given the file ".claude/commands/review.md" is read
    When searching for tag references in the proof requirements
    Then it does not hardcode "@regression" as a tag to execute during review
    And tag execution is driven by the review proof config

  @adw-3tkya9-machine-readable-rev
  Scenario: /review command classifies failures per config severity
    Given the file ".claude/commands/review.md" is read
    When the proof requirements describe failure classification
    Then classification rules reference per-tag severity from the config
    And no tag has a hardcoded severity assumption in the review command

  # ── 8. TypeScript integrity ─────────────────────────────────────────────────

  @adw-3tkya9-machine-readable-rev @regression
  Scenario: TypeScript type-check passes after all changes for issue 273
    Given the ADW codebase has been modified for issue 273
    When "bunx tsc --noEmit" and "bunx tsc --noEmit -p adws/tsconfig.json" are run
    Then both type-check commands exit with code 0
