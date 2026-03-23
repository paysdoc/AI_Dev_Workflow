@adw-j2ydkj-cost-revamp-github-c
Feature: Cost comment formatter with divergence warning and env var toggle

  The comment formatter presents cost data in GitHub issue comments using
  locally computed cost as the source of truth, with per-model token breakdown,
  multi-currency totals, divergence warnings when computed vs reported cost
  diverges by >5%, estimate-vs-actual reporting at phase completion, and a
  single SHOW_COST_IN_COMMENTS env var to toggle all cost content on or off.

  Background:
    Given the ADW codebase is checked out

  # ── 1: commentFormatter.ts module exists ──────────────────────────────────

  @adw-j2ydkj-cost-revamp-github-c @regression
  Scenario: commentFormatter.ts exists in the cost reporting directory
    Given the file "adws/cost/reporting/commentFormatter.ts" exists
    Then it exports a function for formatting cost comment sections

  # ── 2: Markdown table with per-model rows ─────────────────────────────────

  @adw-j2ydkj-cost-revamp-github-c @regression
  Scenario: Comment formatter produces a markdown table with per-model rows
    Given PhaseCostRecords for models "claude-opus-4-6" and "claude-sonnet-4-5"
    When the comment formatter formats the cost breakdown
    Then the output contains a markdown table
    And the table has one row per model
    And each row includes the model name, token counts, and computed cost in USD

  @adw-j2ydkj-cost-revamp-github-c
  Scenario: Comment formatter shows per-model token breakdown columns
    Given PhaseCostRecords with token usage including "input", "output", "cache_read", and "cache_write"
    When the comment formatter formats the cost breakdown
    Then the markdown table includes columns for each token type

  @adw-j2ydkj-cost-revamp-github-c
  Scenario: Comment formatter includes a total row summing all models
    Given PhaseCostRecords for models "claude-opus-4-6" with computed cost 0.50 and "claude-sonnet-4-5" with computed cost 0.10
    When the comment formatter formats the cost breakdown
    Then the output includes a total row showing 0.60 USD

  @adw-j2ydkj-cost-revamp-github-c
  Scenario: Comment formatter renders single-model cost without a table
    Given a single PhaseCostRecord for model "claude-sonnet-4-5"
    When the comment formatter formats the cost breakdown
    Then the output contains cost information for that model

  # ── 3: Multi-currency totals ──────────────────────────────────────────────

  @adw-j2ydkj-cost-revamp-github-c
  Scenario: Comment formatter shows multi-currency totals
    Given PhaseCostRecords with a total computed cost of 1.00 USD
    And an EUR exchange rate is available
    When the comment formatter formats the cost breakdown
    Then the output includes both USD and EUR totals

  # ── 4: Divergence warning ─────────────────────────────────────────────────

  @adw-j2ydkj-cost-revamp-github-c @regression
  Scenario: Divergence warning appears when computed vs reported cost diverges by more than 5%
    Given PhaseCostRecords where computed cost is 1.10 and reported cost is 1.00
    When the comment formatter formats the cost breakdown
    Then the output includes a divergence warning
    And the warning shows the percentage difference

  @adw-j2ydkj-cost-revamp-github-c
  Scenario: No divergence warning at 4.9% divergence
    Given PhaseCostRecords where computed cost is 1.049 and reported cost is 1.00
    When the comment formatter formats the cost breakdown
    Then the output does not include a divergence warning

  @adw-j2ydkj-cost-revamp-github-c
  Scenario: Divergence warning when reported cost exceeds computed by more than 5%
    Given PhaseCostRecords where computed cost is 0.94 and reported cost is 1.00
    When the comment formatter formats the cost breakdown
    Then the output includes a divergence warning

  @adw-j2ydkj-cost-revamp-github-c
  Scenario: No divergence warning when reported cost is undefined
    Given PhaseCostRecords where reported cost is undefined
    When the comment formatter formats the cost breakdown
    Then the output does not include a divergence warning

  @adw-j2ydkj-cost-revamp-github-c
  Scenario: Divergence warning when reported cost is zero and computed cost is positive
    Given PhaseCostRecords where computed cost is 0.50 and reported cost is 0.00
    When the comment formatter formats the cost breakdown
    Then the output includes a divergence warning

  # ── 5: Estimate-vs-actual at phase completion ─────────────────────────────

  @adw-j2ydkj-cost-revamp-github-c @regression
  Scenario: Estimate-vs-actual section shown at phase completion
    Given PhaseCostRecords with estimatedTokens input = 1500 and actualTokens input = 1600
    When the comment formatter formats the cost breakdown for a completed phase
    Then the output includes an estimate-vs-actual section
    And the section shows the estimated count, actual count, and percentage difference

  @adw-j2ydkj-cost-revamp-github-c
  Scenario: Estimate-vs-actual shows absolute numbers and percentage per token type
    Given PhaseCostRecords with estimatedTokens output = 250 and actualTokens output = 300
    When the comment formatter formats the cost breakdown for a completed phase
    Then the estimate-vs-actual section includes the estimated value 250
    And the section includes the actual value 300
    And the section includes the percentage difference

  @adw-j2ydkj-cost-revamp-github-c
  Scenario: Estimate-vs-actual section omitted when estimated tokens are not available
    Given PhaseCostRecords where estimatedTokens is undefined
    When the comment formatter formats the cost breakdown for a completed phase
    Then the output does not include an estimate-vs-actual section

  @adw-j2ydkj-cost-revamp-github-c
  Scenario: Estimate-vs-actual section omitted when actual tokens are not available
    Given PhaseCostRecords where actualTokens is undefined
    When the comment formatter formats the cost breakdown for a completed phase
    Then the output does not include an estimate-vs-actual section

  # ── 6: SHOW_COST_IN_COMMENTS env var toggle ───────────────────────────────

  @adw-j2ydkj-cost-revamp-github-c @regression
  Scenario: Cost content included in comments when SHOW_COST_IN_COMMENTS is true
    Given the environment variable "SHOW_COST_IN_COMMENTS" is set to "true"
    And PhaseCostRecords with cost data are available
    When the comment formatter checks whether to include cost content
    Then cost content is included in the comment output

  @adw-j2ydkj-cost-revamp-github-c @regression
  Scenario: Cost content excluded from comments when SHOW_COST_IN_COMMENTS is false
    Given the environment variable "SHOW_COST_IN_COMMENTS" is set to "false"
    And PhaseCostRecords with cost data are available
    When the comment formatter checks whether to include cost content
    Then cost content is not included in the comment output

  @adw-j2ydkj-cost-revamp-github-c
  Scenario: Cost content included by default when SHOW_COST_IN_COMMENTS is not set
    Given the environment variable "SHOW_COST_IN_COMMENTS" is not set
    And PhaseCostRecords with cost data are available
    When the comment formatter checks whether to include cost content
    Then cost content is included in the comment output

  @adw-j2ydkj-cost-revamp-github-c
  Scenario: Divergence warning also controlled by SHOW_COST_IN_COMMENTS
    Given the environment variable "SHOW_COST_IN_COMMENTS" is set to "false"
    And PhaseCostRecords with a >5% cost divergence
    When the comment formatter formats the cost breakdown
    Then the output does not include a divergence warning
    And the output does not include cost content

  # ── 7: CSV output unaffected by env var ───────────────────────────────────

  @adw-j2ydkj-cost-revamp-github-c @regression
  Scenario: Cost CSV output is unaffected by SHOW_COST_IN_COMMENTS setting
    Given the environment variable "SHOW_COST_IN_COMMENTS" is set to "false"
    And PhaseCostRecords with cost data are available
    When cost data is written to CSV
    Then the CSV file contains the cost records
    And the CSV output is identical to when SHOW_COST_IN_COMMENTS is "true"

  # ── 8: Phase comment helpers updated ──────────────────────────────────────

  @adw-j2ydkj-cost-revamp-github-c @regression
  Scenario: Issue workflow completed comment uses the new comment formatter
    Given the file "adws/github/workflowCommentsIssue.ts" is read
    Then the completed comment formatting imports from the cost comment formatter
    And the completed comment uses PhaseCostRecord-based cost formatting

  @adw-j2ydkj-cost-revamp-github-c @regression
  Scenario: Issue workflow error comment uses the new comment formatter
    Given the file "adws/github/workflowCommentsIssue.ts" is read
    Then the error comment formatting imports from the cost comment formatter

  @adw-j2ydkj-cost-revamp-github-c
  Scenario: PR review workflow completed comment uses the new comment formatter
    Given the file "adws/github/workflowCommentsPR.ts" is read
    Then the PR review completed comment formatting imports from the cost comment formatter

  @adw-j2ydkj-cost-revamp-github-c
  Scenario: PR review workflow error comment uses the new comment formatter
    Given the file "adws/github/workflowCommentsPR.ts" is read
    Then the PR review error comment formatting imports from the cost comment formatter

  # ── 9: Unit test coverage ─────────────────────────────────────────────────

  @adw-j2ydkj-cost-revamp-github-c @regression
  Scenario: Unit tests cover comment formatting output
    Given the cost module test files exist
    Then there are unit tests for the comment formatter producing correct markdown table output

  @adw-j2ydkj-cost-revamp-github-c @regression
  Scenario: Unit tests cover divergence warning inclusion at boundary
    Given the cost module test files exist
    Then there are unit tests verifying divergence warning appears above 5% and not at or below 5%

  @adw-j2ydkj-cost-revamp-github-c @regression
  Scenario: Unit tests cover env var toggle behavior
    Given the cost module test files exist
    Then there are unit tests verifying SHOW_COST_IN_COMMENTS toggles cost content on and off

  @adw-j2ydkj-cost-revamp-github-c
  Scenario: Unit tests cover estimate-vs-actual formatting
    Given the cost module test files exist
    Then there are unit tests verifying estimate-vs-actual section includes absolute numbers and percentages

  # ── 10: Type checks pass ──────────────────────────────────────────────────

  @adw-j2ydkj-cost-revamp-github-c @regression
  Scenario: All existing type checks still pass
    Given the ADW codebase with the comment formatter added
    When "bunx tsc --noEmit" is run
    Then the command exits with code 0
    And "bunx tsc --noEmit -p adws/tsconfig.json" also exits with code 0
