# PR-Review: Unit test directories still present

## PR-Review Description
The reviewer (paysdoc) flagged that the `__tests__/` directories under `adws/` were never actually deleted. The PR description and checklist claimed "All `adws/*/__tests__/` directories and files removed," but at the time of the review (after commit `c958612`), all 93 test files across 12 `__tests__/` directories remained on disk. The build agent had updated `.adw/project.md`, `guidelines/coding_guidelines.md`, and `README.md` but failed to execute the actual file deletions.

Subsequent automated fix attempts (`88664df`, `3231e57`, `f1a5c36`) deleted the test files but also introduced unrelated changes that need to be reverted:
- `adws/adwSdlc.tsx` — renamed `computeTotalTokens` to `computeDisplayTokens` (unrelated)
- `eslint.config.js` — added `'**/*.md'` to ignores (unrelated)

## Summary of Original Implementation Plan
The original plan at `specs/issue-169-adw-1773386141689-alfbmn-sdlc_planner-remove-adw-unit-tests.md` specified:
1. Delete 9 `__tests__/` directories under `adws/` via `rm -rf`
2. Add `## Unit Tests: disabled` to `.adw/project.md`
3. Update the **Testing** bullet in `guidelines/coding_guidelines.md`
4. Update the `README.md` project structure tree to remove `__tests__/` references
5. Run validation commands to confirm no `__tests__/` directories remain

Steps 2–4 were completed in commit `c958612`. Step 1 was completed in follow-up commit `3231e57`. `vitest.config.ts` was updated with `passWithNoTests: true` in commit `f1a5c36`.

## Relevant Files
Use these files to resolve the review:

- `adws/**/__tests__/` — 12 directories totalling 93 test files; must all be deleted (already done in `3231e57`, verify only).
- `vitest.config.ts` — Added `passWithNoTests: true` so `bun run test` succeeds with zero test files (already done in `f1a5c36`, verify only).
- `adws/adwSdlc.tsx` — Has an unrelated change (`computeTotalTokens` → `computeDisplayTokens`) from commit `88664df` that must be reverted.
- `eslint.config.js` — Has an unrelated change (added `'**/*.md'` to ignores) from commit `f1a5c36` that must be reverted.
- `.adw/project.md` — Already has `## Unit Tests: disabled` (verify only).
- `guidelines/coding_guidelines.md` — Already updated with BDD rationale (verify only).
- `README.md` — Already updated to remove `__tests__/` references (verify only).
- `package.json` — Must remain intact (verify only).

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Verify all ADW unit test directories are deleted

Confirm no `__tests__/` directories remain under `adws/`:

```bash
find adws -type d -name __tests__
```

Output must be empty. If any directories remain, delete them with `git rm -rf <path>`.

### Step 2: Revert unrelated change in `adws/adwSdlc.tsx`

Commit `88664df` changed `computeTotalTokens` to `computeDisplayTokens` on line ~118. This is unrelated to issue #169. Revert this single line:

```diff
-    if (RUNNING_TOKENS) config.ctx.runningTokenTotal = computeDisplayTokens(totalModelUsage);
+    if (RUNNING_TOKENS) config.ctx.runningTokenTotal = computeTotalTokens(totalModelUsage);
```

Also verify the import statement still references `computeTotalTokens` (not `computeDisplayTokens`). Search for the import and update if needed.

### Step 3: Revert unrelated change in `eslint.config.js`

Commit `f1a5c36` added `'**/*.md'` to the eslint ignores array. This is unrelated to issue #169. Revert this change:

```diff
-    ignores: ['node_modules/', 'dist/', '.claude/', '**/*.md'],
+    ignores: ['node_modules/', 'dist/', '.claude/'],
```

### Step 4: Verify previously completed changes are intact

Confirm the documentation and config updates from the original implementation are still in place:

- `grep -q '## Unit Tests: disabled' .adw/project.md && echo "OK"`
- `grep -q 'BDD scenarios' guidelines/coding_guidelines.md && echo "OK"`
- `test -f vitest.config.ts && echo "vitest.config.ts exists"`
- `grep -q 'passWithNoTests' vitest.config.ts && echo "passWithNoTests configured"`
- `grep -q '"test"' package.json && echo "test script exists"`

### Step 5: Run validation commands

Run all validation commands to confirm zero regressions.

## Validation Commands
Execute every command to validate the review is complete with zero regressions.

- `find adws -type d -name __tests__ | head -20` — Verify no `__tests__/` directories remain under `adws/`
- `test -f vitest.config.ts && echo "vitest.config.ts exists"` — Verify vitest config is intact
- `grep -q '"test"' package.json && echo "test script exists"` — Verify package.json test script is intact
- `grep -q '## Unit Tests: disabled' .adw/project.md && echo "project.md updated"` — Verify project.md has the new section
- `grep -q 'BDD scenarios' guidelines/coding_guidelines.md && echo "guidelines updated"` — Verify guidelines reflect the new approach
- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Type check the project
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type check adws specifically

## Notes
- The core review issue (test files not deleted) was already addressed in commit `3231e57`.
- The main remaining work is reverting 2 unrelated changes that were introduced by automated fix attempts.
- `vitest.config.ts` addition of `passWithNoTests: true` is a valid related change — keeps the test command working with zero test files.
- Do NOT run `bun run test` as a validation command — `passWithNoTests` means it passes, but there are no meaningful tests to run.
- Target repos that use ADW and have their own unit tests are unaffected by this change.
