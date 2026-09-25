/**
 * Probes for rate-limit clearance via `rateLimitProbe`'s structural classifier, delegated
 * to a `claude` ping run under stream-json output.
 * On `clear`: removes from queue, posts resumed comment, spawns the orchestrator.
 * On repeated `failed` or `unknown`: removes from queue, posts error comment. `failed`
 * (e.g. a confirmed auth failure) shares this strike path with `unknown` for now — the
 * PRD's decider issue is what gives it its own treatment.
 */

import { spawn } from 'child_process';
import type { ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { log, PROBE_INTERVAL_CYCLES, MAX_UNKNOWN_PROBE_FAILURES, AGENTS_STATE_DIR, REPO_ROOT, parseTargetRepoArgs, buildLaunchBoundary, type WorkflowStage } from '../core';
import {
  readPauseQueue,
  removeFromPauseQueue,
  updatePauseQueueEntry,
  type PausedWorkflow,
} from '../core/pauseQueue';
import { readLocalRepoIdentity } from '../core/localRepoIdentity';
import { Platform, type RepoIdentifier } from '@paysdoc/devplatform';
import { postIssueStageComment } from '../phases/phaseCommentHelpers';
import type { WorkflowContext } from '../forge/workflowCommentsIssue';
import { acquireIssueSpawnLock, releaseIssueSpawnLock } from './spawnGate';
import { AgentStateManager } from '../core/agentState';
import { probeRateLimit, type ProbeOutcome, type ProbeClassification } from './rateLimitProbe';

/** Readiness window (ms) to confirm a spawned child did not immediately crash. */
const READINESS_WINDOW_MS = 2000;

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
function postEntryStageComment(entry: PausedWorkflow, stage: WorkflowStage, ctx: WorkflowContext): void {
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

export async function resumeWorkflow(entry: PausedWorkflow): Promise<void> {
  const repoInfo = resolveEntryRepoInfo(entry);

  if (!worktreeExists(entry.worktreePath)) {
    log(`Paused workflow ${entry.adwId}: worktree gone at ${entry.worktreePath} — removing from queue`, 'warn');
    removeFromPauseQueue(entry.adwId);

    postEntryStageComment(entry, 'error', {
      issueNumber: entry.issueNumber,
      adwId: entry.adwId,
      errorMessage: `Workflow paused at '${entry.pausedAtPhase}' but worktree no longer exists. Manual restart required.`,
    });
    return;
  }

  // Canonical-claim verification: per-issue spawn lock + matching adwId in top-level state.
  // Prevents resume-path spawn when another orchestrator holds the claim (split-brain)
  // or when the state file's adwId has been manually edited / rewritten.
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

  try {
    // cwd pinned to REPO_ROOT — target-repo worktrees do not contain adws/ scripts
    const child = spawn('bunx', spawnArgs, { detached: true, stdio: ['ignore', logFd, logFd], cwd: REPO_ROOT });

    try {
      await awaitChildReadiness(child, READINESS_WINDOW_MS);

      // Child stayed alive past readiness window — commit side-effects
      removeFromPauseQueue(entry.adwId);
      child.unref();
      log(`Resumed workflow ${entry.adwId} (pid ${child.pid})`, 'success');

      postEntryStageComment(entry, 'resumed', {
        issueNumber: entry.issueNumber,
        adwId: entry.adwId,
        pausedAtPhase: entry.pausedAtPhase,
      });
    } catch (err) {
      // Child exited early or errored — keep entry in queue for next-cycle retry
      log(`Resume spawn failed for ${entry.adwId}: ${err}. See ${resumeLogPath}`, 'error');
      updatePauseQueueEntry(entry.adwId, {
        probeFailures: (entry.probeFailures ?? 0) + 1,
        lastProbeAt: new Date().toISOString(),
      });
    }
  } finally {
    try { fs.closeSync(logFd); } catch { /* fd already closed on child side */ }
  }
}

function recordUnknownProbeFailure(entry: PausedWorkflow, verdict: ProbeOutcome): void {
  const failures = (entry.probeFailures ?? 0) + 1;
  log(`Probe failure (${verdict}) for workflow ${entry.adwId} (${failures}/${MAX_UNKNOWN_PROBE_FAILURES})`, 'warn');
  if (failures < MAX_UNKNOWN_PROBE_FAILURES) {
    updatePauseQueueEntry(entry.adwId, { probeFailures: failures, lastProbeAt: new Date().toISOString() });
    return;
  }
  log(`Max probe failures reached for ${entry.adwId} — removing from queue`, 'error');
  removeFromPauseQueue(entry.adwId);
  postEntryStageComment(entry, 'error', {
    issueNumber: entry.issueNumber,
    adwId: entry.adwId,
    errorMessage: `Workflow paused at '${entry.pausedAtPhase}' failed to resume after ${MAX_UNKNOWN_PROBE_FAILURES} probe attempts. Manual restart required.`,
  });
}

async function applyProbeOutcome(entry: PausedWorkflow, verdict: ProbeOutcome): Promise<void> {
  if (verdict === 'clear') {
    log(`Rate limit cleared — resuming workflow ${entry.adwId}`, 'success');
    await resumeWorkflow(entry);
    return;
  }
  if (verdict === 'limited') {
    log(`Rate limit still active for workflow ${entry.adwId} — will retry later`, 'info');
    updatePauseQueueEntry(entry.adwId, { lastProbeAt: new Date().toISOString() });
    return;
  }
  // 'failed' (a confirmed non-rate-limit failure, e.g. auth) and 'unknown' both still
  // follow the strike path until the PRD's decider issue treats them differently.
  recordUnknownProbeFailure(entry, verdict);
}

/** Only runs the probe every PROBE_INTERVAL_CYCLES cycles to avoid hammering the API. */
export async function scanPauseQueue(cycleCount: number, probe: () => ProbeClassification = probeRateLimit): Promise<void> {
  if (cycleCount % PROBE_INTERVAL_CYCLES !== 0) return;

  const entries = readPauseQueue();
  if (entries.length === 0) return;

  log(`Pause queue scan: ${entries.length} paused workflow(s)`);

  const classification = probe();

  for (const entry of entries) {
    await applyProbeOutcome(entry, classification.verdict);
  }
}
