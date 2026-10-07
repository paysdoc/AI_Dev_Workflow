/**
 * Phase scenarios of feature-992. Each runs the real `executeScenarioTestPhase` or the real `executeStepDefPhase` over the
 * throwaway worktree of feature-929's workflow, whose ".adw/" the scenario's steps describe (the declared application type,
 * the dev server, the scenario command). The scenario test phase finds the stand-in `npm` and `npx` first on `PATH` (see
 * feature-992-standins.ts); the step-definition phase starts feature-929's throwaway CLI and the scenario reads the
 * arguments it was started with.
 */

import { Given, When, Then } from '@cucumber/cucumber';
import assert from 'assert';
import * as path from 'path';

import { RunnerMode } from '../../../adws/core/applicationType.ts';
import { allocateRandomPort, isPortAvailable } from '../../../adws/core/portAllocator.ts';
import { loadProjectConfig } from '../../../adws/core/projectConfig.ts';
import { declaredApplicationProfile } from '../../../adws/phases/applicationTypeGate.ts';
import { executeScenarioTestPhase } from '../../../adws/phases/scenarioTestPhase.ts';
import { executeStepDefPhase } from '../../../adws/phases/stepDefPhase.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';

import { installCompactingCli, readRuns, type RunRecord } from './feature-929-compacting-cli.ts';
import { createWorkflow, type Workflow929 } from './feature-929-workflow.ts';
import { s as workflowWorld } from './feature-988-world.ts';
import { assertProjectMdFile } from './feature-991-project-md.ts';
import {
  ADW_DIRECTORY,
  COMMANDS_MD,
  SCENARIOS_MD,
  freshAdwFiles,
  setBddFramework,
  setRunScenariosByTag,
  setStartDevServer,
  stepDefDirectoryOf,
  writeAdwFiles,
  type AdwFiles,
} from './feature-992-adw-files.ts';
import { commandMatches, describeCalls, ranIn, runForTag, withoutAtSign } from './feature-992-calls.ts';
import { isInside, reportPathFor } from './feature-992-junit.ts';
import {
  commandLine,
  devServerCommand,
  devServerLog,
  recordedCalls,
  standIns,
  toolchain,
  withRealToolchain,
  withStandInsOnPath,
  writeStandIns,
} from './feature-992-standins.ts';
import { requireProof, requireWorkflow, s } from './feature-992-world.ts';
import { writeStandInScenario, writeWebProject } from './feature-992-worktree.ts';

const TARGET_REPOSITORY = 'adw-fixture/void-992';
const GENERATOR_COMMAND = '/generate_step_definitions';
const PHASE_TIMEOUT_MS = 300_000;
const STOP_POLLS = 40;
const STOP_POLL_MS = 150;

function requireAdwFiles(): AdwFiles {
  assert.ok(s.adwFiles, 'Expected a workflow whose ".adw/" the scenario describes to have been set up first');
  return s.adwFiles;
}

function assertFile(actual: string, expected: string): void {
  assert.strictEqual(actual, expected, `The scenarios describe the repository's "${expected}"`);
}

/** Points the workflow's configuration at what its worktree now holds, as `initializeWorkflow` does when a workflow starts. */
async function prepareWorkflow(workflow: Workflow929): Promise<void> {
  if (s.adwFiles) writeAdwFiles(workflow.worktreePath, s.adwFiles);
  const projectConfig = loadProjectConfig(workflow.worktreePath);
  const applicationProfile = declaredApplicationProfile(projectConfig);
  assert.ok(applicationProfile, `The worktree's ".adw/project.md" declares no application type ADW knows: ${JSON.stringify(projectConfig.applicationType)}`);
  s.port = await allocateRandomPort();
  workflow.config.projectConfig = projectConfig;
  workflow.config.applicationProfile = applicationProfile;
  workflow.config.applicationUrl = `http://localhost:${s.port}`;
}

Given("a workflow for issue {int} whose worktree's {string} declares the application type {string}", function (issueNumber: number, file: string, applicationType: string) {
  assertProjectMdFile(file);
  const workflow = createWorkflow(issueNumber, TARGET_REPOSITORY);
  workflowWorld.workflow = workflow;
  s.adwFiles = freshAdwFiles(applicationType);
  // A repository whose scenarios run on ADW's Playwright project holds that project, as `adw_init` leaves it.
  if (declaredApplicationProfile({ applicationType })?.runnerMode === RunnerMode.AdwPlaywright) writeWebProject(workflow.worktreePath);
});

Given("the worktree's {string} starts a dev server that answers on its health check path", function (file: string) {
  assertFile(file, COMMANDS_MD);
  setStartDevServer(requireAdwFiles(), devServerCommand(), toolchain.behaviour.devServer.healthPath);
  s.devServerLog = standIns().serverLog;
});

