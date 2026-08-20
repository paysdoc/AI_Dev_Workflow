/**
 * GitContext package — standalone, importable public surface.
 *
 * Primary export: GitContext class and its public types. The public surface
 * includes the forge-neutral executor primitive (`GitContext.exec` plus the
 * `ExecWorkingDirectory`/`ExecOptions` types), the TokenProvider port
 * types (`TokenProvider`/`CredentialRequest`/`CredentialPurpose`) — the seam
 * a forge adapter built on this package implements instead of the core
 * holding a credential — and the `Logger` port (`Logger`/`LogLevel`,
 * defaulting to `consoleLogger`), so the package carries no dependency on
 * the host application's logger. The GitHub implementation of the
 * TokenProvider port (`createGitHubTokenProvider`), the gh command-string
 * builders, GitHub App authentication, token resolution, GitHub remote-URL
 * parsing, bot-identity derivation, clone-URL construction and
 * `gh auth token` all live in the GitHub forge adapter
 * (`adws/providers/github/`, #792/#793), not here.
 *
 * Bootstrap exceptions (issue #700, narrowed by #793): the functions below
 * are the ONLY legitimate pre-context git reads in the codebase — generic
 * git reads only, no forge vocabulary. They live inside this structurally-
 * exempt package (guard skips adws/gitContext/ by directory) rather than on
 * the ALLOWLIST. The GitHub forge adapter composes them rather than
 * shelling out itself.
 */

export { GitContext } from './gitContext';
export type {
  GitIdentity, GitContextOptions, ExecFn, GitContextDeps, FsDeps, ExecWorkingDirectory, ExecOptions,
  TokenProvider, CredentialPurpose, CredentialRequest, Logger, LogLevel,
} from './types';
export { consoleLogger } from './consoleLogger';
export { killProcessesInDirectory } from './processCleanup';
export type { WorktreeForIssueResult } from './worktreeQueryOps';
export type { WorktreeRegistration } from './worktreeProbeOps';
export type { LogSinceOptions } from './gitReadOps';

// Bootstrap — absorbed pre-context primitives (issue #700), generic git reads only (#793)
export { readOriginRemoteUrl, readEnvGitIdentity, readGitConfigIdentity } from './bootstrapIdentity';
export type { GitConfigIdentityDeps } from './bootstrapIdentity';
export {
  getTargetRepoWorkspacePath,
  isRepoCloned,
  cloneRepo,
  ensureRepoWorkspace,
} from './repoWorkspace';
export type { EnsureRepoWorkspaceDeps } from './repoWorkspace';
