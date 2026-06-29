@adw-696 @adw-vl60su-gitcontext-migrate-g
Feature: GitContext fetch/merge/ls-remote migration — the residual remote git ops route through the per-command-auth chokepoint, and the git/gh guard no longer exempts their two consumers

  Issue #696 (parent PRD `specs/prd/git-context-repo-authority.md`, user stories 5
  and 17) migrates the last two consumers of remote git operations off raw
  `execSync`/`execWithRetry` shell-outs and onto `GitContext`:

    • `adws/triggers/autoMergeHandler.ts` — 9 `git fetch`/`git merge`/`git push`/
      `git reset --hard` shell-outs, all now routing through the new `fetchRemote`,
      `mergeBranch`, `abortMerge` context methods (and the already-migrated
      `pushBranch`/`fetchAndResetToRemote`).
    • `adws/core/remoteReconcile.ts` — `git ls-remote --exit-code origin <branch>`
      via `execWithRetry` with no `cwd`, resolving `origin` from `process.cwd()` (the
      wrong-base-repo bug); now routes through `gitContextForRepo(repoInfo).lsRemote(…)`
      which injects the correct `cwd` from `repoInfo`.

  Four new methods are added to `GitContext` via a new `remoteOps.ts` op module:
  `fetchRemote`, `mergeBranch`, `abortMerge`, `lsRemote`. Each routes through the
  private `#run()` per-command-auth chokepoint, inheriting token injection,
  git-identity injection, and explicit `cwd` — the same chokepoint the entire
  epic exists to enforce.

  Background:
    Given the ADW codebase is checked out

  # ═══════════════ §1  THE NEW REMOTE-OP METHODS ROUTE THROUGH #run (story 17) ══

  # ── §1a  fetch-remote carries token + git identity + supplied cwd ───────────────

  @adw-696 @adw-vl60su-gitcontext-migrate-g
  Scenario: The new fetchRemote method supplies the context token, git identity, and supplied cwd to its child command
    Given a GitContext for owner "acme" repo "webapp" with auth token "token-acme" and git author "Acme Bot <bot@acme.dev>"
    And the context's git and gh commands are captured by a recording runner
    When the "fetch-remote" remote-op operation runs through the context for worktree path "/srv/adw/repos/acme/webapp/.worktrees/feat"
    Then the captured command ran with auth token "token-acme" in its child environment
    And the captured command ran with git author "Acme Bot <bot@acme.dev>" in its child environment
    And the captured command ran with cwd equal to the supplied worktree path "/srv/adw/repos/acme/webapp/.worktrees/feat"

  # ── §1b  ls-remote carries token + git identity + defaults to base-path cwd ─────

  @adw-696 @adw-vl60su-gitcontext-migrate-g
  Scenario: The new lsRemote method defaults cwd to the context base path and carries token + git identity
    Given a GitContext for owner "acme" repo "webapp" with auth token "token-acme" and git author "Acme Bot <bot@acme.dev>"
    And the context's git and gh commands are captured by a recording runner
    When the "ls-remote" remote-op operation runs through the context
    Then the captured command ran with auth token "token-acme" in its child environment
    And the captured command ran with git author "Acme Bot <bot@acme.dev>" in its child environment
    And the captured command ran with cwd equal to the context base path

  # ── §1c  remote-op methods do not mutate the parent process environment ──────────

  @adw-696 @adw-vl60su-gitcontext-migrate-g
  Scenario: A remote-op leaves the parent process environment byte-for-byte unchanged
    Given a GitContext for owner "acme" repo "webapp" with auth token "token-acme" and git author "Acme Bot <bot@acme.dev>"
    And the context's git and gh commands are captured by a recording runner
    And a baseline snapshot of the parent process environment is captured
    When the "ls-remote" remote-op operation runs through the context
    Then the parent process environment matches the baseline snapshot

  # ═══════════════ §2  CONSUMERS DE-ALLOWLISTED AND GUARD-CLEAN (story 5) ══════════

  @adw-696 @adw-vl60su-gitcontext-migrate-g
  Scenario Outline: The git/gh guard scans the migrated remote-op consumer (no longer allowlisted) and finds no direct git/gh shell-out
    Given the ADW codebase is checked out
    When the git/gh guard scans the file "<file>"
    Then the git/gh guard scanned that file
    And the git/gh guard reports no violation in that file

    Examples:
      | file                                    |
      | adws/triggers/autoMergeHandler.ts       |
      | adws/core/remoteReconcile.ts            |

  # ═══════════════ §3  WHOLE-REPO GUARD STILL PASSES (story 5) ═════════════════════

  @adw-696 @adw-vl60su-gitcontext-migrate-g
  Scenario: The git/gh guard passes across the whole repository after the remote-op consumers are de-allowlisted
    Given the ADW codebase is checked out
    When the git/gh guard is run across the repository
    Then the git/gh guard reports no violations

  # ═══════════════ §4  TYPE-CHECK BACKSTOP (registry T22) ══════════════════════════

  @adw-696 @adw-vl60su-gitcontext-migrate-g
  Scenario: The ADW TypeScript type-check passes with the migrated remote-op surface in place
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
