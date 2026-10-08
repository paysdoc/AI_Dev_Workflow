# Build and Plan Phases

## Overview

The build and plan phases translate issue analysis into a committed implementation. The install phase primes agent context; the plan phase classifies the issue, produces the spec file, and builds the git-authoritative continuation prompt used to restart a build agent without redoing completed work; the plan validation phase aligns the spec with BDD scenarios; the alignment phase runs a single-pass reconciliation of the plan against BDD scenarios; the build phase implements the spec with token-limit recovery and resume-in-place support.

## Responsibilities

- `installPhase.ts` — runs the install agent in the worktree, parses tool results (Read/Bash) from the JSONL output into a `<project-context>` preamble, caches it to `agents/{adwId}/install_cache.md`, and populates `config.installContext` for injection into later agents; entirely non-fatal
- `planPhase.ts` — runs `runPlanAgent` with the issue type slash command, corrects swapped plan filenames, reads the plan file for the issue comment summary, commits only the plan file behind the plan commit guard, and posts stage comments at each step
- `planCommitGuard.ts` — baseline, guard and plan-only commit for the plan phase:
  - `capturePlanPhaseBaseline(gitCtx, worktreePath)` records HEAD and a sha256 of every file under `.claude/` and `.adw/` (symlinks hashed by target, not followed); `executePlanPhase` calls it before the plan agent runs
  - `assertPlanPhaseLeftOffLimitsAlone(gitCtx, worktreePath, baseline)` throws `PlanCommitGuardError` (with `paths`) naming every path under `.claude/` or `.adw/` that was created, modified or deleted since the baseline, or that appears in commits added since the baseline HEAD (read from `GitContext.diff('<head>..HEAD')` through `parseUnifiedDiff`/`touchedPaths`, so both sides of a rename show; a diff that holds text but no file header is refused rather than read as empty)
  - `commitPlanFileOnly` / `buildPlanCommitMessage` commit exactly the plan file through `GitContext.addAndCommitPaths` with the deterministic message `plan-orchestrator: <keyword>: add plan for issue #<n>`; no LLM `/commit` call is made
  - pure helpers: `isOffLimitsToPlanner`, `changedFilePaths`, `findOffLimitsChanges`
