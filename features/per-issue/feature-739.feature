@adw-739 @adw-ne2we8-ttl-sweep-promotion
Feature: The 14-day per-issue scenario sweep is promotion-aware — a scenario under active promotion consideration (@promotion-suggested-<date>) is exempt from age-based deletion, while declined and untagged scenarios are swept on the normal 14-day TTL

  Issue #739 fixes the root cause of "files with `@promotion-suggested-*` get lost":
  the per-issue retention sweep (`runPerIssueScenarioSweep`,
  `adws/triggers/perIssueScenarioSweep.ts`, invoked every backlog cycle at
  `adws/triggers/trigger_cron.ts`) deletes any `features/per-issue/feature-{N}.feature`
  14 days after its linked PR merged — and it is currently TAG-BLIND. `isScenarioStale`
  is an age-only predicate, so a scenario a maintainer has flagged for promotion with
  `@promotion-suggested-<date>` is deleted out from under them the moment it crosses the
  14-day line, even though a promotion decision is still pending.

  THE FIX (parent PRD `specs/prd/automated-scenario-promotion-sweep.md`, sections
  "Problem Statement" / "Solution" / Implementation Decision "TTL sweep change"): make
  the sweep promotion-aware WITHOUT widening or narrowing the retention WINDOW.
  `isScenarioStale` STAYS a pure age-only predicate; a new pure `isPromotionExempt`
  predicate (fed by a new pure `promotionTagState` module that reads the on-file markers
  `@promotion-suggested-<date>` / `@promotion-declined`) is COMPOSED into the sweep so a
  file is deleted only when it is BOTH stale AND not promotion-exempt. A
  `@promotion-suggested-*` file becomes exempt; a `@promotion-declined` file — and an
  untagged file — is swept on the normal 14-day TTL exactly as today.

  The behavioural contract pinned below (the OBSERVABLE half of the acceptance criteria):

    1. SUGGESTED ⇒ EXEMPT (AC1). A stale per-issue scenario carrying
       `@promotion-suggested-<date>` is RETAINED by the sweep — regardless of how old the
       suggestion date itself is (the tag's presence exempts it; the suggestion date is
       not a second TTL).
    2. DECLINED / UNTAGGED ⇒ SWEPT (AC2 / AC3). A stale scenario tagged
       `@promotion-declined`, and a stale UNTAGGED scenario, are both DELETED on the
       normal 14-day TTL — the declined path is not exempt, and untagged behaviour is
       unchanged from today.
    3. EXEMPTION KEEPS THE PAIR TOGETHER. When a scenario is exempt, its
       `feature-{N}.steps.ts` step-def sibling is retained alongside it — exemption never
       orphans the sibling, and never deletes one of the pair while keeping the other.
    4. EXEMPT-ONLY SWEEP IS A NO-OP. When the only stale candidate is exempt, the sweep
       removes nothing and makes NO commit — no empty commit, no churn.
    5. PER-FILE, NOT ALL-OR-NOTHING. In one sweep over a mixed backlog, an exempt scenario
       is retained while a co-resident non-exempt stale scenario is deleted; the sweep's
       deletion commit records the non-exempt removal and NEVER the exempt file.
    6. AGE GATE STILL FIRES FIRST (AC5 guard). Exemption only ever NARROWS deletions among
       already-stale files; it can never WIDEN them. A file still inside the 14-day window
       is retained even when tagged `@promotion-declined` — `isScenarioStale` remains the
       primary gate and a "declined" tag cannot force early deletion.
    7. TYPE-CHECK BACKSTOP (T22). The ADW TypeScript type-check still passes with the new
       `promotionTagState` / `isPromotionExempt` composition wired in.

  Observability / rot-prevention note:

    Every assertion below targets an artefact the sweep PRODUCES — the presence or absence
    of a seeded per-issue scenario (and its step-def sibling) in the temp worktree after
    the sweep, the name-status of the sweep's deletion commit, whether the sweep advanced
    HEAD at all, or the type-checker's verdict (T22). These are vocabulary registry
    surface #3 ("git artefacts: branches, commits, pushes, and worktree state produced by
    the system under test").

    A #739-specific subtlety, called out so it is not mistaken for a rot violation: the
    seeded feature file CARRIES a promotion marker (`@promotion-suggested-<date>` /
    `@promotion-declined`) in its content, and the sweep READS that marker to decide
    exemption. That read is the SYSTEM UNDER TEST consuming its own input — the seeded
    `features/per-issue/feature-{N}.feature` is INPUT TEST-FIXTURE DATA committed into a
    throwaway temp git repo, a git artefact the sweep consumes (the exact category the
    Rot-Detection Rubric permits, as feature-735 seeds its fixture scenarios and
    feature-648 seeds commits into a real temp repo) — NOT a source file of this framework.
    The SUT reading its input and the SCENARIO asserting the SUT's output (was the file
    kept or deleted) are two different things; only the latter is an assertion, and NO step
    below reads `perIssueScenarioSweep.ts`, `promotionTagState.ts`, or `trigger_cron.ts` as
    text, substring-matches its contents, or parses it as JSON/AST.

  Scope notes:

    • THE PURE-UNIT HALVES OF THE ACCEPTANCE CRITERIA ARE THE IMPLEMENTER'S, NOT BDD. AC4
      (`promotionTagState` correctly parses/serializes both markers and the
      `none → suggested → declined` transitions, idempotently) and the structural half of
      AC5 (`isScenarioStale` stays a pure age-only predicate; exemption lives in a separate
      `isPromotionExempt`) are properties of source functions, not observable system
      outputs — they belong in the implementer's Vitest coverage, exactly as feature-735
      and feature-730 split their unit tests from their end-to-end BDD scenarios. The BDD
      layer here pins ONLY the observable composed behaviour (kept vs deleted); it
      deliberately does NOT call `promotionTagState.parse` / `.serialize` directly or assert
      the state-machine transitions, because doing so would test a source-code property.
    • THE SERIALIZE / WRITE PATH IS OUT OF SCOPE FOR THIS SLICE. The sweep only PARSES the
      on-file marker to decide exemption; it never WRITES a `@promotion-suggested-` or
      `@promotion-declined` tag. Tagging a file (the mover / decline flow) is a different
      slice of the parent PRD and is not exercised here.
    • THE RETENTION WINDOW AND THE PERSIST/PUSH/NO-EMPTY-COMMIT MACHINERY ARE feature-735's
      CONTRACT and are not re-pinned except where #739's tag dimension interacts with them:
      §4 (exempt-only ⇒ no commit), §5 (mixed ⇒ commit records only the non-exempt removal),
      and §6 (a fresh declined file is retained by the age gate). This fix must not widen,
      narrow, or disable the 14-day window — it only exempts suggested files from it.
    • THE @regression MAINTENANCE SWEEP IS SKIPPED for this issue: `.adw/scenarios.md`
      configures a `## Regression Scenario Directory`, so promotion to the regression suite
      is a deliberate human decision and the agent never auto-promotes.

  Vocabulary note:

    Reused registered phrases (`features/regression/vocabulary.md`):
      G18  `the ADW codebase is checked out`
      T22  `the ADW TypeScript type-check passes`

    Novel phrasing introduced here — the registry has no phrase for a promotion-AWARE
    retention sweep, for a per-issue scenario seeded with a promotion marker, or for a
    kept/deleted verdict keyed on that marker. The phrasing is deliberately DISTINCT from
    feature-735's plain-sweep phrases (`the per-issue scenario sweep runs over the
    repository`, `the feature file for issue {int} is absent/retained…`,
    `the step-def sibling for issue {int} is absent/retained…`, `the sweep creates no new
    commit…`) so that feature-739.steps.ts can define its own self-contained step defs
    without an AmbiguousStepDefinition clash under the globally-loaded per-issue step defs
    (the bespoke-per-feature convention; zero phrase collisions across the suite). The gap
    is surfaced to the maintainer in the agent Output:
      • `a per-issue scenario and its step-def sibling for issue {int}, whose linked PR merged {int} days ago, tagged {string}, are committed on the default branch`
      • `the promotion-aware per-issue scenario sweep runs over the repository`
      • `the per-issue scenario for issue {int} is retained in the worktree`
      • `the per-issue scenario for issue {int} is deleted from the worktree`
      • `issue {int}'s step-def sibling is retained in the worktree`
      • `the promotion-aware sweep creates no commit on the default branch`
      • `the sweep's deletion commit records the removal of issue {int}'s scenario`
      • `the sweep's deletion commit does not record any removal for issue {int}`

    Step-definition note for the maintainer (feature-739.steps.ts — keep it SELF-CONTAINED
    with its own `@adw-739` Before/After and module-private `ctx`; do NOT reach into
    feature-735's sweep step defs):
      • Build the harness exactly as feature-735.steps.ts does: a REAL temp git repo
        (`git init` / clone) whose `origin` is a REAL bare remote (`git init --bare`), with
        the default branch checked out. Seed each issue's
        `features/per-issue/feature-{N}.feature` AND its
        `features/per-issue/step_definitions/feature-{N}.steps.ts` sibling, commit them on
        the default branch, and push so the remote carries the pre-sweep tree.
      • The seeding Given writes the promotion marker into the seeded scenario's tag block
        (`@promotion-suggested-<date>` or `@promotion-declined`, verbatim from the {string}
        argument) — the same locus the mover uses (registry G14/G15). When the {string}
        argument is the sentinel `"none"`, seed the scenario with NO promotion tag (the
        untagged / AC3 case). The merge-age `{int} days ago` sets the injected
        `getMergedAt` return to `FIXED_NOW − {int} days` (stale ≥ 14, fresh < 14, measured
        against a FIXED run time).
      • `the promotion-aware per-issue scenario sweep runs over the repository` drives the
        SAME production `runPerIssueScenarioSweep` IN-PROCESS (post-fix, now
        promotion-aware) with the temp repo as its working directory and a FIXED `now`,
        wiring `listFeatures` / `listStepDefSiblings` / `persistRemoval` to the real
        `GitContext` over the temp repo and injecting `getMergedAt` per seeded issue —
        feature-735.steps.ts's exact wiring. Record HEAD before the sweep for the
        no-commit / name-status assertions. Do NOT drive it through an orchestrator
        subprocess or the git-remote-mock (feature-735 scope-note rationale).
      • `retained` / `deleted` read the worktree file's presence after the sweep;
        `issue {int}'s step-def sibling is retained` reads the sibling's presence;
        `the promotion-aware sweep creates no commit` compares `git rev-parse HEAD` before
        and after; the deletion-commit phrases read `git show --name-status HEAD` (assert a
        `D<TAB>features/per-issue/feature-{N}.feature` line is present for the swept issue
        and absent for the exempt issue).
      • HOW the sweep reads the on-file marker (a new injected content-reader dep vs a
        direct `fs` read of the tracked file), and WHETHER `promotionTagState` /
        `isPromotionExempt` are distinct modules, are SOURCE-STRUCTURE choices — left
        unpinned here, exactly as feature-735 left its persist seam unpinned. The harness
        seeds the real file content; the in-process sweep reads it however it is built.

  Background:
    Given the ADW codebase is checked out

  # ── §1 SUGGESTED ⇒ EXEMPT: a stale @promotion-suggested-<date> scenario is retained (AC1) ─
  #
  # The headline fix. A scenario whose linked PR merged 20 days ago (well past the 14-day
  # TTL) but which carries `@promotion-suggested-<date>` must survive the sweep — a
  # promotion decision is still pending and deleting it would lose the maintainer's flagged
  # work. The exemption is keyed on the tag's PRESENCE, not on the suggestion date, so an
  # OLD suggestion date is still exempt (a guard against a mis-implementation that treats
  # the suggestion date as its own expiry — the precise "get lost" root cause). RED before
  # the fix (the tag-blind sweep deletes it); GREEN after (exempt).

  @adw-739 @adw-ne2we8-ttl-sweep-promotion
  Scenario Outline: A stale scenario carrying a promotion-suggested tag is exempt from the sweep regardless of the suggestion date
    Given a per-issue scenario and its step-def sibling for issue 665, whose linked PR merged 20 days ago, tagged "<promotionTag>", are committed on the default branch
    When the promotion-aware per-issue scenario sweep runs over the repository
    Then the per-issue scenario for issue 665 is retained in the worktree

    Examples:
      | promotionTag                    | note                                                        |
      | @promotion-suggested-2026-06-20 | a recent suggestion — under active consideration            |
      | @promotion-suggested-2025-01-05 | an old suggestion — still exempt; the tag is not a 2nd TTL  |

  # ── §2 DECLINED / UNTAGGED ⇒ SWEPT: a stale scenario is deleted on the normal 14-day TTL (AC2 / AC3) ─
  #
  # The other half of the contract. A `@promotion-declined` scenario is NOT exempt — a
  # decline is a terminal "do not promote" verdict, so the file returns to the normal TTL
  # and is swept (AC2). An UNTAGGED stale scenario is swept exactly as today — no behaviour
  # change (AC3). Both rows delete because the file is stale AND not exempt.

  @adw-739 @adw-ne2we8-ttl-sweep-promotion
  Scenario Outline: A stale scenario that is declined or untagged is deleted on the normal 14-day TTL
    Given a per-issue scenario and its step-def sibling for issue 665, whose linked PR merged 20 days ago, tagged "<promotionTag>", are committed on the default branch
    When the promotion-aware per-issue scenario sweep runs over the repository
    Then the per-issue scenario for issue 665 is deleted from the worktree

    Examples:
      | promotionTag        | note                                              |
      | @promotion-declined | declined is terminal — swept on the normal TTL    |
      | none                | untagged — swept exactly as today, no change      |

  # ── §3 Exemption keeps the feature/step-def pair together ──────────────────────────────
  #
  # feature-735 established that the sweep removes a scenario and its `feature-{N}.steps.ts`
  # sibling as a pair. Its mirror image must hold under exemption: when a scenario is
  # exempt, its step-def sibling is retained ALONGSIDE it — exemption must not orphan the
  # sibling (nor keep one of the pair while deleting the other). Guards against composing
  # the exemption at the wrong granularity.

  @adw-739 @adw-ne2we8-ttl-sweep-promotion
  Scenario: An exempt scenario retains its step-def sibling
    Given a per-issue scenario and its step-def sibling for issue 665, whose linked PR merged 20 days ago, tagged "@promotion-suggested-2026-06-20", are committed on the default branch
    When the promotion-aware per-issue scenario sweep runs over the repository
    Then the per-issue scenario for issue 665 is retained in the worktree
    And issue 665's step-def sibling is retained in the worktree

  # ── §4 An exempt-only sweep is a no-op — no empty commit ───────────────────────────────
  #
  # When the only stale candidate is exempt, the sweep removes nothing and must make NO
  # commit — no empty commit, no churn on the default branch every cron cycle. The mirror
  # of feature-735 §4 (a sub-window file produces no commit), but here the retention reason
  # is the promotion tag rather than the age.

  @adw-739 @adw-ne2we8-ttl-sweep-promotion
  Scenario: A sweep whose only stale candidate is promotion-exempt makes no commit
    Given a per-issue scenario and its step-def sibling for issue 665, whose linked PR merged 20 days ago, tagged "@promotion-suggested-2026-06-20", are committed on the default branch
    When the promotion-aware per-issue scenario sweep runs over the repository
    Then the per-issue scenario for issue 665 is retained in the worktree
    And the promotion-aware sweep creates no commit on the default branch

  # ── §5 Per-file exemption in a mixed backlog — exempt kept, non-exempt swept ───────────
  #
  # Exemption is per-file, not all-or-nothing. In one sweep over a mixed backlog — issue
  # 665 stale + `@promotion-suggested`, issue 601 stale + untagged — the exempt scenario is
  # retained and the non-exempt one is deleted, and the sweep's deletion commit records the
  # non-exempt removal while NEVER recording the exempt file. Pins that the exempt file is
  # never swept into the removal batch even when a genuine removal is happening in the same
  # cycle.

  @adw-739 @adw-ne2we8-ttl-sweep-promotion
  Scenario: One sweep retains an exempt scenario while deleting a co-resident non-exempt stale scenario
    Given a per-issue scenario and its step-def sibling for issue 665, whose linked PR merged 20 days ago, tagged "@promotion-suggested-2026-06-20", are committed on the default branch
    And a per-issue scenario and its step-def sibling for issue 601, whose linked PR merged 20 days ago, tagged "none", are committed on the default branch
    When the promotion-aware per-issue scenario sweep runs over the repository
    Then the per-issue scenario for issue 665 is retained in the worktree
    And the per-issue scenario for issue 601 is deleted from the worktree
    And the sweep's deletion commit records the removal of issue 601's scenario
    And the sweep's deletion commit does not record any removal for issue 665

  # ── §6 The age gate still fires first — a fresh declined file is retained (AC5 guard) ───
  #
  # Exemption can only NARROW deletions among already-stale files; it must never WIDEN them.
  # A file still inside the 14-day window (merged 3 days ago) is retained even when tagged
  # `@promotion-declined` — `isScenarioStale` remains the primary gate, so a "declined" tag
  # cannot force early deletion of a fresh file. Guards against an implementation that keys
  # deletion off the tag before (or instead of) the age.

  @adw-739 @adw-ne2we8-ttl-sweep-promotion
  Scenario: A fresh scenario inside the retention window is retained even when tagged declined
    Given a per-issue scenario and its step-def sibling for issue 665, whose linked PR merged 3 days ago, tagged "@promotion-declined", are committed on the default branch
    When the promotion-aware per-issue scenario sweep runs over the repository
    Then the per-issue scenario for issue 665 is retained in the worktree

  # ── §T Type-check backstop (T22) ───────────────────────────────────────────────────────
  #
  # The new `promotionTagState` / `isPromotionExempt` composition keeps the ADW codebase
  # type-clean. A backstop consistent with feature-735 §6 and feature-730 §T.

  @adw-739 @adw-ne2we8-ttl-sweep-promotion
  Scenario: The ADW TypeScript type-check passes with the promotion-aware sweep composition wired in
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
