@adw-610 @adw-8ah63o-app-docs-living-docs
Feature: app_docs living-docs semantic routing + sibling collapse — /document routes by semantic description match, collapses multiple sibling entries for one area into one, regenerates the entry, and creates a new doc only for a genuinely novel change

  Issue #610 is the convergence slice #609 deliberately deferred (parent PRD
  `specs/prd/app-docs-module-living-docs.md`, user stories 5/6/10). #609 shipped
  the registry module and rewrite-in-place, but routed a change to its owning
  module by EXPLICIT FILE GLOBS only, and listed three behaviours as explicitly
  out of scope: semantic routing, sibling-collapse of MULTIPLE pre-existing
  entries, and regenerated descriptions. #610 adds exactly those three and the
  boundary the new matcher must respect, completing the convergence loop.

  Three upgrades over #609, plus one boundary:

    • SEMANTIC ROUTING (AC1). Routing is lifted from glob-only to semantic
      judgement against the module DESCRIPTIONS in the index. Conditions rarely
      enumerate every file a module owns, so glob-only routing mis-fires — a
      touched file the entry does not glob is wrongly treated as novel and a
      second entry is appended. #610 routes a change to the entry whose
      description semantically covers the area even when its file globs miss the
      touched file, so the owning entry is UPDATED, not duplicated.

    • COLLAPSE-AND-PRUNE (AC2). When a change maps to an area that MULTIPLE sibling
      entries already describe (the snapshot-era residue the PRD diagnoses), #610
      folds them into ONE module doc and ONE entry, PRUNING the now-redundant
      siblings. #609 could converge only a SINGLE pre-existing entry; collapsing
      several into one is the new behaviour and the issue's named end-to-end
      outcome — a run over an area with several sibling docs converges them to one.

    • REGENERATED DESCRIPTIONS (AC3). On every rewrite the entry's
      description/conditions are regenerated from the doc's current content, so the
      semantic matcher keeps matching against accurate text instead of drifting
      against a stale description.

    • NOVEL BOUNDARY (AC4). Semantic matching introduces an over-merge failure mode
      glob matching could not have: a novel change wrongly folded into a
      vaguely-related existing module. #610 must still create exactly one new doc +
      entry for a genuinely novel change WITHOUT over-merging it into an unrelated
      module.

  The behavioural contract pinned below:

    1. SEMANTIC ROUTING OVER A GLOB MISS (AC1, core; §1). When an entry's
       description semantically owns the area but its file globs do not enumerate
       the touched file, a /document run UPDATES that one entry in place — it does
       not append a second sibling entry as glob-only routing would. The index
       still holds exactly one entry for the area, and it is the pre-existing one.
    2. SIBLINGS COLLAPSE TO ONE (AC2, AC5 headline; §2). A /document run over an
       area that three sibling entries describe folds them into exactly one module
       doc and one index entry — the convergence the snapshot-era append-forever
       model never performed.
    3. THE PRUNE IS SURGICAL (AC2; §3). Collapsing siblings removes the redundant
       entries for the touched area ONLY; every unrelated module entry survives
       unchanged. Convergence shrinks the index toward one-entry-per-module without
       ever pruning a module it did not route to.
    4. DESCRIPTIONS ARE REGENERATED ON REWRITE (AC3; §4). When the owning doc is
       rewritten, the entry's description/conditions are regenerated from the doc's
       current content — the produced entry no longer carries the stale seeded
       description, so the semantic matcher keeps matching against accurate text.
    5. NOVEL CREATES EXACTLY ONE, NO OVER-MERGE (AC4, AC5 headline; §5). A
       genuinely novel change — one no entry semantically owns — creates exactly
       one new module doc and one new index entry, and is never folded into a
       vaguely-related existing module. Create-when-novel survives the new semantic
       matcher without regrowing duplicates or over-merging.
    6. TYPE-CHECK BACKSTOP (§6). The ADW TypeScript type-check still passes after
       the collapse/prune helpers and the semantic-routing wiring land.

  Observability / rot-prevention note:

    Every assertion below targets an artefact the system PRODUCES at runtime — the
    converged `.adw/conditional_docs.md` index and the `app_docs/` module docs that
    a /document convergence run writes INTO a temp fixture worktree, or the
    type-checker's verdict. These produced files are OUTPUTS of the system under
    test, the same artefact category the Rot-Detection Rubric permits ("git
    artifacts produced by a phase", "state files written by an orchestrator") and
    the same category #609 §1–§5 and registry phrases T15–T17 already assert against
    (counting tokens on a produced `.feature` artefact to defend the very same
    append-rather-than-refresh bug class this PRD fixes for docs).

      • §1, §2, §3, §5 seed a FIXTURE index + docs into a temp worktree (test
        input), run the convergence routing over a touched-file set, and assert the
        PRODUCED index/docs: how many entries own the area, how many module docs
        cover it, which redundant siblings were pruned, whether unrelated entries
        survived, and how many new entries were created. All are counts / membership
        / identity over produced output — never prose.
      • §4 asserts the PRODUCED entry's regenerated description DIFFERS from the
        stale value the test SEEDED and reflects the documented current content —
        a comparison of an OUTPUT artefact against the test's own INPUT, the same
        output-changed-relative-to-known-input shape T15–T17 use. It does not read,
        substring-match, or AST-parse any SOURCE file of this repo.
      • §6 asserts the type-checker's verdict (registry T22).

    No assertion reads a SOURCE file of this repo as text, substring-matches its
    contents, or parses it as JSON/AST. The seeded fixture index and docs are
    INPUT/artefact test data — not `.claude/commands/document.md`,
    `adws/core/conditionalDocsRegistry.ts`, or any other registry source. Whether
    semantic routing lives in the `/document` prompt and the collapse/prune helpers
    in the registry module are SOURCE-STRUCTURE choices left unasserted; their
    observable proxies are §1–§5 (convergence behaves) and §6 (it compiles).

  Scope notes:

    • Semantic routing is a NON-DETERMINISTIC LLM judgement; these content-assertion
      scenarios pin its DETERMINISTIC structural consequences (the collapse count,
      the prune membership, the novel-create count, the regenerated-vs-stale delta),
      driving the routing decision through the same in-process seam #609 uses — the
      registry module plus a stubbed doc body and a seeded route — exactly as the
      PRD's testing decisions prescribe ("assert observable outcomes … not prompt
      wording"). The matcher's judgement QUALITY (does it pick the right entry on
      real prose?) is the implementer's non-deterministic integration concern and is
      out of BDD scope — a live LLM verdict cannot be asserted deterministically.
    • The registry module's pure parse/serialize round-trip and the new
      collapse/prune helpers' table tests are the VITEST scope (per the PRD's
      testing decisions) and are intentionally NOT re-enumerated here; §2–§3 pin
      only their observable convergence consequence.
    • The oversize/overlap GUARD flags (user stories 11/12) and the one-off 191-doc
      ADW migration (user story 8) are SEPARATE PRD slices, not #610, and are out of
      scope — these scenarios assert routing/collapse/regenerate/novel only.
    • The LLM-authored doc BODY is an opaque precondition (stubbable via the
      claude-cli-stub, as feature-628 §3 does); the assertions pin convergence
      COUNTS, prune MEMBERSHIP, and the regenerated-description DELTA, all invariant
      to whatever prose the body carries.
    • The `@regression` maintenance sweep is SKIPPED for this issue:
      `.adw/scenarios.md` configures a `## Regression Scenario Directory`, so
      promotion is a deliberate human decision and the agent never auto-promotes.

  Vocabulary note:

    Reused registered phrases (`features/regression/vocabulary.md`):
      G18 (`the ADW codebase is checked out`),
      T22 (`the ADW TypeScript type-check passes`).

    Novel phrasing introduced here. The registry has no phrase for semantic
    description routing, sibling collapse-and-prune, regenerated descriptions, or
    the novel/no-over-merge boundary; and #609's per-issue convergence phrases are
    defined in `feature-609.steps.ts`, so re-matching them from a sibling per-issue
    file would be an ambiguous-step clash (cucumber.js loads every
    `features/per-issue/step_definitions/**/*.ts` globally). #610 therefore owns a
    parallel phrase family, scoped to its own `@adw-610` fixture state. The gap is
    surfaced to the maintainer in the agent Output:
      • `a conditional-docs index whose only entry for the area under {string} is described semantically but does not list {string} among its owned file globs`
      • `a conditional-docs index with three sibling entries describing the same area under {string}`
      • `a conditional-docs index with three sibling entries describing the area under {string} alongside entries for {int} unrelated modules`
      • `a conditional-docs index whose single entry for the area under {string} carries a stale description that no longer reflects the module's current content`
      • `a conditional-docs index describing {int} unrelated modules, none of which owns the area under {string}`
      • `the /document agent documents a change touching {string}`
      • `the conditional-docs index holds exactly one entry for the area under {string}`
      • `exactly one module doc covers the area under {string}`
      • `that one entry is the pre-existing entry, updated in place rather than appended alongside a new sibling`
      • `the redundant sibling entries that described the area under {string} are pruned from the index`
      • `every unrelated module entry is left unchanged`
      • `the entry for the area under {string} carries a regenerated description reflecting the module's current content rather than the stale seeded text`
      • `the /document agent creates exactly one new module doc and one new index entry for the area under {string}`

    Step-definition note for the maintainer: every §1–§5 step needs a temp worktree
    seeded with a fixture `.adw/conditional_docs.md` (entries carrying descriptions
    and owned globs) plus the corresponding `app_docs/` docs; the convergence routing
    is then driven over a touched-file set (the registry-backed collapse/prune path,
    with the semantic route seeded and the doc body stubbed) and the PRODUCED
    index/docs are asserted. The "area under {string}" argument is a path-area prefix;
    the touched-file argument is a concrete path under it. For §1 the seeded entry's
    globs deliberately exclude the touched file so glob-only routing would miss it
    (semantic routing must still find it). For §4 the seed carries a recognisable
    stale description marker; the assertion is that the produced entry no longer
    carries it.

  Background:
    Given the ADW codebase is checked out

  # ── §1 Semantic routing over a glob miss (AC1, core) ──────────────────────────
  #
  # THE upgrade over #609. The single existing entry's DESCRIPTION semantically
  # owns `adws/state/`, but its file globs do NOT enumerate the touched file —
  # under #609's glob-only routing the change would miss, be treated as novel, and
  # append a second sibling entry. Semantic routing must instead recognise the
  # owning entry by its description and UPDATE it in place, leaving exactly one
  # entry for the area — and it must be the pre-existing entry, not a fresh append.
  # (AC1; contract §1.)

  @adw-610 @adw-8ah63o-app-docs-living-docs
  Scenario: A change whose file the owning entry does not glob is still routed to that entry by semantic description match
    Given a conditional-docs index whose only entry for the area under "adws/state/" is described semantically but does not list "adws/state/snapshotReader.ts" among its owned file globs
    When the /document agent documents a change touching "adws/state/snapshotReader.ts"
    Then the conditional-docs index holds exactly one entry for the area under "adws/state/"
    And that one entry is the pre-existing entry, updated in place rather than appended alongside a new sibling

  # ── §2 Three sibling entries collapse to one (AC2, AC5 headline) ──────────────
  #
  # The issue's named end-to-end outcome and the AC5 headline assertion. Three
  # sibling entries already describe `adws/cost/` — the snapshot-era residue where
  # several overlapping per-run entries accreted for one area. A single /document
  # run over that area folds them into exactly ONE module doc and ONE index entry.
  # #609 could only converge a single pre-existing entry; collapsing three into one
  # is the new behaviour. (AC2, AC5; contract §2.)

  @adw-610 @adw-8ah63o-app-docs-living-docs
  Scenario: A run over an area described by three sibling entries collapses them to one module doc and one index entry
    Given a conditional-docs index with three sibling entries describing the same area under "adws/cost/"
    When the /document agent documents a change touching "adws/cost/phaseCostRecords.ts"
    Then the conditional-docs index holds exactly one entry for the area under "adws/cost/"
    And exactly one module doc covers the area under "adws/cost/"

  # ── §3 The prune is surgical (AC2) ────────────────────────────────────────────
  #
  # Collapse must PRUNE the redundant siblings — not merely update one and leave
  # the others — and the prune must be surgical: it touches the converged area
  # only. Three siblings describe `adws/triggers/` alongside three unrelated module
  # entries. After the run, the redundant `adws/triggers/` siblings are gone, one
  # entry remains for the area, and every unrelated entry survives unchanged — the
  # index shrinks toward one-entry-per-module without over-pruning a sibling it
  # never routed to. (AC2; contract §3.)

  @adw-610 @adw-8ah63o-app-docs-living-docs
  Scenario: Collapsing siblings prunes only the redundant entries for the touched area and leaves unrelated modules untouched
    Given a conditional-docs index with three sibling entries describing the area under "adws/triggers/" alongside entries for 3 unrelated modules
    When the /document agent documents a change touching "adws/triggers/trigger_cron.ts"
    Then the conditional-docs index holds exactly one entry for the area under "adws/triggers/"
    And the redundant sibling entries that described the area under "adws/triggers/" are pruned from the index
    And every unrelated module entry is left unchanged

  # ── §4 Descriptions are regenerated on rewrite (AC3, user story 10) ───────────
  #
  # The owning entry's seeded description is STALE — it no longer reflects the
  # module's current content. When /document rewrites the owning doc, it regenerates
  # the entry's description/conditions from the doc's current content, so the
  # produced entry no longer carries the stale seeded text. This is what keeps the
  # semantic matcher matching against accurate text on the next run instead of
  # drifting. The assertion compares the PRODUCED entry against the test's own
  # SEEDED stale value (output-vs-known-input), never a source file. (AC3; §4.)

  @adw-610 @adw-8ah63o-app-docs-living-docs
  Scenario: Rewriting the owning doc regenerates the entry's description to reflect the module's current content
    Given a conditional-docs index whose single entry for the area under "adws/vcs/" carries a stale description that no longer reflects the module's current content
    When the /document agent documents a change touching "adws/vcs/worktreeReset.ts"
    Then the conditional-docs index holds exactly one entry for the area under "adws/vcs/"
    And the entry for the area under "adws/vcs/" carries a regenerated description reflecting the module's current content rather than the stale seeded text

  # ── §5 Novel creates exactly one, no over-merge (AC4, AC5 headline) ───────────
  #
  # The boundary the new semantic matcher must respect. The index describes three
  # unrelated modules, NONE of which owns `adws/notifications/`. A genuinely novel
  # change there must create exactly ONE new module doc and ONE new index entry —
  # and must NOT be over-merged into any of the vaguely-related existing modules.
  # Create-when-novel must survive semantic matching without regrowing duplicates
  # (the #609 no-append rule) and without folding novelty into an unrelated entry
  # (the new over-merge failure mode). (AC4, AC5; contract §5.)

  @adw-610 @adw-8ah63o-app-docs-living-docs
  Scenario: A genuinely novel change creates exactly one new module doc and entry without over-merging into an unrelated module
    Given a conditional-docs index describing 3 unrelated modules, none of which owns the area under "adws/notifications/"
    When the /document agent documents a change touching "adws/notifications/slackNotifier.ts"
    Then the /document agent creates exactly one new module doc and one new index entry for the area under "adws/notifications/"
    And every unrelated module entry is left unchanged

  # ── §6 Type-check backstop ────────────────────────────────────────────────────
  #
  # The collapse/prune helpers and the semantic-routing wiring are new code on the
  # registry/`/document` path. Asserting the source "now routes semantically" would
  # be a prohibited source-structure assertion, so the convergence scenarios above
  # (which exercise that path observably) plus this compile backstop are the
  # wiring's observable proxies. (Contract §6.)

  @adw-610 @adw-8ah63o-app-docs-living-docs
  Scenario: TypeScript type-check passes after the collapse/prune helpers and semantic-routing wiring land
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
