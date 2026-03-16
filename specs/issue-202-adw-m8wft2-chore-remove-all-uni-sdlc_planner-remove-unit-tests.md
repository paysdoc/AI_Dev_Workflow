# Chore: Remove all unit tests

## Metadata
issueNumber: `202`
adwId: `m8wft2-chore-remove-all-uni`
issueJson: `{"number":202,"title":"chore: remove all unit tests","body":"## Summary\n\nRemove all unit test files and related Vitest configuration from the project.\n\n## Files to remove\n\n- `adws/__tests__/featurePlanTemplate.test.ts`\n- `adws/__tests__/issueDependencies.test.ts`\n- `adws/__tests__/planValidationAgent.test.ts`\n- `adws/__tests__/dependencyExtractionAgent.test.ts`\n- `adws/__tests__/planValidationPhase.test.ts`\n- `adws/agents/__tests__/resolutionAgent.test.ts`\n- `adws/agents/__tests__/claudeAgent.test.ts`\n- `adws/agents/__tests__/validationAgent.test.ts`\n- `adws/phases/__tests__/planValidationPhase.test.ts`\n\n## Additional cleanup\n\n- Remove Vitest config (`vitest.config.ts` or equivalent)\n- Remove `vitest` and related dev dependencies from `package.json`\n- Remove `test` and `test:watch` scripts from `package.json`\n- Remove any test-related CI steps if applicable\n- Clean up empty `__tests__/` directories after deletion\n\n## Acceptance criteria\n\n- [ ] All `*.test.ts` files are deleted\n- [ ] Vitest dependency and config are removed\n- [ ] Test scripts removed from `package.json`\n- [ ] Project builds/runs without errors after removal","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-16T14:25:13Z","comments":[],"actionableComment":null}`

## Chore Description
Remove all unit test files (`*.test.ts`), the Vitest test runner configuration (`vitest.config.ts`), the `vitest` dev dependency from `package.json`, the `test` and `test:watch` npm scripts, and all references to `__tests__/` directories in documentation and ESLint config. ADW no longer uses unit tests; BDD scenarios are the validation mechanism.

## Relevant Files
Use these files to resolve the chore:

- `adws/__tests__/featurePlanTemplate.test.ts` — unit test file to delete
- `adws/__tests__/issueDependencies.test.ts` — unit test file to delete
- `adws/__tests__/planValidationAgent.test.ts` — unit test file to delete
- `adws/__tests__/dependencyExtractionAgent.test.ts` — unit test file to delete
- `adws/__tests__/planValidationPhase.test.ts` — unit test file to delete
- `adws/agents/__tests__/resolutionAgent.test.ts` — unit test file to delete
- `adws/agents/__tests__/claudeAgent.test.ts` — unit test file to delete
- `adws/agents/__tests__/validationAgent.test.ts` — unit test file to delete
- `adws/phases/__tests__/planValidationPhase.test.ts` — unit test file to delete
- `vitest.config.ts` — Vitest configuration file to delete
- `package.json` — remove `vitest` dev dependency, remove `test` and `test:watch` scripts
- `eslint.config.js` — remove `__tests__` rule override block (lines 21-26)
- `README.md` — remove `__tests__/` entries from Project Structure, update Testing section
- `adws/README.md` — remove Tests section listing `__tests__/` directories (lines 638-647)
- `.adw/commands.md` — update `## Run Tests` from `bun run test` to `N/A`
- `.claude/commands/test.md` — remove ADW Tests step (step 4) that references `adws/__tests__`

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Delete all unit test files

- Delete `adws/__tests__/featurePlanTemplate.test.ts`
- Delete `adws/__tests__/issueDependencies.test.ts`
- Delete `adws/__tests__/planValidationAgent.test.ts`
- Delete `adws/__tests__/dependencyExtractionAgent.test.ts`
- Delete `adws/__tests__/planValidationPhase.test.ts`
- Delete `adws/agents/__tests__/resolutionAgent.test.ts`
- Delete `adws/agents/__tests__/claudeAgent.test.ts`
- Delete `adws/agents/__tests__/validationAgent.test.ts`
- Delete `adws/phases/__tests__/planValidationPhase.test.ts`
- After deletion, remove the now-empty directories:
  - `adws/__tests__/`
  - `adws/agents/__tests__/`
  - `adws/phases/__tests__/`

### 2. Delete Vitest configuration

- Delete `vitest.config.ts`

### 3. Remove vitest dependency and test scripts from package.json

- Remove the `"vitest"` entry from `devDependencies`
- Remove the `"test": "vitest run"` script
- Remove the `"test:watch": "vitest"` script

### 4. Run bun install to update lockfile

- Run `bun install` to regenerate `bun.lock` without vitest

### 5. Remove __tests__ ESLint rule override from eslint.config.js

- Remove the entire config block that targets `**/__tests__/**/*.ts` files (the block that disables `@typescript-eslint/no-explicit-any` for test files):
  ```js
  {
    files: ['**/__tests__/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  }
  ```

### 6. Update .adw/commands.md

- Change the `## Run Tests` section from `bun run test` to `N/A`

### 7. Update .claude/commands/test.md

- Remove the entire "ADW Tests" step (step 4) that runs `bun run test -- --run adws/__tests__`, including its heading and all bullet points
- Renumber subsequent steps (Build becomes step 4, Application Tests becomes step 5)

### 8. Update README.md project structure

- Remove the three `__tests__/` entries from the Project Structure tree:
  - `├── __tests__/          # Root-level orchestrator tests` under `adws/`
  - `│   ├── __tests__/      # Agent tests` under `agents/`
  - `│   ├── __tests__/      # Phase tests` under `phases/`
- Remove `vitest.config.ts        # Vitest test runner configuration` from the root-level entries
- Update the `## Testing` section: remove the sentence "ADW's own unit tests have been removed in favour of BDD scenarios. The test commands below remain available for target repos that opt in to unit tests via `.adw/project.md`." and the `test`/`test:watch` code block. Replace with a brief note that ADW uses BDD scenarios for validation (see `.adw/scenarios.md`).

### 9. Update adws/README.md

- Remove the **Tests** section (lines 638-647) that lists co-located `__tests__/` directories

### 10. Run validation commands

- Run all validation commands to confirm the chore is complete with zero regressions

## Validation Commands
Execute every command to validate the chore is complete with zero regressions.

- `bun run lint` — Run linter to check for code quality issues (confirms eslint.config.js change is valid)
- `bunx tsc --noEmit` — TypeScript type check for root project
- `bunx tsc --noEmit -p adws/tsconfig.json` — TypeScript type check for ADW scripts
- `bun run build` — Build the application to verify no build errors

## Notes
- IMPORTANT: Adhere to the coding guidelines in `guidelines/coding_guidelines.md`.
- Do NOT touch any files under `specs/` or `app_docs/` — they are historical artifacts and do not need updating.
- The `bun.lock` file will be automatically regenerated by `bun install` after removing vitest.
- The `.adw/project.md` already has `## Unit Tests: disabled` — no change needed there.
