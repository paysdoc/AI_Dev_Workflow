@adw-527 @adw-22y8n3-adwmerge-dead-ends-i
Feature: merge_blocked recovery path — adwMerge no longer dead-ends at the merge step

  Issue #527 closes two production dead-ends in the merge handoff
  (`adws/adwMerge.tsx`), both of which silently killed issues that had
  reached `awaiting_merge`:

    • `no_pr_found` wrote terminal `abandoned` on the *first* miss. PR
      resolution (`defaultFindPRByBranch`) queried `gh pr list --state all
      ... --limit 5` and blindly returned `prs[0]`, so a branch carrying a
      closed PR plus an open PR could resolve to the wrong (closed) PR.
      Observed on paysdoc/AI_Dev_Workflow#508: branch had PR #523 (closed)
      and #526 (open); `--state all`/`prs[0]` returned the wrong one.
    • `merge_failed` (conflict resolution exhausted after
      `MAX_AUTO_MERGE_ATTEMPTS`) wrote terminal `discarded` (#460). Because
      `discarded` is non-retriable, ADW was permanently out of the loop and
      the only recourse was a manual merge that lost ADW's bookkeeping.

  The fix introduces a recoverable escalation stage and a human re-entry
  command:

    1. PR resolution returns the single **open** PR for the branch (most
       recent when more than one is open), never a closed/merged PR when an
       open one exists.
    2. `no_pr_found` is bounded: the workflow stays in `awaiting_merge` and
       a retry counter is incremented in top-level state. Only after **3**
       misses does it escalate.
    3. A new `merge_blocked` stage is the escalation target for both an
       exhausted `no_pr_found` and `merge_failed`. It posts an explanatory
       comment naming the cause and the `## Retry` remedy. It is NOT
       retriable and is ineligible for a cron spawn.
    4. A `## Retry` comment command (mirroring `## Cancel`) resets
       `merge_blocked` → `awaiting_merge` and clears the retry counter;
       recovery then rides the existing `awaiting_merge` cron hoist.
    5. `merge_failed` is consciously re-routed from `discarded` to
       `merge_blocked` (a deliberate revision of #460). The anti-loop intent
       of #460 is preserved: `merge_blocked` recovers only via an explicit
       human `## Retry`, never automatically. `pr_closed` still writes
       `discarded` (deliberate operator intent, unchanged).

  Observability / rot-prevention note:

    Every assertion below targets artefacts the system produces — the
    top-level state file written by adwMerge (`workflowStage` and the merge
    retry counter, both read the same way vocabulary entry T1 reads
    `workflowStage`), the comment / merge calls captured by the mock GitHub
    API, and whether the cron sweep dispatches an orchestrator. No assertion
    reads the contents of `adws/adwMerge.tsx`, `adws/github/prApi.ts`,
    `adws/triggers/cronIssueFilter.ts`, `adws/triggers/cronStageResolver.ts`,
    or `adws/types/workflowTypes.ts`.

    In particular, the acceptance criterion "`merge_blocked` is in the
    `WorkflowStage` union" is proven *behaviourally* — the orchestrator
    writes `merge_blocked` to the state-file artefact (§2, §3) and the cron
    treats it as terminal-until-human (§4) — rather than by parsing the
    union out of `workflowTypes.ts`, which would be the source-reading rot
    pattern this suite is designed to avoid.

  Scope notes:

    • The `processedSpawns`-above-retriable ordering (#449 split-brain
      defense) is explicitly out of scope; no scenario here touches that
      ordering. `## Retry` recovery rides the `awaiting_merge` hoist and the
      on-disk merge spawn lock only.
    • #524 (the wrong stored `branchName` that produced #95's `no_pr_found`)
      is a separate root cause and is covered by `feature-524.feature`; this
      file treats the stored branch name as a fixed input.

  Background:
    Given the ADW codebase is checked out

  # ── §1 PR resolution returns the single open PR ───────────────────────────

  @adw-527 @adw-22y8n3-adwmerge-dead-ends-i
  Scenario: Merge resolves the open PR when the branch also carries a closed PR (the #508 regression)
    Given an issue 9520 exists in the mock issue tracker
    And the mock GitHub API records all PR-list calls
    And the mock GitHub API is configured to accept issue comments
    And the worktree for adwId "merge-blocked-527-1" is initialised at branch "feature-issue-9520-observ"
    And a state file exists for adwId "merge-blocked-527-1" at stage "awaiting_merge"
    And the branch "feature-issue-9520-observ" carries a closed PR 9523 and an open PR 9526
    When the "merge" orchestrator is invoked with adwId "merge-blocked-527-1" and issue 9520
    Then the mock GitHub API recorded a PR-merge call for PR 9526
    And the mock harness recorded no PR-merge call for PR 9523
    And the state file for adwId "merge-blocked-527-1" records workflowStage "completed"
    And the orchestrator subprocess exited 0

  @adw-527 @adw-22y8n3-adwmerge-dead-ends-i
  Scenario: Merge resolves the most recent open PR when more than one open PR exists on the branch
    Given an issue 9521 exists in the mock issue tracker
    And the mock GitHub API records all PR-list calls
    And the worktree for adwId "merge-blocked-527-2" is initialised at branch "feature-issue-9521-observ"
    And a state file exists for adwId "merge-blocked-527-2" at stage "awaiting_merge"
    And the branch "feature-issue-9521-observ" carries open PR 9530 and a more recent open PR 9531
    When the "merge" orchestrator is invoked with adwId "merge-blocked-527-2" and issue 9521
    Then the mock GitHub API recorded a PR-merge call for PR 9531
    And the mock harness recorded no PR-merge call for PR 9530
    And the state file for adwId "merge-blocked-527-2" records workflowStage "completed"

  # ── §2 no_pr_found is bounded: stay, count, then escalate ──────────────────

  @adw-527 @adw-22y8n3-adwmerge-dead-ends-i
  Scenario: A first no_pr_found miss keeps the workflow in awaiting_merge and increments the retry counter
    Given an issue 9522 exists in the mock issue tracker
    And the mock GitHub API is configured to accept issue comments
    And the worktree for adwId "merge-blocked-527-3" is initialised at branch "feature-issue-9522-observ"
    And a state file exists for adwId "merge-blocked-527-3" at stage "awaiting_merge"
    And the branch "feature-issue-9522-observ" has no pull request
    When the "merge" orchestrator is invoked with adwId "merge-blocked-527-3" and issue 9522
    Then the state file for adwId "merge-blocked-527-3" records workflowStage "awaiting_merge"
    And the state file for adwId "merge-blocked-527-3" records a merge retry count of 1
    And the mock harness recorded zero PR-merge calls
    And the orchestrator subprocess exited 0

  @adw-527 @adw-22y8n3-adwmerge-dead-ends-i
  Scenario: A no_pr_found miss below the threshold increments the counter without escalating to merge_blocked
    Given an issue 9523 exists in the mock issue tracker
    And the worktree for adwId "merge-blocked-527-4" is initialised at branch "feature-issue-9523-observ"
    And a state file exists for adwId "merge-blocked-527-4" at stage "awaiting_merge"
    And the state file for adwId "merge-blocked-527-4" is seeded with a merge retry count of 1
    And the branch "feature-issue-9523-observ" has no pull request
    When the "merge" orchestrator is invoked with adwId "merge-blocked-527-4" and issue 9523
    Then the state file for adwId "merge-blocked-527-4" records workflowStage "awaiting_merge"
    And the state file for adwId "merge-blocked-527-4" records a merge retry count of 2

  @adw-527 @adw-22y8n3-adwmerge-dead-ends-i
  Scenario: The third consecutive no_pr_found miss escalates to merge_blocked with an explanatory comment
    Given an issue 9524 exists in the mock issue tracker
    And the mock GitHub API is configured to accept issue comments
    And the worktree for adwId "merge-blocked-527-5" is initialised at branch "feature-issue-9524-observ"
    And a state file exists for adwId "merge-blocked-527-5" at stage "awaiting_merge"
    And the state file for adwId "merge-blocked-527-5" is seeded with a merge retry count of 2
    And the branch "feature-issue-9524-observ" has no pull request
    When the "merge" orchestrator is invoked with adwId "merge-blocked-527-5" and issue 9524
    Then the state file for adwId "merge-blocked-527-5" records workflowStage "merge_blocked"
    And the mock GitHub API recorded a comment on issue 9524
    And the merge-blocked escalation comment on issue 9524 names the blocking cause
    And the mock GitHub API recorded a comment on issue 9524 containing the text "## Retry"
    And the mock harness recorded zero PR-merge calls

  @adw-527 @adw-22y8n3-adwmerge-dead-ends-i
  Scenario: A successful resolution after earlier misses merges and clears the retry counter
    Given an issue 9525 exists in the mock issue tracker
    And the mock GitHub API is configured to accept issue comments
    And the worktree for adwId "merge-blocked-527-6" is initialised at branch "feature-issue-9525-observ"
    And a state file exists for adwId "merge-blocked-527-6" at stage "awaiting_merge"
    And the state file for adwId "merge-blocked-527-6" is seeded with a merge retry count of 2
    And the branch "feature-issue-9525-observ" carries a single open PR 9540
    When the "merge" orchestrator is invoked with adwId "merge-blocked-527-6" and issue 9525
    Then the mock GitHub API recorded a PR-merge call for PR 9540
    And the state file for adwId "merge-blocked-527-6" records workflowStage "completed"
    And the state file for adwId "merge-blocked-527-6" records a merge retry count of 0

  # ── §3 merge_failed → merge_blocked; pr_closed → discarded (unchanged) ─────

  @adw-527 @adw-22y8n3-adwmerge-dead-ends-i
  Scenario: An exhausted auto-merge routes to merge_blocked instead of discarded (#460 revision)
    Given an issue 9526 exists in the mock issue tracker
    And the mock GitHub API is configured to accept issue comments
    And the worktree for adwId "merge-blocked-527-7" is initialised at branch "feature-issue-9526-observ"
    And a state file exists for adwId "merge-blocked-527-7" at stage "awaiting_merge"
    And the branch "feature-issue-9526-observ" carries a single open PR 9550
    And automatic conflict resolution for PR 9550 fails after the maximum attempts
    When the "merge" orchestrator is invoked with adwId "merge-blocked-527-7" and issue 9526
    Then the state file for adwId "merge-blocked-527-7" records workflowStage "merge_blocked"
    And the merge-blocked escalation comment for issue 9526 names the blocking cause
    And the mock GitHub API recorded a comment containing the text "## Retry"

  @adw-527 @adw-22y8n3-adwmerge-dead-ends-i
  Scenario: A PR closed without merge still writes discarded (anti-loop intent preserved)
    Given an issue 9527 exists in the mock issue tracker
    And the worktree for adwId "merge-blocked-527-8" is initialised at branch "feature-issue-9527-observ"
    And a state file exists for adwId "merge-blocked-527-8" at stage "awaiting_merge"
    And the branch "feature-issue-9527-observ" carries a single closed unmerged PR 9560
    When the "merge" orchestrator is invoked with adwId "merge-blocked-527-8" and issue 9527
    Then the state file for adwId "merge-blocked-527-8" records workflowStage "discarded"
    And the mock harness recorded zero PR-merge calls
    And the orchestrator subprocess exited 0

  # ── §4 merge_blocked is terminal-until-human (not retriable, no spawn) ─────

  @adw-527 @adw-22y8n3-adwmerge-dead-ends-i
  Scenario: A merge_blocked workflow is neither spawned nor re-dispatched by the cron sweep
    Given an issue 9528 exists in the mock issue tracker
    And issue 9528 carries an ADW comment naming adwId "merge-blocked-527-9"
    And a state file exists for adwId "merge-blocked-527-9" at stage "merge_blocked"
    When the cron probe runs once
    Then no orchestrator is spawned for issue 9528
    And no merge orchestrator is dispatched for issue 9528

  # ── §5 ## Retry re-entry resets merge_blocked → awaiting_merge ─────────────

  @adw-527 @adw-22y8n3-adwmerge-dead-ends-i
  Scenario: ## Retry on a merge_blocked issue resets it to awaiting_merge and clears the retry counter
    Given an issue 9529 exists in the mock issue tracker
    And a state file exists for adwId "merge-blocked-527-10" at stage "merge_blocked"
    And the state file for adwId "merge-blocked-527-10" is seeded with a merge retry count of 3
    And issue 9529 has a comment whose body is "## Retry"
    When the "## Retry" directive is processed for issue 9529
    Then the state file for adwId "merge-blocked-527-10" records workflowStage "awaiting_merge"
    And the state file for adwId "merge-blocked-527-10" records a merge retry count of 0

  @adw-527 @adw-22y8n3-adwmerge-dead-ends-i
  Scenario: After ## Retry, the next cron tick re-dispatches the merge orchestrator
    Given an issue 9530 exists in the mock issue tracker
    And issue 9530 carries an ADW comment naming adwId "merge-blocked-527-11"
    And a state file exists for adwId "merge-blocked-527-11" at stage "awaiting_merge"
    When the cron probe runs once
    Then the merge orchestrator is dispatched for issue 9530

  @adw-527 @adw-22y8n3-adwmerge-dead-ends-i
  Scenario: A merge_blocked workflow recovers through ## Retry and merges on the next attempt
    Given an issue 9531 exists in the mock issue tracker
    And the mock GitHub API is configured to accept issue comments
    And the worktree for adwId "merge-blocked-527-12" is initialised at branch "feature-issue-9531-observ"
    And a state file exists for adwId "merge-blocked-527-12" at stage "merge_blocked"
    And the state file for adwId "merge-blocked-527-12" is seeded with a merge retry count of 3
    And issue 9531 has a comment whose body is "## Retry"
    When the "## Retry" directive is processed for issue 9531
    Then the state file for adwId "merge-blocked-527-12" records workflowStage "awaiting_merge"
    And the state file for adwId "merge-blocked-527-12" records a merge retry count of 0
    Given the branch "feature-issue-9531-observ" carries a single open PR 9570
    When the "merge" orchestrator is invoked with adwId "merge-blocked-527-12" and issue 9531
    Then the mock GitHub API recorded a PR-merge call for PR 9570
    And the state file for adwId "merge-blocked-527-12" records workflowStage "completed"
    And the mock GitHub API recorded a comment on issue 9531

  # ── §6 Gate semantics unchanged (confirming intent) ────────────────────────

  @adw-527 @adw-22y8n3-adwmerge-dead-ends-i
  Scenario: A no-hitl issue with an unapproved open PR merges immediately once PR resolution succeeds
    Given an issue 9532 exists in the mock issue tracker
    And the mock GitHub API is configured to accept issue comments
    And the worktree for adwId "merge-blocked-527-13" is initialised at branch "feature-issue-9532-observ"
    And a state file exists for adwId "merge-blocked-527-13" at stage "awaiting_merge"
    And issue 9532 does not carry the "hitl" label
    And the branch "feature-issue-9532-observ" carries a single open unapproved PR 9580
    When the "merge" orchestrator is invoked with adwId "merge-blocked-527-13" and issue 9532
    Then the mock GitHub API recorded a PR-merge call for PR 9580
    And the state file for adwId "merge-blocked-527-13" records workflowStage "completed"

  # ── §7 Type-check ──────────────────────────────────────────────────────────

  @adw-527 @adw-22y8n3-adwmerge-dead-ends-i
  Scenario: TypeScript type-check passes after the merge_blocked recovery change
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
