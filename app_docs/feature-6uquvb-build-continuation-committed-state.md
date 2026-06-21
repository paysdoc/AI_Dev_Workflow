# Build Continuation Prompt: Committed-State Direction

## Overview

When a build agent is restarted — whether within the same orchestrator run (token limit / context compaction) or across orchestrators (resume-in-place after a phase timeout or liveness reclaim) — the fresh agent is given a git-authoritative "inventory and continue" prompt rather than the raw plan. This prevents the restarted agent from redoing or reverting already-completed work. All continuation framing originates from a single pure function, `buildContinuationPrompt()`, in `adws/phases/planPhase.ts`.

## Responsibilities

- **`buildContinuationPrompt(originalPlanContent, previousOutput, reason, baseBranch?, checkpointCommitsPresent?)`** — pure string builder that emits the git-authoritative continuation prompt. When `checkpointCommitsPresent` is `true` (or `reason` is `'resumed_in_place'`), it instructs the agent to inspect committed state (`git log`, `git diff`) and uncommitted state (`git status`, `git diff --staged`) before writing code, and demotes the previous-output tail to a secondary hint. When `checkpointCommitsPresent` is `false`, it preserves the legacy prompt shape (no regression to fresh first-pass builds).
- **`buildResumeInPlacePrompt(originalPlanContent, baseBranch?)`** — thin wrapper that calls `buildContinuationPrompt` with `reason: 'resumed_in_place'`, an empty previous-output string, and `checkpointCommitsPresent: true`. Used by `executeBuildPhase` on cross-orchestrator resumes where no in-process summary is available but the git state is authoritative.
- **`shouldResumeBuildInPlace(recoveryState)`** — pure predicate returning `recoveryState.canResume === true`. Determines whether `executeBuildPhase` should seed the first build-agent invocation with the resume-in-place framing rather than the raw plan.
- **Wiring in `executeBuildPhase`** — seeds `currentPlanContent` with the resume-in-place prompt when `shouldResumeBuildInPlace(recoveryState)` is true; otherwise uses the raw plan. In-build token-limit/compaction restarts recompute `currentPlanContent` from raw `planContent` on each iteration, so there is no double-wrapping.
- **Re-exports** — `buildResumeInPlacePrompt` and `shouldResumeBuildInPlace` are exported from `adws/phases/index.ts` and `adws/workflowPhases.ts` alongside `buildContinuationPrompt` and `MAX_CONTINUATION_OUTPUT_LENGTH`.

## Contracts & Invariants

- `buildContinuationPrompt()` is a **pure function** (string-in / string-out, no I/O). It never mutates state or reads from the filesystem.
- The no-checkpoint path (`checkpointCommitsPresent: false`, non-resume reason) is **byte-for-byte identical** to the pre-#561 prompt; first-pass fresh builds receive the unchanged plan.
- Fresh (non-resume) builds (`recoveryState.canResume === false`) receive `planContent` exactly as before — `shouldResumeBuildInPlace` acts as a compile-time-readable gate.
- The resume-in-place prompt (`buildResumeInPlacePrompt`) passes an **empty** previous-output string, which is correct: on a cross-orchestrator resume there is no in-process summary, and the git state is declared authoritative.
- The `'resumed_in_place'` reason emits the `checkpointCommitsPresent: true` body (inventory + continue instructions) regardless of whether the reused worktree actually has checkpoint commits; the instruction degrades gracefully to "start from step 1" when little or no work is present.
- In-build restarts (token-limit / compaction) inside a resumed run recompute `currentPlanContent` from raw `planContent` in `buildPhase.ts`'s continuation loop — the resume seed is not re-applied, preventing double-wrapping.
- The `reason` parameter union is `'token_limit' | 'compaction' | 'resumed_in_place'`. Adding a fourth value requires a new `reasonMessage` branch; the function's body is otherwise additive.

## Configuration

No operator configuration. `defaultBranch` is resolved by `initializeWorkflow()` and stored on `WorkflowConfig`; `executeBuildPhase` passes it as `baseBranch` to `buildResumeInPlacePrompt`. `recoveryState` is similarly sourced from `WorkflowConfig`.

## Gotchas

- **`baseBranch` omission** — `buildResumeInPlacePrompt(plan)` (undefined `baseBranch`) produces base-less git instructions; the prompt does not emit `origin/undefined`. Callers should always pass `defaultBranch` when it is available.
- **Two-dot vs three-dot git operators** — the prompt names `git log --oneline --stat origin/<base>..HEAD` (commits on HEAD not on base) and `git diff origin/<base>...HEAD` (net changes since divergence). This matches the canonical ADW idiom; do not conflate the two operators.
- **`shouldResumeBuildInPlace` trigger scope** — `canResume === true` fires for any resumed build, whether the worktree was reused (REUSE gate) or reset (RESET gate). The inventory-then-continue instruction is harmless on a RESET-then-resume (agent inspects, finds no partial code, starts at step 1), so the broader trigger is intentional and safe.
- **`planPhase.ts` line budget** — the module is kept under the 300-line ceiling per coding guidelines. Adding further reasons or wrappers should stay within that bound.
- **`implement.md` is not modified** — the resume signal is only known at runtime; injecting it through the composed prompt (not the static command file) is the only way to satisfy the "no regression to fresh build" invariant and to avoid the recurring out-of-scope command-file revert hazard.
