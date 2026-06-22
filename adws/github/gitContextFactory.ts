import { execSync } from 'child_process';
import { GitContext } from '../gitContext';
import type { GitIdentity } from '../gitContext/types';
import { getInstallationToken, isGitHubAppConfigured } from './githubAppAuth';
import { REPO_ROOT, TARGET_REPOS_DIR, GITHUB_PAT } from '../core/environment';
import type { RepoInfo } from './githubApi';

export function deriveGitIdentity(): GitIdentity {
  const appId = process.env.GITHUB_APP_ID;
  const appSlug = process.env.GITHUB_APP_SLUG;
  if (appId && appSlug) {
    const botName = `${appSlug}[bot]`;
    const botEmail = `${appId}+${appSlug}[bot]@users.noreply.github.com`;
    return { authorName: botName, authorEmail: botEmail, committerName: botName, committerEmail: botEmail };
  }
  try {
    const name = execSync('git config user.name', { encoding: 'utf-8' }).trim() || 'ADW Bot';
    const email = execSync('git config user.email', { encoding: 'utf-8' }).trim() || 'adw-bot@noreply.github.com';
    return { authorName: name, authorEmail: email, committerName: name, committerEmail: email };
  } catch {
    return { authorName: 'ADW Bot', authorEmail: 'adw-bot@noreply.github.com', committerName: 'ADW Bot', committerEmail: 'adw-bot@noreply.github.com' };
  }
}

function resolveToken(owner: string, repo: string): string {
  if (isGitHubAppConfigured()) {
    try { return getInstallationToken(owner, repo); } catch { /* fall through */ }
  }
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  try {
    const result = execSync('gh auth token', { encoding: 'utf-8' });
    if (result && typeof result === 'string') {
      const t = result.trim();
      if (t) return t;
    }
  } catch { /* ignore */ }
  return 'placeholder-unset-token';
}

let selfHostOwnerCache: string | undefined;
let selfHostRepoCache: string | undefined;

function getSelfHostIdentity(): { owner: string; repo: string } {
  if (selfHostOwnerCache === undefined) {
    try {
      const remote = execSync('git remote get-url origin', { encoding: 'utf-8', cwd: REPO_ROOT }).trim();
      const m = remote.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
      selfHostOwnerCache = m?.[1] ?? '';
      selfHostRepoCache = m?.[2] ?? '';
    } catch {
      selfHostOwnerCache = '';
      selfHostRepoCache = '';
    }
  }
  return { owner: selfHostOwnerCache!, repo: selfHostRepoCache! };
}

export function clearSelfHostCache(): void {
  selfHostOwnerCache = undefined;
  selfHostRepoCache = undefined;
}

/** Returns a fresh GitContext for the given repo (no caching — getInstallationToken handles token freshness). */
export function gitContextForRepo(repoInfo: RepoInfo, opts?: { selfHost?: boolean }): GitContext {
  const { owner, repo } = repoInfo;
  const token = resolveToken(owner, repo);
  const gitIdentity = deriveGitIdentity();
  const sh = getSelfHostIdentity();
  const selfHost = opts?.selfHost ?? (owner === sh.owner && repo === sh.repo && !!sh.owner);
  return new GitContext({
    owner, repo, selfHost, token, gitIdentity,
    frameworkRepoRoot: REPO_ROOT,
    targetReposDir: TARGET_REPOS_DIR,
    pat: GITHUB_PAT,
  });
}
