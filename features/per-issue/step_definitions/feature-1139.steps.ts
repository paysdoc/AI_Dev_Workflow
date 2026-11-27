/**
 * The scenarios of feature-1139.feature run adwSdlc as a process in the cli-tool workspace, which the steps give a list of Real
 * Boundaries and a stand-in scenario runner. The manifest the claude-cli-stub is loaded with is what writes the issue's feature
 * file and answers the scenario fix agent, so the steps that rely on what it writes check the manifest. The stand-in reports only
 * the scenarios described to it, so each step that adds a scenario describes it as passing under its tag.
 */

import { Given, Then } from '@cucumber/cucumber';
import assert from 'assert';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';

import { AGENTS_STATE_DIR, LOGS_DIR } from '../../../adws/core/config.ts';
import { OrchestratorId } from '../../../adws/core/index.ts';
import { commitOnDefaultBranch } from '../../regression/support/fixtureTargetRepo.ts';
import { ensureTargetWorkspace, requireHarness } from '../../regression/support/subprocessHarness.ts';
import { FEATURE_FILE, featureFile, stepDefinitionFiles } from '../../regression/step_definitions/feature-1101-content.ts';
import { describeScenarios, installStandIn, runByTagCommand, standInRuns, type ScenarioRow } from '../../regression/step_definitions/feature-1101-standin.ts';
import { argumentsOf } from '../../regression/step_definitions/feature-995-prompt.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';

