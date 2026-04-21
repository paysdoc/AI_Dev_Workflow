@adw-486
Feature: KPI commits land on the repo's default branch, not the current ADW branch

  When ADW's KPI phase commits app_docs/agentic_kpis.md, the commit must land
  on the repo's default branch (resolved at runtime via `gh repo view --json
  defaultBranchRef -q .defaultBranchRef.name`), regardless of which branch
  ADW itself is currently checked out on. Without this, KPI updates leak
  into the active feature branch and any open PR from it instead of landing
  cleanly on the default branch where cross-run KPI tracking belongs.

  The implementation uses a temporary detached worktree on
  origin/<default-branch> so the active ADW working tree, HEAD, and index
  are never mutated while other phases may still be running.

  Background:
    Given the ADW codebase is checked out

  # ── Default-branch resolution via gh ───────────────────────────────────

  @adw-486 @regression
  Scenario: commitAndPushKpiFile resolves the default branch via gh repo view
    Given "adws/vcs/commitOperations.ts" is read
    Then the file contains "defaultBranchRef"

  # ── Temp detached worktree on origin/<default-branch> ─────────────────

  @adw-486 @regression
  Scenario: commitAndPushKpiFile creates a detached worktree rather than checking out the default branch in place
    Given "adws/vcs/commitOperations.ts" is read
    Then the file contains "git worktree add --detach"

  @adw-486 @regression
  Scenario: commitAndPushKpiFile fetches the default branch from origin before creating the worktree
    Given "adws/vcs/commitOperations.ts" is read
    Then the file contains "git fetch origin"

  @adw-486 @regression
  Scenario: commitAndPushKpiFile pushes explicitly to the default branch on origin, not the current branch
    Given "adws/vcs/commitOperations.ts" is read
    Then the file contains "git push origin HEAD:"

  # ── Active working tree, HEAD, and index remain untouched ─────────────

  @adw-486 @regression
  Scenario: commitAndPushKpiFile does not mutate the active working tree with git checkout
    Given "adws/vcs/commitOperations.ts" is read
    Then the file does not contain "git checkout"

  @adw-486 @regression
  Scenario: commitAndPushKpiFile does not mutate the active index with git read-tree
    Given "adws/vcs/commitOperations.ts" is read
    Then the file does not contain "git read-tree"

  @adw-486 @regression
  Scenario: commitAndPushKpiFile does not mutate the active index with git update-index
    Given "adws/vcs/commitOperations.ts" is read
    Then the file does not contain "git update-index"

  @adw-486 @regression
  Scenario: commitAndPushKpiFile no longer selects the push target via getCurrentBranch
    Given "adws/vcs/commitOperations.ts" is read
    Then the file does not contain "getCurrentBranch"

  # ── Temp worktree is always cleaned up ────────────────────────────────

  @adw-486 @regression
  Scenario: commitAndPushKpiFile removes the temp worktree via git worktree remove
    Given "adws/vcs/commitOperations.ts" is read
    Then the file contains "git worktree remove"

  @adw-486 @regression
  Scenario: commitAndPushKpiFile cleans up the temp worktree in a finally block so cleanup always runs
    Given "adws/vcs/commitOperations.ts" is read
    Then the file contains "finally"

  # ── Non-fatal contract preserved ──────────────────────────────────────

  @adw-486 @regression
  Scenario: commitAndPushKpiFile still catches errors and logs a warning without throwing
    Given "adws/vcs/commitOperations.ts" is read
    Then the file contains "try"
    And the file contains "catch"
    And the file contains "log"

  # ── Type safety ───────────────────────────────────────────────────────

  @adw-486 @regression
  Scenario: TypeScript type-check passes after the KPI default-branch fix
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
