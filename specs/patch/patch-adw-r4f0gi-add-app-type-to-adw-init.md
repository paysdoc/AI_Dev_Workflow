# Patch: Add Application Type inference and generation to adw_init.md

## Metadata
adwId: `r4f0gi-application-type-con`
reviewChangeRequest: `specs/issue-278-adw-r4f0gi-application-type-con-sdlc_planner-app-type-screenshot-upload.md`

## Issue Summary
**Original Spec:** specs/issue-278-adw-r4f0gi-application-type-con-sdlc_planner-app-type-screenshot-upload.md
**Issue:** `adw_init.md` was not updated to include `## Application Type` as a section to generate in step 3 (Create `.adw/project.md`), nor was application type inference logic added to step 1 (Analyze the Project). Spec Step 4 was not implemented at all. This causes 3 BDD scenarios to fail.
**Solution:** Update `.claude/commands/adw_init.md`: (1) Add application type inference logic to step 1 (Analyze the Project). (2) Add `## Application Type` to the sections list in step 3 (Create `.adw/project.md`), placed after `## Script Execution`, with the inferred value.

## Files to Modify
Use these files to implement the patch:

- `.claude/commands/adw_init.md` — Add application type inference to step 1 and `## Application Type` generation to step 3

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Add application type inference logic to step 1 (Analyze the Project)
- In `.claude/commands/adw_init.md`, within step 1 ("Analyze the Project"), after the existing bullet about reading `README.md`, add a new bullet:
  - **Infer the application type** — classify the project as `web` or `cli`:
    - Classify as `web` if any of these signals are present:
      - `package.json` contains frontend framework dependencies: `react`, `next`, `vue`, `nuxt`, `angular`, `svelte`, `sveltekit`, `astro`, `remix`, `gatsby`
      - Presence of config files: `next.config.*`, `vite.config.*`, `angular.json`, `svelte.config.*`
      - Presence of directories: `src/pages/`, `src/app/`, `public/`, `static/`
    - Classify as `cli` otherwise (default)

### Step 2: Add `## Application Type` section to step 3 (Create `.adw/project.md`)
- In `.claude/commands/adw_init.md`, within step 3 ("Create `.adw/project.md`"), add `## Application Type` to the list of sections generated, placed after `## Script Execution`
- The value should be the inferred application type (`cli` or `web`) determined in step 1

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `cd /Users/martin/projects/paysdoc/AI_Dev_Workflow/.worktrees/feature-issue-278-app-type-screenshot-upload && bunx cucumber-js --tags "@adw-278"` — Run all @adw-278 tagged scenarios to verify the 3 previously-failing scenarios now pass
- `cd /Users/martin/projects/paysdoc/AI_Dev_Workflow/.worktrees/feature-issue-278-app-type-screenshot-upload && bunx cucumber-js --tags "@regression"` — Run all regression scenarios to verify zero regressions
- `bunx tsc --noEmit` — Root TypeScript compilation check
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW module TypeScript compilation check

## Patch Scope
**Lines of code to change:** ~15 lines added to adw_init.md
**Risk level:** low
**Testing required:** Run @adw-278 BDD scenarios to verify the 3 failing tests pass; run @regression to ensure no regressions
