@adw-561 @adw-6uquvb-point-build-continua
Feature: Build continuation prompt points the restarted agent at committed git state

  Issue #561 changes the build continuation prompt — `buildContinuationPrompt`
  (defined in `adws/phases/planPhase.ts`, consumed by the build phase's
  continuation loop in `adws/phases/buildPhase.ts`) — so a restarted build agent
  is directed to inspect **committed state** (`git log` / `git diff` against the
  base branch) as the authoritative record of what is already done, instead of
  relying solely on a truncated tail of the previous agent's output. Parent PRD:
  `specs/prd/build-context-reset-progress-gate.md`, Implementation Decisions →
  Continuation prompt.

  Why now: issue #559's progress gate commits the worktree at every checkpoint,
  so the build branch carries a durable, lossless record of completed work in git
  — every checkpoint commit sits on the build branch ahead of the base. Each
  continuation agent starts with a fresh context window, so it has ample room to
  read committed state. Directing it to git protects the progress gate from churn
  caused by an agent redoing or reverting earlier work it could not remember.

  Before this issue the continuation prompt's only "what's already done" signal is
  the `<previous-agent-output>` blob — a truncated text summary of the previous
  agent's output. After this issue, when committed checkpoint work exists, the
  prompt makes committed git state the source of truth.

  Scope:

    • The committed-state direction appears only when the build branch carries
      checkpoint commits beyond the base. On the first build pass — no checkpoint
      commits yet — the prompt is unchanged: it still carries the previous agent's
      partial output as the continuation context. (AC3 — protects the first pass.)
    • The behaviour is independent of which restart trigger fired: `token_limit`
      and `compaction` both route through the same continuation prompt, so the
      committed-state direction must not be gated behind one trigger.
    • The continuation prompt still embeds the original plan content — the rewrite
      must not drop the plan the agent is implementing.

  Observability / rot-prevention note:

    Every assertion targets the STRING the continuation-prompt builder returns —
    a runtime output of the system under test, exactly as issue #559's scenarios
    assert the progress gate's returned decision and issue #504's scenarios assert
    a parser's output state. No step reads `planPhase.ts`, `buildPhase.ts`, or any
    module as source text, substring-matches a source file's contents, or parses a
    source file as JSON/AST. The committed-vs-first-pass condition is established
    as real git state in a temporary worktree (checkpoint commits present or absent
    on the build branch beyond the base) — a git artefact, a permitted target — and
    the prompt the builder produces in response is the observable behaviour pinned.

  Vocabulary note:

    Registered phrases reused from `features/regression/vocabulary.md`:
    `the ADW codebase is checked out` (background) and `the ADW TypeScript
    type-check passes` (cross-cutting backstop). The registry has no phrase for: a
    build worktree carrying / lacking checkpoint commits beyond the base, building
    a continuation prompt (with a token-limit or compaction trigger), or a
    continuation prompt directing the agent to the committed `git log`/`git diff`
    against the base, naming committed state the authoritative record of completed
    work, carrying the previous agent's output, or embedding the original plan.
    Novel phrasing is introduced for those and the gap is surfaced to the
    maintainer in the agent Output.

  Background:
    Given the ADW codebase is checked out

  # ── §1 Committed checkpoints → the prompt points at committed git state (AC1, AC2)
  #
  # When the build branch carries checkpoint commits beyond the base, the
  # continuation prompt directs the fresh agent to read committed state as the
  # authoritative record of completed work.

  @adw-561 @adw-6uquvb-point-build-continua
  Scenario: A continuation prompt for a build with committed checkpoints directs the agent to the git log against the base
    Given a build worktree whose branch carries checkpoint commits beyond the base branch
    When a build continuation prompt is built for that worktree
    Then the continuation prompt directs the agent to inspect the committed git log against the base branch

  @adw-561 @adw-6uquvb-point-build-continua
  Scenario: A continuation prompt for a build with committed checkpoints directs the agent to the git diff against the base
    Given a build worktree whose branch carries checkpoint commits beyond the base branch
    When a build continuation prompt is built for that worktree
    Then the continuation prompt directs the agent to inspect the committed git diff against the base branch

  @adw-561 @adw-6uquvb-point-build-continua
  Scenario: A continuation prompt makes committed git state the authoritative record of completed work
    Given a build worktree whose branch carries checkpoint commits beyond the base branch
    When a build continuation prompt is built for that worktree
    Then the continuation prompt presents the committed git state as the authoritative record of completed work
    And the continuation prompt instructs the agent not to redo work that is already committed

  @adw-561 @adw-6uquvb-point-build-continua
  Scenario: A continuation prompt for a build with committed checkpoints still embeds the original plan
    Given a build worktree whose branch carries checkpoint commits beyond the base branch
    When a build continuation prompt is built for that worktree
    Then the continuation prompt includes the original plan content

  # ── §2 First build pass (no checkpoint commits) → behaviour unchanged (AC3)
  #
  # With nothing committed beyond the base, there is no committed state to inspect,
  # so the prompt keeps its pre-existing shape: no git direction, and the previous
  # agent's partial output is still carried as the continuation context.

  @adw-561 @adw-6uquvb-point-build-continua
  Scenario: A continuation prompt for the first build pass does not direct the agent to committed git state
    Given a build worktree whose branch has no checkpoint commits beyond the base branch
    When a build continuation prompt is built for that worktree
    Then the continuation prompt does not direct the agent to inspect committed git state

  @adw-561 @adw-6uquvb-point-build-continua
  Scenario: A continuation prompt for the first build pass still carries the previous agent's output
    Given a build worktree whose branch has no checkpoint commits beyond the base branch
    And the previous build agent left partial output
    When a build continuation prompt is built for that worktree
    Then the continuation prompt carries the previous agent's output as the continuation context

  # ── §3 The committed-state direction is independent of the restart trigger
  #
  # Both restart triggers reach the same continuation prompt, so the committed-state
  # direction must appear after a compaction reset too — not only a token-limit one.

  @adw-561 @adw-6uquvb-point-build-continua
  Scenario: The committed-state direction is present after a compaction reset, not only a token-limit reset
    Given a build worktree whose branch carries checkpoint commits beyond the base branch
    When a build continuation prompt is built for that worktree after a context-compaction reset
    Then the continuation prompt directs the agent to inspect the committed git log against the base branch

  # ── Type-check backstop ──────────────────────────────────────────────────

  @adw-561 @adw-6uquvb-point-build-continua
  Scenario: TypeScript type-check passes after pointing the continuation prompt at committed state
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
