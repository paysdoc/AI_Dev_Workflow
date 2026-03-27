@adw-329-hitl-label-gate
Feature: HITL label gate prevents auto-merge

  When a GitHub issue has the `hitl` (human-in-the-loop) label,
  `executeAutoMergePhase` skips both PR approval and merge, leaving
  the PR open for a human to approve and merge manually.  A comment
  is posted on the issue indicating the PR is ready for human review.
  The webhook auto-merge path is unaffected because it only fires on
  human-submitted `pull_request_review` approved events.

  Background:
    Given the ADW codebase is checked out

  # ── issueHasLabel helper ─────────────────────────────────────────────────

  @adw-329-hitl-label-gate @regression
  Scenario: issueHasLabel function exists in issueApi.ts
    Given "adws/github/issueApi.ts" is read
    Then the file exports a function named "issueHasLabel"

  @adw-329-hitl-label-gate @regression
  Scenario: issueHasLabel accepts issueNumber, labelName, and repoInfo parameters
    Given "adws/github/issueApi.ts" is read
    Then the function "issueHasLabel" accepts parameters "issueNumber", "labelName", and "repoInfo"

  @adw-329-hitl-label-gate @regression
  Scenario: issueHasLabel performs a real-time gh issue view call for labels
    Given "adws/github/issueApi.ts" is read
    Then the function "issueHasLabel" calls "gh issue view" with "--json labels"

  @adw-329-hitl-label-gate
  Scenario: issueHasLabel is exported from github/index.ts barrel
    Given "adws/github/index.ts" is read
    Then the file exports "issueHasLabel"

  # ── autoMergePhase hitl gate ─────────────────────────────────────────────

  @adw-329-hitl-label-gate @regression
  Scenario: autoMergePhase imports issueHasLabel
    Given "adws/phases/autoMergePhase.ts" is read
    Then the file imports "issueHasLabel"

  @adw-329-hitl-label-gate @regression
  Scenario: autoMergePhase checks for hitl label before approval and merge
    Given "adws/phases/autoMergePhase.ts" is read
    Then "issueHasLabel" is called before "approvePR"
    And "issueHasLabel" is called before "mergeWithConflictResolution"

  @adw-329-hitl-label-gate @regression
  Scenario: autoMergePhase skips approvePR when hitl label is present
    Given "adws/phases/autoMergePhase.ts" is read
    Then the phase skips "approvePR" when the hitl label is detected

  @adw-329-hitl-label-gate @regression
  Scenario: autoMergePhase skips mergeWithConflictResolution when hitl label is present
    Given "adws/phases/autoMergePhase.ts" is read
    Then the phase skips "mergeWithConflictResolution" when the hitl label is detected

  @adw-329-hitl-label-gate @regression
  Scenario: autoMergePhase posts awaiting-human-approval comment on the issue when hitl detected
    Given "adws/phases/autoMergePhase.ts" is read
    Then the phase calls "commentOnIssue" when the hitl label is detected
    And the comment contains "Awaiting human approval"

  @adw-329-hitl-label-gate @regression
  Scenario: autoMergePhase returns empty cost record when hitl label skips merge
    Given "adws/phases/autoMergePhase.ts" is read
    Then the hitl skip path returns a result with costUsd 0 and empty phaseCostRecords

  @adw-329-hitl-label-gate @regression
  Scenario: autoMergePhase logs hitl label detection
    Given "adws/phases/autoMergePhase.ts" is read
    Then the phase logs a message containing "hitl" when the label is detected

  # ── Webhook path unaffected ──────────────────────────────────────────────

  @adw-329-hitl-label-gate @regression
  Scenario: Webhook auto-merge handler does not check for hitl label
    Given "adws/triggers/autoMergeHandler.ts" is read
    Then the file does not reference "issueHasLabel" or "hitl"

  @adw-329-hitl-label-gate @regression
  Scenario: Webhook trigger routing is unchanged for approved reviews
    Given "adws/triggers/trigger_webhook.ts" is read
    Then the approved-review branch does not check for a "hitl" label

  # ── UBIQUITOUS_LANGUAGE.md ───────────────────────────────────────────────

  @adw-329-hitl-label-gate @regression
  Scenario: hitl term is defined in UBIQUITOUS_LANGUAGE.md
    Given "UBIQUITOUS_LANGUAGE.md" is read
    Then the file contains a definition for "hitl"

  # ── TypeScript type-check ────────────────────────────────────────────────

  @adw-329-hitl-label-gate @regression
  Scenario: ADW TypeScript type-check passes after hitl label gate implementation
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
