/**
 * Webhook gatekeeper functions.
 *
 * Handles eligibility checking, dependency unblocking on issue close,
 * classify-and-spawn workflow, and cron process management.
 */

import { spawn, execSync } from 'child_process';
import { log, generateAdwId } from '../core';
import type { RepoInfo } from '../github/githubApi';
import { getRepoInfo } from '../github';
import { classifyIssueForTrigger, getWorkflowScript } from '../core/issueClassifier';

import { checkIssueEligibility } from './issueEligibility';
import { parseDependencies } from './issueDependencies';

/**
 * Spawns a detached child process for running ADW orchestrator workflows.
 */
export function spawnDetached(command: string, args: string[]): void {
  log(`Spawning: ${command} ${args.join(' ')}`);
  const child = spawn(command, args, {
    detached: true,
    stdio: 'inherit',
  });
  child.unref();
}

/**
 * Classifies and spawns a workflow for an eligible issue.
 */
export async function classifyAndSpawnWorkflow(
  issueNumber: number,
  repoInfo: RepoInfo | undefined,
  targetRepoArgs: string[],
): Promise<void> {
  const resolvedRepoInfo = repoInfo ?? getRepoInfo();
  const classification = await classifyIssueForTrigger(issueNumber, resolvedRepoInfo);
  const workflowScript = getWorkflowScript(classification.issueType, classification.adwCommand);
  const adwId = classification.adwId || generateAdwId(classification.issueTitle);

  log(`Issue #${issueNumber} classified as ${classification.issueType}, spawning ${workflowScript}`, 'success');
  spawnDetached('bunx', ['tsx', workflowScript, String(issueNumber), adwId, '--issue-type', classification.issueType, ...targetRepoArgs]);
}

/**
 * Handles the `issues.closed` event for dependency unblocking.
 * Finds open issues that depend on the closed issue and re-evaluates eligibility.
 */
export async function handleIssueClosedDependencyUnblock(
  closedIssueNumber: number,
  repoInfo: RepoInfo,
  targetRepoArgs: string[],
): Promise<void> {
  try {
    const json = execSync(
      `gh issue list --repo ${repoInfo.owner}/${repoInfo.repo} --state open --json number,body --limit 100`,
      { encoding: 'utf-8' },
    );
    const issues = JSON.parse(json) as { number: number; body: string }[];

    const dependents = issues.filter((issue) => {
      const deps = parseDependencies(issue.body || '');
      return deps.includes(closedIssueNumber);
    });

    if (dependents.length === 0) {
      log(`No issues depend on closed issue #${closedIssueNumber}`);
      return;
    }

    log(`Found ${dependents.length} issue(s) depending on closed issue #${closedIssueNumber}`);

    for (const dependent of dependents) {
      const eligibility = await checkIssueEligibility(dependent.number, dependent.body || '', repoInfo);
      if (eligibility.eligible) {
        log(`Issue #${dependent.number} unblocked by closure of #${closedIssueNumber}, spawning workflow`);
        await classifyAndSpawnWorkflow(dependent.number, repoInfo, targetRepoArgs);
      } else {
        log(`Issue #${dependent.number} still ineligible after #${closedIssueNumber} closed: ${eligibility.reason}`);
      }
    }
  } catch (error) {
    log(`Error checking dependents of closed issue #${closedIssueNumber}: ${error}`, 'error');
  }
}

/** Tracks whether a cron process has been spawned for each repo. */
const cronSpawnedForRepo = new Set<string>();

/** Spawns a cron trigger process for the repo if one isn't already running. */
export function ensureCronProcess(repoInfo: RepoInfo, targetRepoArgs: string[]): void {
  const repoKey = `${repoInfo.owner}/${repoInfo.repo}`;
  if (cronSpawnedForRepo.has(repoKey)) return;

  cronSpawnedForRepo.add(repoKey);
  log(`Spawning cron trigger for ${repoKey}`);
  const child = spawn('bunx', ['tsx', 'adws/triggers/trigger_cron.ts', ...targetRepoArgs], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

/** Resets the cron process tracking. Exported for tests only. */
export function resetCronSpawnedForRepo(): void {
  cronSpawnedForRepo.clear();
}

/**
 * Logs the deferral reason for an ineligible issue.
 */
export function logDeferral(issueNumber: number, eligibility: { reason?: string; blockingIssues?: number[] }): void {
  if (eligibility.reason === 'open_dependencies') {
    log(`Deferring issue #${issueNumber}: open dependencies [${eligibility.blockingIssues?.join(', ')}]`);
  } else {
    log(`Deferring issue #${issueNumber}: ${eligibility.reason}`);
  }
}
