@adw-609 @adw-o4qdu5-app-docs-living-docs
Feature: app_docs living-docs convergence core — /document rewrites the owning module doc in place and updates the single existing entry, never appending a second one

  Issue #609 is the thinnest complete path that proves per-module living docs
  (parent PRD `specs/prd/app-docs-module-living-docs.md`). Today `/document`
  writes one immutable per-run snapshot doc (`feature-{adwId}-*.md`) and APPENDS
  one entry to `.adw/conditional_docs.md` on every run — so re-running it on the
  same area grows a duplicate doc and a duplicate index entry, and the index
  (read today as a raw string) inflates by one entry per run forever.

  This slice flips that to convergence. A registry module parses
  `conditional_docs.md` into structured entries (doc path, conditions, owned file
  globs) and serializes them back to markdown. `/document` is rewritten so that,
  on an area an existing entry already OWNS — matched by EXPLICIT FILE GLOBS
  (semantic matching is deferred to a later slice) — it rewrites that one module
  doc in place to a current-state reference and updates the SINGLE existing entry,
  rather than appending a second doc + entry for the already-covered area. The
  end-to-end outcome the issue names: running `/document` twice on one area yields
  exactly one converged module doc and exactly one index entry, not a duplicate.

  Because the routing key in this slice is an explicit glob match (not semantic
  judgement) and the parse/serialize is the pure registry module, the convergence
  COUNT outcome is deterministic CODE behaviour — the LLM supplies only the doc
  body prose, which none of the assertions below depend on. That is what lets
  these scenarios pin one-doc-one-entry hermetically.

  The behavioural contract pinned below:

    1. NO APPEND ON AN OWNED AREA (AC3, core). When an index entry already owns
       the touched area by its file globs, a `/document` run UPDATES that one
       entry — the index still holds exactly one entry owning the area and exactly
       one module doc covers it. A second sibling entry is never appended.
    2. TWO RUNS CONVERGE TO ONE DOC + ONE ENTRY (AC4, headline content-assertion).
       Two `/document` runs on the same area — the first creating, the second
       routing to the now-owning entry by glob — leave exactly one module doc and
       exactly one index entry for that area. This is the duplicate the old
       append-forever behaviour produced, now collapsed to one.
    3. REWRITE IN PLACE, CURRENT-STATE FORMAT (AC2). The owning module doc is
       rewritten in place to a current-state reference: exactly one doc covers the
       area and it carries NO per-feature history or changelog section. Superseded
       behaviour is replaced, not stacked as an appended snapshot.
    4. CONVERGENCE TOUCHES ONLY THE OWNING ENTRY (AC1, observable proxy). A
       `/document` run that converges one area leaves every UNRELATED module entry
       in the index preserved unchanged — the registry serializes the untouched
       entries back losslessly, so convergence never mangles or reorders siblings
       it did not route to. (The pure parse/serialize round-trip itself is the
       vitest scope of AC1; this pins its observable convergence consequence.)
    5. A GENUINELY NOVEL AREA STILL CREATES EXACTLY ONE (boundary). When NO entry
       owns the touched area, a `/document` run creates exactly one new module doc
       and one new index entry — the no-append rule suppresses duplicates for
       already-covered areas without suppressing first-time documentation of a
       genuinely novel area.
    6. TYPE-CHECK BACKSTOP (AC5, wiring). The ADW TypeScript type-check still
       passes after the registry module replaces the raw-string read of the index
       in its project-config consumer.

  Observability / rot-prevention note:

    Every assertion below targets an artefact the system PRODUCES at runtime — the
    converged `conditional_docs.md` index and the `app_docs/` module docs that a
    `/document` convergence run writes INTO a temp fixture worktree, or the
    type-checker's verdict. These produced files are OUTPUTS of the system under
    test, the same artefact category the Rot-Detection Rubric permits ("git
    artifacts produced by a phase", "state files written by an orchestrator") and
    the same category registry phrases T15–T17 already assert against — counting
    `@promotion-suggested-*` tokens on a produced `.feature` artefact to defend the
    very same append-rather-than-refresh bug class this issue fixes for docs.

      • §1–§5 seed a FIXTURE index + docs into a temp worktree (test input), run
        the convergence routing over a touched-file set, and assert the PRODUCED
        index/docs: how many entries own the area, how many module docs cover it,
        whether the doc carries a changelog section, whether unrelated entries
        survive. All are counts/shape of produced output, never prose.
      • §6 asserts the type-checker's verdict (registry T22).

    No assertion reads a SOURCE file of this repo as text, substring-matches its
    contents, or parses it as JSON/AST. The seeded fixture index and docs are
    INPUT/artefact test data — not `adws/core/projectConfig.ts`, the `/document`
    prompt, or any registry source file. Which file the registry module lives in,
    and how `/document` is wired to call it, are SOURCE-STRUCTURE choices left
    unasserted; their observable proxies are §1–§5 (convergence behaves) and §6
    (it compiles).

  Scope notes:

    • The registry module's pure parse/serialize round-trip (lossless re-emission,
      malformed-entry handling, ownership-glob extraction) is AC1's VITEST scope
      and is intentionally NOT re-enumerated here; §4 pins only its observable
      convergence consequence (siblings survive a convergence write).
    • Routing in THIS slice is explicit FILE-GLOB matching; semantic matching
      against module descriptions is a later slice and is out of scope. Every
      "owns the area" assertion below is therefore a deterministic glob decision,
      which is what keeps these scenarios hermetic.
    • The LLM-authored doc BODY is treated as an opaque precondition (stubbable via
      the claude-cli-stub, as feature-628 §3 does); the assertions pin only the
      convergence COUNTS and the absence of a changelog section, both invariant to
      whatever prose the body carries.
    • Index entries the convergence run does not route to (sibling-collapse of
      MULTIPLE pre-existing entries that describe the same area, oversize/overlap
      guard flags, and the one-off 191-doc migration) are later slices of the PRD
      and are out of scope for #609.
    • The `@regression` maintenance sweep is SKIPPED for this issue:
      `.adw/scenarios.md` configures a `## Regression Scenario Directory`, so
      promotion is a deliberate human decision and the agent never auto-promotes.

  Vocabulary note:

    Reused registered phrases (`features/regression/vocabulary.md`):
      G18 (`the ADW codebase is checked out`),
      T22 (`the ADW TypeScript type-check passes`).

    Novel phrasing introduced here — the registry is scoped to
    orchestrator/phase/mock-query behaviours and has NO phrase for the
    conditional-docs registry, glob-owned areas, converged module docs, or the
    no-append/rewrite-in-place outcome. The gap is surfaced to the maintainer in
    the agent Output:
      • `a conditional-docs index that already owns the area matched by glob {string} with a single module doc`
      • `a conditional-docs index with no entry owning files under {string}`
      • `a conditional-docs index that owns the area matched by glob {string} alongside entries for {int} unrelated modules`
      • `a /document run documents a change touching {string}`
      • `a second /document run documents another change touching {string}`
      • `the conditional-docs index contains exactly one entry owning files under {string}`
      • `exactly one module doc exists for the area owning files under {string}`
      • `the module doc for the area owning files under {string} contains no per-feature history or changelog section`
      • `the entries for the unrelated modules are preserved unchanged`
      • `a new module doc and a single new index entry are created for the area owning files under {string}`

    Step-definition note for the maintainer: §1–§5 need a temp worktree seeded
    with a fixture `.adw/conditional_docs.md` whose entries carry explicit owned
    globs, plus the corresponding `app_docs/` docs; the convergence routing is then
    driven over a touched-file set (the registry-backed rewrite-in-place path,
    with the doc body stubbed) and the PRODUCED index/docs are asserted. The
    "owns files under {string}" argument is a path-area prefix; the touched-file
    argument is a concrete path under it that the entry's glob matches.

  Background:
    Given the ADW codebase is checked out

  # ── §1 No append on an already-owned area (AC3, core) ─────────────────────────
  #
  # An entry already owns `adws/vcs/` by its file globs. A `/document` run on a
  # file in that area must UPDATE that one entry and its one doc, not append a
  # second entry/doc for the already-covered area. This isolates the no-append
  # decision on a pre-owned index — the exact behaviour the append-forever model
  # got wrong. (Contract §1.)

  @adw-609 @adw-o4qdu5-app-docs-living-docs
  Scenario: A /document run on an already-owned area updates the single owning entry instead of appending a second one
    Given a conditional-docs index that already owns the area matched by glob "adws/vcs/**" with a single module doc
    When a /document run documents a change touching "adws/vcs/worktreeReset.ts"
    Then the conditional-docs index contains exactly one entry owning files under "adws/vcs/"
    And exactly one module doc exists for the area owning files under "adws/vcs/"

  # ── §2 Two runs converge to one doc + one entry (AC4, headline) ───────────────
  #
  # The issue's named end-to-end outcome. Starting from an index that owns nothing
  # in `adws/triggers/`, two `/document` runs on that area — the first creating
  # the doc+entry, the second routing to the now-owning entry by glob — converge
  # to exactly one module doc and exactly one index entry, not the duplicate pair
  # the old per-run-snapshot + append behaviour produced. (Contract §2.)

  @adw-609 @adw-o4qdu5-app-docs-living-docs
  Scenario: Two /document runs on the same area produce exactly one module doc and one index entry
    Given a conditional-docs index with no entry owning files under "adws/triggers/"
    When a /document run documents a change touching "adws/triggers/trigger_cron.ts"
    And a second /document run documents another change touching "adws/triggers/pauseQueueScanner.ts"
    Then the conditional-docs index contains exactly one entry owning files under "adws/triggers/"
    And exactly one module doc exists for the area owning files under "adws/triggers/"

  # ── §3 Rewrite in place, current-state format (AC2) ───────────────────────────
  #
  # The owning module doc is rewritten in place to a current-state reference:
  # exactly one doc covers the area and it carries NO per-feature history or
  # changelog section. Superseded behaviour is replaced rather than stacked as an
  # appended per-run snapshot — the doc stays a living current-truth reference.
  # (Contract §3.)

  @adw-609 @adw-o4qdu5-app-docs-living-docs
  Scenario: The owning module doc is rewritten in place to current-state form with no changelog tail
    Given a conditional-docs index that already owns the area matched by glob "adws/vcs/**" with a single module doc
    When a /document run documents a change touching "adws/vcs/worktreeReset.ts"
    Then exactly one module doc exists for the area owning files under "adws/vcs/"
    And the module doc for the area owning files under "adws/vcs/" contains no per-feature history or changelog section

  # ── §4 Convergence touches only the owning entry (AC1, observable proxy) ──────
  #
  # Converging one area must not disturb the rest of the registry. A run that
  # routes to the `adws/cost/` entry leaves every unrelated module entry preserved
  # unchanged — the registry serializes the untouched entries back losslessly, so
  # convergence never mangles or reorders siblings it did not route to. (The pure
  # round-trip is AC1's vitest scope; this pins its observable consequence.)
  # (Contract §4.)

  @adw-609 @adw-o4qdu5-app-docs-living-docs
  Scenario: Converging one area leaves the unrelated module entries in the index unchanged
    Given a conditional-docs index that owns the area matched by glob "adws/cost/**" alongside entries for 3 unrelated modules
    When a /document run documents a change touching "adws/cost/phaseCostRecords.ts"
    Then the conditional-docs index contains exactly one entry owning files under "adws/cost/"
    And the entries for the unrelated modules are preserved unchanged

  # ── §5 A genuinely novel area still creates exactly one (boundary) ────────────
  #
  # The no-append rule must not become "never create". When NO entry owns the
  # touched area, a `/document` run creates exactly one new module doc and one new
  # index entry — first-time documentation of a genuinely novel area is preserved,
  # while already-covered areas are deduplicated. This is the boundary that proves
  # convergence suppresses duplicates, not all new docs. (Contract §5.)

  @adw-609 @adw-o4qdu5-app-docs-living-docs
  Scenario: A /document run on an area no entry owns creates exactly one new module doc and one new index entry
    Given a conditional-docs index with no entry owning files under "adws/notifications/"
    When a /document run documents a change touching "adws/notifications/slackNotifier.ts"
    Then a new module doc and a single new index entry are created for the area owning files under "adws/notifications/"
    And the conditional-docs index contains exactly one entry owning files under "adws/notifications/"

  # ── §6 Type-check backstop (AC5, wiring) ──────────────────────────────────────
  #
  # The registry module replaces the raw-string read of the index in its
  # project-config consumer. The observable proxy that the consumer swap did not
  # break the build is the type-checker's verdict — asserting the source no longer
  # does a raw read would be a prohibited source-structure assertion, so the
  # convergence scenarios above (which exercise the registry as the index's
  # read/write path) plus this compile backstop are AC5's observable proxies.
  # (Contract §6.)

  @adw-609 @adw-o4qdu5-app-docs-living-docs
  Scenario: TypeScript type-check passes after the registry module replaces the raw-string index read
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
