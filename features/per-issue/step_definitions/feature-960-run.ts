/**
 * Runs Cucumber in a child process, over a throwaway feature or over the regression suite's smoke
 * and surface scenarios, and reads the run's message stream: for each scenario that ran, the status
 * and error message of every step. The child loads exactly the support code `cucumber.js` imports,
 * so the step library under `features/regression/step_definitions/` is judged as Cucumber runs it.
 * `cucumber.js` merges a feature path given on the command line with its own paths, so every run
 * needs a tag expression to narrow it.
 */

import assert from 'assert';
import { spawnSync } from 'child_process';
import { randomBytes } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import {
  TestStepResultStatus,
  type Envelope,
  type Hook,
  type Pickle,
  type TestCase,
  type TestCaseStarted,
  type TestStepResult,
} from '@cucumber/messages';

import { REPO_ROOT } from '../../../adws/core/environment.ts';

const { PASSED, FAILED, PENDING, SKIPPED, UNDEFINED, AMBIGUOUS, UNKNOWN } = TestStepResultStatus;

const CHILD_TIMEOUT_MS = 120_000;
const CLAUDE_CLI_STUB = resolve(REPO_ROOT, 'test/mocks/claude-cli-stub.ts');
const BLANKED_CREDENTIALS: readonly string[] = ['GH_TOKEN', 'GITHUB_PAT'];
const MESSAGE_LINES_SHOWN = 8;

const UNRUNNABLE: ReadonlySet<TestStepResultStatus> = new Set([UNDEFINED, AMBIGUOUS]);
const UNRESOLVED: ReadonlySet<TestStepResultStatus> = new Set([FAILED, UNDEFINED, AMBIGUOUS]);

export type Verdict = 'passes' | 'fails' | 'is reported pending';

export interface StepOutcome {
  readonly text: string;
  readonly status: TestStepResultStatus;
  readonly message: string;
}

export interface ScenarioOutcome {
  readonly name: string;
  /** As the child reports it, relative to the checkout root it ran from. */
  readonly uri: string;
  readonly tags: readonly string[];
  /** The scenario's own steps, in order. Its hooks are kept apart: an After hook passes after a pending step. */
  readonly steps: readonly StepOutcome[];
  readonly hooks: readonly StepOutcome[];
}

export interface ThrowawayFeature {
  readonly tag: string;
  readonly path: string;
}

export interface CucumberRunOptions {
  /** Receives the run's message stream and serves as the child's temp directory. */
  readonly directory: string;
  readonly tags: string;
  readonly featurePath?: string;
}

/** The tag is unique to the run and is never an `@adw-` tag, since some per-issue hooks keyed on those set `mockContext` too. */
export function writeThrowawayFeature(directory: string, insideRegressionHooks: boolean, steps: string): ThrowawayFeature {
  const tag = `throwaway960run${randomBytes(4).toString('hex')}`;
  const stepLines = steps.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
  const path = join(directory, 'throwaway.feature');
  const lines = [
    insideRegressionHooks ? `@${tag} @regression` : `@${tag}`,
    `Feature: Throwaway run ${tag}`,
    '',
    '  Scenario: Throwaway scenario',
    ...stepLines.map((line) => `    ${line}`),
    '',
  ];
  writeFileSync(path, lines.join('\n'), 'utf-8');
  return { tag, path };
}

/** The child must reach neither GitHub nor the Claude CLI, even if a step under test ran something it should not. */
function childEnvironment(tempDirectory: string): NodeJS.ProcessEnv {
  // cucumber.js adds a JUnit formatter when this is set, which would overwrite the outer run's report.
  const { ADW_JUNIT_REPORT_PATH: _junitReport, ...inherited } = process.env;
  const blanked = [...BLANKED_CREDENTIALS, ...Object.keys(inherited).filter((name) => name.startsWith('GITHUB_APP_'))];
  return {
    ...inherited,
    ...Object.fromEntries(blanked.map((name) => [name, ''])),
    CLAUDE_CODE_PATH: CLAUDE_CLI_STUB,
    NODE_OPTIONS: '--import tsx',
    TMPDIR: tempDirectory,
  };
}

