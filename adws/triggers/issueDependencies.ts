/**
 * Issue dependency parser and resolver.
 *
 * Parses `## Dependencies` sections from issue bodies, extracts issue references,
 * and resolves their open/closed state via the GitHub API.
 */

import { getIssueState } from '../github/issueApi';
import type { RepoInfo } from '../github/githubApi';

/**
 * Parses issue dependency numbers from the `## Dependencies` section of an issue body.
 * Supports `#N` references and full GitHub issue URLs.
 * Returns a deduplicated array of issue numbers.
 */
export function parseDependencies(issueBody: string): number[] {
  if (!issueBody) return [];

  // Find the ## Dependencies or ## Depends on heading (case-insensitive)
  const headingPattern = /^## (?:dependencies|depends on)\b/im;
  const headingMatch = issueBody.match(headingPattern);
  if (!headingMatch || headingMatch.index === undefined) return [];

  // Extract the section content until the next ## heading or end of text
  const sectionStart = headingMatch.index + headingMatch[0].length;
  const nextHeadingMatch = issueBody.slice(sectionStart).match(/^## /m);
  const sectionEnd = nextHeadingMatch?.index !== undefined
    ? sectionStart + nextHeadingMatch.index
    : issueBody.length;

  const section = issueBody.slice(sectionStart, sectionEnd);

  const issueNumbers = new Set<number>();

  // Match #N references (must be positive integers)
  for (const match of section.matchAll(/#(\d+)/g)) {
    const num = parseInt(match[1], 10);
    if (num > 0) issueNumbers.add(num);
  }

  // Match full GitHub issue URLs
  for (const match of section.matchAll(/https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/(\d+)/g)) {
    const num = parseInt(match[1], 10);
    if (num > 0) issueNumbers.add(num);
  }

  return [...issueNumbers];
}

/**
 * Finds open (blocking) dependencies for an issue.
 * Calls `getIssueState()` for each dependency to check if it is still open.
 * Does NOT resolve transitive dependencies.
 */
export async function findOpenDependencies(issueBody: string, repoInfo: RepoInfo): Promise<number[]> {
  const deps = parseDependencies(issueBody);
  if (deps.length === 0) return [];

  const openDeps: number[] = [];
  for (const dep of deps) {
    try {
      const state = getIssueState(dep, repoInfo);
      if (state === 'OPEN') {
        openDeps.push(dep);
      }
    } catch {
      // If we can't check the state, skip this dependency
    }
  }

  return openDeps;
}
