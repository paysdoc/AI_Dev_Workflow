import * as path from 'path';
import { log, AgentStateManager, emptyModelUsageMap, type LogLevel } from '../core';
import {
  BaselineStatus,
  isBaselineWaived,
  runBaselineChecks,
  type BaselineEvent,
  type BaselineInput,
  type BaselineVerdict,
  type DevServerStartResult,
} from '../core/baselineGate';
import { runShellCommand, type ProcessRunner } from '../core/checkRunner';
import { devServerPort, withHealthyDevServer } from '../core/devServerLifecycle';
import type { PhaseResult } from '../core/phaseRunner';
import { loadProjectConfig } from '../core/projectConfig';
import { ParkReason } from '../forge/parkComment';
import { sharedBaseWorktree, type BaseCheckout, type BaseWorktreePort } from './baseWorktree';
import { readDeclaredDevServer } from './declaredDevServer';
import { logCheckVerdict } from './staticCheckGate';
import type { WorkflowConfig } from './workflowInit';
import { parkWorkflow } from './workflowPark';

const CHECK_LABEL = 'Base branch check';

export interface DevServerStartSpec {
  readonly command: string;
  readonly cwd: string;
  readonly port: number;
  readonly healthPath: string;
  readonly outputPath: string;
}

export interface BaselinePhaseDeps {
  readonly baseWorktree: BaseWorktreePort;
  readonly runProcess: ProcessRunner;
  readonly startDevServer: (spec: DevServerStartSpec) => Promise<DevServerStartResult>;
  readonly now: () => Date;
}

async function startAndStopDevServer(spec: DevServerStartSpec): Promise<DevServerStartResult> {
  const outcome = await withHealthyDevServer(
    { startCommand: spec.command, port: spec.port, healthPath: spec.healthPath, cwd: spec.cwd, outputPath: spec.outputPath },
    async () => undefined,
  );
  return outcome.started ? { healthy: true, output: '' } : { healthy: false, output: outcome.output };
}

function zeroResult(): PhaseResult {
  return { costUsd: 0, modelUsage: emptyModelUsageMap(), phaseCostRecords: [] };
}

function recordLine(statePath: string, message: string, level: LogLevel): void {
  log(message, level);
  AgentStateManager.appendLog(statePath, message);
}

function outputOf(output: string): string {
  return output.trim() === '' ? '(no output)' : output.trimEnd();
}

function logEvent(statePath: string, event: BaselineEvent): void {
  switch (event.kind) {
    case 'dependencies_installed':
      if (event.exitCode === 0) {
        recordLine(statePath, `Base branch install passed: ${event.command}`, 'success');
        return;
      }
      recordLine(statePath, `Base branch install failed (exit ${event.exitCode ?? 'none'}): ${event.command}`, 'error');
      recordLine(statePath, outputOf(event.output), 'error');
      return;
    case 'checks_ran':
      event.verdicts.forEach(verdict => logCheckVerdict(statePath, verdict, CHECK_LABEL));
      return;
    case 'dev_server_checked':
      if (event.result.healthy) {
        recordLine(statePath, 'Base branch dev server started, answered its health check and was stopped', 'success');
        return;
      }
      recordLine(statePath, 'Base branch dev server did not start; its output:', 'error');
      recordLine(statePath, outputOf(event.result.output), 'error');
      return;
  }
}

function serverStarter(
  config: WorkflowConfig,
  checkout: BaseCheckout,
  healthCheckPath: string,
  declaredServer: string | null,
  startDevServer: BaselinePhaseDeps['startDevServer'],
): BaselineInput['startDevServer'] {
  if (declaredServer === null) return undefined;
  const spec: DevServerStartSpec = {
    command: declaredServer,
    cwd: checkout.path,
    port: devServerPort(config.applicationUrl),
    healthPath: healthCheckPath || '/',
    outputPath: path.join(config.logsDir, 'base-dev-server.log'),
  };
  return () => startDevServer(spec);
}

function recordPassedBaseline(config: WorkflowConfig, checkout: BaseCheckout, recordedAt: Date): void {
  AgentStateManager.writeTopLevelState(config.adwId, {
    baseline: {
      status: BaselineStatus.Passed,
      baseBranch: checkout.baseBranch,
      baseCommit: checkout.commit,
      recordedAt: recordedAt.toISOString(),
    },
  });
  recordLine(config.orchestratorStatePath, `Baseline green on ${checkout.baseBranch} at ${checkout.commit}`, 'success');
}

function settle(config: WorkflowConfig, checkout: BaseCheckout, verdict: BaselineVerdict, now: () => Date): PhaseResult {
  switch (verdict.kind) {
    case 'green':
      recordPassedBaseline(config, checkout, now());
      return zeroResult();
    case 'checks_red':
      return parkWorkflow(config, { reason: ParkReason.BaselineRed, baseBranch: checkout.baseBranch, failedChecks: verdict.failed });
    case 'server_down':
      return parkWorkflow(config, { reason: ParkReason.BaseServerDown, baseBranch: checkout.baseBranch, output: verdict.output });
  }
}

/**
 * Checks the base branch before any work starts: its dependencies are installed, its static checks run and its
 * declared dev server is started and stopped again, all in a checkout of its own. A red base parks the workflow.
 * The checkout is shared with the single-scenario re-runs of the scenario fix loop and removed when the process exits.
 */
export async function executeBaselinePhase(config: WorkflowConfig, deps: Partial<BaselinePhaseDeps> = {}): Promise<PhaseResult> {
  const statePath = config.orchestratorStatePath;
  log('Phase: Baseline', 'info');
  AgentStateManager.appendLog(statePath, 'Starting baseline phase');

  if (isBaselineWaived(AgentStateManager.readTopLevelState(config.adwId)?.baseline)) {
    recordLine(statePath, 'Baseline waived by `## Continue`: the base branch is not checked, and this run fixes the pre-existing failures too', 'info');
    return zeroResult();
  }

  const baseWorktree = deps.baseWorktree ?? sharedBaseWorktree(config);
  const runProcess = deps.runProcess ?? runShellCommand;
  const startDevServer = deps.startDevServer ?? startAndStopDevServer;
  const now = deps.now ?? (() => new Date());

  const checkout = baseWorktree.ensure();
  recordLine(statePath, `Baseline: base branch ${checkout.baseBranch} at ${checkout.commit} is checked out in ${checkout.path}`, 'info');

  const project = loadProjectConfig(checkout.path);
  const declaredServer = readDeclaredDevServer(checkout.path);
  const verdict = await runBaselineChecks({
    commands: project.commands,
    cwd: checkout.path,
    runProcess,
    startDevServer: serverStarter(config, checkout, project.commands.healthCheckPath, declaredServer, startDevServer),
    report: event => logEvent(statePath, event),
  });
  return settle(config, checkout, verdict, now);
}