- `planPhase.ts` — `buildContinuationPrompt(originalPlanContent, previousOutput, reason, baseBranch?, checkpointCommitsPresent?)`: pure string builder for the git-authoritative continuation prompt given to a restarted build agent, whether restarted within the same orchestrator run (token limit / context compaction) or across orchestrators (resume-in-place after a phase timeout or liveness reclaim). When `checkpointCommitsPresent` is `true` (or `reason` is `'resumed_in_place'`), it instructs the agent to inspect committed state (`git log`, `git diff`) and uncommitted state (`git status`, `git diff --staged`) before writing code, demoting the previous-output tail to a secondary hint; when `false`, it preserves the legacy prompt shape used by fresh first-pass builds.
- `planPhase.ts` — `buildResumeInPlacePrompt(originalPlanContent, baseBranch?)`: thin wrapper calling `buildContinuationPrompt` with `reason: 'resumed_in_place'`, an empty previous-output string, and `checkpointCommitsPresent: true`; used by `buildPhase.ts` on cross-orchestrator resumes where no in-process summary is available and the git state is authoritative.
- `planPhase.ts` — `shouldResumeBuildInPlace(recoveryState)`: pure predicate (`recoveryState.canResume === true`) that determines whether `executeBuildPhase` seeds the first build-agent invocation with the resume-in-place framing rather than the raw plan. `buildResumeInPlacePrompt` and `shouldResumeBuildInPlace` are re-exported from `adws/phases/index.ts` and `adws/workflowPhases.ts` alongside `buildContinuationPrompt` and `MAX_CONTINUATION_OUTPUT_LENGTH`.
- `planValidationPhase.ts` — discovers BDD scenario files tagged `@adw-{N}`; runs the validation agent to detect plan-scenario mismatches; enters a resolution loop (up to `MAX_VALIDATION_RETRY_ATTEMPTS`) where `runResolutionAgent` fixes mismatches then `runValidationAgent` re-validates; commits artifacts if any changes were made
- `buildPhase.ts` — reads the plan file, seeds `currentPlanContent` with the resume-in-place prompt when `shouldResumeBuildInPlace(recoveryState)` is true (otherwise the raw plan), then enters a `while(!buildCompleted)` loop that respawns the build agent on token limit or compaction events, recomputing `currentPlanContent` from the raw plan on each in-loop restart; after `MAX_CONTEXT_RESETS` within a batch, commits a checkpoint and evaluates the progress gate; throws on progress gate abort; commits implementation after the loop
- `alignmentPhase.ts` — single-pass reconciliation of the plan against BDD scenario files: reads the plan and every `@adw-{issueNumber}` scenario file, runs `runAlignmentAgent` once with the GitHub issue JSON as the source of truth, and folds any unresolvable conflicts into inline warnings on the plan rather than halting the workflow; commits updated plan/scenario artifacts via `runCommitAgent` when the agent reports changes
- `alignmentPhase.ts` — skips (zero-cost, non-fatal) when the stage already completed on recovery, when `scenarioAuthoringSkipReason(issue.labels)` returns a reason (`adws/core/adwLabels.ts`, #820 — `regression-promotion` or `adw:none`), when no plan file exists yet, or when no `@adw-{issueNumber}` scenario files are found; the label-reason skip logs which label decided it and is defense-in-depth on top of the "no scenario files" skip, since a `shouldSkipScenarioAuthoring`-gated issue has no scenarios to discover anyway

## Contracts & Invariants

- `installPhase.ts` always returns a cost result (possibly zero-cost); it never throws — errors are caught and logged
- `planPhase.ts` skips the plan agent when `planFileExists()` returns true (idempotent on recovery)
- `planPhase.ts` skips the commit when `shouldExecuteStage('plan_committing', recoveryState)` returns false (idempotent on recovery)
- The plan commit carries the plan file and nothing else; every other worktree change, staged or not, stays uncommitted. The per-issue scenario file therefore lands in the next commit that stages the whole worktree (`alignment-agent`, otherwise `build-agent`).
- The guard runs in the orchestrator process after the plan agent has exited and throws before any commit, so the phase fails loudly and the agent cannot skip it. `.adw-version`, `.adw-stub-*` and `.claude-x` are not off-limits.
- Other phases still commit through `runCommitAgent` (`/commit`, `git add -A`); only the plan phase changed.
- `buildContinuationPrompt()` is a pure function (string-in / string-out, no I/O, no mutation). The no-checkpoint path (`checkpointCommitsPresent: false`, non-resume reason) is byte-for-byte identical to the legacy pre-continuation prompt, so fresh (non-resume) builds (`recoveryState.canResume === false`) receive `planContent` exactly as before.
- `buildResumeInPlacePrompt` always passes an **empty** previous-output string — correct because a cross-orchestrator resume has no in-process summary, so the git state is declared authoritative instead.
- The `'resumed_in_place'` reason always emits the `checkpointCommitsPresent: true` body (inventory + continue instructions), regardless of whether the reused worktree actually has checkpoint commits; the instruction degrades gracefully to "start from step 1" when little or no work is present. `shouldResumeBuildInPlace`'s `canResume === true` trigger fires for both a REUSE-gated and a RESET-gated resume — harmless on a RESET-then-resume, since the agent inspects, finds no partial code, and starts at step 1.
- In-build restarts (token-limit / compaction) inside a resumed run recompute `currentPlanContent` from raw `planContent` in `buildPhase.ts`'s continuation loop — the resume seed is not re-applied on those restarts, preventing double-wrapping.
- The `reason` parameter union is `'token_limit' | 'compaction' | 'resumed_in_place'`; adding a fourth value requires a new `reasonMessage` branch, but the function's body is otherwise additive.
- `buildPhase.ts` accumulates cost and model usage across all continuation spawns
- The progress gate in `buildPhase.ts` aborts when the worktree tree hash has not advanced after a full batch of `MAX_CONTEXT_RESETS` resets; this prevents infinite looping on a stuck agent
- `planValidationPhase.ts` exits early (not an error) when no scenario files are tagged for the issue
- `planValidationPhase.ts` degrades gracefully when `OutputValidationError` is thrown by either validation or resolution agent: it logs a warning and returns without throwing
- `alignmentPhase.ts` never throws — an `OutputValidationError` (or any other alignment-agent failure) is caught, logged, and converted into an `aligned: true` result carrying a single warning, so a broken alignment agent never blocks the workflow
- `alignmentPhase.ts` posts `plan_aligning`/`plan_aligned` stage comments only when `config.repoContext` is set; it never constructs its own forge context (the #796/#820 "skip when no repoContext" precedent)

## Configuration

- `MAX_CONTEXT_RESETS` — maximum agent respawns per batch before a checkpoint commit
- `MAX_PROGRESS_CHECKPOINTS` — maximum checkpoint commits before aborting
- `MAX_VALIDATION_RETRY_ATTEMPTS` — maximum plan-scenario resolution cycles
- `config.installContext` — injected into plan and scenario agents as a context preamble
- `config.projectConfig.commands.runTests` — used by the unit test phase, not the build phase
- Board status updates (`moveToStatus`) use `config.repoContext` when available
- No operator configuration governs continuation framing directly: `defaultBranch` (resolved by `initializeWorkflow()` and stored on `WorkflowConfig`) is passed as `baseBranch` to `buildResumeInPlacePrompt`, and `recoveryState` (also sourced from `WorkflowConfig`) drives `shouldResumeBuildInPlace`.

## Gotchas

- The guard does not undo planner changes. On a retry in the same worktree they become part of the new baseline and stay uncommitted until a later `git add -A` commit.
- In orchestrators that run the scenario agent alongside the plan phase (`adwSdlc`, `adwPlanBuildReview`, `adwPlanBuildTestReview`), a scenario-agent rewrite of `.adw/commands.md` before the plan commit is indistinguishable from a planner change and fails the plan phase; a retry passes because the change is then in the baseline.
- The plan commit uses the launch `GitContext` identity, not the host's `git config`.
- `planCommitGuard.ts` must not pass strings starting with `git ` or `gh ` to calls; the git/gh guard (`lint:git-guard`) enforces this, so only `GitContext` methods are used.
- `installPhase.ts` extracts context from the install agent's JSONL by pairing `tool_use` (Read/Bash) blocks with their `tool_result` responses; only non-error results are included
- `buildPhase.ts` posts a `build_progress` comment at most once per minute (`PROGRESS_UPDATE_INTERVAL_MS = 60000`) to avoid flooding the issue
- `buildPhase.ts` logs an estimate-vs-actual cost comparison when `costSource === 'extractor_finalized'` and both estimated and actual usage are present
- `planValidationPhase.ts` commits updated artifacts only when the resolution agent returned at least one decision (`artifactsChanged`); a resolution with zero decisions produces no commit
- The build phase does not commit on its own after a successful build agent run — `shouldExecuteStage('build_committing', recoveryState)` guards a separate explicit `runCommitAgent` call
- `buildResumeInPlacePrompt(plan)` called with an undefined `baseBranch` produces base-less git instructions rather than emitting a literal `origin/undefined`; callers should still always pass `defaultBranch` when it is available.
- The continuation prompt names two different git diff operators deliberately: `git log --oneline --stat origin/<base>..HEAD` (commits on HEAD not on base, two-dot) and `git diff origin/<base>...HEAD` (net changes since divergence, three-dot). This matches the canonical ADW idiom — do not conflate the two operators.
- `planPhase.ts` is kept under the 300-line ceiling per coding guidelines; adding further continuation reasons or wrapper functions should stay within that bound.
- The resume signal is only known at runtime, so it is injected through the composed prompt rather than by editing `implement.md` — the static command file is deliberately left untouched, both to satisfy the "no regression to fresh build" invariant and to avoid the recurring out-of-scope command-file revert hazard.
- `buildContinuationPrompt`, `buildResumeInPlacePrompt`, and `shouldResumeBuildInPlace` are unit-tested directly in `adws/phases/__tests__/planPhase.test.ts` (no-checkpoint, with-checkpoint, and `resumed_in_place` prompt bodies; the wrapper's equivalence to a checkpointed `buildContinuationPrompt` call; and the predicate's true/false branches) — independent of a live orchestrator run.

## Decisions

- [ADR-0023](../specs/adr/0023-context-exhaustion-is-a-reset.md) — Context exhaustion restarts the agent with fresh context; git state carries the work over
- [ADR-0024](../specs/adr/0024-tdd-in-build-phase-single-pass-alignment.md) — TDD in the build phase and single-pass plan-scenario alignment
- [ADR-0047](../specs/adr/0047-resume-in-place.md) — A recovered workflow continues in its existing worktree when git can still work there
- [ADR-0056](../specs/adr/0056-planner-commits-only-the-plan.md) — The planner commits only the plan; `.claude/` and `.adw/` are off-limits to it
