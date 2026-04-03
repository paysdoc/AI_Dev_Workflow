@adw-xngqn4-orchestrators-exit-a @adw-380 @regression
Feature: Orchestrators exit after PR approval with awaiting_merge handoff

  All orchestrators (adwSdlc, adwChore, adwPlanBuildReview, adwPlanBuildTestReview)
  are restructured so that nothing runs after PR creation that requires the worktree.
  After PR creation, the orchestrator approves the PR via API call, writes
  "awaiting_merge" to the top-level workflow state file, and exits.

  executeAutoMergePhase is removed from all four orchestrators. Phase ordering
  is adjusted so worktree-dependent phases run before PR creation.

  Background:
    Given the ADW codebase is checked out

  # -- awaiting_merge as a valid WorkflowStage ----------------------------

  @adw-xngqn4-orchestrators-exit-a @regression
  Scenario: awaiting_merge is a valid WorkflowStage value
    Given "adws/types/workflowTypes.ts" is read
    Then the WorkflowStage union type includes "awaiting_merge"

  # -- adwSdlc.tsx --------------------------------------------------------

  @adw-xngqn4-orchestrators-exit-a @regression
  Scenario: adwSdlc.tsx does not import executeAutoMergePhase
    Given "adws/adwSdlc.tsx" is read
    Then the file does not import "executeAutoMergePhase"

  @adw-xngqn4-orchestrators-exit-a @regression
  Scenario: adwSdlc.tsx runs KPI phase before PR phase
    Given "adws/adwSdlc.tsx" is read
    Then "executeKpiPhase" is called before "executePRPhase"

  @adw-xngqn4-orchestrators-exit-a @regression
  Scenario: adwSdlc.tsx approves PR after PR creation
    Given "adws/adwSdlc.tsx" is read
    Then "approvePR" is called after "executePRPhase"

  @adw-xngqn4-orchestrators-exit-a @regression
  Scenario: adwSdlc.tsx writes awaiting_merge to top-level state file after PR creation
    Given "adws/adwSdlc.tsx" is read
    Then the orchestrator writes "awaiting_merge" to the top-level state file after "executePRPhase"

  @adw-xngqn4-orchestrators-exit-a
  Scenario: adwSdlc.tsx has no worktree-dependent phase after PR creation
    Given "adws/adwSdlc.tsx" is read
    Then no phase that requires the worktree is called after "executePRPhase"

  # -- adwChore.tsx -------------------------------------------------------

  @adw-xngqn4-orchestrators-exit-a @regression
  Scenario: adwChore.tsx does not import executeAutoMergePhase
    Given "adws/adwChore.tsx" is read
    Then the file does not import "executeAutoMergePhase"

  @adw-xngqn4-orchestrators-exit-a @regression
  Scenario: adwChore.tsx runs DiffEvaluation phase before PR phase
    Given "adws/adwChore.tsx" is read
    Then "executeDiffEvaluationPhase" is called before "executePRPhase"

  @adw-xngqn4-orchestrators-exit-a @regression
  Scenario: adwChore.tsx runs Document phase before PR phase in regression path
    Given "adws/adwChore.tsx" is read
    Then in the regression_possible path "executeDocumentPhase" is called before "executePRPhase"

  @adw-xngqn4-orchestrators-exit-a @regression
  Scenario: adwChore.tsx approves PR after PR creation
    Given "adws/adwChore.tsx" is read
    Then "approvePR" is called after "executePRPhase"

  @adw-xngqn4-orchestrators-exit-a @regression
  Scenario: adwChore.tsx writes awaiting_merge to top-level state file after PR creation
    Given "adws/adwChore.tsx" is read
    Then the orchestrator writes "awaiting_merge" to the top-level state file after "executePRPhase"

  @adw-xngqn4-orchestrators-exit-a
  Scenario: adwChore.tsx has no worktree-dependent phase after PR creation
    Given "adws/adwChore.tsx" is read
    Then no phase that requires the worktree is called after "executePRPhase"

  # -- adwPlanBuildReview.tsx ---------------------------------------------

  @adw-xngqn4-orchestrators-exit-a @regression
  Scenario: adwPlanBuildReview.tsx does not import executeAutoMergePhase
    Given "adws/adwPlanBuildReview.tsx" is read
    Then the file does not import "executeAutoMergePhase"

  @adw-xngqn4-orchestrators-exit-a @regression
  Scenario: adwPlanBuildReview.tsx approves PR after PR creation
    Given "adws/adwPlanBuildReview.tsx" is read
    Then "approvePR" is called after "executePRPhase"

  @adw-xngqn4-orchestrators-exit-a @regression
  Scenario: adwPlanBuildReview.tsx writes awaiting_merge to top-level state file after PR creation
    Given "adws/adwPlanBuildReview.tsx" is read
    Then the orchestrator writes "awaiting_merge" to the top-level state file after "executePRPhase"

  @adw-xngqn4-orchestrators-exit-a
  Scenario: adwPlanBuildReview.tsx has no worktree-dependent phase after PR creation
    Given "adws/adwPlanBuildReview.tsx" is read
    Then no phase that requires the worktree is called after "executePRPhase"

  # -- adwPlanBuildTestReview.tsx -----------------------------------------

  @adw-xngqn4-orchestrators-exit-a @regression
  Scenario: adwPlanBuildTestReview.tsx does not import executeAutoMergePhase
    Given "adws/adwPlanBuildTestReview.tsx" is read
    Then the file does not import "executeAutoMergePhase"

  @adw-xngqn4-orchestrators-exit-a @regression
  Scenario: adwPlanBuildTestReview.tsx approves PR after PR creation
    Given "adws/adwPlanBuildTestReview.tsx" is read
    Then "approvePR" is called after "executePRPhase"

  @adw-xngqn4-orchestrators-exit-a @regression
  Scenario: adwPlanBuildTestReview.tsx writes awaiting_merge to top-level state file after PR creation
    Given "adws/adwPlanBuildTestReview.tsx" is read
    Then the orchestrator writes "awaiting_merge" to the top-level state file after "executePRPhase"

  @adw-xngqn4-orchestrators-exit-a
  Scenario: adwPlanBuildTestReview.tsx has no worktree-dependent phase after PR creation
    Given "adws/adwPlanBuildTestReview.tsx" is read
    Then no phase that requires the worktree is called after "executePRPhase"

  # -- Cross-cutting: autoMergePhase still exists for webhook path --------

  @adw-xngqn4-orchestrators-exit-a
  Scenario: autoMergePhase.ts still exists for the webhook auto-merge path
    Then the file "adws/phases/autoMergePhase.ts" exists

  @adw-xngqn4-orchestrators-exit-a
  Scenario: executeAutoMergePhase is still exported from phases/index.ts
    Given "adws/phases/index.ts" is read
    Then the file exports "executeAutoMergePhase"

  # -- TypeScript type-check ----------------------------------------------

  @adw-xngqn4-orchestrators-exit-a @regression
  Scenario: ADW TypeScript type-check passes after orchestrator restructuring
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
