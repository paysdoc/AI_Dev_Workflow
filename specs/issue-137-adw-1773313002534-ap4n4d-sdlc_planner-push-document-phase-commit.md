# Bug: Document phase commit is not pushed, lost on branch deletion after PR merge

## Metadata
issueNumber: `137`
adwId: `1773313002534-ap4n4d`
issueJson: `{"number":137,"title":"Document phase commit is not pushed, lost on branch deletion after PR merge","body":"## Bug\n\nThe document phase (`executeDocumentPhase`) commits conditional documentation to the feature branch but never pushes the commit to the remote. Since the document phase runs **after** the PR phase (`executePRPhase`), the push that happens during PR creation does not include the documentation commit. When the PR is merged and the feature branch is deleted, the unpushed documentation commit is lost.\n\n## Affected Orchestrators\n\n- `adws/adwSdlc.tsx` — `executePRPhase` (line 83) runs before `executeDocumentPhase` (line 94)\n- `adws/adwPlanBuildDocument.tsx` — `executePRPhase` (line 64) runs before `executeDocumentPhase` (line 69)\n\n## Root Cause\n\n`executeDocumentPhase` in `adws/phases/documentPhase.ts` calls `runCommitAgent()` (line 89) which stages and commits changes but does not push. Since the branch was already pushed during `executePRPhase`, the new documentation commit only exists locally.\n\n## Expected Behavior\n\nThe documentation commit should be pushed to the remote branch so it is included in the PR before merge.\n\n## Suggested Fix\n\nAdd a `git push` after the `runCommitAgent()` call in `executeDocumentPhase` (`adws/phases/documentPhase.ts`, line 89), so the documentation commit is pushed to the already-existing remote branch.","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-12T10:56:30Z","comments":[],"actionableComment":null}`

## Bug Description
The `executeDocumentPhase` function in `adws/phases/documentPhase.ts` commits conditional documentation to the feature branch via `runCommitAgent()` (line 89) but never pushes the commit to the remote. Since the document phase runs **after** `executePRPhase` in both `adwSdlc.tsx` and `adwPlanBuildDocument.tsx`, the push that happens during PR creation does not include the later documentation commit. When the PR is merged and the feature branch is deleted on GitHub, the unpushed documentation commit is lost forever.

**Actual behavior:** Documentation commit exists only locally and is lost when the branch is deleted after PR merge.
**Expected behavior:** The documentation commit should be pushed to the remote branch so it appears in the PR diff before merge.

## Problem Statement
`executeDocumentPhase` calls `runCommitAgent()` to commit documentation changes but does not subsequently push those commits to the remote. The branch was already pushed during `executePRPhase`, so the new documentation commit only exists locally and is never included in the PR.

## Solution Statement
Add a `pushBranch()` call after `runCommitAgent()` in `executeDocumentPhase` to push the documentation commit to the already-existing remote branch. This follows the same pattern used in `prReviewCompletion.ts` (line 119) where `pushBranch(prDetails.headBranch, worktreePath)` is called after a commit agent run.

## Steps to Reproduce
1. Run a full SDLC workflow: `bunx tsx adws/adwSdlc.tsx <issueNumber>`
2. The plan, build, test, and PR phases execute — the branch is pushed during `executePRPhase`
3. `executeDocumentPhase` runs, generating documentation and committing it locally via `runCommitAgent()`
4. The workflow completes, but the documentation commit is never pushed
5. When the PR is merged and the branch is deleted on GitHub, the documentation commit is lost

## Root Cause Analysis
In `adws/phases/documentPhase.ts`, line 89 calls `runCommitAgent()` which stages and commits changes but does not push. The branch already has an upstream tracking reference (set during `executePRPhase`), but since no `pushBranch()` call follows the commit, the new commit remains local-only. This is in contrast to `prReviewCompletion.ts` (line 119) which correctly calls `pushBranch()` after its `runCommitAgent()` call.

The two affected orchestrators are:
- `adws/adwSdlc.tsx` — `executePRPhase` (line 83) runs before `executeDocumentPhase` (line 94)
- `adws/adwPlanBuildDocument.tsx` — `executePRPhase` (line 64) runs before `executeDocumentPhase` (line 69)

