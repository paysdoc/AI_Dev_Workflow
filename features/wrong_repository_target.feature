@adw-223
Feature: PR review targets the correct repository

  When adwPrReview.tsx is triggered for a PR on a target repository (e.g., vestmatic),
  it must create the worktree in the target repository's workspace
  (~/.adw/repos/<owner>/<repo>/), not in the ADW repository directory.

  The root cause of the regression: adwPrReview.tsx extracts a targetRepo (with cloneUrl)
  from --target-repo CLI args but only forwards repoInfo (owner/repo, no cloneUrl) to
  initializePRReviewWorkflow. As a result, ensureWorktree is called without baseRepoPath,
  so all git operations run in the ADW process directory instead of the target repo workspace.

  Background:
    Given the ADW codebase is checked out

  @adw-223 @regression
  Scenario: adwPrReview passes targetRepo (with cloneUrl) to initializePRReviewWorkflow
    Given "adws/adwPrReview.tsx" is read
    Then adwPrReview.tsx calls initializePRReviewWorkflow with the targetRepo argument

  @adw-223 @regression
  Scenario: initializePRReviewWorkflow accepts a targetRepo parameter
    Given "adws/phases/prReviewPhase.ts" is read
    Then the initializePRReviewWorkflow function signature accepts a targetRepo parameter

  @adw-223 @regression
  Scenario: initializePRReviewWorkflow calls ensureTargetRepoWorkspace when targetRepo is provided
    Given "adws/phases/prReviewPhase.ts" is read
    Then initializePRReviewWorkflow imports and calls ensureTargetRepoWorkspace

  @adw-223 @adw-317 @regression
  Scenario: ensureWorktree is called with the target repo workspace path as baseRepoPath
    Given "adws/phases/prReviewPhase.ts" is read
    Then ensureWorktree is called with a baseRepoPath derived from the target repo workspace

  @adw-223 @regression
  Scenario: ADW TypeScript type-check passes after the wrong-repo fix
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes

  @adw-223
  Scenario: PR review for a target repo branch does not fail with "Branch does not exist" in the ADW repo
    Given a PR exists for branch "chore-issue-30-update-adw-settings" on the vestmatic repository
    And the branch does not exist in the ADW repository's git history
    And adwPrReview.tsx is invoked with "--target-repo paysdoc/vestmatic"
    When initializePRReviewWorkflow runs for PR #31
    Then the worktree is created inside the vestmatic workspace path
    And the workflow does not fail with "Branch does not exist and no base branch was provided"

  @adw-223
  Scenario: When no --target-repo is provided, worktree falls back to the ADW directory
    Given adwPrReview.tsx is invoked without --target-repo arguments
    When initializePRReviewWorkflow runs without a targetRepo
    Then ensureWorktree is called without a baseRepoPath
    And worktree operations remain scoped to the ADW repository directory
