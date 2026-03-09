/**
 * ADW Build Helper Functions
 *
 * Contains CLI helper functions for adwBuild.tsx:
 * - parseArguments (delegates to shared orchestratorCli)
 * - printBuildSummary
 */

import { log } from './core';
import { parseOrchestratorArguments } from './core/orchestratorCli';

/**
 * Parses and validates build command line arguments.
 */
export function parseArguments(args: string[]): { issueNumber: number; providedAdwId: string | null; cwd: string | null } {
  const { issueNumber, adwId, cwd } = parseOrchestratorArguments(args, {
    scriptName: 'adwBuild.tsx',
    usagePattern: '<github-issueNumber> [adw-id] [--cwd <path>]',
    supportsIssueType: false,
  });
  return { issueNumber, providedAdwId: adwId, cwd };
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
