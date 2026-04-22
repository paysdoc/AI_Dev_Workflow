/**
 * Webhook gatekeeper functions.
 *
 * Handles eligibility checking, dependency unblocking on issue close,
 * classify-and-spawn workflow, and cron process management.
 */

import { spawn, execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { log, generateAdwId } from '../core';
import { AGENTS_STATE_DIR } from '../core/config';
import type { RepoInfo } from '../github/githubApi';
import { getRepoInfo } from '../github';
import { closeIssue } from '../github/issueApi';
import { classifyIssueForTrigger, getWorkflowScript } from '../core/issueClassifier';
import { AgentStateManager } from '../core/agentState';

import { isAdwRunningForIssue } from '../github';
import { checkIssueEligibility } from './issueEligibility';
import { parseDependencies } from './issueDependencies';
import { isCronAliveForRepo } from './cronProcessGuard';
import { releaseIssueSpawnLock } from './spawnGate';
// takeoverHandler enforces the decision before any spawn
import { evaluateCandidate } from './takeoverHandler';
import type { CandidateDecision } from './takeoverHandler';

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
 * Accepts an optional pre-computed decision from the cron trigger to avoid
 * double-evaluation when the cron path has already called evaluateCandidate.
 */
export async function classifyAndSpawnWorkflow(
  issueNumber: number,
  repoInfo: RepoInfo | undefined,
  targetRepoArgs: string[],
  existingAdwId?: string,
  precomputedDecision?: CandidateDecision,
): Promise<void> {
  const resolvedRepoInfo = repoInfo ?? getRepoInfo();

  // Enforce the takeover decision before any spawn. When the cron trigger has
  // already called evaluateCandidate, it passes the pre-computed decision here
  // to avoid re-acquiring the spawn lock.
  const decision = precomputedDecision ?? evaluateCandidate({ issueNumber, repoInfo: resolvedRepoInfo });

  if (decision.kind === 'defer_live_holder') {
    log(`Issue #${issueNumber}: live holder (pid ${decision.holderPid}) owns this issue, deferring`);
    return;
  }

  if (decision.kind === 'skip_terminal') {
    log(`Issue #${issueNumber}: terminal stage "${decision.terminalStage}", skipping spawn`);
    return;
  }

  if (decision.kind === 'take_over_adwId') {
    // Takeover path: reuse the existing adwId, skip re-classification.
    const { adwId, derivedStage } = decision;
    const state = AgentStateManager.readTopLevelState(adwId);
    const workflowScript = state?.orchestratorScript ?? getWorkflowScript('/feature', undefined);
    log(`Issue #${issueNumber}: taking over adwId=${adwId} derivedStage=${derivedStage}, spawning ${workflowScript}`, 'success');
    spawnDetached('bunx', ['tsx', workflowScript, String(issueNumber), adwId, ...targetRepoArgs]);
    releaseIssueSpawnLock(resolvedRepoInfo, issueNumber);
    return;
  }

  // spawn_fresh path: classify the issue and spawn a new workflow.
  try {
    const classification = await classifyIssueForTrigger(issueNumber, resolvedRepoInfo);

    if (await isAdwRunningForIssue(issueNumber, resolvedRepoInfo)) {
      log(`Issue #${issueNumber}: another ADW workflow started during classification, aborting spawn`);
      releaseIssueSpawnLock(resolvedRepoInfo, issueNumber);
      return;
    }

    const workflowScript = getWorkflowScript(classification.issueType, classification.adwCommand);
    const adwId = existingAdwId || classification.adwId || generateAdwId(classification.issueTitle);

    log(`Issue #${issueNumber} classified as ${classification.issueType}, spawning ${workflowScript}`, 'success');
    spawnDetached('bunx', ['tsx', workflowScript, String(issueNumber), adwId, '--issue-type', classification.issueType, ...targetRepoArgs]);
    releaseIssueSpawnLock(resolvedRepoInfo, issueNumber);
  } catch (err) {
    releaseIssueSpawnLock(resolvedRepoInfo, issueNumber);
    throw err;
  }
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
  if (cronSpawnedForRepo.has(repoKey)) {
    if (isCronAliveForRepo(repoKey)) return;
    cronSpawnedForRepo.delete(repoKey);
  }

  if (isCronAliveForRepo(repoKey)) {
    cronSpawnedForRepo.add(repoKey); // sync in-memory cache
    return;
  }

  cronSpawnedForRepo.add(repoKey);
  log(`Spawning cron trigger for ${repoKey}`);
  const cronLogDir = path.join(AGENTS_STATE_DIR, 'cron');
  fs.mkdirSync(cronLogDir, { recursive: true });
  const logFd = fs.openSync(path.join(cronLogDir, `${repoKey.replace('/', '_')}.log`), 'a');
  const child = spawn('bunx', ['tsx', 'adws/triggers/trigger_cron.ts', ...targetRepoArgs], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
  });
  child.unref();
  fs.closeSync(logFd);
}

/**
 * Closes open issues that depend on the given abandoned issue.
 * Posts an error comment on each dependent explaining the parent was abandoned.
 */
export async function closeAbandonedDependents(
  closedIssueNumber: number,
  repoInfo: RepoInfo,
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
      log(`No issues depend on abandoned issue #${closedIssueNumber}`);
      return;
    }

    log(`Found ${dependents.length} issue(s) depending on abandoned issue #${closedIssueNumber}`);

    for (const dependent of dependents) {
      const comment = [
        '## Blocked Issue Abandoned',
        '',
        `This issue depends on #${closedIssueNumber} which was abandoned (PR closed without merge). Closing this issue as it can no longer proceed.`,
        '',
        'Reopen this issue and its parent if you want to retry.',
      ].join('\n');
      await closeIssue(dependent.number, repoInfo, comment);
      log(`Closed dependent issue #${dependent.number} due to abandoned parent #${closedIssueNumber}`);
    }
  } catch (error) {
    log(`Error closing dependents of abandoned issue #${closedIssueNumber}: ${error}`, 'error');
  }
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
