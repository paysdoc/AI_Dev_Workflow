@adw-3tkya9-machine-readable-rev
Feature: Machine-readable review_proof.md + tag-driven scenario execution

  Replace the prose-based .adw/review_proof.md with a machine-readable format
  that defines which BDD tags to run during review, their failure severity
  classification, and supplementary checks. regressionScenarioProof.ts reads
  this config instead of hardcoded tags. The three-tier tag strategy introduces
  @review-proof (blocker, every review), @adw-{issueNumber} (blocker, graceful
  skip), and moves @regression out of review into periodic GitHub Actions.

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

  # ── 3. {issueNumber} placeholder substitution ──────────────────────────────

  @adw-3tkya9-machine-readable-rev
  Scenario: Orchestration layer substitutes {issueNumber} in tag names before review
    Given the review proof config contains a tag "@adw-{issueNumber}"
    And the current issue number is 273
    When the orchestration layer processes the config
    Then the tag is resolved to "@adw-273"
    And the review agent receives concrete tags without {issueNumber} placeholders

  @adw-3tkya9-machine-readable-rev
  Scenario: {issueNumber} substitution is consistent with existing {tag} pattern in commands.md
    Given ".adw/commands.md" contains "## Run Scenarios by Tag" with a "{tag}" placeholder
    And ".adw/review_proof.md" uses "{issueNumber}" as a placeholder in tag names
    When the orchestration layer resolves placeholders
    Then "{issueNumber}" is substituted before passing tags to the review agent
    And the "{tag}" placeholder in commands.md is used at scenario execution time

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

  # ── 5. Three-tier tag strategy: severity and execution ──────────────────────

  @adw-3tkya9-machine-readable-rev
  Scenario: @review-proof failures are classified as blocker
    Given scenarios tagged "@review-proof" are executed during review
    And at least one "@review-proof" scenario fails
    When the review classifies the failure
    Then the failure severity is "blocker"
    And the review is marked as not passed

  @adw-3tkya9-machine-readable-rev
  Scenario: @adw-{issueNumber} failures are classified as blocker
    Given scenarios tagged "@adw-273" are executed during review for issue 273
    And at least one "@adw-273" scenario fails
    When the review classifies the failure
    Then the failure severity is "blocker"
    And the review is marked as not passed

  @adw-3tkya9-machine-readable-rev
  Scenario: Tech-debt severity tag failures do not block the review
    Given the review proof config defines a tag with severity "tech-debt"
    And at least one scenario for that tag fails
    When the review classifies the failure
    Then the failure severity is "tech-debt"
    And the review is not marked as blocked by the tech-debt failure
    And the tech-debt failure is reported as a non-blocking issue

  @adw-3tkya9-machine-readable-rev
  Scenario: Graceful skip when no @adw-{issueNumber} scenarios exist
    Given the review proof config defines "@adw-{issueNumber}" as a tag to run
    And no scenarios tagged "@adw-273" exist in the features directory
    When the scenario proof executes the @adw-273 tag
    Then the tag execution is skipped gracefully without error
    And no blocker issues are raised for the missing tag
    And the review continues with remaining configured tags

  @adw-3tkya9-machine-readable-rev
  Scenario: @regression is not executed during review
    Given the review proof config does not include "@regression" as a tag
    When the review phase executes
    Then "@regression" scenarios are not run during the review
    And "@regression" execution is deferred to a periodic GitHub Action

  # ── 6. Proof file output reflects config-driven tags ────────────────────────

  @adw-3tkya9-machine-readable-rev
  Scenario: Scenario proof markdown includes sections for each configured tag
    Given the review proof config defines "@review-proof" and "@adw-273" as tags
    When the scenario proof runner writes the proof file
    Then the proof markdown contains a section for "@review-proof" with status and output
    And the proof markdown contains a section for "@adw-273" with status and output
    And the proof markdown does not contain a section for "@regression"

  # ── 7. End-to-end compatibility ─────────────────────────────────────────────

  @adw-3tkya9-machine-readable-rev
  Scenario: Existing review flow works end-to-end with new config format
    Given ".adw/review_proof.md" uses the new machine-readable format with tags and severity
    And the review phase is executed for a branch with code changes
    When the review reads review_proof.md
    Then it successfully parses the tags, severity, and supplementary checks
    And the review produces a valid JSON output with scenario results
    And supplementary checks (type-check, lint) are executed as configured

  @adw-3tkya9-machine-readable-rev
  Scenario: Review fallback when review_proof.md is absent still works
    Given ".adw/review_proof.md" does not exist in the target repository
    When the review phase executes
    Then the review falls back to the default proof behavior
    And no error is raised due to a missing review_proof.md

  # ── 8. TypeScript integrity ─────────────────────────────────────────────────

  @adw-3tkya9-machine-readable-rev @regression
  Scenario: TypeScript type-check passes after all changes for issue 273
    Given the ADW codebase has been modified for issue 273
    When "bunx tsc --noEmit" and "bunx tsc --noEmit -p adws/tsconfig.json" are run
    Then both type-check commands exit with code 0