const SCENARIOS_FILE = '.adw/scenarios.md';
const COMMANDS_FILE = '.adw/commands.md';
const RUN_BY_TAG_BLOCK = /(## Run Scenarios by Tag\n\n```sh\n)[\s\S]*?(\n```)/;
const BOUNDARY_TAG = /^@boundary-/;
/** One line of the orchestrator's execution log for each failed tag that the scenario fix phase hands to the fix agent. */
const FIX_STARTED = 'Resolving failed scenario:';
const FIX_AGENT_OUTPUT = /^resolve-e2e-.*\.jsonl$/;

interface ManifestEdit {
  readonly path: string;
  readonly contents: string;
}

function claimedAdwId(world: RegressionWorld): string {
  const adwIds = [...requireHarness(world).claimedAdwIds];
  assert.strictEqual(adwIds.length, 1, `Expected exactly one workflow to have run, but the claimed adwIds are: ${adwIds.join(', ') || 'none'}`);
  return adwIds[0];
}

function seededIssue(world: RegressionWorld): number {
  const issues = [...world.seededIssues];
  assert.strictEqual(issues.length, 1, `Expected the scenario to seed exactly one issue, but it seeded: ${issues.join(', ') || 'none'}`);
  return issues[0];
}

function manifestEditsOf(world: RegressionWorld, command: string): readonly ManifestEdit[] {
  const manifestPath = world.harnessEnv['MOCK_MANIFEST_PATH'];
  assert.ok(manifestPath, 'Expected the claude-cli-stub to be loaded with a manifest first');
  const entry = JSON.parse(readFileSync(manifestPath, 'utf-8')).byCommand?.[command];
  assert.ok(entry, `Expected the manifest ${manifestPath} to answer ${command}`);
  return entry.edits ?? [];
}

function tagsOnLineAbove(lines: readonly string[], index: number): string[] {
  const above = index > 0 ? lines[index - 1] : '';
  return above.startsWith('@') ? above.split(/\s+/) : [];
}

/** The tags of the Feature and of the scenario: the tag lines right above `Feature:` and above the scenario's own line. */
function tagsOfScenario(featureText: string, scenario: string): string[] {
  const lines = featureText.split('\n').map((line) => line.trim());
  const scenarioAt = lines.indexOf(`Scenario: ${scenario}`);
  const featureAt = lines.findIndex((line) => line.startsWith('Feature:'));
  return [...tagsOnLineAbove(lines, featureAt), ...tagsOnLineAbove(lines, scenarioAt)];
}

/** The tags the scenario agent gives the scenario, from the one feature file the manifest's `/scenario_writer` writes holding it. */
function tagsTheScenarioAgentWrites(world: RegressionWorld, scenario: string, issueNumber: number): string[] {
  const holding = manifestEditsOf(world, '/scenario_writer').filter((edit) => edit.path.endsWith('.feature') && edit.contents.includes(`Scenario: ${scenario}`));
  assert.strictEqual(holding.length, 1, `Expected the scenario agent to write the scenario "${scenario}" into one feature file, but it writes it into ${holding.length}`);
  const tags = tagsOfScenario(holding[0].contents, scenario);
  assert.ok(tags.includes(`@adw-${issueNumber}`), `Expected the scenario agent to tag "${scenario}" @adw-${issueNumber}, but its tags are: ${tags.join(' ') || 'none'}`);
  return tags;
}

function describePassing(world: RegressionWorld, tag: string, scenario: string): void {
  const row: ScenarioRow = { tag, scenario, result: { kind: 'passes' } };
  describeScenarios(requireHarness(world), [row]);
}

function withRunByTag(markdown: string, command: string, file: string): string {
  assert.ok(RUN_BY_TAG_BLOCK.test(markdown), `Expected "${file}" of the fixture to hold a fenced "## Run Scenarios by Tag" block`);
  return markdown.replace(RUN_BY_TAG_BLOCK, (_block, head: string, tail: string) => `${head}${command}${tail}`);
}

Given("the target repository's scenario configuration declares the Real Boundary {string}", function (this: RegressionWorld, name: string) {
  const workspace = ensureTargetWorkspace(this);
  const current = readFileSync(join(workspace, SCENARIOS_FILE), 'utf-8');
  const entry = `- \`${name}\` — a real invocation of the tool's command line`;
  const declared = `${current.trimEnd()}\n\n## Real Boundaries\n${entry}\n`;
  commitOnDefaultBranch(workspace, SCENARIOS_FILE, declared, `Declare the Real Boundary ${name}`);
});

Given("the target repository's workspace runs its scenarios by tag with a stand-in that passes every scenario", function (this: RegressionWorld) {
  const harness = requireHarness(this);
  const workspace = ensureTargetWorkspace(this);
  installStandIn(harness);

  const runByTag = runByTagCommand(harness);
  for (const file of [COMMANDS_FILE, SCENARIOS_FILE]) {
    const configured = withRunByTag(readFileSync(join(workspace, file), 'utf-8'), runByTag, file);
    commitOnDefaultBranch(workspace, file, configured, `Run the scenarios by tag with the stand-in (${file})`);
  }
  for (const [path, contents] of Object.entries(stepDefinitionFiles())) commitOnDefaultBranch(workspace, path, contents, `Add ${path}`);
});

Given('the scenario agent writes the scenario {string} for issue {int} with no boundary tag', function (this: RegressionWorld, scenario: string, issueNumber: number) {
  const tags = tagsTheScenarioAgentWrites(this, scenario, issueNumber);
  assert.deepStrictEqual(tags.filter((tag) => BOUNDARY_TAG.test(tag)), [], `Expected the scenario agent to give "${scenario}" no boundary tag`);
  describePassing(this, `@adw-${issueNumber}`, scenario);
});

Given(
  'the scenario agent writes the scenario {string} for issue {int}, tagged with the declared boundary {string}',
  function (this: RegressionWorld, scenario: string, issueNumber: number, boundary: string) {
    const declared = readFileSync(join(ensureTargetWorkspace(this), SCENARIOS_FILE), 'utf-8');
    assert.ok(declared.includes(`## Real Boundaries\n- \`${boundary}\``), `Expected the target repository's ${SCENARIOS_FILE} to declare the Real Boundary "${boundary}" first`);
    const tags = tagsTheScenarioAgentWrites(this, scenario, issueNumber);
    assert.ok(tags.includes(`@boundary-${boundary}`), `Expected the scenario agent to tag "${scenario}" @boundary-${boundary}, but its tags are: ${tags.join(' ')}`);
    describePassing(this, `@adw-${issueNumber}`, scenario);
  },
);

Given('the scenario fix agent leaves the scenario {string} without a boundary tag', function (this: RegressionWorld, scenario: string) {
  const featureEdits = manifestEditsOf(this, '/resolve_failed_scenario').filter((edit) => edit.path.endsWith('.feature'));
  assert.deepStrictEqual(featureEdits.map((edit) => edit.path), [], `Expected the scenario fix agent to edit no feature file, so that "${scenario}" keeps no boundary tag`);
});

Given("the target repository's Regression Suite holds the scenario {string}, which carries no boundary tag", function (this: RegressionWorld, scenario: string) {
  const row: ScenarioRow = { tag: '@regression', scenario, result: { kind: 'passes' } };
  commitOnDefaultBranch(ensureTargetWorkspace(this), FEATURE_FILE, featureFile([row]), 'Add the regression scenario');
  describeScenarios(requireHarness(this), [row]);
});

/** The fix agent's input is the JSON of the failed tag, the one argument of the `/resolve_failed_scenario` command line it was started with. */
function lastFixAgentInput(world: RegressionWorld): { readonly testName: string; readonly error: string } {
  const statePath = join(AGENTS_STATE_DIR, claimedAdwId(world), OrchestratorId.Sdlc, 'scenario-fix');
  const promptPath = join(statePath, 'prompts', 'resolve_failed_scenario.txt');
  assert.ok(existsSync(promptPath), `Expected the scenario fix agent to have been started, but ${promptPath} does not exist`);
  const [input] = argumentsOf(readFileSync(promptPath, 'utf-8'));
  return JSON.parse(input ?? '{}');
}

Then(
  'the scenario fix agent was handed the scenario {string} as failing because it carries no boundary tag',
  function (this: RegressionWorld, scenario: string) {
    const { testName, error } = lastFixAgentInput(this);
    assert.strictEqual(testName, `@adw-${seededIssue(this)}`, `Expected the fix agent to be handed the issue's scenarios as failing, but it was handed ${testName}`);
    const naming = (error ?? '').split('\n').filter((line) => line.includes(scenario) && line.includes('carries no boundary tag'));
    assert.strictEqual(naming.length, 1, `Expected the failure handed to the fix agent to say once that "${scenario}" carries no boundary tag, but it reads:\n${error}`);
  },
);

Then('the stand-in ran no scenario', function (this: RegressionWorld) {
  const runs = standInRuns(requireHarness(this));
  assert.deepStrictEqual(runs, [], `Expected the scenario runner not to have run, but it ran: ${runs.map((run) => run.tag).join(', ')}`);
});

Then('the stand-in ran the scenarios of both {string} and {string}', function (this: RegressionWorld, first: string, second: string) {
  const ranTags = new Set(standInRuns(requireHarness(this)).map((run) => run.tag));
  const missing = [first, second].filter((tag) => !ranTags.has(tag));
  assert.deepStrictEqual(missing, [], `Expected the scenario runner to have run ${missing.join(' and ')}, but it ran: ${[...ranTags].join(', ') || 'nothing'}`);
});

function logLinesAbout(adwId: string, text: string): string[] {
  const log = join(AGENTS_STATE_DIR, adwId, OrchestratorId.Sdlc, 'execution.log');
  return existsSync(log) ? readFileSync(log, 'utf-8').split('\n').filter((line) => line.includes(text)) : [];
}

function fixAgentOutputs(adwId: string): string[] {
  const logsDir = join(LOGS_DIR, adwId);
  return existsSync(logsDir) ? readdirSync(logsDir).filter((name) => FIX_AGENT_OUTPUT.test(name)) : [];
}

Then('the scenario fix agent was not started', function (this: RegressionWorld) {
  const adwId = claimedAdwId(this);
  const started = logLinesAbout(adwId, FIX_STARTED);
  const outputs = fixAgentOutputs(adwId);
  assert.deepStrictEqual(started, [], `Expected the scenario fix phase not to start the fix agent, but the orchestrator's log has:\n${started.join('\n')}`);
  assert.deepStrictEqual(outputs, [], `Expected the fix agent to leave no output file, but ${LOGS_DIR}/${adwId} holds: ${outputs.join(', ')}`);
});
