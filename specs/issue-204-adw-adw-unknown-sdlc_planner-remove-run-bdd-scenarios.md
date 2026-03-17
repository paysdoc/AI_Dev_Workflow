# Chore: Remove `## Run BDD Scenarios` and consolidate into `## Run Scenarios by Tag`

## Metadata
issueNumber: `204`
adwId: `adw-unknown`
issueJson: `{}`

## Chore Description
`## Run BDD Scenarios` in `.adw/commands.md` is a redundant special case of `## Run Scenarios by Tag`. The scenario writer always tags scenarios with `@adw-{issueNumber}`, so issue-scoped BDD scenarios can be run via `## Run Scenarios by Tag` with tag `adw-{issueNumber}`. This chore removes `runBddScenarios` from config, deletes `runBddScenarios()` from `bddScenarioRunner.ts`, refactors `runBddScenariosWithRetry` and callers to use `runScenariosByTag` with tag `adw-{issueNumber}`, and updates all documentation references.

## Relevant Files

- **`adws/agents/bddScenarioRunner.ts`** — Contains `runBddScenarios()` (to delete) and `runScenariosByTag()` (to keep).
- **`adws/agents/testRetry.ts`** — Contains `runBddScenariosWithRetry` and `BddScenarioRetryOptions` which use `runBddScenarios` internally; must be refactored to use `runScenariosByTag`.
- **`adws/agents/index.ts`** — Barrel exports `runBddScenarios`; must remove that export.
- **`adws/core/projectConfig.ts`** — Contains `runBddScenarios` in `CommandsConfig` interface, `HEADING_TO_KEY` map, and `getDefaultCommandsConfig()`; all must be removed.
- **`adws/phases/testPhase.ts`** — Caller using `projectConfig.commands.runBddScenarios` as `scenarioCommand`; must switch to `projectConfig.commands.runScenariosByTag` and pass tag `adw-{issueNumber}`.
- **`adws/adwTest.tsx`** — Caller using `projectConfig.commands.runBddScenarios` as `scenarioCommand`; same change.
- **`.adw/commands.md`** — Contains `## Run BDD Scenarios` / `N/A` section (lines 39–40); must be removed.
- **`.adw/conditional_docs.md`** — Line 112 references `## Run BDD Scenarios`; must be updated to `## Run Scenarios by Tag`.
- **`app_docs/feature-q9kms5-bdd-scenarios-before-pr.md`** — Documents the old `runBddScenarios` approach; update to reflect the new tag-based approach.

## Step by Step Tasks

### 1. Remove `## Run BDD Scenarios` from `.adw/commands.md`
- Delete the `## Run BDD Scenarios` section and its `N/A` body (lines 39–40) from `.adw/commands.md`.

### 2. Remove `runBddScenarios` from `CommandsConfig` in `adws/core/projectConfig.ts`
- Remove `runBddScenarios: string` from the `CommandsConfig` interface.
- Remove `'run bdd scenarios': 'runBddScenarios'` from `HEADING_TO_KEY`.
- Remove `runBddScenarios: 'N/A'` from `getDefaultCommandsConfig()`.

### 3. Delete `runBddScenarios()` from `adws/agents/bddScenarioRunner.ts`
- Delete the `runBddScenarios` function (lines 25–76) and its JSDoc comment.
- Keep `runScenariosByTag()` and `BddScenarioResult` unchanged.

### 4. Remove `runBddScenarios` export from `adws/agents/index.ts`
- Remove `runBddScenarios` from the `// BDD Scenario Runner` export block.

### 5. Refactor `BddScenarioRetryOptions` and `runBddScenariosWithRetry` in `adws/agents/testRetry.ts`
- In `BddScenarioRetryOptions`, replace `scenarioCommand: string` (the old `## Run BDD Scenarios` command) and `issueNumber: number` with:
  - `tagCommand: string` — the `## Run Scenarios by Tag` command template (e.g. `cucumber-js --tags "@{tag}"`).
  - `issueNumber: number` — kept; used to construct the tag `adw-{issueNumber}`.
- In `runBddScenariosWithRetry`:
  - Destructure `tagCommand` instead of `scenarioCommand`.
  - Replace all calls to `runBddScenarios(scenarioCommand, issueNumber, cwd)` with `runScenariosByTag(tagCommand, `adw-${issueNumber}`, cwd)`.
  - Update the import: remove `runBddScenarios`, keep/add `runScenariosByTag` from `./bddScenarioRunner`.

### 6. Update `adws/phases/testPhase.ts` to use `runScenariosByTag`
- Change `scenarioCommand: projectConfig.commands.runBddScenarios` to `tagCommand: projectConfig.commands.runScenariosByTag` in the `runBddScenariosWithRetry` call.
- Update JSDoc comment on the `BDD scenarios gate` block to reflect the new approach.

### 7. Update `adws/adwTest.tsx` to use `runScenariosByTag`
- Change `scenarioCommand: projectConfig.commands.runBddScenarios` to `tagCommand: projectConfig.commands.runScenariosByTag` in the `runBddScenariosWithRetry` call.

### 8. Update `.adw/conditional_docs.md`
- On line 112, replace the reference to `## Run BDD Scenarios` in `.adw/commands.md` with `## Run Scenarios by Tag`.

### 9. Update `app_docs/feature-q9kms5-bdd-scenarios-before-pr.md`
- Update the `## What Was Built` section: change `runBddScenarios field in CommandsConfig` to note it has been replaced by the tag-based approach via `runScenariosByTag`.
- Update the `## How to Use` section: replace step 1's `## Run BDD Scenarios` example with a `## Run Scenarios by Tag` example using `cucumber-js --tags "@{tag}"`.
- Update the `## Configuration` table: remove the `## Run BDD Scenarios` row and add a note that issue-scoped scenarios use `## Run Scenarios by Tag` with tag `adw-{issueNumber}`.
- Update the `## Technical Implementation` / `## Files Modified` bullet for `projectConfig.ts` to reflect the removed field.

### 10. Validate
- Run all validation commands.

## Validation Commands

```sh
bun run lint
bunx tsc --noEmit
bunx tsc --noEmit -p adws/tsconfig.json
bun run build
```

## Notes
- Unit tests are disabled for this project (`## Unit Tests: disabled` in `.adw/project.md`), so no unit test step is needed.
- `runScenariosByTag` already exists and has the same N/A skip logic as `runBddScenarios` — no behaviour change for repos where the command is N/A or empty.
- The `BddScenarioRetryOptions.scenarioCommand` rename to `tagCommand` is a breaking interface change; both callers (`testPhase.ts` and `adwTest.tsx`) are updated in steps 6–7, so no other callers remain.
- `.claude/commands/scenario_writer.md` already references `## Run Scenarios by Tag` only — no change needed there.
- `.claude/commands/adw_init.md` does not generate a `## Run BDD Scenarios` section — no change needed.
- Spec files in `specs/` that reference `runBddScenarios` are historical; no functional changes needed there.
