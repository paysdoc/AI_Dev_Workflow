/**
 * The cucumber-jvm repository the scenario of feature-1143.feature sweeps: the cli-tool workspace, given the ".adw/" that
 * "adw_init" writes for a "mobile:kotlincm" repository, the Kotlin step definitions and feature files the Givens describe,
 * and a Gradle wrapper. Every file is committed on `main`, with `origin/main` following it, because the sweep reads a fresh
 * checkout of `origin/main` and nothing else.
 *
 * The host has no Gradle and no Kotlin compiler, so `gradlew` is a stand-in for the `:scenarios` test task's dry run: it writes
 * the report cucumber-jvm's `unused` plugin would write for the committed files to the path of `-Dcucumber.plugin=unused:`,
 * and fails unless the run is a dry run. It is a shell script because the cron passes on `NODE_OPTIONS=--import tsx`, which
 * a Node script run in the target could not resolve.
 */

import assert from 'assert';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join, posix } from 'path';

import { DEFAULT_BRANCH, commitOnDefaultBranch } from '../../regression/support/fixtureTargetRepo.ts';
import { realGit } from '../../regression/support/fixtureWorktree.ts';
import { ensureTargetWorkspace } from '../../regression/support/subprocessHarness.ts';
import { adwFilesWrittenFor } from '../../regression/step_definitions/feature-1044-prompt.ts';
import { renderAdwFiles } from '../../regression/step_definitions/feature-992-adw-files.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';

const CUCUMBER_JVM = 'cucumber-jvm';
const GRADLE_WRAPPER = 'gradlew';
const KOTLIN_EXTENSION = '.kt';
const REGRESSION_DIRECTORY = 'features/regression';
const EXECUTABLE = 0o755;

interface JvmTarget {
  readonly stepDefinitionDirectory: string;
  /** Kotlin step file → the pattern of each definition, in order. */
  readonly stepFiles: Map<string, string[]>;
  /** Feature file → the text of each step it runs, in order. */
  readonly features: Map<string, string[]>;
}

interface UnusedDefinition {
  readonly location: string;
  readonly pattern: string;
}

const targets = new WeakMap<RegressionWorld, JvmTarget>();

function requireJvmTarget(world: RegressionWorld): JvmTarget {
  const target = targets.get(world);
  assert.ok(target, "Expected the cucumber-jvm repository's \".adw/\" to have been given first");
  return target;
}

