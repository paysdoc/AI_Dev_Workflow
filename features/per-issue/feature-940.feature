@adw-940 @adw-z62hd4-feat-map-module-docs
Feature: Module docs name the decision records that govern them: the index block is authoritative, the doc's Decisions section mirrors it, and the docs-index gate fails when the two differ or a listed record does not exist

  Issue #940 links the module docs in `app_docs/` to the decision records in `specs/adr/`. The
  relation is many-to-many and optional: a doc may list no record or several, and a record may
  govern no doc or several.

    • Index. An entry in `.adw/conditional_docs.md` may carry a `Decisions:` block listing ADR
      numbers. The block is authoritative. Today the registry parser
      (`adws/core/conditionalDocsRegistry.ts`) does not know the block. It skips the header and
      files the records under the list before it in the entry, or drops them when there is none,
      so an index that carries the block fails the gate's round-trip check.
    • Doc. A module doc with decisions has a `## Decisions` section listing the same records,
      each linked to its file in `specs/adr/`.
    • Gate. `bun run lint:docs-index` (`adws/checkLivingDocsIndex.ts`) fails when a doc's section
      and its index block differ, and when a listed record does not exist.
    • Writer. `/document` writes and preserves both. Its rewrites have dropped references before:
      commit 9f28d82b removed the GitContext doc's only pointer into `specs/`. The gate is what
      holds the mapping in place.
    • Seed. The existing module docs get their mapping from `specs/adr/README.md`.

  `document.md` is a hash input, so the change starts an upgrade on every target repo. A target
  repo without `specs/adr/` must pass the gate with no `Decisions:` blocks.

  The labels below are the section numbers used for the scenario groups further down (§1–§5):

    §1  THE PARSER KNOWS THE BLOCK (AC1). An index whose entries carry `Decisions:` blocks
        round-trips byte for byte, and each parsed entry lists its records in order, apart from
        its `Owns:` globs and `Conditions:`. A misspelt block still fails the round trip: the
        parser learns this block, not every unknown one. Collapsing two sibling entries, which
        `/document` does when two entries cover one module, keeps the records of both.

    §2  THE GATE HOLDS EACH DOC TO ITS BLOCK (AC2). Over a fixture repository whose index is
        otherwise healthy, the gate passes when every doc's section lists the records of its
        block. It fails, naming the doc, when they differ: a record missing on either side, a
        section lost in a rewrite, a section with no block.

    §3  THE GATE KNOWS WHICH RECORDS EXIST (AC2). A record that block and section agree on, but
        that has no file in `specs/adr/`, fails the gate, which names it.

    §4  A REPOSITORY WITH NO DECISION RECORDS (AC3). With no `specs/adr/` and no `Decisions:`
        blocks, the gate passes. With no `specs/adr/` and a block, it fails: an upgraded
        `/document` must not invent records in a target repo.

    §5  THE ADW CHECKOUT (AC4, AC5). `bun run lint:docs-index` passes on the checkout. The seeded
        mapping is in force: a copy of the checkout whose module docs have lost their Decisions
        sections fails the gate. A type-check backstop follows.

  Each row is written to fail for a specific wrong implementation:
    • the round-trip row fails for today's parser, for a serializer that leaves the block out,
      and for one that writes an empty `Decisions:` header on an entry with no records;
    • the parse row fails for a parser that carries the block through as opaque text. That
      round-trips, but leaves the gate nothing to compare. It also fails for today's parser,
      under which alpha owns a glob named 0044;
    • the misspelt-block row fails for a parser that passes any unknown block through to satisfy
      the round trip. A `Decision:` block would then never be checked against its doc;
    • the collapse row fails for a collapse that builds the merged entry from `Owns:` and
      `Conditions:` alone, as `collapseEntries` does today. A doc rewritten from that entry would
      list no record either, block and section would agree, and the gate could not see the loss;
    • the passing row fails for a gate that wants a Decisions section on every doc (the healthy
      fixture docs list none), wants every record listed somewhere (0004 governs no doc), or
      treats a record listed by two docs (0002) as a duplicate;
    • the outline rows fail for a check that runs in one direction only. The third row also
      fails for a check that compares only how many records each side lists;
    • the rewrite row is the 9f28d82b failure mode. It fails for a gate that compares only the
      docs that still have a section;
    • the no-block row fails for a gate that walks only the entries that carry a block. The
      block is authoritative, so a section on its own is a mismatch, not a second source of
      truth;
    • the unknown-record row fails for a gate that only compares section and block, which agree
      here;
    • the first §4 row fails for a gate that needs `specs/adr/` to exist, whether it crashes on
      the missing directory or reports it. The second fails for a gate that skips the decision
      checks when `specs/adr/` is missing;
    • the package-script row fails when any seeded block disagrees with its doc or lists a record
      that does not exist. The copy row fails when the seed is empty: with no block in the index,
      stripping every section changes nothing the gate checks. Its precondition, that the copy
      passes as made, rules out a copy that fails for some other reason.

  ── WHY SOME CRITERIA GET NO SCENARIO OF THEIR OWN ──────────────────────────────────────────
  AC2's unit tests are an obligation on the vitest suite, which the build and test phases
  discharge; §2 and §3 are their behavioural counterpart. AC4 is a fact about the seeded data.
  Which records govern which doc is a judgement taken from `specs/adr/README.md` and the records
  themselves, and a scenario could pin a pairing only by reading the index as source text, which
  the rot-prevention rule forbids. §5 gives AC4 two behavioural anchors instead: the gate passes
  on the checkout, so every seeded block matches its doc and lists records that exist; and the
  seed is not empty. Whether it is complete is checked in review. The `/document` prompt runs
  only inside a real Claude session, which this harness never starts. What it must write is what
  §2 checks, and the collapse helper it names is §1's last row. That `document.md` is a hash
  input is existing behaviour, pinned by `features/regression/hashing/feature-537.feature`.

  Not pinned here, and left to the plan:
    • where the `Decisions:` block sits within an entry, and how a record number is written in
      it. The canonical form is the serializer's; the step definitions write their fixtures in
      it;
    • whether a block and a section that hold the same records in a different order differ;
    • whether the gate checks that a section's links resolve. The scenarios always link each
      record to the path of its file in `specs/adr/`;
    • whether the docs-index sweep (`adws/triggers/docsIndexSweep.ts`), which shares
      `adws/core/docsIndexHealth.ts` with the gate, reports the new findings too.

  Notes for the step definitions:
    • NEVER RUN THE REAL `/document` COMMAND OR THE REAL CLAUDE CLI. Every input here is a
      throwaway fixture the steps write.
    • "a living-docs index text, in canonical form, holding these entries:" builds the index text
      in memory, one entry per row in table order, under the `# Conditional Documentation`
      preamble:
        – `owns` is a comma-separated glob list; an empty cell means no `Owns:` block (a legacy
          entry);
        – `decisions` is a comma-separated record list; an empty cell means no `Decisions:` block;
        – every entry gets two `Conditions:` lines that name its doc path.
      Write the text by hand in the canonical form the implementation defines, never through
      `serializeConditionalDocs`. That function is under test, and text it built would
      round-trip by construction.
    • "is parsed" calls `parseConditionalDocs`. "parsed and serialized again" calls
      `serializeConditionalDocs(parseConditionalDocs(text))`.
    • "lists these decision records" compares each parsed entry's records with its row, in
      order; an empty cell means none. "keeps exactly the Owns globs and Conditions it was
      written with" compares each parsed entry with what the Given wrote.
    • "are collapsed into" parses the text and calls `collapseEntries` with both doc paths and,
      as the merged entry, the surviving doc path and its conditions. Step 5 of `/document`
      names this helper. "each once" checks that the surviving entry holds every given record
      exactly once, in any order.
    • "a fixture repository whose living-docs index and module docs are healthy" builds a
      throwaway directory that today's gate passes, as `healthyEntries()` does in
      `adws/__tests__/checkLivingDocsIndex.test.ts`:
        – about 40 legacy entries, each with a one-line doc under `app_docs/`, plus `README.md`
          and `adws/README.md`, so the count stays inside the gate's band of 25 to 60 once the
          scenario adds its own entries;
        – no Decisions section, no `Decisions:` block, no `specs/adr/`;
        – no fixture name contains four digits in a row, so a record number in the report can
          only come from the decision checks.
      Remove the directory after each scenario.
    • "holds the decision records" writes one file per record, `specs/adr/<number>-<slug>.md`.
      "has no ADR directory" makes sure `specs/adr/` is absent.
    • A module doc that a step names and the fixture lacks is added in full: the doc under
      `app_docs/`, one source file under `src/<name>/`, and an index entry that owns
      `src/<name>/**`. The gate then round-trips entries that carry `Owns:`, `Decisions:` and
      `Conditions:` together.
    • "carries a Decisions block listing" writes the records in the given order, in canonical
      form. "carries a block named "Decision:" listing" writes that header verbatim where a
      `Decisions:` block goes. "carries no Decisions block" leaves the entry without one.
    • "has a Decisions section listing" writes a `## Decisions` section, one line per record,
      each linked to its file relative to the doc (`../specs/adr/<file>`). A record with no file
      links to the path its file would have.
    • "is rewritten without its Decisions section" overwrites the doc with a different body and
      no `## Decisions` heading. It leaves the index alone, as a `/document` rewrite that lost
      the section would.
    • "the docs-index gate is run over the fixture repository" runs
      `bunx tsx adws/checkLivingDocsIndex.ts <fixture root>` from the ADW checkout root and
      captures the exit status and stdout. Calling `runLivingDocsIndexCheck(root)` in-process
      is fine. "run through its package script entry point" runs `bun run lint:docs-index` in
      the ADW checkout root, as the gate step of feature 909 does.
    • "exits 0" and "fails" assert exit status 0 and 1, showing the captured report on failure.
      "report names" matches the doc path as a substring. "names the decision records" matches
      each record number as a whole token, with or without an `ADR-` prefix. "reports the index
      as non-canonical" matches the round-trip check's `non-canonical serialization` detail.
    • "a copy of the ADW checkout's living-docs index, module docs and decision records" copies
      into a throwaway directory `.adw/conditional_docs.md`, all of `app_docs/` and `specs/adr/`,
      and every other file an index entry names as its doc (today `README.md` and
      `adws/README.md`). Source files stay behind, so `Owns:` globs match nothing; the gate
      reports dead globs as warnings, not failures. "passes over that copy" runs the gate on the
      copy and asserts exit 0.
    • "loses its Decisions section" removes from every doc under `app_docs/` in the copy the
      `## Decisions` heading and everything after it up to the next `## ` heading or the end of
      the file. The index is left alone.
    • These phrases are defined elsewhere:
        – "the ADW codebase is checked out" in
          `features/step_definitions/ensureCronOnEveryEventSteps.ts`;
        – "the ADW TypeScript type-check passes" in
          `features/regression/step_definitions/thenSteps.ts`.

  Vocabulary note. These registered phrases from `features/regression/vocabulary.md` are reused:
    • G18 `the ADW codebase is checked out`
    • T22 `the ADW TypeScript type-check passes`
  The registry has no phrase for the living-docs index, its parser, module docs, decision
  records or the docs-index gate, so novel phrasing is introduced. The gate phrasing mirrors the
  envelope conformance gate of feature 909 ("is run through its package script entry point",
  "exits 0", "fails").

  # ── §1 THE PARSER KNOWS THE BLOCK ─────────────────────────────────────────────────────────────

  @adw-940 @adw-z62hd4-feat-map-module-docs
  Scenario: An index whose entries carry Decisions blocks round-trips through the registry parser byte for byte
    Given a living-docs index text, in canonical form, holding these entries:
      | docPath                   | owns                     | decisions  |
      | app_docs/feature-alpha.md | src/alpha/**             | 0044, 0053 |
      | app_docs/feature-beta.md  |                          | 0012       |
      | app_docs/feature-gamma.md | src/gamma/*.ts, src/g.ts |            |
      | README.md                 |                          |            |
    When the living-docs index text is parsed and serialized again
    Then the serialized index text is identical to the original

  @adw-940 @adw-z62hd4-feat-map-module-docs
  Scenario: Each parsed entry lists its decision records in order, apart from its Owns globs and Conditions
    Given a living-docs index text, in canonical form, holding these entries:
      | docPath                   | owns                     | decisions  |
      | app_docs/feature-alpha.md | src/alpha/**             | 0044, 0053 |
      | app_docs/feature-beta.md  |                          | 0012       |
      | app_docs/feature-gamma.md | src/gamma/*.ts, src/g.ts |            |
      | README.md                 |                          |            |
    When the living-docs index text is parsed
    Then the parsed entries list these decision records:
      | docPath                   | decisions  |
      | app_docs/feature-alpha.md | 0044, 0053 |
      | app_docs/feature-beta.md  | 0012       |
      | app_docs/feature-gamma.md |            |
      | README.md                 |            |
    And every parsed entry keeps exactly the Owns globs and Conditions it was written with

  @adw-940 @adw-z62hd4-feat-map-module-docs
  Scenario: A misspelt Decisions block still fails the docs-index gate's round-trip check
    Given a fixture repository whose living-docs index and module docs are healthy
    And the fixture repository holds the decision records "0001"
    And the index entry for "app_docs/feature-alpha.md" carries a block named "Decision:" listing "0001"
    And the module doc "app_docs/feature-alpha.md" has a Decisions section listing "0001"
    When the docs-index gate is run over the fixture repository
    Then the docs-index gate fails
    And the docs-index gate reports the index as non-canonical

  @adw-940 @adw-z62hd4-feat-map-module-docs
  Scenario: Collapsing two sibling entries keeps the decision records of both on the surviving entry
    Given a living-docs index text, in canonical form, holding these entries:
      | docPath                   | owns         | decisions  |
      | app_docs/feature-alpha.md | src/alpha/** | 0001, 0002 |
      | app_docs/feature-beta.md  | src/beta/**  | 0002, 0003 |
    When the entries for "app_docs/feature-alpha.md" and "app_docs/feature-beta.md" in that index are collapsed into "app_docs/feature-alpha.md"
    Then the collapsed entry for "app_docs/feature-alpha.md" lists the decision records "0001, 0002, 0003", each once

  # ── §2 THE GATE HOLDS EACH DOC TO ITS BLOCK ───────────────────────────────────────────────────

  @adw-940 @adw-z62hd4-feat-map-module-docs
  Scenario: Module docs whose Decisions sections list the records of their index blocks pass the docs-index gate
    Given a fixture repository whose living-docs index and module docs are healthy
    And the fixture repository holds the decision records "0001, 0002, 0003, 0004"
    And the index entry for "app_docs/feature-alpha.md" carries a Decisions block listing "0001, 0002"
    And the module doc "app_docs/feature-alpha.md" has a Decisions section listing "0001, 0002"
    And the index entry for "app_docs/feature-beta.md" carries a Decisions block listing "0002, 0003"
    And the module doc "app_docs/feature-beta.md" has a Decisions section listing "0002, 0003"
    When the docs-index gate is run over the fixture repository
    Then the docs-index gate exits 0

  @adw-940 @adw-z62hd4-feat-map-module-docs
  Scenario Outline: A Decisions section that lists other records than its index block fails the docs-index gate, naming the doc and every differing record
    Given a fixture repository whose living-docs index and module docs are healthy
    And the fixture repository holds the decision records "0001, 0002, 0003"
    And the index entry for "app_docs/feature-alpha.md" carries a Decisions block listing "<block>"
    And the module doc "app_docs/feature-alpha.md" has a Decisions section listing "<section>"
    When the docs-index gate is run over the fixture repository
    Then the docs-index gate fails
    And the docs-index gate report names "app_docs/feature-alpha.md"
    And the docs-index gate report names the decision records "<differing>"

    Examples:
      | block      | section    | differing  |
      | 0001, 0002 | 0001       | 0002       |
      | 0001       | 0001, 0002 | 0002       |
      | 0001, 0002 | 0001, 0003 | 0002, 0003 |

  @adw-940 @adw-z62hd4-feat-map-module-docs
  Scenario: A rewrite that drops a module doc's Decisions section fails the docs-index gate while the index block still lists the records
    Given a fixture repository whose living-docs index and module docs are healthy
    And the fixture repository holds the decision records "0001, 0002"
    And the index entry for "app_docs/feature-alpha.md" carries a Decisions block listing "0001, 0002"
    And the module doc "app_docs/feature-alpha.md" has a Decisions section listing "0001, 0002"
    When the module doc "app_docs/feature-alpha.md" is rewritten without its Decisions section
    And the docs-index gate is run over the fixture repository
    Then the docs-index gate fails
    And the docs-index gate report names "app_docs/feature-alpha.md"

  @adw-940 @adw-z62hd4-feat-map-module-docs
  Scenario: A Decisions section whose index entry carries no Decisions block fails the docs-index gate, because the block is authoritative
    Given a fixture repository whose living-docs index and module docs are healthy
    And the fixture repository holds the decision records "0001"
    And the index entry for "app_docs/feature-alpha.md" carries no Decisions block
    And the module doc "app_docs/feature-alpha.md" has a Decisions section listing "0001"
    When the docs-index gate is run over the fixture repository
    Then the docs-index gate fails
    And the docs-index gate report names "app_docs/feature-alpha.md"

  # ── §3 THE GATE KNOWS WHICH RECORDS EXIST ─────────────────────────────────────────────────────

  @adw-940 @adw-z62hd4-feat-map-module-docs
  Scenario: A decision record that block and section agree on but that has no file in the ADR directory fails the docs-index gate, naming the record
    Given a fixture repository whose living-docs index and module docs are healthy
    And the fixture repository holds the decision records "0001, 0002"
    And the index entry for "app_docs/feature-alpha.md" carries a Decisions block listing "0001, 0099"
    And the module doc "app_docs/feature-alpha.md" has a Decisions section listing "0001, 0099"
    When the docs-index gate is run over the fixture repository
    Then the docs-index gate fails
    And the docs-index gate report names "app_docs/feature-alpha.md"
    And the docs-index gate report names the decision records "0099"

  # ── §4 A REPOSITORY WITH NO DECISION RECORDS ──────────────────────────────────────────────────

  @adw-940 @adw-z62hd4-feat-map-module-docs
  Scenario: A repository with no ADR directory and no Decisions blocks passes the docs-index gate
    Given a fixture repository whose living-docs index and module docs are healthy
    And the fixture repository has no ADR directory
    When the docs-index gate is run over the fixture repository
    Then the docs-index gate exits 0

  @adw-940 @adw-z62hd4-feat-map-module-docs
  Scenario: A repository with no ADR directory whose index lists a decision record fails the docs-index gate, naming the record
    Given a fixture repository whose living-docs index and module docs are healthy
    And the fixture repository has no ADR directory
    And the index entry for "app_docs/feature-alpha.md" carries a Decisions block listing "0001"
    And the module doc "app_docs/feature-alpha.md" has a Decisions section listing "0001"
    When the docs-index gate is run over the fixture repository
    Then the docs-index gate fails
    And the docs-index gate report names "app_docs/feature-alpha.md"
    And the docs-index gate report names the decision records "0001"

  # ── §5 THE ADW CHECKOUT ───────────────────────────────────────────────────────────────────────

  @adw-940 @adw-z62hd4-feat-map-module-docs
  Scenario: The docs-index gate passes on the ADW checkout when run through its package script entry point
    Given the ADW codebase is checked out
    When the docs-index gate is run through its package script entry point
    Then the docs-index gate exits 0

  @adw-940 @adw-z62hd4-feat-map-module-docs
  Scenario: The seeded mapping is in force on the ADW checkout: a copy whose module docs lose their Decisions sections fails the docs-index gate
    Given a copy of the ADW checkout's living-docs index, module docs and decision records
    And the docs-index gate passes over that copy
    When every module doc in that copy loses its Decisions section
    And the docs-index gate is run over that copy
    Then the docs-index gate fails

  @adw-940 @adw-z62hd4-feat-map-module-docs
  Scenario: TypeScript type-check passes with decision records on the index entries
    Then the ADW TypeScript type-check passes
