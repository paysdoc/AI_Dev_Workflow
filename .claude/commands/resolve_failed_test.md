---
target: false
---
# Resolve Failed Test

Fix a specific failing test using the provided failure details.

## Instructions

1. **Analyze the Test Failure**
   - Review the test name, purpose, and error message from the `Test Failure Input`
   - Understand what the test is trying to validate
   - Identify the root cause from the error details
   - A static-check round (type check, additional type checks, lint, build) hands over every failing static check at once: `execution_command` holds each failing check's command from `.adw/commands.md`, one per line, and `error` holds one section per failing check with its name, command, exit code and output, cut short when long. Run each command to see all of its output, and fix every listed check

2. **Context Discovery**
   - Check recent changes: `git diff origin/<defaultBranch> --stat --name-only`, where `<defaultBranch>` is the branch on the `HEAD branch:` line of `git remote show origin`
   - If a relevant spec exists in `specs/*.md`, read it to understand requirements
   - Focus only on files that could impact this specific test

3. **Reproduce the Failure**
   - IMPORTANT: Use the `execution_command` provided in the test data
   - Run it to see the full error output and stack trace
   - Confirm you can reproduce the exact failure

4. **Fix the Issue**
   - Make minimal, targeted changes to resolve only this test failure (for a static-check round: only the listed checks)
   - Ensure the fix aligns with the test purpose and any spec requirements
   - Do not modify unrelated code or tests
   - **Never silence a failure.** Fix the cause in the code. Do not:
     - add a comment that suppresses a check: `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, `biome-ignore`, `# noqa`, `# type: ignore`, `# pylint: disable`, `//nolint`, `#[allow(...)]`, `# rubocop:disable`, or the equivalent for any other tool
     - edit lint, compiler or build configuration (`eslint.config.*`, `.eslintrc*`, `tsconfig*.json`, `package.json`, `pyproject.toml`, `setup.cfg`, `.golangci.*`, `Cargo.toml` and the like), `.adw/commands.md`, or the Playwright configuration in `features/`
     - skip, delete or weaken a failing test or its assertion
   - ADW checks the diff of every static-check fix round. A round that adds a suppression comment or touches one of those files is rejected and reverted, and the run stops for a human

5. **Validate the Fix**
   - Re-run the same `execution_command` to confirm the test now passes
   - Do NOT run other tests or the full test suite
   - Focus only on fixing this specific test
   - Do not commit or push: ADW commits your changes itself

## Test Failure Input

$ARGUMENTS

## Report

Provide a concise summary of:
- Root cause identified
- Specific fix applied
- Confirmation that the test now passes