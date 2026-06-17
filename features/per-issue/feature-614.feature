@adw-614 @adw-ih7bza-fix-adwupgrade-infin
Feature: adwUpgrade receipt-based proof-of-execution — verifyAdwRegen gates on receipt freshness, not on a `.adw/` content diff

  Issue #614 fixes an **infinite self-upgrade loop** in `adwUpgrade.tsx`. When a
  framework hash bump comes from a `hashInputs` change that does NOT alter the
  `.adw/` config generated for a given repo, `/adw_init` regenerates byte-identical
  `.adw/`, the old `verifyAdwRegen` sees no `git status -- .adw` diff and returns
  `{ ok: false }`, the orchestrator returns `regen_incomplete` (no `.adw-version`
  stamp, no PR), and the `adw:upgrade` tracking issue is re-dispatched by cron every
  tick — burning spend forever (live incident 2026-06-17: hash `34e7e129…` →
  `c1acb23f…`, looping on tracking issue #613).

  Root cause: the #572 anti-brick gate used **"the `.adw/` artefact changed"** as a
  proxy for **"the agent actually did its job."** That proxy is wrong — a `hashInput`
  change can legitimately produce zero `.adw/` diff. On a repo that already has valid
  `.adw/`, the two cases the diff-check conflates leave **byte-identical filesystem
  state** and no post-hoc inspection can separate them:
    • LEGITIMATE NO-OP — the agent ran, correctly concluded `.adw/` needs no change.
    • SILENT SKIP — the agent skipped/botched the work, leaving the old `.adw/`.

  The fix replaces the diff requirement with a **direct proof-of-execution signal**: an
  agent-written receipt `.adw/.regen-receipt` carrying `frameworkHash: <currentHash>`.
  `verifyAdwRegen(worktreePath, expectedHash)` now gates on receipt FRESHNESS. The
  claim branch is checked out off the default branch, which carries the *previous*
  receipt holding the *old* hash; a real run rewrites it to the current hash, a silent
  skip leaves the old hash. Same filesystem, opposite verdicts — keyed solely on the
  receipt.

  The behavioural contract pinned below (the new `verifyAdwRegen` decision):

    1. LEGITIMATE NO-OP PASSES (AC3, the loop-break). On a worktree whose `.adw/` is
       valid and committed with ZERO pending content change, a receipt stamped with the
       expected hash makes verification PASS — exactly the case the old diff-gate
       bricked. This is what lets the orchestrator stamp `.adw-version` and open the
       version-bump PR instead of looping.
    2. SILENT SKIP FAILS (AC4). On the SAME byte-identical worktree, a receipt holding a
       STALE hash makes verification FAIL — the silent-skip the old diff-gate could not
       distinguish from the legitimate no-op.
    3. RECEIPT ABSENT FAILS (AC4). A valid `.adw/` with no receipt at all FAILS — a run
       that never wrote the proof cannot advance the version.
    4. MISSING `.adw/` FILE STILL FAILS (AC5, no #572 regression). A missing or empty
       required `.adw/` config file FAILS even when a fresh receipt is present — the
       receipt is ANDed with the file-presence check, never a bypass.
    5. MISSING VOCABULARY STILL FAILS. An absent `features/regression/vocabulary.md`
       FAILS even with a fresh receipt — same AND semantics, vocabulary branch.
    6. TYPE-CHECK BACKSTOP. The ADW TypeScript type-check still passes after the
       `verifyAdwRegen` signature gains `expectedHash` and the diff check is removed.

  Observability / rot-prevention note:

    Every assertion below targets the VERDICT `verifyAdwRegen` PRODUCES — the
    `{ ok, missing }` value it returns over a worktree fixture the step constructs —
    never the text, shape, or existence of a source file of this repo:

      • §1–§3 assert the boolean pass/fail `verifyAdwRegen` resolves over a worktree
        whose `.adw/`, vocabulary file, and `.adw/.regen-receipt` the step writes as
        INPUT — the same INPUT-fixture-then-assert-the-return-value pattern feature-538
        uses for `.adw-version` and feature-601 uses for the JUnit verdict.
      • §4–§5 additionally assert the `missing` list the verdict carries, proving WHICH
        branch failed (file vs vocabulary) rather than the receipt masking it.
      • §6 asserts the type-checker's verdict (registry T22).

    The `.adw/.regen-receipt` and the six `.adw/` files the steps write into a temp
    worktree are INPUT/artefact test data — the target repo's data files, the same
    category the Rot-Detection Rubric permits (state files written, worktree fixtures) —
    NOT source files of this repo. No step reads `adws/adwUpgrade.tsx`,
    `adws/phases/worktreeSetup.ts`, `.claude/commands/adw_init.md`, or any other source
    file as text, substring-matches its contents, or parses it as JSON/AST.

  Scope notes:

    • AC1 (`/adw_init` writes `.adw/.regen-receipt` with `frameworkHash: <currentHash>`
      as its final step, committed) is a PROMPT change in `.claude/commands/adw_init.md`.
      Like feature-572's note that "a live Claude run actually regenerates `.adw/`
      remains the implementer's MANUAL smoke check — genuinely infeasible in CI because
      the mock CLI stub cannot write `.adw/`", a stubbed `/adw_init` cannot prove the
      prompt writes the receipt. AC1 is owned by the prompt rewrite + the `pr_review`
      reviewer + the live run. Its OBSERVABLE proxy is §1: a worktree carrying a fresh
      receipt is exactly the artefact the prompt's final step must produce, and §1 pins
      that such a worktree passes verification.

    • The END-TO-END orchestrator outcome — gate-pass → `writeAdwVersion` +
      `createPullRequest`; gate-fail → non-workflow failure comment, no stamp, no PR,
      clean cron re-dispatch — is the UNCHANGED `executeUpgrade` wiring. The issue states
      it explicitly: "on pass → … (unchanged). On fail → existing non-workflow failure
      comment … self-heal as today." That wiring is already pinned at the orchestrator
      surface by feature-572 §1/§2 (W1) and by this issue's dep-injected `UpgradeDeps`
      unit tests (Tests 1–4). The genuinely-NEW decision #614 introduces lives entirely
      in `verifyAdwRegen`'s receipt-freshness criterion, pinned hermetically here as
      §1–§5, so the end-to-end is not re-pinned (and these sections run NOW rather than
      PENDING on the ISSUE-3-CUTOVER W1 driver).

    • SUPERSESSION of feature-572 §2. feature-572 §2 ("A regenerated .adw/ passes the
      gate") encodes the OLD pass criterion — six files + vocabulary + a non-trivial
      `.adw/` DIFF — and seeds no receipt. #614 removes the diff requirement and adds the
      receipt-freshness requirement, so once both #614 and the W1 driver are live, that
      receipt-less worktree would FAIL the new gate: feature-572 §2 encodes a criterion
      #614 retires. The authoritative gate spec is now THIS file (§1–§5). This is
      surfaced to the maintainer rather than silently editing a sibling per-issue file —
      feature-572 §2's narrative and step defs are owned by #572 — exactly as feature-572
      surfaced its own supersession of feature-541 §1–§3 and feature-601 of feature-577
      §4–§9. feature-572 §1 (empty/unverified `.adw/` → no stamp, no PR, failure comment)
      is UNCHANGED: the file-presence branch is preserved (AC5, pinned here as §4), so §1
      stays valid.

    • The `verifyAdwRegen` signature gaining `expectedHash` and the removal of the
      `git status --porcelain -- .adw` line are SOURCE-STRUCTURE facts, deliberately NOT
      asserted (rot-prevention). Their OBSERVABLE proxies: §1 — a zero-content-diff
      worktree now passes, which is only possible once the diff check is gone AND the
      receipt is honoured; §2 — a stale receipt fails, only possible once the hash is
      compared. Those belong to the implementer's `verifyAdwRegen` unit tests (Test 5).

    • Per-file content hashes in the receipt are explicitly DROPPED by the grilled design
      (near-zero protection beyond presence + freshness); the receipt stays one line, so
      no scenario asserts per-file digests.

    • The gate-disarm operational note (bump `.adw-version` to the current hash before
      self-hosting this fix, so the still-armed gate does not re-trigger the loop while it
      is broken) is a one-time human chore — nothing to observe or automate — and is out
      of scope here.

    • The `@regression` maintenance sweep is SKIPPED for this issue: `.adw/scenarios.md`
      configures a `## Regression Scenario Directory`, so promotion is a deliberate human
      decision and the agent never auto-promotes.

  Vocabulary note:

    Reused registered phrases (`features/regression/vocabulary.md`):
      G18 (`the ADW codebase is checked out`),
      T22 (`the ADW TypeScript type-check passes`).

    Novel phrasing introduced here — the registry has no receipt / regeneration-
    verification phrase, and the predecessor feature-572's gate phrases are bound to its
    own orchestrator-subprocess `ctx` (reusing them would cross-wire per-feature state
    under the globally-loaded step defs). The gap is surfaced to the maintainer in the
    agent Output:
      • `a target worktree whose complete .adw/ directory and regression vocabulary file are committed with no pending content changes`
      • `a target worktree with a complete .adw/ directory and regression vocabulary file`
      • `the target worktree carries a regen receipt stamped with framework hash {string}`
      • `the target worktree carries no regen receipt`
      • `the target worktree is missing the .adw/ config file {string}`
      • `the target worktree is missing the regression vocabulary file`
      • `the .adw/ regeneration is verified against framework hash {string}`
      • `the regeneration verification passes`
      • `the regeneration verification fails`
      • `the regeneration verification reports {string} as a missing artefact`

  Background:
    Given the ADW codebase is checked out

  # ── §1 Legitimate no-op — a fresh receipt passes despite zero content diff ─────
  #
  # THE loop-break. The worktree's `.adw/` is valid and committed with no pending
  # content change — the byte-identical regeneration the old diff-gate read as
  # `{ ok: false }` and looped on forever. A receipt stamped with the EXPECTED hash
  # proves `/adw_init` ran to completion, so verification PASSES and the orchestrator
  # can stamp `.adw-version` and open the version-bump PR. (AC3; the receipt-hash-match
  # pass branch of the implementer's Test 5; the gate-level cause of Test 1.)

  @adw-614 @adw-ih7bza-fix-adwupgrade-infin
  Scenario: A legitimate no-op regen with a fresh receipt passes the gate even with zero .adw/ content diff
    Given a target worktree whose complete .adw/ directory and regression vocabulary file are committed with no pending content changes
    And the target worktree carries a regen receipt stamped with framework hash "c1acb23f5e6d7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b"
    When the .adw/ regeneration is verified against framework hash "c1acb23f5e6d7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b"
    Then the regeneration verification passes

  # ── §2 Silent skip — a stale receipt fails on the identical filesystem state ───
  #
  # The same byte-identical worktree as §1, differing ONLY in the receipt: it holds
  # the STALE (default-branch) hash a silent-skip `/adw_init` failed to update. The old
  # diff-gate could not tell this apart from §1 (both zero-diff); the receipt does.
  # Verification FAILS — no stamp, no PR. (AC4; Test 2; the receipt-hash-mismatch branch
  # of Test 5.)

  @adw-614 @adw-ih7bza-fix-adwupgrade-infin
  Scenario: A silent skip leaving a stale receipt fails the gate on the same zero-diff worktree
    Given a target worktree whose complete .adw/ directory and regression vocabulary file are committed with no pending content changes
    And the target worktree carries a regen receipt stamped with framework hash "34e7e1290a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8091a2b3c4d5e6f70819"
    When the .adw/ regeneration is verified against framework hash "c1acb23f5e6d7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b"
    Then the regeneration verification fails

  # ── §3 Receipt absent — a run that wrote no proof fails ────────────────────────
  #
  # Valid, committed `.adw/` but NO `.adw/.regen-receipt` at all. Absent proof cannot
  # advance the version, so verification FAILS. (AC4; the receipt-presence branch of
  # Test 5.)

  @adw-614 @adw-ih7bza-fix-adwupgrade-infin
  Scenario: A worktree with no regen receipt fails the gate
    Given a target worktree whose complete .adw/ directory and regression vocabulary file are committed with no pending content changes
    And the target worktree carries no regen receipt
    When the .adw/ regeneration is verified against framework hash "c1acb23f5e6d7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b"
    Then the regeneration verification fails

  # ── §4 #572 preserved — a missing .adw/ file fails despite a fresh receipt ─────
  #
  # The receipt is ANDed with the file-presence check, never a bypass: a missing
  # required `.adw/` config file FAILS even with a fresh, matching receipt, and the
  # verdict reports that file as missing — proving the receipt does not mask the
  # #572 brick protection. (AC5; Test 3; the files branch of Test 5.)

  @adw-614 @adw-ih7bza-fix-adwupgrade-infin
  Scenario: A missing required .adw/ config file fails the gate even with a fresh receipt
    Given a target worktree with a complete .adw/ directory and regression vocabulary file
    And the target worktree is missing the .adw/ config file "project.md"
    And the target worktree carries a regen receipt stamped with framework hash "c1acb23f5e6d7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b"
    When the .adw/ regeneration is verified against framework hash "c1acb23f5e6d7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b"
    Then the regeneration verification fails
    And the regeneration verification reports "project.md" as a missing artefact

  # ── §5 Vocabulary preserved — a missing vocabulary file fails despite a receipt ─
  #
  # Same AND semantics on the vocabulary branch: an absent
  # `features/regression/vocabulary.md` FAILS even with a fresh receipt, and the verdict
  # reports the vocabulary path as missing. (The vocabulary branch of Test 5.)

  @adw-614 @adw-ih7bza-fix-adwupgrade-infin
  Scenario: A missing regression vocabulary file fails the gate even with a fresh receipt
    Given a target worktree with a complete .adw/ directory and regression vocabulary file
    And the target worktree is missing the regression vocabulary file
    And the target worktree carries a regen receipt stamped with framework hash "c1acb23f5e6d7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b"
    When the .adw/ regeneration is verified against framework hash "c1acb23f5e6d7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b"
    Then the regeneration verification fails
    And the regeneration verification reports "features/regression/vocabulary.md" as a missing artefact

  # ── §6 Type-check backstop ─────────────────────────────────────────────────────

  @adw-614 @adw-ih7bza-fix-adwupgrade-infin
  Scenario: TypeScript type-check passes after the receipt-freshness gate lands
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
