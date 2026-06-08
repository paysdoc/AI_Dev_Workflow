@adw-538 @adw-n9880l-adwversion-deep-modu
Feature: adwVersion deep module — read and write a target repo's .adw-version hash file

  Issue #538 builds the foundation module for the parent PRD
  (`specs/prd/adw-init-hash-and-label-classification.md`, "Hash storage on
  target repos"). Every target repo carries a `.adw-version` file at its
  worktree root recording the framework hash it last initialised with. This
  module is the only reader and writer of that file.

  The contract is deliberately tiny and metadata-free:

    1. `readAdwVersion(worktreePath)` returns the stored hash, trimmed, when
       `<worktreePath>/.adw-version` exists.
    2. `readAdwVersion(worktreePath)` returns `null` when the file is absent.
       "No `.adw-version`" composes naturally with "hash mismatch with N/A on
       one side", which is what lets first-bootstrap and upgrade collapse into
       a single downstream code path — so the absent case returning `null`
       (not throwing, not "") is load-bearing for the callers in later slices.
    3. `writeAdwVersion(worktreePath, hash)` writes the bare hash followed by a
       single trailing newline — no surrounding metadata, no second line.
    4. Reads tolerate trailing whitespace and stray newlines, so a
       hand-edited or differently-serialised file still yields the same hash.

  Observability / rot-prevention note:

    Every assertion below targets an output of the system under test, never the
    text of a source file:

      • Read scenarios assert the *return value* of `readAdwVersion` — the hash
        string, or `null`.
      • Write scenarios assert the bytes of the `.adw-version` file the module
        *produces*. That file is an artefact written at runtime — the direct
        output of `writeAdwVersion` — exactly like the orchestrator state files
        the vocabulary Rot-Detection Rubric explicitly permits asserting
        against (entry T1 reads a state file the orchestrator wrote). It is the
        target repo's data file, not a source file of this repo.

    No step reads the module's own source (wherever `readAdwVersion` /
    `writeAdwVersion` come to live), parses it, or substring-matches its text.
    The behaviour is proven entirely by calling the two functions and observing
    what they return and what they leave on disk. The `.adw-version` file is
    set up as a fixture input for read scenarios and inspected as a produced
    artefact for write scenarios — never asserted as a source-code property.

  Scope notes:

    • This module only reads and writes the file. Computing the framework hash
      (the `hashComputer` module), deciding whether the stored value is stale,
      and the upgrade-claim flow are all separate slices and out of scope here;
      these scenarios treat the hash purely as an opaque 64-character string.
    • The fixed location `<worktreePath>/.adw-version` (root, outside `.adw/`)
      is part of the contract because it keeps the LLM `.adw/` regen from
      clobbering the version marker. The scenarios drive the module through
      `worktreePath` rather than asserting a hard-coded absolute path, so the
      root-relative placement is exercised without pinning a brittle path.

  Vocabulary note:

    `features/regression/vocabulary.md` registers only orchestrator-, phase-,
    and mock-query-level phrases; none cover a pure read/write file module.
    Per the vocabulary-preference rule, novel Gherkin phrasing is introduced
    here and the gap is surfaced to the maintainer in the agent Output. The one
    reused phrase is the cross-cutting "the ADW TypeScript type-check passes"
    backstop (§5), already established by features #533 and #535.

  Background:
    Given the ADW codebase is checked out

  # ── §1 Read — file present ─────────────────────────────────────────────────

  @adw-538 @adw-n9880l-adwversion-deep-modu
  Scenario: readAdwVersion returns the stored hash when .adw-version is present
    Given a target worktree whose ".adw-version" file contains the hash "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" followed by a single trailing newline
    When readAdwVersion is called on that worktree
    Then readAdwVersion returns "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"

  # ── §2 Read — file absent → null ───────────────────────────────────────────

  @adw-538 @adw-n9880l-adwversion-deep-modu
  Scenario: readAdwVersion returns null when .adw-version is absent
    Given a target worktree that has no ".adw-version" file
    When readAdwVersion is called on that worktree
    Then readAdwVersion returns null

  # ── §3 Read — trailing whitespace and stray newlines are tolerated ─────────

  @adw-538 @adw-n9880l-adwversion-deep-modu
  Scenario: readAdwVersion tolerates trailing spaces after the stored hash
    Given a target worktree whose ".adw-version" file contains the hash "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" followed by trailing spaces and a newline
    When readAdwVersion is called on that worktree
    Then readAdwVersion returns "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"

  @adw-538 @adw-n9880l-adwversion-deep-modu
  Scenario: readAdwVersion tolerates several stray trailing newlines
    Given a target worktree whose ".adw-version" file contains the hash "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" followed by several blank lines
    When readAdwVersion is called on that worktree
    Then readAdwVersion returns "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"

  @adw-538 @adw-n9880l-adwversion-deep-modu
  Scenario: readAdwVersion returns the hash when .adw-version has no trailing newline
    Given a target worktree whose ".adw-version" file contains the hash "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" with no trailing newline
    When readAdwVersion is called on that worktree
    Then readAdwVersion returns "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"

  # ── §4 Write — bare hash plus a single trailing newline ────────────────────

  @adw-538 @adw-n9880l-adwversion-deep-modu
  Scenario: writeAdwVersion writes the hash followed by exactly one trailing newline
    Given a target worktree with no ".adw-version" file
    When writeAdwVersion is called on that worktree with the hash "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    Then the ".adw-version" artefact in that worktree contains exactly the hash "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" followed by a single newline

  @adw-538 @adw-n9880l-adwversion-deep-modu
  Scenario: a hash written by writeAdwVersion reads back unchanged through readAdwVersion
    Given a target worktree with no ".adw-version" file
    When writeAdwVersion is called on that worktree with the hash "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    And readAdwVersion is called on that worktree
    Then readAdwVersion returns "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"

  @adw-538 @adw-n9880l-adwversion-deep-modu
  Scenario: writeAdwVersion overwrites an existing .adw-version with the new hash and a single newline
    Given a target worktree whose ".adw-version" file already contains the hash "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" followed by a single trailing newline
    When writeAdwVersion is called on that worktree with the hash "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    Then the ".adw-version" artefact in that worktree contains exactly the hash "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" followed by a single newline

  # ── §5 Type-check ──────────────────────────────────────────────────────────

  @adw-538 @adw-n9880l-adwversion-deep-modu
  Scenario: TypeScript type-check passes for the adwVersion module
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
