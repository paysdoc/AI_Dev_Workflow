/**
 * The per-entry I/O the scanner executes on `resume`, plus the best-effort stage comments
 * posted through an entry's own boundary (also used by the scanner's `evict` branch).
 * Extracted from `pauseQueueScanner.ts` so both files stay under the file-size guideline.
 *
 * Remove-before-spawn: the queue entry is removed before the orchestrator child exists, so
 * no concurrent reader (another cron tick, the `## Retry` handler) can see an entry whose
 * resume is in flight. If the spawn then fails inside the readiness window — early exit,
 * `'error'`, or a synchronous throw — the entry is re-appended with `probeFailures`
 * incremented, so a failed spawn still counts toward the strike budget exactly as before.
 */

import { spawn } from 'child_process';
import type { ChildProcess, SpawnOptions } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { log, AGENTS_STATE_DIR, REPO_ROOT, parseTargetRepoArgs, buildLaunchBoundary, type WorkflowStage } from '../core';
import {
  removeFromPauseQueue,
  appendToPauseQueue,
  type PausedWorkflow,
} from '../core/pauseQueue';
import { readLocalRepoIdentity } from '../core/localRepoIdentity';
import { Platform, type RepoIdentifier } from '@paysdoc/devplatform';
import { postIssueStageComment } from '../phases/phaseCommentHelpers';
import type { WorkflowContext } from '../forge/workflowCommentsIssue';
import { acquireIssueSpawnLock, releaseIssueSpawnLock } from './spawnGate';
import { AgentStateManager } from '../core/agentState';

/** Readiness window (ms) to confirm a spawned child did not immediately crash. */
export const READINESS_WINDOW_MS = 2000;

export type SpawnOrchestrator = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;

export interface ResumeDeps {
  readonly now?: () => Date;
  readonly spawn?: SpawnOrchestrator;
}

/**
 * Resolves the target repo for a paused entry from its persisted `--target-repo`
 * extraArgs — the same repo the orchestrator is respawned with. Falls back to the
 * cron's local git remote ONLY when the entry has no target repo (a framework
 * self-hosting workflow, where cwd's remote IS the correct repo). This stops the
 * resume path from pinning the process-global GH_TOKEN to the cron host's own repo.
 */
export function resolveEntryRepoInfo(entry: PausedWorkflow): RepoIdentifier {
  const targetRepo = parseTargetRepoArgs([...(entry.extraArgs ?? [])]);
  if (targetRepo) {
    return { owner: targetRepo.owner, repo: targetRepo.repo, platform: Platform.GitHub };
  }
  return readLocalRepoIdentity();
}

/** Builds a launch boundary for the paused entry's own repo — the same `--target-repo` resolution as `resolveEntryRepoInfo`. */
function resolveEntryBoundary(entry: PausedWorkflow) {
  return buildLaunchBoundary(parseTargetRepoArgs([...(entry.extraArgs ?? [])]));
}

/**
 * Posts a best-effort stage comment for a paused-queue entry through a
 * boundary built for the ENTRY's own repo — never the cron host's cwd.
 */
export function postEntryStageComment(entry: PausedWorkflow, stage: WorkflowStage, ctx: WorkflowContext): void {
  try {
    const boundary = resolveEntryBoundary(entry);
    postIssueStageComment(boundary.providers, entry.issueNumber, stage, ctx);
  } catch (err) {
    log(`Failed to post ${stage} comment for issue #${entry.issueNumber}: ${err}`, 'warn');
  }
}

function worktreeExists(worktreePath: string): boolean {
  return fs.existsSync(worktreePath);
}

/**
 * Waits up to `timeoutMs` for the child to stay alive, rejecting on early 'error' or 'exit'.
 * Resolves if the child has not exited before the timeout elapses.
 */
function awaitChildReadiness(child: ChildProcess, timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const ref: { timer?: ReturnType<typeof setTimeout> } = {};

    const onError = (err: Error) => {
      clearTimeout(ref.timer);
      reject(err);
    };

    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      clearTimeout(ref.timer);
      reject(new Error(`child exited early code=${code} signal=${signal}`));
    };

    child.once('error', onError);
    child.once('exit', onExit);

    ref.timer = setTimeout(() => {
      child.removeListener('error', onError);
      child.removeListener('exit', onExit);
      resolve();
    }, timeoutMs);
  });
}

/**
 * A spawn that fails inside the readiness window must still count toward the strike
 * budget, exactly as a failed probe does — `appendToPauseQueue`, not `updatePauseQueueEntry`,
 * because the entry is no longer in the file by the time this runs (`updatePauseQueueEntry`
 * is a silent no-op on an absent adwId); `appendToPauseQueue`'s adwId dedupe rules out a
 * double re-append.
 */
function requeueAfterFailedSpawn(entry: PausedWorkflow, err: unknown, resumeLogPath: string, now: () => Date): void {
  log(`Resume spawn failed for ${entry.adwId}: ${err}. See ${resumeLogPath}`, 'error');
  appendToPauseQueue({
    ...entry,
    probeFailures: (entry.probeFailures ?? 0) + 1,
    lastProbeAt: now().toISOString(),
  });
}

