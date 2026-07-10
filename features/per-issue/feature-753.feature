@adw-753 @adw-pa6xsc-dependency-unblock-m
Feature: Dependency unblock selects dependents with the SAME extractor detection uses — a prose "- blocked by #N" dependent unblocks when its blocker closes, so deferred issues never strand

  Issue #753 fixes a parser split between the two halves of dependency handling.
  Detection (the defer-at-creation path) and unblock (the re-evaluate-on-close
  path) answer the SAME question — "who depends on #X" — with DIFFERENT parsers,
  so an issue that was correctly DEFERRED at creation is never UNBLOCKED when its
  blocker merges. It strands, deferred forever.

  Root cause (verified in the issue):

    • Defer / detection: `findOpenDependencies` → `extractDependencies` →
      `parseKeywordProximityDependencies` — an 80-char keyword-proximity lookback
      (`issueDependencies.ts` lines 105-111). It MATCHES a bare prose bullet such
      as `- blocked by #28`, so an issue declaring its blocker in prose is
      correctly deferred at creation.
    • Unblock: `handleIssueClosedDependencyUnblock` →
      `parseDependencies` (`webhookGatekeeper.ts:182`) — HEADING-ONLY
      (`## Dependencies|Depends on|Blocked by`, `issueDependencies.ts` lines 50-52).
      It does NOT match a bare bullet, so on the blocker's closure it selects NO
      dependent, logs "No issues depend on closed issue #N", and the prose
      dependent never unblocks.

    Observed in the wild: vestmatic-research #29 (`- blocked by #28`) deferred
    correctly at 2026-07-09 13:32, then on #28's merge at 14:49 the unblock logged
    "No issues depend on closed issue #28" and #29 stranded.

  What this slice builds:

    • `handleIssueClosedDependencyUnblock` selects dependents through
      `extractDependencies` — the SAME extractor detection uses — instead of the
      narrow heading-only `parseDependencies` at :182, run over all open issues.
    • A DI seam on the function (an injectable open-issue lister, dependency
      extractor, eligibility check, and spawn), mirroring `issueOpenedRouter.ts`'s
      `IssueOpenedRouterDeps` + `buildDefault...Deps()` pure-decision + DI pattern,
      so the flow is drivable in-process with NO real `gh` / `listOpenIssues`.

  Contract pinned here (the OBSERVABLE behaviour, not the seam's field/signature shape):

    • prose is now selected   → an open issue whose body declares a prose
                                 dependency `- blocked by #N` (no heading) is
                                 SELECTED as a dependent when #N closes, its
                                 eligibility is re-evaluated, and — if eligible —
                                 it is spawned (AC1; the headline RED→green, the
                                 exact #29 defect).
    • heading still unblocks   → a dependent declaring its blocker under a
                                 `## Blocked by` heading continues to unblock (AC2;
                                 no regression — the extractor is the heading ∪
                                 prose superset, so heading deps are never dropped).
    • eligibility still gates  → a dependent SELECTED on closure but re-evaluated
                                 as still blocked is NOT spawned; selection is not a
                                 blind spawn (AC1 — "re-evaluated / spawned").
    • selectivity              → an open issue that does not depend on the closed
                                 issue is neither re-evaluated nor spawned.

  Observability / rot-prevention note:

    Every assertion below targets a runtime OUTPUT of the system under test, never a
    source file. No step reads `webhookGatekeeper.ts`, `issueDependencies.ts`,
    `issueOpenedRouter.ts`, or any module as text, substring-matches its contents, or
    parses it as JSON/AST.

      • The scenarios phase-import `handleIssueClosedDependencyUnblock` and drive it
        with injected collaborators — an open-issue lister returning an IN-MEMORY
        seeded issue set (so no real `gh` / `listOpenIssues`), the REAL production
        dependency extractor (the same one detection uses, so the prose-matching is
        genuinely exercised and never faked), an injected eligibility check that
        returns a seeded verdict AND records which issue numbers it was asked about,
        and an injected spawn collaborator that RECORDS the issue numbers it was
        asked to spawn.
      • "spawns a workflow for issue N" / "spawns no workflow for issue N" assert the
        recorded SPAWN spy — a recorded call on an injected collaborator, exactly the
        observable category feature-722 §1 asserts through its injected adwId
        generator ("invoked once" / "not invoked") and the registered `git-mock` /
        `mock server` recorders assert. It is a runtime artefact, not a source read.
      • "re-evaluates eligibility for issue N" / "does not re-evaluate eligibility for
        issue N" assert the recorded ELIGIBILITY spy's call set — the observable that
        distinguishes "selected as a dependent" (eligibility was consulted) from "not
        selected at all" (it was not). This is the sharpest RED pin: before the fix
        the heading-only parser never selects a prose dependent, so eligibility is
        never re-evaluated for it and the assertion fails; after the fix the shared
        extractor selects it, so it is.
      • The issue numbers, prose lines, and headings in the steps are INPUT test data
        (the seeded issue bodies fed to the injected lister + extractor — the same
        "seeded body is test input" category feature-722 uses for its seeded comment
        bodies); the recorded spawn set, the recorded eligibility-consultation set,
        and the type-check exit code are the system's OUTPUTS. No file existence,
        `readFileSync`, or source-structure assertion appears.

  Scope notes:

    • THE PINNED BEHAVIOUR IS THE OBSERVABLE OUTCOME — which dependents are
      re-evaluated and which are spawned when a blocker closes — NOT the DI seam's
      internal shape: the name of the deps interface, whether the extractor is
      injected or defaulted, the order of the collaborators, or how the closed issue
      number is threaded are the implementer's choice (the #722 / #664 "pin the
      decision, not the taxonomy" stance). An implementer may structure the seam
      freely as long as these outcomes hold.
    • `closeAbandonedDependents` (`webhookGatekeeper.ts:249`) IS INTENTIONALLY LEFT
      UNCHANGED and is NOT driven here. Its narrow heading-only `parseDependencies`
      is the deliberately safe direction (failing to CLOSE a dependent strands
      nothing dangerous — a human can still act), so it is explicitly out of scope
      per the issue and no scenario pins it.
    • THE CRON BACKSTOP FOR UNBLOCK IS OUT OF SCOPE. Unblock remains webhook-only;
      this slice does not add a cron re-scan and none is pinned.
    • THE `adw:none` OPT-OUT IS OUT OF SCOPE. It already works on the webhook-opened
      and cron-fresh paths (feature-545); no code and no scenario are needed here.
    • THE WEBHOOK DELEGATION IS THIN WIRING, NOT DRIVEN AS A SUBPROCESS. That the
      `issues.closed` webhook path calls `handleIssueClosedDependencyUnblock` is thin
      wiring over the DI function §1-§4 pin; the subprocess webhook harness (registry
      W11) cannot observe the real detached `spawn` or the real `gh` issue list (the
      "BDD harness observability limits" constraint), so the decision is pinned
      in-process here and the wiring rides §5's type-check.
    • THE RETROACTIVE RESCUE OF #29 IS OUT OF SCOPE (its blocker already closed;
      recover manually) and is not a code path this slice adds.
    • THE @regression MAINTENANCE SWEEP IS SKIPPED for this issue: `.adw/scenarios.md`
      configures a `## Regression Scenario Directory`, so promotion to the regression
      suite is a deliberate human decision and the agent never auto-promotes.

  Vocabulary note:

    Registered phrases reused (`features/regression/vocabulary.md`):
      G18 `the ADW codebase is checked out`              (background + type-check)
      T22 `the ADW TypeScript type-check passes`          (backstop)

    Novel phrasing introduced here — the registry is orchestrator / subprocess /
    mock-server oriented and has no phrase for an IN-PROCESS dependency-unblock
    decision driven through injected collaborators. Surfaced to the maintainer in the
    agent Output:
      Seeded open issues (injected lister input):
        • `an open issue {int} with a prose dependency line {string} and no dependency heading`
        • `an open issue {int} that lists blocker {int} under a Blocked by heading`
        • `an open issue {int} with no dependency on blocker {int}`
      Injected eligibility verdict:
        • `the injected eligibility check reports issue {int} as eligible`
        • `the injected eligibility check reports issue {int} as still blocked`
      Invocation:
        • `the issue-closed dependency unblock runs for closed issue {int}`
      Assertions on the injected spies:
        • `the dependency unblock re-evaluates eligibility for issue {int}`
        • `the dependency unblock does not re-evaluate eligibility for issue {int}`
        • `the dependency unblock spawns a workflow for issue {int}`
        • `the dependency unblock spawns no workflow for issue {int}`

    Step-definition note for the maintainer:
      • All steps phase-import production code; nothing spawns a subprocess, hits the
        network, or reads a source file. Import `handleIssueClosedDependencyUnblock`
        (its post-fix DI form) from `adws/triggers/issueClosedUnblockRouter.ts` — the
        sibling module the plan extracts the unblock flow into (mirroring
        `issueOpenedRouter.ts`); it is also re-exported from
        `adws/triggers/trigger_webhook.ts`. Per the scope note above the seam's module
        placement is the implementer's choice — import it from wherever the DI seam lands.
      • The seeded-issue Givens push `{ number, body }` records onto a World-scoped
        array. The `... prose dependency line {string} ...` Given seeds the body to the
        given line verbatim (e.g. `"- blocked by #2801"`, NO heading). The `... lists
        blocker {int} under a Blocked by heading` Given seeds a body of
        `"## Blocked by\n- #<blocker>"`. The `... with no dependency on blocker {int}`
        Given seeds a body carrying NO `#`-reference at all — deliberately, so the
        proximity parser returns empty AND `extractDependencies` never trips its
        `needsLlm` fallback (an unmatched bare `#N` would), keeping the run hermetic
        with no LLM/network.
      • The injected open-issue lister returns that seeded array (replacing the real
        `ctx.listOpenIssues` — NO real `gh`). WIRE THE REAL PRODUCTION EXTRACTOR as
        the dependency extractor — `extractDependencies` from `issueDependencies.ts`,
        or its synchronous proximity core `parseKeywordProximityDependencies` for
        guaranteed no-LLM hermeticity (it is the same superset detection resolves to).
        Do NOT inject a fake extractor that pre-decides membership: that would make the
        prose-selection assertion tautological and blind to a regression back to the
        heading-only `parseDependencies`. Because the seeded bodies are single-ref
        prose / single-ref heading / zero-ref, the real extractor resolves each
        synchronously and no LLM fires.
      • The `... eligibility check reports issue {int} as eligible|still blocked`
        Givens prime an injected `checkEligibility(number, body, repoInfo)` that
        returns the seeded verdict (`{ eligible: true }` / `{ eligible: false, reason:
        'open_dependencies' }`) per issue number AND records every number it was
        called with (for the re-evaluation assertions). Default verdict for an unprimed
        issue is irrelevant — only selected dependents are consulted.
      • The `... runs for closed issue {int}` When calls
        `handleIssueClosedDependencyUnblock(closedIssueNumber, repoInfo,
        targetRepoArgs, <injected deps>)`. The injected spawn collaborator is a
        recording spy capturing the issue numbers it is asked to spawn; NO real
        `spawnDetached` / `classifyAndSpawnWorkflow` runs. The exact deps-param shape is
        the implementer's choice — pin the recorded spawn set and eligibility-call set,
        not the signature.
      • The Thens assert the recorded sets: `spawns a workflow for issue N` → the spawn
        recorder contains N; `spawns no workflow for issue N` → it does not;
        `re-evaluates eligibility for issue N` → the eligibility recorder contains N;
        `does not re-evaluate eligibility for issue N` → it does not. Value-based, never
        a source read.
      • §5 reuses the registered T22 type-check Then (feature-504.steps.ts) — already
        registered, do NOT redefine.
      • feature-753.steps.ts declares its OWN `@adw-753` Before/After hooks resetting
        the World scratch (seeded issues, eligibility verdict map, spawn recorder,
        eligibility recorder). Everything is in-memory: no mock GitHub server, no
        `agents/<adwId>` disk writes, so there is no state-dir cleanup beyond the
        scratch reset.

  Background:
    Given the ADW codebase is checked out

  # ═══════════════════ §1  PROSE DEPENDENT UNBLOCKS — the headline RED→green (#29 defect) ═══
  #
  # AC1. An open issue declaring its blocker in a bare prose bullet — no `## Blocked by`
  # heading — is the case the heading-only `parseDependencies` MISSED. Driven through the
  # shared extractor, the blocker's closure now SELECTS it (eligibility is re-evaluated)
  # and, being eligible, SPAWNS it. An unrelated open issue is neither re-evaluated nor
  # spawned. Before the fix the prose dependent is never selected, so its eligibility is
  # never re-evaluated and no spawn is recorded — this scenario is RED.

  @adw-753 @adw-pa6xsc-dependency-unblock-m
  Scenario: A prose "- blocked by #N" dependent is re-evaluated and spawned when its blocker closes, while a non-dependent is left alone
    Given an open issue 2901 with a prose dependency line "- blocked by #2801" and no dependency heading
    And an open issue 2902 with no dependency on blocker 2801
    And the injected eligibility check reports issue 2901 as eligible
    When the issue-closed dependency unblock runs for closed issue 2801
    Then the dependency unblock re-evaluates eligibility for issue 2901
    And the dependency unblock spawns a workflow for issue 2901
    And the dependency unblock does not re-evaluate eligibility for issue 2902
    And the dependency unblock spawns no workflow for issue 2902

  # ═══════════════════ §2  HEADING DEPENDENT STILL UNBLOCKS — no regression ═══════════════
  #
  # AC2. The shared extractor is the heading ∪ prose SUPERSET
  # (`parseKeywordProximityDependencies` unions `parseDependencies` with the proximity
  # scan), so a dependent declaring its blocker under a `## Blocked by` heading — the case
  # the old parser DID catch — continues to unblock. The regression guard: swapping to the
  # broader extractor drops nothing the narrow one caught.

  @adw-753 @adw-pa6xsc-dependency-unblock-m
  Scenario: A "## Blocked by" heading dependent still unblocks when its blocker closes
    Given an open issue 2911 that lists blocker 2810 under a Blocked by heading
    And the injected eligibility check reports issue 2911 as eligible
    When the issue-closed dependency unblock runs for closed issue 2810
    Then the dependency unblock re-evaluates eligibility for issue 2911
    And the dependency unblock spawns a workflow for issue 2911

  # ═══════════════════ §3  MIXED CLOSURE — prose AND heading both unblock, unrelated skipped ═══
  #
  # AC1 + AC2 together in one closure. A single blocker's closure unblocks BOTH a prose
  # dependent and a heading dependent, while an issue with no dependency on it is skipped.
  # This pins that the extractor genuinely spans both declaration styles in one pass and
  # stays selective.

  @adw-753 @adw-pa6xsc-dependency-unblock-m
  Scenario: One closure unblocks both a prose dependent and a heading dependent while skipping an unrelated issue
    Given an open issue 2921 with a prose dependency line "- blocked by #2820" and no dependency heading
    And an open issue 2922 that lists blocker 2820 under a Blocked by heading
    And an open issue 2923 with no dependency on blocker 2820
    And the injected eligibility check reports issue 2921 as eligible
    And the injected eligibility check reports issue 2922 as eligible
    When the issue-closed dependency unblock runs for closed issue 2820
    Then the dependency unblock spawns a workflow for issue 2921
    And the dependency unblock spawns a workflow for issue 2922
    And the dependency unblock spawns no workflow for issue 2923

  # ═══════════════════ §4  ELIGIBILITY STILL GATES — selected but still blocked ⇒ not spawned ═══
  #
  # AC1's "re-evaluated / spawned" clause. Selection is NOT a blind spawn. A prose dependent
  # is selected on the blocker's closure and its eligibility IS re-evaluated, but because it
  # remains blocked (e.g. a second open dependency, or the concurrency limit), it is NOT
  # spawned. The re-evaluation-happened + no-spawn pair proves the handler consulted
  # eligibility and respected an ineligible verdict rather than firing unconditionally.

  @adw-753 @adw-pa6xsc-dependency-unblock-m
  Scenario: A prose dependent selected on closure but re-evaluated as still blocked is not spawned
    Given an open issue 2931 with a prose dependency line "- blocked by #2830" and no dependency heading
    And the injected eligibility check reports issue 2931 as still blocked
    When the issue-closed dependency unblock runs for closed issue 2830
    Then the dependency unblock re-evaluates eligibility for issue 2931
    And the dependency unblock spawns no workflow for issue 2931

  # ═══════════════════ §5  TYPE-CHECK BACKSTOP (registry T22) ═══════════════════════════════
  #
  # Consistent with the sibling per-issue features (feature-664 §6, feature-722 §3): routing
  # `handleIssueClosedDependencyUnblock` through `extractDependencies` and adding the DI seam
  # compiles within the ADW codebase's type-check — the injected-deps signature matches its
  # call sites and the webhook wiring still type-checks.

  @adw-753 @adw-pa6xsc-dependency-unblock-m
  Scenario: The ADW TypeScript type-check passes after routing the unblock through the shared extractor and DI seam
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