Given("the worktree's {string} runs scenarios by tag with {string}", function (directory: string, command: string) {
  assertFile(directory, ADW_DIRECTORY);
  setRunScenariosByTag(requireAdwFiles(), command);
});

Given(
  "the worktree's {string} runs scenarios by tag with a stand-in that records each run and writes a JUnit report in which every scenario passes",
  function (directory: string) {
    assertFile(directory, ADW_DIRECTORY);
    setRunScenariosByTag(requireAdwFiles(), `"${standIns().scenarioCommand}" {tag}`);
  },
);

Given(
  "the worktree's {string} names the BDD framework {string} and the step definition directory {string}",
  function (file: string, framework: string, stepDefDirectory: string) {
    assertFile(file, SCENARIOS_MD);
    setBddFramework(requireAdwFiles(), framework, stepDefDirectory);
  },
);

Given(
  'the worktree holds a feature tagged {string} in {string} and steps for it in {string}',
  function (tag: string, featureDirectory: string, stepDirectory: string) {
    writeStandInScenario(requireWorkflow().worktreePath, featureDirectory, stepDirectory, tag);
  },
);

Given(
  'the worktree holds a feature tagged {string} and steps for it in the step definition directory {string} names',
  function (tag: string, file: string) {
    assertFile(file, SCENARIOS_MD);
    writeStandInScenario(requireWorkflow().worktreePath, 'features/', stepDefDirectoryOf(requireAdwFiles()), tag);
  },
);

function assertStandIn(program: string): void {
  assert.strictEqual(program, 'npx', 'The scenarios stand in for "npx": it is what the run command of ADW\'s Playwright project runs');
}

Given('{string} is a stand-in that records each run and writes a JUnit report in which every scenario passes', function (program: string) {
  assertStandIn(program);
  toolchain.behaviour = { ...toolchain.behaviour, failingTags: [], playwrightExitCode: 0 };
});

Given('{string} is a stand-in that records each run, exits 0, and writes a JUnit report in which one scenario fails', function (program: string) {
  assertStandIn(program);
  const failingTag = `adw-${requireWorkflow().issueNumber}`;
  toolchain.behaviour = { ...toolchain.behaviour, failingTags: [failingTag], playwrightExitCode: 0 };
});

Given('{string} is a stand-in that records each run', function (program: string) {
  assertStandIn(program);
});

When("the workflow's scenario test phase runs", { timeout: PHASE_TIMEOUT_MS }, async function (this: RegressionWorld) {
  const workflow = requireWorkflow();
  await prepareWorkflow(workflow);
  const run = (): ReturnType<typeof executeScenarioTestPhase> => executeScenarioTestPhase(workflow.config);
  const { scenarioProof } = await (toolchain.real ? withRealToolchain(run) : withStandInsOnPath(writeStandIns(), run));
  this.scenarioProofResult = scenarioProof;
});

Then('{string} ran in {string} before {string} ran there for the tag {string}', function (first: string, directory: string, second: string, tag: string) {
  const where = path.join(requireWorkflow().worktreePath, directory);
  const calls = recordedCalls();
  const secondIndex = calls.findIndex(call => commandMatches(call, second) && ranIn(call, where) && call.tag === withoutAtSign(tag));
  assert.ok(secondIndex !== -1, `Expected "${second}" to have run in "${directory}" for the tag "${tag}", but the stand-ins recorded: ${describeCalls()}`);
  const firstRanBefore = calls.slice(0, secondIndex).some(call => commandMatches(call, first) && ranIn(call, where));
  assert.ok(firstRanBefore, `Expected "${first}" to have run in "${directory}" before "${second}" did, but the stand-ins recorded: ${describeCalls()}`);
});

Then('{string} was not run', function (command: string) {
  const runs = recordedCalls().filter(call => commandMatches(call, command));
  assert.deepStrictEqual(runs.map(commandLine), [], `Expected "${command}" not to have run, but the stand-ins recorded: ${describeCalls()}`);
});

Then("the scenario command {string} configures ran in the worktree's root for the tag {string}", function (directory: string, tag: string) {
  assertFile(directory, ADW_DIRECTORY);
  const run = runForTag('scenario-command', tag);
  assert.ok(ranIn(run, requireWorkflow().worktreePath), `Expected the scenario command to run in the worktree's root, but it ran in "${run.cwd}"`);
});

function servedPort(): number {
  assert.ok(s.devServerLog, "Expected the scenario's dev server to have been described first");
  const listening = devServerLog(s.devServerLog).filter(line => line.startsWith('listening '));
  const latest = listening[listening.length - 1];
  assert.ok(latest, `Expected the dev server to have listened, but it logged: ${JSON.stringify(devServerLog(s.devServerLog))}`);
  return Number(latest.slice('listening '.length));
}

