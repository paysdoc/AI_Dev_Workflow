# Declarative Orchestration Architecture

## Problem Statement

ADW's orchestration layer has accumulated architectural friction across six areas:

1. **Orchestrator boilerplate**: All 14 orchestrator scripts repeat ~40 lines of identical arg parsing, workflow initialization, CostTracker setup, try/catch, and completion handling. Adding a new orchestrator means copying an existing one and editing the phase list. After #344 lands, cost tracking divergence is resolved, but the structural duplication remains.

2. **Entangled agent process handling**: `agentProcessHandler.ts` is a 320-line state machine that handles JSONL stream parsing, real-time token extraction, fatal error detection (auth, rate limit, compaction, token limit), process lifecycle management, and cost finalization — all in a single function with inline side effects (e.g., `process.kill()`). It is untested and untestable in its current form.

3. **Flat, unstructured workflow state**: `WorkflowContext` is a flat bag of ~30 optional fields with no structure indicating which phase produces or consumes which data. Inter-phase data flow is implicit — phases write to arbitrary fields, and consuming phases just hope the field was set. This makes dependencies between phases invisible.

4. **Incomplete provider migration**: Four phase files still import directly from `../github` instead of going through the provider interface (`repoContext`). Operations like `approvePR`, `issueHasLabel`, and `fetchPRDetails` are missing from the provider interface entirely.

5. **Fragile pause/resume**: On rate-limit pause, the system serializes minimal info to a pause queue, then re-spawns the entire orchestrator process on resume. This re-runs `initializeWorkflow()` (issue fetch, worktree setup, config loading, port allocation) and relies on comment-based stage detection to skip completed phases — a heuristic that can misfire.

6. **Comment-based stage detection**: The cron trigger parses GitHub issue comments to determine workflow stage (active, failed, retriable). This is fragile (depends on comment structure), expensive (fetches all comments), and redundant when the orchestrator already knows its own state.

## Solution

Replace the current copy-paste orchestrator scripts with a declarative orchestrator runner that defines workflows as typed phase lists with four composition primitives. Introduce structured, namespaced workflow state that makes inter-phase data flow explicit. Refactor the agent process handler into an event-driven stream processor with pluggable, pure listeners. Complete the provider migration for phase files. Replace comment-based stage detection with state file reads.

## User Stories

1. As a developer adding a new orchestrator, I want to declare a phase list in ~15 lines instead of copying ~100 lines of boilerplate, so that new pipelines are trivial to create and review.

2. As a developer reading an orchestrator definition, I want to see the control flow (sequential, parallel, branching, optional) declared explicitly in the phase list, so that I can understand the pipeline without reading phase internals.

3. As a developer working on a phase, I want to read typed, namespaced input (e.g., `state.plan.filePath`) and write typed output (e.g., `state.build.output`), so that inter-phase dependencies are visible and compiler-checked.

4. As a developer debugging a failed workflow, I want the serialized state snapshot to show exactly which phase produced which data, so that I can pinpoint where things went wrong.

5. As a developer, I want the orchestrator runner to handle CostTracker lifecycle, arg parsing, initialization, completion, and error handling automatically, so that I never duplicate that boilerplate.

6. As a developer, I want to mark phases as `optional()` in the declaration, so that non-fatal phases (scenario writer, step def generation) don't halt the pipeline without me writing try/catch in the phase.

7. As a developer, I want to use `branch()` in the declaration to express conditional logic (e.g., diff verdict → safe vs regression path), so that control flow is visible in the orchestrator definition, not hidden inside phases.

8. As a developer, I want to use `parallel()` in the declaration to run independent phases concurrently (e.g., plan + scenario), so that parallelism is declared, not hand-coded.

9. As a developer, I want any phase that hits a token limit to be automatically retried by the runner, with the phase supplying a continuation prompt builder via `onTokenLimit`, so that continuation logic isn't duplicated in every phase.

10. As a developer, I want phases that don't provide `onTokenLimit` to fail on token limit as they do today, so that the default behavior is safe and explicit.

11. As a developer, I want rate-limit pause to serialize the exact phase index + structured state + cost tracker state, so that resume picks up from exactly where it stopped — no re-initialization, no comment parsing.

12. As a developer, I want the resumed workflow to skip re-running `initializeWorkflow()`, so that resume is fast and doesn't hit GitHub API unnecessarily.

13. As a developer, I want the agent process handler to emit typed events from the JSONL stream, so that token extraction, error detection, progress reporting, and output accumulation are independent, pure listeners.

14. As a developer, I want fatal error detection (auth, rate limit, compaction, token limit) to emit a `fatal_error` event rather than calling `process.kill()` inline, so that the stream orchestrator — not the detector — owns process lifecycle decisions.

