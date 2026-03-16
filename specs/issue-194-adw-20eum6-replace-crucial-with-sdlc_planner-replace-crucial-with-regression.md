# Feature: Replace @crucial with @regression

## Metadata
issueNumber: `194`
adwId: `20eum6-replace-crucial-with`
issueJson: `{"number":194,"title":"replace @crucial with @regression","body":"/feature\n\nThe review mechanism runs regression tests by checking which features contain the label `@crucial`. Replace this label and all references to it  by the more descriptive `@regression`","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-16T11:22:29Z","comments":[],"actionableComment":null}`

## Feature Description
The review mechanism runs regression tests by checking which BDD scenarios are tagged `@crucial`. This tag name is vague and does not clearly communicate the intent — these are regression safety-net scenarios. This feature renames the `@crucial` tag to `@regression` across the entire codebase: source files, configuration files, slash commands, feature files, and documentation.

## User Story
As a developer using ADW
I want the regression test tag to be called `@regression` instead of `@crucial`
So that the tag name clearly communicates that these scenarios form the regression safety net

## Problem Statement
The `@crucial` tag is used throughout the codebase to mark BDD scenarios that serve as the regression test suite. The name "crucial" is vague — it doesn't communicate what kind of importance is meant. "Regression" is a well-known testing term that immediately conveys the purpose: these scenarios guard against regressions in existing functionality.

## Solution Statement
Perform a comprehensive rename of `@crucial` to `@regression` across all layers:
1. Rename the source file `crucialScenarioProof.ts` → `regressionScenarioProof.ts`
2. Rename all TypeScript identifiers (`crucialPassed` → `regressionPassed`, `runCrucialScenarioProof` → `runRegressionScenarioProof`, etc.)
3. Update configuration types and keys (`runCrucialScenarios` → `runRegressionScenarios`, `runCrucial` → `runRegression`)
4. Update `.adw/` config file headings and commands (`## Run Crucial Scenarios` → `## Run Regression Scenarios`)
5. Update all slash command prompts that reference `@crucial`
6. Update all `.feature` files to use `@regression` instead of `@crucial`
7. Update all documentation (README, adws/README, review_proof, conditional_docs, project.md)

## Relevant Files
Use these files to implement the feature:

**Source files to rename/modify:**
- `adws/agents/crucialScenarioProof.ts` — Main file to rename to `regressionScenarioProof.ts`; contains `ScenarioProofResult` interface, `runCrucialScenarioProof`, `buildProofMarkdown`, all with "crucial" identifiers
- `adws/agents/index.ts` — Re-exports from `crucialScenarioProof.ts`; update import path and export names
- `adws/agents/reviewRetry.ts` — Imports from `crucialScenarioProof.ts`; uses `crucialPassed`, `runCrucialCommand`, `runCrucialScenarioProof`
- `adws/core/projectConfig.ts` — Defines `CommandsConfig.runCrucialScenarios`, `ScenariosConfig.runCrucial`, heading mappings, and default values with `@crucial`
- `adws/phases/workflowCompletion.ts` — References `config.projectConfig.commands.runCrucialScenarios`
- `adws/agents/bddScenarioRunner.ts` — JSDoc comments referencing `@crucial`

**Configuration files:**
- `.adw/scenarios.md` — `## Run Crucial Scenarios` heading and `@crucial` in command
- `.adw/commands.md` — `## Run Crucial Scenarios` heading and `@crucial` in command
- `.adw/review_proof.md` — Multiple references to `@crucial` in proof type, classification rules
- `.adw/conditional_docs.md` — References to `@crucial` tag in condition descriptions
- `.adw/project.md` — Reference to "crucial scenarios command" in project description

**Slash commands:**
- `.claude/commands/review.md` — References `@crucial` in proof requirements and instructions
- `.claude/commands/scenario_writer.md` — References `@crucial` in tag maintenance sweep section
- `.claude/commands/adw_init.md` — References `@crucial` in scenarios.md generation instructions

**Feature files:**
- `features/review_phase.feature` — Many `@crucial` tags and scenario text references
- `features/primed_claude_agent.feature` — `@crucial` tags on scenarios
- `features/llm_dependency_extraction.feature` — `@crucial` tags on scenarios
- `features/agent_commands.feature` — `@crucial` tags on scenarios
- `features/cron_pr_review_filter.feature` — `@crucial` tags on scenarios
- `features/review_retry_patch_implementation.feature` — `@crucial` tags on scenarios

