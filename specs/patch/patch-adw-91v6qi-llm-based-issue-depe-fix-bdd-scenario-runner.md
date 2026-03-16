# Patch: Install BDD scenario runner and create step definitions

## Metadata
adwId: `91v6qi-llm-based-issue-depe`
reviewChangeRequest: `Issue #1: @crucial BDD scenarios all failed with exit code 127 (command not found) and no output. The BDD scenario runner binary (cucumber-js) was not found during execution.`

## Issue Summary
**Original Spec:** specs/issue-185-adw-91v6qi-llm-based-issue-depe-sdlc_planner-llm-dependency-extraction.md
**Issue:** All @crucial and @adw-185 BDD scenarios failed with exit code 127 because `cucumber-js` is not installed. The `@cucumber/cucumber` package is missing from `package.json` and no step definitions exist for the feature file `features/llm_dependency_extraction.feature`.
**Solution:** Install `@cucumber/cucumber` as a devDependency, create a cucumber configuration file, and implement step definitions for all scenarios in the feature file. The step definitions will import and test the actual implementation functions (`parseDependencyArray`, `runDependencyExtractionAgent`, `extractDependencies`, `findOpenDependencies`) with appropriate mocking for external dependencies.

## Files to Modify
Use these files to implement the patch:

- `package.json` — Add `@cucumber/cucumber` and `ts-node` to devDependencies
- `cucumber.js` — New: Cucumber configuration file pointing to step definitions and TypeScript support
- `features/step_definitions/llm_dependency_extraction.steps.ts` — New: Step definitions for all scenarios in `llm_dependency_extraction.feature`
- `features/support/world.ts` — New: Cucumber World class for sharing state between steps

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Install @cucumber/cucumber and ts-node
- Run `bun add -d @cucumber/cucumber ts-node`
- Verify the packages appear in `package.json` devDependencies
- Run `bun install` to ensure the binary is available

### Step 2: Create cucumber configuration file
- Create `cucumber.js` at the project root with:
  - `default` profile pointing to `features/**/*.feature`
  - `require` pointing to `features/step_definitions/**/*.ts` and `features/support/**/*.ts`
  - `requireModule` set to `['ts-node/register']`
  - `publishQuiet: true` to suppress the Cucumber publish banner
  - Format set to `progress` for concise output

### Step 3: Create Cucumber World class
- Create `features/support/world.ts` with a custom World class that holds:
  - `issueBody: string` — the issue body text under test
  - `commandOutput: string` — captured output from command/function invocation
  - `dependencies: number[]` — parsed dependency array
  - `agentResult: object` — result from agent invocation
  - `error: Error | null` — captured error for failure scenarios
  - `warningLogged: boolean` — whether a warning was logged
  - `regexFallbackUsed: boolean` — whether regex fallback was triggered
  - `issueStates: Map<number, string>` — mock issue open/closed states

### Step 4: Create step definitions for all scenarios
- Create `features/step_definitions/llm_dependency_extraction.steps.ts` implementing Given/When/Then steps for the feature file
- Import the actual implementation functions:
  - `parseDependencyArray` from `../../adws/agents/dependencyExtractionAgent`
  - `parseDependencies` and `extractDependencies` from `../../adws/triggers/issueDependencies`
- For scenarios testing the `/extract_dependencies` command output (scenarios 1-9): Use `parseDependencyArray` to validate the extraction logic since the command is a Claude prompt — test the parsing/validation layer
- For scenarios testing `runDependencyExtractionAgent` (scenarios 10-12): Mock `runClaudeAgentWithCommand` using a module-level mock, verify correct parameters and output parsing
- For scenarios testing `findOpenDependencies` (scenarios 13-15): Mock the agent and `getIssueState` to test LLM-first with regex fallback behavior
- Use `assert` from `node:assert` for assertions in step definitions
- Each Given step sets up the World state (issue body, mocks, issue states)
- Each When step invokes the function under test
- Each Then step asserts the expected outcome

### Step 5: Verify cucumber-js runs successfully
- Run `npx cucumber-js --tags "@crucial"` to validate @crucial scenarios pass
- Run `npx cucumber-js --tags "@adw-91v6qi-llm-based-issue-depe"` to validate all issue scenarios pass
- Fix any step definition mismatches or assertion failures

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `bun run lint` - Run linter to check for code quality issues
- `bunx tsc --noEmit` - TypeScript type check for the application
- `bunx tsc --noEmit -p adws/tsconfig.json` - TypeScript type check for ADW scripts
- `bun run test -- --run adws/__tests__` - Run ADW unit tests to verify zero regressions
- `npx cucumber-js --tags "@crucial"` - Run @crucial BDD scenarios to verify they pass
- `npx cucumber-js --tags "@adw-91v6qi-llm-based-issue-depe"` - Run all issue-specific BDD scenarios

## Patch Scope
**Lines of code to change:** ~250-300 (mostly new step definitions)
**Risk level:** low
**Testing required:** BDD scenario execution with cucumber-js, existing unit tests must continue to pass
