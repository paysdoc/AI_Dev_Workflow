# PRD: Test/Review Responsibility Split + Dev Server Lifecycle Refactor

## Problem Statement

ADW workflows leak `next dev` processes into target repository worktrees. A single chore worktree (`paysdoc.nl/.worktrees/chore-issue-28-remove-secrets-store-env-vars`) accumulated 12+ leaked Next.js processes over 5 days, including a `next-server` (v16.1.6) holding `.next/dev/lock` for 47 hours and 11 telemetry flush processes that never exited. The lock holder blocks subsequent dev server starts in the same worktree.

The leak is a symptom of a deeper architectural problem: the review phase has accreted test-execution responsibilities that belong to the test phase. The current `review.md` slash command unconditionally invokes `prepare_app.md` (which backgrounds `bunx next dev`) regardless of whether it actually needs a live application. Strategy C ("Default UI Validation") in review navigates the app and takes screenshots — work that should live in the test phase, not the review phase. Three parallel review agents (default `REVIEW_AGENT_COUNT=3`) each start their own dev server. Nothing in the codebase ever cleans them up: `removeWorktreesForIssue` is only called from the issue-close webhook handler, not at workflow completion, so dev servers leak across the whole window between workflow finish and issue close (which can be days, or never).

A separate but related problem: phase implementations have been parked in `*Completion.ts` files where they don't belong. `executeReviewPhase` lives in `workflowCompletion.ts`. `executePRReviewTestPhase` lives in `prReviewCompletion.ts`. `completePRReviewWorkflow` itself runs the commit agent and pushes the branch — work that has nothing to do with "completion." This was identified in a prior grill-me but only partially walked.

The PR review workflow is also a half-second-class citizen: it doesn't write top-level workflow state, doesn't move the issue board on error, doesn't support rate-limit pause/resume, and posts D1 cost records via a bespoke inline path — all because `PRReviewWorkflowConfig` is type-incompatible with `WorkflowConfig`, so PR review can't use the generic `phaseRunner` that gives every other orchestrator these features for free.

## Solution

Reframe the test and review phases around their proper responsibilities:

- **The test phase runs all tests** — unit tests, BDD scenarios for the feature being implemented (`@adw-{issueNumber}` tagged), and BDD regression scenarios (`@regression` tagged). It produces a structured proof artifact (`scenario_proof.md`) summarizing per-tag results. When the target repository's test runner cannot manage its own dev server (i.e., when `.adw/commands.md` declares a `## Start Dev Server` command), the test phase spawns the dev server in TypeScript before running scenarios and tears it down in a finally block — owning the lifecycle end-to-end so nothing leaks.

- **The review phase reads the proof artifact and judges** the implementation against the issue requirements. It does not run tests. It does not navigate the application. It does not start a dev server. It is a passive judge.

