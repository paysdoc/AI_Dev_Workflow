/**
 * Runs a phase, or an orchestrator's lifecycle, of the production code in-process for a surface row,
 * against the mock forge, the fixture worktree G11 made and the Claude CLI stub. The phase runs
 * under the name the production orchestrator passes to `runPhase`, so the stage artefacts are the
 * production ones.
 */

import { copyFileSync } from 'fs';
import { join } from 'path';

import type { PhaseCostRecord } from '../../../adws/cost/index.ts';
import { CostTracker, runPhase } from '../../../adws/core/phaseRunner.ts';
import { readSpawnLockRecord } from '../../../adws/triggers/spawnGate.ts';
import { runWithOrchestratorLifecycle } from '../../../adws/phases/orchestratorLock.ts';
import { resolveWorkflowRepoId } from '../../../adws/phases/workflowRepoIdentity.ts';
import type { WorkflowConfig } from '../../../adws/phases/workflowInit.ts';
import type { LifecycleOutcome, PhaseOutcome, RegressionWorld } from '../step_definitions/world.ts';
import { pointClaudeCodeAtStub } from './claudeCliStub.ts';
import { buildPhaseConfig, phaseDefinition } from './phaseConfig.ts';

export { SURFACE_REPO } from './mockForgeProviders.ts';
export { buildPhaseConfig } from './phaseConfig.ts';

/** The base class posts to the Cost API whenever the host's .env sets COST_API_URL; a surface row records instead. */
export class NonPostingCostTracker extends CostTracker {
  readonly committedRecords: PhaseCostRecord[] = [];

  async commit(_config: WorkflowConfig, records: PhaseCostRecord[]): Promise<void> {
    this.committedRecords.push(...records);
  }
}

/** The agent runner drops every MOCK_* name from the stub's environment, so only a marker file in the worktree can program it. */
export function deliverStubManifest(world: RegressionWorld, worktreePath: string): void {
  pointClaudeCodeAtStub(world);
  const manifestPath = world.harnessEnv['MOCK_MANIFEST_PATH'];
  if (manifestPath) copyFileSync(manifestPath, join(worktreePath, '.adw-stub-manifest.json'));
}

class PhaseExitSentinel extends Error {
  constructor(readonly code: number) {
    super(`process.exit(${code})`);
  }
}

interface Trapped<T> {
  readonly resolved: boolean;
  readonly value?: T;
  readonly error?: unknown;
  readonly exitCode?: number;
}

/** A pause, a timeout or a failed workflow ends the process; the trap turns that into a recorded exit code. */
export async function withExitTrap<T>(run: () => Promise<T>): Promise<Trapped<T>> {
  const originalExit = process.exit;
  process.exit = ((code?: number) => {
    throw new PhaseExitSentinel(code ?? 0);
  }) as typeof process.exit;

  try {
    return { resolved: true, value: await run() };
  } catch (error) {
    if (error instanceof PhaseExitSentinel) return { resolved: false, exitCode: error.code };
    return { resolved: false, error };
  } finally {
    process.exit = originalExit;
  }
}

export async function runSurfacePhase(world: RegressionWorld, adwId: string, orchestrator: string, phase: string): Promise<PhaseOutcome> {
  const { fn, phaseName } = phaseDefinition(orchestrator, phase);
  const config = buildPhaseConfig(world, adwId, orchestrator);
  deliverStubManifest(world, config.worktreePath);

  const { resolved, error, exitCode } = await withExitTrap(() => runPhase(config, new NonPostingCostTracker(), fn, phaseName));
  return { adwId, orchestrator, phase, resolved, error, exitCode };
}

export async function runSurfaceLifecycle(world: RegressionWorld, adwId: string, orchestrator: string): Promise<LifecycleOutcome> {
  const config = buildPhaseConfig(world, adwId, orchestrator);
  let ran = false;
  let lockHolderPid: number | null = null;

  const { value, error, exitCode } = await withExitTrap(() =>
    runWithOrchestratorLifecycle(config, async () => {
      ran = true;
      lockHolderPid = readSpawnLockRecord(resolveWorkflowRepoId(config), config.issueNumber)?.pid ?? null;
    }),
  );
  return { adwId, orchestrator, issueNumber: config.issueNumber, returned: value, ran, lockHolderPid, error, exitCode };
}
