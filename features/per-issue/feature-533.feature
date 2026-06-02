@adw-533 @adw-d16x49-review-route-guideli
Feature: review-cycle remediation routing — guideline violations block and run /refactor instead of /patch

  Issue #533 closes the gap between the project-wide coding-guidelines
  contract and the review-cycle that's supposed to enforce it. Today the
  review prompts (`.claude/commands/review.md` Step 3 and the equivalent
  step in `.claude/commands/pr_review.md`) report coding-guideline
  violations as `tech-debt` reviewIssues — non-blocking, never patched, and
  never refactored. The result is that ADW-driven branches accumulate
  guideline drift even though the project has an enforceable
  `.adw/coding_guidelines.md`.

  The fix re-routes guideline violations through a dedicated remediation
  strategy:

    1. `ReviewIssue` (defined in `adws/agents/reviewAgent.ts`) gains an
       optional field `remediationStrategy: "refactor" | "patch"`. When
       the field is absent on a `blocker`, the patch cycle treats it as
       `"patch"` (back-compat default).
    2. `review.md` Step 3 (Coding Guidelines Check) is rewritten:
        • The scope of guideline checks narrows to **changed files only**
          (the diff against the default branch). Pre-existing violations
          in untouched files are no longer reported.
        • All guideline violations found across the changed files are
          consolidated into **one** `blocker` reviewIssue carrying
          `remediationStrategy: "refactor"`. The affected files and the
          violated rule names are listed in `issueDescription`.
    3. `pr_review.md` mirrors the same routing.
    4. `executeReviewPatchCycle` in `adws/phases/reviewPhase.ts` (and the
       equivalent path in `adws/phases/prReviewPhase.ts`) is restructured
       to partition the incoming `blockerIssues` into `patchBlockers`
       (strategy `"patch"` or absent) and `refactorBlockers`
       (strategy `"refactor"`), then execute them in this order:
         a. For each `patchBlocker`: `/patch` agent → `buildAgent`.
         b. If any `refactorBlockers` exist: a single `/refactor` agent
            invocation → `buildAgent`.
         c. Commit and push all changes.
    5. Infinite-loop protection is left to the existing orchestrator-level
       retry cap; no additional guard is added in this issue.

  The triggering motivation: the project ships a refactor skill
  (`.claude/skills/refactor/SKILL.md`) that already knows how to apply
  guidelines mechanically — the review cycle just wasn't reaching for it.
  After this change, a blocker with `remediationStrategy: "refactor"`
  spawns the same agent shape as every other agent the orchestrator
  invokes, with `/refactor` as the prompt, scoped to the affected files.

  Observability / rot-prevention note:

    Every assertion below targets artefacts the system produces — the
    sequence of Claude-CLI agent invocations recorded by the stub harness
    (the same recorded-invocation channel the existing review-related
    surface scenarios drive), the top-level state file written by the
    review orchestrator (read the same way vocabulary entry T1 reads
    `workflowStage`), the git invocations captured by the git-mock (T4
    and T11), and the orchestrator subprocess exit code (T5). No
    assertion reads the contents of `adws/agents/reviewAgent.ts`,
    `adws/phases/reviewPhase.ts`, `adws/phases/prReviewPhase.ts`,
    `.claude/commands/review.md`, or `.claude/commands/pr_review.md`,
    and no assertion inspects the JSON shape of the review-agent output
    as a string — the recorded agent invocations are the behavioural
    signal that the routing decision was made correctly.

    In particular, the acceptance criterion "`ReviewIssue` type includes
    `remediationStrategy`" is proven *behaviourally* — a stubbed review
    output carrying that field reaches the patch cycle and influences
    the agent the orchestrator invokes (§§1–4) — rather than by parsing
    `reviewAgent.ts`, which would be the source-reading rot pattern this
    suite is designed to avoid. The TypeScript type-check scenario (§7)
    is the type-shape backstop.

  Scope notes:

    • The reviewer-prompt rewrite (review.md / pr_review.md Step 3 —
      narrowing scope to changed files and consolidating violations
      into one blocker) is exercised here through stubbed review-agent
      output: each scenario seeds the review-agent fixture that the
      orchestrator consumes, then asserts the downstream routing
      behaviour. The deterministic acceptance check that the reviewer
      *correctly* identifies guideline violations across a given diff
      belongs in the reviewer's own prompt-eval harness; this file
      treats the reviewer output as a fixed input and asserts only the
      patch-cycle's reaction to it.
    • The retry-cap behaviour (the existing orchestrator-level guard
      against runaway review cycles) is unchanged by this issue and is
      explicitly out of scope. No scenario here invokes the cycle more
      than once.
    • The refactor skill's own behaviour (which files it reads, which
      guideline categories it applies) is covered by the skill's own
      docs and is out of scope here. This file asserts only that the
      orchestrator *spawns* the `/refactor` agent at the right moment.

  Background:
    Given the ADW codebase is checked out

  # ── §1 Refactor routing — a refactor blocker spawns /refactor, not /patch ──

  @adw-533 @adw-d16x49-review-route-guideli
  Scenario: A review with a single refactor blocker triggers the /refactor agent and skips /patch
    Given an issue 9700 exists in the mock issue tracker
    And the mock GitHub API is configured to accept issue comments
    And the worktree for adwId "review-refactor-533-1" is initialised at branch "feature-issue-9700-refactor-routing"
    And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/review-refactor-blocker.json"
    And the review-agent output for adwId "review-refactor-533-1" carries one blocker with remediationStrategy "refactor" listing files "adws/agents/reviewAgent.ts" and rule "nesting-depth"
    When the "review" orchestrator is invoked with adwId "review-refactor-533-1" and issue 9700
    Then the claude-cli-stub recorded a "/refactor" agent invocation for adwId "review-refactor-533-1"
    And the claude-cli-stub recorded no "/patch" agent invocation for adwId "review-refactor-533-1"
    And the git-mock recorded a commit on branch "feature-issue-9700-refactor-routing"
    And the git-mock recorded a push to branch "feature-issue-9700-refactor-routing"
    And the state file for adwId "review-refactor-533-1" records no error
    And the orchestrator subprocess exited 0

  # ── §2 Patch routing — explicit "patch" and the absent-field default ──────

  @adw-533 @adw-d16x49-review-route-guideli
  Scenario: A blocker without a remediationStrategy defaults to /patch and never spawns /refactor
    Given an issue 9701 exists in the mock issue tracker
    And the mock GitHub API is configured to accept issue comments
    And the worktree for adwId "review-refactor-533-2" is initialised at branch "feature-issue-9701-patch-default"
    And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/review-patch-blocker-no-strategy.json"
    And the review-agent output for adwId "review-refactor-533-2" carries one blocker with no remediationStrategy field
    When the "review" orchestrator is invoked with adwId "review-refactor-533-2" and issue 9701
    Then the claude-cli-stub recorded a "/patch" agent invocation for adwId "review-refactor-533-2"
    And the claude-cli-stub recorded no "/refactor" agent invocation for adwId "review-refactor-533-2"
    And the orchestrator subprocess exited 0

  @adw-533 @adw-d16x49-review-route-guideli
  Scenario: An explicit "patch" remediationStrategy routes to /patch and never spawns /refactor
    Given an issue 9702 exists in the mock issue tracker
    And the mock GitHub API is configured to accept issue comments
    And the worktree for adwId "review-refactor-533-3" is initialised at branch "feature-issue-9702-patch-explicit"
    And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/review-patch-blocker-explicit.json"
    And the review-agent output for adwId "review-refactor-533-3" carries one blocker with remediationStrategy "patch"
    When the "review" orchestrator is invoked with adwId "review-refactor-533-3" and issue 9702
    Then the claude-cli-stub recorded a "/patch" agent invocation for adwId "review-refactor-533-3"
    And the claude-cli-stub recorded no "/refactor" agent invocation for adwId "review-refactor-533-3"
    And the orchestrator subprocess exited 0

  # ── §3 Execution order — patches first, then a single /refactor, then push ─

  @adw-533 @adw-d16x49-review-route-guideli
  Scenario: A mixed review batches patch blockers first, then runs /refactor once, then commits+pushes
    Given an issue 9703 exists in the mock issue tracker
    And the mock GitHub API is configured to accept issue comments
    And the worktree for adwId "review-refactor-533-4" is initialised at branch "feature-issue-9703-mixed-order"
    And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/review-mixed-blockers.json"
    And the review-agent output for adwId "review-refactor-533-4" carries two patch blockers and one refactor blocker
    When the "review" orchestrator is invoked with adwId "review-refactor-533-4" and issue 9703
    Then the claude-cli-stub recorded two "/patch" agent invocations for adwId "review-refactor-533-4"
    And the claude-cli-stub recorded exactly one "/refactor" agent invocation for adwId "review-refactor-533-4"
    And the claude-cli-stub recorded both "/patch" agent invocations before the "/refactor" agent invocation for adwId "review-refactor-533-4"
    And the claude-cli-stub recorded a build-agent invocation after each "/patch" agent invocation for adwId "review-refactor-533-4"
    And the claude-cli-stub recorded a build-agent invocation after the "/refactor" agent invocation for adwId "review-refactor-533-4"
    And the git-mock recorded a commit on branch "feature-issue-9703-mixed-order" only after every agent invocation for adwId "review-refactor-533-4"
    And the git-mock recorded a push to branch "feature-issue-9703-mixed-order"
    And the orchestrator subprocess exited 0

  # ── §4 Consolidation — one refactor blocker covering N files → 1 invocation ─

  @adw-533 @adw-d16x49-review-route-guideli
  Scenario: A single refactor blocker covering multiple affected files yields exactly one /refactor invocation
    Given an issue 9704 exists in the mock issue tracker
    And the mock GitHub API is configured to accept issue comments
    And the worktree for adwId "review-refactor-533-5" is initialised at branch "feature-issue-9704-consolidated"
    And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/review-refactor-consolidated.json"
    And the review-agent output for adwId "review-refactor-533-5" carries one blocker with remediationStrategy "refactor" listing three affected files
    When the "review" orchestrator is invoked with adwId "review-refactor-533-5" and issue 9704
    Then the claude-cli-stub recorded exactly one "/refactor" agent invocation for adwId "review-refactor-533-5"
    And the claude-cli-stub recorded a build-agent invocation after the "/refactor" agent invocation for adwId "review-refactor-533-5"
    And the orchestrator subprocess exited 0

  # ── §5 No refactor blocker → /refactor is never spawned ────────────────────

  @adw-533 @adw-d16x49-review-route-guideli
  Scenario: A review with no refactor blockers never spawns the /refactor agent
    Given an issue 9705 exists in the mock issue tracker
    And the mock GitHub API is configured to accept issue comments
    And the worktree for adwId "review-refactor-533-6" is initialised at branch "feature-issue-9705-no-refactor"
    And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/review-no-refactor-blocker.json"
    And the review-agent output for adwId "review-refactor-533-6" carries no blockers with remediationStrategy "refactor"
    When the "review" orchestrator is invoked with adwId "review-refactor-533-6" and issue 9705
    Then the claude-cli-stub recorded no "/refactor" agent invocation for adwId "review-refactor-533-6"
    And the orchestrator subprocess exited 0

  @adw-533 @adw-d16x49-review-route-guideli
  Scenario: A passing review with zero blockers spawns neither /patch nor /refactor
    Given an issue 9706 exists in the mock issue tracker
    And the mock GitHub API is configured to accept issue comments
    And the worktree for adwId "review-refactor-533-7" is initialised at branch "feature-issue-9706-passing"
    And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/review-passing.json"
    And the review-agent output for adwId "review-refactor-533-7" reports success with zero blocker issues
    When the "review" orchestrator is invoked with adwId "review-refactor-533-7" and issue 9706
    Then the claude-cli-stub recorded no "/refactor" agent invocation for adwId "review-refactor-533-7"
    And the claude-cli-stub recorded no "/patch" agent invocation for adwId "review-refactor-533-7"
    And the state file for adwId "review-refactor-533-7" records no error
    And the orchestrator subprocess exited 0

  # ── §6 PR-level review applies the same routing ────────────────────────────

  @adw-533 @adw-d16x49-review-route-guideli
  Scenario: The PR-level review path spawns /refactor for a refactor blocker, mirroring the passive judge
    Given an issue 9707 exists in the mock issue tracker
    And the mock GitHub API is configured to accept issue comments
    And the worktree for adwId "review-refactor-533-8" is initialised at branch "feature-issue-9707-pr-review-refactor"
    And the mock GitHub API is configured to return an open PR 9807 for issue 9707 with an unaddressed coding-guideline review comment
    And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/pr-review-refactor-blocker.json"
    And the pr-review-agent output for adwId "review-refactor-533-8" carries one blocker with remediationStrategy "refactor"
    When the "pr_review" orchestrator is invoked with adwId "review-refactor-533-8" and PR 9807
    Then the claude-cli-stub recorded a "/refactor" agent invocation for adwId "review-refactor-533-8"
    And the claude-cli-stub recorded no "/patch" agent invocation for adwId "review-refactor-533-8"
    And the git-mock recorded a commit on branch "feature-issue-9707-pr-review-refactor"
    And the git-mock recorded a push to branch "feature-issue-9707-pr-review-refactor"
    And the orchestrator subprocess exited 0

  @adw-533 @adw-d16x49-review-route-guideli
  Scenario: The PR-level review path runs /patch first then /refactor for a mixed blocker set
    Given an issue 9708 exists in the mock issue tracker
    And the mock GitHub API is configured to accept issue comments
    And the worktree for adwId "review-refactor-533-9" is initialised at branch "feature-issue-9708-pr-review-mixed"
    And the mock GitHub API is configured to return an open PR 9808 for issue 9708 with unaddressed review comments
    And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/pr-review-mixed-blockers.json"
    And the pr-review-agent output for adwId "review-refactor-533-9" carries one patch blocker and one refactor blocker
    When the "pr_review" orchestrator is invoked with adwId "review-refactor-533-9" and PR 9808
    Then the claude-cli-stub recorded one "/patch" agent invocation for adwId "review-refactor-533-9"
    And the claude-cli-stub recorded one "/refactor" agent invocation for adwId "review-refactor-533-9"
    And the claude-cli-stub recorded the "/patch" agent invocation before the "/refactor" agent invocation for adwId "review-refactor-533-9"
    And the orchestrator subprocess exited 0

  # ── §7 Type-check ──────────────────────────────────────────────────────────

  @adw-533 @adw-d16x49-review-route-guideli
  Scenario: TypeScript type-check passes after the remediationStrategy routing change
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
