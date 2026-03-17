# Bug: PR review worktree creation fails when branch only exists on remote

## Metadata
issueNumber: `217`
adwId: `7nw4nz-bug-in-target-repo`
issueJson: `{"number":217,"title":"Bug in target repo","body":"...worktreeCreation.ts:144 throw new Error...Branch 'chore-issue-28-update-command-md' does not exist and no base branch was provided...","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-17T13:57:20Z","comments":[],"actionableComment":null}`

## Bug Description
When the PR review workflow (`adwPrReview.tsx`) is triggered for a PR whose head branch only exists on the remote (not yet fetched locally), worktree creation fails with:

```
Error: Failed to create worktree for branch 'chore-issue-28-update-command-md': Error: Branch 'chore-issue-28-update-command-md' does not exist and no base branch was provided
```

**Expected behavior**: The PR review workflow should fetch the branch from the remote and create a worktree for it, since the branch is the head of an open PR and must exist on GitHub.

**Actual behavior**: `createWorktree` checks local refs and stale remote tracking refs, finds neither, and throws because no `baseBranch` fallback was provided by the caller (`prReviewPhase.ts`).

## Problem Statement
`createWorktree()` in `worktreeCreation.ts` checks `git rev-parse --verify "origin/${branchName}"` to see if the branch exists on the remote, but this only checks locally-cached remote tracking refs. If `git fetch` hasn't been run for that specific branch, the tracking ref doesn't exist locally, causing both the local and remote checks to fail. The PR review workflow at `prReviewPhase.ts:92` calls `ensureWorktree(prDetails.headBranch)` without a `baseBranch` — which is correct (the branch already exists on GitHub, we don't want to create a new one) — but `createWorktree` has no fallback fetch mechanism.

## Solution Statement
Add a `git fetch origin "${branchName}"` attempt in `createWorktree()` when both the local and stale remote ref checks fail. After fetching, re-check `origin/${branchName}`. If the fetch succeeds and the ref now exists, proceed normally with worktree creation. This is a surgical fix in `createWorktree` that benefits all callers, not just the PR review flow.

## Steps to Reproduce
1. Have a target repository with a PR whose head branch (`chore-issue-28-update-command-md`) has not been fetched locally
2. Trigger the PR review workflow: `bunx tsx adws/adwPrReview.tsx <pr-number>`
3. The workflow calls `initializePRReviewWorkflow` → `ensureWorktree(prDetails.headBranch)` → `createWorktree(branchName)` with no `baseBranch`
4. `createWorktree` fails because:
   - `git rev-parse --verify "chore-issue-28-update-command-md"` fails (no local branch)
   - `git rev-parse --verify "origin/chore-issue-28-update-command-md"` fails (stale tracking refs)
   - No `baseBranch` provided, so the error is thrown

## Root Cause Analysis
The root cause is a missing `git fetch` step in `createWorktree()`. The function assumes that if a branch exists on the remote, `origin/${branchName}` will already be available in the local refs. This assumption breaks when:

1. The target repo was cloned with minimal fetch depth or the branch was pushed to the remote after the last fetch
2. The cron/webhook trigger spawns a fresh process that inherits a stale git state
3. The PR review workflow is the first operation targeting this specific branch

The normal workflow (`initializeWorkflow` in `workflowInit.ts`) avoids this by always passing `defaultBranch` as the `baseBranch` parameter to `ensureWorktree`, which creates a new branch from the base. But in the PR review case, the branch already exists and should be checked out — creating a new branch from a base would be wrong.

## Relevant Files
Use these files to fix the bug:

- `adws/vcs/worktreeCreation.ts` — Contains `createWorktree()` where the fix needs to be applied. The branch existence check at lines 96-109 needs a fetch fallback before concluding the branch doesn't exist.
- `adws/phases/prReviewPhase.ts` — The caller at line 92 that triggers the bug. No changes needed here since the fix is in `createWorktree`.
- `guidelines/coding_guidelines.md` — Coding guidelines to follow during implementation.

## Step by Step Tasks

### 1. Add fetch fallback to `createWorktree` in `adws/vcs/worktreeCreation.ts`

- In the `createWorktree` function, after the remote ref check (`git rev-parse --verify "origin/${branchName}"`) fails at lines 103-108, add a fetch attempt before setting `branchExists = false`
- The logic should be:
  1. Try `git fetch origin "${branchName}"` using the same `gitOpts`
  2. If fetch succeeds, re-check `git rev-parse --verify "origin/${branchName}"`
  3. If the re-check succeeds, set `branchExists = true`
  4. If either the fetch or re-check fails, set `branchExists = false` (current behavior)
- Add a log message when the fetch succeeds: `log(\`Fetched branch '${branchName}' from origin\`, 'info')`
- The modified code in the inner catch block (lines 105-108) should look like:

```typescript
catch {
  // Remote ref not found locally, try fetching from origin
  try {
    execSync(`git fetch origin "${branchName}"`, gitOpts);
    execSync(`git rev-parse --verify "origin/${branchName}"`, gitOpts);
    branchExists = true;
    log(`Fetched branch '${branchName}' from origin`, 'info');
  } catch {
    branchExists = false;
  }
}
```

### 2. Add BDD scenario for PR review worktree creation with unfetched branch

- Create a new feature file `features/pr_review_worktree_fetch.feature` with a scenario that validates:
  - Given a branch exists only on the remote (not in local refs)
  - When `createWorktree` is called for that branch without a `baseBranch`
  - Then `createWorktree` fetches the branch from origin and creates the worktree successfully
- Create step definitions in `features/step_definitions/prReviewWorktreeFetchSteps.ts`
- Tag the scenario with `@adw-217` and `@regression`

### 3. Run validation commands

- Run all validation commands listed below to ensure the fix compiles, passes linting, and introduces no regressions.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Type check the root project
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type check the adws project
- `bunx cucumber-js --tags "@adw-217"` — Run the new BDD scenario for this fix
- `bunx cucumber-js --tags "@regression"` — Run all regression scenarios to ensure no regressions

## Notes
- This is a minimal fix in `createWorktree` that benefits all callers, not just the PR review flow. Any code path that calls `createWorktree` for an existing remote branch that hasn't been fetched locally will now self-heal.
- The `git fetch origin "${branchName}"` is a targeted fetch (single branch), not a full `git fetch`, so it's fast and doesn't pull unnecessary data.
- The coding guidelines in `guidelines/coding_guidelines.md` must be strictly followed: meaningful error messages, type safety, and pure function preferences.
