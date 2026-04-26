@adw-496
Feature: Unify auto-merge under stateless (no hitl) OR approved gate

  Issue #496: replaces two parallel merge paths with two different gate
  conditions with a single stateless rule applied at one merge entry point
  (adwMerge.tsx). The `hitl` label on the **issue** is the single human-intent
  signal that gates auto-merge. The four canonical rules collapse to one
  expression with no persistent state:

      gate_open = (no hitl on issue) OR (PR is approved)

  Four rules:
    1. No `hitl` on issue            → auto-merge fires (any issue type)
    2. `hitl` on issue               → defer auto-merge
    3. `hitl` on issue + PR approved → auto-merge fires (order irrelevant)
    4. `hitl` removed without approval → eligible again (rule 1, stateless)

  Drift to be corrected:
    - #483 added `issueHasLabel('hitl')` gate to adwMerge — correct condition
      but only one of two merge paths.
    - #488/#489 replaced the hitl gate with PR approval — wrong condition;
      approval is one of two satisfiers, not the only one.
    - The chore pipeline never used either gate — `adwChore.tsx` previously
      called `approvePR` + `mergePR` inline. This issue routes chore through
      `adwMerge` so there is one merge path and one gate.

  Hard prerequisite — `fetchPRApprovalState` empty-string bug:
    `gh pr view --json reviewDecision` returns the empty string `""` (not
    `null`) when the repo has no branch protection. The previous null-only
    fallback rendered `isApprovedFromReviewsList` dead code and broke rule 3
    on unprotected repos. The fix treats empty-string the same as `null`.

  Background:
    Given the ADW codebase is checked out

  # ═══════════════════════════════════════════════════════════════════════
  # 1. fetchPRApprovalState — empty-string reviewDecision fallback fix
  # ═══════════════════════════════════════════════════════════════════════

  @adw-496 @regression
  Scenario: fetchPRApprovalState falls back to isApprovedFromReviewsList for empty-string reviewDecision
    Given "adws/github/prApi.ts" is read
    Then the function "fetchPRApprovalState" treats an empty-string reviewDecision the same as null
    And the function "fetchPRApprovalState" calls "isApprovedFromReviewsList" when reviewDecision is empty string

  @adw-496 @regression
  Scenario: fetchPRApprovalState returns true when reviewDecision is empty string and reviews list contains a single APPROVED review
    Given fetchPRApprovalState is invoked against a stubbed gh pr view that returns reviewDecision "" and a reviews list with one author "alice" latest "APPROVED"
    Then fetchPRApprovalState returns true

  @adw-496 @regression
  Scenario: fetchPRApprovalState returns false when reviewDecision is empty string and reviews list is empty
    Given fetchPRApprovalState is invoked against a stubbed gh pr view that returns reviewDecision "" and an empty reviews list
    Then fetchPRApprovalState returns false

  @adw-496 @regression
  Scenario: fetchPRApprovalState still returns true for explicit APPROVED reviewDecision
    Given fetchPRApprovalState is invoked against a stubbed gh pr view that returns reviewDecision "APPROVED" and an empty reviews list
    Then fetchPRApprovalState returns true

  @adw-496 @regression
  Scenario: fetchPRApprovalState still returns false for non-empty non-APPROVED reviewDecision (REVIEW_REQUIRED)
    Given fetchPRApprovalState is invoked against a stubbed gh pr view that returns reviewDecision "REVIEW_REQUIRED" and an empty reviews list
    Then fetchPRApprovalState returns false

  @adw-496 @regression
  Scenario: fetchPRApprovalState empty-string fallback contract — the source no longer compares reviewDecision against null/undefined exclusively
    Given "adws/github/prApi.ts" is read
    Then the file does not contain "reviewDecision !== null && reviewDecision !== undefined"

  # ═══════════════════════════════════════════════════════════════════════
  # 2. adwMerge.tsx — unified gate: (no hitl on issue) OR (PR approved)
  # ═══════════════════════════════════════════════════════════════════════

  @adw-496 @regression
  Scenario: adwMerge.tsx imports issueHasLabel and fetchPRApprovalState
    Given "adws/adwMerge.tsx" is read
    Then the file imports "issueHasLabel"
    And the file imports "fetchPRApprovalState"

  @adw-496 @regression
  Scenario: MergeDeps interface declares both issueHasLabel and fetchPRApprovalState
    Given "adws/adwMerge.tsx" is read
    Then the MergeDeps interface declares a "issueHasLabel" field
    And the MergeDeps interface declares a "fetchPRApprovalState" field

  @adw-496 @regression
  Scenario: buildDefaultDeps wires both issueHasLabel and fetchPRApprovalState
    Given "adws/adwMerge.tsx" is read
    Then "buildDefaultDeps" returns an object containing "issueHasLabel"
    And "buildDefaultDeps" returns an object containing "fetchPRApprovalState"

  @adw-496 @regression
  Scenario: adwMerge.tsx evaluates the unified gate before mergeWithConflictResolution
    Given "adws/adwMerge.tsx" is read
    Then "issueHasLabel" is called before "mergeWithConflictResolution"
    And "fetchPRApprovalState" is called before "mergeWithConflictResolution"

  @adw-496 @regression
  Scenario: adwMerge.tsx skips merge when hitl is on issue and PR is not approved
    Given "adws/adwMerge.tsx" is read
    Then the gate-closed branch returns an outcome with reason "hitl_blocked_unapproved"
    And the gate-closed branch does not call "mergeWithConflictResolution"
    And the gate-closed branch does not call "writeTopLevelState"

  @adw-496 @regression
  Scenario: adwMerge.tsx logs a deferring message naming the issue and PR when the gate is closed
    Given "adws/adwMerge.tsx" is read
    Then the phase logs a message containing "deferring" when the gate is closed

  @adw-496 @regression
  Scenario: adwMerge.tsx does not post a GitHub comment when deferring on a closed gate
    Given "adws/adwMerge.tsx" is read
    Then the gate-closed branch does not call "commentOnIssue"
    And the gate-closed branch does not call "commentOnPR"

  # ═══════════════════════════════════════════════════════════════════════
  # 3. The four canonical rules — gate_open behaviour matrix
  # ═══════════════════════════════════════════════════════════════════════

  @adw-496 @regression
  Scenario: Rule 1 — no hitl on issue, PR not approved → auto-merge fires
    Given an awaiting_merge state file for adw-id "rule1abc" with branch "feature/rule1" and an open PR
    And the issue does not carry the "hitl" label
    And fetchPRApprovalState returns false for the PR
    When executeMerge is invoked for issue 1001 with the injected deps
    Then mergeWithConflictResolution is called with the PR number
    And the outcome is "completed" or the merge attempt is reached

  @adw-496 @regression
  Scenario: Rule 2 — hitl on issue, PR not approved → defer (no merge, no state write)
    Given an awaiting_merge state file for adw-id "rule2def" with branch "feature/rule2" and an open PR
    And the issue carries the "hitl" label
    And fetchPRApprovalState returns false for the PR
    When executeMerge is invoked for issue 1002 with the injected deps
    Then mergeWithConflictResolution is not called
    And the outcome is "abandoned" with reason "hitl_blocked_unapproved"
    And writeTopLevelState is not called on the gate-closed branch

  @adw-496 @regression
  Scenario: Rule 3 — hitl on issue and PR approved → auto-merge fires (approval satisfies the gate)
    Given an awaiting_merge state file for adw-id "rule3ghi" with branch "feature/rule3" and an open PR
    And the issue carries the "hitl" label
    And fetchPRApprovalState returns true for the PR
    When executeMerge is invoked for issue 1003 with the injected deps
    Then mergeWithConflictResolution is called with the PR number
    And the outcome is "completed" or the merge attempt is reached

  @adw-496 @regression
  Scenario: Rule 4 — hitl removed between cron ticks without approval → next tick re-evaluates statelessly and fires (rule 1)
    Given an awaiting_merge state file for adw-id "rule4jkl" with branch "feature/rule4" and an open PR
    And on the first executeMerge invocation the issue carries the "hitl" label and the PR is not approved
    And on the second executeMerge invocation the issue does not carry the "hitl" label and the PR is still not approved
    When executeMerge is invoked twice for issue 1004 with the injected deps
    Then the first invocation defers with reason "hitl_blocked_unapproved"
    And the second invocation calls mergeWithConflictResolution with the PR number

  # ═══════════════════════════════════════════════════════════════════════
  # 4. Chore unified path — adwChore exits in awaiting_merge, never merges inline
  # ═══════════════════════════════════════════════════════════════════════

  @adw-496 @regression
  Scenario: adwChore.tsx does not call mergePR inline
    Given "adws/adwChore.tsx" is read
    Then the file does not contain "mergePR"

  @adw-496 @regression
  Scenario: adwChore.tsx writes awaiting_merge to top-level state after PR creation
    Given "adws/adwChore.tsx" is read
    Then the orchestrator writes workflowStage "awaiting_merge" after PR approval

  @adw-496 @regression
  Scenario: adwChore.tsx imports issueHasLabel for the conditional approval check
    Given "adws/adwChore.tsx" is read
    Then the file imports "issueHasLabel"

  @adw-496 @regression
  Scenario: adwChore.tsx skips approvePR when hitl is currently on the issue
    Given the chore pipeline reaches the post-PR approval step
    And the issue carries the "hitl" label at that moment
    When the chore pipeline evaluates the approval gate
    Then approvePR is not called
    And the workflow continues by writing workflowStage "awaiting_merge"

  @adw-496 @regression
  Scenario: adwChore.tsx calls approvePR when hitl is NOT on the issue
    Given the chore pipeline reaches the post-PR approval step
    And the issue does not carry the "hitl" label at that moment
    When the chore pipeline evaluates the approval gate
    Then approvePR is called once for the freshly-created PR
    And the workflow continues by writing workflowStage "awaiting_merge"

  @adw-496 @regression
  Scenario: adwChore.tsx merge path is unified — only adwMerge dispatches the merge
    Given "adws/adwChore.tsx" is read
    Then the file does not contain "mergeWithConflictResolution"
    And the orchestrator exits to the cron after writing "awaiting_merge"

  # ═══════════════════════════════════════════════════════════════════════
  # 5. hitl-on-PR is never read; humans/external processes own the label
  # ═══════════════════════════════════════════════════════════════════════

  @adw-496 @regression
  Scenario: adwMerge.tsx reads hitl from the issue, not the PR
    Given "adws/adwMerge.tsx" is read
    Then the call to "issueHasLabel" passes the issue number (not the PR number) as its first argument
    And the call to "issueHasLabel" passes the literal label name "hitl" as its second argument

  @adw-496 @regression
  Scenario: adwMerge.tsx never adds or removes the hitl label
    Given "adws/adwMerge.tsx" is read
    Then the file does not contain "addIssueLabel"
    And the file does not contain "removeIssueLabel"

  @adw-496 @regression
  Scenario: adwChore.tsx never adds or removes the hitl label
    Given "adws/adwChore.tsx" is read
    Then the file does not contain "addIssueLabel"
    And the file does not contain "removeIssueLabel"

  # ═══════════════════════════════════════════════════════════════════════
  # 6. README/docs — the four rules and disciplined workflow are documented
  # ═══════════════════════════════════════════════════════════════════════

  @adw-496
  Scenario: README documents the four canonical rules of the unified hitl gate
    Given "README.md" is read
    Then the file contains "hitl"
    And the file contains "(no hitl on issue) OR"
    And the file contains "PR is approved"

  @adw-496
  Scenario: README documents the disciplined pre-add workflow for hitl
    Given "README.md" is read
    Then the file contains "pre-add"
    And the file contains "hitl"

  @adw-496
  Scenario: README documents the Cancel interaction with hitl (stateless re-evaluation)
    Given "README.md" is read
    Then the file contains "## Cancel"
    And the file contains "stateless"

  # ═══════════════════════════════════════════════════════════════════════
  # 7. TypeScript type-check
  # ═══════════════════════════════════════════════════════════════════════

  @adw-496 @regression
  Scenario: ADW TypeScript type-check passes after the unified hitl/approval gate change
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
