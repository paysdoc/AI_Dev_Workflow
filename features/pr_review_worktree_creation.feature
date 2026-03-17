@adw-217
Feature: PR review creates worktree for branch that exists only on the remote

  When adwPrReview.tsx starts, it calls ensureWorktree(prDetails.headBranch) with
  no base branch. If the branch exists on GitHub but has not been fetched into local
  remote-tracking refs (origin/<branch>), createWorktree throws
  "Branch does not exist and no base branch was provided", crashing the PR review
  workflow before any review work begins.

  The fix must fetch the branch from the remote before attempting worktree creation
  so that createWorktree can locate the branch even when the local repo has stale
  or missing remote-tracking refs.

  Background:
    Given the ADW codebase is checked out

  @adw-217 @regression
  Scenario: createWorktree fetches from remote when branch is not in remote-tracking refs
    Given "adws/vcs/worktreeCreation.ts" is read
    Then createWorktree or ensureWorktree performs a git fetch for the target branch before attempting git worktree add

  @adw-217 @regression
  Scenario: PR review worktree is created for a branch that exists on remote but not locally
    Given a PR exists for branch "chore-issue-28-update-command-md"
    And the branch does not exist as a local branch in the ADW repository
    And the branch has not been fetched so "origin/chore-issue-28-update-command-md" does not resolve
    When initializePRReviewWorkflow is called for that PR
    Then a worktree is successfully created for "chore-issue-28-update-command-md"
    And the workflow does not crash with "Branch does not exist and no base branch was provided"

  @adw-217 @regression
  Scenario: createWorktree handles branch present only in remote-tracking refs after fetch
    Given the branch "feat-99-abc-my-feature" does not exist as a local branch
    And after fetching, "origin/feat-99-abc-my-feature" resolves to a valid commit
    When createWorktree is called for "feat-99-abc-my-feature" with no base branch
    Then git worktree add creates the worktree tracking the remote branch
    And the worktree path is returned without error

  @adw-217 @regression
  Scenario: TypeScript type-check passes after the remote-fetch fix
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes

  @adw-217
  Scenario: ensureWorktree still reuses an existing worktree when the branch is already checked out
    Given a worktree already exists for branch "chore-issue-28-update-command-md"
    When ensureWorktree is called for "chore-issue-28-update-command-md"
    Then the existing worktree path is returned
    And no new worktree is created
    And no git fetch is performed for an already-present worktree

  @adw-217
  Scenario: ensureWorktree still works when the branch exists locally before the fetch
    Given the branch "feat-42-xyz-something" exists as a local branch
    When ensureWorktree is called for "feat-42-xyz-something"
    Then a worktree is created using the existing local branch
    And the worktree path is returned without error
