@adw-488 @adw-329-hitl-label-gate @adw-496
Feature: Unified hitl-OR-approved merge gate in adwMerge (issue #488 → #496)

  Issue #488 originally swapped the hitl-label gate for a PR-approval-only
  gate. Issue #496 reverses that single-condition design and replaces it
  with the unified rule documented in unify_auto_merge_hitl_gate.feature:

      gate_open = (no hitl on issue) OR (PR is approved)

  Under the unified gate `executeMerge` reads *both* the hitl label on the
  issue and the PR approval state. It only defers when both are negative —
  hitl is present *and* the PR is not approved. The defer outcome is
  `{ outcome: 'abandoned', reason: 'hitl_blocked_unapproved' }`, no state
  write, no GitHub comment (log only). When hitl is absent the merge fires
  even on an unapproved PR (rule 1); when the PR is approved the merge
  fires regardless of hitl (rule 3).

  `fetchPRApprovalState` is the same per-#488: it queries
  `--json reviewDecision,reviews` and combines the server-computed
  `reviewDecision` with a per-reviewer-latest aggregation fallback. Issue
  #496 fixes a residual bug — empty-string `reviewDecision` (which the
  gh CLI returns on repos without branch protection) is now treated the
  same as `null` so the per-reviewer fallback actually runs.

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

  # NOTE (issue #496): the unified gate `(no hitl on issue) OR (PR approved)`
  # restores `issueHasLabel` as a first-class merge gate alongside
  # `fetchPRApprovalState`. The #488 scenarios that asserted the *removal* of
  # issueHasLabel are inverted below and re-tagged @adw-496 so they enforce the
  # new contract.

  @adw-488 @adw-496 @regression
  Scenario: adwMerge.tsx imports issueHasLabel for the unified hitl gate
    Given "adws/adwMerge.tsx" is read
    Then the file imports "issueHasLabel"

  @adw-488 @adw-496 @regression
  Scenario: adwMerge.tsx references the hitl label for the unified gate
    Given "adws/adwMerge.tsx" is read
    Then the file contains "hitl"

  @adw-488 @adw-496 @regression
  Scenario: MergeDeps interface declares both issueHasLabel and fetchPRApprovalState
    Given "adws/adwMerge.tsx" is read
    Then the MergeDeps interface declares a "fetchPRApprovalState" field
    And the MergeDeps interface declares a "issueHasLabel" field

  @adw-488 @adw-496 @regression
  Scenario: buildDefaultDeps wires both fetchPRApprovalState and issueHasLabel
    Given "adws/adwMerge.tsx" is read
    Then "buildDefaultDeps" returns an object containing "fetchPRApprovalState"
    And "buildDefaultDeps" returns an object containing "issueHasLabel"

  @adw-488 @regression
  Scenario: adwMerge.tsx calls fetchPRApprovalState before mergeWithConflictResolution
    Given "adws/adwMerge.tsx" is read
    Then "fetchPRApprovalState" is called before "mergeWithConflictResolution"

  @adw-488 @regression
  Scenario: adwMerge.tsx approval check runs after PR lookup
    Given "adws/adwMerge.tsx" is read
    Then "findPRByBranch" is called before "fetchPRApprovalState"

  # NOTE (issue #496): the gate-closed branch now triggers when *both* hitl is
  # on the issue *and* the PR is not approved (rule 2). The reason was renamed
  # from `awaiting_approval` to `hitl_blocked_unapproved`, and the log message
  # was changed from "not approved" to "deferring".

  @adw-488 @adw-496 @regression
  Scenario: adwMerge.tsx skips mergeWithConflictResolution when the gate is closed (hitl on issue and PR not approved)
    Given "adws/adwMerge.tsx" is read
    Then the gate-closed branch does not call "mergeWithConflictResolution"

  @adw-488 @adw-496 @regression
  Scenario: adwMerge.tsx gate-closed branch returns abandoned with reason "hitl_blocked_unapproved"
    Given "adws/adwMerge.tsx" is read
    Then the gate-closed branch returns an outcome with reason "hitl_blocked_unapproved"

  @adw-488 @adw-496 @regression
  Scenario: adwMerge.tsx gate-closed branch does not write workflowStage
    Given "adws/adwMerge.tsx" is read
    Then the gate-closed branch does not call "writeTopLevelState"

  @adw-488 @adw-496 @regression
  Scenario: adwMerge.tsx logs a deferring message when the gate is closed
    Given "adws/adwMerge.tsx" is read
    Then the phase logs a message containing "deferring" when the gate is closed

  # ── adwMerge behaviour: approval flips dispatch into merge ──────────────

  @adw-488 @regression
  Scenario: executeMerge proceeds to mergeWithConflictResolution when fetchPRApprovalState returns true
    Given an awaiting_merge state file for adw-id "approve123" with branch "feature/x" and an open PR
    And fetchPRApprovalState returns true for the PR
    When executeMerge is invoked for issue 99 with the injected deps
    Then mergeWithConflictResolution is called with the PR number
    And the outcome is "completed" or the merge attempt is reached

  # NOTE (issue #496): under the unified gate, "fetchPRApprovalState returns
  # false" alone is no longer a defer condition — the issue must *also* carry
  # the hitl label. Without hitl, rule 1 fires (auto-merge proceeds even when
  # the PR is unapproved). The replacement scenarios in
  # unify_auto_merge_hitl_gate.feature cover all four cells of the matrix.

  @adw-488 @adw-496 @regression
  Scenario: executeMerge defers with hitl_blocked_unapproved when hitl is on issue and PR is not approved
    Given an awaiting_merge state file for adw-id "wait123" with branch "feature/y" and an open PR
    And the issue carries the "hitl" label
    And fetchPRApprovalState returns false for the PR
    When executeMerge is invoked for issue 99 with the injected deps
    Then mergeWithConflictResolution is not called
    And the outcome is "abandoned" with reason "hitl_blocked_unapproved"
    And writeTopLevelState is not called on the gate-closed branch

  # ── autoMergePhase still labels but adwMerge no longer reads label ──────

  @adw-488
  Scenario: autoMergePhase still adds the hitl label as an informational marker
    Given "adws/phases/autoMergePhase.ts" is read
    Then the file contains "hitl"

  # NOTE (issue #496): the unified gate explicitly *does* call issueHasLabel —
  # rule 3 says hitl + approved still merges, so issueHasLabel is consulted
  # but a true result is overridden by an APPROVED PR. The original #488
  # assertion "no call to issueHasLabel is made" is inverted.

  @adw-488 @adw-496 @regression
  Scenario: adwMerge calls issueHasLabel but still merges a hitl-labelled approved PR (rule 3)
    Given a state file for adw-id "lbl123" with workflowStage "awaiting_merge" and an open approved PR
    And the issue still carries the "hitl" label
    When executeMerge is invoked with fetchPRApprovalState returning true
    Then the merge proceeds via mergeWithConflictResolution
    And issueHasLabel is consulted as part of the unified gate evaluation

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
