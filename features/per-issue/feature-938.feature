@adw-938 @adw-znc6m9-bug-guardrails-are-m
Feature: Every agent ADW starts for a target repository gets ADW's guardrail settings — the .github/adw.yml reader and template no longer know the guardrails key, and a key left in a repository's file changes nothing and costs one log line at most

  Issue #938 resolves the `## Divergence` section of ADR-0050
  (`specs/adr/0050-target-repo-guardrails.md`), item 1. That section is the specification.

  Today. An agent ADW starts for a target repository gets the guardrail settings only when the
  repository's `.github/adw.yml` holds `guardrails: true`. The guardrail settings are a
  `--settings` argument carrying ADW's deny list and its five hooks, plus a
  `CLAUDE_HOOKS_LOG_DIR` that sends the hooks' logs to the run's own directory under ADW's agent
  state. `resolveGuardrailsDecision` (`adws/core/guardrailsGate.ts`) checks, in order: the
  operator's kill switch `ADW_TARGET_GUARDRAILS=off`, a self-host run, the `guardrails` key, and
  the startup probe's verdict. The configuration reader (`adws/core/adwYmlConfig.ts`) defaults
  the key to `false` and logs a warning each time it parses a value it does not understand. The
  gate reads the file again for every agent it starts. #762 called the key temporary rollout
  scaffolding. On 2026-10-01 `paysdoc/devplatform` had `guardrails: true`; `paysdoc/depaudit` and
  ADW itself had no such key, and a target repository without the file got no injection at all.

  Ruling (owner, 2026-10-01): guardrails are mandatory for every target repository.

  What #938 changes. Every agent ADW starts for a target repository gets the guardrail settings,
  whether or not the repository has a `.github/adw.yml` and whatever the file says. The
  configuration reader and the `.github/adw.yml` template ADW writes no longer know the key. A
  `guardrails` key left in a repository's file changes nothing, and ADW logs at most one line
  about it.

  What stays. The kill switch, the self-host exclusion and the probe that fails open are not the
  key, and ADR-0050's decision drivers rest on them: a wrong deny rule must not be able to block
  the queue. ADW never rewrites a repository's existing `.github/adw.yml` (#931), so a leftover
  key stays in the file and is ignored there.

  The labels below are the section numbers used for the scenario groups further down (§1–§5):

    §1  EVERY TARGET REPOSITORY GETS THE GUARDRAIL SETTINGS (AC1). An agent started for a target
        repository that has no `.github/adw.yml` gets the guardrail settings, and its hook logs
        go to the run's own directory, outside the worktree. So does an agent started for a
        repository whose file holds no `guardrails` key, the commented-out key ADW's earlier
        template wrote, or a leftover key with any value.

    §2  A LEFTOVER KEY IS IGNORED WITHOUT A WARNING STORM. One run reads the configuration as a
        workflow does when it starts, then starts three agents. Every agent gets the guardrail
        settings, and ADW logs at most one line about the key.

    §3  THE READER AND THE TEMPLATE NO LONGER KNOW THE KEY (AC2). The configuration ADW reads
        carries no guardrails setting, with the file absent or holding a leftover key, and the
        keys ADW still reads from the same file still apply. The `.github/adw.yml` ADW writes into
        a target repository that has none offers no `guardrails` key, set or commented out.

    §4  WHAT STAYS. The kill switch and a self-host run still start agents without the guardrail
        settings and never run the probe. A failed probe still fails open: the agent starts
        without the settings and ADW sends one alert. With the key gone, the probe now guards a
        target repository that has no `.github/adw.yml` as well.

    §5  BACKSTOP. The type-check. Once the configuration has no guardrails setting, any code
        that still reads one, and any test or step definition that still builds one, fails it.

  Each row is written to fail for a specific wrong implementation:
    • every §1 row is RED today except the leftover `guardrails: true` row, because the gate
      withholds the settings unless the key reads `true`. That row fails for a fix that withholds
      the settings, or refuses the run, when a file still holds a key ADW no longer knows;
    • the absent-file row fails for a fix that injects only when the file exists;
    • the commented-out row is the file ADW's own template wrote into a target repository;
    • the `guardrails: false` row fails for a fix that only flips the key's default to `true` and
      still honours an explicit opt-out;
    • the `guardrails: maybe` row fails for a fix that keeps the reader's malformed-value
      fallback, which fails safe toward no guardrails;
    • every §1 row checks where the hook logs go. It fails for a fix that passes `--settings`
      without `CLAUDE_HOOKS_LOG_DIR`: the hooks then log to `logs/`, relative to the target
      worktree;
    • §2's `maybe` row is RED today: the reader warns each time it parses the value and the gate
      reads the file for every agent, so the run logs four warnings. Its `false` row is RED today
      because no agent gets the settings. All three rows fail for a fix that logs a notice about
      the retired key from the gate for every agent, or from a reader the gate still calls for
      every agent;
    • §3's reader rows are RED today: the reader returns a `guardrails` value from every read. The
      other-keys assertions are GREEN today. They fail for a fix that treats a file holding a key
      it does not know as malformed and falls back to the defaults, dropping the owner's
      `unitTests: false` and `hitl: true`;
    • §3's template row is RED today: the template ends with `# guardrails: false` under a
      "Guardrails canary" comment. It fails for a fix that rewords the comment and leaves the key
      line;
    • §4's kill-switch and self-host rows are GREEN today and must stay green. They fail for a fix
      that makes guardrails mandatory by injecting on every spawn, removing the gate instead of
      the key. The kill switch is the operator's way out when a deny rule is wrong. A self-host
      run keeps ADW's own settings, and injecting there would fire every hook twice;
    • §4's probe row is RED today: for a repository with no `.github/adw.yml` the gate stops at
      the key and never runs the probe. It fails for a fix that fails closed, refusing to start
      the agent when the probe fails.

  ── WHY SOME CRITERIA GET NO SCENARIO OF THEIR OWN ──────────────────────────────────────────
  AC3 (unit tests cover injection with the file absent and with a leftover key) is an obligation
  on the vitest suite, which the build and test phases discharge. §1 and §2 are its behavioural
  counterparts. AC4 (the Divergence section of ADR-0050 removed in the same pull request) and
  removing the key from the documents (`README.md`, `app_docs/feature-9gjajh-claude-agents-core.md`)
  are documentation changes. A scenario could only grep them, which the rot rules forbid, so the
  review of the pull request checks them. `/adw_init` writes the same template through a heredoc
  in `.claude/commands/adw_init.md`. That prompt runs only inside a real Claude session, which this
  harness never starts. `adws/__tests__/adwInitPrompt.test.ts` keeps the heredoc byte-identical to
  `ADW_YML_TEMPLATE`, so §3's template row covers its content.

  Not pinned here, and left to the plan:
    • whether ADW logs the one permitted line about a leftover key or none at all, where it is
      logged from, and its wording;
    • whether the gate keeps any dependency on the configuration reader.

  How these scenarios observe the system. Every assertion targets a runtime artefact:
    • the argv and the environment of each Claude CLI process ADW starts, recorded by a stand-in
      executable at the CLI boundary;
    • the calls the stubbed guardrails probe and the stubbed alert sender received;
    • the lines ADW logs while the scenario's When steps run;
    • the configuration the reader returns;
    • the `.github/adw.yml` ADW writes into a throwaway worktree;
    • the type-check's exit code.
  No scenario reads, greps or parses a source file. The worktrees and the `.github/adw.yml` files
  they hold are fixtures the steps write.

  Notes for the step definitions:
    • NEVER START THE REAL CLAUDE CLI, NEVER RUN THE REAL GUARDRAILS PROBE (it makes paid model
      calls), NEVER POST TO SLACK.
    • THE STAND-IN CLI. "the Claude CLI is a stand-in that records how ADW started it" points
      `CLAUDE_CODE_PATH` at a throwaway executable. Each run appends one record, its argv and its
      full environment, to a file whose absolute path is baked into the script; the path cannot
      travel in a `MOCK_*` variable, which `getSafeSubprocessEnv()` drops. The stand-in answers
      with clean stream-json (a system/init line, an assistant text line and a successful result)
      and exits 0. Feature-928's harness (`feature-928-harness.ts`) builds such a stand-in. Its
      helpers may be imported, but its hooks are scoped to `@adw-928` and its phrases must not be
      reused. Call `clearClaudeCodePathCache()` after setting `CLAUDE_CODE_PATH` and after
      restoring it.
    • THE PROBE AND THE ALERT. "the guardrails startup probe passes" and "… fails" install an
      override through `setGuardrailsGateDepsForTesting`. The override spreads
      `productionGuardrailsGateDeps` and replaces only the probe, which answers `{ ok: true }` or
      `{ ok: false, detail: … }` and counts its calls, and the alert sender, which records each
      alert. Never replace how the gate reads the environment or a repository's files: these
      scenarios exist to exercise them. Spreading the production deps keeps the steps valid
      whatever deps the build leaves on the gate. "was run" and "was not run" read the probe's
      call count. "ADW sent one alert that the guardrails startup probe failed" requires exactly
      one recorded alert.
    • THE WORKTREE is a throwaway directory; neither the gate nor the reader runs git. "a worktree
      that has no {string}" asserts the path is absent. "a worktree whose {string} holds:" writes
      the doc string to that path.
    • STARTING AGENTS. "ADW starts an agent in that worktree for a run against a target
      repository" calls the real `runClaudeAgentWithCommand` for a routed command (for example
      `/commit`, with the model and effort `getModelForCommand` and `getEffortForCommand` give
      it). It passes the worktree as `cwd`, a throwaway output file, and the launch context the
      phases pass for a target repository (`selfHost: !repoContext`): `{ selfHost: false, adwId }`.
      "… for a run on ADW's own repository" passes `selfHost: true`. "ADW starts {int} agents …"
      does it N times in sequence under the same adwId. Each scenario uses an adwId of its own.
    • THE GUARDRAIL SETTINGS. "was started with the guardrail settings ADW builds for target
      repositories": the recorded argv carries `--settings` followed by a JSON document
      deep-equal to `buildGuardrailsSettings({ frameworkRepoRoot: REPO_ROOT })`, computed at step
      time. Its deny list must not be empty, and it must register a hook command for each of
      PreToolUse, PostToolUse, Notification, Stop and SubagentStop. "the agent" requires exactly
      one record; "each of the {int} agents" requires exactly N records and checks each one.
      "the agent's hook logs go to the run's own hook-log directory, outside the worktree": the
      record's `CLAUDE_HOOKS_LOG_DIR` is absolute, equals `resolveHookLogDir(adwId)`, and is not
      inside the worktree. "was started without guardrail settings": exactly one record, with no
      `--settings` in its argv and no `CLAUDE_HOOKS_LOG_DIR` in its environment. A start that
      throws before the CLI runs fails this step.
    • THE LOG. From the scenario's first When step on, capture every line written through
      `console.log`, `console.warn` and `console.error`, still passing it through; ADW's `log()`
      writes with `console.log`. "ADW logged at most one line about the {string} key in {string}"
      counts the captured lines that contain both the key and the file's base name (`adw.yml`),
      case-insensitively. The reader's own lines start `adw.yml:`. A per-spawn line that mentions
      guardrails but not the file is not about the key.
    • THE CONFIGURATION. "ADW reads that worktree's configuration as a workflow does when it
      starts" calls the real `readAdwYmlConfig(worktree)`, as `initializeWorkflow` does, and keeps
      the result. "carries no guardrails setting": the result has no property whose name contains
      "guardrails", case-insensitively. "has the unit-test gate disabled": `unitTests` is `false`.
      "has human review of framework-upgrade pull requests switched on": `hitl` is `true`.
    • THE TEMPLATE. "ADW writes its starting {string} into that worktree" calls the real
      `writeAdwYmlTemplateIfAbsent(worktree)`, the write the framework upgrade makes when a target
      repository has no file, and requires it to report that it created the file at that path.
      "the {string} ADW wrote offers no {string} key, set or commented out": no line of the
      written file matches `^\s*#?\s*guardrails\s*:`, case-insensitively. Prose that mentions
      guardrails is allowed.
    • THE KILL SWITCH. The Background step saves `ADW_TARGET_GUARDRAILS` and deletes it from
      `process.env`, so a host that sets the kill switch cannot change what the scenarios see.
      "… by setting {string} to {string}" sets it. The gate reads `process.env` when it decides.
    • HOOKS. Scope every hook to `@adw-938`. `After`: clear the guardrails override
      (`setGuardrailsGateDepsForTesting(null)`), restore `CLAUDE_CODE_PATH` and every environment
      variable a step touched, clear the CLI path cache, restore the console methods, and remove
      the throwaway directories.
    • REUSED, NOT REDEFINED. G18 is defined in `features/step_definitions/`, and T22 in the
      regression suite's `thenSteps.ts`. Redefining either is an AmbiguousStepDefinition.
    • OTHER STEP DEFINITIONS THE BUILD TOUCHES. `feature-820.steps.ts`, `feature-929-workflow.ts`,
      `feature-929.steps.ts`, `feature-930-plan-fixture.ts`, `feature-933-workflow.ts` and
      `feature-937-workflow.ts` build `{ hitl, unitTests, guardrails }` literals, and
      `feature-928-harness.ts` passes `readAdwYml` to `setGuardrailsGateDepsForTesting`. If the
      build removes the setting from the configuration, or the reader from the gate's deps, those
      files adapt, and §5 fails until they do. Their scenarios' behaviour does not change, so they
      are not re-tagged.

  Vocabulary note. These registered phrases from `features/regression/vocabulary.md` are reused:
    • G18 `the ADW codebase is checked out`
    • T22 `the ADW TypeScript type-check passes`
  These registered phrases are deliberately NOT reused:
    • G3 and G9 load a manifest or a payload into the shared Claude CLI stub. That stub records
      only the prompt, through a `MOCK_*` variable the launch allowlist drops, so it cannot show
      a process's `--settings` argument or its environment.
  No unregistered phrase from another per-issue feature is reused. The registry has no phrase for
  the following, so novel phrasing is introduced for them: the throwaway worktree and its
  `.github/adw.yml`; the recording stand-in CLI; the guardrails probe and its alert; the
  operator's kill switch; starting agents for a target-repository run or a self-host run; the
  guardrail settings and hook-log directory a process received; the log lines about the key; the
  configuration the reader returns; and the template ADW writes.

  Background:
    Given the ADW codebase is checked out
    And the operator has not switched off ADW's guardrails for target repositories

  # ── §1 EVERY TARGET REPOSITORY GETS THE GUARDRAIL SETTINGS ─────────────────────────────────────

  @adw-938 @adw-znc6m9-bug-guardrails-are-m
  Scenario: An agent started for a target repository that has no .github/adw.yml gets ADW's guardrail settings, and its hook logs go to the run's own directory outside the worktree
    Given a worktree that has no ".github/adw.yml"
    And the Claude CLI is a stand-in that records how ADW started it
    And the guardrails startup probe passes
    When ADW starts an agent in that worktree for a run against a target repository
    Then the agent was started with the guardrail settings ADW builds for target repositories
    And the agent's hook logs go to the run's own hook-log directory, outside the worktree

  @adw-938 @adw-znc6m9-bug-guardrails-are-m
  Scenario Outline: An agent started for a target repository whose .github/adw.yml holds <file holds> gets ADW's guardrail settings
    Given a worktree whose ".github/adw.yml" holds:
      """
      unitTests: true
      <guardrails line>
      """
    And the Claude CLI is a stand-in that records how ADW started it
    And the guardrails startup probe passes
    When ADW starts an agent in that worktree for a run against a target repository
    Then the agent was started with the guardrail settings ADW builds for target repositories
    And the agent's hook logs go to the run's own hook-log directory, outside the worktree

    Examples:
      | file holds                                         | guardrails line     |
      | no guardrails key                                  |                     |
      | the commented-out key ADW's earlier template wrote | # guardrails: false |
      | a leftover opt-in                                  | guardrails: true    |
      | a leftover opt-out                                 | guardrails: false   |
      | a leftover value ADW never understood              | guardrails: maybe   |

  # ── §2 A LEFTOVER KEY IS IGNORED WITHOUT A WARNING STORM ───────────────────────────────────────

  @adw-938 @adw-znc6m9-bug-guardrails-are-m
  Scenario Outline: Over a run that reads the configuration and starts three agents, a leftover "<guardrails line>" changes nothing and ADW logs at most one line about it
    Given a worktree whose ".github/adw.yml" holds:
      """
      <guardrails line>
      unitTests: true
      """
    And the Claude CLI is a stand-in that records how ADW started it
    And the guardrails startup probe passes
    When ADW reads that worktree's configuration as a workflow does when it starts
    And ADW starts 3 agents in that worktree for a run against a target repository
    Then each of the 3 agents was started with the guardrail settings ADW builds for target repositories
    And ADW logged at most one line about the "guardrails" key in ".github/adw.yml"

    Examples:
      | guardrails line   |
      | guardrails: true  |
      | guardrails: false |
      | guardrails: maybe |

  # ── §3 THE READER AND THE TEMPLATE NO LONGER KNOW THE KEY ──────────────────────────────────────

  @adw-938 @adw-znc6m9-bug-guardrails-are-m
  Scenario: The configuration ADW reads for a target repository that has no .github/adw.yml carries no guardrails setting
    Given a worktree that has no ".github/adw.yml"
    When ADW reads that worktree's configuration as a workflow does when it starts
    Then the configuration ADW read carries no guardrails setting

  @adw-938 @adw-znc6m9-bug-guardrails-are-m
  Scenario Outline: The configuration ADW reads from a .github/adw.yml that still holds "<guardrails line>" carries no guardrails setting, and the file's other keys still apply
    Given a worktree whose ".github/adw.yml" holds:
      """
      <guardrails line>
      unitTests: false
      hitl: true
      """
    When ADW reads that worktree's configuration as a workflow does when it starts
    Then the configuration ADW read carries no guardrails setting
    And the configuration ADW read has the unit-test gate disabled
    And the configuration ADW read has human review of framework-upgrade pull requests switched on

    Examples:
      | guardrails line   |
      | guardrails: true  |
      | guardrails: false |
      | guardrails: maybe |

  @adw-938 @adw-znc6m9-bug-guardrails-are-m
  Scenario: The .github/adw.yml ADW writes into a target repository that has none offers no guardrails key, set or commented out
    Given a worktree that has no ".github/adw.yml"
    When ADW writes its starting ".github/adw.yml" into that worktree
    Then the ".github/adw.yml" ADW wrote offers no "guardrails" key, set or commented out

  # ── §4 WHAT STAYS ──────────────────────────────────────────────────────────────────────────────

  @adw-938 @adw-znc6m9-bug-guardrails-are-m
  Scenario: Once the operator switches ADW's guardrails off, an agent started for a target repository gets no guardrail settings and the guardrails probe is not run
    Given a worktree that has no ".github/adw.yml"
    And the operator has switched off ADW's guardrails for target repositories by setting "ADW_TARGET_GUARDRAILS" to "off"
    And the Claude CLI is a stand-in that records how ADW started it
    And the guardrails startup probe passes
    When ADW starts an agent in that worktree for a run against a target repository
    Then the agent was started without guardrail settings
    And the guardrails startup probe was not run

  @adw-938 @adw-znc6m9-bug-guardrails-are-m
  Scenario: An agent started for a run on ADW's own repository gets no injected guardrail settings, because ADW's own settings apply there
    Given a worktree that has no ".github/adw.yml"
    And the Claude CLI is a stand-in that records how ADW started it
    And the guardrails startup probe passes
    When ADW starts an agent in that worktree for a run on ADW's own repository
    Then the agent was started without guardrail settings
    And the guardrails startup probe was not run

  @adw-938 @adw-znc6m9-bug-guardrails-are-m
  Scenario: When the guardrails startup probe fails, an agent started for a target repository that has no .github/adw.yml still starts, without guardrail settings, and ADW sends one alert
    Given a worktree that has no ".github/adw.yml"
    And the Claude CLI is a stand-in that records how ADW started it
    And the guardrails startup probe fails
    When ADW starts an agent in that worktree for a run against a target repository
    Then the guardrails startup probe was run
    And the agent was started without guardrail settings
    And ADW sent one alert that the guardrails startup probe failed

  # ── §5 BACKSTOP ────────────────────────────────────────────────────────────────────────────────

  @adw-938 @adw-znc6m9-bug-guardrails-are-m
  Scenario: The ADW TypeScript type-check passes once the configuration ADW reads from .github/adw.yml has no guardrails setting
    Then the ADW TypeScript type-check passes
