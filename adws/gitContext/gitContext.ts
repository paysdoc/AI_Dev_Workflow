/**
 * GitContext deep module — the single authority for "which repo's filesystem."
 *
 * A GitContext is constructed from a mandatory identity (owner, repo, selfHost,
 * tokenProvider, gitIdentity) plus injected config (frameworkRepoRoot, targetReposDir).
 * Base-path resolution lives only in the constructor — no optional base path,
 * no cwd fallback. Incomplete identity is a hard construction error.
 *
 * Every git operation — and every forge adapter built on this package — is
 * routed through `exec()`, the package's public, forge-neutral executor — the
 * single spawn site, single env merge, single cwd resolution and single
 * ENOENT-rewrap `catch` in the package. `exec()` knows nothing about what a
 * command means: no forge semantics, no token selection, no `--repo`
 * awareness.
 *
 * A private classifier chooses the working-directory CLASS and assembles the
 * credential env, then delegates to `exec()`:
 *   - #run() — git commands and workspace-scoped operations. Resolves to the
 *              context base path (or an explicit worktree path when
 *              supplied).
 * Forge adapters build their own classifier on top of the same primitives —
 * one resolves to the injected framework repo root (`ExecWorkingDirectory`'s
 * `frameworkRoot` class) for commands whose repository identity travels in
 * the command string, so a repo-independent command can run without the
 * target workspace ever having been cloned.
 *
 * `#run` assembles its credential environment through the **TokenProvider
 * port** (`#credentials`, see `types.ts`), asked once per command and never
 * cached by the core, plus git identity — merged into the child environment
 * without ever mutating process.env. It declares only a forge-neutral
 * `CredentialPurpose`; the provider decides which credential answers it.
 * Identity validation probes the provider once at construction and discards
 * the result — see `assertCompleteIdentity`.
 *
 * A spawn failure caused by a missing working directory (basePath or an
 * explicit worktree path that has never been cloned/created on this host)
 * is rewrapped inside `exec()` into an error naming the path and repository
 * identity, preserving `code: 'ENOENT'`; every other failure propagates
 * verbatim.
 *
 * Worktree-operation logging arrives through an injected `Logger` port
 * (`deps.logger`), defaulting to `consoleLogger` — so the package carries no
 * dependency on the host application's logger (PRD story 17).
 */

import * as path from 'path';
import { execSync } from 'child_process';
import { existsSync, mkdirSync, copyFileSync, rmSync } from 'fs';
import type {
  GitContextOptions, GitIdentity, ExecFn, GitContextDeps, FsDeps, ExecOptions, ExecWorkingDirectory,
  TokenProvider, CredentialPurpose, Logger,
} from './types';
import { consoleLogger } from './consoleLogger';
import { branchOps } from './branchOps';
import { commitOps } from './commitOps';
import { worktreeResetOps } from './worktreeResetOps';
import { worktreeQueryOps, type WorktreeForIssueResult } from './worktreeQueryOps';
import { worktreeCreateOps } from './worktreeCreateOps';
import { worktreeRemoveOps } from './worktreeRemoveOps';
import { worktreeProbeOps, type WorktreeRegistration } from './worktreeProbeOps';
import { gitReadOps } from './gitReadOps';
import type { LogSinceOptions } from './gitReadOps';
import { remoteOps } from './remoteOps';
import { claimOps } from './claimOps';
import { rewrapMissingWorkingDirectory } from './workingDirectoryGuard';

/** Single real spawn site for the package — a thin execSync wrapper. */
const defaultExec: ExecFn = (command, options) => {
  if (options.input !== undefined) {
    return execSync(command, {
      ...options,
      encoding: 'utf-8',
      input: options.input,
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 10 * 1024 * 1024,
    }) as string;
  }
  return execSync(command, { ...options, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }) as string;
};

