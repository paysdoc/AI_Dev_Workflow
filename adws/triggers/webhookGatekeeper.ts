/**
 * Webhook gatekeeper functions.
 *
 * Handles eligibility checking, dependency unblocking on issue close,
 * classify-and-spawn workflow, and cron process management.
 */

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { log, generateAdwId, REPO_ROOT, LOGS_DIR } from '../core';
import type { LaunchBoundary } from '../core';
import type { IssueTracker } from '../providers/types';
import { classifyIssueForTrigger, getWorkflowScript } from '../core/issueClassifier';
import { issueTypeToAdwLabel, ADW_UPGRADE_LABEL } from '../core/adwLabels';
import type { IssueClassSlashCommand } from '../types/issueTypes';
import { AgentStateManager } from '../core/agentState';

import { isAdwRunningForIssue } from '../forge/workflowCommentsBase';
import type { IssueClassificationResult } from '../core/issueClassifier';
import { parseDependencies } from './issueDependencies';
import { isCronAliveForRepo } from './cronProcessGuard';
import { releaseIssueSpawnLock } from './spawnGate';
// takeoverHandler enforces the decision before any spawn
import { evaluateCandidate } from './takeoverHandler';
import type { CandidateDecision } from './takeoverHandler';
import { readAuthGate } from '../core/authGate';
import type { RepoIdentifier } from '../providers/types';

/**
 * Spawns a detached child process for running ADW orchestrator workflows.
 *
 * Any relative `.ts`/`.tsx` script path in `args` is resolved against REPO_ROOT
 * and spawn is given an explicit `cwd: REPO_ROOT`, so the child works correctly
 * even if the caller's process.cwd() drifts (e.g. trigger launched from a
 * subdirectory). assertCwdIsRepoRoot() at trigger startup is the primary guard;
 * this is belt-and-braces.
 */
export function spawnDetached(command: string, args: string[]): void {
  const resolvedArgs = args.map((arg) => {
    // Match orchestrator script paths like `adws/adwSdlc.tsx` or `adws/triggers/foo.ts`.
    if (/^adws\/.*\.tsx?$/.test(arg) && !path.isAbsolute(arg)) {
      return path.join(REPO_ROOT, arg);
    }
    return arg;
  });
  log(`Spawning: ${command} ${resolvedArgs.join(' ')}`);
  const child = spawn(command, resolvedArgs, {
    detached: true,
    stdio: 'inherit',
    cwd: REPO_ROOT,
  });
  child.unref();
}

export interface LabelRouting {
  precomputedClassification?: IssueClassSlashCommand;
  issueTitle?: string;
  persistInferredLabel?: boolean;
}

/**
 * Classifies and spawns a workflow for an eligible issue.
 * Accepts an optional pre-computed decision from the cron trigger to avoid
 * double-evaluation when the cron path has already called evaluateCandidate.
 */
