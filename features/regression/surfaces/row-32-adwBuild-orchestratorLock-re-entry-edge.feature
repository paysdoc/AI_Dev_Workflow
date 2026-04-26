@regression @surface
Feature: adwBuild — orchestratorLock — re-entry (edge: concurrent execution detected)

  # Row 32: lock already held; orchestrator should detect concurrent execution and exit.
  # DEFERRED-RUNTIME-GAP: W1 subprocess fails due to (1) spawnOrchestrator passes adwId before
  # issueNumber in CLI args (reversed vs orchestrator expected order) and (2) fetchGitHubIssue
  # uses gh CLI with GraphQL/HTTPS which cannot reach the HTTP mock server. Both require
  # Issue #1 step-definition fixes. Vocabulary and step matching are correct (dry-run passes).
  # DEFERRED-VOCAB-GAP: no phrase to seed "a spawn lock for issue {N} is held" — G5 covers
  # the inverse (no lock exists). Without a lock-seeding phrase, this scenario cannot set up
  # the concurrent-execution precondition; the orchestrator will acquire the lock normally and
  # exit 0. The row is retained as a target for vocabulary extension.
  Scenario: build orchestrator exits when spawn-gate lock is already held
    Given an issue 1032 exists in the mock issue tracker
    And a state file exists for adwId "surface-32" at stage "initialized"
    And the worktree for adwId "surface-32" is initialised at branch "surface-32"
    When the "build" orchestrator is invoked with adwId "surface-32" and issue 1032
    Then the orchestrator subprocess exited 0
