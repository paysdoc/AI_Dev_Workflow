/**
 * Issue dependency parser and resolver.
 *
 * Parses `## Dependencies` sections from issue bodies, extracts issue references,
 * and resolves their open/closed state via the GitHub API.
 *
 * Extraction order:
 * 1. In-memory cache (keyed by issueNumber + body hash) — instant
 * 2. Keyword proximity parsing (no LLM) — fast
 * 3. LLM-based extraction — only when proximity parse found fewer refs than total #N refs
 *
 * This eliminates unnecessary LLM calls on every 20s poll cycle.
 */

import { createHash } from 'crypto';
import { getIssueState } from '../github/issueApi';
import type { RepoInfo } from '../github/githubApi';
import { log } from '../core';
import { runDependencyExtractionAgent } from '../agents/dependencyExtractionAgent';

/** Dependency keywords that indicate a preceding #N reference is a blocking dependency. */
const DEPENDENCY_KEYWORDS = [
  'blocked by',
  'depends on',
  'requires',
  'prerequisite',
  'waiting on',
  'after',
];

/** In-memory cache: key = `${issueNumber}:${bodyHash}` → dependency numbers. */
const dependencyCache = new Map<string, number[]>();

/** Computes a short hash of the issue body for cache keying. */
function hashBody(body: string): string {
  return createHash('sha1').update(body).digest('hex').slice(0, 12);
}

/**
 * Parses issue dependency numbers from the `## Dependencies` or `## Blocked by` section.
 * Supports `#N` references and full GitHub issue URLs.
 * Returns a deduplicated array of issue numbers.
 *
 * Used as a fallback when LLM-based extraction fails.
 */
export function parseDependencies(issueBody: string): number[] {
  if (!issueBody) return [];

  // Find the ## Dependencies, ## Depends on, or ## Blocked by heading (case-insensitive)
  const headingPattern = /^## (?:dependencies|depends on|blocked by)\b/im;
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
 * Parses dependency issue numbers from the entire issue body using keyword proximity.
 * Looks for `#N` references preceded (within 10 words) by a dependency keyword.
 * Also handles the `## Blocked by` heading section.
 *
 * Returns a deduplicated array of issue numbers.
 */
export function parseKeywordProximityDependencies(issueBody: string): number[] {
  if (!issueBody) return [];

  const issueNumbers = new Set<number>();

  // Include heading-based dependencies
  for (const n of parseDependencies(issueBody)) {
    issueNumbers.add(n);
  }

  // Keyword proximity: find all #N references in the full body
  const refPattern = /#(\d+)/g;
  let refMatch: RegExpExecArray | null;

  while ((refMatch = refPattern.exec(issueBody)) !== null) {
    const num = parseInt(refMatch[1], 10);
    if (num <= 0) continue;

    // Look back up to 80 chars (≈ 10 words) before this reference for a keyword
    const lookbackStart = Math.max(0, refMatch.index - 80);
    const lookback = issueBody.slice(lookbackStart, refMatch.index).toLowerCase();

    if (DEPENDENCY_KEYWORDS.some(kw => lookback.includes(kw))) {
      issueNumbers.add(num);
    }
  }

  return [...issueNumbers];
}

/**
 * Extracts dependency issue numbers from an issue body.
 *
 * Strategy:
 * 1. Check in-memory cache.
 * 2. Try keyword proximity parsing (no LLM).
 * 3. If proximity found fewer deps than total #N refs in body, fall back to LLM.
 *
 * @param issueBody - Raw issue body text to analyze
 * @param logsDir - Directory to write agent logs
 * @param statePath - Optional path to agent's state directory for state tracking
 * @param cwd - Optional working directory for the agent
 * @param issueNumber - Optional issue number for cache keying
 */
export async function extractDependencies(
  issueBody: string,
  logsDir: string,
  statePath?: string,
  cwd?: string,
  issueNumber?: number,
): Promise<number[]> {
  // Cache check
  const cacheKey = `${issueNumber ?? '?'}:${hashBody(issueBody)}`;
  const cached = dependencyCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  // Fast path: keyword proximity
  const proximityDeps = parseKeywordProximityDependencies(issueBody);

  // Count total #N references to decide if LLM fallback is needed
  const totalRefs = (issueBody.match(/#\d+/g) ?? []).length;
  const needsLlm = totalRefs > 0 && proximityDeps.length < totalRefs;

  if (!needsLlm) {
    dependencyCache.set(cacheKey, proximityDeps);
    return proximityDeps;
  }

  // LLM fallback
  try {
    const result = await runDependencyExtractionAgent(issueBody, logsDir, statePath, cwd);
    if (result.success && result.dependencies.length > 0) {
      dependencyCache.set(cacheKey, result.dependencies);
      return result.dependencies;
    }
    log('LLM dependency extraction returned empty result, falling back to proximity parser', 'warn');
  } catch (err) {
    log(`LLM dependency extraction failed: ${err}, falling back to proximity parser`, 'warn');
  }

  dependencyCache.set(cacheKey, proximityDeps);
  return proximityDeps;
}

/**
 * Finds open (blocking) dependencies for an issue.
 * Calls `getIssueState()` for each dependency to check if it is still open.
 * Does NOT resolve transitive dependencies.
 *
 * @param issueBody - Raw issue body text to analyze
 * @param repoInfo - GitHub repository context for checking issue states
 * @param logsDir - Directory to write agent logs (default: 'logs')
 * @param statePath - Optional path to agent's state directory for state tracking
 * @param cwd - Optional working directory for the agent
 * @param issueNumber - Optional issue number for cache keying
 */
export async function findOpenDependencies(
  issueBody: string,
  repoInfo: RepoInfo,
  logsDir: string = 'logs',
  statePath?: string,
  cwd?: string,
  issueNumber?: number,
): Promise<number[]> {
  const deps = await extractDependencies(issueBody, logsDir, statePath, cwd, issueNumber);

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
