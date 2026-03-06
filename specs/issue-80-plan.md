# PR-Review: Fix incorrect CLI flag name for reasoning effort

## PR-Review Description
The PR review identifies that `--reasoning-effort` is not a valid Claude Code CLI option. The correct flag is `--effort`. This affects two locations in `adws/agents/claudeAgent.ts` (lines 246 and 330) where the flag is passed to the CLI, plus a comment in `adws/core/config.ts` that references the wrong flag name. The documentation file also references the wrong flag name.

## Summary of Original Implementation Plan
The original plan (`specs/issue-80-adw-add-resoning-effort-4wna6z-sdlc_planner-add-reasoning-effort-to-slash-commands.md`) adds per-command reasoning effort configuration to the ADW slash command system. It defines `ReasoningEffort` type, `SLASH_COMMAND_EFFORT_MAP` / `SLASH_COMMAND_EFFORT_MAP_FAST` maps, and a `getEffortForCommand()` function in `config.ts`. It threads the effort level through `runClaudeAgent()` and `runClaudeAgentWithCommand()` in `claudeAgent.ts`, which append a CLI flag to the args array. All agent callers were updated to pass effort. The plan incorrectly assumed the flag was `--reasoning-effort` when it is actually `--effort`.

## Relevant Files
Use these files to resolve the review:

- `adws/agents/claudeAgent.ts` — Contains the two occurrences of `--reasoning-effort` on lines 246 and 330 that must be changed to `--effort`. This is the primary file to fix.
- `adws/core/config.ts` — Contains a JSDoc comment on line 212 referencing `--reasoning-effort` that should be updated to `--effort`.
- `app_docs/feature-add-resoning-effort-4wna6z-reasoning-effort-slash-commands.md` — Documentation file referencing `--reasoning-effort` that should be updated to `--effort`.
- `.adw/conditional_docs.md` — Contains a reference to `--reasoning-effort` that should be updated to `--effort`.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Fix CLI flag in `runClaudeAgent()` (claudeAgent.ts line 246)
- Change `'--reasoning-effort'` to `'--effort'` in the args array spread on line 246
- Update the `@param effort` JSDoc comment on line 217 to reference the correct flag name

### Step 2: Fix CLI flag in `runClaudeAgentWithCommand()` (claudeAgent.ts line 330)
- Change `'--reasoning-effort'` to `'--effort'` in the cliArgs array spread on line 330
- Update the `@param effort` JSDoc comment on line 292 to reference the correct flag name

### Step 3: Fix JSDoc comment in config.ts (line 212)
- Change the comment from `` `--reasoning-effort` `` to `` `--effort` `` on line 212

### Step 4: Fix documentation references
- In `app_docs/feature-add-resoning-effort-4wna6z-reasoning-effort-slash-commands.md`, replace all occurrences of `--reasoning-effort` with `--effort`
- In `.adw/conditional_docs.md`, replace `--reasoning-effort` with `--effort`

### Step 5: Run validation commands
- Run `npm run lint` to check for code quality issues
- Run `npx tsc --noEmit` to verify TypeScript compilation
- Run `npx tsc --noEmit -p adws/tsconfig.json` to verify adws TypeScript compilation
- Run `npm test` to validate all tests pass with zero regressions

## Validation Commands
Execute every command to validate the review is complete with zero regressions.

- `npm run lint` - Run linter to check for code quality issues
- `npx tsc --noEmit` - Verify TypeScript compilation for the main project
- `npx tsc --noEmit -p adws/tsconfig.json` - Verify TypeScript compilation for the adws subsystem
- `npm test` - Run all tests to validate the review is complete with zero regressions

## Notes
- The fix is purely a string rename: `--reasoning-effort` -> `--effort`. No logic, types, or test assertions need to change since the effort values themselves (`low`, `medium`, `high`, `max`) are correct.
- The tests in `slashCommandModelMap.test.ts` do not reference the CLI flag name directly, so they require no changes.
- Log messages in `claudeAgent.ts` that say "Reasoning effort:" are descriptive labels, not CLI flags, and can remain as-is.
