@adw-960 @adw-f2mx98-bug-regression-then
Feature: Regression steps T1 and T5 judge runtime artefacts only, so outside the @regression hooks neither passes on source text or on a run that never happened: T1 reads the state file and, when there is none, fails naming the paths it tried; T5 compares the recorded exit code; W1 and W10 are reported pending instead of passing by doing nothing

  Issue #960 resolves item 4 of the `## Divergence` section of ADR-0037. The owner ruled on
  2026-10-01 that the rot rubric applies to everything under `features/regression/`, so the two
  source-text branches are a bug. The issue was split from #935.

  The regression World (`features/regression/step_definitions/world.ts`) starts with
  `mockContext` null and `lastExitCode` -1. Only the `@regression` Before hook, or a per-issue
  hook that calls `setupMockInfrastructure` itself, sets `mockContext`. While it is null:
    • T1 `the state file for adwId {string} records workflowStage {string}` reads
      `adws/adwSdlc.tsx` and `adws/phases/authPause.ts`. It passes when they contain
      `handleAuthRequiredPause(` and the quoted stage, and never looks for a state file;
    • T5 `the orchestrator subprocess exited {int}` passes when `authPause.ts` contains
      `process.exit(N)`;
    • W1 `the {string} orchestrator is invoked with adwId {string} and issue {int}` and W10
      `the cron probe runs once` return at once, so they pass having done nothing.
  Checked on 2026-10-02 with a throwaway feature run outside the hooks. T1 "paused_auth" passed
  for an adwId with no state file. T5 "exited 0" passed as the only step. T1 "build_completed"
  failed with "Expected 'build_completed' in authPause.ts", which names no path.

  No feature file reaches these branches today. The smoke and surface scenarios run inside the
  `@regression` hooks and stop pending at their When step. Features 908, 912 and 927 reuse T1,
  but their own hooks set `mockContext`, so there T1 already reads the state they write to
  `agents/<adwId>/state.json`. 927's step definitions say they do it to stop T1 "falling back to
  inspecting source". The branches catch the next per-issue feature that reuses the registered
  phrases, which the scenario writer is told to do.

  After the fix:
    • T1 reads `agents/<adwId>/state.json` under the ADW checkout root. When that file is
      absent, it reads `.adw/state.json` in the worktree that G6 or G11 registered for the adwId.
      When neither exists it fails, naming each path it tried. When the recorded stage differs
      it fails;
    • T5 always compares `World.lastExitCode` with N. Nothing sets it before a subprocess step
      runs, so "exited 0" fails when nothing ran;
    • W1 and W10 lose their `mockContext === null` early returns. They report pending everywhere
      until a later slice gives them real bodies (ADR-0037, item 3).

  The labels below are the section numbers used for the scenario groups further down (§1–§7):

    §1  THE FALSE GREEN. Outside the hooks, a scenario that invokes an orchestrator, asserts a
        workflowStage and an exit code, and runs nothing passes today. It must be reported
        pending.

    §2  T5 COMPARES THE RECORDED EXIT CODE (AC2). "exited 0" as the only step fails, outside the
        hooks and inside them. T5 passes on the code a subprocess step recorded and fails on any
        other. W1 and W10 are still pending, so a stand-in step records the code.

    §3  T1 WITH NO STATE FILE (AC3). T1 fails and names the paths it tried: the top-level path,
        and the worktree path when a worktree is registered.

    §4  T1 ON A RECORDED STATE. T1 passes on the stage the top-level state file records and fails
        on any other, outside the hooks and inside them. With no top-level file it falls back to
        the worktree state G6 wrote. When both exist, the top-level file wins.

    §5  W1 AND W10 NEVER PASS BY DOING NOTHING. As the only step of a scenario, each is reported
        pending, outside the hooks and inside them.

    §6  PENDING STAYS PENDING (AC4). The 8 smoke and 34 surface scenarios are still all reported
        pending. The T1 scenarios of features 908, 912 and 927 are flagged `@adw-960`, so this
        issue's test phase runs them. On 2026-10-02 all 69 scenarios of those three features
        passed.

    §7  BACKSTOP. Type-check.

  Each row is written to fail for a specific wrong implementation:
    • the §1 row fails for today's code. It also fails for a fix that removes the T1 and T5
      branches but keeps W1's early return: W1 then passes, T1 fails, and the scenario is
      reported failed, not pending;
    • the "exited 0 as the only step" rows fail outside the hooks for today's code;
    • the T5 pass rows fail for a T5 that needs `mockContext`, or that always fails. The
      exit-code-1 row also fails for today's code, which looks for `process.exit(1)` in
      `authPause.ts` and finds only `process.exit(0)`;
    • the T5 mismatch rows fail outside the hooks for today's code, and for a T5 that checks only
      that some subprocess step ran;
    • the no-state rows fail outside the hooks for today's code. The `paused` row is there
      because `authPause.ts` also contains `'paused'`, so a fix that special-cases `paused_auth`
      still fails it. The inside row pins the path in the message;
    • the empty-worktree row fails for a T1 that names only one of the two paths it tried;
    • the top-level pass rows fail for a T1 that needs `mockContext`. Outside the hooks they also
      fail for today's code, because `authPause.ts` never mentions `awaiting_merge`;
    • the top-level mismatch rows fail outside the hooks for today's code;
    • the fallback rows fail for a T1 that reads only the top-level path. The precedence rows
      fail for one that prefers the worktree state;
    • the §5 rows fail outside the hooks for today's code, and for a fix that gives W1 or W10 a
      body that passes without running anything;
    • the §6 smoke-and-surface row fails if any of those scenarios turns from pending to passed
      or failed, for instance because W1's or W10's preserved body was uncommented. The flagged
      908, 912 and 927 scenarios fail for a T1 that stops reading `agents/<adwId>/state.json`.

  ── WHY SOME CRITERIA GET NO SCENARIO OF THEIR OWN ──────────────────────────────────────────
  AC1 (`grep -rnE "readFileSync\(.*'adws/" features/regression/step_definitions` finds nothing)
  is a property of source text. A scenario could check it only by reading step-definition files,
  which the rot-prevention rule forbids, so it belongs in the plan's validation commands. §2–§4
  are its behavioural counterpart: no T1 or T5 verdict depends on what `adws/` contains.
  AC5 (item 4 removed from ADR-0037) and the new T1 and T5 rows of
  `features/regression/vocabulary.md` are documentation. No scenario asserts on the text of a
  decision record or of the registry. The rest of AC4, that every scenario passing on `dev`
  still passes, needs a whole-suite comparison before and after the change. That is left to the
  plan's validation commands. ADW's test phase already runs `@regression` as a blocker tag.

  Notes for the step definitions:
    • THE SYSTEM UNDER TEST is the step library under `features/regression/step_definitions/`, as
      Cucumber runs it. Every scenario runs Cucumber in a child process over a throwaway feature
      and reads the run's results. Nothing calls a step function directly or reads a
      step-definition file. G6, G11, W1, W10, T1 and T5 appear only inside the throwaway
      features. The child resolves them to the definitions under test.
    • "a throwaway feature whose only scenario runs outside|inside the @regression hooks, with
      the steps:" writes a feature file into a fresh temp directory outside the checkout. It
      holds one Feature and one Scenario, with the DocString's lines as its steps. The scenario
      carries a tag unique to the run. "inside" also tags it `@regression`, so the regression
      Before hook sets `World.mockContext`. "outside" adds nothing, so no hook sets it. Never
      give it an `@adw-` tag, because some per-issue hooks keyed on those set `mockContext` too.
    • "the throwaway feature is run through Cucumber" spawns `bunx cucumber-js --tags <tag>
      <feature path>` from the ADW checkout root with `NODE_OPTIONS=--import tsx`. The child then
      loads exactly the support code `cucumber.js` imports. It takes about 3 seconds.
        – cucumber-js merges CLI paths with the paths `cucumber.js` configures, and prints a
          deprecation notice saying so. Without the tag filter the child runs the whole suite.
        – Remove `ADW_JUNIT_REPORT_PATH` from the child's environment. `cucumber.js` adds a JUnit
          formatter when it is set. The scenario proof sets it for the outer run, so a child that
          inherits it writes over the outer run's report.
        – Nothing in the child may reach GitHub or the Claude CLI, even if a broken W1 or W10 ran
          something. Blank `GH_TOKEN` and the `GITHUB_APP_*` variables, and point
          `CLAUDE_CODE_PATH` at `test/mocks/claude-cli-stub.ts`.
        – Read the results from a machine-readable formatter written to a temp file, such as
          `--format message:<file>`, not from the progress output.
        – Assert that the child ran exactly one scenario, the throwaway one, so a filter mistake
          cannot make a verdict vacuous.
    • The verdicts come from the throwaway scenario's step results:
        – "passes": every step PASSED;
        – "fails": a step FAILED. An UNDEFINED or AMBIGUOUS step is not a failure of the step
          under test. Report it as an error instead;
        – "is reported pending": a step is PENDING, no step FAILED or is UNDEFINED or AMBIGUOUS,
          and every later step was SKIPPED.
      When a verdict does not hold, show the child's step results and error messages.
    • "the failure message names the state file path "<p>"" matches `<p>`, which is relative to
      the checkout root, as a substring of the failed step's error message. T1 reports absolute
      paths. "names the state file path inside the worktree registered for adwId X" matches a
      path that ends in `/.adw/state.json`. G11 creates that worktree in a temp directory inside
      the child, so the outer run cannot know its full path. "reports the recorded workflowStage
      "<s>"" matches `<s>` as a substring of the error message.
    • "a stand-in subprocess step has recorded exit code {int}" appears only inside throwaway
      features. Define it with this feature's steps. It sets `World.lastExitCode` to N and
      stands in for W1 and W10 until they get real bodies. The child loads it because
      `cucumber.js` imports every per-issue step definition.
    • "the ADW checkout holds a top-level state file for adwId X recording workflowStage S"
      writes `{ "adwId": X, "workflowStage": S }` to `agents/X/state.json` under the checkout
      root, where T1 looks first. "holds no top-level state file for adwId X" makes sure
      `agents/X/` is absent. An After hook removes `agents/<adwId>/` for every adwId these steps
      name, and every temp directory the scenario made.
    • "the regression suite's smoke and surface scenarios are run through Cucumber" runs the
      child with `--tags "@smoke or @surface"`, under the same environment rules. On 2026-10-02
      that selected 42 scenarios, all pending, in under 5 seconds. "every smoke and surface
      scenario is reported pending" asserts two things. The child ran at least one scenario from
      `features/regression/smoke/` and one from `features/regression/surfaces/`. Every scenario
      it ran is reported pending in the sense above.
    • Key every hook on `@adw-f2mx98-bug-regression-then`, never on `@adw-960`. The flagged
      scenarios of 908, 912 and 927 carry `@adw-960` and must not run this feature's hooks.
    • These phrases are defined elsewhere:
        – "the ADW codebase is checked out" in
          `features/step_definitions/ensureCronOnEveryEventSteps.ts`;
        – "the ADW TypeScript type-check passes" in
          `features/regression/step_definitions/thenSteps.ts`.

  Vocabulary note. These registered phrases from `features/regression/vocabulary.md` are reused:
    • G18 `the ADW codebase is checked out`
    • T22 `the ADW TypeScript type-check passes`
  The phrases under test appear verbatim inside the throwaway features: G6, G11, W1, W10, T1
  and T5. The registry has no phrase for any of the following, so novel phrasing is introduced
  for them:
    • running Cucumber over a throwaway feature, and that run's verdicts and failure messages;
    • seeding or clearing a top-level state file without running an orchestrator;
    • a stand-in subprocess step;
    • running the smoke and surface scenarios.

  Background:
    Given the ADW codebase is checked out

  # ── §1 THE FALSE GREEN ───────────────────────────────────────────────────────────────────────

  @adw-960 @adw-f2mx98-bug-regression-then
  Scenario: Replaying the false green — outside the @regression hooks, a scenario that invokes an orchestrator, asserts a workflowStage and an exit code, and runs nothing is reported pending, not passed
    Given the ADW checkout holds no top-level state file for adwId "throwaway960-replay"
    And a throwaway feature whose only scenario runs outside the @regression hooks, with the steps:
      """
      When the "sdlc" orchestrator is invoked with adwId "throwaway960-replay" and issue 960
      Then the state file for adwId "throwaway960-replay" records workflowStage "paused_auth"
      And the orchestrator subprocess exited 0
      """
    When the throwaway feature is run through Cucumber
    Then the throwaway scenario is reported pending

  # ── §2 T5 COMPARES THE RECORDED EXIT CODE ───────────────────────────────────────────────────

  @adw-960 @adw-f2mx98-bug-regression-then
  Scenario Outline: A throwaway feature whose only step is "Then the orchestrator subprocess exited 0" fails <where> the @regression hooks, because no subprocess step ran
    Given a throwaway feature whose only scenario runs <where> the @regression hooks, with the steps:
      """
      Then the orchestrator subprocess exited 0
      """
    When the throwaway feature is run through Cucumber
    Then the throwaway scenario fails

    Examples:
      | where   |
      | outside |
      | inside  |

  @adw-960 @adw-f2mx98-bug-regression-then
  Scenario Outline: T5 passes <where> the @regression hooks when a subprocess step recorded the exit code it expects, <code>
    Given a throwaway feature whose only scenario runs <where> the @regression hooks, with the steps:
      """
      Given a stand-in subprocess step has recorded exit code <code>
      Then the orchestrator subprocess exited <code>
      """
    When the throwaway feature is run through Cucumber
    Then the throwaway scenario passes

    Examples:
      | where   | code |
      | outside | 0    |
      | inside  | 0    |
      | outside | 1    |

  @adw-960 @adw-f2mx98-bug-regression-then
  Scenario Outline: T5 "exited 0" fails <where> the @regression hooks when the subprocess step recorded exit code 3
    Given a throwaway feature whose only scenario runs <where> the @regression hooks, with the steps:
      """
      Given a stand-in subprocess step has recorded exit code 3
      Then the orchestrator subprocess exited 0
      """
    When the throwaway feature is run through Cucumber
    Then the throwaway scenario fails

    Examples:
      | where   |
      | outside |
      | inside  |

  # ── §3 T1 WITH NO STATE FILE ────────────────────────────────────────────────────────────────

  @adw-960 @adw-f2mx98-bug-regression-then
  Scenario Outline: A throwaway feature asserting T1 "<stage>" for an adwId with no state file fails <where> the @regression hooks, and the failure names the path it tried
    Given the ADW checkout holds no top-level state file for adwId "throwaway960-none"
    And a throwaway feature whose only scenario runs <where> the @regression hooks, with the steps:
      """
      Then the state file for adwId "throwaway960-none" records workflowStage "<stage>"
      """
    When the throwaway feature is run through Cucumber
    Then the throwaway scenario fails
    And the failure message names the state file path "agents/throwaway960-none/state.json"

    Examples:
      | where   | stage       |
      | outside | paused_auth |
      | outside | paused      |
      | inside  | paused_auth |

  @adw-960 @adw-f2mx98-bug-regression-then @adw-963
  Scenario: T1 for an adwId whose registered worktree holds no state file either fails, and the failure names both paths it tried
    Given the ADW checkout holds no top-level state file for adwId "throwaway960-bare"
    And a throwaway feature whose only scenario runs outside the @regression hooks, with the steps:
      """
      Given the worktree for adwId "throwaway960-bare" is initialised at branch "throwaway960-bare"
      Then the state file for adwId "throwaway960-bare" records workflowStage "paused_auth"
      """
    When the throwaway feature is run through Cucumber
    Then the throwaway scenario fails
    And the failure message names the state file path "agents/throwaway960-bare/state.json"
    And the failure message names the state file path inside the worktree registered for adwId "throwaway960-bare"

  # ── §4 T1 ON A RECORDED STATE ───────────────────────────────────────────────────────────────

  @adw-960 @adw-f2mx98-bug-regression-then
  Scenario Outline: T1 passes <where> the @regression hooks on the workflowStage the top-level state file records
    Given the ADW checkout holds a top-level state file for adwId "throwaway960-top" recording workflowStage "awaiting_merge"
    And a throwaway feature whose only scenario runs <where> the @regression hooks, with the steps:
      """
      Then the state file for adwId "throwaway960-top" records workflowStage "awaiting_merge"
      """
    When the throwaway feature is run through Cucumber
    Then the throwaway scenario passes

    Examples:
      | where   |
      | outside |
      | inside  |

  @adw-960 @adw-f2mx98-bug-regression-then
  Scenario Outline: T1 fails <where> the @regression hooks when the top-level state file records a different workflowStage, and the failure reports the stage it found
    Given the ADW checkout holds a top-level state file for adwId "throwaway960-other" recording workflowStage "build_completed"
    And a throwaway feature whose only scenario runs <where> the @regression hooks, with the steps:
      """
      Then the state file for adwId "throwaway960-other" records workflowStage "paused_auth"
      """
    When the throwaway feature is run through Cucumber
    Then the throwaway scenario fails
    And the failure message reports the recorded workflowStage "build_completed"

    Examples:
      | where   |
      | outside |
      | inside  |

  @adw-960 @adw-f2mx98-bug-regression-then
  Scenario Outline: With no top-level state file, T1 falls back to the state G6 wrote into the worktree it registered — asserting "<asserted>" against a recorded "review_failed" <verdict>
    Given the ADW checkout holds no top-level state file for adwId "throwaway960-wt"
    And a throwaway feature whose only scenario runs outside the @regression hooks, with the steps:
      """
      Given a state file exists for adwId "throwaway960-wt" at stage "review_failed"
      Then the state file for adwId "throwaway960-wt" records workflowStage "<asserted>"
      """
    When the throwaway feature is run through Cucumber
    Then the throwaway scenario <verdict>

    Examples:
      | asserted      | verdict |
      | review_failed | passes  |
      | paused_auth   | fails   |

  @adw-960 @adw-f2mx98-bug-regression-then
  Scenario Outline: When the top-level state file and the worktree state G6 wrote both exist, T1 trusts the top-level file — asserting "<asserted>" <verdict>
    Given the ADW checkout holds a top-level state file for adwId "throwaway960-both" recording workflowStage "awaiting_merge"
    And a throwaway feature whose only scenario runs outside the @regression hooks, with the steps:
      """
      Given a state file exists for adwId "throwaway960-both" at stage "paused"
      Then the state file for adwId "throwaway960-both" records workflowStage "<asserted>"
      """
    When the throwaway feature is run through Cucumber
    Then the throwaway scenario <verdict>

    Examples:
      | asserted       | verdict |
      | awaiting_merge | passes  |
      | paused         | fails   |

  # ── §5 W1 AND W10 NEVER PASS BY DOING NOTHING ───────────────────────────────────────────────

  @adw-960 @adw-f2mx98-bug-regression-then
  Scenario Outline: As the only step of a scenario <where> the @regression hooks, <phrase> is reported pending, never passed
    Given a throwaway feature whose only scenario runs <where> the @regression hooks, with the steps:
      """
      <step>
      """
    When the throwaway feature is run through Cucumber
    Then the throwaway scenario is reported pending

    Examples:
      | where   | phrase | step                                                                               |
      | outside | W1     | When the "sdlc" orchestrator is invoked with adwId "throwaway960-w1" and issue 960 |
      | inside  | W1     | When the "sdlc" orchestrator is invoked with adwId "throwaway960-w1" and issue 960 |
      | outside | W10    | When the cron probe runs once                                                      |
      | inside  | W10    | When the cron probe runs once                                                      |

  # ── §6 PENDING STAYS PENDING ────────────────────────────────────────────────────────────────

  @adw-960 @adw-f2mx98-bug-regression-then @adw-963 @adw-964
  Scenario: The regression suite's smoke and surface scenarios are all still reported pending, except the surface rows that run in-process, which pass
    When the regression suite's smoke and surface scenarios are run through Cucumber
    Then every smoke and surface scenario is reported pending, except these surface rows, which pass:
      | row                                                        |
      | row-02-adwPlan-planPhase-happy.feature                     |
      | row-03-adwPlan-planPhase-error-stub-failure.feature        |
      | row-04-adwBuild-buildPhase-happy.feature                   |
      | row-05-adwBuild-buildPhase-edge-missing-lock.feature       |
      | row-06-adwBuild-unitTestPhase-happy.feature                |
      | row-07-adwReview-reviewPhase-happy.feature                 |
      | row-08-adwReview-reviewPhase-error-review-rejected.feature |
      | row-09-adwReview-diffEvaluationPhase-happy.feature         |
      | row-15-adwChore-reviewPhase-happy.feature                  |
      | row-20-adwTest-unitTestPhase-happy.feature                 |
      | row-21-adwTest-scenarioTestPhase-happy.feature             |
      | row-22-adwTest-scenarioProof-happy.feature                 |
      | row-23-adwTest-scenarioFixPhase-error.feature              |
      | row-31-adwPlan-orchestratorLock-acquired-happy.feature     |
      | row-32-adwBuild-orchestratorLock-re-entry-edge.feature     |
      | row-33-adwReview-planValidationPhase-happy.feature         |
      | row-34-adwReview-alignmentPhase-happy.feature              |

  # ── §7 BACKSTOP ─────────────────────────────────────────────────────────────────────────────

  @adw-960 @adw-f2mx98-bug-regression-then
  Scenario: TypeScript type-check passes with T1 and T5 reading only runtime artefacts
    Then the ADW TypeScript type-check passes
