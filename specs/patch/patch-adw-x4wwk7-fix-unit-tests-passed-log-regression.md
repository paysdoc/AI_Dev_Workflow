# Patch: Fix "Unit tests passed!" log outside unitTestsEnabled guard

## Metadata
adwId: `x4wwk7-application-type-con`
reviewChangeRequest: `Issue #2: Branch reverts issue #289 fixes: testPhase.ts moves 'Unit tests passed!' log outside the if(unitTestsEnabled) block (line 97), causing it to log 'Unit tests passed!' even when unit tests are disabled and skipped. This is a behavioral regression.`

## Issue Summary
**Original Spec:** `specs/issue-278-adw-r4f0gi-application-type-con-sdlc_planner-app-type-screenshot-upload.md`
**Issue:** In `adws/phases/testPhase.ts`, lines 97–98 log "Unit tests passed!" and append that message to the orchestrator state unconditionally — even when `unitTestsEnabled` is `false` and unit tests were skipped. This is a behavioral regression that reverts issue #289 fixes.
**Solution:** Move the two log statements (lines 97–98) back inside the `if (unitTestsEnabled)` block, immediately after the failure-exit guard closes (after line 91), so the success message only appears when unit tests actually ran and passed.

## Files to Modify

- `adws/phases/testPhase.ts` — Move "Unit tests passed!" log lines from outside the `if(unitTestsEnabled)` block to inside it

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Move the success log inside the `if (unitTestsEnabled)` block
- In `adws/phases/testPhase.ts`, lines 97–98 currently read:
  ```typescript
  log('Unit tests passed!', 'success');
  AgentStateManager.appendLog(orchestratorStatePath, 'Unit tests passed');
  ```
- These two lines sit **after** the closing `}` of the entire `if/else` block (line 95).
- Move them **inside** the `if (unitTestsEnabled)` branch, between line 91 (`}` closing the failure guard) and line 92 (`} else {`).
- The corrected structure should be:
  ```typescript
    if (unitTestsEnabled) {
      // ... run unit tests ...
      if (!unitTestsResult.passed) {
        // ... error handling + process.exit(1) ...
      }

      log('Unit tests passed!', 'success');
      AgentStateManager.appendLog(orchestratorStatePath, 'Unit tests passed');
    } else {
      log('Unit tests disabled — skipping', 'info');
      AgentStateManager.appendLog(orchestratorStatePath, 'Unit tests disabled — skipping');
    }
  ```
- Remove the now-empty lines 97–98 that previously held these statements.

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `grep -n "Unit tests passed" adws/phases/testPhase.ts` — Verify the log is inside the `if (unitTestsEnabled)` block (should appear at a line number between the `if (unitTestsEnabled)` opening and the `} else {`)
- `bunx tsc --noEmit` — Root TypeScript compilation check
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW module TypeScript compilation check
- `bun run lint` — Linter check for code quality
- `bun run build` — Build validation

## Patch Scope
**Lines of code to change:** ~4 (move 2 lines, remove 2 blank lines)
**Risk level:** low
**Testing required:** TypeScript compilation + lint + build. Manual review that the log now only fires when unit tests are enabled and pass.
