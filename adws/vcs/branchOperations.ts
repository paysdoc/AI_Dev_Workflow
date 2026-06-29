/**
 * Pure branch-identity vocabulary — branch name generation and validation.
 * Write/sync I/O operations have migrated to GitContext methods (#662).
 * The two read-only local helpers below remain for the worktree-domain files
 * (#661 scope) that cannot yet adopt the context pattern.
 */

import { IssueClassSlashCommand, branchPrefixMap, branchPrefixAliases } from '../core';
import { gitContextForRepo, readLocalRepoInfo } from '../github/gitContextFactory';

/**
 * Protected branches that must never be deleted.
 */
export const PROTECTED_BRANCHES = ['main', 'master', 'develop'];

/**
 * Validates a slug for branch-name assembly.
 *
 * A valid slug is: non-empty, lowercase, [a-z0-9-] only, no leading/trailing
 * hyphens, no consecutive hyphens, ≤ 50 characters, no known branch prefix
 * (canonical or alias), no "issue-<N>" segment, no path separators, and no
 * forbidden git-ref characters.
 *
 * Throws with an operator-legible message on any violation.
 */
export function validateSlug(slug: string): string {
  if (!slug || slug.trim() === '') {
    throw new Error('Slug is empty');
  }

  if (slug.includes('/') || slug.includes('\\')) {
    throw new Error(`Slug contains forbidden path separator: "${slug}"`);
  }

  if (/[~^:*?[\]@{}\\`]/.test(slug) || slug.includes('..')) {
    throw new Error(`Slug contains forbidden git-ref characters: "${slug}"`);
  }

  if (!/^[a-z0-9-]+$/.test(slug)) {
    throw new Error(`Slug contains forbidden characters (only a-z, 0-9, and hyphens allowed): "${slug}"`);
  }

  if (slug.startsWith('-') || slug.endsWith('-')) {
    throw new Error(`Slug must not start or end with a hyphen: "${slug}"`);
  }

  if (slug.includes('--')) {
    throw new Error(`Slug must not contain consecutive hyphens: "${slug}"`);
  }

  if (slug.length > 50) {
    throw new Error(`Slug exceeds 50 characters (length=${slug.length}): "${slug}"`);
  }

  // Reject a slug that re-embeds the canonical type prefix, but ONLY in the
  // unambiguous shapes: the slug IS a prefix, or it carries the prefix + the
  // `-issue-` anchor (`review-issue-...`). A bare `${prefix}-<word>` is NOT
  // rejected — content words legitimately start with a prefix token
  // (e.g. "review-failed", "test-harness", "fix-flaky") and the assembled
  // branch is anchored on `-issue-<N>-`, so a leading prefix word never breaks
  // branchMatchesIssue / deterministicBranchName parsing.
  const canonicalPrefixes = Object.values(branchPrefixMap);
  const aliasPrefixes = Object.values(branchPrefixAliases).flat() as string[];
  const forbiddenPrefixes = [...new Set([...canonicalPrefixes, ...aliasPrefixes])];

  for (const prefix of forbiddenPrefixes) {
    if (slug === prefix || slug.startsWith(`${prefix}-issue-`)) {
      throw new Error(`Slug already contains a forbidden prefix "${prefix}": "${slug}"`);
    }
  }

  if (/issue-\d+/.test(slug)) {
    throw new Error(`Slug must not contain "issue-<number>" segment: "${slug}"`);
  }

  return slug;
}

/**
 * Assembles a canonical branch name from issue type, number, and slug.
 * Format: <prefix>-issue-<issueNumber>-<slug> (hyphen-separated).
 *
 * The slug is validated before assembly — any drift in LLM output is caught here
 * and throws rather than propagating a malformed branch name.
 *
 * @param issueNumber - The GitHub issue number
 * @param slug - A pre-validated slug (lowercase, hyphens only, no prefix, no issue number)
 * @param issueType - The issue classification (defaults to '/feature')
 * @returns Canonical branch name, e.g. "feature-issue-42-add-user-auth"
 */
export function generateBranchName(
  issueNumber: number,
  slug: string,
  issueType: IssueClassSlashCommand = '/feature'
): string {
  const validatedSlug = validateSlug(slug);
  const prefix = branchPrefixMap[issueType];
  return `${prefix}-issue-${issueNumber}-${validatedSlug}`;
}

/**
 * Infers the issue type from a branch name by examining its prefix.
 * Maps branch prefixes to issue classification:
 *   - bugfix/ -> /bug
 *   - chore/ -> /chore
 *   - review/ -> /pr_review
 *   - feature/ (or unknown) -> /feature
 *
 * @param branchName - The branch name to parse (e.g., "bugfix/issue-123-fix-login")
 * @returns The inferred issue type classification
 */
export function inferIssueTypeFromBranch(branchName: string): IssueClassSlashCommand {
  if (branchName.startsWith('bugfix/') || branchName.startsWith('bugfix-')) {
    return '/bug';
  }
  if (branchName.startsWith('chore/') || branchName.startsWith('chore-')) {
    return '/chore';
  }
  if (branchName.startsWith('review/') || branchName.startsWith('review-')) {
    return '/pr_review';
  }
  return '/feature';
}

/**
 * Returns the default branch from the GitHub API.
 * Thin adapter: routes through GitContext.defaultBranch() so auth and cwd are per-command.
 */
export function getDefaultBranch(cwd?: string): string {
  return gitContextForRepo(readLocalRepoInfo(cwd)).defaultBranch();
}
