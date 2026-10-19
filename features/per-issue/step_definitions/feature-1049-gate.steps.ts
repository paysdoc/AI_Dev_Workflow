/**
 * The Given and When steps of feature-1049. The workflow, its ".adw/" and the stand-in device host come from the steps of
 * features 992 and 1047; here the scenario says what runs the worktree's scenarios, which branch holds the same ".adw/", and
 * whether the baseline was waived, and then the real `createPreExistingRegressionGate` judges the scenarios that fail on the
 * issue's branch against a real base checkout, over the stand-in device host. The gate's park is the real one, with
 * `process.exit` trapped: the state and the comment are written, and what the host held at that moment is kept.
 */

import { Given, When } from '@cucumber/cucumber';
import assert from 'assert';

import { AgentStateManager } from '../../../adws/core/agentState.ts';
import { BaselineStatus } from '../../../adws/core/baselineGate.ts';
import { BASE_RERUN_TAG } from '../../../adws/phases/baseScenarioRerun.ts';
import { createPreExistingRegressionGate } from '../../../adws/phases/preExistingRegressionGate.ts';
import type { ScenarioProofResult } from '../../../adws/phases/scenarioProof.ts';

import type { Workflow929 } from '../../regression/step_definitions/feature-929-workflow.ts';
import { ADW_DIRECTORY, setInstallDependencies, setRunScenariosByTag } from '../../regression/step_definitions/feature-992-adw-files.ts';
import { TrappedExit, trappingExit } from '../../regression/step_definitions/feature-992-exit.ts';
import { prepareWorkflow, requireAdwFiles } from '../../regression/step_definitions/feature-992-phase.steps.ts';
import { toolchain, withStandInsOnPath, writeStandIns } from '../../regression/step_definitions/feature-992-standins.ts';
import { requireWorkflow } from '../../regression/step_definitions/feature-992-world.ts';
import { lastStandInDeviceHost, standInDeviceHost, type StandInDeviceHost } from '../../regression/support/standInDevices.ts';
import { DEVICE_VARIABLES, runnerCommand, writeScenarioRunner, type ScenarioOutcomes } from './feature-990-scripts.ts';
import { BASE_BRANCH, requireScratch, s as state990 } from './feature-990-world.ts';
import { commitBaseBranch, proofOnIssueBranch, useGitOfTheWorktree } from './feature-1049-base.ts';
import { requireBaseBranch, requireRunner, s } from './feature-1049-world.ts';

const CONTINUE_DIRECTIVE = '## Continue';
/** The park a baseline is waived for in the scenarios: the one a red baseline leaves. */
const WAIVED_PARK = 'baseline_red';
const STAND_IN_NPX = 'npx';
const GATE_TIMEOUT_MS = 120_000;

function assertAdwDirectory(directory: string): void {
  assert.strictEqual(directory, ADW_DIRECTORY, `The scenarios describe the repository's "${ADW_DIRECTORY}"`);
}

Given(
  "the worktree's {string} runs scenarios by tag with a stand-in that records each run and reports each scenario with the outcome it has on the branch it runs on",
  function (directory: string) {
    assertAdwDirectory(directory);
    setRunScenariosByTag(requireAdwFiles(), `${runnerCommand(requireScratch())} {tag}`);
    s.runner = 'scenario-runner';
  },
);

Given('{string} is a stand-in that records each run and reports each scenario with the outcome it has on the branch it runs on', function (program: string) {
  assert.strictEqual(program, STAND_IN_NPX, `The scenarios stand in for "${STAND_IN_NPX}": it is what the run command of ADW's Playwright project runs`);
  s.runner = 'npx';
});

Given('the base branch {string} holds the same {string} as the worktree', function (branch: string, directory: string) {
  assert.strictEqual(branch, BASE_BRANCH, `The scenarios' base branch is "${BASE_BRANCH}"`);
  assertAdwDirectory(directory);
  s.baseBranch = branch;
});

Given(
  'every scenario of the target repository fails when any of {string}, {string} and {string} is missing from the environment it runs in',
  function (avdVariable: string, serialVariable: string, udidVariable: string) {
    assert.deepStrictEqual([avdVariable, serialVariable, udidVariable], [...DEVICE_VARIABLES], 'The variables the devices of a run are handed in');
    s.requiresDevices = true;
  },
);

Given("the owner has waived the workflow's baseline with {string}", function (directive: string) {
  assert.strictEqual(directive, CONTINUE_DIRECTIVE, `The directive that waives a baseline is "${CONTINUE_DIRECTIVE}"`);
  const { adwId, issueNumber } = requireWorkflow();
  // What "## Continue" leaves in the state of a workflow parked for a red baseline, and what the gate reads.
  AgentStateManager.writeTopLevelState(adwId, {
    adwId,
    issueNumber,
    baseline: { status: BaselineStatus.Waived, waivedPark: WAIVED_PARK, recordedAt: new Date().toISOString() },
  });
});

/** The program the worktree's ".adw/" names answers each scenario as the table says it does on the branch it runs on. */
function answerAsTheTableSays(scenarios: readonly ScenarioOutcomes[]): void {
  if (requireRunner() === 'scenario-runner') {
    writeScenarioRunner(requireScratch(), { requiresServer: false, requiresDevices: s.requiresDevices }, scenarios);
    return;
  }
  // "npx" answers by tag, and the re-run runs one scenario under one tag: the scenario names the one scenario it is asked about.
  assert.strictEqual(scenarios.length, 1, `The stand-in "${STAND_IN_NPX}" answers for the one tag the re-run runs, so the scenario names one scenario`);
  toolchain.behaviour = { ...toolchain.behaviour, failingTags: scenarios[0].onBaseBranch === 'fails' ? [BASE_RERUN_TAG] : [] };
}

function recordWhatTheHostHolds(host: StandInDeviceHost): void {
  s.atPark = { commands: [...host.commands], running: host.runningEmulators() };
}

async function judgeOnBase(workflow: Workflow929, proof: ScenarioProofResult): Promise<void> {
  const host = lastStandInDeviceHost() ?? standInDeviceHost();
  const gate = createPreExistingRegressionGate(workflow.config, { withDevices: host.withDevices });
  const run = (): Promise<void> => trappingExit(() => gate(proof), () => recordWhatTheHostHolds(host));
  try {
    await withStandInsOnPath(writeStandIns(), run);
  } catch (error) {
    if (!(error instanceof TrappedExit && error.exitCode === 0)) throw error;
  }
}

When("the regression scenarios that fail on the issue's branch are judged against the base branch", { timeout: GATE_TIMEOUT_MS }, async function () {
  const workflow = requireWorkflow();
  const baseBranch = requireBaseBranch();
  const scenarios = state990.scenarios;

  // The stand-ins run the scenarios, so the base checkout has nothing to install.
  setInstallDependencies(requireAdwFiles(), 'N/A');
  await prepareWorkflow(workflow);
  workflow.config.defaultBranch = baseBranch;
  commitBaseBranch(workflow, baseBranch, scenarios);
  useGitOfTheWorktree(workflow);
  answerAsTheTableSays(scenarios);
  await judgeOnBase(workflow, proofOnIssueBranch(scenarios));
});
