# Chore: Provider interface — approvePR, issueHasLabel, fetchPRDetails

## Metadata
issueNumber: `353`
adwId: `pwsvyi-refactor-provider-in`
issueJson: `{"number":353,"title":"refactor: provider interface — approvePR, issueHasLabel, fetchPRDetails","body":"## Parent PRD\n\n`specs/prd/declarative-orchestration-architecture.md`\n\n## What to build\n\nComplete the provider abstraction for phase files by adding missing operations to the provider interfaces and routing phase code through `repoContext` instead of direct GitHub imports.\n\n**Add to provider interfaces** (`adws/providers/types.ts`):\n- `CodeHost.approvePR(prNumber)` — approve a pull request (used in auto-merge flow)\n- `IssueTracker.issueHasLabel(issueNumber, label)` — check if an issue has a specific label (used in HITL gate)\n- `CodeHost.fetchPRDetails(prNumber)` — fetch full PR details (used in PR review init)\n\n**Implement in GitHub provider:**\n- `githubCodeHost.ts` — implement `approvePR` and `fetchPRDetails`, delegating to existing functions in `adws/github/prApi.ts`\n- `githubIssueTracker.ts` — implement `issueHasLabel`, delegating to existing function in `adws/github/issueApi.ts`\n\n**Update phase files:**\n- `autoMergePhase.ts` — replace direct imports of `approvePR`, `issueHasLabel`, `commentOnIssue`, `commentOnPR` from `../github` with `repoContext.codeHost.*` / `repoContext.issueTracker.*`\n- `prReviewPhase.ts` — replace direct import of `fetchPRDetails`, `getUnaddressedComments` from `../github` with provider calls\n\n**Out of scope:** Triggers remain GitHub-specific. Comment formatting (`formatWorkflowComment`) and auth refresh (`refreshTokenIfNeeded`) stay as direct imports.\n\n## Acceptance criteria\n\n- [ ] `CodeHost.approvePR(prNumber)` added to interface and implemented in GitHub provider\n- [ ] `IssueTracker.issueHasLabel(issueNumber, label)` added to interface and implemented in GitHub provider\n- [ ] `CodeHost.fetchPRDetails(prNumber)` added to interface and implemented in GitHub provider\n- [ ] `autoMergePhase.ts` routes through `repoContext` — no direct `../github` imports for these operations\n- [ ] `prReviewPhase.ts` routes through `repoContext` for PR detail fetching\n- [ ] Auto-merge flow works end-to-end through provider abstraction\n- [ ] PR review flow works end-to-end through provider abstraction\n- [ ] All new interface methods have explicit TypeScript types\n\n## Blocked by\n\nNone — can start immediately.\n\n## User stories addressed\n\n- User story 17 (approvePR, issueHasLabel, fetchPRDetails on provider interface)\n- User story 18 (phase code goes through provider for future platform support)\n- User story 20 (explicit TypeScript types at all boundaries)","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-30T08:32:38Z","comments":[],"actionableComment":null}`

## Chore Description

Complete the provider abstraction for phase files by adding three missing operations to the provider interfaces (`CodeHost` and `IssueTracker`) and routing `autoMergePhase.ts` and `prReviewPhase.ts` through `repoContext` instead of direct GitHub imports.

Currently, `autoMergePhase.ts` imports `approvePR`, `issueHasLabel`, `commentOnIssue`, and `commentOnPR` directly from `../github`, and `prReviewPhase.ts` imports `fetchPRDetails` directly from `../github`. These direct imports bypass the provider abstraction layer that was introduced for platform-agnostic support.

The three new provider interface methods are:
- `CodeHost.approvePR(prNumber)` — approve a pull request (auto-merge flow)
- `CodeHost.fetchPRDetails(prNumber)` — fetch full PR details with state info (PR review init)
- `IssueTracker.issueHasLabel(issueNumber, label)` — check if an issue has a label (HITL gate)

Additionally, `commentOnIssue` and `commentOnPR` already exist on the provider interfaces as `IssueTracker.commentOnIssue()` and `CodeHost.commentOnPullRequest()`, so `autoMergePhase.ts` simply needs to route through those existing methods.

