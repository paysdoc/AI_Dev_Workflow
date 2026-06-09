@adw-559 @adw-qej3f4-replace-build-contex
Feature: Build context-reset cap replaced by a state-novelty progress gate

  Issue #559 replaces the hard `MAX_CONTEXT_RESETS` kill in the build phase
  (`adws/phases/buildPhase.ts`) with a **progress gate**: a build that keeps
  reaching new repository states is allowed to keep restarting, while a build
  that has stalled is aborted — all bounded by a hard backstop. Parent PRD:
  `specs/prd/build-context-reset-progress-gate.md`.

  Today the build phase restarts the build agent up to `MAX_CONTEXT_RESETS`
  times per batch (default 3, env-tunable) on either of two triggers —
  `tokenLimitExceeded` and `compactionDetected` — and then throws once the
  shared per-batch counter exceeds the cap. Those two restart-handling blocks
  are near-duplicates today.

  After this issue, when the per-batch counter reaches `MAX_CONTEXT_RESETS`,
  instead of throwing, a single consolidated handler runs the loop
  commit → hash → gate → act:

    1. commit the worktree via the existing `/commit` agent (a guard skips the
       commit when the worktree is clean — a clean tree is an unchanged hash);
    2. compute the `HEAD` tree hash via a thin VCS helper;
    3. evaluate the state-novelty gate against the set of tree states already
       seen this build (seeded at build start with the build-start tree hash);
    4. act on the decision.

  The gate is a pure function returning a discriminated decision:

    • novel tree state, within the backstop  → continue (reset the per-batch
      counter, record the hash, increment the checkpoint count);
    • novel tree state, past the backstop     → backstop abort;
    • non-novel state (a previously-seen tree, the build-start seed recurring,
      or nothing committed) → no-progress abort.

  Design rationale exercised below (see the PRD's Solution / Implementation
  Decisions): novelty — not size growth — is the progress signal, so a
  net-negative batch (deletions / refactor) that reaches a new state counts as
  progress; the `seen` set is seeded with the build-start tree hash so a build
  that commits nothing is caught as a frozen no-op; the new env-tunable
  `MAX_PROGRESS_CHECKPOINTS` (default 20) is the backstop on monotonic churn.

  Scope:

    • The gate applies to BOTH build-phase restart triggers, which share one
      per-batch counter and now route through one gated handler.
    • The test and review phases keep their existing hard-cap compaction
      recovery (it still aborts at `MAX_CONTEXT_RESETS`); this issue must not
      leak the build gate into them.
    • Abort messages may be generic at this slice; distinct per-reason messages
      are a later slice. No scenario below asserts abort message text — the
      discriminated abort *reason* is pinned at the pure-function level, where
      it is the function's return value.

  Observability / rot-prevention note:

    Every assertion targets an artefact the system produces at runtime — never
    the text of a source file. No step reads `buildPhase.ts`, `config.ts`, or
    any module as text, substring-matches its contents, or parses it as
    JSON/AST.

      • The gate-decision scenarios call the pure gate function and assert its
        returned decision and its non-mutation of the inputs — the decision is
        an output, exactly as the JSONL-parser scenarios in issue #504 assert a
        parser's output state. Constant values (`MAX_PROGRESS_CHECKPOINTS`,
        `MAX_CONTEXT_RESETS`) are exercised through the behaviour they govern,
        never read from source.
      • The tree-hash scenarios assert git artefacts (the `HEAD` tree hash of a
        real worktree), a permitted target.
      • The build-phase scenarios assert recorded git-mock commits, the phase's
        completion / abort outcome, and the recorded context-reset count — all
        runtime artefacts of running the phase.

  Vocabulary note:

    Registered phrases reused from `features/regression/vocabulary.md`:
    `the ADW codebase is checked out` (background) and `the ADW TypeScript
    type-check passes` (cross-cutting backstop). T4 (`the git-mock recorded a
    commit on branch {string}`) is the closest registered phrase for the
    commit-recorded assertion, but these phase-level scenarios do not pin a
    branch, so a branch-agnostic `a commit is recorded at the batch boundary`
    (and its negation) is used instead. The registry has no phrase for: seeding
    / evaluating the state-novelty gate, a
    discriminated gate decision (continue / no-progress / backstop), the
    per-batch reset cap or the progress-checkpoint backstop as tunable inputs,
    the build agent signalling a token-limit or compaction reset, a batch
    boundary committing / skipping / reaching a novel-or-repeated tree state,
    the worktree `HEAD` tree hash, or a build / review / test phase surviving,
    completing, or aborting. Novel phrasing is introduced for those and the gap
    is surfaced to the maintainer in the agent Output.

  Defaults: unless a scenario states otherwise, the per-batch context-reset cap
  is the default 3 and the progress-checkpoint backstop is generous (the gate is
  not the thing under test in that scenario) — each scenario sets only the
  bounds it exercises.

  Background:
    Given the ADW codebase is checked out

  # ── §1 The progress-gate decision — pure function (AC1, AC8) ─────────────
  #
  # The gate is evaluated against the committed HEAD tree state, the set of tree
  # states already seen this build (seeded with the build-start hash), the
  # progress-checkpoint count, and the backstop. Each scenario maps to one of
  # the unit-test cases the acceptance criteria enumerate.

  @adw-559 @adw-qej3f4-replace-build-contex
  Scenario: A novel tree state within the backstop continues the build
    Given the build-start tree state seeds the set of seen states
    And the progress-checkpoint backstop is set to 20
    And no progress checkpoints have been recorded yet in this build
    And the committed tree state is novel — never seen in this build
    When the progress gate is evaluated for the committed tree state
    Then the gate decision is to continue

  @adw-559 @adw-qej3f4-replace-build-contex
  Scenario: A tree state already seen earlier in the build aborts with no-progress
    Given the build-start tree state seeds the set of seen states
    And the progress-checkpoint backstop is set to 20
    And the committed tree state was recorded at an earlier checkpoint in this build
    When the progress gate is evaluated for the committed tree state
    Then the gate decision is to abort with reason no-progress

  @adw-559 @adw-qej3f4-replace-build-contex
  Scenario: A committed state equal to the build-start seed (frozen) aborts with no-progress
    Given the build-start tree state seeds the set of seen states
    And the progress-checkpoint backstop is set to 20
    And the committed tree state equals the build-start seed state
    When the progress gate is evaluated for the committed tree state
    Then the gate decision is to abort with reason no-progress

  @adw-559 @adw-qej3f4-replace-build-contex
  Scenario: A novel state at the backstop limit still continues
    Given the build-start tree state seeds the set of seen states
    And the progress-checkpoint backstop is set to 3
    And 2 progress checkpoints have already been recorded in this build
    And the committed tree state is novel — never seen in this build
    When the progress gate is evaluated for the committed tree state
    Then the gate decision is to continue

  @adw-559 @adw-qej3f4-replace-build-contex
  Scenario: A novel state one past the backstop aborts at the backstop
    Given the build-start tree state seeds the set of seen states
    And the progress-checkpoint backstop is set to 3
    And 3 progress checkpoints have already been recorded in this build
    And the committed tree state is novel — never seen in this build
    When the progress gate is evaluated for the committed tree state
    Then the gate decision is to abort at the backstop

  @adw-559 @adw-qej3f4-replace-build-contex
  Scenario: A net-negative batch that reaches a novel state counts as progress
    Given the build-start tree state seeds the set of seen states
    And the progress-checkpoint backstop is set to 20
    And the committed tree state is novel but represents a net deletion of lines
    When the progress gate is evaluated for the committed tree state
    Then the gate decision is to continue

  @adw-559 @adw-qej3f4-replace-build-contex
  Scenario: Evaluating the gate does not mutate the seen states or the checkpoint count
    Given the build-start tree state seeds the set of seen states
    And the progress-checkpoint backstop is set to 20
    And 1 progress checkpoint has already been recorded in this build
    And the committed tree state is novel — never seen in this build
    When the progress gate is evaluated for the committed tree state
    Then the set of seen states passed to the gate is unchanged
    And the progress-checkpoint count passed to the gate is unchanged

  # ── §2 The tree-hash novelty signal — VCS helper (AC3) ───────────────────
  #
  # The helper returns the worktree HEAD tree hash. Hash equality is what the
  # gate relies on to tell a repeated state from a novel one; hash inequality
  # under a deletion-only change is what makes a net-negative batch register as
  # progress.

  @adw-559 @adw-qej3f4-replace-build-contex
  Scenario: Re-committing an identical tree yields an identical HEAD tree hash
    Given a worktree on the build branch with a committed change
    And the worktree HEAD tree hash is recorded
    When the worktree is returned to that identical tree state and committed again
    Then the worktree HEAD tree hash equals the recorded hash

  @adw-559 @adw-qej3f4-replace-build-contex
  Scenario: A deletion-only change yields a HEAD tree hash distinct from before
    Given a worktree on the build branch with a committed change
    And the worktree HEAD tree hash is recorded
    When a commit that only deletes content is made
    Then the worktree HEAD tree hash differs from the recorded hash

  # ── §3 Batch-boundary commit and the commit-if-dirty guard (AC4) ─────────

  @adw-559 @adw-qej3f4-replace-build-contex
  Scenario: A dirty worktree at the batch boundary is committed before the gate evaluates
    Given the per-batch context-reset cap is 3
    And the progress-checkpoint backstop is set to 20
    And the build agent signals a token-limit reset on every run within the first batch
    And the worktree has uncommitted changes at the batch boundary
    And the build agent then completes successfully
    When the build phase runs
    Then a commit is recorded at the batch boundary

  @adw-559 @adw-qej3f4-replace-build-contex
  Scenario: A clean worktree at the batch boundary skips the commit and the gate sees no progress
    Given the per-batch context-reset cap is 3
    And the build agent signals a token-limit reset on every run
    And the worktree is clean at the batch boundary
    When the build phase runs
    Then no commit is recorded at the batch boundary
    And the build phase aborts with reason no-progress

  # ── §4 End-to-end build phase via the token-limit trigger (AC6, AC7) ─────

  @adw-559 @adw-qej3f4-replace-build-contex
  Scenario: A progressing build survives more than the per-batch reset cap and completes
    Given the per-batch context-reset cap is 3
    And the progress-checkpoint backstop is set to 20
    And the build agent signals a token-limit reset on every run across the first two batches
    And each batch boundary commits a novel tree state
    And the build agent then completes successfully
    When the build phase runs
    Then the build phase survives more than 3 context resets
    And the build phase completes successfully

  @adw-559 @adw-qej3f4-replace-build-contex
  Scenario: A frozen build whose worktree never changes aborts with no-progress
    Given the per-batch context-reset cap is 3
    And the build agent signals a token-limit reset on every run
    And the worktree is clean at every batch boundary
    When the build phase runs
    Then the build phase aborts with reason no-progress

  @adw-559 @adw-qej3f4-replace-build-contex
  Scenario: An oscillating build that returns to a prior tree state aborts with no-progress
    Given the per-batch context-reset cap is 3
    And the progress-checkpoint backstop is set to 20
    And the build agent signals a token-limit reset on every run
    And the first batch boundary commits a novel tree state
    And the second batch boundary returns the worktree to the first boundary's tree state
    When the build phase runs
    Then the build phase aborts with reason no-progress

  @adw-559 @adw-qej3f4-replace-build-contex
  Scenario: A build that always reaches a novel state is stopped at the backstop
    Given the per-batch context-reset cap is 3
    And the progress-checkpoint backstop is set to 2
    And the build agent signals a token-limit reset on every run
    And every batch boundary commits a new novel tree state
    When the build phase runs
    Then the build phase survives more than 3 context resets
    And the build phase aborts at the backstop

  @adw-559 @adw-qej3f4-replace-build-contex
  Scenario: A net-negative batch (deletions) that reaches a novel state lets the build continue
    Given the per-batch context-reset cap is 3
    And the progress-checkpoint backstop is set to 20
    And the build agent signals a token-limit reset on every run across the first batch
    And the first batch boundary commits a net deletion that reaches a novel tree state
    And the build agent then completes successfully
    When the build phase runs
    Then the build phase survives more than 3 context resets
    And the build phase completes successfully

  # ── §5 Both restart triggers share one gated handler (AC5) ───────────────
  #
  # Consolidation is proven behaviourally: the compaction trigger reaches the
  # same gate as the token-limit trigger (progress survives, frozen aborts), and
  # a batch that mixes both triggers shares one per-batch counter and one gated
  # boundary — not a source-structure assertion about a single handler.

  @adw-559 @adw-qej3f4-replace-build-contex
  Scenario: A compaction-triggered progressing build survives past the reset cap and completes
    Given the per-batch context-reset cap is 3
    And the progress-checkpoint backstop is set to 20
    And the build agent signals a context-compaction reset on every run across the first two batches
    And each batch boundary commits a novel tree state
    And the build agent then completes successfully
    When the build phase runs
    Then the build phase survives more than 3 context resets
    And the build phase completes successfully

  @adw-559 @adw-qej3f4-replace-build-contex
  Scenario: A compaction-triggered frozen build aborts with no-progress
    Given the per-batch context-reset cap is 3
    And the build agent signals a context-compaction reset on every run
    And the worktree is clean at every batch boundary
    When the build phase runs
    Then the build phase aborts with reason no-progress

  @adw-559 @adw-qej3f4-replace-build-contex
  Scenario: Token-limit and compaction resets share one per-batch counter and one gated boundary
    Given the per-batch context-reset cap is 3
    And the progress-checkpoint backstop is set to 20
    And within the first batch the build agent signals a token-limit reset, then a compaction reset, then a token-limit reset
    And the batch boundary commits a novel tree state
    And the build agent then completes successfully
    When the build phase runs
    Then the build phase survives more than 3 context resets
    And the build phase completes successfully

  # ── §6 A legitimate no-op build never engages the gate (AC9) ─────────────

  @adw-559 @adw-qej3f4-replace-build-contex
  Scenario: A build agent that completes on its first run never engages the progress gate
    Given the per-batch context-reset cap is 3
    And the build agent completes successfully on its first run with no reset
    When the build phase runs
    Then the build phase completes successfully
    And the build phase records zero context resets

  # ── §7 Test and review phases are unchanged (test/review compaction path) ─
  #
  # The build gate must not leak into the other phases: their compaction
  # recovery still aborts at the reset cap and never commits-and-continues.

  @adw-559 @adw-qej3f4-replace-build-contex
  Scenario: The review phase still aborts at the context-reset cap on repeated compaction
    Given the per-batch context-reset cap is 3
    And the review agent signals a context-compaction reset on every run
    When the review phase runs
    Then the review phase aborts at the context-reset cap
    And no batch-boundary commit is recorded for the review phase

  @adw-559 @adw-qej3f4-replace-build-contex
  Scenario: The test phase still aborts at the context-reset cap on repeated compaction
    Given the per-batch context-reset cap is 3
    And the test agent signals a context-compaction reset on every run
    When the test phase runs
    Then the test phase aborts at the context-reset cap
    And no batch-boundary commit is recorded for the test phase

  # ── Type-check backstop ──────────────────────────────────────────────────

  @adw-559 @adw-qej3f4-replace-build-contex
  Scenario: TypeScript type-check passes after introducing the progress gate
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
