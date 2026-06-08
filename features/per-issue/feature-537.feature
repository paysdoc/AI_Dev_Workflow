@adw-537 @adw-zapagn-hashcomputer-deep-mo
Feature: hashComputer — a pure deep module that computes the framework's content hash from declared inputs

  Issue #537 builds the first deep module of the "ADW init via content hash"
  redesign (parent PRD `specs/prd/adw-init-hash-and-label-classification.md`,
  User Story 3). `hashComputer` reads the `hashInputs:` frontmatter on
  `/adw_init.md`, resolves the listed files, concatenates their bytes in a
  canonical (order-independent) order, and returns a SHA256 hex digest. The
  same change adds the `hashInputs:` frontmatter field to `/adw_init.md`
  itself — today's declared set is `.claude/commands/adw_init.md` and
  `templates/vocabulary.md.template`.

  The digest is the *contract* the rest of the redesign keys on: downstream
  modules (`adwVersion`, `upgradeClaim`) and the `initializeWorkflow()` hash
  check compare a target repo's `.adw-version` against this value to decide
  whether a framework upgrade is needed. This issue delivers only the pure
  hash function plus the spec change; the consumers are separate issues.

  The behavioural contract pinned below:

    1. Given a framework whose `/adw_init.md` declares a `hashInputs:` list of
       files that all resolve, the module returns a SHA256 hex digest.
    2. The digest is deterministic — recomputing over identical inputs yields
       the identical digest.
    3. The digest is independent of the order in which files appear in the
       `hashInputs:` list (canonical order or sort).
    4. The digest is sensitive — changing any single byte in any declared
       input file changes the digest.
    5. A missing `hashInputs:` frontmatter declaration is a hard error.
    6. A declared input file that does not resolve is a hard error that names
       the missing file.
    7. Run against the real ADW framework checkout, the module returns a
       stable digest — which is only possible if `/adw_init.md` already carries
       a `hashInputs:` field whose every listed file resolves (§7 below).

  Observability / rot-prevention note:

    Every assertion below targets an artefact the module *produces at runtime*
    — the returned SHA256 digest, or the error it raises — never the text of a
    source file:

      • The fixture scenarios (§§1–6) build a throwaway framework directory,
        seed its `/adw_init.md` and input files as *test inputs the scenario
        itself writes*, then assert on the digest the module returns (or the
        error it raises). The fixture files are inputs to the system under
        test, not source files of the framework.
      • The real-framework scenario (§7) asserts only that the module returns
        a well-formed, stable digest for the live checkout. It never reads
        `.claude/commands/adw_init.md`, `templates/vocabulary.md.template`, or
        the new `hashComputer` source as text, never substring-matches their
        contents, and never parses them as JSON/AST. The acceptance criterion
        "`/adw_init.md` has a `hashInputs:` frontmatter field listing dependent
        files" is proven *behaviourally*: the module returns a digest instead
        of raising the missing-frontmatter or missing-file error it would raise
        if the field were absent or a listed file were unresolvable.

    No step reads a source file's contents and asserts against them; the digest
    and the raised error are the behavioural signals, exactly as the framework
    Rot-Prevention rule and `features/regression/vocabulary.md` Rot-Detection
    Rubric require.

  Scope notes:

    • This file covers only the `hashComputer` module and the `hashInputs:`
      spec change on `/adw_init.md`. The downstream consumers — `adwVersion`,
      `upgradeClaim`, `labelManager`, the `initializeWorkflow()` hash check,
      and `adwUpgrade.tsx` — are separate issues in the parent PRD and are out
      of scope here.
    • The exact concatenation/canonicalisation scheme and the literal SHA256
      constant for a given fixture are implementation choices the PRD leaves
      open ("canonical order or sort — TBD by implementation"). These scenarios
      therefore pin the observable contract — a well-formed digest, determinism,
      order-independence, byte-sensitivity, and clear errors — rather than a
      hardcoded hex value, so they do not break when the implementer picks a
      particular separator or sort key. The exact-value "known SHA256" check
      lives in the module's own fixture unit tests (PRD Testing Decisions),
      which complement, rather than duplicate, this behavioural suite.
    • Whether the module additionally folds `/adw_init.md`'s own raw bytes into
      the digest beyond the listed files is an implementation detail and is not
      asserted; in the real framework `/adw_init.md` is itself a member of its
      own `hashInputs:` list, so its content is covered either way.

  Vocabulary note:

    None of the phrases registered in `features/regression/vocabulary.md` cover
    a pure content-hash module — the registry is scoped to orchestrator / phase
    / mock-query behaviours (spawned orchestrators, executed phases, recorded
    GitHub/git calls). Per the vocabulary-preference rule, novel Gherkin
    phrasing is introduced here and the gap is surfaced to the maintainer in the
    agent Output.

  Background:
    Given the ADW codebase is checked out

  # ── §1 Normal path — declared inputs produce a SHA256 hex digest ───────────

  @adw-537 @adw-zapagn-hashcomputer-deep-mo
  Scenario: The hash computer returns a SHA256 hex digest for a framework with declared, resolvable inputs
    Given a fixture framework whose adw_init spec declares hash inputs:
      | path      |
      | alpha.txt |
      | beta.txt  |
    And the fixture input file "alpha.txt" contains "alpha-content-537"
    And the fixture input file "beta.txt" contains "beta-content-537"
    When the framework content hash is computed for the fixture framework
    Then the most recent computed hash is a 64-character lowercase hexadecimal SHA256 digest

  # ── §2 Determinism & order-independence — reorder does not change the hash ──

  @adw-537 @adw-zapagn-hashcomputer-deep-mo
  Scenario: Reordering the files in the hash inputs list does not change the digest
    Given a fixture framework whose adw_init spec declares hash inputs:
      | path      |
      | alpha.txt |
      | beta.txt  |
    And the fixture input file "alpha.txt" contains "alpha-content-537"
    And the fixture input file "beta.txt" contains "beta-content-537"
    When the framework content hash is computed for the fixture framework
    And the hash inputs in the fixture adw_init spec are reordered to:
      | path      |
      | beta.txt  |
      | alpha.txt |
    And the framework content hash is computed for the fixture framework
    Then the recorded hashes are all identical

  # ── §3 Sensitivity — changing any byte in any declared input changes it ────

  @adw-537 @adw-zapagn-hashcomputer-deep-mo
  Scenario: Changing one byte in any declared input file changes the digest
    Given a fixture framework whose adw_init spec declares hash inputs:
      | path      |
      | alpha.txt |
      | beta.txt  |
    And the fixture input file "alpha.txt" contains "alpha-content-537"
    And the fixture input file "beta.txt" contains "beta-content-537"
    When the framework content hash is computed for the fixture framework
    And the fixture input file "alpha.txt" is modified by a single byte
    And the framework content hash is computed for the fixture framework
    And the fixture input file "beta.txt" is modified by a single byte
    And the framework content hash is computed for the fixture framework
    Then the recorded hashes are all different

  # ── §4 Error — missing hashInputs frontmatter is a hard, clear error ───────

  @adw-537 @adw-zapagn-hashcomputer-deep-mo
  Scenario: A framework whose adw_init spec omits the hashInputs frontmatter raises a clear error
    Given a fixture framework whose adw_init spec omits the hash inputs frontmatter
    When the framework content hash computation is attempted for the fixture framework
    Then the hash computation fails with an error reporting the absent hash inputs declaration

  # ── §5 Error — a declared input that does not resolve names the file ───────

  @adw-537 @adw-zapagn-hashcomputer-deep-mo
  Scenario: A declared input file that does not resolve raises a clear error naming the missing file
    Given a fixture framework whose adw_init spec declares hash inputs:
      | path               |
      | alpha.txt          |
      | does-not-exist.txt |
    And the fixture input file "alpha.txt" contains "alpha-content-537"
    When the framework content hash computation is attempted for the fixture framework
    Then the hash computation fails with an error that names the missing input file "does-not-exist.txt"

  # ── §6 Two distinct frameworks with distinct inputs hash differently ───────

  @adw-537 @adw-zapagn-hashcomputer-deep-mo
  Scenario: Frameworks with the same hash-input filenames but different file content hash differently
    Given a fixture framework whose adw_init spec declares hash inputs:
      | path      |
      | alpha.txt |
    And the fixture input file "alpha.txt" contains "first-framework-content"
    When the framework content hash is computed for the fixture framework
    And a second fixture framework whose adw_init spec declares hash inputs:
      | path      |
      | alpha.txt |
    And the fixture input file "alpha.txt" in the second fixture framework contains "second-framework-content"
    And the framework content hash is computed for the second fixture framework
    Then the recorded hashes are all different

  # ── §7 Real framework — the hashInputs spec change makes a digest resolvable ─

  @adw-537 @adw-zapagn-hashcomputer-deep-mo
  Scenario: The hash computer returns a stable digest for the real ADW framework checkout
    When the framework content hash is computed for the ADW framework under test
    And the framework content hash is computed for the ADW framework under test
    Then the most recent computed hash is a 64-character lowercase hexadecimal SHA256 digest
    And the recorded hashes are all identical

  # ── §8 Type-check ──────────────────────────────────────────────────────────

  @adw-537 @adw-zapagn-hashcomputer-deep-mo
  Scenario: TypeScript type-check passes after adding the hashComputer module
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
