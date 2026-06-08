@adw-541 @adw-gj381g-adwupgrade-tsx-orche
Feature: adwUpgrade.tsx orchestrator — regenerates `.adw/`, bumps `.adw-version`, and opens the upgrade PR

  Issue #541 builds the single-purpose `adwUpgrade.tsx` orchestrator described
  in the "`adwUpgrade.tsx` orchestrator" section of the parent PRD
  (`specs/prd/adw-init-hash-and-label-classification.md`, User Stories 7 and 22).
  It is the worker that performs the actual framework regeneration once an
  upgrade has been claimed: it runs `/adw_init.md` via the Claude CLI against the
  target worktree, recomputes the framework content hash at runtime, commits the
  regenerated `.adw/` directory, writes the fresh hash to `.adw-version`, and
  opens a PR linking the `adw:upgrade` tracking issue.

  Like `adwMerge.tsx`, this orchestrator joins the exception list — it does NOT
  call `initializeWorkflow()`, so no recursive-spawn / hash-check guard applies
  to it by construction. It is CLI-invocable end to end
  (`bunx tsx adws/adwUpgrade.tsx <issueNumber>`).

  The behavioural contract pinned below:

    1. Invoked against a target worktree on the claimed `adw-upgrade-<hash>`
       branch, the orchestrator runs end to end and opens a PR linked to the
       tracking issue (the PR is the success signal). (AC1, AC6, US7)
    2. The upgrade branch ends with exactly two commits: the empty claim commit
       left by `upgradeClaim` (#539) plus this orchestrator's single regeneration
       commit. (AC3)
    3. A `.adw-version` file is written carrying a well-formed SHA256 digest.
       (AC4)
    4. The digest is RECOMPUTED at runtime, not pinned to the value embedded in
       the claim branch name: when the branch's claim token is stale, the
       written `.adw-version` differs from that stale token. (AC2, US26)
    5. On success the orchestrator posts NO workflow comment — the opened PR is
       the only success signal. (AC6)
    6. On LLM regeneration failure the orchestrator posts a single NON-workflow
       comment (carrying no ADW marker, so the concurrency guard does not count
       it) to the tracking issue, opens no PR, writes no `.adw-version`, and
       exits cleanly. (AC5, US22)

  Observability / rot-prevention note:

    Every assertion below targets an artefact the system produces at runtime,
    never the text of a source file:

      • the orchestrator subprocess exit code (`World.lastExitCode`);
      • calls recorded by the mock GitHub API — the PR creation linked to the
        tracking issue, and the failure comment / its ADW-marker absence;
      • git artefacts produced in the temp target worktree — the two commits on
        the `adw-upgrade-<hash>` branch;
      • the `.adw-version` file the orchestrator writes into the target worktree.
        That file is a produced artefact of the system under test — the target
        repo's data file, exactly the kind of orchestrator-written artefact the
        vocabulary Rot-Detection Rubric permits asserting against (entry T1 reads
        an orchestrator-written state file) — not a source file of this repo.

    No step reads `adws/adwUpgrade.tsx` (or any other source file) as text,
    substring-matches its contents, or parses it as JSON/AST. The orchestrator is
    proven behaviourally — by what it opens, commits, writes, comments, and the
    code it exits with — exactly as the framework Rot-Prevention rule and
    `features/regression/vocabulary.md` Rot-Detection Rubric require.

  Scope notes:

    • Per the PRD Testing Decisions, `adwUpgrade.tsx` is shallow composition
      (worktree setup + LLM call + commit + push + PR open) and is covered by
      integration-level smoke scenarios only. The deterministic harness is the
      claude-cli-stub + mock GitHub API + a temp target worktree (the existing
      orchestrator-smoke idiom behind G3/G4/G11). A true upgrade against a live
      Claude run and a live GitHub remote is the implementer's non-deterministic
      integration test and is intentionally out of BDD scope.
    • The upstream pieces this orchestrator composes — the `hashComputer` module
      (#537), the `adwVersion` reader/writer (#538), and the `upgradeClaim`
      primitive (#539, which produces the empty claim commit) — are pinned by
      their own per-issue files and are out of scope here. This file treats the
      claim branch + its empty commit as a precondition and the framework hash as
      an opaque well-formed digest.
    • Creating the `adw:upgrade` tracking issue, registering dependencies, and
      returning parked issues to the Todo lane belong to `initializeWorkflow()`
      (a separate slice) and are not asserted here; this file pins only what the
      upgrade orchestrator itself observably does once the tracking issue exists.
    • adwUpgrade does not call `initializeWorkflow()` and is not asserted to emit
      the standard `.adw/state.json` workflow-state artefact (it carries no ADW
      workflow stage); the success/failure signals it IS contracted to produce —
      the PR, the commits, the `.adw-version` file, and the failure comment — are
      what these scenarios assert instead.
    • "Exits cleanly" (AC5) is pinned as subprocess exit 0, matching the
      established error/edge convention in the regression suite (e.g.
      `row-03-...error-stub-failure`, `row-11-...edge-pr-not-merged` both assert
      `exited 0` for a handled failure). A handled LLM failure that deliberately
      avoids polluting the concurrency count is a clean exit, not a crash.
    • Claim-branch tokens shown below are illustrative. §2's stale token is an
      all-zero 64-hex digest — a value a real SHA256 of the framework cannot take
      — so "the written `.adw-version` differs from the claim token" is an
      unambiguous proof that the digest was recomputed at runtime rather than
      copied from the branch name.

  Vocabulary note:

    Reused registered phrases (`features/regression/vocabulary.md`):
    G3 (`the claude-cli-stub is loaded with manifest {string}`),
    G4 (`an issue {int} exists in the mock issue tracker`),
    G11 (`the worktree for adwId {string} is initialised at branch {string}`),
    G1 (`the mock GitHub API is configured to accept issue comments`),
    W1 (`the {string} orchestrator is invoked with adwId {string} and issue {int}`),
    T5 (`the orchestrator subprocess exited {int}`),
    T8 (`the mock GitHub API recorded a PR creation for issue {int}`),
    T2 (`the mock GitHub API recorded a comment on issue {int}`),
    T14 (`the mock harness recorded zero comment posts on issue {int}`),
    and the cross-cutting `the ADW TypeScript type-check passes` backstop
    established by #533/#535/#537/#538/#539.

    Novel phrasing introduced here (no registered phrase fits — the registry is
    scoped to orchestrator/phase/mock-query behaviours and has no `.adw-version`,
    two-commit, ADW-marker-absence, or zero-PR-creation phrase). The gap is
    surfaced to the maintainer in the agent Output:
      • `the upgrade branch {string} already carries the empty upgrade-claim commit`
      • `the upgrade branch {string} contains exactly two commits ahead of its base: the empty upgrade claim and the framework regeneration commit`
      • `the ".adw-version" artefact in the worktree for adwId {string} records a 64-character lowercase hexadecimal SHA256 digest`
      • `the ".adw-version" artefact in the worktree for adwId {string} does not record the hash {string}`
      • `the ".adw-version" artefact in the worktree for adwId {string} is absent`
      • `the most recent comment on issue {int} carries no ADW workflow marker`
      • `the mock harness recorded zero PR creations for issue {int}`

    Step-definition note for the maintainer: the W1 orchestrator-name map must
    gain an `upgrade → adwUpgrade.tsx` entry (and lose the deleted
    `init → adwInit.tsx` entry, per the PRD). adwUpgrade's CLI takes only
    `<issueNumber>`; the adwId carried by W1 is the harness's handle to the
    pre-initialised target worktree, not a CLI argument.

  Background:
    Given the ADW codebase is checked out

  # ── §1 Happy path — runs end to end, opens the PR, posts no workflow comment ─

  @adw-541 @adw-gj381g-adwupgrade-tsx-orche
  Scenario: The upgrade orchestrator regenerates the framework, opens the linked PR, and posts no workflow comment
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/adw-upgrade-regen-happy.json"
    And an issue 7541 exists in the mock issue tracker
    And the worktree for adwId "upgrade-7541" is initialised at branch "adw-upgrade-a1b2c3d4"
    And the upgrade branch "adw-upgrade-a1b2c3d4" already carries the empty upgrade-claim commit
    And the mock GitHub API is configured to accept issue comments
    When the "upgrade" orchestrator is invoked with adwId "upgrade-7541" and issue 7541
    Then the orchestrator subprocess exited 0
    And the mock GitHub API recorded a PR creation for issue 7541
    And the ".adw-version" artefact in the worktree for adwId "upgrade-7541" records a 64-character lowercase hexadecimal SHA256 digest
    And the mock harness recorded zero comment posts on issue 7541

  # ── §2 Two commits on the branch — empty claim + the regeneration commit ─────

  @adw-541 @adw-gj381g-adwupgrade-tsx-orche
  Scenario: The upgrade branch ends with the empty claim commit plus a single regeneration commit
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/adw-upgrade-regen-happy.json"
    And an issue 7542 exists in the mock issue tracker
    And the worktree for adwId "upgrade-7542" is initialised at branch "adw-upgrade-b2c3d4e5"
    And the upgrade branch "adw-upgrade-b2c3d4e5" already carries the empty upgrade-claim commit
    When the "upgrade" orchestrator is invoked with adwId "upgrade-7542" and issue 7542
    Then the orchestrator subprocess exited 0
    And the upgrade branch "adw-upgrade-b2c3d4e5" contains exactly two commits ahead of its base: the empty upgrade claim and the framework regeneration commit

  # ── §3 Runtime hash recomputation — not pinned to the stale claim token ──────

  @adw-541 @adw-gj381g-adwupgrade-tsx-orche
  Scenario: The written .adw-version is recomputed at runtime and differs from a stale claim-branch token
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/adw-upgrade-regen-happy.json"
    And an issue 7543 exists in the mock issue tracker
    And the worktree for adwId "upgrade-7543" is initialised at branch "adw-upgrade-0000000000000000000000000000000000000000000000000000000000000000"
    And the upgrade branch "adw-upgrade-0000000000000000000000000000000000000000000000000000000000000000" already carries the empty upgrade-claim commit
    When the "upgrade" orchestrator is invoked with adwId "upgrade-7543" and issue 7543
    Then the orchestrator subprocess exited 0
    And the ".adw-version" artefact in the worktree for adwId "upgrade-7543" records a 64-character lowercase hexadecimal SHA256 digest
    And the ".adw-version" artefact in the worktree for adwId "upgrade-7543" does not record the hash "0000000000000000000000000000000000000000000000000000000000000000"

  # ── §4 LLM failure — non-workflow comment, no PR, no version bump, clean exit ─

  @adw-541 @adw-gj381g-adwupgrade-tsx-orche
  Scenario: On LLM regeneration failure the orchestrator posts a non-workflow comment, opens no PR, and exits cleanly
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/adw-upgrade-regen-failure.json"
    And an issue 7544 exists in the mock issue tracker
    And the worktree for adwId "upgrade-7544" is initialised at branch "adw-upgrade-c3d4e5f6"
    And the upgrade branch "adw-upgrade-c3d4e5f6" already carries the empty upgrade-claim commit
    And the mock GitHub API is configured to accept issue comments
    When the "upgrade" orchestrator is invoked with adwId "upgrade-7544" and issue 7544
    Then the orchestrator subprocess exited 0
    And the mock GitHub API recorded a comment on issue 7544
    And the most recent comment on issue 7544 carries no ADW workflow marker
    And the mock harness recorded zero PR creations for issue 7544
    And the ".adw-version" artefact in the worktree for adwId "upgrade-7544" is absent

  # ── §5 Type-check ──────────────────────────────────────────────────────────

  @adw-541 @adw-gj381g-adwupgrade-tsx-orche
  Scenario: TypeScript type-check passes after adding the adwUpgrade orchestrator
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