export async function resumeWorkflow(entry: PausedWorkflow, deps: ResumeDeps = {}): Promise<void> {
  const spawnChild = deps.spawn ?? spawn;
  const now = deps.now ?? (() => new Date());

  const repoInfo = resolveEntryRepoInfo(entry);

  if (!worktreeExists(entry.worktreePath)) {
    log(`Paused workflow ${entry.adwId}: worktree gone at ${entry.worktreePath} — removing from queue`, 'warn');
    removeFromPauseQueue(entry.adwId);

    postEntryStageComment(entry, 'error', {
      issueNumber: entry.issueNumber,
      adwId: entry.adwId,
      errorMessage: `Workflow paused at '${entry.pausedAtPhase}' but worktree no longer exists. It stays paused — post \`## Retry\` on this issue to respawn it.`,
    });
    return;
  }

  // Canonical-claim verification: per-issue spawn lock + matching adwId in top-level state.
  // Prevents resume-path spawn when another orchestrator holds the claim (split-brain)
  // or when the state file's adwId has been manually edited / rewritten. Must stay ahead of
  // the removal below: a skip here must never take the entry off the queue, or a resume the
  // lock blocked this cycle would strand the workflow with nothing left to retry it.
  if (!acquireIssueSpawnLock(repoInfo, entry.issueNumber, process.pid)) {
    log(
      `Paused workflow ${entry.adwId}: spawn lock held for ${repoInfo.owner}/${repoInfo.repo}#${entry.issueNumber} — skipping resume this cycle`,
      'warn',
    );
    return;
  }

  const topLevelState = AgentStateManager.readTopLevelState(entry.adwId);
  if (!topLevelState || topLevelState.adwId !== entry.adwId) {
    const observed = topLevelState?.adwId ?? null;
    log(
      `Paused workflow ${entry.adwId}: canonical claim diverged (expected adwId=${entry.adwId}, observed=${observed}) — removing from queue`,
      'error',
    );
    releaseIssueSpawnLock(repoInfo, entry.issueNumber);
    removeFromPauseQueue(entry.adwId);
    postEntryStageComment(entry, 'error', {
      issueNumber: entry.issueNumber,
      adwId: entry.adwId,
      errorMessage: `Workflow paused at '${entry.pausedAtPhase}' could not resume: canonical claim diverged (expected adwId=${entry.adwId}, observed=${observed ?? 'missing state file'}). Manual inspection required.`,
    });
    return;
  }

  // Release the verification-only lock so the spawned child's acquireOrchestratorLock
  // can take over the lifetime lock. The brief gap is acceptable.
  releaseIssueSpawnLock(repoInfo, entry.issueNumber);

  const resumeLogDir = path.join(AGENTS_STATE_DIR, 'paused_queue_logs');
  fs.mkdirSync(resumeLogDir, { recursive: true });
  const resumeLogPath = path.join(resumeLogDir, `${entry.adwId}.resume.log`);
  const logFd = fs.openSync(resumeLogPath, 'a');

  // Resolve the orchestrator script against
  // REPO_ROOT so the spawn works even if the cron host's process.cwd() drifts.
  const resolvedScript = path.isAbsolute(entry.orchestratorScript)
    ? entry.orchestratorScript
    : path.join(REPO_ROOT, entry.orchestratorScript);
  const spawnArgs = [
    'tsx',
    resolvedScript,
    String(entry.issueNumber),
    entry.adwId,
    ...(entry.extraArgs ?? []),
  ];

  log(`Resuming workflow ${entry.adwId} for issue #${entry.issueNumber} (${entry.orchestratorScript})`);

  // The entry must be gone from the queue file before the child exists, so a concurrent
  // reader (another cron tick, the `## Retry` handler) can never see it and resume it a
  // second time. A spawn that then fails is re-appended below with an extra strike.
  removeFromPauseQueue(entry.adwId);

  try {
    // cwd pinned to REPO_ROOT — target-repo worktrees do not contain adws/ scripts
    const child = spawnChild('bunx', spawnArgs, { detached: true, stdio: ['ignore', logFd, logFd], cwd: REPO_ROOT });

    await awaitChildReadiness(child, READINESS_WINDOW_MS);

    // Child stayed alive past readiness window — commit side-effects
    child.unref();
    log(`Resumed workflow ${entry.adwId} (pid ${child.pid})`, 'success');

    postEntryStageComment(entry, 'resumed', {
      issueNumber: entry.issueNumber,
      adwId: entry.adwId,
      pausedAtPhase: entry.pausedAtPhase,
    });
  } catch (err) {
    // Spawn threw synchronously, emitted 'error', or the child exited early — the entry is
    // already gone from the queue, so it is put back with one more strike.
    requeueAfterFailedSpawn(entry, err, resumeLogPath, now);
  } finally {
    try { fs.closeSync(logFd); } catch { /* fd already closed on child side */ }
  }
}
