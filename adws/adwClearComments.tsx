#!/usr/bin/env bunx tsx
/**
 * ADW Clear Comments Script
 *
 * Removes all comments from a GitHub issue.
 * Useful for resetting an issue when a workflow has gone wrong.
 *
 * Usage: bunx tsx adws/adwClearComments.tsx <issueNumber>
 */

import { log, buildLaunchBoundary } from './core';
import type { IssueTracker } from './providers/types';
import type { TargetRepoInfo } from './types/issueTypes';

interface ClearCommentsResult {
  total: number;
  deleted: number;
  failed: number;
  issueTitle: string;
}

/** The tracker surface `clearIssueComments` needs — a bound provider, no repository parameter to get wrong. */
export type CommentClearingTracker = Pick<IssueTracker, 'fetchComments' | 'getIssueTitle' | 'deleteComment'>;

/**
 * Prints usage information and exits.
 */
function printUsageAndExit(): never {
  console.error('Usage: bunx tsx adws/adwClearComments.tsx <issueNumber> [--repo owner/repo]');
  console.error('');
  console.error('Removes all comments from a GitHub issue.');
  console.error('');
  console.error('Arguments:');
  console.error('  issueNumber      - GitHub issue number to clear comments from');
  console.error('  --repo owner/repo - Optional target repository (defaults to local git remote)');
  process.exit(1);
}

/**
 * Parses and validates the issue number and optional repo from CLI arguments.
 */
function parseArguments(args: string[]): { issueNumber: number; targetRepo: TargetRepoInfo | null } {
  if (args.length < 1) {
    printUsageAndExit();
  }

  const issueNumber = parseInt(args[0], 10);
  if (isNaN(issueNumber) || issueNumber <= 0) {
    console.error(`Invalid issue number: ${args[0]}`);
    process.exit(1);
  }

  let targetRepo: TargetRepoInfo | null = null;
  const repoIndex = args.indexOf('--repo');
  if (repoIndex !== -1 && args[repoIndex + 1]) {
    const fullName = args[repoIndex + 1];
    const parts = fullName.split('/');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new Error(`Invalid repository full name: ${fullName}`);
    }
    targetRepo = { owner: parts[0], repo: parts[1], cloneUrl: `https://github.com/${parts[0]}/${parts[1]}.git` };
  }

  return { issueNumber, targetRepo };
}

/**
 * Fetches all comments on an issue and deletes them sequentially.
 * Continues deleting even if individual deletions fail.
 * @param issueNumber - The issue number to clear comments from
 * @param tracker - The bound issue tracker to clear comments through
 */
export function clearIssueComments(issueNumber: number, tracker: CommentClearingTracker): ClearCommentsResult {
  const comments = tracker.fetchComments(issueNumber);
  const issueTitle = tracker.getIssueTitle(issueNumber);

  if (comments.length === 0) {
    log(`No comments found on issue #${issueNumber} ("${issueTitle}")`, 'info');
    return { total: 0, deleted: 0, failed: 0, issueTitle };
  }

  log(`Found ${comments.length} comment(s) on issue #${issueNumber} ("${issueTitle}")`, 'info');

  let deleted = 0;
  let failed = 0;

  for (const comment of comments) {
    try {
      log(`Deleting comment ${comment.id}: "${comment.body.substring(0, 10)}..."`, 'info');
      tracker.deleteComment(comment.id);
      deleted++;
    } catch (error) {
      log(`Failed to delete comment ${comment.id}: ${error}`, 'error');
      failed++;
    }
  }

  return { total: comments.length, deleted, failed, issueTitle };
}

/**
 * Main entry point.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const { issueNumber, targetRepo } = parseArguments(args);

  log(`Clearing all comments from issue #${issueNumber}...`, 'info');

  const boundary = buildLaunchBoundary(targetRepo);
  const result = clearIssueComments(issueNumber, boundary.providers.issueTracker);

  log(`Summary: ${result.deleted}/${result.total} deleted, ${result.failed} failed`, 'info');

  process.exit(result.failed > 0 ? 1 : 0);
}

const isDirectExecution = process.argv[1]?.includes('adwClearComments');
if (isDirectExecution) {
  main();
}
