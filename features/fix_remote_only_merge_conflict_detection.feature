@adw-490
Feature: Auto-merge conflict detection covers remote-only conflicts and unmatched gh error strings

  Issue #490: `mergeWithConflictResolution` in `adws/triggers/autoMergeHandler.ts`
  used to give up after a single attempt — without ever invoking the
  `/resolve_conflict` agent — whenever the conflict only manifested on
  GitHub's view of the merge. Two defects combined to produce that failure
  on `vestmatic#52` / PR #63 after #489 landed:

    Bug A — `isMergeConflictError` keyword set was too narrow.
            GitHub's actual `gh pr merge` failure for a conflicted PR is
            "Pull request <repo>#<n> is not mergeable: the merge commit
            cannot be cleanly created." None of the original keywords
            (`merge conflict`, `dirty`, `behind`) match it, so the retry
            loop hit `break` and exited after one attempt.

    Bug B — `checkMergeConflicts` ran the local merge dry-run against a
            stale worktree. Because the worktree's view of the base
            branch was not refreshed (no `git fetch origin <base>`), a
            local dry-run could succeed cleanly while GitHub correctly
            reported a conflict. With `hasConflicts === false` the
            `/resolve_conflict` agent was skipped, the push succeeded as
            a no-op, `gh pr merge` failed with the unmatched "not
            mergeable" string, Bug A kicked in, and the workflow wrote
            terminal `discarded`.

  The fix: `isMergeConflictError` must match GitHub's `not mergeable` /
  `cannot be cleanly created` phrasing, and `checkMergeConflicts` must
  refresh `origin/<baseBranch>` before the local dry-run so a remote-only
  conflict is detected and `/resolve_conflict` is invoked. `discarded` may
  only be written after `/resolve_conflict` has actually been attempted.

  Background:
    Given the ADW codebase is checked out

  # ─────────────────────────────────────────────────────────────────────────
  # Bug A — isMergeConflictError matches GitHub's actual error strings
  # ─────────────────────────────────────────────────────────────────────────

  @adw-490 @regression
  Scenario: isMergeConflictError matches the "not mergeable" phrasing from gh pr merge
    Given "adws/triggers/autoMergeHandler.ts" is read
    Then the file contains "isMergeConflictError"
    And the file contains "not mergeable"

  @adw-490 @regression
  Scenario: isMergeConflictError matches the bare "conflict" substring
    Given "adws/triggers/autoMergeHandler.ts" is read
    Then the file contains "isMergeConflictError"
    And the file contains "'conflict'"

  @adw-490 @regression
  Scenario: isMergeConflictError still recognises the legacy "merge conflict" / "dirty" / "behind" strings
    Given "adws/triggers/autoMergeHandler.ts" is read
    Then the file contains "'merge conflict'"
    And the file contains "'dirty'"
    And the file contains "'behind'"

  @adw-490 @regression
  Scenario: mergeWithConflictResolution does not break out of the retry loop on a "not mergeable" gh error
    Given "adws/triggers/autoMergeHandler.ts" is read
    Then the file contains "isMergeConflictError(lastMergeError)"
    And the non-conflict break is only reached when isMergeConflictError returns false

  # ─────────────────────────────────────────────────────────────────────────
  # Bug B — checkMergeConflicts refreshes origin/<baseBranch> before dry-run
  # ─────────────────────────────────────────────────────────────────────────

  @adw-490 @regression
  Scenario: checkMergeConflicts fetches origin/<baseBranch> before the local merge dry-run
    Given "adws/triggers/autoMergeHandler.ts" is read
    Then the file contains "function checkMergeConflicts"
    And checkMergeConflicts calls "git fetch origin" before "git merge --no-commit --no-ff"

  @adw-490 @regression
  Scenario: checkMergeConflicts dry-run targets the freshly fetched origin/<baseBranch>, not the local worktree branch
    Given "adws/triggers/autoMergeHandler.ts" is read
    Then the file contains "git merge --no-commit --no-ff"
    And the dry-run merge ref is "origin/" prefixed rather than the bare baseBranch

  @adw-490 @regression
  Scenario: checkMergeConflicts aborts the dry-run merge whether it succeeded or failed
    Given "adws/triggers/autoMergeHandler.ts" is read
    Then the file contains "git merge --abort"
    And both the success and failure branches of the dry-run abort the merge before returning

  @adw-490
  Scenario: checkMergeConflicts logs and returns false (skip resolution) when the fetch itself fails
    Given "adws/triggers/autoMergeHandler.ts" is read
    Then the file contains "Failed to fetch origin/"
    And the failed-fetch path returns false from checkMergeConflicts

  # ─────────────────────────────────────────────────────────────────────────
  # Behaviour — stale-local-worktree-but-remote-conflicting PR is recovered
  # ─────────────────────────────────────────────────────────────────────────

  @adw-490 @regression
  Scenario: mergeWithConflictResolution invokes resolveConflictsViaAgent when the remote base has diverged from the local worktree
    Given an awaiting_merge PR whose local worktree is behind origin/<baseBranch>
    And the remote base contains commits that conflict with the head branch
    When mergeWithConflictResolution is invoked for the PR
    Then checkMergeConflicts fetches origin/<baseBranch> before the dry-run
    And checkMergeConflicts reports conflicts because the dry-run runs against the freshly fetched origin
    And resolveConflictsViaAgent is invoked at least once for the PR

  @adw-490 @regression
  Scenario: A successful agent resolution recovers the merge instead of writing discarded
    Given an awaiting_merge PR whose local worktree is behind origin/<baseBranch>
    And resolveConflictsViaAgent succeeds and produces a clean merge commit
    When mergeWithConflictResolution is invoked for the PR
    Then pushBranchChanges is called with the head branch after resolution
    And mergePR is called for the PR
    And mergeWithConflictResolution returns success=true
    And the workflow does not write workflowStage "discarded"

  @adw-490 @regression
  Scenario: discarded is only written after /resolve_conflict was actually attempted
    Given an awaiting_merge PR whose local worktree is behind origin/<baseBranch>
    And resolveConflictsViaAgent fails on every attempt
    When mergeWithConflictResolution is invoked for the PR
    Then resolveConflictsViaAgent is invoked at least once before the loop exits
    And mergeWithConflictResolution returns success=false with the last error
    And adwMerge writes workflowStage "discarded" only after the agent has been attempted

  @adw-490 @regression
  Scenario: A conflicted gh pr merge result re-enters the retry loop instead of breaking immediately
    Given mergePR returns "Pull request acme/widgets#7 is not mergeable: the merge commit cannot be cleanly created."
    When mergeWithConflictResolution evaluates the failure
    Then isMergeConflictError returns true for that error
    And the retry loop continues to the next attempt up to MAX_AUTO_MERGE_ATTEMPTS

  # ─────────────────────────────────────────────────────────────────────────
  # Unit tests — autoMergeHandler.ts gets dedicated coverage
  # ─────────────────────────────────────────────────────────────────────────

  @adw-490 @regression
  Scenario: autoMergeHandler unit test file exists alongside the other trigger tests
    Then the file "adws/triggers/__tests__/autoMergeHandler.test.ts" exists

  @adw-490 @regression
  Scenario: Unit test covers isMergeConflictError for the GitHub "not mergeable" string
    Given "adws/triggers/__tests__/autoMergeHandler.test.ts" is read
    Then the file contains "isMergeConflictError"
    And the file contains "not mergeable"
    And the file contains "cannot be cleanly created"

  @adw-490 @regression
  Scenario: Unit test covers isMergeConflictError for the legacy keyword set
    Given "adws/triggers/__tests__/autoMergeHandler.test.ts" is read
    Then the file contains "merge conflict"
    And the file contains "dirty"
    And the file contains "behind"

  @adw-490 @regression
  Scenario: Unit test verifies mergeWithConflictResolution invokes resolveConflictsViaAgent on remote-only conflict
    Given "adws/triggers/__tests__/autoMergeHandler.test.ts" is read
    Then the file contains "mergeWithConflictResolution"
    And the file contains "resolveConflictsViaAgent" or "/resolve_conflict"
    And the test exercises a remote-base-diverged-from-local-worktree scenario

  @adw-490 @regression
  Scenario: Unit test verifies a "not mergeable" gh failure does not short-circuit the retry loop
    Given "adws/triggers/__tests__/autoMergeHandler.test.ts" is read
    Then the file contains "not mergeable"
    And the test asserts the loop does not break after the first attempt for that error

  # ─────────────────────────────────────────────────────────────────────────
  # TypeScript type-check
  # ─────────────────────────────────────────────────────────────────────────

  @adw-490 @regression
  Scenario: ADW TypeScript type-check passes after the conflict-detection fix
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
