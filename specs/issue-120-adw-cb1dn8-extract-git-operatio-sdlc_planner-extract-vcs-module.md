# Chore: Extract git operations into a VCS-agnostic module

## Metadata
issueNumber: `120`
adwId: `cb1dn8-extract-git-operatio`
issueJson: `{"number":120,"title":"Extract git operations into a VCS-agnostic module","body":"## Summary\nMove VCS-agnostic git operations out of `adws/github/` into a dedicated `adws/vcs/` module. The `github/` module should only contain GitHub-specific API code.\n\n## Dependencies\n- #119 — Global registry must be removed first so that git operations have clean, explicit cwd parameters\n\n## User Story\nAs a developer reading the codebase, I want git operations (branch, commit, worktree) to live separately from GitHub API code so the module boundaries match the actual concerns.\n\n## Acceptance Criteria\n\n### Create `adws/vcs/` module\nMove from `github/` to `vcs/`:\n- `gitBranchOperations.ts` → `adws/vcs/branchOperations.ts` (remove `getDefaultBranch` — that's in CodeHost)\n- `gitCommitOperations.ts` → `adws/vcs/commitOperations.ts`\n- `worktreeOperations.ts` → `adws/vcs/worktreeOperations.ts`\n- `worktreeCreation.ts` → `adws/vcs/worktreeCreation.ts`\n- `worktreeCleanup.ts` → `adws/vcs/worktreeCleanup.ts`\n- `worktreeQuery.ts` → `adws/vcs/worktreeQuery.ts`\n\n### Create `adws/vcs/index.ts` barrel export\n\n### Update `adws/github/` \n- Remove relocated files\n- Update `adws/github/index.ts` — re-export from `vcs/` for backward compatibility during transition, then remove re-exports\n- `github/` now only contains: `githubApi.ts`, `issueApi.ts`, `prApi.ts`, `pullRequestCreator.ts`, `prCommentDetector.ts`, `projectBoardApi.ts`, `workflowComments*.ts`\n\n### Move shared comment utilities\n- `workflowCommentsBase.ts` contains platform-agnostic comment parsing (stage detection, ADW signature matching, recovery state detection) — move parsing utilities to `adws/core/` or `adws/vcs/`\n- Keep GitHub-specific comment posting in `github/`\n\n### Update all imports across the codebase\n\n### Move tests\n- Move corresponding test files from `github/__tests__/` to `vcs/__tests__/`\n\n### Tests\n- Run full test suite after migration\n- Verify no circular dependencies introduced\n\n## Notes\n- All functions in `vcs/` take an explicit `cwd` parameter — no global state, no provider interfaces. These are direct git command wrappers.\n- This is a structural change with no behavior change. Every function keeps its exact same implementation.\n- After this, the module layout clearly communicates: `vcs/` = git commands, `github/` = GitHub API, `providers/` = abstraction layer.","state":"OPEN","author":"paysdoc","labels":["enhancement"],"createdAt":"2026-03-09T15:19:27Z","comments":[],"actionableComment":null}`

## Chore Description

Move VCS-agnostic git operations out of `adws/github/` into a dedicated `adws/vcs/` module so that module boundaries match actual concerns: `vcs/` = git command wrappers, `github/` = GitHub API code, `providers/` = abstraction layer. This is a purely structural refactor with zero behavior change.

Additionally, extract platform-agnostic comment parsing utilities from `adws/github/workflowCommentsBase.ts` into `adws/core/workflowCommentParsing.ts`, keeping only the GitHub-specific `isAdwRunningForIssue` function in `github/`.

## Relevant Files

