# Chore: Remove `## Run BDD Scenarios` command and consolidate into `## Run Scenarios by Tag`

## Metadata
issueNumber: `204`
adwId: `8kp95r-remove-run-bdd-scena`
issueJson: `{"number":204,"title":"Remove ## Run BDD Scenarios from commands.md and consolidate into ## Run Scenarios by Tag","body":"...","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-16T14:36:34Z","comments":[],"actionableComment":null}`

## Chore Description
`## Run BDD Scenarios` in `.adw/commands.md` is a redundant special case of `## Run Scenarios by Tag`. The scenario writer always tags scenarios with `@adw-{issueNumber}`, so running issue-scoped BDD scenarios can be achieved via `## Run Scenarios by Tag` with tag `adw-{issueNumber}` — no dedicated command is needed.

`runBddScenarios()` and `runScenariosByTag()` in `bddScenarioRunner.ts` are nearly identical — both spawn a subprocess, skip on `N/A`, and return `BddScenarioResult`. The only difference is the placeholder (`{issueNumber}` vs `{tag}`). Consolidation removes dead code and eliminates a confusing distinction.

## Relevant Files
Use these files to resolve the chore:

- **`.adw/commands.md`** (lines 39–40) — Contains the `## Run BDD Scenarios` section to remove.
- **`adws/core/projectConfig.ts`** — Contains `runBddScenarios` in `CommandsConfig` interface (line 31), `HEADING_TO_KEY` map (line 100), and `getDefaultCommandsConfig()` (line 123).
- **`adws/agents/bddScenarioRunner.ts`** (lines 25–76) — Contains the `runBddScenarios()` function to delete. Keep `runScenariosByTag()`.
- **`adws/agents/index.ts`** (line 57) — Exports `runBddScenarios` from the barrel.
- **`adws/agents/testRetry.ts`** — Contains `BddScenarioRetryOptions` (line 202–207) with `scenarioCommand` field, and `runBddScenariosWithRetry` (lines 215–274) that calls `runBddScenarios()`.
- **`adws/phases/testPhase.ts`** (line 96) — Uses `projectConfig.commands.runBddScenarios` to get the scenario command.
- **`adws/adwTest.tsx`** (line 148) — Uses `projectConfig.commands.runBddScenarios` to get the scenario command.
- **`.adw/conditional_docs.md`** (lines 111–112) — References `## Run BDD Scenarios` and `runBddScenariosWithRetry`.
- **`app_docs/feature-q9kms5-bdd-scenarios-before-pr.md`** — Historical documentation with `runBddScenarios` references; update to reflect consolidation.
- **`prompts/adw_init.txt`** — Contains reference to `## Run BDD Scenarios`; update.
- **`guidelines/coding_guidelines.md`** — Coding guidelines to follow (no changes needed).

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Remove `runBddScenarios` from config interface and parsing

- **`adws/core/projectConfig.ts`**:
  - Remove `runBddScenarios: string;` from the `CommandsConfig` interface (line 31).
  - Remove `'run bdd scenarios': 'runBddScenarios',` from the `HEADING_TO_KEY` map (line 100).
  - Remove `runBddScenarios: 'N/A',` from `getDefaultCommandsConfig()` (line 123).

### Step 2: Delete `runBddScenarios()` function from bddScenarioRunner

- **`adws/agents/bddScenarioRunner.ts`**:
  - Delete the entire `runBddScenarios()` function (lines 25–76), including its JSDoc comment.
  - Keep `BddScenarioResult` interface and `runScenariosByTag()` function unchanged.

### Step 3: Remove `runBddScenarios` from barrel exports

- **`adws/agents/index.ts`**:
  - Remove `runBddScenarios` from the `export` block under `// BDD Scenario Runner` (line 57). Keep `runScenariosByTag` and `BddScenarioResult` exports.

### Step 4: Refactor `runBddScenariosWithRetry` to use `runScenariosByTag`

