/**
 * GitHub clone-URL construction (issue #793, PRD story 14) — the HTTPS→SSH
 * rewrite the core used to apply silently. ADW's wiring layer
 * (`adws/core/targetRepoManager.ts`) calls this before handing the core a
 * clone URL; the core itself clones exactly what it is given.
 */

import { parseGitHubRemoteUrl } from './githubIdentity';

/**
 * Converts an HTTPS GitHub clone URL to SSH format.
 * Non-HTTPS URLs (e.g., already SSH, another forge, empty) are returned unchanged.
 */
export function convertToSshUrl(cloneUrl: string): string {
  if (!cloneUrl.startsWith('https://github.com/')) return cloneUrl;
  const info = parseGitHubRemoteUrl(cloneUrl);
  if (!info) return cloneUrl;
  return `git@github.com:${info.owner}/${info.repo}.git`;
}
