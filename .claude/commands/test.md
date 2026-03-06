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
- IMPORTANT: Return ONLY the JSON array with test results
  - IMPORTANT: Do not include any additional text, explanations, or markdown formatting
  - We'll immediately run JSON.parse() on the output, so make sure it's valid JSON
- If a test passes, omit the error field
- If a test fails, include the error message in the error field
- Execute all tests even if some fail
- Error Handling:
  - If a command returns non-zero exit code, mark as failed and immediately stop processing tests
  - Capture stderr output for error field
  - Timeout commands after `TEST_COMMAND_TIMEOUT`
  - IMPORTANT: If a test fails, stop processing tests and return the results thus far
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

### ADW Tests

4. **ADW Tests**
   - Command: Read `## Run Tests` from `.adw/commands.md` and append the ADW test subset path. Default: `bun run test -- --run adws/__tests__`
   - test_name: "adw_tests"
   - test_purpose: "Validates all ADW (AI Developer Workflow) script functionality including workflow execution and utilities"

### Build

5. **Build**
   - Command: Read `## Run Build` from `.adw/commands.md`. Default: `bun run build`
   - test_name: "app_build"
   - test_purpose: "Validates the complete build process including bundling, asset optimization, and production compilation"

### Application Tests

6. **Application Tests**
   - Command: Read `## Run Tests` from `.adw/commands.md` and append the application test subset path. Default: `bun run test -- --run src`
   - test_name: "app_tests"
   - test_purpose: "Validates application-level test suites under the src/ directory in the target repository"
   - Condition: Only execute if a `src/` directory exists in the working directory. If `src/` does not exist, skip this test and mark it as passed with a note indicating it was skipped (no src/ directory found).

## Report

- IMPORTANT: Return results exclusively as a JSON array based on the `Output Structure` section below.
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
    "error": "optional string"
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
    "test_name": "adw_tests",
    "passed": true,
    "execution_command": "bun run test -- --run adws/__tests__",
    "test_purpose": "Validates all ADW (AI Developer Workflow) script functionality including workflow execution and utilities"
  }
]
```
