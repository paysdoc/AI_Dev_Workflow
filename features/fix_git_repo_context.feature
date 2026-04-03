@adw-317
Feature: All git operations target the correct repository context

  Multiple git operations in the ADW codebase default to process.cwd() (the ADW repo)
  when they should target an external repo. Every git operation must explicitly receive
  its repo context — no silent defaults to process.cwd() for repo-specific operations.

  Background:
    Given the ADW codebase is checked out

  # ── 1. copyEnvToWorktree accepts baseRepoPath ─────────────────────────────

  @adw-317 @regression
  Scenario: copyEnvToWorktree function signature accepts baseRepoPath parameter
    Given "adws/vcs/worktreeOperations.ts" is read
    Then the copyEnvToWorktree function signature accepts an optional baseRepoPath parameter

  @adw-317 @regression
  Scenario: copyEnvToWorktree uses baseRepoPath to resolve source .env path
    Given "adws/vcs/worktreeOperations.ts" is read
    Then copyEnvToWorktree passes baseRepoPath to getMainRepoPath when provided

  @adw-317
  Scenario: copyEnvToWorktree still works without baseRepoPath for ADW-local worktrees
    Given "adws/vcs/worktreeOperations.ts" is read
    Then copyEnvToWorktree can be called with only worktreePath and defaults to the ADW repo

  # ── 2. getRepoInfo accepts cwd parameter ───────────────────────────────────

  @adw-317 @regression
  Scenario: getRepoInfo function signature accepts optional cwd parameter
    Given "adws/github/githubApi.ts" is read
    Then the getRepoInfo function signature accepts an optional cwd parameter

  @adw-317 @regression
  Scenario: getRepoInfo passes cwd to execSync for git remote get-url
    Given "adws/github/githubApi.ts" is read
    Then getRepoInfo passes the cwd option to execSync when cwd is provided

  @adw-317
  Scenario: getRepoInfo without cwd defaults to process.cwd for backward compatibility
    Given "adws/github/githubApi.ts" is read
    Then getRepoInfo called without cwd reads the remote URL from the current working directory

  # ── 3. githubAppAuth.ts git remote read accepts cwd ────────────────────────

  @adw-317 @regression
  Scenario: githubAppAuth git remote fallback passes cwd to execSync
    Given "adws/github/githubAppAuth.ts" is read
    Then the git remote get-url fallback in activateGitHubAppAuth passes cwd to execSync when available

  # ── 4. Auto-merge handler passes baseRepoPath to ensureWorktree ────────────

  @adw-317
  Scenario: Auto-merge handler extracts target repo from webhook payload
    Given "adws/triggers/autoMergeHandler.ts" is read
    Then the auto-merge handler extracts owner and repo from the webhook payload repository field

  @adw-317
  Scenario: Auto-merge handler derives target repo workspace path
    Given "adws/triggers/autoMergeHandler.ts" is read
    Then the auto-merge handler derives the target repo workspace path before calling ensureWorktree

  @adw-317
  Scenario: Auto-merge handler passes baseRepoPath to ensureWorktree
    Given "adws/triggers/autoMergeHandler.ts" is read
    Then ensureWorktree is called with baseRepoPath derived from the target repo workspace

  # ── 5. worktreeCreation.ts threads baseRepoPath to copyEnvToWorktree ───────

  @adw-317 @regression
  Scenario: ensureWorktree passes baseRepoPath to copyEnvToWorktree
    Given "adws/vcs/worktreeCreation.ts" is read
    Then every call to copyEnvToWorktree inside ensureWorktree passes the baseRepoPath argument

  # ── 6. workflowInit.ts passes repo context to VCS functions ────────────────

  @adw-317 @regression
  Scenario: workflowInit passes targetRepoWorkspacePath to findWorktreeForIssue
    Given "adws/phases/workflowInit.ts" is read
    Then findWorktreeForIssue is called with targetRepoWorkspacePath as the cwd parameter

  @adw-317 @regression
  Scenario: workflowInit passes repo context to copyEnvToWorktree
    Given "adws/phases/workflowInit.ts" is read
    Then every call to copyEnvToWorktree in workflowInit passes the repo context when targetRepoWorkspacePath is available

  # ── 7. Target repo clones use SSH URLs ─────────────────────────────────────

  @adw-317 @regression
  Scenario: New target repo clones convert HTTPS URLs to SSH format
    Given "adws/core/targetRepoManager.ts" is read
    Then HTTPS clone URLs are converted to SSH format before cloning

  @adw-317
  Scenario: SSH clone URL format is git@github.com:owner/repo.git
    Given "adws/core/targetRepoManager.ts" is read
    Then the SSH URL conversion transforms "https://github.com/owner/repo" to "git@github.com:owner/repo.git"

  @adw-317
  Scenario: Already-SSH clone URLs are not double-converted
    Given "adws/core/targetRepoManager.ts" is read
    Then clone URLs already in SSH format are passed through unchanged

  # ── 8. No silent process.cwd() defaults in repo-specific operations ────────

  @adw-317 @regression
  Scenario: No git operations silently default to process.cwd for repo-specific work
    Given "adws/vcs/worktreeOperations.ts" is read
    And "adws/github/githubApi.ts" is read
    And "adws/github/githubAppAuth.ts" is read
    Then every git execSync call in repo-specific functions accepts a cwd parameter

  # ── 9. TypeScript integrity ────────────────────────────────────────────────

  @adw-317 @regression
  Scenario: ADW TypeScript type-check passes after the git repo context fix
    Given the ADW codebase is checked out
    When "bunx tsc --noEmit" and "bunx tsc --noEmit -p adws/tsconfig.json" are run
    Then both type-check commands exit with code 0

  # ── 10. End-to-end: external target repo worktree uses correct .env ────────

  @adw-317
  Scenario: Worktree for external target repo copies .env from target repo not ADW repo
    Given an external target repo exists at a workspace path
    And the target repo has its own .env file
    And the ADW repo has a different .env file
    When ensureWorktree is called with the target repo's baseRepoPath
    Then the worktree's .env file matches the target repo's .env
    And the worktree's .env file does not match the ADW repo's .env

  @adw-317
  Scenario: Auto-merge for external repo PR does not create worktree in ADW directory
    Given a pull_request_review webhook payload for repository "paysdoc/vestmatic"
    And the review state is "approved"
    When the auto-merge handler processes the webhook
    Then the worktree is created inside the vestmatic workspace path
    And the worktree is not created inside the ADW repository directory
