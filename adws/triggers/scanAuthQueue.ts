/**
 * scanAuthQueue — resume paused_auth orchestrators after auth has been restored.
 *
 * Called by trigger_cron.ts when the auth gate is absent (i.e., auth has been cleared).
 * For each agents/<adwId>/state.json with workflowStage === 'paused_auth':
 *   1. Rewrite state to 'abandoned' so takeoverHandler branch 5 fires.
 *   2. Call evaluateCandidate — expected result: take_over_adwId.
 *   3. Spawn the orchestrator with the original adwId preserved.
 */

import * as fs from 'fs';
import { log, AGENTS_STATE_DIR } from '../core';
import { AgentStateManager } from '../core/agentState';
import { readAuthGate } from '../core/authGate';
import { evaluateCandidate } from './takeoverHandler';
import type { TakeoverDeps } from './takeoverHandler';
import { spawnDetached } from './webhookGatekeeper';
import { releaseIssueSpawnLock } from './spawnGate';
import type { RepoInfo } from '../github/githubApi';

export interface ScanAuthQueueDeps {
  readAuthGate: () => ReturnType<typeof import('../core/authGate').readAuthGate>;
  listAgentDirs: () => string[];
  readTopLevelState: (adwId: string) => ReturnType<typeof AgentStateManager.readTopLevelState>;
  writeTopLevelState: (adwId: string, patch: Record<string, unknown>) => void;
  evaluateCandidate: typeof evaluateCandidate;
  spawnDetached: typeof spawnDetached;
  releaseIssueSpawnLock: typeof releaseIssueSpawnLock;
}

function defaultListAgentDirs(): string[] {
  try {
    return fs.readdirSync(AGENTS_STATE_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);
  } catch {
    return [];
  }
}

function buildDefaultDeps(): ScanAuthQueueDeps {
  return {
    readAuthGate: () => readAuthGate(),
    listAgentDirs: defaultListAgentDirs,
    readTopLevelState: (adwId) => AgentStateManager.readTopLevelState(adwId),
    writeTopLevelState: (adwId, patch) => AgentStateManager.writeTopLevelState(adwId, patch),
    evaluateCandidate,
    spawnDetached,
    releaseIssueSpawnLock,
  };
}

/**
 * Walks agents/* for paused_auth states, rewrites each to abandoned, then
 * routes through takeoverHandler branch 5 to re-spawn with the original adwId.
 *
 * @returns count of orchestrators successfully re-triggered
 */
export async function scanAuthQueue(
  cronRepoInfo: RepoInfo,
  targetRepoArgs: string[],
  takeoverDeps?: TakeoverDeps,
  deps?: ScanAuthQueueDeps,
): Promise<number> {
  const d = deps ?? buildDefaultDeps();

  if (d.readAuthGate() !== null) {
    log('scanAuthQueue: auth gate still set, skipping', 'warn');
    return 0;
  }

  const agentDirs = d.listAgentDirs();
  let resumedCount = 0;

  for (const adwId of agentDirs) {
    const state = d.readTopLevelState(adwId);
    if (!state || state.workflowStage !== 'paused_auth') continue;
    if (state.issueNumber == null) {
      log(`scanAuthQueue: adwId=${adwId} has no issueNumber, skipping`, 'warn');
      continue;
    }

    const issueNumber = state.issueNumber;
    log(`scanAuthQueue: resuming adwId=${adwId} issue #${issueNumber}`, 'info');

    // Rewrite to 'abandoned' so takeoverHandler branch 5 fires
    try {
      d.writeTopLevelState(adwId, { workflowStage: 'abandoned' });
    } catch (err) {
      log(`scanAuthQueue: failed to rewrite adwId=${adwId}: ${err}`, 'warn');
      continue;
    }

    let decision;
    try {
      decision = d.evaluateCandidate({ issueNumber, repoInfo: cronRepoInfo }, takeoverDeps);
    } catch (err) {
      log(`scanAuthQueue: evaluateCandidate failed for adwId=${adwId}: ${err}`, 'warn');
      continue;
    }

    if (decision.kind !== 'take_over_adwId') {
      log(`scanAuthQueue: adwId=${adwId} decision was ${decision.kind}, not spawning`, 'warn');
      continue;
    }

    const orchestratorScript = state.orchestratorScript ?? 'adws/adwSdlc.tsx';
    log(`scanAuthQueue: spawning ${orchestratorScript} for adwId=${adwId} issue #${issueNumber}`, 'success');
    try {
      d.spawnDetached('bunx', ['tsx', orchestratorScript, String(issueNumber), adwId, ...targetRepoArgs]);
      d.releaseIssueSpawnLock(cronRepoInfo, issueNumber);
      resumedCount++;
    } catch (err) {
      log(`scanAuthQueue: spawn failed for adwId=${adwId}: ${err}`, 'warn');
    }
  }

  log(`scanAuthQueue: resumed ${resumedCount} orchestrator(s)`, 'info');
  return resumedCount;
}
