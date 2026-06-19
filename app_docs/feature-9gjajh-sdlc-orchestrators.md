# SDLC Orchestrators

## Overview

The SDLC Orchestrators module provides two top-level workflow drivers — `adwSdlc.tsx` (full pipeline) and `adwPlanBuild.tsx` (lightweight pipeline) — that coordinate all agent phases for a GitHub issue from initialization through PR creation. They compose reusable phase functions from `workflowPhases.ts` and delegate lifecycle concerns (locking, heartbeating, state management) to supporting modules in `phases/`.

## Responsibilities

- Parse CLI arguments (`issueNumber`, optional `adwId`, optional `--issue-type`, optional `--target-repo`) and bootstrap a `WorkflowConfig` via `initializeWorkflow`
- Acquire a per-issue spawn lock via `runWithOrchestratorLifecycle`; exit cleanly if another orchestrator already holds the lock
- Run a heartbeat for the duration of execution so staleness detection can reclaim dead locks
- Execute ordered phase sequences via `runPhase` and `runPhasesParallel`:
  - **adwSdlc**: Install -> Plan + Scenario (parallel) -> Alignment -> Build -> StepDef -> UnitTest -> ScenarioTestFixLoop -> Review/Patch/Retest loop (bounded by `MAX_REVIEW_RETRY_ATTEMPTS`) -> Document -> PR -> ProofPublish
  - **adwPlanBuild**: Install -> Plan -> Build -> UnitTest -> PR (no scenarios, no review, no document phase)
- Track cumulative token costs via `CostTracker` and persist them on all exit paths (success, pause, error)
- Write `awaiting_merge` to top-level state after PR approval (adwSdlc only); `adwMerge.tsx` handles completion
- Call `completeWorkflow` to write `completed` stage (adwPlanBuild only)
- Intercept `AuthRequiredError` and delegate to `handleAuthRequiredPause` before falling through to `handleWorkflowError`

## Contracts & Invariants

- `initializeWorkflow` runs the upgrade gate for target-repo workflows and parks the issue (exits 0) if the target's `.adw/` is stale
- The spawn lock file persists on disk if `handleWorkflowError` or `handleAuthRequiredPause` exits via `process.exit`; the next caller reclaims it by detecting a dead PID or start-time mismatch
- `adwSdlc` never calls `completeWorkflow`; it writes `awaiting_merge` directly and relies on `adwMerge.tsx` to advance to `completed`
- `adwPlanBuild` does call `completeWorkflow`, which writes `completed` directly (no merge handoff)
- All error handlers (`handleWorkflowError`, `handleRateLimitPause`, `handleWorkflowDiscarded`) call `process.exit` synchronously, so the `finally` block in `runWithOrchestratorLifecycle` does not run on those paths
- `WorkflowConfig` is immutable after `initializeWorkflow` returns; phases read from it but do not write back to it (they write to `AgentStateManager` instead)
- GitHub App auth is activated at the start of `initializeWorkflow` so child processes spawned by phase agents do not inherit a stale `GH_TOKEN`; if a GitHub App is configured but `GITHUB_PAT` is absent, initialization fails immediately

## Configuration

Environment variables consumed at startup:

- `ANTHROPIC_API_KEY` — required; passed to all agent invocations
- `CLAUDE_CODE_PATH` — path to Claude CLI (default: `/usr/local/bin/claude`); pre-flight check verifies it is executable before any phases run
- `GITHUB_PAT` — required when a GitHub App is configured (used for PR approval)
- `MAX_TEST_RETRY_ATTEMPTS` — maximum retries for the scenario-test/fix loop (default: 5; adwSdlc only)
- `MAX_REVIEW_RETRY_ATTEMPTS` — maximum iterations of the review -> patch -> retest cycle (default: 3; adwSdlc only)

Per-repo configuration (read from the worktree at init time):

- `.adw/` directory — project config loaded via `loadProjectConfig`; absence yields defaults
- `.github/adw.yml` — controls whether the unit-test gate is enabled (`unitTests: true/false`)

## Gotchas

- If `handleWorkflowError` fires, the spawn lock is NOT released; the next cron trigger must wait for PID-liveness detection to reclaim it before a new orchestrator can start
- `adwSdlc` sets `workflowStage: awaiting_merge` as its terminal success state; anything that checks for `completed` will not see it until `adwMerge.tsx` runs
- The review phase is a passive judge: it does not start a dev server or run tests — it reads the `scenarioProofPath` produced by `executeScenarioTestPhase` and returns a verdict. The retry loop, patching, and retest are orchestrated in `adwSdlc.tsx`'s `main()`, not inside `executeReviewPhase`
- `adwPlanBuild` skips scenarios, alignment, review, and document phases entirely; it is not a subset of adwSdlc's phases at runtime — it calls `completeWorkflow` rather than writing `awaiting_merge`, so its terminal state is different
- Branch name is persisted to top-level state only when it is non-empty; the `cwd` override path never sets `branchName`, so it must not clobber a previously persisted name
- For target-repo workflows, `--target-repo` must be passed on resume; omitting it causes the respawned orchestrator to target the cron host's repo instead of the intended target
