@adw-742 @adw-mnmihl-scenario-authoring-s
Feature: The SDLC scenario-authoring phase is skipped for a promotion issue — a regression-promotion issue runs plan/build/test without inventing a junk feature-<promotionIssueN>.feature, while a normal feature issue authors scenarios exactly as today

  Issue #742 adds the AUTHORING SKIP-GATE half of the automated scenario-promotion
  sweep (parent PRD `specs/prd/automated-scenario-promotion-sweep.md`, PR #738,
  User Story 11). Its sibling #740 files the promotion issue (labelled `adw:feature`
  + `regression-promotion` + `hitl`) that the normal SDLC pipeline then runs to
  relocate a per-issue scenario into `features/regression/`. But that promotion
  issue is not a real "author scenarios for this feature" ticket — it is a MOVE
  instruction. Left unguarded, the unconditional scenario phase would hand the
  promotion issue to `scenario_writer`, which would invent a brand-new junk
  `features/per-issue/feature-<promotionIssueN>.feature`. That file (a) reddens the
  promotion run and (b) becomes its OWN future promotion candidate — a
  promotion-of-a-promotion. #734 dodged this by luck (n=1, the LLM happened not to
  author one); this slice removes the reliance on LLM discretion.

  THE FIX (parent PRD Implementation Decision "Pipeline modifications (minimal)"):
  a trivial pure gate `shouldSkipScenarioAuthoring(labels)` returns true exactly
  when `regression-promotion` is present, and is wired into BOTH touched phases so
  that, for a promotion issue, the scenario-authoring phases no-op:

    • `scenarioPhase` — when the gate fires, `executeScenarioPhase` returns early
      WITHOUT invoking the `/scenario_writer` command agent, so no per-issue feature
      file is authored.
    • `alignmentPhase` — when the gate fires, `executeAlignmentPhase` returns early
      WITHOUT invoking the `/align_plan_scenarios` command agent (and the dependent
      validation / gherkin-freeze / fidelity steps that hang off the alignment pass
      no-op as a unit), cleanly and with no spurious failure.

  A normal (non-promotion) feature issue is unaffected: neither gate fires, so
  scenario authoring and alignment run exactly as today.

  The behavioural contract pinned below (the OBSERVABLE half of the acceptance
  criteria — the pure gate itself is integration-covered per the PRD, see Scope
  notes):

    1. PROMOTION ISSUE ⇒ SCENARIO AUTHORING SKIPPED (AC1, US11). An issue whose
       label set contains `regression-promotion` runs the scenario phase WITHOUT the
       `/scenario_writer` agent ever being invoked — the gate short-circuits before
       any agent call. The presence of `regression-promotion` is decisive regardless
       of the co-labels a promotion issue also carries (`adw:feature`, `hitl`).
    2. NON-PROMOTION ISSUE ⇒ SCENARIO AUTHORING RUNS AS TODAY (AC3, AC4). An issue
       WITHOUT `regression-promotion` invokes `/scenario_writer` exactly as before —
       and this holds even when the issue carries `hitl` (which promotion issues also
       carry), proving the gate keys specifically on `regression-promotion`, not on
       "is this issue special/gated".
    3. NO JUNK feature-<promotionIssueN>.feature IS AUTHORED (AC1 literal, US11). For
       a promotion issue, even with the authoring agent ARMED to write a per-issue
       feature file when invoked, no `features/per-issue/feature-<promotionIssueN>.feature`
       appears in the worktree after the scenario phase — the promotion-of-a-promotion
       is prevented at the source.
    4. PROMOTION ISSUE ⇒ ALIGNMENT NO-OPS CLEANLY (AC2). For a promotion issue, the
       alignment phase does NOT invoke the `/align_plan_scenarios` agent and completes
       without raising — EVEN when a plan file and a `@adw-<N>`-tagged scenario file
       are present (a deliberate test construction; see §4). The no-op is INTENTIONAL
       (the gate), not merely incidental (the pre-existing "no scenario files found"
       skip). "No spurious failures" is pinned: the phase returns normally.
    5. NON-PROMOTION ISSUE ⇒ ALIGNMENT RUNS AS TODAY (AC3 guard). For a non-promotion
       issue with a plan and a `@adw-<N>` scenario present, the alignment phase DOES
       invoke `/align_plan_scenarios` — the alignment gate is label-scoped and never
       suppresses the normal path.
    6. TYPE-CHECK BACKSTOP (T22). The ADW codebase still type-checks with the new
       `shouldSkipScenarioAuthoring` gate wired into `scenarioPhase` and
       `alignmentPhase`.

  Observability / rot-prevention note:

    Every assertion below targets an artefact the phase PRODUCES — whether the
    `/scenario_writer` or `/align_plan_scenarios` command agent was invoked (recorded
    by the claude-cli-stub in `MOCK_INVOCATION_LOG`), whether a per-issue feature file
    the phase would have authored is present in or absent from the worktree, whether
    the in-process phase call raised, or the type-checker's verdict (T22). These are
    vocabulary registry surfaces #5 ("log streams / recorded invocations captured from
    the stub"), #3 ("git/worktree artefacts produced by the system under test") and
    #4 ("no exception propagated").

    The gate under test is exercised through the COMPOSED phase behaviour, not by
    reading source. NO step below reads `scenarioPhase.ts`, `alignmentPhase.ts`, or
    `shouldSkipScenarioAuthoring`'s source as text, substring-matches its contents, or
    parses it as JSON/AST. "Was the agent invoked?" is answered from the stub's
    recorded prompt log — a recorded call, exactly as feature-533 reads
    `MOCK_INVOCATION_LOG` for ordering assertions — never from the phase source. "Was
    a junk feature file authored?" asserts the presence/absence of a worktree file the
    scenario phase WRITES (an authored artefact, the same category feature-739 uses
    when it asserts a swept file is deleted), never the existence of a framework source
    file.

    A subtlety, called out so it is not mistaken for a rot violation: §4 SEEDS a
    `@adw-<N>`-tagged per-issue scenario file into the worktree for a PROMOTION issue.
    A real promotion issue never has one (authoring is skipped upstream by this very
    gate). That seed is a deliberate TEST CONSTRUCTION whose sole purpose is to prove
    the alignment gate short-circuits BEFORE `alignmentPhase`'s scenario-discovery
    step — i.e. that the no-op is the gate firing, not the incidental "no scenario
    files found" skip that would pass vacuously. The seeded file is INPUT FIXTURE data
    the phase consumes, not a source file of this framework.

  Scope notes:

    • THE PURE GATE IS INTEGRATION-COVERED, NOT UNIT-TESTED — AND THIS FEATURE IS THAT
      COVER. The parent PRD's Testing Decisions name `shouldSkipScenarioAuthoring`
      (with `promotionIssueBody` and the `runPromotionSweep` shell) as
      "integration-covered … exercised via BDD/pipeline behaviour rather than isolated
      units". So — unlike #739/#740, whose pure deciders were the implementer's Vitest
      — there is no separate unit test to defer AC4 to. AC4 ("`shouldSkipScenarioAuthoring`
      is a pure gate consistent with `regression-promotion` label detection") is pinned
      HERE, behaviourally: §1 and §2 form the label truth-table observed through the
      phase — `regression-promotion` present ⇒ skip; absent ⇒ run — including the
      `hitl`-but-not-`regression-promotion` discriminator (§2) that proves the gate
      keys on the right label. The scenarios deliberately do NOT call
      `shouldSkipScenarioAuthoring([...])` directly and assert its boolean, because
      that would test a source-code property; they drive the two phases and observe
      whether authoring/alignment ran.
    • ONLY THE AUTHORING SKIP IS PINNED. The DOWNSTREAM behaviour of a promotion issue
      — that its zero-`@adw-{promotionIssueN}` test run is classified
      `{passed, skipped}` and does not redden (parent PRD "Green-proof (verified)" /
      "Empty-target-tag invariant"), and that the build agent performs the relocation —
      is a DIFFERENT concern owned by the test/build phases and the #740 issue body, not
      by this authoring gate. It is not pinned here.
    • THE "VALIDATION / GHERKIN-FREEZE / FIDELITY STEPS" ARE NOT SEPARATE PHASES. In the
      current pipeline the single-pass `alignmentPhase` subsumes the old multi-round
      validation, and the fidelity/gherkin-freeze work hangs off that alignment agent
      pass. The two touched files are `scenarioPhase.ts` and `alignmentPhase.ts` only;
      the observable no-op is pinned at those two phase boundaries (§1, §3 for scenario;
      §4 for alignment). This feature does not invent phase functions that do not exist.
    • HOW THE GATE IS WIRED IS A SOURCE-STRUCTURE CHOICE, left unpinned exactly as
      #739/#740 left their seams. Whether the gate reads `config.issue.labels`
      (mapped to names) or a pre-derived `issueLabels`, whether it is checked above or
      below the existing `shouldExecuteStage` guard, and whether `alignmentPhase`'s
      early-return reuses `scenarioPhase`'s decision — none is asserted. The scenarios
      pin the behaviour (promotion ⇒ neither agent invoked, no junk file; non-promotion
      ⇒ both run), not the mechanism.
    • THE @regression MAINTENANCE SWEEP IS SKIPPED for this issue: `.adw/scenarios.md`
      configures a `## Regression Scenario Directory`, so promotion to the executed
      regression suite is a deliberate human decision and the agent never auto-promotes.

  Vocabulary note:

    Reused registered phrases (`features/regression/vocabulary.md`):
      G18  `the ADW codebase is checked out`
      T22  `the ADW TypeScript type-check passes`

    Novel phrasing introduced here — the registry has no phrase for driving
    `executeScenarioPhase` / `executeAlignmentPhase` in-process, for a label-keyed
    authoring gate, or for a "was the command agent invoked?" verdict read from the
    stub's recorded-invocation log. The registry's agent phrases (G3/G9 stub-loading,
    W-family orchestrator/phase invocations) are bound to the SUBPROCESS/orchestrator
    drivers (`givenSteps.ts` / `whenSteps.ts`, several still pending at CUTOVER) and
    are keyed on adwId worktrees, not on the label-gate phase-import path. As #739 and
    #740 did for the sibling sweeps, feature-742 introduces DISTINCT, self-contained
    phrasing so `feature-742.steps.ts` owns its step defs with no
    `AmbiguousStepDefinition` clash under the globally-loaded per-issue + regression
    step defs (the bespoke-per-feature convention; zero phrase collisions across the
    suite). The gap is surfaced to the maintainer here:
      • `a feature issue {int} labelled {string} is ready for the scenario pipeline`
      • `a plan file for issue {int} is present in the worktree`
      • `a per-issue scenario file tagged for issue {int} is present in the worktree`
      • `the scenario-writer stub is armed to author a per-issue feature file for issue {int} when invoked`
      • `the scenario phase runs for issue {int}`
      • `the alignment phase runs for issue {int}`
      • `the scenario-writer agent is invoked for issue {int}`
      • `the scenario-writer agent is not invoked for issue {int}`
      • `no per-issue feature file for issue {int} is authored in the worktree`
      • `the alignment agent is invoked for issue {int}`
      • `the alignment agent is not invoked for issue {int}`
      • `the scenario phase completes without raising an error`
      • `the alignment phase completes without raising an error`

    Step-definition note for the maintainer (feature-742.steps.ts — keep it
    SELF-CONTAINED with its own `@adw-742` Before/After and module-private `ctx`; do
    NOT reach into feature-533 / feature-739 / feature-740 ctx or step defs):
      • DRIVE THE PHASES IN-PROCESS (registry pattern 2, "phase import"), NOT via an
        orchestrator subprocess (the W1 subprocess driver is still pending at CUTOVER).
        Import `executeScenarioPhase` from `adws/phases/scenarioPhase.ts` and
        `executeAlignmentPhase` from `adws/phases/alignmentPhase.ts`. Build a MINIMAL
        `WorkflowConfig` cast (`… as unknown as WorkflowConfig`) carrying only the
        fields the phases read — mirroring feature-719.steps.ts's minimal-config
        pattern. For the scenario phase: `recoveryState` (a FRESH state so
        `shouldExecuteStage('plan_validating', recoveryState)` returns true — otherwise
        the phase skips for the unrelated "already completed" reason and masks the
        gate), `orchestratorStatePath` (a temp state file), `adwId`, `issueNumber`,
        `issue` (a `GitHubIssue` whose `.labels` is `[{ name }, …]` from the outline
        row), `worktreePath` (a fresh `mkdtemp` dir), `logsDir`, `installContext`
        (undefined is fine). For the alignment phase: additionally `issueType`, `ctx`,
        and OMIT `repoContext` (leave it undefined) so no `plan_aligning` stage comment
        is attempted — the gate short-circuits before that step regardless, and this
        keeps the harness free of a mock GitHub server.
      • WIRE THE CLAUDE-CLI-STUB so any agent call is intercepted (never a real LLM) and
        RECORDED. Use `setupMockInfrastructure()` / `teardownMockInfrastructure()`
        (`test/mocks/test-harness.ts`) to point `CLAUDE_CODE_PATH` at
        `test/mocks/claude-cli-stub.ts`, and set `process.env.MOCK_INVOCATION_LOG` to a
        temp file BEFORE calling the phase (the phase spawns the stub with the ambient
        env; the stub appends each prompt to that log — see feature-533.steps.ts's
        `ensureInvocationLog` / `readInvocations` helpers, kept module-private here).
        `the scenario-writer agent is invoked` ⇒ some recorded prompt contains
        `/scenario_writer`; `… is not invoked` ⇒ none does. `the alignment agent is
        invoked` ⇒ some recorded prompt contains `/align_plan_scenarios`; `… is not
        invoked` ⇒ none does.
      • FOR §3 (armed stub) set `MOCK_MANIFEST_PATH` + `MOCK_WORKTREE_PATH` to a manifest
        that, when `/scenario_writer` runs, WRITES
        `features/per-issue/feature-{N}.feature` into the worktree — so BEFORE the fix
        the invoked agent authors the junk file (RED: file present) and AFTER the fix the
        skipped agent leaves it absent (GREEN). `no per-issue feature file for issue {int}
        is authored` ⇒ `!existsSync(join(worktree, 'features/per-issue/feature-{N}.feature'))`
        after the phase. Do NOT pre-seed that file for §3.
      • `a plan file for issue {int} is present` writes the plan via the SAME
        `getPlanFilePath(issueNumber, worktreePath)` the phase reads, so the seed lands
        exactly where alignment Step 1 (`readPlanFile`) looks. `a per-issue scenario file
        tagged for issue {int} is present` writes a `features/per-issue/feature-{N}.feature`
        carrying a `@adw-{N}` feature-level tag so `findScenarioFiles(N, worktree)`
        discovers it — making §4 a genuine gate test (without the gate, alignment would
        proceed to invoke `/align_plan_scenarios`) and §5's normal-path invocation real.
      • `a feature issue {int} labelled {string}` parses the comma-separated {string}
        into `issue.labels = [{ name }, …]` and stashes the issue fixture (minimal title
        + body) on `ctx` for the When step to build the config from. The gate's own
        `regression-promotion` string should come from `ADW_REGRESSION_PROMOTION_LABEL`
        (`adws/github/labelManager.ts`); the scenarios pass it as literal label text.
      • `completes without raising an error` wraps the in-process phase call in
        try/catch and asserts nothing propagated (the phases are non-fatal by design;
        this guards a gate mis-implementation — e.g. a label-parse throw — from
        regressing the no-op into a spurious failure). Record no orchestrator/agent
        error state was written for the skipped path.

  Background:
    Given the ADW codebase is checked out

  # ── §1 Promotion issue ⇒ scenario authoring is SKIPPED (AC1 / US11 / AC4) ──────────────
  #
  # The headline. An issue whose label set contains `regression-promotion` must run the
  # scenario phase WITHOUT `/scenario_writer` ever being invoked — the gate short-circuits
  # before any agent call. Both rows carry `regression-promotion`; they vary the co-labels
  # a promotion issue also carries so the skip is pinned as keyed on `regression-promotion`
  # presence, not on the exact label set. RED before the gate exists (the unconditional
  # phase invokes `/scenario_writer`); GREEN once the gate short-circuits.

  @adw-742 @adw-mnmihl-scenario-authoring-s
  Scenario Outline: A promotion issue carrying regression-promotion skips scenario authoring
    Given a feature issue 815 labelled "<labels>" is ready for the scenario pipeline
    When the scenario phase runs for issue 815
    Then the scenario-writer agent is not invoked for issue 815
    And the scenario phase completes without raising an error

    Examples:
      | labels                                  | note                                              |
      | regression-promotion                    | the reconciliation key alone triggers the skip    |
      | regression-promotion, adw:feature, hitl | the full #740-filed promotion label set           |

  # ── §2 Non-promotion issue ⇒ scenario authoring RUNS as today (AC3 / AC4) ──────────────
  #
  # The other half of the truth-table. An issue WITHOUT `regression-promotion` invokes
  # `/scenario_writer` exactly as before — no behaviour change. The `adw:feature, hitl` row
  # is the AC4 discriminator: a `hitl`-gated feature issue (hitl, but NOT regression-promotion)
  # must STILL author scenarios, proving the gate keys specifically on `regression-promotion`
  # and not on "is this issue human-gated/special". These rows are guards (GREEN before and
  # after the fix); the gate must never over-fire.

  @adw-742 @adw-mnmihl-scenario-authoring-s
  Scenario Outline: A non-promotion feature or bug issue authors scenarios exactly as today
    Given a feature issue 816 labelled "<labels>" is ready for the scenario pipeline
    When the scenario phase runs for issue 816
    Then the scenario-writer agent is invoked for issue 816

    Examples:
      | labels            | note                                                        |
      | adw:feature       | a normal feature issue — authoring runs as today            |
      | adw:feature, hitl | hitl but not a promotion — must NOT be skipped (keys on label) |
      | bug               | a normal bug issue — unaffected                             |

  # ── §3 No junk feature-<promotionIssueN>.feature is authored (AC1 literal / US11) ───────
  #
  # The concrete anti-"promotion-of-a-promotion" guard. Even with the scenario-writer stub
  # ARMED to author a per-issue feature file the moment it is invoked, a promotion issue
  # produces no `features/per-issue/feature-815.feature` in the worktree — because the gate
  # prevents the agent from ever running. RED before the fix (the invoked agent authors the
  # junk file, which would redden the run AND become its own future promotion candidate);
  # GREEN after (absent).

  @adw-742 @adw-mnmihl-scenario-authoring-s
  Scenario: A promotion issue authors no junk per-issue feature file even with the writer armed
    Given a feature issue 815 labelled "regression-promotion, adw:feature, hitl" is ready for the scenario pipeline
    And the scenario-writer stub is armed to author a per-issue feature file for issue 815 when invoked
    When the scenario phase runs for issue 815
    Then the scenario-writer agent is not invoked for issue 815
    And no per-issue feature file for issue 815 is authored in the worktree

  # ── §4 Promotion issue ⇒ the dependent alignment phase NO-OPS cleanly (AC2) ─────────────
  #
  # The dependent-step half of the contract. For a promotion issue the alignment phase must
  # not invoke `/align_plan_scenarios` and must complete without raising — and it must do so
  # INTENTIONALLY (the gate), not incidentally. To prove that, we seed BOTH a plan file and a
  # `@adw-815` scenario file: without the gate, `alignmentPhase` would find the plan (Step 1)
  # AND discover the scenario file (Step 2) and proceed to invoke the alignment agent. The
  # seeded `@adw-815` file is a deliberate test construction — a real promotion issue never
  # has one (this very gate skipped its authoring) — present ONLY so the no-op is a genuine
  # RED→GREEN on the gate rather than a vacuous pass via the pre-existing "no scenario files"
  # skip. RED before the fix (alignment invokes `/align_plan_scenarios`); GREEN after.

  @adw-742 @adw-mnmihl-scenario-authoring-s
  Scenario: A promotion issue skips alignment even when a plan and a tagged scenario are present
    Given a feature issue 815 labelled "regression-promotion, adw:feature, hitl" is ready for the scenario pipeline
    And a plan file for issue 815 is present in the worktree
    And a per-issue scenario file tagged for issue 815 is present in the worktree
    When the alignment phase runs for issue 815
    Then the alignment agent is not invoked for issue 815
    And the alignment phase completes without raising an error

  # ── §5 Non-promotion issue ⇒ the alignment phase RUNS as today (AC3 guard) ──────────────
  #
  # The mirror guard for the alignment gate. A non-promotion feature issue with a plan and a
  # `@adw-816` scenario present must STILL invoke `/align_plan_scenarios` — the gate added to
  # `alignmentPhase` is label-scoped and never suppresses the normal alignment path. A guard
  # (GREEN before and after); pins that #742's alignment change is a promotion-only skip, not
  # a blanket disable.

  @adw-742 @adw-mnmihl-scenario-authoring-s
  Scenario: A non-promotion feature issue runs alignment exactly as today
    Given a feature issue 816 labelled "adw:feature" is ready for the scenario pipeline
    And a plan file for issue 816 is present in the worktree
    And a per-issue scenario file tagged for issue 816 is present in the worktree
    When the alignment phase runs for issue 816
    Then the alignment agent is invoked for issue 816

  # ── §T Type-check backstop (T22) ───────────────────────────────────────────────────────
  #
  # The new `shouldSkipScenarioAuthoring` gate wired into `scenarioPhase` and `alignmentPhase`
  # keeps the ADW codebase type-clean. A backstop consistent with feature-739 §T and
  # feature-740 §T.

  @adw-742 @adw-mnmihl-scenario-authoring-s
  Scenario: The ADW TypeScript type-check passes with the scenario-authoring skip-gate wired in
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
