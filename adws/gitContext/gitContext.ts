/**
 * GitContext deep module — the single authority for "which repo's filesystem."
 *
 * A GitContext is constructed from a mandatory identity (owner, repo, selfHost,
 * token, gitIdentity) plus injected config (frameworkRepoRoot, targetReposDir).
 * Base-path resolution lives only in the constructor — no optional base path,
 * no cwd fallback. Incomplete identity is a hard construction error.
 *
 * The full git/gh operation surface (worktree create/remove/reset/list, branch,
 * commit/push, issue/PR/gh) is the documented API commitment to be implemented
 * in later slices. This slice ships the interface + base-path/worktree/env
 * resolution authority only.
 */

import * as path from 'path';
import type { GitContextOptions, GitIdentity } from './types';

function assertCompleteIdentity(options: GitContextOptions): void {
  if (!options.owner || !options.owner.trim()) {
    throw new Error('GitContext: owner must not be empty');
  }
  if (!options.repo || !options.repo.trim()) {
    throw new Error('GitContext: repo must not be empty');
  }
  if (typeof options.selfHost !== 'boolean') {
    throw new Error('GitContext: selfHost discriminator must be a boolean (true = self-host, false = target)');
  }
  if (!options.token || !options.token.trim()) {
    throw new Error('GitContext: token must not be empty');
  }
  if (!options.gitIdentity) {
    throw new Error('GitContext: gitIdentity must be provided');
  }
  if (!options.gitIdentity.authorName || !options.gitIdentity.authorName.trim()) {
    throw new Error('GitContext: gitIdentity.authorName must not be empty');
  }
  if (!options.gitIdentity.authorEmail || !options.gitIdentity.authorEmail.trim()) {
    throw new Error('GitContext: gitIdentity.authorEmail must not be empty');
  }
  if (!options.gitIdentity.committerName || !options.gitIdentity.committerName.trim()) {
    throw new Error('GitContext: gitIdentity.committerName must not be empty');
  }
  if (!options.gitIdentity.committerEmail || !options.gitIdentity.committerEmail.trim()) {
    throw new Error('GitContext: gitIdentity.committerEmail must not be empty');
  }
  if (!options.frameworkRepoRoot || !options.frameworkRepoRoot.trim()) {
    throw new Error('GitContext: frameworkRepoRoot must not be empty');
  }
  if (!options.targetReposDir || !options.targetReposDir.trim()) {
    throw new Error('GitContext: targetReposDir must not be empty');
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
  readonly #gitIdentity: GitIdentity;

  constructor(options: GitContextOptions) {
    assertCompleteIdentity(options);
    this.#owner = options.owner;
    this.#repo = options.repo;
    this.#selfHost = options.selfHost;
    this.#token = options.token;
    this.#gitIdentity = options.gitIdentity;
    this.#basePath = resolveBasePath(options);
  }

  get basePath(): string {
    return this.#basePath;
  }

  get owner(): string {
    return this.#owner;
  }

  get repo(): string {
    return this.#repo;
  }

  get selfHost(): boolean {
    return this.#selfHost;
  }

  worktreePathFor(branch: string): string {
    if (!branch || !branch.trim()) {
      throw new Error('GitContext: branch must not be empty');
    }
    return path.join(this.#basePath, '.worktrees', sanitizeBranchName(branch));
  }

  commandEnv(base: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
    return {
      ...base,
      GH_TOKEN: this.#token,
      GIT_AUTHOR_NAME: this.#gitIdentity.authorName,
      GIT_AUTHOR_EMAIL: this.#gitIdentity.authorEmail,
      GIT_COMMITTER_NAME: this.#gitIdentity.committerName,
      GIT_COMMITTER_EMAIL: this.#gitIdentity.committerEmail,
    };
  }
}
