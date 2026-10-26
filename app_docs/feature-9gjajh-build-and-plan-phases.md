# Build and Plan Phases

## Overview

The build and plan phases translate issue analysis into a committed implementation. The plan itself is never committed: it stays in the worktree that wrote it. The install phase primes agent context; the plan phase classifies the issue, produces the spec file, and builds the git-authoritative continuation prompt used to restart a build agent without redoing completed work; the plan validation phase aligns the spec with BDD scenarios; the alignment phase runs a single-pass reconciliation of the plan against BDD scenarios; the build phase implements the spec with token-limit recovery and resume-in-place support.

## Responsibilities

- `lostPlanGate.ts` — `planCreatedByEarlierRun(recoveryState)` (pure: `canResume && !shouldExecuteStage('plan_created', …)`) and `parkIfPlanLost(config, phase)`, which parks a resumed workflow as `worktree_lost` via `parkWorkflow` when an earlier run created the plan and this run's worktree has none; otherwise it returns. Called by the plan phase (top, before its first `await`, only when `!planFileExists`), the plan-validation phase (in its `!planContent` branch) and the build phase (in its plan-read `catch`), always before the throw or the planner
- `installPhase.ts` — runs the install agent in the worktree, parses tool results (Read/Bash) from the JSONL output into a `<project-context>` preamble, caches it to `agents/{adwId}/install_cache.md`, and populates `config.installContext` for injection into later agents; entirely non-fatal
- `planPhase.ts` — runs `runPlanAgent` with the issue type slash command, corrects swapped plan filenames, reads the plan file for the issue comment summary, commits nothing, and posts stage comments at each step (`plan_building`, `plan_created`)
- `planPhase.ts` — `buildContinuationPrompt(originalPlanContent, previousOutput, reason, baseBranch?, checkpointCommitsPresent?)`: pure string builder for the git-authoritative continuation prompt given to a restarted build agent, whether restarted within the same orchestrator run (token limit / context compaction) or across orchestrators (resume-in-place after a phase timeout or liveness reclaim). When `checkpointCommitsPresent` is `true` (or `reason` is `'resumed_in_place'`), it instructs the agent to inspect committed state (`git log`, `git diff`) and uncommitted state (`git status`, `git diff --staged`) before writing code, demoting the previous-output tail to a secondary hint; when `false`, it preserves the legacy prompt shape used by fresh first-pass builds. Both variants close, after `</previous-agent-output>`, with a `## Completion Check` section (check every plan step against the git state before changing anything; if all are done and the plan's validation commands pass, make no further edits and end with a line holding only `BUILD_COMPLETE`) and a `## Scope` section (once every plan step is done, refactors, extra hardening, stress tests, fuzz runs and mutation tests are out of scope, and uncommitted edits outside the plan's steps are not work to continue).
- `planPhase.ts` — `buildResumeInPlacePrompt(originalPlanContent, baseBranch?)`: thin wrapper calling `buildContinuationPrompt` with `reason: 'resumed_in_place'`, an empty previous-output string, and `checkpointCommitsPresent: true`; used by `buildPhase.ts` on cross-orchestrator resumes where no in-process summary is available and the git state is authoritative.
- `planPhase.ts` — `shouldResumeBuildInPlace(recoveryState)`: pure predicate (`recoveryState.canResume === true`) that determines whether `executeBuildPhase` seeds the first build-agent invocation with the resume-in-place framing rather than the raw plan. `buildResumeInPlacePrompt` and `shouldResumeBuildInPlace` are re-exported from `adws/phases/index.ts` and `adws/workflowPhases.ts` alongside `buildContinuationPrompt` and `MAX_CONTINUATION_OUTPUT_LENGTH`.
- `planValidationPhase.ts` — discovers BDD scenario files tagged `@adw-{N}`; runs the validation agent to detect plan-scenario mismatches; enters a resolution loop (up to `MAX_VALIDATION_RETRY_ATTEMPTS`) where `runResolutionAgent` fixes mismatches then `runValidationAgent` re-validates; commits artifacts if any changes were made
- `buildPhase.ts` — reads the plan file, seeds `currentPlanContent` with the resume-in-place prompt when `shouldResumeBuildInPlace(recoveryState)` is true (otherwise the raw plan), then enters a `while(!buildCompleted)` loop that respawns the build agent on token limit or compaction events, recomputing `currentPlanContent` from the raw plan on each in-loop restart; when a stopped run's output passes `reportsBuildComplete`, skips the recovery comment and the within-batch restart, commits if dirty, evaluates the gate with `completionReported`, and on `complete` takes the normal success path (no further agent run); otherwise, after `MAX_CONTEXT_RESETS` within a batch, commits a checkpoint and evaluates the progress gate; throws on progress gate abort; commits implementation after the loop
- `alignmentPhase.ts` — single-pass reconciliation of the plan against BDD scenario files: reads the plan and every `@adw-{issueNumber}` scenario file, runs `runAlignmentAgent` once with the GitHub issue JSON as the source of truth, and folds any unresolvable conflicts into inline warnings on the plan rather than halting the workflow; commits updated plan/scenario artifacts via `runCommitAgent` when the agent reports changes
- `alignmentPhase.ts` — skips (zero-cost, non-fatal) when the stage already completed on recovery, when `scenarioAuthoringSkipReason(issue.labels)` returns a reason (`adws/core/adwLabels.ts`, #820 — `regression-promotion` or `adw:none`), when no plan file exists yet, or when no `@adw-{issueNumber}` scenario files are found; the label-reason skip logs which label decided it and is defense-in-depth on top of the "no scenario files" skip, since a `shouldSkipScenarioAuthoring`-gated issue has no scenarios to discover anyway

## Contracts & Invariants

- `installPhase.ts` always returns a cost result (possibly zero-cost); it never throws — errors are caught and logged
- `planPhase.ts` skips the plan agent when `planFileExists()` returns true (idempotent on recovery)
- The plan phase adds no commit and runs no guard: the plan, and every other change the planner makes (`.claude/` and `.adw/` included), stays uncommitted in the worktree. The per-issue scenario file and the other changes land in the next commit that stages the whole worktree (`alignment-agent`, otherwise `build-agent`).
- The plan stays out of the branch because worktree setup appends `specs/` to the worktree's tracked `.gitignore` (`ignoreSpecsInWorktree`), and later phases read the plan from the worktree by path.
- The `plan_committing` stage and its "Committing Plan" comment no longer exist. A run that posted that comment before the release resumes after `plan_created`, because `detectRecoveryState` ignores comments it cannot map to a stage.
- Other phases commit through `runCommitAgent` (`/commit`, `git add -A`); the plan phase does not commit.
- `buildContinuationPrompt()` is a pure function (string-in / string-out, no I/O, no mutation). The no-checkpoint path (`checkpointCommitsPresent: false`, non-resume reason) keeps the legacy pre-continuation body and appends only the completion-check and scope sections; fresh (non-resume) builds (`recoveryState.canResume === false`) still receive `planContent` exactly as before, since the first context uses the raw plan.
- `buildResumeInPlacePrompt` always passes an **empty** previous-output string — correct because a cross-orchestrator resume has no in-process summary, so the git state is declared authoritative instead.
- The `'resumed_in_place'` reason always emits the `checkpointCommitsPresent: true` body (inventory + continue instructions), regardless of whether the reused worktree actually has checkpoint commits; the instruction degrades gracefully to "start from step 1" when little or no work is present. `shouldResumeBuildInPlace`'s `canResume === true` trigger fires for both a REUSE-gated and a RESET-gated resume — harmless on a RESET-then-resume, since the agent inspects, finds no partial code, and starts at step 1.
- In-build restarts (token-limit / compaction) inside a resumed run recompute `currentPlanContent` from raw `planContent` in `buildPhase.ts`'s continuation loop — the resume seed is not re-applied on those restarts, preventing double-wrapping.
- The `reason` parameter union is `'token_limit' | 'compaction' | 'resumed_in_place'`; adding a fourth value requires a new `reasonMessage` branch, but the function's body is otherwise additive.
- `buildPhase.ts` accumulates cost and model usage across all continuation spawns
- The progress gate in `buildPhase.ts` aborts when the worktree tree hash has not advanced after a full batch of `MAX_CONTEXT_RESETS` resets; this prevents infinite looping on a stuck agent. A stopped agent that printed the `BUILD_COMPLETE` line ends the build instead, whatever the tree hash does
- `planValidationPhase.ts` exits early (not an error) when no scenario files are tagged for the issue
- `planValidationPhase.ts` degrades gracefully when `OutputValidationError` is thrown by either validation or resolution agent: it logs a warning and returns without throwing
- `alignmentPhase.ts` never throws — an `OutputValidationError` (or any other alignment-agent failure) is caught, logged, and converted into an `aligned: true` result carrying a single warning, so a broken alignment agent never blocks the workflow
- `alignmentPhase.ts` posts `plan_aligning`/`plan_aligned` stage comments only when `config.repoContext` is set; it never constructs its own forge context (the #796/#820 "skip when no repoContext" precedent)

- `parkIfPlanLost` is called only by a phase that has already found no plan, and it never returns when it parks. A fresh run, or a resume before `plan_created`, returns, so the planner runs or `Cannot read plan file` is thrown exactly as before.
- The planner never runs again once an earlier run created the plan. The recovery state is read once at init from the issue's comments, so it reflects earlier runs only and never this run's planner.
- The park names the earlier run's plan path (`recoveryState.planPath`), falling back to `getPlanFilePath`, and the worktree. It posts no phase-opening comment and starts no agent; in a parallel group the plan phase parks before the scenario phase starts.

## Configuration

- `MAX_CONTEXT_RESETS` — maximum agent respawns per batch before a checkpoint commit
- `MAX_PROGRESS_CHECKPOINTS` — maximum checkpoint commits before aborting
- `MAX_VALIDATION_RETRY_ATTEMPTS` — maximum plan-scenario resolution cycles
- `config.installContext` — injected into plan and scenario agents as a context preamble
- `config.projectConfig.commands.runTests` — used by the unit test phase, not the build phase
- Board status updates (`moveToStatus`) use `config.repoContext` when available
- No operator configuration governs continuation framing directly: `defaultBranch` (resolved by `initializeWorkflow()` and stored on `WorkflowConfig`) is passed as `baseBranch` to `buildResumeInPlacePrompt`, and `recoveryState` (also sourced from `WorkflowConfig`) drives `shouldResumeBuildInPlace`.

## Gotchas

- A pipeline host still running code that commits plans with a plain `git add` fails on the ignored `specs/` path; the ignore and the end of the plan commit must reach the host in the same release.
- A plan the planner leaves tracked by git (for example one a prior commit added) is not hidden by the ignore.
- `installPhase.ts` extracts context from the install agent's JSONL by pairing `tool_use` (Read/Bash) blocks with their `tool_result` responses; only non-error results are included
- `buildPhase.ts` posts a `build_progress` comment at most once per minute (`PROGRESS_UPDATE_INTERVAL_MS = 60000`) to avoid flooding the issue
- `buildPhase.ts` logs an estimate-vs-actual cost comparison when `costSource === 'extractor_finalized'` and both estimated and actual usage are present
- `planValidationPhase.ts` commits updated artifacts only when the resolution agent returned at least one decision (`artifactsChanged`); a resolution with zero decisions produces no commit
- Only a line that is exactly `BUILD_COMPLETE` (trimmed) counts as a completion report; prose, backticks or a longer token fall back to a restart. Edits made after the marker in the same context are committed with the build; the prompt forbids them and the later phases validate the branch.
- The build phase does not commit on its own after a successful build agent run — `shouldExecuteStage('build_committing', recoveryState)` guards a separate explicit `runCommitAgent` call
- `buildResumeInPlacePrompt(plan)` called with an undefined `baseBranch` produces base-less git instructions rather than emitting a literal `origin/undefined`; callers should still always pass `defaultBranch` when it is available.
- The continuation prompt names two different git diff operators deliberately: `git log --oneline --stat origin/<base>..HEAD` (commits on HEAD not on base, two-dot) and `git diff origin/<base>...HEAD` (net changes since divergence, three-dot). This matches the canonical ADW idiom — do not conflate the two operators.
- `planPhase.ts` is kept under the 300-line ceiling per coding guidelines; adding further continuation reasons or wrapper functions should stay within that bound.
- The resume signal is only known at runtime, so it is injected through the composed prompt rather than by editing `implement.md` — the static command file is deliberately left untouched, both to satisfy the "no regression to fresh build" invariant and to avoid the recurring out-of-scope command-file revert hazard.
- `buildContinuationPrompt`, `buildResumeInPlacePrompt`, and `shouldResumeBuildInPlace` are unit-tested directly in `adws/phases/__tests__/planPhase.test.ts` (no-checkpoint, with-checkpoint, and `resumed_in_place` prompt bodies; the wrapper's equivalence to a checkpointed `buildContinuationPrompt` call; and the predicate's true/false branches) — independent of a live orchestrator run.

- An empty plan file counts as missing (`planFileExists` requires content), so a resumed run parks on it.
- `adwBuild.tsx`'s own pre-flight check for a missing plan runs before the build phase and never parks.

## Decisions

- [ADR-0023](../docs/adr/0023-context-exhaustion-is-a-reset.md) — Context exhaustion restarts the agent with fresh context; git state carries the work over
- [ADR-0024](../docs/adr/0024-tdd-in-build-phase-single-pass-alignment.md) — TDD in the build phase and single-pass plan-scenario alignment
- [ADR-0047](../docs/adr/0047-resume-in-place.md) — A recovered workflow continues in its existing worktree when git can still work there
- [ADR-0056](../docs/adr/0056-planner-commits-only-the-plan.md) — The planner commits only the plan; `.claude/` and `.adw/` are off-limits to it (the plan commit and its guard are retired; the record is kept as listed)
