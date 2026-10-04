import { log, AgentStateManager, emptyModelUsageMap, type LogLevel, type ModelUsageMap } from '../core';
import { runStaticChecks, CheckStatus, type CheckVerdict, type ProcessRunner } from '../core/checkRunner';
import { buildFixRoundGuardConfig, describeGuardRejection, type FixRoundGuardConfig } from '../core/fixRoundGuard';
import { inferStackLanguages } from '../core/stackCoherenceCheck';
import { runStaticCheckFixLoop, type FixLoopEvent, type FixRoundPort, type StaticCheckFixLoopResult } from '../core/staticCheckFixLoop';
import { ParkReason, type ParkEvidence } from '../forge/parkComment';
import { buildStaticCheckFixRoundPort } from './staticCheckFixRound';
import { parkWorkflow } from './workflowPark';
import type { WorkflowConfig } from './workflowInit';

export interface StaticCheckGateDeps {
  readonly runProcess: ProcessRunner;
  readonly fixRounds?: FixRoundPort;
}

export interface StaticCheckGateResult {
  readonly costUsd: number;
  readonly modelUsage: ModelUsageMap;
  readonly fixRounds: number;
}

type ChecksRunner = () => Promise<readonly CheckVerdict[]>;

function recordLine(statePath: string, message: string, level: LogLevel): void {
  log(message, level);
  AgentStateManager.appendLog(statePath, message);
}

function describeFailedCheck(verdict: CheckVerdict): string {
  return `${verdict.check} (exit ${verdict.exitCode ?? 'none'})`;
}

function logCheckVerdict(statePath: string, verdict: CheckVerdict): void {
  if (verdict.status === CheckStatus.Skipped) {
    recordLine(statePath, `Static check skipped (N/A): ${verdict.check}`, 'info');
    return;
  }
  if (verdict.status === CheckStatus.Passed) {
    recordLine(statePath, `Static check passed: ${verdict.check} — ${verdict.command}`, 'success');
    return;
  }
  recordLine(statePath, `Static check failed: ${describeFailedCheck(verdict)} — ${verdict.command}`, 'error');
  recordLine(statePath, verdict.output.trim() === '' ? '(no output)' : verdict.output.trimEnd(), 'error');
}

function logLoopEvent(statePath: string, event: FixLoopEvent): void {
  switch (event.kind) {
    case 'checks_ran':
      return;
    case 'round_started':
      recordLine(statePath, `Static-check fix round ${event.round}: fixing ${event.failed.map(describeFailedCheck).join(', ')}`, 'info');
      return;
    case 'round_kept':
      recordLine(statePath, `Static-check fix round ${event.round} kept; running the static checks again`, 'info');
      return;
    case 'round_rejected':
      recordLine(statePath, `Static-check fix round ${event.round} rejected by the fix-round guard and reverted:`, 'warn');
      event.reasons.forEach(reason => recordLine(statePath, `  ${describeGuardRejection(reason)}`, 'warn'));
      return;
  }
}

function guardConfigFor(config: WorkflowConfig): FixRoundGuardConfig {
  const { commands, scenarios } = config.projectConfig;
  const languages = inferStackLanguages({
    testFramework: commands.testFramework,
    bddFramework: scenarios.bddFramework,
    runTests: commands.runTests,
    runScenariosByTag: commands.runScenariosByTag,
  });
  const guardConfig = buildFixRoundGuardConfig(languages, commands.suppressionPatterns);
  guardConfig.ignoredAdditions.forEach((entry) => {
    recordLine(
      config.orchestratorStatePath,
      `Fix-round guard: ignoring "${entry}" in the suppression patterns of .adw/commands.md; an entry cannot remove a pattern`,
      'warn',
    );
  });
  return guardConfig;
}

function stalledEvidence(result: Extract<StaticCheckFixLoopResult, { kind: 'stalled' }>): ParkEvidence {
  return {
    reason: ParkReason.FixLoopStalled,
    failedChecks: result.failed.map(({ check, command, exitCode, output }) => ({ check, command, exitCode, output })),
    stall: result.stall,
    rounds: result.rounds,
    rejections: result.rejections.map(describeGuardRejection),
  };
}

/** The guard configuration and the real port, which needs the launch's git context, exist only once a check is red. */
async function fixFailingChecks(
  config: WorkflowConfig,
  deps: StaticCheckGateDeps,
  runChecks: ChecksRunner,
  firstRun: readonly CheckVerdict[],
): Promise<StaticCheckGateResult> {
  const statePath = config.orchestratorStatePath;
  // The loop starts by running the checks; it is handed the run that was just made, so none runs twice.
  let unreadRun: readonly CheckVerdict[] | undefined = firstRun;

  const result = await runStaticCheckFixLoop({
    runChecks: async () => {
      const run = unreadRun ?? (await runChecks());
      unreadRun = undefined;
      return run;
    },
    fixRounds: deps.fixRounds ?? buildStaticCheckFixRoundPort(config),
    guardConfig: guardConfigFor(config),
    report: event => logLoopEvent(statePath, event),
  });

  if (result.kind === 'stalled') {
    recordLine(statePath, `Static-check fix loop stalled (${result.stall}) after ${result.rounds} fix round(s)`, 'warn');
    return parkWorkflow(config, stalledEvidence(result));
  }
  recordLine(statePath, `Static checks green after ${result.rounds} fix round(s)`, 'success');
  return { costUsd: result.costUsd, modelUsage: result.modelUsage, fixRounds: result.rounds };
}

/**
 * Every check run is logged, with the full output of the checks that failed. A loop that stops making progress
 * parks the workflow and does not return; the run only goes on once the checks are green.
 */
export async function runStaticCheckGate(config: WorkflowConfig, deps: StaticCheckGateDeps): Promise<StaticCheckGateResult> {
  const statePath = config.orchestratorStatePath;
  log('Phase: Static Checks', 'info');
  AgentStateManager.appendLog(statePath, 'Starting test phase: Static Checks');

  const runChecks: ChecksRunner = async () => {
    const verdicts = await runStaticChecks(config.projectConfig.commands, config.worktreePath, deps.runProcess);
    verdicts.forEach(verdict => logCheckVerdict(statePath, verdict));
    return verdicts;
  };

  const firstRun = await runChecks();
  if (!firstRun.some(verdict => verdict.status === CheckStatus.Failed)) {
    return { costUsd: 0, modelUsage: emptyModelUsageMap(), fixRounds: 0 };
  }
  return fixFailingChecks(config, deps, runChecks, firstRun);
}
