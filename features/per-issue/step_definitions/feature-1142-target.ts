/**
 * The target repository the scenarios of feature-1142.feature sweep: the cli-tool workspace, given the scenario configuration,
 * feature files and step definition files the Givens describe. Every file is committed on `main`, with `origin/main` following
 * it, because the sweep reads a fresh checkout of `origin/main` and nothing else.
 *
 * A cucumber-js target runs the real cucumber-js of this checkout by absolute path, loading its step files as CommonJS through
 * `NODE_PATH`: the target has no `node_modules`, and the `bunx` shadow that leads the cron's `PATH` would record the call and run
 * nothing. `NODE_OPTIONS` is cleared because the cron passes on `--import tsx`, which the target cannot resolve.
 */

import assert from 'assert';
import { basename, posix } from 'path';

import { REPO_ROOT } from '../../../adws/core/environment.ts';
import { commitOnDefaultBranch } from '../../regression/support/fixtureTargetRepo.ts';
import { ensureTargetWorkspace } from '../../regression/support/subprocessHarness.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';

export const CUCUMBER_JS = 'cucumber-js';
const REGRESSION_DIRECTORY = 'features/regression';
const IMPORT_LINE = 1;
const PER_ISSUE_FEATURE = /(?:^|\/)feature-(\d+)\.feature$/;
const COMMONJS_PACKAGE = `${JSON.stringify({ name: 'fixture-cli-tool', version: '1.0.0', private: true }, null, 2)}\n`;
const NOT_APPLICABLE_COMMANDS: readonly string[] = [
  'Install Dependencies',
  'Run Linter',
  'Type Check',
  'Additional Type Checks',
  'Run Tests',
  'Run Build',
  'Start Dev Server',
  'Run Regression Scenarios',
];

export interface TargetRepository {
  readonly framework: string;
  readonly perIssueDirectory: string;
  readonly stepDefinitionDirectory: string;
  /** Feature file → the text of each step it runs, in order. */
  readonly features: Map<string, string[]>;
  /** Step definition file → line → the pattern registered on that line. */
  readonly stepFiles: Map<string, Map<number, string>>;
}

const targets = new WeakMap<RegressionWorld, TargetRepository>();

function withoutTrailingSlash(directory: string): string {
  return directory.replace(/\/+$/, '');
}

function issueOfFeature(featurePath: string): number | null {
  const match = PER_ISSUE_FEATURE.exec(featurePath);
  return match ? Number(match[1]) : null;
}

function runByTagCommand(framework: string): string {
  if (framework !== CUCUMBER_JS) return `${framework} --tags=@{tag}`;
  const nodeModules = posix.join(REPO_ROOT, 'node_modules');
  const cli = posix.join(nodeModules, '@cucumber/cucumber/bin/cucumber.js');
  return `NODE_OPTIONS= NODE_PATH='${nodeModules}' '${process.execPath}' '${cli}' --tags "@{tag}"`;
}

function commandsMd(runByTag: string): string {
  const notApplicable = NOT_APPLICABLE_COMMANDS.flatMap((heading) => [`## ${heading}`, 'N/A', '']);
  return ['# Commands', '', '## Package Manager', 'npm', '', ...notApplicable, '## Run Scenarios by Tag', runByTag, ''].join('\n');
}

function scenariosMd(target: TargetRepository, runByTag: string): string {
  const scenarioDirectory = posix.dirname(withoutTrailingSlash(target.perIssueDirectory));
  return [
    '# Scenarios',
    '',
    '## Scenario Directory',
    `${scenarioDirectory}/`,
    '',
    '## Run Scenarios by Tag',
    runByTag,
    '',
    '## Run Regression Scenarios',
    'N/A',
    '',
    '## Per-Issue Scenario Directory',
    target.perIssueDirectory,
    '',
    '## BDD Framework',
    target.framework,
    '',
    '## Step Def Directory',
    target.stepDefinitionDirectory,
    '',
  ].join('\n');
}

/** Cucumber reads its own configuration from the worktree it runs in, which is where the sweep's dry run runs. */
function cucumberConfig(target: TargetRepository): string {
  const perIssue = withoutTrailingSlash(target.perIssueDirectory);
  const paths = [`${perIssue}/**/*.feature`, `${REGRESSION_DIRECTORY}/**/*.feature`];
  const require = [`${withoutTrailingSlash(target.stepDefinitionDirectory)}/**/*.js`, `${perIssue}/step_definitions/**/*.js`];
  return `${JSON.stringify({ default: { paths, require } }, null, 2)}\n`;
}

function featureText(featurePath: string, steps: readonly string[]): string {
  const issue = issueOfFeature(featurePath);
  const name = basename(featurePath, '.feature');
  const stepLines = steps.map((text, index) => `    ${index === 0 ? 'Given' : 'And'} ${text}`);
  return [issue === null ? '@regression' : `@adw-${issue}`, `Feature: ${name}`, '', `  Scenario: ${name} runs`, ...stepLines, ''].join('\n');
}

function javaScriptLine(line: number, definitions: ReadonlyMap<number, string>): string {
  if (line === IMPORT_LINE) return "const { Given } = require('@cucumber/cucumber');";
  const pattern = definitions.get(line);
  return pattern === undefined ? '' : `Given(${JSON.stringify(pattern)}, function () {});`;
}

