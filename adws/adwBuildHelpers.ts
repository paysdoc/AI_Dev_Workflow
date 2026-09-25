import { log } from './core';
import { parseOrchestratorArguments } from './core/orchestratorCli';

/** Returns 0 if the URL is absent or unparseable. */
export function extractPrNumber(prUrl: string | undefined): number {
  if (!prUrl) return 0;
  const parts = prUrl.split('/pull/');
  if (parts.length < 2) return 0;
  const n = parseInt(parts[1], 10);
  return isNaN(n) ? 0 : n;
}

export function parseArguments(args: string[]): { issueNumber: number; providedAdwId: string | null; cwd: string | null } {
  const { issueNumber, adwId, cwd } = parseOrchestratorArguments(args, {
    scriptName: 'adwBuild.tsx',
    usagePattern: '<github-issueNumber> [adw-id] [--cwd <path>]',
    supportsIssueType: false,
  });
  return { issueNumber, providedAdwId: adwId, cwd };
}

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