**Documentation:**
- `README.md` — BDD Scenario Configuration section references `@crucial`
- `adws/README.md` — References `@crucial` in scenario proof and tagging convention docs

**Guidelines:**
- `guidelines/coding_guidelines.md` — Read and follow these guidelines

## Implementation Plan
### Phase 1: Foundation — Rename Core Source File and Update Types
Rename `crucialScenarioProof.ts` to `regressionScenarioProof.ts` and update all TypeScript identifiers from "crucial" to "regression". Update the `CommandsConfig` and `ScenariosConfig` type definitions and their heading mappings in `projectConfig.ts`.

### Phase 2: Core Implementation — Update All Consumers
Update all files that import from or reference the renamed module: `index.ts`, `reviewRetry.ts`, `workflowCompletion.ts`. Update log messages and user-facing strings.

### Phase 3: Configuration and Prompts
Update all `.adw/` configuration files, slash command prompts, and feature files to use `@regression` instead of `@crucial`.

### Phase 4: Documentation
Update `README.md` and `adws/README.md` to replace all `@crucial` references with `@regression`.

## Step by Step Tasks

### Step 1: Rename `crucialScenarioProof.ts` to `regressionScenarioProof.ts` and update contents
- `git mv adws/agents/crucialScenarioProof.ts adws/agents/regressionScenarioProof.ts`
- In the new file, rename all identifiers:
  - File-level JSDoc: "Crucial scenario proof" → "Regression scenario proof"
  - `ScenarioProofResult.crucialPassed` → `regressionPassed`
  - `ScenarioProofResult.crucialOutput` → `regressionOutput`
  - `ScenarioProofResult.crucialExitCode` → `regressionExitCode`
  - All JSDoc comments: `@crucial` → `@regression`
  - `buildProofMarkdown` parameters: `crucialOutput` → `regressionOutput`, `crucialExitCode` → `regressionExitCode`, `crucialPassed` → `regressionPassed`
  - `crucialStatus` → `regressionStatus`
  - Markdown heading in proof output: `## @crucial Scenarios` → `## @regression Scenarios`
  - `runCrucialScenarioProof` → `runRegressionScenarioProof`
  - `options.runCrucialCommand` → `options.runRegressionCommand`
  - Local variables: `crucialResult` → `regressionResult`, `crucialOutput` → `regressionOutput`
  - Tag passed to `runScenariosByTag`: `'crucial'` → `'regression'`

### Step 2: Update `adws/agents/index.ts`
- Change import path from `'./crucialScenarioProof'` to `'./regressionScenarioProof'`
- Rename the section comment from `// Crucial Scenario Proof` to `// Regression Scenario Proof`
- Update exported names: `runCrucialScenarioProof` → `runRegressionScenarioProof`

### Step 3: Update `adws/agents/reviewRetry.ts`
- Update import: `from './crucialScenarioProof'` → `from './regressionScenarioProof'`
- Update import names: `runCrucialScenarioProof` → `runRegressionScenarioProof`
- `ReviewRetryOptions.runCrucialCommand` → `runRegressionCommand`
- JSDoc: `@crucial` → `@regression` in all comments
- Destructured variable: `runCrucialCommand` → `runRegressionCommand`
- Log messages: `'@crucial'` → `'@regression'`
- `scenarioProof.crucialPassed` → `scenarioProof.regressionPassed`
- `crucialStatus` → `regressionStatus`
- Blocker issue description: `'@crucial BDD scenarios failed'` → `'@regression BDD scenarios failed'`
- Blocker issue resolution: `'Fix the failing @crucial BDD scenarios'` → `'Fix the failing @regression BDD scenarios'`

### Step 4: Update `adws/core/projectConfig.ts`
- `CommandsConfig.runCrucialScenarios` → `runRegressionScenarios`
- `ScenariosConfig.runCrucial` → `runRegression`
- `SCENARIOS_HEADING_TO_KEY`: `'run crucial scenarios': 'runCrucial'` → `'run regression scenarios': 'runRegression'`
- `HEADING_TO_KEY`: `'run crucial scenarios': 'runCrucialScenarios'` → `'run regression scenarios': 'runRegressionScenarios'`
- Default values: `cucumber-js --tags "@crucial"` → `cucumber-js --tags "@regression"`
- `getDefaultCommandsConfig()`: `runCrucialScenarios` → `runRegressionScenarios`
- `getDefaultScenariosConfig()`: `runCrucial` → `runRegression`

### Step 5: Update `adws/phases/workflowCompletion.ts`
- `config.projectConfig.commands.runCrucialScenarios` → `config.projectConfig.commands.runRegressionScenarios`
- `runCrucialCommand` (in `runReviewWithRetry` call) → `runRegressionCommand`

