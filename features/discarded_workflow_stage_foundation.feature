@adw-454
Feature: Discarded workflow stage foundation — type, cron skip-terminal parity, and shared helper

  Introduces the `discarded` workflow stage as the terminal, non-retriable
  counterpart to `abandoned`. This slice only delivers the foundation:
  the union member, the cron-sweeper skip behavior, and a shared
  `handleWorkflowDiscarded` helper. Existing call sites that write
  `abandoned` are NOT yet reclassified — that is a later slice.

  The end-to-end demonstration is: writing `discarded` to a top-level
  state file causes `cronIssueFilter` to skip the issue the same way
  `completed` is skipped, and `cronStageResolver` treats it as neither
  active nor retriable.

  Background:
    Given the ADW codebase is checked out

  # ═══════════════════════════════════════════════════════════════════════════
  # 1. WorkflowStage union gains `discarded`
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-454 @regression
  Scenario: WorkflowStage type in workflowTypes.ts includes "discarded"
    Given "adws/types/workflowTypes.ts" is read
    Then the WorkflowStage union type includes the literal "discarded"

  @adw-454 @regression
  Scenario: WorkflowStage type retains "abandoned" alongside the new "discarded"
    Given "adws/types/workflowTypes.ts" is read
    Then the WorkflowStage union type includes the literal "abandoned"
    And the WorkflowStage union type includes the literal "discarded"

  # ═══════════════════════════════════════════════════════════════════════════
  # 2. cronStageResolver treats `discarded` as skip-terminal (parity with completed)
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-454 @regression
  Scenario: isRetriableStage returns false for "discarded"
    Given the stage "discarded"
    When isRetriableStage evaluates the stage
    Then the stage evaluation returns false

  @adw-454 @regression
  Scenario: isActiveStage returns false for "discarded"
    Given the stage "discarded"
    When isActiveStage evaluates the stage
    Then the stage evaluation returns false

  @adw-454
  Scenario: isRetriableStage still returns true for "abandoned" (regression)
    Given the stage "abandoned"
    When isRetriableStage evaluates the stage
    Then the stage evaluation returns true

  # ═══════════════════════════════════════════════════════════════════════════
  # 3. cronIssueFilter skips `discarded` issues during backlog sweep
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-454 @regression
  Scenario: Issue with discarded stage from state file is excluded by the cron filter
    Given an issue with adw-id "discarded1" extracted from comments
    And a state file exists at "agents/discarded1/state.json" with workflowStage "discarded"
    When the cron trigger evaluates eligibility
    Then the issue is not eligible for re-processing
    And the filter reason includes "discarded"

  @adw-454 @regression
  Scenario: discarded issues are filtered with parity to completed issues
    Given an issue with adw-id "done-c-9999" extracted from comments
    And a state file exists at "agents/done-c-9999/state.json" with workflowStage "completed"
    And an issue with adw-id "done-d-9999" extracted from comments
    And a state file exists at "agents/done-d-9999/state.json" with workflowStage "discarded"
    When the cron trigger evaluates eligibility for each issue
    Then both issues are not eligible for re-processing
    And the filter reasons identify them as terminal skip cases

  @adw-454 @regression
  Scenario: discarded bypasses the retriable path that abandoned takes
    Given an issue with adw-id "retry-d-1234" extracted from comments
    And a state file exists at "agents/retry-d-1234/state.json" with workflowStage "discarded"
    When the cron trigger evaluates eligibility
    Then the issue is not considered eligible via isRetriableStage
    And the cron does not spawn a workflow for this issue

  # ═══════════════════════════════════════════════════════════════════════════
  # 4. handleWorkflowDiscarded helper in workflowCompletion.ts
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-454 @regression
  Scenario: workflowCompletion.ts exports a handleWorkflowDiscarded helper
    Given "adws/phases/workflowCompletion.ts" is read
    Then the file exports a function named "handleWorkflowDiscarded"

  @adw-454 @regression
  Scenario: handleWorkflowDiscarded writes workflowStage "discarded" to the top-level state
    Given a workflow invoking "handleWorkflowDiscarded" for adw-id "kill-1234"
    When the helper runs to completion
    Then the top-level state file at "agents/kill-1234/state.json" has workflowStage "discarded"

  @adw-454 @regression
  Scenario: handleWorkflowDiscarded posts a terminal comment on the issue
    Given a workflow invoking "handleWorkflowDiscarded" with a repoContext and issue number 77
    When the helper runs to completion
    Then a terminal comment is posted on issue 77 via the repoContext issue tracker
    And the comment communicates that the workflow was discarded (non-retriable)

  @adw-454
  Scenario: handleWorkflowDiscarded accepts a reason that appears in the terminal comment
    Given a workflow invoking "handleWorkflowDiscarded" with reason "pr_closed_externally"
    When the helper runs to completion
    Then the terminal comment posted on the issue includes the reason context "pr_closed_externally"

  # ═══════════════════════════════════════════════════════════════════════════
  # 5. Regression: handleWorkflowError still writes "abandoned"
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-454 @regression
  Scenario: handleWorkflowError still writes workflowStage "abandoned" (unchanged)
    Given "adws/phases/workflowCompletion.ts" is read
    Then handleWorkflowError writes workflowStage "abandoned" to the top-level state file
    And handleWorkflowError does not write workflowStage "discarded"

  @adw-454 @regression
  Scenario: existing callers of handleWorkflowError are not reclassified in this slice
    Given "adws/phases/workflowCompletion.ts" is read
    Then handleWorkflowError retains its existing behavior of writing "abandoned"
    And no existing call site of handleWorkflowError is migrated to handleWorkflowDiscarded

  # ═══════════════════════════════════════════════════════════════════════════
  # 6. Unit tests extended in cronStageResolver.test.ts and cronIssueFilter.test.ts
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-454 @regression
  Scenario: cronStageResolver.test.ts covers the discarded skip path for isRetriableStage
    Given "adws/triggers/__tests__/cronStageResolver.test.ts" is read
    Then the test file asserts that isRetriableStage returns false for "discarded"

  @adw-454 @regression
  Scenario: cronStageResolver.test.ts covers the discarded skip path for isActiveStage
    Given "adws/triggers/__tests__/cronStageResolver.test.ts" is read
    Then the test file asserts that isActiveStage returns false for "discarded"

  @adw-454 @regression
  Scenario: cronIssueFilter test suite covers the discarded exclusion path
    Given the cron issue filter test file is read
    Then at least one test asserts that evaluateIssue excludes an issue whose state stage is "discarded"
    And the exclusion reason references the terminal/discarded classification

  # ═══════════════════════════════════════════════════════════════════════════
  # 7. No migration — only new writes use the new stage
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-454 @regression
  Scenario: No migration script rewrites existing state files to the discarded stage
    Given the ADW codebase is checked out
    Then no module references a migration that rewrites existing "abandoned" state files to "discarded"
    And existing state files that read "abandoned" continue to be treated as retriable

  @adw-454
  Scenario: Existing "abandoned" state files remain retriable after this slice
    Given a pre-existing state file at "agents/legacy-12345/state.json" with workflowStage "abandoned"
    When the cron trigger evaluates eligibility
    Then the issue is considered eligible for re-processing via the existing abandoned path
    And the stage is not silently upgraded to "discarded"

  # ═══════════════════════════════════════════════════════════════════════════
  # 8. Scope guard — call site reclassification is out of scope for this slice
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-454
  Scenario: adwMerge defensive exits are not reclassified in this slice
    Given "adws/adwMerge.tsx" is read
    Then adwMerge does not yet call handleWorkflowDiscarded
    And adwMerge's defensive exits that currently write "abandoned" remain unchanged

  @adw-454
  Scenario: webhookHandlers PR-closed path is not reclassified in this slice
    Given the webhook handlers module is read
    Then the PR-closed path does not yet write workflowStage "discarded"
    And the PR-closed path's existing behavior is preserved for slice #2

  # ═══════════════════════════════════════════════════════════════════════════
  # 9. TypeScript compilation
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-454 @regression
  Scenario: TypeScript type-check passes after adding the discarded stage
    When "bunx tsc --noEmit" is run
    Then the command exits with code 0
    And "bunx tsc --noEmit -p adws/tsconfig.json" also exits with code 0
