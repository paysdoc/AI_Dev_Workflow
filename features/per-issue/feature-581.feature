@adw-581 @adw-l8a10n-stack-coherence-chec
Feature: Stack-coherence check (warn loud, non-blocking) — detected framework vs run-command language, the Gherkin mandate, and the adw:unverified channel

  Issue #581 is the coherence-check slice of the parent PRD
  (`specs/prd/multi-language-test-and-bdd-support.md`, Implementation Decisions →
  Proof layer & Scenario format). It is defense-in-depth against `adw_init`'s OWN
  mis-detection: `adw_init` defaults the scenario tool to cucumber-js on
  non-recognition, so a Python (or Go/Rust/Ruby) project can end up with a detected
  config whose run command does not match its stack. `stackCoherenceCheck` catches
  that incoherence and warns LOUDLY through the `adw:unverified` comment + label
  channel — it never blocks. It is blocked-by #579, whose framework→runtime map
  (`stepDefExtensionsFor` / `FRAMEWORK_EXTENSION_MAP`) is the set the Gherkin-mandate
  axis keys off.

  Two coherence axes are asserted, both warn-only:

    • LANGUAGE MATCH (AC1, US22). The detected framework's language must match the
      run-command language. The PRD's named example — a Python stack carrying a
      cucumber-js run command — is the mis-detection this catches: `adw_init` picked
      a Python Gherkin runner (e.g. `pytest-bdd`) for the stack but the run command
      was mis-defaulted to cucumber-js, so the framework language (Python) and the
      run-command language (JS) disagree. A coherent config — framework matched to
      its native run command, in ANY language — resolves to ok.
    • GHERKIN MANDATE (AC2, US31). The detected `bddFramework` must be Gherkin-based
      (per the PRD Gherkin mandate — the promotion / per-issue-sweep / vocabulary
      subsystems all parse Gherkin). A non-Gherkin framework (raw `jest`, `pytest`,
      `rspec`) warns through the SAME channel EVEN WHEN its run-command language
      matches — the two axes are independent.

    On either warning the workflow emits an `adw:unverified` comment AND label and
    CONTINUES (AC3, AC4). The check has no blocking outcome at all: its result space
    is ok | warning, never hard-fail — the deliberate contrast with
    `computeTestVerdict`, which can hard-fail.

  The behavioural contract pinned below:

    1. COHERENT → OK (AC1+, AC2+, US22/US31). A detected config whose Gherkin
       framework is matched to its native run command resolves to ok, across
       languages (cucumber-js/JS, pytest-bdd/behave/Python, godog/Go, cucumber-rs/Rust,
       cucumber-ruby/Ruby). One outline carries both positives: coherence is
       language-AGNOSTIC (a non-JS coherent stack is never flagged), and every known
       Gherkin runner passes the Gherkin-mandate axis.
    2. LANGUAGE MISMATCH → WARNING (AC1, US22). A detected framework whose language
       disagrees with the run-command language resolves to a warning — including the
       PRD's exact "Python stack with a cucumber-js run command", plus the mirror
       (a JS framework with a Python run command) and a Go-framework/JS-command row.
       The same incoherence, shown in three directions.
    3. NON-GHERKIN FRAMEWORK → WARNING (AC2, US31). A non-Gherkin `bddFramework`
       resolves to a warning EVEN WHEN its run-command language matches (jest+jest,
       pytest+pytest, rspec+rspec — each language-coherent). If only the language axis
       existed these would be ok; the warning proves the Gherkin-mandate axis fires
       independently. §3 is the input-driven proof that AC2 is a separate check from
       AC1, mirroring feature-578 §6/§7's same-fixture/opposite-config design.
    4. NEVER BLOCKS — HELPER (AC4). An incoherent config yields a RETURNED, advisory
       warning — the check resolves to a value, never throws and never produces a
       blocking/hard-fail outcome. The "warn loud, non-blocking" contract at the
       decision layer.
    5. NEVER BLOCKS + CHANNEL — END TO END (AC3, AC4). A workflow whose worktree
       carries an incoherent detected `.adw/` descriptor does NOT fail (the
       orchestrator exits 0 and records no error) yet records an `adw:unverified`
       comment AND an `adw:unverified` label on the issue — a loud fix-forward signal,
       not a buried log line. PENDING until the W1 orchestrator driver lands (see
       Scope notes).
    6. TYPE-CHECK BACKSTOP. The ADW TypeScript type-check still passes after the
       coherence-check module and its wiring land.

  Observability / rot-prevention note:

    Every assertion below targets a value the system PRODUCES at runtime over INPUT
    test data the step supplies — never the text, shape, or existence of a source
    file of this repo:

      • §1–§4 assert the verdict `stackCoherenceCheck` RESOLVES over a framework NAME
        and a run-command STRING the step supplies as INPUT test data — exactly the
        category of feature-577 §4–§7's verdict-over-canned-signals and feature-579
        §2's extension-over-framework-name. The framework/run-command pair is input,
        not a source file; the resolved ok/warning verdict is the produced value.
      • §5 asserts the orchestrator subprocess exit code (registry T5), the absence of
        an error in the state file the orchestrator WRITES (registry T9 — a produced
        artefact), a comment recorded by the mock GitHub API (registry T2), and an
        `adw:unverified` label application recorded by the mock GitHub API (registry
        T12) — all runtime outputs of a spawned process over an INPUT worktree
        descriptor the step authors into a test worktree (the `.adw/` fixture is the
        same category as feature-577 §8/§9's worktree framework declaration).
      • §6 asserts the type-checker's verdict (registry T22), not any file's text.

    Deliberately NOT asserted (would violate the framework Rot-Prevention rule): that
    a `stackCoherenceCheck` module file exists, that `projectConfig` / `stepDefDetection`
    gained anything, that `adw_init.md` emits coherence wiring or a particular
    `bddFramework`, that `unitTestPhase` / the proof path calls the check, or any
    substring/AST match against any source file. The exhaustive coherence table —
    every Gherkin runner × every language pairing, every non-Gherkin name, empty /
    malformed framework — is the implementer's unit test under
    `adws/core/__tests__/stackCoherenceCheck.test.ts` (the "(unit-tested)" suffix in
    AC1). No step reads any source file of this repo as text, substring-matches its
    contents, or parses it as JSON/AST.

  Scope notes:

    • AC1 ("`stackCoherenceCheck` returns ok/warning … (unit-tested)") is split as the
      siblings split theirs: the OBSERVABLE decisions are pinned here (§1 coherent
      across languages; §2 the canonical mismatch; §3 the Gherkin-mandate isolation;
      §4 non-blocking), and the EXHAUSTIVE pairing table belongs in the implementer's
      `adws/core/__tests__/stackCoherenceCheck.test.ts`. These scenarios pin only the
      representative observable verdicts, mirroring feature-577/578's split between BDD
      behaviour and implementer unit tests.
    • AC2's Gherkin-mandate set is the framework→runtime map established by the blocker
      #579 (`stepDefExtensionsFor` / `FRAMEWORK_EXTENSION_MAP` in `stepDefDetection.ts`):
      a name in that map (cucumber-js, pytest-bdd, behave, godog, cucumber-rs,
      cucumber-ruby) is Gherkin-based; a name outside it (jest, pytest, rspec) is not.
      §3 pins a representative non-Gherkin subset; the exhaustive membership table is
      the implementer's unit test.
    • AC3 (channel emission) + AC4 (never blocks, end-to-end) — §5 is end-to-end through
      an orchestrator and therefore PENDING until the ISSUE-3-CUTOVER lands the W1
      subprocess driver (`features/regression/step_definitions/whenSteps.ts` currently
      returns `'pending'`), exactly as feature-577 §8/§9 and feature-576 §4/§5. The
      `adw:unverified` comment+label channel itself is the SHARED infrastructure already
      built by #577 (`applyLabel` + `postIssueStageComment`, wired in `unitTestPhase`);
      #581 adds the coherence→channel wiring. The exact wiring locus (workflow-init vs
      the proof/test path) is the implementer's; §5 pins only the observable channel
      contract — a comment and the label recorded, the subprocess exiting 0 with no
      error — not the internal phase. It is written now as the spec and activates when
      the harness can drive a real orchestrator.
    • "Warn loud, NON-BLOCKING" means the check has NO blocking outcome — its result
      space is ok | warning, never hard-fail. §4 pins this at the helper (a returned
      advisory, not a throw); §5 pins it end-to-end (exit 0, no error). The deliberate
      contrast is `computeTestVerdict`, which CAN resolve to hard-fail — the coherence
      check cannot.
    • The `@regression` maintenance sweep is SKIPPED for this issue: `.adw/scenarios.md`
      configures a `## Regression Scenario Directory`, so promotion is a deliberate
      human decision and the agent never auto-promotes.

  Vocabulary note:

    Reused registered phrases (`features/regression/vocabulary.md`):
      G18 (`the ADW codebase is checked out`),
      G3  (`the claude-cli-stub is loaded with manifest {string}`),
      G9  (`the claude-cli-stub is loaded with fixture {string}`),
      G4  (`an issue {int} exists in the mock issue tracker`),
      G1  (`the mock GitHub API is configured to accept issue comments`),
      G12 (`the mock GitHub API is configured to accept label applications`),
      G11 (`the worktree for adwId {string} is initialised at branch {string}`),
      W1  (`the {string} orchestrator is invoked with adwId {string} and issue {int}`),
      T5  (`the orchestrator subprocess exited {int}`),
      T9  (`the state file for adwId {string} records no error`),
      T2  (`the mock GitHub API recorded a comment on issue {int}`),
      T12 (`the mock GitHub API recorded an application of the {string} label on issue {int}`),
      T22 (`the ADW TypeScript type-check passes`).

    Novel phrasing introduced here (no registered phrase fits — the registry has no
    coherence-check or incoherent-descriptor phrase). The gap is surfaced to the
    maintainer in the agent Output:
      • `the stack-coherence check is resolved for detected BDD framework {string} and scenario run command {string}`
      • `the stack-coherence check result is {string}`
      • `the stack-coherence check is non-blocking`
      • `the worktree for adwId {string} declares an incoherent stack config`

    New scripted manifest required for §5 (created alongside this feature by the
    implementer; canned agent interactions, not a source file). It scripts a clean
    plan/build/test run so the workflow REACHES and passes the non-blocking coherence
    check, leaving the worktree's incoherent `.adw/` descriptor as the only variable
    that fires the channel:
      • `test/fixtures/jsonl/manifests/adw-stack-coherence-happy.json`

  Background:
    Given the ADW codebase is checked out

  # ── §1 Coherent — framework matched to its native run-command language → ok ─────
  #
  # A detected config whose Gherkin framework is paired with its native run command
  # resolves to ok, in EVERY language. This is both AC1-positive (coherent → ok) and
  # AC2-positive (every known Gherkin runner passes the Gherkin-mandate axis), and it
  # proves coherence is language-agnostic: a coherent Python/Go/Rust/Ruby stack is
  # never flagged merely for being non-JS.

  @adw-581 @adw-l8a10n-stack-coherence-chec
  Scenario Outline: A coherent Gherkin stack matched to its run-command language resolves to ok
    When the stack-coherence check is resolved for detected BDD framework "<framework>" and scenario run command "<runCommand>"
    Then the stack-coherence check result is "ok"

    Examples:
      | framework     | runCommand                       |
      | cucumber-js   | bunx cucumber-js --tags @adw-581 |
      | pytest-bdd    | pytest tests/                    |
      | behave        | behave features/                 |
      | godog         | go test ./...                    |
      | cucumber-rs   | cargo test                       |
      | cucumber-ruby | bundle exec cucumber             |

  # ── §2 Language mismatch — framework language ≠ run-command language → warning ──
  #
  # The AC1 / US22 mis-detection: the detected framework's language disagrees with the
  # run-command language. Row 1 is the PRD's exact example — a Python stack
  # (pytest-bdd, the Gherkin runner adw_init picks for Python) carrying a cucumber-js
  # run command (the mis-default). Row 2 is the mirror (JS framework, Python command);
  # row 3 a Go framework with a JS command. One incoherence, three directions.

  @adw-581 @adw-l8a10n-stack-coherence-chec
  Scenario Outline: A framework whose language disagrees with the run command resolves to a warning
    When the stack-coherence check is resolved for detected BDD framework "<framework>" and scenario run command "<runCommand>"
    Then the stack-coherence check result is "warning"

    Examples:
      | framework   | runCommand                       |
      | pytest-bdd  | bunx cucumber-js --tags @adw-581 |
      | cucumber-js | pytest tests/                    |
      | godog       | bunx cucumber-js --tags @adw-581 |

  # ── §3 Gherkin mandate — non-Gherkin framework → warning, language match notwithstanding ─
  #
  # AC2 / US31, isolated from AC1: each row is LANGUAGE-COHERENT (framework and run
  # command share a language) but the framework is NOT Gherkin-based, so the
  # Gherkin-mandate axis alone produces the warning. If only the language axis existed
  # these would resolve to ok — the warning is the proof the two axes are independent.

  @adw-581 @adw-l8a10n-stack-coherence-chec
  Scenario Outline: A non-Gherkin framework is flagged even when its run-command language matches
    When the stack-coherence check is resolved for detected BDD framework "<framework>" and scenario run command "<runCommand>"
    Then the stack-coherence check result is "warning"

    Examples:
      | framework | runCommand        |
      | jest      | npx jest          |
      | pytest    | pytest tests/     |
      | rspec     | bundle exec rspec |

  # ── §4 Never blocks (helper) — the warning is a returned advisory, not a throw ──
  #
  # AC4 at the decision layer. The canonical incoherent config resolves to a warning
  # VALUE — the check returns rather than throwing, and its result space carries no
  # blocking/hard-fail outcome. "Warn loud, non-blocking."

  @adw-581 @adw-l8a10n-stack-coherence-chec
  Scenario: An incoherent detected config yields a non-blocking warning, never a thrown or blocking outcome
    When the stack-coherence check is resolved for detected BDD framework "pytest-bdd" and scenario run command "bunx cucumber-js --tags @adw-581"
    Then the stack-coherence check result is "warning"
    And the stack-coherence check is non-blocking

  # ── §5 Channel + never blocks (end to end) — adw:unverified comment + label, exit 0 ─
  #
  # AC3 + AC4 end-to-end (PENDING until ISSUE-3-CUTOVER lands the W1 driver). A
  # workflow whose worktree carries an incoherent detected `.adw/` descriptor does NOT
  # fail (orchestrator exits 0, state file records no error) yet records an
  # adw:unverified comment AND label on the issue — the loud, non-blocking fix-forward
  # signal. The channel is #577's shared infrastructure; #581 wires coherence into it.

  @adw-581 @adw-l8a10n-stack-coherence-chec
  Scenario: An incoherent detected stack warns through the adw:unverified channel without blocking the workflow
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/adw-stack-coherence-happy.json"
    And the claude-cli-stub is loaded with fixture "plan-agent.json"
    And an issue 5810 exists in the mock issue tracker
    And the mock GitHub API is configured to accept issue comments
    And the mock GitHub API is configured to accept label applications
    And the worktree for adwId "test-5810" is initialised at branch "feature-5810"
    And the worktree for adwId "test-5810" declares an incoherent stack config
    When the "test" orchestrator is invoked with adwId "test-5810" and issue 5810
    Then the orchestrator subprocess exited 0
    And the state file for adwId "test-5810" records no error
    And the mock GitHub API recorded an application of the "adw:unverified" label on issue 5810
    And the mock GitHub API recorded a comment on issue 5810

  # ── §6 Type-check backstop ──────────────────────────────────────────────────────

  @adw-581 @adw-l8a10n-stack-coherence-chec
  Scenario: TypeScript type-check passes after the stack-coherence check lands
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
