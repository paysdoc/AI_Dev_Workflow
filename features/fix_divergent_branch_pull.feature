@adw-368
Feature: pullLatestDefaultBranch handles divergent branches gracefully

  When ADW initializes a workflow, it pulls the latest default branch of the
  target repository via pullLatestDefaultBranch(). If the local default branch
  has diverged from the remote (e.g., due to a force-push or a prior failed
  merge), the bare `git pull` fails with "Need to specify how to reconcile
  divergent branches." The fix must ensure the pull always succeeds by
  specifying a reconciliation strategy.

  Background:
    Given the ADW codebase is checked out

  # ── 1. Pull command uses a reconciliation strategy ─────────────────────

  @adw-368 @regression
  Scenario: pullLatestDefaultBranch git pull command includes a reconciliation strategy
    Given "adws/core/targetRepoManager.ts" is read
    Then the git pull command in pullLatestDefaultBranch includes a reconciliation flag
    And the flag is one of "--ff-only", "--rebase", or "--no-rebase"

  @adw-368 @regression
  Scenario: pullLatestDefaultBranch does not use a bare git pull without strategy
    Given "adws/core/targetRepoManager.ts" is read
    Then there is no bare "git pull" call without a reconciliation strategy in pullLatestDefaultBranch

  # ── 2. Divergent branch recovery ──────────────────────────────────────

  @adw-368 @regression
  Scenario: pullLatestDefaultBranch recovers when local and remote have diverged
    Given "adws/core/targetRepoManager.ts" is read
    Then pullLatestDefaultBranch has a fallback that resets to the remote branch when pull fails
    And the fallback uses "git reset --hard" to origin/defaultBranch

  @adw-368
  Scenario: Divergent branch recovery logs a warning before resetting
    Given "adws/core/targetRepoManager.ts" is read
    Then the divergent branch fallback logs a warning indicating a reset is being performed

  # ── 3. Normal fast-forward pull still works ────────────────────────────

  @adw-368 @regression
  Scenario: pullLatestDefaultBranch still fetches and checks out the default branch
    Given "adws/core/targetRepoManager.ts" is read
    Then pullLatestDefaultBranch calls "git fetch origin" before pulling
    And pullLatestDefaultBranch checks out the default branch before pulling
    And pullLatestDefaultBranch returns the default branch name

  # ── 4. ensureTargetRepoWorkspace integration ──────────────────────────

  @adw-368
  Scenario: ensureTargetRepoWorkspace succeeds when default branch has diverged
    Given a target repository workspace exists with a cloned repo
    And the local default branch has diverged from the remote default branch
    When ensureTargetRepoWorkspace is called for that target repo
    Then the function completes without throwing an error
    And the local default branch matches the remote default branch HEAD

  # ── 5. TypeScript integrity ────────────────────────────────────────────

  @adw-368 @regression
  Scenario: ADW TypeScript type-check passes after the divergent branch pull fix
    Given the ADW codebase is checked out
    When "bunx tsc --noEmit" and "bunx tsc --noEmit -p adws/tsconfig.json" are run
    Then both type-check commands exit with code 0
