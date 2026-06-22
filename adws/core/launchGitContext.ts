/**
 * Boundary-constructor adapter — builds exactly one GitContext at a process launch boundary.
 *
 * Lives in adws/core/ (not adws/gitContext/) so the gitContext package stays free of
 * ADW-global dependencies. The gitContext package is a pure, dependency-injectable
 * deep module; this adapter is the ADW-specific wiring layer.
 */

import { execSync } from 'child_process';
import { GitContext } from '../gitContext';
import type { GitIdentity } from '../gitContext';
import type { TargetRepoInfo } from '../types/issueTypes';
import type { RepoInfo } from '../github/githubApi';
import { getRepoInfo } from '../github/githubApi';
import {
  isGitHubAppConfigured,
  getInstallationToken,
  ensureAppAuthForRepo,
} from '../github/githubAppAuth';
import { REPO_ROOT, TARGET_REPOS_DIR, GITHUB_PAT } from './environment';

const DEFAULT_ADW_IDENTITY: GitIdentity = {
  authorName: 'ADW Bot',
  authorEmail: 'adw-bot@users.noreply.github.com',
  committerName: 'ADW Bot',
  committerEmail: 'adw-bot@users.noreply.github.com',
};

/**
 * Injectable seams for buildLaunchGitContext. All fields are optional;
 * production defaults are applied if omitted.
 */
export interface LaunchGitContextDeps {
  /** Returns the local git remote owner/repo. Defaults to getRepoInfo() from ../github. */
  getRepoInfo?: (cwd?: string) => RepoInfo;
  /** Returns a non-empty GitHub token for the given owner/repo. Defaults to resolveLaunchToken(). */
  resolveToken?: (owner: string, repo: string) => string;
  /** Returns a complete git identity. Defaults to resolveLaunchGitIdentity(). */
  resolveGitIdentity?: () => GitIdentity;
  /** Absolute path to the ADW framework repo root. Defaults to REPO_ROOT. */
  frameworkRepoRoot?: string;
  /** Absolute path to the directory that houses cloned target repos. Defaults to TARGET_REPOS_DIR. */
  targetReposDir?: string;
}

/**
 * Resolves a GitHub token for the given owner/repo using the following priority:
 * 1. GitHub App installation token (if configured)
 * 2. GITHUB_PAT env var
 * 3. `gh auth token` CLI output
 * 4. GH_TOKEN env var
 *
 * Throws loudly if no token is resolvable (story 23).
 */
export function resolveLaunchToken(owner: string, repo: string): string {
  if (isGitHubAppConfigured()) {
    const token = getInstallationToken(owner, repo);
    if (token) return token;
  }
  if (GITHUB_PAT) return GITHUB_PAT;
  try {
    const token = execSync('gh auth token', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    if (token) return token;
  } catch { /* gh not configured or not available */ }
  const envToken = process.env.GH_TOKEN;
  if (envToken) return envToken;
  throw new Error(`launchGitContext: could not resolve a GitHub token for ${owner}/${repo}`);
}

/**
 * Resolves a complete git author/committer identity using the following priority:
 * 1. GitHub App bot identity (if App configured)
 * 2. GIT_AUTHOR_* / GIT_COMMITTER_* env vars
 * 3. git config user.name / user.email
 * 4. Built-in ADW Bot default (never returns empty fields)
 */
export function resolveLaunchGitIdentity(): GitIdentity {
  if (isGitHubAppConfigured()) {
    const appId = process.env.GITHUB_APP_ID;
    const appSlug = process.env.GITHUB_APP_SLUG;
    if (appId && appSlug) {
      const botName = `${appSlug}[bot]`;
      const botEmail = `${appId}+${appSlug}[bot]@users.noreply.github.com`;
      return {
        authorName: botName,
        authorEmail: botEmail,
        committerName: botName,
        committerEmail: botEmail,
      };
    }
  }

  const authorName = process.env.GIT_AUTHOR_NAME;
  const authorEmail = process.env.GIT_AUTHOR_EMAIL;
  const committerName = process.env.GIT_COMMITTER_NAME || authorName;
  const committerEmail = process.env.GIT_COMMITTER_EMAIL || authorEmail;

  if (authorName && authorEmail && committerName && committerEmail) {
    return { authorName, authorEmail, committerName, committerEmail };
  }

  try {
    const name = execSync('git config user.name', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    const email = execSync('git config user.email', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    if (name && email) {
      return { authorName: name, authorEmail: email, committerName: name, committerEmail: email };
    }
  } catch { /* git config not available */ }

  return DEFAULT_ADW_IDENTITY;
}

/**
 * Builds exactly one GitContext from the process launch identity.
 *
 * When `targetRepo` is non-null (i.e., `--target-repo` was present), builds a
 * TARGET context whose base path is `join(targetReposDir, owner, repo)`.
 * When `targetRepo` is null, builds a SELF-HOST context whose base path is
 * `frameworkRepoRoot`, with owner/repo taken from the local git remote via
 * `deps.getRepoInfo()`.
 *
 * Note: if `--target-repo` is supplied pointing to the framework repo itself,
 * the discriminator is `--target-repo` PRESENCE, so it is treated as a target
 * context (basePath under targetReposDir), consistent with buildRepoIdentifier.
 *
 * Ensures process-global auth is set for not-yet-migrated gh calls on this path
 * by calling ensureAppAuthForRepo (idempotent; no-op when App not configured).
 * Per-command auth cutover (story 7) is a later slice.
 *
 * Call this exactly once at each process launch boundary. Thread the returned
 * context downward — do not call downstream code to re-derive the repo root.
 *
 * @param targetRepo - Parsed --target-repo info, or null for self-host
 * @param deps - Injectable seams (all optional; production defaults applied)
 */
export function buildLaunchGitContext(
  targetRepo: TargetRepoInfo | null,
  deps: LaunchGitContextDeps = {},
): GitContext {
  const getInfo = deps.getRepoInfo ?? getRepoInfo;
  const resolveToken = deps.resolveToken ?? resolveLaunchToken;
  const resolveIdentity = deps.resolveGitIdentity ?? resolveLaunchGitIdentity;
  const frameworkRepoRoot = deps.frameworkRepoRoot ?? REPO_ROOT;
  const targetReposDir = deps.targetReposDir ?? TARGET_REPOS_DIR;

  const selfHost = targetRepo === null;
  const { owner, repo } = targetRepo ?? getInfo();

  // Ensure process-global auth is set for not-yet-migrated gh calls on this path.
  // Idempotent; no-op when App not configured. Per-command auth cutover is story 7.
  ensureAppAuthForRepo(owner, repo);

  return new GitContext({
    owner,
    repo,
    selfHost,
    token: resolveToken(owner, repo),
    gitIdentity: resolveIdentity(),
    frameworkRepoRoot,
    targetReposDir,
  });
}
