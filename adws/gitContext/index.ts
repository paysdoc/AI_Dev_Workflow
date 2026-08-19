/**
 * GitContext package — standalone, importable public surface.
 *
 * Primary export: GitContext class and its public types. The public surface
 * includes the forge-neutral executor primitive (`GitContext.exec` plus the
 * `ExecWorkingDirectory`/`ExecOptions` types) and the TokenProvider port
 * types (`TokenProvider`/`CredentialRequest`/`CredentialPurpose`) — the seam
 * a forge adapter built on this package implements instead of the core
 * holding a credential. The GitHub implementation of that port
 * (`createGitHubTokenProvider`), the gh command-string builders, GitHub App
 * authentication and token resolution all live in the GitHub forge adapter
 * (`adws/providers/github/`, #792), not here.
 *
 * Bootstrap exceptions (issue #700): the functions below are the ONLY legitimate
 * pre-context git/gh reads in the codebase. They live inside this structurally-
 * exempt package (guard skips adws/gitContext/ by directory) rather than on the
 * ALLOWLIST. ADW adapters (launchGitContext.ts, gitContextFactory.ts, etc.) import
 * them here and delegate, keeping zero raw git/gh strings outside this package.
 */

export { GitContext } from './gitContext';
export type {
  GitIdentity, GitContextOptions, ExecFn, GitContextDeps, FsDeps, ExecWorkingDirectory, ExecOptions,
  TokenProvider, CredentialPurpose, CredentialRequest,
} from './types';
export { killProcessesInDirectory } from './processCleanup';
export type { WorktreeForIssueResult } from './worktreeQueryOps';
export type { WorktreeRegistration } from './worktreeProbeOps';
export type { LogSinceOptions } from './gitReadOps';

// Bootstrap — absorbed pre-context primitives (issue #700)
export { readLocalRepoInfo, ghAuthToken, resolveBootstrapGitIdentity, parseGitHubRemoteUrl } from './bootstrapIdentity';
export type { RepoInfo as BootstrapRepoInfo, BootstrapIdentityDeps } from './bootstrapIdentity';
export {
  getTargetRepoWorkspacePath,
  isRepoCloned,
  convertToSshUrl,
  cloneRepo,
  ensureRepoWorkspace,
} from './repoWorkspace';
export type { EnsureRepoWorkspaceDeps } from './repoWorkspace';
