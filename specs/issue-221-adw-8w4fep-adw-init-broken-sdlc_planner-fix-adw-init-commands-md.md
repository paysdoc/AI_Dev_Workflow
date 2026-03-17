# Bug: adw_init missing scenario sections in commands.md

## Metadata
issueNumber: `221`
adwId: `8w4fep-adw-init-broken`
issueJson: `{"number":221,"title":"adw init broken","body":"Consider https://github.com/vestmatic/vestmatic/pull/29\n\nThis is a pull request after ```/adw_init``` was run. However, commands.md is missing \n`## Run Scenarios by Tag` and `## Run Regression Scenarios`","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-17T14:10:23Z","comments":[{"author":"paysdoc","createdAt":"2026-03-17T14:12:43Z","body":"## Take action"},{"author":"paysdoc","createdAt":"2026-03-17T15:04:18Z","body":"## Take action"}],"actionableComment":null}`

## Bug Description
When `/adw_init` is run on a target repository, the generated `.adw/commands.md` file is missing two required sections: `## Run Scenarios by Tag` and `## Run Regression Scenarios`. These sections are documented in the README and `adws/README.md` as required parts of `commands.md`, and are actively consumed by `projectConfig.ts` (lines 99-100) to populate `ProjectCommands.runScenariosByTag` and `ProjectCommands.runRegressionScenarios`. Without them, the values fall back to hardcoded defaults in `projectConfig.ts` (lines 121-122) rather than being tailored to the target project's detected E2E tool.

**Expected:** After `/adw_init`, `commands.md` contains `## Run Scenarios by Tag` and `## Run Regression Scenarios` sections with values matching the detected E2E tool (the same values written to `.adw/scenarios.md` in step 7).

**Actual:** After `/adw_init`, `commands.md` is missing both sections entirely.

## Problem Statement
The `/adw_init` command template (`.claude/commands/adw_init.md`) step 2 lists the sections to generate for `commands.md`, but omits `## Run Scenarios by Tag` and `## Run Regression Scenarios` from the list. Step 7 correctly generates these sections in `.adw/scenarios.md`, but step 2 doesn't mirror them into `commands.md`.

## Solution Statement
Add `## Run Scenarios by Tag` and `## Run Regression Scenarios` to step 2 of `.claude/commands/adw_init.md`, with a note that the values should match what is determined in step 7 based on the detected E2E tool. This ensures the generated `commands.md` includes the scenario sections that downstream workflow phases expect.

## Steps to Reproduce
1. Run `/adw_init` on a target repository (e.g., vestmatic)
2. Inspect the generated `.adw/commands.md`
3. Observe that `## Run Scenarios by Tag` and `## Run Regression Scenarios` sections are absent
4. Compare with `.adw/scenarios.md` which correctly has both sections

## Root Cause Analysis
The `.claude/commands/adw_init.md` template step 2 enumerates 12 sections for `commands.md` but was never updated to include the two scenario-related sections when BDD scenario support was added. Step 7 (which creates `scenarios.md`) does generate the correct values, and the README documents that these should also appear in `commands.md`, but the template step 2 was not kept in sync.

The `projectConfig.ts` module (line 99-100) maps `'run scenarios by tag'` → `runScenariosByTag` and `'run regression scenarios'` → `runRegressionScenarios` from `commands.md`, with defaults (lines 121-122) as fallback. So the system still works via defaults, but the generated `commands.md` is incomplete and misleading — it doesn't reflect the E2E tool detected for the specific target project.

## Relevant Files
Use these files to fix the bug:

- `.claude/commands/adw_init.md` — The `/adw_init` command template. Step 2 lists sections for `commands.md` but is missing the two scenario sections. **This is the only file that needs editing.**
- `.adw/commands.md` — ADW's own `commands.md` showing the expected sections including `## Run Scenarios by Tag` (line 39) and `## Run Regression Scenarios` (line 42) — reference for expected output.
- `adws/core/projectConfig.ts` — Reads `commands.md` sections (lines 99-100 map the headings; lines 121-122 define defaults) — reference for confirming the heading names must match exactly.
- `guidelines/coding_guidelines.md` — Coding guidelines to follow.

## Step by Step Tasks

### 1. Add scenario sections to step 2 of adw_init.md
- Open `.claude/commands/adw_init.md`
- In step 2 ("Create `.adw/commands.md`"), add two new bullet points after `## Script Execution`:
  - `## Run Scenarios by Tag` — Command to run scenarios by tag, using `{tag}` placeholder (determined by E2E tool detection in step 7)
  - `## Run Regression Scenarios` — Command to run all `@regression`-tagged scenarios (determined by E2E tool detection in step 7)
- Add a note in step 2 that these values should be consistent with the E2E tool detected in step 7 (Playwright, Cypress, Cucumber, or default Cucumber)

### 2. Run validation commands
- Run the validation commands below to confirm no regressions.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bun run build` — Build the application to verify no build errors
- `bunx cucumber-js --tags "@adw-221"` — Run any BDD scenarios tagged for this issue (expected: none exist yet, should exit cleanly)
- Manually verify that `.claude/commands/adw_init.md` step 2 now lists `## Run Scenarios by Tag` and `## Run Regression Scenarios` in the section enumeration

## Notes
- This is a documentation/template-only fix — no runtime TypeScript code changes needed.
- The `projectConfig.ts` defaults (lines 121-122) act as a safety net, so existing target repos are not broken. But the generated `commands.md` should be complete and match the detected E2E tool.
- Adhere to `guidelines/coding_guidelines.md` — specifically clarity over cleverness and keeping changes minimal.
