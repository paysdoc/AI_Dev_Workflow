# Bug: Worktree Discovery Inconsistent on Restart

## Metadata
issueNumber: `30`
adwId: `adw-unknown`
issueJson: `{}`

## Bug Description
When an ADW crashes before posting the `branch_created` GitHub comment, a restart fails to find the previously created worktree and instead creates a new one with a slightly different branch name.

**First run (crashes):**
```
[2026-02-26T11:58:49.624Z] [clear-comment-patter-7r08rt] Branch name generated: bug-issue-29-clear-comment-triggers-adw
```

**Restart (creates a new worktree instead of reusing):**
```
[2026-02-26T12:11:02.045Z] [clear-comment-patter-my7g9p] Branch name generated: bug-issue-29-fix-clear-comment-triggers-adw
```

**Expected:** The restart should detect the existing worktree `bug-issue-29-clear-comment-triggers-adw` and reuse it.
**Actual:** A new worktree `bug-issue-29-fix-clear-comment-triggers-adw` is created instead.

## Problem Statement
`findWorktreeForIssue` fails to match the existing worktree because `branchPrefixMap` in `adws/core/issueTypes.ts` maps `/bug` to `'bugfix'` and `/feature` to `'feature'`, but the `generate_branch_name.md` command instructs the LLM to generate branch names using `bug-` and `feat-` prefixes respectively. The pattern `^bugfix-issue-29-` is searched but the actual directory is named `bug-issue-29-...`, so no match is found.

The two-level recovery guard (`findWorktreeForIssue` then `recoveryState.branchName`) is only effective if at least one succeeds. When the crash happens before the `branch_created` comment is posted, `recoveryState.branchName` is `null`, so both guards fail and a new branch is generated.

## Solution Statement
Correct `branchPrefixMap` so that `/bug` maps to `'bug'` and `/feature` maps to `'feat'`, matching what `generate_branch_name.md` actually instructs the LLM to produce. Update the affected unit tests to use the corrected prefixes in their mock data, and add a regression test for the exact crash scenario described in the bug report.

