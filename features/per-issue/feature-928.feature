@adw-928 @adw-3a0fub-bug-every-claude-pro
Feature: Every agent ADW starts takes its model and effort from the routing tables and runs a slash command, every Claude CLI process ADW starts is stateless and shares one launch environment, and ANTHROPIC_API_KEY is an optional choice that moves billing from the Claude subscription to the API

  Issue #928 resolves the Divergence sections of four decision records in `specs/adr/`: ADR-0010
  items 1 and 2, ADR-0015 item 1, ADR-0052 item 1 and ADR-0057 items 1 and 2. Each item states
  what a check of the code found, and the owner ruled each one a bug.

  What #928 changes:
    • ROUTING (ADR-0010). Three spawns pass a literal model instead of reading the routing
      tables. The upgrade orchestrator runs `/adw_init` with `'sonnet'` and no effort, where the
      tables give `sonnet` and `medium`. The auto-merge handler runs `/resolve_conflict` with
      `'sonnet'`; the command is missing from the `SlashCommand` union and from all four tables.
      The output-validation retry in `runCommandAgent` uses `'haiku'`. All three read the model
      and the effort from the tables, and `/resolve_conflict` joins the union and the four
      tables. In the fast tables `/promote_regression_vocabulary` is routed to Haiku with the
      effort `medium`; its effort becomes undefined, as the tables' own rule for Haiku requires.
    • THE RETRY (ADR-0015). `buildRetryPrompt` assembles the retry's corrective prompt in
      TypeScript. The retry becomes a command file under `.claude/commands/`, invoked like every
      other command: a slash command and its positional arguments.
    • STATELESS (ADR-0052). The rate-limit probe, the schema probe and the guardrails probe start
      `claude` without `CLAUDE_CODE_DISABLE_AUTO_MEMORY`. Every `claude` process ADW starts gets
      one shared launch environment, which sets the variable to "1" after everything else.
    • THE KEY IS OPTIONAL (ADR-0057). The health check stops requiring `ANTHROPIC_API_KEY`. The
      orchestrators' usage text presents the key as optional and says that setting it moves
      billing from the Claude subscription to the API, as do `.env.sample`, both READMEs and
      the orchestrator header comments. ADW keeps forwarding the key when the operator sets it.

  Two consequences of the issue's own wording reach further than its list of call sites:
    • AC1 says no call site outside the routing module names a model literally. The three
      probes pass `--model haiku` in their argument lists, and `runClaudeAgentWithCommand`
      defaults its `model` parameter to `'sonnet'`. Those are literal models outside the routing
      module too, so §1's repository-wide row passes only when they also take their model from
      it. Mentions of model names that start no process are not call sites: the model unions in
      `adws/types/agentTypes.ts`, the pricing table in `adws/cost/providers/anthropic/pricing.ts`
      and the model-name parsing in `adws/core/workflowCommentParsing.ts`.
    • "Every `claude` process ADW starts" includes the health check's `claude --version`, which
      today runs in ADW's whole environment, so §4 drives it beside the three probes. The two
      `claude auth status --json` runs fall under the same sentence; see below.
  ADR-0015 records the rate-limit and schema probes as one-turn probes that do no pipeline work,
  outside the single spawn path. This feature does not ask any probe to run a slash command.

  The labels below are the section numbers used for the scenario groups further down (§1–§6):

    §1  ROUTING (ADR-0010 item 1; AC1). The upgrade orchestrator's `/adw_init` and the auto-merge
        handler's `/resolve_conflict` reach the Claude CLI with the model and the effort the
        tables give their command. `/resolve_conflict` is routed in both modes. A model-literal
        check passes across the repository, and fails on a fixture tree that names a model at a
        call site, in each form the codebase uses today.

    §2  HAIKU TAKES NO EFFORT (ADR-0010 item 2; AC2). Over every routed command, in both modes, a
        command routed to Haiku has no effort. `/promote_regression_vocabulary` in fast mode
        reaches the CLI on Haiku with no `--effort` flag.

    §3  THE RETRY IS A SLASH COMMAND (ADR-0015 item 1; AC3; and the retry's part of ADR-0010
        item 1). An agent whose output fails validation is retried through a slash command and
        its arguments, with no instruction written in code. The retry's command is told what to
        correct, runs on the model and effort the tables give it for the issue at hand, and
        resolves to a command file in a target repository's worktree.

    §4  EVERY CLAUDE PROCESS STARTS STATELESS (ADR-0052 item 1; AC4; and ADR-0057's forwarding).
        Five ways ADW starts the CLI: a pipeline agent, the rate-limit probe, the schema probe,
        the guardrails probe and the health check's version check. Each turns auto-memory off,
        even when ADW's own environment turns it on. Each passes the same launch environment:
        the API key when the operator set it, and nothing outside the launch allowlist.

    §5  THE API KEY IS OPTIONAL (ADR-0057 items 1 and 2; AC5). The health check's environment
        check passes with the key unset or set, and never lists it as required. Each of the
        fourteen orchestrators that print the shared usage text presents the key as optional
        and states its billing effect.

    §6  BACKSTOP. `bun run test` is the type-check. Every table is a `Record<SlashCommand, …>`,
        so `/resolve_conflict` or the retry's command missing from the union or from any of the
        four tables fails it.

  Each row is written to fail for a specific wrong implementation:
    • the `/adw_init` row fails for today's literal: the CLI gets `--model sonnet` and no
      `--effort`, where the default tables give `medium`;
    • the `/resolve_conflict` rows fail while the tables give the command no model. A literal
      left in place after the entries are added fails the spawn row wherever the tables give
      something else, and fails the model-literal check in every case;
    • the fast row of the Haiku table check fails for `/promote_regression_vocabulary` as it
      stands. The spawn row for that command fails while the CLI still gets `--effort medium`,
      and for a "fix" that moves the command off Haiku instead of dropping its effort;
    • the retry rows fail for today's retry, whose prompt starts "You were invoked with" and is
      no slash command at all. The instruction row fails for a retry that hands the old
      corrective text to a slash command as an argument. The hand-over row fails for a retry
      command that is not told what to correct. The routing rows fail for a model named in code
      wherever the tables give the retry's command something else, and for a retry that
      ignores the issue's fast mode. The worktree row fails for a retry command kept where
      ADW's worktree setup does not copy it into target worktrees;
    • the memory rows fail for the three probes and the version check as they stand: the
      rate-limit probe, the guardrails probe and the version check pass on the "0" from ADW's
      own environment, and the schema probe sets nothing. They also fail for a launcher that
      fills the variable in only when it is missing;
    • the shared-environment rows fail for a launcher that copies ADW's whole environment, as
      the rate-limit probe, the guardrails probe and the version check do today, passing on
      every variable instead of the allowlisted ones. They also fail for a launcher that drops
      the API key;
    • the health-check rows fail for today's check, which fails when the key is unset and lists
      it as required when it is set;
    • the usage rows fail for today's text, "ANTHROPIC_API_KEY  - Anthropic API key" under
      "Environment Requirements", which neither marks the key optional nor mentions billing;
    • the model-literal rows fail while there is no check. The `scripts/` row fails a check that
      scans only `adws/`, which the guardrails probe would escape. The `--model` rows fail a
      check that reads only the spawn function's arguments, and the default-parameter row fails
      one that ignores parameter defaults. The repository-wide row fails while a probe or the
      spawn function's default still names a model.

  ── WHY SOME CRITERIA GET NO SCENARIO OF THEIR OWN ──────────────────────────────────────────
  AC2's and AC4's unit tests, and AC1's unit test if the build chooses one over a lint rule, are
  obligations on the vitest suite, which the build and test phases discharge. §2, §4 and §1's
  model-literal rows are their behavioural counterparts here. AC6 (the four Divergence sections
  removed in the same pull request) and the document edits of ADR-0057 item 2 (`.env.sample`,
  `README.md`, `adws/README.md` and each orchestrator's header comment) change files, not
  behaviour. A scenario could only grep them, which the rot rules forbid, so review owns them.
  The usage text is the one place where the running system tells the operator what the key
  does, and §5 asserts it. `adwPrReview.tsx` prints a usage text of its own that names no
  environment variable, so §5 has no row for it; its header comment is among the documents
  review owns. The two `claude auth status --json` runs, in the cron's auth-gate tick
  (`adws/triggers/trigger_cron.ts`) and in the agent spawn's re-check after an expired token
  (`adws/agents/claudeAgent.ts`), copy ADW's whole environment today. The issue's "every
  `claude` process" covers them. No scenario drives them: reaching them needs an auth gate on
  disk, or an expired-token reply followed by a status answer, which this harness does not
  stage. The vitest suite is where they are asserted. The values `/resolve_conflict` and the
  retry's command get in the tables are the build's choice (ADR-0010: the values are tuning),
  so no row pins them; every row reads them back from the tables at run time.

  The per-issue scenarios that drive the rate-limit probe (feature-902, feature-907,
  feature-909) inject an exec seam that bypasses the spawn and its environment. Their behaviour
  does not change, so they are not re-tagged. If the build widens that seam to carry the launch
  environment, their step definitions adapt.

  How these scenarios observe the system. Every assertion targets a runtime artefact:
    • the argv, environment and working directory of each Claude CLI process ADW starts, and the
      content of the files its arguments name, recorded by a stand-in executable at the CLI
      boundary;
    • the model and effort the routing module returns at run time;
    • the result the command agent returns;
    • the target worktree that ADW's worktree setup produces;
    • the report the health check's environment check returns;
    • the usage text an orchestrator prints;
    • the verdicts of the model-literal check and the type-check.
  No scenario reads, greps or parses a source file. The model-literal check reads source; the
  scenarios read only its verdict, as the git/gh guard scenarios do.

  Notes for the step definitions:

    • NEVER START THE REAL CLAUDE CLI. "the Claude CLI is a recording stand-in" writes a
      throwaway executable (a shebang script, made executable) and points `CLAUDE_CODE_PATH` at
      its absolute path. Call `clearClaudeCodePathCache()` after setting it and after restoring
      it. Each invocation appends one record to a record file whose absolute path is baked into
      the script. The path must not travel in a `MOCK_*` variable, which `getSafeSubprocessEnv()`
      drops, and must not be relative to the working directory, because the schema and
      guardrails probes run in throwaway directories. A record holds:
        – the argv and the full environment the process received;
        – its working directory;
        – its slash command: the first token of the prompt (the last argv entry) when that
          token starts with "/";
        – whether `<cwd>/.claude/commands/<name>.md` exists for that slash command;
        – the content of every argument that names an existing file, read at invocation time.
      It answers with clean stream-json: a system/init line, an assistant text line and a
      successful result carrying the same text, then exits 0. Asked for `--version`, it prints a
      version string and exits 0. "… that answers its first run with output that fails
      validation and every later run with valid output" counts invocations in a file beside the
      record and switches the text. The guardrails probe's own verdict is never asserted; it
      reports a failed deny matrix against the stand-in, and that is fine.
    • READING THE RECORDS. `--model` and `--effort` are read by flag position in argv. "with no
      effort flag" means no `--effort` in argv. "was started for {string}" selects the records
      whose slash command equals the given one and ignores the rest. That also covers a
      guardrails probe run that a target-repo spawn decision may start, though the test-deps
      override in `guardrailsGate.ts` is the cleaner way to keep that decision from probing or
      injecting `--settings`. "was started {int} times" counts every record.
    • ROUTING EXPECTATIONS come from the real routing module at step time, through
      `getModelForCommand(command, body)` and `getEffortForCommand(command, body)`. The body is
      a short issue text; for "asks for {string}" the quoted keyword is appended to it.
        – "with the model and the effort the … routing tables give it": `--model` equals the
          model. An undefined effort means no `--effort` flag; a defined one means `--effort`
          equals it. When the tables give the command no model, fail with a message that says
          so; today that is `/resolve_conflict`.
        – "the routing tables give {string} a model" and "… give the retry's slash command a
          model" assert a defined model. "the retry's slash command" is the slash command of
          the second record.
        – "the routing tables are consulted for every slash command": every slash command is the
          union of the keys of the four exported tables. "no slash command the routing tables
          send to "haiku" is given an effort": for each command and the given body, whenever
          `getModelForCommand` returns "haiku", `getEffortForCommand` returns undefined. Report
          every offender.
    • THE UPGRADE SPAWN drives the production `runInitCommand` that `buildDefaultUpgradeDeps`
      supplies, the one `executeUpgrade` calls, with a throwaway worktree path and log path.
      Fake providers and a fake GitContext suffice. Neither the upgrade nor the auto-merge
      handler has an issue body that could ask for fast mode, so both rows use the default
      tables.
    • THE AUTO-MERGE SPAWN calls `mergeWithConflictResolution` with a fake GitContext whose
      merges of the base branch throw (a conflict), whose fetches, abort, push and sync succeed
      and whose `selfHost` is true, and with a code host whose merge succeeds. Use a throwaway
      worktree and logs directory.
    • THE COMMAND AGENT is the real `runCommandAgent`, with a throwaway logs directory and no
      context preamble. "with output validation" supplies an `extractOutput` that accepts the
      stand-in's valid text (for example `[12]`) and rejects its invalid text with one fixed
      error string, and an `outputSchema` (for example an array-of-integers JSON schema). "the
      command agent returns the output the retry produced" compares the result's `parsed` with
      what the validator extracts from the valid text. "a command agent runs {string}", without
      output validation, passes no `extractOutput`, so no retry runs.
    • THE RETRY is the second record.
        – "a slash command followed only by its arguments": the prompt is `/<name>` followed by
          zero or more arguments quoted the way `runClaudeAgentWithCommand` quotes them (single
          quotes, embedded quotes escaped), and nothing else.
        – "none of the corrective instructions the retry used to write in code": no argv entry
          contains "You were invoked with", "You returned the following output", "failed
          validation against the expected JSON schema" or "Return ONLY valid JSON".
        – "handed its command the validation error, the expected output schema and the output
          that failed validation, each inline or in a file it names": each of the three is in
          some argument, or in the recorded content of a file an argument names. The error and
          the failed output match as substrings. The schema matches when a JSON document there
          equals it, or holds it as a nested value, in any formatting.
    • THE TARGET WORKTREE is a throwaway git repository prepared by the real
      `copyClaudeAssetsToWorktree`. Its tracked-file query needs a GitContext: a real temp
      repository with a minimal GitContext works, as the G24 and G25 Givens of the regression
      vocabulary do. The command agent runs with that worktree as its `cwd`. "the retry started
      the Claude CLI in that worktree" reads the retry's recorded working directory; "found a
      command file for the retry's slash command in the directory it ran in" reads its
      command-file flag.
    • THE LAUNCHERS of "ADW starts the Claude CLI through the {string}":
        – "pipeline agent spawn": `runClaudeAgentWithCommand` for a routed command, with the
          model and effort the tables give it and a throwaway output file;
        – "rate-limit probe": `probeRateLimit()` with its default exec. Not feature-902's
          injected exec seam, which bypasses the spawn and its environment;
        – "schema probe": `checkClaudeJsonlSchema()` over a throwaway copy of
          `adws/jsonl/schema.json`. Never write the committed schema, and never run the
          module's CLI entry in process, because it calls `process.exit`;
        – "guardrails probe": `runGuardrailsProbe()`, the unmemoized production seam that runs
          `scripts/guardrails-probe.ts` as a subprocess. It starts the CLI four times;
        – "health check's Claude CLI check": `checkClaudeCodeCLI()`.
      "ADW's own environment" is the test process's `process.env`, which the guardrails probe's
      subprocess inherits. Save every variable a Given touches and restore it in `After`.
      "every Claude CLI process ADW started had {string} set to {string}" fails when no process
      was recorded. "no Claude CLI process ADW started had {string} set" requires the variable
      to be absent from every record's environment. `ADW_TEST_UNLISTED_928` stands for any
      variable outside the launch allowlist; nothing reads it.
    • THE HEALTH CHECK is `checkEnvironmentVariables()`, called in process. "passes": `success`
      is true. "does not report {string} missing": the name is in neither the missing list nor
      the error. "does not list {string} among the required variables": the name is not in the
      list the check reports as required, whatever the build calls that list.
    • THE USAGE TEXT. "the {string} orchestrator is asked for its usage" runs
      `bunx tsx adws/<orchestrator> --help` from the repository root with `NODE_OPTIONS`
      cleared, and captures stdout and stderr. The exit code is not asserted; it is 1 today.
      The key's entry is the line naming it plus any continuation lines indented under it.
      "presents {string} as optional": the entry matches /optional/i. "says that setting
      {string} moves billing from the Claude subscription to the API": the entry matches
      /subscription/i, /\bAPI\b/ and /bill/i.
    • THE MODEL-LITERAL CHECK is whichever gate the build adds for AC1: a lint rule, a guard
      script run like `lint:git-guard`, or a unit test. "run across the repository" runs it
      over the checkout; "reports no violations" is exit 0, with the check's output shown on
      failure. "run over the fixture source tree" runs the same check with the fixture tree as
      its root: a guard script or ESLint with the tree as `cwd` (clear `NODE_OPTIONS`, as
      feature-816's runner for the git/gh guard does), or a unit test whose scan root can be
      pointed at the tree. If the gate has no such seam, add one. "fails naming {string}" is a
      non-zero exit whose output contains the path. The fixture tree is a throwaway directory
      holding only the named file, written in the given form:
        – "as an argument to the agent spawn function":
          `runClaudeAgentWithCommand('/commit', [], 'fixture', outputFile, '<model>')`;
        – "after a --model flag in a Claude CLI argument list":
          `['--print', '--model', '<model>', 'ping']`;
        – "as the default of a spawn function's model parameter":
          `function spawnFixture(model: string = '<model>') { … }`.
    • HOOKS. Scope every hook to `@adw-928`. `After`: restore `CLAUDE_CODE_PATH` and clear the
      path cache, restore every environment variable a Given touched, remove the throwaway
      directories, and clear any guardrails test-deps override.
    • REUSED, NOT REDEFINED. "the ADW codebase is checked out" is defined in
      `features/step_definitions/ensureCronOnEveryEventSteps.ts`, and "the ADW TypeScript
      type-check passes" in the regression suite's `thenSteps.ts`. Redefining either is an
      AmbiguousStepDefinition. Do not reuse "the rate-limit probe runs" or "the schema probe
      runs" from feature-902 and feature-909: they drive other seams.

  Vocabulary note. These registered phrases from `features/regression/vocabulary.md` are reused:
    • G18 `the ADW codebase is checked out`
    • T22 `the ADW TypeScript type-check passes`
  These registered phrases are deliberately NOT reused:
    • G3 and G9 load a manifest or a payload into the shared Claude CLI stub. That stub records
      only the prompt, through a `MOCK_*` variable the launch allowlist drops, so it cannot show
      the model, the effort or the environment a process received;
    • W16 and T34 run the git/gh guard, which this issue does not touch. The model-literal check
      is a different gate;
    • W1 and T5 run an orchestrator for an issue and read its exit code. The usage rows run
      `--help` and do not assert the exit code.
  No unregistered phrase from another per-issue feature is reused. The registry has no phrase
  for the following, so novel phrasing is introduced for them: the recording stand-in and its
  records; ADW's own environment; the upgrade, auto-merge and command-agent spawns; the
  launchers; the routing tables and the Haiku check; the retry's prompt, hand-over, routing and
  command file; the target worktree; the health check's environment check; the usage text; and
  the model-literal check and its fixture tree.

  Background:
    Given the ADW codebase is checked out

  # ── §1 ROUTING ─────────────────────────────────────────────────────────────────────────────────

  @adw-928 @adw-3a0fub-bug-every-claude-pro
  Scenario: The upgrade orchestrator starts the Claude CLI for "/adw_init" with the model and the effort the routing tables give it, not with a model named in code
    Given the Claude CLI is a recording stand-in
    When the upgrade orchestrator runs "/adw_init" to regenerate a target repository's ADW configuration
    Then the Claude CLI was started for "/adw_init" with the model and the effort the default routing tables give it

  @adw-928 @adw-3a0fub-bug-every-claude-pro
  Scenario: The auto-merge handler starts the Claude CLI for "/resolve_conflict" with the model and the effort the routing tables give it, not with a model named in code
    Given the Claude CLI is a recording stand-in
    When the auto-merge handler meets a merge conflict and runs "/resolve_conflict"
    Then the Claude CLI was started for "/resolve_conflict" with the model and the effort the default routing tables give it

  @adw-928 @adw-3a0fub-bug-every-claude-pro
  Scenario Outline: "/resolve_conflict" is a routed command — the routing tables give it a model whether or not the issue asks for fast mode
    When the routing tables are consulted for "/resolve_conflict" for an issue whose body <body>
    Then the routing tables give "/resolve_conflict" a model

    Examples:
      | tables  | body                       |
      | default | does not ask for fast mode |
      | fast    | asks for "/fast"           |

  @adw-928 @adw-3a0fub-bug-every-claude-pro
  Scenario: The model-literal check finds no call site outside the routing module that names a model
    When the model-literal check is run across the repository
    Then the model-literal check reports no violations

  @adw-928 @adw-3a0fub-bug-every-claude-pro
  Scenario Outline: The model-literal check fails as soon as a call site outside the routing module names a model literally, in each form the codebase uses today
    Given a fixture source tree in which "<file>" names the model "<model>" <form>
    When the model-literal check is run over the fixture source tree
    Then the model-literal check fails naming "<file>"

    Examples:
      | file                          | model  | form                                                 |
      | adws/agents/fixtureAgent.ts   | fable  | as an argument to the agent spawn function           |
      | adws/triggers/fixtureProbe.ts | haiku  | after a --model flag in a Claude CLI argument list   |
      | scripts/fixture-probe.ts      | sonnet | after a --model flag in a Claude CLI argument list   |
      | adws/agents/fixtureSpawn.ts   | opus   | as the default of a spawn function's model parameter |

  # ── §2 HAIKU TAKES NO EFFORT ───────────────────────────────────────────────────────────────────

  @adw-928 @adw-3a0fub-bug-every-claude-pro
  Scenario Outline: No slash command the routing tables send to Haiku is given an effort, whether or not the issue asks for fast mode
    When the routing tables are consulted for every slash command for an issue whose body <body>
    Then no slash command the routing tables send to "haiku" is given an effort

    Examples:
      | tables  | body                       |
      | default | does not ask for fast mode |
      | fast    | asks for "/fast"           |

  @adw-928 @adw-3a0fub-bug-every-claude-pro
  Scenario: For an issue that asks for fast mode, "/promote_regression_vocabulary" reaches the Claude CLI on Haiku with no effort flag
    Given the Claude CLI is a recording stand-in
    When a command agent runs "/promote_regression_vocabulary" for an issue whose body asks for "/fast"
    Then the Claude CLI was started for "/promote_regression_vocabulary" with the model "haiku"
    And the Claude CLI was started for "/promote_regression_vocabulary" with no effort flag

  # ── §3 THE RETRY IS A SLASH COMMAND ────────────────────────────────────────────────────────────

  @adw-928 @adw-3a0fub-bug-every-claude-pro
  Scenario: An agent whose output fails validation is retried through a slash command and its arguments, and the retry's prompt carries no instruction written in code
    Given the Claude CLI is a recording stand-in that answers its first run with output that fails validation and every later run with valid output
    When a command agent with output validation runs "/extract_dependencies" for an issue whose body does not ask for fast mode
    Then the Claude CLI was started 2 times
    And the retry started the Claude CLI with a slash command followed only by its arguments
    And the retry's prompt carries none of the corrective instructions the retry used to write in code
    And the command agent returns the output the retry produced

  @adw-928 @adw-3a0fub-bug-every-claude-pro
  Scenario: The retry's command is told what to correct — the validation error, the expected output schema and the output that failed validation
    Given the Claude CLI is a recording stand-in that answers its first run with output that fails validation and every later run with valid output
    When a command agent with output validation runs "/extract_dependencies" for an issue whose body does not ask for fast mode
    Then the retry handed its command the validation error, the expected output schema and the output that failed validation, each inline or in a file it names

  @adw-928 @adw-3a0fub-bug-every-claude-pro
  Scenario Outline: The retry runs on the model and the effort the routing tables give its slash command for the issue at hand, not on a model named in code
    Given the Claude CLI is a recording stand-in that answers its first run with output that fails validation and every later run with valid output
    When a command agent with output validation runs "/extract_dependencies" for an issue whose body <body>
    Then the routing tables give the retry's slash command a model for an issue whose body <body>
    And the retry started the Claude CLI with the model and the effort the routing tables give its slash command for an issue whose body <body>

    Examples:
      | tables  | body                       |
      | default | does not ask for fast mode |
      | fast    | asks for "/fast"           |

  @adw-928 @adw-3a0fub-bug-every-claude-pro
  Scenario: In a target repository's worktree, the retry's slash command resolves to a command file that ADW's worktree setup put there
    Given a target repository worktree that ADW's worktree setup has prepared
    And the Claude CLI is a recording stand-in that answers its first run with output that fails validation and every later run with valid output
    When a command agent with output validation runs "/extract_dependencies" in that worktree for an issue whose body does not ask for fast mode
    Then the retry started the Claude CLI in that worktree
    And the Claude CLI found a command file for the retry's slash command in the directory it ran in

  # ── §4 EVERY CLAUDE PROCESS STARTS STATELESS ───────────────────────────────────────────────────

  @adw-928 @adw-3a0fub-bug-every-claude-pro
  Scenario Outline: A pipeline agent, each probe and the health check's version check all start the Claude CLI with auto-memory off, even when ADW's own environment turns it on
    Given ADW's own environment sets "CLAUDE_CODE_DISABLE_AUTO_MEMORY" to "0"
    And the Claude CLI is a recording stand-in
    When ADW starts the Claude CLI through the "<launcher>"
    Then every Claude CLI process ADW started had "CLAUDE_CODE_DISABLE_AUTO_MEMORY" set to "1"

    Examples:
      | launcher                        |
      | pipeline agent spawn            |
      | rate-limit probe                |
      | schema probe                    |
      | guardrails probe                |
      | health check's Claude CLI check |

  @adw-928 @adw-3a0fub-bug-every-claude-pro
  Scenario Outline: A pipeline agent, each probe and the health check's version check all hand the Claude CLI the same launch environment — ANTHROPIC_API_KEY passes through when the operator set it, and a variable outside the launch allowlist never does
    Given ADW's own environment sets "ANTHROPIC_API_KEY" to "sk-ant-test-928"
    And ADW's own environment sets "ADW_TEST_UNLISTED_928" to "must-not-reach-claude"
    And the Claude CLI is a recording stand-in
    When ADW starts the Claude CLI through the "<launcher>"
    Then every Claude CLI process ADW started had "ANTHROPIC_API_KEY" set to "sk-ant-test-928"
    And no Claude CLI process ADW started had "ADW_TEST_UNLISTED_928" set

    Examples:
      | launcher                        |
      | pipeline agent spawn            |
      | rate-limit probe                |
      | schema probe                    |
      | guardrails probe                |
      | health check's Claude CLI check |

  # ── §5 THE API KEY IS OPTIONAL ─────────────────────────────────────────────────────────────────

  @adw-928 @adw-3a0fub-bug-every-claude-pro
  Scenario Outline: The health check's environment check passes whether or not the operator set ANTHROPIC_API_KEY, and never lists the key as required
    Given ADW's own environment <key>
    When the health check checks ADW's environment variables
    Then the environment variable check passes
    And the environment variable check does not report "ANTHROPIC_API_KEY" missing
    And the environment variable check does not list "ANTHROPIC_API_KEY" among the required variables

    Examples:
      | key                                           |
      | leaves "ANTHROPIC_API_KEY" unset              |
      | sets "ANTHROPIC_API_KEY" to "sk-ant-test-928" |

  @adw-928 @adw-3a0fub-bug-every-claude-pro
  Scenario Outline: Every orchestrator that prints the shared usage text presents ANTHROPIC_API_KEY as optional and says that setting it moves billing from the Claude subscription to the API
    When the "<orchestrator>" orchestrator is asked for its usage
    Then the usage text presents "ANTHROPIC_API_KEY" as optional
    And the usage text says that setting "ANTHROPIC_API_KEY" moves billing from the Claude subscription to the API

    Examples:
      | orchestrator               |
      | adwSdlc.tsx                |
      | adwPlan.tsx                |
      | adwBuild.tsx               |
      | adwTest.tsx                |
      | adwChore.tsx               |
      | adwPatch.tsx               |
      | adwDocument.tsx            |
      | adwPlanBuild.tsx           |
      | adwPlanBuildTest.tsx       |
      | adwPlanBuildReview.tsx     |
      | adwPlanBuildTestReview.tsx |
      | adwPlanBuildDocument.tsx   |
      | adwMerge.tsx               |
      | adwUpgrade.tsx             |

  # ── §6 BACKSTOP ────────────────────────────────────────────────────────────────────────────────

  @adw-928 @adw-3a0fub-bug-every-claude-pro
  Scenario: TypeScript type-check passes with "/resolve_conflict" and the retry's command in the command union and in all four routing tables
    Then the ADW TypeScript type-check passes