function tail(output: string, lines = 30): string {
  return output.trim().split('\n').slice(-lines).join('\n');
}

interface ChildRun {
  readonly messagesPath: string;
  /** The child's stdout and stderr, shown when its message stream is missing or incomplete. */
  readonly output: string;
}

function spawnCucumber({ directory, tags, featurePath }: CucumberRunOptions): ChildRun {
  const messagesPath = join(directory, 'messages.ndjson');
  const tempDirectory = join(directory, 'tmp');
  mkdirSync(tempDirectory, { recursive: true });

  const result = spawnSync(
    'bunx',
    ['cucumber-js', '--tags', tags, '--format', `message:${messagesPath}`, ...(featurePath ? [featurePath] : [])],
    {
      cwd: REPO_ROOT,
      env: childEnvironment(tempDirectory),
      encoding: 'utf-8',
      maxBuffer: 64 * 1024 * 1024,
      timeout: CHILD_TIMEOUT_MS,
    },
  );
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  assert.ok(!result.error, `Could not run the child Cucumber process: ${result.error?.message}\n${tail(output)}`);
  return { messagesPath, output };
}

function readEnvelopes({ messagesPath, output }: ChildRun): Envelope[] {
  assert.ok(existsSync(messagesPath), `The child Cucumber process wrote no message stream. Output:\n${tail(output)}`);
  const lines = readFileSync(messagesPath, 'utf-8').split('\n').filter((line) => line.trim().length > 0);
  const envelopes = lines.map((line) => JSON.parse(line) as Envelope);

  const parseErrors = envelopes.flatMap(({ parseError }) => (parseError ? [`${parseError.source.uri}: ${parseError.message}`] : []));
  assert.deepStrictEqual(parseErrors, [], 'The child Cucumber process could not parse a feature file');
  assert.ok(envelopes.some(({ testRunFinished }) => testRunFinished), `The child Cucumber run did not finish. Output:\n${tail(output)}`);
  return envelopes;
}

export function runCucumber(options: CucumberRunOptions): readonly ScenarioOutcome[] {
  const scenarios = scenariosFrom(readEnvelopes(spawnCucumber(options)));
  assert.deepStrictEqual(scenarios.flatMap(brokenParts), [], 'The child Cucumber run is broken, which says nothing about the step under test');
  return scenarios;
}

interface MessageIndex {
  readonly pickles: ReadonlyMap<string, Pickle>;
  readonly testCases: ReadonlyMap<string, TestCase>;
  readonly hooks: ReadonlyMap<string, Hook>;
  readonly results: ReadonlyMap<string, TestStepResult>;
}

function resultKey(testCaseStartedId: string, testStepId: string): string {
  return `${testCaseStartedId}/${testStepId}`;
}

function indexOf(envelopes: readonly Envelope[]): MessageIndex {
  const finishedSteps = envelopes.flatMap(({ testStepFinished }) => (testStepFinished ? [testStepFinished] : []));
  return {
    pickles: new Map(envelopes.flatMap(({ pickle }) => (pickle ? [[pickle.id, pickle] as const] : []))),
    testCases: new Map(envelopes.flatMap(({ testCase }) => (testCase ? [[testCase.id, testCase] as const] : []))),
    hooks: new Map(envelopes.flatMap(({ hook }) => (hook ? [[hook.id, hook] as const] : []))),
    results: new Map(finishedSteps.map((step) => [resultKey(step.testCaseStartedId, step.testStepId), step.testStepResult] as const)),
  };
}

function scenariosFrom(envelopes: readonly Envelope[]): ScenarioOutcome[] {
  const index = indexOf(envelopes);
  return envelopes.flatMap(({ testCaseStarted }) => (testCaseStarted ? [scenarioOutcome(testCaseStarted, index)] : []));
}