Then(
  'the run of {string} for the tag {string} was given {string} holding the address of the dev server ADW started',
  function (command: string, tag: string, variable: string) {
    const run = runForTag(command, tag);
    const port = servedPort();
    assert.strictEqual(port, s.port, 'Expected the dev server to listen on the port the workflow was given');
    assert.strictEqual(run.env[variable], `http://localhost:${port}`, `Expected "${variable}" to hold the address of the dev server, which listened on port ${port}`);
  },
);

Then(
  "the run of {string} for the tag {string} was given {string} holding the scenario proof's report path for that tag, and {string} holding a directory of that tag's own inside the scenario proof's artifacts directory",
  function (this: RegressionWorld, command: string, tag: string, reportVariable: string, proofVariable: string) {
    const proof = requireProof(this);
    const run = runForTag(command, tag);
    assert.strictEqual(run.env[reportVariable], reportPathFor(proof, tag), `Expected "${reportVariable}" to hold the scenario proof's report path for "${tag}"`);

    const proofDir = run.env[proofVariable];
    assert.ok(proofDir && isInside(proofDir, proof.artifactsDir), `Expected "${proofVariable}" to hold a directory inside "${proof.artifactsDir}", but it holds "${proofDir}"`);
    const otherDirectories = recordedCalls().filter(call => commandMatches(call, command) && call.tag !== run.tag).map(call => call.env[proofVariable]);
    assert.ok(!otherDirectories.includes(proofDir), `Expected "${proofVariable}" to be the tag's own directory, but another run was given "${proofDir}" too`);
  },
);

async function waitUntilStopped(port: number): Promise<void> {
  for (let poll = 0; poll < STOP_POLLS; poll++) {
    if (await isPortAvailable(port)) return;
    await new Promise(resolve => setTimeout(resolve, STOP_POLL_MS));
  }
  assert.fail(`Expected the dev server on port ${port} to have been stopped by the end of the phase`);
}

Then(
  'the dev server ADW started answered throughout the run of {string} for the tag {string}, and was stopped by the end of the phase',
  async function (command: string, tag: string) {
    const run = runForTag(command, tag);
    const answers = (run.probes ?? []).map(({ phase, status }) => `${phase}:${status}`);
    assert.deepStrictEqual(answers, ['start:200', 'end:200'], `Expected the dev server to answer 200 before and after the run, got ${JSON.stringify(answers)}`);
    await waitUntilStopped(servedPort());
  },
);

Then('the scenario proof records the tag {string} as passed', function (this: RegressionWorld, tag: string) {
  const proof = requireProof(this);
  const result = proof.tagResults.find(({ resolvedTag }) => resolvedTag === tag);
  assert.ok(result, `Expected the scenario proof to have run the tag "${tag}", but it ran: ${proof.tagResults.map(({ resolvedTag }) => resolvedTag).join(', ')}`);
  assert.ok(result.passed && !result.skipped, `Expected "${tag}" to pass, but it did not (exit code ${result.exitCode}). Output:\n${result.output}`);
});

When("the workflow's step-definition phase runs", { timeout: PHASE_TIMEOUT_MS }, async function () {
  const workflow = requireWorkflow();
  await prepareWorkflow(workflow);
  workflowWorld.cli ??= installCompactingCli(workflowWorld.behaviour);
  await executeStepDefPhase(workflow.config);
});

function generatorRuns(): RunRecord[] {
  assert.ok(workflowWorld.cli, "Expected the workflow's step-definition phase to have run first");
  return readRuns(workflowWorld.cli.runLogPath).filter(run => run.command === GENERATOR_COMMAND);
}

/** The agent's prompt is its slash command and its arguments, each in single quotes. */
function startedWith(run: RunRecord): string[] {
  return [...run.prompt.matchAll(/'((?:[^']|'\\'')*)'/g)].map(match => match[1].replace(/'\\''/g, "'"));
}

function onlyGeneratorRun(): RunRecord {
  const runs = generatorRuns();
  assert.strictEqual(runs.length, 1, `Expected the step-definition generator to have been started once, but it was started ${runs.length} times`);
  return runs[0];
}

function assertStartedInMode(mode: RunnerMode): void {
  const [, , startedMode] = startedWith(onlyGeneratorRun());
  assert.strictEqual(startedMode, mode, `Expected the step-definition generator to be started in the mode "${mode}", but it was started with "${startedMode}"`);
}

Then('the step-definition generator was started once, for issue {int}', function (issueNumber: number) {
  const [startedFor] = startedWith(onlyGeneratorRun());
  assert.strictEqual(startedFor, String(issueNumber), `Expected the step-definition generator to be started for issue ${issueNumber}`);
});

Then("the step-definition generator was started in the mode for ADW's Playwright project", function () {
  assertStartedInMode(RunnerMode.AdwPlaywright);
});

Then('the step-definition generator was started in the mode for the scenario runner that {string} describes', function (file: string) {
  assertFile(file, SCENARIOS_MD);
  assertStartedInMode(RunnerMode.Descriptor);
});
