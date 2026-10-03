/**
 * Step definitions for §5 of feature-961.feature: the checks that only a Cucumber run of its own can
 * make. A dry run shows how every step in the configured suite resolves; a real child run shows the
 * promoted feature's results and what it leaves behind. Both read the run's message stream.
 */

import { Given, When, Then } from '@cucumber/cucumber';
import type { DataTable } from '@cucumber/cucumber';
import { TestStepResultStatus, type Envelope, type Pickle, type TestCase } from '@cucumber/messages';
import assert from 'assert';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import { AUTH_GATE_PATH, writeAuthGate } from '../../../adws/core/authGate.ts';
import { AGENTS_STATE_DIR, LOGS_DIR } from '../../../adws/core/config.ts';

export interface ChildRun {
  readonly status: number | null;
  readonly envelopes: readonly Envelope[];
  readonly stderr: string;
}

interface StateSnapshot {
  readonly authGate: string | null;
  readonly cronRegistry: Readonly<Record<string, string>>;
  readonly cronLogs: Readonly<Record<string, string>>;
}

interface ResolvedStep {
  readonly uri: string;
  readonly definitions: number;
}

const state: { run: ChildRun | null; before: StateSnapshot | null } = { run: null, before: null };

/** Laid over the child's environment by a scenario that needs the child to see something of its own; null leaves it as the parent's. */
let childEnvironment: NodeJS.ProcessEnv | null = null;

export function setChildEnvironment(overlay: NodeJS.ProcessEnv | null): void {
  childEnvironment = overlay;
}

// The child may hold the subprocess surface rows, each bounded at two minutes.
const STEP_TIMEOUT_MS = 10 * 60_000;
/** `spawnSync` blocks the event loop, so Cucumber's own step timer cannot fire while it runs; this one has to come first. */
const SPAWN_TIMEOUT_MS = STEP_TIMEOUT_MS - 15_000;

/** The code under test logs to stdout, so a run that executes steps interleaves log lines with the envelopes. */
function parseEnvelopeLine(line: string): Envelope[] {
  if (!line.startsWith('{')) return [];
  try {
    return [JSON.parse(line) as Envelope];
  } catch {
    return [];
  }
}

/**
 * ADW's test phase sets `ADW_JUNIT_REPORT_PATH` for the parent run; a child that inherited it would
 * get a junit formatter from `cucumber.js` and overwrite the parent's report. `--format message`
 * takes stdout from `progress`, because the last formatter without a target gets it. The child is
 * selected by tag expression only: `cucumber.js` adds a path argument to its configured paths
 * instead of narrowing the run, so a path-selected child would also run this feature, and recurse.
 */
function runCucumber(args: readonly string[]): ChildRun {
  const env: NodeJS.ProcessEnv = { ...process.env, ...childEnvironment, NODE_OPTIONS: '--import tsx' };
  delete env.ADW_JUNIT_REPORT_PATH;
  const result = spawnSync('bunx', ['cucumber-js', ...args, '--format', 'message'], {
    cwd: process.cwd(),
    encoding: 'utf-8',
    maxBuffer: 256 * 1024 * 1024,
    timeout: SPAWN_TIMEOUT_MS,
    env,
  });
  assert.ok(!result.error, `Expected the child Cucumber run to finish: ${result.error}`);
  const envelopes = (result.stdout ?? '').split('\n').flatMap(parseEnvelopeLine);
  return { status: result.status, envelopes, stderr: result.stderr ?? '' };
}

/** The run the scenario's When step made, for the steps of other features that judge it. */
export function requireRun(): ChildRun {
  assert.ok(state.run, 'Expected a child Cucumber run to have been made first');
  return state.run;
}

function picklesOf(envelopes: readonly Envelope[]): Pickle[] {
  return envelopes.flatMap((envelope) => (envelope.pickle ? [envelope.pickle] : []));
}

function testCasesOf(envelopes: readonly Envelope[]): TestCase[] {
  return envelopes.flatMap((envelope) => (envelope.testCase ? [envelope.testCase] : []));
}

/** A test step resolves to its step definitions: none means undefined, more than one means ambiguous. */
function resolvedStepsOf(testCase: TestCase, text: string, texts: ReadonlyMap<string, string>, uri: string): ResolvedStep[] {
  return testCase.testSteps
    .filter((step) => step.pickleStepId !== undefined && texts.get(step.pickleStepId) === text)
    .map((step) => ({ uri, definitions: step.stepDefinitionIds?.length ?? 0 }));
}