**Out of scope:** Triggers remain GitHub-specific. `formatWorkflowComment`, `refreshTokenIfNeeded`, `activateGitHubAppAuth`, `isGitHubAppConfigured`, and `getRepoInfo` stay as direct imports. `getUnaddressedComments` stays as a direct GitHub import because it contains complex filtering logic that is inherently GitHub-specific (uses `isResolved` field on GitHub review comments).

## Relevant Files
Use these files to resolve the chore:

### Provider layer (interfaces + types)
- `adws/providers/types.ts` — Add `ApproveResult` type, `PullRequestDetails` type, new methods to `CodeHost` and `IssueTracker` interfaces
- `adws/providers/github/mappers.ts` — Add `mapPRDetailsToPullRequestDetails` mapper for the new `fetchPRDetails` return type

### GitHub provider implementations
- `adws/providers/github/githubCodeHost.ts` — Implement `approvePR` and `fetchPRDetails` on `GitHubCodeHost`
- `adws/providers/github/githubIssueTracker.ts` — Implement `issueHasLabel` on `GitHubIssueTracker`

### Underlying GitHub API functions (read-only reference)
- `adws/github/prApi.ts` — Contains `approvePR(prNumber, repoInfo)` at line 217 and `fetchPRDetails(prNumber, repoInfo)` at line 57
- `adws/github/issueApi.ts` — Contains `issueHasLabel(issueNumber, labelName, repoInfo)` at line 272

### Phase files to update
- `adws/phases/autoMergePhase.ts` — Replace all direct `../github` operation imports with `repoContext.*` provider calls
- `adws/phases/prReviewPhase.ts` — Replace `fetchPRDetails` direct import with `repoContext.codeHost.fetchPRDetails()`, construct `repoContext` earlier

### Type reference (read-only)
- `adws/types/workflowTypes.ts` — Contains `PRDetails` interface (lines 77-88), used by agent functions downstream

### Coding guidelines
- `guidelines/coding_guidelines.md` — Follow coding guidelines (type safety, no `any`, single responsibility)

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Add new types and interface methods to `adws/providers/types.ts`

- Add an `ApproveResult` interface after `PullRequestResult`:
  ```typescript
  export interface ApproveResult {
    success: boolean;
    error?: string;
  }
  ```
- Add a `PullRequestDetails` interface that extends `PullRequest` with the `state` field (needed by `prReviewPhase.ts` to check closed/merged status):
  ```typescript
  export interface PullRequestDetails extends PullRequest {
    state: string;
  }
  ```
- Add to the `CodeHost` interface (after `fetchPullRequest`):
  ```typescript
  approvePR(prNumber: number): ApproveResult;
  fetchPRDetails(prNumber: number): PullRequestDetails;
  ```
- Add to the `IssueTracker` interface (after `fetchComments`):
  ```typescript
  issueHasLabel(issueNumber: number, labelName: string): boolean;
  ```

### Step 2: Add mapper for `PullRequestDetails` in `adws/providers/github/mappers.ts`

- Add a `mapPRDetailsToPullRequestDetails` function that maps `PRDetails` (from `workflowTypes.ts`) to the new provider `PullRequestDetails` type:
  ```typescript
  export function mapPRDetailsToPullRequestDetails(pr: PRDetails): PullRequestDetails {
    return {
      number: pr.number,
      title: pr.title,
      body: pr.body,
      state: pr.state,
      sourceBranch: pr.headBranch,
      targetBranch: pr.baseBranch,
      url: pr.url,
      linkedIssueNumber: pr.issueNumber ?? undefined,
    };
  }
  ```
- Import `PullRequestDetails` from `../types` in the mappers file.

### Step 3: Implement `approvePR` and `fetchPRDetails` in `adws/providers/github/githubCodeHost.ts`