- **A dedicated cron janitor** scans target repository worktrees every 5 minutes for orphaned dev server processes (the catastrophic safety net for the case where the orchestrator was SIGKILL'd before its finally block ran). It leaves processes alone if the workflow stage is non-terminal AND the orchestrator PID is still alive, OR if the worktree is younger than 30 minutes.

- **The PR review workflow is unified with the main workflow** by composing rather than duplicating its config: `PRReviewWorkflowConfig` contains a `base: WorkflowConfig` field, and PR review phases route through the same `phaseRunner` as every other orchestrator. This single change resolves four long-standing disparities: top-level state writes, board status moves, rate-limit pause handling, and D1 cost posting.

- **Phase implementations are relocated** out of `*Completion.ts` files (relocations agreed in the prior grill but not completed). After this PRD, the completion files contain only terminal-state handlers.

- **The E2E test concept is trashed entirely.** Playwright spec files and the `e2e-tests/` convention go away. All test execution flows through the BDD scenario phase, configured per target via `.adw/scenarios.md`. The test runner can be Cucumber-js, Playwright Test, or anything else; ADW does not care. This eliminates the dual code paths in `runE2ETestsWithRetry` vs `runScenarioProof`.

The implementation is decomposed into a sequence of small, atomic pull requests, each leaving ADW in a working state. The user runs the cron trigger from a separate clone of `main` (the runner clone) while developing on `dev`, so in-flight workflows are never affected by mid-refactor commits. Each PR merges to `main` independently and the runner picks up the change on its next restart.

## User Stories

1. As an ADW operator, I want a workflow run against a Next.js target repo to clean up its dev server when the workflow finishes, so that the worktree's `.next/dev/lock` is released and subsequent runs don't deadlock.

2. As an ADW operator, I want a workflow that gets SIGKILL'd mid-flight to have its leaked dev server reaped within 30 minutes, so that orphans don't accumulate over weeks.

3. As an ADW operator, I want the cron janitor to leave alone dev servers belonging to active workflows, so that I never lose state from a long-running but legitimate run.

4. As an ADW operator, I want the cron janitor to leave alone dev servers in worktrees younger than 30 minutes, so that fresh workflows have a grace period before the janitor races them.

5. As an ADW operator, I want to start the cron trigger from a separate clone of `main` while I develop on `dev` in another clone, so that mid-refactor commits never break in-flight workflows.

6. As an ADW developer, I want the test phase to run unit tests, feature scenarios, and regression scenarios in sequence, so that one phase produces a complete validation picture instead of three scattered pieces in three different files.

7. As an ADW developer, I want the test phase to produce a single proof artifact (`scenario_proof.md`) summarizing per-tag pass/fail, so that the review phase has a deterministic input to judge against.

8. As an ADW developer, I want the test phase to spawn its own dev server when the target repo's runner doesn't manage one, so that I don't have to configure Playwright's `webServer` block for non-Playwright projects.

9. As an ADW developer, I want the test phase to read `## Start Dev Server` from `.adw/commands.md` with a `{PORT}` placeholder, so that parallel workflows on the same target don't collide on a fixed port.

10. As an ADW developer, I want the test phase to wait for the dev server to be ready via an HTTP probe with a configurable health path, so that scenarios don't run before the server is up.

11. As an ADW developer, I want the dev server start to retry up to 3 times if the health probe times out, so that transient startup failures don't fail the phase.

12. As an ADW developer, I want the test phase to fall back to running scenarios anyway after 3 failed start attempts, so that I get clearer failure messages from the actual scenario runner instead of an opaque "dev server failed" error.

13. As an ADW developer, I want the dev server to be killed via process group signal on cleanup, so that webpack workers, telemetry flushers, and other children die with the parent.

14. As an ADW developer, I want a single passive review agent reading the proof artifact, so that review is fast and deterministic instead of three parallel agents racing to navigate the same UI.

15. As an ADW developer, I want the review agent to support both scenario proof (Strategy A) and custom proof from `.adw/review_proof.md` (Strategy B), so that target repos with custom validation requirements still have an escape hatch.

16. As an ADW developer, I want Strategy C (UI navigation fallback) removed from `review.md`, so that review never invokes `prepare_app` and never starts a dev server.

17. As an ADW developer, I want a `scenarioFixPhase` that takes the test phase's failure list and runs resolver agents to fix the failing scenarios, so that the patch loop has a clear home outside review.

18. As an ADW developer, I want each orchestrator that uses scenarios to wire its own test→fix→retest loop, so that each orchestrator can decide its own retry semantics without a hidden global helper.

19. As an ADW developer, I want review blockers (when the implementation doesn't meet the issue requirements despite tests passing) handled by an orchestrator-level patch+build+retest loop, so that review can stay passive while still triggering fixes.

20. As an ADW developer, I want `executeReviewPhase` moved from `phases/workflowCompletion.ts` to a new `phases/reviewPhase.ts`, so that completion files contain only terminal handlers.

21. As an ADW developer, I want `executePRReviewTestPhase` moved from `phases/prReviewCompletion.ts` to `phases/prReviewPhase.ts`, so that PR review's test phase lives alongside its other phases instead of in a "Completion" file.

22. As an ADW developer, I want the commit+push step extracted from `completePRReviewWorkflow` into its own dedicated phase, so that "completion" actually means completion and the gated commit is visible in the orchestrator's phase list.

23. As an ADW developer, I want `PRReviewWorkflowConfig` to contain a `base: WorkflowConfig` field via composition, so that PR review can route shared phases through `phaseRunner` without polluting the main config with PR-only fields.

24. As an ADW developer, I want `adwPrReview.tsx` to use `runPhase`/`CostTracker` instead of hand-rolling cost bookkeeping, so that PR review automatically gets D1 cost posting, top-level state writes, rate-limit pause handling, and consistent retry semantics.

25. As an ADW developer, I want PR review phases to be called via a closure-wrapper pattern when they need access to PR-specific fields, so that `runPhase` stays generic and the closure makes the dependency on the composed config explicit.

26. As an ADW operator, I want PR review to support rate-limit pause and resume, so that a rate-limit hit during PR review doesn't kill the workflow entirely.

27. As an ADW operator, I want PR review to write top-level workflow state on success and on error, so that the workflow ledger is consistent across both workflow types.

28. As an ADW operator, I want both workflows to use a distributed board status update pattern (each phase moves its own status), so that the board reflects mid-flight state in real time and the pattern is symmetric.

29. As an ADW developer, I want the SDLC orchestrator to follow this phase order: install → plan+scenario (parallel) → alignment → build → stepDef → unitTest → scenarioTest [→ scenarioFix → loop] → review → document → KPI → PR, so that step definitions are generated against the built code (not a phantom interface) and scenarios run after step defs are ready.

30. As an ADW developer, I want `stepDefPhase` (currently dead code) wired into the SDLC orchestrator between build and unitTest, so that scenario execution has its dependencies in place.

31. As an ADW developer, I want the E2E test concept removed entirely — including `runE2ETestsWithRetry`, `runPlaywrightE2ETests`, `discoverE2ETestFiles`, the `e2e-tests/*.spec.ts` convention, and the `## Run E2E Tests` heading in `.adw/commands.md` — so that there is one unified path through BDD scenarios instead of two competing test stacks.

32. As an ADW developer, I want `resolve_failed_e2e_test.md` renamed to `resolve_failed_scenario.md` and `runResolveE2ETestAgent` renamed to `runResolveScenarioAgent`, so that the resolver agent's name reflects what it actually resolves.

33. As an ADW developer, I want `prepare_app.md`, `start.md`, `in_loop_review.md`, and `test_e2e.md` deleted, so that orphan slash commands don't confuse contributors or the LLM.

34. As an ADW developer, I want `adw_init` to detect the target repo's test runner and set `## Start Dev Server: N/A` when the runner manages its own server (Playwright `webServer` block, etc.) or when the project is CLI-only, so that target repos that don't need a dev server skip the spawn.

35. As an ADW developer, I want `adw_init` to add a `## Health Check Path` field to generated `.adw/commands.md` files with a default of `/`, so that target repos can override the probe target if their root path is slow or redirects.

36. As an ADW developer, I want `adw_init` to stop generating the `## Run E2E Tests` heading, so that newly initialized target repos don't carry the deprecated convention.

37. As an ADW developer, I want the implementation decomposed into small, atomic, independently-shippable PRs, so that I can run my cron trigger off `main` against the partially-refactored state without anything breaking.

38. As an ADW developer, I want unit tests for `core/devServerLifecycle.ts`, so that the spawn/probe/kill logic is verified in isolation against mocked process and HTTP primitives.

39. As an ADW developer, I want unit tests for `triggers/devServerJanitor.ts`, so that the kill-decision rule is verified against synthetic worktree states without depending on real lsof or real processes.

40. As an ADW developer, I want unit tests for `phases/scenarioTestPhase.ts`, so that the dev-server-decision branch and the proof generation are verified against mocked subprocess output.

41. As an ADW operator, I want a future grill-me about adding `Blocked` as an issue tracker board status (set by error handlers in the test/scenario fix/review failure paths), so that workflows that fail mid-flight park their issue in a known state instead of leaving it stuck wherever it was. This is **out of scope for this PRD** and explicitly deferred.

## Implementation Decisions

### New phase architecture

The test/review responsibility split is the central decision. Test phase is active (runs tests, owns dev server lifecycle, produces proof). Review phase is passive (reads proof, judges, outputs reviewIssues). The patch/retest loop is split: scenario test failures are resolved by `scenarioFixPhase` (orchestrator-wired loop); review-found blockers are resolved by an orchestrator-level patch+build+retest loop.

Two phases instead of three:
- `unitTestPhase` (renamed from existing `testPhase.ts`)
- `scenarioTestPhase` (new, replaces both `runE2ETestsWithRetry` and `runScenarioProof`)

The E2E concept and Playwright-specific code path is deleted. All test execution routes through the BDD scenario phase, configured per target repo via `.adw/scenarios.md`.

### Dev server lifecycle

Encapsulated in a new generic helper module exporting a `withDevServer` function. The helper takes a start command, a port, a health path, and a working directory; spawns the start command in a detached process group with `{PORT}` substituted into the command string; HTTP-probes the health path at 1-second intervals up to a 20-second timeout; retries the start up to 3 times on failure; falls back to running the wrapped work anyway after 3 failures; and kills the entire process group on cleanup via `process.kill(-pid, 'SIGTERM')`.

The scenario test phase uses `withDevServer` only when the target repo's `.adw/commands.md` declares a non-`N/A` `## Start Dev Server` command. CLI projects and projects whose runners self-manage (e.g., Playwright with `webServer`) skip the wrapper.

The `## Start Dev Server` schema requires a `{PORT}` placeholder so parallel workflows can use dynamic ports without environment variable leakage. A new `## Health Check Path` field is added to the schema with a default of `/`. The `## Run E2E Tests` field is removed from the schema.

### Cron janitor

A new probe in `triggers/devServerJanitor.ts`, called from the existing `trigger_cron.ts` loop on a 5-minute timer. It walks each target repo's `.worktrees/` directory, runs `lsof +D <worktreePath>` per worktree to find process holders, and applies the kill decision rule: leave alone if (workflow stage is non-terminal AND the orchestrator PID is still alive) OR (the worktree is younger than 30 minutes). Otherwise SIGTERM the process, wait, SIGKILL survivors. The orchestrator state file's `pid` field is used for the alive check; the `workflowStage` field for the terminal check.

### PR review unification via composition

`PRReviewWorkflowConfig` is restructured as composition rather than inheritance: `{ base: WorkflowConfig, prNumber, prDetails, unaddressedComments, applicationUrl }`. Shared phases continue to take `WorkflowConfig` and are called via `runPhase(config.base, tracker, executeUnitTestPhase)`. PR-specific phases take `PRReviewWorkflowConfig` and are called via the closure-wrapper pattern: `runPhase(config.base, tracker, _ => executePRReviewPlanPhase(config))`.

This single structural change resolves all four PR review disparities:
- Top-level state writes — provided by `phaseRunner`'s state machine
- Board status moves — moved to a distributed pattern, each phase moves its own status (matches the post-refactor main workflow)
- Rate-limit pause handling — provided by `phaseRunner`'s `RateLimitError` catch path
- D1 cost posting — provided by `phaseRunner`'s `CostTracker.commit`

After unification, the bespoke inline `postCostRecordsToD1` call in `prReviewCompletion.ts` is removed. The hand-rolled cost bookkeeping in `adwPrReview.tsx` is replaced with `runPhase`/`CostTracker`.

### Relocations from prior grill session

Three concrete relocations agreed in the prior grill (session `13362077-92da-4299-b889-a2df5f4b87ea`) are still in scope and integrate naturally with the new architecture:

1. `executeReviewPhase` moves from `phases/workflowCompletion.ts` to a new `phases/reviewPhase.ts`. It is also rewritten as a passive judge (Strategy A+B only, no UI navigation, no `prepare_app`).
2. `executePRReviewTestPhase` moves from `phases/prReviewCompletion.ts` to `phases/prReviewPhase.ts`. It is also expanded to use the new test phase structure (`unitTestPhase` + `scenarioTestPhase` + `scenarioFixPhase` loop) instead of the old `runUnitTestsWithRetry` + `runE2ETestsWithRetry` pair.
3. The commit+push block is extracted from `completePRReviewWorkflow` into a small dedicated phase (added either to `prReviewPhase.ts` or as its own file, TBD during implementation). After extraction, `completePRReviewWorkflow` shrinks to a true terminal handler.

After these moves, both `*Completion.ts` files contain only terminal-state handlers.

### Slash command changes

`review.md` is rewritten. The new shape: extract context, read scenario proof at the path supplied as an argument, evaluate per-tag results from the proof markdown (Strategy A) or follow `.adw/review_proof.md` if present (Strategy B), run supplementary checks (`bunx tsc --noEmit`, `bun run lint`), perform a coding guidelines check, return a JSON object with `success`, `reviewSummary`, `reviewIssues`, and `screenshots` (where `screenshots` is just the proof file path — review never produces UI screenshots).

`prepare_app.md`, `start.md`, `in_loop_review.md`, `test_e2e.md` are deleted.

`resolve_failed_e2e_test.md` is renamed to `resolve_failed_scenario.md`. `runResolveE2ETestAgent` is renamed to `runResolveScenarioAgent`.

`adw_init.md` is updated to detect target test runners and set `## Start Dev Server: N/A` for Playwright-managed, CLI, or other self-managing projects; to add the new `## Health Check Path` field; and to stop generating `## Run E2E Tests`.

### New SDLC phase order

```
install → plan + scenario (parallel) → alignment → build → stepDef →
unitTest → scenarioTest [→ scenarioFix → loop] → review → document → KPI → PR
```

`stepDef` is wired in for the first time (currently dead code in `phases/stepDefPhase.ts`). It sits between `build` and `unitTest` so step definitions are generated against built code rather than a phantom interface. The orchestrator-level loop wraps `scenarioTest` + `scenarioFix`, retrying until pass or max retries. A separate orchestrator-level loop wraps `review` + the patch+build+scenarioTest cycle, retrying when review finds blockers.

### Atomic-PR implementation principle

The work is decomposed into a sequence of small, atomic, independently-shippable PRs. Each PR must leave ADW in a working state. The user runs the cron trigger from a separate clone of `main` (the runner clone) while developing on `dev`. Each PR merges to `main` independently, and the runner picks up the change on its own restart cycle. No PR may depend on a later PR landing for ADW to remain functional. This constraint shapes the decomposition — for example, the dev server lifecycle helper must land before any phase that uses it; the deletion of `runE2ETestsWithRetry` cannot land until every caller has been migrated; the `PRReviewWorkflowConfig` composition refactor must land before the disparity fixes that depend on `phaseRunner`.

## Testing Decisions

Unit tests verify external behavior, not implementation details. A good test for a deep module exercises the public interface against mocked boundary primitives (process spawn, fetch, fs, kill) and asserts on observable behavior (was the right command spawned with the right args; was the proof artifact written with the right structure; did the kill propagate to the process group). A bad test reaches into the module's private state or asserts on which lines of code got executed.

Three deep modules get unit tests:

1. **`core/devServerLifecycle.ts`** — verify the start command is spawned with correct port substitution; verify the HTTP probe loop respects the configured interval and timeout; verify the retry count; verify the fallback path runs the wrapped work even when the start fails 3 times; verify the kill targets the process group and not just the parent PID; verify the kill runs in finally even when the wrapped work throws. Mock `child_process.spawn`, global `fetch`, and `process.kill`.

2. **`triggers/devServerJanitor.ts`** — verify the kill decision rule across all four cells of the (terminal-stage × PID-alive) × (younger-than-30-min × older-than-30-min) matrix; verify the worktree walk reads from the right directory; verify the lsof invocation; verify the SIGTERM/SIGKILL escalation. Mock fs operations, the orchestrator state file reader, and `process.kill`.

3. **`phases/scenarioTestPhase.ts`** — verify the dev-server-decision branch (wraps `withDevServer` when `## Start Dev Server` is non-`N/A`, skips when `N/A`); verify the test command is invoked with the correct tag filter (`@adw-{issue}` + `@regression`); verify the proof markdown is written with per-tag sections; verify the resolver agent is called for each failed scenario when retries are enabled. Mock `withDevServer`, the subprocess executor, and the proof writer.

The shallow modules (`scenarioFixPhase`, `reviewPhase`, `prReviewCommitPushPhase`) are mostly orchestration over existing pieces and are covered by integration tests against the orchestrators that wire them.

Prior art for the test style: existing Vitest tests under `adws/__tests__/`, `adws/core/__tests__/` (e.g., `phaseRunner.test.ts` already mocks subprocess and state-file primitives), `adws/agents/__tests__/`, `adws/triggers/__tests__/` (e.g., `triggerCronAwaitingMerge.test.ts` follows the same probe-test pattern that `devServerJanitor` should match), and `adws/cost/__tests__/`. The mock harness in `test/mocks/` provides claude-cli stub, github-api mock server, and git-remote mock — useful for any cross-cutting integration tests.

## Out of Scope

- **Adding a `Blocked` issue tracker status.** The board status options are currently `To Do`, `In Progress`, `Review`, `Done` (the first three native to GitHub Projects, `Review` added manually). The user wants `Blocked` so error paths in workflows can park issues in a known state, but this is deferred to its own future grill-me. For this PRD, error paths leave the board status as-is.

- **`adw_init` board creation** (creating an issue tracker board if it doesn't exist and adding `Review` and `Blocked` columns). Same future grill-me.

- **Unifying the scattered commit+push pattern across all phases.** The prior grill identified 8 sites where `runCommitAgent` + `pushBranch` are called inline at the end of various phases. This is a separate latent issue, explicitly out of scope. The new commit+push phase extracted from `completePRReviewWorkflow` is justified by the test gate (you can't push code that fails its tests), not as a step toward generalizing the pattern.

- **Strategy C UI navigation as a fallback.** Removed entirely. Target repos that want UI-level validation must configure scenario proof or custom proof. Projects without either lose UI-navigation validation, but they can rely on the test phase having caught regressions.

- **Generic config-type unification beyond PR review.** Only `PRReviewWorkflowConfig` and `WorkflowConfig` are unified (via composition). Other workflow configs that may exist in the codebase are not touched.

- **Replacing the existing `agents/regressionScenarioProof.ts` markdown format with JSON.** The artifact format stays markdown (`scenario_proof.md`) for review compatibility; only its caller and home file change.

- **Defensive `prepare_app` + `teardown_app` slash command pair.** Earlier in the design discussion the user briefly considered making slash commands self-contained for portability. That was abandoned in favor of trashing E2E entirely and routing all dev server lifecycle through TS. No `teardown_app` slash command will be created.

- **`REVIEW_AGENT_COUNT` as a configurable knob.** The constant and the `Promise.all` parallel review machinery are deleted entirely. Review is single-agent.

- **Migration tooling for existing target repositories** that have `## Run E2E Tests` set or `e2e-tests/` directories. Migration is manual. Each target repo's `.adw/commands.md` and conventions are updated by its developers when they next run `adw_init` or by hand.

## Further Notes

This PRD is the output of a single grill-me session on 2026-04-08 (~50 questions) that combined two related grill threads: the test/review responsibility split surfaced by the leaked dev server processes, and the unfinished `workflowCompletion.ts` cleanup from a prior session (`13362077-92da-4299-b889-a2df5f4b87ea`, 2026-04-07). Both grills were re-opened together because they share the same root cause: ADW phase modules have accreted responsibilities and code that don't belong to them.

The leaked `next dev` processes that triggered the investigation were killed manually during the grill (13 processes via SIGTERM, lock released cleanly). The chore worktree `paysdoc.nl/.worktrees/chore-issue-28-remove-secrets-store-env-vars` is now in a clean state.

The runner clone (`Option A` from the grill) is set up and running. The user develops on `dev` in the existing clone; the cron trigger runs from a separate clone on `main`. Target repo workspaces under `~/.adw/repos/` are shared between the two clones; ADW's own `agents/` and `projects/` state directories are isolated. This decoupling is the safety net for the atomic-PR rollout.

A future grill-me about `adw_init` board setup with `Blocked` status is captured separately in project memory and should be picked up after this refactor lands.

The decisions in this PRD are dense. Each module change is interleaved with a behavioral change. The implementation plan that follows this PRD should sequence the work carefully so each PR is independently shippable: introduce the deep modules first (devServerLifecycle, devServerJanitor) before any phase consumes them; introduce `scenarioTestPhase` before deleting the old E2E machinery; unify `PRReviewWorkflowConfig` before refactoring `adwPrReview.tsx` to use `phaseRunner`; relocate `executeReviewPhase` and rewrite `review.md` in the same PR (since they're tightly coupled). The deletions (slash commands, dead test functions, e2e-tests convention) come last, after every consumer has been migrated.
