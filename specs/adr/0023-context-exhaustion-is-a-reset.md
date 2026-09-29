---
status: accepted
date: 2026-03-25
recorded: 2026-09-29
provenance:
  - kind: contemporaneous
    source: specs/issue-298-adw-9zcqhw-detect-context-compa-sdlc_planner-detect-compaction-restart.md
  - kind: contemporaneous
    source: specs/issue-299-*.md (two plans for #299)
  - kind: contemporaneous
    source: specs/issue-521-adw-bed2tg-bug-step-def-agent-c-sdlc_planner-orchestrator-watchdog-agent-timeout.md
  - kind: contemporaneous
    source: specs/issue-559-adw-qej3f4-replace-build-contex-sdlc_planner-build-novelty-progress-gate.md
  - kind: contemporaneous
    source: specs/issue-560-adw-23ipne-distinct-operator-fa-sdlc_planner-distinct-abort-messages.md
  - kind: contemporaneous
    source: specs/issue-561-adw-6uquvb-point-build-continua-sdlc_planner-build-continuation-committed-state.md
supersedes: []
superseded-by: []
---

# Context exhaustion restarts the agent with fresh context; git state carries the work over

## Context and Problem Statement

A long-running pipeline agent can fill its context window. Claude Code then compacts the conversation on its own, and the agent carries on from a summary. Issue #298 describes the effect: compaction "is lossy", and the agent "may redo work, miss context, or make incorrect assumptions". The build phase already had a continuation loop for an agent that approached its token limit. The question was what to do when context runs out, and later, how many restarts to allow and what to do with an agent that never returns at all.

The decision covers `adws/agents/agentProcessHandler.ts`, `adws/agents/claudeAgent.ts`, `adws/phases/buildPhase.ts`, `adws/phases/progressGate.ts`, `adws/core/retryOrchestrator.ts` and the continuation prompt in `adws/phases/planPhase.ts`.

## Decision Drivers

* Output quality drops after compaction (#298).
* A fixed restart cap killed builds that were making progress at the same count as builds that were stuck (#559).
* On issue #508 an agent reported success but its process never exited, and the orchestrator waited for more than 2.5 hours in `stepDef_running` with nothing to reclaim it (#521).

## Considered Options

* Let the agent continue on the compacted context (the behaviour before #298).
* Kill the agent when compaction is seen and start a new one with fresh context, reusing the token-limit continuation loop.
* For the limit on restarts: a fixed cap (`MAX_CONTEXT_RESETS`), or a gate that asks whether the committed state is new.

## Decision Outcome

Chosen option: "kill and restart with fresh context", because the plan is on disk and the worktree holds everything the previous agent wrote. Issue #298: "The build agent's plan spec lives on disk and is read fresh each time. The working tree contains all changes made by the previous agent run."

The decision was made in four steps.

1. 2026-03-25 (#298, #299). The stream handler detects the `compact_boundary` event, terminates the agent and returns `compactionDetected`. The build phase treats it like a token-limit stop. #299 extended the restart to the test and review retry loops, without counting it as a retry attempt.
2. 2026-05-21 (#521). Every agent invocation runs under a watchdog, 30 minutes by default and configurable per phase. The agent is spawned as a process-group leader so that the kill reaches its grandchildren. When the watchdog fires, the phase is marked `failed`, a "Phase Timeout" comment is posted and the orchestrator exits with code 0.
3. 2026-06-09 (#559, #560). In the build phase the fixed cap no longer ends the run. After `MAX_CONTEXT_RESETS` restarts (default 3) the worktree is committed and the tree hash of `HEAD` is compared with the hashes seen in this build. A new hash lets the build continue, a known hash aborts with `no_progress`, and more than `MAX_PROGRESS_CHECKPOINTS` checkpoints (default 20) aborts with `backstop`. The two aborts have different operator messages: inspect the plan, or split the issue.
4. 2026-06-09 (#561). The continuation prompt tells the new agent to read committed and uncommitted git state as the record of completed work. The tail of the previous agent's output stays in the prompt as a secondary hint.

### Consequences

* Good, because an agent never works from a compacted summary in the build and unit-test phases.
* Good, because a build that keeps producing new committed states can run past three restarts, and a stalled build stops at the first batch boundary.
* Good, because a wedged agent can hold an orchestrator for at most the watchdog timeout.
* Bad, because each restart pays for a fresh read of the plan and the git state.
* Bad, because the progress gate makes checkpoint commits on the feature branch through the `/commit` agent.
* Bad, because the test retry loop still uses the fixed cap and throws after `MAX_CONTEXT_RESETS` compactions.

### Confirmation

Checked on 2026-09-29 by reading the code.

* `adws/agents/agentProcessHandler.ts` kills the agent when the parser sets `compactionDetected`; `adws/phases/buildPhase.ts` calls `evaluateProgressGate`; `adws/core/config.ts` defines `MAX_CONTEXT_RESETS` (3), `MAX_PROGRESS_CHECKPOINTS` (20) and `AGENT_DEFAULT_TIMEOUT_MS` (1,800,000).
* `adws/agents/claudeAgent.ts` spawns with `detached: true` and calls `killProcessGroup` when the watchdog fires.
* `adws/phases/__tests__/progressGate.test.ts` was run with Vitest and passed. `adws/agents/__tests__/agentProcessHandler.test.ts` and `claudeAgent.test.ts` exist but were not run.
* No CI workflow runs the unit tests; they run through `bun run test:unit`.

## More Information

* Unresolved: `agentProcessHandler.ts` kills every agent on compaction, but only `buildPhase.ts` and the unit-test path (`adws/agents/testRetry.ts`, `adws/phases/unitTestPhase.ts`) restart it. A search for `compactionDetected` finds no other consumer. The review handling that #299 added lived in `adws/agents/reviewRetry.ts`, which was removed on 2026-04-08 (commit a805a4b6, see [ADR-0031](0031-active-test-phase-passive-review-judge.md)). The stage `review_compaction_recovery` and its comment formatter remain, and nothing posts it. Whether leaving the other phases without a restart is deliberate is not recorded.
* The plans for #559, #560 and #561 name a parent PRD, `specs/prd/build-context-reset-progress-gate.md`. It is not in the repository, so its rationale (the plans mention "novelty over size-growth") could not be read.
* #521 also changed the step-definition prompt to check syntax with `bunx tsc --noEmit` and never import step files.
* How a timed-out phase is picked up again is recorded in [ADR-0036](0036-stage-taxonomy-and-exhaustive-classifier.md) and [ADR-0047](0047-resume-in-place.md).