function resolvedSteps(envelopes: readonly Envelope[], text: string): ResolvedStep[] {
  const pickles = picklesOf(envelopes);
  const texts = new Map(pickles.flatMap((pickle) => pickle.steps.map((step): [string, string] => [step.id, step.text])));
  const uris = new Map(pickles.map((pickle): [string, string] => [pickle.id, pickle.uri]));
  return testCasesOf(envelopes).flatMap((testCase) => resolvedStepsOf(testCase, text, texts, uris.get(testCase.pickleId) ?? ''));
}

When('Cucumber dry-runs every feature its configuration loads', { timeout: STEP_TIMEOUT_MS }, function () {
  state.run = runCucumber(['--dry-run']);
});

Then('every {string} step in the dry run matches exactly one step definition', function (text: string) {
  const steps = resolvedSteps(requireRun().envelopes, text);
  assert.ok(steps.length > 0, `Expected the dry run to hold at least one "${text}" step`);
  const offenders = steps.filter((step) => step.definitions !== 1).map((step) => `${step.uri} (${step.definitions} definitions)`);
  assert.deepStrictEqual([...new Set(offenders)], [], `Expected every "${text}" step to match exactly one step definition`);
});

Then('the dry run holds a {string} step in each of these features:', function (text: string, table: DataTable) {
  const pickles = picklesOf(requireRun().envelopes);
  const holdsStep = (uri: string): boolean => pickles.some((pickle) => pickle.uri === uri && pickle.steps.some((step) => step.text === text));
  const missing = table.hashes().map((row) => row.feature).filter((uri) => !holdsStep(uri));
  assert.deepStrictEqual(missing, [], `Expected the dry run to hold a "${text}" step in each listed feature`);
});

function readIfExists(file: string): string | null {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : null;
}

/** The names and contents of the files in a directory; an absent directory counts as empty. */
function directoryContents(dir: string): Record<string, string> {
  if (!fs.existsSync(dir)) return {};
  const names = fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => entry.name).sort();
  return Object.fromEntries(names.map((name): [string, string] => [name, fs.readFileSync(path.join(dir, name), 'utf-8')]));
}

function snapshotState(): StateSnapshot {
  return {
    authGate: readIfExists(AUTH_GATE_PATH),
    cronRegistry: directoryContents(path.join(AGENTS_STATE_DIR, 'cron')),
    cronLogs: directoryContents(path.join(LOGS_DIR, 'agents', 'cron')),
  };
}

/** The stream lists a scenario's pickle and test case before it starts, so one pass maps each start to a name. */
function scenarioNames(envelopes: readonly Envelope[]): Map<string, string> {
  const pickleNames = new Map<string, string>();
  const pickleOfTestCase = new Map<string, string>();
  const names = new Map<string, string>();
  for (const { pickle, testCase, testCaseStarted } of envelopes) {
    if (pickle) pickleNames.set(pickle.id, pickle.name);
    if (testCase) pickleOfTestCase.set(testCase.id, testCase.pickleId);
    if (testCaseStarted) names.set(testCaseStarted.id, pickleNames.get(pickleOfTestCase.get(testCaseStarted.testCaseId) ?? '') ?? '');
  }
  return names;
}

function describeFailure(envelope: Envelope, names: ReadonlyMap<string, string>): string[] {
  const finished = envelope.testStepFinished;
  if (!finished || finished.testStepResult.status === TestStepResultStatus.PASSED) return [];
  const { status, message } = finished.testStepResult;
  return [`${names.get(finished.testCaseStartedId) ?? 'unknown scenario'}: ${status} ${message ?? ''}`.trim()];
}

function failingSteps(envelopes: readonly Envelope[]): string[] {
  const names = scenarioNames(envelopes);
  return envelopes.flatMap((envelope) => describeFailure(envelope, names));
}

Given("ADW's auth gate holds a record of an earlier authentication failure", function () {
  writeAuthGate({ adwId: null, issueNumber: null, agentName: 'auth-gate-record-probe' });
});

When('Cucumber runs the scenarios tagged {string} in a child process', { timeout: STEP_TIMEOUT_MS }, function (tags: string) {
  state.before = snapshotState();
  state.run = runCucumber(['--tags', tags]);
});

Then('that run held at least one scenario, and every one of them passed', function () {
  const { status, envelopes, stderr } = requireRun();
  assert.ok(testCasesOf(envelopes).length > 0, `Expected the run to hold at least one scenario. stderr:\n${stderr}`);
  assert.deepStrictEqual(failingSteps(envelopes), [], 'Expected every step of every scenario to pass');
  assert.strictEqual(status, 0, `Expected the run to exit 0. stderr:\n${stderr}`);
});

Then("ADW's auth gate, the cron registry and the cron logs are as they were before that run", function () {
  assert.ok(state.before, 'Expected the state to have been snapshotted just before the child run');
  assert.deepStrictEqual(snapshotState(), state.before);
});
