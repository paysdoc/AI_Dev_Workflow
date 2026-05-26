@adw-524 @adw-sh8m9r-branchname-agent-re
Feature: branchName persistence — one branch per adwId across workflow re-entry

  Issue #524 makes the branch name a once-per-adwId decision. Today
  `initializeWorkflow` in `adws/phases/workflowInit.ts` chooses a branch
  through a four-step cascade (caller cwd → recovered branch → worktree
  found by issue pattern → `runGenerateBranchNameAgent`). When a phase
  re-enters the workflow without a recovered branch AND worktree discovery
  by issue pattern misses (the existing branch was pruned, the worktree
  lives under a target-repo path the lookup doesn't scan, or the dir-name
  pattern doesn't normalise), the branch-name agent
  (`/generate_branch_name`) is invoked a second time. The agent is an LLM
  and is not deterministic, so the second invocation can return a slightly
  different slug. The orchestrator then creates a NEW branch and worktree
  and proceeds there, while the plan, scenarios, and other phase-1
  artifacts sit on the first branch and are never seen. The build phase
  fails with `Cannot read plan file at <new-worktree>/specs/issue-N-plan.md`.

  The triggering incident was ADW `cv2hai-rfc-split-worker-api`
  (issue vestmatic/vestmatic#95): invocation #1 returned
  `split-worker-api-scrape-deck`, invocation #2 returned
  `split-worker-api-scrape-deck-ports`, leaving two branches and stranding
  the plan on the first.

  This feature makes the chosen branch name durable for the lifetime of an
  `adwId`:

    1. Once a branch name is chosen for an `adwId`, `initializeWorkflow`
       persists it in the top-level workflow state file
       (`agents/{adwId}/state.json`, field `branchName`).
    2. On every subsequent initialisation within that `adwId`, the persisted
       name is reused — even when the recovery state is empty and worktree
       discovery by issue pattern misses — so `runGenerateBranchNameAgent`
       is never called a second time.
    3. If the branch-name agent is somehow run a second time within an
       `adwId` and returns a name that differs from the persisted one,
       initialisation aborts with an error that names the persisted branch
       instead of silently forking into a new worktree.

  The scenarios below assert against the artefacts the workflow produces —
  never against framework source files:

    • the top-level state file written by `initializeWorkflow`
      (`agents/{adwId}/state.json`) — an *artefact*, not a source file
      (see `features/regression/vocabulary.md` Rot-Detection Rubric and
      vocabulary entry T1, which reads the same state artefact);
    • the branch-creating git invocations recorded by the git-mock (the
      same recorded-invocation channel behind vocabulary T4 / T11);
    • the branch-name agent invocation record produced under the adwId's
      logs directory;
    • the error raised / recorded by `initializeWorkflow` on a genuine
      slug mismatch.

  No assertion in this file reads the contents of
  `adws/phases/workflowInit.ts`, `adws/agents/gitAgent.ts`,
  `adws/agents/planAgent.ts`, or `.claude/commands/generate_branch_name.md`.

  The deterministic acceptance check for AC bullet 3 ("simulate two
  `workflowInit` calls with the same `adwId`/`issueNumber`/`issueType`
  where the underlying agent returns different slugs; assert only one
  branch/worktree is created") is a unit test that belongs at
  `adws/phases/__tests__/workflowInit.test.ts`, driving `initializeWorkflow`
  against a stubbed branch-name agent — that test file is the canonical
  home for the slug-mismatch-determinism contract. Correctness of how a
  slug is assembled into a full branch name (`feature-issue-{N}-{slug}`) is
  a separate concern owned by the deterministic branch-name assembly work
  (issue #455); this file treats the assembled name as a fixed value.

  Scope note:

    • §5 covers the issue's optional, explicitly-follow-up acceptance
      criterion (AC bullet 4 — `findPlanFile` searching sibling worktrees
      and naming the orphan worktree in its error). It documents the
      fallback contract for when an orphan worktree already exists and may
      be deferred to a follow-up issue; the primary fix (§§1–4) prevents
      the orphan worktree from being created in the first place.

  Background:
    Given the ADW codebase is checked out

  # ── §1 Persistence — the chosen branch name is written to top-level state ─

  @adw-524 @adw-sh8m9r-branchname-agent-re
  Scenario: Initialising a workflow persists the chosen branch name to the top-level state file
    Given an issue 9500 exists in the mock issue tracker
    And no resumable branch is recorded for issue 9500
    And worktree discovery by issue pattern is unavailable for issue 9500
    And the branch-name agent is configured to return slug "split-worker-api-scrape-deck"
    When the workflow is initialised for adwId "branch-persist-524-1" and issue 9500
    Then the top-level state file for adwId "branch-persist-524-1" records a non-empty branchName
    And the top-level state file for adwId "branch-persist-524-1" records branchName "feature-issue-9500-split-worker-api-scrape-deck"

  # ── §2 Reuse — re-entry reuses the persisted name; the agent is not re-run ─

  @adw-524 @adw-sh8m9r-branchname-agent-re
  Scenario: Re-entry reuses the persisted branch name even when the agent would return a different slug
    Given an issue 9501 exists in the mock issue tracker
    And a branch name "feature-issue-9501-split-worker-api-scrape-deck" is already persisted in the top-level state for adwId "branch-persist-524-2"
    And no resumable branch is recorded for issue 9501
    And worktree discovery by issue pattern is unavailable for issue 9501
    And the branch-name agent is configured to return slug "split-worker-api-scrape-deck-ports"
    When the workflow is initialised for adwId "branch-persist-524-2" and issue 9501
    Then the top-level state file for adwId "branch-persist-524-2" still records branchName "feature-issue-9501-split-worker-api-scrape-deck"
    And the branch-name agent is not invoked for adwId "branch-persist-524-2"

  @adw-524 @adw-sh8m9r-branchname-agent-re
  Scenario: Two initialisations of the same adwId with divergent agent slugs create exactly one branch and one worktree
    Given an issue 9502 exists in the mock issue tracker
    And no resumable branch is recorded for issue 9502
    And worktree discovery by issue pattern is unavailable for issue 9502
    And the branch-name agent is configured to return slug "split-worker-api-scrape-deck" on its first call and "split-worker-api-scrape-deck-ports" on its second call
    When the workflow is initialised for adwId "branch-persist-524-3" and issue 9502
    And the workflow is initialised again for adwId "branch-persist-524-3" and issue 9502
    Then only one branch is created for issue 9502 across both initialisations
    And only one worktree is created for issue 9502 across both initialisations
    And the branch-name agent is invoked exactly once across both initialisations for adwId "branch-persist-524-3"
    And the top-level state file for adwId "branch-persist-524-3" records branchName "feature-issue-9502-split-worker-api-scrape-deck"

  # ── §3 Abort on mismatch — defensive guard against a forked second branch ─

  @adw-524 @adw-sh8m9r-branchname-agent-re
  Scenario: A re-run agent returning a different slug aborts initialisation instead of forking a new worktree
    Given an issue 9503 exists in the mock issue tracker
    And a branch name "feature-issue-9503-split-worker-api-scrape-deck" is already persisted in the top-level state for adwId "branch-persist-524-4"
    And the branch-name agent is forced to run again and is configured to return slug "split-worker-api-scrape-deck-ports"
    When the workflow is initialised for adwId "branch-persist-524-4" and issue 9503
    Then the workflow initialisation fails with an error that names the persisted branch "feature-issue-9503-split-worker-api-scrape-deck"
    And no second worktree is created for issue 9503
    And the top-level state file for adwId "branch-persist-524-4" still records branchName "feature-issue-9503-split-worker-api-scrape-deck"

  # ── §4 Determinism guard — a matching re-run slug is reused, not aborted ──

  @adw-524 @adw-sh8m9r-branchname-agent-re
  Scenario: A re-run agent returning the same slug is reused without aborting
    Given an issue 9504 exists in the mock issue tracker
    And a branch name "feature-issue-9504-split-worker-api-scrape-deck" is already persisted in the top-level state for adwId "branch-persist-524-5"
    And the branch-name agent is forced to run again and is configured to return slug "split-worker-api-scrape-deck"
    When the workflow is initialised for adwId "branch-persist-524-5" and issue 9504
    Then the workflow initialisation completes without error
    And the top-level state file for adwId "branch-persist-524-5" records branchName "feature-issue-9504-split-worker-api-scrape-deck"
    And only one worktree is created for issue 9504

  # ── §5 (Optional follow-up — AC bullet 4) sibling-worktree plan resolution ─

  @adw-524 @adw-sh8m9r-branchname-agent-re
  Scenario: When the plan lives only in a sibling worktree, plan resolution surfaces an error naming the orphan worktree
    Given an issue 9505 exists in the mock issue tracker
    And a worktree for adwId "branch-persist-524-6" exists at branch "feature-issue-9505-scrape-deck-ports" with no plan file
    And a sibling worktree for issue 9505 at branch "feature-issue-9505-scrape-deck" holds the plan file "specs/issue-9505-plan.md"
    When the plan file for issue 9505 is resolved from the worktree for adwId "branch-persist-524-6"
    Then the plan resolution error names the orphan worktree at branch "feature-issue-9505-scrape-deck"

  # ── §6 Type-check ─────────────────────────────────────────────────────────

  @adw-524 @adw-sh8m9r-branchname-agent-re
  Scenario: TypeScript type-check passes after the branchName-persistence change
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
