/**
 * Public types for the GitContext deep module.
 *
 * Contract: identity in, repo-scoped operations out. Base-path resolution
 * lives only in the GitContext constructor — no optional base path, no cwd
 * fallback. All identity and config are injected at construction so the
 * package carries no dependency on ADW-specific globals.
 */

/** Git author and committer identity for child-process env overlays. */
export interface GitIdentity {
  authorName: string;
  authorEmail: string;
  committerName: string;
  committerEmail: string;
}

/**
 * Construction options for GitContext.
 *
 * All fields are mandatory — any missing or empty field is a hard construction
 * error. There is no optional base-path parameter and no cwd fallback.
 *
 * frameworkRepoRoot and targetReposDir are injected by the caller (e.g. from
 * environment.ts's REPO_ROOT and TARGET_REPOS_DIR) so this package depends on
 * no ADW globals and can be imported by other projects.
 */
export interface GitContextOptions {
  /** GitHub owner (organisation or user). */
  owner: string;
  /** Repository name (without the owner prefix). */
  repo: string;
  /**
   * True when ADW is operating on its own (self-hosted) repository.
   * False for any external target repository. Must be a boolean — omitting
   * this field is a hard construction error (story 23).
   */
  selfHost: boolean;
  /** Personal access token or GitHub App installation token. */
  token: string;
  /** Author and committer identity for git operations. */
  gitIdentity: GitIdentity;
  /**
   * Absolute path to the ADW framework repository root.
   * Injected by the caller (environment.ts REPO_ROOT). Used as basePath for
   * self-host contexts.
   */
  frameworkRepoRoot: string;
  /**
   * Absolute path to the directory that houses cloned target repositories.
   * Injected by the caller (environment.ts TARGET_REPOS_DIR). Used as the
   * base of basePath for target contexts: join(targetReposDir, owner, repo).
   */
  targetReposDir: string;
}
