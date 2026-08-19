/**
 * GitContext deep module — the single authority for "which repo's filesystem."
 *
 * A GitContext is constructed from a mandatory identity (owner, repo, selfHost,
 * token, gitIdentity) plus injected config (frameworkRepoRoot, targetReposDir).
 * Base-path resolution lives only in the constructor — no optional base path,
 * no cwd fallback. Incomplete identity is a hard construction error.
 *
 * Every gh/git operation is routed through `exec()`, the package's public,
 * forge-neutral executor — the single spawn site, single env merge, single
 * cwd resolution and single ENOENT-rewrap `catch` in the package. `exec()`
 * knows nothing about what a command means: no forge semantics, no token
 * selection, no `--repo` awareness.
 *
 * Two private classifiers choose the working-directory CLASS and assemble
 * the credential env, then delegate to `exec()`:
 *   - #run()        — git commands and workspace-scoped operations. Resolves
 *                      to the context base path (or an explicit worktree path
 *                      when supplied).
 *   - #runRepoApi() — repo-independent gh commands, whose repository identity
 *                      travels in the command string. Resolves to the
 *                      injected framework repo root, which exists regardless
 *                      of whether the target workspace has ever been cloned.
 * Both assemble their credential environment through the **TokenProvider
 * port** (`#credentials`, see `types.ts`), asked once per command and never
 * cached by the core, plus git identity — merged into the child environment
 * without ever mutating process.env. Each classifier declares only a
 * forge-neutral `CredentialPurpose`; the provider decides which credential
 * answers it. Identity validation probes the provider once at construction
 * and discards the result — see `assertCompleteIdentity`. `token`/`pat`
 * remain on `GitContextOptions` only as the transitional literal-credential
 * path for callers that have not yet been migrated to a provider.
 *
 * A spawn failure caused by a missing working directory (basePath or an
 * explicit worktree path that has never been cloned/created on this host)
 * is rewrapped inside `exec()` into an error naming the path and repository
 * identity, preserving `code: 'ENOENT'`; every other failure propagates
 * verbatim.
 */

import * as path from 'path';
import { execSync } from 'child_process';
import { existsSync, mkdirSync, copyFileSync, rmSync } from 'fs';
import type {
  GitContextOptions, GitIdentity, ExecFn, GitContextDeps, FsDeps, ExecOptions, ExecWorkingDirectory,
  TokenProvider, CredentialPurpose, CredentialRequest,
} from './types';
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
import {
  fetchIssueCmd, commentOnIssueCmd, issueStateCmd, closeIssueCmd, issueTitleCmd,
  fetchIssueCommentsCmd, issueHasLabelCmd, addIssueLabelCmd, createIssueCmd,
  updateIssueBodyCmd, findOpenUpgradeIssueCmd, deleteIssueCommentCmd,
  listOpenIssuesCmd, issueCommentsCmd,
  type ListOpenIssuesOptions,
} from './commands/issueCommands';
import {
  findPRByBranchCmd, fetchPRDetailsCmd, fetchPRReviewsCmd, fetchPRReviewCommentsCmd,
  commentOnPRCmd, mergePRCmd, approvePRCmd, prApprovalStateCmd,
  fetchPRListCmd, fetchAllPRsCmd, createPRCmd, fetchMergedPRsCmd, prChangedFilesCmd,
} from './commands/prCommands';
import { createLabelCmd, applyLabelCmd } from './commands/labelCommands';
import { setSecretCmd } from './commands/secretCommands';
import {
  graphQLCmd, graphQLInputCmd, projectQueryCmd, itemQueryCmd, fieldQueryCmd, moveStatusCmd,
  parseProjectId, parseIssueItem, parseStatusField,
} from './commands/boardCommands';

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

  // Credential fields are conditionally required: exactly one of tokenProvider
  // (the supported path) or token (transitional) must be supplied.
  if (!options.tokenProvider && options.token === undefined) {
    throw new Error('GitContext: exactly one of tokenProvider or token must be provided');
  }
  if (!options.tokenProvider && !options.token?.trim()) {
    throw new Error('GitContext: token must not be empty');
  }
  if (options.tokenProvider) {
    // Validate-and-discard probe: construction performs exactly ONE
    // resolution to fail loudly when the provider can produce no credential
    // — preserving the loud launch-time failure that launchGitContext and
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
}

