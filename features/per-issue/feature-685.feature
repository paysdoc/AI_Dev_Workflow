@adw-685 @adw-jrlonn-fix-harden-adwupgrad
Feature: adwUpgrade hardening — validity-only regen gate, a bounded failure cap with human escalation, and a scoped regen commit

  Issue #685 hardens the framework self-upgrade lane (`adws/adwUpgrade.tsx`) so it
  can neither silently loop forever nor revert merged work with its own commit.
  Three independent parts, shipped together, each fixing a verified root cause that
  stranded the upgrade tracking issue #657 (and froze the head of the GitContext PRD):

    1. COIN-FLIP RECEIPT GATE. The #614 `verifyAdwRegen` gate hard-requires an
       agent-written `.adw/.regen-receipt` stamped with the current framework hash.
       But `adw_init.md` carries NO instruction to write that receipt (added for #614,
       then deleted by upgrade commit 184b600). Whether the gate passes therefore
       depends on whether the LLM happens to write the receipt unprompted — #657 failed
       3× then a later run passed by luck. Flaky, not a permanent brick, but
       non-deterministic and certain to fail again.
    2. NO FAILURE TERMINATOR. A failing upgrade posts a comment and exits 0; cron
       re-dispatches it every tick with no bound, no Slack, no blocked-lane move. #657
       looped silently with zero human signal. `adwUpgrade` lives OUTSIDE the
       `initializeWorkflow` recovery kernel, so the #639 resume-cap / `human_gated`
       escalation never reaches it — the upgrade lane needs its OWN bounded cap.
    3. SELF-REVERTING COMMIT. `commitChanges` uses `git add -A`. The upgrade worktree
       carries a runtime-copied (gitignored-but-tracked-on-the-host) `.claude/commands/
       adw_init.md`; `git add -A` sweeps whatever version the cron host holds into the
       regen commit. Every upgrade commit touches `adw_init.md` — sometimes reverting
       merged work. This is how the receipt instruction was deleted in the first place.

  Part A — VALIDITY-ONLY REGEN GATE (replaces the receipt proof).
    `verifyAdwRegen` proves VALIDITY, not authorship: the six canonical `.adw/` files
    present and non-empty, plus `features/regression/vocabulary.md` present. The
    `.adw/.regen-receipt` existence/freshness checks and their dead helpers are removed,
    the now-unused `expectedHash` parameter is dropped, and the receipt is gitignored so
    it can never re-enter a commit. Rationale: a valid `.adw/` is valid whether the LLM
    rewrote it or left it byte-identical — the receipt only ever proved authorship (the
    irrelevant part) and was the part the reversion bug deleted. A clean no-op now stamps
    the hash and resumes, which is the intended behaviour and the loop-break.

  Part B — MAX_FAILURES CAP + ESCALATION.
    A bot-authored upgrade-failure comment is a durable, countable failure signal on the
    tracking issue. A new pure helper recognises exactly the comments
    `buildUpgradeFailureComment` produces (bot-authored; HITL-deferred and merge-failed
    comments are EXCLUDED) and counts them. `executeUpgrade` gains two gates: an ENTRY
    gate that exits immediately when a terminal label (`adw:blocked`) is already present
    (idempotent escalation, no re-dispatch work), and a CAP gate — placed AFTER the
    existing PR-idempotency guard so a claim that already has a PR never escalates — that,
    once the failure count reaches the cap, applies the terminal label, moves the board to
    Blocked, posts ONE Slack alert, posts a DISTINCT (non-failure-signature) escalation
    comment, and returns a new `escalated` outcome instead of regenerating.

  Part D — SCOPED REGEN COMMIT.
    `commitChanges` gains an optional `excludePaths`; when set it stages with a
    `:!<path>` exclude pathspec and scopes the porcelain check identically. With no opts
    it is byte-identical to today (every other caller untouched). `adwUpgrade` excludes
    `.claude/commands/adw_init.md`, so the genuine regen outputs (`.adw/`, `.adw-version`,
    real `target: true` `.claude` propagation) still commit while the runtime-copied
    command file is held out — and it is a no-op on target repos where that file is
    untracked.

  Observability / rot-prevention note:

    Every assertion below targets a runtime OUTPUT of the system under test — a function
    return value, a recorded call on an injected dependency, or a git artefact produced
    by the commit phase — NEVER the text, shape, or existence of a source file of this
    repo. No step reads `adws/adwUpgrade.tsx`, `adws/phases/worktreeSetup.ts`,
    `adws/core/upgradeFailureCap.ts`, `adws/core/config.ts`, `adws/gitContext/commitOps.ts`,
    `.claude/commands/adw_init.md`, or `.env.sample` as text, substring-matches its
    contents, or parses it as JSON/AST.

      • §A1–§A5 phase-import `verifyAdwRegen(worktreePath)` and assert the `{ ok, missing }`
        verdict it RETURNS over a temp worktree fixture the step constructs — the same
        INPUT-fixture-then-assert-the-return-value pattern feature-614 used for the
        receipt gate and feature-601 for the JUnit verdict. The `.adw/` files and the
        legacy receipt the steps write into the temp worktree are INPUT/artefact test data
        (the worktree-fixture category the Rot-Detection Rubric permits), NOT source files
        of this repo.
      • §B1–§B2 phase-import the pure `isUpgradeFailureComment` / `countUpgradeFailureComments`
        helpers and assert their returned verdict/count — a function-of-the-system return
        value, exactly the observable category feature-639 §1 asserts for `nextResumeAction`.
        The comment bodies are produced by calling the real `buildUpgrade*Comment` builders,
        so the scenarios pin the classifier-recognises-exactly-what-the-builder-emits
        CONTRACT (a round-trip), never a hard-coded substring of source.
      • §B3–§B6 phase-import `executeUpgrade` with an injected `UpgradeDeps` (the
        `makeDeps`-style fake the existing unit suite already uses) and assert the returned
        `outcome` plus the recorded calls on the injected `applyLabel` / `moveToStatus` /
        `postSlack` / `commentOnIssue` / `runInitCommand` / `createPullRequest` deps — the
        feature-639 §3 injected-commenter pattern. Driving through INJECTED deps (rather
        than the subprocess + mock server) is deliberate: the Projects-V2 board write and
        the fire-and-forget Slack ping are known blind spots of the mock-server harness, so
        only an injected-dep surface can observe the board move and the Slack alert at all.
      • §D1–§D3 drive the migrated `commitChanges` over a REAL temp git repo and assert the
        committed file set (`git show --name-only HEAD`) and the residual working-tree state
        (`git status --porcelain`) — git artefacts, registry observability surface #3.
      • §T1 asserts the type-checker's verdict (registry T22).

    The strings in the steps — stage-like tokens such as `escalated`, the label
    `adw:blocked`, the board status `Blocked`, and the `.adw/` filenames — are INPUT/OUTPUT
    test data (a value the system reads from or writes to an artefact, or a documented
    return-contract token named verbatim in the issue), exactly the artefact category the
    Rot-Detection Rubric permits. The acceptance criterion "`escalated` is a new outcome"
    is therefore proven BEHAVIOURALLY (the system returns it in §B3/§B5) and never by
    parsing the `UpgradeRunResult` union out of source — the same technique feature-639
    used to prove `human_gated` and feature-527 to prove `merge_blocked`.

  Scope notes:

    • SUPERSESSION of feature-614 §1–§3. feature-614 encoded the OLD pass criterion —
      a `.adw/.regen-receipt` whose `frameworkHash` matches the orchestrator's expected
      hash — and gated PASS/FAIL on receipt FRESHNESS:
        §1 fresh receipt → pass;  §2 stale receipt → fail;  §3 no receipt → fail.
      Part A retires the receipt entirely (validity, not authorship). Under the new gate
      the SAME worktrees resolve differently: a no-receipt worktree (§614 §3) now PASSES
      (this is the loop-break, pinned here as §A1) and a stale/legacy-receipt worktree
      (§614 §2) now PASSES (the receipt is ignored, pinned here as §A2). §614 §1's outcome
      (pass) still holds but its RATIONALE (the receipt freshness is why) is retired. The
      authoritative gate spec is now THIS file (§A1–§A5). feature-614's narrative and step
      defs are owned by #614 and are surfaced to the maintainer here rather than silently
      edited — exactly as feature-614 surfaced its own supersession of feature-572 §2 and
      feature-601 of feature-577 §4–§9. feature-614 §4–§5 (a missing `.adw/` file / missing
      vocabulary fails) are PRESERVED in behaviour and re-pinned here as §A3/§A5.
      IMPLEMENTER HEADS-UP: dropping the `expectedHash` parameter is a SIGNATURE change, so
      feature-614's step def (which calls `verifyAdwRegen(worktreePath, hash)`) and the
      receipt-specific cases in `worktreeSetup.test.ts` will need the maintainer's
      reconciliation for the type-check (§T1) and the @adw-614 suite to stay green; the
      issue's own Tests section calls for deleting those receipt-specific cases.

    • This is the UPGRADE-LANE cap, deliberately separate from the #639 resume cap. The
      shared knob is the `MAX_FAILURES` env constant; the COUNTING is upgrade-lane-specific
      (it tallies bot-authored GitHub failure comments, not a state-file `resumeAttempts`
      counter). The existing cap zoo (`MAX_RESUME_ATTEMPTS`, etc.) is NOT being migrated.

    • The failure cap is set EXPLICITLY per scenario as an injected input (defaulting to
      the `MAX_FAILURES` config constant in production), so these scenarios pin the
      boundary behaviour independent of the production default of 3 — mirroring feature-639's
      injected resume bound. Asserting the literal default 3 would couple the scenario to a
      config value (and reading it out of `config.ts` would be a prohibited source read).

    • The terminal label provisioning ("create `adw:blocked` on the repo before first use,
      like `regression-promotion`") is a one-time setup concern, pinned indirectly by §B3's
      label-application assertion (an apply presupposes existence) and otherwise owned by
      the implementer's deps wiring — nothing standalone to observe.

    • RE-ARM is NOT a separate scenario. A human removing the `adw:blocked` label (and
      clearing the failure comments, e.g. via `## Cancel`) returns the lane to the
      below-cap state, which is exactly §B4 (no terminal label + a failure count below the
      cap → proceeds) layered on §B2 (a cleared comment thread counts as zero). The
      directive-handler subprocess wiring for `## Cancel` is the implementer's unit surface,
      not drivable hermetically here.

    • Part D pins the OBSERVABLE commit content (which paths land in the regen commit and
      which remain pending), NOT the exact `git add` pathspec string the implementer emits.
      An implementer may construct the exclude pathspec however they like as long as the
      committed file set holds.

    • The @regression maintenance sweep is SKIPPED for this issue: `.adw/scenarios.md`
      configures a `## Regression Scenario Directory`, so promotion is a deliberate human
      decision and the agent never auto-promotes.

  Vocabulary note:

    Registered phrases reused (`features/regression/vocabulary.md`):
      G18 `the ADW codebase is checked out`
      T22 `the ADW TypeScript type-check passes`

    Novel phrasing introduced here — the registry has no phrase for the validity gate, the
    upgrade-failure classifier, the upgrade-lane cap/escalation, or the scoped commit; and
    feature-614's receipt-gate phrases encode the retired hash-keyed contract (and are
    bound to #614's own step-def `ctx`, so reusing them would cross-wire state under the
    globally-loaded step defs). All novel phrasing is surfaced to the maintainer in the
    agent Output. By part:

      Part A (validity gate):
        • `a regen target worktree carrying a complete, non-empty .adw/ directory and the regression vocabulary file`
        • `the regen target worktree additionally carries a legacy regen receipt stamped with framework hash {string}`
        • `the regen target worktree is missing the .adw/ config file {string}`
        • `the regen target worktree has an empty .adw/ config file {string}`
        • `the regen target worktree is missing the regression vocabulary file`
        • `the .adw/ regeneration validity is checked`
        • `the regeneration validity check passes`
        • `the regeneration validity check fails`
        • `the regeneration validity check reports {string} as a missing artefact`

      Part B (classifier + cap):
        • `the upgrade failure-comment classifier evaluates a {string} comment authored by {string}`
        • `the classifier recognises it as an upgrade failure comment: {string}`
        • `an upgrade tracking issue {int} whose comment thread holds {int} bot-authored upgrade-failure comments`
        • `the thread also holds one bot-authored HITL-deferred comment, one bot-authored merge-failed comment, and {int} human comments`
        • `the upgrade failure comments on the thread are counted`
        • `the upgrade failure-comment count is {int}`
        • `the upgrade tracking issue {int} already carries the terminal "adw:blocked" label`
        • `the upgrade claim branch already has an open pull request`
        • `the upgrade failure cap is set to {int}`
        • `the upgrade orchestration runs for tracking issue {int}`
        • `the upgrade orchestration outcome is {string}`
        • `the terminal "adw:blocked" label is applied to issue {int}`
        • `no terminal "adw:blocked" label is applied to issue {int}`
        • `the board moves issue {int} to "Blocked"`
        • `the board is not moved for issue {int}`
        • `exactly one Slack alert is posted`
        • `no Slack alert is posted`
        • `a distinct escalation comment is posted to issue {int}`
        • `the escalation comment is not itself classified as an upgrade failure comment`
        • `no escalation comment is posted to issue {int}`
        • `the .adw/ directory is regenerated`
        • `the .adw/ directory is not regenerated`
        • `a pull request is opened for issue {int}`
        • `no pull request is opened for issue {int}`

      Part D (scoped commit):
        • `a regen worktree with pending changes to {string}, {string}, and {string}`
        • `a regen worktree with a pending change to {string} and an untracked {string}`
        • `the regen changes are committed excluding {string}`
        • `the regen changes are committed without an exclude list`
        • `the resulting commit includes {string}`
        • `the resulting commit excludes {string}`
        • `{string} remains uncommitted in the worktree`

    Step-definition note for the maintainer:
      • §A1–§A5 build a temp worktree under the test tmp dir: write the six canonical
        `.adw/` files non-empty and `features/regression/vocabulary.md`, then mutate per the
        Given (omit/empty a named `.adw/` file, omit vocabulary, or drop in a legacy
        receipt). Phase-import `verifyAdwRegen(worktreePath)` — NOTE the post-#685 single-arg
        signature — and assert the returned `ok` and that `missing` contains the named token.
      • §B1–§B2 phase-import `isUpgradeFailureComment(body, author)` and
        `countUpgradeFailureComments(comments)` from `adws/core/upgradeFailureCap`. Map the
        `{string}` body kind to a real builder call — `upgrade-failure` →
        `buildUpgradeFailureComment(...)`, `hitl-deferred` → `buildUpgradeHitlComment(...)`,
        `merge-failed` → `buildUpgradeMergeFailedComment(...)`, `unrelated` → arbitrary text —
        and map the author `{string}` to the configured GitHub App bot login (`<slug>[bot]`)
        for `bot` and any non-bot login for `human`. Build the thread as
        `IssueCommentSummary[]` (body + author) for the count.
      • §B3–§B6 phase-import `executeUpgrade(issueNumber, adwId, repoInfo, baseRepoPath,
        frameworkRepoRoot, deps)` with a `makeDeps`-style fake: inject `fetchIssueComments`
        to return the seeded number of bot-authored upgrade-failure comments; capture
        `applyLabel`, `moveToStatus`, `postSlack`, `commentOnIssue`, `runInitCommand`, and
        `createPullRequest` as recording spies; set `findPRByBranch` to return a PR for the
        "already has an open pull request" Given (else null); set the injected failure cap
        per the Given. Assert `result.outcome` and the spy call counts/arguments. "Distinct
        escalation comment" asserts the captured escalation body is NOT recognised by
        `isUpgradeFailureComment` (guards against a self-inflating loop).
      • §D1–§D3 init a real temp git repo, commit a baseline, then create the pending
        changes named in the Given (modify tracked files; leave the untracked variant
        unstaged and never previously committed). Drive the migrated `commitChanges`
        (`adws/gitContext/commitOps` `commitChanges`, or `GitContext.commitChanges`) with and
        without `{ excludePaths }`, then assert `git show --name-only --format= HEAD`
        includes/excludes each path and `git status --porcelain` still lists the held-out
        file.

  Background:
    Given the ADW codebase is checked out

  # ════════════════════════════════════════════════════════════════════════════════
  # Part A — validity-only regen gate (verifyAdwRegen proves validity, not authorship)
  # ════════════════════════════════════════════════════════════════════════════════

  # ── §A1 The loop-break: a valid no-op with NO receipt now passes ──────────────────
  #
  # THE fix for the coin-flip gate. A worktree whose `.adw/` is complete and non-empty
  # and whose vocabulary file is present passes verification with NO receipt at all —
  # the byte-identical regeneration that #614's receipt gate failed whenever the LLM
  # did not happen to write the receipt. This is what lets the orchestrator stamp
  # `.adw-version` and open the version-bump PR instead of looping. (Supersedes
  # feature-614 §3, which failed this exact worktree.)

  @adw-685 @adw-jrlonn-fix-harden-adwupgrad
  Scenario: A valid .adw/ with no regen receipt passes the validity gate
    Given a regen target worktree carrying a complete, non-empty .adw/ directory and the regression vocabulary file
    When the .adw/ regeneration validity is checked
    Then the regeneration validity check passes

  # ── §A2 The receipt is now irrelevant: a legacy/stale receipt still passes ────────
  #
  # The same valid worktree, additionally carrying a leftover `.adw/.regen-receipt`
  # holding an OLD framework hash — the "stale receipt" #614 §2 failed on. Validity is
  # validity regardless of authorship, so verification PASSES; the receipt is neither
  # read nor required. (Supersedes feature-614 §2.)

  @adw-685 @adw-jrlonn-fix-harden-adwupgrad
  Scenario: A valid .adw/ carrying a stale legacy regen receipt still passes the validity gate
    Given a regen target worktree carrying a complete, non-empty .adw/ directory and the regression vocabulary file
    And the regen target worktree additionally carries a legacy regen receipt stamped with framework hash "34e7e1290a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8091a2b3c4d5e6f70819"
    When the .adw/ regeneration validity is checked
    Then the regeneration validity check passes

  # ── §A3 #572 brick protection preserved: a missing .adw/ file fails ───────────────
  #
  # The file-presence branch is untouched: a missing required `.adw/` config file FAILS
  # and the verdict names it, so a genuinely empty/unverified `.adw/` cannot advance the
  # version. (Re-pins feature-614 §4 / feature-572 §1 under the new receipt-free gate.)

  @adw-685 @adw-jrlonn-fix-harden-adwupgrad
  Scenario: A missing required .adw/ config file fails the validity gate
    Given a regen target worktree carrying a complete, non-empty .adw/ directory and the regression vocabulary file
    And the regen target worktree is missing the .adw/ config file "project.md"
    When the .adw/ regeneration validity is checked
    Then the regeneration validity check fails
    And the regeneration validity check reports "project.md" as a missing artefact

  # ── §A4 The non-empty clause: an empty .adw/ file fails ───────────────────────────
  #
  # Presence alone is insufficient — a zero-byte required file FAILS and is named. This
  # pins the "present AND non-empty" half of the validity criterion.

  @adw-685 @adw-jrlonn-fix-harden-adwupgrad
  Scenario: An empty required .adw/ config file fails the validity gate
    Given a regen target worktree carrying a complete, non-empty .adw/ directory and the regression vocabulary file
    And the regen target worktree has an empty .adw/ config file "commands.md"
    When the .adw/ regeneration validity is checked
    Then the regeneration validity check fails
    And the regeneration validity check reports "commands.md" as a missing artefact

  # ── §A5 Vocabulary presence preserved: a missing vocabulary file fails ────────────
  #
  # Same AND semantics on the vocabulary branch: an absent
  # `features/regression/vocabulary.md` FAILS and the verdict names it. (Re-pins
  # feature-614 §5.)

  @adw-685 @adw-jrlonn-fix-harden-adwupgrad
  Scenario: A missing regression vocabulary file fails the validity gate
    Given a regen target worktree carrying a complete, non-empty .adw/ directory and the regression vocabulary file
    And the regen target worktree is missing the regression vocabulary file
    When the .adw/ regeneration validity is checked
    Then the regeneration validity check fails
    And the regeneration validity check reports "features/regression/vocabulary.md" as a missing artefact

  # ════════════════════════════════════════════════════════════════════════════════
  # Part B — MAX_FAILURES cap + escalation
  # ════════════════════════════════════════════════════════════════════════════════

  # ── §B1 The classifier recognises ONLY bot-authored upgrade-failure comments ──────
  #
  # `isUpgradeFailureComment(body, author)` is the pure core of the cap. It recognises
  # exactly the comment `buildUpgradeFailureComment` emits, and ONLY when bot-authored:
  # the sibling HITL-deferred and merge-failed bot comments are EXCLUDED (different
  # signatures), and a human pasting the failure text is EXCLUDED (authorship). Getting
  # this wrong would either miscount toward a premature escalation or never escalate.

  @adw-685 @adw-jrlonn-fix-harden-adwupgrad
  Scenario Outline: The upgrade failure-comment classifier matches only the bot-authored failure signature
    When the upgrade failure-comment classifier evaluates a "<kind>" comment authored by "<author>"
    Then the classifier recognises it as an upgrade failure comment: "<recognised>"

    Examples:
      | kind            | author | recognised |
      | upgrade-failure | bot    | true       |
      | hitl-deferred   | bot    | false      |
      | merge-failed    | bot    | false      |
      | upgrade-failure | human  | false      |
      | unrelated       | bot    | false      |

  # ── §B2 The counter tallies only the failure comments in a mixed thread ───────────
  #
  # `countUpgradeFailureComments` filters a real thread down to the bot-authored
  # failure comments — the durable failure signal the cap reads. Sibling bot comments
  # (HITL, merge-failed) and human comments must not inflate the count.

  @adw-685 @adw-jrlonn-fix-harden-adwupgrad
  Scenario: The upgrade failure counter tallies only the bot-authored failure comments in a mixed thread
    Given an upgrade tracking issue 6850 whose comment thread holds 3 bot-authored upgrade-failure comments
    And the thread also holds one bot-authored HITL-deferred comment, one bot-authored merge-failed comment, and 2 human comments
    When the upgrade failure comments on the thread are counted
    Then the upgrade failure-comment count is 3

  # ── §B3 At the cap, the upgrade escalates instead of regenerating (AC: Part B) ────
  #
  # The spend-stopping point. When the failure count has reached the cap, the upgrade
  # does NOT regenerate — it applies the terminal `adw:blocked` label, moves the board
  # to Blocked, posts exactly ONE Slack alert, posts a DISTINCT escalation comment
  # (deliberately NOT the failure signature, so it cannot inflate the count and re-trip
  # the cap), and returns the new `escalated` outcome. The distinct-comment assertion
  # round-trips through §B1's classifier to prove the no-self-inflation contract.

  @adw-685 @adw-jrlonn-fix-harden-adwupgrad
  Scenario: An upgrade at the failure cap escalates to a human with a label, board move, one Slack alert, and a distinct comment
    Given an upgrade tracking issue 6851 whose comment thread holds 3 bot-authored upgrade-failure comments
    And the upgrade failure cap is set to 3
    When the upgrade orchestration runs for tracking issue 6851
    Then the upgrade orchestration outcome is "escalated"
    And the terminal "adw:blocked" label is applied to issue 6851
    And the board moves issue 6851 to "Blocked"
    And exactly one Slack alert is posted
    And a distinct escalation comment is posted to issue 6851
    And the escalation comment is not itself classified as an upgrade failure comment
    And the .adw/ directory is not regenerated
    And no pull request is opened for issue 6851

  # ── §B4 Below the cap, the upgrade proceeds normally with no escalation (AC: Part B)
  #
  # The headroom case. With the failure count below the cap and no terminal label, the
  # upgrade regenerates and opens its PR exactly as today — and applies NO label, moves
  # NO board, posts NO Slack. This is also the RE-ARM end-state: after a human clears the
  # label and the failure comments, the lane is back here.

  @adw-685 @adw-jrlonn-fix-harden-adwupgrad
  Scenario: An upgrade below the failure cap proceeds and opens its PR without escalating
    Given an upgrade tracking issue 6852 whose comment thread holds 2 bot-authored upgrade-failure comments
    And the upgrade failure cap is set to 3
    When the upgrade orchestration runs for tracking issue 6852
    Then the upgrade orchestration outcome is "completed"
    And the .adw/ directory is regenerated
    And a pull request is opened for issue 6852
    And no terminal "adw:blocked" label is applied to issue 6852
    And the board is not moved for issue 6852
    And no Slack alert is posted

  # ── §B5 Entry gate: an already-labelled issue exits immediately, idempotently ─────
  #
  # Once escalated, re-dispatch must do NOTHING — no regeneration, no PR, and no DUPLICATE
  # Slack alert or escalation comment. The entry gate sees the terminal label and exits
  # with the `escalated` outcome, so cron re-dispatching the blocked issue every tick is
  # silent and free. This is what makes escalation idempotent.

  @adw-685 @adw-jrlonn-fix-harden-adwupgrad
  Scenario: An upgrade on an already-blocked issue exits immediately without repeating any escalation work
    Given the upgrade tracking issue 6853 already carries the terminal "adw:blocked" label
    And the upgrade failure cap is set to 3
    When the upgrade orchestration runs for tracking issue 6853
    Then the upgrade orchestration outcome is "escalated"
    And the .adw/ directory is not regenerated
    And no pull request is opened for issue 6853
    And no Slack alert is posted
    And no escalation comment is posted to issue 6853

  # ── §B6 Ordering: a claim that already has a PR never escalates (AC: Part B) ───────
  #
  # The cap gate sits AFTER the existing PR-idempotency guard. So even when the failure
  # count is at or over the cap, a claim branch that already has a PR resolves to the
  # unchanged `completed` / pr_already_exists no-op — it does NOT escalate. This protects
  # an upgrade that genuinely reached the PR stage from being mislabelled as blocked.

  @adw-685 @adw-jrlonn-fix-harden-adwupgrad
  Scenario: An upgrade whose claim branch already has a PR completes without escalating even at the failure cap
    Given an upgrade tracking issue 6854 whose comment thread holds 3 bot-authored upgrade-failure comments
    And the upgrade failure cap is set to 3
    And the upgrade claim branch already has an open pull request
    When the upgrade orchestration runs for tracking issue 6854
    Then the upgrade orchestration outcome is "completed"
    And no terminal "adw:blocked" label is applied to issue 6854
    And the board is not moved for issue 6854
    And no Slack alert is posted
    And the .adw/ directory is not regenerated

  # ════════════════════════════════════════════════════════════════════════════════
  # Part D — scoped regen commit
  # ════════════════════════════════════════════════════════════════════════════════

  # ── §D1 excludePaths holds the runtime-copied command file out of the regen commit ─
  #
  # The reversion fix. A regen worktree dirty across the genuine outputs AND the
  # runtime-copied `.claude/commands/adw_init.md`: committing with the exclude lands the
  # genuine outputs (`.adw/`, `.adw-version`) in the commit while `adw_init.md` is held
  # out and stays pending in the worktree — so the upgrade commit can no longer revert
  # whatever version of that command file the cron host happened to hold.

  @adw-685 @adw-jrlonn-fix-harden-adwupgrad
  Scenario: A scoped commit stages the genuine regen outputs but holds out the runtime-copied command file
    Given a regen worktree with pending changes to ".adw/project.md", ".adw-version", and ".claude/commands/adw_init.md"
    When the regen changes are committed excluding ".claude/commands/adw_init.md"
    Then the resulting commit includes ".adw/project.md"
    And the resulting commit includes ".adw-version"
    And the resulting commit excludes ".claude/commands/adw_init.md"
    And ".claude/commands/adw_init.md" remains uncommitted in the worktree

  # ── §D2 No opts is byte-identical to today (every other caller untouched) ─────────
  #
  # The regression guard for all OTHER callers. With no exclude list, the same dirty
  # worktree commits EVERYTHING — including `.claude/commands/adw_init.md` — exactly as
  # `git add -A` does today. This proves the new parameter is purely additive.

  @adw-685 @adw-jrlonn-fix-harden-adwupgrad
  Scenario: A commit with no exclude list stages every pending change exactly as before
    Given a regen worktree with pending changes to ".adw/project.md", ".adw-version", and ".claude/commands/adw_init.md"
    When the regen changes are committed without an exclude list
    Then the resulting commit includes ".adw/project.md"
    And the resulting commit includes ".adw-version"
    And the resulting commit includes ".claude/commands/adw_init.md"

  # ── §D3 No-op on a target repo where the excluded path is untracked ───────────────
  #
  # On a target repo that never tracked `.claude/commands/adw_init.md`, excluding it is a
  # harmless no-op: the genuine output still commits and the untracked file simply stays
  # untracked. The exclude pathspec must not error on an absent/untracked path.

  @adw-685 @adw-jrlonn-fix-harden-adwupgrad
  Scenario: Excluding an untracked path is a no-op that still commits the genuine output
    Given a regen worktree with a pending change to ".adw/project.md" and an untracked ".claude/commands/adw_init.md"
    When the regen changes are committed excluding ".claude/commands/adw_init.md"
    Then the resulting commit includes ".adw/project.md"
    And ".claude/commands/adw_init.md" remains uncommitted in the worktree

  # ════════════════════════════════════════════════════════════════════════════════
  # §T1 Type-check backstop
  # ════════════════════════════════════════════════════════════════════════════════

  # The new `escalated` outcome, the `excludePaths` option, the dropped `expectedHash`
  # parameter (and its callsite + deps-type), the new `upgradeFailureCap` helpers, and the
  # new `MAX_FAILURES` constant keep the ADW codebase type-clean. A backstop consistent
  # with feature-614 §6 and feature-639 §6.

  @adw-685 @adw-jrlonn-fix-harden-adwupgrad
  Scenario: The ADW TypeScript type-check passes with the upgrade-hardening changes wired in
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