- Import `approvePR as ghApprovePR` from `../../github/prApi` (the existing `fetchPRDetails` import is already present).
- Import `ApproveResult` and `PullRequestDetails` from `../types`.
- Import `mapPRDetailsToPullRequestDetails` from `./mappers`.
- Implement `approvePR(prNumber: number): ApproveResult`:
  ```typescript
  approvePR(prNumber: number): ApproveResult {
    return ghApprovePR(prNumber, this.repoInfo);
  }
  ```
  Note: the `GH_TOKEN` unset/restore logic lives inside `prApi.approvePR` already — no need to duplicate it.
- Implement `fetchPRDetails(prNumber: number): PullRequestDetails`:
  ```typescript
  fetchPRDetails(prNumber: number): PullRequestDetails {
    const pr = fetchPRDetails(prNumber, this.repoInfo);
    return mapPRDetailsToPullRequestDetails(pr);
  }
  ```
  Note: there is already an import of `fetchPRDetails` from `prApi`. The method name conflicts with the import — rename the import to `ghFetchPRDetails` to avoid shadowing, and update the existing `fetchPullRequest` method to use the renamed import.

### Step 4: Implement `issueHasLabel` in `adws/providers/github/githubIssueTracker.ts`

- Import `issueHasLabel as ghIssueHasLabel` from `../../github/issueApi`.
- Implement `issueHasLabel(issueNumber: number, labelName: string): boolean`:
  ```typescript
  issueHasLabel(issueNumber: number, labelName: string): boolean {
    return ghIssueHasLabel(issueNumber, labelName, this.repoInfo);
  }
  ```

### Step 5: Update `autoMergePhase.ts` — route through `repoContext`

- **Change the import from `../github`:** Remove `commentOnPR`, `approvePR`, `commentOnIssue`, `issueHasLabel`, and `type RepoInfo` from the `../github` import. Keep only `isGitHubAppConfigured` (GitHub-specific gate, out of scope):
  ```typescript
  import { isGitHubAppConfigured } from '../github';
  ```
- **Remove the `repoInfo` construction** (line 63: `const repoInfo: RepoInfo = { owner, repo };`). The `repoContext` already has the bound repo info.
- **Replace `issueHasLabel` call** (line 67):
  - Before: `issueHasLabel(issueNumber, 'hitl', repoInfo)`
  - After: `repoContext.issueTracker.issueHasLabel(issueNumber, 'hitl')`
- **Replace `commentOnIssue` call** (line 69):
  - Before: `commentOnIssue(issueNumber, ..., repoInfo)`
  - After: `repoContext.issueTracker.commentOnIssue(issueNumber, ...)`
- **Replace `approvePR` call** (line 90):
  - Before: `approvePR(prNumber, repoInfo)`
  - After: `repoContext.codeHost.approvePR(prNumber)`
- **Replace `commentOnPR` call** (line 123):
  - Before: `commentOnPR(prNumber, failureComment, repoInfo)`
  - After: `repoContext.codeHost.commentOnPullRequest(prNumber, failureComment)`
- **Make `repoContext` non-optional in the function body:** The guard on lines 55-61 already checks `repoContext?.repoId.owner` and returns early if missing. After the guard, `repoContext` is guaranteed non-null. Add a non-null assertion or type narrowing:
  ```typescript
  if (!repoContext) {
    log('executeAutoMergePhase: no repo context, skipping auto-merge', 'warn');
    // ...return
  }
  // repoContext is guaranteed non-null from here
  ```

### Step 6: Update `prReviewPhase.ts` — route `fetchPRDetails` through `repoContext`

- **Move `repoContext` creation earlier** in `initializePRReviewWorkflow()`, before the `fetchPRDetails` call (currently line 51). The `repoContext` is currently constructed at lines 109-121 (after worktree setup). Move the `repoContext` construction to immediately after `resolvedRepoInfo` is computed (after line 47), before `fetchPRDetails`:
  ```typescript
  const resolvedRepoInfo = repoInfo ?? getRepoInfo();
  activateGitHubAppAuth(resolvedRepoInfo.owner, resolvedRepoInfo.repo);

  // Create RepoContext early so fetchPRDetails can go through the provider
  let repoContext: RepoContext | undefined;
  try {
    const repoIdForContext = repoId ?? { owner: resolvedRepoInfo.owner, repo: resolvedRepoInfo.repo, platform: Platform.GitHub };
    repoContext = createRepoContext({
      repoId: repoIdForContext,
      cwd: process.cwd(), // temporary cwd; will be updated after worktree setup
    });
  } catch (error) {
    log(`Failed to create RepoContext (falling back to direct API calls): ${error}`, 'info');
  }
  ```
