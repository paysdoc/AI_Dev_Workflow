@adw-521 @adw-bed2tg-bug-step-def-agent-c
Feature: orchestrator watchdog — agent invocation timeout kills the process tree and records phase failure

  Issue #521 lands a watchdog around the Claude agent invocation wrapper
  in `adws/agents/claudeAgent.ts` (the `runClaudeAgentWithCommand`
  helper that spawns `claude --print <slash-command>`). Before this
  change, a wedged Bash subprocess inside a Claude agent could keep the
  orchestrator alive indefinitely. The triggering incident was ADW
  workflow `mqwyb7-llm-drafted-observab` (issue #508, sdlc), which
  remained in `stepDef_running` for 2.5+ hours: the step-def agent
  emitted `{"type":"result","subtype":"success"}` after ~8 minutes but
  the CLI process never exited because orphan `cat`/`head` children
  from a heredoc pipeline (`node --input-type=module <<EOF ... EOF
  2>&1 | head -20`) kept the bash subprocess alive — so the
  orchestrator's `await runClaudeAgentWithCommand(...)` never resolved.

  The watchdog applies a per-agent invocation timeout (default ~30 min,
  configurable per phase). On timeout it:

    1. Kills the **process tree** (not just the immediate child — orphan
       shells were the root cause of the wedge incident).
    2. Marks the failing phase as failed in the orchestrator state file
       so the workflow does not silently advance.
    3. Posts a `## :warning: Phase Timeout` comment on the issue so a
       human can see the wedge without log-spelunking.
    4. Returns control to the orchestrator, which exits cleanly. The
       resume path (next cron tick / next webhook event) re-enters the
       failed phase rather than treating the run as completed.

  The scenarios in this file exercise the watchdog end-to-end through
  the existing mock GitHub harness and assert against the artefacts the
  orchestrator produces: the state file written by the orchestrator
  (an *artefact*, not a source file — see `vocabulary.md` Rot-Detection
  Rubric) and the comment / label calls captured by the mock GitHub
  API. No assertion in this file is made against the contents of
  `adws/agents/claudeAgent.ts`, `adws/phases/stepDefPhase.ts`,
  `.claude/commands/generate_step_definitions.md`, or any other
  framework source file. Watchdog-timer correctness (the SIGKILL on
  process-group, exact timeout constant, signal escalation order) is
  unit-tested separately at
  `adws/agents/__tests__/claudeAgent.test.ts` against a synthetic
  child process; that test file is the canonical acceptance check for
  the kill-tree contract.

  Scope notes:

    • Layer 1 of the incident report — the `generate_step_definitions`
      prompt under-specifies the syntax check, letting the model pick
      `node --input-type=module` (which executes step files) — is
      addressed by a separate prompt edit and is verified by human PR
      review of `.claude/commands/generate_step_definitions.md` plus a
      regression unit-test fixture that locks in the captured Cucumber
      `checkInstall` stack trace. Asserting against the prompt source
      file here would be the rot pattern the parent PRD was designed to
      stop.
    • Layer 3 of the incident report — filing a minimal repro of
      "Bash tool subprocess outlives `result: success`" against
      `claude-cli` — is an upstream issue, not testable here.

  Background:
    Given the ADW codebase is checked out

  # ── §1 Watchdog fires on a wedged agent ───────────────────────────────

  @adw-521 @adw-bed2tg-bug-step-def-agent-c
  Scenario: A wedged step-def agent triggers the watchdog and the orchestrator subprocess exits cleanly
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/watchdog-stepdef-wedge.json"
    And the claude-cli-stub is configured to hang past the agent watchdog timeout for the step-def phase
    And the agent watchdog timeout for the step-def phase is set to 5 seconds
    And an issue 9700 exists in the mock issue tracker
    And the worktree for adwId "watchdog-521-1" is initialised at branch "feature-9700"
    And the mock GitHub API is configured to accept issue comments
    When the "sdlc" orchestrator is invoked with adwId "watchdog-521-1" and issue 9700
    Then the orchestrator subprocess exited 0
    And the orchestrator subprocess for adwId "watchdog-521-1" completed within 30 seconds

  @adw-521 @adw-bed2tg-bug-step-def-agent-c
  Scenario: A wedged agent marks the failing phase as failed in the orchestrator state file
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/watchdog-stepdef-wedge.json"
    And the claude-cli-stub is configured to hang past the agent watchdog timeout for the step-def phase
    And the agent watchdog timeout for the step-def phase is set to 5 seconds
    And an issue 9701 exists in the mock issue tracker
    And the worktree for adwId "watchdog-521-2" is initialised at branch "feature-9701"
    And the mock GitHub API is configured to accept issue comments
    When the "sdlc" orchestrator is invoked with adwId "watchdog-521-2" and issue 9701
    Then the orchestrator subprocess exited 0
    And the state file for adwId "watchdog-521-2" records the "step-def" phase as failed with reason "agent_timeout"

  @adw-521 @adw-bed2tg-bug-step-def-agent-c
  Scenario: A wedged agent triggers a Phase Timeout comment on the issue
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/watchdog-stepdef-wedge.json"
    And the claude-cli-stub is configured to hang past the agent watchdog timeout for the step-def phase
    And the agent watchdog timeout for the step-def phase is set to 5 seconds
    And an issue 9702 exists in the mock issue tracker
    And the worktree for adwId "watchdog-521-3" is initialised at branch "feature-9702"
    And the mock GitHub API is configured to accept issue comments
    When the "sdlc" orchestrator is invoked with adwId "watchdog-521-3" and issue 9702
    Then the orchestrator subprocess exited 0
    And the mock GitHub API recorded a comment on issue 9702
    And the mock GitHub API recorded a comment containing the text "Phase Timeout"
    And the mock GitHub API recorded a comment containing the text "step-def"

  # ── §2 Process-tree kill — orphan children are reaped ────────────────

  @adw-521 @adw-bed2tg-bug-step-def-agent-c
  Scenario: A wedged agent's orphan child processes do not outlive the orchestrator subprocess
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/watchdog-orphan-children.json"
    And the claude-cli-stub is configured to spawn an orphan child that outlives a single-process SIGTERM
    And the agent watchdog timeout for the step-def phase is set to 5 seconds
    And an issue 9703 exists in the mock issue tracker
    And the worktree for adwId "watchdog-521-4" is initialised at branch "feature-9703"
    And the mock GitHub API is configured to accept issue comments
    When the "sdlc" orchestrator is invoked with adwId "watchdog-521-4" and issue 9703
    Then the orchestrator subprocess exited 0
    And no orphan child process spawned by the stub for adwId "watchdog-521-4" remains alive after the orchestrator subprocess exits

  # ── §3 Watchdog does not fire on a quick agent (regression guard) ────

  @adw-521 @adw-bed2tg-bug-step-def-agent-c
  Scenario: A normal step-def agent that returns well within the watchdog window completes without a Phase Timeout comment
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/adw-sdlc-happy.json"
    And the agent watchdog timeout for the step-def phase is set to 30 seconds
    And an issue 9704 exists in the mock issue tracker
    And the worktree for adwId "watchdog-521-5" is initialised at branch "feature-9704"
    And the mock GitHub API is configured to accept issue comments
    When the "sdlc" orchestrator is invoked with adwId "watchdog-521-5" and issue 9704
    Then the orchestrator subprocess exited 0
    And the state file for adwId "watchdog-521-5" records no error
    And the mock harness recorded zero comments containing the text "Phase Timeout" on issue 9704

  # ── §4 Resume path — re-invocation re-enters the failed phase ────────

  @adw-521 @adw-bed2tg-bug-step-def-agent-c
  Scenario: After a watchdog-triggered phase failure, re-invoking the orchestrator re-enters the failed phase
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/watchdog-resume-recovery.json"
    And the agent watchdog timeout for the step-def phase is set to 5 seconds
    And an issue 9705 exists in the mock issue tracker
    And the worktree for adwId "watchdog-521-6" is initialised at branch "feature-9705"
    And the mock GitHub API is configured to accept issue comments
    And the state file for adwId "watchdog-521-6" records the "step-def" phase as failed with reason "agent_timeout" from a previous run
    When the "sdlc" orchestrator is invoked with adwId "watchdog-521-6" and issue 9705
    Then the orchestrator subprocess exited 0
    And the state file for adwId "watchdog-521-6" records the "step-def" phase as completed
    And the state file for adwId "watchdog-521-6" records no error

  # ── §5 Configurable per-phase timeout ───────────────────────────────

  @adw-521 @adw-bed2tg-bug-step-def-agent-c
  Scenario: Phase-specific timeouts override the framework default
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/watchdog-per-phase-timeout.json"
    And the agent watchdog timeout for the plan phase is set to 60 seconds
    And the agent watchdog timeout for the step-def phase is set to 5 seconds
    And the claude-cli-stub is configured to delay the step-def phase by 20 seconds and the plan phase by 1 second
    And an issue 9706 exists in the mock issue tracker
    And the worktree for adwId "watchdog-521-7" is initialised at branch "feature-9706"
    And the mock GitHub API is configured to accept issue comments
    When the "sdlc" orchestrator is invoked with adwId "watchdog-521-7" and issue 9706
    Then the orchestrator subprocess exited 0
    And the state file for adwId "watchdog-521-7" records the "plan" phase as completed
    And the state file for adwId "watchdog-521-7" records the "step-def" phase as failed with reason "agent_timeout"

  @adw-521 @adw-bed2tg-bug-step-def-agent-c
  Scenario: With no per-phase override, the framework default watchdog timeout applies
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/watchdog-default-timeout.json"
    And no per-phase agent watchdog timeout is configured for adwId "watchdog-521-8"
    And an issue 9707 exists in the mock issue tracker
    And the worktree for adwId "watchdog-521-8" is initialised at branch "feature-9707"
    And the mock GitHub API is configured to accept issue comments
    When the "sdlc" orchestrator is invoked with adwId "watchdog-521-8" and issue 9707
    Then the orchestrator subprocess exited 0
    And the agent watchdog applied to the step-def phase for adwId "watchdog-521-8" matches the framework default timeout

  # ── §6 Watchdog does not fire on rate-limit pause (pre-existing kill path) ─

  @adw-521 @adw-bed2tg-bug-step-def-agent-c
  Scenario: When the agent is killed by the rate-limit detector before the watchdog fires, no Phase Timeout comment is posted
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/rate-limit-pause-resume.json"
    And the agent watchdog timeout for the plan phase is set to 60 seconds
    And an issue 9708 exists in the mock issue tracker
    And the worktree for adwId "watchdog-521-9" is initialised at branch "feature-9708"
    And the mock GitHub API is configured to accept issue comments
    When the "sdlc" orchestrator is invoked with adwId "watchdog-521-9" and issue 9708
    Then the orchestrator subprocess exited 0
    And the state file for adwId "watchdog-521-9" records workflowStage "paused"
    And the mock harness recorded zero comments containing the text "Phase Timeout" on issue 9708

  # ── §7 Type-check ────────────────────────────────────────────────────

  @adw-521 @adw-bed2tg-bug-step-def-agent-c
  Scenario: TypeScript type-check passes after the watchdog change
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
