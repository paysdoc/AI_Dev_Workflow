#!/usr/bin/env npx tsx
/**
 * ADW Clear Comments Script
 *
 * Removes all comments from a GitHub issue.
 * Useful for resetting an issue when a workflow has gone wrong.
 *
 * Usage: npx tsx adws/adwClearComments.tsx <issueNumber>
 */

import { log } from './core';
import { fetchIssueCommentsRest, deleteIssueComment } from './github';

interface ClearCommentsResult {
  total: number;
  deleted: number;
  failed: number;
}

/**
 * Prints usage information and exits.
 */
function printUsageAndExit(): never {
  console.error('Usage: npx tsx adws/adwClearComments.tsx <issueNumber>');
  console.error('');
  console.error('Removes all comments from a GitHub issue.');
  console.error('');
  console.error('Arguments:');
  console.error('  issueNumber  - GitHub issue number to clear comments from');
  process.exit(1);
}

/**
 * Parses and validates the issue number from CLI arguments.
 */
function parseArguments(args: string[]): { issueNumber: number } {
  if (args.length < 1) {
    printUsageAndExit();
  }

  const issueNumber = parseInt(args[0], 10);
  if (isNaN(issueNumber) || issueNumber <= 0) {
    console.error(`Invalid issue number: ${args[0]}`);
    process.exit(1);
  }

  return { issueNumber };
}

/**
 * Fetches all comments on an issue and deletes them sequentially.
 * Continues deleting even if individual deletions fail.
 */
export function clearIssueComments(issueNumber: number): ClearCommentsResult {
  const comments = fetchIssueCommentsRest(issueNumber);

  if (comments.length === 0) {
    log(`No comments found on issue #${issueNumber}`, 'info');
    return { total: 0, deleted: 0, failed: 0 };
  }

  log(`Found ${comments.length} comment(s) on issue #${issueNumber}`, 'info');

  let deleted = 0;
  let failed = 0;

  for (const comment of comments) {
    try {
      deleteIssueComment(comment.id);
      deleted++;
    } catch (error) {
      log(`Failed to delete comment ${comment.id}: ${error}`, 'error');
      failed++;
    }
  }

  return { total: comments.length, deleted, failed };
}

/**
 * Main entry point.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const { issueNumber } = parseArguments(args);

  log(`Clearing all comments from issue #${issueNumber}...`, 'info');

  const result = clearIssueComments(issueNumber);

  log(`Summary: ${result.deleted}/${result.total} deleted, ${result.failed} failed`, 'info');

  process.exit(result.failed > 0 ? 1 : 0);
}

const isDirectExecution = process.argv[1]?.includes('adwClearComments');
if (isDirectExecution) {
  main();
}
