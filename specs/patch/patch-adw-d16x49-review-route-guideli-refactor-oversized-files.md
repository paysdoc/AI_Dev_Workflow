# Patch: Apply /refactor to two files exceeding the 300-line coding-guideline cap

## Metadata
adwId: `d16x49-review-route-guideli`
reviewChangeRequest: `Issue #1: Coding-guideline violations in changed files (.adw/coding_guidelines.md → Modularity: 'Keep files under 300 lines'): adws/phases/reviewPhase.ts (344 lines, was 271) and features/per-issue/step_definitions/feature-533.steps.ts (559 lines). Resolution: Run /refactor on the listed files`

## Issue Summary
**Original Spec:** specs/issue-533-adw-d16x49-review-route-guideli-sdlc_planner-route-guideline-violations-to-refactor.md
**Issue:** Two files added/modified by issue #533 exceed the 300-line Modularity cap in `.adw/coding_guidelines.md`:
- `adws/phases/reviewPhase.ts` — 344 lines (grew from 271 with the new `applyPatchBlocker` / `applyRefactorBlockers` helpers and their JSDoc).
- `features/per-issue/step_definitions/feature-533.steps.ts` — 559 lines (new file, well over the cap).
**Solution:** Invoke the `/refactor` slash command on exactly those two files. The skill reads `.adw/coding_guidelines.md`, splits each file along cohesive seams (extracting helpers/sections into sibling modules) until every resulting file is under 300 lines, and preserves behavior. Cucumber picks up the new step-definition files automatically because it globs `features/per-issue/step_definitions/**/*.ts` (see `cucumber.js`).

## Files to Modify
Use these files to implement the patch:

- `adws/phases/reviewPhase.ts` — split so the file is under 300 lines (likely extract `applyPatchBlocker`, `applyRefactorBlockers`, and their `PatchCtx`/`RefactorCtx` interfaces into a sibling module such as `adws/phases/reviewPatchHelpers.ts`).
- `features/per-issue/step_definitions/feature-533.steps.ts` — split so the file is under 300 lines (likely along the existing section dividers: Given/When/Then groups, with hooks/helpers staying in the entry file).

New sibling files created by the refactor (the `/refactor` skill decides exact names and granularity) must remain inside `adws/phases/` and `features/per-issue/step_definitions/` respectively so Cucumber and the existing imports continue to resolve.

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Invoke /refactor on the two over-cap files
- Run the `/refactor` slash command with the explicit file list:
  - `adws/phases/reviewPhase.ts`
  - `features/per-issue/step_definitions/feature-533.steps.ts`
- The skill (see `.claude/skills/refactor/SKILL.md`) will read `.adw/coding_guidelines.md`, identify the 300-line-cap violation as the primary issue, extract cohesive units into new sibling files until each touched file is under 300 lines, and report what it changed.
- Do NOT broaden the scope — only those two files (and any new sibling files the skill creates while splitting them) are in scope. Pre-existing violations in unrelated files are out of scope.

### Step 2: Verify both target files dropped below the cap
- Run `wc -l adws/phases/reviewPhase.ts features/per-issue/step_definitions/feature-533.steps.ts` and any newly-created sibling files; confirm each line count is `< 300`.
- If either file is still ≥ 300 lines, re-invoke `/refactor` on the remaining file(s) until the cap is satisfied. If `/refactor` reports no further violations but a file is still over 300 lines, that is a skill failure — surface it and stop.

### Step 3: Run validation commands
- Execute every command in the `## Validation` section below in order. Each must exit 0.
- If `bun run lint` or either `bunx tsc --noEmit` flags new errors introduced by the split (most likely missing/duplicate exports, unused imports left behind in the original file, or wrong relative paths in imports from the new sibling files), fix them and re-run.
- If `bunx cucumber-js --tags "@regression"` reports a step as undefined after the split, the new step-definition file is either outside the `features/per-issue/step_definitions/**/*.ts` glob or duplicates a step name; fix the path/dedupe and re-run.

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `wc -l adws/phases/reviewPhase.ts features/per-issue/step_definitions/feature-533.steps.ts` plus any new sibling files — confirm every count is `< 300`.
- `bun run lint` — ESLint over the repo; must exit 0.
- `bunx tsc --noEmit` — root TypeScript type-check; must exit 0.
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW type-check (per `.adw/commands.md` `## Additional Type Checks`); must exit 0.
- `bun run build` — production build; must exit 0.
- `bun run test:unit` — Vitest; the existing `refactorAgent.test.ts` and `reviewPhase.test.ts` must still pass (they exercise the public exports, which the split preserves).
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — regression scenarios must report zero failures, confirming the feature-533 step definitions are still discovered after the split.

## Patch Scope
**Lines of code to change:** ~350–400 lines of mechanical extraction across the two files plus 2–3 new sibling files; no behavior changes.
**Risk level:** low — purely structural; public exports (`executeReviewPhase`, `executeReviewPatchCycle`, all `Given`/`When`/`Then` step bindings) remain reachable through the same import paths and the same Cucumber glob.
**Testing required:** Confirm both files drop below 300 lines, then run the full validation list above; the regression Cucumber run is the load-bearing check that the BDD step split did not break step discovery.
