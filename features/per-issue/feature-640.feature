@adw-640 @adw-rk9n3v-feat-tell-resumed-bu
Feature: a resumed build run is told to inventory its worktree and continue, not restart — so each resume does strictly less work and its PR is indistinguishable from a fresh run's

  Issue #640 (parent PRD `specs/prd/stage-recovery-resume-in-place.md`, Implementation
  Decisions → recognition instruction; Testing Decisions → not unit-tested, a BDD
  scenario if anything) closes the last gap in resume-in-place. Issue #638 made a
  recovered run REUSE its healthy worktree in place — the partial work (committed
  checkpoints AND uncommitted edits) survives the takeover instead of being reset to the
  remote. But the build agent the resumed run then re-enters was still handed the SAME
  fresh `/implement` prompt as a first run: "here is the plan, implement it". A
  fresh-start prompt over a worktree that already holds half the work invites the agent
  to redo (or revert) what is already there — so a resume could do as much work as the
  original run, and resume-in-place would never converge.

  This slice extends the build-agent prompt so a RESUMED run is told it is resuming and
  instructed to inventory the existing partial work in its worktree and continue from
  where it left off, rather than restart from scratch. That recognition instruction is
  what makes resume-in-place converge: each resume inventories what is already done and
  implements only the remainder, so each resume does strictly less work than the last.
  (This is the cross-run sibling of issue #561, which gave the WITHIN-build continuation
  prompt — `buildContinuationPrompt`, fired on a token-limit / compaction reset — the
  same "inspect committed git state, do not redo" direction. #640 carries that direction
  across a whole-run takeover; the implementer may reuse or parallel that composer.)

  The change is confined to the build-agent prompt — transient context handed to the
  build agent at launch. It is NOT written into the plan, the commits, or the PR. The PR
  a resumed run opens is therefore composed from the same durable inputs (the unchanged
  plan and the agent's committed diff) as a fresh run's, so a resumed run's PR is
  indistinguishable from a non-resumed one (AC2). And a FRESH run — not resuming — still
  receives the unchanged build prompt and implements the plan from the beginning, so
  there is no regression to first-run behaviour (AC3).

  Observability / rot-prevention note:

    Every assertion targets the STRING the build-agent prompt composer returns — a
    runtime output of the system under test, exactly as issue #561's scenarios assert the
    continuation-prompt builder's returned string and issue #637's scenario asserts the
    composed Phase Timeout comment body. No step reads buildAgent.ts, planPhase.ts,
    buildPhase.ts, or any module as source text, substring-matches a source file's
    contents, or parses a source file as JSON/AST.

    The "resumed" vs "fresh" condition in each Given is the composer's INPUT — the resume
    signal a taken-over run carries — exactly the test-data category the Rot-Detection
    Rubric permits, NOT a read of this repo's source files. The prompt the composer
    produces in response is the observable behaviour pinned. The recognition intent
    (resuming / inventory / continue / do-not-redo) is asserted by tolerant keyword match,
    never against the implementer's exact sentence wording.

  Scope notes:

    • Behaviour pinned here is the OBSERVABLE content of the composed build-agent prompt
      for a resumed vs a fresh run. The composer's name, signature, and exact sentence
      wording are an implementer's choice and are NOT pinned; the scenarios assert the
      prompt's recognition intent and the preservation of the plan content, not a literal
      sentence. Whether the implementer reuses issue #561's `buildContinuationPrompt` or
      adds a parallel composer is left open.
    • The signal is a build-prompt augmentation only. How a resumed run is DETECTED (the
      takeover / worktree-reuse machinery of issue #638, pinned by feature-638) is OUT of
      scope here — these scenarios take the resume signal as given and pin only what the
      prompt then says.
    • "PR indistinguishable" (AC2) is pinned at the prompt seam: the resumed prompt
      preserves the same plan content a fresh prompt carries and adds only resume context,
      so nothing distinguishing flows into the PR (which is composed from the durable plan
      + committed diff, never the transient prompt). Driving the PR phase end-to-end would
      only re-observe the stubbed build agent's output and is deliberately not done.
    • The @regression maintenance sweep is SKIPPED for this issue: `.adw/scenarios.md`
      configures a `## Regression Scenario Directory`, so promotion is a deliberate human
      decision and the agent never auto-promotes.

  Vocabulary note:

    Reused registered phrases (`features/regression/vocabulary.md`):
      G18  `the ADW codebase is checked out`
      T22  `the ADW TypeScript type-check passes`

    Novel phrasing introduced here (surfaced to the maintainer in the agent Output) — the
    registry has no phrase for the build-agent prompt or a resumed-run recognition
    instruction. Phrasing is kept deliberately distinct from issue #561's "continuation
    prompt" phrases (subject "build agent prompt", and "worktree's existing partial work"
    / "already present" rather than "committed git state" / "already committed") so the
    two surfaces' step definitions do not collide:
      • `a resumed-in-place build run whose worktree carries partial work from the interrupted run`
      • `a fresh build run that is not being resumed`
      • `the build agent prompt is composed for the run`
      • `the build agent prompt signals that the run is resuming an in-progress implementation`
      • `the build agent prompt instructs the agent to inventory the existing work in its worktree before writing code`
      • `the build agent prompt presents the worktree's existing partial work as the authoritative record of work already done`
      • `the build agent prompt instructs the agent to continue from where the work left off rather than restart from scratch`
      • `the build agent prompt instructs the agent not to redo work that is already present`
      • `the build agent prompt carries no resume-or-inventory signal`
      • `the build agent prompt includes the implementation plan content`
      • `the build agent prompt embeds the same implementation plan content a fresh run's prompt embeds`
      • `the build agent prompt adds resume-and-inventory context on top of the fresh build prompt`

    Step-definition note for the maintainer: the resumed / fresh Given sets a `resuming`
    flag (and a fixed plan-content fixture) on the composer input; the When phase-imports
    the build-agent prompt composer the implementer introduces (expected to live beside
    `runBuildAgent` in adws/agents/buildAgent.ts, or to be `buildContinuationPrompt`
    reused for the cross-run case) and calls it once with that input. Each recognition-
    intent Then asserts the returned prompt by tolerant keyword match — deliberately RED
    against today's fresh-only prompt and NOT keyed to the implementer's exact sentence.
    The "same plan content" / "carries no resume-or-inventory signal" / "adds resume-and-
    inventory context" Thens compose the composer twice (resuming and not) over the same
    plan fixture and compare the two returned strings.

  Background:
    Given the ADW codebase is checked out

  # ── §1 A resumed run is told it is resuming and must inventory first (AC1 headline) ──
  #
  # The headline recognition instruction. A run resumed in place (its worktree preserved
  # by issue #638) re-enters the build agent; the prompt now tells the agent the run is
  # resuming an in-progress implementation and that it must inventory the existing work in
  # the worktree before writing any code. Asserted against the composed prompt's content —
  # a returned string — never a source file. (AC1.)

  @adw-640 @adw-rk9n3v-feat-tell-resumed-bu
  Scenario: The build prompt for a resumed run signals the resume and directs the agent to inventory existing work first
    Given a resumed-in-place build run whose worktree carries partial work from the interrupted run
    When the build agent prompt is composed for the run
    Then the build agent prompt signals that the run is resuming an in-progress implementation
    And the build agent prompt instructs the agent to inventory the existing work in its worktree before writing code

  # ── §2 Continue from existing work rather than restart (AC1 — the convergence essence) ─
  #
  # What makes resume-in-place converge. The prompt presents the worktree's existing
  # partial work — committed checkpoints AND the uncommitted edits #638 preserves — as the
  # authoritative record of what is already done, directs the agent to continue from where
  # that work left off instead of restarting from scratch, and forbids redoing work that is
  # already present. Each resume therefore implements only the remainder and does strictly
  # less work than the last. (AC1.)

  @adw-640 @adw-rk9n3v-feat-tell-resumed-bu
  Scenario: The build prompt for a resumed run directs the agent to continue from existing work rather than restart
    Given a resumed-in-place build run whose worktree carries partial work from the interrupted run
    When the build agent prompt is composed for the run
    Then the build agent prompt presents the worktree's existing partial work as the authoritative record of work already done
    And the build agent prompt instructs the agent to continue from where the work left off rather than restart from scratch
    And the build agent prompt instructs the agent not to redo work that is already present

  # ── §3 A fresh run is unchanged — no regression to first-run behaviour (AC3) ─────────
  #
  # The regression guard. A run that is NOT resuming still receives the pre-existing build
  # prompt: no resume signal, no inventory direction, and it still embeds the plan so the
  # agent implements it from the beginning exactly as before. A blanket "always add the
  # resume instruction" implementation would regress first-run behaviour and trip here.

  @adw-640 @adw-rk9n3v-feat-tell-resumed-bu
  Scenario: The build prompt for a fresh run carries no resume signal and still embeds the plan
    Given a fresh build run that is not being resumed
    When the build agent prompt is composed for the run
    Then the build agent prompt carries no resume-or-inventory signal
    And the build agent prompt includes the implementation plan content

  # ── §4 A resumed run's PR is indistinguishable from a fresh run's (AC2) ──────────────
  #
  # The non-leakage guarantee. The resumed prompt embeds the SAME plan content a fresh
  # run's prompt carries and adds only resume-and-inventory context on top — the resume
  # signal is confined to the transient build prompt and never alters the durable inputs
  # the PR is composed from (the plan + the agent's committed diff). Combined with §3 (a
  # fresh prompt carries no resume signal), this pins that the only difference between the
  # two prompts is additive process context, so a resumed run's PR is indistinguishable
  # from a non-resumed one. Asserted by comparing the two composed prompt strings — both
  # outputs of the system under test, not source files. (AC2.)

  @adw-640 @adw-rk9n3v-feat-tell-resumed-bu
  Scenario: A resumed run's build prompt preserves the same plan a fresh run uses and only adds resume context
    Given a resumed-in-place build run whose worktree carries partial work from the interrupted run
    When the build agent prompt is composed for the run
    Then the build agent prompt embeds the same implementation plan content a fresh run's prompt embeds
    And the build agent prompt adds resume-and-inventory context on top of the fresh build prompt

  # ── §5 Type-check backstop ──────────────────────────────────────────────────────────
  #
  # The build-prompt composer and the resume signal threaded into it keep the ADW codebase
  # type-clean. A backstop, consistent with feature-561's type-check scenario and
  # feature-637 §6 / feature-638 §8. (Backstop.)

  @adw-640 @adw-rk9n3v-feat-tell-resumed-bu
  Scenario: The ADW TypeScript type-check passes with the resumed-run build prompt wired in
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
