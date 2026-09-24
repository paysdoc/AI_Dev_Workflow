export {
  validateSlug,
  generateBranchName,
  inferIssueTypeFromBranch,
  PROTECTED_BRANCHES,
} from './branchOperations';

export { deterministicBranchName, branchMatchesIssue } from './branchIdentity';

// Main repo path utility (used by agent subprocess env injection). Takes an
// injected GitContext — resolves the path through it rather than
// constructing one.
export { getMainRepoPath } from './worktreeOperations';

export { killProcessesInDirectory } from './worktreeCleanup';