function scenarioOutcome(started: TestCaseStarted, index: MessageIndex): ScenarioOutcome {
  const testCase = index.testCases.get(started.testCaseId);
  const pickle = testCase && index.pickles.get(testCase.pickleId);
  assert.ok(testCase && pickle, `The message stream holds no test case or pickle for test case ${started.testCaseId}`);

  const pickleStepTexts = new Map(pickle.steps.map((step) => [step.id, step.text] as const));
  const resultOf = (testStepId: string) => index.results.get(resultKey(started.id, testStepId));
  return {
    name: pickle.name,
    uri: pickle.uri,
    tags: pickle.tags.map((tag) => tag.name),
    steps: testCase.testSteps.flatMap((testStep) =>
      testStep.pickleStepId ? [outcomeOf(resultOf(testStep.id), pickleStepTexts.get(testStep.pickleStepId) ?? testStep.pickleStepId)] : [],
    ),
    hooks: testCase.testSteps.flatMap((testStep) =>
      testStep.hookId ? [outcomeOf(resultOf(testStep.id), describeHook(index.hooks.get(testStep.hookId)))] : [],
    ),
  };
}

function outcomeOf(result: TestStepResult | undefined, text: string): StepOutcome {
  return {
    text,
    status: result?.status ?? UNKNOWN,
    message: result?.message ?? result?.exception?.message ?? '',
  };
}

function describeHook(hook: Hook | undefined): string {
  if (!hook) return 'unknown hook';
  return `${hook.type} hook at ${hook.sourceReference.uri}:${hook.sourceReference.location?.line}`;
}

/** An undefined or ambiguous step is an error in the throwaway feature, and a hook that does not pass is an error in the harness. */
function brokenParts(scenario: ScenarioOutcome): string[] {
  const steps = scenario.steps.filter((step) => UNRUNNABLE.has(step.status)).map((step) => `${step.status} step "${step.text}"`);
  const hooks = scenario.hooks.filter((hook) => hook.status !== PASSED).map((hook) => `${hook.status} ${hook.text}`);
  return [...steps, ...hooks].map((part) => `${scenario.name}: ${part}`);
}

function isReportedPending(steps: readonly StepOutcome[]): boolean {
  const pendingAt = steps.findIndex((step) => step.status === PENDING);
  if (pendingAt < 0 || steps.some((step) => UNRESOLVED.has(step.status))) return false;
  return steps.slice(pendingAt + 1).every((step) => step.status === SKIPPED);
}

const VERDICTS: Record<Verdict, (steps: readonly StepOutcome[]) => boolean> = {
  passes: (steps) => steps.length > 0 && steps.every((step) => step.status === PASSED),
  fails: (steps) => steps.some((step) => step.status === FAILED),
  'is reported pending': isReportedPending,
};

export function verdictHolds(scenario: ScenarioOutcome, verdict: Verdict): boolean {
  return VERDICTS[verdict](scenario.steps);
}

function messageLines(message: string): string[] {
  const lines = message.split('\n').filter((line) => line.trim().length > 0);
  return lines.slice(0, MESSAGE_LINES_SHOWN).map((line) => `      ${line}`);
}

export function describeScenario(scenario: ScenarioOutcome): string {
  const steps = scenario.steps.flatMap((step) => [`  ${step.status.padEnd(9)} ${step.text}`, ...messageLines(step.message)]);
  return [`${scenario.name} (${scenario.uri})`, ...steps].join('\n');
}

export function failureMessage(scenario: ScenarioOutcome): string {
  const failed = scenario.steps.find((step) => step.status === FAILED);
  assert.ok(failed, `Expected the throwaway scenario to have a failed step, but the child Cucumber run reported:\n${describeScenario(scenario)}`);
  return failed.message;
}
