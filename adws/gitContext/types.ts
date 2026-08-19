/**
 * Public types for the GitContext deep module.
 *
 * Contract: identity in, repo-scoped operations out. Base-path resolution
 * lives only in the GitContext constructor — no optional base path, no cwd
 * fallback. All identity and config are injected at construction so the
 * package carries no dependency on ADW-specific globals.
 */

/**
 * Injectable command runner seam — exists for hermetic testing and
 * standalone-package reuse. The default is a thin execSync wrapper;
 * tests inject a spy that records invocations without spawning real processes.
 *
 * The optional `input` field passes data to the child process's stdin.
 */
export type ExecFn = (command: string, options: { cwd: string; env: NodeJS.ProcessEnv; input?: string }) => string;

/**
 * The working-directory CLASS a command belongs to — the caller's declaration,
 * never the executor's inference. There is no `process.cwd()` fallback and no
 * fourth option.
 *
 *  - `workspace`    — the target workspace this context is bound to. Omitting
 *                      `path` means the context base path; supplying `path`
 *                      narrows to an explicit worktree beneath it.
 *  - `frameworkRoot` — the injected framework repository root, for commands
 *                      that carry their own repository identity and need no
 *                      checkout (#775's contract). Deliberately carries no `path`
 *                      — "framework root with an explicit worktree path" is
 *                      unrepresentable rather than merely undocumented.
 */
export type ExecWorkingDirectory =
  | { readonly kind: 'workspace'; readonly path?: string }
  | { readonly kind: 'frameworkRoot' };

/**
 * Options for {@link GitContext.exec}, the package's public forge-neutral
 * executor. Deliberately carries no forge semantics — no credential
 * selection, no PAT-versus-installation-token discrimination, no `--repo`
 * awareness. `command` stays a separate, first positional parameter on
 * `exec` (not folded into this object) so the `git-gh-shellout` CI guard
 * keeps inspecting it.
 */
export interface ExecOptions {
  /** The working-directory class this command runs in — never a bare path. */
  readonly cwd: ExecWorkingDirectory;
  /**
   * Per-command credential/identity overlay, merged over the inherited
   * process environment inside the executor. Never a whole replacement
   * environment, and never a `process.env` mutation.
   */
  readonly env: NodeJS.ProcessEnv;
  /** Optional data piped to the child process's stdin. */
  readonly input?: string;
}

/**
 * Injectable filesystem seam for worktree management ops.
 * All fields optional; defaults are the real fs functions.
 */
export interface FsDeps {
  existsSync: (p: string) => boolean;
  mkdirSync: (p: string, opts?: { recursive?: boolean }) => void;
  copyFileSync: (src: string, dest: string) => void;
  rmSync: (p: string, opts?: { force?: boolean; recursive?: boolean }) => void;
}

/**
 * Optional dependency bag for GitContext. Follows the ADW Deps idiom
 * (JanitorDeps, MergeDeps, ReconcileDeps). All fields optional so existing
 * call sites `new GitContext(options)` continue to work unchanged.
 */
export interface GitContextDeps {
  exec?: ExecFn;
  /** Injectable fs for worktree management ops — defaults to real 'fs' functions. */
  fsDeps?: FsDeps;
}

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
  /**
   * Optional Personal Access Token for operations that require a different
   * identity than the primary app token (e.g., PR approval, Projects V2).
   * When provided and `usePat: true` is passed to `#run`, this token is used
   * instead of the context's primary token. Never mutates process.env.
   */
  pat?: string;
}
