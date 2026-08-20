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
 * The core's forge-neutral declaration of *why* a command needs a credential —
 * never a declaration of *which kind* of credential it needs. `'alternateIdentity'`
 * means "the primary automation identity cannot perform this operation" — true of
 * PR approval (GitHub forbids bot self-approval) and Projects V2 writes (app tokens
 * lack access on user-owned repos), and expressible on any forge. `'default'` is
 * everything else. The core never learns that the answer to `'alternateIdentity'`
 * is a PAT — only the provider knows that.
 */
export type CredentialPurpose = 'default' | 'alternateIdentity';

/** A single command's credential request, bound to the repository it targets. */
export interface CredentialRequest {
  readonly owner: string;
  readonly repo: string;
  readonly purpose: CredentialPurpose;
}

/**
 * The TokenProvider port — the seam a forge adapter implements to hand the core
 * credentials without the core ever holding one.
 *
 * `credentialEnv` is called on **every** command; the core never memoises its
 * result. A GitHub App installation token expires roughly an hour after minting,
 * and this is what lets the credential source's own expiry-aware refresh actually
 * fire for a long-running orchestrator instead of replaying a stale snapshot.
 *
 * The return value is a per-command environment **overlay** — the same shape
 * `ExecOptions.env` accepts — never a whole environment and never a
 * `process.env` mutation. Returning an overlay rather than a bare token string
 * keeps the credential variable's *name* (e.g. `GH_TOKEN`) on the provider's
 * side of the port, so the core carries no forge vocabulary.
 */
export interface TokenProvider {
  credentialEnv(request: CredentialRequest): NodeJS.ProcessEnv;
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
 * The four levels the worktree operations report at.
 */
export type LogLevel = 'info' | 'error' | 'success' | 'warn';

/**
 * The logger port (PRD story 17) — exists so the package carries no
 * dependency on the host application's utilities. Structurally compatible
 * with the host application's `log(message, level?)` (`adws/core/logger.ts`),
 * so the ADW logger is injectable with no adapter.
 */
export type Logger = (message: string, level?: LogLevel) => void;

/**
 * Optional dependency bag for GitContext. Follows the ADW Deps idiom
 * (JanitorDeps, MergeDeps, ReconcileDeps). All fields optional so existing
 * call sites `new GitContext(options)` continue to work unchanged.
 */
export interface GitContextDeps {
  exec?: ExecFn;
  /** Injectable fs for worktree management ops — defaults to real 'fs' functions. */
  fsDeps?: FsDeps;
  /** Injectable logger port — defaults to `consoleLogger`. */
  logger?: Logger;
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
 * error — except the credential fields: exactly one of `tokenProvider` (the
 * supported path) or `token` (the transitional literal-credential path) must
 * be supplied. There is no optional base-path parameter and no cwd fallback.
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
  /**
   * TRANSITIONAL literal-credential path. A resolved token, captured once and
   * replayed for the life of the context — exactly the construction-time
   * caching the TokenProvider port exists to remove. Kept only so the many
   * existing construction sites that assert against a literal token continue
   * to work unchanged; production callers supply `tokenProvider` instead and
   * never this field. Exactly one of `token` or `tokenProvider` is required.
   * Removed, along with `pat`, when the forge adapter lands (#792/#796).
   */
  token?: string;
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
   * The supported credential path: a port the core asks, once per command,
   * for a credential environment overlay. When supplied, the core holds no
   * token of its own — see {@link TokenProvider}. Exactly one of
   * `tokenProvider` or `token` is required.
   */
  tokenProvider?: TokenProvider;
  /**
   * TRANSITIONAL Personal Access Token for operations that require a
   * different identity than the primary token (e.g., PR approval, Projects
   * V2) — only meaningful alongside the transitional `token` field. When
   * `tokenProvider` is supplied, `pat` is ignored; the provider alone decides
   * which credential an `'alternateIdentity'` request receives. Never
   * mutates process.env. Removed alongside `token` in #792/#796.
   */
  pat?: string;
}