### Source files being moved (github/ → vcs/)
- `adws/github/gitBranchOperations.ts` — Branch management (create, checkout, delete, infer type). Becomes `adws/vcs/branchOperations.ts`.
- `adws/github/gitCommitOperations.ts` — Commit and push operations, cost file handling. Becomes `adws/vcs/commitOperations.ts`.
- `adws/github/worktreeOperations.ts` — Core worktree path/status functions plus re-exports from query/creation/cleanup. Stays named `adws/vcs/worktreeOperations.ts`.
- `adws/github/worktreeCreation.ts` — Worktree creation and setup. Stays named `adws/vcs/worktreeCreation.ts`.
- `adws/github/worktreeCleanup.ts` — Worktree removal and process cleanup. Stays named `adws/vcs/worktreeCleanup.ts`.
- `adws/github/worktreeQuery.ts` — Worktree listing and issue-based search. Stays named `adws/vcs/worktreeQuery.ts`.
- `adws/github/gitOperations.ts` — Barrel re-export for branch + commit operations. Will be removed (replaced by `adws/vcs/index.ts`).

### Comment parsing extraction
- `adws/github/workflowCommentsBase.ts` — Contains pure parsing utilities (STAGE_ORDER, ADW_SIGNATURE, isAdwComment, detectRecoveryState, etc.) mixed with GitHub-dependent `isAdwRunningForIssue`. Pure parsing moves to core/.

### Barrel / index files to update
- `adws/github/index.ts` — Main github barrel. Must remove git operation re-exports and keep only GitHub API exports.
- `adws/index.ts` — Top-level ADW module barrel. Must re-export git operations from `./vcs` instead of `./github`.

### Consumer files that import git operations (need import path updates)
- `adws/adwBuild.tsx` — imports `getCurrentBranch`, `inferIssueTypeFromBranch` from `./github`
- `adws/adwPatch.tsx` — imports `getCurrentBranch`, `inferIssueTypeFromBranch` from `./github`
- `adws/adwInit.tsx` — imports `commitChanges` from `./github`
- `adws/phases/prReviewCompletion.ts` — imports `pushBranch`, `inferIssueTypeFromBranch` from `../github`
- `adws/phases/prReviewPhase.ts` — imports `ensureWorktree` from `../github`
- `adws/phases/documentPhase.ts` — imports `pushBranch` from `../github`
- `adws/agents/prAgent.ts` — imports `getDefaultBranch` from `../github/gitOperations`
- `adws/agents/reviewRetry.ts` — imports `pushBranch` from `../github`
- `adws/triggers/trigger_webhook.ts` — imports `commitAndPushCostFiles`, `pullLatestCostBranch` from `../github/gitOperations` and `removeWorktreesForIssue` from `../github/worktreeOperations`
- `adws/triggers/webhookHandlers.ts` — imports `deleteRemoteBranch`, `commitAndPushCostFiles`, `pullLatestCostBranch` from `../github/gitOperations` and `removeWorktree` from `../github/worktreeOperations`
- `adws/providers/github/githubCodeHost.ts` — imports `getDefaultBranch` from `../../github/gitBranchOperations`
- `adws/core/orchestratorLib.ts` — imports `STAGE_ORDER` from `../github/workflowCommentsBase`

### Workflow comment files to update (import parsing from core/)
- `adws/github/workflowComments.ts` — re-exports from workflowCommentsBase; must split re-exports between core/ and github/
- `adws/github/workflowCommentsIssue.ts` — imports `ADW_SIGNATURE`, `truncateText`, `formatRunningTokenFooter` from `./workflowCommentsBase`
- `adws/github/workflowCommentsPR.ts` — imports `ADW_SIGNATURE`, `truncateText`, `formatRunningTokenFooter` from `./workflowCommentsBase`

### Test files to move (github/__tests__/ → vcs/__tests__/)
- `adws/github/__tests__/gitOperations.test.ts` — Tests getDefaultBranch, checkoutDefaultBranch, deleteLocalBranch, deleteRemoteBranch
- `adws/github/__tests__/worktreeOperations.test.ts` — Comprehensive worktree tests (~1800 lines)
- `adws/github/__tests__/branchNameGeneration.test.ts` — Tests generateBranchName
- `adws/github/__tests__/commitCostFiles.test.ts` — Tests commitAndPushCostFiles