15. As a developer testing the agent infrastructure, I want to feed recorded JSONL fixtures through the stream processor and verify that the correct events are emitted, so that error detection and token extraction have unit test coverage.

16. As a developer testing the orchestrator runner, I want to provide mock phases that read/write structured state and verify that execution order, branching, parallel execution, optional handling, and pause/resume work correctly.

17. As a developer, I want `approvePR()`, `issueHasLabel()`, and `fetchPRDetails()` available on the provider interface, so that `autoMergePhase` and `prReviewPhase` route through `repoContext` instead of importing from `../github` directly.

18. As a developer adding GitLab or Jira support, I want all phase code to go through the provider interface, so that new platform support doesn't require modifying phase files.

19. As the cron trigger, I want to read orchestrator state files to determine workflow stage, so that I don't rely on fragile comment structure parsing.

20. As a developer, I want all module interfaces (orchestrator runner, stream processor, structured state, provider extensions) defined with explicit TypeScript types — no `any`, no implicit shapes, no convention-based contracts.

21. As a developer, I want the `reviewRetry` orchestrator to remain self-contained as a single phase, but read/write structured state instead of passing results through function args, so that review data is accessible to downstream phases (document, KPI) without closure wiring.

22. As a developer, I want the structured state to be serializable to JSON, so that pause/resume snapshots and state file reads work without custom serialization logic.

23. As a developer, I want the orchestrator runner to support the existing pause queue mechanism (append to `agents/paused_queue.json`), but with richer serialized state that enables exact-position resume.

## Implementation Decisions

### Declarative Orchestrator Runner

- A new module provides `defineOrchestrator()` and `runOrchestrator()` functions.
- Orchestrators are defined as a configuration object with an `OrchestratorId` and a typed phase list.
- Four composition primitives: sequential (default), `parallel()`, `branch()`, `optional()`.
- The runner owns: CLI arg parsing, `initializeWorkflow()`, `CostTracker` lifecycle, per-phase execution, try/catch, `completeWorkflow()` / `handleWorkflowError()`, and pause/resume.
- All 14 existing orchestrator scripts are replaced with declarative definitions.
- Token-limit continuation is handled by the runner: phases optionally provide an `onTokenLimit(state, previousResult)` function that returns a continuation prompt. The runner manages the retry loop (up to `MAX_CONTEXT_RESETS`). Phases without `onTokenLimit` fail on token limit.

### Structured Workflow State

- A new type replaces the flat `WorkflowContext` with namespaced sections grouped by producing phase: `state.install.*`, `state.plan.*`, `state.build.*`, `state.review.*`, `state.diffEval.*`, `state.test.*`, `state.document.*`, `state.kpi.*`, `state.scenario.*`, `state.pr.*`.
- Each namespace is a typed interface defining the fields that phase produces.
- Phases receive the full state object, read from other namespaces, and write to their own namespace.
- The state object is JSON-serializable for pause/resume snapshots.
- Init-time data (issue, adwId, worktreePath, branchName, projectConfig, repoContext) lives on a separate `WorkflowConfig` object, not in the phase state. State is exclusively for inter-phase data flow.

### Agent Stream Event System

- The current `agentProcessHandler.ts` is refactored into an event-driven stream processor.
- A JSONL stream parser reads stdout and emits typed events (parsed envelopes).
- Independent, pure listeners subscribe to events: token extraction, error detection, progress reporting, output accumulation.
- Listeners are side-effect-free — they compute and return data, they do not mutate external state or kill processes.
- A stream orchestrator composes the listeners, owns the process handle, and reacts to `fatal_error` events by killing the process.
- `claudeAgent.ts` continues to own process spawning (ENOENT retry, OAuth refresh) and delegates to the stream processor for output handling.

### Provider Interface Completion

- Add `approvePR(prNumber)`, `issueHasLabel(issueNumber, label)`, and `fetchPRDetails(prNumber)` to the provider interfaces (`CodeHost` and/or `IssueTracker` as appropriate).
- Implement these methods in the GitHub provider, delegating to existing functions in `adws/github/`.
- Update `autoMergePhase.ts` and `prReviewPhase.ts` to use `repoContext` instead of direct GitHub imports.
- Scope: phases only. Triggers remain GitHub-specific entry points. Comment formatting and auth refresh remain as-is.

### Pause/Resume Improvement

- On pause, the runner serializes: phase index in the declaration, structured state snapshot, CostTracker state (accumulated cost, model usage, phase cost records).
- On resume, the runner loads the snapshot and continues from the next phase — no `initializeWorkflow()` re-run, no comment parsing.
- The pause queue file format (`PausedWorkflow`) is extended with serialized state fields.
- The existing `pauseQueueScanner` probe mechanism (rate-limit detection via `claude --print "ping"`) remains unchanged.

