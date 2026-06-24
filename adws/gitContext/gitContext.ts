/**
 * GitContext deep module — the single authority for "which repo's filesystem."
 *
 * A GitContext is constructed from a mandatory identity (owner, repo, selfHost,
 * token, gitIdentity) plus injected config (frameworkRepoRoot, targetReposDir).
 * Base-path resolution lives only in the constructor — no optional base path,
 * no cwd fallback. Incomplete identity is a hard construction error.
 *
 * Every gh/git operation is routed through the private #run() chokepoint,
 * which injects per-command auth (token or PAT) + git identity into the child
 * environment without ever mutating process.env.
 */

import * as path from 'path';
import { execSync } from 'child_process';
import { existsSync, mkdirSync, copyFileSync, rmSync } from 'fs';
import type { GitContextOptions, GitIdentity, ExecFn, GitContextDeps, FsDeps } from './types';
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
    ['token', options.token],
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
  readonly #owner: string;
  readonly #repo: string;
  readonly #selfHost: boolean;
  readonly #token: string;
  readonly #pat: string | undefined;
  readonly #gitIdentity: GitIdentity;
  readonly #exec: ExecFn;
  readonly #fsDeps: FsDeps;

  constructor(options: GitContextOptions, deps: GitContextDeps = {}) {
    assertCompleteIdentity(options);
    this.#owner = options.owner;
    this.#repo = options.repo;
    this.#selfHost = options.selfHost;
    this.#token = options.token;
    this.#pat = options.pat;
    this.#gitIdentity = options.gitIdentity;
    this.#basePath = resolveBasePath(options);
    this.#exec = deps.exec ?? defaultExec;
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

  commandEnv(base: NodeJS.ProcessEnv = {}, usePat = false): NodeJS.ProcessEnv {
    return {
      ...base,
      GH_TOKEN: (usePat && this.#pat) ? this.#pat : this.#token,
      GIT_AUTHOR_NAME: this.#gitIdentity.authorName,
      GIT_AUTHOR_EMAIL: this.#gitIdentity.authorEmail,
      GIT_COMMITTER_NAME: this.#gitIdentity.committerName,
      GIT_COMMITTER_EMAIL: this.#gitIdentity.committerEmail,
    };
  }

  /**
   * Single spawn chokepoint — explicit cwd + per-command env
   * (token or PAT + git identity). Never mutates process.env.
   *
   * opts.cwd    — when provided, overrides the context base path as the working directory
   * opts.usePat — when true and a PAT is configured, uses the PAT as GH_TOKEN
   * opts.input  — when provided, passes the string to the child's stdin
   */
  #run(command: string, opts: { cwd?: string; input?: string; usePat?: boolean } = {}): string {
    const env = this.commandEnv(process.env, opts.usePat ?? false);
    return this.#exec(command, {
      cwd: opts.cwd ?? this.#basePath,
      env,
      input: opts.input,
    }).trim();
  }

  defaultBranch(): string {
    return this.#run(
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
    return this.#run(fetchIssueCmd(this.#owner, this.#repo, issueNumber));
  }

  commentOnIssue(issueNumber: number, body: string): void {
    this.#run(commentOnIssueCmd(this.#owner, this.#repo, issueNumber), { input: body });
  }

  issueState(issueNumber: number): string {
    return this.#run(issueStateCmd(this.#owner, this.#repo, issueNumber));
  }

  closeIssue(issueNumber: number): void {
    this.#run(closeIssueCmd(this.#owner, this.#repo, issueNumber));
  }

  issueTitle(issueNumber: number): string {
    return this.#run(issueTitleCmd(this.#owner, this.#repo, issueNumber));
  }

  fetchIssueComments(issueNumber: number): string {
    return this.#run(fetchIssueCommentsCmd(this.#owner, this.#repo, issueNumber));
  }

  issueHasLabel(issueNumber: number, _labelName: string): string {
    return this.#run(issueHasLabelCmd(this.#owner, this.#repo, issueNumber));
  }

  addIssueLabel(issueNumber: number, labelName: string): void {
    this.#run(addIssueLabelCmd(this.#owner, this.#repo, issueNumber, labelName));
  }

  createIssue(title: string, body: string): string {
    return this.#run(createIssueCmd(this.#owner, this.#repo, title), { input: body });
  }

  updateIssueBody(issueNumber: number, body: string): void {
    this.#run(updateIssueBodyCmd(this.#owner, this.#repo, issueNumber), { input: body });
  }

  findOpenUpgradeIssue(): string {
    return this.#run(findOpenUpgradeIssueCmd(this.#owner, this.#repo));
  }

  deleteIssueComment(commentId: number): void {
    this.#run(deleteIssueCommentCmd(this.#owner, this.#repo, commentId));
  }

  listOpenIssues(opts: ListOpenIssuesOptions): string {
    return this.#run(listOpenIssuesCmd(this.#owner, this.#repo, opts));
  }

  issueComments(issueNumber: number): string {
    return this.#run(issueCommentsCmd(this.#owner, this.#repo, issueNumber));
  }

  fetchMergedPRs(limit?: number): string {
    return this.#run(fetchMergedPRsCmd(this.#owner, this.#repo, limit));
  }

  authenticatedUser(): string {
    return this.#run('gh api user');
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

  logSince(opts: LogSinceOptions, cwd?: string): string {
    return gitReadOps.logSince((cmd, c) => this.#run(cmd, { cwd: c }), opts, cwd ?? this.#basePath);
  }

  findPRByBranch(branchName: string): string {
    return this.#run(findPRByBranchCmd(this.#owner, this.#repo, branchName));
  }

  fetchPRDetails(prNumber: number): string {
    return this.#run(fetchPRDetailsCmd(this.#owner, this.#repo, prNumber));
  }

  fetchPRReviews(prNumber: number): string {
    return this.#run(fetchPRReviewsCmd(this.#owner, this.#repo, prNumber));
  }

  fetchPRReviewComments(prNumber: number): string {
    return this.#run(fetchPRReviewCommentsCmd(this.#owner, this.#repo, prNumber));
  }

  commentOnPR(prNumber: number, body: string): void {
    this.#run(commentOnPRCmd(this.#owner, this.#repo, prNumber), { input: body });
  }

  mergePR(prNumber: number): void {
    this.#run(mergePRCmd(this.#owner, this.#repo, prNumber));
  }

  /** Approves a PR using the PAT identity (GitHub forbids bot self-approval). */
  approvePR(prNumber: number): void {
    this.#run(approvePRCmd(this.#owner, this.#repo, prNumber), { usePat: true });
  }

  prApprovalState(prNumber: number): string {
    return this.#run(prApprovalStateCmd(this.#owner, this.#repo, prNumber));
  }

  fetchPRList(): string {
    return this.#run(fetchPRListCmd(this.#owner, this.#repo));
  }

  fetchAllPRs(): string {
    return this.#run(fetchAllPRsCmd(this.#owner, this.#repo));
  }

  fetchPRChangedFiles(prNumber: number): string {
    return this.#run(prChangedFilesCmd(this.#owner, this.#repo, prNumber));
  }

  createPR(title: string, body: string, headBranch: string, baseBranch?: string, labels?: readonly string[]): string {
    return this.#run(createPRCmd(this.#owner, this.#repo, title, headBranch, baseBranch, labels), { input: body });
  }

  createLabel(name: string, color: string, description: string): void {
    this.#run(createLabelCmd(this.#owner, this.#repo, name, color, description));
  }

  applyLabel(issueNumber: number, labelName: string): void {
    this.#run(applyLabelCmd(this.#owner, this.#repo, issueNumber, labelName));
  }

  setSecret(name: string, value: string): void {
    this.#run(setSecretCmd(this.#owner, this.#repo, name), { input: value });
  }

  runGraphQL(query: string, variables?: Record<string, string | number>): string {
    return this.#run(graphQLCmd(query, variables), { usePat: true });
  }

  /** stdin-JSON form for GraphQL mutations with complex/array variables that runGraphQL's flag form cannot express. Uses PAT (Projects V2 writes) with graceful fallback to context token when no PAT is set. */
  runGraphQLInput(body: Record<string, unknown>): string {
    return this.#run(graphQLInputCmd(), { input: JSON.stringify(body), usePat: true });
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
      projectId = parseProjectId(this.#run(projectQueryCmd(this.#owner, this.#repo), { usePat: true }));
    } catch { return false; }
    if (!projectId) return false;

    let item: { itemId: string; currentStatus: string | null } | null = null;
    try {
      item = parseIssueItem(
        this.#run(itemQueryCmd(this.#owner, this.#repo, issueNumber), { usePat: true }),
        projectId,
      );
    } catch { return false; }
    if (!item) return false;
    if (item.currentStatus?.toLowerCase() === targetStatus.toLowerCase()) return true;

    let field: { fieldId: string; optionId: string } | 'already_at_status' | null = null;
    try {
      field = parseStatusField(
        this.#run(fieldQueryCmd(projectId), { usePat: true }),
        targetStatus,
        item.currentStatus,
      );
    } catch { return false; }
    if (!field) return false;
    if (field === 'already_at_status') return true;

    try {
      this.#run(moveStatusCmd(projectId, item.itemId, field.fieldId, field.optionId), { usePat: true });
    } catch { return false; }
    return true;
  }
}
