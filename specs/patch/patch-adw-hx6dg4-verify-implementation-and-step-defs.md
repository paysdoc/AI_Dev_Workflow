# Patch: Verify robustness hardening implementation and generate passing scenario proof

## Metadata
adwId: `hx6dg4-robustness-hardening`
reviewChangeRequest: `Issue #2: @adw-315 scenarios FAILED (exit code 1, no output). All 33 BDD scenarios in features/retry_logic_resilience.feature cannot pass because the underlying source code modifications have not been made. Resolution: Complete the source code implementation per the spec, then generate step definitions for the 33 scenarios and re-run the scenario proof.`

## Issue Summary
**Original Spec:** `specs/issue-315-adw-gcisck-robustness-hardening-sdlc_planner-retry-logic-resilience.md`
**Issue:** The scenario proof at `logs/hx6dg4-robustness-hardening/scenario_proof/scenario_proof.md` recorded `@adw-315` scenarios as FAILED (exit code 1, no output). At the time the proof was generated, either the source code modifications were incomplete or the step definitions file did not exist, causing Cucumber to exit with code 1 before producing output.
**Solution:** The source code implementation across 15 files and the step definitions file (`features/step_definitions/retryLogicResilienceSteps.ts`) are now in place. Verify all 32 BDD scenarios pass, confirm validation suite is green, and ensure the implementation matches every spec requirement. Fix any assertion mismatches between step definitions and source code.

## Files to Modify
Verification-only — no files need modification unless an assertion mismatch is found:

1. `adws/core/utils.ts` — Verify `execWithRetry` utility matches step definition assertions
2. `adws/core/index.ts` — Verify `execWithRetry` export
3. `adws/github/issueApi.ts` — Verify `execWithRetry` usage in all `gh` CLI calls
4. `adws/github/prApi.ts` — Verify `execWithRetry` usage in all `gh` CLI calls
5. `adws/github/githubApi.ts` — Verify `execWithRetry` usage in `gh api user` call only
6. `adws/providers/github/githubCodeHost.ts` — Verify existing PR check + `execWithRetry`
7. `adws/agents/claudeAgent.ts` — Verify 3-attempt ENOENT retry with path re-resolution
8. `adws/phases/workflowInit.ts` — Verify pre-flight CLI validation
9. `adws/vcs/worktreeCreation.ts` — Verify `origin/<defaultBranch>` base ref
10. `adws/agents/resolutionAgent.ts` — Verify graceful degradation + retry
11. `adws/agents/validationAgent.ts` — Verify retry on non-JSON output
12. `adws/agents/reviewRetry.ts` — Verify null/undefined filter on arrays
13. `adws/triggers/autoMergeHandler.ts` — Verify skip_reason.txt writes
14. `adws/phases/autoMergePhase.ts` — Verify skip_reason.txt writes
15. `features/step_definitions/retryLogicResilienceSteps.ts` — Step definitions for all 32 scenarios

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Run BDD scenarios and verify all pass
- Execute `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-315" --format summary`
- Expect: 32 scenarios (32 passed), 133 steps (133 passed)
- If any scenario fails, read the failing step definition assertion and the corresponding source file to identify the mismatch
- Fix the source code (not the step definitions) to match the expected pattern

### Step 2: Verify step definitions exist for all 32 scenarios
- Read `features/step_definitions/retryLogicResilienceSteps.ts`
- Confirm step definitions cover all scenarios in `features/retry_logic_resilience.feature`:
  - Section 1 (execWithRetry): 7 scenarios — utility creation + 4 module adoption
  - Section 2 (Claude CLI ENOENT): 3 scenarios — retry, re-resolution, exhaustion
  - Section 3 (Pre-flight CLI): 3 scenarios — missing, non-executable, passing
  - Section 4 (Worktree origin): 3 scenarios — origin ref, dirty local, diverged warning
  - Section 5 (PR check): 3 scenarios — reuse existing, create new, check command
  - Section 6 (JSON parse): 6 scenarios — resolution retry/degrade, validation retry/degrade, array filter
  - Section 7 (Skip reason): 6 scenarios — 4 handler exits + 2 phase exits
  - Cross-cutting: 1 scenario — TypeScript compilation
- Run `bunx cucumber-js --tags "@adw-315" --dry-run` to confirm zero undefined steps

### Step 3: Fix any failing assertions (conditional)
- Only execute this step if Step 1 reports failures
- For each failing step definition assertion:
  - Read the step definition code to find the exact string match expected
  - Read the corresponding source file to find the actual code
  - Modify the source file to include the expected pattern
  - Re-run the failing scenario to confirm it passes
- Common mismatch patterns to check:
  - `execWithRetry` loop: must use `for (let attempt = 0; attempt < maxAttempts; attempt++)`
  - `execWithRetry` backoff: must use `500 * Math.pow(2, attempt)` and `Atomics.wait`
  - `execWithRetry` error tracking: must use `lastError` variable and `throw lastError`
  - Claude ENOENT retry: must use `for (let attempt = 0; attempt < 2; attempt++)` and `const newPath = resolveClaudeCodePath()`
  - Pre-flight check: must include `Pre-flight check failed`, `Pre-flight check passed`, `accessSync`, `fsConstants.X_OK`
  - Worktree creation: must use `origin/${baseBranch}` or `origin/${base}` and include `differs from origin/`
  - PR check: must include `Existing PR #`, `reusing`, `return { url, number }`, `parsed.length > 0`, `gh pr create --title`
  - Resolution agent: must include `retrying once`, `parseResolutionResult(retryResult.output)`, `resolved: false, decisions: []`
  - Validation agent: must include `retrying once`, `parseValidationResult(retryResult.output)`, `aligned: false`
  - Review retry: must include `.filter(` with `issue != null` and `s != null` type guards

## Validation
Execute every command to validate the patch is complete with zero regressions.

1. `bun run lint` — Run linter to check for code quality issues
2. `bun run build` — Build the application to verify no build errors
3. `bunx tsc --noEmit` — Root TypeScript type checking
4. `bunx tsc --noEmit -p adws/tsconfig.json` — ADW-specific TypeScript type checking
5. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-315" --format summary` — Run all @adw-315 BDD scenarios (expect 32 passed)

## Patch Scope
**Lines of code to change:** 0 (verification-only — source code and step definitions already implemented)
**Risk level:** low (all changes already applied, this patch verifies correctness)
**Testing required:** BDD scenario proof via Cucumber + TypeScript compilation + linting
