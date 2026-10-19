/**
 * The world the device janitor sweeps: a host that holds leftover devices, the workflow state of some ADW IDs, the ADW IDs
 * whose orchestrators are alive, and the age of some worktrees, all handed over as the janitor's dependencies. Everything
 * it is asked, and everything it logs, is recorded. No vitest import: any test may use it.
 */

import { leftoverDevicesHost, type LeftoverDevicesHost, type LeftoverDevicesScript } from '../../../core/__tests__/fixtures/leftoverDevicesHost';
import type { AgentState } from '../../../types/agentTypes';
import { JANITOR_GRACE_PERIOD_MS } from '../../devServerJanitor';
import type { DeviceJanitorDeps } from '../../deviceJanitor';

export const TARGET_REPOS = '/repos';
/** Inside the grace period. */
export const YOUNG = JANITOR_GRACE_PERIOD_MS / 2;
/** Outside the grace period. */
export const OLD = JANITOR_GRACE_PERIOD_MS * 2;

export interface JanitorWorldOptions {
  readonly script: Partial<LeftoverDevicesScript>;
  /** The top-level state of an ADW ID; one that is not here has no state, as after `## Cancel`. */
  readonly states: Readonly<Record<string, Partial<AgentState>>>;
  /** The ADW IDs whose orchestrators are alive. */
  readonly live: readonly string[];
  /** The age of a worktree by its path; one that is not here is gone. */
  readonly worktreeAges: Readonly<Record<string, number>>;
}

export interface JanitorWorld {
  readonly host: LeftoverDevicesHost;
  readonly deps: DeviceJanitorDeps;
  /** Each log call as `<level> <message>`. */
  readonly lines: string[];
  /** The ADW IDs whose orchestrators were asked after, in the order asked. Each question is also among the host's events, as `orchestrator of <adwId>?`. */
  readonly asked: string[];
}

/** The state a workflow records at init that the janitor reads: the repository and the branch. */
export const stateFor = (owner: string, repo: string, branchName: string): Partial<AgentState> => ({ repoIdentity: { owner, repo }, branchName });

/** Where that branch's worktree is, under `TARGET_REPOS`. */
export const worktreeOf = (branchName: string, owner = 'acme', repo = 'app'): string => `${TARGET_REPOS}/${owner}/${repo}/.worktrees/${branchName}`;

/** A whole state, as the janitor reads it, from the fields a test cares about. */
export const agentStateOf = (adwId: string, recorded: Partial<AgentState>): AgentState => ({
  adwId,
  issueNumber: null,
  agentName: 'orchestrator',
  execution: { status: 'running', startedAt: '2026-01-01T00:00:00Z' },
  ...recorded,
});

export function janitorWorld(options: Partial<JanitorWorldOptions> = {}): JanitorWorld {
  const { script = {}, states = {}, live = [], worktreeAges = {} } = options;
  const host = leftoverDevicesHost(script);
  const lines: string[] = [];
  const asked: string[] = [];

  const deps: DeviceJanitorDeps = {
    devices: host.deps,
    readTopLevelState: adwId => (adwId in states ? agentStateOf(adwId, states[adwId]) : null),
    isAgentProcessRunning: adwId => {
      asked.push(adwId);
      host.events.push(`orchestrator of ${adwId}?`);
      return live.includes(adwId);
    },
    getWorktreeAgeMs: worktreePath => worktreeAges[worktreePath] ?? Infinity,
    log: (message, level = 'info') => {
      lines.push(`${level} ${message}`);
    },
  };
  return { host, deps, lines, asked };
}
