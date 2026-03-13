# Feature: Define BDD Scenario Configuration in .adw/ and Establish Tagging Conventions

## Metadata
issueNumber: `164`
adwId: `1773386463517-mvb88d`
issueJson: `{"number":164,"title":"Define BDD scenario configuration in .adw/ and establish tagging conventions","body":"## Context\n\nThe ADW testing strategy is being revamped to make BDD/scenario testing the primary validation mechanism, replacing unit tests and code-diff review proof. This issue defines the configuration format and conventions that all subsequent features depend on.\n\n## Requirements\n\n### New file: \\`.adw/scenarios.md\\`\n\n- \\`## Scenario Directory\\` — relative path in the target repo where scenario files live (e.g. \\`features/\\`, \\`tests/e2e/\\`)\n- \\`## Run Scenarios by Tag\\` — tool-specific command to run scenarios by tag (e.g. \\`bunx playwright test --grep \"@{tag}\"\\` or \\`cucumber-js --tags \"@{tag}\"\\`)\n- \\`## Run Crucial Scenarios\\` — command to run all \\`@crucial\\`-tagged scenarios\n\n### Additions to \\`.adw/commands.md\\`\n\n- \\`## Run Scenarios by Tag\\` — same as above (used by workflow phase commands)\n- \\`## Run Crucial Scenarios\\` — same as above\n\n### Scenario file format\n\nThe file format is **not prescribed here** — it is determined by the tool specified in \\`## Run E2E Tests\\` in \\`commands.md\\`:\n\n- If \\`## Run E2E Tests\\` contains a real CLI command (e.g. \\`bunx playwright test\\`, \\`cucumber-js\\`) → scenario files match whatever that tool expects (e.g. \\`.spec.ts\\`, \\`.feature\\`)\n- If \\`## Run E2E Tests\\` is \\`n/a\\` or absent → default to Gherkin \\`.feature\\` files; a Cucumber setup will be bootstrapped by the Scenario Planner Agent (see dependent issue)\n\n### Tagging conventions\n\n- \\`@adw-{issueNumber}\\` — marks scenarios created, modified, or flagged as relevant for a specific GitHub issue\n- \\`@crucial\\` — marks scenarios that form the regression safety net; maintained over time by the Scenario Planner Agent\n\n### ADW project configuration\n\n- Create ADW's own \\`.adw/scenarios.md\\` as a reference implementation\n- Document tagging conventions and the format-resolution logic in \\`adws/README.md\\`\n\n## Acceptance Criteria\n\n- \\`.adw/scenarios.md\\` format is specified with examples for both the Playwright and Cucumber cases\n- \\`commands.md\\` additions are documented\n- Tagging conventions are documented in \\`adws/README.md\\`\n- ADW's own \\`.adw/scenarios.md\\` exists\n- The \\`## Run E2E Tests\\` → file format resolution logic is documented","state":"OPEN","author":"paysdoc","labels":["enhancement"],"createdAt":"2026-03-13T07:01:21Z","comments":[],"actionableComment":null}`

## Feature Description
This feature introduces a new `.adw/scenarios.md` configuration file and tagging conventions for BDD/scenario testing within the ADW ecosystem. As ADW shifts its testing strategy toward BDD/scenario testing as the primary validation mechanism, a standardized configuration format is needed so that workflow phases (plan, build, test, review) can discover scenario directories, run scenarios by tag, and execute crucial regression scenarios. This configuration serves as the foundation for all subsequent BDD-related features (e.g., Scenario Planner Agent, scenario-driven test phase).

## User Story
As an ADW workflow operator
I want to configure BDD scenario directories and run commands in `.adw/scenarios.md`
So that ADW agents can discover, tag, and execute scenario tests across any target repository regardless of the testing tool used

