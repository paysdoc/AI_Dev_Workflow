/**
 * ADW Build Helper Functions
 *
 * Contains CLI helper functions extracted from adwBuild.tsx:
 * - printUsageAndExit
 * - parseArguments
 * - printBuildSummary
 */

import { log } from './core';

/**
 * Prints usage information and exits.
 */
export function printUsageAndExit(): never {
  console.error('Usage: npx tsx adws/adwBuild.tsx <github-issueNumber> [adw-id] [--cwd <path>]');
  console.error('');
  console.error('Options:');
  console.error('  --cwd <path>       Working directory for git operations (worktree path)');
  console.error('');
  console.error('Prerequisites:');
  console.error('  - Must be on a feature/bugfix/chore branch');
  console.error('  - Plan file must exist at specs/issue-{number}.md');
  console.error('');
  console.error('Environment Requirements:');
  console.error('  ANTHROPIC_API_KEY  - Anthropic API key');
  console.error('  CLAUDE_CODE_PATH   - Path to Claude CLI (default: /usr/local/bin/claude)');
  console.error('  GITHUB_PAT         - (Optional) GitHub Personal Access Token');
  process.exit(1);
}

/**
 * Parses and validates command line arguments.
 */
export function parseArguments(args: string[]): { issueNumber: number; providedAdwId: string | null; cwd: string | null } {
  if (args.length < 1) {
    printUsageAndExit();
  }

  // Parse --cwd option
  let cwd: string | null = null;
  const cwdIndex = args.indexOf('--cwd');
  if (cwdIndex !== -1 && args[cwdIndex + 1]) {
    cwd = args[cwdIndex + 1];
    args.splice(cwdIndex, 2);
  }

  const issueNumber = parseInt(args[0], 10);
  if (isNaN(issueNumber)) {
    console.error(`Invalid issue number: ${args[0]}`);
    process.exit(1);
  }

  const providedAdwId = args[1] || null;

  return { issueNumber, providedAdwId, cwd };
}

/**
 * Prints the build phase summary.
 */
export function printBuildSummary(
  issueNumber: number,
  issueTitle: string,
  branchName: string,
  logsDir: string,
  prUrl: string,
  costUsd: number
): void {
  log('===================================', 'info');
  log('ADW Build workflow completed!', 'success');
  log(`Issue: #${issueNumber} - ${issueTitle}`, 'info');
  log(`Branch: ${branchName}`, 'info');

  if (prUrl) {
    log(`PR: ${prUrl}`, 'info');
  }

  log(`Logs: ${logsDir}`, 'info');

  if (costUsd > 0) {
    log(`Cost: $${costUsd.toFixed(4)}`, 'info');
  }

  log('===================================', 'info');
}
