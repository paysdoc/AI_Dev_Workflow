@adw-612 @adw-9gjajh-app-docs-living-docs
Feature: app_docs living-docs one-off migration — clusters the snapshot-era per-run docs into per-module current-state docs and rewrites the index to one entry per module via the registry module

  Issue #612 is the one-off, ADW-only migration that bootstraps the per-module
  living-docs world (parent PRD `specs/prd/app-docs-module-living-docs.md`, user
  story 8). #609 shipped the registry module plus rewrite-in-place; #610 added
  semantic routing and sibling collapse-and-prune; together they make NEW
  `/document` runs converge. But convergence only shrinks an area once that area
  is re-touched, so ADW's accumulated snapshot-era residue — ~191 per-run
  `app_docs/feature-*.md` docs and a `.adw/conditional_docs.md` carrying one entry
  per run — would drain only as features happen to revisit each module. #612
  collapses the whole tree in one pass so the repo gets the bounded-index benefit
  immediately. #612 is BLOCKED BY #610 because it REUSES that shipped seam (the
  registry's parse / collapse / serialize) rather than inventing a second index
  representation.

  What the migration does, and the failure modes it must avoid:

    • CLUSTER THE SNAPSHOTS (AC1). The per-run docs are clustered by owning module
      into ~40 per-module current-state docs. The clustering itself is a
      non-deterministic agent pass (PRD testing decision: "a throwaway agent pass …
      not unit-tested"); these content-assertion scenarios pin its DETERMINISTIC
      structural consequences, never the cluster QUALITY.

    • REWRITE THE INDEX TO ONE ENTRY PER MODULE (AC2). `.adw/conditional_docs.md`
      is re-serialized THROUGH THE REGISTRY MODULE to exactly one entry per module
      — the index is bounded by module count (a few dozen) instead of feature count
      (unbounded), which is the whole point of the PRD.

    • REMOVE THE PER-RUN RESIDUE (AC3). The snapshot-era `feature-*` docs and the
      one-entry-per-run entries that pointed at them are removed. This is a
      DESTRUCTIVE whole-`app_docs/` rewrite; the old docs are not an audit record —
      their history lives in git.

    • PRODUCE A CLEAN, NON-REGROWN INDEX (AC4). The produced index must parse
      cleanly back through the registry module (no dropped or malformed entries) and
      must satisfy the regrowth invariant: no two entries own overlapping file
      globs. A migration that emitted two entries owning the same area would seed
      the very duplicate-regrowth the convergence guards exist to catch — so the
      migration's own output is held to that invariant up front.

    The append-rather-than-refresh bug class the PRD repeatedly diagnoses has a
    migration-specific shape: a lazy migration could merely CONCATENATE each
    module's snapshots into one fat doc (carrying every per-run history section) and
    technically satisfy "one doc per module" while producing bloated, non-current
    docs. §1 pins that the produced module doc is a current-state reference carrying
    no per-run history section, defending that shape directly.

  The behavioural contract pinned below:

    1. SNAPSHOTS FOR ONE AREA COLLAPSE TO ONE CURRENT-STATE DOC + ONE ENTRY (AC1,
       core; §1). A snapshot-era tree whose several per-run docs all describe one
       module area is migrated to exactly one module doc and exactly one index entry
       for that area, and that doc is a current-state reference carrying no per-run
       history section — not a concatenation of the snapshots it replaced.
    2. ONE ENTRY PER MODULE ACROSS THE WHOLE TREE (AC1, AC2 headline; §2). A
       snapshot-era tree spanning several module areas, each with multiple per-run
       entries, is migrated to exactly one entry per area — the produced index holds
       one entry per documented module and a total entry count equal to the module
       count, collapsing the one-entry-per-run inflation the PRD diagnoses.
    3. THE PER-RUN RESIDUE IS REMOVED (AC3; §3). After migration no index entry
       points to a per-run `feature-*` snapshot doc and no per-run snapshot doc
       remains in the produced `app_docs/` tree — the destructive rewrite drops the
       snapshot residue (history preserved in git, not in the working tree).
    4. THE PRODUCED INDEX PARSES CLEANLY THROUGH THE REGISTRY MODULE (AC4; §4). The
       migrated index round-trips through the registry module with no dropped or
       malformed entries — it is a valid registry artefact the convergence path and
       the guards can read, not a hand-rolled markdown blob.
    5. THE PRODUCED INDEX HAS NO OVERLAPPING ENTRIES (AC4, regrowth invariant; §5).
       No two entries in the migrated index own overlapping file globs — the
       migration seeds the taxonomy without the duplicate-ownership regrowth the
       guards exist to flag, so convergence starts from a clean, non-overlapping
       seed.
    6. TYPE-CHECK BACKSTOP (§6). The ADW TypeScript type-check still passes after
       the migration's clustering-and-serialize helpers land on the registry path.

  Observability / rot-prevention note:

    Every assertion below targets an artefact the system PRODUCES at runtime — the
    migrated `.adw/conditional_docs.md` index and the per-module `app_docs/` docs the
    migration writes INTO a temp fixture worktree, or the type-checker's verdict.
    These produced files are OUTPUTS of the system under test, the same artefact
    category the Rot-Detection Rubric permits ("git artifacts produced by a phase",
    "state files written by an orchestrator") and the same category #609 §1–§5,
    #610 §1–§5, and registry phrases T15–T17 already assert against (counting
    entries / docs / tokens on produced artefacts to defend the very
    append-rather-than-refresh bug class this PRD fixes for docs).

      • §1, §2 seed a snapshot-era FIXTURE tree (per-run docs + one-entry-per-run
        index) into a temp worktree (test input), run the migration's
        cluster-and-serialize over it, and assert the PRODUCED index/docs: how many
        entries own an area, how many module docs cover it, the total entry count,
        and whether the produced doc carries a per-run history section. All are
        counts / shape over produced output — never prose.
      • §3 asserts the produced index holds no entry pointing to a per-run snapshot
        doc and the produced tree retains no per-run snapshot doc — membership over
        produced artefacts, the same file-count category #609 §1 uses ("exactly one
        module doc exists for the area").
      • §4 asserts the produced index re-parses through the registry module with no
        dropped or malformed entries — a round-trip over the PRODUCED artefact, the
        same output-survives-a-known-operation shape the registry round-trip tests
        use; it does not read this repo's registry SOURCE.
      • §5 asserts no two PRODUCED entries own overlapping globs — a computed
        property of the produced index, not a source read.
      • §6 asserts the type-checker's verdict (registry T22).

    No assertion reads a SOURCE file of this repo as text, substring-matches its
    contents, or parses it as JSON/AST. The seeded snapshot-era tree is INPUT/artefact
    test data — not `adws/core/conditionalDocsRegistry.ts`, the migration source, or
    any other repo source. Where the migration entry point lives and how it calls the
    registry are SOURCE-STRUCTURE choices left unasserted; their observable proxies are
    §1–§5 (the migration behaves) and §6 (it compiles).

  Scope notes:

    • The clustering is a NON-DETERMINISTIC agent pass; these scenarios pin its
      DETERMINISTIC structural consequences (the per-area collapse count, the
      one-entry-per-module total, the residue-removal membership, the clean
      re-parse, the no-overlap invariant), driving the migration through the same
      in-process registry seam #609/#610 use — the registry module's
      collapse/serialize with the cluster assignment SEEDED as test input and the
      doc body stubbed, exactly as the PRD's testing decisions prescribe ("assert
      observable outcomes … not prompt wording"). Whether the agent picks GOOD
      module boundaries on real prose is the implementer's non-deterministic
      integration concern and is out of BDD scope — a live clustering verdict cannot
      be asserted deterministically.
    • The registry module's pure parse / serialize / collapse round-trips are the
      VITEST scope (per the PRD's testing decisions, and #609/#610) and are
      intentionally NOT re-enumerated here; §1–§5 pin only the migration's
      observable serialization consequence over a snapshot-era fixture.
    • HITL gate (AC5). The issue carries the `hitl` label, so the migration's PR is
      held for human review before merge. That gate is the EXISTING, already-shipped
      auto-merge-on-`hitl` behaviour (the HITL label lifecycle, exercised by
      feature-587), enforced by the orchestrator — it is not code the migration
      implements, and re-asserting the generic merge gate here would duplicate that
      coverage against an unrelated orchestration seam. AC5 is therefore satisfied by
      the label + the existing gate and is intentionally out of THIS feature's BDD
      scope, which pins the migration's own serialization consequences.
    • Non-ADW target repos get NO migration (PRD "Out of Scope") — they rely solely
      on the convergence shipped in #609/#610. That boundary is a process fact, not a
      runtime behaviour of the migration code, and is not asserted here.
    • The LLM-authored / agent-clustered doc BODY is an opaque precondition (stubbable
      via the claude-cli-stub, as feature-628 §3 and #610 do); the assertions pin the
      migration's COUNTS, residue MEMBERSHIP, re-parse validity, and the no-overlap
      invariant, all invariant to whatever prose a module-doc body carries — except
      §1's no-per-run-history assertion, which pins the absence of the seeded per-run
      history markers (an output-vs-known-input comparison, not a source read).
    • The `@regression` maintenance sweep is SKIPPED for this issue:
      `.adw/scenarios.md` configures a `## Regression Scenario Directory`, so
      promotion is a deliberate human decision and the agent never auto-promotes.

  Vocabulary note:

    Reused registered phrases (`features/regression/vocabulary.md`):
      G18 (`the ADW codebase is checked out`),
      T22 (`the ADW TypeScript type-check passes`).

    Novel phrasing introduced here. The registry has no phrase for the snapshot-era
    migration, and #609's per-issue convergence phrases ("owning files under …") and
    #610's ("for the area under …") are defined in their own per-issue step files, so
    re-matching them from a sibling per-issue file would be an ambiguous-step clash
    (cucumber.js loads every `features/per-issue/step_definitions/**/*.ts` globally).
    #612 therefore owns a parallel, `migrated`-qualified phrase family scoped to its
    own `@adw-612` fixture state. The gap is surfaced to the maintainer in the agent
    Output:
      • `a snapshot-era app_docs tree whose per-run docs all describe the area under {string}`
      • `a snapshot-era app_docs tree whose per-run docs describe {int} distinct module areas`
      • `a snapshot-era app_docs tree carrying {int} per-run docs with one conditional-docs entry per snapshot`
      • `the one-off migration clusters and rewrites the app_docs tree`
      • `the migrated conditional-docs index holds exactly one entry for the area under {string}`
      • `exactly one migrated module doc covers the area under {string}`
      • `the migrated module doc for the area under {string} carries no per-run history section`
      • `the migrated conditional-docs index holds exactly one entry for each of the {int} documented module areas`
      • `the migrated conditional-docs index holds exactly {int} entries in total`
      • `the migrated conditional-docs index contains no entry pointing to a per-run snapshot doc`
      • `no per-run snapshot doc remains in the migrated app_docs tree`
      • `the migrated conditional-docs index parses cleanly through the registry module with no dropped or malformed entries`
      • `no two entries in the migrated conditional-docs index own overlapping file globs`

    Step-definition note for the maintainer: every §1–§5 step needs a temp worktree
    seeded with a snapshot-era fixture — several per-run `app_docs/feature-<adwId>-<slug>.md`
    docs plus a `.adw/conditional_docs.md` carrying ONE entry per snapshot (each entry's
    docPath pointing at its `feature-*` doc). The migration is then driven in-process
    over that fixture via the registry's collapse/serialize seam, with the cluster
    assignment SEEDED as test input (snapshots grouped by their owning "area under
    {string}" prefix) and the produced module-doc body stubbed; the PRODUCED index/docs
    are asserted. The "area under {string}" argument is a path-area prefix; the seeded
    snapshots for that area carry per-run history markers so §1's
    no-per-run-history assertion has something to be absent. The per-run/snapshot
    discriminator is the SEEDED snapshot set, NOT a bare `feature-` prefix: the
    migration's own module docs follow the repo's module-doc convention
    `feature-<migrationAdwId>-<module-slug>.md` (this run's short adwId `9gjajh`; the
    preserved exemplar `feature-o4qdu5-...registry.md`), so a bare `feature-` prefix
    does NOT distinguish a leftover per-run snapshot from a produced module doc. §3
    instead keys off the per-run snapshots SEEDED into the fixture (their
    pre-migration adwIds / their per-run history markers), asserting "no entry points
    to a seeded per-run snapshot doc" and "no seeded per-run snapshot doc remains" as
    membership over produced artefacts. §4 re-parses the produced index through `parseConditionalDocs` and
    asserts the entry set survives a parse → serialize → parse round-trip unchanged;
    §5 computes pairwise glob overlap over the produced entries and asserts zero.

  Background:
    Given the ADW codebase is checked out

  # ── §1 Snapshots for one area collapse to one current-state doc + one entry (AC1) ──
  #
  # The migration unit. Several per-run snapshot docs all describe `adws/triggers/`
  # (the snapshot-era residue: one immutable per-run doc + one index entry each).
  # The migration clusters them into exactly ONE module doc and updates the index to
  # exactly ONE entry for the area — and that produced doc is a current-state
  # reference, NOT a concatenation of the snapshots (it carries none of their
  # seeded per-run history sections). This pins both the collapse count and the
  # current-state/no-staple property the PRD's bug class demands. (AC1; contract §1.)

  @adw-612 @adw-9gjajh-app-docs-living-docs
  Scenario: Per-run snapshots describing one module area migrate to one current-state doc and one index entry
    Given a snapshot-era app_docs tree whose per-run docs all describe the area under "adws/triggers/"
    When the one-off migration clusters and rewrites the app_docs tree
    Then the migrated conditional-docs index holds exactly one entry for the area under "adws/triggers/"
    And exactly one migrated module doc covers the area under "adws/triggers/"
    And the migrated module doc for the area under "adws/triggers/" carries no per-run history section

  # ── §2 One entry per module across the whole tree (AC1, AC2 headline) ──────────
  #
  # The PRD headline: the index becomes bounded by module count instead of feature
  # count. A snapshot-era tree spans three distinct module areas, each carrying
  # several per-run docs and several index entries. After the migration the produced
  # index holds exactly one entry PER AREA — three entries total, not the
  # one-per-run inflation it replaced. This is the "rewrite to one entry per module"
  # outcome the always-paid prime cost depends on. (AC1, AC2; contract §2.)

  @adw-612 @adw-9gjajh-app-docs-living-docs
  Scenario: A snapshot-era tree spanning several modules migrates to exactly one entry per module
    Given a snapshot-era app_docs tree whose per-run docs describe 3 distinct module areas
    When the one-off migration clusters and rewrites the app_docs tree
    Then the migrated conditional-docs index holds exactly one entry for each of the 3 documented module areas
    And the migrated conditional-docs index holds exactly 3 entries in total

  # ── §3 The per-run residue is removed (AC3) ───────────────────────────────────
  #
  # The destructive half of the rewrite. A snapshot-era tree carries twelve per-run
  # docs and one index entry per snapshot. After the migration NO index entry still
  # points at a per-run `feature-*` snapshot doc, and NO per-run snapshot doc remains
  # in the produced `app_docs/` tree — the snapshot residue is dropped from the
  # working tree (its history preserved in git, not in `app_docs/`). The planning
  # side that reads the index never again routes to a superseded per-run snapshot.
  # (AC3; contract §3.)

  @adw-612 @adw-9gjajh-app-docs-living-docs
  Scenario: The migration removes the per-run snapshot docs and their index entries
    Given a snapshot-era app_docs tree carrying 12 per-run docs with one conditional-docs entry per snapshot
    When the one-off migration clusters and rewrites the app_docs tree
    Then the migrated conditional-docs index contains no entry pointing to a per-run snapshot doc
    And no per-run snapshot doc remains in the migrated app_docs tree

  # ── §4 The produced index parses cleanly through the registry module (AC4) ─────
  #
  # The migration re-serializes the index THROUGH the registry module, so the
  # produced index must be a valid registry artefact — it round-trips back through
  # the registry parser with no dropped or malformed entries. This is what lets the
  # convergence path and the guards read the migrated index as structured entries
  # rather than a hand-rolled markdown blob. The assertion re-parses the PRODUCED
  # index; it never reads the registry SOURCE. (AC4; contract §4.)

  @adw-612 @adw-9gjajh-app-docs-living-docs
  Scenario: The migrated index round-trips through the registry module with no dropped or malformed entries
    Given a snapshot-era app_docs tree carrying 12 per-run docs with one conditional-docs entry per snapshot
    When the one-off migration clusters and rewrites the app_docs tree
    Then the migrated conditional-docs index parses cleanly through the registry module with no dropped or malformed entries

  # ── §5 The produced index has no overlapping entries (AC4, regrowth invariant) ─
  #
  # The seed taxonomy must start clean. The migrated index must satisfy the regrowth
  # invariant the guards exist to enforce: no two entries own overlapping file globs.
  # A migration that emitted two entries owning the same area would seed exactly the
  # duplicate-ownership regrowth convergence is meant to prevent — so the migration's
  # own output is held to the no-overlap invariant before it becomes the taxonomy
  # convergence routes against. (AC4; contract §5.)

  @adw-612 @adw-9gjajh-app-docs-living-docs
  Scenario: The migrated index seeds the taxonomy with no overlapping ownership between entries
    Given a snapshot-era app_docs tree carrying 12 per-run docs with one conditional-docs entry per snapshot
    When the one-off migration clusters and rewrites the app_docs tree
    Then no two entries in the migrated conditional-docs index own overlapping file globs

  # ── §6 Type-check backstop ────────────────────────────────────────────────────
  #
  # The clustering-and-serialize helpers are new code on the registry/migration path.
  # Asserting the source "now clusters via the registry" would be a prohibited
  # source-structure assertion, so the migration scenarios above (which exercise that
  # path observably) plus this compile backstop are the wiring's observable proxies.
  # (Contract §6.)

  @adw-612 @adw-9gjajh-app-docs-living-docs
  Scenario: TypeScript type-check passes after the migration clustering-and-serialize helpers land
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
