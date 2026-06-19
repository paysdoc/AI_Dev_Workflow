# PR and Merge Phases

## Overview

These three phases manage the end of a workflow's build lifecycle: creating a pull request from the worktree branch, addressing unaddressed review comments, and automatically merging an approved PR. Together they drive an issue from completed implementation through code review to final merge.

## Responsibilities

- `executePRPhase`: commits any lingering uncommitted changes, generates a PR title and body via the `/pull_request` agent, pushes the branch, creates the PR via `CodeHost.createPullRequest()`, and moves the issue to the Review board status.
- `initializePRReviewWorkflow`: bootstraps a PR review run — fetches PR details, checks for unaddressed comments, creates a worktree on the PR's head branch, writes orchestrator state, allocates a dev-server port, and constructs a `PRReviewWorkflowConfig`.
- `executePRReviewPlanPhase`: reads the existing plan file (or falls back to the PR body), runs the PR review plan agent, and posts stage comments on the PR.
- `executePRReviewBuildPhase`: runs the PR review build agent with the plan output and posts stage comments.
- `executePRReviewCommitPushPhase`: commits all changes, pushes the branch, and moves the linked issue to Review.
- `executeAutoMergePhase`: reads PR approval state from GitHub; if no approval is found, applies the `hitl` label and posts a one-time comment; if approved, calls `mergeWithConflictResolution` (up to `MAX_AUTO_MERGE_ATTEMPTS` attempts) and posts a failure comment if merging cannot complete. Merge failures are non-fatal.

## Contracts & Invariants

- `executePRPhase` commits any uncommitted changes before creating the PR, so the PR always reflects the full worktree state.
- `initializePRReviewWorkflow` exits the process immediately (`process.exit(0)`) when the PR is already CLOSED or MERGED, or when no unaddressed comments exist.
- `executeAutoMergePhase` silently skips (no comment) when the `hitl` label is already present, preventing comment floods on repeated cron re-entries.
- The `hitl` label is applied and a comment is posted at most once per unapproved PR cycle; subsequent cron entries hit the silent-skip path.
- Merge failures do not propagate as thrown errors — the phase always returns successfully.
- `PRReviewWorkflowConfig.base` conforms to `WorkflowConfig`, allowing PR review phases to reuse the same phase helpers as standard workflows.

## Configuration

GitHub App authentication is activated at the start of `initializePRReviewWorkflow` via `activateGitHubAppAuth`. The `repoContext` is created from a `RepoIdentifier`; when it cannot be created, the phase falls back to direct `gh` CLI calls. `MAX_AUTO_MERGE_ATTEMPTS` is read from `core` constants.

## Gotchas

- `executePRPhase` uses `repoContext.codeHost.createPullRequest()` when a `repoContext` is available; without one it only logs the generated PR content and does not create a PR.
- `extractPrNumber` in `autoMergePhase` parses the PR number from `ctx.prUrl`; the phase exits as a no-op when the URL is absent or unparseable.
- `approvePR` (called upstream by the merge orchestrator, not by these phases) uses a PAT-swap to work around GitHub's rule that an actor cannot approve their own PR.
- `inferIssueTypeFromBranch` is called in the commit-push phase to classify the issue type from the branch name prefix because the PR review workflow does not carry the original `issueType`.
