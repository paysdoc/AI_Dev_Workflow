@adw-lvakyr-remove-webhook-auto
Feature: Simplify webhook handlers — remove auto-merge, thin event relay

  The webhook is simplified to a thin event relay. All orchestration work is
  removed from webhook handlers. PR approval auto-merge is removed entirely
  (merge is handled by cron + adwMerge.tsx). pull_request.closed does nothing
  for merged PRs; for abandoned PRs it writes 'abandoned' to the state file
  and closes the linked issue. issues.closed handles all cleanup: worktree
  removal, remote branch deletion, active-stage grace period guard, and
  dependency management with abandoned-aware logic.

  Background:
    Given the ADW codebase is checked out

  # ═══════════════════════════════════════════════════════════════════════════
  # 1. pull_request_review (approved) — webhook does nothing
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-lvakyr-remove-webhook-auto @regression
  Scenario: handleApprovedReview is not imported in trigger_webhook.ts
    Given "adws/triggers/trigger_webhook.ts" is read
    Then the file does not import "handleApprovedReview"

  @adw-lvakyr-remove-webhook-auto @regression
  Scenario: trigger_webhook.ts does not call handleApprovedReview
    Given "adws/triggers/trigger_webhook.ts" is read
    Then the file does not contain a call to "handleApprovedReview"

  @adw-lvakyr-remove-webhook-auto @regression
  Scenario: Approved PR review returns ignored response with no side effects
    Given "adws/triggers/trigger_webhook.ts" is read
    Then the pull_request_review handler returns an "ignored" response for approved reviews
    And no auto-merge or workflow spawn occurs for approved reviews

  @adw-lvakyr-remove-webhook-auto
  Scenario: Non-approved PR review still routes to adwPrReview.tsx
    Given "adws/triggers/trigger_webhook.ts" is read
    Then the non-approved review branch spawns adwPrReview.tsx

  # ═══════════════════════════════════════════════════════════════════════════
  # 2. handleApprovedReview removed from autoMergeHandler.ts
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-lvakyr-remove-webhook-auto @regression
  Scenario: handleApprovedReview function is removed from autoMergeHandler.ts
    Given "adws/triggers/autoMergeHandler.ts" is read
    Then the file does not export "handleApprovedReview"
    And the file does not contain "export async function handleApprovedReview"

  @adw-lvakyr-remove-webhook-auto @regression
  Scenario: mergeWithConflictResolution is still exported from autoMergeHandler.ts
    Given "adws/triggers/autoMergeHandler.ts" is read
    Then the file exports a function named "mergeWithConflictResolution"

  # ═══════════════════════════════════════════════════════════════════════════
  # 3. pull_request.closed (merged) — does nothing
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-lvakyr-remove-webhook-auto @regression
  Scenario: pull_request.closed does nothing when PR was merged
    Given "adws/triggers/trigger_webhook.ts" is read
    Then the pull_request closed handler returns early with no side effects when the PR was merged

  @adw-lvakyr-remove-webhook-auto @regression
  Scenario: Merged PR close does not clean up worktree or delete remote branch
    Given "adws/triggers/webhookHandlers.ts" is read
    Then handlePullRequestEvent does not call removeWorktree when the PR was merged
    And handlePullRequestEvent does not call deleteRemoteBranch when the PR was merged

  @adw-lvakyr-remove-webhook-auto
  Scenario: Merged PR close does not close the linked issue
    Given "adws/triggers/webhookHandlers.ts" is read
    Then handlePullRequestEvent does not call closeIssue when the PR was merged

  # ═══════════════════════════════════════════════════════════════════════════
  # 4. pull_request.closed (not merged) — abandoned flow
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-lvakyr-remove-webhook-auto @regression
  Scenario: Abandoned PR extracts adw-id from linked issue comments
    Given "adws/triggers/webhookHandlers.ts" is read
    Then handlePullRequestEvent extracts the adw-id from the linked issue's comments using extractAdwIdFromComment

  @adw-lvakyr-remove-webhook-auto @adw-460 @regression
  Scenario: Abandoned PR writes 'discarded' to state file (reclassified in issue #460)
    Given "adws/triggers/webhookHandlers.ts" is read
    Then handlePullRequestEvent writes workflowStage "discarded" to the state file when the PR was not merged
    And handlePullRequestEvent does not write workflowStage "abandoned" in the PR-closed path

  @adw-lvakyr-remove-webhook-auto @regression
  Scenario: Abandoned PR closes the linked issue to cascade to issues.closed
    Given "adws/triggers/webhookHandlers.ts" is read
    Then handlePullRequestEvent closes the linked issue when the PR was not merged
    And the issue closure cascades to the issues.closed webhook handler

  @adw-lvakyr-remove-webhook-auto
  Scenario: Abandoned PR does not clean up worktree directly
    Given "adws/triggers/webhookHandlers.ts" is read
    Then handlePullRequestEvent does not call removeWorktree when the PR was not merged
    And worktree cleanup is deferred to the issues.closed handler

  # ═══════════════════════════════════════════════════════════════════════════
  # 5. issues.closed — state file reading and cleanup
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-lvakyr-remove-webhook-auto @regression
  Scenario: issues.closed extracts adw-id from issue comments
    Given "adws/triggers/trigger_webhook.ts" is read
    Then the issues closed handler extracts adw-id from the closed issue's comments

  @adw-lvakyr-remove-webhook-auto @regression
  Scenario: issues.closed reads state file via AgentStateManager
    Given "adws/triggers/trigger_webhook.ts" is read
    Then the issues closed handler reads the state file via AgentStateManager using the extracted adw-id

  @adw-lvakyr-remove-webhook-auto @regression
  Scenario: issues.closed cleans up worktree for the closed issue
    Given "adws/triggers/trigger_webhook.ts" is read
    Then the issues closed handler calls removeWorktreesForIssue or equivalent worktree cleanup

  @adw-lvakyr-remove-webhook-auto @regression
  Scenario: issues.closed deletes remote branch for the closed issue
    Given "adws/triggers/trigger_webhook.ts" is read
    Then the issues closed handler deletes the remote branch associated with the closed issue

  # ═══════════════════════════════════════════════════════════════════════════
  # 6. issues.closed — active stage grace period guard
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-lvakyr-remove-webhook-auto @regression
  Scenario: issues.closed skips cleanup when workflowStage is ACTIVE and within grace period
    Given "adws/triggers/trigger_webhook.ts" is read
    Then the issues closed handler checks whether the workflowStage is active
    And skips worktree cleanup and branch deletion when the stage is active and within the grace period

  @adw-lvakyr-remove-webhook-auto
  Scenario: issues.closed performs cleanup when active stage exceeds grace period
    Given "adws/triggers/trigger_webhook.ts" is read
    Then the issues closed handler performs cleanup when the active stage timestamp exceeds the grace period

  # ═══════════════════════════════════════════════════════════════════════════
  # 7. issues.closed — abandoned dependency handling
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-lvakyr-remove-webhook-auto @regression
  Scenario: issues.closed closes dependent issues with error comment when stage is abandoned
    Given "adws/triggers/trigger_webhook.ts" is read
    Then when workflowStage is "abandoned" the issues closed handler closes all dependent issues
    And posts an explanatory error comment on each dependent issue

  @adw-lvakyr-remove-webhook-auto @regression
  Scenario: issues.closed unblocks dependents and spawns workflows on normal closure
    Given "adws/triggers/trigger_webhook.ts" is read
    Then when workflowStage is not "abandoned" the issues closed handler unblocks dependent issues
    And spawns workflows for newly-eligible dependent issues

  @adw-lvakyr-remove-webhook-auto
  Scenario: issues.closed preserves existing dependency unblock behavior for non-abandoned closures
    Given "adws/triggers/trigger_webhook.ts" is read
    Then the non-abandoned dependency handling matches the existing handleIssueClosedDependencyUnblock behavior

  # ═══════════════════════════════════════════════════════════════════════════
  # 8. WorkflowStage type includes abandoned
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-lvakyr-remove-webhook-auto @regression
  Scenario: abandoned is included in the WorkflowStage type
    Given "adws/types/workflowTypes.ts" is read
    Then the WorkflowStage type includes "abandoned"

  # ═══════════════════════════════════════════════════════════════════════════
  # 9. known_issues.md — claude-cli-enoent distinction
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-lvakyr-remove-webhook-auto
  Scenario: known_issues.md distinguishes CWD-gone from binary-missing for claude-cli-enoent
    Given "known_issues.md" is read
    Then the claude-cli-enoent entry distinguishes between a missing working directory and a missing binary

  # ═══════════════════════════════════════════════════════════════════════════
  # 10. TypeScript compilation
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-lvakyr-remove-webhook-auto @regression
  Scenario: TypeScript type-check passes after webhook handler simplification
    When "bunx tsc --noEmit" is run
    Then the command exits with code 0
    And "bunx tsc --noEmit -p adws/tsconfig.json" also exits with code 0
