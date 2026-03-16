# Bug: Cucumber regression tests run nothing — config and step definitions missing

## Metadata
issueNumber: `201`
adwId: `1epy28-cucumber-regression`
issueJson: `{"number":201,"title":"Cucumber regression tests run nothing — config and step definitions missing","body":"## Problem\n\n`bunx cucumber-js --tags \"@regression\"` returns `0 scenarios, 0 steps` because of two root causes:\n\n### 1. `cucumber.js` is hardcoded to a single feature file\n\n```js\npaths: ['features/plan_template_unit_tests_conditional.feature'],\nimport: ['features/step_definitions/planTemplateSteps.ts'],\n```\n\nOnly one feature file and one step definition file are loaded. The remaining 9 feature files are never discovered.\n\n### 2. Step definitions exist for only 1 of 10 feature files\n\nOnly `planTemplateSteps.ts` exists. The other 9 feature files have no matching step definition files.\n\n## Fix\n\n1. Update `cucumber.js` — change `paths` to `['features/**/*.feature']` and `import` to `['features/step_definitions/**/*.ts']`\n2. Write step definition files for all 9 feature files missing them\n3. Add `@regression` tags to the 3 feature files that currently have zero\n4. Verify `bunx cucumber-js --tags \"@regression\"` discovers and runs all regression scenarios","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-16T14:21:35Z","comments":[],"actionableComment":null}`

## Bug Description
Running `bunx cucumber-js --tags "@regression"` returns `0 scenarios, 0 steps` — none of the BDD regression scenarios are discovered or executed. This means the entire regression safety net is non-functional; the review phase, scenario proof, and CI validation all silently pass without testing anything.

**Expected behaviour:** All feature files are discovered, all step definitions load, and all `@regression`-tagged scenarios execute.

**Actual behaviour:** Only `plan_template_unit_tests_conditional.feature` and `planTemplateSteps.ts` are loaded. Since that file has `@crucial` tags (not `@regression`), zero scenarios match the `@regression` filter.

## Problem Statement
Two independent root causes prevent Cucumber from running any regression scenarios:

1. **`cucumber.js` hardcodes a single feature file and a single step definition file** — the `paths` and `import` arrays each contain one entry instead of glob patterns, so 9 of 10 feature files are invisible to Cucumber.
2. **Step definitions exist for only 1 of 10 feature files** — even if Cucumber discovered all features, 9 would fail with "undefined" steps because no matching step definition files exist.
3. **Three feature files use `@crucial` instead of `@regression`** — `plan_template_unit_tests_conditional.feature`, `push_adw_kpis.feature`, and `remove_unnecessary_exports.feature` still use the old `@crucial` tag, so their scenarios are excluded from `@regression` runs.

## Solution Statement
1. Update `cucumber.js` to use glob patterns: `paths: ['features/**/*.feature']` and `import: ['features/step_definitions/**/*.ts']`.
2. Write step definition files for the 9 feature files that lack them, following the same code-inspection pattern used in the existing `planTemplateSteps.ts`.
3. Replace `@crucial` with `@regression` in the 3 feature files that still use `@crucial`.

## Steps to Reproduce
```bash
bunx cucumber-js --tags "@regression"
# Output: 0 scenarios, 0 steps
```

## Root Cause Analysis
- `cucumber.js` was created with hardcoded paths pointing to only `features/plan_template_unit_tests_conditional.feature` and `features/step_definitions/planTemplateSteps.ts`. This was likely correct at the time it was first committed (when only one feature file existed), but was never updated as additional feature files were added.
- Step definition files were only written for the first feature file. Subsequent features were added without corresponding step definitions.
- Three feature files (`plan_template_unit_tests_conditional.feature`, `push_adw_kpis.feature`, `remove_unnecessary_exports.feature`) still use the old `@crucial` tag. The `replace_crucial_with_regression.feature` scenario file documents that this rename should have happened, but these three files were missed.

## Relevant Files
Use these files to fix the bug:

- `cucumber.js` — Root-level Cucumber config. Contains hardcoded `paths` and `import` arrays that must be changed to globs.
- `features/step_definitions/planTemplateSteps.ts` — Existing step definitions for `plan_template_unit_tests_conditional.feature`. Reference for the code-inspection step definition pattern.
- `features/agent_commands.feature` — 7 scenarios (4 `@regression`), needs step defs.
- `features/cron_pr_review_filter.feature` — 8 scenarios (4 `@regression`), needs step defs.
- `features/llm_dependency_extraction.feature` — 19 scenarios (10 `@regression`), needs step defs.
- `features/primed_claude_agent.feature` — 10 scenarios (6 `@regression`), needs step defs.
- `features/push_adw_kpis.feature` — 8 scenarios (3 `@crucial` → `@regression`), needs step defs.
- `features/remove_unnecessary_exports.feature` — 40 scenarios (2 `@crucial` → `@regression`), needs step defs.
- `features/replace_crucial_with_regression.feature` — 17 scenarios (10 `@regression`), needs step defs.
- `features/review_phase.feature` — 8 scenarios (4 `@regression`), needs step defs.
- `features/review_retry_patch_implementation.feature` — 8 scenarios (5 `@regression`), needs step defs.
- `features/plan_template_unit_tests_conditional.feature` — 9 scenarios (3 `@crucial` → `@regression`), has step defs already but needs `@crucial` replaced with `@regression`.
- `guidelines/coding_guidelines.md` — Coding guidelines to follow.

### New Files
- `features/step_definitions/agentCommandsSteps.ts`
- `features/step_definitions/cronPrReviewFilterSteps.ts`
- `features/step_definitions/llmDependencyExtractionSteps.ts`
- `features/step_definitions/primedClaudeAgentSteps.ts`
- `features/step_definitions/pushAdwKpisSteps.ts`
- `features/step_definitions/removeUnnecessaryExportsSteps.ts`
- `features/step_definitions/replaceCrucialWithRegressionSteps.ts`
- `features/step_definitions/reviewPhaseSteps.ts`
- `features/step_definitions/reviewRetryPatchSteps.ts`

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Update `cucumber.js` to use glob patterns
- Open `cucumber.js` and change:
  - `paths: ['features/plan_template_unit_tests_conditional.feature']` → `paths: ['features/**/*.feature']`
  - `import: ['features/step_definitions/planTemplateSteps.ts']` → `import: ['features/step_definitions/**/*.ts']`

### Step 2: Replace `@crucial` with `@regression` in the 3 feature files
- In `features/plan_template_unit_tests_conditional.feature`: replace all occurrences of `@crucial` with `@regression` (lines 15, 22, 29)
- In `features/push_adw_kpis.feature`: replace all occurrences of `@crucial` with `@regression` (lines 12, 20, 27)
- In `features/remove_unnecessary_exports.feature`: replace all occurrences of `@crucial` with `@regression` (lines 179, 187)

### Step 3: Create step definitions for `agent_commands.feature`
- Create `features/step_definitions/agentCommandsSteps.ts`
- This feature verifies that validation and resolution agents delegate to slash commands via `runClaudeAgentWithCommand` instead of raw prompts.
- Steps inspect source files (`adws/agents/validationAgent.ts`, `adws/agents/resolutionAgent.ts`, `adws/agents/claudeAgent.ts`) to verify:
  - Agents call `runClaudeAgentWithCommand` with the correct command strings
  - `runClaudeAgent` is not defined or called anywhere
  - Arguments are passed in the correct order
  - Return types are correct (`ValidationResult`, `ResolutionResult`)
- Use `readFileSync` + `assert` pattern matching the existing `planTemplateSteps.ts` approach.

### Step 4: Create step definitions for `cron_pr_review_filter.feature`
- Create `features/step_definitions/cronPrReviewFilterSteps.ts`
- This feature verifies that the cron trigger's PR review polling correctly filters out ADW's own review submissions.
- Steps inspect source files (`adws/triggers/trigger_cron.ts`, `adws/github/prCommentDetector.ts`) to verify:
  - The bot filter logic exists and identifies ADW-authored reviews
  - Genuine human reviews are still detected
  - Existing Bot-typed account filtering is preserved
- Use context variables to track scenario state (PR number, user login, review type).

### Step 5: Create step definitions for `llm_dependency_extraction.feature`
- Create `features/step_definitions/llmDependencyExtractionSteps.ts`
- This feature verifies the LLM-based issue dependency extraction pipeline.
- Steps inspect source files (`adws/triggers/issueDependencies.ts`, `adws/agents/dependencyExtractionAgent.ts`, `.claude/commands/extract_dependencies.md`) to verify:
  - The extract_dependencies command exists
  - `runDependencyExtractionAgent` calls the command with the haiku model
  - `findOpenDependencies` uses LLM extraction as primary path with regex fallback
  - JSON parsing handles arrays and malformed output
- Context variables track issue body content and expected dependency arrays.

### Step 6: Create step definitions for `primed_claude_agent.feature`
- Create `features/step_definitions/primedClaudeAgentSteps.ts`
- This feature verifies the `runPrimedClaudeAgentWithCommand` function.
- Steps inspect source files (`adws/agents/claudeAgent.ts`, `adws/agents/planAgent.ts`, `adws/agents/scenarioAgent.ts`, `adws/agents/index.ts`) to verify:
  - The function is exported and has the correct signature
  - The composed prompt begins with `/install` and includes the target command
  - Plan and scenario agents call `runPrimedClaudeAgentWithCommand`
  - The function is re-exported from the barrel file
- Reuse the existing `Given the ADW codebase contains {string}` step from `planTemplateSteps.ts` — since both files define it, extract a shared step or ensure the pattern is identical so Cucumber doesn't error on duplicate definitions. The safest approach: import the shared step from `planTemplateSteps.ts` or define it only once in a shared `commonSteps.ts` file.

### Step 7: Create step definitions for `push_adw_kpis.feature`
- Create `features/step_definitions/pushAdwKpisSteps.ts`
- This feature verifies the KPI phase commits and pushes `agentic_kpis.md`.
- Steps inspect source files (`adws/phases/kpiPhase.ts`) to verify:
  - Git commit logic includes the KPI file
  - Push step exists
  - Error handling is non-fatal
  - No commit when no changes or agent failure

### Step 8: Create step definitions for `remove_unnecessary_exports.feature`
- Create `features/step_definitions/removeUnnecessaryExportsSteps.ts`
- This feature verifies that unnecessary exports have been removed across many source files.
- Steps read source files and verify that specific symbols are NOT prefixed with `export` but are still defined.
- Also verifies barrel files no longer re-export removed symbols.
- Validation scenarios run `bun run test` and `bunx tsc --noEmit` — these steps should assert the commands exist or verify the file structure supports them.
- NOTE: The feature references `crucialScenarioProof.ts` (line 89) but the actual file is `regressionScenarioProof.ts`. The step definition should handle this by checking the actual filename.

### Step 9: Create step definitions for `replace_crucial_with_regression.feature`
- Create `features/step_definitions/replaceCrucialWithRegressionSteps.ts`
- This feature verifies that `@crucial` has been fully replaced by `@regression` everywhere.
- Steps scan configuration files (`.adw/scenarios.md`, `.adw/commands.md`), source files (`adws/agents/regressionScenarioProof.ts`, `adws/core/projectConfig.ts`, `adws/agents/reviewRetry.ts`), feature files, and documentation to verify no `@crucial` references remain.
- Uses glob scanning of `features/**/*.feature` and `adws/**/*.ts` for comprehensive checks.

### Step 10: Create step definitions for `review_phase.feature`
- Create `features/step_definitions/reviewPhaseSteps.ts`
- This feature verifies the review phase uses BDD scenario execution as proof.
- Steps inspect source files (`adws/phases/prReviewPhase.ts` or `adws/agents/reviewAgent.ts`, `adws/agents/regressionScenarioProof.ts`, `.adw/review_proof.md`, `.adw/scenarios.md`) to verify:
  - The review phase runs regression scenario commands when scenarios.md exists
  - Regression failures are blockers, non-regression failures are tech-debt
  - Falls back to code-diff proof when scenarios.md is absent

### Step 11: Create step definitions for `review_retry_patch_implementation.feature`
- Create `features/step_definitions/reviewRetryPatchSteps.ts`
- This feature verifies the review retry loop consolidates blockers and implements patches.
- Steps inspect source files (`adws/agents/reviewRetry.ts`) to verify:
  - `runBuildAgent` is called after `runPatchAgent`
  - Blockers are consolidated/deduplicated
  - Cost tracking includes build agent calls
  - Patch agent failure doesn't block other blockers

### Step 12: Handle shared step definitions to avoid duplicate registration
- Multiple feature files share the same Given steps (e.g., `Given the ADW codebase contains {string}`, `Given the ADW workflow is configured for a target repository`).
- Create a `features/step_definitions/commonSteps.ts` file that defines all shared steps.
- Remove the shared `Given the ADW codebase contains {string}` step from `planTemplateSteps.ts` and place it in `commonSteps.ts`.
- All feature-specific step files import from Cucumber directly but do NOT re-define steps already defined in `commonSteps.ts`.
- Shared steps to extract into `commonSteps.ts`:
  - `Given the ADW codebase contains {string}` — used by `plan_template_unit_tests_conditional.feature` and `primed_claude_agent.feature`
  - `Given the ADW workflow is configured for a target repository` — used by `agent_commands.feature`, `llm_dependency_extraction.feature`, `review_phase.feature`
  - `Given the ADW codebase is checked out` — used by `remove_unnecessary_exports.feature`
  - `Given the ADW codebase is at the current working directory` — used by `replace_crucial_with_regression.feature`
  - `Given {string} is read` — generic file reading step used across several features
- Pattern: each step def reads the referenced source file with `readFileSync`, stores content in a context object, and uses `assert` to verify patterns.

### Step 13: Run validation commands
- Execute all validation commands listed below to confirm the bug is fixed with zero regressions.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

- `bunx cucumber-js --tags "@regression" --dry-run` — Verify all @regression scenarios are discovered and all steps have matching definitions (no undefined steps). This should report the total count of regression scenarios (expected: ~68 scenarios).
- `bunx cucumber-js --tags "@regression"` — Run all regression scenarios end-to-end. Every scenario must pass.
- `bunx cucumber-js` — Run ALL scenarios (not just @regression) to verify no step definition conflicts or duplicate registrations.
- `bun run lint` — Run linter to check for code quality issues.
- `bunx tsc --noEmit` — Type check root config.
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type check adws config.

## Notes
- All step definitions follow the **code-inspection** pattern established in `planTemplateSteps.ts`: read source files, search for patterns, assert on structure. They do NOT execute application code at runtime.
- The `remove_unnecessary_exports.feature` references `crucialScenarioProof.ts` (line 89) but the actual file was renamed to `regressionScenarioProof.ts`. The step definition must account for the actual filename.
- Strictly follow coding guidelines in `guidelines/coding_guidelines.md`: prefer pure functions, immutability, declarative style, strict TypeScript.
- Unit tests are disabled for this project (`.adw/project.md` has `## Unit Tests: disabled`), so no unit tests are written.
- BDD scenarios ARE the validation mechanism for ADW.
