# PR-Review: Unit test directories still present

## PR-Review Description
The reviewer (paysdoc) flagged that the `__tests__/` directories under `adws/` were never actually deleted. The PR description and checklist claim "All `adws/*/__tests__/` directories and files removed," but all 98 test files across 12 `__tests__/` directories remain on disk. The build agent updated `.adw/project.md`, `guidelines/coding_guidelines.md`, and `README.md` correctly but failed to execute the actual file deletions.

## Summary of Original Implementation Plan
The original plan at `specs/issue-169-adw-1773386141689-alfbmn-sdlc_planner-remove-adw-unit-tests.md` specified:
1. Delete 9 `__tests__/` directories under `adws/` via `rm -rf`
2. Add `## Unit Tests: disabled` to `.adw/project.md`
3. Update the **Testing** bullet in `guidelines/coding_guidelines.md`
4. Update the `README.md` project structure tree to remove `__tests__/` references
5. Run validation commands to confirm no `__tests__/` directories remain

The original plan listed 9 directories but missed 3 nested provider directories: `adws/providers/github/__tests__/`, `adws/providers/gitlab/__tests__/`, and `adws/providers/jira/__tests__/`. Steps 2–4 were completed; step 1 (the actual deletions) was not executed.

## Relevant Files
Use these files to resolve the review:

- `adws/__tests__/` — 7 test files to delete
- `adws/agents/__tests__/` — 16 test files to delete
- `adws/core/__tests__/` — 23 test files to delete
- `adws/github/__tests__/` — 14 test files to delete
- `adws/phases/__tests__/` — 10 test files + 1 helper to delete
- `adws/providers/__tests__/` — 2 test files to delete
- `adws/providers/github/__tests__/` — 3 test files to delete (missed by original plan)
- `adws/providers/gitlab/__tests__/` — 3 test files to delete (missed by original plan)
- `adws/providers/jira/__tests__/` — 3 test files to delete (missed by original plan)
- `adws/triggers/__tests__/` — 12 test files to delete
- `adws/types/__tests__/` — 1 test file to delete
- `adws/vcs/__tests__/` — 4 test files to delete
- `vitest.config.ts` — Must remain intact (verify only, no changes)
- `package.json` — Must remain intact (verify only, no changes)

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Delete all ADW unit test directories

Use `find adws -type d -name __tests__` to discover all `__tests__/` directories dynamically, then delete each one. This catches any directories missed by manual enumeration. The known 12 directories are:

- `adws/__tests__/`
- `adws/agents/__tests__/`
- `adws/core/__tests__/`
- `adws/github/__tests__/`
- `adws/phases/__tests__/`
- `adws/providers/__tests__/`
- `adws/providers/github/__tests__/`
- `adws/providers/gitlab/__tests__/`
- `adws/providers/jira/__tests__/`
- `adws/triggers/__tests__/`
- `adws/types/__tests__/`
- `adws/vcs/__tests__/`

Use `git rm -rf` so deletions are staged automatically:

```bash
git rm -rf adws/__tests__/ adws/agents/__tests__/ adws/core/__tests__/ adws/github/__tests__/ adws/phases/__tests__/ adws/providers/__tests__/ adws/providers/github/__tests__/ adws/providers/gitlab/__tests__/ adws/providers/jira/__tests__/ adws/triggers/__tests__/ adws/types/__tests__/ adws/vcs/__tests__/
```

### Step 2: Verify no `__tests__/` directories remain

Run `find adws -type d -name __tests__` to confirm all test directories are gone. The output must be empty.

### Step 3: Verify previously completed changes are still intact

Confirm the documentation updates from the original implementation are still in place:

- `grep -q '## Unit Tests: disabled' .adw/project.md && echo "OK"`
- `grep -q 'BDD scenarios' guidelines/coding_guidelines.md && echo "OK"`
- `test -f vitest.config.ts && echo "vitest.config.ts exists"`
- `grep -q '"test"' package.json && echo "test script exists"`

### Step 4: Run validation commands

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
- The prior revision plan correctly identified the issue but the deletions were never executed. This plan must be followed through to completion.
- Use `find` for dynamic discovery rather than hardcoded paths to avoid missing nested directories.
- Do NOT delete `vitest.config.ts`, `package.json` test scripts, or any test tooling — only the ADW-specific test files under `adws/`.
- Do NOT run `bun run test` as a validation command — there are no test files to run after deletion.
- The `.adw/project.md`, `guidelines/coding_guidelines.md`, and `README.md` changes from the original PR are already correct and do not need further modification.