### Step 6: Update `adws/agents/bddScenarioRunner.ts`
- JSDoc comments: `@crucial` → `@regression` (lines 87-88)

### Step 7: Update `.adw/scenarios.md`
- `## Run Crucial Scenarios` → `## Run Regression Scenarios`
- `cucumber-js --tags "@crucial"` → `cucumber-js --tags "@regression"`

### Step 8: Update `.adw/commands.md`
- `## Run Crucial Scenarios` → `## Run Regression Scenarios`
- `cucumber-js --tags "@crucial"` → `cucumber-js --tags "@regression"`

### Step 9: Update `.adw/review_proof.md`
- All references to `@crucial` → `@regression`
- "crucial" in descriptive text (e.g., "Crucial scenario failures") → use `@regression` consistently

### Step 10: Update `.adw/conditional_docs.md`
- All references to `@crucial` → `@regression`

### Step 11: Update `.adw/project.md`
- "crucial scenarios command" → "regression scenarios command"

### Step 12: Update `.claude/commands/review.md`
- All references to `@crucial` → `@regression`

### Step 13: Update `.claude/commands/scenario_writer.md`
- All references to `@crucial` → `@regression`
- Section heading `### 6. \`@crucial\` tag maintenance sweep` → `### 6. \`@regression\` tag maintenance sweep`

### Step 14: Update `.claude/commands/adw_init.md`
- All references to `@crucial` → `@regression`
- `## Run Crucial Scenarios` → `## Run Regression Scenarios` in example outputs

### Step 15: Update all `.feature` files
- In all feature files under `features/`, replace `@crucial` tag with `@regression`
- In `features/review_phase.feature`, also update scenario text that references `@crucial` as a concept (e.g., "crucial scenario failures") to use `@regression`

### Step 16: Update `README.md`
- All references to `@crucial` → `@regression`
- `## Run Crucial Scenarios` → `## Run Regression Scenarios`
- Update `crucialScenarioProof.ts` → `regressionScenarioProof.ts` in the project structure section
- Comment description: "Crucial scenario proof for reviews" → "Regression scenario proof for reviews"

### Step 17: Update `adws/README.md`
- All references to `@crucial` → `@regression`
- `crucialScenarioProof.ts` file reference → `regressionScenarioProof.ts`

### Step 18: Run validation commands
- Execute all validation commands to ensure zero regressions

## Testing Strategy
### Unit Tests
Unit tests are disabled for this project per `.adw/project.md`. Validation relies on type checking, linting, and BDD scenarios.

### Edge Cases
- Ensure no partial renames (e.g., a variable still named `crucial` while its type uses `regression`)
- Ensure heading mappings in `projectConfig.ts` match the new `.adw/` heading names exactly (case-insensitive)
- Ensure the `runScenariosByTag` call in the renamed file passes `'regression'` as the tag, not `'crucial'`
- Ensure default command strings use `@regression` not `@crucial`

## Acceptance Criteria
- All TypeScript files compile without errors (`bunx tsc --noEmit` and `bunx tsc --noEmit -p adws/tsconfig.json`)
- No remaining references to `@crucial` or `crucial` in any source file, config file, slash command, feature file, or documentation (except in historical `specs/` and `app_docs/` files which are not modified)
- The file `adws/agents/crucialScenarioProof.ts` no longer exists; replaced by `adws/agents/regressionScenarioProof.ts`
- All config types, heading mappings, and defaults use "regression" naming
- All `.feature` files use `@regression` tags instead of `@crucial`
- Linting passes with no new errors
- Existing test suite passes

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bunx tsc --noEmit` — Root TypeScript type check
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW-specific TypeScript type check
- `bun run lint` — Run ESLint to check for code quality issues
- `grep -ri "crucial" adws/ .adw/ .claude/commands/ features/ README.md --include="*.ts" --include="*.md" --include="*.feature" | grep -v "node_modules" | grep -v "specs/" | grep -v "app_docs/"` — Verify no remaining `crucial` references in active source, config, commands, features, or root docs (specs/ and app_docs/ are historical and excluded)

## Notes
- Historical spec files in `specs/` and documentation in `app_docs/` are NOT modified — they are immutable records of past planning and implementation.
- The `patch/` subdirectory of `specs/` is also left unchanged for the same reason.
- Strictly adhere to `guidelines/coding_guidelines.md`: immutability, type safety, clarity, modularity.
- No new libraries are needed for this change.