## Steps to Reproduce
1. Trigger an ADW workflow for a `/bug` issue (e.g., issue #29)
2. The ADW generates branch name `bug-issue-29-...` and creates a worktree
3. The ADW crashes before the `branch_created` GitHub comment is posted
4. Restart the ADW for the same issue
5. Observe: `findWorktreeForIssue('/bug', 29)` returns `null` (pattern `^bugfix-issue-29-` does not match `bug-issue-29-...`)
6. Observe: `recoveryState.branchName` is `null` (no branch name in any comment)
7. Observe: `runGenerateBranchNameAgent` is called, generating a new different branch name
8. Observe: a new worktree is created instead of reusing the existing one

## Root Cause Analysis
In `adws/core/issueTypes.ts`, `branchPrefixMap` is defined as:
```typescript
export const branchPrefixMap: Record<IssueClassSlashCommand, string> = {
  '/feature': 'feature',  // ← incorrect; agent generates feat-
  '/bug': 'bugfix',        // ← incorrect; agent generates bug-
  '/chore': 'chore',       // ← correct
  '/pr_review': 'review',  // ← correct
};
```

The `generate_branch_name.md` command is passed `issueClass: /bug` and instructs the LLM with examples like `bug-issue-456-fix-login-error` and `feat-issue-123-add-user-auth`. The LLM strips the slash and uses the short form. This is also confirmed by `extractBranchNameFromComment` in `workflowCommentsBase.ts`, which already correctly uses the regex `(feat|bug|chore|review|test)-issue-\d+...`.

The mismatch means `findWorktreeForIssue` builds the wrong search pattern and can never find worktrees for `/bug` or `/feature` issues, making the primary recovery guard completely ineffective.

## Relevant Files

- **`adws/core/issueTypes.ts`** — Contains `branchPrefixMap` that needs to be corrected (lines ~102-107)
- **`adws/github/worktreeOperations.ts`** — Contains `findWorktreeForIssue` that consumes `branchPrefixMap` to build the search pattern (lines ~285-321)
- **`adws/__tests__/worktreeOperations.test.ts`** — Contains `findWorktreeForIssue` tests whose mock data uses the wrong prefixes; must be updated to reflect correct prefixes and a regression test added

### New Files
None required.

## Step by Step Tasks

### Step 1: Fix branchPrefixMap in issueTypes.ts
- Open `adws/core/issueTypes.ts`
- Locate `branchPrefixMap` (around line 102)
- Change `/bug` value from `'bugfix'` to `'bug'`
- Change `/feature` value from `'feature'` to `'feat'`

### Step 2: Update findWorktreeForIssue tests to use correct prefixes
- Open `adws/__tests__/worktreeOperations.test.ts`
- Locate the `describe('findWorktreeForIssue', ...)` block (around line 1423)
- In the **"returns worktree result when matching worktree exists"** test: update mock data directory `feature-issue-42-add-login` → `feat-issue-42-add-login` and branch ref `feature/issue-42-add-login` → `feat-issue-42-add-login`; update expected `worktreePath` and `branchName` to match
- In the **"matches correct prefix for bug issues"** test: update mock data directory `bugfix-issue-42-fix-bug` → `bug-issue-42-fix-bug` and branch ref `bugfix/issue-42-fix-bug` → `bug-issue-42-fix-bug`; update expected results to match
- In the **"does not match different issue type prefix"** test: update the mock directory `bugfix-issue-42-fix-bug` → `bug-issue-42-fix-bug` and branch ref accordingly (the test still expects `null` because `/feature` prefix `feat-` ≠ `bug-`)
- In the **"does not match different issue number"** test: update mock directory `feature-issue-42-add-login` → `feat-issue-42-add-login` and branch ref accordingly
- In the **"does not partial match issue numbers"** test: update mock directory `feature-issue-10-medium-fix` → `feat-issue-10-medium-fix` and branch ref accordingly
- In the **"returns the first match when multiple worktrees exist"** test: update both mock directories from `feature-issue-42-...` → `feat-issue-42-...` and branch refs accordingly; update expected results

### Step 3: Add regression test for the crash-before-comment scenario
- In the `describe('findWorktreeForIssue', ...)` block in `adws/__tests__/worktreeOperations.test.ts`, add a new test:
  - Name: `'finds bug worktree with bug- prefix matching the actual generated branch name pattern'`
  - Mock `git worktree list --porcelain` to return a worktree at `.worktrees/bug-issue-29-clear-comment-triggers-adw` with branch `bug-issue-29-clear-comment-triggers-adw`
  - Call `findWorktreeForIssue('/bug', 29)`
  - Assert: result is non-null with correct path and branch name (the exact scenario from the bug report)

### Step 4: Run validation commands
- Run all validation commands listed in the Validation Commands section

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

```bash
# Run the full test suite to confirm no regressions
npm test

# Run linter to check for code quality issues
npm run lint

# Run TypeScript type checks
npx tsc --noEmit
npx tsc --noEmit -p adws/tsconfig.json
```

Read `.adw/commands.md` from the current working directory for the project-specific validation commands.

## Notes
- The `extractBranchNameFromComment` regex in `workflowCommentsBase.ts` already correctly uses `(feat|bug|chore|review|test)` — confirming the expected branch prefixes and that this file does not need changes.
- The `workflowPhases.test.ts` mock data uses `'feature/issue-1-test'` and `'bug-issue-1-adw-recovered-id-fix-login'` as branch names. These are used as mocked return values for `runGenerateBranchNameAgent` and `detectRecoveryState` respectively, not as raw patterns in `findWorktreeForIssue` — no changes needed there.
- The root cause is a mismatch between what `branchPrefixMap` specifies vs. what `generate_branch_name.md` instructs the LLM to produce. The fix must stay consistent with the prompt examples in `generate_branch_name.md` (`bug-issue-`, `feat-issue-`, `chore-issue-`).
