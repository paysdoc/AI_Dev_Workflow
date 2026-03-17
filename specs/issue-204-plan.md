# PR-Review: Remove `prompts/adw_init.txt` file

## PR-Review Description
PR #205 reviewer (paysdoc) flagged `prompts/adw_init.txt` for removal. The file contains a hardcoded `/adw_init` slash command invocation with a full issue JSON payload — it is a development artifact that was committed to the repository. It is not referenced by any runtime code in `adws/` and serves no purpose in the tracked codebase. The file should be deleted from git, and the `prompts/` directory reference in `README.md` should be removed since `adw_init.txt` is the only file in that directory.

## Summary of Original Implementation Plan
The original plan (`specs/issue-204-adw-8kp95r-remove-run-bdd-scena-sdlc_planner-remove-run-bdd-scenarios-command.md`) removed the redundant `## Run BDD Scenarios` command from `.adw/commands.md` and consolidated issue-scoped BDD test execution into `## Run Scenarios by Tag`. It touched `projectConfig.ts`, `bddScenarioRunner.ts`, `testRetry.ts`, `testPhase.ts`, `adwTest.tsx`, barrel exports, and documentation files. The original plan listed `prompts/adw_init.txt` as a relevant file to update, but the reviewer now wants it deleted entirely.

## Relevant Files
Use these files to resolve the review:

- **`prompts/adw_init.txt`** — The file flagged for removal. Only file in the `prompts/` directory. Not referenced by any code in `adws/`.
- **`README.md`** (line 277) — References `prompts/` in the Project Structure section as "Prompt templates (e.g., adw_init.txt)". Must be updated to remove the `prompts/` entry since the directory will no longer exist.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Delete `prompts/adw_init.txt` from git

- Run `git rm prompts/adw_init.txt` to remove the file from git tracking and disk.
- This will also effectively remove the `prompts/` directory since it is the only file in it.

### Step 2: Update `README.md` Project Structure

- Remove the `prompts/                # Prompt templates (e.g., adw_init.txt)` line from the Project Structure section (line 277).

### Step 3: Run validation commands

- Run all validation commands to confirm zero regressions.

## Validation Commands
Execute every command to validate the review is complete with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Root TypeScript type check
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW TypeScript type check
- `bun run build` — Build the application to verify no build errors

## Notes
- `prompts/adw_init.txt` is not imported or referenced by any runtime code — only by the original implementation spec and README. Deleting it is safe.
- Since `adw_init.txt` is the only file in `prompts/`, git will automatically stop tracking the directory.
