---
status: accepted
date: 2026-03-22
recorded: 2026-09-29
provenance:
  - kind: contemporaneous
    source: specs/issue-265-adw-btrko8-architectural-improv-sdlc_planner-improve-codebase-architecture.md (issue #265, merged as PR #266 on 2026-03-22)
  - kind: contemporaneous
    source: specs/issue-97-adw-refactor-the-code-fuyzg6-sdlc_planner-refactor-architecture-and-tests.md (issue #97, merged as PR #98 on 2026-03-09)
  - kind: contemporaneous
    source: specs/issue-398-adw-s59wpc-adwprreview-migrated-sdlc_planner-migrate-prreview-to-phaserunner.md (issue #398, merged as PR #410 on 2026-04-08)
supersedes: []
superseded-by: []
---

# Phases run through a shared phase runner, and the core is split into single-purpose modules

## Context and Problem Statement

With one script per orchestrator ([ADR-0001](0001-script-per-orchestrator-driving-claude-code-cli.md)), shared behaviour was copied from script to script. The spec for issue #265 lists what that had produced: every composite orchestrator repeated "the same 9-line cost-tracking boilerplate per phase, totaling 30+ repetitions"; `config.ts` was "a god module with 7 distinct concerns", so that "changes to model routing (frequent) require navigating past unrelated Jira/GitLab credentials"; `utils.ts` was "a junk drawer"; and more than 15 agent wrappers followed one pattern with no shared abstraction. The decision covers how an orchestrator runs a phase and how `adws/core/` and `adws/agents/` are divided.

## Decision Drivers

* Adding an orchestrator, agent or phase should need little boilerplate.
* Behaviour that applies to every phase should be written once.
* The coding guidelines' rule of one responsibility per file, under 300 lines.

## Considered Options

None recorded.

## Decision Outcome

Three changes were made together.

* **Phase runner.** An orchestrator runs a phase by calling `runPhase(config, tracker, phaseFn)`, or `runPhasesParallel` for phases with no dependency on each other. The runner and its `CostTracker` own cost accumulation, token persistence and the posting of cost records. A phase function returns its cost and model usage and does no bookkeeping of its own.
* **Core decomposition.** `config.ts` was split into `environment.ts`, `modelRouting.ts` and a reduced `config.ts`. `utils.ts` gave up ID generation to `adwId.ts` and logging to `logger.ts`. The stream parser moved from `agents/` to `core/claudeStreamParser.ts`, and the routing maps to `types/issueRouting.ts`.
* **Shared agent helper.** `runCommandAgent` handles the common sequence of running a command and extracting typed output, so a thin agent is a configuration object.

Issue #97 had taken the first step two weeks earlier, moving the argument parsing copied into all 13 orchestrators to `orchestratorCli.ts`. Issue #398 brought `adwPrReview.tsx`, which had kept its own bookkeeping, onto the runner, using a closure where a phase needs the PR-review configuration.

### Consequences

* Good, because behaviour added to the runner reaches every orchestrator that uses it. Issue #398 records this: moving PR review onto the runner gave it per-phase state writes, rate-limit pause and resume, and cost posting "as a side effect of this single refactor".
* Good, because the runner later became the place for skipping phases already completed on resume, for the agent timeout and for the in-process rate-limit wait.
* Bad, because re-export files kept for compatibility remain: `config.ts` re-exports `environment.ts` and `modelRouting.ts`, `agents/jsonlParser.ts` re-exports the moved parser, and `claudeAgent.ts` carries a block of re-exports.
* Bad, because the runner imports phase and forge modules lazily to avoid circular dependencies at load time.

### Confirmation

Checked against the code on 2026-09-29:

* `adws/core/phaseRunner.ts` exports `CostTracker`, `runPhase`, `runPhasesSequential` and `runPhasesParallel`. Unit tests: `adws/core/__tests__/phaseRunner.test.ts` (26 cases), run by `bun run test:unit`.
* 12 of the 16 `adws/adw*.tsx` scripts call `runPhase`. The four that do not are `adwMerge.tsx`, `adwUpgrade.tsx` and `adwClearComments.tsx`, which run no phases, and `adwDocument.tsx`, which calls the document agent directly and does not go through `CostTracker`.
* `environment.ts`, `modelRouting.ts`, `adwId.ts`, `logger.ts`, `claudeStreamParser.ts`, `types/issueRouting.ts` and `agents/commandAgent.ts` all exist.

No CI gate checks that a new orchestrator uses the runner.

## More Information

* Parts of the #265 plan that were not carried out, as the code stands: `adwPlanBuildTest.tsx` and `adwPlanBuildTestReview.tsx` are still full scripts and now differ from their counterparts; `utils.ts` still exists (63 lines); `agentProcessHandler.ts` was not merged into `claudeAgent.ts`; `types/dataTypes.ts` was not removed. No source records a decision to drop these steps.
* The spec describes orchestrators becoming "declarative phase lists". In the code they are sequences of `await runPhase(...)` calls.
* Several files exceed the 300-line guideline today, among them `triggers/trigger_cron.ts` (566) and `adwUpgrade.tsx` (504).
* Issue #265's body is only the skill invocation `/improve-codebase-architecture`; the analysis is in the spec.
* What the runner writes on each phase transition: [ADR-0029](0029-top-level-state-file-as-source-of-truth.md). Rate limits: [ADR-0025](0025-rate-limit-pause-and-resume-queue.md) and [ADR-0055](0055-rate-limit-structured-signals-two-tier-wait.md). Cost records: [ADR-0026](0026-cost-computed-locally-persisted-in-d1.md).
* The spawn function that `runCommandAgent` wraps: [ADR-0015](0015-slash-commands-as-single-spawn-path.md).
