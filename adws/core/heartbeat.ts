/**
 * Heartbeat ticker. Writes `lastSeenAt` to the top-level state file every `intervalMs`,
 * decoupled from phase progress. Exists to give the cron sweeper a signal to distinguish
 * alive-but-wedged from alive-and-progressing orchestrators.
 */

import { AgentStateManager } from './agentState';
import { log } from './utils';

interface HeartbeatHandle {
  readonly adwId: string;
  readonly timer: NodeJS.Timeout;
}
export type { HeartbeatHandle };

export function startHeartbeat(adwId: string, intervalMs: number): HeartbeatHandle {
  log(`Heartbeat starting for adwId=${adwId} (intervalMs=${intervalMs})`, 'info');
  const timer = setInterval(() => {
    try {
      AgentStateManager.writeTopLevelState(adwId, { lastSeenAt: new Date().toISOString() });
    } catch (err) {
      log(`Heartbeat write failed for adwId=${adwId}: ${err}`, 'warn');
    }
  }, intervalMs);
  return { adwId, timer };
}

export function stopHeartbeat(handle: HeartbeatHandle): void {
  clearInterval(handle.timer);
  log(`Heartbeat stopped for adwId=${handle.adwId}`, 'info');
}
