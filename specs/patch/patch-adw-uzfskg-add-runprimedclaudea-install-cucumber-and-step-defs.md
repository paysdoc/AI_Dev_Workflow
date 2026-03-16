# Patch: Install cucumber-js and add step definitions for BDD scenario proof

## Metadata
adwId: `uzfskg-add-runprimedclaudea`
reviewChangeRequest: `Issue #1: @crucial scenarios FAILED with exit code 127 (command not found) and no output. This indicates the BDD test runner binary was not found in the environment, not a code-level failure. The actual implementation is correct per code diff review.`

## Issue Summary
**Original Spec:** specs/issue-189-adw-uzfskg-add-runprimedclaudea-sdlc_planner-add-primed-claude-agent.md
**Issue:** The scenario proof runner executes `cucumber-js --tags "@crucial"` (from `.adw/scenarios.md`) but `cucumber-js` is not installed as a dependency — exit code 127. No step definition files exist in `features/step_definitions/`, no `cucumber.js` config exists, and `.adw/scenarios.md` and `.adw/commands.md` reference bare `cucumber-js` which doesn't resolve because `node_modules/.bin` is not on the default shell PATH. There are 15 `@crucial` scenarios across 4 feature files that all need step definitions.
**Solution:** Install `@cucumber/cucumber` as a dev dependency, create a `cucumber.js` config for TypeScript support via `tsx`, update `.adw/scenarios.md` and `.adw/commands.md` to use `npx cucumber-js` so the binary resolves, and create step definition files implementing all Given/When/Then steps as structural code assertions (reading source files and verifying patterns — no runtime mocking).

## Files to Modify
Use these files to implement the patch:

- `package.json` — Add `@cucumber/cucumber` as dev dependency (via `bun add -d @cucumber/cucumber`)
- `.adw/scenarios.md` — Change `cucumber-js` → `npx cucumber-js` in both run commands
- `.adw/commands.md` — Change `cucumber-js` → `npx cucumber-js` in `## Run Scenarios by Tag` and `## Run Crucial Scenarios`
- `cucumber.js` (new) — Cucumber configuration specifying `tsx` loader and step definition paths
- `features/step_definitions/common_steps.ts` (new) — Shared Given/When/Then steps reused across feature files
- `features/step_definitions/primed_claude_agent_steps.ts` (new) — Steps for `primed_claude_agent.feature`
- `features/step_definitions/agent_commands_steps.ts` (new) — Steps for `agent_commands.feature`
- `features/step_definitions/review_phase_steps.ts` (new) — Steps for `review_phase.feature`
- `features/step_definitions/cron_pr_review_filter_steps.ts` (new) — Steps for `cron_pr_review_filter.feature`

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Install @cucumber/cucumber and create config
- Run `bun add -d @cucumber/cucumber`
- Verify binary resolves: `npx cucumber-js --version`
- Create `cucumber.js` in project root with this config:
  ```js
  module.exports = {
    default: {
      requireModule: ['tsx'],
      require: ['features/step_definitions/**/*.ts'],
      paths: ['features/**/*.feature'],
      format: ['progress'],
    },
  };
  ```
- `tsx` is already a dev dependency so TypeScript step definitions transpile automatically

### Step 2: Update command config files to use `npx cucumber-js`
- In `.adw/scenarios.md`:
  - `## Run Scenarios by Tag`: `cucumber-js --tags "@{tag}"` → `npx cucumber-js --tags "@{tag}"`
  - `## Run Crucial Scenarios`: `cucumber-js --tags "@crucial"` → `npx cucumber-js --tags "@crucial"`
- In `.adw/commands.md`:
  - `## Run Scenarios by Tag`: `cucumber-js --tags "@{tag}"` → `npx cucumber-js --tags "@{tag}"`
  - `## Run Crucial Scenarios`: `cucumber-js --tags "@crucial"` → `npx cucumber-js --tags "@crucial"`

### Step 3: Create step definitions with a shared World class
All step definitions are **structural code assertions** — they read source files with `fs.readFileSync` and verify patterns with string/regex matching. No runtime mocking required.

Create a custom World class in `features/step_definitions/common_steps.ts` to carry state between steps (`fileContent`, `matchedLine`, `searchResults`, `promptTemplate`).

**Shared steps** (used across multiple features):
- `Given the ADW codebase contains {string}` — assert file exists with `fs.existsSync`
- `Given {string} is read` — store file contents in World context
- `Given the ADW codebase` / `Given the ADW workflow is configured for a target repository` / `Given the target repository has a plan file and BDD scenario files` — no-op setup steps
- `When searching for the exported symbol {string}` — regex `export.*function\s+<name>` against stored content
- `When searching for the call that launches the plan agent subprocess` / `scenario agent subprocess` — search stored content for call patterns
- `When searching for usages of {word}` — glob + read all `adws/**/*.ts` files for the symbol
- `When searching for the export of {string}` — search stored file for export statement
- `Then the function is defined with the {string} keyword` — assert matched region contains keyword
- `Then its signature accepts command, args, agentName, outputFile, model, effort, onProgress, statePath, and cwd parameters` — assert parameter names
- `Then it returns a Promise<AgentResult>` — assert return type annotation
- `Then it calls {string}` / `Then it does not call {string} for the plan/scenario agent subprocess` — assert presence/absence
- `Then the symbol is exported from the barrel file` — assert export statement
- `Then {word} is not defined/called anywhere in the codebase` — grep all TS files, assert no match

**Feature-specific steps** in their own files:
- `primed_claude_agent_steps.ts` — prompt composition, `/install` prefix, arg quoting, delegation assertions
- `agent_commands_steps.ts` — validation/resolution agent command assertions, symbol absence checks
- `review_phase_steps.ts` — scenario proof integration, fallback logic, pass/fail reporting
- `cron_pr_review_filter_steps.ts` — PR polling filter, bot filter, ADW review exclusion

### Step 4: Run scenarios and fix any step definition mismatches
- Run `npx cucumber-js --tags "@crucial"` — all 15 crucial scenarios must pass (exit code 0)
- Run `npx cucumber-js --tags "@adw-uzfskg-add-runprimedclaudea"` — all 9 issue scenarios must pass
- Fix any undefined steps, assertion failures, or step pattern mismatches iteratively

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `npx cucumber-js --tags "@crucial"` — All 15 @crucial scenarios across 4 feature files pass (exit code 0)
- `npx cucumber-js --tags "@adw-uzfskg-add-runprimedclaudea"` — All 9 issue-tagged scenarios pass (exit code 0)
- `bun run lint` — No lint errors in new or modified files
- `bunx tsc --noEmit` — No TypeScript compilation errors
- `bunx tsc --noEmit -p adws/tsconfig.json` — No ADW TypeScript compilation errors
- `bun run test -- --run adws/__tests__` — All ADW unit tests pass with zero regressions

## Patch Scope
**Lines of code to change:** ~300 (cucumber config + 5 step definition files + 4 lines in config files)
**Risk level:** low
**Testing required:** Run cucumber-js with @crucial and @adw-uzfskg-add-runprimedclaudea tags; run existing vitest suite and type checks to confirm zero regressions
