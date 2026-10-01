@adw-929 @adw-abjew4-bug-on-compaction-on
Feature: On context compaction only the build phase and the unit-test path stop and restart their agent — an agent in any other phase runs on with its compacted context to its final result, and the retired review compaction recovery stage is gone

  Issue #929 resolves the `## Divergence` section of ADR-0023
  (`specs/adr/0023-context-exhaustion-is-a-reset.md`). That section is the specification.

  Today the agent process handler stops every agent as soon as Claude Code reports that it has
  compacted the agent's context (a `system`/`compact_boundary` stream-json line). Only two callers
  restart the stopped agent:
    • the build phase, which starts a fresh build agent with a continuation prompt (and, past
      `MAX_CONTEXT_RESETS`, commits and consults the progress gate);
    • the unit-test path, which runs the unit tests again without using up a retry, whether the
      test agent or the test-resolution agent was stopped.
  Every other phase gets the stopped agent's partial output back and carries on as if it were the
  agent's answer. The review handling that #299 added lived in `adws/agents/reviewRetry.ts`, which
  was removed on 2026-04-08 (ADR-0031). Its `review_compaction_recovery` stage and comment
  formatter remain, and nothing posts them.

  Ruling (owner, 2026-09-29): only build and tests restart on compaction. Every other phase runs on
  with the compacted context and is not killed. Killing it and accepting its partial output is a
  bug.

  The labels below are the section numbers used for the scenario groups further down (§1–§4):

    §1  THE BUILD PHASE STILL RESTARTS (AC1, "as today"). The first build agent is stopped before
        it reports a final result. A second one is started and told why. The build phase finishes
        on the second agent's final result, and the issue gets a "Context Compaction Recovery"
        comment.

    §2  THE UNIT-TEST PATH STILL RESTARTS (AC1, "as today"). A stopped test agent is run again. A
        stopped test-resolution agent sends the phase back to run the unit tests again. Neither
        restart uses up a unit-test retry, and the issue gets a "Test Compaction Recovery" comment.

    §3  EVERY OTHER PHASE RUNS ON (AC2). In a representative set of other phases the compacted
        agent is not stopped, runs to completion and is started only once. Two rows separate the
        rule from look-alikes:
          – the review-patch build agent is the build agent the review phase runs to apply the
            patch for a review blocker. The build phase uses the same build-agent runner, so this
            row proves that the decision follows the phase, not the agent;
          – the scenario fix phase resolves failing BDD scenarios. It is a test phase, but it is
            not the unit-test path, so its agent runs on.
        One end-to-end review scenario shows why the partial output must not be accepted. Before
        the compaction the review agent wrote a draft verdict that reports a blocker; its final
        result passes the review. The review phase must pass the review on the final result and
        post no compaction recovery comment.

    §4  THE RETIRED REVIEW STAGE IS GONE (AC4). A comment headed "Review Compaction Recovery" is
        no longer read as a workflow stage, and ADW no longer formats one. The build and test
        recovery comments are still read as their stages, and the stage classifier still
        classifies those stages as resumable. The type-check passes; it is what enforces the
        classifier's `never` guard and the exhaustive stage map in the classifier's unit test.

  Left to other checks: AC3 (unit tests for both cases) is enforced by `bun run test:unit`. AC5
  (removing the `## Divergence` section from ADR-0023) is a documentation change, checked at
  review.

  How these scenarios observe the system. Every assertion targets a runtime artefact:
    • the stand-in Claude CLI's own record of each run it served: the prompt it received, whether
      it was stopped by a signal, and whether it reached its natural end;
    • what a phase returns and the workflow context it updates (the build output, the review
      verdict, the number of unit-test retries used);
    • the comments the recording issue tracker received;
    • the stage the comment parser reads from a comment body, the class the stage classifier
      assigns to a stage, and the comment body ADW formats for a stage;
    • the type-check's exit code.
  No scenario reads, greps or parses a source file.

  Notes for the step definitions:
    • NEVER SPAWN THE REAL CLAUDE CLI. Point `CLAUDE_CODE_PATH` at a throwaway executable written
      for the scenario (feature-907's `writeThrowawayClaudeScript` is the precedent). Clear the
      cached CLI path before and after (`clearClaudeCodePathCache()`), and restore the variable in
      an `@adw-929` `After` hook. `getSafeSubprocessEnv()` filters the spawned CLI's environment,
      so `MOCK_*` variables never reach it: bake absolute paths (run log, per-command invocation
      counter, JUnit report path) into the script itself.
    • THE COMPACTING CLI. The script picks its behaviour from the slash command at the start of
      its prompt (the last argv) and from how many times that command has already run. A run that
      compacts:
        1. writes a `system`/`init` line and an assistant text line with recognisable partial
           output;
        2. writes `{"type":"system","subtype":"compact_boundary"}`;
        3. waits about two seconds, so that a handler which stops agents on compaction has done so
           before the run carries on;
        4. writes a further assistant line and a `result` line carrying the final result, records
           that it reached its natural end, and exits 0.
      It records that it was stopped when it receives SIGTERM: install a handler that appends to
      the run log and exits 143. Every other run writes its `init`, assistant and `result` lines
      at once. "the first <agent>" means that only the first run of that agent's command
      compacts. The restarted agent, and every other command (commit, patch, …), runs normally.
    • Agent to command: build agent and review-patch build agent → `/implement` (`/implement-tdd`
      when the issue has scenario files); PR review build agent → `/implement` through the PR
      review build runner; test agent → `/test`; test-resolution agent → `/resolve_failed_test`;
      plan agent → the issue's classification command (e.g. `/bug`); step-definition agent →
      `/generate_step_definitions`; review agent → `/review`; scenario-resolution agent →
      `/resolve_failed_scenario`; document agent → `/document`. "was started N time(s)" counts
      the runs of that command.
    • Every final result must satisfy the agent's own output parser (the review agent's JSON
      verdict, for example), so that no validation retry starts an extra agent.
    • DRIVING THE PHASES. §1, §2 and the end-to-end review scenario run the real phase functions
      in-process (`executeBuildPhase`, `executeUnitTestPhase`, `executeReviewPhase`). Each runs
      on a `WorkflowConfig` built over a throwaway git worktree whose providers record every call:
      the `world796` harness that feature-820 drives `executeReviewPhase` with. §1 needs the plan
      file where `getPlanFilePath` looks, and a real git repository, because the build phase
      reads the `HEAD` tree hash. §2 enables unit tests. Each completed `/test` run writes a JUnit
      report to `<logsDir>/junit-unit.xml`, passing unless the scenario says otherwise. Never let
      the unit-test phase reach a hard-fail verdict: it calls `process.exit(1)`.
    • §3 drives, per row, the real entry point the named phase uses for the named agent. Where
      only that phase uses the runner (plan, step-definition, review, scenario-resolution,
      document, PR review build), call the runner the way the phase does. For the review-patch
      build agent, drive the review phase's patch path (`applyPatchBlocker` with one patch
      blocker), never `runBuildAgent` directly.
    • "a comment headed {string} was posted on issue {int}" matches a recorded comment on that
      issue whose `## ` heading line contains the text. "no compaction recovery comment" means
      that no recorded comment on the issue has a heading containing "Compaction Recovery".
    • §4 builds the comment body from the heading as `## <heading>`, a blank line, and
      `**ADW ID:** \`abjew4-bug-on-compaction-on\``, then passes it to
      `parseWorkflowStageFromComment`. The classifier rows call `classifyStageString`. The
      formatter scenario calls `formatWorkflowComment` with the stage string and a minimal
      context.
    • The agent names in these steps are prose. Match them with one custom parameter type that
      lists them, longest first; no other step file defines a parameter type.

  Vocabulary note. These registered phrases from `features/regression/vocabulary.md` are reused:
    • G18 `the ADW codebase is checked out`
    • T22 `the ADW TypeScript type-check passes`
  Everything else is novel, because the registry has no phrase for a compacting Claude CLI, for a
  phase driven in-process with recording providers, or for the outcome of an agent run. The
  registered comment phrases (T2, T3) assert requests recorded by the mock GitHub API server,
  which an in-process phase with recording providers never makes.

  Background:
    Given the ADW codebase is checked out

  # §1 — THE BUILD PHASE STILL RESTARTS

  @adw-929 @adw-abjew4-bug-on-compaction-on
  Scenario: A build agent whose context is compacted in the build phase is stopped, and a fresh build agent continues the plan from the worktree
    Given a workflow for issue 9291 in the target repository "acme/widgets" whose providers record every call
    And the issue has an implementation plan in its worktree
    And the Claude CLI compacts the context of the first build agent partway through its run, after which, if left running, the agent carries on to a final result
    When the build phase runs
    Then the first build agent was stopped before it reported a final result
    And a second build agent was started and told that the previous build agent was stopped because its context was compacted
    And the second build agent ran to completion
    And the build phase completed with the second build agent's final result as the build output
    And a comment headed "Context Compaction Recovery" was posted on issue 9291

  # §2 — THE UNIT-TEST PATH STILL RESTARTS

  @adw-929 @adw-abjew4-bug-on-compaction-on
  Scenario: A test agent whose context is compacted in the unit-test phase is stopped and run again, and the restart does not use up a unit-test retry
    Given a workflow for issue 9292 in the target repository "acme/widgets" whose providers record every call
    And unit tests are enabled for the workflow
    And the Claude CLI compacts the context of the first test agent partway through its run, after which, if left running, the agent carries on to a final result
    When the unit-test phase runs
    Then the first test agent was stopped before it reported a final result
    And a second test agent was started
    And the second test agent ran to completion
    And the unit-test phase used none of its retries
    And a comment headed "Test Compaction Recovery" was posted on issue 9292

  @adw-929 @adw-abjew4-bug-on-compaction-on
  Scenario: A test-resolution agent whose context is compacted in the unit-test phase is stopped, and the unit tests run again without using up a retry
    Given a workflow for issue 9292 in the target repository "acme/widgets" whose providers record every call
    And unit tests are enabled for the workflow
    And the first unit-test run reports one failing unit test and every later run reports all unit tests passing
    And the Claude CLI compacts the context of the first test-resolution agent partway through its run, after which, if left running, the agent carries on to a final result
    When the unit-test phase runs
    Then the first test-resolution agent was stopped before it reported a final result
    And the test agent was started 2 times
    And the unit-test phase used none of its retries
    And a comment headed "Test Compaction Recovery" was posted on issue 9292

  # §3 — EVERY OTHER PHASE RUNS ON

  @adw-929 @adw-abjew4-bug-on-compaction-on
  Scenario Outline: An agent whose context is compacted in the <phase> phase is not stopped and runs to completion on its compacted context
    Given a workflow for issue 9293 in the target repository "acme/widgets" whose providers record every call
    And the Claude CLI compacts the context of the first <agent> partway through its run, after which, if left running, the agent carries on to a final result
    When the <phase> phase runs its <agent>
    Then the <agent> was not stopped
    And the <agent> ran to completion
    And the <agent> was started 1 time

    Examples:
      | phase           | agent                     |
      | plan            | plan agent                |
      | step definition | step-definition agent     |
      | review          | review agent              |
      | review          | review-patch build agent  |
      | scenario fix    | scenario-resolution agent |
      | document        | document agent            |
      | PR review       | PR review build agent     |

  @adw-929 @adw-abjew4-bug-on-compaction-on
  Scenario: The review phase passes the review on the verdict its review agent reached after a compaction, not on the draft verdict it wrote before it, and posts no compaction recovery comment
    Given a workflow for issue 9294 in the target repository "acme/widgets" whose providers record every call
    And the Claude CLI compacts the context of the first review agent partway through its run, after which, if left running, the agent carries on to a final result
    And before the compaction the review agent wrote a draft verdict that reports a blocker
    And the review agent's final result passes the review with no blockers
    When the review phase runs
    Then the review agent was not stopped
    And the review agent was started 1 time
    And the review phase passes the review
    And no compaction recovery comment was posted on issue 9294

  # §4 — THE RETIRED REVIEW STAGE IS GONE

  @adw-929 @adw-abjew4-bug-on-compaction-on
  Scenario: A comment headed "Review Compaction Recovery" is no longer read as a workflow stage
    Given an ADW workflow comment headed ":warning: Review Compaction Recovery"
    When the workflow stage is read from that comment
    Then no workflow stage is read from that comment

  @adw-929 @adw-abjew4-bug-on-compaction-on
  Scenario: ADW no longer formats a "Review Compaction Recovery" comment for the retired review stage
    When ADW formats the workflow comment for the stage "review_compaction_recovery"
    Then the formatted comment is not headed "Review Compaction Recovery"

  @adw-929 @adw-abjew4-bug-on-compaction-on
  Scenario Outline: The build and unit-test compaction recovery comments are still read as their workflow stages, which the stage classifier still classifies as resumable
    Given an ADW workflow comment headed "<heading>"
    When the workflow stage is read from that comment
    Then the workflow stage read from that comment is "<stage>"
    And the stage classifier classifies the stage "<stage>" as "resumable"

    Examples:
      | heading                               | stage                    |
      | :warning: Context Compaction Recovery | compaction_recovery      |
      | :warning: Test Compaction Recovery    | test_compaction_recovery |

  @adw-929 @adw-abjew4-bug-on-compaction-on
  Scenario: TypeScript type-check passes once the review compaction recovery stage is retired, so the exhaustive stage classifier still covers every workflow stage
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