### Test files with import updates only (stay in their current location)
- `adws/github/__tests__/pullRequestCreator.test.ts` — Mocks `../gitOperations` (pushBranch); update mock path
- `adws/providers/github/__tests__/githubCodeHost.test.ts` — imports getDefaultBranch from `../../../github/gitBranchOperations`
- `adws/phases/__tests__/documentPhase.test.ts` — imports `pushBranch` from `../../github`
- `adws/phases/__tests__/buildPhase.test.ts` — imports type `WorkflowContext` from `../../github`
- `adws/phases/__tests__/prPhase.test.ts` — imports type `WorkflowContext` from `../../github`
- `adws/phases/__tests__/prReviewPhase.test.ts` — imports type `PRReviewWorkflowContext` from `../../github`
- `adws/phases/__tests__/testPhase.test.ts` — imports type `WorkflowContext` from `../../github`
- `adws/phases/__tests__/workflowCompletion.test.ts` — imports type `WorkflowContext` from `../../github`
- `adws/agents/__tests__/reviewRetry.test.ts` — imports `pushBranch` from `../../github`
- `adws/__tests__/prReviewCostTracking.test.ts` — imports `getRepoInfo` from `../github`
- `adws/__tests__/tokenLimitRecovery.test.ts` — imports `postWorkflowComment` from `../github`
- `adws/core/__tests__/orchestratorLib.test.ts` — imports `STAGE_ORDER` from `../../github/workflowCommentsBase`
- `adws/github/__tests__/commentFiltering.test.ts` — imports parsing functions from `../workflowCommentsBase`
- `adws/github/__tests__/workflowCommentsRunningTokens.test.ts` — imports from `../workflowCommentsBase`
- `adws/github/__tests__/triggerCommentHandling.test.ts` — imports from `../workflowCommentsBase`

### New Files
- `adws/vcs/index.ts` — Barrel export for all VCS operations
- `adws/vcs/branchOperations.ts` — Moved from github/gitBranchOperations.ts
- `adws/vcs/commitOperations.ts` — Moved from github/gitCommitOperations.ts
- `adws/vcs/worktreeOperations.ts` — Moved from github/worktreeOperations.ts
- `adws/vcs/worktreeCreation.ts` — Moved from github/worktreeCreation.ts
- `adws/vcs/worktreeCleanup.ts` — Moved from github/worktreeCleanup.ts
- `adws/vcs/worktreeQuery.ts` — Moved from github/worktreeQuery.ts
- `adws/vcs/__tests__/` — Directory for moved test files
- `adws/core/workflowCommentParsing.ts` — Platform-agnostic comment parsing extracted from workflowCommentsBase

### Conditional documentation
- `app_docs/feature-trigger-should-commi-f8jwcf-commit-push-cost-csv.md` — Read before modifying commitAndPushCostFiles or gitOperations.ts commit/push functions. References paths in `adws/github/gitOperations.ts` that will change.
- `guidelines/coding_guidelines.md` — Coding standards to follow during refactor.

## Step by Step Tasks

### Step 1: Create `adws/vcs/` directory and move source files

- Create `adws/vcs/` directory
- Copy `adws/github/gitBranchOperations.ts` → `adws/vcs/branchOperations.ts`
- Copy `adws/github/gitCommitOperations.ts` → `adws/vcs/commitOperations.ts`
- Copy `adws/github/worktreeOperations.ts` → `adws/vcs/worktreeOperations.ts`
- Copy `adws/github/worktreeCreation.ts` → `adws/vcs/worktreeCreation.ts`
- Copy `adws/github/worktreeCleanup.ts` → `adws/vcs/worktreeCleanup.ts`
- Copy `adws/github/worktreeQuery.ts` → `adws/vcs/worktreeQuery.ts`

### Step 2: Update internal imports within moved vcs/ files

All files in `adws/vcs/` that reference sibling modules need path updates for the renamed files:

- **`adws/vcs/commitOperations.ts`**: Change `import { getCurrentBranch, PROTECTED_BRANCHES } from './gitBranchOperations'` → `from './branchOperations'`
- **`adws/vcs/worktreeOperations.ts`**: Change `import { getDefaultBranch } from './gitOperations'` → `import { getDefaultBranch } from './branchOperations'`
- **`adws/vcs/worktreeOperations.ts`**: Verify re-exports from `'./worktreeQuery'`, `'./worktreeCreation'`, `'./worktreeCleanup'` — these paths stay the same since the filenames didn't change
- **`adws/vcs/worktreeCreation.ts`**: Verify imports from `'./worktreeOperations'` — path stays the same
- **`adws/vcs/worktreeCleanup.ts`**: Verify imports from `'./worktreeOperations'` and `'./worktreeQuery'` — paths stay the same
- All `../core` imports stay unchanged (relative path from `vcs/` to `core/` is the same as from `github/` to `core/`)

