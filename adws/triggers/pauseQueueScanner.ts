/**
 * Pause queue scanner — probes paused workflows and resumes them when capacity returns.
 *
 * Called from trigger_cron.ts on every N poll cycles.
 * Runs a cheap `claude --print "ping"` call to check if rate limit has cleared.
 * On success: removes from queue, posts resumed comment, spawns the orchestrator.
 * On repeated unknown failure: removes from queue, posts error comment.
 */

import { execSync, spawn } from 'child_process';
import * as fs from 'fs';
import { log, PROBE_INTERVAL_CYCLES, MAX_UNKNOWN_PROBE_FAILURES, resolveClaudeCodePath } from '../core';
import {
  readPauseQueue,
  removeFromPauseQueue,
  updatePauseQueueEntry,
  type PausedWorkflow,
} from '../core/pauseQueue';
import { getRepoInfo, activateGitHubAppAuth } from '../github';
import { postIssueStageComment } from '../phases/phaseCommentHelpers';
import { createRepoContext } from '../providers/repoContext';
import { Platform } from '../providers/types';

/** Rate-limit indicator strings — same as agentProcessHandler detection. */
const RATE_LIMIT_STRINGS = [
  "You've hit your limit",
  "You're out of extra usage",
  '502 Bad Gateway',
  'Invalid authentication credentials',
];

/** Returns true if the text contains a known rate-limit indicator. */
function containsRateLimitText(text: string): boolean {
  return RATE_LIMIT_STRINGS.some(s => text.includes(s));
}

/**
 * Sends a cheap probe to Claude CLI to test if rate limit has cleared.
 * Returns 'clear' (exit 0, no rate-limit text), 'limited' (rate-limit detected), or 'unknown'.
 */
function probeRateLimit(): 'clear' | 'limited' | 'unknown' {
  try {
    const claudePath = resolveClaudeCodePath();
    const output = execSync(
      `${claudePath} --print "ping" --model haiku --max-turns 1 --dangerously-skip-permissions --output-format stream-json`,
      { encoding: 'utf-8', timeout: 30_000 },
    );
    if (containsRateLimitText(output)) return 'limited';
    return 'clear';
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (containsRateLimitText(msg)) return 'limited';
    return 'unknown';
  }
}

/** Returns true if the worktree path exists on disk. */
function worktreeExists(worktreePath: string): boolean {
  return fs.existsSync(worktreePath);
}

/** Posts a resumed comment to the GitHub issue and spawns the orchestrator. */
async function resumeWorkflow(entry: PausedWorkflow): Promise<void> {
  const repoInfo = getRepoInfo();
  activateGitHubAppAuth(repoInfo.owner, repoInfo.repo);

  // Check worktree still exists
  if (!worktreeExists(entry.worktreePath)) {
    log(`Paused workflow ${entry.adwId}: worktree gone at ${entry.worktreePath} — removing from queue`, 'warn');
    removeFromPauseQueue(entry.adwId);

    try {
      const repoContext = createRepoContext({
        repoId: { owner: repoInfo.owner, repo: repoInfo.repo, platform: Platform.GitHub },
        cwd: process.cwd(),
      });
      postIssueStageComment(repoContext, entry.issueNumber, 'error', {
        issueNumber: entry.issueNumber,
        adwId: entry.adwId,
        errorMessage: `Workflow paused at '${entry.pausedAtPhase}' but worktree no longer exists. Manual restart required.`,
      });
    } catch {
      // Non-fatal
    }
    return;
  }

  // Remove from queue before spawning to avoid duplicate spawns
  removeFromPauseQueue(entry.adwId);

  // Post resumed comment
  try {
    const repoContext = createRepoContext({
      repoId: { owner: repoInfo.owner, repo: repoInfo.repo, platform: Platform.GitHub },
      cwd: entry.worktreePath,
    });
    postIssueStageComment(repoContext, entry.issueNumber, 'resumed', {
      issueNumber: entry.issueNumber,
      adwId: entry.adwId,
      pausedAtPhase: entry.pausedAtPhase,
    });
  } catch (err) {
    log(`Failed to post resumed comment for issue #${entry.issueNumber}: ${err}`, 'warn');
  }

  // Spawn orchestrator detached
  const spawnArgs = [
    'tsx',
    entry.orchestratorScript,
    String(entry.issueNumber),
    entry.adwId,
    ...(entry.extraArgs ?? []),
  ];
  log(`Resuming workflow ${entry.adwId} for issue #${entry.issueNumber} (${entry.orchestratorScript})`, 'success');
  const child = spawn('bunx', spawnArgs, { detached: true, stdio: 'ignore' });
  child.unref();
}

/**
 * Scans the pause queue and probes/resumes paused workflows.
 * Only runs the probe every PROBE_INTERVAL_CYCLES cycles to avoid hammering the API.
 *
 * @param cycleCount - Incrementing cycle counter from the cron trigger.
 */
export async function scanPauseQueue(cycleCount: number): Promise<void> {
  if (cycleCount % PROBE_INTERVAL_CYCLES !== 0) return;

  const entries = readPauseQueue();
  if (entries.length === 0) return;

  log(`Pause queue scan: ${entries.length} paused workflow(s)`);

  const probeResult = probeRateLimit();

  for (const entry of entries) {
    if (probeResult === 'clear') {
      log(`Rate limit cleared — resuming workflow ${entry.adwId}`, 'success');
      await resumeWorkflow(entry);
    } else if (probeResult === 'limited') {
      log(`Rate limit still active for workflow ${entry.adwId} — will retry later`, 'info');
      updatePauseQueueEntry(entry.adwId, { lastProbeAt: new Date().toISOString() });
    } else {
      // Unknown error — increment failure count
      const failures = (entry.probeFailures ?? 0) + 1;
      log(`Unknown probe failure for workflow ${entry.adwId} (${failures}/${MAX_UNKNOWN_PROBE_FAILURES})`, 'warn');
      if (failures >= MAX_UNKNOWN_PROBE_FAILURES) {
        log(`Max probe failures reached for ${entry.adwId} — removing from queue`, 'error');
        removeFromPauseQueue(entry.adwId);
        try {
          const repoInfo = getRepoInfo();
          const repoContext = createRepoContext({
            repoId: { owner: repoInfo.owner, repo: repoInfo.repo, platform: Platform.GitHub },
            cwd: process.cwd(),
          });
          postIssueStageComment(repoContext, entry.issueNumber, 'error', {
            issueNumber: entry.issueNumber,
            adwId: entry.adwId,
            errorMessage: `Workflow paused at '${entry.pausedAtPhase}' failed to resume after ${MAX_UNKNOWN_PROBE_FAILURES} probe attempts. Manual restart required.`,
          });
        } catch {
          // Non-fatal
        }
      } else {
        updatePauseQueueEntry(entry.adwId, {
          probeFailures: failures,
          lastProbeAt: new Date().toISOString(),
        });
      }
    }
  }
}
