@adw-233
Feature: Fix issue number resolution in PR review workflow and serialise cost CSVs

  When the PR review workflow completes, the issue number must be resolved
  reliably. If the PR body lacks an "Implements #N" link, extraction falls
  back to the ADW branch-name format. When no issue number can be resolved,
  downstream consumers (project board moves, cost CSVs) are safely skipped.
  PR review cost CSVs use a serialised naming scheme so multiple review
  iterations for the same issue are grouped and sortable.

  Background:
    Given the ADW codebase is checked out

  # ── 1: Branch-name fallback for issue number extraction ────────────────────

  @adw-233 @regression
  Scenario: extractIssueNumberFromBranch matches ADW branch format
    Given "adws/triggers/webhookHandlers.ts" is read
    Then extractIssueNumberFromBranch matches ADW-style branches like "feature-42-abcd1234-slug"

  @adw-233 @regression
  Scenario: extractIssueNumberFromBranch still matches legacy issue-N pattern
    Given "adws/triggers/webhookHandlers.ts" is read
    Then extractIssueNumberFromBranch matches legacy branches like "feature/issue-42-slug"

  @adw-233 @regression
  Scenario: extractIssueNumberFromBranch returns null for non-matching branches
    Given "adws/triggers/webhookHandlers.ts" is read
    Then extractIssueNumberFromBranch returns null for "main"

  @adw-233 @regression
  Scenario: fetchPRDetails falls back to branch name when PR body has no issue link
    Given "adws/github/prApi.ts" is read
    Then fetchPRDetails references a branch-name extraction fallback for issueNumber

  # ── 2: Make issue number nullable in PR review config ──────────────────────

  @adw-233 @regression
  Scenario: PRReviewWorkflowConfig.issueNumber allows null
    Given "adws/phases/prReviewPhase.ts" is read
    Then the PRReviewWorkflowConfig issueNumber field accepts null

  @adw-233 @regression
  Scenario: initializePRReviewWorkflow does not default issueNumber to zero
    Given "adws/phases/prReviewPhase.ts" is read
    Then initializePRReviewWorkflow does not contain "issueNumber || 0"

  # ── 3: Guard downstream consumers ─────────────────────────────────────────

  @adw-233 @regression
  Scenario: completePRReviewWorkflow guards moveToStatus with issueNumber check
    Given "adws/phases/prReviewCompletion.ts" is read
    Then moveToStatus is only called when issueNumber is truthy in completePRReviewWorkflow

  @adw-233 @regression
  Scenario: completePRReviewWorkflow guards cost CSV write with issueNumber check
    Given "adws/phases/prReviewCompletion.ts" is read
    Then cost CSV writing is guarded by an issueNumber check in completePRReviewWorkflow

  # ── 4: Cost CSV naming (migrated to adws/cost/reporting/csvWriter.ts in #245) ─

  @adw-233
  Scenario: costCsvWriter exports a function to resolve serialised cost CSV path
    Given "adws/cost/reporting/csvWriter.ts" is read
    Then the file contains a function for resolving serialised cost CSV paths

  @adw-233
  Scenario: Serialised cost CSV path appends a serial number suffix
    Given "adws/cost/reporting/csvWriter.ts" is read
    Then the serialised CSV path function appends a numeric serial suffix

  @adw-233
  Scenario: rebuildProjectCostCsv correctly parses serialised filenames
    Given "adws/cost/reporting/csvWriter.ts" is read
    Then rebuildProjectCostCsv extracts issue number from the first dash-separated segment

  # ── Cross-cutting: Type-check passes ───────────────────────────────────────

  @adw-233 @regression
  Scenario: TypeScript type-check passes after PR review issue number fix
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