## Problem Statement
ADW currently has no standardized way to configure BDD/scenario testing. The `## Run E2E Tests` command in `commands.md` runs the full E2E suite, but there is no mechanism to:
1. Specify where scenario files live in the target repo
2. Run scenarios filtered by tag (e.g., only scenarios relevant to a specific issue)
3. Run crucial regression scenarios as a safety net
4. Determine what file format scenarios should use based on the project's testing tool

Without this configuration, upcoming BDD features (Scenario Planner Agent, scenario-driven test phase) have no foundation to build on.

## Solution Statement
1. Create a new `.adw/scenarios.md` configuration file with three sections: `## Scenario Directory`, `## Run Scenarios by Tag`, and `## Run Crucial Scenarios`
2. Add corresponding `## Run Scenarios by Tag` and `## Run Crucial Scenarios` headings to `.adw/commands.md` so workflow phase commands can also access these commands
3. Extend `projectConfig.ts` with a `ScenariosConfig` interface, parser (`parseScenariosMd`), heading-to-key mapping, and loader integration
4. Define tagging conventions (`@adw-{issueNumber}`, `@crucial`) and the file-format resolution logic (`## Run E2E Tests` → tool → file format)
5. Create ADW's own `.adw/scenarios.md` as a reference implementation
6. Document everything in `adws/README.md`
7. Update `/adw_init` to generate `scenarios.md` during bootstrapping

## Relevant Files
Use these files to implement the feature:

- `adws/core/projectConfig.ts` — The central config loader. Must be extended with `ScenariosConfig` interface, `parseScenariosMd()` function, `SCENARIOS_HEADING_TO_KEY` mapping, and integration into `loadProjectConfig()` and `ProjectConfig`.
- `adws/core/__tests__/projectConfig.test.ts` — Unit tests for projectConfig. Must be extended with tests for the new `ScenariosConfig`, `parseScenariosMd()`, and `loadProjectConfig()` scenarios.md loading.
- `adws/core/index.ts` — Barrel exports. Must export `ScenariosConfig`, `getDefaultScenariosConfig`, `parseScenariosMd`.
- `.adw/commands.md` — ADW's own command config. Must add `## Run Scenarios by Tag` and `## Run Crucial Scenarios` sections.
- `.adw/project.md` — ADW's project config. Must list the new `scenarios.md` file in the `.adw/` directory description.
- `adws/README.md` — ADW system documentation. Must document BDD tagging conventions, scenario configuration format, and file-format resolution logic.
- `.claude/commands/adw_init.md` — The `/adw_init` slash command. Must be updated to generate `.adw/scenarios.md` during bootstrapping.
- `.adw/conditional_docs.md` — Must add a condition for when working with `.adw/scenarios.md` or BDD scenario configuration.
- `guidelines/coding_guidelines.md` — Coding guidelines to follow during implementation.

### New Files
- `.adw/scenarios.md` — ADW's own scenario configuration (reference implementation). Contains `## Scenario Directory`, `## Run Scenarios by Tag`, and `## Run Crucial Scenarios`.

## Implementation Plan

### Phase 1: Foundation
Extend the `projectConfig.ts` module with the new `ScenariosConfig` type, parser, and heading-to-key mapping. This is the foundational change — all other files depend on the config being loadable. Add the new `scenariosMd` raw content field and parsed `scenarios` field to `ProjectConfig`. Update `loadProjectConfig()` to read `.adw/scenarios.md` and parse it.

### Phase 2: Core Implementation
1. Create ADW's own `.adw/scenarios.md` as the reference implementation (ADW uses Vitest, not Playwright/Cucumber, and has `## Run E2E Tests` as `N/A`, so it defaults to Gherkin `.feature` format)
2. Add `## Run Scenarios by Tag` and `## Run Crucial Scenarios` to `.adw/commands.md`
3. Update `CommandsConfig` and `HEADING_TO_KEY` in `projectConfig.ts` to also recognize these new command headings
4. Write comprehensive unit tests