- **`adws/agents/testRetry.ts`**:
  - Change the import from `import { runBddScenarios } from './bddScenarioRunner';` to `import { runScenariosByTag } from './bddScenarioRunner';`.
  - In `BddScenarioRetryOptions` interface:
    - Replace `scenarioCommand: string;` with `tagCommand: string;` (the `## Run Scenarios by Tag` command template from config).
    - Keep `issueNumber: number;` — it's still needed to construct the tag.
    - Update the JSDoc comment: change `## Run BDD Scenarios` to `## Run Scenarios by Tag`.
  - In `runBddScenariosWithRetry()`:
    - Destructure `tagCommand` instead of `scenarioCommand` from `opts`.
    - Construct the tag as `const tag = \`adw-${issueNumber}\`;`.
    - Replace `await runBddScenarios(scenarioCommand, issueNumber, cwd)` with `await runScenariosByTag(tagCommand, tag, cwd)` (two occurrences: lines 223 and 252).

### Step 5: Update `testPhase.ts` to use `runScenariosByTag` command

- **`adws/phases/testPhase.ts`**:
  - Update the doc comment (line 33) from `config.projectConfig.commands.runBddScenarios` to `config.projectConfig.commands.runScenariosByTag`.
  - Change line 96 from `const scenarioCommand = projectConfig.commands.runBddScenarios;` to `const scenarioCommand = projectConfig.commands.runScenariosByTag;`.
  - Update the `runBddScenariosWithRetry` call (line 97–105): change `scenarioCommand,` to `tagCommand: scenarioCommand,`.

### Step 6: Update `adwTest.tsx` to use `runScenariosByTag` command

- **`adws/adwTest.tsx`**:
  - Change line 148 from `scenarioCommand: projectConfig.commands.runBddScenarios,` to `tagCommand: projectConfig.commands.runScenariosByTag,`.

### Step 7: Remove `## Run BDD Scenarios` from `.adw/commands.md`

- **`.adw/commands.md`**:
  - Delete lines 39–40 (`## Run BDD Scenarios` heading and `N/A` value).

### Step 8: Update documentation references

- **`.adw/conditional_docs.md`**:
  - Line 111: Change `runBddScenariosWithRetry` to `runBddScenariosWithRetry` (function name is unchanged — keep it as-is since the function still exists, just refactored internally).
  - Line 112: Change `## Run BDD Scenarios` to `## Run Scenarios by Tag`.

- **`app_docs/feature-q9kms5-bdd-scenarios-before-pr.md`**:
  - Replace all references to `runBddScenarios` field/function with `runScenariosByTag`.
  - Replace all references to `## Run BDD Scenarios` config heading with `## Run Scenarios by Tag`.
  - Update the configuration table and any code examples that show `## Run BDD Scenarios`.

- **`prompts/adw_init.txt`**:
  - Remove/replace any references to `## Run BDD Scenarios` with `## Run Scenarios by Tag`.

- **Spec/patch files** under `specs/`: These are historical records and should not be modified.

### Step 9: Remove stale `BddScenarioRetryOptions` export rename

- **`adws/agents/index.ts`**:
  - Verify the `BddScenarioRetryOptions` export still works after the interface field rename. The type name itself is unchanged — only the `scenarioCommand` field was renamed to `tagCommand`, so no export changes needed beyond Step 3.

### Step 10: Run validation commands

- Run `bun run lint` to check for code quality issues.
- Run `bunx tsc --noEmit` to verify type checking passes.
- Run `bunx tsc --noEmit -p adws/tsconfig.json` to verify adws type checking passes.
- Run `bun run build` to verify no build errors.

## Validation Commands
Execute every command to validate the chore is complete with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Root TypeScript type check
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW TypeScript type check
- `bun run build` — Build the application to verify no build errors

## Notes
- IMPORTANT: Strictly adhere to the coding guidelines in `guidelines/coding_guidelines.md`.
- The `runBddScenariosWithRetry` function name is kept as-is to avoid unnecessary churn in callers — only its internals change to use `runScenariosByTag` instead of the deleted `runBddScenarios`.
- The `BddScenarioRetryOptions` type name is kept as-is — only the `scenarioCommand` field is renamed to `tagCommand` to accurately reflect that it now uses the tag-based command template.
- Spec and patch files under `specs/` are historical records and should NOT be modified.
- Unit tests are disabled for this project (`.adw/project.md` has `## Unit Tests: disabled`), so no unit tests need to be added.
- `output.jsonl` contains references but is a generated artifact — do not modify.