export async function classifyAndSpawnWorkflow(
  issueNumber: number,
  boundary: LaunchBoundary,
  targetRepoArgs: string[],
  existingAdwId?: string,
  precomputedDecision?: CandidateDecision,
  labelRouting?: LabelRouting,
): Promise<void> {
  const { repoId, providers: { issueTracker } } = boundary;

  if (readAuthGate() !== null) {
    log(`Issue #${issueNumber}: auth gate set, skipping spawn`, 'warn');
    releaseIssueSpawnLock(repoId, issueNumber);
    return;
  }

  // Upgrade-tracking issues (adw:upgrade) are driven solely by adwUpgrade.tsx, never by
  // normal classification. Must be intercepted BEFORE evaluateCandidate: otherwise the
  // classifier reads the #UPG issue's title, mislabels it (e.g. as a chore), and re-enters
  // the upgrade gate on the very issue that represents the upgrade — a loop/crash/runaway.
  // Routing it to adwUpgrade is also the self-heal: adwUpgrade's own per-issue lifecycle
  // lock makes re-dispatch idempotent (live → no-op, dead → resume), so no separate watchdog
  // is needed. We release the spawn lock here so adwUpgrade can acquire its lifecycle lock.
  // fetchLabels is fail-open ([] on error) — the same "proceed when the check cannot
  // complete" policy the legacy issueHasLabel had.
  if (issueTracker.fetchLabels(issueNumber).includes(ADW_UPGRADE_LABEL)) {
    log(`Issue #${issueNumber}: adw:upgrade tracking issue, routing to adwUpgrade`, 'success');
    spawnDetached('bunx', ['tsx', 'adws/adwUpgrade.tsx', String(issueNumber), ...targetRepoArgs]);
    releaseIssueSpawnLock(repoId, issueNumber);
    return;
  }

  // Enforce the takeover decision before any spawn. When the cron trigger has
  // already called evaluateCandidate, it passes the pre-computed decision here
  // to avoid re-acquiring the spawn lock.
  const decision = precomputedDecision ?? evaluateCandidate({ issueNumber, boundary });

  if (decision.kind === 'defer_live_holder') {
    log(`Issue #${issueNumber}: live holder (pid ${decision.holderPid}) owns this issue, deferring`);
    return;
  }

  if (decision.kind === 'skip_terminal') {
    log(`Issue #${issueNumber}: terminal stage "${decision.terminalStage}", skipping spawn`);
    return;
  }

  if (decision.kind === 'escalate_human_gated') {
    log(`Issue #${issueNumber}: resume cap reached, escalated adwId=${decision.adwId} → human_gated (awaiting ## Retry)`, 'warn');
    return;
  }

  if (decision.kind === 'take_over_adwId') {
    // Takeover path: reuse the existing adwId, skip re-classification.
    const { adwId, derivedStage } = decision;
    const state = AgentStateManager.readTopLevelState(adwId);
    const workflowScript = state?.orchestratorScript ?? getWorkflowScript('/feature');
    log(`Issue #${issueNumber}: taking over adwId=${adwId} derivedStage=${derivedStage}, spawning ${workflowScript}`, 'success');
    spawnDetached('bunx', ['tsx', workflowScript, String(issueNumber), adwId, ...targetRepoArgs]);
    releaseIssueSpawnLock(repoId, issueNumber);
    return;
  }

  // spawn_fresh path: classify the issue and spawn a new workflow.
  try {
    const classification = labelRouting?.precomputedClassification
      ? { issueType: labelRouting.precomputedClassification, success: true as const, issueTitle: labelRouting.issueTitle, adwId: undefined }
      : await classifyIssueForTrigger(issueNumber, { fetchIssue: (n) => issueTracker.fetchIssue(n) });

    if (await isAdwRunningForIssue(issueNumber, issueTracker)) {
      log(`Issue #${issueNumber}: another ADW workflow started during classification, aborting spawn`);
      releaseIssueSpawnLock(repoId, issueNumber);
      return;
    }

    const workflowScript = getWorkflowScript(classification.issueType);
    const adwId = existingAdwId || classification.adwId || generateAdwId(classification.issueTitle);

    log(`Issue #${issueNumber} classified as ${classification.issueType}, spawning ${workflowScript}`, 'success');
    spawnDetached('bunx', ['tsx', workflowScript, String(issueNumber), adwId, '--issue-type', classification.issueType, ...targetRepoArgs]);
    releaseIssueSpawnLock(repoId, issueNumber);
    persistInferredLabel(issueNumber, classification, labelRouting, issueTracker);
  } catch (err) {
    releaseIssueSpawnLock(repoId, issueNumber);
    throw err;
  }
}

/** Persists an inferred classification as an adw:* label when routing requests it. Isolated from its spawn so the write is exercisable on its own. */
export function persistInferredLabel(
  issueNumber: number,
  classification: Pick<IssueClassificationResult, 'issueType' | 'success'>,
  labelRouting: LabelRouting | undefined,
  issueTracker: Pick<IssueTracker, 'applyLabel'>,
): void {
  if (!labelRouting?.persistInferredLabel || !classification.success) return;
  const label = issueTypeToAdwLabel(classification.issueType);
  if (!label) return;
  try {
    issueTracker.applyLabel(issueNumber, label);
  } catch (labelErr) {
    log(`Issue #${issueNumber}: failed to persist inferred label "${label}": ${labelErr}`, 'warn');
  }
}

/** Tracks whether a cron process has been spawned for each repo. */
const cronSpawnedForRepo = new Set<string>();

/** Spawns a cron trigger process for the repo if one isn't already running. */
export function ensureCronProcess(repoInfo: RepoIdentifier, targetRepoArgs: string[]): void {
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
  const cronLogDir = path.join(LOGS_DIR, 'agents', 'cron');
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
  tracker: Pick<IssueTracker, 'listIssues' | 'closeIssue'>,
): Promise<void> {
  try {
    const issues = tracker.listIssues({ fields: ['number', 'body'], limit: 100 });

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
      await tracker.closeIssue(dependent.number, comment);
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
