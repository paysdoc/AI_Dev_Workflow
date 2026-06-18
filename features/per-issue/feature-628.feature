@adw-628 @adw-v7dih7-adwupgrade-reconcile
Feature: adwUpgrade reconciles a reused stale worktree to the remote claim tip before regen — diverged-reuse stops mis-parking as claim_lost

  Issue #628 fixes the ROOT CAUSE behind #627. `#627` parks the upgrade
  orchestrator cleanly when its regen push is rejected non-fast-forward instead
  of crashing — a SAFETY NET, not a cure. With the net in place the orchestrator
  still makes no progress: it re-parks every cron tick (absent the `.adw-version`
  disarm) because nothing ever fixes the divergence that caused the rejection.

  Root cause: `ensureWorktree` (`adws/vcs/worktreeCreation.ts`) returns an
  EXISTING local worktree as-is — it does NOT fetch or reset the reused worktree
  to `origin/<claim-branch>`. So when a prior orchestrator left a
  `.worktrees/adw-upgrade-<hash>/` worktree built on a SUPERSEDED claim commit
  (a different claim cycle re-created the remote branch with a new nonce), the
  next `adwUpgrade` run regenerates `.adw/` on the stale base and its push can
  never fast-forward. This is the original incident exactly: the local worktree
  sat on the `zgmo37zc`-nonce claim commit while the remote claim branch had
  advanced to the `llwvynsy`-nonce commit — two DIVERGENT siblings, so the push
  was non-fast-forward and #627 (correctly, for what it could see) parked it.

  The fix reconciles the reused worktree to the current remote claim tip BEFORE
  regen, but only on the upgrade path: `git fetch origin <claim-branch>` then
  `git reset --hard origin/<claim-branch>` (a hard reset is safe here — the
  upgrade worktree is a throwaway regen target that never carries un-pushed user
  work). The shared `ensureWorktree` primitive that every OTHER orchestrator
  relies on is left unperturbed (reconciliation is scoped to the upgrade path /
  opt-in), so non-upgrade reuse keeps its current reuse-as-is semantics. The
  genuine concurrent-claim race — a new claim landing AFTER the reconcile, so the
  push is STILL rejected — correctly remains the `claim_lost` park from #627: the
  reconcile resets only the LOCAL worktree and never force-pushes, so it can
  never clobber the rightful claim owner.

  The behavioural contract pinned below:

    1. RECONCILE FIXES DIVERGENCE (AC1, core). A reused upgrade worktree sitting
       on a superseded, divergent claim commit is reset to the remote claim tip;
       a regeneration commit built on the reconciled worktree then pushes as a
       clean fast-forward — the push that previously could never advance.
    2. RECONCILE IS A SAFE NO-OP WHEN ALREADY CURRENT. A reused upgrade worktree
       already on the current claim commit is left at the remote tip and its
       regen push still fast-forwards — reconciliation never breaks the common,
       non-diverged case.
    3. END-TO-END (AC1, wiring). Driven through the orchestrator, a run that
       reuses a stale upgrade worktree reconciles and OPENS THE LINKED PR — the
       success signal it previously could never reach because the push parked.
    4. #627 BOUNDARY PRESERVED. A competing claimant that re-advances the remote
       claim branch AFTER the reconcile (so the regen push is still non-ff) still
       parks the run as the claim loser: no PR, no comment, clean exit. The
       reconcile does not mask a genuine claim loss.
    5. NO BEHAVIOURAL CHANGE FOR OTHER ORCHESTRATORS (AC2). A non-upgrade
       orchestrator reusing an existing worktree through the shared primitive
       leaves that worktree's local-only commits intact — it is never hard-reset
       to the remote. The reconcile is scoped to the upgrade path alone.
    6. TYPE-CHECK BACKSTOP. The ADW TypeScript type-check still passes after the
       reconcile is wired into the upgrade path.

  Observability / rot-prevention note:

    Every assertion below targets an artefact the system produces at runtime —
    a git artefact (the worktree HEAD commit, an accepted/rejected push), a call
    recorded by the mock GitHub API (a PR creation, the absence of one or of a
    comment), a subprocess exit code, or the type-checker's verdict. None reads
    `adws/vcs/worktreeCreation.ts`, `adws/vcs/worktreeReset.ts`,
    `adws/adwUpgrade.tsx`, or any other source file as text, substring-matches
    its contents, or parses it as JSON/AST.

      • §1–§2 drive the upgrade-path reconcile over a REAL temp git repo whose
        bare `origin` carries the claim branch, and assert git artefacts: the
        worktree HEAD after reconcile (`git rev-parse HEAD`) and whether a
        subsequent push is accepted as a fast-forward — registry surface #3
        (git artefacts), the same INPUT-fixture-then-assert-the-git-state shape
        feature-541 uses for its two-commit claim-branch assertions.
      • §3 drives the upgrade orchestrator and asserts the recorded PR creation
        (T8) — the orchestrator pushes BEFORE it opens the PR, so a recorded PR
        creation is the observable proof the reconciled regen push fast-forwarded.
      • §4 asserts the #627 claim_lost signature behaviourally — exit 0, zero PR
        creations, zero comments (T5 / T14 / feature-541's zero-PR phrase) — the
        same observable signature feature-541 §4 uses for a handled non-crash exit.
      • §5 drives the upgrade-path reuse over a REAL git fixture and asserts a
        local-only commit survives on the worktree HEAD (git artefact).
      • §6 asserts the type-checker's verdict (registry T22).

    The temp git repositories, worktrees, and claim commits the steps construct
    are INPUT/artefact test data — the same category the Rot-Detection Rubric
    permits (worktree fixtures, git artefacts produced by a phase) — NOT source
    files of this repo.

  Scope notes:

    • The reconcile primitive itself (fetch → reset --hard; no `git clean -fdx` and
      no merge/rebase-abort) is `fetchAndResetToRemote`
      (`adws/vcs/branchOperations.ts`) and is covered by its own focused
      mocked-execSync unit tests; this file does not re-enumerate its internal call
      sequence. (`resetWorktreeToRemote` in `adws/vcs/worktreeReset.ts` — the takeover
      primitive that additionally runs `git clean -fdx` — is deliberately NOT used on
      the upgrade path, because that clean would delete the worktree's copied
      gitignored `.env`.) It pins only the OBSERVABLE upgrade-path outcome: a diverged
      reused worktree ends at the remote claim tip and its regen push fast-forwards.
    • Whether the fix wires the reconcile as an opt-in flag on `ensureWorktree` or
      as a separate call on the upgrade path is a SOURCE-STRUCTURE choice,
      deliberately NOT asserted. Its observable proxies are §1–§3 (the upgrade
      reuse reconciles) and §5 (the non-upgrade reuse does not) — both hold under
      either implementation.
    • §3–§4 assume the `adw-upgrade-regen-happy` claude-cli-stub manifest carries
      the run past the #614 receipt-freshness gate (so the flow reaches the push);
      the regeneration content itself is #541/#614 territory, treated here as an
      opaque precondition. The genuinely-new decision #628 introduces — reconcile
      the reused base before regen — is what §1–§4 pin.
    • A true reconcile against a LIVE GitHub remote under a real concurrent claim
      is the implementer's non-deterministic integration test and is intentionally
      out of BDD scope — a live remote cannot be asserted deterministically. The
      deterministic harness here is a local bare `origin` repo (§1–§2, §5) and the
      claude-cli-stub + mock GitHub API (§3–§4).
    • The `.adw-version` disarm that breaks an already-looping park is a one-time
      human operational chore (nothing to observe or automate) and is out of scope.
    • The `@regression` maintenance sweep is SKIPPED for this issue: `.adw/scenarios.md`
      configures a `## Regression Scenario Directory`, so promotion is a deliberate
      human decision and the agent never auto-promotes.

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
      T14 (`the mock harness recorded zero comment posts on issue {int}`),
      T22 (`the ADW TypeScript type-check passes`).
    Also reused: `the mock harness recorded zero PR creations for issue {int}`
    (introduced by feature-541, globally loaded; feature-572 already reuses it).

    Novel phrasing introduced here — the registry is scoped to
    orchestrator/phase/mock-query behaviours and has NO phrase for worktree
    git-state reconciliation (remote claim tip, divergent reuse, fast-forward
    acceptance, local-commit survival). The gap is surfaced to the maintainer in
    the agent Output:
      • `a target repo whose remote claim branch {string} points at the current claim commit`
      • `a reused upgrade worktree checked out on a superseded, divergent claim commit of {string}`
      • `a reused upgrade worktree already checked out on the current claim commit of {string}`
      • `the upgrade worktree is reconciled to the remote claim tip of {string}`
      • `the upgrade worktree HEAD matches the remote claim tip of {string}`
      • `a regeneration commit pushed from the reconciled worktree to {string} is accepted as a fast-forward`
      • `the upgrade worktree for adwId {string} is stale — its branch sits on a superseded claim commit while the remote claim branch has advanced to a new claim`
      • `a competing claimant advances the remote claim branch {string} after the run reconciles, so the regeneration push is rejected as non-fast-forward`
      • `a target repo with an existing worktree for branch {string} carrying a local-only commit ahead of the remote`
      • `a non-upgrade orchestrator reuses the existing worktree for branch {string}`
      • `the reused worktree HEAD still carries the local-only commit`
      • `the reused worktree HEAD does not match the remote tip of {string}`

    Step-definition note for the maintainer: §1–§2 and §5 need a temp target repo
    whose bare `origin` carries the claim/feature branch, with the local worktree
    placed on a DIVERGENT (sibling) commit — the literal incident reproduction
    (local `zgmo37zc`-nonce vs remote `llwvynsy`-nonce). §3–§4 extend the
    feature-541 upgrade-orchestrator harness (G11 + W1) so the target worktree's
    `origin` carries the ADVANCED claim branch, letting the upgrade path's
    `fetch` + `reset --hard` reconcile before the regen push.

  Background:
    Given the ADW codebase is checked out

  # ── §1 Reconcile fixes divergence — stale base reset to the remote claim tip ──
  #
  # THE fix. The reused upgrade worktree sits on a superseded, divergent claim
  # commit (the `zgmo37zc`-nonce base); the remote claim branch has advanced to
  # the current claim (the `llwvynsy`-nonce tip). Reconciling resets the worktree
  # to the remote tip, so a regeneration commit built on top pushes as a clean
  # fast-forward — the push that previously could never advance and forced the
  # #627 park. (AC1, core; contract §1.)

  @adw-628 @adw-v7dih7-adwupgrade-reconcile
  Scenario: Reconciling a diverged reused upgrade worktree resets it to the remote claim tip and makes its regen push fast-forward
    Given a target repo whose remote claim branch "adw-upgrade-deadbeef" points at the current claim commit
    And a reused upgrade worktree checked out on a superseded, divergent claim commit of "adw-upgrade-deadbeef"
    When the upgrade worktree is reconciled to the remote claim tip of "adw-upgrade-deadbeef"
    Then the upgrade worktree HEAD matches the remote claim tip of "adw-upgrade-deadbeef"
    And a regeneration commit pushed from the reconciled worktree to "adw-upgrade-deadbeef" is accepted as a fast-forward

  # ── §2 Safe no-op — reconcile never breaks an already-current worktree ────────
  #
  # The common case: the reused worktree is already on the current claim commit.
  # Reconciliation leaves it at the remote tip (no divergence to discard) and the
  # regen push still fast-forwards — proving the reconcile is not over-aggressive
  # and never harms the non-diverged path. (Contract §2.)

  @adw-628 @adw-v7dih7-adwupgrade-reconcile
  Scenario: Reconciling an already-current reused upgrade worktree is a safe no-op and its regen push still fast-forwards
    Given a target repo whose remote claim branch "adw-upgrade-cafebabe" points at the current claim commit
    And a reused upgrade worktree already checked out on the current claim commit of "adw-upgrade-cafebabe"
    When the upgrade worktree is reconciled to the remote claim tip of "adw-upgrade-cafebabe"
    Then the upgrade worktree HEAD matches the remote claim tip of "adw-upgrade-cafebabe"
    And a regeneration commit pushed from the reconciled worktree to "adw-upgrade-cafebabe" is accepted as a fast-forward

  # ── §3 End-to-end — a stale-worktree run reconciles and opens the linked PR ───
  #
  # Driven through the orchestrator: the target worktree is stale (its branch on a
  # superseded claim commit while the remote claim branch has advanced). The
  # orchestrator pushes BEFORE it opens the PR, so a recorded PR creation is the
  # observable proof the reconciled regen push fast-forwarded — the success signal
  # the run could never reach before, when the stale base parked it as claim_lost.
  # (AC1, wiring; contract §3.)

  @adw-628 @adw-v7dih7-adwupgrade-reconcile
  Scenario: A run reusing a stale upgrade worktree reconciles to the remote claim tip and opens the linked PR
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/adw-upgrade-regen-happy.json"
    And an issue 6283 exists in the mock issue tracker
    And the worktree for adwId "upgrade-6283" is initialised at branch "adw-upgrade-feedface"
    And the upgrade worktree for adwId "upgrade-6283" is stale — its branch sits on a superseded claim commit while the remote claim branch has advanced to a new claim
    And the mock GitHub API is configured to accept issue comments
    When the "upgrade" orchestrator is invoked with adwId "upgrade-6283" and issue 6283
    Then the orchestrator subprocess exited 0
    And the mock GitHub API recorded a PR creation for issue 6283
    And the mock harness recorded zero comment posts on issue 6283

  # ── §4 #627 boundary preserved — a genuine concurrent claim still parks ───────
  #
  # The reconcile must NOT mask a real claim loss. A competing claimant re-advances
  # the remote claim branch AFTER this run reconciles, so the regen push is still
  # rejected non-fast-forward. The run parks as the claim loser exactly as #627
  # contracts: clean exit, no PR, no comment — never a force-push that would
  # clobber the rightful owner. (Contract §4.)

  @adw-628 @adw-v7dih7-adwupgrade-reconcile
  Scenario: A competing claim landing after reconcile still parks the run as the claim loser with no PR and no comment
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/adw-upgrade-regen-happy.json"
    And an issue 6284 exists in the mock issue tracker
    And the worktree for adwId "upgrade-6284" is initialised at branch "adw-upgrade-d00dfeed"
    And the upgrade worktree for adwId "upgrade-6284" is stale — its branch sits on a superseded claim commit while the remote claim branch has advanced to a new claim
    And a competing claimant advances the remote claim branch "adw-upgrade-d00dfeed" after the run reconciles, so the regeneration push is rejected as non-fast-forward
    And the mock GitHub API is configured to accept issue comments
    When the "upgrade" orchestrator is invoked with adwId "upgrade-6284" and issue 6284
    Then the orchestrator subprocess exited 0
    And the mock harness recorded zero PR creations for issue 6284
    And the mock harness recorded zero comment posts on issue 6284

  # ── §5 No behavioural change for other orchestrators (AC2) ────────────────────
  #
  # The reconcile is scoped to the upgrade path. A non-upgrade orchestrator
  # reusing an existing worktree through the shared primitive leaves that
  # worktree's local-only commit intact — it is NOT hard-reset to the remote.
  # This is the contract every other caller of the shared worktree primitive
  # relies on, and it is unperturbed. (AC2; contract §5.)

  @adw-628 @adw-v7dih7-adwupgrade-reconcile
  Scenario: A non-upgrade orchestrator reusing an existing worktree leaves its local-only commit intact
    Given a target repo with an existing worktree for branch "issue-700-fix" carrying a local-only commit ahead of the remote
    When a non-upgrade orchestrator reuses the existing worktree for branch "issue-700-fix"
    Then the reused worktree HEAD still carries the local-only commit
    And the reused worktree HEAD does not match the remote tip of "issue-700-fix"

  # ── §6 Type-check ─────────────────────────────────────────────────────────────

  @adw-628 @adw-v7dih7-adwupgrade-reconcile
  Scenario: TypeScript type-check passes after wiring the reconcile into the upgrade path
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
