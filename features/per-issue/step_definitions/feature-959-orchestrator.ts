/**
 * Writes what a real orchestrator leaves on disk, so the cron rows observe the artefacts a real
 * run would have produced. "Mirror the fixed startup": this is a copy of what `initializeWorkflow`
 * writes once it has recorded `starting`, never more and never less. The ownerless variant copies what
 * it wrote before the fix: no pid in the top-level state.
 */

import assert from 'assert';
import type { RepoIdentifier } from '@paysdoc/devplatform';

import { AgentStateManager } from '../../../adws/core/agentState.ts';
import { orchestratorNamesForScript } from '../../../adws/core/orchestratorNames.ts';
import { acquireIssueSpawnLock } from '../../../adws/triggers/spawnGate.ts';
import type { AgentIdentifier } from '../../../adws/types/agentTypes.ts';
import type { OrchestratorProcess } from './feature-959-processes.ts';
import type { Workflow } from './feature-959-world.ts';

export type StartupShape = 'fixed' | 'ownerless';

const RUNNING_SUFFIX = '_running';
const TEN_MINUTES_MS = 10 * 60_000;
const ALLOCATED_PORT_LINE = 'Allocated port 57665 for dev server';

function orchestratorNameOf(script: string): AgentIdentifier {
  const [name] = orchestratorNamesForScript(script);
  assert.ok(name, `Expected an orchestrator name for the script ${script}`);
  return name as AgentIdentifier;
}

/** The fixed startup also records its owner and a fresh heartbeat; the ownerless relaunch recorded neither. */
function ownerFields(shape: StartupShape, owner: OrchestratorProcess): Record<string, unknown> {
  if (shape === 'ownerless') return {};
  return { pid: owner.pid, pidStartedAt: owner.startToken, lastSeenAt: new Date().toISOString() };
}

export function recordStarting(workflow: Workflow, owner: OrchestratorProcess, shape: StartupShape): void {
  const { adwId, issueNumber, script, branchName, repoIdentity } = workflow;
  AgentStateManager.writeTopLevelState(adwId, {
    adwId,
    issueNumber,
    workflowStage: 'starting',
    orchestratorScript: script,
    repoIdentity,
    branchName,
    ...ownerFields(shape, owner),
  });

  const orchestratorName = orchestratorNameOf(script);
  const statePath = AgentStateManager.initializeState(adwId, orchestratorName);
  AgentStateManager.writeState(statePath, {
    adwId,
    issueNumber,
    agentName: orchestratorName,
    pid: owner.pid,
    execution: AgentStateManager.createExecutionState('running'),
    branchName,
  });
  AgentStateManager.appendLog(statePath, `Starting ${orchestratorName} workflow for issue #${issueNumber}`);
  AgentStateManager.appendLog(statePath, ALLOCATED_PORT_LINE);
}

/**
 * The stage a running orchestrator stands at. `phaseRunner` also writes the phase entry for a
 * `<phase>_running` stage, started at least ten minutes ago so the cron's grace period has passed.
 */
export function recordStage(workflow: Workflow, stage: string, lastSeenAt: Date): void {
  const phase = stage.endsWith(RUNNING_SUFFIX) ? stage.slice(0, -RUNNING_SUFFIX.length) : null;
  const startedAt = new Date(Date.now() - TEN_MINUTES_MS - 30_000).toISOString();
  AgentStateManager.writeTopLevelState(workflow.adwId, {
    workflowStage: stage,
    lastSeenAt: lastSeenAt.toISOString(),
    ...(phase ? { phases: { [phase]: { status: 'running' as const, startedAt } } } : {}),
  });
}

export function tenMinutesAgo(): Date {
  return new Date(Date.now() - TEN_MINUTES_MS);
}

/** The record `acquireIssueSpawnLock` writes while the owner lives: its pid and the start token read then. */
export function takeSpawnLock(repoId: RepoIdentifier, workflow: Workflow, owner: OrchestratorProcess): void {
  assert.ok(
    acquireIssueSpawnLock(repoId, workflow.issueNumber, owner.pid),
    `Expected to take the spawn lock for issue ${workflow.issueNumber} under pid ${owner.pid}`,
  );
}
