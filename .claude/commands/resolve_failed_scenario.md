---
target: false
---
# Resolve Failed Scenario

Fix a specific failing BDD scenario using the provided failure details.

## Instructions

1. **Analyze the Scenario Failure**
   - Review the JSON data in the `Scenario Failure Input`, paying attention to:
     - `testName`: The name of the failing test
     - `testPath`: The path to the test file (you will need this for re-execution)
     - `error`: The specific error that occurred
     - `screenshots`: Any captured screenshots showing the failure state
     - `applicationUrl`: If present, use this URL instead of the default when re-running the test. If not present, read `.adw/commands.md` for the default dev server URL, falling back to `http://localhost:3000`
   - Understand what the test is trying to validate from a user interaction perspective

2. **Understand the Scenario**
   - Read the scenario file specified in the `testPath` field from the JSON
   - Note the scenario steps, user story, and success criteria

3. **Reproduce the Failure**
   - IMPORTANT: Use the `testPath` from the JSON to re-execute the specific scenario
   - Observe the output and confirm you can reproduce the exact failure
   - Compare the error you see with the error reported in the JSON

4. **Fix the Issue**
   - Based on your reproduction, identify the root cause
   - Make minimal, targeted changes to resolve only this scenario failure
   - Ensure the fix aligns with the scenario steps and expected behavior

   **Hermeticity** — you MAY edit application/implementation code to make the app hermetic for this scenario: add a test-mode switch (env var, flag, or route), stub external services, seed deterministic data, and freeze time/randomness. Editing app code alongside step definitions to reach hermeticity is explicitly authorized.

   **Frozen contract** — do NOT edit, add, or delete any `.feature` file. The Gherkin scenario is the immutable contract; fix the code and step definitions to satisfy it, never the reverse. Any `.feature` change you make will be automatically detected and reverted before the next test run and before the commit.

   **Budget** — resolve attempts are capped by the workflow's max-retry budget. If hermeticity/green is not reached within the budget the workflow hard-fails. Do not stub the assertion itself or weaken test expectations to force a pass — the hard-fail will surface this as a failed workflow instead.

5. **Validate the Fix**
   - Re-run the same scenario using the `testPath` to confirm it now passes
   - IMPORTANT: The scenario must complete successfully before considering it resolved
   - Do NOT run other tests or the full test suite
   - Focus only on fixing this specific scenario

## Scenario Failure Input

$ARGUMENTS

## Report

Provide a concise summary of:
- Root cause identified (e.g., missing element, timing issue, incorrect selector)
- Specific fix applied
- Confirmation that the scenario now passes after your fix