### Step 3: Create `adws/vcs/index.ts` barrel export

Create the barrel file that exports all VCS operations. Do NOT export `getDefaultBranch` from this barrel (the issue specifies it belongs in CodeHost). Internal vcs/ files can still import it directly from `./branchOperations`.

Export list for `adws/vcs/index.ts`:
```typescript
// Branch operations
export {
  getCurrentBranch,
  generateBranchName,
  generateFeatureBranchName,
  createFeatureBranch,
  checkoutBranch,
  inferIssueTypeFromBranch,
  checkoutDefaultBranch,
  mergeLatestFromDefaultBranch,
  deleteLocalBranch,
  deleteRemoteBranch,
  PROTECTED_BRANCHES,
} from './branchOperations';

// Commit operations
export {
  commitChanges,
  pushBranch,
  pullLatestCostBranch,
  commitAndPushCostFiles,
  type CommitCostFilesOptions,
} from './commitOperations';

// Worktree operations
export {
  getWorktreePath,
  worktreeExists,
  getMainRepoPath,
  isBranchCheckedOutElsewhere,
  freeBranchFromMainRepo,
  getWorktreesDir,
  copyEnvToWorktree,
  type BranchCheckoutStatus,
} from './worktreeOperations';

// Worktree query
export {
  listWorktrees,
  findWorktreeForIssue,
  type WorktreeForIssueResult,
} from './worktreeQuery';

// Worktree creation
export {
  createWorktree,
  createWorktreeForNewBranch,
  ensureWorktree,
  getWorktreeForBranch,
} from './worktreeCreation';

// Worktree cleanup
export {
  killProcessesInDirectory,
  removeWorktree,
  removeWorktreesForIssue,
} from './worktreeCleanup';
```

### Step 4: Extract comment parsing utilities to `adws/core/workflowCommentParsing.ts`

Create `adws/core/workflowCommentParsing.ts` with all pure (platform-agnostic) parsing functions extracted from `adws/github/workflowCommentsBase.ts`:

**Functions/constants to move:**
- `STAGE_ORDER` (and the private `STAGE_HEADER_MAP`)
- `ADW_SIGNATURE`, `ADW_SIGNATURE_PATTERN`
- `ADW_COMMENT_PATTERN` (private constant)
- `formatModelName()`, `formatRunningTokenFooter()`
- `isAdwComment()`
- `ACTIONABLE_COMMENT_PATTERN`, `isActionableComment()`
- `CLEAR_COMMENT_PATTERN`, `isClearComment()`
- `extractActionableContent()`
- `truncateText()`
- `parseWorkflowStageFromComment()`
- `extractAdwIdFromComment()`
- `extractBranchNameFromComment()`
- `extractPrUrlFromComment()`
- `extractPlanPathFromComment()`
- `TERMINAL_STAGES` (private constant)
- `detectRecoveryState()`
- `formatResumingComment()` — check if this exists in workflowCommentsBase or workflowComments; if it's pure parsing, move it

**Import adjustments for the new file:**
- It needs `WorkflowStage`, `RecoveryState`, `GitHubComment` from `'./index'` (core barrel) — these are types, no circular dependency concern

**What stays in `adws/github/workflowCommentsBase.ts`:**
- `isAdwRunningForIssue()` — depends on `fetchGitHubIssue` (GitHub API call) and `AgentStateManager`
- Import the parsing utilities it needs from `'../core/workflowCommentParsing'`

### Step 5: Update `adws/core/index.ts` to export comment parsing

Add re-exports from the new `workflowCommentParsing.ts` to `adws/core/index.ts` so consumers can import parsing utilities through the core barrel.

