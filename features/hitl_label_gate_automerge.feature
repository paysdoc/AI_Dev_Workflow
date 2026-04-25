@adw-488 @adw-329-hitl-label-gate
Feature: PR-approval gate replaces hitl-label gate in adwMerge

  Issue #488: the merge gate in `adwMerge.tsx` previously checked for the
  `hitl` label on the issue. That conflated two distinct signals — "we
  prompted the human" vs "don't merge yet" — and forced the human to both
  approve the PR via GitHub Reviews and remove the label before the bot
  would merge.

  The new gate calls `fetchPRApprovalState(prNumber, repoInfo)`. When the
  PR is not approved, `executeMerge` returns `{ outcome: 'abandoned',
  reason: 'awaiting_approval' }` and writes nothing to the state file —
  `workflowStage` stays `awaiting_merge` so the cron retries on the next
  cycle. The `autoMergePhase` continues to add the `hitl` label as an
  informational marker; nothing in `adwMerge` reads it.

  `fetchPRApprovalState` itself is tightened: it queries
  `--json reviewDecision,reviews` and combines the server-computed
  `reviewDecision` with a per-reviewer-latest aggregation fallback that
  applies when `reviewDecision === null` (no branch protection / no
  CODEOWNERS / no required reviewers configured on the target repo).

  Background:
    Given the ADW codebase is checked out

  # ── fetchPRApprovalState — server-side reviewDecision ───────────────────

  @adw-488 @regression
  Scenario: fetchPRApprovalState queries reviewDecision and reviews together
    Given "adws/github/prApi.ts" is read
    Then the file contains "gh pr view"
    And the file contains "--json reviewDecision,reviews"

  @adw-488 @regression
  Scenario: fetchPRApprovalState returns true when reviewDecision is "APPROVED"
    Given "adws/github/prApi.ts" is read
    Then the function "fetchPRApprovalState" returns true when reviewDecision equals "APPROVED"

  @adw-488 @regression
  Scenario: fetchPRApprovalState returns false when reviewDecision is "CHANGES_REQUESTED"
    Given "adws/github/prApi.ts" is read
    Then the function "fetchPRApprovalState" returns false when reviewDecision equals "CHANGES_REQUESTED"

  @adw-488 @regression
  Scenario: fetchPRApprovalState returns false when reviewDecision is "REVIEW_REQUIRED"
    Given "adws/github/prApi.ts" is read
    Then the function "fetchPRApprovalState" returns false when reviewDecision equals "REVIEW_REQUIRED"

  # ── isApprovedFromReviewsList — per-reviewer-latest fallback ────────────

  @adw-488 @regression
  Scenario: isApprovedFromReviewsList is exported from prApi.ts
    Given "adws/github/prApi.ts" is read
    Then the file exports a function named "isApprovedFromReviewsList"

  @adw-488 @regression
  Scenario: fetchPRApprovalState falls back to isApprovedFromReviewsList when reviewDecision is null
    Given "adws/github/prApi.ts" is read
    Then the function "fetchPRApprovalState" calls "isApprovedFromReviewsList" when reviewDecision is null

  @adw-488 @regression
  Scenario: isApprovedFromReviewsList returns true for a single reviewer whose latest review is APPROVED
    Given a reviews list with one author "alice" whose latest review state is "APPROVED"
    When isApprovedFromReviewsList aggregates the list
    Then isApprovedFromReviewsList returns true

  @adw-488 @regression
  Scenario: isApprovedFromReviewsList returns true when every author's latest review is APPROVED
    Given a reviews list with authors "alice" and "bob" whose latest reviews are both "APPROVED"
    When isApprovedFromReviewsList aggregates the list
    Then isApprovedFromReviewsList returns true

  @adw-488 @regression
  Scenario: isApprovedFromReviewsList returns false when any author's latest review is CHANGES_REQUESTED
    Given a reviews list with author "alice" latest "APPROVED" and author "bob" latest "CHANGES_REQUESTED"
    When isApprovedFromReviewsList aggregates the list
    Then isApprovedFromReviewsList returns false

  @adw-488 @regression
  Scenario: isApprovedFromReviewsList returns false when the same author approves then later requests changes
    Given a reviews list with one author "alice" whose earlier review is "APPROVED" and latest review is "CHANGES_REQUESTED"
    When isApprovedFromReviewsList aggregates the list
    Then isApprovedFromReviewsList returns false

  @adw-488 @regression
  Scenario: isApprovedFromReviewsList ignores COMMENTED and DISMISSED states when picking the latest blocking/approving review
    Given a reviews list with author "alice" whose latest substantive review is "APPROVED" and a later "COMMENTED" review
    When isApprovedFromReviewsList aggregates the list
    Then isApprovedFromReviewsList returns true

  @adw-488 @regression
  Scenario: isApprovedFromReviewsList returns false on an empty reviews list
    Given an empty reviews list
    When isApprovedFromReviewsList aggregates the list
    Then isApprovedFromReviewsList returns false

  # ── adwMerge.tsx — gate swap (issueHasLabel → fetchPRApprovalState) ─────

  @adw-488 @regression
  Scenario: adwMerge.tsx imports fetchPRApprovalState
    Given "adws/adwMerge.tsx" is read
    Then the file imports "fetchPRApprovalState"

  @adw-488 @regression
  Scenario: adwMerge.tsx no longer imports issueHasLabel
    Given "adws/adwMerge.tsx" is read
    Then the file does not import "issueHasLabel"

  @adw-488 @regression
  Scenario: adwMerge.tsx no longer references the hitl label
    Given "adws/adwMerge.tsx" is read
    Then the file does not contain "hitl"

  @adw-488 @regression
  Scenario: MergeDeps interface drops issueHasLabel and adds fetchPRApprovalState
    Given "adws/adwMerge.tsx" is read
    Then the MergeDeps interface declares a "fetchPRApprovalState" field
    And the MergeDeps interface does not declare an "issueHasLabel" field

  @adw-488 @regression
  Scenario: buildDefaultDeps wires fetchPRApprovalState and drops issueHasLabel
    Given "adws/adwMerge.tsx" is read
    Then "buildDefaultDeps" returns an object containing "fetchPRApprovalState"
    And "buildDefaultDeps" does not return an object containing "issueHasLabel"

  @adw-488 @regression
  Scenario: adwMerge.tsx calls fetchPRApprovalState before mergeWithConflictResolution
    Given "adws/adwMerge.tsx" is read
    Then "fetchPRApprovalState" is called before "mergeWithConflictResolution"

  @adw-488 @regression
  Scenario: adwMerge.tsx approval check runs after PR lookup
    Given "adws/adwMerge.tsx" is read
    Then "findPRByBranch" is called before "fetchPRApprovalState"

  @adw-488 @regression
  Scenario: adwMerge.tsx skips mergeWithConflictResolution when the PR is not approved
    Given "adws/adwMerge.tsx" is read
    Then the phase skips "mergeWithConflictResolution" when fetchPRApprovalState returns false

  @adw-488 @regression
  Scenario: adwMerge.tsx not-approved branch returns abandoned with reason "awaiting_approval"
    Given "adws/adwMerge.tsx" is read
    Then the not-approved branch returns an outcome with reason "awaiting_approval"

  @adw-488 @regression
  Scenario: adwMerge.tsx not-approved branch does not write workflowStage
    Given "adws/adwMerge.tsx" is read
    Then the not-approved branch does not call "writeTopLevelState"

  @adw-488 @regression
  Scenario: adwMerge.tsx logs a not-approved message that names the PR
    Given "adws/adwMerge.tsx" is read
    Then the phase logs a message containing "not approved" when fetchPRApprovalState returns false

  # ── adwMerge behaviour: approval flips dispatch into merge ──────────────

  @adw-488 @regression
  Scenario: executeMerge proceeds to mergeWithConflictResolution when fetchPRApprovalState returns true
    Given an awaiting_merge state file for adw-id "approve123" with branch "feature/x" and an open PR
    And fetchPRApprovalState returns true for the PR
    When executeMerge is invoked for issue 99 with the injected deps
    Then mergeWithConflictResolution is called with the PR number
    And the outcome is "completed" or the merge attempt is reached

  @adw-488 @regression
  Scenario: executeMerge returns awaiting_approval and skips merge when fetchPRApprovalState returns false
    Given an awaiting_merge state file for adw-id "wait123" with branch "feature/y" and an open PR
    And fetchPRApprovalState returns false for the PR
    When executeMerge is invoked for issue 99 with the injected deps
    Then mergeWithConflictResolution is not called
    And the outcome is "abandoned" with reason "awaiting_approval"
    And writeTopLevelState is not called on the awaiting-approval branch

  # ── autoMergePhase still labels but adwMerge no longer reads label ──────

  @adw-488
  Scenario: autoMergePhase still adds the hitl label as an informational marker
    Given "adws/phases/autoMergePhase.ts" is read
    Then the file contains "hitl"

  @adw-488 @regression
  Scenario: adwMerge no longer depends on the hitl label being absent for the merge to proceed
    Given a state file for adw-id "lbl123" with workflowStage "awaiting_merge" and an open approved PR
    And the issue still carries the "hitl" label
    When executeMerge is invoked with fetchPRApprovalState returning true
    Then the merge proceeds via mergeWithConflictResolution
    And no call to "issueHasLabel" is made

  # ── Webhook path unaffected ──────────────────────────────────────────────

  @adw-488 @adw-329-hitl-label-gate @adw-lvakyr-remove-webhook-auto
  Scenario: Webhook auto-merge handler does not check for hitl label
    Given "adws/triggers/autoMergeHandler.ts" is read
    Then the file does not reference "issueHasLabel" or "hitl"

  @adw-488 @adw-329-hitl-label-gate @adw-lvakyr-remove-webhook-auto
  Scenario: Webhook trigger routing is unchanged for approved reviews
    Given "adws/triggers/trigger_webhook.ts" is read
    Then the approved-review branch does not check for a "hitl" label

  # ── UBIQUITOUS_LANGUAGE.md ───────────────────────────────────────────────

  @adw-488 @adw-329-hitl-label-gate @regression
  Scenario: hitl term is still defined in UBIQUITOUS_LANGUAGE.md (informational marker)
    Given "UBIQUITOUS_LANGUAGE.md" is read
    Then the file contains a definition for "hitl"

  # ── TypeScript type-check ────────────────────────────────────────────────

  @adw-488 @regression
  Scenario: ADW TypeScript type-check passes after the approval-gate swap
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
