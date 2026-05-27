@adw-529 @adw-9s65vu-adwmerge-findorchest
Feature: orchestrator-state resolution — adwMerge follows the owning orchestrator, not the first -orchestrator dir

  Issue #529 closes a shadowing bug in `findOrchestratorStatePath`
  (`adws/core/stateHelpers.ts`). The function scans `agents/{adwId}/*/` and
  returns the **first** subdirectory whose `state.json` `agentName` ends in
  `-orchestrator`, in `readdirSync` order. When an `adwId` is reused across a
  failed `init-orchestrator` attempt and the real `sdlc-orchestrator` run
  (adwId reuse on retry — commit e19eae3), the scan can return the **failed
  `init-orchestrator`** directory instead of `sdlc-orchestrator`, because
  `init-` sorts ahead of `sdlc-`.

  `adwMerge.tsx` then reads `branchName` from that wrong directory, finds none
  (the failed init attempt never recorded one), hits the `no_branch_name`
  guard, and writes terminal `abandoned`. Because `abandoned` ≠ `merge_blocked`,
  the `## Retry` re-entry command (#527 / #528) cannot recover it — the issue is
  stranded with an open, mergeable PR sitting untouched.

  The triggering incident was paysdoc/AI_Dev_Workflow#508 / PR #526
  (2026-05-26): `agents/kswfvk-llm-drafted-observab/` held both an
  `init-orchestrator` record (status `failed`, no `branchName`) and the real
  `sdlc-orchestrator` record (branch
  `feature-issue-508-llm-draft-observability-examples`, PR #526).
  `findOrchestratorStatePath` returned the init directory; #508 sat `abandoned`
  while #526 stayed open and conflicting. Manually writing the correct branch
  name into the resolved file and resetting to `awaiting_merge` let `adwMerge`
  find #526 and merge it.

  The fix makes resolution follow the orchestrator that actually owns the run:

    1. `findOrchestratorStatePath` prefers the orchestrator directory whose
       `agentName` maps to the `orchestratorScript` recorded in the top-level
       state file (`agents/{adwId}/state.json`). For an SDLC run that script is
       `adws/adwSdlc.tsx` (`deriveOrchestratorScript('sdlc-orchestrator')`), so
       the `sdlc-orchestrator` directory wins over a shadowing
       `init-orchestrator` directory regardless of `readdirSync` order.
    2. Resolution falls back to the current first-`-orchestrator`-match
       behaviour only when the top-level state records no `orchestratorScript`
       or no directory matches it — so legacy state files and
       single-orchestrator runs are unchanged.

  Observability / rot-prevention note:

    Every assertion below targets artefacts the system produces — the
    top-level state file written by `adwMerge` (`workflowStage`, read the same
    way vocabulary entry T1 reads it), the PR-merge call captured by the mock
    GitHub API (the recorded-request channel behind T23), and the orchestrator
    subprocess exit code (T5). The per-orchestrator `state.json` records seeded
    by the Given steps (`agents/{adwId}/{orchestrator}/state.json`) are state
    *artefacts*, not source files — see `features/regression/vocabulary.md`
    Rot-Detection Rubric. No assertion reads the contents of
    `adws/core/stateHelpers.ts`, `adws/adwMerge.tsx`,
    `adws/core/orchestratorLib.ts`, or any other framework source file, and no
    assertion inspects the resolved directory path as a string. The fix is
    proven *behaviourally* — a shadowed SDLC run merges its PR and reaches
    `completed` instead of stranding in `abandoned`.

  The deterministic acceptance check the issue calls for ("add a unit test with
  two competing orchestrator dirs") is a unit test that belongs at
  `adws/core/__tests__/stateHelpers.test.ts`, driving `findOrchestratorStatePath`
  directly against an `agents/{adwId}/` fixture that contains both a failed
  `init-orchestrator` directory and an `sdlc-orchestrator` directory and
  asserting it resolves to the `sdlc-orchestrator` one. That test file is the
  canonical home for the resolution-preference contract; the scenarios here
  cover the observable end-to-end consequence through `adwMerge`.

  Scope notes:

    • The stranded-`abandoned` recovery story — `merge_blocked` and the
      `## Retry` command — is owned by #527 / #528 and covered by
      `feature-527.feature`; this file treats those stages as fixed and asserts
      only that the correct branch is resolved so the dead-end is never reached.
    • The separate root cause where `adwMerge` reads `branchName` from
      orchestrator state at all (while #524 persists it to top-level state) is
      tracked independently and covered by `feature-524.feature`; this file
      treats the per-orchestrator `branchName` as the input under test.
    • The `init-orchestrator` record is arranged to be the directory an
      unguarded `readdirSync` scan would return first (reproducing the #508
      ordering), so each §1 scenario genuinely fails under the old first-match
      logic and passes only once resolution follows the owning orchestrator.

  Background:
    Given the ADW codebase is checked out

  # ── §1 Owning-orchestrator preference (the #508 regression) ────────────────

  @adw-529 @adw-9s65vu-adwmerge-findorchest
  Scenario: adwMerge merges via the sdlc-orchestrator branch even though a failed init-orchestrator record shadows it (the #508 regression)
    Given an issue 9595 exists in the mock issue tracker
    And the mock GitHub API is configured to accept issue comments
    And the worktree for adwId "shadow-529-1" is initialised at branch "feature-issue-9595-observ"
    And the top-level state for adwId "shadow-529-1" records stage "awaiting_merge" owned by the "sdlc-orchestrator"
    And adwId "shadow-529-1" also has a failed init-orchestrator record with no branch name
    And adwId "shadow-529-1" also has an sdlc-orchestrator record for branch "feature-issue-9595-observ"
    And the branch "feature-issue-9595-observ" carries a single open PR 9596
    When the "merge" orchestrator is invoked with adwId "shadow-529-1" and issue 9595
    Then the mock GitHub API recorded a PR-merge call for PR 9596
    And the state file for adwId "shadow-529-1" records workflowStage "completed"
    And the orchestrator subprocess exited 0

  @adw-529 @adw-9s65vu-adwmerge-findorchest
  Scenario: The sdlc-orchestrator branch is resolved even when the shadowing init-orchestrator record carries a stale branch name
    Given an issue 9597 exists in the mock issue tracker
    And the mock GitHub API is configured to accept issue comments
    And the worktree for adwId "shadow-529-2" is initialised at branch "feature-issue-9597-observ"
    And the top-level state for adwId "shadow-529-2" records stage "awaiting_merge" owned by the "sdlc-orchestrator"
    And adwId "shadow-529-2" also has a failed init-orchestrator record for the stale branch "adwinit-issue-9597-block"
    And adwId "shadow-529-2" also has an sdlc-orchestrator record for branch "feature-issue-9597-observ"
    And the branch "adwinit-issue-9597-block" has no pull request
    And the branch "feature-issue-9597-observ" carries a single open PR 9598
    When the "merge" orchestrator is invoked with adwId "shadow-529-2" and issue 9597
    Then the mock GitHub API recorded a PR-merge call for PR 9598
    And the state file for adwId "shadow-529-2" records workflowStage "completed"

  # ── §2 Fallback preserved (no owning orchestrator recorded) ────────────────

  @adw-529 @adw-9s65vu-adwmerge-findorchest
  Scenario: With no owning orchestrator recorded, resolution falls back to the sole orchestrator record and merges
    Given an issue 9599 exists in the mock issue tracker
    And the mock GitHub API is configured to accept issue comments
    And the worktree for adwId "shadow-529-3" is initialised at branch "feature-issue-9599-observ"
    And the top-level state for adwId "shadow-529-3" records stage "awaiting_merge" with no owning orchestrator recorded
    And adwId "shadow-529-3" also has an sdlc-orchestrator record for branch "feature-issue-9599-observ"
    And the branch "feature-issue-9599-observ" carries a single open PR 9600
    When the "merge" orchestrator is invoked with adwId "shadow-529-3" and issue 9599
    Then the mock GitHub API recorded a PR-merge call for PR 9600
    And the state file for adwId "shadow-529-3" records workflowStage "completed"

  # ── §3 Type-check ──────────────────────────────────────────────────────────

  @adw-529 @adw-9s65vu-adwmerge-findorchest
  Scenario: TypeScript type-check passes after the orchestrator-path-shadowing fix
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