function assertCompleteIdentity(options: GitContextOptions): void {
  const required: Array<[string, string | undefined]> = [
    ['owner', options.owner],
    ['repo', options.repo],
    ['frameworkRepoRoot', options.frameworkRepoRoot],
    ['targetReposDir', options.targetReposDir],
  ];
  for (const [field, value] of required) {
    if (!value?.trim()) throw new Error(`GitContext: ${field} must not be empty`);
  }
  if (typeof options.selfHost !== 'boolean') {
    throw new Error('GitContext: selfHost discriminator must be a boolean (true = self-host, false = target)');
  }
  if (!options.gitIdentity) throw new Error('GitContext: gitIdentity must be provided');
  const id = options.gitIdentity;
  const idFields: Array<[string, string | undefined]> = [
    ['authorName', id.authorName],
    ['authorEmail', id.authorEmail],
    ['committerName', id.committerName],
    ['committerEmail', id.committerEmail],
  ];
  for (const [field, value] of idFields) {
    if (!value?.trim()) throw new Error(`GitContext: gitIdentity.${field} must not be empty`);
  }

  if (!options.tokenProvider) {
    throw new Error('GitContext: tokenProvider must be provided');
  }
  // Validate-and-discard probe: construction performs exactly ONE
  // resolution to fail loudly when the provider can produce no credential —
  // preserving the loud launch-time failure that launchGitContext and
  // gitContextFactory callers depend on — but the answer is thrown away
  // immediately. The first real command still resolves the provider's
  // SECOND answer, never this one. This is what keeps "never cached at
  // construction" literally true while still validating eagerly.
  const probe = options.tokenProvider.credentialEnv({ owner: options.owner, repo: options.repo, purpose: 'default' });
  const values = Object.values(probe);
  const isComplete = values.length > 0 && values.every((v) => !!v?.trim());
  if (!isComplete) {
    throw new Error(`GitContext: tokenProvider returned no credential for ${options.owner}/${options.repo}`);
  }
}

function resolveBasePath(options: GitContextOptions): string {
  return options.selfHost
    ? options.frameworkRepoRoot
    : path.join(options.targetReposDir, options.owner, options.repo);
}