### Step 6: Update `adws/github/workflowCommentsBase.ts`

- Remove all parsing functions/constants that were moved to core/
- Add import of needed parsing utilities from `'../core/workflowCommentParsing'` (specifically `parseWorkflowStageFromComment`, `extractAdwIdFromComment` which `isAdwRunningForIssue` uses)
- Keep `isAdwRunningForIssue()` with its `fetchGitHubIssue` and `AgentStateManager` imports

### Step 7: Update `adws/github/workflowComments.ts` re-exports

This file re-exports everything from `workflowCommentsBase`. After the split:
- Re-export parsing utilities from `'../core/workflowCommentParsing'` (or from `'../core'` barrel)
- Re-export `isAdwRunningForIssue` from `'./workflowCommentsBase'`
- Keep existing re-exports from `workflowCommentsIssue` and `workflowCommentsPR`

### Step 8: Update `adws/github/workflowCommentsIssue.ts` and `workflowCommentsPR.ts`

These files import `ADW_SIGNATURE`, `truncateText`, `formatRunningTokenFooter` from `'./workflowCommentsBase'`.
- Change to import from `'../core/workflowCommentParsing'` (or `'../core'` barrel)

### Step 9: Update `adws/github/index.ts` — remove git operation exports

Remove all git operation and worktree re-exports from the github barrel. After this change, `adws/github/index.ts` should only export:
- GitHub API (`githubApi.ts`): `getRepoInfo`, `getRepoInfoFromUrl`, `getRepoInfoFromPayload`, `fetchGitHubIssue`, `fetchPRDetails`, `fetchPRReviews`, `fetchPRReviewComments`, `commentOnPR`, `fetchPRList`, `commentOnIssue`, `fetchIssueCommentsRest`, `deleteIssueComment`, `getIssueTitleSync`, `type RepoInfo`
- Pull request creator: `createPullRequest`
- PR comment detector: `getLastAdwCommitTimestamp`, `getUnaddressedComments`, `hasUnaddressedComments`
- Issue API: anything from `issueApi.ts` if exported
- Project board: `moveIssueToStatus`
- Workflow comments: all exports from `workflowComments.ts` (which now re-exports parsing from core/ and GitHub-specific from local)

### Step 10: Remove original files from `adws/github/`

Delete these files from `adws/github/`:
- `gitBranchOperations.ts`
- `gitCommitOperations.ts`
- `gitOperations.ts` (barrel)
- `worktreeOperations.ts`
- `worktreeCreation.ts`
- `worktreeCleanup.ts`
- `worktreeQuery.ts`

### Step 11: Update all consumer imports — direct submodule imports

Update files that import from specific github submodule paths:

- **`adws/triggers/trigger_webhook.ts`**: Change `from '../github/gitOperations'` → `from '../vcs'` (for `commitAndPushCostFiles`, `pullLatestCostBranch`). Change `from '../github/worktreeOperations'` → `from '../vcs'` (for `removeWorktreesForIssue`)
- **`adws/triggers/webhookHandlers.ts`**: Change `from '../github/gitOperations'` → `from '../vcs'` (for `deleteRemoteBranch`, `commitAndPushCostFiles`, `pullLatestCostBranch`). Change `from '../github/worktreeOperations'` → `from '../vcs'` (for `removeWorktree`)
- **`adws/agents/prAgent.ts`**: Change `from '../github/gitOperations'` → `from '../vcs/branchOperations'` (for `getDefaultBranch`) — note: `getDefaultBranch` is not in the vcs/ barrel, so import from the specific file
- **`adws/providers/github/githubCodeHost.ts`**: Change `from '../../github/gitBranchOperations'` → `from '../../vcs/branchOperations'` (for `getDefaultBranch`)

### Step 12: Update all consumer imports — barrel imports

Update files that import git operations from the `../github` barrel to import from `../vcs` instead. Each file needs its import split: GitHub API imports stay on `../github`, git operation imports move to `../vcs`.

