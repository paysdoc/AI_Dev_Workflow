@adw-460
Feature: Reclassify adwMerge and webhookHandlers exits as abandoned vs discarded per semantics

  The discarded stage foundation (#454) introduced the terminal, non-retriable
  'discarded' workflowStage but did not yet reclassify call sites — every exit
  still wrote 'abandoned'. This slice implements the per-site reclassification
  in adwMerge and webhookHandlers so that the actual semantics of the exit
  determine whether the cron sweeper re-tries the issue or leaves it alone:

    abandoned (transient, retriable)   — real crashes and transient defensive exits
    discarded (terminal, not retriable) — operator intent and unrecoverable merge

  Today's blanket 'abandoned' causes operator-closed PRs to retry forever and
  genuine merge failures to loop indefinitely, because isRetriableStage treats
  every 'abandoned' write as retriable.

  Background:
    Given the ADW codebase is checked out

  # ═══════════════════════════════════════════════════════════════════════════
  # 1. adwMerge — discarded (terminal) exits: pr_closed, merge_failed
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-460 @regression
  Scenario: adwMerge writes workflowStage "discarded" when the PR is closed without merge
    Given executeMerge is invoked with a PR whose GitHub state is "CLOSED"
    When the pr_closed exit path is taken
    Then the result outcome is "abandoned" with reason "pr_closed"
    And writeTopLevelState is called with workflowStage "discarded"
    And writeTopLevelState is not called with workflowStage "abandoned"

  @adw-460 @regression
  Scenario: adwMerge writes workflowStage "discarded" when the auto-merge fails after retries
    Given executeMerge is invoked with an open PR
    And mergeWithConflictResolution returns success=false with an error message
    When the merge_failed exit path is taken
    Then the result outcome is "abandoned" with reason "merge_failed"
    And writeTopLevelState is called with workflowStage "discarded"
    And writeTopLevelState is not called with workflowStage "abandoned"

  @adw-460 @regression
  Scenario: adwMerge imports handleWorkflowDiscarded from workflowCompletion
    Given "adws/adwMerge.tsx" is read
    Then the file imports "handleWorkflowDiscarded" from "./phases/workflowCompletion"

  @adw-460 @regression
  Scenario: adwMerge source writes "discarded" for the two terminal exit paths
    Given "adws/adwMerge.tsx" is read
    Then the pr_closed exit writes workflowStage "discarded"
    And the merge_failed exit writes workflowStage "discarded"

  # ═══════════════════════════════════════════════════════════════════════════
  # 2. adwMerge — abandoned (transient) exits
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-460 @regression
  Scenario: adwMerge returns "no_state_file" without writing top-level state when the state file is missing
    Given executeMerge is invoked with readTopLevelState returning null
    When the no_state_file exit path is taken
    Then the result reason is "no_state_file"
    And writeTopLevelState is not called

  @adw-460 @regression
  Scenario: adwMerge writes workflowStage "abandoned" when the top-level stage is not awaiting_merge
    Given executeMerge is invoked with a top-level workflowStage of "completed"
    When the unexpected_stage exit path is taken
    Then the result reason begins with "unexpected_stage"
    And writeTopLevelState is called with workflowStage "abandoned"
    And writeTopLevelState is not called with workflowStage "discarded"

  @adw-460 @regression
  Scenario: adwMerge writes workflowStage "abandoned" when the orchestrator state path is not found
    Given executeMerge is invoked with findOrchestratorStatePath returning null
    When the no_orchestrator_state exit path is taken
    Then the result reason is "no_orchestrator_state"
    And writeTopLevelState is called with workflowStage "abandoned"
    And writeTopLevelState is not called with workflowStage "discarded"

  @adw-460 @regression
  Scenario: adwMerge writes workflowStage "abandoned" when branchName is missing in orchestrator state
    Given executeMerge is invoked with orchestrator state lacking branchName
    When the no_branch_name exit path is taken
    Then the result reason is "no_branch_name"
    And writeTopLevelState is called with workflowStage "abandoned"
    And writeTopLevelState is not called with workflowStage "discarded"

  @adw-460 @regression
  Scenario: adwMerge writes workflowStage "abandoned" when no PR is found for the branch
    Given executeMerge is invoked with findPRByBranch returning null
    When the no_pr_found exit path is taken
    Then the result reason is "no_pr_found"
    And writeTopLevelState is called with workflowStage "abandoned"
    And writeTopLevelState is not called with workflowStage "discarded"

  @adw-460 @regression
  Scenario: adwMerge writes workflowStage "abandoned" when ensureWorktree throws
    Given executeMerge is invoked and ensureWorktree throws an error
    When the worktree_error exit path is taken
    Then the result reason is "worktree_error"
    And writeTopLevelState is called with workflowStage "abandoned"
    And writeTopLevelState is not called with workflowStage "discarded"

  @adw-460 @regression
  Scenario: adwMerge source writes "abandoned" for each writing transient defensive exit
    Given "adws/adwMerge.tsx" is read
    Then the unexpected_stage exit writes workflowStage "abandoned"
    And the no_orchestrator_state exit writes workflowStage "abandoned"
    And the no_branch_name exit writes workflowStage "abandoned"
    And the no_pr_found exit writes workflowStage "abandoned"
    And the worktree_error exit writes workflowStage "abandoned"
    And the no_state_file exit does not call writeTopLevelState

  # ═══════════════════════════════════════════════════════════════════════════
  # 3. adwMerge — completed exits unchanged
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-460 @regression
  Scenario: adwMerge writes workflowStage "completed" when the PR is already MERGED
    Given executeMerge is invoked with a PR whose GitHub state is "MERGED"
    Then the result outcome is "completed" with reason "already_merged"
    And writeTopLevelState is called with workflowStage "completed"
    And writeTopLevelState is not called with workflowStage "abandoned"
    And writeTopLevelState is not called with workflowStage "discarded"

  @adw-460 @regression
  Scenario: adwMerge writes workflowStage "completed" on a successful auto-merge
    Given executeMerge is invoked with an open PR
    And mergeWithConflictResolution returns success=true
    Then the result outcome is "completed" with reason "merged"
    And writeTopLevelState is called with workflowStage "completed"
    And writeTopLevelState is not called with workflowStage "abandoned"
    And writeTopLevelState is not called with workflowStage "discarded"

  # ═══════════════════════════════════════════════════════════════════════════
  # 4. adwMerge unit test coverage — all ten writeTopLevelState paths
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-460 @regression
  Scenario: adwMerge.test.ts asserts workflowStage "discarded" for the pr_closed test
    Given "adws/__tests__/adwMerge.test.ts" is read
    Then the pr_closed test asserts writeTopLevelState was called with workflowStage "discarded"

  @adw-460 @regression
  Scenario: adwMerge.test.ts asserts workflowStage "discarded" for the merge_failed test
    Given "adws/__tests__/adwMerge.test.ts" is read
    Then the merge_failed test asserts writeTopLevelState was called with workflowStage "discarded"

  @adw-460 @regression
  Scenario: adwMerge.test.ts asserts workflowStage "abandoned" for each transient defensive exit
    Given "adws/__tests__/adwMerge.test.ts" is read
    Then the unexpected_stage test asserts writeTopLevelState was called with workflowStage "abandoned"
    And the no_orchestrator_state test asserts writeTopLevelState was called with workflowStage "abandoned"
    And the no_branch_name test asserts writeTopLevelState was called with workflowStage "abandoned"
    And the no_pr_found test asserts writeTopLevelState was called with workflowStage "abandoned"
    And the worktree_error test asserts writeTopLevelState was called with workflowStage "abandoned"

  @adw-460
  Scenario: adwMerge.test.ts asserts writeTopLevelState is not called for the no_state_file exit
    Given "adws/__tests__/adwMerge.test.ts" is read
    Then the no_state_file test asserts writeTopLevelState was not called

  @adw-460 @regression
  Scenario: adwMerge.test.ts asserts workflowStage "completed" for both completion exits
    Given "adws/__tests__/adwMerge.test.ts" is read
    Then the already_merged test asserts writeTopLevelState was called with workflowStage "completed"
    And the merged test asserts writeTopLevelState was called with workflowStage "completed"

  # ═══════════════════════════════════════════════════════════════════════════
  # 5. webhookHandlers — PR-closed path writes discarded
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-460 @regression
  Scenario: handlePullRequestEvent writes workflowStage "discarded" for a closed, non-merged PR
    Given handlePullRequestEvent is invoked with a closed, non-merged PR payload
    And the linked issue's comments contain an adw-id
    When the abandoned PR branch runs
    Then writeTopLevelState is called with workflowStage "discarded"
    And writeTopLevelState is not called with workflowStage "abandoned"

  @adw-460 @regression
  Scenario: webhookHandlers.ts PR-closed path writes "discarded" literal and not "abandoned"
    Given "adws/triggers/webhookHandlers.ts" is read
    Then the handlePullRequestEvent body writes workflowStage "discarded" to the top-level state
    And the handlePullRequestEvent body does not write workflowStage "abandoned" to the top-level state

  @adw-460
  Scenario: webhookHandlers.ts PR-closed path still closes the linked issue
    Given handlePullRequestEvent is invoked with a closed, non-merged PR payload
    When the abandoned PR branch runs
    Then closeIssue is called with the linked issue number
    And the comment posted on the closed issue explains that the PR was closed without merging

  # ═══════════════════════════════════════════════════════════════════════════
  # 6. webhookHandlers unit test coverage
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-460 @regression
  Scenario: webhookHandlers.test.ts asserts workflowStage "discarded" for the PR-closed path
    Given "adws/triggers/__tests__/webhookHandlers.test.ts" is read
    Then at least one handlePullRequestEvent test asserts writeTopLevelState was called with workflowStage "discarded"
    And no handlePullRequestEvent test asserts writeTopLevelState was called with workflowStage "abandoned"

  # ═══════════════════════════════════════════════════════════════════════════
  # 7. Cross-module semantics — retry predicates reflect the new classification
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-460 @regression
  Scenario: An issue whose adwMerge exited via pr_closed is filtered out of the cron backlog sweep
    Given an issue with adw-id "pr-closed-460" extracted from comments
    And a state file exists at "agents/pr-closed-460/state.json" with workflowStage "discarded"
    When the cron trigger evaluates eligibility
    Then the issue is not eligible for re-processing
    And the filter reason identifies the issue as terminally discarded

  @adw-460 @regression
  Scenario: An issue whose adwMerge exited via merge_failed is filtered out of the cron backlog sweep
    Given an issue with adw-id "merge-failed-460" extracted from comments
    And a state file exists at "agents/merge-failed-460/state.json" with workflowStage "discarded"
    When the cron trigger evaluates eligibility
    Then the issue is not eligible for re-processing
    And the filter reason identifies the issue as terminally discarded

  @adw-460 @regression
  Scenario: An issue whose adwMerge exited via a transient defensive path remains retriable
    Given an issue with adw-id "transient-460" extracted from comments
    And a state file exists at "agents/transient-460/state.json" with workflowStage "abandoned"
    When the cron trigger evaluates eligibility
    Then the issue is considered eligible via the retriable abandoned path

  # ═══════════════════════════════════════════════════════════════════════════
  # 8. TypeScript compilation
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-460 @regression
  Scenario: TypeScript type-check passes after call-site reclassification
    When "bunx tsc --noEmit" is run
    Then the command exits with code 0
    And "bunx tsc --noEmit -p adws/tsconfig.json" also exits with code 0