## Relevant Files
Use these files to fix the bug:

- `adws/phases/documentPhase.ts` — **Primary fix location.** Contains `executeDocumentPhase` which commits but does not push. Need to add `pushBranch()` after `runCommitAgent()` on line 89. Import `pushBranch` from `'../github'`.
- `adws/phases/__tests__/documentPhase.test.ts` — **Test file.** Existing tests for `executeDocumentPhase`. Need to add a test that verifies `pushBranch` is called after the commit with the correct branch name and worktree path.
- `adws/github/gitCommitOperations.ts` — **Reference.** Contains the `pushBranch()` function definition. No changes needed.
- `adws/github/index.ts` — **Reference.** Already exports `pushBranch`. No changes needed.
- `adws/phases/prReviewCompletion.ts` — **Reference.** Shows the existing pattern of calling `pushBranch()` after `runCommitAgent()` (line 119). No changes needed.
- `guidelines/coding_guidelines.md` — **Reference.** Coding guidelines to follow during implementation.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Add `pushBranch` import and call in `documentPhase.ts`

- Open `adws/phases/documentPhase.ts`
- Add `pushBranch` to the import from `'../github'` (line 14):
  ```typescript
  import {
    postWorkflowComment,
    pushBranch,
  } from '../github';
  ```
- Add `branchName` to the destructured config properties (line 33):
  ```typescript
  const { orchestratorStatePath, adwId, issueNumber, issueType, issue, ctx, worktreePath, logsDir, repoInfo, branchName } = config;
  ```
- Add `pushBranch()` call immediately after the `runCommitAgent()` call on line 89:
  ```typescript
  // Commit documentation
  await runCommitAgent('document-agent', issueType, JSON.stringify(issue), logsDir, undefined, worktreePath, issue.body);

  // Push documentation commit to remote
  pushBranch(branchName, worktreePath);
  ```

### 2. Add unit test for push behavior in `documentPhase.test.ts`

- Open `adws/phases/__tests__/documentPhase.test.ts`
- Add `pushBranch` to the `'../../github'` mock (the mock already exists at line 19-21):
  ```typescript
  vi.mock('../../github', () => ({
    postWorkflowComment: vi.fn(),
    pushBranch: vi.fn(),
  }));
  ```
- Add `pushBranch` to the import from `'../../github'` (line 36):
  ```typescript
  import { postWorkflowComment, pushBranch } from '../../github';
  ```
- Add a new test case that verifies `pushBranch` is called with the branch name and worktree path after successful document generation:
  ```typescript
  it('pushes documentation commit to remote after commit', async () => {
    await executeDocumentPhase(makeConfig());

    expect(pushBranch).toHaveBeenCalledWith('feat-issue-42-test', '/mock/worktree');
  });
  ```
- Add a test case verifying `pushBranch` is NOT called when the document agent fails:
  ```typescript
  it('does not push when document agent fails', async () => {
    vi.mocked(runDocumentAgent).mockResolvedValueOnce({
      success: false,
      output: 'Failed',
      totalCostUsd: 0.05,
      docPath: '',
    });

    await expect(executeDocumentPhase(makeConfig())).rejects.toThrow();

    expect(pushBranch).not.toHaveBeenCalled();
  });
  ```

### 3. Run validation commands

- Run the validation commands listed below to confirm the fix works and causes no regressions.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

- `bun run lint` - Run linter to check for code quality issues
- `bunx tsc --noEmit` - Type check the project
- `bunx tsc --noEmit -p adws/tsconfig.json` - Type check the adws project
- `bun run test` - Run all tests to validate the fix and ensure zero regressions

## Notes
- The fix follows the exact same pattern as `prReviewCompletion.ts` (line 119) which calls `pushBranch(prDetails.headBranch, worktreePath)` after `runCommitAgent()`.
- The standalone `adws/adwDocument.tsx` is NOT affected — it runs `runDocumentAgent()` directly without `executeDocumentPhase` and is used for local documentation generation only (no branch/PR context).
- Strictly adhere to coding guidelines in `guidelines/coding_guidelines.md`.
