# Bug: PR created against `main` instead of repository default branch

## Metadata
issueNumber: `62`
adwId: `pr-for-vestmatic-is-8lmju4`
issueJson: `{"number":62,"title":"PR for vestmatic is not sent to default branch","body":"The following PR, https://github.com/vestmatic/vestmatic/pull/10, proposes to merge the new branch to main instead of the default branch.","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-03T12:32:42Z","comments":[],"actionableComment":null}`

## Bug Description
When ADW creates a pull request for an external repository (vestmatic/vestmatic), the PR targets `main` instead of the repository's actual default branch (`stage-3`). The vestmatic PR #10 was created with `--base main` when it should have been `--base stage-3`.

**Expected behavior:** The PR should target the repository's default branch as configured on GitHub (e.g., `stage-3` for vestmatic).

**Actual behavior:** The PR targets `main` because the AI model running the `/pull_request` slash command either fails to correctly determine the default branch or falls back to `main`.

## Problem Statement
The `/pull_request` slash command delegates default branch detection to the AI model by instructing it to run `git remote show origin` and parse the output. This is unreliable because:
1. The AI model (sonnet) must correctly execute the command, parse freeform shell output, and extract the `HEAD branch:` line
2. If parsing fails or the command errors, the model silently falls back to `main`
3. There is already a reliable programmatic function `getDefaultBranch()` in `gitOperations.ts` that uses the GitHub API (`gh repo view --json defaultBranchRef`) — but it's not used in the PR creation flow

## Solution Statement
Determine the default branch programmatically inside `runPullRequestAgent()` using the existing `getDefaultBranch()` function before invoking the Claude agent, and pass the resolved branch name to the `/pull_request` slash command as a new variable (`$5`). Update the slash command to use this variable directly instead of trying to determine the default branch itself.

## Steps to Reproduce
1. Set up ADW with an external target repository whose default branch is NOT `main` (e.g., vestmatic/vestmatic with default branch `stage-3`)
2. Run a workflow that reaches the PR creation phase (e.g., `adwPlanBuild.tsx`)
3. Observe that the created PR targets `main` instead of the repository's actual default branch

## Root Cause Analysis
The flow is:
1. `executePRPhase()` calls `runPullRequestAgent()` → which calls `runClaudeAgentWithCommand('/pull_request', args, ...)`
2. The args passed are: `branchName\nissueJson\nplanFile\nadwId` (4 values)
3. The `/pull_request` slash command maps these to `$1`–`$4` and instructs the AI model to determine the default branch by running `git remote show origin`
4. The AI model either fails to parse the output correctly or defaults to `main`

The reliable `getDefaultBranch()` function already exists in `adws/github/gitOperations.ts` and uses `gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name'` which queries the GitHub API directly. This function is used elsewhere (e.g., `checkoutDefaultBranch()`, `pullLatestDefaultBranch()`) but is not used in the PR agent flow.

## Relevant Files
Use these files to fix the bug:

- `adws/agents/prAgent.ts` — Contains `formatPullRequestArgs()` and `runPullRequestAgent()`. Must be updated to determine and pass the default branch.
- `.claude/commands/pull_request.md` — The slash command template. Must be updated to accept `$5` (defaultBranch) and use it instead of `git remote show origin`.
- `adws/github/gitOperations.ts` — Contains the `getDefaultBranch()` function that will be imported and used. Read-only reference.
- `adws/phases/prPhase.ts` — Calls `runPullRequestAgent()`. Read-only reference to verify no caller changes are needed.
- `adws/adwPatch.tsx` — Also calls `runPullRequestAgent()`. Read-only reference to verify no caller changes are needed.
- `adws/__tests__/workflowPhases.test.ts` — Existing test for PR phase. Read-only reference.
- `guidelines/coding_guidelines.md` — Coding guidelines. Must be followed.

### New Files
- `adws/__tests__/prAgent.test.ts` — Unit tests for `formatPullRequestArgs()` and `runPullRequestAgent()` to validate the default branch is correctly resolved and passed.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Update `formatPullRequestArgs()` in `adws/agents/prAgent.ts`
- Add a 5th parameter `defaultBranch: string` to the function signature
- Append `defaultBranch` to the returned string as the 5th newline-separated value
- The return should be: `${branchName}\n${issueJson}\n${planFile}\n${adwId}\n${defaultBranch}`

### Step 2: Update `runPullRequestAgent()` in `adws/agents/prAgent.ts`
- Import `getDefaultBranch` from `../github/gitOperations`
- Before calling `formatPullRequestArgs()`, call `getDefaultBranch(cwd)` to resolve the default branch
- Log the resolved default branch for debugging: `log(\`  Default branch: ${defaultBranch}\`, 'info');`
- Pass the resolved `defaultBranch` as the 5th argument to `formatPullRequestArgs()`
- No changes to the function signature — the default branch is determined internally

### Step 3: Update `.claude/commands/pull_request.md`
- Add `defaultBranch: $5, defaults to 'main' if not provided` to the Variables section
- In the Instructions section, replace the instruction to use `git remote show origin` with: "Use the `defaultBranch` variable as the base branch for the PR"
- In the Run section, replace all `<default>` placeholders with the `defaultBranch` variable
- Remove any instructions about parsing `git remote show origin` output

### Step 4: Add unit tests in `adws/__tests__/prAgent.test.ts`
- Test `formatPullRequestArgs()`:
  - Verify it returns the correct 5-value newline-separated string including defaultBranch
- Test `runPullRequestAgent()` (mocking dependencies):
  - Mock `getDefaultBranch` to return `'stage-3'`
  - Verify the default branch is resolved using the `cwd` parameter
  - Verify the resolved default branch is included in the args passed to `runClaudeAgentWithCommand`
  - Test that when `cwd` is undefined, `getDefaultBranch` is called with `undefined`

### Step 5: Run Validation Commands
- Run the validation commands below to ensure the bug is fixed with zero regressions.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

- `npm run lint` - Run linter to check for code quality issues
- `npm run build` - Build the application to verify no build errors
- `npm test` - Run all tests to validate the fix with zero regressions
- `npx vitest run adws/__tests__/prAgent.test.ts` - Run the new PR agent tests specifically

## Notes
- The `guidelines/coding_guidelines.md` must be followed: keep functions pure where possible, use meaningful names, write unit tests.
- The `getDefaultBranch()` function already correctly handles the `cwd` parameter via `resolveTargetRepoCwd()`, so it works in both local and worktree contexts.
- No changes are needed to callers (`prPhase.ts`, `adwPatch.tsx`) since the default branch resolution is encapsulated inside `runPullRequestAgent()`.
- The existing `pullRequestCreator.ts` (programmatic PR creator) has a separate `baseBranch` parameter defaulting to `'develop'`. This file is NOT used by the slash command flow and is not affected by this fix.