function stepFileText(file: string, definitions: ReadonlyMap<number, string>): string {
  if (file.endsWith('.py')) {
    const blocks = [...definitions.values()].map((pattern) => `\n@given(${JSON.stringify(pattern)})\ndef step_impl(context):\n    pass`);
    return `from behave import given\n${blocks.join('\n')}\n`;
  }
  const lastLine = Math.max(IMPORT_LINE, ...definitions.keys());
  return `${Array.from({ length: lastLine }, (_, index) => javaScriptLine(index + 1, definitions)).join('\n')}\n`;
}

export function requireTarget(world: RegressionWorld): TargetRepository {
  const target = targets.get(world);
  assert.ok(target, "Expected the target repository's scenario configuration to have been given first");
  return target;
}

function commitFeature(world: RegressionWorld, featurePath: string): void {
  const steps = requireTarget(world).features.get(featurePath) ?? [];
  commitOnDefaultBranch(ensureTargetWorkspace(world), featurePath, featureText(featurePath, steps), `Write ${featurePath}`);
}

export function configureTarget(world: RegressionWorld, framework: string, perIssueDirectory: string, stepDefinitionDirectory: string): void {
  const workspace = ensureTargetWorkspace(world);
  const target: TargetRepository = { framework, perIssueDirectory, stepDefinitionDirectory, features: new Map(), stepFiles: new Map() };
  targets.set(world, target);

  const runByTag = runByTagCommand(framework);
  commitOnDefaultBranch(workspace, 'package.json', COMMONJS_PACKAGE, 'Load the step definitions as CommonJS');
  commitOnDefaultBranch(workspace, '.adw/commands.md', commandsMd(runByTag), 'Run the scenarios by tag, and no static check');
  commitOnDefaultBranch(workspace, '.adw/scenarios.md', scenariosMd(target, runByTag), 'Name the scenario directories and the BDD framework');
  if (framework === CUCUMBER_JS) commitOnDefaultBranch(workspace, 'cucumber.json', cucumberConfig(target), 'Configure cucumber-js');
}

export function addPerIssueScenario(world: RegressionWorld, featurePath: string, issue: number): void {
  const target = requireTarget(world);
  const directory = withoutTrailingSlash(target.perIssueDirectory);
  assert.ok(featurePath.startsWith(`${directory}/`), `Expected ${featurePath} to lie in the per-issue scenario directory ${directory}`);
  assert.strictEqual(issueOfFeature(featurePath), issue, `Expected ${featurePath} to be the Per-Issue Scenario of issue ${issue}`);
  target.features.set(featurePath, []);
  commitFeature(world, featurePath);
}

export function perIssueFeatureOf(world: RegressionWorld, issue: number): string {
  const featurePath = [...requireTarget(world).features.keys()].find((candidate) => issueOfFeature(candidate) === issue);
  assert.ok(featurePath, `Expected the target repository to hold the Per-Issue Scenario of issue ${issue} first`);
  return featurePath;
}

/** `line` null puts the definition after the file's last one. */
export function defineStep(world: RegressionWorld, file: string, line: number | null, pattern: string): void {
  const target = requireTarget(world);
  const definitions = target.stepFiles.get(file) ?? new Map<number, string>();
  const at = line ?? Math.max(IMPORT_LINE, ...definitions.keys()) + 2;
  assert.ok(at > IMPORT_LINE && !definitions.has(at), `Expected line ${at} of ${file} to be free for the Step Definition "${pattern}"`);
  definitions.set(at, pattern);
  target.stepFiles.set(file, definitions);
  commitOnDefaultBranch(ensureTargetWorkspace(world), file, stepFileText(file, definitions), `Define "${pattern}" in ${file}`);
}

export function useStep(world: RegressionWorld, featurePath: string, text: string): void {
  const steps = requireTarget(world).features.get(featurePath);
  assert.ok(steps, `Expected the target repository to hold ${featurePath} first`);
  steps.push(text);
  commitFeature(world, featurePath);
}

function definitionsUnder(target: TargetRepository, directory: string): string[] {
  const prefix = `${withoutTrailingSlash(directory)}/`;
  return [...target.stepFiles].filter(([file]) => file.startsWith(prefix)).flatMap(([, definitions]) => [...definitions.values()]);
}

/** Gives the Per-Issue Scenario two steps defined in `directory` when it has none, then has the regression scenario run every definition there. */
export function shareStepsWithRegressionSuite(world: RegressionWorld, directory: string, issue: number, regressionFeature: string): void {
  assert.ok(regressionFeature.startsWith(`${REGRESSION_DIRECTORY}/`), `Expected ${regressionFeature} to lie in the Regression Suite's ${REGRESSION_DIRECTORY}`);
  const target = requireTarget(world);
  const perIssueFeature = perIssueFeatureOf(world, issue);
  if ((target.features.get(perIssueFeature) ?? []).length === 0) {
    const file = `${withoutTrailingSlash(directory)}/orders.steps.js`;
    ['an order is placed', 'the order is accepted'].forEach((pattern, index) => {
      defineStep(world, file, 3 + index, pattern);
      useStep(world, perIssueFeature, pattern);
    });
  }

  const shared = definitionsUnder(target, directory);
  const notShared = (target.features.get(perIssueFeature) ?? []).filter((step) => !shared.includes(step));
  assert.deepStrictEqual(notShared, [], `Expected every step of ${perIssueFeature} to be defined in ${directory}`);
  target.features.set(regressionFeature, shared);
  commitFeature(world, regressionFeature);
}
