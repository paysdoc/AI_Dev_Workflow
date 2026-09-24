/**
 * Extraction order:
 * 1. In-memory cache (keyed by issueNumber + body hash) — instant
 * 2. Keyword proximity parsing (no LLM) — fast
 * 3. LLM-based extraction — only when proximity parse found fewer refs than total #N refs
 *
 * This eliminates unnecessary LLM calls on every 20s poll cycle.
 */

import { createHash } from 'crypto';
import type { IssueTracker } from '@paysdoc/devplatform';
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

function hashBody(body: string): string {
  return createHash('sha1').update(body).digest('hex').slice(0, 12);
}

/** Used as a fallback when LLM-based extraction fails. */
export function parseDependencies(issueBody: string): number[] {
  if (!issueBody) return [];

  const headingPattern = /^## (?:dependencies|depends on|blocked by)\b/im;
  const headingMatch = issueBody.match(headingPattern);
  if (!headingMatch || headingMatch.index === undefined) return [];

  const sectionStart = headingMatch.index + headingMatch[0].length;
  const nextHeadingMatch = issueBody.slice(sectionStart).match(/^## /m);
  const sectionEnd = nextHeadingMatch?.index !== undefined
    ? sectionStart + nextHeadingMatch.index
    : issueBody.length;

  const section = issueBody.slice(sectionStart, sectionEnd);

  const issueNumbers = new Set<number>();

  for (const match of section.matchAll(/#(\d+)/g)) {
    const num = parseInt(match[1], 10);
    if (num > 0) issueNumbers.add(num);
  }

  for (const match of section.matchAll(/https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/(\d+)/g)) {
    const num = parseInt(match[1], 10);
    if (num > 0) issueNumbers.add(num);
  }

  return [...issueNumbers];
}

/**
 * Looks for `#N` references preceded (within 10 words) by a dependency keyword.
 * Also handles the `## Blocked by` heading section.
 */
export function parseKeywordProximityDependencies(issueBody: string): number[] {
  if (!issueBody) return [];

  const issueNumbers = new Set<number>();

  for (const n of parseDependencies(issueBody)) {
    issueNumbers.add(n);
  }

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

export async function extractDependencies(
  issueBody: string,
  logsDir: string,
  statePath?: string,
  cwd?: string,
  issueNumber?: number,
): Promise<number[]> {
  const cacheKey = `${issueNumber ?? '?'}:${hashBody(issueBody)}`;
  const cached = dependencyCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const proximityDeps = parseKeywordProximityDependencies(issueBody);

  // Count total #N references to decide if LLM fallback is needed
  const totalRefs = (issueBody.match(/#\d+/g) ?? []).length;
  const needsLlm = totalRefs > 0 && proximityDeps.length < totalRefs;

  if (!needsLlm) {
    dependencyCache.set(cacheKey, proximityDeps);
    return proximityDeps;
  }

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

/** Does NOT resolve transitive dependencies. */
export async function findOpenDependencies(
  issueBody: string,
  tracker: Pick<IssueTracker, 'getIssueState'>,
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
      const state = tracker.getIssueState(dep);
      log(`Dependency #${dep}: ${state}`);
      if (state === 'OPEN') {
        openDeps.push(dep);
      }
    } catch (err) {
      log(`Failed to check state of dependency #${dep}, treating as OPEN (fail-closed): ${err}`, 'warn');
      openDeps.push(dep);
    }
  }

  const summary = openDeps.length > 0
    ? `Dependency check complete: ${openDeps.length} open dependency(ies) found (${openDeps.map(n => `#${n}`).join(', ')})`
    : `Dependency check complete: 0 open dependency(ies) found`;
  log(summary);

  return openDeps;
}