### Phase 3: Integration
1. Update `adws/README.md` with BDD scenario configuration documentation, tagging conventions, and format-resolution logic
2. Update `.claude/commands/adw_init.md` to generate `scenarios.md` during bootstrapping
3. Update `.adw/project.md` to reference the new file
4. Update `.adw/conditional_docs.md` with conditions for scenario configuration work

## Step by Step Tasks

### Step 1: Extend `ScenariosConfig` type and parser in `projectConfig.ts`
- Add `ScenariosConfig` interface with fields: `scenarioDirectory: string`, `runByTag: string`, `runCrucial: string`
- Add `SCENARIOS_HEADING_TO_KEY` mapping: `'scenario directory' → 'scenarioDirectory'`, `'run scenarios by tag' → 'runByTag'`, `'run crucial scenarios' → 'runCrucial'`
- Add `getDefaultScenariosConfig()` returning sensible defaults: `scenarioDirectory: 'features/'`, `runByTag: 'cucumber-js --tags "@{tag}"'`, `runCrucial: 'cucumber-js --tags "@crucial"'`
- Add `parseScenariosMd(content: string): ScenariosConfig` function following the same pattern as `parseCommandsMd()` and `parseProvidersMd()`
- Add `scenarios: ScenariosConfig` and `scenariosMd: string` fields to the `ProjectConfig` interface
- Update `getDefaultProjectConfig()` to include `scenarios: getDefaultScenariosConfig()` and `scenariosMd: ''`
- Update `loadProjectConfig()` to read and parse `.adw/scenarios.md`

### Step 2: Add scenario command headings to `CommandsConfig`
- Add `runScenariosByTag: string` and `runCrucialScenarios: string` to `CommandsConfig` interface
- Add `'run scenarios by tag' → 'runScenariosByTag'` and `'run crucial scenarios' → 'runCrucialScenarios'` to `HEADING_TO_KEY`
- Update `getDefaultCommandsConfig()` with defaults: `runScenariosByTag: 'cucumber-js --tags "@{tag}"'`, `runCrucialScenarios: 'cucumber-js --tags "@crucial"'`

### Step 3: Update barrel exports in `adws/core/index.ts`
- Export `ScenariosConfig`, `getDefaultScenariosConfig`, `parseScenariosMd` from `projectConfig`