function sanitizeBranchName(branch: string): string {
  return branch.replace(/[/\\:*?"<>|`]/g, '-');
}

export class GitContext {
  readonly #basePath: string;
  readonly #repoApiCwd: string;
  readonly #owner: string;
  readonly #repo: string;
  readonly #selfHost: boolean;
  readonly #credentials: TokenProvider;
  readonly #gitIdentity: GitIdentity;
  readonly #execFn: ExecFn;
  readonly #fsDeps: FsDeps;
  readonly #log: Logger;

  constructor(options: GitContextOptions, deps: GitContextDeps = {}) {
    assertCompleteIdentity(options);
    this.#owner = options.owner;
    this.#repo = options.repo;
    this.#selfHost = options.selfHost;
    this.#credentials = options.tokenProvider;
    this.#gitIdentity = options.gitIdentity;
    this.#basePath = resolveBasePath(options);
    this.#repoApiCwd = options.frameworkRepoRoot;
    this.#execFn = deps.exec ?? defaultExec;
    this.#fsDeps = deps.fsDeps ?? { existsSync, mkdirSync, copyFileSync, rmSync };
    this.#log = deps.logger ?? consoleLogger;
  }

  get basePath(): string { return this.#basePath; }
  get owner(): string { return this.#owner; }
  get repo(): string { return this.#repo; }
  get selfHost(): boolean { return this.#selfHost; }

  worktreePathFor(branch: string): string {
    if (!branch || !branch.trim()) throw new Error('GitContext: branch must not be empty');
    return path.join(this.#basePath, '.worktrees', sanitizeBranchName(branch));
  }

  /**
   * Assembles a command's environment overlay. The credential is resolved
   * through the TokenProvider port on **every call** — never captured at
   * construction — so a long-running orchestrator's agent-subprocess call
   * sites (buildPhase.ts, documentPhase.ts, reviewPhase.ts, prPhase.ts,
   * prReviewPhase.ts, scenarioFixPhase.ts, promotionRotAdvisory.ts) each get a
   * freshly-resolved credential per invocation. The credential is spread
   * before the GIT_* identity assignments so a hostile or misbehaving
   * provider can never displace the context's git identity; both are spread
   * after `base`, preserving existing precedence for call sites that pass an
   * overlay base.
   */
  commandEnv(base: NodeJS.ProcessEnv = {}, purpose: CredentialPurpose = 'default'): NodeJS.ProcessEnv {
    return {
      ...base,
      ...this.#credentials.credentialEnv({ owner: this.#owner, repo: this.#repo, purpose }),
      GIT_AUTHOR_NAME: this.#gitIdentity.authorName,
      GIT_AUTHOR_EMAIL: this.#gitIdentity.authorEmail,
      GIT_COMMITTER_NAME: this.#gitIdentity.committerName,
      GIT_COMMITTER_EMAIL: this.#gitIdentity.committerEmail,
    };
  }

  /** Resolves a working-directory CLASS to the concrete path `exec()` spawns in. */
  #resolveWorkingDirectory(spec: ExecWorkingDirectory): string {
    if (spec.kind === 'frameworkRoot') return this.#repoApiCwd;
    if (spec.path === undefined) return this.#basePath;
    if (!spec.path.trim()) throw new Error('GitContext: exec working directory path must not be empty');
    return spec.path;
  }

  /**
   * The package's public, forge-neutral executor — the single spawn site.
   * Every git/gh operation in this class, and every future forge adapter
   * built on this package, reaches a child process through here.
   *
   * `command` is the FIRST POSITIONAL parameter by contract, not a field on
   * `options`: `adws/checkGitGhGuard.ts`'s `git-gh-shellout` rule only
   * inspects a call's first argument, so an options-object form would
   * silently disable that guard for every consumer of this method.
   *
   * `options.cwd` is a working-directory CLASS, never a bare path, and there
   * is no `process.cwd()` fallback — see `ExecWorkingDirectory`.
   * `options.env` is a per-command credential/identity overlay merged over
   * the inherited process environment; `process.env` itself is never
   * mutated. `options.input`, when supplied, is piped to the child's stdin.
   *
   * Returns stdout, trimmed — every existing call site depends on this.
   * A spawn failure caused by a missing working directory is rewrapped into
   * an actionable error naming the path and repository identity, preserving
   * `code: 'ENOENT'`; every other failure (including an ENOENT whose cwd
   * genuinely exists) propagates verbatim.
   *
   * Deliberately forge-neutral: no credential-purpose parameter, no token
   * selection, no forge vocabulary anywhere in this signature.
   */
  exec(command: string, options: ExecOptions): string {
    if (!command.trim()) throw new Error('GitContext: exec command must not be empty');
    const cwd = this.#resolveWorkingDirectory(options.cwd);
    const env = { ...process.env, ...options.env };
    try {
      return this.#execFn(command, { cwd, env, input: options.input }).trim();
    } catch (error) {
      throw rewrapMissingWorkingDirectory(
        error,
        { cwd, command, owner: this.#owner, repo: this.#repo, selfHost: this.#selfHost },
        this.#fsDeps.existsSync,
      );
    }
  }

  /**
   * Workspace-scoped classifier over `exec()` — git commands and
   * workspace-scoped operations. Resolves to the context base path, or to an
   * explicit worktree path when supplied.
   *
   * opts.cwd   — when provided, narrows the workspace class to this worktree path
   * opts.input — when provided, passes the string to the child's stdin
   */
  #run(command: string, opts: { cwd?: string; input?: string } = {}): string {
    return this.exec(command, {
      cwd: { kind: 'workspace', path: opts.cwd },
      env: this.commandEnv({}),
      input: opts.input,
    });
  }

  // ── Branch ops ───────────────────────────────────────────────────────────────

  getCurrentBranch(worktreePath?: string): string {
    return branchOps.getCurrentBranch((cmd, cwd) => this.#run(cmd, { cwd }), worktreePath ?? this.#basePath);
  }

  mergeLatestFromDefaultBranch(defaultBranch: string, worktreePath: string): void {
    branchOps.mergeLatestFromDefaultBranch((cmd, cwd) => this.#run(cmd, { cwd }), defaultBranch, worktreePath);
  }

  fetchAndResetToRemote(defaultBranch: string, worktreePath: string): void {
    branchOps.fetchAndResetToRemote((cmd, cwd) => this.#run(cmd, { cwd }), defaultBranch, worktreePath);
  }

  deleteLocalBranch(branch: string, worktreePath?: string): boolean {
    return branchOps.deleteLocalBranch((cmd, cwd) => this.#run(cmd, { cwd }), branch, worktreePath ?? this.#basePath);
  }

  deleteRemoteBranch(branch: string, worktreePath?: string): boolean {
    return branchOps.deleteRemoteBranch((cmd, cwd) => this.#run(cmd, { cwd }), branch, worktreePath ?? this.#basePath);
  }

  // ── Commit/push ops ──────────────────────────────────────────────────────────

  commitChanges(message: string, worktreePath: string, opts?: { excludePaths?: readonly string[] }): boolean {
    return commitOps.commitChanges((cmd, cwd) => this.#run(cmd, { cwd }), message, worktreePath, opts);
  }

  removeAndCommitPaths(paths: readonly string[], message: string, worktreePath: string): boolean {
    return commitOps.removeAndCommitPaths((cmd, cwd) => this.#run(cmd, { cwd }), paths, message, worktreePath);
  }

  addAndCommitPaths(paths: readonly string[], message: string, worktreePath: string): boolean {
    return commitOps.addAndCommitPaths((cmd, cwd) => this.#run(cmd, { cwd }), paths, message, worktreePath);
  }

  pushBranch(branch: string, worktreePath: string): void {
    commitOps.pushBranch((cmd, cwd) => this.#run(cmd, { cwd }), branch, worktreePath);
  }

  getHeadTreeHash(worktreePath: string): string {
    return commitOps.getHeadTreeHash((cmd, cwd) => this.#run(cmd, { cwd }), worktreePath);
  }

  hasUncommittedChanges(worktreePath: string): boolean {
    return commitOps.hasUncommittedChanges((cmd, cwd) => this.#run(cmd, { cwd }), worktreePath);
  }

  // ── Worktree reset op ────────────────────────────────────────────────────────

  resetWorktree(worktreePath: string, branch: string): void {
    worktreeResetOps.resetWorktree(
      (cmd, cwd) => this.#run(cmd, { cwd }),
      this.#fsDeps,
      worktreePath,
      branch,
    );
  }

  // ── Worktree management ops ──────────────────────────────────────────────────

  #worktreesDir(): string {
    return path.join(this.#basePath, '.worktrees');
  }

  #worktreePaths(branchName: string): { worktreesDir: string; worktreePath: string; baseCwd: string } {
    return {
      worktreesDir: this.#worktreesDir(),
      worktreePath: this.worktreePathFor(branchName),
      baseCwd: this.#basePath,
    };
  }

  createWorktree(branchName: string, baseBranch?: string): string {
    return worktreeCreateOps.createWorktree(
      (cmd, cwd) => this.#run(cmd, { cwd }),
      this.#fsDeps,
      this.#log,
      this.#worktreePaths(branchName),
      branchName,
      baseBranch,
    );
  }

  createWorktreeForNewBranch(branchName: string, baseBranch?: string): string {
    return worktreeCreateOps.createWorktreeForNewBranch(
      (cmd, cwd) => this.#run(cmd, { cwd }),
      this.#fsDeps,
      this.#log,
      this.#worktreePaths(branchName),
      branchName,
      baseBranch,
    );
  }

  ensureWorktree(branchName: string, baseBranch?: string): string {
    return worktreeCreateOps.ensureWorktree(
      (cmd, cwd) => this.#run(cmd, { cwd }),
      this.#fsDeps,
      this.#log,
      this.#worktreePaths(branchName),
      branchName,
      baseBranch,
    );
  }

  getWorktreeForBranch(branchName: string): string | null {
    return worktreeQueryOps.getWorktreeForBranch(
      (cmd, cwd) => this.#run(cmd, { cwd }),
      this.#fsDeps,
      this.#basePath,
      this.worktreePathFor(branchName),
      branchName,
    );
  }

  listWorktrees(): string[] {
    return worktreeQueryOps.listWorktrees(
      (cmd, cwd) => this.#run(cmd, { cwd }),
      this.#basePath,
    );
  }

  findWorktreeForIssue(prefixes: readonly string[], issueNumber: number): WorktreeForIssueResult | null {
    return worktreeQueryOps.findWorktreeForIssue(
      (cmd, cwd) => this.#run(cmd, { cwd }),
      this.#basePath,
      prefixes,
      issueNumber,
    );
  }

  removeWorktree(branchName: string): boolean {
    return worktreeRemoveOps.removeWorktree(
      (cmd, cwd) => this.#run(cmd, { cwd }),
      this.#fsDeps,
      this.#log,
      this.worktreePathFor(branchName),
      branchName,
      (branch) => this.deleteLocalBranch(branch),
      this.#basePath,
    );
  }

  removeWorktreesForIssue(issueNumber: number): number {
    return worktreeRemoveOps.removeWorktreesForIssue(
      (cmd, cwd) => this.#run(cmd, { cwd }),
      this.#fsDeps,
      this.#log,
      this.#basePath,
      issueNumber,
      (branch) => this.deleteLocalBranch(branch),
    );
  }

  copyEnvToWorktree(worktreePath: string): void {
    worktreeCreateOps.copyEnvToWorktree(
      this.#fsDeps,
      this.#log,
      this.#basePath,
      worktreePath,
    );
  }

  remoteUrl(cwd?: string): string {
    return this.#run('git remote get-url origin', { cwd });
  }

  remotes(cwd?: string): string[] {
    return this.#run('git remote', { cwd }).split('\n').map(s => s.trim()).filter(Boolean);
  }

  gitConfigUser(cwd?: string): { name: string | null; email: string | null } {
    let name: string | null = null;
    let email: string | null = null;
    try {
      const n = this.#run('git config user.name', { cwd });
      name = n || null;
    } catch { /* unset key — expected non-error state */ }
    try {
      const e = this.#run('git config user.email', { cwd });
      email = e || null;
    } catch { /* unset key — expected non-error state */ }
    return { name, email };
  }

  // ── Worktree / branch probe reads ────────────────────────────────────────────

  resolveGitDir(worktreePath: string): string | null {
    return worktreeProbeOps.resolveGitDir((cmd, cwd) => this.#run(cmd, { cwd }), worktreePath);
  }

  currentBranchSymbolic(worktreePath: string): string | null {
    return worktreeProbeOps.currentBranchSymbolic((cmd, cwd) => this.#run(cmd, { cwd }), worktreePath);
  }

  worktreeRegistration(worktreePath: string): WorktreeRegistration {
    return worktreeProbeOps.worktreeRegistration((cmd, cwd) => this.#run(cmd, { cwd }), worktreePath);
  }

  worktreeBranches(cwd?: string): string[] {
    return worktreeQueryOps.worktreeBranches((cmd, c) => this.#run(cmd, { cwd: c }), cwd ?? this.#basePath);
  }

  localBranches(cwd?: string): string[] {
    return branchOps.localBranches((cmd, c) => this.#run(cmd, { cwd: c }), cwd ?? this.#basePath);
  }

  mainRepoPath(cwd?: string): string {
    return worktreeQueryOps.mainRepoPath((cmd, c) => this.#run(cmd, { cwd: c }), cwd ?? this.#basePath);
  }

  // ── Remote fetch / merge / ls-remote ops ────────────────────────────────────

  fetchRemote(branch: string, cwd: string): void {
    remoteOps.fetchRemote((cmd, c) => this.#run(cmd, { cwd: c }), branch, cwd);
  }

  mergeBranch(ref: string, cwd: string, opts?: { noCommit?: boolean; noFf?: boolean; noEdit?: boolean }): void {
    remoteOps.mergeBranch((cmd, c) => this.#run(cmd, { cwd: c }), ref, cwd, opts);
  }

  abortMerge(cwd: string): void {
    remoteOps.abortMerge((cmd, c) => this.#run(cmd, { cwd: c }), cwd);
  }

  lsRemote(branch: string, cwd?: string): string {
    return remoteOps.lsRemote((cmd, c) => this.#run(cmd, { cwd: c }), branch, cwd ?? this.#basePath);
  }

  // ── Upgrade-claim distributed-lock ops ──────────────────────────────────────

  addDetachedWorktree(worktreePath: string, ref: string, cwd: string): void {
    claimOps.addDetachedWorktree((cmd, c) => this.#run(cmd, { cwd: c }), worktreePath, ref, cwd);
  }

  commitAllowEmpty(message: string, cwd: string): void {
    claimOps.commitAllowEmpty((cmd, c) => this.#run(cmd, { cwd: c }), message, cwd);
  }

  pushHeadToBranch(branch: string, cwd: string): void {
    claimOps.pushHeadToBranch((cmd, c) => this.#run(cmd, { cwd: c }), branch, cwd);
  }

  removeDetachedWorktree(worktreePath: string, cwd: string): void {
    claimOps.removeDetachedWorktree((cmd, c) => this.#run(cmd, { cwd: c }), worktreePath, cwd);
  }

  // ── Git read ops ──────────────────────────────────────────────────────────────

  lsFiles(cwd: string, prefix?: string): string[] {
    return gitReadOps.lsFiles((cmd, c) => this.#run(cmd, { cwd: c }), cwd, prefix);
  }

  headShort(cwd?: string): string {
    return gitReadOps.headShort((cmd, c) => this.#run(cmd, { cwd: c }), cwd ?? this.#basePath);
  }

  diff(range: string, cwd: string): string {
    return gitReadOps.diff((cmd, c) => this.#run(cmd, { cwd: c }), range, cwd);
  }

  log(branchName: string, cwd?: string): string {
    return gitReadOps.log((cmd, c) => this.#run(cmd, { cwd: c }), branchName, cwd ?? this.#basePath);
  }

  show(ref: string, filePath: string, cwd?: string): string {
    return gitReadOps.show((cmd, c) => this.#run(cmd, { cwd: c }), ref, filePath, cwd ?? this.#basePath);
  }

  logSince(opts: LogSinceOptions, cwd?: string): string {
    return gitReadOps.logSince((cmd, c) => this.#run(cmd, { cwd: c }), opts, cwd ?? this.#basePath);
  }

}