- **`adws/adwBuild.tsx`**: Split import — `getCurrentBranch`, `inferIssueTypeFromBranch` from `'./vcs'`; keep `fetchGitHubIssue`, `getRepoInfo`, `postWorkflowComment`, `WorkflowContext`, `detectRecoveryState`, `type RepoInfo` from `'./github'`
- **`adws/adwPatch.tsx`**: Split import — `getCurrentBranch`, `inferIssueTypeFromBranch` from `'./vcs'`; keep `fetchGitHubIssue` from `'./github'`
- **`adws/adwInit.tsx`**: Change `commitChanges` import from `'./github'` → `'./vcs'`
- **`adws/phases/prReviewCompletion.ts`**: Split — `pushBranch`, `inferIssueTypeFromBranch` from `'../vcs'`; keep other imports from `'../github'`
- **`adws/phases/prReviewPhase.ts`**: Split — `ensureWorktree` from `'../vcs'`; keep `fetchPRDetails`, `getUnaddressedComments`, `type PRReviewWorkflowContext`, `getRepoInfo`, `type RepoInfo` from `'../github'`
- **`adws/phases/documentPhase.ts`**: Change `pushBranch` import from `'../github'` → `'../vcs'`
- **`adws/agents/reviewRetry.ts`**: Change `pushBranch` import from `'../github'` → `'../vcs'`
- **`adws/core/orchestratorLib.ts`**: Change `STAGE_ORDER` import from `'../github/workflowCommentsBase'` → `'./workflowCommentParsing'` (now in core/)

### Step 13: Update `adws/index.ts` top-level barrel

Split the current `from './github'` export block:
- Git operation exports (`getCurrentBranch`, `generateFeatureBranchName`, `createFeatureBranch`, `checkoutBranch`, `commitChanges`, `pushBranch`, etc.) → `from './vcs'`
- Worktree exports → `from './vcs'`
- Comment parsing exports (`STAGE_ORDER`, `parseWorkflowStageFromComment`, `detectRecoveryState`, etc.) → `from './core'` (since they moved to core)
- GitHub API exports, PR exports, workflow comment posting exports → stay `from './github'`

### Step 14: Move test files to `adws/vcs/__tests__/`

- Create `adws/vcs/__tests__/` directory
- Move `adws/github/__tests__/gitOperations.test.ts` → `adws/vcs/__tests__/gitOperations.test.ts`
- Move `adws/github/__tests__/worktreeOperations.test.ts` → `adws/vcs/__tests__/worktreeOperations.test.ts`
- Move `adws/github/__tests__/branchNameGeneration.test.ts` → `adws/vcs/__tests__/branchNameGeneration.test.ts`
- Move `adws/github/__tests__/commitCostFiles.test.ts` → `adws/vcs/__tests__/commitCostFiles.test.ts`

### Step 15: Update imports within moved test files

- **`gitOperations.test.ts`**: Change `from '../gitOperations'` → `from '../branchOperations'` (tests getDefaultBranch, checkoutDefaultBranch, deleteLocalBranch, deleteRemoteBranch). Update mock path `vi.mock('../../core/utils'` → `vi.mock('../../core/utils'` (stays same depth). Update all `../` references that pointed to `github/` parent.
- **`worktreeOperations.test.ts`**: Change `from '../gitOperations'` → `from '../branchOperations'`. Update all mock paths — `vi.mock('../gitOperations')` → `vi.mock('../branchOperations')`. Other mocks (`../../core/utils`, `../../core/config`, `../../core/targetRepoManager`) stay same since vcs/ is at the same level as github/.
- **`branchNameGeneration.test.ts`**: Change `from '../gitOperations'` → `from '../branchOperations'` (for `generateBranchName`). Update mocks accordingly.
- **`commitCostFiles.test.ts`**: Change `from '../gitOperations'` → `from '../commitOperations'` (for `commitAndPushCostFiles`). Update mocks for gitBranchOperations → branchOperations.

### Step 16: Update import paths in test files that stay in place

Update remaining test files that reference the moved modules:

