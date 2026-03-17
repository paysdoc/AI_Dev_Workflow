# Patch: Restore package.json test script removed with vitest

## Metadata
adwId: `fla3u2-1773754088098`
reviewChangeRequest: `Issue #1: @regression scenario 'Test suite passes after all exports are removed' (remove_unnecessary_exports.feature:180) fails. The step 'Then the test suite exits with code 0' at removeUnnecessaryExportsSteps.ts:147 fails because 'bun run test' exits with code 1 — package.json has no 'test' script.`

## Issue Summary
**Original Spec:** specs/issue-215-adw-fla3u2-1773754088098-sdlc_planner-implement-cucumber-step-definitions.md
**Issue:** The `@regression` scenario "Test suite passes after all exports are removed" at `remove_unnecessary_exports.feature:180` fails because `bun run test` exits with code 1. The `test` script was removed from `package.json` in commit `32e3937` ("chore: remove unit tests and vitest config") when vitest was removed, but the cucumber scenario still runs `bun run test`. This is a pre-existing regression unrelated to this PR's changes.
**Solution:** Restore the `test` script in `package.json` as `"test": "bunx tsc --noEmit"`. Since vitest was removed and unit tests are disabled, the test script should run type checking — this is exactly what the scenario validates (no import breakage after removing exports). The scenario's subsequent step "And no TypeScript import errors are reported" checks for `has no exported member` in the output, which aligns with `tsc --noEmit` output.

## Files to Modify
Use these files to implement the patch:

- `package.json` — Add `"test": "bunx tsc --noEmit"` to the `scripts` section

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Add test script to package.json
- In `package.json`, add `"test": "bunx tsc --noEmit"` to the `scripts` object
- The scripts section should become:
  ```json
  "scripts": {
    "build": "tsc",
    "lint": "eslint .",
    "test": "bunx tsc --noEmit"
  }
  ```

### Step 2: Verify the fix
- Run `bun run test` to confirm it exits with code 0
- Run `bunx cucumber-js --tags "@regression" --name "Test suite passes after all exports are removed"` to confirm the specific failing scenario now passes

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `bun run test` — Verify the restored test script exits with code 0
- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Verify TypeScript compilation succeeds
- `bunx tsc --noEmit -p adws/tsconfig.json` — Verify adws-specific TypeScript compilation succeeds
- `bunx cucumber-js --tags "@regression"` — Confirm all regression-tagged scenarios pass

## Patch Scope
**Lines of code to change:** 1
**Risk level:** low
**Testing required:** Run `bun run test` to confirm exit code 0, then run the failing regression scenario to confirm it passes
