# Patch: Rebase onto origin/dev to preserve issue #289 artifacts

## Metadata
adwId: `x4wwk7-application-type-con`
reviewChangeRequest: `Issue #4: Branch deletes issue #289 files — rebase onto origin/dev to preserve them`

## Issue Summary
**Original Spec:** specs/issue-278-adw-r4f0gi-application-type-con-sdlc_planner-app-type-screenshot-upload.md
**Issue:** The current branch diverged from a point before issue #289 (PR #290) was merged into dev. As a result, the branch is missing three files that #289 introduced: `features/fix_bdd_scenarios_failure.feature`, `features/step_definitions/fixBddScenariosFailureSteps.ts`, and `app_docs/feature-8fns89-fix-bdd-scenarios-failure.md`. Merging this branch would effectively delete those files, removing regression test coverage for previously fixed bugs.
**Solution:** Rebase the branch onto `origin/dev` so that issue #289 artifacts are preserved alongside the new #278 changes. The two change sets have no overlapping files, so the rebase should apply cleanly with no conflicts.

## Files to Modify
No source files need modification. This is a git history operation only.

Files that will be **gained** from origin/dev after rebase:
- `features/fix_bdd_scenarios_failure.feature` (issue #289 BDD scenarios)
- `features/step_definitions/fixBddScenariosFailureSteps.ts` (issue #289 step definitions)
- `app_docs/feature-8fns89-fix-bdd-scenarios-failure.md` (issue #289 documentation)
- `.adw/conditional_docs.md` (updated conditional docs)
- `adws/agents/regressionScenarioProof.ts` (updated regression proof agent)
- `adws/phases/testPhase.ts` (updated test phase)
- `adws/phases/workflowInit.ts` (updated workflow init)
- `app_docs/agentic_kpis.md` (updated KPIs)
- `projects/AI_Dev_Workflow/*.csv` (cost tracking updates)
- `specs/issue-289-adw-8fns89-sdlc_planner-fix-bdd-scenarios-failure.md` (issue #289 spec)

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Fetch latest origin/dev
- Run `git fetch origin dev` to ensure the local ref is up-to-date

### Step 2: Rebase onto origin/dev
- Run `git rebase origin/dev`
- The two change sets have **zero overlapping files**, so the rebase should apply cleanly:
  - Branch changes: `.adw/project.md`, `README.md`, `adws/core/projectConfig.ts`, `adws/github/workflowCommentsIssue.ts`, `adws/phases/workflowCompletion.ts`, `features/application_type_screenshot_upload.feature`, `features/step_definitions/applicationTypeScreenshotUploadSteps.ts`, `specs/issue-278-*.md`
  - origin/dev changes: `.adw/conditional_docs.md`, `adws/agents/regressionScenarioProof.ts`, `adws/phases/testPhase.ts`, `adws/phases/workflowInit.ts`, `app_docs/feature-8fns89-*.md`, `features/fix_bdd_scenarios_failure.*`, `projects/AI_Dev_Workflow/*.csv`, `specs/issue-289-*.md`
- If conflicts occur unexpectedly, resolve them by keeping both sets of changes

### Step 3: Verify issue #289 files are present
- Confirm the three critical files exist after rebase:
  - `features/fix_bdd_scenarios_failure.feature`
  - `features/step_definitions/fixBddScenariosFailureSteps.ts`
  - `app_docs/feature-8fns89-fix-bdd-scenarios-failure.md`

### Step 4: Force-push the rebased branch
- Run `git push --force-with-lease` to update the remote branch with the rebased history

## Validation
Execute every command to validate the patch is complete with zero regressions.

1. `git log --oneline HEAD | head -20` — Verify the branch commits sit on top of origin/dev commits (including the #289 merge)
2. `test -f features/fix_bdd_scenarios_failure.feature && echo "OK" || echo "MISSING"` — Verify issue #289 feature file is present
3. `test -f features/step_definitions/fixBddScenariosFailureSteps.ts && echo "OK" || echo "MISSING"` — Verify issue #289 step definitions are present
4. `test -f app_docs/feature-8fns89-fix-bdd-scenarios-failure.md && echo "OK" || echo "MISSING"` — Verify issue #289 documentation is present
5. `bunx tsc --noEmit -p adws/tsconfig.json` — ADW TypeScript compilation check after rebase

## Patch Scope
**Lines of code to change:** 0 (git history operation only)
**Risk level:** low (no overlapping files; force-with-lease protects against unexpected remote changes)
**Testing required:** Verify files exist after rebase, run TypeScript compilation to confirm no integration breakage