### Stage Detection Migration

- `trigger_cron.ts` reads orchestrator state files (`agents/*/adw_state.json`) to determine workflow stage, replacing comment-based stage detection via `workflowCommentParsing.ts`.
- Comment-based stage parsing is removed from the cron trigger path.
- The concurrency guard remains API-based (fetches open issues + PRs from GitHub) to support future distributed execution.
- Dependency extraction remains as-is (three-tier: cache, keyword proximity, LLM fallback).

### Review Retry

- `reviewRetry.ts` stays self-contained as a single phase — not decomposed into the declarative runner's primitives.
- It is modified to read/write structured state (`state.review.*`) instead of passing results through function arguments and closure bindings.
- Downstream phases (document, KPI) read review results from `state.review.screenshotUrls`, `state.review.retries`, etc.

### TypeScript Type Discipline

- All module boundaries must have explicit TypeScript type definitions.
- No `any` types at module boundaries.
- All event types in the stream processor are discriminated unions.
- Phase input/output contracts are enforced by the structured state type.
- The orchestrator runner's primitives (`parallel`, `branch`, `optional`) are fully typed.

## Testing Decisions

Good tests verify external behavior at module boundaries, not implementation details. Tests should be able to survive internal refactoring without changing. The three new modules have clean boundaries specifically designed for isolated testing.

### Modules to Test

**Orchestrator Runner**
- Feed mock phases (functions that read/write structured state) into the runner.
- Verify: execution order matches declaration, `parallel()` runs phases concurrently, `branch()` follows correct path based on state, `optional()` catches and continues on error, fatal phase errors halt the pipeline.
- Verify pause/resume: serialize mid-pipeline, deserialize, confirm remaining phases execute in order with correct state.
- Verify token-limit continuation: phase with `onTokenLimit` is retried, phase without it fails.

**Agent Stream Event System**
- Feed recorded JSONL fixtures (already exist in `adws/jsonl/fixtures/` and `test/fixtures/jsonl/`) through the stream processor.
- Verify: token extraction listener produces correct counts, error detection listener emits `fatal_error` for auth/rate-limit/compaction/token-limit patterns, progress listener emits at correct intervals, output accumulator captures full text.
- Verify: stream orchestrator kills process on `fatal_error` event.

**Structured Workflow State**
- Serialize/deserialize roundtrip tests.
- Verify type safety: namespaced reads/writes produce correct shapes.

### Prior Art

- `adws/cost/__tests__/computation.test.ts` and `extractor.test.ts` — Vitest unit tests with similar boundary-testing approach.
- `adws/jsonl/fixtures/` — JSONL fixture files for stream processing tests.
- `test/fixtures/jsonl/` — Additional JSONL envelope and payload fixtures.
- `features/` — BDD scenarios for integration-level testing.

## Out of Scope

- **Trigger platform abstraction**: Triggers (`trigger_webhook.ts`, `trigger_cron.ts`, `webhookHandlers.ts`) remain GitHub-specific. No GitLab/Jira webhook support.
- **Project config loader refactor**: `projectConfig.ts` (471 lines, 5 parsers) stays as-is — no current pain.
- **Review retry decomposition**: `reviewRetry.ts` stays self-contained; its internal loop is not expressed using the runner's primitives.
- **Distributed execution support**: Concurrency guard remains API-based but no active work on multi-machine orchestration.
- **Comment formatting abstraction**: `formatWorkflowComment` and related functions stay as direct GitHub imports — not routed through providers.
- **GitHub App auth refresh**: `refreshTokenIfNeeded()` stays as a direct import in `phaseCommentHelpers.ts`.
- **Dependency extraction changes**: The three-tier strategy (cache → proximity → LLM) is unchanged.
- **`BoardStatus` enum**: Remains GitHub-specific in provider types — not generalized.

## Further Notes

- **Dependency on #344**: The CostTracker migration (#344) should land first, as it eliminates the manual cost accumulation divergence in `adwPlan`, `adwDocument`, `adwInit`, and `adwPrReview`. The declarative runner assumes all orchestrators use `CostTracker`/`runPhase`.
- **Migration strategy**: Orchestrators can be migrated incrementally — convert one at a time to declarative definitions, verify behavior, continue. The runner and the old manual pattern can coexist during migration.
- **Backward compatibility**: The structured state should be additive during migration. Phases can be updated one at a time to read/write namespaced state while the flat `WorkflowContext` fields remain available. Once all phases are migrated, the flat fields are removed.
