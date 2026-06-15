---
target: false
---
# Application Validation Test Suite

Execute comprehensive validation tests for the application and ADW (AI Developer Workflow) scripts, returning results in a standardized JSON format for automated processing.

## Purpose

Proactively identify and fix issues in the application before they impact users or developers. By running this comprehensive test suite, you can:
- Detect syntax errors, type mismatches, and import failures
- Identify broken tests or security vulnerabilities
- Verify build processes and dependencies
- Ensure the application is in a healthy state

## Variables

TEST_COMMAND_TIMEOUT: 5 minutes

## Instructions

- Read `.adw/commands.md` from the current working directory for all project-specific commands. If `.adw/commands.md` does not exist, use the default commands shown in each test step below.
- Execute each test in the sequence provided below
- Capture the result (passed/failed) and any error messages
- CRITICAL: Return ONLY the JSON array with test results. No additional text, explanations, or markdown formatting — `JSON.parse()` runs directly on your output.
- If a test passes, omit the error field
- If a test fails, include the error message in the error field
- Execute all tests even if some fail — do not stop on failure
- Error Handling:
  - If a command returns non-zero exit code, mark as failed and continue to the next test
  - Capture stderr output for error field
  - Timeout commands after `TEST_COMMAND_TIMEOUT`
- Test execution order is important - dependencies should be validated first
- log the start, end and result of each test to the console for visibility
- All file paths are relative to the project root

## Test Execution Sequence

### Linting & Type Checks

1. **Linting**
   - Command: Read `## Run Linter` from `.adw/commands.md`. Default: `bun run lint`
   - test_name: "linting"
   - test_purpose: "Validates code quality for both application and ADW code, identifies unused imports, style violations, and potential bugs"

2. **TypeScript Type Check**
   - Command: Read `## Type Check` from `.adw/commands.md`. Default: `bunx tsc --noEmit`
   - test_name: "typescript_check"
   - test_purpose: "Validates TypeScript type correctness for the application without generating output files, catching type errors, missing imports, and incorrect function signatures"

3. **ADW TypeScript Check**
   - Command: Read `## Additional Type Checks` from `.adw/commands.md`. Default: `bunx tsc --noEmit -p adws/tsconfig.json`
   - test_name: "adw_typescript_check"
   - test_purpose: "Validates TypeScript type correctness for ADW scripts without generating output files"

### Build

4. **Build**
   - Command: Read `## Run Build` from `.adw/commands.md`. Default: `bun run build`
   - test_name: "app_build"
   - test_purpose: "Validates the complete build process including bundling, asset optimization, and production compilation"

### Application Tests

5. **Application Tests**
   - Read `## Run Tests` from `.adw/commands.md` to get the test command. Default: `bun run test`
   - Read `## Test Directory` from `.adw/commands.md` to get the test directory. Default: `src` when the section is absent.
   - Run the test command scoped to the test directory. Append the directory in the runner-appropriate way:
     - `pytest` / `go test`: positional argument — e.g. `pytest tests`, `go test ./tests/...`
     - Vitest / Bun test: via `-- --run <dir>` — e.g. `bun run test -- --run src`
   - **Run this test unconditionally** — there is no directory-existence check or skip condition. A missing `src/` directory is not a skip signal; run against whichever directory is configured.
   - If the runner discovers zero tests (e.g. pytest "collected 0 items", Vitest "no test files found"), report `passed: true` with `testcase_count: 0` — **do not fail the agent**. The verdict layer (not the agent) decides pass/warn/hard-fail.
   - Read the testcase count from the runner's own summary line (e.g. "5 passed", "collected 5 items").
   - test_name: "app_tests"
   - test_purpose: "Validates application-level test suites in the configured test directory"

## Report

- Return results exclusively as a JSON array based on the `Output Structure` section below.
- Sort the JSON array with failed tests (passed: false) at the top
- Include all tests in the output, both passed and failed
- The execution_command field should contain the exact command that can be run to reproduce the test
- This allows subsequent agents to quickly identify and resolve errors

### Output Structure

```json
[
  {
    "test_name": "string",
    "passed": boolean,
    "execution_command": "string",
    "test_purpose": "string",
    "error": "optional string",
    "testcase_count": "optional integer — number of testcases executed (0 when runner discovered none)"
  },
  ...
]
```

### Example Output

```json
[
  {
    "test_name": "app_build",
    "passed": false,
    "execution_command": "bun run build",
    "test_purpose": "Validates the complete build process including bundling, asset optimization, and production compilation",
    "error": "TS2345: Argument of type 'string' is not assignable to parameter of type 'number'"
  },
  {
    "test_name": "app_tests",
    "passed": true,
    "execution_command": "pytest tests",
    "test_purpose": "Validates application-level test suites in the configured test directory",
    "testcase_count": 7
  }
]
```
