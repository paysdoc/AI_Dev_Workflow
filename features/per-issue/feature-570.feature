@adw-570 @adw-nm1413-adwupgrade-pr-body-u
Feature: adwUpgrade PR body carries a `Closes #N` closing keyword so the upgrade tracking issue auto-closes on merge

  Issue #570 fixes a keyword bug in the upgrade orchestrator. `buildUpgradePrBody`
  (`adws/adwUpgrade.tsx`) hand-rolled its PR body with `Implements #<N>`, which is
  **not** a GitHub closing keyword — it creates only a bare cross-reference. As a
  result the `adw:upgrade` tracking issue never auto-closes on merge, never gains a
  Development-section linked-PR relationship (the chip Projects renders), and stays
  `OPEN` forever. Any issue parked behind it via `## Blocked by #N` then stays
  blocked **permanently**, because `findOpenDependencies` keys on the dependency
  issue's state being `OPEN`.

  Confirmed incident (2026-06-11): #565 hit the upgrade gate, parked with
  `## Blocked by #566`, and spawned `adwUpgrade` for tracking issue #566. The
  upgrade ran and PRs #567/#568 merged into `dev` with the correct `.adw-version`,
  but #566 stayed OPEN — its timeline shows only `cross-referenced` events, never a
  `connected`/development link — because the PR bodies said `Implements #566`
  instead of `Closes #566`. Consequently #565 is parked forever.

  The fix is keyword-only and **additive**:

    1. `buildUpgradePrBody` adds a `Closes #<N>` line. GitHub honours `Closes` to
       auto-close the tracking issue (and create the linked-PR relationship) on
       merge to the default branch, regardless of WHO merges — so it covers both
       the auto-merge path and the HITL-human-merge path (where the orchestrator
       has already exited and an explicit close call could not fire). The tracking
       issue and PR are always in the same repo, so plain `Closes #<N>` (no
       cross-repo `owner/repo#N` form) suffices.
    2. `Implements #<N>` is RETAINED as the first line — defense-in-depth. If
       auto-close ever silently fails, `linkedPrDetector` still recognises the
       merged PR, so `concurrencyGuard` will not over-count and `cronLabelEligibility`
       will not re-spawn.

  The normal SDLC path is unaffected — `/pull_request` already emits `Closes #N`.
  Only the hand-rolled upgrade body carried the wrong keyword.

  The behavioural contract pinned below:

    1. On a happy upgrade run, the PR the orchestrator opens carries a
       `Closes #<N>` closing keyword for the tracking issue — the keyword that
       drives auto-close on merge. (the fix)
    2. That same PR body additively RETAINS the `Implements #<N>` cross-reference
       alongside `Closes #<N>`, preserving the `linkedPrDetector` backstop. (a
       "fix" that REPLACED rather than ADDED the keyword would regress this.)
    3. The type-check backstop still passes.

  Observability / rot-prevention note:

    The PR body is an OUTPUT the orchestrator sends to GitHub: the mock GitHub API
    captures the PR-creation POST — body included — as a recorded request
    (vocabulary Observability Surface 2 / "Mock query"; the same recorded-request
    category behind T8 `recorded a PR creation` and T3 `recorded a comment
    containing the text`). Asserting that recorded PR-creation body contains
    `Closes #<N>` / `Implements #<N>` therefore pins observable behaviour, NOT a
    source-code property.

    No step reads `adws/adwUpgrade.tsx` (or any source file) as text,
    substring-matches its contents, or parses it as JSON/AST. The doc-comment
    correction at `adwUpgrade.tsx:20-21` called for in the issue is a source-comment
    edit and is intentionally NOT asserted — asserting a source comment would
    violate the framework Rot-Prevention rule.

    GitHub's actual keyword-driven issue auto-closure on merge is GitHub's own
    behaviour and is out of the deterministic harness's reach (the mock records
    requests; it does not emulate GitHub parsing a PR body and closing an issue).
    The closest artefact the ADW system itself controls — and the exact thing #570
    got wrong — is the PR body it emits. That is what these scenarios pin.

  Scope notes:

    • Like the sibling per-issue file feature-541 (which builds this orchestrator),
      these scenarios drive the real `adwUpgrade.tsx` subprocess against the
      claude-cli-stub + mock GitHub API + a temp target worktree, and assert on the
      recorded PR-creation request. They REUSE feature-541's happy-path harness
      setup verbatim, adding only the PR-body-content assertions #570 introduces.
    • feature-541's existing `Implements #N` coverage is via its source-inspection
      backstop only; this file pins both keywords behaviourally on the recorded PR
      body. The two files are complementary and neither supersedes the other.
    • Out of scope (separate follow-ups named in the issue): the duplicate
      `adwUpgrade` spawn (`findPRByBranch` TOCTOU race), non-deterministic
      `/adw_init` regeneration, and remediating already-merged-but-open upgrade
      issues (handled manually).

  Vocabulary note:

    Reused registered phrases (`features/regression/vocabulary.md`):
      G18 (`the ADW codebase is checked out`),
      G3  (`the claude-cli-stub is loaded with manifest {string}`),
      G4  (`an issue {int} exists in the mock issue tracker`),
      G11 (`the worktree for adwId {string} is initialised at branch {string}`),
      G1  (`the mock GitHub API is configured to accept issue comments`),
      W1  (`the {string} orchestrator is invoked with adwId {string} and issue {int}`),
      T5  (`the orchestrator subprocess exited {int}`),
      T8  (`the mock GitHub API recorded a PR creation for issue {int}`),
      and the cross-cutting `the ADW TypeScript type-check passes` backstop.

    Reused from the sibling per-issue file feature-541 (established there, not in
    the registry):
      `the upgrade branch {string} already carries the empty upgrade-claim commit`.

    Novel phrasing introduced here (no registered phrase fits — the registry has no
    PR-body-content phrase; this one extends T8 with a body-content qualifier
    exactly as T3 extends T2 for comment bodies). The gap is surfaced to the
    maintainer in the agent Output:
      • `the mock GitHub API recorded a PR creation for issue {int} with a body containing {string}`

  Background:
    Given the ADW codebase is checked out

  # ── §1 The fix — the upgrade PR carries a `Closes #N` closing keyword ─────────
  #
  # The PR the orchestrator opens for the tracking issue must contain `Closes #<N>`,
  # the keyword GitHub honours to auto-close the issue on merge. Before #570 the
  # body said only `Implements #<N>`, so the tracking issue stayed OPEN forever and
  # any dependent parked behind it was blocked permanently.

  @adw-570 @adw-nm1413-adwupgrade-pr-body-u
  Scenario: The upgrade PR body contains a `Closes #N` closing keyword for the tracking issue
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/adw-upgrade-regen-happy.json"
    And an issue 7570 exists in the mock issue tracker
    And the worktree for adwId "upgrade-7570" is initialised at branch "adw-upgrade-e5f6a7b8"
    And the upgrade branch "adw-upgrade-e5f6a7b8" already carries the empty upgrade-claim commit
    And the mock GitHub API is configured to accept issue comments
    When the "upgrade" orchestrator is invoked with adwId "upgrade-7570" and issue 7570
    Then the orchestrator subprocess exited 0
    And the mock GitHub API recorded a PR creation for issue 7570
    And the mock GitHub API recorded a PR creation for issue 7570 with a body containing "Closes #7570"

  # ── §2 Additive — the `Implements #N` backstop is retained alongside `Closes` ─
  #
  # The fix is additive, not a swap. The same PR body must keep `Implements #<N>`
  # so the `linkedPrDetector` backstop still recognises the merged PR if auto-close
  # ever silently fails. A regression that REPLACED `Implements` with `Closes`
  # would pass §1 but fail here.

  @adw-570 @adw-nm1413-adwupgrade-pr-body-u
  Scenario: The upgrade PR body retains the `Implements #N` cross-reference alongside the `Closes #N` keyword
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/adw-upgrade-regen-happy.json"
    And an issue 7571 exists in the mock issue tracker
    And the worktree for adwId "upgrade-7571" is initialised at branch "adw-upgrade-f6a7b8c9"
    And the upgrade branch "adw-upgrade-f6a7b8c9" already carries the empty upgrade-claim commit
    And the mock GitHub API is configured to accept issue comments
    When the "upgrade" orchestrator is invoked with adwId "upgrade-7571" and issue 7571
    Then the orchestrator subprocess exited 0
    And the mock GitHub API recorded a PR creation for issue 7571 with a body containing "Implements #7571"
    And the mock GitHub API recorded a PR creation for issue 7571 with a body containing "Closes #7571"

  # ── §3 Type-check backstop ───────────────────────────────────────────────────

  @adw-570 @adw-nm1413-adwupgrade-pr-body-u
  Scenario: TypeScript type-check passes after adding the Closes keyword to the upgrade PR body
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
