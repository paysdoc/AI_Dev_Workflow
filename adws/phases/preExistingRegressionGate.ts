import { log, AgentStateManager, type LogLevel } from '../core';
import { isBaselineWaived, type BaselineRecord } from '../core/baselineGate';
import {
  BaseScenarioOutcome,
  describeFailingScenario,
  triageRegressionFailures,
  type FailingScenario,
  type ScenarioRerun,
  type TriagedScenario,
} from '../core/regressionTriage';
import { ParkReason } from '../forge/parkComment';
import { buildBaseScenarioRerun } from './baseScenarioRerun';
import type { ScenarioProofResult } from './scenarioProof';
import { parkWorkflow } from './workflowPark';
import type { WorkflowConfig } from './workflowInit';

const REGRESSION_TAG = '@regression';

export type PreExistingRegressionGate = (proof: ScenarioProofResult) => Promise<void>;

export interface PreExistingRegressionGateDeps {
  readonly rerunOnBase: ScenarioRerun;
  readonly readBaseline: () => BaselineRecord | undefined;
}

/** `null` when the tag failed without per-case results: the failing scenarios cannot be told apart. */
export function failingRegressionScenarios(proof: ScenarioProofResult): readonly FailingScenario[] | null {
  const result = proof.tagResults.find(tag => tag.resolvedTag === REGRESSION_TAG);
  if (!result || result.passed || result.skipped) return [];
  if (!result.cases) return null;
  return result.cases
    .filter(testCase => testCase.status === 'failed')
    .map(({ name, classname }) => (classname === undefined ? { name } : { name, feature: classname }));
}

function recordLine(statePath: string, message: string, level: LogLevel): void {
  log(message, level);
  AgentStateManager.appendLog(statePath, message);
}

function describeOutcome({ scenario, outcome }: TriagedScenario): { message: string; level: LogLevel } {
  const name = describeFailingScenario(scenario);
  switch (outcome) {
    case BaseScenarioOutcome.Failed:
      return { message: `Regression scenario "${name}" also fails on the base branch: pre-existing`, level: 'warn' };
    case BaseScenarioOutcome.Passed:
      return { message: `Regression scenario "${name}" passes on the base branch: introduced by this change`, level: 'info' };
    case BaseScenarioOutcome.NotRun:
      return { message: `Regression scenario "${name}" could not be run on the base branch: treated as introduced by this change`, level: 'info' };
  }
}

function logTriaged(statePath: string, triaged: readonly TriagedScenario[]): void {
  triaged.forEach((entry) => {
    const { message, level } = describeOutcome(entry);
    recordLine(statePath, message, level);
  });
}

/**
 * The real re-run is built on first need, so a run whose regression scenarios pass never touches git.
 * Returns only when no failing regression scenario also fails on the base branch; otherwise it parks.
 */
export function createPreExistingRegressionGate(
  config: WorkflowConfig,
  deps: Partial<PreExistingRegressionGateDeps> = {},
): PreExistingRegressionGate {
  const statePath = config.orchestratorStatePath;
  let realRerun: ScenarioRerun | undefined;
  const rerunOnBase: ScenarioRerun = deps.rerunOnBase ?? (scenario => {
    realRerun ??= buildBaseScenarioRerun(config);
    return realRerun(scenario);
  });
  const readBaseline = deps.readBaseline ?? (() => AgentStateManager.readTopLevelState(config.adwId)?.baseline);

  return async (proof) => {
    const failing = failingRegressionScenarios(proof);
    if (failing === null) {
      recordLine(statePath, 'The failing regression scenarios cannot be identified (no per-case results): they go to the fix agent', 'warn');
      return;
    }
    if (failing.length === 0) return;

    const triage = await triageRegressionFailures({ failing, waived: isBaselineWaived(readBaseline()), rerunOnBase });
    if (triage.kind === 'waived') {
      recordLine(statePath, 'The baseline was waived by `## Continue`: the failing regression scenarios go to the fix agent', 'info');
      return;
    }

    logTriaged(statePath, triage.triaged);
    if (triage.kind === 'pre_existing') {
      parkWorkflow(config, {
        reason: ParkReason.PreExistingRegression,
        baseBranch: config.defaultBranch,
        scenario: describeFailingScenario(triage.scenario),
      });
    }
  };
}
