/**
 * Auth-required pause handler.
 * Mirrors handleRateLimitPause in workflowCompletion.ts but for host-wide auth failures.
 */

import { log, AgentStateManager } from '../core';
import { type ModelUsageMap, persistTokenCounts } from '../cost';
import { writeAuthGate } from '../core/authGate';
import { AuthRequiredError } from '../types/agentTypes';
import type { WorkflowConfig } from './workflowInit';

/**
 * Catches AuthRequiredError in an orchestrator main():
 * - writes/updates agents/.auth_gate
 * - marks workflowStage = 'paused_auth'
 * - exits 0
 */
export function handleAuthRequiredPause(
  config: WorkflowConfig,
  err: AuthRequiredError,
  costUsd?: number,
  modelUsage?: ModelUsageMap,
): never {
  const { orchestratorStatePath, orchestratorName, adwId, issueNumber } = config;

  if (costUsd !== undefined && modelUsage) {
    persistTokenCounts(orchestratorStatePath, costUsd, modelUsage);
  }

  writeAuthGate({ adwId, issueNumber, agentName: err.agentName });

  const existingState = AgentStateManager.readState(orchestratorStatePath);
  AgentStateManager.writeState(orchestratorStatePath, {
    execution: {
      status: 'paused',
      startedAt: existingState?.execution?.startedAt ?? new Date().toISOString(),
      completedAt: new Date().toISOString(),
    },
    metadata: {
      ...(existingState?.metadata ?? {}),
      pauseReason: 'auth_required',
      pausedAtAgent: err.agentName,
    },
  });

  AgentStateManager.writeTopLevelState(adwId, { workflowStage: 'paused_auth' });
  AgentStateManager.appendLog(orchestratorStatePath, `${orchestratorName} workflow paused awaiting re-auth (agent: ${err.agentName})`);

  log(`${orchestratorName} workflow paused awaiting re-auth`, 'warn');
  process.exit(0);
}

/**
 * Used by trigger_cron.ts when SIGTERMing live PIDs:
 * rewrites the top-level state to paused_auth without triggering comments or Slack.
 */
export function markStatePausedAuthForLiveOrchestrator(adwId: string): void {
  try {
    AgentStateManager.writeTopLevelState(adwId, { workflowStage: 'paused_auth' });
  } catch (err) {
    log(`markStatePausedAuthForLiveOrchestrator: failed for adwId=${adwId}: ${err}`, 'warn');
  }
}