/** `an order is placed` → `anOrderIsPlaced`. */
function methodNameOf(pattern: string): string {
  const [first = '', ...rest] = pattern.split(/[^A-Za-z0-9]+/).filter(Boolean);
  return [first.toLowerCase(), ...rest.map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`)].join('');
}

/** The binary name cucumber-jvm reports a step file's class by: its package, from its directory, then its class, from its name. */
function classOf(target: JvmTarget, file: string): string {
  const packagePath = posix.relative(target.stepDefinitionDirectory, posix.dirname(file));
  return [...packagePath.split('/').filter(Boolean), posix.basename(file, KOTLIN_EXTENSION)].join('.');
}

function kotlinStepFile(target: JvmTarget, file: string, patterns: readonly string[]): string {
  const binaryName = classOf(target, file).split('.');
  const className = binaryName.pop() ?? '';
  const methods = patterns.flatMap((pattern) => ['', `    @Given(${JSON.stringify(pattern)})`, `    fun ${methodNameOf(pattern)}() {}`]);
  return [`package ${binaryName.join('.')}`, '', 'import io.cucumber.java.en.Given', '', `class ${className} {`, ...methods.slice(1), '}', ''].join('\n');
}

function featureText(featurePath: string, steps: readonly string[]): string {
  const name = posix.basename(featurePath, '.feature');
  const tags = featurePath.startsWith(`${REGRESSION_DIRECTORY}/`) ? ['@regression'] : [];
  const stepLines = steps.map((text, index) => `    ${index === 0 ? 'Given' : 'And'} ${text}`);
  return [...tags, `Feature: ${name}`, '', `  Scenario: ${name} runs`, ...stepLines, ''].join('\n');
}

function unusedDefinitions(target: JvmTarget): UnusedDefinition[] {
  const used = new Set([...target.features.values()].flat());
  return [...target.stepFiles].flatMap(([file, patterns]) =>
    patterns.filter((pattern) => !used.has(pattern)).map((pattern) => ({ location: `${classOf(target, file)}.${methodNameOf(pattern)}()`, pattern })),
  );
}

/** The text cucumber-jvm 8's `unused` plugin writes: the count line, then a table whose cells are padded to their column's width. */
function unusedReport(definitions: readonly UnusedDefinition[]): string {
  const count = `\n${definitions.length} unused step definition(s)`;
  if (definitions.length === 0) return count;
  const rows = [['Location', 'Expression'], ...definitions.map(({ location, pattern }) => [location, `# ${pattern}`])];
  const widths = [0, 1].map((column) => Math.max(...rows.map((row) => row[column].length)));
  const lines = rows.map((row) => row.map((cell, column) => cell.padEnd(widths[column])).join(' '));
  return `${count}\n\n${lines.join('\n')}\n`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function gradleWrapper(report: string): string {
  return [
    '#!/bin/sh',
    'dry_run=no',
    'report=',
    'for arg in "$@"; do',
    '  case "$arg" in',
    '    -Dcucumber.execution.dry-run=true) dry_run=yes ;;',
    '    -Dcucumber.plugin=unused:*) report="${arg#-Dcucumber.plugin=unused:}" ;;',
    '  esac',
    'done',
    'if [ "$dry_run" != yes ] || [ -z "$report" ]; then',
    '  echo "gradle stand-in: expected a cucumber-jvm dry run that writes the unused report, but was given: $*" >&2',
    '  exit 1',
    'fi',
    `printf '%s' ${shellQuote(report)} > "$report"`,
    'echo "gradle stand-in: wrote cucumber-jvm\'s unused report to $report"',
    '',
  ].join('\n');
}

function commitIfChanged(workspace: string, relPath: string, contents: string, message: string): void {
  const absolutePath = join(workspace, relPath);
  if (existsSync(absolutePath) && readFileSync(absolutePath, 'utf-8') === contents) return;
  commitOnDefaultBranch(workspace, relPath, contents, message);
}

/** The sweep runs the wrapper from a fresh checkout of `origin/main`, which keeps a file's mode only as git recorded it. */
function commitExecutableIfChanged(workspace: string, relPath: string, contents: string, message: string): void {
  const absolutePath = join(workspace, relPath);
  if (existsSync(absolutePath) && readFileSync(absolutePath, 'utf-8') === contents) return;
  writeFileSync(absolutePath, contents, { mode: EXECUTABLE });
  chmodSync(absolutePath, EXECUTABLE);
  realGit(workspace, 'add', '--', relPath);
  realGit(workspace, 'update-index', '--chmod=+x', '--', relPath);
  realGit(workspace, 'commit', '-q', '-m', message);
  realGit(workspace, 'update-ref', `refs/remotes/origin/${DEFAULT_BRANCH}`, DEFAULT_BRANCH);
}

function commitGradleWrapper(world: RegressionWorld): void {
  const report = unusedReport(unusedDefinitions(requireJvmTarget(world)));
  commitExecutableIfChanged(ensureTargetWorkspace(world), GRADLE_WRAPPER, gradleWrapper(report), 'Write the Gradle wrapper stand-in');
}

export function configureJvmTarget(world: RegressionWorld, applicationType: string, stepDefinitionDirectory: string): void {
  const files = adwFilesWrittenFor(applicationType);
  assert.strictEqual(files.scenarios.get('BDD Framework'), CUCUMBER_JVM, `Expected "adw_init" to write the BDD framework ${CUCUMBER_JVM} for ${applicationType}`);
  assert.strictEqual(
    files.scenarios.get('Step Def Directory'),
    stepDefinitionDirectory,
    `Expected "adw_init" to write the step definition directory ${stepDefinitionDirectory} for ${applicationType}`,
  );

  const workspace = ensureTargetWorkspace(world);
  Object.entries(renderAdwFiles(files)).forEach(([relPath, contents]) => commitIfChanged(workspace, relPath, contents, `Write ${relPath} as adw_init writes it`));
  targets.set(world, { stepDefinitionDirectory, stepFiles: new Map(), features: new Map() });
  commitGradleWrapper(world);
}

export function defineJvmStep(world: RegressionWorld, file: string, pattern: string): void {
  const target = requireJvmTarget(world);
  assert.ok(file.startsWith(`${target.stepDefinitionDirectory}/`) && file.endsWith(KOTLIN_EXTENSION), `Expected ${file} to be a Kotlin file under ${target.stepDefinitionDirectory}`);
  const patterns = [...(target.stepFiles.get(file) ?? []), pattern];
  target.stepFiles.set(file, patterns);
  commitOnDefaultBranch(ensureTargetWorkspace(world), file, kotlinStepFile(target, file, patterns), `Define "${pattern}" in ${file}`);
  commitGradleWrapper(world);
}

export function useStepInRegressionSuite(world: RegressionWorld, featurePath: string, pattern: string): void {
  assert.ok(featurePath.startsWith(`${REGRESSION_DIRECTORY}/`), `Expected ${featurePath} to lie in the Regression Suite's ${REGRESSION_DIRECTORY}`);
  const target = requireJvmTarget(world);
  const steps = [...(target.features.get(featurePath) ?? []), pattern];
  target.features.set(featurePath, steps);
  commitOnDefaultBranch(ensureTargetWorkspace(world), featurePath, featureText(featurePath, steps), `Run "${pattern}" in ${featurePath}`);
  commitGradleWrapper(world);
}

/** The line of the `fun` that the definition's annotation sits on, in the file as `main` holds it. */
export function declarationLineOf(world: RegressionWorld, file: string, pattern: string): number {
  const lines = realGit(ensureTargetWorkspace(world), 'show', `${DEFAULT_BRANCH}:${file}`).split('\n');
  const annotation = lines.findIndex((line) => line.trim() === `@Given(${JSON.stringify(pattern)})`);
  assert.ok(annotation >= 0, `Expected ${file} on ${DEFAULT_BRANCH} to define "${pattern}"`);
  const declaration = lines.findIndex((line, index) => index > annotation && line.trim().startsWith('fun '));
  assert.ok(declaration > annotation, `Expected a fun to follow the definition of "${pattern}" in ${file}`);
  return declaration + 1;
}