- **Replace `fetchPRDetails` with provider call** (line 51):
  - If `repoContext` is available: `repoContext.codeHost.fetchPRDetails(prNumber)` returns `PullRequestDetails`
  - Fallback: keep the direct `fetchPRDetails(prNumber, resolvedRepoInfo)` call for resilience
  - Map `PullRequestDetails` to `PRDetails` for downstream compatibility with agent functions:
    ```typescript
    let prDetails: PRDetails;
    if (repoContext) {
      const prd = repoContext.codeHost.fetchPRDetails(prNumber);
      prDetails = {
        number: prd.number,
        title: prd.title,
        body: prd.body,
        state: prd.state,
        headBranch: prd.sourceBranch,
        baseBranch: prd.targetBranch,
        url: prd.url,
        issueNumber: prd.linkedIssueNumber ?? null,
        reviewComments: [],
      };
    } else {
      prDetails = fetchPRDetails(prNumber, resolvedRepoInfo);
    }
    ```
- **Remove `fetchPRDetails` from the `../github` import.** Keep `getUnaddressedComments`, `type PRReviewWorkflowContext`, `getRepoInfo`, `type RepoInfo`, `activateGitHubAppAuth`.
- **Remove the second `repoContext` construction** (lines 109-121) since it was moved earlier. After the worktree is set up, update `repoContext.cwd` if needed — but since `RepoContext` is `Readonly`, create a new context with the worktree path:
  ```typescript
  // After worktree setup, recreate repoContext with the worktree cwd
  if (repoContext) {
    repoContext = createRepoContext({
      repoId: repoContext.repoId,
      cwd: worktreePath,
    });
  }
  ```
- Import `type PullRequestDetails` from `../providers/types` for the provider return type.

### Step 7: Run validation commands

- Run all validation commands listed below to confirm zero type errors and zero regressions.

## Validation Commands
Execute every command to validate the chore is complete with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Type check root tsconfig
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type check adws tsconfig
- `bun run build` — Build the application to verify no build errors

## Notes
- Follow `guidelines/coding_guidelines.md` strictly: no `any` types, leverage the type system, keep interfaces for object shapes.
- The `approvePR` function in `prApi.ts` temporarily unsets `GH_TOKEN` to use personal auth identity — this logic is encapsulated in `prApi.approvePR` and the provider just delegates to it. No need to reproduce this in the provider layer.
- `getUnaddressedComments` stays as a direct `../github` import in `prReviewPhase.ts`. It contains complex GitHub-specific filtering logic (uses `isResolved` field on review threads). Abstracting it would require extending the `ReviewComment` provider type with resolution tracking — that's a separate chore.
- `isGitHubAppConfigured` stays as a direct import in `autoMergePhase.ts` — it's a GitHub-specific configuration check, not a provider operation.
- The `PullRequestDetails` type intentionally omits `reviewComments` (unlike the GitHub-specific `PRDetails`). Review comments are fetched separately via `fetchReviewComments()` or `getUnaddressedComments()`. If a consumer needs review comments, they call the dedicated method.
- When renaming the `fetchPRDetails` import in `githubCodeHost.ts` to avoid shadowing with the new method name, ensure the existing `fetchPullRequest` method is updated to use the renamed import.
- In `prReviewPhase.ts`, the `PRDetails.reviewComments` field is set to `[]` when mapping from `PullRequestDetails` — this is safe because `prReviewPhase.ts` never accesses `prDetails.reviewComments` directly (it fetches comments separately via `getUnaddressedComments`).
