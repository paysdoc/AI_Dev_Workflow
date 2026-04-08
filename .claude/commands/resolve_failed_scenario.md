---
target: false
---
# Resolve Failed Scenario

Fix a specific failing BDD scenario using the provided failure details.

## Instructions

1. **Analyze the E2E Test Failure**
   - Review the JSON data in the `Test Failure Input`, paying attention to:
     - `testName`: The name of the failing test
     - `testPath`: The path to the test file (you will need this for re-execution)
     - `error`: The specific error that occurred
     - `screenshots`: Any captured screenshots showing the failure state
     - `applicationUrl`: If present, use this URL instead of the default when re-running the test. If not present, read `.adw/commands.md` for the default dev server URL, falling back to `http://localhost:3000`
   - Understand what the test is trying to validate from a user interaction perspective

2. **Understand Test Execution**
   - Read the scenario file or step definitions to understand the test context
   - Read the test file specified in the `testPath` field from the JSON
   - Note the test steps, user story, and success criteria

3. **Reproduce the Failure**
   - IMPORTANT: Use the `testPath` from the JSON to re-execute the specific E2E test
   - Follow the BDD scenario execution pattern from `.adw/scenarios.md`
   - Observe the browser behavior and confirm you can reproduce the exact failure
   - Compare the error you see with the error reported in the JSON

4. **Fix the Issue**
   - Based on your reproduction, identify the root cause
   - Make minimal, targeted changes to resolve only this E2E test failure
   - Consider common E2E issues:
     - Element selector changes
     - Timing issues (elements not ready)
     - UI layout changes
     - Application logic modifications
   - Ensure the fix aligns with the user story and test purpose

5. **Validate the Fix**
   - Re-run the same E2E test step by step using the `testPath` to confirm it now passes
   - IMPORTANT: The test must complete successfully before considering it resolved
   - Do NOT run other tests or the full test suite
   - Focus only on fixing this specific E2E test

## Test Failure Input

$ARGUMENTS

## Report

Provide a concise summary of:
- Root cause identified (e.g., missing element, timing issue, incorrect selector)
- Specific fix applied
- Confirmation that the E2E test now passes after your fix