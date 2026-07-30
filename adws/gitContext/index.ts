/**
 * GitContext package — standalone, importable public surface.
 *
 * Primary export: GitContext class and its public types.
 *
 * Bootstrap exceptions (issue #700): the functions below are the ONLY legitimate
 * pre-context git/gh reads in the codebase. They live inside this structurally-
 * exempt package (guard skips adws/gitContext/ by directory) rather than on the
 * ALLOWLIST. ADW adapters (launchGitContext.ts, gitContextFactory.ts, etc.) import
 * them here and delegate, keeping zero raw git/gh strings outside this package.
 */

export { GitContext } from './gitContext';
export type { GitIdentity, GitContextOptions, ExecFn, GitContextDeps, FsDeps } from './types';
export { killProcessesInDirectory } from './processCleanup';
export type { WorktreeForIssueResult } from './worktreeQueryOps';
export type { WorktreeRegistration } from './worktreeProbeOps';
export type { LogSinceOptions } from './gitReadOps';

// Bootstrap — absorbed pre-context primitives (issue #700)
export { isGitHubAppConfigured, getInstallationToken } from './appAuth';
export { readLocalRepoInfo, ghAuthToken, resolveBootstrapGitIdentity, parseGitHubRemoteUrl } from './bootstrapIdentity';
export type { RepoInfo as BootstrapRepoInfo, BootstrapIdentityDeps } from './bootstrapIdentity';
export { resolveContextToken } from './tokenResolver';
export type { ResolveContextTokenInput } from './tokenResolver';
export {
  getTargetRepoWorkspacePath,
  isRepoCloned,
  convertToSshUrl,
  cloneRepo,
  ensureRepoWorkspace,
} from './repoWorkspace';
export type { EnsureRepoWorkspaceDeps } from './repoWorkspace';
