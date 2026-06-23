/**
 * GitContext package — standalone, importable public surface.
 *
 * Exports only the GitContext class and its public types. No context-free
 * git/gh free functions. See GitContext for the construction contract.
 */

export { GitContext } from './gitContext';
export type { GitIdentity, GitContextOptions, ExecFn, GitContextDeps, FsDeps } from './types';
export { killProcessesInDirectory } from './processCleanup';
export type { WorktreeForIssueResult } from './worktreeQueryOps';
