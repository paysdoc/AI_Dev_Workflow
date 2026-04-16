@adw-dcy9qz-create-thin-merge-or
Feature: Thin merge orchestrator and cron awaiting_merge handoff

  adwMerge.tsx is a minimal orchestrator spawned by the cron when it detects
  workflowStage === 'awaiting_merge' in the state file. It receives the same
  adw-id as the original orchestrator, reads the state file for PR URL and
  branch name, checks PR status, resolves conflicts if needed, merges the PR,
  and writes 'completed' to the state file. The cron detects awaiting_merge
  as a handoff stage (not active, not retriable) that bypasses the grace
  period. Cleanup happens via the issues.closed webhook when GitHub
  auto-closes the issue.

  Background:
    Given the ADW codebase is checked out

  # ═══════════════════════════════════════════════════════════════════════════
  # 1. adwMerge.tsx existence and interface
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-dcy9qz-create-thin-merge-or @regression
  Scenario: adwMerge.tsx exists as a dedicated merge orchestrator
    Then the file "adws/adwMerge.tsx" exists

  @adw-dcy9qz-create-thin-merge-or @regression
  Scenario: adwMerge.tsx accepts adw-id and issue number as arguments
    Given "adws/adwMerge.tsx" is read
    Then the script parses adw-id and issue number from command-line arguments

  # ═══════════════════════════════════════════════════════════════════════════
  # 2. State file reading
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-dcy9qz-create-thin-merge-or @regression
  Scenario: adwMerge.tsx reads the top-level state file for the given adw-id
    Given "adws/adwMerge.tsx" is read
    Then the script reads the state file via AgentStateManager using the adw-id

  @adw-dcy9qz-create-thin-merge-or @regression
  Scenario: adwMerge.tsx extracts PR URL from the state file
    Given "adws/adwMerge.tsx" is read
    Then the script reads the PR URL from the state file

  @adw-dcy9qz-create-thin-merge-or
  Scenario: adwMerge.tsx extracts branch name from the state file
    Given "adws/adwMerge.tsx" is read
    Then the script reads the branch name from the state file

  # ═══════════════════════════════════════════════════════════════════════════
  # 3. PR status checking
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-dcy9qz-create-thin-merge-or @regression
  Scenario: adwMerge.tsx checks if the PR is still open before merging
    Given "adws/adwMerge.tsx" is read
    Then the script checks the PR state before attempting merge

  @adw-dcy9qz-create-thin-merge-or
  Scenario: adwMerge.tsx exits without error when PR is closed but not merged
    Given "adws/adwMerge.tsx" is read
    Then the script handles a closed-but-not-merged PR gracefully

  # ═══════════════════════════════════════════════════════════════════════════
  # 4. Already-merged PR handling
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-dcy9qz-create-thin-merge-or @regression
  Scenario: adwMerge.tsx handles already-merged PR gracefully
    Given "adws/adwMerge.tsx" is read
    Then the script detects when the PR is already merged
    And writes workflowStage "completed" to the state file
    And posts a completion comment on the issue

  # ═══════════════════════════════════════════════════════════════════════════
  # 5. Merge with conflict resolution
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-dcy9qz-create-thin-merge-or @regression
  Scenario: adwMerge.tsx uses mergeWithConflictResolution for the merge attempt
    Given "adws/adwMerge.tsx" is read
    Then the script calls "mergeWithConflictResolution" to attempt the merge

  @adw-dcy9qz-create-thin-merge-or
  Scenario: adwMerge.tsx resolves conflicts before merging when needed
    Given "adws/adwMerge.tsx" is read
    Then the merge flow includes conflict resolution via resolve_conflict

  # ═══════════════════════════════════════════════════════════════════════════
  # 6. Completion handling
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-dcy9qz-create-thin-merge-or @regression
  Scenario: adwMerge.tsx writes completed to state file on successful merge
    Given "adws/adwMerge.tsx" is read
    Then the script writes workflowStage "completed" to the top-level state file on success

  @adw-dcy9qz-create-thin-merge-or @regression
  Scenario: adwMerge.tsx posts a completion comment on the issue after merge
    Given "adws/adwMerge.tsx" is read
    Then the script posts a completion comment on the issue after successful merge

  @adw-dcy9qz-create-thin-merge-or
  Scenario: adwMerge.tsx exits cleanly after writing completed state
    Given "adws/adwMerge.tsx" is read
    Then the script exits with code 0 after writing the completed state

  # ═══════════════════════════════════════════════════════════════════════════
  # 7. Cron awaiting_merge stage classification
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-dcy9qz-create-thin-merge-or @regression
  Scenario: awaiting_merge is not classified as an active stage
    Given the stage "awaiting_merge"
    When isActiveStage evaluates the stage
    Then the stage evaluation returns false

  @adw-dcy9qz-create-thin-merge-or @regression
  Scenario: awaiting_merge is not classified as a retriable stage
    Given the stage "awaiting_merge"
    When isRetriableStage evaluates the stage
    Then the stage evaluation returns false

  @adw-dcy9qz-create-thin-merge-or @regression
  Scenario: Cron evaluateIssue recognizes awaiting_merge as a handoff stage
    Given the file "adws/triggers/trigger_cron.ts" is read
    Then evaluateIssue handles "awaiting_merge" as a distinct handoff stage
    And awaiting_merge does not fall through to the unknown-stage exclusion

  # ═══════════════════════════════════════════════════════════════════════════
  # 8. Cron grace period bypass for awaiting_merge
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-dcy9qz-create-thin-merge-or @regression
  Scenario: awaiting_merge bypasses the grace period check
    Given an issue with adw-id "merge123" extracted from comments
    And a state file exists with workflowStage "awaiting_merge" and recent phase timestamps
    When the cron trigger evaluates the issue
    Then the grace period check is skipped for awaiting_merge
    And the issue is processed immediately

  @adw-dcy9qz-create-thin-merge-or
  Scenario: Grace period still applies to non-handoff stages
    Given an issue with adw-id "active123" extracted from comments
    And a state file exists with workflowStage "abandoned" and recent phase timestamps
    When the cron trigger evaluates the issue
    Then the grace period check is applied normally

  # ═══════════════════════════════════════════════════════════════════════════
  # 9. Cron spawns adwMerge.tsx
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-dcy9qz-create-thin-merge-or @regression
  Scenario: Cron spawns adwMerge.tsx when awaiting_merge is detected
    Given the file "adws/triggers/trigger_cron.ts" is read
    Then when awaiting_merge is detected the cron spawns "adwMerge.tsx"
    And the spawned process receives the adw-id and issue number

  @adw-dcy9qz-create-thin-merge-or @regression
  Scenario: Cron does not use classifyAndSpawnWorkflow for awaiting_merge issues
    Given the file "adws/triggers/trigger_cron.ts" is read
    Then awaiting_merge issues bypass classifyAndSpawnWorkflow
    And are handled by a dedicated merge spawn path

  @adw-dcy9qz-create-thin-merge-or
  Scenario: Cron adds awaiting_merge issue to processedIssues after spawning adwMerge
    Given the file "adws/triggers/trigger_cron.ts" is read
    Then the issue number is added to processedIssues after spawning adwMerge.tsx

  # ═══════════════════════════════════════════════════════════════════════════
  # 10. WorkflowStage type
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-dcy9qz-create-thin-merge-or @regression
  Scenario: awaiting_merge is included in the WorkflowStage type
    Given "adws/types/workflowTypes.ts" is read
    Then the WorkflowStage type includes "awaiting_merge"

  # ═══════════════════════════════════════════════════════════════════════════
  # 11. TypeScript compilation
  # ═══════════════════════════════════════════════════════════════════════════

  @adw-dcy9qz-create-thin-merge-or @regression
  Scenario: TypeScript type-check passes after merge orchestrator implementation
    When "bunx tsc --noEmit" is run
    Then the command exits with code 0
    And "bunx tsc --noEmit -p adws/tsconfig.json" also exits with code 0