/**
 * TRANSITIONAL — the literal-credential path for callers that still pass
 * `options.token`/`options.pat` instead of a `tokenProvider`. Production no
 * longer takes this path; it exists so the many existing construction sites
 * that assert against a literal token stay untouched and keep acting as this
 * slice's regression net. This is the only place the credential environment
 * is derived from a construction-time snapshot in the core, and it is one
 * deletion away from gone — removed alongside `GitContextOptions.token`/`pat`
 * in #792/#796.
 */
function staticCredentialProvider(token: string, pat: string | undefined): TokenProvider {
  return {
    credentialEnv({ purpose }: CredentialRequest): NodeJS.ProcessEnv {
      return { GH_TOKEN: (purpose === 'alternateIdentity' && pat) ? pat : token };
    },
  };
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

  constructor(options: GitContextOptions, deps: GitContextDeps = {}) {
    assertCompleteIdentity(options);
    this.#owner = options.owner;
    this.#repo = options.repo;
    this.#selfHost = options.selfHost;
    this.#credentials = options.tokenProvider ?? staticCredentialProvider(options.token ?? '', options.pat);
    this.#gitIdentity = options.gitIdentity;
    this.#basePath = resolveBasePath(options);
    this.#repoApiCwd = options.frameworkRepoRoot;
    this.#execFn = deps.exec ?? defaultExec;
    this.#fsDeps = deps.fsDeps ?? { existsSync, mkdirSync, copyFileSync, rmSync };
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
   * opts.cwd     — when provided, narrows the workspace class to this worktree path
   * opts.purpose — the forge-neutral credential purpose this command needs;
   *                the TokenProvider port, not this classifier, decides which
   *                credential answers it. Private and temporary — never
   *                reaches `exec()`'s public signature.
   * opts.input   — when provided, passes the string to the child's stdin
   */
  #run(command: string, opts: { cwd?: string; input?: string; purpose?: CredentialPurpose } = {}): string {
    return this.exec(command, {
      cwd: { kind: 'workspace', path: opts.cwd },
      env: this.commandEnv({}, opts.purpose ?? 'default'),
      input: opts.input,
    });
  }

  /**
   * Framework-root classifier over `exec()` — gh commands whose repository
   * identity travels in the command string (`--repo owner/repo`, `gh api
   * repos/owner/repo/…`) or that address no repository at all (`gh api
   * user`, `gh api graphql`) are pure GitHub API calls: they need no
   * repository working directory. They run from the framework repo root,
   * which always exists, so directive handling (Cancel/Retry) never depends
   * on a target workspace having been cloned.
   *
   * Deliberately accepts no cwd override — the framework-root class makes
   * that override unrepresentable rather than merely unpassed.
   */
  #runRepoApi(command: string, opts: { input?: string; purpose?: CredentialPurpose } = {}): string {
    return this.exec(command, {
      cwd: { kind: 'frameworkRoot' },
      env: this.commandEnv({}, opts.purpose ?? 'default'),
      input: opts.input,
    });
  }

  defaultBranch(): string {
    return this.#runRepoApi(
      `gh repo view ${this.#owner}/${this.#repo} --json defaultBranchRef --jq .defaultBranchRef.name`,
    );
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
      this.#worktreePaths(branchName),
      branchName,
      baseBranch,
    );
  }

  createWorktreeForNewBranch(branchName: string, baseBranch?: string): string {
    return worktreeCreateOps.createWorktreeForNewBranch(
      (cmd, cwd) => this.#run(cmd, { cwd }),
      this.#fsDeps,
      this.#worktreePaths(branchName),
      branchName,
      baseBranch,
    );
  }

  ensureWorktree(branchName: string, baseBranch?: string): string {
    return worktreeCreateOps.ensureWorktree(
      (cmd, cwd) => this.#run(cmd, { cwd }),
      this.#fsDeps,
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
      this.#basePath,
      issueNumber,
      (branch) => this.deleteLocalBranch(branch),
    );
  }

  copyEnvToWorktree(worktreePath: string): void {
    worktreeCreateOps.copyEnvToWorktree(
      this.#fsDeps,
      this.#basePath,
      worktreePath,
    );
  }

  // ── GitHub issue ops ─────────────────────────────────────────────────────────

  fetchIssue(issueNumber: number): string {
    return this.#runRepoApi(fetchIssueCmd(this.#owner, this.#repo, issueNumber));
  }

  commentOnIssue(issueNumber: number, body: string): void {
    this.#runRepoApi(commentOnIssueCmd(this.#owner, this.#repo, issueNumber), { input: body });
  }

  issueState(issueNumber: number): string {
    return this.#runRepoApi(issueStateCmd(this.#owner, this.#repo, issueNumber));
  }

  closeIssue(issueNumber: number): void {
    this.#runRepoApi(closeIssueCmd(this.#owner, this.#repo, issueNumber));
  }

  issueTitle(issueNumber: number): string {
    return this.#runRepoApi(issueTitleCmd(this.#owner, this.#repo, issueNumber));
  }

  fetchIssueComments(issueNumber: number): string {
    return this.#runRepoApi(fetchIssueCommentsCmd(this.#owner, this.#repo, issueNumber));
  }

  issueHasLabel(issueNumber: number, _labelName: string): string {
    return this.#runRepoApi(issueHasLabelCmd(this.#owner, this.#repo, issueNumber));
  }

  addIssueLabel(issueNumber: number, labelName: string): void {
    this.#runRepoApi(addIssueLabelCmd(this.#owner, this.#repo, issueNumber, labelName));
  }

  createIssue(title: string, body: string): string {
    return this.#runRepoApi(createIssueCmd(this.#owner, this.#repo, title), { input: body });
  }

  updateIssueBody(issueNumber: number, body: string): void {
    this.#runRepoApi(updateIssueBodyCmd(this.#owner, this.#repo, issueNumber), { input: body });
  }

  findOpenUpgradeIssue(): string {
    return this.#runRepoApi(findOpenUpgradeIssueCmd(this.#owner, this.#repo));
  }

  deleteIssueComment(commentId: number): void {
    this.#runRepoApi(deleteIssueCommentCmd(this.#owner, this.#repo, commentId));
  }

  listOpenIssues(opts: ListOpenIssuesOptions): string {
    return this.#runRepoApi(listOpenIssuesCmd(this.#owner, this.#repo, opts));
  }

  issueComments(issueNumber: number): string {
    return this.#runRepoApi(issueCommentsCmd(this.#owner, this.#repo, issueNumber));
  }

  fetchMergedPRs(limit?: number): string {
    return this.#runRepoApi(fetchMergedPRsCmd(this.#owner, this.#repo, limit));
  }

  authenticatedUser(): string {
    return this.#runRepoApi('gh api user');
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

  findPRByBranch(branchName: string): string {
    return this.#runRepoApi(findPRByBranchCmd(this.#owner, this.#repo, branchName));
  }

  fetchPRDetails(prNumber: number): string {
    return this.#runRepoApi(fetchPRDetailsCmd(this.#owner, this.#repo, prNumber));
  }

  fetchPRReviews(prNumber: number): string {
    return this.#runRepoApi(fetchPRReviewsCmd(this.#owner, this.#repo, prNumber));
  }

  fetchPRReviewComments(prNumber: number): string {
    return this.#runRepoApi(fetchPRReviewCommentsCmd(this.#owner, this.#repo, prNumber));
  }

  commentOnPR(prNumber: number, body: string): void {
    this.#runRepoApi(commentOnPRCmd(this.#owner, this.#repo, prNumber), { input: body });
  }

  mergePR(prNumber: number): void {
    this.#runRepoApi(mergePRCmd(this.#owner, this.#repo, prNumber));
  }

  /** Approves a PR using the PAT identity (GitHub forbids bot self-approval). */
  approvePR(prNumber: number): void {
    this.#runRepoApi(approvePRCmd(this.#owner, this.#repo, prNumber), { purpose: 'alternateIdentity' });
  }

  prApprovalState(prNumber: number): string {
    return this.#runRepoApi(prApprovalStateCmd(this.#owner, this.#repo, prNumber));
  }

  fetchPRList(): string {
    return this.#runRepoApi(fetchPRListCmd(this.#owner, this.#repo));
  }

  fetchAllPRs(): string {
    return this.#runRepoApi(fetchAllPRsCmd(this.#owner, this.#repo));
  }

  fetchPRChangedFiles(prNumber: number): string {
    return this.#runRepoApi(prChangedFilesCmd(this.#owner, this.#repo, prNumber));
  }

  createPR(title: string, body: string, headBranch: string, baseBranch?: string, labels?: readonly string[]): string {
    return this.#runRepoApi(createPRCmd(this.#owner, this.#repo, title, headBranch, baseBranch, labels), { input: body });
  }

  createLabel(name: string, color: string, description: string): void {
    this.#runRepoApi(createLabelCmd(this.#owner, this.#repo, name, color, description));
  }

  applyLabel(issueNumber: number, labelName: string): void {
    this.#runRepoApi(applyLabelCmd(this.#owner, this.#repo, issueNumber, labelName));
  }

  setSecret(name: string, value: string): void {
    this.#runRepoApi(setSecretCmd(this.#owner, this.#repo, name), { input: value });
  }

  runGraphQL(query: string, variables?: Record<string, string | number>): string {
    return this.#runRepoApi(graphQLCmd(query, variables), { purpose: 'alternateIdentity' });
  }

  /** stdin-JSON form for GraphQL mutations with complex/array variables that runGraphQL's flag form cannot express. Uses PAT (Projects V2 writes) with graceful fallback to context token when no PAT is set. */
  runGraphQLInput(body: Record<string, unknown>): string {
    return this.#runRepoApi(graphQLInputCmd(), { input: JSON.stringify(body), purpose: 'alternateIdentity' });
  }

  /**
   * Moves a GitHub issue to a target status on its Projects V2 board.
   * Uses the PAT identity (app tokens lack Projects V2 access on user-owned repos).
   * Returns true if the move succeeded; false if no project, no item, or no status match.
   * Gracefully handles empty/placeholder responses (e.g., in test mode with a spy exec).
   */
  moveIssueToStatus(issueNumber: number, targetStatus: string): boolean {
    let projectId: string | null = null;
    try {
      projectId = parseProjectId(this.#runRepoApi(projectQueryCmd(this.#owner, this.#repo), { purpose: 'alternateIdentity' }));
    } catch { return false; }
    if (!projectId) return false;

    let item: { itemId: string; currentStatus: string | null } | null = null;
    try {
      item = parseIssueItem(
        this.#runRepoApi(itemQueryCmd(this.#owner, this.#repo, issueNumber), { purpose: 'alternateIdentity' }),
        projectId,
      );
    } catch { return false; }
    if (!item) return false;
    if (item.currentStatus?.toLowerCase() === targetStatus.toLowerCase()) return true;

    let field: { fieldId: string; optionId: string } | 'already_at_status' | null = null;
    try {
      field = parseStatusField(
        this.#runRepoApi(fieldQueryCmd(projectId), { purpose: 'alternateIdentity' }),
        targetStatus,
        item.currentStatus,
      );
    } catch { return false; }
    if (!field) return false;
    if (field === 'already_at_status') return true;

    try {
      this.#runRepoApi(moveStatusCmd(projectId, item.itemId, field.fieldId, field.optionId), { purpose: 'alternateIdentity' });
    } catch { return false; }
    return true;
  }
}
