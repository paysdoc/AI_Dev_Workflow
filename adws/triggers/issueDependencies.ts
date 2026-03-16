/**
 * Issue dependency parser and resolver.
 *
 * Parses `## Dependencies` sections from issue bodies, extracts issue references,
 * and resolves their open/closed state via the GitHub API.
 *
 * Primary extraction uses LLM-based analysis via `runDependencyExtractionAgent`,
 * with regex-based parsing as a fast-path fallback on failure.
 */

import { getIssueState } from '../github/issueApi';
import type { RepoInfo } from '../github/githubApi';
import { log } from '../core';
import { runDependencyExtractionAgent } from '../agents/dependencyExtractionAgent';

/**
 * Parses issue dependency numbers from the `## Dependencies` section of an issue body.
 * Supports `#N` references and full GitHub issue URLs.
 * Returns a deduplicated array of issue numbers.
 *
 * Used as a fallback when LLM-based extraction fails.
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
 * Extracts dependency issue numbers from an issue body using LLM-based analysis.
 * Falls back to regex-based `parseDependencies` if the LLM call fails or returns empty.
 *
 * @param issueBody - Raw issue body text to analyze
 * @param logsDir - Directory to write agent logs
 * @param statePath - Optional path to agent's state directory for state tracking
 * @param cwd - Optional working directory for the agent
 */
export async function extractDependencies(
  issueBody: string,
  logsDir: string,
  statePath?: string,
  cwd?: string,
): Promise<number[]> {
  try {
    const result = await runDependencyExtractionAgent(issueBody, logsDir, statePath, cwd);
    if (result.success && result.dependencies.length > 0) {
      return result.dependencies;
    }
    log('LLM dependency extraction returned empty result, falling back to regex parser', 'warn');
  } catch (err) {
    log(`LLM dependency extraction failed: ${err}, falling back to regex parser`, 'warn');
  }
  return parseDependencies(issueBody);
}

/**
 * Finds open (blocking) dependencies for an issue.
 * Calls `getIssueState()` for each dependency to check if it is still open.
 * Does NOT resolve transitive dependencies.
 *
 * Uses LLM-based extraction first, with regex parsing as a fallback.
 *
 * @param issueBody - Raw issue body text to analyze
 * @param repoInfo - GitHub repository context for checking issue states
 * @param logsDir - Directory to write agent logs (default: 'logs')
 * @param statePath - Optional path to agent's state directory for state tracking
 * @param cwd - Optional working directory for the agent
 */
export async function findOpenDependencies(
  issueBody: string,
  repoInfo: RepoInfo,
  logsDir: string = 'logs',
  statePath?: string,
  cwd?: string,
): Promise<number[]> {
  const deps = await extractDependencies(issueBody, logsDir, statePath, cwd);

  if (deps.length === 0) {
    log('No dependencies found, skipping dependency check');
    return [];
  }

  log(`Checking dependencies: found ${deps.length} dependency(ies) to resolve`);

  const openDeps: number[] = [];
  for (const dep of deps) {
    try {
      const state = getIssueState(dep, repoInfo);
      log(`Dependency #${dep}: ${state}`);
      if (state === 'OPEN') {
        openDeps.push(dep);
      }
    } catch (err) {
      log(`Failed to check state of dependency #${dep}: ${err}`, 'warn');
    }
  }

  const summary = openDeps.length > 0
    ? `Dependency check complete: ${openDeps.length} open dependency(ies) found (${openDeps.map(n => `#${n}`).join(', ')})`
    : `Dependency check complete: 0 open dependency(ies) found`;
  log(summary);

  return openDeps;
}
