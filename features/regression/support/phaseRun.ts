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
import { DIRECT_PHASE_ORCHESTRATOR, buildPhaseConfig, directPhaseDefinition, phaseDefinition, type PhaseDefinition } from './phaseConfig.ts';

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

/**
 * The unit-test phase points the JUnit report at its logs directory through `process.env`. In-process
 * that outlives the phase and its temp directory, `vitest.config.ts` reads it, and every child
 * process inherits it.
 */
function restoreUnitReportPathOnCleanup(world: Pick<RegressionWorld, 'cleanup'>): void {
  const saved = process.env['ADW_UNIT_TEST_REPORT_PATH'];
  world.cleanup.push(() => {
    if (saved === undefined) delete process.env['ADW_UNIT_TEST_REPORT_PATH'];
    else process.env['ADW_UNIT_TEST_REPORT_PATH'] = saved;
  });
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

async function runDefinedPhase(
  world: RegressionWorld,
  adwId: string,
  orchestrator: string,
  phase: string,
  { fn, phaseName }: PhaseDefinition,
): Promise<PhaseOutcome> {
  const config = buildPhaseConfig(world, adwId, orchestrator);
  deliverStubManifest(world, config.worktreePath);
  restoreUnitReportPathOnCleanup(world);

  const { resolved, error, exitCode } = await withExitTrap(() => runPhase(config, new NonPostingCostTracker(), fn, phaseName));
  // The review phase reads the proof a scenario test phase leaves on the workflow context; the scenario-proof Then steps read it from the World.
  world.scenarioProofResult = config.ctx.scenarioProof;
  return { adwId, orchestrator, phase, resolved, error, exitCode };
}

/** The definition is looked up first, so an unknown name fails before anything is written. */
export async function runSurfacePhase(world: RegressionWorld, adwId: string, orchestrator: string, phase: string): Promise<PhaseOutcome> {
  return runDefinedPhase(world, adwId, orchestrator, phase, phaseDefinition(orchestrator, phase));
}

export async function runDirectSurfacePhase(world: RegressionWorld, adwId: string, phase: string): Promise<PhaseOutcome> {
  return runDefinedPhase(world, adwId, DIRECT_PHASE_ORCHESTRATOR, phase, directPhaseDefinition(phase));
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
