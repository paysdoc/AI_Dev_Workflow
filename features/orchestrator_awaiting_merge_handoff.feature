@adw-bpn4sv-orchestrators-exit-a
Feature: Orchestrators exit after PR approval with awaiting_merge handoff

  All orchestrators (adwSdlc, adwChore, adwPlanBuildReview, adwPlanBuildTestReview)
  are restructured so that nothing runs after PR creation that requires the worktree.
  After PR creation the orchestrator approves the PR (API call), writes
  "awaiting_merge" to the top-level state file, then exits. The executeAutoMergePhase
  is removed from all four orchestrators.

  Background:
    Given the ADW codebase is checked out

  # ── executeAutoMergePhase removal ──────────────────────────────────────────

  @adw-bpn4sv-orchestrators-exit-a @regression
  Scenario: adwSdlc.tsx does not import executeAutoMergePhase
    Given "adws/adwSdlc.tsx" is read
    Then the file does not import "executeAutoMergePhase"

  @adw-bpn4sv-orchestrators-exit-a @regression
  Scenario: adwSdlc.tsx does not call executeAutoMergePhase
    Given "adws/adwSdlc.tsx" is read
    Then the file does not contain a call to "executeAutoMergePhase"

  @adw-bpn4sv-orchestrators-exit-a @regression
  Scenario: adwChore.tsx does not import executeAutoMergePhase
    Given "adws/adwChore.tsx" is read
    Then the file does not import "executeAutoMergePhase"

  @adw-bpn4sv-orchestrators-exit-a @regression
  Scenario: adwChore.tsx does not call executeAutoMergePhase
    Given "adws/adwChore.tsx" is read
    Then the file does not contain a call to "executeAutoMergePhase"

  @adw-bpn4sv-orchestrators-exit-a @regression
  Scenario: adwPlanBuildReview.tsx does not import executeAutoMergePhase
    Given "adws/adwPlanBuildReview.tsx" is read
    Then the file does not import "executeAutoMergePhase"

  @adw-bpn4sv-orchestrators-exit-a @regression
  Scenario: adwPlanBuildReview.tsx does not call executeAutoMergePhase
    Given "adws/adwPlanBuildReview.tsx" is read
    Then the file does not contain a call to "executeAutoMergePhase"

  @adw-bpn4sv-orchestrators-exit-a @regression
  Scenario: adwPlanBuildTestReview.tsx does not import executeAutoMergePhase
    Given "adws/adwPlanBuildTestReview.tsx" is read
    Then the file does not import "executeAutoMergePhase"

  @adw-bpn4sv-orchestrators-exit-a @regression
  Scenario: adwPlanBuildTestReview.tsx does not call executeAutoMergePhase
    Given "adws/adwPlanBuildTestReview.tsx" is read
    Then the file does not contain a call to "executeAutoMergePhase"

  # ── Phase reordering: adwChore.tsx ─────────────────────────────────────────

  @adw-bpn4sv-orchestrators-exit-a @regression
  Scenario: adwChore.tsx calls executeDiffEvaluationPhase before executePRPhase
    Given "adws/adwChore.tsx" is read
    Then "executeDiffEvaluationPhase" is called before "executePRPhase"

  @adw-bpn4sv-orchestrators-exit-a @regression
  Scenario: adwChore.tsx calls executeDocumentPhase before executePRPhase in regression path
    Given "adws/adwChore.tsx" is read
    Then "executeDocumentPhase" is called before "executePRPhase" in the regression_possible branch

  # ── Phase reordering: adwSdlc.tsx ──────────────────────────────────────────

  @adw-bpn4sv-orchestrators-exit-a @regression
  Scenario: adwSdlc.tsx calls executeKpiPhase before executePRPhase
    Given "adws/adwSdlc.tsx" is read
    Then "executeKpiPhase" is called before "executePRPhase"

  # ── PR approval after PR creation ──────────────────────────────────────────

  @adw-bpn4sv-orchestrators-exit-a @regression
  Scenario: adwSdlc.tsx approves PR after executePRPhase
    Given "adws/adwSdlc.tsx" is read
    Then "approvePR" is called after "executePRPhase"

  @adw-bpn4sv-orchestrators-exit-a @regression
  Scenario: adwChore.tsx approves PR after executePRPhase
    Given "adws/adwChore.tsx" is read
    Then "approvePR" is called after "executePRPhase"

  @adw-bpn4sv-orchestrators-exit-a @regression
  Scenario: adwPlanBuildReview.tsx approves PR after executePRPhase
    Given "adws/adwPlanBuildReview.tsx" is read
    Then "approvePR" is called after "executePRPhase"

  @adw-bpn4sv-orchestrators-exit-a @regression
  Scenario: adwPlanBuildTestReview.tsx approves PR after executePRPhase
    Given "adws/adwPlanBuildTestReview.tsx" is read
    Then "approvePR" is called after "executePRPhase"

  # ── awaiting_merge state file write ────────────────────────────────────────

  @adw-bpn4sv-orchestrators-exit-a @regression
  Scenario: adwSdlc.tsx writes awaiting_merge to top-level state after PR approval
    Given "adws/adwSdlc.tsx" is read
    Then the orchestrator writes workflowStage "awaiting_merge" after PR approval

  @adw-bpn4sv-orchestrators-exit-a @regression
  Scenario: adwChore.tsx writes awaiting_merge to top-level state after PR approval
    Given "adws/adwChore.tsx" is read
    Then the orchestrator writes workflowStage "awaiting_merge" after PR approval

  @adw-bpn4sv-orchestrators-exit-a @regression
  Scenario: adwPlanBuildReview.tsx writes awaiting_merge to top-level state after PR approval
    Given "adws/adwPlanBuildReview.tsx" is read
    Then the orchestrator writes workflowStage "awaiting_merge" after PR approval

  @adw-bpn4sv-orchestrators-exit-a @regression
  Scenario: adwPlanBuildTestReview.tsx writes awaiting_merge to top-level state after PR approval
    Given "adws/adwPlanBuildTestReview.tsx" is read
    Then the orchestrator writes workflowStage "awaiting_merge" after PR approval

  @adw-bpn4sv-orchestrators-exit-a @regression
  Scenario: awaiting_merge is written via AgentStateManager.writeTopLevelState
    Given "adws/adwSdlc.tsx" is read
    Then the awaiting_merge write uses "AgentStateManager.writeTopLevelState"

  # ── No worktree-dependent phase after PR ───────────────────────────────────

  @adw-bpn4sv-orchestrators-exit-a @regression
  Scenario: adwSdlc.tsx has no worktree-dependent phase after executePRPhase
    Given "adws/adwSdlc.tsx" is read
    Then no phase that requires the worktree is called after "executePRPhase"
    And only API calls and state writes occur between "executePRPhase" and "completeWorkflow"

  @adw-bpn4sv-orchestrators-exit-a @regression
  Scenario: adwChore.tsx has no worktree-dependent phase after executePRPhase
    Given "adws/adwChore.tsx" is read
    Then no phase that requires the worktree is called after "executePRPhase"
    And only API calls and state writes occur between "executePRPhase" and "completeWorkflow"

  @adw-bpn4sv-orchestrators-exit-a @regression
  Scenario: adwPlanBuildReview.tsx has no worktree-dependent phase after executePRPhase
    Given "adws/adwPlanBuildReview.tsx" is read
    Then no phase that requires the worktree is called after "executePRPhase"
    And only API calls and state writes occur between "executePRPhase" and "completeWorkflow"

  @adw-bpn4sv-orchestrators-exit-a @regression
  Scenario: adwPlanBuildTestReview.tsx has no worktree-dependent phase after executePRPhase
    Given "adws/adwPlanBuildTestReview.tsx" is read
    Then no phase that requires the worktree is called after "executePRPhase"
    And only API calls and state writes occur between "executePRPhase" and "completeWorkflow"

  # ── executePRPhase is last worktree phase ──────────────────────────────────

  @adw-bpn4sv-orchestrators-exit-a @regression
  Scenario: executePRPhase is the final phase before the approve-and-exit sequence
    Given "adws/adwPlanBuildReview.tsx" is read
    Then "executePRPhase" is the last executeXxxPhase call before "approvePR"

  # ── completeWorkflow called after handoff ──────────────────────────────────

  @adw-bpn4sv-orchestrators-exit-a
  Scenario: adwSdlc.tsx calls completeWorkflow after awaiting_merge write
    Given "adws/adwSdlc.tsx" is read
    Then "completeWorkflow" is called after the awaiting_merge state write

  @adw-bpn4sv-orchestrators-exit-a
  Scenario: adwChore.tsx calls completeWorkflow after awaiting_merge write
    Given "adws/adwChore.tsx" is read
    Then "completeWorkflow" is called after the awaiting_merge state write

  # ── hitl label gate preserved ──────────────────────────────────────────────

  @adw-bpn4sv-orchestrators-exit-a
  Scenario: Orchestrators check hitl label before approving PR
    Given "adws/adwSdlc.tsx" is read
    Then the orchestrator checks for the hitl label before calling approvePR
    And the orchestrator skips approvePR when hitl label is present

  # ── TypeScript type-check ──────────────────────────────────────────────────

  @adw-bpn4sv-orchestrators-exit-a @regression
  Scenario: ADW TypeScript type-check passes after orchestrator restructure
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
