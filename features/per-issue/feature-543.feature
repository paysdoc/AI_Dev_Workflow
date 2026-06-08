@adw-543 @adw-6zw7n2-hitl-opt-in-via-gith
Feature: HITL opt-in via .github/adw.yml — gates whether the upgrade PR auto-merges

  Issue #543 teaches the `adwUpgrade.tsx` orchestrator (built in #541) to read a
  per-target-repo config file, `.github/adw.yml`, to decide whether the upgrade PR
  it opens should auto-merge (the default) or be left open for human review (the
  opt-in). Per the parent PRD
  (`specs/prd/adw-init-hash-and-label-classification.md`, the "`adwUpgrade.tsx`
  orchestrator" section and User Stories 8 and 9), the config field lives at the
  target repo root *outside* `.adw/` precisely so the LLM regeneration of `.adw/`
  cannot clobber the opt-in signal — exactly the rationale that keeps `.adw-version`
  outside `.adw/` (#538).

  Before this slice, `adwUpgrade.tsx` opens the PR and stops — the open PR is the
  whole success signal (#541, §1). This slice adds the merge decision *after* the
  PR is opened. The behavioural contract pinned below:

    1. No `.github/adw.yml` present  → auto-merge is the default. The orchestrator
       opens the upgrade PR and merges it. (AC1, US8)
    2. `hitl: false` in the config   → same as absent: the upgrade PR auto-merges.
       (AC1, US8)
    3. `hitl: true` in the config    → the orchestrator opens the upgrade PR but
       does NOT merge it; it is left open, awaiting human review. (AC2, US9)
    4. A malformed `.github/adw.yml`  → fall back to the default (auto-merge). A
       broken opt-in signal must never silently strand the upgrade — the safe
       default is to keep target repos current. (AC3, US9)

  The three config states required by the acceptance criteria are each exercised:
  opt-out-absent/false (§1, §2), opt-in-true (§3), and malformed (§4).

  Observability / rot-prevention note:

    Every assertion below targets an artefact the system produces at runtime, never
    the text of a source file:

      • the orchestrator subprocess exit code (`World.lastExitCode`);
      • the PR-creation call recorded by the mock GitHub API (registered vocabulary
        entry T8) — proof the upgrade PR was opened;
      • the PR-merge call recorded by the mock GitHub API. `gh pr merge` is captured
        as a `PUT .../pulls/:n/merge` request by the mock server's generic request
        recorder — the same recorded-request channel the established per-issue
        phrases `the mock GitHub API recorded a PR-merge call for PR {int}` (#527)
        and the registered T7 `the mock harness recorded zero PR-merge calls` drive.

    `.github/adw.yml` is a target-repo *data* file. In every scenario it is only ever
    SEEDED as a precondition input into the test worktree — never read back, parsed,
    or substring-matched as an assertion. This is the same fixture-input treatment
    `.adw-version` receives in #538's read scenarios, and it is explicitly permitted:
    the prohibition is on asserting against source-file shape/contents, not on
    seeding an input the system-under-test reads. The HITL decision is proven purely
    by what the orchestrator does observably afterwards — whether or not it records a
    merge call — not by re-reading the config.

    No step reads `adws/adwUpgrade.tsx` (or any module) as text, substring-matches
    its contents, or parses it as JSON/AST.

  Scope notes:

    • AC3 also calls for "a warning log" on the malformed path. The load-bearing,
      caller-observable behaviour is the *fallback to auto-merge*, which §4 pins via
      the recorded merge call. The warning's exact wording is the implementer's
      choice and has no registered observable channel; pinning its text would be the
      log-substring rot pattern this suite avoids. It is therefore deliberately NOT
      asserted — the fallback is proven by behaviour, mirroring how #541 pinned
      "exits cleanly" as subprocess exit 0 rather than by inspecting internals.
    • The HITL gate here is the `.github/adw.yml` config file, distinct from the
      `hitl` *label* that `autoMergePhase.ts` consults for the review orchestrators.
      The upgrade orchestrator's auto-merge is the simple "auto-merge by default"
      contract of US8 — it is NOT gated on an APPROVED review (that would contradict
      "auto-merges without my intervention"); the only gate is this config file.
      Approval state is therefore not set up in any scenario below.
    • Building the `adwUpgrade.tsx` orchestrator itself (regeneration, the
      `.adw-version` bump, the two-commit branch, the LLM-failure comment) is #541's
      contract and is pinned by `feature-541.feature`; this file treats a successful
      regeneration (the `adw-upgrade-regen-happy.json` manifest) and the opened PR as
      givens and asserts only the merge decision layered on top.
    • Creating the `adw:upgrade` tracking issue, the upgrade-claim race, and
      dependency bookkeeping belong to other slices and are out of scope here.

  Vocabulary note:

    Reused registered phrases (`features/regression/vocabulary.md`):
    G3 (`the claude-cli-stub is loaded with manifest {string}`),
    G4 (`an issue {int} exists in the mock issue tracker`),
    G11 (`the worktree for adwId {string} is initialised at branch {string}`),
    G1 (`the mock GitHub API is configured to accept issue comments`),
    W1 (`the {string} orchestrator is invoked with adwId {string} and issue {int}`),
    T5 (`the orchestrator subprocess exited {int}`),
    T8 (`the mock GitHub API recorded a PR creation for issue {int}`),
    T7 (`the mock harness recorded zero PR-merge calls`),
    and the cross-cutting `the ADW TypeScript type-check passes` backstop.

    Reused from #541 (introduced there, not yet promoted to the registry):
    `the upgrade branch {string} already carries the empty upgrade-claim commit`.

    Novel phrasing introduced here (no registered phrase fits — the registry has no
    `.github/adw.yml` seeding phrase and no upgrade-PR-merge phrase keyed by the
    tracking issue). The gap is surfaced to the maintainer in the agent Output:
      • `the worktree for adwId {string} has no ".github/adw.yml" file`
      • `a ".github/adw.yml" file in the worktree for adwId {string} sets hitl to false`
      • `a ".github/adw.yml" file in the worktree for adwId {string} sets hitl to true`
      • `the worktree for adwId {string} has a malformed ".github/adw.yml" file`
      • `the mock GitHub API recorded a PR-merge call for the upgrade PR linked to issue {int}`

    Step-definition note for the maintainer: the upgrade-PR-merge phrase is keyed by
    the tracking issue (like T8), not by a PR number — the orchestrator creates the
    PR itself, so its number is not known a priori. The step should locate the PR
    created referencing the issue (the recorded `POST .../pulls` whose body carries
    `Implements #<issue>`) and assert a `PUT .../pulls/<that-number>/merge` was
    recorded.

  Background:
    Given the ADW codebase is checked out

  # ── §1 Absent config — auto-merge is the default ────────────────────────────

  @adw-543 @adw-6zw7n2-hitl-opt-in-via-gith
  Scenario: With no .github/adw.yml the upgrade PR auto-merges
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/adw-upgrade-regen-happy.json"
    And an issue 8541 exists in the mock issue tracker
    And the worktree for adwId "upgrade-8541" is initialised at branch "adw-upgrade-d4e5f6a7"
    And the upgrade branch "adw-upgrade-d4e5f6a7" already carries the empty upgrade-claim commit
    And the worktree for adwId "upgrade-8541" has no ".github/adw.yml" file
    And the mock GitHub API is configured to accept issue comments
    When the "upgrade" orchestrator is invoked with adwId "upgrade-8541" and issue 8541
    Then the orchestrator subprocess exited 0
    And the mock GitHub API recorded a PR creation for issue 8541
    And the mock GitHub API recorded a PR-merge call for the upgrade PR linked to issue 8541

  # ── §2 hitl: false — same as absent, the upgrade PR auto-merges ─────────────

  @adw-543 @adw-6zw7n2-hitl-opt-in-via-gith
  Scenario: With hitl set to false in .github/adw.yml the upgrade PR auto-merges
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/adw-upgrade-regen-happy.json"
    And an issue 8542 exists in the mock issue tracker
    And the worktree for adwId "upgrade-8542" is initialised at branch "adw-upgrade-e5f6a7b8"
    And the upgrade branch "adw-upgrade-e5f6a7b8" already carries the empty upgrade-claim commit
    And a ".github/adw.yml" file in the worktree for adwId "upgrade-8542" sets hitl to false
    And the mock GitHub API is configured to accept issue comments
    When the "upgrade" orchestrator is invoked with adwId "upgrade-8542" and issue 8542
    Then the orchestrator subprocess exited 0
    And the mock GitHub API recorded a PR creation for issue 8542
    And the mock GitHub API recorded a PR-merge call for the upgrade PR linked to issue 8542

  # ── §3 hitl: true — PR opened but NOT merged; awaits human review ───────────

  @adw-543 @adw-6zw7n2-hitl-opt-in-via-gith
  Scenario: With hitl set to true in .github/adw.yml the upgrade PR is opened but not auto-merged
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/adw-upgrade-regen-happy.json"
    And an issue 8543 exists in the mock issue tracker
    And the worktree for adwId "upgrade-8543" is initialised at branch "adw-upgrade-f6a7b8c9"
    And the upgrade branch "adw-upgrade-f6a7b8c9" already carries the empty upgrade-claim commit
    And a ".github/adw.yml" file in the worktree for adwId "upgrade-8543" sets hitl to true
    And the mock GitHub API is configured to accept issue comments
    When the "upgrade" orchestrator is invoked with adwId "upgrade-8543" and issue 8543
    Then the orchestrator subprocess exited 0
    And the mock GitHub API recorded a PR creation for issue 8543
    And the mock harness recorded zero PR-merge calls

  # ── §4 Malformed config — fall back to the auto-merge default ───────────────

  @adw-543 @adw-6zw7n2-hitl-opt-in-via-gith
  Scenario: A malformed .github/adw.yml falls back to the auto-merge default
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/adw-upgrade-regen-happy.json"
    And an issue 8544 exists in the mock issue tracker
    And the worktree for adwId "upgrade-8544" is initialised at branch "adw-upgrade-a7b8c9d0"
    And the upgrade branch "adw-upgrade-a7b8c9d0" already carries the empty upgrade-claim commit
    And the worktree for adwId "upgrade-8544" has a malformed ".github/adw.yml" file
    And the mock GitHub API is configured to accept issue comments
    When the "upgrade" orchestrator is invoked with adwId "upgrade-8544" and issue 8544
    Then the orchestrator subprocess exited 0
    And the mock GitHub API recorded a PR creation for issue 8544
    And the mock GitHub API recorded a PR-merge call for the upgrade PR linked to issue 8544

  # ── §5 Type-check ───────────────────────────────────────────────────────────

  @adw-543 @adw-6zw7n2-hitl-opt-in-via-gith
  Scenario: TypeScript type-check passes after adding the HITL opt-in gate to adwUpgrade
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
