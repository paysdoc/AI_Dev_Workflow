@adw-611 @adw-ih6ju7-app-docs-living-docs
Feature: app_docs living-docs post-write self-check guards — /document flags an oversized module doc (bloat) and an overlapping index entry (regrowth) after it writes

  Issue #611 is the second slice of the per-module living-docs PRD
  (`specs/prd/app-docs-module-living-docs.md`), building on the registry module
  and rewrite-in-place convergence that #609 landed (the blocked-by). #609 made
  `/document` rewrite the owning module doc in place and keep one index entry per
  area; it deliberately left two safety nets out of scope. This slice adds them.

  Convergence is non-deterministic (semantic matching) and, for non-ADW repos, is
  the SOLE mechanism keeping `app_docs/` lean — there is no migration backstop
  there. So the PRD pairs convergence with a deterministic post-write self-check
  that catches the two ways it can go wrong:

    • BLOAT — a module doc the rewrite produced is too large. An oversized doc is a
      refactor signal for the underlying MODULE (there is no doc-split path); the
      flag is surfaced by `/document` and handed to a refactor actor. Measurement
      lives HERE because `/refactor` is blind to `app_docs/` — it sees only changed
      code files, never the docs.
    • REGROWTH — the rewrite produced a SECOND index entry whose ownership overlaps
      an existing one (convergence misfired and duplicated a module instead of
      routing to the entry that already owned the area). Caught early, this is the
      only line of defence for repos with no one-off migration to fall back on.

  The guards are a deep, PURE module over the registry module's parsed entries:
  given the parsed entries and the produced docs' sizes, they compute a bloat flag
  (a doc over the size threshold) and regrowth flags (entry pairs whose owned globs
  overlap). Deterministic, lifted out of the LLM. The document phase runs them as a
  POST-WRITE self-check after `/document` writes, logs both flags, and routes the
  bloat flag onward.

  Because the guards are pure functions over parsed entries + produced doc sizes,
  the flag outcomes are deterministic CODE behaviour — the LLM supplies only the
  doc body prose, which none of the assertions below depend on. That is what lets
  these scenarios pin emit / no-emit / route / log hermetically, the same way #609
  pinned the convergence counts.

  The behavioural contract pinned below:

    1. OVERSIZE DOC EMITS A BLOAT FLAG (AC4, headline). When the self-check runs
       over a produced module doc whose size exceeds the bloat threshold, it emits
       a bloat flag naming that doc's area. This is the issue's named end-to-end
       outcome: "a run that writes an oversized doc emits a bloat flag".
    2. A WITHIN-BUDGET DOC EMITS NO BLOAT FLAG (AC1 boundary, observable proxy).
       When the produced doc is within the threshold, the self-check emits NO bloat
       flag — the guard flags real oversize, it is not always-on. (The exact
       at-threshold off-by-one boundary is AC1's VITEST scope and is not
       re-enumerated here; this pins only the observable over-vs-within outcome.)
    3. OVERLAPPING ENTRY EMITS A REGROWTH FLAG (AC4, headline). When the produced
       index holds two entries whose owned globs both match files under one area —
       a convergence misfire that duplicated a module — the self-check emits a
       regrowth flag naming the overlapping pair. The issue's second named outcome:
       "a run that produces an overlapping entry emits a regrowth flag".
    4. DISJOINT ENTRIES EMIT NO REGROWTH FLAG (AC1 boundary, no false positives).
       When the produced index's entries own disjoint areas with no common file,
       the self-check emits NO regrowth flag — overlap detection does not fire on
       the normal one-entry-per-module steady state. This is the no-false-positive
       guarantee AC1 names explicitly.
    5. THE BLOAT FLAG IS ROUTED ONWARD (AC3). An emitted bloat flag is not merely
       computed: the self-check routes it to a refactor follow-up (a `/refactor`
       hand-off or a filed refactor issue) that names the oversized doc's area, so
       the oversize signal reaches the actor that can act on it.
    6. THE PHASE LOGS BOTH FLAGS (AC2, wiring). The document phase's post-write
       self-check actually runs the guards and LOGS what it emits — over a fixture
       carrying both an oversized doc and an overlapping pair, both a bloat and a
       regrowth flag appear in the self-check's logged output. This pins that the
       guards are wired into the phase, not a library nobody calls.

  Observability / rot-prevention note:

    Every assertion below targets an artefact the system PRODUCES at runtime — the
    self-check's emitted flag set, its logged output, the refactor follow-up it
    routes, all computed over a `.adw/conditional_docs.md` index and `app_docs/`
    module docs seeded INTO a temp fixture worktree as the post-`/document`-write
    state. These produced/seeded files are the OUTPUTS of `/document` (the docs it
    writes and the index it converges), the same artefact category #609's scenarios
    asserted against and the same category the Rot-Detection Rubric permits ("state
    files written by an orchestrator", "git artifacts produced by a phase").

      • A module doc's SIZE is the guard's INPUT, not an assertion target. No Then
        step asserts "the doc has N lines / N bytes" — that would be the prohibited
        file-shape assertion. The over-/within-threshold size is a fixture-
        construction detail of the produced doc; every assertion is on the guard's
        OUTPUT (the emitted / logged / routed flag), never on the doc's measured
        size directly.
      • The seeded index + docs are INPUT/artefact test data representing what a
        `/document` write produced — they are NOT `adws/core/conditionalDocsRegistry.ts`,
        the (not-yet-written) guards module source, the `/document` prompt, or any
        repo source file. No assertion reads a SOURCE file as text, substring-
        matches its contents, or parses it as JSON/AST.
      • Which file the guards module lives in, its function names, and how the
        document phase is wired to call it are SOURCE-STRUCTURE choices left
        unasserted; their observable proxies are §1–§6 (the guards emit, suppress,
        route, and log the right flags over produced artefacts).

  Scope notes:

    • The guards module's pure table-tested behaviour — exact at-threshold boundary
      (over vs at vs under by one unit), and the full overlap-shape matrix (identical
      glob, subset glob, sibling-disjoint glob, legacy entry with no owned glob) — is
      AC1's VITEST scope (prior art: `adws/core/__tests__/conditionalDocsRegistry.test.ts`,
      `testVerdict.test.ts`) and is intentionally NOT re-enumerated here. §1–§4 pin
      only the observable emit / no-emit consequences at the coarse over-vs-within
      and overlap-vs-disjoint level.
    • The routing TARGET is left open by the issue ("`/refactor` OR a filed refactor
      issue"). §5 asserts the behavioural outcome — a refactor follow-up that names
      the oversized doc's area is produced — and is agnostic to which mechanism the
      build agent wires; the step-def note records both acceptable observables.
    • The LLM-authored doc BODY is an opaque precondition (stubbable via the
      claude-cli-stub, as #609 and feature-628 do); the assertions pin only the
      flag outcomes, invariant to whatever prose the body carries. The oversized
      fixture doc is padded to a deterministic over-threshold size, not generated.
    • Out of scope for #611 and NOT asserted: splitting an oversized doc (there is
      no doc-split path — bloat routes to refactor, full stop), semantic routing
      against module descriptions, the sibling-collapse of pre-existing duplicate
      entries, and the one-off 191-doc ADW migration. These are other slices of the
      PRD.
    • The `@regression` maintenance sweep is SKIPPED for this issue: `.adw/scenarios.md`
      configures a `## Regression Scenario Directory`, so promotion is a deliberate
      human decision and the agent never auto-promotes.

  Vocabulary note:

    Reused registered phrase (`features/regression/vocabulary.md`):
      G18 (`the ADW codebase is checked out`).

    Novel phrasing introduced here — the registry is scoped to orchestrator / phase
    / mock-query behaviours and has NO phrase for the post-write self-check, the
    bloat / regrowth flags, the size threshold, overlapping owned globs, or the
    refactor-routing outcome. The gap is surfaced to the maintainer in the agent
    Output:
      • `a written module doc for the area owning files under {string} whose size exceeds the bloat threshold`
      • `a written module doc for the area owning files under {string} whose size is within the bloat threshold`
      • `a conditional-docs index with two entries whose owned globs both match files under {string}`
      • `a conditional-docs index whose two entries own disjoint areas with no common file`
      • `a second entry whose owned globs also match files under {string}`
      • `the post-write self-check runs`
      • `the self-check emits a bloat flag for the area owning files under {string}`
      • `the self-check emits no bloat flag for the area owning files under {string}`
      • `the self-check emits a regrowth flag naming the two overlapping entries for files under {string}`
      • `the self-check emits no regrowth flag`
      • `the bloat flag is routed to a refactor follow-up for the area owning files under {string}`
      • `the self-check logs a bloat flag for the area owning files under {string}`
      • `the self-check logs a regrowth flag for the two overlapping entries for files under {string}`

    Step-definition note for the maintainer: drive the self-check IN-PROCESS, the
    way feature-609 drives convergence. Each scenario seeds a temp fixture worktree
    with a `.adw/conditional_docs.md` (built via the registry module's
    `serializeConditionalDocs`, entries carrying explicit owned globs) plus the
    `app_docs/` module docs the entries point at — the post-`/document`-write state.
    The "area owning files under {string}" argument is a path-area prefix; the
    step resolves it to the entry whose owned glob matches it and to that entry's
    `docPath`. For the bloat Givens, write the named entry's doc file padded to a
    size COMFORTABLY over the guards module's exported threshold (over case) or to a
    few lines (within case) — construct the boundary from the exported threshold so
    the fixture tracks any retune; never hard-code a magic line count in the
    `.feature`. Run the document phase's post-write self-check entry point over the
    fixture and assert its emitted flag set (§1–§4), the refactor follow-up it
    routes (§5 — observe EITHER a recorded refactor-issue filing on the mock GitHub
    API whose body names the area, OR an in-process refactor hand-off record naming
    the area; whichever the build agent wired satisfies AC3), and its logged output
    (§6). The doc body is stubbed; no assertion depends on its prose.

  Background:
    Given the ADW codebase is checked out

  # ── §1 Oversize doc emits a bloat flag (AC4, headline) ────────────────────────
  #
  # The issue's first named end-to-end outcome. A `/document` write produced a
  # module doc for `adws/vcs/` whose size exceeds the bloat threshold; the
  # post-write self-check must emit a bloat flag naming that area, because an
  # oversized module doc signals the module itself needs refactoring. (Contract §1.)

  @adw-611 @adw-ih6ju7-app-docs-living-docs
  Scenario: A /document write that produces an oversized module doc emits a bloat flag
    Given a written module doc for the area owning files under "adws/vcs/" whose size exceeds the bloat threshold
    When the post-write self-check runs
    Then the self-check emits a bloat flag for the area owning files under "adws/vcs/"

  # ── §2 A within-budget doc emits no bloat flag (AC1 boundary) ─────────────────
  #
  # The bloat guard must flag real oversize, not every run. A produced doc whose
  # size is within the threshold draws NO bloat flag — proving the flag is keyed on
  # size, not always-on. The exact at-threshold off-by-one is AC1's vitest scope;
  # this pins the coarse over-vs-within observable. (Contract §2.)

  @adw-611 @adw-ih6ju7-app-docs-living-docs
  Scenario: A /document write that produces a within-budget module doc emits no bloat flag
    Given a written module doc for the area owning files under "adws/vcs/" whose size is within the bloat threshold
    When the post-write self-check runs
    Then the self-check emits no bloat flag for the area owning files under "adws/vcs/"

  # ── §3 Overlapping entry emits a regrowth flag (AC4, headline) ────────────────
  #
  # The issue's second named end-to-end outcome. Convergence misfired and produced
  # a SECOND index entry whose owned globs also match files under `adws/triggers/`,
  # duplicating a module that an entry already owned. The self-check must emit a
  # regrowth flag naming the overlapping pair, so the misfire is caught early on a
  # repo with no migration backstop. (Contract §3.)

  @adw-611 @adw-ih6ju7-app-docs-living-docs
  Scenario: A /document run that produces an overlapping index entry emits a regrowth flag
    Given a conditional-docs index with two entries whose owned globs both match files under "adws/triggers/"
    When the post-write self-check runs
    Then the self-check emits a regrowth flag naming the two overlapping entries for files under "adws/triggers/"

  # ── §4 Disjoint entries emit no regrowth flag (AC1, no false positives) ───────
  #
  # The no-false-positive guarantee AC1 names explicitly. In the normal
  # one-entry-per-module steady state, entries own disjoint areas with no common
  # file; the self-check must emit NO regrowth flag. Regrowth detection fires only
  # on a genuine ownership overlap, never on healthy disjoint convergence.
  # (Contract §4.)

  @adw-611 @adw-ih6ju7-app-docs-living-docs
  Scenario: A /document run whose index entries own disjoint areas emits no regrowth flag
    Given a conditional-docs index whose two entries own disjoint areas with no common file
    When the post-write self-check runs
    Then the self-check emits no regrowth flag

  # ── §5 The bloat flag is routed onward (AC3) ──────────────────────────────────
  #
  # An emitted bloat flag must reach the actor that can act on it. Measurement
  # lives in `/document` (it can see `app_docs/`); the fix lives downstream. The
  # self-check routes the flag to a refactor follow-up — a `/refactor` hand-off or
  # a filed refactor issue — that names the oversized doc's area. The assertion is
  # agnostic to which mechanism the build agent wires. (Contract §5.)

  @adw-611 @adw-ih6ju7-app-docs-living-docs
  Scenario: An emitted bloat flag is routed to a refactor follow-up naming the oversized module
    Given a written module doc for the area owning files under "adws/vcs/" whose size exceeds the bloat threshold
    When the post-write self-check runs
    Then the bloat flag is routed to a refactor follow-up for the area owning files under "adws/vcs/"

  # ── §6 The phase logs both flags (AC2, wiring) ────────────────────────────────
  #
  # The document phase must RUN the guards as a post-write self-check and log what
  # they emit — pinning that the guards are wired into the phase, not an uncalled
  # library. Over a fixture carrying both an oversized doc and an overlapping pair
  # on `adws/triggers/`, both a bloat flag and a regrowth flag appear in the
  # self-check's logged output. (Contract §6.)

  @adw-611 @adw-ih6ju7-app-docs-living-docs
  Scenario: The post-write self-check logs both the bloat and the regrowth flag it emits
    Given a written module doc for the area owning files under "adws/triggers/" whose size exceeds the bloat threshold
    And a second entry whose owned globs also match files under "adws/triggers/"
    When the post-write self-check runs
    Then the self-check logs a bloat flag for the area owning files under "adws/triggers/"
    And the self-check logs a regrowth flag for the two overlapping entries for files under "adws/triggers/"
