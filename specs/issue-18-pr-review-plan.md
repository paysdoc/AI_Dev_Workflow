# PR-Review: Fix Script Execution placeholder in `.adw/commands.md`

## PR-Review Description
The reviewer (`paysdoc`) flagged that `.adw/commands.md` line 37, under the `## Script Execution` section, currently contains just `npx tsx` but should include a placeholder indicating where the script name goes: `npx tsx <script name>`. This is consistent with how `.adw/project.md` already documents the same value as `npx tsx <script_name>` and how the spec (Step 5) distinguished between the two files — `commands.md` was incorrectly written without the placeholder. The default value in `adws/core/projectConfig.ts` and the corresponding test assertion should also be updated for consistency.

## Summary of Original Implementation Plan
The original plan (`specs/issue-18-adw-the-adw-is-too-speci-tf7slv-sdlc_planner-generalize-adw-project-config.md`) introduced a `.adw/` directory-based project configuration system to generalize the ADW. It created three config files (`commands.md`, `project.md`, `conditional_docs.md`), a `projectConfig.ts` loader module, refactored all slash command templates to read from these configs with fallback defaults, added an `/adw_init` command, and seeded the ADW repo with its own `.adw/` config files. Step 5 of the plan listed `Script Execution: npx tsx` for `commands.md` while listing `Script Execution: npx tsx <script_name>` for `project.md` — this inconsistency is the root cause of the review comment.

## Relevant Files
Use these files to resolve the review:

- `.adw/commands.md` — The file flagged in the review. Line 37 needs to change from `npx tsx` to `npx tsx <script name>`.
- `adws/core/projectConfig.ts` — Contains the default value for `scriptExecution` (line 78: `'npx tsx'`). Should be updated to `'npx tsx <script name>'` for consistency with the config file.
- `adws/__tests__/projectConfig.test.ts` — Contains the test assertion for the default `scriptExecution` value (line 61). Must be updated to match the new default.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Update `.adw/commands.md` Script Execution value
- In `.adw/commands.md`, change line 37 from `npx tsx` to `npx tsx <script name>`
- This directly resolves the reviewer's comment

### Step 2: Update the default `scriptExecution` in `adws/core/projectConfig.ts`
- In `adws/core/projectConfig.ts`, line 78, change `scriptExecution: 'npx tsx'` to `scriptExecution: 'npx tsx <script name>'`
- This keeps the programmatic default consistent with the ADW's own `.adw/commands.md` reference implementation

### Step 3: Update the test assertion in `adws/__tests__/projectConfig.test.ts`
- In `adws/__tests__/projectConfig.test.ts`, line 61, change `expect(config.commands.scriptExecution).toBe('npx tsx')` to `expect(config.commands.scriptExecution).toBe('npx tsx <script name>')`
- This keeps the test in sync with the updated default value

### Step 4: Run Validation Commands
- Run all validation commands to confirm zero regressions

## Validation Commands
Execute every command to validate the review is complete with zero regressions.

- `npm run lint` - Run linter to check for code quality issues
- `npx tsc --noEmit` - Type check main project
- `npx tsc --noEmit -p adws/tsconfig.json` - Type check ADW scripts
- `npm test` - Run all tests to validate the review is complete with zero regressions
- `npm run build` - Build the application to verify no build errors

## Notes
- The reviewer used the format `npx tsx <script name>` (with a space in the placeholder). The existing `.adw/project.md` uses `npx tsx <script_name>` (with underscore). Both are human-readable placeholders. The plan uses the reviewer's exact format since that is what was explicitly requested for `commands.md`.
- The `adws/README.md` (line 613) also documents Script Execution as `npx tsx`, but this is in a documentation example showing the section format, not a config value — updating it is not required for this review.
