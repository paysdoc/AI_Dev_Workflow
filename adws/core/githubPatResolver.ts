/**
 * GitHub PAT resolver — supports multiple comma-separated PATs.
 *
 * Parses GITHUB_PAT as a comma-separated list, tests each token against
 * a target repository, and returns the first one with access.
 */

import { execSync } from 'child_process';
import { log } from './utils';

/**
 * Splits the raw GITHUB_PAT env var by commas, trims whitespace,
 * and filters empty strings.
 */
export function parseGitHubPats(rawPat: string | undefined): string[] {
  if (!rawPat) return [];
  return rawPat
    .split(',')
    .map(t => t.trim())
    .filter(Boolean);
}

/**
 * Masks a token for safe logging — shows only the last 4 characters.
 */
function maskToken(pat: string): string {
  if (pat.length <= 4) return '****';
  return `...${pat.slice(-4)}`;
}

/**
 * Tests if a PAT has access to a specific repo by calling
 * `gh api repos/{owner}/{repo} --jq .full_name` with the PAT set as GH_TOKEN.
 */
export function testPatAccess(pat: string, owner: string, repo: string): boolean {
  try {
    execSync(`gh api repos/${owner}/${repo} --jq .full_name`, {
      stdio: 'pipe',
      env: { ...process.env, GH_TOKEN: pat },
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Tests repo access without any PAT (relying on `gh auth login`).
 */
export function testRepoAccessWithoutPat(owner: string, repo: string): boolean {
  try {
    const env = { ...process.env };
    delete env.GH_TOKEN;
    execSync(`gh api repos/${owner}/${repo} --jq .full_name`, {
      stdio: 'pipe',
      env,
    });
    return true;
  } catch {
    return false;
  }
}

export interface PatResolution {
  pat: string | null;
  method: 'pat' | 'gh_auth' | 'none';
}

/**
 * Resolves the correct GitHub PAT for a given repository.
 *
 * 1. Parses GITHUB_PAT (or GITHUB_PERSONAL_ACCESS_TOKEN) as comma-separated list.
 * 2. Tests each PAT against the repo; returns the first working one.
 * 3. Falls back to `gh auth login` if no PAT works.
 * 4. Returns `method: 'none'` if the repo is completely inaccessible.
 */
export function resolveGitHubPat(owner: string, repo: string): PatResolution {
  const pats = parseGitHubPats(
    process.env.GITHUB_PAT || process.env.GITHUB_PERSONAL_ACCESS_TOKEN,
  );

  if (pats.length > 0) {
    log(`Testing ${pats.length} GitHub PAT(s) against ${owner}/${repo}...`, 'info');
    for (const pat of pats) {
      log(`Testing PAT ${maskToken(pat)} against ${owner}/${repo}...`, 'info');
      if (testPatAccess(pat, owner, repo)) {
        return { pat, method: 'pat' };
      }
    }
  }

  // No PATs worked (or none configured) — try gh auth login
  if (testRepoAccessWithoutPat(owner, repo)) {
    return { pat: null, method: 'gh_auth' };
  }

  return { pat: null, method: 'none' };
}
