# Bug: prAgent passes args as string instead of array

## Metadata
issueNumber: `71`
adwId: `pragent-passes-args-vrcjoy`
issueJson: `{"number":71,"title":"prAgent passes args as string","body":"function formatPullRequestArgs formats the arguments as a string. This leads the ``/pull_request``` command to misinterpret the arguments. The args should be offered as an array.","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-05T12:21:55Z","comments":[],"actionableComment":null}`

## Bug Description
The `formatPullRequestArgs` function in `adws/agents/prAgent.ts` returns a single newline-separated string containing all 5 arguments (branchName, issueJson, planFile, adwId, defaultBranch). When this string is passed to `runClaudeAgentWithCommand`, it is treated as a single argument and wrapped in a single pair of quotes. This means the `/pull_request` slash command receives the entire string as `$ARGUMENTS` (or `$1`), and variables `$2` through `$5` are empty.

**Expected behavior:** Each argument should be passed as a separate positional argument so the `/pull_request` command can access them as `$1`, `$2`, `$3`, `$4`, `$5`.

**Actual behavior:** All arguments are concatenated into one newline-separated string and passed as a single argument.

## Problem Statement
`formatPullRequestArgs` returns a `string` instead of a `string[]`, causing `runClaudeAgentWithCommand` to treat all 5 values as one argument rather than 5 separate positional arguments.

## Solution Statement
Change `formatPullRequestArgs` to return a `string[]` (array of strings) instead of a single newline-separated `string`. This aligns with how `runClaudeAgentWithCommand` handles array args — each element becomes a separate single-quoted positional argument ($1, $2, $3, etc.). This pattern is already used by `planAgent.ts` (line 271).

## Steps to Reproduce
1. Run any ADW workflow that reaches the PR phase (e.g., `npx tsx adws/adwPlanBuild.tsx <issue>`)
2. Observe that `formatPullRequestArgs` returns a newline-separated string
3. `runClaudeAgentWithCommand` wraps the entire string in single quotes as one argument
4. The `/pull_request` command receives `$1` = entire multi-line string, `$2`–`$5` = empty

## Root Cause Analysis
In `adws/agents/prAgent.ts`, `formatPullRequestArgs` (line 14–22) joins arguments with `\n` and returns a `string`. The `runClaudeAgentWithCommand` function (in `claudeAgent.ts`, line 302–306) handles strings by wrapping them in a single set of quotes, meaning the entire multi-line string becomes one CLI argument. When the slash command template tries to access `$1`, `$2`, etc., only `$1` contains data (the full concatenated string) and all other variables are empty.

The fix is straightforward: return an array so each value maps to its own positional argument, matching the pattern used by other agents like `planAgent.ts`.

## Relevant Files
Use these files to fix the bug:

- `adws/agents/prAgent.ts` — Contains `formatPullRequestArgs` which needs to return `string[]` instead of `string`. This is the primary file to fix.
- `adws/__tests__/prAgent.test.ts` — Contains tests for `formatPullRequestArgs` and `runPullRequestAgent` that need to be updated to expect an array return type.
- `adws/agents/claudeAgent.ts` — Contains `runClaudeAgentWithCommand` which already supports `string | readonly string[]` args. No changes needed, but useful for understanding the fix.
- `guidelines/coding_guidelines.md` — Coding guidelines to follow.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Update `formatPullRequestArgs` to return a `string[]`

- In `adws/agents/prAgent.ts`, change the return type of `formatPullRequestArgs` from `string` to `string[]`
- Replace the newline-concatenated return statement with an array literal:
  ```ts
  return [branchName, issueJson, planFile, adwId, defaultBranch];
  ```

### 2. Update tests in `adws/__tests__/prAgent.test.ts`

- Update the `formatPullRequestArgs` test suite:
  - Change the first test ("returns 5-value newline-separated string including defaultBranch") to verify the function returns an array of 5 elements with correct values at each index
  - Change the second test ("includes the default branch as the 5th value") to verify the array's 5th element (index 4) is the default branch
- Update the `runPullRequestAgent` test ("includes resolved default branch in args passed to agent"):
  - Change the assertion to treat `args` as a `string[]` instead of splitting by newlines
  - Verify `args[4]` equals `'stage-3'`

### 3. Run validation commands

- Run all validation commands listed below to confirm the fix works with zero regressions.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

- `npx tsc --noEmit -p adws/tsconfig.json` — Type-check the adws project to verify the return type change compiles correctly
- `npm test` — Run all tests to validate the fix and ensure zero regressions
- `npm run lint` — Run linter to check for code quality issues
- `npm run build` — Build the application to verify no build errors

## Notes
- The `guidelines/coding_guidelines.md` coding guidelines are followed: the fix uses immutability (returning a new array), type safety (changing the return type), and clarity (array literal is more explicit than string concatenation).
- This fix follows the existing pattern in `planAgent.ts` (line 271) which already passes args as an array: `const args = [String(issue.number), adwId || 'adw-unknown', issueJson];`
- No new libraries are required.