- **`adws/github/__tests__/pullRequestCreator.test.ts`**: Update `vi.mock('../gitOperations')` → `vi.mock('../../vcs/commitOperations')` (for `pushBranch`). Update import `from '../gitOperations'` → `from '../../vcs/commitOperations'`.
- **`adws/providers/github/__tests__/githubCodeHost.test.ts`**: Update import `from '../../../github/gitBranchOperations'` → `from '../../../vcs/branchOperations'`. Update `vi.mock()` path accordingly.
- **`adws/phases/__tests__/documentPhase.test.ts`**: Update `pushBranch` import/mock from `../../github` → `../../vcs`.
- **`adws/agents/__tests__/reviewRetry.test.ts`**: Update `pushBranch` import/mock from `../../github` → `../../vcs`.
- **`adws/core/__tests__/orchestratorLib.test.ts`**: Update `STAGE_ORDER` import from `../../github/workflowCommentsBase` → `../workflowCommentParsing` (now in core/).
- **`adws/github/__tests__/commentFiltering.test.ts`**: Update imports from `../workflowCommentsBase` — parsing functions now come from `../../core/workflowCommentParsing`. `isAdwRunningForIssue` still comes from `../workflowCommentsBase`.
- **`adws/github/__tests__/workflowCommentsRunningTokens.test.ts`**: Update `from '../workflowCommentsBase'` → `from '../../core/workflowCommentParsing'` (for `formatRunningTokenFooter`, `formatModelName`).
- **`adws/github/__tests__/triggerCommentHandling.test.ts`**: Update `from '../workflowCommentsBase'` → split between `../../core/workflowCommentParsing` (for `isActionableComment`, `isClearComment`, `ADW_SIGNATURE`) and `../workflowCommentsBase` if needed.

### Step 17: Run validation commands and fix any issues

- Run `bunx tsc --noEmit` and `bunx tsc --noEmit -p adws/tsconfig.json` to catch any broken imports or type errors
- Run `bun run lint` to check for import ordering and code quality
- Run `bun run test` to verify all tests pass
- Verify no circular dependencies by checking that vcs/ never imports from github/ and core/ never imports from github/ or vcs/

## Validation Commands

```bash
# Type check (catches broken imports and type errors)
bunx tsc --noEmit

# ADW-specific type check
bunx tsc --noEmit -p adws/tsconfig.json

# Lint (catches import ordering, unused imports, code quality)
bun run lint

# Full test suite (verifies zero regressions)
bun run test

# Verify no circular dependencies: vcs/ must never import from github/
# (manual grep check)
grep -r "from.*['\"].*github" adws/vcs/ || echo "No github imports in vcs/ — OK"

# Verify core/ does not import from github/ or vcs/
grep -r "from.*['\"].*github\|from.*['\"].*vcs" adws/core/workflowCommentParsing.ts || echo "No github/vcs imports in workflowCommentParsing — OK"
```

## Notes

- IMPORTANT: Follow `guidelines/coding_guidelines.md` strictly — clarity over cleverness, single responsibility, explicit types, no `any`.
- This is a structural change with **zero behavior change**. Every function keeps its exact same implementation. Do not refactor, optimize, or change function signatures.
- `getDefaultBranch` stays in `adws/vcs/branchOperations.ts` (the implementation) but is NOT exported from `adws/vcs/index.ts` barrel. Direct importers (`githubCodeHost.ts`, `prAgent.ts`, `worktreeOperations.ts`) import from the specific file path `./branchOperations` or `../../vcs/branchOperations`.
- The `worktreeOperations.ts` re-exports from worktreeQuery/worktreeCreation/worktreeCleanup are kept as-is to maintain backward compat within the module. The new `vcs/index.ts` barrel also exports these directly.
- `adws/github/__tests__/ensureGitignoreEntry.test.ts` tests a function from `adws/phases/workflowLifecycle.ts` (not from the git operations modules). It stays in `github/__tests__/` — it's already misplaced but is out of scope for this chore.
- Read `app_docs/feature-trigger-should-commi-f8jwcf-commit-push-cost-csv.md` before modifying `commitAndPushCostFiles` paths. That doc references `adws/github/gitOperations.ts` which will change to `adws/vcs/commitOperations.ts`.
- When updating `vi.mock()` paths in test files, ensure the mock path matches the actual module path used by the source file under test (not the test file's relative path).
