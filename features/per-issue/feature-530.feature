@adw-530 @adw-bbwalf-adwmerge-reads-branc
Feature: adwMerge resolves branchName from top-level state — the #524 persistence reaches the merge path

  Issue #530 closes the gap between where the branch name is *written* and
  where adwMerge *reads* it. Issue #524 (PR #525) made the branch name a
  durable, once-per-adwId decision and persists it to the top-level workflow
  state (`agents/{adwId}/state.json`, field `branchName`) via
  `AgentStateManager.writeTopLevelState`. But `adws/adwMerge.tsx` resolves the
  branch name only from the orchestrator-specific state found by
  `findOrchestratorStatePath(adwId)`
  (`agents/{adwId}/{orchestrator}/state.json`), with no fallback to the
  top-level state. The #524 fix therefore never reaches the merge path.

  At the read site the missing branch name trips one of two guards — the
  orchestrator state is absent (`no_orchestrator_state`) or present but carries
  no branchName (`no_branch_name`) — and adwMerge writes the terminal stage
  `abandoned`. Because `abandoned` is not `merge_blocked`, the `## Retry`
  recovery path added by #527 cannot rescue it. This was observed on issue
  #508 / PR #526 (2026-05-26): the SDLC run started after #524 had merged, yet
  no branchName was present at the read site, the workflow went to `abandoned`,
  and PR #526 was left open and conflicting. Recovery was manual.

  The fix makes the read and write sites agree: adwMerge resolves the branch
  name from the top-level state first (where #524 persists it) and falls back
  to the orchestrator state for workflows that pre-date #524 or only recorded
  it there. The abandon guard fires only when *neither* state carries a branch
  name.

  Observability / rot-prevention note:

    Every assertion below targets artefacts the system produces — the
    top-level state written by adwMerge (`workflowStage`, read the same way
    vocabulary entry T1 reads it) and the PR-merge calls captured by the mock
    GitHub API (the recorded-request channel behind T7 / T23 / T24). The branch
    name's storage location is exercised purely as an input artefact (which
    state holds it), never by parsing orchestrator source. No assertion reads
    the contents of `adws/adwMerge.tsx`, `adws/core/stateHelpers.ts`, or
    `adws/core/agentState.ts`.

  Scope notes:

    • The branch-name *persistence* contract (writing it to top-level state at
      branch creation) is owned by #524 and covered by `feature-524.feature`;
      this file treats the persisted value as a fixed input and asserts only
      that the merge path *reads* it.
    • The `findOrchestratorStatePath` shadowing bug (a separate compounding
      cause on #508) is out of scope; these scenarios pin the read-site
      contract independently of which orchestrator directory the helper picks.
    • The `merge_blocked` / `## Retry` recovery path is owned by #527 and
      covered by `feature-527.feature`; this file asserts that a resolvable
      branch name keeps the workflow off the terminal `abandoned` stage in the
      first place, so recovery is never needed.

  Background:
    Given the ADW codebase is checked out

  # ── §1 The fix — a top-level-persisted branchName reaches the merge path ───

  @adw-530 @adw-bbwalf-adwmerge-reads-branc
  Scenario: Merge resolves the top-level branchName and merges when no orchestrator state exists
    Given an issue 9600 exists in the mock issue tracker
    And the mock GitHub API records all PR-list calls
    And the mock GitHub API is configured to accept issue comments
    And the worktree for adwId "merge-toplevel-530-1" is initialised at branch "feature-issue-9600-observ"
    And a state file exists for adwId "merge-toplevel-530-1" at stage "awaiting_merge"
    And the branchName "feature-issue-9600-observ" is recorded in the top-level state for adwId "merge-toplevel-530-1"
    And no orchestrator state exists for adwId "merge-toplevel-530-1"
    And the branch "feature-issue-9600-observ" carries a single open PR 9610
    When the merge handoff is executed for adwId "merge-toplevel-530-1" and issue 9600
    Then the mock GitHub API recorded a PR-merge call for PR 9610
    And the state file for adwId "merge-toplevel-530-1" records workflowStage "completed"

  @adw-530 @adw-bbwalf-adwmerge-reads-branc
  Scenario: Merge resolves the top-level branchName and merges when the orchestrator state carries no branchName
    Given an issue 9601 exists in the mock issue tracker
    And the mock GitHub API records all PR-list calls
    And the mock GitHub API is configured to accept issue comments
    And the worktree for adwId "merge-toplevel-530-2" is initialised at branch "feature-issue-9601-observ"
    And a state file exists for adwId "merge-toplevel-530-2" at stage "awaiting_merge"
    And the branchName "feature-issue-9601-observ" is recorded in the top-level state for adwId "merge-toplevel-530-2"
    And the orchestrator state for adwId "merge-toplevel-530-2" records no branchName
    And the branch "feature-issue-9601-observ" carries a single open PR 9611
    When the merge handoff is executed for adwId "merge-toplevel-530-2" and issue 9601
    Then the mock GitHub API recorded a PR-merge call for PR 9611
    And the state file for adwId "merge-toplevel-530-2" records workflowStage "completed"

  # ── §2 Fallback — an orchestrator-only branchName still resolves (legacy) ──

  @adw-530 @adw-bbwalf-adwmerge-reads-branc
  Scenario: Merge falls back to the orchestrator-state branchName when the top-level state records none
    Given an issue 9602 exists in the mock issue tracker
    And the mock GitHub API records all PR-list calls
    And the mock GitHub API is configured to accept issue comments
    And the worktree for adwId "merge-fallback-530-3" is initialised at branch "feature-issue-9602-observ"
    And a state file exists for adwId "merge-fallback-530-3" at stage "awaiting_merge"
    And the top-level state for adwId "merge-fallback-530-3" records no branchName
    And the branchName "feature-issue-9602-observ" is recorded in the orchestrator state for adwId "merge-fallback-530-3"
    And the branch "feature-issue-9602-observ" carries a single open PR 9612
    When the merge handoff is executed for adwId "merge-fallback-530-3" and issue 9602
    Then the mock GitHub API recorded a PR-merge call for PR 9612
    And the state file for adwId "merge-fallback-530-3" records workflowStage "completed"

  # ── §3 Precedence — the top-level branchName wins when the two disagree ────

  @adw-530 @adw-bbwalf-adwmerge-reads-branc
  Scenario: Merge resolves against the top-level branchName when it differs from the orchestrator-state branchName
    Given an issue 9603 exists in the mock issue tracker
    And the mock GitHub API records all PR-list calls
    And the mock GitHub API is configured to accept issue comments
    And the worktree for adwId "merge-precedence-530-4" is initialised at branch "feature-issue-9603-toplevel"
    And a state file exists for adwId "merge-precedence-530-4" at stage "awaiting_merge"
    And the branchName "feature-issue-9603-toplevel" is recorded in the top-level state for adwId "merge-precedence-530-4"
    And the branchName "feature-issue-9603-orchestrator" is recorded in the orchestrator state for adwId "merge-precedence-530-4"
    And the branch "feature-issue-9603-toplevel" carries a single open PR 9613
    And the branch "feature-issue-9603-orchestrator" carries a single open PR 9614
    When the merge handoff is executed for adwId "merge-precedence-530-4" and issue 9603
    Then the mock GitHub API recorded a PR-merge call for PR 9613
    And the mock harness recorded no PR-merge call for PR 9614
    And the state file for adwId "merge-precedence-530-4" records workflowStage "completed"

  # ── §4 Guard preserved — abandon only when neither state has a branchName ──

  @adw-530 @adw-bbwalf-adwmerge-reads-branc
  Scenario: Merge abandons without merging only when neither state records a branchName
    Given an issue 9604 exists in the mock issue tracker
    And the mock GitHub API records all PR-list calls
    And the worktree for adwId "merge-noname-530-5" is initialised at branch "feature-issue-9604-observ"
    And a state file exists for adwId "merge-noname-530-5" at stage "awaiting_merge"
    And the top-level state for adwId "merge-noname-530-5" records no branchName
    And the orchestrator state for adwId "merge-noname-530-5" records no branchName
    And the branch "feature-issue-9604-observ" carries a single open PR 9615
    When the merge handoff is executed for adwId "merge-noname-530-5" and issue 9604
    Then the state file for adwId "merge-noname-530-5" records workflowStage "abandoned"
    And the mock harness recorded zero PR-merge calls

  # ── §5 Type-check ──────────────────────────────────────────────────────────

  @adw-530 @adw-bbwalf-adwmerge-reads-branc
  Scenario: TypeScript type-check passes after the adwMerge branchName-read change
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
