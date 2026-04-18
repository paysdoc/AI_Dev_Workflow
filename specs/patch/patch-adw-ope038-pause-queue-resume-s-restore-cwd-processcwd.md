# Patch: Restore cwd: process.cwd() in resumeWorkflow spawn

## Metadata
adwId: `ope038-pause-queue-resume-s`
reviewChangeRequest: `Issue #1: adws/triggers/pauseQueueScanner.ts:137 spawns with cwd: entry.worktreePath, contradicting the spec (Step 3, Notes section, and multiple in-spec warnings). The spec mandates cwd: process.cwd() because external-repo worktrees (e.g. /Users/martin/projects/paysdoc/depaudit/.worktrees/*/) do not contain adws/ scripts — verified: ls of that directory shows no adws/. As implemented, any resume of an external-repo workflow (depaudit, the exact repo in the 2026-04-18 incident this bug was filed for) will fail at module load with 'Cannot find module adws/adwSdlc.tsx', triggering the probeFailures escalation path and abandoning the workflow after MAX_UNKNOWN_PROBE_FAILURES with a 'Manual restart required' comment — the exact failure mode the fix was meant to prevent. The alignment-agent commit (1b3b488) explicitly flagged this as unresolved and said 'human reviewer must decide'; the subsequent scenario-fix-agent commit (16e67b4) chose option (b) without human input. Resolution: Revert adws/triggers/pauseQueueScanner.ts:137 to cwd: process.cwd() and restore the one-line justifying comment removed by commit 16e67b4. Then update the BDD scenarios in features/pause_queue_resume_spawn_failure.feature (lines 41, 15 of feature description) to expect cwd: process.cwd() instead of cwd: entry.worktreePath, and rerun @regression + @adw-448 scenarios to confirm green.`

## Issue Summary
**Original Spec:** specs/issue-448-adw-ope038-pause-queue-resume-s-sdlc_planner-fix-silent-resume-spawn.md
**Issue:** Commit `16e67b4` (scenario-fix-agent) changed `spawn()`'s `cwd` on `adws/triggers/pauseQueueScanner.ts:140` from `process.cwd()` to `entry.worktreePath` and removed the justifying one-line comment. The spec explicitly forbids this: target-repo worktrees (e.g. `depaudit/.worktrees/*/`) do not contain `adws/` scripts, so any external-repo resume will die at module load. The alignment-agent commit `1b3b488` marked this deviation as requiring human review; the scenario-fix-agent then resolved it against the spec without human input. The BDD feature file still reflects the old-issue-suggestion (`cwd: entry.worktreePath`) and must also be corrected so the scenarios match the spec-correct implementation.
**Solution:** (1) Revert the source line to `cwd: process.cwd()` and restore the one-line explanatory comment. (2) Update the feature file's description and the one scenario that encodes the literal `cwd: entry.worktreePath` to `cwd: process.cwd()`. (3) Remove the stale NOTE block in the step definition that described the (now-resolved) deviation. The unit test already asserts `cwd: process.cwd()`, so no test changes are needed.

## Files to Modify
Use these files to implement the patch:

- `adws/triggers/pauseQueueScanner.ts` — line 140: revert `cwd: entry.worktreePath` to `cwd: process.cwd()` and restore the justifying one-line comment above it.
- `features/pause_queue_resume_spawn_failure.feature` — line 15 (description) and lines 40-43 (scenario title + Then step): replace `cwd: entry.worktreePath` / `cwd entry.worktreePath` with `cwd: process.cwd()` / `cwd process.cwd()`.
- `features/step_definitions/pauseQueueResumeSpawnFailureSteps.ts` — remove the stale NOTE block (lines 66-69) that documented the deviation.

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Revert source file to `cwd: process.cwd()` and restore the one-line comment

- In `adws/triggers/pauseQueueScanner.ts`, locate the `spawn('bunx', ...)` call (currently line 140).
- Replace this single line:
  ```ts
      const child = spawn('bunx', spawnArgs, { detached: true, stdio: ['ignore', logFd, logFd], cwd: entry.worktreePath });
  ```
  with these two lines (restoring the comment that commit `16e67b4` removed):
  ```ts
      // cwd is pinned to cron host — target-repo worktrees do not contain adws/ scripts
      const child = spawn('bunx', spawnArgs, { detached: true, stdio: ['ignore', logFd, logFd], cwd: process.cwd() });
  ```
- This matches exactly what commit `1001ea5` (the build-agent) produced before the scenario-fix-agent regressed it.

### Step 2: Update the feature file to expect `cwd: process.cwd()`

- In `features/pause_queue_resume_spawn_failure.feature`:
  - Line 15 (feature description): change `spawns with ``cwd: entry.worktreePath``,` to `spawns with ``cwd: process.cwd()``,` (preserve surrounding prose).
  - Line 41 (scenario title): change `Scenario: resumeWorkflow passes cwd entry.worktreePath to spawn` to `Scenario: resumeWorkflow passes cwd process.cwd() to spawn`.
  - Line 43 (Then step argument): change `Then the resumeWorkflow function passes "cwd: entry.worktreePath" to spawn` to `Then the resumeWorkflow function passes "cwd: process.cwd()" to spawn`.
- Leave all other scenarios and step text unchanged.

### Step 3: Remove the stale NOTE block from the step definition

- In `features/step_definitions/pauseQueueResumeSpawnFailureSteps.ts`, delete the four-line NOTE comment block (currently lines 66-69):
  ```ts
  // NOTE: The feature scenario title says "cwd: entry.worktreePath" but the plan
  // intentionally deviates to "cwd: process.cwd()" because target-repo worktrees
  // do not contain adws/ scripts. This step checks what is actually implemented.
  // The scenario will be RED if implementation uses entry.worktreePath.
  ```
- Leave the `Then('the resumeWorkflow function passes {string} to spawn', ...)` step implementation unchanged — it already reads the expected literal from the scenario and greps for it in the source, so with the feature file updated in Step 2 it will now assert `"cwd: process.cwd()"` as intended.

## Validation
Execute every command to validate the patch is complete with zero regressions.

From the repo root (`/Users/martin/projects/paysdoc/AI_Dev_Workflow/.worktrees/bugfix-issue-448-fix-pause-queue-resume-spawn`):

1. **Type-check the ADW workspace**
   `bunx tsc --noEmit -p adws/tsconfig.json`
   Expect: zero type errors.

2. **Unit test (already asserts `cwd: process.cwd()`; was RED before this patch)**
   `bunx vitest run adws/triggers/__tests__/pauseQueueScanner.test.ts`
   Expect: all cases green, including `spawn cwd is pinned to process.cwd(), NOT entry.worktreePath`.

3. **Issue-tagged BDD scenarios**
   `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-448"`
   Expect: all scenarios under `features/pause_queue_resume_spawn_failure.feature` green, including `resumeWorkflow passes cwd process.cwd() to spawn`.

4. **Regression suite**
   `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"`
   Expect: no new regressions; the feature's `@regression`-tagged scenarios all pass.

5. **Lint**
   `bun run lint`
   Expect: zero errors on the two modified source files.

## Patch Scope
**Lines of code to change:** ~7 (1 line in source + 1 comment restored, 3 lines in feature file, 4 lines removed from step-def file)
**Risk level:** low
**Testing required:** rerun the unit test (which was pre-written to assert the spec-correct behavior) and the `@adw-448` + `@regression` cucumber tags; no new tests needed.
