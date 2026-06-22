/**
 * Boundary factory — constructs a GitContext from ambient ADW identity.
 *
 * Resolves auth token (GitHub App → GH_TOKEN → gh CLI) and git identity
 * (env → App slug bot → git config → defaults), injects the ADW framework
 * paths, and returns a fully initialised GitContext.
 *
 * Async so callers can await it at the scope boundary; all resolution is
 * currently synchronous under the hood (execSync / env reads).
 */

import { execSync } from 'child_process';
import { GitContext } from '../gitContext';
import type { GitIdentity, GitContextOptions } from '../gitContext/types';
import { isGitHubAppConfigured, getInstallationToken } from './githubAppAuth';
import { REPO_ROOT, TARGET_REPOS_DIR } from '../core/environment';

interface FactoryInput {
  owner: string;
  repo: string;
  selfHost: boolean;
}

function resolveToken(owner: string, repo: string): string {
  if (isGitHubAppConfigured()) {
    return getInstallationToken(owner, repo);
  }
  if (process.env.GH_TOKEN) {
    return process.env.GH_TOKEN;
  }
  try {
    const token = execSync('gh auth token', { encoding: 'utf-8' }).trim();
    if (token) return token;
  } catch {
    // gh not available or not authenticated
  }
  throw new Error(`gitContextFor: no auth token available for ${owner}/${repo}`);
}

function resolveGitIdentity(): GitIdentity {
  if (process.env.GIT_AUTHOR_NAME && process.env.GIT_AUTHOR_EMAIL) {
    return {
      authorName: process.env.GIT_AUTHOR_NAME,
      authorEmail: process.env.GIT_AUTHOR_EMAIL,
      committerName: process.env.GIT_COMMITTER_NAME ?? process.env.GIT_AUTHOR_NAME,
      committerEmail: process.env.GIT_COMMITTER_EMAIL ?? process.env.GIT_AUTHOR_EMAIL,
    };
  }
  const slug = process.env.GITHUB_APP_SLUG;
  if (slug) {
    const botName = `${slug}[bot]`;
    const botEmail = `${slug}[bot]@users.noreply.github.com`;
    return { authorName: botName, authorEmail: botEmail, committerName: botName, committerEmail: botEmail };
  }
  try {
    const name = execSync('git config user.name', { encoding: 'utf-8' }).trim();
    const email = execSync('git config user.email', { encoding: 'utf-8' }).trim();
    if (name && email) {
      return { authorName: name, authorEmail: email, committerName: name, committerEmail: email };
    }
  } catch {
    // git config not available
  }
  return {
    authorName: 'ADW Bot',
    authorEmail: 'adw-bot@users.noreply.github.com',
    committerName: 'ADW Bot',
    committerEmail: 'adw-bot@users.noreply.github.com',
  };
}

export async function gitContextFor({ owner, repo, selfHost }: FactoryInput): Promise<GitContext> {
  return gitContextForSync({ owner, repo, selfHost });
}

/** Synchronous variant — all resolution is execSync under the hood; use when async is not possible. */
export function gitContextForSync({ owner, repo, selfHost }: FactoryInput): GitContext {
  const token = resolveToken(owner, repo);
  const gitIdentity = resolveGitIdentity();
  const options: GitContextOptions = {
    owner,
    repo,
    selfHost,
    token,
    gitIdentity,
    frameworkRepoRoot: REPO_ROOT,
    targetReposDir: TARGET_REPOS_DIR,
  };
  return new GitContext(options);
}
