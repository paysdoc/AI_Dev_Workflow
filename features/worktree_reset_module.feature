@adw-457
Feature: worktreeReset deep module — deterministic reset of a worktree to origin/<branch>

  The worktreeReset module is the first step of any takeover after a dead
  orchestrator. It returns a worktree to an exact copy of origin/<branch> by
  aborting any in-progress merge or rebase, resetting tracked state to the
  remote tip, and clearing all untracked files. Unpushed local commits are
  explicitly discarded — the module trades local work for a deterministic
  starting point that every successor orchestrator can rely on.

  This slice delivers the standalone module; integration into
  takeoverHandler's decision tree happens in a later slice.

  Background:
    Given the ADW codebase is checked out

  # ── 1. Module shape and public interface ──────────────────────────────

  @adw-457 @regression
  Scenario: worktreeReset module lives at adws/vcs/worktreeReset.ts
    Given "adws/vcs/worktreeReset.ts" is read
    Then the file exists

  @adw-457 @regression
  Scenario: worktreeReset exports resetWorktreeToRemote with the documented signature
    Given "adws/vcs/worktreeReset.ts" is read
    Then the module exports a function named "resetWorktreeToRemote"
    And the function accepts parameters named "worktreePath" and "branch"

  @adw-457 @regression
  Scenario: Module doc comment explicitly states that unpushed commits are discarded
    Given "adws/vcs/worktreeReset.ts" is read
    Then the module-level doc comment states that unpushed local commits are discarded

  # ── 2. In-progress merge abort ────────────────────────────────────────

  @adw-457 @regression
  Scenario: resetWorktreeToRemote aborts an in-progress merge via git merge --abort
    Given a worktree with an in-progress merge
    When resetWorktreeToRemote is called for that worktree and its branch
    Then "git merge --abort" is run in the worktree before any reset or clean

  @adw-457 @regression
  Scenario: resetWorktreeToRemote falls back to removing .git/MERGE_HEAD when merge --abort fails
    Given a worktree with an in-progress merge
    And "git merge --abort" fails or is unavailable
    When resetWorktreeToRemote is called for that worktree and its branch
    Then the ".git/MERGE_HEAD" file is removed from the worktree

  @adw-457
  Scenario: resetWorktreeToRemote skips merge abort when no merge is in progress
    Given a worktree with no in-progress merge
    When resetWorktreeToRemote is called for that worktree and its branch
    Then "git merge --abort" is not run
    And no attempt is made to remove ".git/MERGE_HEAD"

  # ── 3. In-progress rebase abort ───────────────────────────────────────

  @adw-457 @regression
  Scenario: resetWorktreeToRemote aborts an in-progress rebase via git rebase --abort
    Given a worktree with an in-progress rebase
    When resetWorktreeToRemote is called for that worktree and its branch
    Then "git rebase --abort" is run in the worktree before any reset or clean

  @adw-457 @regression
  Scenario: resetWorktreeToRemote falls back to removing rebase directories when rebase --abort fails
    Given a worktree with an in-progress rebase
    And "git rebase --abort" fails or is unavailable
    When resetWorktreeToRemote is called for that worktree and its branch
    Then the ".git/rebase-apply/" directory is removed from the worktree
    And the ".git/rebase-merge/" directory is removed from the worktree

  @adw-457
  Scenario: resetWorktreeToRemote skips rebase abort when no rebase is in progress
    Given a worktree with no in-progress rebase
    When resetWorktreeToRemote is called for that worktree and its branch
    Then "git rebase --abort" is not run
    And no attempt is made to remove the rebase-apply or rebase-merge directories

  # ── 4. Hard reset to origin/<branch> ──────────────────────────────────

  @adw-457 @regression
  Scenario: resetWorktreeToRemote runs git reset --hard origin/<branch>
    Given a worktree on branch "feature-issue-457-worktree-reset-module"
    When resetWorktreeToRemote is called with that worktree and branch
    Then "git reset --hard origin/feature-issue-457-worktree-reset-module" is run in the worktree

  @adw-457 @regression
  Scenario: Hard reset is performed after any merge or rebase abort
    Given a worktree with an in-progress merge
    When resetWorktreeToRemote is called for that worktree and its branch
    Then the merge abort step runs before "git reset --hard"

  # ── 5. Clean untracked files ──────────────────────────────────────────

  @adw-457 @regression
  Scenario: resetWorktreeToRemote runs git clean -fdx after the hard reset
    Given a worktree on branch "feature-issue-457-worktree-reset-module"
    When resetWorktreeToRemote is called with that worktree and branch
    Then "git clean -fdx" is run in the worktree
    And "git clean -fdx" runs after "git reset --hard"

  # ── 6. Shell-mocked unit test coverage (covers acceptance criteria) ──

  @adw-457 @regression
  Scenario: Unit tests use a shell-mocking harness rather than real git calls
    Given the unit test file for worktreeReset exists
    Then each test replaces the shell executor with an injected mock
    And no test invokes a real git subprocess

  @adw-457 @regression
  Scenario: Unit test — clean worktree — reset is idempotent
    Given a mocked worktree with no in-progress merge or rebase and no dirty files
    When resetWorktreeToRemote is called
    Then the function completes without throwing
    And only "git reset --hard origin/<branch>" and "git clean -fdx" are recorded on the mock
    And calling resetWorktreeToRemote a second time records the same calls with the same effect

  @adw-457 @regression
  Scenario: Unit test — dirty tracked files are discarded by the hard reset
    Given a mocked worktree whose tracked files have uncommitted modifications
    When resetWorktreeToRemote is called
    Then "git reset --hard origin/<branch>" is recorded on the mock
    And the mocked tracked-file state after reset matches origin/<branch>

  @adw-457 @regression
  Scenario: Unit test — in-progress merge is aborted before reset
    Given a mocked worktree whose .git/MERGE_HEAD indicates an in-progress merge
    When resetWorktreeToRemote is called
    Then "git merge --abort" is recorded on the mock before "git reset --hard"
    And the in-progress merge marker is cleared before reset

  @adw-457 @regression
  Scenario: Unit test — in-progress rebase is aborted before reset
    Given a mocked worktree whose .git/rebase-apply/ or .git/rebase-merge/ indicates an in-progress rebase
    When resetWorktreeToRemote is called
    Then "git rebase --abort" is recorded on the mock before "git reset --hard"
    And the in-progress rebase marker is cleared before reset

  @adw-457 @regression
  Scenario: Unit test — untracked files are removed by git clean -fdx
    Given a mocked worktree with untracked files outside tracked state
    When resetWorktreeToRemote is called
    Then "git clean -fdx" is recorded on the mock after "git reset --hard"
    And the mocked untracked-file set is empty after the call completes

  @adw-457
  Scenario: Unit test — merge-abort fallback path is exercised
    Given a mocked worktree with an in-progress merge
    And the mock is configured so "git merge --abort" exits non-zero
    When resetWorktreeToRemote is called
    Then the ".git/MERGE_HEAD" removal is recorded on the mock after the failed abort
    And the function still proceeds to the hard reset and clean

  @adw-457
  Scenario: Unit test — rebase-abort fallback path is exercised
    Given a mocked worktree with an in-progress rebase
    And the mock is configured so "git rebase --abort" exits non-zero
    When resetWorktreeToRemote is called
    Then the removal of ".git/rebase-apply/" and ".git/rebase-merge/" is recorded on the mock
    And the function still proceeds to the hard reset and clean

  # ── 7. TypeScript integrity ───────────────────────────────────────────

  @adw-457 @regression
  Scenario: ADW TypeScript type-check passes with the new worktreeReset module
    Given the ADW codebase is checked out
    When "bunx tsc --noEmit" and "bunx tsc --noEmit -p adws/tsconfig.json" are run
    Then both type-check commands exit with code 0