### Step 4: Create ADW's own `.adw/scenarios.md`
- Create the file with the following content:
  - `## Scenario Directory` → `features/` (ADW's scenario directory — will be created when first scenario is written)
  - `## Run Scenarios by Tag` → `cucumber-js --tags "@{tag}"` (ADW has `## Run E2E Tests: N/A`, so it defaults to Cucumber/Gherkin)
  - `## Run Crucial Scenarios` → `cucumber-js --tags "@crucial"`

### Step 5: Add scenario commands to `.adw/commands.md`
- Add `## Run Scenarios by Tag` section with value `cucumber-js --tags "@{tag}"`
- Add `## Run Crucial Scenarios` section with value `cucumber-js --tags "@crucial"`

### Step 6: Write unit tests for new scenario config
- Add tests to `adws/core/__tests__/projectConfig.test.ts`:
  - `getDefaultScenariosConfig` returns expected defaults
  - `getDefaultProjectConfig` includes scenarios and scenariosMd fields
  - `parseScenariosMd` parses all three sections correctly
  - `parseScenariosMd` returns defaults for empty content
  - `parseScenariosMd` handles partial sections (only some headings present)
  - `loadProjectConfig` loads `scenarios.md` when present
  - `loadProjectConfig` returns default scenarios config when `scenarios.md` is missing
  - `loadProjectConfig` returns empty `scenariosMd` when file is missing
  - `parseCommandsMd` parses new `runScenariosByTag` and `runCrucialScenarios` headings
  - `getDefaultCommandsConfig` includes new scenario command defaults
  - Playwright example: `parseScenariosMd` with Playwright-style commands
  - Cucumber example: `parseScenariosMd` with Cucumber-style commands

### Step 7: Document BDD scenario configuration in `adws/README.md`
- Add a new section `### BDD Scenario Configuration` under the existing `### Project Configuration (.adw/ Directory)` section
- Document the `.adw/scenarios.md` file format with all three sections
- Provide example configurations for both Playwright and Cucumber cases:
  - **Playwright example**: `## Scenario Directory` → `tests/e2e/`, `## Run Scenarios by Tag` → `bunx playwright test --grep "@{tag}"`, `## Run Crucial Scenarios` → `bunx playwright test --grep "@crucial"`
  - **Cucumber example**: `## Scenario Directory` → `features/`, `## Run Scenarios by Tag` → `cucumber-js --tags "@{tag}"`, `## Run Crucial Scenarios` → `cucumber-js --tags "@crucial"`
- Document the `## Run Scenarios by Tag` and `## Run Crucial Scenarios` additions to `commands.md`
- Document tagging conventions:
  - `@adw-{issueNumber}` — marks scenarios created, modified, or flagged as relevant for a specific GitHub issue
  - `@crucial` — marks scenarios that form the regression safety net; maintained over time by the Scenario Planner Agent
- Document the file-format resolution logic:
  - If `## Run E2E Tests` in `commands.md` contains a real CLI command → scenario files use that tool's expected format (`.spec.ts` for Playwright, `.feature` for Cucumber, etc.)
  - If `## Run E2E Tests` is `N/A` or absent → default to Gherkin `.feature` files; Cucumber setup bootstrapped by the Scenario Planner Agent

### Step 8: Update `/adw_init` to generate `scenarios.md`
- Add a new step in `.claude/commands/adw_init.md` (after step 5 "Create `.adw/review_proof.md`") to generate `.adw/scenarios.md`:
  - Detect the E2E test tool from the `## Run E2E Tests` value determined in step 2
  - If Playwright detected: `## Scenario Directory` → `tests/e2e/` (or detected test dir), `## Run Scenarios by Tag` → `bunx playwright test --grep "@{tag}"`, `## Run Crucial Scenarios` → `bunx playwright test --grep "@crucial"`
  - If Cypress detected: `## Scenario Directory` → `cypress/e2e/`, `## Run Scenarios by Tag` → `npx cypress run --spec "**/*{tag}*"`, `## Run Crucial Scenarios` → `npx cypress run --tag "@crucial"`
  - If Cucumber detected: `## Scenario Directory` → `features/`, `## Run Scenarios by Tag` → `cucumber-js --tags "@{tag}"`, `## Run Crucial Scenarios` → `cucumber-js --tags "@crucial"`
  - If E2E is N/A or absent: default to Cucumber/Gherkin: `## Scenario Directory` → `features/`, `## Run Scenarios by Tag` → `cucumber-js --tags "@{tag}"`, `## Run Crucial Scenarios` → `cucumber-js --tags "@crucial"`
- Update step 7 (Report) to include `scenarios.md` in the list of created files

### Step 9: Update `.adw/project.md`
- Add `.adw/scenarios.md` to the `.adw/**` entry in the `## Relevant Files` section with description: "BDD scenario configuration (scenario directory, run-by-tag command, crucial scenarios command)"

### Step 10: Update `.adw/conditional_docs.md`
- Add a new entry pointing to the documentation that will be created for this feature (via the `/document` phase):
  - Conditions: "When working with `.adw/scenarios.md` or BDD scenario configuration", "When implementing scenario-driven test phases", "When working with `@adw-{issueNumber}` or `@crucial` tagging conventions"

### Step 11: Run validation commands
- Run `bun run lint` to check for code quality issues
- Run `bunx tsc --noEmit` to verify TypeScript compilation
- Run `bunx tsc --noEmit -p adws/tsconfig.json` to verify adws TypeScript compilation
- Run `bun run test` to validate all tests pass with zero regressions
- Run `bun run build` to verify no build errors

## Testing Strategy

### Unit Tests
- **`parseScenariosMd` parsing**: Verify all three headings are parsed correctly into `ScenariosConfig` fields
- **`parseScenariosMd` defaults**: Empty content returns `getDefaultScenariosConfig()`
- **`parseScenariosMd` partial**: Missing headings fall back to defaults
- **`parseScenariosMd` Playwright example**: Full Playwright config parses correctly
- **`parseScenariosMd` Cucumber example**: Full Cucumber config parses correctly
- **`loadProjectConfig` with scenarios.md**: Config loads `scenarios` and `scenariosMd` when file exists
- **`loadProjectConfig` without scenarios.md**: Returns default scenarios config and empty `scenariosMd`
- **`getDefaultProjectConfig` includes scenarios**: Verify the default config includes `scenarios` and `scenariosMd` fields
- **`getDefaultScenariosConfig` values**: Verify default scenario directory, run-by-tag, and run-crucial values
- **`parseCommandsMd` with new headings**: Verify `runScenariosByTag` and `runCrucialScenarios` are parsed from commands.md
- **`getDefaultCommandsConfig` includes new fields**: Verify defaults include the two new scenario command fields
- **Existing tests still pass**: All existing `projectConfig.test.ts` tests continue to pass (no regressions)

### Edge Cases
- Empty `scenarios.md` file → returns defaults
- `scenarios.md` with unknown headings → ignored, known headings parsed
- `scenarios.md` with only one section → that section parsed, others default
- `commands.md` with new scenario headings but no `scenarios.md` → commands parsed, scenarios use defaults
- Multi-line command values in `## Run Scenarios by Tag` → preserved as-is
- `.adw/` directory exists but `scenarios.md` is missing → `scenariosMd` is empty, `scenarios` uses defaults

## Acceptance Criteria
- `.adw/scenarios.md` format is specified with `## Scenario Directory`, `## Run Scenarios by Tag`, and `## Run Crucial Scenarios` sections
- Examples for both Playwright and Cucumber cases are documented in `adws/README.md`
- `## Run Scenarios by Tag` and `## Run Crucial Scenarios` additions to `commands.md` are implemented and documented
- Tagging conventions (`@adw-{issueNumber}`, `@crucial`) are documented in `adws/README.md`
- ADW's own `.adw/scenarios.md` exists as a reference implementation
- The `## Run E2E Tests` → file format resolution logic is documented in `adws/README.md`
- `projectConfig.ts` loads and parses `.adw/scenarios.md` with proper defaults
- All new and existing unit tests pass
- `/adw_init` generates `scenarios.md` during bootstrapping
- All validation commands pass with zero errors

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Run root TypeScript type checker
- `bunx tsc --noEmit -p adws/tsconfig.json` — Run adws-specific TypeScript type checker
- `bun run test` — Run full test suite to validate zero regressions
- `bun run build` — Build the application to verify no build errors

## Notes
- **Coding guidelines**: The `guidelines/coding_guidelines.md` file must be strictly followed. Key points: strict TypeScript types (no `any`), functional patterns (map/filter/reduce), immutability, and files under 300 lines.
- **Backward compatibility**: `loadProjectConfig()` must continue to work when `scenarios.md` is absent — the `getDefaultScenariosConfig()` defaults ensure this.
- **`{tag}` placeholder convention**: The `## Run Scenarios by Tag` command uses `{tag}` as a placeholder (similar to `{PORT}` in `## Prepare App`), which agents will substitute at runtime.
- **No Cucumber dependency yet**: ADW's own `.adw/scenarios.md` references `cucumber-js` commands, but the actual Cucumber setup will be bootstrapped by the Scenario Planner Agent (a dependent issue). The configuration is forward-looking.
- **No new libraries required**: This feature only adds configuration and documentation — no new npm packages needed.
