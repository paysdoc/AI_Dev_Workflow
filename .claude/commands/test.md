---
target: false
---
# Application Unit Tests

Run the application's unit tests and return the result in a standardized JSON format for automated processing.

## Purpose

ADW derives the verdict of the unit tests from the JUnit report this command's test run emits, and runs every other check of the code itself, before this command starts. This command runs the unit tests and reports what happened. It checks nothing else.

## Variables

TEST_COMMAND_TIMEOUT: 5 minutes

## Instructions

- Read `.adw/commands.md` from the current working directory for all project-specific commands. If `.adw/commands.md` does not exist, use the default command shown in the test step below.
- Run only the test in the sequence provided below, and no other command that checks the code
- Capture the result (passed/failed) and any error messages
- CRITICAL: Return ONLY the JSON array with the test result. No additional text, explanations, or markdown formatting — `JSON.parse()` runs directly on your output.
- If the test passes, omit the error field
- If the test fails, include the error message in the error field
- Error Handling:
  - If the command returns a non-zero exit code, mark the test as failed
  - Capture stderr output for the error field
  - Timeout the command after `TEST_COMMAND_TIMEOUT`
- log the start, end and result of the test to the console for visibility
- All file paths are relative to the project root

## Test Execution Sequence

### Application Tests

1. **Application Tests**
   - Command: Read `## Run Tests` from `.adw/commands.md` and run it exactly as written. Default: `bun run test:unit`
   - test_name: "app_tests"
   - test_purpose: "Validates the full application unit-test suite as configured in .adw/commands.md"
   - The runner emits a JUnit report to the path in `$ADW_UNIT_TEST_REPORT_PATH` via flags already configured in `## Run Tests`. Do NOT delete or relocate that file after the run.
   - Run this test unconditionally — do not skip based on directory existence. The `testcase_count` field in the output is informational; the authoritative verdict is derived from the JUnit report by `unitTestPhase`.

## Report

- Return the result exclusively as a JSON array based on the `Output Structure` section below.
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
  }
]
```

### Example Output

```json
[
  {
    "test_name": "app_tests",
    "passed": false,
    "execution_command": "bun run test:unit",
    "test_purpose": "Validates the full application unit-test suite as configured in .adw/commands.md",
    "error": "FAIL src/parser.test.ts > parseInput > rejects an empty string\nAssertionError: expected [Function] to throw an error"
  }
]
```
