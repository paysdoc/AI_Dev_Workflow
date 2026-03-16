# Patch: Fix cucumber-js command not found in scenario runner

## Metadata
adwId: `jjxkk9-plan-templates-inclu`
reviewChangeRequest: `specs/issue-193-adw-jjxkk9-plan-templates-inclu-sdlc_planner-conditional-unit-tests-plan-template.md`

## Issue Summary
**Original Spec:** specs/issue-193-adw-jjxkk9-plan-templates-inclu-sdlc_planner-conditional-unit-tests-plan-template.md
**Issue:** All 3 @crucial scenarios and all @adw-193 scenarios FAILED with exit code 127 (command not found). The BDD scenario runner (`bddScenarioRunner.ts`) executes commands from `.adw/commands.md` directly via `spawn(resolvedCommand, [], { shell: true })`. The commands are `cucumber-js --tags "@{tag}"` and `cucumber-js --tags "@crucial"`, but `cucumber-js` is only available in `node_modules/.bin/` — not in the system PATH. The shell cannot find the bare `cucumber-js` binary, resulting in exit code 127.
**Solution:** Prefix the `cucumber-js` commands in `.adw/commands.md` with `bunx` so that bun resolves the binary from `node_modules/.bin/`. This matches the project's package manager (`bun`) and how other local binaries are invoked throughout the project (e.g., `bunx tsc`, `bunx tsx`).

## Files to Modify
Use these files to implement the patch:

- `.adw/commands.md` — Change `cucumber-js` to `bunx cucumber-js` in `## Run Scenarios by Tag` (line 43) and `## Run Crucial Scenarios` (line 46).

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Prefix cucumber-js commands with `bunx` in `.adw/commands.md`
- Read `.adw/commands.md`
- Change line 43 (`## Run Scenarios by Tag` value) from `cucumber-js --tags "@{tag}"` to `bunx cucumber-js --tags "@{tag}"`
- Change line 46 (`## Run Crucial Scenarios` value) from `cucumber-js --tags "@crucial"` to `bunx cucumber-js --tags "@crucial"`
- This matches the project convention: `bunx` is used for all local binaries (e.g., `bunx tsc --noEmit`, `bunx tsx <script>`)

### Step 2: Run validation commands
- `bunx cucumber-js --tags "@crucial"` — Run the 3 @crucial scenarios and verify they pass (exit code 0)
- `bun run lint` — Verify no lint issues introduced
- `bunx tsc --noEmit` — TypeScript compilation check
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW TypeScript compilation check
- `bun run test` — Run all Vitest tests to verify zero regressions

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `bunx cucumber-js --tags "@crucial"` — All 3 @crucial scenarios must pass
- `bunx cucumber-js --tags "@adw-193"` — All @adw-193 scenarios must pass
- `bun run lint` — No lint issues
- `bunx tsc --noEmit` — TypeScript compilation passes
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW TypeScript compilation passes
- `bun run test` — All Vitest tests pass with zero regressions

## Patch Scope
**Lines of code to change:** 2
**Risk level:** low
**Testing required:** @crucial and @adw-193 cucumber scenarios must pass. Existing Vitest suite must pass with zero regressions.
