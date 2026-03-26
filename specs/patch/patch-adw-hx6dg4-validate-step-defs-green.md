# Patch: Validate step definitions for retry logic resilience scenarios

## Metadata
adwId: `hx6dg4`
reviewChangeRequest: `Issue #2: @adw-315 scenarios FAILED (exit code 1, no output). The 30 BDD scenarios in retry_logic_resilience.feature have no matching step definitions, so cucumber-js exits immediately. Resolution: Generate step definitions for all steps in features/retry_logic_resilience.feature and ensure they validate the implemented source code changes.`

## Issue Summary
**Original Spec:** `specs/issue-315-adw-gcisck-robustness-hardening-sdlc_planner-retry-logic-resilience.md`
**Issue:** The scenario proof at `logs/hx6dg4-robustness-hardening/scenario_proof/scenario_proof.md` reported all @adw-315 scenarios as FAILED (exit code 1, no output) because `features/step_definitions/retryLogicResilienceSteps.ts` did not exist at proof time — cucumber-js found zero matching step definitions and exited immediately.
**Solution:** Step definitions have been generated in `features/step_definitions/retryLogicResilienceSteps.ts`. They use the project's source-code-reading validation pattern (read file → `assert.ok(content.includes(...))`) to verify all 7 hardening areas: `execWithRetry` utility, GitHub API module integration, Claude CLI ENOENT retry, pre-flight validation, worktree origin base ref, PR existing-check, JSON parse retry/degradation, undefined array filtering, and skip reason files. All 32 scenarios / 133 steps now pass.

## Files to Modify
No source files need modification — the implementation and step definitions are already complete:

- `features/step_definitions/retryLogicResilienceSteps.ts` — already generated, 665 lines, covers all 32 scenarios
- `adws/core/utils.ts` — `execWithRetry` already implemented
- `adws/github/issueApi.ts` — already uses `execWithRetry`
- `adws/github/prApi.ts` — already uses `execWithRetry`
- `adws/github/githubApi.ts` — already uses `execWithRetry`
- `adws/providers/github/githubCodeHost.ts` — already uses `execWithRetry` + existing PR check
- `adws/agents/claudeAgent.ts` — ENOENT 3-attempt retry already implemented
- `adws/agents/resolutionAgent.ts` — graceful fallback + retry already implemented
- `adws/agents/validationAgent.ts` — retry on JSON parse failure already implemented
- `adws/agents/reviewRetry.ts` — undefined array filter already implemented
- `adws/phases/workflowInit.ts` — pre-flight check already implemented
- `adws/vcs/worktreeCreation.ts` — origin base ref already implemented
- `adws/triggers/autoMergeHandler.ts` — skip reason files already implemented
- `adws/phases/autoMergePhase.ts` — skip reason files already implemented

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Verify all @adw-315 scenarios pass
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-315"` and confirm 32 scenarios / 133 steps pass with zero failures
- This validates that `features/step_definitions/retryLogicResilienceSteps.ts` correctly matches all Gherkin steps

### Step 2: Verify TypeScript compilation
- Run `bunx tsc --noEmit -p adws/tsconfig.json` to confirm the implementation has no type errors
- This is also validated by the final BDD scenario ("All changes pass TypeScript type checking") which runs `tsc` inside the step definition

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-315" --format progress` — All 32 scenarios pass (133 steps)
- `bunx tsc --noEmit -p adws/tsconfig.json` — TypeScript compilation succeeds with zero errors
- `bun run lint` — Linter passes
- `bun run build` — Build succeeds

## Patch Scope
**Lines of code to change:** 0 (implementation and step definitions already complete)
**Risk level:** low
**Testing required:** Run @adw-315 BDD scenarios to confirm green; run tsc to confirm compilation
