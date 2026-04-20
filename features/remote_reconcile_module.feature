@adw-458
Feature: remoteReconcile derives WorkflowStage from remote artifacts with re-verification

  The remoteReconcile deep module derives the current workflow stage from
  remote artifacts (branch existence, PR state, merged/closed flags,
  commits ahead) so that takeover can trust the remote as authoritative over
  a possibly stale state file. A mandatory re-verification read fires
  immediately before returning, to guard against read-your-write lag on the
  GitHub API. On divergence between the two reads, the module retries up to
  a small bounded limit; if divergence persists, it falls back to the
  state-file value. All GitHub reads are injected as dependencies so unit
  tests can drive every branch with fakes.

  This slice is standalone; integration into takeoverHandler lives in a
  later slice.

  Background:
    Given the ADW codebase is checked out

  # ===================================================================
  # 1. Module surface
  # ===================================================================

  @adw-458 @regression
  Scenario: remoteReconcile module exists at adws/core/remoteReconcile.ts
    Given the file "adws/core/remoteReconcile.ts" exists
    Then the file exports a function named "deriveStageFromRemote"

  @adw-458 @regression
  Scenario: deriveStageFromRemote accepts issueNumber, adwId, and repoInfo
    Given "adws/core/remoteReconcile.ts" is read
    Then the "deriveStageFromRemote" function signature accepts an issue number, an adwId, and a repoInfo object
    And the function returns a value typed as "WorkflowStage"

  @adw-458 @regression
  Scenario: All GitHub reads are supplied via injected dependencies
    Given "adws/core/remoteReconcile.ts" is read
    Then "deriveStageFromRemote" receives its GitHub read functions as injected dependencies
    And the module does not call gh CLI or github API helpers at import time
    And the injected dependencies can be replaced with fakes in unit tests

  # ===================================================================
  # 2. Stage mapping — four remote-state cases
  # ===================================================================

  @adw-458 @regression
  Scenario: Branch exists with no PR resolves to a pre-PR running stage
    Given injected GitHub reads report that the feature branch exists
    And injected GitHub reads report that no PR is open for that branch
    When deriveStageFromRemote is called for the issue
    Then the re-verification read agrees with the first read
    And the derived stage is a pre-PR running stage

  @adw-458 @regression
  Scenario: Branch exists with an open PR resolves to awaiting_merge
    Given injected GitHub reads report that the feature branch exists
    And injected GitHub reads report that a PR for that branch is open and not merged
    When deriveStageFromRemote is called for the issue
    Then the re-verification read agrees with the first read
    And the derived stage is "awaiting_merge"

  @adw-458 @regression
  Scenario: Branch with a merged PR resolves to completed
    Given injected GitHub reads report that the feature branch exists
    And injected GitHub reads report that the PR for that branch is merged
    When deriveStageFromRemote is called for the issue
    Then the re-verification read agrees with the first read
    And the derived stage is "completed"

  @adw-458 @regression
  Scenario: Branch with a closed-unmerged PR resolves to discarded
    Given injected GitHub reads report that the feature branch exists
    And injected GitHub reads report that the PR for that branch is closed and not merged
    When deriveStageFromRemote is called for the issue
    Then the re-verification read agrees with the first read
    And the derived stage is "discarded"

  # ===================================================================
  # 3. Re-verification read before return
  # ===================================================================

  @adw-458 @regression
  Scenario: A re-verification read fires immediately before returning
    Given injected GitHub reads report a stable remote state
    When deriveStageFromRemote is called for the issue
    Then the injected GitHub reads are invoked at least twice
    And the final invocation occurs immediately before the derived stage is returned

  @adw-458 @regression
  Scenario: First read and re-verification agree on the first try
    Given injected GitHub reads return the same remote snapshot on both reads
    When deriveStageFromRemote is called for the issue
    Then the module does not perform any further retry reads
    And the derived stage is returned from the agreed snapshot

  # ===================================================================
  # 4. Re-verification divergence and bounded retry
  # ===================================================================

  @adw-458 @regression
  Scenario: Divergence between first read and re-verification triggers a retry
    Given the first injected GitHub read returns a snapshot mapping to "awaiting_merge"
    And the re-verification read returns a snapshot mapping to "completed"
    When deriveStageFromRemote is called for the issue
    Then the module performs at least one additional retry read
    And the retry count does not exceed the bounded retry limit defined in the module

  @adw-458 @regression
  Scenario: Retry converges and the converged stage is returned
    Given the first read disagrees with the re-verification read
    And a subsequent retry produces two successive reads that agree on "completed"
    When deriveStageFromRemote is called for the issue
    Then the module stops retrying as soon as two successive reads agree
    And the derived stage is "completed"

  @adw-458 @regression
  Scenario: Retry count is bounded by a small limit
    Given injected GitHub reads return divergent snapshots on every attempt
    When deriveStageFromRemote is called for the issue
    Then the total number of retry attempts is capped at a small bounded limit
    And the module does not retry indefinitely

  # ===================================================================
  # 5. Post-retry persistent divergence falls back to state-file value
  # ===================================================================

  @adw-458 @regression
  Scenario: Persistent divergence after the retry limit falls back to the state-file value
    Given injected GitHub reads keep returning divergent snapshots on every attempt
    And the state file for the adwId records workflowStage "build_running"
    When deriveStageFromRemote is called for the issue
    Then after exhausting the retry limit the derived stage equals the state-file workflowStage
    And the derived stage is "build_running"

  @adw-458
  Scenario: Fallback reads workflowStage from the top-level state file via AgentStateManager
    Given "adws/core/remoteReconcile.ts" is read
    Then the fallback branch reads the workflowStage from the top-level state file through AgentStateManager
    And the fallback does not infer the stage from issue comments

  # ===================================================================
  # 6. Edge case — branch does not exist on remote
  # ===================================================================

  @adw-458
  Scenario: Missing remote branch falls back to the state-file value
    Given injected GitHub reads report that the feature branch does not exist
    And the state file for the adwId records workflowStage "starting"
    When deriveStageFromRemote is called for the issue
    Then the derived stage equals the state-file workflowStage
    And the derived stage is "starting"

  # ===================================================================
  # 7. Unit test coverage — every mapping branch and retry path
  # ===================================================================

  @adw-458 @regression
  Scenario: Unit tests exist for remoteReconcile in adws/core/__tests__
    Given the test file "adws/core/__tests__/remoteReconcile.test.ts" exists
    Then the tests import "deriveStageFromRemote" from "adws/core/remoteReconcile"
    And the tests construct injected fakes for the GitHub read dependencies

  @adw-458 @regression
  Scenario Outline: Unit test covers the "<case>" mapping branch
    Given "adws/core/__tests__/remoteReconcile.test.ts" is read
    Then a test case covers "<case>" mapping to "<expected_stage>"

    Examples:
      | case                           | expected_stage        |
      | branch-only, no PR             | pre-PR running stage  |
      | branch + open PR               | awaiting_merge        |
      | branch + merged PR             | completed             |
      | branch + closed-unmerged PR    | discarded             |

  @adw-458 @regression
  Scenario: Unit tests cover re-verification divergence that converges on retry
    Given "adws/core/__tests__/remoteReconcile.test.ts" is read
    Then a test case covers first-read/re-verification divergence that converges within the retry limit
    And the test asserts the derived stage equals the converged snapshot

  @adw-458 @regression
  Scenario: Unit tests cover persistent divergence falling back to state-file
    Given "adws/core/__tests__/remoteReconcile.test.ts" is read
    Then a test case covers persistent divergence across all retries
    And the test asserts the derived stage equals the state-file workflowStage

  @adw-458
  Scenario: Unit tests use fakes for all GitHub reads and do not hit the network
    Given "adws/core/__tests__/remoteReconcile.test.ts" is read
    Then no test invokes the real gh CLI or issues real HTTP requests to github.com
    And all GitHub reads in the tests are supplied by injected fakes

  # ===================================================================
  # 8. Purity — no side effects on state or worktree
  # ===================================================================

  @adw-458
  Scenario: deriveStageFromRemote does not write the top-level state file
    Given "adws/core/remoteReconcile.ts" is read
    Then "deriveStageFromRemote" does not call AgentStateManager.writeTopLevelState
    And "deriveStageFromRemote" does not mutate the worktree

  # ===================================================================
  # 9. TypeScript compilation
  # ===================================================================

  @adw-458 @regression
  Scenario: ADW TypeScript type-check passes after adding remoteReconcile
    Given the ADW codebase with remoteReconcile.ts added
    When "bunx tsc --noEmit -p adws/tsconfig.json" is run
    Then the command exits with code 0
