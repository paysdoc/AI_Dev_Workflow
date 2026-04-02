@adw-n8bk8n-fix-worktree-root-co
Feature: Fix worktree root contamination — path rewriting hook and remove git pull from root

  Claude Code's Write/Edit/Read tools resolve absolute paths against the git repository
  root, not the spawned process's cwd. This causes files to land in the main repo root
  instead of the worktree. Additionally, git pull in the main repo root during
  initialization crashes on divergent branches or contaminates worktree state.

  This feature adds a pre-tool hook that rewrites file paths from the main repo root to
  the worktree path, removes unnecessary git pull operations from root-level VCS
  functions, and passes the required env vars from the agent harness to spawned processes.

  Background:
    Given the ADW codebase is checked out

  # ── 1. Pre-tool hook: worktree path rewriting ─────────────────────────

  @adw-n8bk8n-fix-worktree-root-co @regression
  Scenario: Pre-tool hook rewrites file_path from main repo root to worktree path
    Given ".claude/hooks/pre-tool-use.ts" is read
    Then the hook checks for ADW_WORKTREE_PATH and ADW_MAIN_REPO_PATH environment variables
    And when both env vars are present it rewrites file_path values that start with ADW_MAIN_REPO_PATH but not ADW_WORKTREE_PATH

  @adw-n8bk8n-fix-worktree-root-co @regression
  Scenario: Pre-tool hook intercepts Write, Edit, and Read tool calls
    Given ".claude/hooks/pre-tool-use.ts" is read
    Then the path rewriting logic applies to "Write", "Edit", and "Read" tool names

  @adw-n8bk8n-fix-worktree-root-co
  Scenario: Pre-tool hook does not rewrite paths already targeting the worktree
    Given ".claude/hooks/pre-tool-use.ts" is read
    Then a file_path that starts with ADW_WORKTREE_PATH is not rewritten even though it also starts with ADW_MAIN_REPO_PATH

  @adw-n8bk8n-fix-worktree-root-co
  Scenario: Pre-tool hook is inactive when env vars are absent
    Given ".claude/hooks/pre-tool-use.ts" is read
    Then when ADW_WORKTREE_PATH or ADW_MAIN_REPO_PATH is not set the path rewriting logic is skipped entirely

  @adw-n8bk8n-fix-worktree-root-co
  Scenario: Pre-tool hook does not rewrite Bash tool commands
    Given ".claude/hooks/pre-tool-use.ts" is read
    Then the path rewriting logic does not apply to the "Bash" tool name

  @adw-n8bk8n-fix-worktree-root-co @regression
  Scenario: Pre-tool hook replaces main repo root prefix with worktree path prefix
    Given ADW_MAIN_REPO_PATH is "/Users/dev/project"
    And ADW_WORKTREE_PATH is "/Users/dev/project/.worktrees/bugfix-issue-370"
    When a Write tool call has file_path "/Users/dev/project/features/my.feature"
    Then the hook rewrites file_path to "/Users/dev/project/.worktrees/bugfix-issue-370/features/my.feature"

  # ── 2. targetRepoManager.pullLatestDefaultBranch — fetch only ─────────

  @adw-n8bk8n-fix-worktree-root-co @regression
  Scenario: pullLatestDefaultBranch is replaced with fetch-only function
    Given "adws/core/targetRepoManager.ts" is read
    Then the function that updates the target repo runs only "git fetch origin"
    And it does not run "git checkout" or "git pull"

  @adw-n8bk8n-fix-worktree-root-co @regression
  Scenario: ensureTargetRepoWorkspace calls the fetch-only function
    Given "adws/core/targetRepoManager.ts" is read
    Then ensureTargetRepoWorkspace calls the renamed fetch-only function instead of pullLatestDefaultBranch

  @adw-n8bk8n-fix-worktree-root-co
  Scenario: Fetch-only function still detects the default branch name
    Given "adws/core/targetRepoManager.ts" is read
    Then the fetch-only function still queries the default branch name via gh repo view
    And returns the default branch name

  # ── 3. freeBranchFromMainRepo — no pull on park ───────────────────────

  @adw-n8bk8n-fix-worktree-root-co @regression
  Scenario: freeBranchFromMainRepo does not pull after checkout
    Given "adws/vcs/worktreeOperations.ts" is read
    Then freeBranchFromMainRepo runs "git checkout" for the default branch
    And freeBranchFromMainRepo does not run "git pull" after the checkout

  @adw-n8bk8n-fix-worktree-root-co
  Scenario: freeBranchFromMainRepo still auto-commits and pushes uncommitted changes
    Given "adws/vcs/worktreeOperations.ts" is read
    Then freeBranchFromMainRepo still runs git add, git commit, and git push for uncommitted changes before switching branches

  # ── 4. Deprecate checkoutDefaultBranch and checkoutBranch ─────────────

  @adw-n8bk8n-fix-worktree-root-co @regression
  Scenario: checkoutDefaultBranch is marked as deprecated
    Given "adws/vcs/branchOperations.ts" is read
    Then checkoutDefaultBranch has a @deprecated JSDoc annotation

  @adw-n8bk8n-fix-worktree-root-co @regression
  Scenario: checkoutBranch is marked as deprecated
    Given "adws/vcs/branchOperations.ts" is read
    Then checkoutBranch has a @deprecated JSDoc annotation

  @adw-n8bk8n-fix-worktree-root-co
  Scenario: Deprecated functions log a warning when called
    Given "adws/vcs/branchOperations.ts" is read
    Then checkoutDefaultBranch logs a deprecation warning when invoked
    And checkoutBranch logs a deprecation warning when invoked

  @adw-n8bk8n-fix-worktree-root-co
  Scenario: Deprecated functions are still exported for external consumers
    Given "adws/vcs/branchOperations.ts" is read
    Then checkoutDefaultBranch and checkoutBranch are still exported functions

  # ── 5. claudeAgent passes worktree env vars to spawned processes ──────

  @adw-n8bk8n-fix-worktree-root-co @regression
  Scenario: claudeAgent spawn includes ADW_WORKTREE_PATH env var
    Given "adws/agents/claudeAgent.ts" is read
    Then the spawn environment includes ADW_WORKTREE_PATH when a cwd is provided

  @adw-n8bk8n-fix-worktree-root-co @regression
  Scenario: claudeAgent spawn includes ADW_MAIN_REPO_PATH env var
    Given "adws/agents/claudeAgent.ts" is read
    Then the spawn environment includes ADW_MAIN_REPO_PATH derived from the repository root

  @adw-n8bk8n-fix-worktree-root-co
  Scenario: claudeAgent does not set worktree env vars when cwd is not provided
    Given "adws/agents/claudeAgent.ts" is read
    Then when cwd is not provided, ADW_WORKTREE_PATH and ADW_MAIN_REPO_PATH are not added to the spawn environment

  # ── 6. TypeScript integrity ────────────────────────────────────────────

  @adw-n8bk8n-fix-worktree-root-co @regression
  Scenario: ADW TypeScript type-check passes after all worktree path fixes
    Given the ADW codebase is checked out
    When "bunx tsc --noEmit" and "bunx tsc --noEmit -p adws/tsconfig.json" are run
    Then both type-check commands exit with code 0
