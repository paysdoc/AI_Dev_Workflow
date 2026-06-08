@adw-544 @adw-tlk8qf-hash-check-upgrade-t
Feature: initializeWorkflow() hash check + upgrade trigger — parks stale-framework issues before classification

  Issue #544 wires the content-hash upgrade gate into `initializeWorkflow()`,
  the shared entry every SDLC orchestrator (`adwPlan`, `adwBuild`, `adwChore`,
  `adwPatch`, `adwPrReview`, …) runs before it does any work. It is the
  integration slice described in the "Hash check in `initializeWorkflow()`"
  section of the parent PRD
  (`specs/prd/adw-init-hash-and-label-classification.md`, User Stories 1, 2, 10,
  13, 25, 26, 27). It composes the upstream deep modules delivered by the
  blocking issues — `hashComputer` (#537), `adwVersion` (#538), `upgradeClaim`
  (#539), and the `adwUpgrade.tsx` orchestrator (#541) — into a single decision
  point.

  Between worktree setup and the LLM classification call, the workflow compares
  the target repo's recorded framework version (its `.adw-version`) against the
  framework's current content hash:

    1. MATCH      → the existing flow continues unchanged: classification runs,
                    the workflow posts its slot-consuming `starting` comment, and
                    the orchestrator proceeds. No upgrade work happens.
    2. MISMATCH, claim WON  → the orchestrator creates an `#UPG` tracking issue
                    carrying the `adw:upgrade` label, invokes `adwUpgrade.tsx`,
                    registers the current issue's dependency on `#UPG`, returns
                    the current issue to the Todo lane, and exits.
    3. MISMATCH, claim LOST → the orchestrator attaches to the upgrade already
                    in flight: it registers the current issue's dependency on the
                    existing `#UPG`, returns the issue to Todo, and exits. It
                    creates no second tracking issue and spawns no second
                    upgrade orchestrator.

  Critical invariant (AC5 / User Story 13): on every mismatch path the exit
  happens BEFORE `postIssueStageComment(..., 'starting', ...)` fires, so the
  parked issue consumes NO concurrency slot — the slot frees immediately and
  throughput recovers when `#UPG` lands. The `starting` comment carries the ADW
  workflow marker that `concurrencyGuard` counts (PRD "Concurrency interaction");
  parking must emit zero such marker comments on the current issue.

  Two edge contracts round out the slice:

    • First-ever bootstrap (AC7 / User Story 25): a target repo with no
      `.adw-version` is treated as a null version — a mismatch — and flows down
      the exact same upgrade path. There is no separate bootstrap branch.
    • `adwMerge.tsx` exemption (AC6): `adwMerge` does not call
      `initializeWorkflow()`, so a stale `.adw-version` triggers no upgrade work
      when a merge runs.

  Observability / rot-prevention note:

    Every assertion below targets an artefact the system produces at runtime —
    never the text of a source file:

      • the orchestrator subprocess exit code (`World.lastExitCode`);
      • calls recorded by the mock GitHub API — the `#UPG` tracking-issue
        creation and its `adw:upgrade` label, the dependency registration on the
        current issue, and the `starting` workflow comment (or its absence) — the
        same recorded-request channel behind registered vocabulary T2/T12/T14;
      • the project-board move that returns the parked issue to the Todo lane (a
        recorded board API call, an output of the run);
      • the harness-recorded `spawnDetached` invocation that launches (or does
        not launch) `adwUpgrade.tsx`, the same recorded-spawn channel #542 uses
        to assert webhook-driven orchestrator spawns;
      • the claude-cli-stub's recorded invocation log, which proves whether the
        LLM classifier ran — the behavioural manifestation of "the hash check
        sits before the classification call".

    The target repo's `.adw-version` is set up as a fixture INPUT for the
    mismatch/match/bootstrap preconditions and is never asserted as a source
    file; it is the target repo's data file — exactly the kind of
    orchestrator-relevant artefact the vocabulary Rot-Detection Rubric permits
    (entries T1/#538 read `.adw-version`/state files written at runtime). No step
    reads `adws/phases/workflowInit.ts` (or any module) as text, substring-matches
    its contents, or parses it as JSON/AST. The behaviour is proven by what the
    orchestrator creates, spawns, registers, moves, comments, and the code it
    exits with — exactly as the framework Rot-Prevention rule and
    `features/regression/vocabulary.md` Rot-Detection Rubric require.

  Scope notes:

    • This file pins only the `initializeWorkflow()` decision point. The upstream
      modules it composes — the content hash (`hashComputer`, #537), the
      `.adw-version` reader/writer (`adwVersion`, #538), the atomic branch-claim
      primitive (`upgradeClaim`, #539, which decides won/lost and produces the
      claim branch), and the regeneration orchestrator (`adwUpgrade.tsx`, #541,
      which recomputes the hash at runtime per User Story 26 and opens the PR) —
      are pinned by their own per-issue files and treated here as collaborators
      whose own behaviour is out of scope. "Current framework version" means the
      digest `hashComputer` returns for the live checkout; scenarios never pin a
      literal hash, so they survive any framework content change.
    • `"plan"` is the representative SDLC orchestrator exercising the shared
      `initializeWorkflow()` path; the gate behaves identically for every
      orchestrator that calls it. `adwMerge` and `adwUpgrade` are the two that do
      not, and §5 pins the merge exemption.
    • AC1 ("hash check after worktree setup, before the LLM classification call")
      is proven behaviourally, not by source ordering: the worktree must exist
      for `.adw-version` to be read (so the check necessarily follows worktree
      setup), and on every mismatch the LLM classifier is NOT invoked (so the
      check necessarily precedes classification). The mismatch issues carry no
      classification label, so absent the short-circuit the classifier WOULD run
      — making "classifier not invoked" a meaningful proof rather than a vacuous
      one. The match baseline (§1) shows the classifier running when the version
      matches.
    • The slot-leak invariant is pinned as "zero ADW-workflow-marker comment
      posts on the current issue", NOT "zero comments of any kind". The marker
      granularity is deliberate and load-bearing: the framework distinguishes
      slot-consuming workflow comments (which carry the ADW marker) from
      non-workflow courtesy/failure comments (which do not — e.g. the failed-init
      comment in #541/#542). Asserting only the marker count keeps the contract
      aligned with what `concurrencyGuard` actually counts and robust to an
      implementer adding a non-workflow "parked pending #UPG" note.
    • §5 asserts only the ABSENCE of upgrade artefacts when a merge runs against a
      stale `.adw-version`; it deliberately does not assert the merge's own exit
      code or lifecycle, because the exemption holds by construction (the hash
      gate is simply not in `adwMerge`'s code path) regardless of whether the
      merge itself succeeds or errors on its unrelated preconditions.
    • User Stories 26 (runtime hash recompute) and 27 (recursive churn during a
      slow HITL upgrade) are system-level consequences realised by `adwUpgrade`
      (#541) and the existing CRON dependency-closure layer, not by this slice;
      #544 contributes the park-and-depend half. They are noted as addressed at
      the system level and not re-pinned here.

  Vocabulary note:

    Reused registered phrases (`features/regression/vocabulary.md`):
    G4 (`an issue {int} exists in the mock issue tracker`),
    G11 (`the worktree for adwId {string} is initialised at branch {string}`),
    G1 (`the mock GitHub API is configured to accept issue comments`),
    G12 (`the mock GitHub API is configured to accept label applications`),
    W1 (`the {string} orchestrator is invoked with adwId {string} and issue {int}`),
    T5 (`the orchestrator subprocess exited {int}`),
    T2 (`the mock GitHub API recorded a comment on issue {int}`),
    and the cross-cutting `the ADW codebase is checked out` background and
    `the ADW TypeScript type-check passes` backstop established by
    #533/#535/#537–#542.

    Reused from sibling per-issue files (introduced by #542, not yet in the
    registry): `the claude classifier was invoked for issue {int}` and
    `the claude classifier was not invoked for issue {int}`.

    Novel phrasing introduced here (no registered phrase fits — the registry has
    no `.adw-version`/version-match, upgrade-claim-branch, tracking-issue-creation,
    dependency-registration, return-to-Todo, upgrade-spawn, or marker-comment-count
    phrase). The gap is surfaced to the maintainer in the agent Output:
      • `the worktree for adwId {string} records a framework version matching the current framework`
      • `the worktree for adwId {string} records a framework version that differs from the current framework`
      • `the worktree for adwId {string} has no recorded framework version`
      • `the target remote has no upgrade claim branch for the current framework version`
      • `an upgrade claim branch for the current framework version already exists on the target remote, tracked by issue {int}`
      • `the mock GitHub API recorded the creation of an upgrade tracking issue carrying the {string} label`
      • `the mock GitHub API recorded no creation of an upgrade tracking issue`
      • `ADW spawned the upgrade orchestrator for the tracking issue`
      • `ADW spawned no upgrade orchestrator for issue {int}`
      • `ADW registered a dependency of issue {int} on the upgrade tracking issue`
      • `ADW returned issue {int} to the Todo lane`
      • `the mock harness recorded zero ADW-workflow-marker comment posts on issue {int}`

  Background:
    Given the ADW codebase is checked out

  # ── §1 Hash match — the existing flow continues unchanged (AC2) ──────────────

  @adw-544 @adw-tlk8qf-hash-check-upgrade-t
  Scenario: A matching .adw-version lets the workflow classify and proceed with no upgrade work
    Given an issue 5441 exists in the mock issue tracker
    And the worktree for adwId "init-5441" is initialised at branch "init-5441"
    And the worktree for adwId "init-5441" records a framework version matching the current framework
    And the mock GitHub API is configured to accept issue comments
    When the "plan" orchestrator is invoked with adwId "init-5441" and issue 5441
    Then the orchestrator subprocess exited 0
    And the claude classifier was invoked for issue 5441
    And the mock GitHub API recorded a comment on issue 5441
    And the mock GitHub API recorded no creation of an upgrade tracking issue
    And ADW spawned no upgrade orchestrator for issue 5441

  # ── §2 Hash mismatch, claim WON — create #UPG, spawn, depend, park, no slot ──

  @adw-544 @adw-tlk8qf-hash-check-upgrade-t
  Scenario: A mismatched .adw-version that wins the claim creates #UPG, launches the upgrade, parks the issue, and consumes no slot
    Given an issue 5442 exists in the mock issue tracker
    And the worktree for adwId "init-5442" is initialised at branch "init-5442"
    And the worktree for adwId "init-5442" records a framework version that differs from the current framework
    And the target remote has no upgrade claim branch for the current framework version
    And the mock GitHub API is configured to accept issue comments
    And the mock GitHub API is configured to accept label applications
    When the "plan" orchestrator is invoked with adwId "init-5442" and issue 5442
    Then the orchestrator subprocess exited 0
    And the mock GitHub API recorded the creation of an upgrade tracking issue carrying the "adw:upgrade" label
    And ADW spawned the upgrade orchestrator for the tracking issue
    And ADW registered a dependency of issue 5442 on the upgrade tracking issue
    And ADW returned issue 5442 to the Todo lane
    And the mock harness recorded zero ADW-workflow-marker comment posts on issue 5442
    And the claude classifier was not invoked for issue 5442

  # ── §3 Hash mismatch, claim LOST — attach to existing #UPG, park, no slot ────

  @adw-544 @adw-tlk8qf-hash-check-upgrade-t
  Scenario: A mismatched .adw-version that loses the claim attaches to the in-flight upgrade without creating a second one
    Given an issue 5443 exists in the mock issue tracker
    And the worktree for adwId "init-5443" is initialised at branch "init-5443"
    And the worktree for adwId "init-5443" records a framework version that differs from the current framework
    And an upgrade claim branch for the current framework version already exists on the target remote, tracked by issue 9143
    And the mock GitHub API is configured to accept issue comments
    When the "plan" orchestrator is invoked with adwId "init-5443" and issue 5443
    Then the orchestrator subprocess exited 0
    And ADW registered a dependency of issue 5443 on the upgrade tracking issue
    And ADW returned issue 5443 to the Todo lane
    And the mock GitHub API recorded no creation of an upgrade tracking issue
    And ADW spawned no upgrade orchestrator for issue 5443
    And the mock harness recorded zero ADW-workflow-marker comment posts on issue 5443
    And the claude classifier was not invoked for issue 5443

  # ── §4 First-ever bootstrap — missing .adw-version uses the upgrade path (AC7) ─

  @adw-544 @adw-tlk8qf-hash-check-upgrade-t
  Scenario: A target repo with no .adw-version is treated as a mismatch and parked down the same upgrade path
    Given an issue 5444 exists in the mock issue tracker
    And the worktree for adwId "init-5444" is initialised at branch "init-5444"
    And the worktree for adwId "init-5444" has no recorded framework version
    And the target remote has no upgrade claim branch for the current framework version
    And the mock GitHub API is configured to accept issue comments
    And the mock GitHub API is configured to accept label applications
    When the "plan" orchestrator is invoked with adwId "init-5444" and issue 5444
    Then the orchestrator subprocess exited 0
    And the mock GitHub API recorded the creation of an upgrade tracking issue carrying the "adw:upgrade" label
    And ADW spawned the upgrade orchestrator for the tracking issue
    And ADW registered a dependency of issue 5444 on the upgrade tracking issue
    And ADW returned issue 5444 to the Todo lane
    And the mock harness recorded zero ADW-workflow-marker comment posts on issue 5444

  # ── §5 adwMerge is exempt — a stale .adw-version triggers no upgrade (AC6) ────

  @adw-544 @adw-tlk8qf-hash-check-upgrade-t
  Scenario: Running a merge against a stale .adw-version performs no upgrade work because adwMerge skips initializeWorkflow
    Given an issue 5445 exists in the mock issue tracker
    And the worktree for adwId "init-5445" is initialised at branch "init-5445"
    And the worktree for adwId "init-5445" records a framework version that differs from the current framework
    And the target remote has no upgrade claim branch for the current framework version
    When the "merge" orchestrator is invoked with adwId "init-5445" and issue 5445
    Then the mock GitHub API recorded no creation of an upgrade tracking issue
    And ADW spawned no upgrade orchestrator for issue 5445

  # ── §6 Type-check ─────────────────────────────────────────────────────────────

  @adw-544 @adw-tlk8qf-hash-check-upgrade-t
  Scenario: TypeScript type-check passes after wiring the hash check into initializeWorkflow
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
